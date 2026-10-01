// Blocked-hours windows. Pure; all comparisons use the local wall clock (DST-safe).
import type { BlockedWindow, Millis } from './types';

/** Whether the wall-clock minute `m` (0..1439) lies inside the window (fromMin > toMin wraps midnight). */
export function minuteInWindow(m: number, w: BlockedWindow): boolean {
  if (w.fromMin === w.toMin) return false;
  return w.fromMin < w.toMin ? m >= w.fromMin && m < w.toMin : m >= w.fromMin || m < w.toMin;
}

function minuteOf(now: Millis): number {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

export function inWindow(now: Millis, w: BlockedWindow): boolean {
  return minuteInWindow(minuteOf(now), w);
}

export function scheduleBlocked(now: Millis, windows: BlockedWindow[]): boolean {
  return windows.some((w) => inWindow(now, w));
}

/** Next epoch ms strictly after `now` at which the local wall clock reads `min` minutes past midnight. */
export function nextWallClock(now: Millis, min: number): Millis {
  const d = new Date(now);
  let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min, 0, 0).getTime();
  let days = 1;
  while (t <= now) {
    t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, min, 0, 0).getTime();
    days++;
  }
  return t;
}

/** When the current schedule block lifts; `now` itself when not blocked. Handles overlapping windows. */
export function scheduleUnblockAt(now: Millis, windows: BlockedWindow[]): Millis {
  let t = now;
  for (let i = 0; i <= windows.length * 2 + 2; i++) {
    const containing = windows.filter((w) => inWindow(t, w));
    if (containing.length === 0) return t;
    t = Math.max(...containing.map((w) => nextWallClock(t, w.toMin)));
  }
  return t;
}

/** Next moment the blocked/unblocked state flips, or null when there are no windows. */
export function nextScheduleChange(now: Millis, windows: BlockedWindow[]): Millis | null {
  if (windows.length === 0) return null;
  if (scheduleBlocked(now, windows)) return scheduleUnblockAt(now, windows);
  return Math.min(...windows.map((w) => nextWallClock(now, w.fromMin)));
}

/** Concatenation is a union: a minute is blocked if any window covers it. */
export function unionWindows(a: BlockedWindow[], b: BlockedWindow[]): BlockedWindow[] {
  const seen = new Set<string>();
  const out: BlockedWindow[] = [];
  for (const w of [...a, ...b]) {
    if (w.fromMin === w.toMin) continue;
    const key = `${w.fromMin}|${w.toMin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fromMin: w.fromMin, toMin: w.toMin });
  }
  return out;
}

/** True if switching from `oldW` to `newW` would unblock at least one minute (a relaxation). */
export function minutesRemoved(oldW: BlockedWindow[], newW: BlockedWindow[]): boolean {
  for (let m = 0; m < 1440; m++) {
    if (oldW.some((w) => minuteInWindow(m, w)) && !newW.some((w) => minuteInWindow(m, w))) return true;
  }
  return false;
}

export function formatWindowTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
