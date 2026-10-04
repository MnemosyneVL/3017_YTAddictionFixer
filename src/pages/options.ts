// Settings page: limits, counting, categories, Shorts, channel rules, saved links, data.
import { APP_NAME, AUTHOR, FILE_STEM, link, type LinkKey } from '../shared/brand';
import { CATEGORY_COLORS, newCategoryId } from '../shared/config';
import { formatWindowTime } from '../shared/schedule';
import type { BlockedWindow, Category, Config } from '../shared/types';
import { request } from '../runtime/rpc';
import { brandHeading, clear, formatDate, h, openExtensionPage, render, staleWorkerBanner, swatch } from './dom';
import { feedbackCard, supportButtons, supportNote } from './feedback';

export {};

let config: Config;
let dirty = false;
let notice: HTMLElement | null = null;
/** Result of an import, shown in the Data card after the page is redrawn with the imported data. */
let importNotice: string | null = null;
/** False on a new installation until the welcome page's "Start" was pressed. */
let setupDone = true;

async function load(): Promise<void> {
  const [cfg, onboarding] = await Promise.all([request('getConfig', {}), request('getOnboarding', {})]);
  config = cfg;
  setupDone = onboarding.setupDone;
  dirty = false;
  await draw();
  if (location.hash === '#saved') document.getElementById('saved-section')?.scrollIntoView();
}

function markDirty(): void {
  dirty = true;
  updateSaveBar();
}

function limitInput(value: number | null, onChange: (v: number | null) => void): HTMLElement {
  const wrap = h('label', { class: 'row' });
  const box = h('input', { type: 'number', min: '0', step: '5' }) as HTMLInputElement;
  const unlimited = h('input', { type: 'checkbox' }) as HTMLInputElement;
  box.value = value === null ? '' : String(value);
  box.disabled = value === null;
  unlimited.checked = value === null;
  box.addEventListener('input', () => onChange(box.value === '' ? 0 : Math.max(0, Number(box.value))));
  unlimited.addEventListener('change', () => {
    box.disabled = unlimited.checked;
    if (unlimited.checked) onChange(null);
    else onChange(box.value === '' ? 0 : Number(box.value));
  });
  wrap.append(box, h('span', { class: 'muted small' }, 'min'), h('label', { class: 'row small' }, unlimited, 'unlimited'));
  return wrap;
}

function generalCard(): HTMLElement {
  const grid = h('div', { class: 'grid' });
  const add = (label: string, control: HTMLElement, hint?: string): void => {
    grid.append(h('div', { class: 'k' }, label), h('div', {}, control, hint ? h('div', { class: 'hint' }, hint) : null));
  };

  add('Daily limit', limitInput(config.dailyLimitMin, (v) => { config.dailyLimitMin = v; markDirty(); }), 'Total YouTube time per day. Raising it takes effect tomorrow.');

  const dayStart = h('input', { type: 'time' }) as HTMLInputElement;
  dayStart.value = `${String(Math.floor(config.dayStartMinutes / 60)).padStart(2, '0')}:${String(config.dayStartMinutes % 60).padStart(2, '0')}`;
  dayStart.addEventListener('change', () => {
    const [hh, mm] = dayStart.value.split(':').map(Number);
    config.dayStartMinutes = (hh || 0) * 60 + (mm || 0);
    markDirty();
  });
  add('Day starts at', dayStart, 'When your day resets. Set it to your usual wake time so late-night viewing counts to the right day.');

  const warn = h('input', { type: 'number', min: '0', step: '1' }) as HTMLInputElement;
  warn.value = String(config.warnBeforeMin);
  warn.addEventListener('input', () => { config.warnBeforeMin = Math.max(0, Number(warn.value)); markDirty(); });
  add('Warn before a limit', h('label', { class: 'row' }, warn, h('span', { class: 'muted small' }, 'min')), '0 to disable warnings.');

  const mode = h('select', {}) as HTMLSelectElement;
  for (const [v, label] of [
    ['visibleOrPlaying', 'Visible or playing (recommended)'],
    ['visibleOnly', 'Only while the tab is visible'],
    ['playingOnly', 'Only while a video is playing'],
  ] as const) {
    const o = h('option', { value: v }, label) as HTMLOptionElement;
    if (config.countingMode === v) o.selected = true;
    mode.append(o);
  }
  const MODE_HINTS: Record<Config['countingMode'], string> = {
    visibleOrPlaying: 'A playing video always counts, even in a background tab or a covered window. A paused video counts while its tab is visible, the window is focused and you are active.',
    visibleOnly: 'Nothing counts in a hidden tab, not even a playing video. A visible video counts while it plays or while you are active on the page.',
    playingOnly: 'A video counts only while it is actually playing; a paused video is free.',
  };
  const COMMON_HINT = 'Feeds, search and channel pages have nothing to play: in every mode they count as Browsing while they are visible and you are active on them. A minimized window or a locked screen never counts.';
  const modeHint = h('div', { class: 'hint' });
  const refreshModeHint = (): void => { modeHint.textContent = `${MODE_HINTS[config.countingMode]} ${COMMON_HINT}`; };
  refreshModeHint();
  mode.addEventListener('change', () => { config.countingMode = mode.value as Config['countingMode']; refreshModeHint(); markDirty(); });
  grid.append(h('div', { class: 'k' }, 'Count time when'), h('div', {}, mode, modeHint));

  const idle = h('input', { type: 'number', min: '15', step: '5' }) as HTMLInputElement;
  idle.value = String(config.idleAfterSec);
  idle.addEventListener('input', () => { config.idleAfterSec = Math.max(15, Number(idle.value)); markDirty(); });
  add('Idle after', h('label', { class: 'row' }, idle, h('span', { class: 'muted small' }, 'sec')), 'Non-playing time stops counting after this long without input.');

  const overlayOn = h('input', { type: 'checkbox' }) as HTMLInputElement;
  overlayOn.checked = config.showOverlayTimer;
  const corner = h('select', {}) as HTMLSelectElement;
  for (const [v, label] of [['tr', 'Top right'], ['tl', 'Top left'], ['br', 'Bottom right'], ['bl', 'Bottom left']] as const) {
    const o = h('option', { value: v }, label) as HTMLOptionElement;
    if (config.overlayCorner === v) o.selected = true;
    corner.append(o);
  }
  corner.disabled = !config.showOverlayTimer;
  overlayOn.addEventListener('change', () => { config.showOverlayTimer = overlayOn.checked; corner.disabled = !overlayOn.checked; markDirty(); });
  corner.addEventListener('change', () => { config.overlayCorner = corner.value as Config['overlayCorner']; markDirty(); });
  add('Timer on the video', h('div', { class: 'row' }, h('label', { class: 'row' }, overlayOn, 'show'), corner), 'A small pill on the player with today’s remaining time and the video’s category.');

  const shelfOn = h('input', { type: 'checkbox' }) as HTMLInputElement;
  shelfOn.checked = config.showSavedShelf;
  shelfOn.addEventListener('change', () => { config.showSavedShelf = shelfOn.checked; markDirty(); });
  add('Saved-for-later shelf', h('label', { class: 'row' }, shelfOn, 'show on the home and subscriptions feeds'), 'Your newest saved videos at the top of the feed, with their category. Videos you cannot watch today are marked.');

  add(
    'Emergency override',
    h('span', {}, `${config.overrideMinutes} minutes, ${config.overridesPerDay === 1 ? 'once' : `${config.overridesPerDay} times`} a day`),
    'Offered on the page you see when YouTube is closed. It lifts the limits and blocked hours for those minutes, ends with a hard stop, and every use is listed in your statistics.',
  );

  return h('div', { class: 'card' }, h('h2', {}, 'General'), grid);
}

function categoriesCard(): HTMLElement {
  const table = h('table');
  const body = h('tbody');
  function redraw(): void {
    clear(body);
    const rows = config.categories.filter((c) => c.builtin !== 'uncategorized').sort((a, b) => a.order - b.order);
    for (const cat of rows) body.append(categoryRow(cat, redraw));
  }
  redraw();
  table.append(
    h('thead', {}, h('tr', {}, h('th', {}, 'Color'), h('th', {}, 'Name'), h('th', {}, 'Daily limit'), h('th', { title: 'Once a limit is reached, how long the current video of this category may keep playing.' }, 'After limit'), h('th', {}, ''))),
    body,
  );
  const addBtn = h('button', {
    onClick: () => {
      const id = newCategoryId('New category', config.categories);
      const order = Math.max(0, ...config.categories.filter((c) => !c.builtin).map((c) => c.order)) + 1;
      config.categories.push({ id, name: 'New category', color: CATEGORY_COLORS[config.categories.length % CATEGORY_COLORS.length]!, limitMin: null, graceMin: null, order });
      markDirty();
      redraw();
    },
  }, '+ Add category');
  return h('div', { class: 'card' }, h('h2', {}, 'Categories'), h(
      'p',
      { class: 'hint' },
      'Every new video is filed under one of these, with the question shown on the video. “unlimited” means the category has no limit of its own; it is still covered by the daily limit. “After limit” says how long the video you are watching may go on once a limit is reached: to its end, for a number of minutes, or 0 to stop at once. Archive hides a category from the question and keeps its history; delete removes it. “Browsing” is the time on feeds, search and channel pages.',
    ), table, h('div', { class: 'toolbar' }, addBtn));
}

/** Number-of-minutes input with an "until video ends" checkbox (null = until the end). */
function graceInput(value: number | null, onChange: (v: number | null) => void): HTMLElement {
  const wrap = h('label', { class: 'row' });
  const box = h('input', { type: 'number', min: '0', step: '5', title: '0 = stop immediately' }) as HTMLInputElement;
  const untilEnd = h('input', { type: 'checkbox' }) as HTMLInputElement;
  box.value = value === null ? '' : String(value);
  box.disabled = value === null;
  untilEnd.checked = value === null;
  box.addEventListener('input', () => onChange(box.value === '' ? 0 : Math.max(0, Number(box.value))));
  untilEnd.addEventListener('change', () => {
    box.disabled = untilEnd.checked;
    onChange(untilEnd.checked ? null : box.value === '' ? 0 : Number(box.value));
  });
  wrap.append(box, h('span', { class: 'muted small' }, 'min'), h('label', { class: 'row small' }, untilEnd, 'until video ends'));
  return wrap;
}

function categoryRow(cat: Category, redraw: () => void): HTMLElement {
  const color = h('input', { type: 'color', value: cat.color }) as HTMLInputElement;
  color.addEventListener('input', () => { cat.color = color.value; markDirty(); });
  const name = h('input', { type: 'text', value: cat.name }) as HTMLInputElement;
  name.disabled = !!cat.builtin;
  name.addEventListener('input', () => { cat.name = name.value; markDirty(); });

  const limit = limitInput(cat.limitMin, (v) => { cat.limitMin = v; markDirty(); });

  const actions = h('div', { class: 'row' });
  if (!cat.builtin) {
    const archive = h('button', { class: 'link', onClick: () => { cat.archived = !cat.archived; markDirty(); redraw(); } }, cat.archived ? 'unarchive' : 'archive');
    const del = h('button', {
      class: 'link',
      onClick: () => {
        if (!confirm(`Delete “${cat.name}”? Past time stays in your statistics but the category is removed.`)) return;
        config.categories = config.categories.filter((c) => c.id !== cat.id);
        if (config.shortsCategoryId === cat.id) config.shortsCategoryId = config.categories.find((c) => !c.builtin && !c.archived)?.id ?? 'browsing';
        for (const [k, r] of Object.entries(config.channelRules)) if (r.categoryId === cat.id) delete config.channelRules[k];
        markDirty();
        redraw();
      },
    }, 'delete');
    actions.append(archive, del);
  }
  const grace = cat.builtin === 'browsing' ? h('span', { class: 'muted small' }, '—') : graceInput(cat.graceMin, (v) => { cat.graceMin = v; markDirty(); });
  const row = h('tr', {}, h('td', {}, color), h('td', {}, name, cat.builtin ? h('span', { class: 'badge' }, 'built-in') : cat.archived ? h('span', { class: 'badge' }, 'archived') : null), h('td', {}, limit), h('td', {}, grace), h('td', {}, actions));
  if (cat.archived) row.style.opacity = '0.6';
  return row;
}

function shortsCard(): HTMLElement {
  const grid = h('div', { class: 'grid' });
  const mode = h('select', {}) as HTMLSelectElement;
  for (const [v, label] of [['auto', 'Assign to a category automatically'], ['prompt', 'Ask like a normal video'], ['block', 'Block Shorts entirely']] as const) {
    const o = h('option', { value: v }, label) as HTMLOptionElement;
    if (config.shortsMode === v) o.selected = true;
    mode.append(o);
  }
  const catSel = h('select', {}) as HTMLSelectElement;
  function fillCat(): void {
    clear(catSel);
    for (const c of config.categories.filter((c) => !c.builtin && !c.archived)) {
      const o = h('option', { value: c.id }, c.name) as HTMLOptionElement;
      if (config.shortsCategoryId === c.id) o.selected = true;
      catSel.append(o);
    }
    catSel.disabled = config.shortsMode !== 'auto';
  }
  fillCat();
  mode.addEventListener('change', () => { config.shortsMode = mode.value as Config['shortsMode']; fillCat(); markDirty(); });
  catSel.addEventListener('change', () => { config.shortsCategoryId = catSel.value; markDirty(); });
  grid.append(h('div', { class: 'k' }, 'Shorts'), h('div', {}, mode), h('div', { class: 'k' }, 'Shorts category'), h('div', {}, catSel));
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Shorts'),
    h('p', { class: 'hint' }, 'Shorts come too fast to be asked about one by one. They are filed under one category and count against its limit, or asked about like any other video, or blocked altogether.'),
    grid,
  );
}

function minutesToTime(min: number): string {
  return formatWindowTime(min);
}
function timeToMinutes(v: string): number {
  const [hh, mm] = v.split(':').map(Number);
  return ((hh || 0) * 60 + (mm || 0)) % 1440;
}

function blockedHoursCard(): HTMLElement {
  const list = h('div', { class: 'stack' });
  function redraw(): void {
    clear(list);
    if (config.blockedWindows.length === 0) {
      list.append(h('p', { class: 'muted' }, 'No blocked hours. YouTube is available all day (within your time budgets).'));
    }
    config.blockedWindows.forEach((w, i) => {
      const from = h('input', { type: 'time', value: minutesToTime(w.fromMin) }) as HTMLInputElement;
      const to = h('input', { type: 'time', value: minutesToTime(w.toMin) }) as HTMLInputElement;
      from.addEventListener('change', () => { w.fromMin = timeToMinutes(from.value); markDirty(); });
      to.addEventListener('change', () => { w.toMin = timeToMinutes(to.value); markDirty(); });
      list.append(
        h('div', { class: 'row' },
          h('span', { class: 'muted small' }, 'from'), from,
          h('span', { class: 'muted small' }, 'to'), to,
          w.fromMin > w.toMin ? h('span', { class: 'badge' }, 'overnight') : null,
          h('button', { class: 'link', onClick: () => { config.blockedWindows.splice(i, 1); markDirty(); redraw(); } }, 'remove'),
        ),
      );
    });
  }
  redraw();
  const addBtn = h('button', {
    onClick: () => {
      config.blockedWindows.push({ fromMin: 23 * 60, toMin: 7 * 60 });
      markDirty();
      redraw();
    },
  }, '+ Add window');
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Blocked hours'),
    h('p', { class: 'hint' }, 'YouTube is fully closed during these hours (hard cutoff, with the usual advance warning; the emergency override still works). An end time before the start time spans midnight. Adding or extending hours applies today; removing them takes effect tomorrow.'),
    list,
    h('div', { class: 'toolbar' }, addBtn),
  );
}

function rulesCard(): HTMLElement {
  const list = h('div', { class: 'stack' });
  function redraw(): void {
    clear(list);
    const entries = Object.entries(config.channelRules);
    if (entries.length === 0) { list.append(h('p', { class: 'muted' }, 'No channel rules yet. Tick “Always use this category for …” in the question on a video to add one.')); return; }
    for (const [channelId, rule] of entries) {
      const sel = h('select', {}) as HTMLSelectElement;
      for (const c of config.categories.filter((c) => !c.builtin && !c.archived)) {
        const o = h('option', { value: c.id }, c.name) as HTMLOptionElement;
        if (rule.categoryId === c.id) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener('change', () => { rule.categoryId = sel.value; markDirty(); });
      list.append(h('div', { class: 'row between' }, h('span', {}, rule.channelName || channelId), h('div', { class: 'row' }, sel, h('button', { class: 'link', onClick: () => { delete config.channelRules[channelId]; markDirty(); redraw(); } }, 'remove'))));
    }
  }
  redraw();
  return h('div', { class: 'card' }, h('h2', {}, 'Channel rules'), h('p', { class: 'hint' }, 'Videos from these channels get their category without the question.'), list);
}

async function savedCard(): Promise<HTMLElement> {
  const links = await request('getSavedLinks', {});
  const list = h('ul', { class: 'links' });
  if (links.length === 0) list.append(h('li', {}, h('span', { class: 'muted' }, 'No saved links. Videos you get blocked on are kept here.')));
  for (const l of links) {
    const category = l.category
      ? h('span', { class: 'chip', title: 'Category' }, swatch(l.category.color), l.category.name)
      : h('span', { class: 'muted' }, 'no category yet');
    list.append(
      h(
        'li',
        {},
        h('a', { class: 't', href: l.url, target: '_blank', title: l.url }, l.title ?? l.url),
        h(
          'div',
          { class: 'meta small' },
          category,
          l.channelName ? h('span', { class: 'muted' }, l.channelName) : null,
          h('span', { class: 'muted' }, formatDate(l.savedAt)),
          h('button', { class: 'link', onClick: async () => { await request('removeSavedLink', { url: l.url }); void load(); } }, 'remove'),
        ),
      ),
    );
  }
  return h(
    'div',
    { class: 'card', id: 'saved-section' },
    h('h2', {}, `Saved for later (${links.length})`),
    h('p', { class: 'hint' }, 'Videos you were blocked on, newest first, with their current category.'),
    list,
  );
}

function dataCard(): HTMLElement {
  const importArea = h('textarea', { placeholder: 'Paste an exported JSON here to import…' }) as HTMLTextAreaElement;
  const status = h('span', { class: 'muted small' });
  const imported = importNotice ? h('p', { class: 'notice ok' }, importNotice) : null;
  importNotice = null;
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Data'),
    h(
      'p',
      { class: 'hint' },
      'Everything is stored in this browser only. Export saves all of it (settings, history, video categories, saved links) as a file; Import replaces it all with such a file. “Clear all data” removes the history, today’s time included, and keeps your settings. “Delete everything” removes the settings too and returns the extension to its first-run state.',
    ),
    imported,
    h(
      'div',
      { class: 'row' },
      h('button', {
        onClick: async () => {
          const { json } = await request('exportData', {});
          const blob = new Blob([json], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${FILE_STEM}-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },
      }, 'Export all data'),
    ),
    h('details', {}, h('summary', {}, 'Import'), importArea, h('div', { class: 'row' }, h('button', {
      onClick: async () => {
        if (!importArea.value.trim()) return;
        if (!confirm('Importing replaces everything stored here: settings, tracked time, video categories and saved links. Continue?')) return;
        const r = await request('importData', { json: importArea.value });
        if (r.ok) {
          importNotice = `Imported ${r.days ?? 0} day(s), ${r.videos ?? 0} video(s) and ${r.savedLinks ?? 0} saved link(s).`;
          void load();
        } else {
          status.textContent = `Not imported: ${r.error}`;
        }
      },
    }, 'Import'), status)),
    h('div', { class: 'toolbar' }, h('button', {
      class: 'danger',
      onClick: async () => {
        if (!confirm('Clear all tracked time, categories memory and saved links? Your settings are kept.')) return;
        await request('clearData', { keepConfig: true });
        void load();
      },
    }, 'Clear all data (keep settings)'), h('button', {
      class: 'danger',
      onClick: async () => {
        if (!confirm('Delete everything, including your settings and categories? This cannot be undone. Export first if you want a backup.')) return;
        await request('clearData', { keepConfig: false });
        void load();
      },
    }, 'Delete everything')),
  );
}

function aboutCard(): HTMLElement {
  const external = (label: string, key: LinkKey): HTMLElement | null => {
    const url = link(key);
    return url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, label) : null;
  };
  return h(
    'div',
    { class: 'card about' },
    h('h2', {}, 'About'),
    h('p', {}, `${APP_NAME}, version ${chrome.runtime.getManifest().version}. Made by ${AUTHOR}.`),
    h(
      'p',
      { class: 'row' },
      h('button', { class: 'link', onClick: () => openExtensionPage('welcome.html') }, 'How it works'),
      external('Privacy policy', 'privacy'),
      external('Source code', 'source'),
      external('Report a problem', 'issues'),
    ),
    h(
      'p',
      { class: 'hint' },
      'Free software under the GNU General Public License, version 3 or later. Everything it records stays in this browser. YouTube is a trademark of Google LLC; this extension is not affiliated with or endorsed by YouTube or Google.',
    ),
  );
}

/** The author's note, always here at the end of the page; the same note is what the occasional reminder shows. */
function supportCard(): HTMLElement {
  const remind = h('input', { type: 'checkbox' }) as HTMLInputElement;
  remind.checked = config.feedbackReminders;
  remind.addEventListener('change', () => { config.feedbackReminders = remind.checked; markDirty(); });
  return h(
    'div',
    { class: 'card support' },
    h('h2', {}, 'Support this project'),
    supportNote(),
    h('div', { class: 'row' }, ...supportButtons()),
    h('label', { class: 'row remind' }, remind, 'Remind me with this note after a week, a month and three months of use'),
    h('p', { class: 'hint' }, 'That is the only thing the extension ever asks for. Nothing is locked behind it, and there are no ads.'),
  );
}

let saveBar: HTMLElement;
/** The bar shows while there is something to save, or something to say about the last save. */
function updateSaveBar(): void {
  saveBar.style.visibility = dirty || notice ? 'visible' : 'hidden';
  saveBar.classList.toggle('clean', !dirty);
}

async function draw(): Promise<void> {
  saveBar = h(
    'div',
    { class: 'saved row between' },
    h('span', { class: 'muted small unsaved' }, 'You have unsaved changes.'),
    h('div', { class: 'row' }, notice ?? h('span'), h('button', { class: 'primary', onClick: save }, 'Save settings')),
  );
  render(
    await staleWorkerBanner(),
    h('div', { class: 'row between' }, brandHeading('Settings'), h('button', { class: 'link', onClick: () => openExtensionPage('welcome.html') }, 'How it works')),
    setupDone
      ? null
      : h(
          'div',
          { class: 'notice warn' },
          'Setup is not finished: nothing is recorded or limited yet. ',
          h('button', { class: 'link', onClick: () => openExtensionPage('welcome.html') }, 'Finish setup'),
        ),
    await feedbackCard(() => void load()),
    generalCard(),
    categoriesCard(),
    shortsCard(),
    blockedHoursCard(),
    rulesCard(),
    await savedCard(),
    dataCard(),
    aboutCard(),
    supportCard(),
    saveBar,
  );
  updateSaveBar();
}

async function save(): Promise<void> {
  const res = await request('saveConfig', { config });
  config = res.config;
  dirty = false;
  const parts: string[] = ['Saved.'];
  if (res.deferredDaily || res.deferredCategories.length) {
    const names = res.deferredCategories.map((id) => config.categories.find((c) => c.id === id)?.name ?? id);
    parts.push(`Increases take effect tomorrow${names.length ? ' (' + [res.deferredDaily ? 'daily' : '', ...names].filter(Boolean).join(', ') + ')' : ''}.`);
  }
  if (res.deferredSchedule) parts.push('Removed blocked hours stay in force until tomorrow.');
  const shown = h('span', { class: 'notice ok small' }, parts.join(' '));
  notice = shown;
  await draw();
  setTimeout(() => {
    if (notice === shown) notice = null;
    shown.remove();
    updateSaveBar();
  }, 8000);
}

void load();
