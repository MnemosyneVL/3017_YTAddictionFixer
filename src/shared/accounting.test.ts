import { describe, expect, it } from 'vitest';
import { applyHeartbeat, attributionFor, grandfatherBudgetSec, isGrandfathered, recheckLimits } from './accounting';
import { dayTotals } from './day';
import { T0, hb, makeContext } from './fixtures';

const S = 1000;

describe('attributionFor', () => {
  it('attributes a playing player video over the URL', () => {
    expect(attributionFor(hb({ url: 'https://www.youtube.com/', playing: true, playerVideoId: 'bbbbbbbbbbb' }))).toEqual({
      kind: 'video',
      videoId: 'bbbbbbbbbbb',
    });
  });
  it('attributes a paused watch page to the URL video', () => {
    expect(attributionFor(hb({ playing: false, playerVideoId: null }))).toEqual({ kind: 'video', videoId: 'aaaaaaaaaaa' });
  });
  it('attributes the feed to browsing and other sites to nothing', () => {
    expect(attributionFor(hb({ url: 'https://www.youtube.com/feed/subscriptions', playing: false, playerVideoId: null }))).toEqual({ kind: 'browsing' });
    expect(attributionFor(hb({ url: 'https://example.com/', playing: false, playerVideoId: null }))).toEqual({ kind: 'none' });
  });
});

describe('applyHeartbeat crediting', () => {
  it('credits nothing on the first heartbeat and the interval on the second', () => {
    const ctx = makeContext();
    const r1 = applyHeartbeat(ctx, 1, hb());
    expect(r1.creditedSec).toBe(0);
    ctx.now = T0 + 5 * S;
    const r2 = applyHeartbeat(ctx, 1, hb());
    expect(r2.creditedSec).toBe(5);
    expect(ctx.day.videos['aaaaaaaaaaa']?.sec).toBe(5);
    expect(dayTotals(ctx.day).totalSec).toBe(5);
  });

  it('credits by the previous state, not the current one', () => {
    const ctx = makeContext();
    applyHeartbeat(ctx, 1, hb({ visible: false, playing: false })); // hidden, paused: does not count
    ctx.now = T0 + 5 * S;
    const r = applyHeartbeat(ctx, 1, hb()); // now visible+playing, but the past 5 s were not
    expect(r.creditedSec).toBe(0);
    ctx.now = T0 + 10 * S;
    expect(applyHeartbeat(ctx, 1, hb({ visible: false, playing: false })).creditedSec).toBe(5);
  });

  it('drops intervals longer than twice the heartbeat (throttled / asleep)', () => {
    const ctx = makeContext();
    applyHeartbeat(ctx, 1, hb());
    ctx.now = T0 + 11 * S;
    expect(applyHeartbeat(ctx, 1, hb()).creditedSec).toBe(0);
    ctx.now = T0 + 16 * S;
    expect(applyHeartbeat(ctx, 1, hb()).creditedSec).toBe(5);
  });

  it('never counts two visible tabs twice (sums to wall-clock)', () => {
    const ctx = makeContext();
    const a = hb({ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', playerVideoId: 'aaaaaaaaaaa' });
    const b = hb({ url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', playerVideoId: 'bbbbbbbbbbb' });
    const times: [number, number][] = [[0, 1], [2, 2], [5, 1], [7, 2], [10, 1], [12, 2]];
    for (const [t, tab] of times) {
      ctx.now = T0 + t * S;
      applyHeartbeat(ctx, tab, tab === 1 ? a : b);
    }
    expect(dayTotals(ctx.day).totalSec).toBe(12);
    expect(ctx.day.videos['aaaaaaaaaaa']!.sec + ctx.day.videos['bbbbbbbbbbb']!.sec).toBe(12);
  });

  it('attributes browsing time separately', () => {
    const ctx = makeContext();
    const feed = hb({ url: 'https://www.youtube.com/', playing: false, playerVideoId: null });
    applyHeartbeat(ctx, 1, feed);
    ctx.now = T0 + 5 * S;
    applyHeartbeat(ctx, 1, feed);
    expect(ctx.day.browsingSec).toBe(5);
    expect(dayTotals(ctx.day).byCategory['browsing']).toBe(5);
  });

  it('browsing counts while looked at even in playingOnly mode; a paused video does not', () => {
    const ctx = makeContext({}, { countingMode: 'playingOnly' });
    const search = hb({ url: 'https://www.youtube.com/results?search_query=rust', playing: false, playerVideoId: null });
    applyHeartbeat(ctx, 1, search);
    ctx.now = T0 + 5 * S;
    applyHeartbeat(ctx, 1, search);
    expect(ctx.day.browsingSec).toBe(5);
    const paused = hb({ playing: false });
    applyHeartbeat(ctx, 2, paused);
    ctx.now = T0 + 10 * S;
    expect(applyHeartbeat(ctx, 2, paused).creditedSec).toBe(0);
    expect(ctx.day.videos['aaaaaaaaaaa']).toBeUndefined();
    expect(applyHeartbeat(ctx, 1, { ...search, focused: false }).counts).toBe(false); // second monitor
  });

  it('uses the known category and keeps uncategorized otherwise', () => {
    const ctx = makeContext({ videoIndex: { aaaaaaaaaaa: { categoryId: 'learning', at: 0 } } });
    applyHeartbeat(ctx, 1, hb());
    ctx.now = T0 + 5 * S;
    applyHeartbeat(ctx, 1, hb());
    expect(ctx.day.videos['aaaaaaaaaaa']?.categoryId).toBe('learning');
    expect(dayTotals(ctx.day).byCategory['learning']).toBe(5);

    const ctx2 = makeContext();
    applyHeartbeat(ctx2, 1, hb());
    ctx2.now = T0 + 5 * S;
    applyHeartbeat(ctx2, 1, hb());
    expect(dayTotals(ctx2.day).byCategory['uncategorized']).toBe(5);
  });

  it('does not count when the screen is locked', () => {
    const ctx = makeContext({ idle: 'locked' });
    applyHeartbeat(ctx, 1, hb());
    ctx.now = T0 + 5 * S;
    expect(applyHeartbeat(ctx, 1, hb()).creditedSec).toBe(0);
  });
});

describe('daily limit', () => {
  function runUntil(ctx: ReturnType<typeof makeContext>, seconds: number, beat = hb()) {
    const events = [];
    for (let t = 0; t <= seconds; t += 5) {
      ctx.now = T0 + t * S;
      events.push(...applyHeartbeat(ctx, 1, beat).events);
    }
    return events;
  }

  it('warns once, then blocks once, grandfathering the playing video', () => {
    const ctx = makeContext({}, { dailyLimitMin: 1, warnBeforeMin: 0.5 });
    const events = runUntil(ctx, 120);
    expect(events.filter((e) => e.type === 'dailyWarning')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'dailyLimit')).toHaveLength(1);
    expect(ctx.state.warned.daily).toBe(true);
    expect(ctx.state.dailyBlock).not.toBeNull();
    expect(isGrandfathered(ctx.state.dailyBlock, 'aaaaaaaaaaa')).toBe(true);
    expect(ctx.day.events.map((e) => e.type)).toEqual(['dailyWarning', 'dailyLimit']);
  });

  it('keeps counting after the block (overage shows in the report)', () => {
    const ctx = makeContext({}, { dailyLimitMin: 1, warnBeforeMin: 0 });
    runUntil(ctx, 120);
    expect(dayTotals(ctx.day).totalSec).toBe(120);
  });

  it('grandfathers a paused but attended video, not a hidden paused tab', () => {
    const ctx = makeContext({}, { dailyLimitMin: 1, warnBeforeMin: 0 });
    const paused = hb({ url: 'https://www.youtube.com/watch?v=ppppppppppp', playerVideoId: 'ppppppppppp', playing: false });
    const hidden = hb({ url: 'https://www.youtube.com/watch?v=hhhhhhhhhhh', playerVideoId: 'hhhhhhhhhhh', playing: false, visible: false });
    for (let t = 0; t <= 60; t += 5) {
      ctx.now = T0 + t * S;
      applyHeartbeat(ctx, 2, hidden);
      applyHeartbeat(ctx, 1, paused);
    }
    expect(ctx.state.dailyBlock).not.toBeNull();
    expect(isGrandfathered(ctx.state.dailyBlock, 'ppppppppppp')).toBe(true);
    expect(isGrandfathered(ctx.state.dailyBlock, 'hhhhhhhhhhh')).toBe(false);
  });

  it('burns the grandfather budget only while playing and reports exhaustion', () => {
    const ctx = makeContext({}, { dailyLimitMin: 1, warnBeforeMin: 0 });
    // 600 s video at 10 s → remaining 590 + margin 120 = 710 s budget
    runUntil(ctx, 60);
    const g = ctx.state.dailyBlock!.grandfathers[0]!;
    expect(g.budgetSec).toBeCloseTo(710, 5);
    ctx.now = T0 + 65 * S;
    applyHeartbeat(ctx, 1, hb({ playing: false }));
    ctx.now = T0 + 70 * S;
    applyHeartbeat(ctx, 1, hb({ playing: false })); // paused interval: no burn
    expect(ctx.state.dailyBlock!.grandfathers[0]!.budgetSec).toBeCloseTo(705, 5);
    let exhausted = false;
    for (let t = 75; t <= 900 && !exhausted; t += 5) {
      ctx.now = T0 + t * S;
      exhausted = applyHeartbeat(ctx, 1, hb()).events.some((e) => e.type === 'grandfatherExhausted');
    }
    expect(exhausted).toBe(true);
    expect(ctx.state.dailyBlock!.grandfathers).toHaveLength(0);
  });

  it('consumes the grandfather when the video ends (not during an ad)', () => {
    const ctx = makeContext({}, { dailyLimitMin: 1, warnBeforeMin: 0 });
    runUntil(ctx, 60);
    ctx.now = T0 + 65 * S;
    expect(applyHeartbeat(ctx, 1, hb({ ended: true, adShowing: true })).events.some((e) => e.type === 'grandfatherExhausted')).toBe(false);
    ctx.now = T0 + 70 * S;
    expect(applyHeartbeat(ctx, 1, hb({ ended: true })).events.some((e) => e.type === 'grandfatherExhausted')).toBe(true);
    expect(isGrandfathered(ctx.state.dailyBlock, 'aaaaaaaaaaa')).toBe(false);
  });

  it('gives live streams the live grace allowance, capped budgets otherwise', () => {
    const cfg = makeContext({}, { liveGraceMin: 20, maxGrandfatherMin: 60 }).config;
    expect(grandfatherBudgetSec(cfg, { isLive: true, duration: null, currentTime: null })).toBe(1200);
    expect(grandfatherBudgetSec(cfg, { isLive: false, duration: null, currentTime: 0 })).toBe(1200);
    expect(grandfatherBudgetSec(cfg, { isLive: false, duration: 4 * 3600, currentTime: 0 })).toBe(3600);
    expect(grandfatherBudgetSec(cfg, { isLive: false, duration: 3000, currentTime: 1000 })).toBe(2200);
  });

  it('caps the budget by the category after-limit allowance', () => {
    const cfg = makeContext({}, { liveGraceMin: 20, maxGrandfatherMin: 240 }).config;
    const vod = { isLive: false, duration: 7200, currentTime: 0 };
    expect(grandfatherBudgetSec(cfg, vod, null)).toBe(7920); // until the end (+10 % margin)
    expect(grandfatherBudgetSec(cfg, vod, 30)).toBe(1800); // at most 30 min
    expect(grandfatherBudgetSec(cfg, vod, 0)).toBe(0); // stop immediately
    expect(grandfatherBudgetSec(cfg, { isLive: true, duration: null, currentTime: null }, 5)).toBe(300);
  });

  it('a category with grace 0 gets no grandfather at all; a capped one gets its minutes', () => {
    const ctx = makeContext(
      { videoIndex: { aaaaaaaaaaa: { categoryId: 'entertainment', at: 0 } } },
      { dailyLimitMin: 1, warnBeforeMin: 0 },
    );
    ctx.config.categories.find((c) => c.id === 'entertainment')!.graceMin = 0;
    runUntil(ctx, 60);
    expect(ctx.state.dailyBlock).not.toBeNull();
    expect(ctx.state.dailyBlock!.grandfathers).toEqual([]);

    const ctx2 = makeContext(
      { videoIndex: { aaaaaaaaaaa: { categoryId: 'entertainment', at: 0 } } },
      { dailyLimitMin: 1, warnBeforeMin: 0 },
    );
    ctx2.config.categories.find((c) => c.id === 'entertainment')!.graceMin = 5;
    runUntil(ctx2, 60);
    expect(ctx2.state.dailyBlock!.grandfathers).toEqual([{ videoId: 'aaaaaaaaaaa', budgetSec: 300 }]);
  });

  it('marks a grandfathered video as finished when it ends (and only then)', () => {
    const ctx = makeContext({}, { dailyLimitMin: 1, warnBeforeMin: 0 });
    runUntil(ctx, 60);
    ctx.now = T0 + 65 * S;
    applyHeartbeat(ctx, 1, hb({ ended: true, adShowing: true })); // ad end: not finished
    expect(ctx.state.finishedVideos).toEqual([]);
    ctx.now = T0 + 70 * S;
    applyHeartbeat(ctx, 1, hb({ ended: true }));
    expect(ctx.state.finishedVideos).toEqual(['aaaaaaaaaaa']);
  });

  it('a video played to its end leaves the saved-for-later list, grandfathered or not', () => {
    const ctx = makeContext();
    const saved = { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', title: 'A', savedAt: T0 - 86_400_000, reason: 'daily' as const };
    const other = { ...saved, url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', videoId: 'bbbbbbbbbbb' };
    ctx.state.savedLinks = [saved, other];
    applyHeartbeat(ctx, 1, hb({ ended: true, adShowing: true })); // an ad ending is not the video ending
    expect(ctx.state.savedLinks).toHaveLength(2);
    expect(ctx.state.finishedVideos).toEqual([]);
    ctx.now = T0 + 5 * S;
    applyHeartbeat(ctx, 1, hb({ ended: true }));
    expect(ctx.state.savedLinks).toEqual([other]);
    expect(ctx.state.finishedVideos).toEqual(['aaaaaaaaaaa']);
    expect(ctx.state.dailyBlock).toBeNull(); // no limit involved
  });

  it('no daily limit when unlimited', () => {
    const ctx = makeContext({}, { dailyLimitMin: null });
    const events = runUntil(ctx, 600);
    expect(events).toHaveLength(0);
    expect(ctx.state.dailyBlock).toBeNull();
  });
});

describe('category limits', () => {
  it('blocks a category when its limit is reached, grandfathering only videos of that category', () => {
    const ctx = makeContext(
      { videoIndex: { aaaaaaaaaaa: { categoryId: 'entertainment', at: 0 }, bbbbbbbbbbb: { categoryId: 'learning', at: 0 } } },
      { dailyLimitMin: null, warnBeforeMin: 0 },
    );
    ctx.config.categories.find((c) => c.id === 'entertainment')!.limitMin = 1;
    ctx.day.limits.category['entertainment'] = 60;
    const ent = hb();
    const learn = hb({ url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', playerVideoId: 'bbbbbbbbbbb' });
    const events = [];
    for (let t = 0; t <= 130; t += 5) {
      ctx.now = T0 + t * S;
      events.push(...applyHeartbeat(ctx, 1, ent).events);
      ctx.now = T0 + t * S + 2500;
      events.push(...applyHeartbeat(ctx, 2, learn).events);
    }
    expect(events.filter((e) => e.type === 'categoryLimit')).toHaveLength(1);
    const block = ctx.state.categoryBlocks['entertainment']!;
    expect(isGrandfathered(block, 'aaaaaaaaaaa')).toBe(true);
    expect(isGrandfathered(block, 'bbbbbbbbbbb')).toBe(false);
    expect(ctx.state.dailyBlock).toBeNull();
  });

  it('the Browsing category limit blocks without grandfathers', () => {
    const ctx = makeContext({}, { dailyLimitMin: null, warnBeforeMin: 0 });
    ctx.day.limits.category['browsing'] = 10;
    const feed = hb({ url: 'https://www.youtube.com/', playing: false, playerVideoId: null });
    for (let t = 0; t <= 15; t += 5) {
      ctx.now = T0 + t * S;
      applyHeartbeat(ctx, 1, feed);
    }
    expect(ctx.state.categoryBlocks['browsing']).toEqual({ since: T0 + 10 * S, grandfathers: [] });
  });

  it('recheckLimits trips a block after a limit was lowered', () => {
    const ctx = makeContext({}, { dailyLimitMin: 60, warnBeforeMin: 0 });
    for (let t = 0; t <= 30; t += 5) {
      ctx.now = T0 + t * S;
      applyHeartbeat(ctx, 1, hb());
    }
    expect(ctx.state.dailyBlock).toBeNull();
    ctx.day.limits.dailySec = 20;
    const events = recheckLimits(ctx);
    expect(events).toEqual([{ type: 'dailyLimit' }]);
    expect(ctx.state.dailyBlock).not.toBeNull();
  });
});
