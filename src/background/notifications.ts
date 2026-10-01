// System notifications and in-page toasts for limit events.
import type { AccountingEvent } from '../shared/accounting';
import { LOG_TAG, NEUTRAL_LABEL } from '../shared/brand';
import { categoryById } from '../shared/config';
import { formatWindowTime } from '../shared/schedule';
import { NOTIFY_CATEGORY, NOTIFY_DAILY } from '../shared/constants';
import type { PushMessage } from '../shared/messages';
import type { Store } from './store';

async function notify(id: string, title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.clear(id);
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2,
    });
  } catch (e) {
    console.warn(LOG_TAG, 'notification failed', e);
  }
}

/** Sends a toast to every YouTube tab we know about. */
export async function broadcastToast(s: Store, text: string, kind: 'info' | 'warn' | 'limit'): Promise<void> {
  const msg: PushMessage = { type: 'toast', text, kind };
  await Promise.all(
    Object.keys(s.tabs).map((id) => chrome.tabs.sendMessage(Number(id), msg).catch(() => undefined)),
  );
}

/** Advance warning that blocked hours are about to start. */
export async function notifySchedule(s: Store, fromMin: number): Promise<void> {
  const text = `YouTube closes at ${formatWindowTime(fromMin)} (blocked hours).`;
  await notify('schedule', NEUTRAL_LABEL, text);
  await broadcastToast(s, text, 'warn');
}

export async function announce(s: Store, events: AccountingEvent[]): Promise<void> {
  for (const e of events) {
    switch (e.type) {
      case 'dailyWarning': {
        const text = `${s.config.warnBeforeMin} min of YouTube left today`;
        await notify(NOTIFY_DAILY, NEUTRAL_LABEL, text);
        await broadcastToast(s, text, 'warn');
        break;
      }
      case 'dailyLimit': {
        const text = 'Daily YouTube limit reached. Finish the video you are watching — YouTube is blocked for the rest of the day after it.';
        await notify(NOTIFY_DAILY, 'Daily limit reached', text);
        await broadcastToast(s, text, 'limit');
        break;
      }
      case 'categoryWarning': {
        const name = categoryById(s.config, e.categoryId)?.name ?? e.categoryId;
        const text = `${name}: ${s.config.warnBeforeMin} min left today`;
        await notify(NOTIFY_CATEGORY + e.categoryId, NEUTRAL_LABEL, text);
        await broadcastToast(s, text, 'warn');
        break;
      }
      case 'categoryLimit': {
        const name = categoryById(s.config, e.categoryId)?.name ?? e.categoryId;
        const text = `${name} limit reached. Finish the current video — further ${name} videos are blocked until tomorrow.`;
        await notify(NOTIFY_CATEGORY + e.categoryId, `${name} limit reached`, text);
        await broadcastToast(s, text, 'limit');
        break;
      }
      case 'grandfatherExhausted':
        break;
    }
  }
}
