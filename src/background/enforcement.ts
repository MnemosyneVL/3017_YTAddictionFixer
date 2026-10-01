// Turns policy decisions into actions on tabs.
import { addSavedLink } from '../shared/links';
import { blockedPageUrl, type PushMessage } from '../shared/messages';
import { evaluate, knownCategory, type PolicyContext } from '../shared/policy';
import { isVideoPage, parseYouTubeUrl, watchUrl } from '../shared/url';
import type { CategoryId, Decision, Millis, VideoId } from '../shared/types';
import { persist, type Store } from './store';

/**
 * Category of a video as far as we know: explicit memory, then a channel rule, then the Shorts
 * auto-category (`knownCategory`). Rule/auto results are written back to the index so accounting uses them too.
 */
export function resolveCategory(s: Store, videoId: VideoId | null, opts: { channelId?: string | null; isShorts?: boolean; now: Millis }): CategoryId | null {
  if (!videoId) return null;
  const entry = s.videoIndex[videoId];
  if (entry?.categoryId) return entry.categoryId;
  const resolved = knownCategory(s.config, entry, { channelId: opts.channelId, isShorts: !!opts.isShorts });
  if (resolved) {
    s.videoIndex[videoId] = { ...(entry ?? { at: opts.now }), categoryId: resolved, at: opts.now };
    s.day.videos[videoId] && (s.day.videos[videoId]!.categoryId = resolved);
  }
  return resolved;
}

export function policyContext(s: Store, now: Millis): PolicyContext {
  return { config: s.config, state: s.state, windows: s.day.limits.windows, now };
}

export function blockedUrlFor(s: Store, url: string, decision: Extract<Decision, { action: 'block' }>): string {
  const videoId = parseYouTubeUrl(url).videoId;
  const finished = !!videoId && s.state.finishedVideos.includes(videoId);
  return blockedPageUrl(chrome.runtime.getURL('blocked.html'), url, decision.reason, decision.categoryId, finished);
}

/** Remembers a blocked video link so it can be watched another day. */
export function saveLink(s: Store, url: string, decision: Extract<Decision, { action: 'block' }>, now: Millis): boolean {
  return addSavedLink(s.state, s.videoIndex, url, decision.reason, now);
}

async function updateTabWithRetry(tabId: number, url: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chrome.tabs.update(tabId, { url });
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cannot be edited/i.test(msg)) return; // tab gone or not ours
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/**
 * The YouTube page the tab is showing (or loading) right now, or null. Without the `tabs` permission a tab's
 * URL is only visible for hosts we have access to, so "no URL" means "not ours".
 */
async function youTubeUrlOf(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.pendingUrl ?? tab.url;
    return url && parseYouTubeUrl(url).isYouTube ? url : null;
  } catch {
    return null; // tab closed
  }
}

/**
 * Sends the tab to the placeholder. Prefers the content script (location.replace → no history entry);
 * falls back to tabs.update when there is no receiver, and verifies the navigation happened.
 * `pageUrl` is the page the decision was made for: the forced redirect only ever hits a tab that is still
 * showing exactly that page. A tab that has left YouTube since its last heartbeat loses its registry entry;
 * one that has moved on to another YouTube page is left to that page's own gate.
 */
export async function redirectTab(s: Store, tabId: number, pageUrl: string, originalUrl: string, decision: Extract<Decision, { action: 'block' }>): Promise<void> {
  const blockedUrl = blockedUrlFor(s, originalUrl, decision);
  const msg: PushMessage = { type: 'block', reason: decision.reason, categoryId: decision.categoryId, blockedUrl };
  let delivered = false;
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    delivered = true;
  } catch {
    delivered = false;
  }
  if (!delivered) {
    const current = await youTubeUrlOf(tabId);
    if (current === pageUrl) {
      await updateTabWithRetry(tabId, blockedUrl);
    } else if (current === null && s.tabs[tabId]) {
      delete s.tabs[tabId];
      await persist(s, ['tabs']);
    }
    return;
  }
  setTimeout(async () => {
    if ((await youTubeUrlOf(tabId)) === pageUrl) await updateTabWithRetry(tabId, blockedUrl);
  }, 1500);
}

/**
 * Evaluates a tab's page (and, if different, the video loaded in its player) and blocks if needed.
 * Returns the decision for the page URL.
 */
export async function enforceTab(s: Store, tabId: number, url: string, categoryId: CategoryId | null, now: Millis, playerVideoId?: VideoId | null): Promise<Decision> {
  const ctx = policyContext(s, now);
  let decision = evaluate(url, categoryId, ctx);
  let originalUrl = url;
  const parsed = parseYouTubeUrl(url);
  if (decision.action !== 'block' && playerVideoId && playerVideoId !== parsed.videoId) {
    const playerCat = resolveCategory(s, playerVideoId, { now, isShorts: false });
    const d2 = evaluate(watchUrl(playerVideoId), playerCat, ctx);
    if (d2.action === 'block') {
      decision = d2;
      originalUrl = isVideoPage(parsed) ? url : watchUrl(playerVideoId);
    }
  }
  if (decision.action === 'block') {
    if (saveLink(s, originalUrl, decision, now)) await persist(s, ['state']);
    await redirectTab(s, tabId, url, originalUrl, decision);
  }
  return decision;
}

/** Re-evaluates every registered tab (after a block transition, override expiry, config change…). */
export async function enforceAll(s: Store, now: Millis): Promise<void> {
  for (const tab of Object.values(s.tabs)) {
    const parsed = parseYouTubeUrl(tab.url);
    if (!parsed.isYouTube) continue;
    const categoryId = resolveCategory(s, parsed.videoId, { now, isShorts: parsed.pageType === 'shorts' });
    await enforceTab(s, tab.tabId, tab.url, categoryId, now, tab.playerVideoId);
  }
}
