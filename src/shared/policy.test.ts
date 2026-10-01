import { describe, expect, it } from 'vitest';
import { newState } from './config';
import { newDayRecord } from './day';
import { T0, makeConfig } from './fixtures';
import { evaluate, expireOverride, knownCategory, overridesLeft, startOverride, type PolicyContext } from './policy';

const WATCH_A = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const WATCH_B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
const SHORT = 'https://www.youtube.com/shorts/sssssssssss';
const HOME = 'https://www.youtube.com/';

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return { config: makeConfig(), state: newState('2026-08-23'), windows: [], now: T0, ...overrides };
}

describe('evaluate', () => {
  it('allows non-YouTube URLs', () => {
    expect(evaluate('https://example.com/', null, ctx())).toEqual({ action: 'allow', categoryId: null });
  });

  it('prompts for an unknown category on a video page, allows known ones and browsing', () => {
    expect(evaluate(WATCH_A, null, ctx())).toEqual({ action: 'prompt' });
    expect(evaluate(WATCH_A, 'learning', ctx())).toEqual({ action: 'allow', categoryId: 'learning' });
    expect(evaluate(HOME, null, ctx())).toEqual({ action: 'allow', categoryId: null });
  });

  it('blocks everything but the grandfathered video under a daily block', () => {
    const c = ctx();
    c.state.dailyBlock = { since: T0, grandfathers: [{ videoId: 'aaaaaaaaaaa', budgetSec: 100 }] };
    expect(evaluate(WATCH_A, 'learning', c)).toEqual({ action: 'allow', categoryId: 'learning' });
    expect(evaluate(WATCH_A, null, c)).toEqual({ action: 'prompt' });
    expect(evaluate(WATCH_B, 'learning', c)).toEqual({ action: 'block', reason: 'daily' });
    expect(evaluate(HOME, null, c)).toEqual({ action: 'block', reason: 'daily' });
    c.state.dailyBlock.grandfathers[0]!.budgetSec = 0;
    expect(evaluate(WATCH_A, 'learning', c)).toEqual({ action: 'block', reason: 'daily' });
  });

  it('blocks only videos of a blocked category, except grandfathered ones', () => {
    const c = ctx();
    c.state.categoryBlocks['entertainment'] = { since: T0, grandfathers: [{ videoId: 'aaaaaaaaaaa', budgetSec: 50 }] };
    expect(evaluate(WATCH_A, 'entertainment', c)).toEqual({ action: 'allow', categoryId: 'entertainment' });
    expect(evaluate(WATCH_B, 'entertainment', c)).toEqual({ action: 'block', reason: 'category', categoryId: 'entertainment' });
    expect(evaluate(WATCH_B, 'learning', c)).toEqual({ action: 'allow', categoryId: 'learning' });
    expect(evaluate(WATCH_B, null, c)).toEqual({ action: 'prompt' });
    expect(evaluate(HOME, null, c)).toEqual({ action: 'allow', categoryId: null });
  });

  it('a Browsing block only blocks non-video pages', () => {
    const c = ctx();
    c.state.categoryBlocks['browsing'] = { since: T0, grandfathers: [] };
    expect(evaluate(HOME, null, c)).toEqual({ action: 'block', reason: 'category', categoryId: 'browsing' });
    expect(evaluate('https://www.youtube.com/results?search_query=x', null, c)).toEqual({ action: 'block', reason: 'category', categoryId: 'browsing' });
    expect(evaluate(WATCH_A, 'learning', c)).toEqual({ action: 'allow', categoryId: 'learning' });
  });

  it('Shorts: block mode always blocks, even during an override', () => {
    const c = ctx({ config: makeConfig({ shortsMode: 'block' }) });
    expect(evaluate(SHORT, 'entertainment', c)).toEqual({ action: 'block', reason: 'shorts' });
    c.state.override = { startedAt: T0, until: T0 + 60_000 };
    expect(evaluate(SHORT, 'entertainment', c)).toEqual({ action: 'block', reason: 'shorts' });
    expect(evaluate(SHORT, 'entertainment', ctx())).toEqual({ action: 'allow', categoryId: 'entertainment' });
  });

  it('an active override lifts time blocks but still prompts for the category', () => {
    const c = ctx();
    c.state.dailyBlock = { since: T0, grandfathers: [] };
    c.state.categoryBlocks['entertainment'] = { since: T0, grandfathers: [] };
    c.state.override = { startedAt: T0, until: T0 + 60_000 };
    expect(evaluate(WATCH_B, 'entertainment', c)).toEqual({ action: 'allow', categoryId: 'entertainment' });
    expect(evaluate(HOME, null, c)).toEqual({ action: 'allow', categoryId: null });
    expect(evaluate(WATCH_B, null, c)).toEqual({ action: 'prompt' });
    c.now = T0 + 60_000;
    expect(evaluate(WATCH_B, 'entertainment', c)).toEqual({ action: 'block', reason: 'daily' });
  });
});

describe('blocked hours', () => {
  // T0 is 10:00 UTC; the test TZ is Europe/Berlin (UTC+2 in August) → local wall clock 12:00.
  const WORK = [{ fromMin: 9 * 60, toMin: 18 * 60 }];
  const NIGHT = [{ fromMin: 23 * 60, toMin: 7 * 60 }];

  it('blocks every page during a window, regardless of category or grandfathers', () => {
    const c = ctx({ windows: WORK });
    expect(evaluate(WATCH_A, 'learning', c)).toEqual({ action: 'block', reason: 'schedule' });
    expect(evaluate(HOME, null, c)).toEqual({ action: 'block', reason: 'schedule' });
    c.state.dailyBlock = { since: T0, grandfathers: [{ videoId: 'aaaaaaaaaaa', budgetSec: 100 }] };
    expect(evaluate(WATCH_A, 'learning', c)).toEqual({ action: 'block', reason: 'schedule' });
  });

  it('does not block outside the window (overnight windows wrap)', () => {
    expect(evaluate(WATCH_A, 'learning', ctx({ windows: NIGHT }))).toEqual({ action: 'allow', categoryId: 'learning' });
    const lateNight = ctx({ windows: NIGHT, now: T0 + 13 * 3600_000 }); // 01:00 local next day
    expect(evaluate(WATCH_A, 'learning', lateNight)).toEqual({ action: 'block', reason: 'schedule' });
  });

  it('the override lifts blocked hours; the Shorts block still wins', () => {
    const c = ctx({ windows: WORK, config: makeConfig({ shortsMode: 'block' }) });
    c.state.override = { startedAt: T0, until: T0 + 60_000 };
    expect(evaluate(WATCH_A, 'learning', c)).toEqual({ action: 'allow', categoryId: 'learning' });
    expect(evaluate(SHORT, 'entertainment', c)).toEqual({ action: 'block', reason: 'shorts' });
  });
});

describe('override', () => {
  it('allows one per day by default, logs it, and expires', () => {
    const c = ctx();
    const day = newDayRecord(c.config, '2026-08-23');
    expect(overridesLeft(c.config, day)).toBe(1);
    const until = startOverride(c.config, c.state, day, T0)!;
    expect(until).toBe(T0 + 15 * 60_000);
    expect(day.overrides).toEqual([{ at: T0, minutes: 15 }]);
    expect(day.events[0]).toMatchObject({ type: 'override', minutes: 15 });
    expect(overridesLeft(c.config, day)).toBe(0);
    // A second call while active returns the same expiry; after expiry none is left.
    expect(startOverride(c.config, c.state, day, T0 + 1000)).toBe(until);
    expect(expireOverride(c.state, T0 + 1000)).toBe(false);
    expect(expireOverride(c.state, until)).toBe(true);
    expect(c.state.override).toBeNull();
    expect(startOverride(c.config, c.state, day, until + 1)).toBeNull();
  });
});

describe('knownCategory', () => {
  const rules = { UC1: { categoryId: 'gamedev', channelName: 'GD', createdAt: 0 } };

  it('prefers explicit memory, then a channel rule, then the Shorts auto-category', () => {
    const c = makeConfig({ channelRules: rules });
    expect(knownCategory(c, { categoryId: 'learning', channelId: 'UC1', at: 0 }, { isShorts: true })).toBe('learning');
    expect(knownCategory(c, { channelId: 'UC1', at: 0 }, { isShorts: true })).toBe('gamedev');
    expect(knownCategory(c, undefined, { channelId: 'UC1', isShorts: false })).toBe('gamedev');
    expect(knownCategory(c, undefined, { isShorts: true })).toBe('entertainment');
    expect(knownCategory(c, undefined, { isShorts: false })).toBeNull();
  });

  it('ignores rules pointing at archived categories and Shorts outside auto mode', () => {
    const c = makeConfig({ channelRules: rules });
    c.categories.find((x) => x.id === 'gamedev')!.archived = true;
    expect(knownCategory(c, { channelId: 'UC1', at: 0 }, { isShorts: false })).toBeNull();
    expect(knownCategory(c, { channelId: 'UC1', at: 0 }, { isShorts: true })).toBe('entertainment');
    expect(knownCategory(makeConfig({ shortsMode: 'prompt' }), undefined, { isShorts: true })).toBeNull();
    expect(knownCategory(makeConfig({ shortsMode: 'block' }), undefined, { isShorts: true })).toBeNull();
  });

  it('lets a channel id fresh from the page override the remembered one', () => {
    const c = makeConfig({ channelRules: { UC2: { categoryId: 'learning', channelName: 'L', createdAt: 0 } } });
    expect(knownCategory(c, { channelId: 'UC1', at: 0 }, { channelId: 'UC2', isShorts: false })).toBe('learning');
    expect(knownCategory(c, { channelId: 'UC2', at: 0 }, { channelId: null, isShorts: false })).toBe('learning');
  });
});
