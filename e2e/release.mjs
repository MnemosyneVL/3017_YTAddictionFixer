// Smoke test of the release build (release/unpacked, made by `npm run package`): the exact files that go into
// the store package must start as a fresh installation without the development test hook.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { DIST, launch, sleep, welcomePage } from './lib.mjs';

const dir = path.join(DIST, '..', 'release', 'unpacked');
if (!existsSync(path.join(dir, 'manifest.json'))) {
  console.error('release/unpacked is missing: run `npm run package` (or `npm run package -- --draft`) first.');
  process.exit(1);
}

let passed = 0;
function ok(name, cond, detail) {
  if (!cond) throw new Error(`FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  passed++;
  console.log(`  ok  ${name}`);
}

const { browser, worker, extensionId, close } = await launch({ headless: true, setup: false, dir });
const errors = [];
try {
  ok('the service worker starts', !!worker && /^[a-p]{32}$/.test(extensionId), extensionId);
  ok('there is no test hook in it', (await worker.evaluate(() => typeof globalThis.__ytbTest)) === 'undefined');
  const welcome = await welcomePage(browser);
  ok('the welcome page opens on install', !!welcome);
  welcome.on('pageerror', (e) => errors.push('[welcome] ' + e.message));
  await welcome.waitForSelector('button.primary.big', { timeout: 10000 });
  ok('the badge shows that setup is pending', (await worker.evaluate(() => chrome.action.getBadgeText({}))) === '!');
  const granted = await worker.evaluate(() => chrome.permissions.getAll());
  ok('no webNavigation, tabs or history permission', !granted.permissions.some((p) => ['webNavigation', 'tabs', 'history'].includes(p)), granted.permissions.join(','));

  const popup = await browser.newPage();
  popup.on('pageerror', (e) => errors.push('[popup] ' + e.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle0' });
  await sleep(400);
  ok('the popup offers to finish setup', /Finish setup/.test(await popup.evaluate(() => document.body.innerText)));

  // Through the real interface, since there is no hook: Start with the defaults.
  await welcome.bringToFront();
  await (await welcome.$('button.primary.big')).click();
  await welcome.waitForFunction(() => /You are set/.test(document.body.innerText), { timeout: 10000 });
  ok('Start finishes setup', /^\d+$/.test(await worker.evaluate(() => chrome.action.getBadgeText({}))));

  for (const name of ['options', 'report', 'popup']) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name} console] ${m.text()}`); });
    await page.goto(`chrome-extension://${extensionId}/${name}.html`, { waitUntil: 'networkidle0' });
    await sleep(400);
    const text = await page.evaluate(() => document.body.innerText);
    ok(`${name} renders`, !!text && !text.includes('Loading') && !text.includes('needs a reload'), text.slice(0, 80));
    await page.close();
  }
  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error('\n' + (e instanceof Error ? e.message : String(e)));
  await close();
  process.exit(1);
}
await close();
