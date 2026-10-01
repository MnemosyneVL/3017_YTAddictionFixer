// First-run flow against real youtube.com: a fresh installation records and enforces nothing until "Start" is
// pressed on the welcome page, the limits chosen there apply the same day, and an already-open video is picked
// up at once.
import { dismissConsent, launch, promptVisible, rpc, sleep, storage, videoState, welcomePage } from './lib.mjs';

const VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo", 19 s
const HEADLESS = process.argv.includes('--headless');

let passed = 0;
function ok(name, cond, detail) {
  if (!cond) throw new Error(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  passed++;
  console.log(`  ok  ${name}`);
}

const { browser, worker, extensionId, close } = await launch({ headless: HEADLESS, setup: false });
const errors = [];
worker.on('console', (m) => { if (/error|fail/i.test(m.text())) errors.push('[worker] ' + m.text()); });
const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));
const overlays = (page) => page.evaluate(() => document.querySelectorAll('[data-yt-budget]').length);

try {
  console.log('# a fresh installation');
  const welcome = await welcomePage(browser);
  ok('the welcome page opens on install', !!welcome);
  welcome.on('pageerror', (e) => errors.push('[welcome] ' + e.message));
  await welcome.waitForSelector('button.primary.big', { timeout: 10000 });
  const welcomeText = await welcome.evaluate(() => document.body.innerText);
  ok('it explains what is recorded and offers Start', /stays in this browser/i.test(welcomeText) && /Nothing is recorded or limited until you press Start/i.test(welcomeText));
  ok('the badge shows that setup is pending', (await badge()) === '!', await badge());
  const status0 = await rpc(worker, 'getStatus');
  ok('status reports setup as pending', status0.setupDone === false);

  console.log('# before Start: YouTube is left alone');
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto(VIDEO, { waitUntil: 'domcontentloaded' });
  await dismissConsent(page, { waitMs: 6000 });
  await page.bringToFront();
  await sleep(7000); // longer than a heartbeat
  ok('no category prompt', !(await promptVisible(page)));
  ok('no overlay of any kind in the page', (await overlays(page)) === 0);
  const before = await storage(worker);
  ok('no video is remembered', Object.keys(before.videoIndex ?? {}).length === 0, JSON.stringify(Object.keys(before.videoIndex ?? {})));
  const day0 = before[Object.keys(before).find((k) => k.startsWith('day:'))];
  ok('no time is counted', !day0 || (Object.keys(day0.videos).length === 0 && day0.browsingSec === 0), JSON.stringify(day0));
  ok('no saved links', (before.state?.savedLinks ?? []).length === 0);
  ok('setup is stored as pending', before.meta && before.meta.setupAt === null, JSON.stringify(before.meta));

  console.log('# Start with a 2-hour day');
  await welcome.bringToFront();
  const twoHours = await welcome.evaluateHandle(() => [...document.querySelectorAll('button.preset')].find((b) => b.textContent === '2 hours'));
  await twoHours.asElement().click();
  await (await welcome.$('button.primary.big')).click();
  await welcome.waitForFunction(() => /You are set/.test(document.body.innerText), { timeout: 10000 });
  const after = await storage(worker);
  ok('setup is stored as done', typeof after.meta?.setupAt === 'number' && after.meta.setupAt > 0, JSON.stringify(after.meta));
  ok('the chosen daily limit is saved', after.config.dailyLimitMin === 120, String(after.config.dailyLimitMin));
  const dayKey = Object.keys(after).find((k) => k.startsWith('day:'));
  ok('it applies today, not tomorrow', after[dayKey].limits.dailySec === 7200, JSON.stringify(after[dayKey].limits));
  ok('the starter categories are saved', JSON.stringify(after.config.categories.filter((c) => !c.builtin).map((c) => c.id)) === JSON.stringify(['learning', 'entertainment']));
  ok('the badge shows the minutes left', (await badge()) === '120', await badge());

  console.log('# the video that was already open');
  await page.bringToFront();
  for (let i = 0; i < 20 && !(await promptVisible(page)); i++) await sleep(500);
  ok('it now asks for its category', await promptVisible(page));
  const vs = await videoState(page);
  ok('and waits paused', vs && vs.paused === true);
  await page.keyboard.press('1');
  await sleep(2500);
  const index = (await storage(worker)).videoIndex;
  ok('the answer is recorded', index?.['jNQXAC9IVRw']?.categoryId === 'learning', JSON.stringify(index));

  console.log('# afterwards');
  const again = await rpc(worker, 'completeSetup', { config: { ...after.config, dailyLimitMin: 600 } });
  ok('setup cannot be run a second time', again.ok === false);
  ok('…so it is no way to raise today’s limit', (await storage(worker))[dayKey].limits.dailySec === 7200);
  const help = await browser.newPage();
  await help.goto(`chrome-extension://${extensionId}/welcome.html`, { waitUntil: 'networkidle0' });
  await sleep(500);
  const helpText = await help.evaluate(() => document.body.innerText);
  ok('the same page is now the help page', /Questions/.test(helpText) && !(await help.$('button.primary.big')));

  console.log('# Delete everything returns to the first-run state');
  await rpc(worker, 'clearData', { keepConfig: false });
  ok('setup is pending again', (await storage(worker)).meta?.setupAt === null && (await badge()) === '!');
  await page.bringToFront();
  await sleep(7000);
  ok('the open tab goes quiet again', (await overlays(page)) === 0);

  console.log('# an installation from before the setup step (settings stored, no first-run record)');
  await worker.evaluate(() => chrome.storage.local.remove('meta'));
  await rpc(worker, '_reloadForTest');
  const legacy = await rpc(worker, 'getStatus');
  ok('is treated as set up, without the welcome step', legacy.setupDone === true && typeof (await storage(worker)).meta?.setupAt === 'number');

  ok('no worker/page errors during the run', errors.length === 0, errors.join(' | '));
  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error('\n' + (e instanceof Error ? e.message : String(e)));
  if (errors.length) console.error('captured errors:\n' + errors.join('\n'));
  await close();
  process.exit(1);
}
await close();
