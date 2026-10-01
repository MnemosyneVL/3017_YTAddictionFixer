// Alarm scheduling: day rollover, override expiry and blocked-hours boundaries.
import { ALARM_OVERRIDE, ALARM_ROLLOVER, ALARM_SCHEDULE } from '../shared/constants';
import { nextScheduleChange } from '../shared/schedule';
import { nextBoundary } from '../shared/time';
import type { Store } from './store';

export async function scheduleRollover(s: Store, now: number): Promise<void> {
  const when = nextBoundary(now, s.config.dayStartMinutes);
  const existing = await chrome.alarms.get(ALARM_ROLLOVER);
  if (existing && Math.abs(existing.scheduledTime - when) < 1000) return;
  await chrome.alarms.create(ALARM_ROLLOVER, { when });
}

/** Arms an alarm at the next start/end of a blocked-hours window (so idle tabs are cut on time). */
export async function scheduleBoundaryAlarm(s: Store, now: number): Promise<void> {
  const next = nextScheduleChange(now, s.day.limits.windows);
  if (next === null) {
    await chrome.alarms.clear(ALARM_SCHEDULE);
    return;
  }
  const existing = await chrome.alarms.get(ALARM_SCHEDULE);
  if (existing && Math.abs(existing.scheduledTime - (next + 500)) < 1000) return;
  await chrome.alarms.create(ALARM_SCHEDULE, { when: next + 500 });
}

export async function scheduleOverrideEnd(until: number | null): Promise<void> {
  if (until === null) {
    await chrome.alarms.clear(ALARM_OVERRIDE);
    return;
  }
  await chrome.alarms.create(ALARM_OVERRIDE, { when: until + 500 });
}
