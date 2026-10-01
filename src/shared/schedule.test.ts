import { describe, expect, it } from 'vitest';
import { formatWindowTime, inWindow, minuteInWindow, minutesRemoved, nextScheduleChange, scheduleBlocked, scheduleUnblockAt, unionWindows } from './schedule';

function local(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

const WORK = { fromMin: 9 * 60, toMin: 18 * 60 };
const NIGHT = { fromMin: 23 * 60, toMin: 7 * 60 };

describe('windows', () => {
  it('minuteInWindow handles normal and wrapped windows', () => {
    expect(minuteInWindow(9 * 60, WORK)).toBe(true);
    expect(minuteInWindow(18 * 60, WORK)).toBe(false);
    expect(minuteInWindow(8 * 60 + 59, WORK)).toBe(false);
    expect(minuteInWindow(23 * 60, NIGHT)).toBe(true);
    expect(minuteInWindow(30, NIGHT)).toBe(true);
    expect(minuteInWindow(7 * 60, NIGHT)).toBe(false);
    expect(minuteInWindow(12 * 60, NIGHT)).toBe(false);
    expect(minuteInWindow(600, { fromMin: 600, toMin: 600 })).toBe(false); // empty window
  });

  it('inWindow / scheduleBlocked use the local wall clock', () => {
    expect(inWindow(local(2026, 8, 24, 12, 0), WORK)).toBe(true);
    expect(inWindow(local(2026, 8, 24, 20, 0), WORK)).toBe(false);
    expect(scheduleBlocked(local(2026, 8, 24, 1, 30), [WORK, NIGHT])).toBe(true);
    expect(scheduleBlocked(local(2026, 8, 24, 8, 0), [WORK, NIGHT])).toBe(false);
  });

  it('scheduleUnblockAt finds the end of the current (possibly chained) block', () => {
    expect(scheduleUnblockAt(local(2026, 8, 24, 12, 0), [WORK])).toBe(local(2026, 8, 24, 18, 0));
    expect(scheduleUnblockAt(local(2026, 8, 24, 23, 30), [NIGHT])).toBe(local(2026, 8, 25, 7, 0));
    expect(scheduleUnblockAt(local(2026, 8, 24, 8, 0), [WORK])).toBe(local(2026, 8, 24, 8, 0)); // not blocked
    // Chained: 8-12 and 11-15 → from 09:00 the block lifts at 15:00.
    expect(scheduleUnblockAt(local(2026, 8, 24, 9, 0), [{ fromMin: 480, toMin: 720 }, { fromMin: 660, toMin: 900 }])).toBe(local(2026, 8, 24, 15, 0));
  });

  it('nextScheduleChange: next start when open, unblock time when blocked, null without windows', () => {
    expect(nextScheduleChange(local(2026, 8, 24, 8, 0), [WORK])).toBe(local(2026, 8, 24, 9, 0));
    expect(nextScheduleChange(local(2026, 8, 24, 12, 0), [WORK])).toBe(local(2026, 8, 24, 18, 0));
    expect(nextScheduleChange(local(2026, 8, 24, 20, 0), [WORK])).toBe(local(2026, 8, 25, 9, 0));
    expect(nextScheduleChange(local(2026, 8, 24, 12, 0), [])).toBeNull();
  });

  it('is DST-safe (boundaries follow the wall clock on 23/25-hour days)', () => {
    // 2026-03-29: clocks jump 02:00 → 03:00 in Europe/Berlin.
    expect(nextScheduleChange(local(2026, 3, 29, 1, 0), [WORK])).toBe(local(2026, 3, 29, 9, 0));
    // 2026-10-25: clocks fall back 03:00 → 02:00.
    expect(scheduleUnblockAt(local(2026, 10, 25, 1, 0), [NIGHT])).toBe(local(2026, 10, 25, 7, 0));
  });

  it('unionWindows concatenates and dedupes; minutesRemoved detects relaxations only', () => {
    expect(unionWindows([WORK], [WORK, NIGHT])).toEqual([WORK, NIGHT]);
    expect(unionWindows([], [])).toEqual([]);
    expect(minutesRemoved([WORK], [WORK, NIGHT])).toBe(false); // pure extension
    expect(minutesRemoved([WORK], [NIGHT])).toBe(true); // work window dropped
    expect(minutesRemoved([WORK], [{ fromMin: 9 * 60, toMin: 17 * 60 }])).toBe(true); // shrunk by an hour
    expect(minutesRemoved([], [WORK])).toBe(false);
  });

  it('formats window times', () => {
    expect(formatWindowTime(0)).toBe('00:00');
    expect(formatWindowTime(9 * 60 + 5)).toBe('09:05');
    expect(formatWindowTime(23 * 60 + 59)).toBe('23:59');
  });
});
