// Toolbar badge: minutes left today, ✕ when blocked, OV during an override, ! while setup is pending.
import { dailyRemainingSec } from '../shared/day';
import { isSetUp } from '../shared/onboarding';
import { overrideActive } from '../shared/policy';
import { scheduleBlocked } from '../shared/schedule';
import { minutesFloor } from '../shared/time';
import type { Store } from './store';

let last = '';

export async function updateBadge(s: Store, now: number): Promise<void> {
  let text = '';
  let color = '#5c6bc0';
  if (!isSetUp(s.meta)) {
    // Setup is pending: nothing is counted yet, and the popup offers to finish it.
    text = '!';
    color = '#ef6c00';
  } else if (overrideActive(s.state, now)) {
    text = 'OV';
    color = '#ef6c00';
  } else if (s.state.dailyBlock || scheduleBlocked(now, s.day.limits.windows)) {
    text = '✕';
    color = '#c62828';
  } else {
    const remaining = dailyRemainingSec(s.day);
    if (remaining !== null) {
      const min = minutesFloor(remaining);
      text = min > 999 ? '999' : String(min);
      color = remaining <= s.config.warnBeforeMin * 60 ? '#ef6c00' : '#2e7d32';
    }
  }
  const key = `${text}|${color}`;
  if (key === last) return;
  last = key;
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  try {
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } catch {
    // older Chrome
  }
}
