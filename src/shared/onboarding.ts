// First-run state: whether setup is finished, plus the small bookkeeping that belongs to this installation
// rather than to the user's settings. Stored under the `meta` key, owned by the service worker. Pure.
import { limitsFromConfig } from './day';
import { FEEDBACK_MILESTONES_DAYS } from './feedback';
import { finite } from './ids';
import type { DecideResponse, HeartbeatResponse, PromptInfo, RequestType } from './messages';
import type { Config, DayRecord, Millis } from './types';

/** One-time explanations shown where the thing happens: the category question, the timer on the video, the first block. */
export const TIPS = ['prompt', 'pill', 'block'] as const;
export type TipId = (typeof TIPS)[number];

export interface Meta {
  /**
   * When the user finished setup by pressing "Start" on the welcome page, i.e. agreed to the on-device
   * record. null = pending: nothing is recorded, prompted or blocked.
   */
  setupAt: Millis | null;
  /** Tips this user has already been shown. */
  tipsSeen: TipId[];
  /** Feedback-reminder milestones (days after setup) the user has already answered. */
  feedbackDone: number[];
}

export function freshMeta(): Meta {
  return { setupAt: null, tipsSeen: [], feedbackDone: [] };
}

/**
 * Turns whatever is stored under `meta` into valid state. An installation that already has settings but no
 * `meta` predates the setup step: it counts as set up from now on, so existing users are never gated.
 */
export function normalizeMeta(raw: unknown, opts: { existingInstall: boolean; now: Millis }): Meta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    // Whoever used the extension before this record existed needs neither the setup nor the beginner tips.
    return opts.existingInstall ? { setupAt: opts.now, tipsSeen: [...TIPS], feedbackDone: [] } : freshMeta();
  }
  const r = raw as Record<string, unknown>;
  const seen: unknown[] = Array.isArray(r.tipsSeen) ? r.tipsSeen : [];
  const done: unknown[] = Array.isArray(r.feedbackDone) ? r.feedbackDone : [];
  return {
    setupAt: finite(r.setupAt, 1) ?? null,
    tipsSeen: TIPS.filter((t) => seen.includes(t)),
    feedbackDone: FEEDBACK_MILESTONES_DAYS.filter((m) => done.includes(m)),
  };
}

/** Whether a one-time tip is still to be shown. Never before setup is finished. */
export function tipDue(meta: Meta, tip: TipId): boolean {
  return isSetUp(meta) && !meta.tipsSeen.includes(tip);
}

/** Records a tip as shown. Returns true when that changed the record (so the caller persists it). */
export function markTip(meta: Meta, tip: TipId): boolean {
  if (meta.tipsSeen.includes(tip)) return false;
  meta.tipsSeen.push(tip);
  return true;
}

export function isSetUp(meta: Meta): boolean {
  return meta.setupAt !== null;
}

/**
 * Finishes setup: today's effective limits are taken straight from the chosen settings. This is the one
 * exception to "raising a limit takes effect tomorrow": the limits a new user picks are their first ones,
 * not a raise. The caller makes sure it only ever runs while setup is pending.
 */
export function finishSetup(meta: Meta, day: DayRecord, config: Config, now: Millis): Meta {
  day.limits = limitsFromConfig(config);
  return { ...meta, setupAt: now };
}

/**
 * What the worker answers while setup is pending, for every request that would record, prompt or block.
 * `undefined` means the request runs normally (reading and changing settings, opening pages).
 * `inactive: true` tells the content script to go quiet until it is woken with an `activate` message.
 */
export function inertReply(type: RequestType): unknown {
  switch (type) {
    case 'decide':
    case 'categorize': {
      const res: DecideResponse = { decision: { action: 'allow', categoryId: null }, inactive: true };
      return res;
    }
    case 'heartbeat': {
      const res: HeartbeatResponse = { decision: { action: 'allow', categoryId: null }, remainingSec: null, inactive: true };
      return res;
    }
    case 'videoInfo':
    case 'removeSavedLink':
      return { ok: true };
    case 'promptInfo': {
      const res: PromptInfo = { categories: [], currentCategoryId: null };
      return res;
    }
    case 'useOverride':
      return { until: null };
    default:
      return undefined;
  }
}
