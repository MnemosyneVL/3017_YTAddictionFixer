// Shared helpers for the browser tests: launch Chrome for Testing with the built extension in a throwaway
// profile, find the service worker, talk to it, and handle YouTube's consent page.
import puppeteer from 'puppeteer';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
export const DIST = path.join(root, 'dist');

/**
 * The categories the browser tests are written against (keys 1 and 3 in the prompt, the seeds in ui.mjs),
 * fixed here so that the product's own starter categories can change freely.
 */
export const TEST_CATEGORIES = [
  { id: 'learning', name: 'Learning', color: '#42a5f5', limitMin: null, graceMin: null, order: 0 },
  { id: 'gamedev', name: 'Game dev', color: '#66bb6a', limitMin: null, graceMin: null, order: 1 },
  { id: 'entertainment', name: 'Entertainment', color: '#ffa726', limitMin: 60, graceMin: null, order: 2 },
];

/**
 * Every launch uses a fresh profile, i.e. a fresh installation: setup is pending, nothing is recorded, and the
 * welcome tab opens. `setup: true` (the default) finishes setup with TEST_CATEGORIES and a 60-minute day and
 * closes that tab; pass `setup: false` to test the first-run state itself. `dir` loads another build than
 * `dist/`, e.g. the release build, which has no test hook (so `setup` must be false and `rpc` does not work).
 */
export async function launch({ headless = false, setup = true, dir = DIST } = {}) {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'ytb-e2e-'));
  const browser = await puppeteer.launch({
    headless,
    enableExtensions: [dir],
    userDataDir,
    defaultViewport: null,
    args: ['--window-size=1280,900', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--lang=en-US'],
  });
  const workerTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
  const worker = await workerTarget.worker();
  const extensionId = new URL(workerTarget.url()).host;
  if (setup) await completeSetup(browser, worker);
  return {
    browser,
    worker,
    extensionId,
    async close() {
      await browser.close().catch(() => undefined);
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** Runs a request against the worker's handlers by dispatching a runtime message from inside the worker. */
export function rpc(worker, type, payload = {}) {
  return worker.evaluate(
    (type, payload) =>
      new Promise((resolve) => {
        // The worker cannot message itself through runtime.sendMessage; call storage/handlers via a global hook.
        const hook = globalThis.__ytbTest;
        if (!hook) return resolve({ error: 'no test hook: this is a release build (npm run build makes the development one)' });
        hook(type, payload).then(resolve, (e) => resolve({ error: String(e) }));
      }),
    type,
    payload,
  );
}

export function storage(worker) {
  return worker.evaluate(() => chrome.storage.local.get(null));
}

/** The welcome tab a fresh installation opens (null if it does not appear within `timeout`). */
export async function welcomePage(browser, timeout = 10000) {
  const target = await browser.waitForTarget((t) => t.type() === 'page' && t.url().endsWith('/welcome.html'), { timeout }).catch(() => null);
  return target ? target.page() : null;
}

/**
 * Finishes the first-run setup the way the welcome page would, and closes the welcome tab: left open it keeps
 * the focus, and YouTube time only counts in a focused tab.
 */
export async function completeSetup(browser, worker) {
  const config = await rpc(worker, 'getConfig'); // any request also waits for the worker's first load
  const builtins = config.categories.filter((c) => c.builtin);
  const res = await rpc(worker, 'completeSetup', {
    config: { ...config, dailyLimitMin: 60, categories: [...TEST_CATEGORIES, ...builtins], shortsCategoryId: 'entertainment' },
  });
  if (!res.ok) throw new Error(`setup failed: ${JSON.stringify(res)}`);
  const page = await welcomePage(browser);
  await page?.close();
}

/**
 * Clicks "Reject all" on YouTube's consent page or in-page consent dialog, if present. The in-page dialog is
 * rendered a moment after the page loads and covers the player, so real mouse clicks land on it until it is
 * gone: pass `waitMs` to keep looking for it that long.
 */
export async function dismissConsent(page, { waitMs = 0 } = {}) {
  const onConsentHost = page.url().includes('consent.');
  const tryClick = () =>
    page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const b = buttons.find((x) => /reject all|alle ablehnen|tout refuser/i.test(x.textContent || ''));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
  const deadline = Date.now() + waitMs;
  let clicked = await tryClick().catch(() => false);
  while (!clicked && Date.now() < deadline) {
    await sleep(500);
    clicked = await tryClick().catch(() => false);
  }
  if (clicked && onConsentHost) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => undefined);
  } else if (clicked) {
    await sleep(1500);
  }
  return clicked;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function videoState(page) {
  return page.evaluate(() => {
    const v = document.querySelector('#movie_player video, ytd-reel-video-renderer[is-active] video, video.html5-main-video');
    if (!v) return null;
    return { paused: v.paused, ended: v.ended, currentTime: v.currentTime, duration: v.duration, readyState: v.readyState, src: !!v.src };
  });
}

export async function promptVisible(page) {
  return page.evaluate(() => !!document.querySelector('[data-yt-budget="prompt"]'));
}
