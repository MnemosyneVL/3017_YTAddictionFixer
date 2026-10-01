import { describe, expect, it } from 'vitest';
import { FEEDBACK_MILESTONES_DAYS, answerFeedback, dueFeedback, type FeedbackState } from './feedback';
import { T0 } from './fixtures';

const DAY = 24 * 60 * 60 * 1000;

function state(daysSinceSetup: number, overrides: Partial<FeedbackState> = {}): FeedbackState {
  return { setupAt: T0, done: [], enabled: true, blocked: false, now: T0 + daysSinceSetup * DAY, ...overrides };
}

describe('dueFeedback', () => {
  it('asks after a week, a month and three months', () => {
    expect(FEEDBACK_MILESTONES_DAYS).toEqual([7, 30, 90]);
    expect(dueFeedback(state(0))).toBeNull();
    expect(dueFeedback(state(6.9))).toBeNull();
    expect(dueFeedback(state(7))).toBe(7);
    expect(dueFeedback(state(29, { done: [7] }))).toBeNull();
    expect(dueFeedback(state(30, { done: [7] }))).toBe(30);
    expect(dueFeedback(state(90, { done: [7, 30] }))).toBe(90);
  });

  it('never asks again after the last milestone was answered', () => {
    expect(dueFeedback(state(91, { done: [7, 30, 90] }))).toBeNull();
    expect(dueFeedback(state(5000, { done: [7, 30, 90] }))).toBeNull();
  });

  it('shows one reminder, the latest, when earlier ones went by unanswered', () => {
    expect(dueFeedback(state(45))).toBe(30);
    expect(dueFeedback(state(400))).toBe(90);
  });

  it('stays quiet when switched off, before setup, and while YouTube is blocked', () => {
    expect(dueFeedback(state(10, { enabled: false }))).toBeNull();
    expect(dueFeedback(state(10, { setupAt: null }))).toBeNull();
    expect(dueFeedback(state(10, { blocked: true }))).toBeNull();
  });
});

describe('answerFeedback', () => {
  it('answers the milestone and every earlier one, keeping what was answered before', () => {
    expect(answerFeedback([], 7)).toEqual([7]);
    expect(answerFeedback([], 30)).toEqual([7, 30]);
    expect(answerFeedback([7], 90)).toEqual([7, 30, 90]);
    expect(answerFeedback([90], 7)).toEqual([7, 90]);
  });

  it('makes the answered reminder go away until the next milestone', () => {
    const done = answerFeedback([], dueFeedback(state(45))!);
    expect(dueFeedback(state(45, { done }))).toBeNull();
    expect(dueFeedback(state(89, { done }))).toBeNull();
    expect(dueFeedback(state(90, { done }))).toBe(90);
  });
});
