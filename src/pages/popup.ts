// Toolbar popup: today's total and per-category budgets at a glance; re-categorize the current video;
// the newest saved-for-later videos.
import type { PromptInfo, StatusSnapshot } from '../shared/messages';
import type { SavedLinkView } from '../shared/saved';
import { formatDuration, formatUntil } from '../shared/time';
import { isVideoPage, parseYouTubeUrl } from '../shared/url';
import { request } from '../runtime/rpc';
import { bar, brandHeading, h, openExtensionPage, render, staleWorkerBanner, swatch } from './dom';
import { feedbackCard } from './feedback';

export {};

const POPUP_SAVED_ITEMS = 5;

interface CurrentVideo {
  tabId: number;
  url: string;
  videoId: string;
  info: PromptInfo;
}

/** The video open in the active tab, if any (for the re-categorize row). */
async function currentVideo(): Promise<CurrentVideo | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !tab.url) return null;
    const parsed = parseYouTubeUrl(tab.url);
    if (!isVideoPage(parsed) || !parsed.videoId) return null;
    const info = await request('promptInfo', { videoId: parsed.videoId });
    return { tabId: tab.id, url: tab.url, videoId: parsed.videoId, info };
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  let s: StatusSnapshot;
  try {
    s = await request('getStatus', {});
  } catch (e) {
    render(h('p', {}, `Could not reach the extension: ${e instanceof Error ? e.message : String(e)}`));
    return;
  }
  if (!s.setupDone) {
    drawSetupPending();
    return;
  }
  const [banner, cv, saved, feedback] = await Promise.all([
    staleWorkerBanner(),
    currentVideo(),
    s.savedLinks > 0 ? request('getSavedLinks', { limit: POPUP_SAVED_ITEMS }).catch(() => []) : Promise.resolve([]),
    feedbackCard(() => void load()),
  ]);
  draw(s, banner, cv, saved, feedback);
}

/** A new installation records nothing until the welcome page's "Start" has been pressed. */
function drawSetupPending(): void {
  render(
    brandHeading(),
    h(
      'div',
      { class: 'card stack' },
      h('b', {}, 'One step left'),
      h('p', { class: 'muted' }, 'Nothing is recorded or limited yet. Finish the short setup to start your time budget.'),
      h('button', { class: 'primary', onClick: () => openExtensionPage('welcome.html') }, 'Finish setup'),
    ),
  );
}

function statusBanner(s: StatusSnapshot): HTMLElement | null {
  if (s.overrideUntil) {
    return h('div', { class: 'notice warn' }, `Emergency override active — ends in ${formatUntil(s.overrideUntil, s.now)}.`);
  }
  if (s.scheduleBlockedUntil) {
    const at = new Date(s.scheduleBlockedUntil).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return h('div', { class: 'notice danger' }, `Blocked hours — YouTube is closed until ${at}.`);
  }
  if (s.dailyBlocked) {
    const g = s.grandfathered.length;
    return h(
      'div',
      { class: 'notice danger' },
      g ? 'Daily limit reached — finish your current video, then YouTube is done for today.' : 'Daily limit reached — YouTube is blocked until tomorrow.',
    );
  }
  return null;
}

function currentVideoCard(cv: CurrentVideo | null): HTMLElement | null {
  if (!cv) return null;
  const sel = h('select', {}) as HTMLSelectElement;
  const none = h('option', { value: '' }, '— pick —') as HTMLOptionElement;
  if (!cv.info.currentCategoryId) none.selected = true;
  sel.append(none);
  for (const c of cv.info.categories) {
    const o = h('option', { value: c.id }, c.name) as HTMLOptionElement;
    if (cv.info.currentCategoryId === c.id) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    void (async () => {
      await request('categorize', { videoId: cv.videoId, categoryId: sel.value, url: cv.url, tabId: cv.tabId });
      void load();
    })();
  });
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'muted small' }, 'Current video'),
    h('div', { class: 'row between' }, h('span', { class: 't', title: cv.info.title ?? cv.videoId }, (cv.info.title ?? cv.videoId).slice(0, 42)), sel),
  );
}

/** The newest saved-for-later videos with their category; "See all" opens the full list in Settings. */
function savedCard(s: StatusSnapshot, saved: SavedLinkView[]): HTMLElement | null {
  if (s.savedLinks === 0) return null;
  const rows = saved.map((l) =>
    h(
      'li',
      {},
      h('a', { class: 't', href: l.url, target: '_blank', title: l.title ?? l.url }, l.title ?? l.url),
      h(
        'div',
        { class: 'row small muted' },
        l.category ? h('span', { class: 'chip' }, swatch(l.category.color), l.category.name) : h('span', {}, 'no category yet'),
        l.channelName ? h('span', {}, l.channelName) : null,
        l.available === false ? h('span', { class: 'badge warn' }, 'blocked today') : null,
      ),
    ),
  );
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'row between' },
      h('span', { class: 'muted small' }, `Saved for later (${s.savedLinks})`),
      h('button', { class: 'link', onClick: () => openExtensionPage('options.html#saved') }, 'See all'),
    ),
    h('ul', { class: 'links' }, ...rows),
  );
}

/** A limit that was raised in Settings today: the raise only takes effect tomorrow (undefined = nothing pending). */
function tomorrow(limitSec: number | null | undefined): HTMLElement | null {
  if (limitSec === undefined) return null;
  return h('div', { class: 'muted small tomorrow' }, limitSec === null ? '→ no limit from tomorrow' : `→ ${formatDuration(limitSec)} from tomorrow`);
}

function draw(s: StatusSnapshot, banner: HTMLElement | null = null, cv: CurrentVideo | null = null, saved: SavedLinkView[] = [], feedback: HTMLElement | null = null): void {
  const remaining = s.remainingSec;
  const totalLine =
    s.dailyLimitSec === null
      ? h('div', {}, h('span', { class: 'total' }, formatDuration(s.totalSec)), ' ', h('span', { class: 'muted' }, 'today (no daily limit)'))
      : h(
          'div',
          {},
          h('span', { class: 'total' }, formatDuration(s.totalSec)),
          ' ',
          h('span', { class: 'muted' }, `of ${formatDuration(s.dailyLimitSec)} · ${remaining !== null ? formatDuration(remaining) + ' left' : ''}`),
        );

  const cats = s.categories
    .filter((c) => c.categoryId !== 'uncategorized' || c.sec > 0)
    .map((c) =>
      h(
        'div',
        { class: 'cat' },
        h('div', { class: 'name' }, swatch(c.color), c.name, c.blocked ? h('span', { class: 'badge warn' }, 'blocked') : null),
        h('div', { class: 'muted small' }, c.limitSec === null ? formatDuration(c.sec) : `${formatDuration(c.sec)} / ${formatDuration(c.limitSec)}`),
        bar(c.sec, c.limitSec, c.color),
        tomorrow(c.deferredLimitSec),
      ),
    );

  render(
    banner,
    h('div', { class: 'row between' }, brandHeading(), h('span', { class: 'muted small' }, s.dayKey)),
    statusBanner(s),
    feedback,
    h('div', { class: 'card' }, totalLine, bar(s.totalSec, s.dailyLimitSec), tomorrow(s.deferredDailyLimitSec)),
    currentVideoCard(cv),
    h('div', { class: 'card' }, ...cats),
    savedCard(s, saved),
    h(
      'div',
      { class: 'footer' },
      h('button', { class: 'btn', onClick: () => openExtensionPage('report.html') }, 'Report'),
      h('button', { class: 'btn', onClick: () => openExtensionPage('options.html') }, 'Settings'),
      h('button', { class: 'btn', onClick: () => openExtensionPage('welcome.html') }, 'Help'),
    ),
  );
}

void load();
