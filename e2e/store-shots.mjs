// Produces the Chrome Web Store graphics into release/store/: five 1280x800 screenshots and the 440x280 promo
// tile, from the development build with seeded, fictional data. YouTube itself is never loaded: the one page
// that needs a video is a mock answered by the harness, and thumbnail requests get a generated image, so no
// third-party title, thumbnail or logo ends up in the listing. Nothing here is part of the extension.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodePng, pngInfo, withoutAlpha } from '../scripts/lib/png.mjs';
import { DIST, launch, rpc, sleep, welcomePage } from './lib.mjs';

const ROOT = path.join(DIST, '..');
const OUT = path.join(ROOT, 'release', 'store');
const W = 1280;
const H = 800;
const brand = JSON.parse(await readFile(path.join(ROOT, 'src', 'shared', 'brand.json'), 'utf8'));
const iconData = `data:image/png;base64,${(await readFile(path.join(ROOT, 'public', 'icons', 'icon128.png'))).toString('base64')}`;

// ---- fictional sample data --------------------------------------------------------------------------------

const CATEGORIES = [
  { id: 'learning', name: 'Learning', color: '#42a5f5', limitMin: null, graceMin: null, order: 0 },
  { id: 'entertainment', name: 'Entertainment', color: '#ffa726', limitMin: 60, graceMin: null, order: 1 },
  { id: 'music', name: 'Music', color: '#ab47bc', limitMin: null, graceMin: null, order: 2 },
];
const VIDEOS = {
  aaaaaaaaaaa: { title: 'Linear algebra, lecture 4: eigenvectors', channelName: 'Open Lectures', channelId: 'UCopenlectures', categoryId: 'learning' },
  ddddddddddd: { title: 'How a transistor works', channelName: 'Open Lectures', channelId: 'UCopenlectures', categoryId: 'learning' },
  ggggggggggg: { title: 'Typography basics in twenty minutes', channelName: 'Design Notes', channelId: 'UCdesignnotes', categoryId: 'learning' },
  bbbbbbbbbbb: { title: 'Sourdough for beginners', channelName: 'Kitchen Table', channelId: 'UCkitchentable', categoryId: 'entertainment' },
  eeeeeeeeeee: { title: 'Ten trick shots that should not work', channelName: 'Weekend Clips', channelId: 'UCweekendclips', categoryId: 'entertainment' },
  fffffffffff: { title: 'Cycling the coast road', channelName: 'Slow Miles', channelId: 'UCslowmiles', categoryId: 'entertainment' },
  ccccccccccc: { title: 'Two hours of quiet piano', channelName: 'Quiet Hours', channelId: 'UCquiethours', categoryId: 'music' },
};
const MOCK_VIDEO = { id: 'hhhhhhhhhhh', title: 'How a jet engine works', channelName: 'Open Lectures', channelId: 'UCopenlectures' };
/** Seconds per category for the last seven days, oldest first; the last entry is today. */
const WEEK = [
  { learning: 2400, entertainment: 3300, music: 900, browsing: 300 },
  { learning: 3000, entertainment: 2100, music: 0, browsing: 420 },
  { learning: 1500, entertainment: 3600, music: 1800, browsing: 240, hit: 'entertainment' },
  { learning: 3300, entertainment: 1200, music: 600, browsing: 180 },
  { learning: 2700, entertainment: 3000, music: 1200, browsing: 360, override: true },
  { learning: 3600, entertainment: 1800, music: 300, browsing: 200 },
  { learning: 1500, entertainment: 1320, music: 600, browsing: 180 },
];

function dayKey(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seed() {
  const items = {};
  const at = Date.now();
  const byCategory = (cat) => Object.entries(VIDEOS).filter(([, v]) => v.categoryId === cat).map(([id]) => id);
  WEEK.forEach((day, i) => {
    const key = dayKey(WEEK.length - 1 - i);
    const videos = {};
    for (const cat of ['learning', 'entertainment', 'music']) {
      const ids = byCategory(cat);
      ids.forEach((id, n) => {
        // the first video of a category gets the larger share
        const sec = Math.round(day[cat] * (ids.length === 1 ? 1 : n === 0 ? 0.6 : 0.4 / (ids.length - 1)));
        if (sec > 0) videos[id] = { categoryId: cat, sec, firstAt: at, lastAt: at };
      });
    }
    const events = [];
    if (day.hit) events.push({ at, type: 'categoryLimit', categoryId: day.hit });
    if (day.override) events.push({ at, type: 'override', minutes: 15 });
    items[`day:${key}`] = {
      date: key,
      videos,
      browsingSec: day.browsing,
      limits: { dailySec: 7200, category: { learning: null, entertainment: 3600, music: null, browsing: null }, windows: [] },
      overrides: day.override ? [{ at, minutes: 15 }] : [],
      events,
    };
  });
  items.videoIndex = Object.fromEntries(Object.entries(VIDEOS).map(([id, v]) => [id, { ...v, at }]));
  const saved = ['eeeeeeeeeee', 'ggggggggggg', 'fffffffffff'];
  items.state = {
    dayKey: dayKey(0),
    lastCountedAt: 0,
    dailyBlock: null,
    categoryBlocks: {},
    override: null,
    warned: { daily: false, category: {}, schedule: {} },
    savedLinks: saved.map((id, n) => ({ url: `https://www.youtube.com/watch?v=${id}`, videoId: id, title: VIDEOS[id].title, savedAt: at - (n + 1) * 5400_000, reason: n === 1 ? 'category' : 'daily' })),
    finishedVideos: [],
  };
  return items;
}

// ---- harness ----------------------------------------------------------------------------------------------

/** A flat two-tone picture standing in for a video thumbnail, coloured by the video id. */
function thumbnail(id) {
  const w = 320;
  const h = 180;
  const hue = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  const palette = [[38, 70, 110], [96, 56, 104], [36, 92, 84], [110, 72, 40], [70, 80, 96], [104, 48, 60]][hue];
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = 0.75 + 0.5 * ((x + y) / (w + h));
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, Math.round(palette[c] * k));
    }
  }
  return encodePng(w, h, px, 3);
}

const MOCK_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${MOCK_VIDEO.title}</title><style>
  body { margin: 0; background: #20242c; color: #f1f3f4; font: 14px system-ui, "Segoe UI", sans-serif; }
  header { height: 56px; display: flex; align-items: center; gap: 24px; padding: 0 24px; border-bottom: 1px solid #3a404c; }
  header .mark { width: 96px; height: 20px; border-radius: 6px; background: #596273; }
  header .search { flex: 0 1 520px; height: 36px; border-radius: 18px; background: #2c323d; border: 1px solid #596273; margin: 0 auto; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; padding: 24px; }
  #movie_player { position: relative; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: linear-gradient(135deg, #4a78b8, #9a5fb0); }
  #movie_player video { width: 100%; height: 100%; display: block; }
  h1 { font-size: 20px; margin: 16px 0 6px; }
  .by { color: #c3cad4; }
  aside div { height: 94px; border-radius: 10px; background: #4a5263; margin-bottom: 12px; }
</style></head><body>
  <header><div class="mark"></div><div class="search"></div></header>
  <main>
    <div>
      <div id="movie_player" class="html5-video-player"><video class="html5-main-video" muted></video></div>
      <h1>${MOCK_VIDEO.title}</h1>
      <div class="by">${MOCK_VIDEO.channelName}</div>
    </div>
    <aside><div></div><div></div><div></div><div></div><div></div><div></div></aside>
  </main>
  <script>
    const player = document.getElementById('movie_player');
    player.getVideoData = () => ({ video_id: '${MOCK_VIDEO.id}', author: '${MOCK_VIDEO.channelName}', title: '${MOCK_VIDEO.title}' });
    player.getPlayerResponse = () => ({ videoDetails: { videoId: '${MOCK_VIDEO.id}', channelId: '${MOCK_VIDEO.channelId}', author: '${MOCK_VIDEO.channelName}', title: '${MOCK_VIDEO.title}', lengthSeconds: '1260' } });
    player.pauseVideo = () => {};
    player.playVideo = () => {};
  </script>
</body></html>`;

/** Answers YouTube and thumbnail requests from the harness; everything else (the extension's own files) passes. */
async function intercept(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.hostname === 'i.ytimg.com') {
      const id = url.pathname.split('/')[2] ?? 'x';
      void req.respond({ status: 200, contentType: 'image/png', body: thumbnail(id) });
    } else if (url.hostname.endsWith('youtube.com')) {
      if (req.resourceType() === 'document') void req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: MOCK_PAGE });
      else void req.respond({ status: 204, body: '' });
    } else {
      void req.continue();
    }
  });
}

const errors = [];
async function save(name, png, width = W, height = H) {
  const out = withoutAlpha(Buffer.from(png));
  const info = pngInfo(out);
  if (!info || info.width !== width || info.height !== height || info.colorType !== 2) {
    errors.push(`${name}: expected ${width}x${height} RGB, got ${JSON.stringify(info)}`);
  }
  await writeFile(path.join(OUT, name), out);
  console.log(`  ${name}  ${info?.width}x${info?.height}`);
}

/** Opens an extension page at the screenshot size and returns it once it has rendered. */
async function open(browser, extensionId, file) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`[${file}] ${e.message}`));
  await intercept(page);
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(`chrome-extension://${extensionId}/${file}`, { waitUntil: 'networkidle0' });
  await sleep(500);
  return page;
}

/** A plain 1280x800 (or tile-sized) canvas of our own, rendered from the given HTML. */
async function stage(browser, html, width = W, height = H) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await sleep(200);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  return png;
}

const STAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f172a; color: #f1f5f9; font-family: system-ui, "Segoe UI", sans-serif; overflow: hidden; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand img { width: 64px; height: 64px; }
  .brand b { font-size: 26px; }
  .brand small { font-size: 15px; color: #94a3b8; font-weight: 500; margin-left: 6px; }
`;

await mkdir(OUT, { recursive: true });
const { browser, worker, extensionId, close } = await launch({ headless: true, setup: false });
try {
  await rpc(worker, 'getBuild');
  await (await welcomePage(browser))?.close();

  console.log('store graphics → release/store/');

  // 5: the welcome page of a fresh installation
  {
    const page = await open(browser, extensionId, 'welcome.html');
    await save('5-welcome.png', await page.screenshot({ type: 'png' }));
    await page.close();
  }

  // Setup done, sample data in place, tips already seen.
  const config = await rpc(worker, 'getConfig');
  const builtins = config.categories.filter((c) => c.builtin);
  const setup = await rpc(worker, 'completeSetup', { config: { ...config, dailyLimitMin: 120, categories: [...CATEGORIES, ...builtins], shortsCategoryId: 'entertainment' } });
  if (!setup.ok) throw new Error(`setup failed: ${JSON.stringify(setup)}`);
  await worker.evaluate(
    (items) => chrome.storage.local.get('meta').then(({ meta }) => chrome.storage.local.set({ ...items, meta: { ...meta, tipsSeen: ['prompt', 'pill', 'block'] } })),
    seed(),
  );
  await rpc(worker, '_reloadForTest');

  // 1: the category question, over a mock video page
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`[mock video] ${e.message}`));
    await intercept(page);
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.goto(`https://www.youtube.com/watch?v=${MOCK_VIDEO.id}`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForSelector('[data-yt-budget="prompt"]', { timeout: 15000 });
    await sleep(1500); // the bridge has reported title and channel by now
    await save('1-prompt.png', await page.screenshot({ type: 'png' }));
    await page.close();
  }

  // 2: the popup, on a stage of our own (it is only 340 px wide)
  {
    const page = await browser.newPage();
    await intercept(page);
    await page.setViewport({ width: 364, height: 700, deviceScaleFactor: 2 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(500);
    const popup = await (await page.$('body')).screenshot({ type: 'png' });
    await page.close();
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${STAGE_CSS}
      .wrap { height: 100vh; display: grid; grid-template-columns: 1fr 420px; align-items: center; gap: 40px; padding: 0 96px; }
      h1 { font-size: 46px; line-height: 1.12; margin: 44px 0 20px; letter-spacing: -0.5px; }
      p { font-size: 21px; line-height: 1.5; color: #cbd5e1; margin: 0 0 12px; max-width: 520px; }
      .shot { width: 364px; border-radius: 14px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55); border: 1px solid #334155; display: block; margin: 0 auto; }
    </style></head><body><div class="wrap">
      <div>
        <div class="brand"><img src="${iconData}" alt=""><div><b>${brand.label}</b><small>${brand.suffix}</small></div></div>
        <h1>Your YouTube time, on a budget</h1>
        <p>A daily limit, limits per category, and the minutes left always in view.</p>
        <p>Everything stays on your device.</p>
      </div>
      <img class="shot" src="data:image/png;base64,${Buffer.from(popup).toString('base64')}" alt="">
    </div></body></html>`;
    await save('2-popup.png', await stage(browser, html));
  }

  // 3: the report
  {
    const page = await open(browser, extensionId, 'report.html');
    await save('3-report.png', await page.screenshot({ type: 'png' }));
    await page.close();
  }

  // 4: the daily limit reached
  {
    // The day's budget is used up, and the video the user tried to open is on the saved list.
    await worker.evaluate(async (today) => {
      const stored = await chrome.storage.local.get(['state', today]);
      const day = stored[today];
      day.videos.aaaaaaaaaaa.sec += 1800;
      day.videos.bbbbbbbbbbb.sec += 1800;
      day.events.push({ at: Date.now(), type: 'dailyLimit' });
      const blocked = { url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', videoId: 'bbbbbbbbbbb', title: 'Sourdough for beginners', savedAt: Date.now(), reason: 'daily' };
      await chrome.storage.local.set({
        [today]: day,
        state: { ...stored.state, dailyBlock: { since: Date.now(), grandfathers: [] }, savedLinks: [blocked, ...stored.state.savedLinks] },
      });
    }, `day:${dayKey(0)}`);
    await rpc(worker, '_reloadForTest');
    const page = await open(browser, extensionId, `blocked.html?u=${encodeURIComponent('https://www.youtube.com/watch?v=bbbbbbbbbbb')}&r=daily`);
    await save('4-blocked.png', await page.screenshot({ type: 'png' }));
    await page.close();
  }

  // The small promo tile: the mark and the name, nothing else.
  {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${STAGE_CSS}
      .tile { width: 440px; height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: radial-gradient(circle at 50% 38%, #1e293b, #0f172a 70%); }
      .tile img { width: 132px; height: 132px; }
      .tile b { font-size: 30px; letter-spacing: -0.3px; }
      .tile small { font-size: 15px; color: #94a3b8; }
    </style></head><body><div class="tile"><img src="${iconData}" alt=""><b>${brand.label}</b><small>${brand.suffix}</small></div></body></html>`;
    await save('promo-440x280.png', await stage(browser, html, 440, 280), 440, 280);
  }

  await writeFile(path.join(OUT, 'icon128.png'), await readFile(path.join(ROOT, 'public', 'icons', 'icon128.png')));
  console.log('  icon128.png  128x128');

  if (errors.length) {
    console.error('ERRORS:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await close();
}
