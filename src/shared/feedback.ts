// The occasional "did it help?" reminder: when it is due. Pure.
import type { Millis } from './types';

/** Days after setup at which the reminder is offered: a week, a month, three months. Then never again. */
export const FEEDBACK_MILESTONES_DAYS = [7, 30, 90] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FeedbackState {
  /** When setup was finished; null while it is pending. */
  setupAt: Millis | null;
  /** Milestones already answered (rated, supported, "later" or "don't ask again"). */
  done: readonly number[];
  /** The "Feedback reminders" switch in Settings. */
  enabled: boolean;
  /** YouTube is closed for the user right now: not the moment to ask for anything. */
  blocked: boolean;
  now: Millis;
}

/**
 * The milestone to show now, or null. A milestone is due once that many days have passed since setup and it
 * has not been answered; milestones that went by unanswered collapse into the latest one, so the reminder
 * shows once however long the user was away.
 */
export function dueFeedback(s: FeedbackState): number | null {
  if (!s.enabled || s.blocked || s.setupAt === null) return null;
  const days = (s.now - s.setupAt) / DAY_MS;
  let due: number | null = null;
  for (const m of FEEDBACK_MILESTONES_DAYS) {
    if (days >= m && !s.done.includes(m)) due = m;
  }
  return due;
}

/** Answering a reminder answers that milestone and every earlier one. */
export function answerFeedback(done: readonly number[], milestone: number): number[] {
  return FEEDBACK_MILESTONES_DAYS.filter((m) => m <= milestone || done.includes(m));
}
