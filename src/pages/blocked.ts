// Placeholder page shown instead of a blocked YouTube page. Keeps the original link, offers the override.
import { APP_LABEL } from '../shared/brand';
import type { BlockInfo } from '../shared/messages';
import { formatUntil } from '../shared/time';
import { parseYouTubeUrl, thumbnailUrl } from '../shared/url';
import { request } from '../runtime/rpc';
import { brandHeading, formatDate, h, openExtensionPage, render, swatch } from './dom';

export {};

const params = new URLSearchParams(location.search);
const originalUrl = params.get('u') ?? '';
const finished = params.get('f') === '1';

async function load(): Promise<void> {
  // The address comes from the query string, which a page can craft: it must be an http(s) YouTube URL
  // before it is shown as a link or navigated to.
  if (!originalUrl || !parseYouTubeUrl(originalUrl).isYouTube) {
    render(h('div', { class: 'card' }, brandHeading(), h('p', { class: 'muted' }, 'Nothing to show here.')));
    return;
  }
  let info: BlockInfo;
  try {
    info = await request('getBlockInfo', { url: originalUrl });
  } catch (e) {
    render(h('div', { class: 'card' }, h('p', {}, `Could not reach the extension: ${e instanceof Error ? e.message : String(e)}`)));
    return;
  }
  draw(info);
}

function draw(info: BlockInfo): void {
  const now = Date.now();
  const allowed = info.decision.action !== 'block';
  const title = info.title ?? (info.videoId ? 'YouTube video' : 'YouTube page');
  document.title = `${allowed ? 'Available' : 'Blocked'} · ${title} · ${APP_LABEL}`;
  const showFinished = finished && !allowed;

  const openBtn = h(
    'a',
    { class: 'btn primary', href: info.url, 'aria-disabled': allowed ? 'false' : 'true', onClick: (e) => { if (!allowed) e.preventDefault(); } },
    allowed ? 'Open video' : `Available ${formatUntil(info.allowedAt, now)} from now`,
  );
  const copyBtn = h('button', { onClick: () => void navigator.clipboard.writeText(info.url).then(() => (copyBtn.textContent = 'Copied')) }, 'Copy link');
  const closeBtn = h('button', { onClick: () => void closeTab() }, 'Close tab');

  const overrideRow = (() => {
    if (allowed) return null;
    if (info.overrideUntil) {
      return h('p', { class: 'notice warn' }, `Override active until ${formatDate(info.overrideUntil)} — reload the video to continue.`);
    }
    if (info.overridesLeft <= 0) return h('p', { class: 'muted small' }, 'No emergency override left today.');
    const btn = h(
      'button',
      {
        class: 'danger',
        onClick: async () => {
          btn.setAttribute('disabled', '');
          const r = await request('useOverride', { url: info.url });
          if (r.until) location.href = info.url;
          else btn.textContent = 'Override not available';
        },
      },
      `Use emergency override (${info.overrideMinutes} min, ${info.overridesLeft} left today)`,
    );
    return h('div', { class: 'stack' }, btn, h('p', { class: 'muted small' }, 'Overrides are logged in your report. The extra minutes end with a hard cutoff.'));
  })();

  const video = info.videoId
    ? h(
        'div',
        { class: 'video' },
        h('img', { src: thumbnailUrl(info.videoId), alt: '' }),
        h('div', {}, h('div', { class: 'title' }, title), info.channelName ? h('div', { class: 'muted' }, info.channelName) : null, h('div', { class: 'muted small mono' }, info.url)),
      )
    : h('div', { class: 'mono small' }, info.url);

  const links = info.savedLinks.filter((l) => l.url !== info.url);
  const savedCard = h(
    'div',
    { class: 'card' },
    h('h2', {}, `Saved for later (${info.savedLinks.length})`),
    h('p', { class: 'muted small' }, 'Every blocked video lands here automatically so you can watch it another day.'),
    links.length
      ? h(
          'ul',
          { class: 'links' },
          ...links.map((l) =>
            h(
              'li',
              {},
              h('a', { class: 't', href: l.url, title: l.url }, l.title ?? l.url),
              l.category ? h('span', { class: 'small', title: 'Category' }, swatch(l.category.color), l.category.name) : null,
              h('span', { class: 'muted small' }, formatDate(l.savedAt)),
              h('button', { class: 'link', onClick: async () => { await request('removeSavedLink', { url: l.url }); void load(); } }, 'remove'),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'No other saved links.'),
  );

  // The first time someone lands here, say what happened and what their options are.
  const firstTime = info.firstBlock
    ? h(
        'div',
        { class: 'card stack first' },
        h('h2', {}, 'What just happened?'),
        h(
          'ul',
          {},
          h('li', {}, 'YouTube is closed for now. A video you were in the middle of may still be finished; everything else waits until the time shown on this page.'),
          h('li', {}, 'Nothing is lost: the video you wanted is saved for later, on this page and at the top of your YouTube feed.'),
          h('li', {}, 'Raising a limit in Settings takes effect tomorrow. If a few more minutes really matter now, there is one emergency override a day.'),
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'primary', onClick: async () => { await request('ackTip', { tip: 'block' }); void load(); } }, 'Got it'),
          h('button', { class: 'link', onClick: () => openExtensionPage('welcome.html') }, 'How it works'),
        ),
      )
    : null;

  render(
    h(
      'div',
      { class: 'hero' },
      h('img', { class: 'icon', src: 'icons/icon128.png', alt: '' }),
      h('h1', {}, showFinished ? 'You finished your video' : info.reasonText),
      h('p', { class: 'muted' }, showFinished ? `${info.reasonText}. ${info.detailText}` : info.detailText),
    ),
    firstTime,
    showFinished
      ? h('div', { class: 'card stack' }, h('div', { class: 'row' }, closeBtn), overrideRow)
      : h('div', { class: 'card stack' }, video, h('div', { class: 'row' }, openBtn, copyBtn, closeBtn), overrideRow),
    savedCard,
    h('p', { class: 'row small muted' }, h('button', { class: 'link', onClick: () => openExtensionPage('report.html') }, 'Report'), h('button', { class: 'link', onClick: () => openExtensionPage('options.html') }, 'Settings'), h('button', { class: 'link', onClick: () => openExtensionPage('welcome.html') }, 'How it works')),
  );
}

async function closeTab(): Promise<void> {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  } catch {
    window.close();
  }
}

// The page is web-accessible so that a blocked YouTube tab can be sent here, which also lets a YouTube page
// embed it. Inside a frame it stays blank: its buttons must not be clickable on the user's behalf.
if (window.top === window) {
  void load();
  setInterval(() => void load(), 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void load();
  });
} else {
  render();
}
