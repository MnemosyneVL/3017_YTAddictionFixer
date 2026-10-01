import { describe, expect, it } from 'vitest';
import { newState } from './config';
import { applyConfigToDay, categoryRemainingSec, dailyRemainingSec, dayTotals, newDayRecord, rollover, setVideoCategory } from './day';
import { T0, makeConfig } from './fixtures';

describe('newDayRecord / limits', () => {
  it('snapshots limits in seconds and skips archived / uncategorized', () => {
    const cfg = makeConfig();
    cfg.categories.find((c) => c.id === 'gamedev')!.archived = true;
    const day = newDayRecord(cfg, '2026-08-23');
    expect(day.limits.dailySec).toBe(3600);
    expect(day.limits.category).toEqual({ learning: null, entertainment: 3600, browsing: null });
  });

  it('applies decreases immediately and defers raises', () => {
    const cfg = makeConfig();
    const day = newDayRecord(cfg, '2026-08-23');
    cfg.dailyLimitMin = 30;
    cfg.categories.find((c) => c.id === 'entertainment')!.limitMin = 90;
    cfg.categories.find((c) => c.id === 'learning')!.limitMin = 120; // unlimited → finite = decrease
    let r = applyConfigToDay(day, cfg);
    expect(r).toEqual({ deferredDaily: false, deferredCategories: ['entertainment'], deferredSchedule: false });
    expect(day.limits.dailySec).toBe(1800);
    expect(day.limits.category['entertainment']).toBe(3600);
    expect(day.limits.category['learning']).toBe(7200);

    cfg.dailyLimitMin = null; // raise to unlimited → deferred
    cfg.categories.find((c) => c.id === 'entertainment')!.limitMin = null;
    r = applyConfigToDay(day, cfg);
    expect(r).toEqual({ deferredDaily: true, deferredCategories: ['entertainment'], deferredSchedule: false });
    expect(day.limits.dailySec).toBe(1800);

    cfg.categories.push({ id: 'music', name: 'Music', color: '#000', limitMin: 10, graceMin: null, order: 5 });
    r = applyConfigToDay(day, cfg);
    expect(day.limits.category['music']).toBe(600); // new category applies immediately
  });
});

describe('totals', () => {
  it('derives totals by category including browsing and uncategorized', () => {
    const day = newDayRecord(makeConfig(), '2026-08-23');
    day.browsingSec = 30;
    day.videos['a'] = { categoryId: 'learning', sec: 100, firstAt: T0, lastAt: T0 };
    day.videos['b'] = { categoryId: 'learning', sec: 50, firstAt: T0, lastAt: T0 };
    day.videos['c'] = { categoryId: null, sec: 20, firstAt: T0, lastAt: T0 };
    expect(dayTotals(day)).toEqual({ totalSec: 200, byCategory: { browsing: 30, learning: 150, uncategorized: 20 } });
    expect(dailyRemainingSec(day)).toBe(3400);
    setVideoCategory(day, 'c', 'entertainment');
    expect(dayTotals(day).byCategory).toEqual({ browsing: 30, learning: 150, entertainment: 20 });
    expect(categoryRemainingSec(day, 'entertainment')).toBe(3580);
    expect(categoryRemainingSec(day, 'learning')).toBeNull();
  });
});

describe('blocked-hours snapshot', () => {
  it('added windows apply today; removed windows stay until tomorrow', () => {
    const cfg = makeConfig({ blockedWindows: [{ fromMin: 540, toMin: 1080 }] });
    const day = newDayRecord(cfg, '2026-08-23');
    expect(day.limits.windows).toEqual([{ fromMin: 540, toMin: 1080 }]);

    cfg.blockedWindows = [{ fromMin: 540, toMin: 1080 }, { fromMin: 1380, toMin: 420 }];
    let r = applyConfigToDay(day, cfg);
    expect(r.deferredSchedule).toBe(false);
    expect(day.limits.windows).toHaveLength(2); // extension is immediate

    cfg.blockedWindows = [{ fromMin: 1380, toMin: 420 }]; // removing the work window…
    r = applyConfigToDay(day, cfg);
    expect(r.deferredSchedule).toBe(true); // …waits for tomorrow
    expect(day.limits.windows).toHaveLength(2); // today both still block
  });
});

describe('rollover', () => {
  it('resets blocks and override, keeps saved links, creates a fresh day', () => {
    const cfg = makeConfig();
    const state = newState('2026-08-23');
    state.dailyBlock = { since: T0, grandfathers: [] };
    state.categoryBlocks['entertainment'] = { since: T0, grandfathers: [] };
    state.override = { startedAt: T0, until: T0 + 1 };
    state.warned.daily = true;
    state.lastCountedAt = T0;
    state.savedLinks.push({ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', savedAt: T0, reason: 'daily' });
    const day = rollover(state, cfg, '2026-08-24', T0 + 5000);
    expect(day.date).toBe('2026-08-24');
    state.finishedVideos.push('aaaaaaaaaaa');
    const day2 = rollover(state, cfg, '2026-08-25', T0 + 6000);
    expect(day2.date).toBe('2026-08-25');
    expect(state).toMatchObject({ dayKey: '2026-08-25', lastCountedAt: T0 + 6000, dailyBlock: null, categoryBlocks: {}, override: null, warned: { daily: false, category: {}, schedule: {} }, finishedVideos: [] });
    expect(state.savedLinks).toHaveLength(1);
  });
});
