// Who may ask the service worker for what. Pure.
import type { RequestType } from './messages';
import { isYouTubeHost } from './url';

/** `content`: a content script in a YouTube tab. `page`: one of the extension's own pages (popup, settings, …). */
export type Role = 'content' | 'page';

/**
 * The least privileged role that may send each request. A content script runs inside YouTube's renderer
 * process, so it gets exactly what its own UI needs; everything that reads or rewrites the user's data is
 * page-only. The mapped type forces every new request to be classified here.
 */
export const ACCESS: { readonly [T in RequestType]: Role } = {
  decide: 'content',
  heartbeat: 'content',
  videoInfo: 'content',
  categorize: 'content',
  promptInfo: 'content',
  removeSavedLink: 'content',
  openOptions: 'content',
  getBuild: 'page',
  getStatus: 'page',
  getConfig: 'page',
  saveConfig: 'page',
  getBlockInfo: 'page',
  useOverride: 'page',
  getSavedLinks: 'page',
  getReport: 'page',
  exportData: 'page',
  importData: 'page',
  clearData: 'page',
  getOnboarding: 'page',
  ackTip: 'page',
  feedbackAction: 'page',
  completeSetup: 'page',
};

/** Own-property check: "constructor" or "toString" are not request types. */
export function isRequestType(v: unknown): v is RequestType {
  return typeof v === 'string' && Object.hasOwn(ACCESS, v);
}

export function mayCall(type: RequestType, role: Role): boolean {
  return role === 'page' || ACCESS[type] === 'content';
}

/** The parts of `chrome.runtime.MessageSender` the decision needs. */
export interface SenderLike {
  id?: string;
  origin?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number };
}

/** Scheme and host of a URL. (`URL.origin` is "null" for `chrome-extension:` outside the browser.) */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.host ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

/**
 * Classifies the sender of a runtime message, or returns null for anything we do not answer.
 * The origin decides: `sender.tab` cannot, because the settings, report and placeholder pages live in tabs too.
 * An extension page inside a frame gets no role, so a framed placeholder page cannot act for the user.
 */
export function senderRole(sender: SenderLike, selfId: string): Role | null {
  if (!selfId || sender.id !== selfId) return null;
  const origin = sender.origin ?? originOf(sender.url);
  if (!origin) return null;
  if (origin === `chrome-extension://${selfId}`) {
    return sender.tab === undefined || sender.frameId === 0 ? 'page' : null;
  }
  if (sender.tab?.id === undefined || sender.frameId !== 0) return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return isYouTubeHost(u.hostname) ? 'content' : null;
}
