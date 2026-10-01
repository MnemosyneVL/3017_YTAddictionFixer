// Day records: creation, effective limits, derived totals. Pure.
import { minutesRemoved, unionWindows } from './schedule';
import {
  BUILTIN_BROWSING,
  BUILTIN_UNCATEGORIZED,
  type CategoryId,
  type Config,
  type DayKey,
  type DayLimits,
  type DayRecord,
  type Millis,
  type State,
  type VideoId,
} from './types';

export function limitsFromConfig(config: Config): DayLimits {
  const category: Record<CategoryId, number | null> = {};
  for (const c of config.categories) {
    if (c.archived || c.builtin === 'uncategorized') continue;
    category[c.id] = c.limitMin === null ? null : Math.round(c.limitMin * 60);
  }
  return {
    dailySec: config.dailyLimitMin === null ? null : Math.round(config.dailyLimitMin * 60),
    category,
    windows: unionWindows(config.blockedWindows, []),
  };
}

export function newDayRecord(config: Config, date: DayKey): DayRecord {
  return { date, videos: {}, browsingSec: 0, limits: limitsFromConfig(config), overrides: [], events: [] };
}

/**
 * Applies a settings change to today's effective limits: decreases apply immediately, increases wait for
 * the next day. Returns the ids whose raise is deferred (for the "effective tomorrow" hint).
 * Note: going from a finite limit to unlimited is a raise (deferred); going from unlimited to finite is a
 * decrease (immediate). The same rule covers blocked hours: added windows block today already; removed
 * windows stay blocked until tomorrow.
 */
export function applyConfigToDay(
  day: DayRecord,
  config: Config,
): { deferredDaily: boolean; deferredCategories: CategoryId[]; deferredSchedule: boolean } {
  const target = limitsFromConfig(config);
  const deferredCategories: CategoryId[] = [];

  const deferredSchedule = minutesRemoved(day.limits.windows, config.blockedWindows);
  day.limits.windows = unionWindows(day.limits.windows, config.blockedWindows);

  let deferredDaily = false;
  if (target.dailySec === null) {
    deferredDaily = day.limits.dailySec !== null;
  } else if (day.limits.dailySec === null || target.dailySec < day.limits.dailySec) {
    day.limits.dailySec = target.dailySec;
  } else if (target.dailySec > day.limits.dailySec) {
    deferredDaily = true;
  }

  for (const [id, t] of Object.entries(target.category)) {
    const cur = day.limits.category[id];
    if (cur === undefined) {
      day.limits.category[id] = t;
      continue;
    }
    if (t === null) {
      if (cur !== null) deferredCategories.push(id);
      continue;
    }
    if (cur === null || t < cur) {
      day.limits.category[id] = t;
    } else if (t > cur) {
      deferredCategories.push(id);
    }
  }
  // Categories removed/archived in config keep their entry for the day (harmless).
  return { deferredDaily, deferredCategories, deferredSchedule };
}

export interface DayTotals {
  totalSec: number;
  /** Includes BUILTIN_BROWSING and BUILTIN_UNCATEGORIZED keys when non-zero. */
  byCategory: Record<CategoryId, number>;
}

export function dayTotals(day: DayRecord): DayTotals {
  const byCategory: Record<CategoryId, number> = {};
  let totalSec = day.browsingSec;
  if (day.browsingSec > 0) byCategory[BUILTIN_BROWSING] = day.browsingSec;
  for (const v of Object.values(day.videos)) {
    if (v.sec <= 0) continue;
    const id = v.categoryId ?? BUILTIN_UNCATEGORIZED;
    byCategory[id] = (byCategory[id] ?? 0) + v.sec;
    totalSec += v.sec;
  }
  return { totalSec, byCategory };
}

export function categorySec(day: DayRecord, categoryId: CategoryId): number {
  return dayTotals(day).byCategory[categoryId] ?? 0;
}

/** Seconds left before the daily limit, or null when unlimited. */
export function dailyRemainingSec(day: DayRecord): number | null {
  if (day.limits.dailySec === null) return null;
  return Math.max(0, day.limits.dailySec - dayTotals(day).totalSec);
}

export function categoryRemainingSec(day: DayRecord, categoryId: CategoryId): number | null {
  const limit = day.limits.category[categoryId];
  if (limit === null || limit === undefined) return null;
  return Math.max(0, limit - categorySec(day, categoryId));
}

/** Re-labels a video's seconds for today when its category becomes known or changes. */
export function setVideoCategory(day: DayRecord, videoId: VideoId, categoryId: CategoryId | null): void {
  const v = day.videos[videoId];
  if (v) v.categoryId = categoryId;
}

/** Starts a new day: fresh record with limits from config, state blocks cleared, saved links kept. */
export function rollover(state: State, config: Config, dayKey: DayKey, now: Millis): DayRecord {
  state.dayKey = dayKey;
  state.lastCountedAt = now;
  state.dailyBlock = null;
  state.categoryBlocks = {};
  state.override = null;
  state.warned = { daily: false, category: {}, schedule: {} };
  state.finishedVideos = [];
  return newDayRecord(config, dayKey);
}
