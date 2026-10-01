// Repairs whatever is in storage (or in an imported backup) into valid state, day records and video index:
// unknown fields are dropped, values coerced, and nothing that is not a safe key becomes a key. Pure.
import { newState, normalizeWindows } from './config';
import { newDayRecord } from './day';
import { clip, finite, isDayKey, isSafeKey, isStoredId } from './ids';
import { MAX_SAVED_LINKS } from './links';
import type {
  Block,
  BlockReason,
  CategoryId,
  Config,
  DayEvent,
  DayEventType,
  DayKey,
  DayLimits,
  DayRecord,
  DayVideo,
  Grandfather,
  SavedLink,
  State,
  VideoIndex,
  VideoIndexEntry,
} from './types';
import { isVideoPage, parseYouTubeUrl } from './url';

const BLOCK_REASONS: readonly BlockReason[] = ['daily', 'category', 'shorts', 'schedule'];
const EVENT_TYPES: readonly DayEventType[] = ['dailyWarning', 'dailyLimit', 'categoryWarning', 'categoryLimit', 'override'];
const MAX_URL = 2048;
const MAX_TITLE = 300;
const MAX_CHANNEL_NAME = 120;
const MAX_FINISHED = 2000;
const MAX_EVENTS = 2000;

function record(raw: unknown): [string, unknown][] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>);
}

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/**
 * Saved links re-checked: each must be an http(s) YouTube video URL; the id is taken from the URL, duplicates
 * are dropped and the list is capped.
 */
export function sanitizeSavedLinks(raw: unknown): SavedLink[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedLink[] = [];
  const seen = new Set<string>();
  for (const item of raw as unknown[]) {
    const r = obj(item);
    if (!r || typeof r.url !== 'string' || r.url.length > MAX_URL) continue;
    const parsed = parseYouTubeUrl(r.url);
    if (!isVideoPage(parsed) || !parsed.videoId || seen.has(parsed.videoId)) continue;
    seen.add(parsed.videoId);
    const link: SavedLink = {
      url: r.url,
      videoId: parsed.videoId,
      savedAt: finite(r.savedAt, 0) ?? 0,
      reason: BLOCK_REASONS.includes(r.reason as BlockReason) ? (r.reason as BlockReason) : 'daily',
    };
    const title = clip(r.title, MAX_TITLE);
    if (title) link.title = title;
    out.push(link);
    if (out.length >= MAX_SAVED_LINKS) break;
  }
  return out;
}

function normalizeBlock(raw: unknown): Block | null {
  const r = obj(raw);
  if (!r) return null;
  const grandfathers: Grandfather[] = [];
  if (Array.isArray(r.grandfathers)) {
    for (const g of r.grandfathers as unknown[]) {
      const gg = obj(g);
      const budgetSec = gg ? finite(gg.budgetSec) : undefined;
      if (gg && isStoredId(gg.videoId) && budgetSec !== undefined && budgetSec > 0) grandfathers.push({ videoId: gg.videoId, budgetSec });
    }
  }
  return { since: finite(r.since, 0) ?? 0, grandfathers };
}

function flags(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of record(raw)) if (isSafeKey(k) && k.length <= 200 && v === true) out[k] = true;
  return out;
}

export function normalizeState(raw: unknown, dayKey: DayKey): State {
  const fresh = newState(dayKey);
  const r = obj(raw);
  if (!r) return fresh;

  const categoryBlocks: Record<CategoryId, Block> = {};
  for (const [id, b] of record(r.categoryBlocks)) {
    const block = isStoredId(id) ? normalizeBlock(b) : null;
    if (block) categoryBlocks[id] = block;
  }

  const o = obj(r.override);
  const until = o ? finite(o.until, 0) : undefined;
  const warned = obj(r.warned);

  return {
    dayKey: isDayKey(r.dayKey) ? r.dayKey : fresh.dayKey,
    lastCountedAt: finite(r.lastCountedAt, 0) ?? 0,
    dailyBlock: normalizeBlock(r.dailyBlock),
    categoryBlocks,
    override: o && until !== undefined ? { startedAt: finite(o.startedAt, 0) ?? until, until } : null,
    warned: warned
      ? { daily: warned.daily === true, category: flags(warned.category), schedule: flags(warned.schedule) }
      : fresh.warned,
    savedLinks: sanitizeSavedLinks(r.savedLinks),
    finishedVideos: Array.isArray(r.finishedVideos) ? (r.finishedVideos as unknown[]).filter(isStoredId).slice(0, MAX_FINISHED) : [],
  };
}

function normalizeLimits(raw: unknown): DayLimits | null {
  const r = obj(raw);
  if (!r) return null;
  const category: Record<CategoryId, number | null> = {};
  for (const [id, v] of record(r.category)) {
    if (!isStoredId(id)) continue;
    const sec = finite(v, 0);
    if (v === null || sec !== undefined) category[id] = sec ?? null;
  }
  return { dailySec: finite(r.dailySec, 0) ?? null, category, windows: normalizeWindows(r.windows) };
}

export function normalizeDay(raw: unknown, config: Config, dayKey: DayKey): DayRecord {
  const fresh = newDayRecord(config, dayKey);
  const r = obj(raw);
  if (!r) return fresh;

  const videos: Record<string, DayVideo> = {};
  for (const [id, v] of record(r.videos)) {
    const vv = obj(v);
    if (!vv || !isStoredId(id)) continue;
    videos[id] = {
      categoryId: isStoredId(vv.categoryId) ? vv.categoryId : null,
      sec: finite(vv.sec, 0) ?? 0,
      firstAt: finite(vv.firstAt, 0) ?? 0,
      lastAt: finite(vv.lastAt, 0) ?? 0,
    };
  }

  const overrides: DayRecord['overrides'] = [];
  const events: DayEvent[] = [];
  if (Array.isArray(r.overrides)) {
    for (const o of r.overrides as unknown[]) {
      const oo = obj(o);
      if (oo && overrides.length < MAX_EVENTS) overrides.push({ at: finite(oo.at, 0) ?? 0, minutes: finite(oo.minutes, 0) ?? 0 });
    }
  }
  if (Array.isArray(r.events)) {
    for (const e of r.events as unknown[]) {
      const ee = obj(e);
      if (!ee || !EVENT_TYPES.includes(ee.type as DayEventType) || events.length >= MAX_EVENTS) continue;
      const event: DayEvent = { at: finite(ee.at, 0) ?? 0, type: ee.type as DayEventType };
      if (isStoredId(ee.categoryId)) event.categoryId = ee.categoryId;
      const minutes = finite(ee.minutes, 0);
      if (minutes !== undefined) event.minutes = minutes;
      events.push(event);
    }
  }

  return {
    date: dayKey,
    videos,
    browsingSec: finite(r.browsingSec, 0) ?? 0,
    limits: normalizeLimits(r.limits) ?? fresh.limits,
    overrides,
    events,
  };
}

export function normalizeVideoIndex(raw: unknown): VideoIndex {
  const out: VideoIndex = {};
  for (const [id, v] of record(raw)) {
    const vv = obj(v);
    if (!vv || !isStoredId(id)) continue;
    const entry: VideoIndexEntry = { at: finite(vv.at, 0) ?? 0 };
    if (isStoredId(vv.categoryId)) entry.categoryId = vv.categoryId;
    const title = clip(vv.title, MAX_TITLE);
    if (title) entry.title = title;
    if (isStoredId(vv.channelId)) entry.channelId = vv.channelId;
    const channelName = clip(vv.channelName, MAX_CHANNEL_NAME);
    if (channelName) entry.channelName = channelName;
    out[id] = entry;
  }
  return out;
}
