import { describe, expect, it } from 'vitest';
import { newDayRecord } from './day';
import { T0, makeConfig } from './fixtures';
import { buildReport, reportToCsv } from './report';
import type { VideoIndex } from './types';

describe('buildReport', () => {
  it('aggregates categories, videos and channels across days and tolerates deleted categories', () => {
    const cfg = makeConfig();
    const d1 = newDayRecord(cfg, '2026-08-22');
    d1.videos['a'] = { categoryId: 'learning', sec: 600, firstAt: T0, lastAt: T0 };
    d1.videos['b'] = { categoryId: 'old-cat', sec: 300, firstAt: T0, lastAt: T0 };
    d1.browsingSec = 100;
    d1.events.push({ at: T0, type: 'dailyLimit' });
    const d2 = newDayRecord(cfg, '2026-08-23');
    d2.videos['a'] = { categoryId: 'learning', sec: 400, firstAt: T0, lastAt: T0 };
    d2.videos['c'] = { categoryId: null, sec: 50, firstAt: T0, lastAt: T0 };
    d2.overrides.push({ at: T0, minutes: 15 });
    d2.events.push({ at: T0, type: 'categoryLimit', categoryId: 'entertainment' }, { at: T0, type: 'override', minutes: 15 });
    const index: VideoIndex = {
      a: { title: 'Rust lifetimes', channelId: 'UC1', channelName: 'Jon', categoryId: 'learning', at: 0 },
      b: { title: 'Old', channelId: 'UC1', channelName: 'Jon', at: 0 },
    };
    const r = buildReport([d2, d1], index, cfg, '2026-08-22', '2026-08-23');
    expect(r.totalSec).toBe(1450);
    expect(r.days.map((d) => d.date)).toEqual(['2026-08-22', '2026-08-23']);
    expect(r.categories[0]).toMatchObject({ categoryId: 'learning', name: 'Learning', sec: 1000 });
    expect(r.categories.find((c) => c.categoryId === 'old-cat')!.name).toBe('(deleted: old-cat)');
    expect(r.categories.find((c) => c.categoryId === 'uncategorized')!.sec).toBe(50);
    expect(r.categories.find((c) => c.categoryId === 'browsing')!.sec).toBe(100);
    expect(r.videos[0]).toMatchObject({ videoId: 'a', title: 'Rust lifetimes', sec: 1000, categoryId: 'learning' });
    expect(r.videos.find((v) => v.videoId === 'c')).toMatchObject({ title: 'c', channelName: 'Unknown channel', categoryId: 'uncategorized' });
    expect(r.channels[0]).toMatchObject({ channelId: 'UC1', channelName: 'Jon', sec: 1300, videos: 2 });
    expect(r.overrides).toBe(1);
    expect(r.limitHits).toEqual({ daily: 1, category: { entertainment: 1 } });
    const csv = reportToCsv(r, cfg);
    expect(csv.split('\n')[0]).toBe('date,total_sec,Browsing_sec,Learning_sec,(deleted: old-cat)_sec,Uncategorized_sec,limit_sec,overrides');
    expect(csv.split('\n')[2]).toBe('2026-08-23,450,0,400,0,50,3600,1');
  });
});
