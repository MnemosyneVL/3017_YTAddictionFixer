// Rebuilds data that crosses a trust boundary field by field: what the page posts to the content script, and
// what a content script or page sends to the service worker. Nothing is copied wholesale, so an unexpected key
// (a `type`, a `__proto__`) never travels on. Pure.
import { isRequestType, mayCall, type Role } from './access';
import { clip, finite, isChannelId, isDayKey, isStoredId, isVideoId } from './ids';
import { FEEDBACK_ACTIONS, type AnyRequest, type Request, type RequestType, type VideoInfo } from './messages';
import { TIPS } from './onboarding';
import type { Config, Heartbeat } from './types';
import { isVideoPage, parseYouTubeUrl, watchUrl } from './url';

const MAX_TITLE = 300;
const MAX_CHANNEL_NAME = 120;
/** URLs up to this length are kept as they are. */
const MAX_URL = 2048;
/** Longer than this is not looked at at all. */
const MAX_URL_INPUT = 65536;

/** Video facts reported by the MAIN-world bridge (or by any other script in the page), reduced to what we use. */
export function sanitizeVideoInfo(raw: unknown): VideoInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isVideoId(r.videoId)) return null;
  const info: VideoInfo = { videoId: r.videoId };
  const title = clip(r.title, MAX_TITLE);
  if (title) info.title = title;
  if (isChannelId(r.channelId)) info.channelId = r.channelId;
  const channelName = clip(r.channelName, MAX_CHANNEL_NAME);
  if (channelName) info.channelName = channelName;
  if (typeof r.isLive === 'boolean') info.isLive = r.isLive;
  if (r.duration === null) info.duration = null;
  else {
    const duration = finite(r.duration, 0);
    if (duration !== undefined) info.duration = duration;
  }
  return info;
}

/**
 * A page URL that is safe to store. Normal URLs pass unchanged; an over-long one is cut down to the part that
 * identifies the page (the video, or the path), so padding a URL can neither bloat storage nor dodge the rules.
 */
export function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_INPUT) return null;
  if (raw.length <= MAX_URL) return raw;
  const p = parseYouTubeUrl(raw);
  if (!p.isYouTube) return null;
  if (isVideoPage(p) && p.videoId) {
    return p.pageType === 'shorts' ? `https://www.youtube.com/shorts/${p.videoId}` : watchUrl(p.videoId);
  }
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname.slice(0, 512)}`;
  } catch {
    return null;
  }
}

/** A heartbeat as the service worker may use it: booleans are real booleans, numbers finite, the id checked. */
export function sanitizeHeartbeat(raw: unknown): Heartbeat | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const url = cleanUrl(r.url);
  if (!url) return null;
  return {
    url,
    visible: r.visible === true,
    pip: r.pip === true,
    playing: r.playing === true,
    focused: r.focused === true,
    fullscreen: r.fullscreen === true,
    playerVideoId: isVideoId(r.playerVideoId) ? r.playerVideoId : null,
    isLive: r.isLive === true,
    duration: finite(r.duration, 0) ?? null,
    currentTime: finite(r.currentTime, 0) ?? null,
    ended: r.ended === true,
    adShowing: r.adShowing === true,
  };
}

const HASH = /^[a-z][a-z0-9-]{0,31}$/i;
const MAX_IMPORT = 64 * 1024 * 1024;

/**
 * Rebuilds a request of a known type from the raw message. Returns null when a required field is missing or
 * malformed. `tabId` (redirect another tab) is only honoured from an extension page.
 */
export function sanitizeRequest(type: RequestType, raw: Record<string, unknown>, role: Role): AnyRequest | null {
  switch (type) {
    case 'getBuild':
      return { type };
    case 'getStatus':
      return { type };
    case 'getConfig':
      return { type };
    case 'exportData':
      return { type };
    case 'decide': {
      const url = cleanUrl(raw.url);
      if (!url) return null;
      const req: Request<'decide'> = { url, type };
      const video = sanitizeVideoInfo(raw.video);
      if (video) req.video = video;
      return req;
    }
    case 'heartbeat': {
      const hb = sanitizeHeartbeat(raw);
      return hb ? { ...hb, type } : null;
    }
    case 'videoInfo': {
      const info = sanitizeVideoInfo(raw);
      return info ? { ...info, type } : null;
    }
    case 'categorize': {
      const url = cleanUrl(raw.url);
      if (!url || !isVideoId(raw.videoId) || !isStoredId(raw.categoryId)) return null;
      const req: Request<'categorize'> = { videoId: raw.videoId, categoryId: raw.categoryId, url, type };
      const rule = raw.channelRule as Record<string, unknown> | null | undefined;
      if (rule && typeof rule === 'object' && isChannelId(rule.channelId)) {
        req.channelRule = { channelId: rule.channelId, channelName: clip(rule.channelName, MAX_CHANNEL_NAME) ?? rule.channelId };
      }
      const tabId = finite(raw.tabId, 0);
      if (role === 'page' && tabId !== undefined && Number.isInteger(tabId)) req.tabId = tabId;
      return req;
    }
    case 'promptInfo':
      return isVideoId(raw.videoId) ? { videoId: raw.videoId, type } : null;
    case 'removeSavedLink':
      // Compared for equality with stored links only, so it is not parsed; just bounded.
      return typeof raw.url === 'string' && raw.url.length <= MAX_URL_INPUT ? { url: raw.url, type } : null;
    case 'openOptions':
      return typeof raw.hash === 'string' && HASH.test(raw.hash) ? { hash: raw.hash, type } : { type };
    case 'saveConfig':
      // The handler runs it through normalizeConfig(), which rebuilds every field.
      return raw.config && typeof raw.config === 'object' ? { config: raw.config as Config, type } : null;
    case 'getBlockInfo': {
      const url = cleanUrl(raw.url);
      return url ? { url, type } : null;
    }
    case 'useOverride': {
      const url = cleanUrl(raw.url);
      return url ? { url, type } : null;
    }
    case 'getSavedLinks': {
      const limit = finite(raw.limit, 0, 500);
      return limit === undefined ? { type } : { limit: Math.floor(limit), type };
    }
    case 'getReport':
      return isDayKey(raw.from) && isDayKey(raw.to) ? { from: raw.from, to: raw.to, type } : null;
    case 'importData':
      return typeof raw.json === 'string' && raw.json.length <= MAX_IMPORT ? { json: raw.json, type } : null;
    case 'clearData':
      // No default: a malformed request must not turn into "wipe the settings too".
      return typeof raw.keepConfig === 'boolean' ? { keepConfig: raw.keepConfig, type } : null;
    case 'getOnboarding':
      return { type };
    case 'feedbackAction': {
      const action = FEEDBACK_ACTIONS.find((a) => a === raw.action);
      return action ? { action, type } : null;
    }
    case 'ackTip': {
      const tip = TIPS.find((t) => t === raw.tip);
      return tip ? { tip, type } : null;
    }
    case 'completeSetup':
      return raw.config && typeof raw.config === 'object' ? { config: raw.config as Config, type } : null;
  }
}

export type Checked = { req: AnyRequest } | { error: string };

/** The single entry check for a runtime message: known type, allowed for the sender's role, well-formed. */
export function checkRequest(msg: unknown, role: Role): Checked {
  if (!msg || typeof msg !== 'object') return { error: 'invalid request' };
  const raw = msg as Record<string, unknown>;
  const type = raw.type;
  if (!isRequestType(type)) {
    return { error: `unknown request type ${typeof type === 'string' ? type.slice(0, 40) : typeof type}` };
  }
  if (!mayCall(type, role)) return { error: `${type} is not available to content scripts` };
  const req = sanitizeRequest(type, raw, role);
  return req ? { req } : { error: `invalid ${type} request` };
}
