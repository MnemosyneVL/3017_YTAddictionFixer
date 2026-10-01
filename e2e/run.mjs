// Browser smoke tests (Puppeteer + Chrome for Testing) against real youtube.com.
// Asserts on extension state, storage and redirects. NOTE: Chrome for Testing does not actually play video
// in automation, so we do not assert on wall-clock playback (counting is exercised in the unit tests).
import assert from 'node:assert';
import { dismissConsent, launch, promptVisible, rpc, sleep, storage, videoState } from './lib.mjs';

const VIDEO_A = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo", 19 s
const VIDEO_B = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const HEADLESS = process.argv.includes('--headless');

let passed = 0;
function ok(name, cond, detail) {
  if (!cond) throw new Error(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  passed++;
  console.log(`  ok  ${name}`);
}

const { browser, worker, extensionId, close } = await launch({ headless: HEADLESS });
const errors = [];
worker.on('console', (m) => { if (/error|fail/i.test(m.text())) errors.push('[worker] ' + m.text()); });

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

  console.log('# gate + prompt');
  await page.goto(VIDEO_A, { waitUntil: 'domcontentloaded' });
  await dismissConsent(page, { waitMs: 6000 });
  await page.bringToFront();
  await rpc(worker, '_setIdle', { idle: 'active' });
  await sleep(5000);
  ok('extension id looks valid', /^[a-p]{32}$/.test(extensionId), extensionId);
  ok('category prompt is shown for a new video', await promptVisible(page));
  const firstPrompt = await page.evaluate(() => document.querySelector('[data-yt-budget="prompt"]')?.shadowRoot?.textContent ?? '');
  ok('the first prompt explains why it asks', /Why am I asked?/.test(firstPrompt), firstPrompt.slice(0, 120));
  const vs1 = await videoState(page);
  ok('video is held paused behind the prompt', vs1 && vs1.paused === true);

  console.log('# categorize');
  await page.keyboard.press('1'); // first category = Learning
  await sleep(2500);
  ok('prompt closes after choosing', !(await promptVisible(page)));
  const store1 = await worker.evaluate(() => chrome.storage.local.get(['videoIndex']));
  const idx = store1.videoIndex?.['jNQXAC9IVRw'];
  ok('video categorized as learning', idx?.categoryId === 'learning', JSON.stringify(idx));
  ok('channelId captured from the player API', /^UC/.test(idx?.channelId ?? ''), idx?.channelId);
  ok('title captured', !!idx?.title, idx?.title);

  console.log('# a page script cannot reach the worker');
  // Posted from the page's own world, exactly as any script on youtube.com could. The first message tries to
  // turn the bridge's "info" report into a clearData request; the others try inherited names as video ids.
  await page.evaluate(() => {
    window.postMessage({ source: 'yt-budget', type: 'info', info: { videoId: 'jNQXAC9IVRw', type: 'clearData', keepConfig: false } }, location.origin);
    window.postMessage({ source: 'yt-budget', type: 'info', info: { videoId: '__proto__', title: 'x' } }, location.origin);
    window.postMessage({ source: 'yt-budget', type: 'info', info: { videoId: 'constructor', title: 'x' } }, location.origin);
  });
  await sleep(1500);
  const afterHostile = await worker.evaluate(() => chrome.storage.local.get(['videoIndex', 'config']));
  ok('a crafted page message cannot clear the data', afterHostile.videoIndex?.['jNQXAC9IVRw']?.categoryId === 'learning', JSON.stringify(Object.keys(afterHostile.videoIndex ?? {})));
  ok('inherited names are not accepted as video ids', await worker.evaluate(() => ({}).title === undefined && ({}).at === undefined));

  // The placeholder page is web-accessible, so a YouTube page can embed it. Framed, it must stay blank.
  const framedUrl = `chrome-extension://${extensionId}/blocked.html?u=${encodeURIComponent(VIDEO_B)}&r=daily`;
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.id = 'ytb-e2e-frame';
    f.src = src;
    f.style.cssText = 'position:fixed;left:0;bottom:0;width:320px;height:200px;z-index:9';
    document.body.append(f);
  }, framedUrl);
  await sleep(2500);
  const framed = page.frames().find((f) => f.url().startsWith(`chrome-extension://${extensionId}/blocked.html`));
  const framedText = framed ? await framed.evaluate(() => document.body.innerText.trim()).catch(() => 'unreadable') : null;
  console.log(`  (placeholder inside a frame: ${framed ? 'loaded' : 'not loaded by the page'})`);
  ok('a framed placeholder page shows nothing', framedText === null || framedText === '', String(framedText).slice(0, 80));
  await page.evaluate(() => document.getElementById('ytb-e2e-frame')?.remove());

  console.log('# timer pill');
  const pillText = await page.evaluate(() => document.querySelector('[data-yt-budget="timer"]')?.shadowRoot?.textContent ?? '');
  ok('timer pill is shown on the video', pillText.length > 0);
  ok('timer pill shows the daily time', /left today|today/.test(pillText), pillText);
  ok('timer pill shows the category', /Learning/.test(pillText), pillText);
  const pillOff = await rpc(worker, 'getConfig').then((c) => rpc(worker, 'saveConfig', { config: { ...c, showOverlayTimer: false } }));
  await sleep(7000);
  ok('timer pill disappears when toggled off', !(await page.evaluate(() => !!document.querySelector('[data-yt-budget="timer"]'))));
  await rpc(worker, 'getConfig').then((c) => rpc(worker, 'saveConfig', { config: { ...c, showOverlayTimer: true } }));
  void pillOff;

  console.log('# re-categorize via the timer pill');
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() => !!document.querySelector('[data-yt-budget="timer"]'))) break;
    await sleep(1000);
  }
  ok('timer pill is back after re-enabling', await page.evaluate(() => !!document.querySelector('[data-yt-budget="timer"]')));
  // A click made up by a page script must do nothing; only a real one reopens the prompt.
  await page.evaluate(() => {
    const host = document.querySelector('[data-yt-budget="timer"]');
    host?.shadowRoot?.querySelector('.pill')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(1000);
  ok('a click synthesized by the page is ignored', !(await promptVisible(page)));
  const pill = await page.evaluateHandle(() => document.querySelector('[data-yt-budget="timer"]')?.shadowRoot?.querySelector('.pill'));
  await pill.asElement()?.click();
  await sleep(1500);
  ok('pill click reopens the category prompt', await promptVisible(page));
  const promptText = await page.evaluate(() => document.querySelector('[data-yt-budget="prompt"]')?.shadowRoot?.textContent ?? '');
  ok('prompt marks the current category', /current/.test(promptText), promptText.slice(0, 120));
  ok('the explanation is not repeated once a video has been filed', !/Why am I asked?/.test(promptText));
  await page.keyboard.press('3'); // Entertainment
  await sleep(2500);
  const recat = await worker.evaluate(() => chrome.storage.local.get(['videoIndex']));
  ok('video re-categorized to entertainment', recat.videoIndex?.['jNQXAC9IVRw']?.categoryId === 'entertainment', JSON.stringify(recat.videoIndex?.['jNQXAC9IVRw']));
  const dayStore = await worker.evaluate(() => chrome.storage.local.get(null));
  const dayRec = dayStore[Object.keys(dayStore).find((k) => k.startsWith('day:'))];
  ok("today's seconds moved to the new category", dayRec?.videos?.['jNQXAC9IVRw']?.categoryId === 'entertainment', JSON.stringify(dayRec?.videos));
  await worker.evaluate(() => globalThis.__ytbTest('categorize', { videoId: 'jNQXAC9IVRw', categoryId: 'learning', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }));

  console.log('# saved shelf on the feed');
  // Seed one saved link (with its index entry so the card has a channel and a category) and reload the store.
  const seed = await worker.evaluate(() => chrome.storage.local.get(['state', 'videoIndex']));
  seed.state.savedLinks = [{ url: VIDEO_B, videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', savedAt: Date.now(), reason: 'daily' }];
  seed.videoIndex = { ...(seed.videoIndex ?? {}), dQw4w9WgXcQ: { title: 'Never Gonna Give You Up', channelName: 'Rick Astley', categoryId: 'entertainment', at: 1 } };
  await worker.evaluate((data) => chrome.storage.local.set(data), seed);
  await rpc(worker, '_reloadForTest');
  const shelfHost = () => page.evaluate(() => !!document.querySelector('[data-yt-budget="shelf"]'));
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await dismissConsent(page);
  for (let i = 0; i < 24 && !(await shelfHost()); i++) await sleep(500);
  ok('saved shelf appears on the home feed', await shelfHost());
  const shelfText = await page.evaluate(() => document.querySelector('[data-yt-budget="shelf"]')?.shadowRoot?.textContent ?? '');
  ok('shelf shows the saved video with channel and category', /Saved for later/.test(shelfText) && /Never Gonna Give You Up/.test(shelfText) && /Rick Astley/.test(shelfText) && /Entertainment/.test(shelfText), shelfText.slice(0, 200));
  ok('shelf sits inside the feed grid', await page.evaluate(() => !!document.querySelector('[data-yt-budget="shelf"]')?.closest('ytd-rich-grid-renderer')));
  const cfgShelf = await rpc(worker, 'getConfig');
  await rpc(worker, 'saveConfig', { config: { ...cfgShelf, showSavedShelf: false } });
  await sleep(7000);
  ok('shelf disappears when switched off', !(await shelfHost()));
  await rpc(worker, 'saveConfig', { config: { ...cfgShelf, showSavedShelf: true } });
  for (let i = 0; i < 24 && !(await shelfHost()); i++) await sleep(500);
  ok('shelf is back after re-enabling', await shelfHost());
  // A real click needs the button to hold still: the feed is still laying out around the shelf that was just
  // inserted, and a click aimed at a button that moves in the meantime lands next to it.
  const removeRect = () =>
    page.evaluate(() => {
      const r = document.querySelector('[data-yt-budget="shelf"]')?.shadowRoot?.querySelector('.x')?.getBoundingClientRect();
      return r ? `${Math.round(r.x)},${Math.round(r.y)}` : '';
    });
  for (let prev = '', i = 0; i < 20; i++) {
    const cur = await removeRect();
    if (cur && cur === prev) break;
    prev = cur;
    await sleep(300);
  }
  const removeBtn = await page.evaluateHandle(() => document.querySelector('[data-yt-budget="shelf"]')?.shadowRoot?.querySelector('.x'));
  await removeBtn.asElement()?.click();
  const savedCount = async () => ((await worker.evaluate(() => chrome.storage.local.get(['state']))).state?.savedLinks ?? []).length;
  for (let i = 0; i < 16 && (await savedCount()) > 0; i++) await sleep(250);
  const afterRemove = await worker.evaluate(() => chrome.storage.local.get(['state']));
  ok('remove button drops the link', (afterRemove.state?.savedLinks ?? []).length === 0, JSON.stringify(afterRemove.state?.savedLinks));
  await sleep(6000);
  ok('shelf hides once the list is empty', !(await shelfHost()));

  console.log('# blocked hours');
  // A second tab that was on YouTube a moment ago and has moved on: it is still in the worker's tab registry,
  // but a block must never pull it back.
  const wanderer = await browser.newPage();
  await wanderer.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await wanderer.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const win = { fromMin: (nowMin - 60 + 1440) % 1440, toMin: (nowMin + 60) % 1440 };
  const cfgSched = await rpc(worker, 'getConfig');
  await rpc(worker, 'saveConfig', { config: { ...cfgSched, blockedWindows: [win] } });
  await sleep(4000);
  ok('active window redirects the open tab', page.url().startsWith(`chrome-extension://${extensionId}/blocked.html`), page.url());
  ok('a tab that has left YouTube is not redirected', wanderer.url().startsWith('https://example.com'), wanderer.url());
  await wanderer.close();
  ok('placeholder names the blocked hours', /closed right now/i.test(await page.evaluate(() => document.body.innerText)));
  ok('the first block explains what happened', /What just happened?/.test(await page.evaluate(() => document.body.innerText)));
  await page.click('.first button.primary');
  await sleep(1200);
  ok('…until "Got it" is pressed', !/What just happened?/.test(await page.evaluate(() => document.body.innerText)));
  const schedInfo = await rpc(worker, 'getBlockInfo', { url: VIDEO_A });
  ok('schedule decision reported', schedInfo.decision.action === 'block' && schedInfo.decision.reason === 'schedule', JSON.stringify(schedInfo.decision));
  const cfgRemoved = await rpc(worker, 'getConfig');
  const removal = await rpc(worker, 'saveConfig', { config: { ...cfgRemoved, blockedWindows: [] } });
  ok('removing the window mid-day is deferred to tomorrow', removal.deferredSchedule === true);
  const stillBlocked = await rpc(worker, 'getBlockInfo', { url: VIDEO_A });
  ok('window removal does not unblock today', stillBlocked.decision.action === 'block' && stillBlocked.decision.reason === 'schedule', JSON.stringify(stillBlocked.decision));
  const ovSched = await rpc(worker, 'useOverride', { url: VIDEO_A });
  ok('override lifts blocked hours', typeof ovSched.until === 'number' && (await rpc(worker, 'getBlockInfo', { url: VIDEO_A })).decision.action !== 'block');
  // Reset schedule state for the remaining checks: fresh day record via clearData(keepConfig).
  await rpc(worker, 'clearData', { keepConfig: true });
  await worker.evaluate(() => globalThis.__ytbTest('categorize', { videoId: 'jNQXAC9IVRw', categoryId: 'learning', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }));
  await page.goto(VIDEO_A, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await sleep(4000);

  console.log('# daily limit → block → placeholder');
  const cfg = await rpc(worker, 'getConfig');
  await rpc(worker, 'saveConfig', { config: { ...cfg, dailyLimitMin: 0.15, warnBeforeMin: 0 } });
  // Give the running heartbeats a moment to cross the (tiny) limit; nudge time via a manual heartbeat too.
  await sleep(8000);
  const status = await rpc(worker, 'getStatus');
  ok('daily block is active after the limit', status.dailyBlocked === true, JSON.stringify({ total: status.totalSec }));
  ok('the video being watched is grandfathered', status.grandfathered.includes('jNQXAC9IVRw'), JSON.stringify(status.grandfathered));

  console.log('# navigation inside the page while blocked');
  // The grandfathered video may stay open; leaving it without a page load must still be caught.
  const onPlaceholder = () => page.url().startsWith(`chrome-extension://${extensionId}/blocked.html`);
  const waitForPlaceholder = async (ms) => {
    for (const end = Date.now() + ms; Date.now() < end && !onPlaceholder(); ) await sleep(100);
    return onPlaceholder();
  };
  ok('the grandfathered video is still open', page.url().startsWith(VIDEO_A), page.url());
  await page.click('ytd-topbar-logo-renderer a#logo');
  ok('an in-page navigation (logo click) is blocked', await waitForPlaceholder(6000), page.url());
  await page.goto(VIDEO_A, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await sleep(4000);
  ok('the grandfathered video opens again', page.url().startsWith(VIDEO_A), page.url());
  // A URL change YouTube's own navigation events do not announce.
  await page.evaluate(() => history.pushState({}, '', '/feed/trending'));
  ok('a bare history.pushState is blocked within 3 seconds', await waitForPlaceholder(3000), page.url());
  await page.goto(VIDEO_A, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await sleep(3000);

  console.log('# a different video is blocked and redirected');
  await page.goto(VIDEO_B, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await sleep(4000);
  ok('blocked video redirects to the placeholder', page.url().startsWith(`chrome-extension://${extensionId}/blocked.html`), page.url());
  ok('placeholder keeps the original URL', decodeURIComponent(page.url()).includes(VIDEO_B), page.url());
  const bodyText = await page.evaluate(() => document.body.innerText);
  ok('placeholder explains the daily limit', /daily/i.test(bodyText));
  const store2 = await worker.evaluate(() => chrome.storage.local.get(['state']));
  ok('blocked link is saved for later', (store2.state?.savedLinks ?? []).some((l) => l.videoId === 'dQw4w9WgXcQ'), JSON.stringify(store2.state?.savedLinks));

  console.log('# emergency override');
  const ov = await rpc(worker, 'useOverride', { url: VIDEO_B });
  ok('override starts', typeof ov.until === 'number' && ov.until > Date.now());
  const afterOv = await rpc(worker, 'getBlockInfo', { url: VIDEO_B });
  ok('override lifts the block', afterOv.decision.action !== 'block', JSON.stringify(afterOv.decision));
  const noMore = await rpc(worker, 'useOverride', { url: VIDEO_B });
  ok('only one override per day', noMore.until === null || noMore.until === ov.until);

  console.log('# report');
  const today = (await rpc(worker, 'getStatus')).dayKey;
  const report = await rpc(worker, 'getReport', { from: today, to: today });
  ok('report has the learning category', report.categories.some((c) => c.categoryId === 'learning'), JSON.stringify(report.categories.map((c) => c.categoryId)));

  console.log('# export / import');
  const exported = await rpc(worker, 'exportData');
  const keysBefore = Object.keys(await storage(worker)).sort();
  const imp = await rpc(worker, 'importData', { json: exported.json });
  ok('a backup imports cleanly', imp.ok === true && imp.days >= 1 && imp.videos >= 1, JSON.stringify(imp));
  ok('import keeps the same storage keys', JSON.stringify(Object.keys(await storage(worker)).sort()) === JSON.stringify(keysBefore));
  const hostile = JSON.parse(exported.json);
  hostile.data.state.savedLinks.unshift({ url: 'javascript://www.youtube.com/watch?x=%0aalert(1)//&v=dQw4w9WgXcQ', savedAt: 1, reason: 'daily' });
  hostile.data.config.categories[0].color = 'url(https://example.com/x)';
  hostile.data['day:1999-01-01'] = { videos: { constructor: { sec: 5 } }, browsingSec: 7 };
  const imp2 = await rpc(worker, 'importData', { json: JSON.stringify(hostile) });
  const afterImport = await storage(worker);
  ok(
    'import drops script links, bad colours and unsafe keys',
    imp2.ok === true &&
      afterImport.state.savedLinks.every((l) => l.url.startsWith('https://')) &&
      /^#[0-9a-f]{6}$/i.test(afterImport.config.categories[0].color) &&
      Object.keys(afterImport['day:1999-01-01'].videos).length === 0,
    JSON.stringify({ links: afterImport.state.savedLinks.map((l) => l.url), color: afterImport.config.categories[0].color }),
  );
  const junk = await rpc(worker, 'importData', { json: '{"x":1}' });
  ok('a file that is not a backup is refused and changes nothing', junk.ok === false && Object.keys(await storage(worker)).length === Object.keys(afterImport).length, JSON.stringify(junk));

  ok('no worker/page errors during the run', errors.length === 0, errors.join(' | '));
  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error('\n' + (e instanceof Error ? e.message : String(e)));
  if (errors.length) console.error('captured errors:\n' + errors.join('\n'));
  await close();
  process.exit(1);
}
await close();
