// Service worker entry point. Every listener is registered synchronously at top level so Chrome can wake
// the worker for it; the actual work runs through the store's serialized queue.
import { senderRole } from '../shared/access';
import { LOG_TAG } from '../shared/brand';
import { ALARM_OVERRIDE, ALARM_ROLLOVER } from '../shared/constants';
import { isSetUp } from '../shared/onboarding';
import { checkRequest } from '../shared/validate';
import { scheduleBoundaryAlarm, scheduleOverrideEnd, scheduleRollover } from './alarms';
import { updateBadge } from './badge';
import { handle, handleAlarm } from './handlers';
import { enqueue, persist, ready, setIdle } from './store';
import { injectIntoOpenTabs } from './tabs';

// Content scripts never touch storage themselves; keep a compromised YouTube renderer from reading or
// rewriting it directly, past the request checks below.
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);

// ---- messages ---------------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  // Only our own pages and our content scripts in YouTube tabs get an answer; what a content script may
  // ask for is a short list (src/shared/access.ts), and every request is rebuilt before a handler sees it.
  const role = senderRole(sender, chrome.runtime.id);
  if (!role) return false;
  const checked = checkRequest(msg, role);
  if ('error' in checked) {
    sendResponse({ error: checked.error });
    return false;
  }
  const req = checked.req;
  enqueue((s) => handle(s, req, sender))
    .then((res) => sendResponse(res ?? { ok: true }))
    .catch((e: unknown) => {
      console.warn(LOG_TAG, 'handler failed', req.type, e);
      sendResponse({ error: e instanceof Error ? e.message : String(e) });
    });
  return true; // async response
});

// ---- tabs / idle ------------------------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async (s) => {
    if (s.tabs[tabId]) {
      delete s.tabs[tabId];
      await persist(s, ['tabs']);
    }
  }).catch(() => undefined);
});

chrome.idle.onStateChanged.addListener((state) => {
  enqueue((s) => setIdle(s, state)).catch(() => undefined);
});

// ---- alarms -----------------------------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  enqueue((s) => handleAlarm(s, alarm.name)).catch((e) => console.warn(LOG_TAG, 'alarm', e));
});

// ---- lifecycle --------------------------------------------------------------------------------------------

async function boot(reason: string): Promise<void> {
  const s = await ready();
  const now = Date.now();
  await chrome.idle.setDetectionInterval(Math.max(15, Math.round(s.config.idleAfterSec)));
  try {
    const idle = await chrome.idle.queryState(Math.max(15, Math.round(s.config.idleAfterSec)));
    await setIdle(s, idle);
  } catch {
    // ignore
  }
  await scheduleRollover(s, now);
  await scheduleBoundaryAlarm(s, now);
  if (s.state.override && s.state.override.until > now) await scheduleOverrideEnd(s.state.override.until);
  await updateBadge(s, now);
  console.log(LOG_TAG, `ready (${reason}), day ${s.state.dayKey}`);
}

chrome.runtime.onInstalled.addListener((details) => {
  enqueue(async (s) => {
    await boot(`installed:${details.reason}`);
    if (!isSetUp(s.meta)) {
      // Nothing is recorded or enforced before the user has read what the extension does and pressed Start,
      // so nothing is injected either. A fresh install gets the welcome page; the popup offers it later.
      if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
      }
      return;
    }
    await injectIntoOpenTabs();
  }).catch((e) => console.warn(LOG_TAG, 'install', e));
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(() => boot('startup')).catch((e) => console.warn(LOG_TAG, 'startup', e));
});

// A worker can also be (re)started by any event above; make sure alarms exist and the badge is right.
enqueue(async (s) => {
  const now = Date.now();
  const existing = await chrome.alarms.get(ALARM_ROLLOVER);
  if (!existing) await scheduleRollover(s, now);
  await scheduleBoundaryAlarm(s, now);
  if (s.state.override && s.state.override.until > now && !(await chrome.alarms.get(ALARM_OVERRIDE))) {
    await scheduleOverrideEnd(s.state.override.until);
  }
  await updateBadge(s, now);
}).catch((e) => console.warn(LOG_TAG, 'boot', e));
