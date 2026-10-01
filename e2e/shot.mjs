import { dismissConsent, launch, rpc, sleep } from './lib.mjs';
import os from 'node:os';
import path from 'node:path';
const out = path.join(os.tmpdir(), 'ytb-pill.png');
const { browser, worker, close } = await launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded' });
  await dismissConsent(page);
  await sleep(2000);
  await dismissConsent(page);
  await rpc(worker, '_setIdle', { idle: 'active' });
  await sleep(5000);
  await page.keyboard.press('1');
  await sleep(7000);
  const player = await page.$('#movie_player');
  await (player ?? page).screenshot({ path: out });
  console.log(out);
} finally { await close(); }
