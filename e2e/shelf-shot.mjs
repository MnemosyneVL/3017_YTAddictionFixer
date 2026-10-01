// Ad-hoc: screenshots the saved-for-later shelf on the home feed in the light and the dark theme
// (%TEMP%\ytb-shelf-{light,dark}.png; ytb-home-{light,dark}.png for context). Seeds three saved links:
// one blocked by an exhausted category budget, one without a category. Logged out, so the feed itself is empty.
import { dismissConsent, launch, rpc, sleep } from './lib.mjs';
import os from 'node:os';
import path from 'node:path';

const { browser, worker, close } = await launch({ headless: true });
try {
  await rpc(worker, 'getBuild'); // the worker persists a fresh state on its initial load; seed only after that
  const now = Date.now();
  const seed = await worker.evaluate(() => chrome.storage.local.get(['state']));
  seed.videoIndex = {
    jNQXAC9IVRw: { title: 'Me at the zoo', channelName: 'jawed', categoryId: 'learning', at: 1 },
    dQw4w9WgXcQ: { title: 'Rick Astley - Never Gonna Give You Up (Official Video)', channelName: 'Rick Astley', categoryId: 'entertainment', at: 1 },
    '9bZkp7q19f0': { title: 'PSY - GANGNAM STYLE M/V', channelName: 'officialpsy', at: 1 },
  };
  seed.state.savedLinks = [
    { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', savedAt: now - 3600e3, reason: 'daily' },
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up (Official Video)', savedAt: now - 86400e3, reason: 'category' },
    { url: 'https://www.youtube.com/watch?v=9bZkp7q19f0', videoId: '9bZkp7q19f0', title: 'PSY - GANGNAM STYLE M/V', savedAt: now - 3 * 86400e3, reason: 'daily' },
  ];
  seed.state.categoryBlocks = { entertainment: { since: now, grandfathers: [] } };
  await worker.evaluate((s) => chrome.storage.local.set(s), seed);
  await rpc(worker, '_reloadForTest');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await dismissConsent(page);
  await sleep(1500);
  await dismissConsent(page);
  for (let i = 0; i < 24 && !(await page.$('[data-yt-budget="shelf"]')); i++) await sleep(500);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((dark) => (dark ? document.documentElement.setAttribute('dark', '') : document.documentElement.removeAttribute('dark')), theme === 'dark');
    await sleep(1000);
    const host = await page.$('[data-yt-budget="shelf"]');
    if (!host) { console.log('no shelf on the page'); break; }
    await page.screenshot({ path: path.join(os.tmpdir(), `ytb-home-${theme}.png`) });
    await host.screenshot({ path: path.join(os.tmpdir(), `ytb-shelf-${theme}.png`) });
    console.log(path.join(os.tmpdir(), `ytb-shelf-${theme}.png`));
  }
} finally {
  await close();
}
