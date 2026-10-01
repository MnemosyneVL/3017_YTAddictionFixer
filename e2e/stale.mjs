// Verifies the stale-worker banner: none when builds match, banner when the page build differs from the SW's.
import assert from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DIST, launch, sleep } from './lib.mjs';

const { browser, extensionId, close } = await launch({ headless: true });
const optionsJs = path.join(DIST, 'pages', 'options.js');
const orig = readFileSync(optionsJs, 'utf8');
try {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle0' });
  await sleep(500);
  const t1 = await page.evaluate(() => document.body.innerText);
  assert(!/needs a reload/i.test(t1), 'no banner expected when builds match');
  console.log('ok  no banner when builds match');

  // Simulate: rebuild changed the page bundle on disk while the SW keeps running the old build.
  const m = orig.match(/"(\d+\.\d+\.\d+\.\d+)"/);
  assert(m, 'build stamp literal found in options.js');
  writeFileSync(optionsJs, orig.replaceAll(m[1], '9.9.9.111111111'));
  await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'networkidle0' });
  await sleep(500);
  const t2 = await page.evaluate(() => document.body.innerText);
  assert(/needs a reload/i.test(t2), 'banner expected on build mismatch, got: ' + t2.slice(0, 120));
  console.log('ok  banner shown when the worker is stale');
} finally {
  writeFileSync(optionsJs, orig);
  await close();
}
console.log('stale-worker checks passed');
