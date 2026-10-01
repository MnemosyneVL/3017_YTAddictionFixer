// Allow / block / prompt decisions and the override. Pure.
import { isGrandfathered } from './accounting';
import { scheduleBlocked } from './schedule';
import { isVideoPage, parseYouTubeUrl } from './url';
import {
  BUILTIN_BROWSING,
  type BlockedWindow,
  type CategoryId,
  type Config,
  type DayRecord,
  type Decision,
  type Millis,
  type State,
  type VideoIndexEntry,
} from './types';

export interface PolicyContext {
  config: Config;
  state: State;
  /** Effective blocked-hours windows for today (day.limits.windows). */
  windows: BlockedWindow[];
  now: Millis;
}

export function overrideActive(state: State, now: Millis): boolean {
  return state.override !== null && now < state.override.until;
}

/**
 * The category we already know for a video without asking: explicit per-video memory, then a channel rule
 * (skipped when its category is archived), then the Shorts auto-category. A channel id fresh from the page
 * (`opts.channelId`) takes precedence over the one remembered in the index entry.
 */
export function knownCategory(
  config: Config,
  entry: VideoIndexEntry | undefined,
  opts: { channelId?: string | null; isShorts: boolean },
): CategoryId | null {
  if (entry?.categoryId) return entry.categoryId;
  const channelId = opts.channelId ?? entry?.channelId;
  const rule = channelId ? config.channelRules[channelId] : undefined;
  if (rule && config.categories.some((c) => c.id === rule.categoryId && !c.archived)) return rule.categoryId;
  if (opts.isShorts && config.shortsMode === 'auto') return config.shortsCategoryId;
  return null;
}

/**
 * Decides what may happen on a YouTube URL.
 * `categoryId` is the video's category if already known (video memory, channel rule, Shorts auto-category),
 * otherwise null. Order: Shorts hard block → blocked hours (hard, no grandfathers) → daily block
 * (grandfathered videos excepted) → category block (grandfathered excepted; the Browsing category blocks
 * non-video pages) → prompt when the category is unknown → allow. An active override lifts the time-based
 * blocks and blocked hours, but not the Shorts block or the prompt.
 */
export function evaluate(url: string, categoryId: CategoryId | null, ctx: PolicyContext): Decision {
  const { config, state, now } = ctx;
  const parsed = parseYouTubeUrl(url);
  if (!parsed.isYouTube) return { action: 'allow', categoryId: null };
  const videoId = isVideoPage(parsed) ? parsed.videoId : null;
  const override = overrideActive(state, now);

  if (parsed.pageType === 'shorts' && config.shortsMode === 'block') {
    return { action: 'block', reason: 'shorts' };
  }

  if (!override && scheduleBlocked(now, ctx.windows)) {
    return { action: 'block', reason: 'schedule' };
  }

  if (!override && state.dailyBlock) {
    if (!videoId || !isGrandfathered(state.dailyBlock, videoId)) {
      return { action: 'block', reason: 'daily' };
    }
  }

  if (!override) {
    if (videoId) {
      const block = categoryId ? state.categoryBlocks[categoryId] : undefined;
      if (categoryId && block && !isGrandfathered(block, videoId)) {
        return { action: 'block', reason: 'category', categoryId };
      }
    } else if (state.categoryBlocks[BUILTIN_BROWSING]) {
      return { action: 'block', reason: 'category', categoryId: BUILTIN_BROWSING };
    }
  }

  if (videoId && categoryId === null) return { action: 'prompt' };
  return { action: 'allow', categoryId };
}

export function overridesLeft(config: Config, day: DayRecord): number {
  return Math.max(0, config.overridesPerDay - day.overrides.length);
}

/** Starts an override if one is available today. Returns the expiry time or null. */
export function startOverride(config: Config, state: State, day: DayRecord, now: Millis): Millis | null {
  if (overrideActive(state, now)) return state.override!.until;
  if (overridesLeft(config, day) <= 0) return null;
  const until = now + config.overrideMinutes * 60 * 1000;
  state.override = { startedAt: now, until };
  day.overrides.push({ at: now, minutes: config.overrideMinutes });
  day.events.push({ at: now, type: 'override', minutes: config.overrideMinutes });
  return until;
}

/** Clears an expired override; returns true if it was just cleared. */
export function expireOverride(state: State, now: Millis): boolean {
  if (state.override && now >= state.override.until) {
    state.override = null;
    return true;
  }
  return false;
}
