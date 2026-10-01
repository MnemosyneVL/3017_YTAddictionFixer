import { describe, expect, it } from 'vitest';
import { newDayRecord } from './day';
import { T0, makeConfig } from './fixtures';
import { overlayInfo } from './overlay';

describe('overlayInfo', () => {
  const cfg = makeConfig();
  const day = newDayRecord(cfg, '2026-08-23');
  day.browsingSec = 300;
  day.videos['a'] = { categoryId: 'entertainment', sec: 3400, firstAt: T0, lastAt: T0 };

  it('returns null when the feature is off', () => {
    expect(overlayInfo(makeConfig({ showOverlayTimer: false }), day, 'entertainment', true)).toBeNull();
  });

  it('reports daily and category lines with warn flags', () => {
    const info = overlayInfo(cfg, day, 'entertainment', true)!;
    expect(info.corner).toBe('tr');
    expect(info.counts).toBe(true);
    expect(info.daily).toEqual({ usedSec: 3700, limitSec: 3600, warn: true }); // over the limit
    expect(info.category).toEqual({ usedSec: 3400, limitSec: 3600, warn: true, name: 'Entertainment', color: '#ffa726' });
  });

  it('handles unlimited limits and unknown categories', () => {
    const cfg2 = makeConfig({ dailyLimitMin: null });
    const day2 = newDayRecord(cfg2, '2026-08-23');
    day2.videos['a'] = { categoryId: 'learning', sec: 60, firstAt: T0, lastAt: T0 };
    const info = overlayInfo(cfg2, day2, 'learning', false)!;
    expect(info.daily).toEqual({ usedSec: 60, limitSec: null, warn: false });
    expect(info.category).toMatchObject({ name: 'Learning', limitSec: null, warn: false });
    expect(overlayInfo(cfg2, day2, null, false)!.category).toBeUndefined();
    expect(overlayInfo(cfg2, day2, 'uncategorized', false)!.category).toBeUndefined();
  });
});
