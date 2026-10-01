// Time accounting: credits heartbeat intervals, detects limits, manages grandfather budgets. Pure.
// Mutates `state`, `day` and `tabs` in place (the caller persists them) and returns the events raised.
import { categoryById } from './config';
import { shouldCount } from './counting';
import { dayTotals } from './day';
import { markFinished, removeSavedVideo } from './links';
import { isVideoPage, parseYouTubeUrl } from './url';
import {
  BUILTIN_BROWSING,
  type Attribution,
  type Block,
  type CategoryId,
  type Config,
  type DayRecord,
  type Grandfather,
  type Heartbeat,
  type IdleState,
  type Millis,
  type State,
  type TabRecord,
  type VideoId,
  type VideoIndex,
} from './types';

export interface AccountingContext {
  config: Config;
  state: State;
  day: DayRecord;
  tabs: Record<number, TabRecord>;
  videoIndex: VideoIndex;
  idle: IdleState;
  now: Millis;
}

export type AccountingEvent =
  | { type: 'dailyWarning' }
  | { type: 'dailyLimit' }
  | { type: 'categoryWarning'; categoryId: CategoryId }
  | { type: 'categoryLimit'; categoryId: CategoryId }
  | { type: 'grandfatherExhausted'; videoId: VideoId };

export interface AccountingResult {
  creditedSec: number;
  attribution: Attribution;
  counts: boolean;
  events: AccountingEvent[];
}

export function categoryOf(videoIndex: VideoIndex, videoId: VideoId): CategoryId | null {
  return videoIndex[videoId]?.categoryId ?? null;
}

/** What the heartbeat's current state should be attributed to. */
export function attributionFor(hb: Heartbeat): Attribution {
  const parsed = parseYouTubeUrl(hb.url);
  if (hb.playing && hb.playerVideoId) return { kind: 'video', videoId: hb.playerVideoId };
  if (isVideoPage(parsed) && parsed.videoId) return { kind: 'video', videoId: parsed.videoId };
  if (parsed.isYouTube) return { kind: 'browsing' };
  return { kind: 'none' };
}

function creditDay(ctx: AccountingContext, attribution: Attribution, sec: number): void {
  const { day, now, videoIndex } = ctx;
  if (attribution.kind === 'video') {
    const id = attribution.videoId;
    const known = categoryOf(videoIndex, id);
    const v = day.videos[id] ?? (day.videos[id] = { categoryId: known, sec: 0, firstAt: now, lastAt: now });
    v.sec += sec;
    v.lastAt = now;
    if (known) v.categoryId = known;
  } else if (attribution.kind === 'browsing') {
    day.browsingSec += sec;
  }
}

function allBlocks(state: State): Block[] {
  const blocks: Block[] = [];
  if (state.dailyBlock) blocks.push(state.dailyBlock);
  for (const b of Object.values(state.categoryBlocks)) blocks.push(b);
  return blocks;
}

/** Burns `sec` from every grandfather budget for `videoId`; returns true if any budget ran out. */
export function burnGrandfather(state: State, videoId: VideoId, sec: number): boolean {
  let exhausted = false;
  for (const block of allBlocks(state)) {
    for (const g of block.grandfathers) {
      if (g.videoId !== videoId) continue;
      g.budgetSec -= sec;
      if (g.budgetSec <= 0) exhausted = true;
    }
    block.grandfathers = block.grandfathers.filter((g) => g.budgetSec > 0);
  }
  return exhausted;
}

/** Removes every grandfather for `videoId` (the video ended). Returns true if any existed. */
export function consumeGrandfather(state: State, videoId: VideoId): boolean {
  let existed = false;
  for (const block of allBlocks(state)) {
    const before = block.grandfathers.length;
    block.grandfathers = block.grandfathers.filter((g) => g.videoId !== videoId);
    if (block.grandfathers.length !== before) existed = true;
  }
  return existed;
}

export function isGrandfathered(block: Block | null | undefined, videoId: VideoId | null): boolean {
  if (!block || !videoId) return false;
  return block.grandfathers.some((g) => g.videoId === videoId && g.budgetSec > 0);
}

/**
 * How much longer the current video may play once a limit trips. `graceMin` comes from the video's category:
 * null = until the end of the video (plus an ad margin, capped globally); a finite value caps it further;
 * 0 = no allowance at all.
 */
export function grandfatherBudgetSec(
  config: Config,
  tab: Pick<TabRecord, 'isLive' | 'duration' | 'currentTime'>,
  graceMin: number | null = null,
): number {
  const graceCap = graceMin === null ? Infinity : graceMin * 60;
  if (tab.isLive || tab.duration === null || !Number.isFinite(tab.duration) || tab.duration <= 0) {
    return Math.min(config.liveGraceMin * 60, graceCap);
  }
  const remaining = Math.max(0, tab.duration - (tab.currentTime ?? 0));
  const margin = Math.max(120, remaining * 0.1);
  return Math.min(config.maxGrandfatherMin * 60, remaining + margin, graceCap);
}

/**
 * Videos the user is in the middle of when a limit trips: loaded in a tab that is playing or actively
 * attended (visible, focused, not idle). Paused videos in hidden tabs are not included — they were opened
 * for later and will be saved as links instead.
 */
function grandfathersFor(ctx: AccountingContext, accept: (videoId: VideoId) => boolean): Grandfather[] {
  const byVideo = new Map<VideoId, Grandfather>();
  for (const tab of Object.values(ctx.tabs)) {
    const id = tab.playerVideoId;
    if (!id || !(tab.playing || tab.counts) || !accept(id)) continue;
    const graceMin = categoryById(ctx.config, categoryOf(ctx.videoIndex, id))?.graceMin ?? null;
    const budgetSec = grandfatherBudgetSec(ctx.config, tab, graceMin);
    if (budgetSec <= 0) continue; // grace 0: stop immediately, no allowance
    const existing = byVideo.get(id);
    if (!existing || existing.budgetSec < budgetSec) byVideo.set(id, { videoId: id, budgetSec });
  }
  return [...byVideo.values()];
}

function detectLimits(ctx: AccountingContext, events: AccountingEvent[]): void {
  const { state, day, config, now } = ctx;
  const totals = dayTotals(day);
  const warnSec = config.warnBeforeMin * 60;

  if (day.limits.dailySec !== null && !state.dailyBlock) {
    if (totals.totalSec >= day.limits.dailySec) {
      state.dailyBlock = { since: now, grandfathers: grandfathersFor(ctx, () => true) };
      day.events.push({ at: now, type: 'dailyLimit' });
      events.push({ type: 'dailyLimit' });
    } else if (warnSec > 0 && !state.warned.daily && totals.totalSec >= day.limits.dailySec - warnSec) {
      state.warned.daily = true;
      day.events.push({ at: now, type: 'dailyWarning' });
      events.push({ type: 'dailyWarning' });
    }
  }

  for (const [categoryId, limit] of Object.entries(day.limits.category)) {
    if (limit === null || limit === undefined || state.categoryBlocks[categoryId]) continue;
    const sec = totals.byCategory[categoryId] ?? 0;
    if (sec >= limit) {
      const grandfathers =
        categoryId === BUILTIN_BROWSING
          ? []
          : grandfathersFor(ctx, (videoId) => categoryOf(ctx.videoIndex, videoId) === categoryId);
      state.categoryBlocks[categoryId] = { since: now, grandfathers };
      day.events.push({ at: now, type: 'categoryLimit', categoryId });
      events.push({ type: 'categoryLimit', categoryId });
    } else if (warnSec > 0 && !state.warned.category[categoryId] && sec >= limit - warnSec) {
      state.warned.category[categoryId] = true;
      day.events.push({ at: now, type: 'categoryWarning', categoryId });
      events.push({ type: 'categoryWarning', categoryId });
    }
  }
}

/**
 * Processes one heartbeat from a tab:
 * 1. credits the interval since the tab's previous heartbeat using the PREVIOUS state (segment accounting),
 *    clamped by the global `lastCountedAt` so several tabs never count the same wall-clock second twice,
 *    and dropped entirely if the gap exceeds 2 × heartbeatSec (tab was throttled/asleep);
 * 2. burns grandfather budgets while a grandfathered video plays, consumes them when it ends; a video that
 *    plays to its end leaves the saved-for-later list and is not auto-saved again today;
 * 3. stores the new tab state;
 * 4. checks daily and per-category limits and warnings.
 */
export function applyHeartbeat(ctx: AccountingContext, tabId: number, hb: Heartbeat): AccountingResult {
  const { config, state, now } = ctx;
  const events: AccountingEvent[] = [];
  const prev = ctx.tabs[tabId];
  const capMs = config.heartbeatSec * 2 * 1000;
  let creditedSec = 0;

  if (prev && prev.counts && now - prev.at <= capMs) {
    const from = Math.max(prev.at, state.lastCountedAt);
    const ms = now - from;
    if (ms > 0) {
      creditedSec = ms / 1000;
      creditDay(ctx, prev.attribution, creditedSec);
      if (prev.playing && prev.attribution.kind === 'video') {
        if (burnGrandfather(state, prev.attribution.videoId, creditedSec)) {
          events.push({ type: 'grandfatherExhausted', videoId: prev.attribution.videoId });
        }
      }
    }
    if (now > state.lastCountedAt) state.lastCountedAt = now;
  }

  if (hb.ended && !hb.adShowing && hb.playerVideoId) {
    // Played to its natural end: it leaves the saved-for-later list, is not auto-saved again today (the
    // placeholder says "finished" instead), and any grandfather allowance for it is spent.
    markFinished(state, hb.playerVideoId);
    removeSavedVideo(state, hb.playerVideoId);
    if (consumeGrandfather(state, hb.playerVideoId)) {
      events.push({ type: 'grandfatherExhausted', videoId: hb.playerVideoId });
    }
  }

  const attribution = attributionFor(hb);
  const counts = shouldCount(config.countingMode, {
    visible: hb.visible,
    pip: hb.pip,
    playing: hb.playing,
    focused: hb.focused,
    idle: ctx.idle,
    browsing: attribution.kind === 'browsing',
  });
  ctx.tabs[tabId] = {
    tabId,
    url: hb.url,
    at: now,
    counts,
    attribution,
    playing: hb.playing,
    playerVideoId: hb.playerVideoId,
    isLive: hb.isLive,
    duration: hb.duration,
    currentTime: hb.currentTime,
  };

  detectLimits(ctx, events);
  return { creditedSec, attribution, counts, events };
}

/** Re-runs limit detection without a heartbeat (e.g. after a limit was lowered in settings). */
export function recheckLimits(ctx: AccountingContext): AccountingEvent[] {
  const events: AccountingEvent[] = [];
  detectLimits(ctx, events);
  return events;
}
