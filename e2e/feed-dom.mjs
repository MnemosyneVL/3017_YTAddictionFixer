// Ad-hoc: dumps what YouTube renders around the feed grid (home, subscriptions) so the saved-for-later shelf's
// anchors can be re-verified when YouTube changes its markup, and checks what a click on an anchor inside a
// shadow root does (SPA navigation vs. document load) and whether cached pages get `hidden`.
// The extension itself is NOT loaded (pure DOM spike; a signed-in profile's budget stays untouched).
// usage: node e2e/feed-dom.mjs [--profile <userDataDir>] [--headful]
//   --profile  use an existing (signed-in) profile, e.g. .yt-budget-profile while stop.bat has closed that browser;
//              a fresh logged-out profile shows an empty home feed.
import puppeteer from 'puppeteer';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dismissConsent, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const profileArg = args.indexOf('--profile');
const profile = profileArg >= 0 ? path.resolve(args[profileArg + 1]) : null;
const userDataDir = profile ?? mkdtempSync(path.join(os.tmpdir(), 'ytb-spike-'));
const browser = await puppeteer.launch({
  headless: !args.includes('--headful'),
  userDataDir,
  defaultViewport: null,
  args: ['--window-size=1280,900', '--mute-audio', '--lang=en-US'],
});

function dump() {
  const attrs = (el) => (el ? Object.fromEntries([...el.attributes].map((a) => [a.name, a.value.slice(0, 60)])) : null);
  const cs = (el, props) => (el ? Object.fromEntries(props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])) : null);
  const browse = document.querySelector('ytd-page-manager > ytd-browse:not([hidden])');
  const grid = browse?.querySelector('ytd-rich-grid-renderer');
  const contents = grid?.querySelector(':scope > #contents');
  const item = contents?.querySelector('ytd-rich-item-renderer');
  const section = contents?.querySelector('ytd-rich-section-renderer');
  const shelfTitle = document.querySelector('ytd-rich-shelf-renderer #title, ytd-rich-shelf-renderer h2, ytd-shelf-renderer #title');
  const itemTitle = item?.querySelector('h3, #video-title');
  const fontProps = ['font-size', 'line-height', 'font-weight', 'font-family', 'color'];
  return {
    url: location.href,
    dark: document.documentElement.hasAttribute('dark'),
    browse: attrs(browse),
    allBrowse: [...document.querySelectorAll('ytd-page-manager > ytd-browse, ytd-page-manager > ytd-watch-flexy')].map((b) => ({ tag: b.tagName.toLowerCase(), ...attrs(b) })),
    gridChildren: grid ? [...grid.children].map((c) => c.tagName.toLowerCase() + (c.id ? '#' + c.id : '')) : null,
    contents: cs(contents, ['display', 'flex-wrap', 'padding', 'gap', 'grid-template-columns', 'width']),
    gridVars: cs(grid, ['--ytd-rich-grid-items-per-row', '--ytd-rich-grid-item-margin', '--ytd-rich-grid-row-margin', '--ytd-rich-grid-item-max-width', '--ytd-rich-grid-item-min-width', '--ytd-rich-grid-content-offset-top', 'width']),
    firstChildren: contents
      ? [...contents.children].slice(0, 10).map((k) => ({ tag: k.tagName.toLowerCase(), attrs: attrs(k), width: Math.round(k.getBoundingClientRect().width), display: getComputedStyle(k).display, margin: getComputedStyle(k).margin }))
      : null,
    item: cs(item, ['width', 'margin', 'display', 'box-sizing']),
    section: cs(section, ['width', 'margin', 'display']),
    shelfTitle: shelfTitle ? { text: shelfTitle.textContent.trim().slice(0, 40), ...cs(shelfTitle, fontProps) } : null,
    itemTitle: itemTitle ? cs(itemTitle, fontProps) : null,
    body: cs(document.body, ['font-size', 'font-family', 'background-color', 'color']),
  };
}

let docRequests = 0;
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('request', (r) => { if (r.isNavigationRequest() && r.resourceType() === 'document' && r.frame() === page.mainFrame()) docRequests++; });

async function open(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await dismissConsent(page);
  await sleep(2000);
  await dismissConsent(page);
  await sleep(4000);
}

try {
  for (const url of ['https://www.youtube.com/', 'https://www.youtube.com/feed/subscriptions']) {
    await open(url);
    console.log(`\n=== ${url}\n${JSON.stringify(await page.evaluate(dump), null, 1)}`);
  }

  console.log('\n=== click on an anchor inside a shadow root prepended to #contents');
  await open('https://www.youtube.com/');
  const injected = await page.evaluate(() => {
    const contents = document.querySelector('ytd-page-manager > ytd-browse:not([hidden]) ytd-rich-grid-renderer > #contents');
    if (!contents) return false;
    window.__spikeNav = [];
    for (const ev of ['yt-navigate-start', 'yt-navigate-finish']) window.addEventListener(ev, () => window.__spikeNav.push(`${ev}@${location.pathname}`));
    const host = document.createElement('div');
    host.id = 'spike-host';
    host.style.cssText = 'display:block;width:100%;flex:0 0 100%;grid-column:1/-1';
    const a = document.createElement('a');
    a.id = 'spike-link';
    a.href = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
    a.textContent = 'spike link';
    a.style.cssText = 'display:block;padding:20px;font-size:20px;color:red';
    host.attachShadow({ mode: 'open' }).append(a);
    contents.prepend(host);
    return true;
  });
  console.log('injected:', injected, 'host width:', await page.evaluate(() => document.getElementById('spike-host')?.getBoundingClientRect().width));
  if (injected) {
    docRequests = 0;
    const link = await page.evaluateHandle(() => document.getElementById('spike-host').shadowRoot.getElementById('spike-link'));
    await link.click();
    await sleep(5000);
    const spa = await page.evaluate(() => window.__spikeNav ?? null);
    console.log(JSON.stringify({ url: page.url(), documentRequests: docRequests, spaEvents: spa, browseAfter: (await page.evaluate(dump)).allBrowse }, null, 1));
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await sleep(4000);
    console.log('after back:', JSON.stringify({ url: page.url(), allBrowse: (await page.evaluate(dump)).allBrowse, stillInjected: await page.evaluate(() => !!document.getElementById('spike-host')) }, null, 1));
  }
} finally {
  await browser.close().catch(() => undefined);
  if (!profile) rmSync(userDataDir, { recursive: true, force: true });
}
