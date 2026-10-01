import { describe, expect, it } from 'vitest';
import { addDays, dayKeyFor, dayKeysInRange, dayStartFor, formatClock, formatDuration, nextBoundary } from './time';

function local(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

describe('dayKeyFor', () => {
  it('uses the local calendar date with a midnight day start', () => {
    expect(dayKeyFor(local(2026, 8, 23, 0, 0), 0)).toBe('2026-08-23');
    expect(dayKeyFor(local(2026, 8, 23, 23, 59), 0)).toBe('2026-08-23');
  });
  it('assigns early-morning time to the previous day with a 04:00 day start', () => {
    expect(dayKeyFor(local(2026, 8, 23, 3, 59), 240)).toBe('2026-08-22');
    expect(dayKeyFor(local(2026, 8, 23, 4, 0), 240)).toBe('2026-08-23');
    expect(dayKeyFor(local(2026, 1, 1, 1, 0), 240)).toBe('2025-12-31');
  });
  it('is consistent with dayStartFor across the DST change', () => {
    // 2026-03-29: clocks go 02:00 → 03:00 in Europe/Berlin
    for (const [h, min] of [[1, 30], [3, 0], [3, 30], [4, 0], [12, 0]] as const) {
      const t = local(2026, 3, 29, h, min);
      const key = dayKeyFor(t, 240);
      expect(dayStartFor(key, 240)).toBeLessThanOrEqual(t);
      expect(dayStartFor(addDays(key, 1), 240)).toBeGreaterThan(t);
    }
    // 2026-10-25: clocks go 03:00 → 02:00
    for (const [h, min] of [[1, 30], [2, 30], [3, 30], [4, 0]] as const) {
      const t = local(2026, 10, 25, h, min);
      const key = dayKeyFor(t, 240);
      expect(dayStartFor(key, 240)).toBeLessThanOrEqual(t);
      expect(dayStartFor(addDays(key, 1), 240)).toBeGreaterThan(t);
    }
  });
});

describe('nextBoundary', () => {
  it('is the next day start after now', () => {
    expect(nextBoundary(local(2026, 8, 23, 10, 0), 0)).toBe(local(2026, 8, 24, 0, 0));
    expect(nextBoundary(local(2026, 8, 23, 3, 0), 240)).toBe(local(2026, 8, 23, 4, 0));
    expect(nextBoundary(local(2026, 8, 23, 4, 0), 240)).toBe(local(2026, 8, 24, 4, 0));
  });
  it('spans 23 and 25 hour days correctly', () => {
    expect(nextBoundary(local(2026, 3, 28, 12, 0), 0) - local(2026, 3, 28, 12, 0)).toBe(12 * 3600_000);
    expect(local(2026, 3, 30, 0, 0) - local(2026, 3, 29, 0, 0)).toBe(23 * 3600_000);
    expect(nextBoundary(local(2026, 3, 29, 0, 30), 0)).toBe(local(2026, 3, 30, 0, 0));
  });
});

describe('ranges and formatting', () => {
  it('addDays and dayKeysInRange', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayKeysInRange('2026-08-30', '2026-09-02')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
    expect(dayKeysInRange('2026-09-02', '2026-08-30')).toEqual([]);
  });
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(125)).toBe('2m');
    expect(formatDuration(3905)).toBe('1h 05m');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3661)).toBe('1:01:01');
  });
});
