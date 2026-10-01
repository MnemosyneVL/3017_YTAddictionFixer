// Reaching the YouTube tabs that are already open: injecting the content scripts into them and waking the
// ones that went quiet while setup was pending.
import { LOG_TAG } from '../shared/brand';
import type { PushMessage } from '../shared/messages';
import { parseYouTubeUrl } from '../shared/url';

const YT_MATCHES = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'];

/** Open tabs showing a page our content scripts run on (not YouTube Music, sign-in, Studio and the like). */
async function youTubeTabIds(): Promise<number[]> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: YT_MATCHES });
  } catch {
    return [];
  }
  const ids: number[] = [];
  for (const tab of tabs) {
    if (tab.id !== undefined && tab.url && parseYouTubeUrl(tab.url).isYouTube) ids.push(tab.id);
  }
  return ids;
}

async function inject(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    console.warn(LOG_TAG, 'could not inject into tab', tabId, e);
  }
}

/** After an install or update: the scripts of the previous version are orphaned, the new ones go in. */
export async function injectIntoOpenTabs(): Promise<void> {
  for (const tabId of await youTubeTabIds()) await inject(tabId);
}

/**
 * After setup was finished: content scripts that went dormant start working, and tabs that have none yet
 * (they were open before the install, when nothing is injected) get them.
 */
export async function activateOpenTabs(): Promise<void> {
  const msg: PushMessage = { type: 'activate' };
  for (const tabId of await youTubeTabIds()) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      await inject(tabId);
    }
  }
}
