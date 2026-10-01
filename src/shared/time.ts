// Day boundaries and formatting. Pure. All calendar math uses local date components (DST-safe).
import type { DayKey, Millis } from './types';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDayKey(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDayKey(key: DayKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`invalid day key: ${key}`);
  return { y, m, d };
}

/**
 * The day a moment belongs to, given that days start `dayStartMinutes` after local midnight.
 * 03:30 with a 04:00 day start still belongs to the previous calendar date.
 */
export function dayKeyFor(now: Millis, dayStartMinutes: number): DayKey {
  const d = new Date(now);
  const minutesSinceMidnight = d.getHours() * 60 + d.getMinutes();
  if (minutesSinceMidnight < dayStartMinutes) {
    return formatDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  }
  return formatDayKey(d);
}

/** Epoch ms at which the given day starts (local wall-clock `dayStartMinutes` on that date). */
export function dayStartFor(key: DayKey, dayStartMinutes: number): Millis {
  const { y, m, d } = parseDayKey(key);
  return new Date(y, m - 1, d, 0, dayStartMinutes, 0, 0).getTime();
}

export function addDays(key: DayKey, n: number): DayKey {
  const { y, m, d } = parseDayKey(key);
  return formatDayKey(new Date(y, m - 1, d + n));
}

/** Epoch ms of the next day boundary strictly after `now`. */
export function nextBoundary(now: Millis, dayStartMinutes: number): Millis {
  const key = dayKeyFor(now, dayStartMinutes);
  let next = dayStartFor(addDays(key, 1), dayStartMinutes);
  // Guard against DST normalisation placing the boundary at or before `now`.
  while (next <= now) next = dayStartFor(addDays(dayKeyFor(next, dayStartMinutes), 1), dayStartMinutes);
  return next;
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayKeysInRange(from: DayKey, to: DayKey): DayKey[] {
  const keys: DayKey[] = [];
  let k = from;
  for (let i = 0; i < 3660 && k <= to; i++) {
    keys.push(k);
    k = addDays(k, 1);
  }
  return keys;
}

/** "1h 05m", "12m", "45s", "0s". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** "1:05:09" / "12:07" style clock duration. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Whole minutes, rounded down, for badges. */
export function minutesFloor(sec: number): number {
  return Math.max(0, Math.floor(sec / 60));
}

/** "6h 12m" until `until`, or "now" when in the past. */
export function formatUntil(until: Millis, now: Millis): string {
  const diff = Math.round((until - now) / 1000);
  return diff <= 0 ? 'now' : formatDuration(diff);
}
