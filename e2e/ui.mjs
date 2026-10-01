// Opens every extension page and screenshots it: first as a fresh installation (welcome page, popup with setup
// pending), then with setup done and sample data seeded.
import { completeSetup, launch, rpc, sleep, storage, welcomePage } from './lib.mjs';
import path from 'node:path';

import os from 'node:os';
const OUT = process.argv[2] || os.tmpdir();
const { browser, worker, extensionId, close } = await launch({ headless: true, setup: false });
const errs = [];

/** Opens an extension page, checks that it rendered without errors and saves `<shot>.png`. */
async function shoot(name, shot = name, query = '') {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errs.push(`[${shot}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[${shot} console] ${m.text()}`); });
  await page.setViewport(name === 'popup' ? { width: 360, height: 640 } : { width: 960, height: 1100 });
  await page.goto(`chrome-extension://${extensionId}/${name}.html${query}`, { waitUntil: 'networkidle0' });
  await sleep(600);
  const text = await page.evaluate(() => document.body.innerText);
  if (!text || text.includes('Could not') || text.includes('Loading')) errs.push(`[${shot}] did not render: ${text.slice(0, 120)}`);
  await page.screenshot({ path: path.join(OUT, `${shot}.png`), fullPage: name !== 'popup' });
  console.log(`${shot}: ${text.split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 100)}`);
  await page.close();
}

try {
  // The worker persists a fresh state during its initial load; wait for that (any request does) or the seed
  // written below would be overwritten.
  await rpc(worker, 'getBuild');
  await (await welcomePage(browser))?.close();

  // A fresh installation: setup is pending.
  await shoot('welcome', 'welcome-setup');
  await shoot('popup', 'popup-setup');
  await shoot('options', 'options-setup');

  await completeSetup(browser, worker);
  // Seed: two days of data across categories via direct storage writes in the worker.
  await worker.evaluate(() => {
    const day = (date, videos, browsingSec, overrides = []) => ({ date, videos, browsingSec, limits: { dailySec: 3600, category: { learning: null, gamedev: null, entertainment: 3600, browsing: null } }, overrides, events: overrides.map((o) => ({ at: o.at, type: 'override', minutes: o.minutes })) });
    return chrome.storage.local.set({
      videoIndex: {
        v1: { title: 'Rust lifetimes explained', channelId: 'UC1', channelName: 'Jon Gjengset', categoryId: 'learning', at: 1 },
        v2: { title: 'Godot 4 tutorial', channelId: 'UC2', channelName: 'GDQuest', categoryId: 'gamedev', at: 1 },
        v3: { title: 'Funny cats compilation', channelId: 'UC3', channelName: 'Cats', categoryId: 'entertainment', at: 1 },
        v4: { title: 'Some podcast', channelId: 'UC1', channelName: 'Jon Gjengset', categoryId: 'learning', at: 1 },
        zzzzzzzzzzz: { title: 'Saved for tomorrow', channelId: 'UC2', channelName: 'GDQuest', categoryId: 'gamedev', at: 1 },
      },
      'day:2026-08-22': day('2026-08-22', { v1: { categoryId: 'learning', sec: 1800, firstAt: 1, lastAt: 2 }, v3: { categoryId: 'entertainment', sec: 3600, firstAt: 1, lastAt: 2 } }, 400, [{ at: 1, minutes: 15 }]),
      'day:2026-08-23': day('2026-08-23', { v1: { categoryId: 'learning', sec: 900, firstAt: 1, lastAt: 2 }, v2: { categoryId: 'gamedev', sec: 1500, firstAt: 1, lastAt: 2 }, v3: { categoryId: 'entertainment', sec: 1200, firstAt: 1, lastAt: 2 }, v4: { categoryId: 'learning', sec: 700, firstAt: 1, lastAt: 2 } }, 250),
      state: { dayKey: '2026-08-23', lastCountedAt: 0, dailyBlock: null, categoryBlocks: {}, override: null, warned: { daily: false, category: {} }, savedLinks: [{ url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz', videoId: 'zzzzzzzzzzz', title: 'Saved for tomorrow', savedAt: 1787500000000, reason: 'daily' }] },
    });
  });
  await rpc(worker, '_reloadForTest');

  // A raise made today shows as "from tomorrow" in the popup.
  const cfg = await rpc(worker, 'getConfig');
  await rpc(worker, 'saveConfig', { config: { ...cfg, dailyLimitMin: 120 } });

  for (const name of ['popup', 'options', 'report']) await shoot(name);
  await shoot('welcome', 'welcome-help');

  // The feedback reminder: due once the installation is a week old, shown in the popup, on the report page and
  // in Settings. Every answer puts it away until the next milestone; "Don't ask again" switches it off.
  {
    const setAge = (days) =>
      worker.evaluate((d) => chrome.storage.local.get('meta').then(({ meta }) => chrome.storage.local.set({ meta: { ...meta, setupAt: Date.now() - d * 86400000, feedbackDone: [] } })), days);
    await setAge(8);
    await rpc(worker, '_reloadForTest');
    for (const name of ['popup', 'options', 'report']) await shoot(name, `${name}-reminder`);

    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(400);
    const shown = () => page.evaluate(() => !!document.querySelector('.feedback'));
    const press = async (label) => (await page.evaluateHandle((l) => [...document.querySelectorAll('.feedback button')].find((b) => b.textContent === l), label)).asElement().click();
    if (!(await shown())) errs.push('[popup] the feedback reminder is not shown after a week');
    await press('Later');
    await sleep(800);
    const afterLater = (await storage(worker)).meta;
    if ((await shown()) || JSON.stringify(afterLater.feedbackDone) !== '[7]') errs.push(`[popup] "Later" did not put the reminder away: ${JSON.stringify(afterLater)}`);

    await setAge(31);
    await rpc(worker, '_reloadForTest');
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(400);
    await press("Don't ask again");
    await sleep(800);
    const off = (await rpc(worker, 'getConfig')).feedbackReminders === false;
    if (!off || (await shown())) errs.push('[popup] "Don\'t ask again" did not switch the reminders off');
    else console.log('popup: the reminder shows after a week; "Later" and "Don\'t ask again" work');
    await page.close();
  }

  // Saving settings must say so: the confirmation used to sit in a bar that was hidden at that very moment.
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 1100 });
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle0' });
    await sleep(400);
    const warn = await page.evaluateHandle(() => [...document.querySelectorAll('.grid .k')].find((k) => k.textContent === 'Warn before a limit')?.nextElementSibling?.querySelector('input'));
    await warn.asElement().click({ clickCount: 3 });
    await page.keyboard.type('7');
    await (await page.evaluateHandle(() => document.querySelector('.saved button.primary'))).asElement().click();
    await sleep(1200);
    const saved = await page.evaluate(() => {
      const n = document.querySelector('.saved .notice');
      return n ? { text: n.textContent, visible: getComputedStyle(n.closest('.saved')).visibility === 'visible' && n.getBoundingClientRect().height > 0 } : null;
    });
    if (!saved || !saved.visible || !/^Saved./.test(saved.text)) errs.push(`[options] the save confirmation is not visible: ${JSON.stringify(saved)}`);
    else console.log(`options: after saving → "${saved.text}"`);
    await page.screenshot({ path: path.join(OUT, 'options-saved.png') });
    await page.close();
  }

  // The placeholder page, first block: blocked hours covering now.
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const cfg2 = await rpc(worker, 'getConfig');
  await rpc(worker, 'saveConfig', { config: { ...cfg2, blockedWindows: [{ fromMin: (nowMin - 60 + 1440) % 1440, toMin: (nowMin + 60) % 1440 }] } });
  await shoot('blocked', 'blocked-first', `?u=${encodeURIComponent('https://www.youtube.com/watch?v=jNQXAC9IVRw')}&r=schedule`);

  if (errs.length) { console.error('ERRORS:\n' + errs.join('\n')); await close(); process.exit(1); }
  console.log('all pages rendered');
} finally {
  await close();
}
