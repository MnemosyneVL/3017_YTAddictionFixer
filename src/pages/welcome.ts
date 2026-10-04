// Welcome page. While setup is pending it explains the extension, lets the user choose a daily limit and
// categories, says what will be recorded, and waits for "Start": the explicit agreement that has to come
// before anything is recorded. Once setup is done the same page is the always-available help page.
import { link } from '../shared/brand';
import { CATEGORY_COLORS, STARTER_CATEGORIES, newCategoryId } from '../shared/config';
import type { Category, Config } from '../shared/types';
import { request } from '../runtime/rpc';
import { brandHeading, h, openExtensionPage, render } from './dom';

export {};

/** A line of the category checklist: a suggestion from STARTER_CATEGORIES or one the user typed in. */
interface Row {
  id: string | null;
  name: string;
  color: string;
  limitMin: number | null;
  on: boolean;
  own: boolean;
}

const DAILY_PRESETS: { label: string; min: number | null }[] = [
  { label: '30 min', min: 30 },
  { label: '1 hour', min: 60 },
  { label: '1½ hours', min: 90 },
  { label: '2 hours', min: 120 },
  { label: '3 hours', min: 180 },
  { label: 'No daily limit', min: null },
];

let mode: 'setup' | 'done' | 'help' = 'setup';
let config: Config;
let dailyLimitMin: number | null = 60;
let rows: Row[] = [];
let problem = '';
let busy = false;

async function load(): Promise<void> {
  const [onboarding, cfg] = await Promise.all([request('getOnboarding', {}), request('getConfig', {})]);
  config = cfg;
  mode = onboarding.setupDone ? 'help' : 'setup';
  dailyLimitMin = cfg.dailyLimitMin;
  rows = STARTER_CATEGORIES.map((c) => ({ id: c.id, name: c.name, color: c.color, limitMin: c.limitMin, on: c.preselected, own: false }));
  draw();
}

// ---- how it works (both modes) ----------------------------------------------------------------------------

function step(n: number, title: string, text: string): HTMLElement {
  return h('div', { class: 'step' }, h('span', { class: 'num' }, String(n)), h('div', {}, h('h3', {}, title), h('p', { class: 'muted' }, text)));
}

function howItWorks(): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'How it works'),
    h(
      'div',
      { class: 'steps' },
      step(1, 'You give YouTube a daily time budget.', 'Time counts while a video plays or while you are actively looking at YouTube. The number on the toolbar icon is the minutes you have left today.'),
      step(2, 'Every new video asks one thing: what is this?', 'You pick a category with one click (or keys 1–9); the video waits until you do. A channel can be given a category for good, and a click on the small timer on the video changes it later.'),
      step(3, 'When the budget is used up, you finish what you are watching.', 'After that YouTube is closed until tomorrow. Every video you were stopped on is saved for later, so nothing is lost.'),
      step(4, 'There is no easy way out.', 'Raising a limit takes effect tomorrow; lowering one works at once. One 15-minute emergency override a day is allowed, and it shows up in your statistics.'),
    ),
  );
}

function recorded(): HTMLElement {
  const privacy = link('privacy');
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'What is recorded, and where it stays'),
    h(
      'p',
      {},
      'To do its job the extension keeps a record on this device: which YouTube videos you open (address, title and channel), how long you watch, the category you give each video, the videos saved for later, and your settings.',
    ),
    h(
      'p',
      {},
      h('b', {}, 'It stays in this browser. '),
      'Nothing is sent to us or to anyone else: there is no account, no server and no analytics. The only requests the extension makes go to YouTube itself, for video titles and thumbnails.',
    ),
    h('p', { class: 'muted' }, 'You can export or delete the record at any time under Settings → Data. Removing the extension removes all of it.'),
    privacy ? h('p', {}, h('a', { href: privacy, target: '_blank', rel: 'noopener' }, 'Privacy policy')) : null,
  );
}

// ---- setup --------------------------------------------------------------------------------------------------

function dailyLimitPicker(): HTMLElement {
  const isPreset = DAILY_PRESETS.some((p) => p.min === dailyLimitMin);
  const custom = h('input', { type: 'number', min: '5', step: '5', placeholder: 'other', 'aria-label': 'Daily limit in minutes' }) as HTMLInputElement;
  if (!isPreset && dailyLimitMin !== null) custom.value = String(dailyLimitMin);
  custom.addEventListener('change', () => {
    const v = Number(custom.value);
    if (Number.isFinite(v) && v > 0) {
      dailyLimitMin = Math.round(v);
      draw();
    }
  });
  return h(
    'div',
    { class: 'row presets' },
    ...DAILY_PRESETS.map((p) =>
      h(
        'button',
        {
          class: 'preset',
          'aria-pressed': p.min === dailyLimitMin ? 'true' : 'false',
          onClick: () => {
            dailyLimitMin = p.min;
            draw();
          },
        },
        p.label,
      ),
    ),
    h('label', { class: 'row' }, custom, h('span', { class: 'muted small' }, 'min')),
  );
}

function categoryRow(row: Row): HTMLElement {
  const on = h('input', { type: 'checkbox', 'aria-label': `Use ${row.name || 'this category'}` }) as HTMLInputElement;
  on.checked = row.on;
  on.addEventListener('change', () => {
    row.on = on.checked;
    draw();
  });
  const dot = h('span', { class: 'swatch' });
  dot.style.background = row.color;
  const name = row.own
    ? (() => {
        const input = h('input', { type: 'text', placeholder: 'Name', maxlength: '60', 'aria-label': 'Category name' }) as HTMLInputElement;
        input.value = row.name;
        input.addEventListener('input', () => (row.name = input.value));
        return input;
      })()
    : h('span', {}, row.name);
  const limit = h('input', { type: 'number', min: '0', step: '5', placeholder: 'no own limit', 'aria-label': `Daily limit for ${row.name || 'this category'} in minutes` }) as HTMLInputElement;
  limit.value = row.limitMin === null ? '' : String(row.limitMin);
  limit.disabled = !row.on;
  limit.addEventListener('input', () => {
    const v = Number(limit.value);
    row.limitMin = limit.value === '' || !Number.isFinite(v) || v < 0 ? null : Math.round(v);
  });
  return h('div', { class: row.on ? 'catrow' : 'catrow off' }, h('label', { class: 'row pick' }, on, dot, name), h('label', { class: 'row' }, limit, h('span', { class: 'muted small' }, 'min a day')));
}

function setupCard(): HTMLElement {
  const addOwn = h(
    'button',
    {
      class: 'link',
      onClick: () => {
        rows.push({ id: null, name: '', color: CATEGORY_COLORS[rows.length % CATEGORY_COLORS.length]!, limitMin: null, on: true, own: true });
        draw();
      },
    },
    '+ Add your own',
  );
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Set it up'),
    h('h3', {}, 'How much YouTube a day?'),
    dailyLimitPicker(),
    h('p', { class: 'hint' }, 'This covers everything you do on YouTube. You can change it later; a raise then takes effect the next day.'),
    h('h3', {}, 'Which kinds of video do you watch?'),
    h('div', { class: 'cats' }, ...rows.map(categoryRow)),
    addOwn,
    h(
      'p',
      { class: 'hint' },
      'Each new video is filed under one of these. A category can have its own, smaller limit inside the daily budget: an hour of Entertainment while Learning may use the rest. Shorts are filed under Entertainment unless you change that in Settings.',
    ),
  );
}

function startCard(): HTMLElement {
  return h(
    'section',
    { class: 'card start' },
    problem ? h('p', { class: 'notice danger' }, problem) : null,
    h('button', { class: 'primary big', disabled: busy, onClick: () => void start() }, busy ? 'Starting…' : 'Start'),
    h('p', { class: 'muted small' }, 'Nothing is recorded or limited until you press Start. Pressing it means you agree to the record described above being kept on this device.'),
  );
}

async function start(): Promise<void> {
  const chosen = rows.filter((r) => r.on && r.name.trim() !== '');
  if (chosen.length === 0) {
    problem = 'Tick at least one category, or add your own.';
    draw();
    return;
  }
  const builtins = config.categories.filter((c) => c.builtin);
  const categories: Category[] = [];
  chosen.forEach((r, order) => {
    const name = r.name.trim().slice(0, 60);
    const id = r.id ?? newCategoryId(name, [...categories, ...builtins]);
    categories.push({ id, name, color: r.color, limitMin: r.limitMin, graceMin: null, order });
  });
  const shorts = categories.find((c) => c.id === 'entertainment') ?? categories[0]!;
  const next: Config = { ...config, dailyLimitMin, categories: [...categories, ...builtins], shortsCategoryId: shorts.id };
  busy = true;
  problem = '';
  draw();
  try {
    const res = await request('completeSetup', { config: next });
    if (res.ok) mode = 'done';
    else problem = res.error ?? 'Setup did not finish. Please try again.';
  } catch (e) {
    problem = `Setup did not finish: ${e instanceof Error ? e.message : String(e)}`;
  }
  busy = false;
  draw();
}

function doneCard(): HTMLElement {
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'You are set'),
    h(
      'ul',
      { class: 'tips' },
      h('li', {}, h('b', {}, 'Open YouTube. '), 'The first video you start asks for its category; after that the timer on the video shows what is left.'),
      h('li', {}, h('b', {}, 'Pin the icon. '), 'Click the puzzle piece in the toolbar and the pin next to this extension, so the minutes left stay in view.'),
      h('li', {}, h('b', {}, 'Incognito windows '), 'are not covered unless you allow it: chrome://extensions → Details → Allow in Incognito.'),
      h('li', {}, h('b', {}, 'Everything can be changed '), 'in Settings: limits, categories, blocked hours, what counts as watching.'),
    ),
    h(
      'div',
      { class: 'row' },
      h('a', { class: 'btn primary', href: 'https://www.youtube.com/', target: '_blank', rel: 'noopener' }, 'Open YouTube'),
      h('button', { onClick: () => openExtensionPage('options.html') }, 'Settings'),
    ),
  );
}

// ---- help ---------------------------------------------------------------------------------------------------

function legend(): HTMLElement {
  const item = (mark: string, cls: string, text: string): HTMLElement => h('li', {}, h('span', { class: `mark ${cls}` }, mark), text);
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'The toolbar icon'),
    h(
      'ul',
      { class: 'legend' },
      item('42', 'ok', 'Minutes left today.'),
      item('4', 'warn', 'The same, once the warning time is reached.'),
      item('✕', 'stop', 'YouTube is closed: the daily limit is used up, or blocked hours are running.'),
      item('OV', 'warn', 'The emergency override is running.'),
      item('!', 'warn', 'Setup is not finished; nothing is recorded yet.'),
    ),
    h('p', { class: 'muted' }, 'Click the icon for today’s breakdown, the current video’s category and your saved-for-later list.'),
  );
}

function faq(): HTMLElement {
  const qa = (q: string, a: string): HTMLElement[] => [h('dt', {}, q), h('dd', { class: 'muted' }, a)];
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, 'Questions'),
    h(
      'dl',
      { class: 'faq' },
      ...qa('I raised my limit but nothing changed.', 'On purpose: a raise applies from the next day, so a weak moment cannot buy more time today. Lowering a limit applies at once.'),
      ...qa('Why does it ask about every video?', 'Because the budget follows what you watch. Tick “Always use this category for this channel” in the question and that channel never asks again; a category you got wrong can be changed with a click on the timer on the video.'),
      ...qa('The video I was finishing got cut off.', 'The allowance to finish a video is a time budget: what is left of the video plus a small margin. Rewinding, looping or a live stream runs into it. How long each category may run on is set under Settings → Categories → After limit.'),
      ...qa('Does a paused or background video count?', 'A playing video counts even in a background tab. A paused one counts only while you are looking at it. “Count time when” in Settings changes this.'),
      ...qa('What about Shorts?', 'They are filed under one category without asking, or blocked altogether: Settings → Shorts.'),
      ...qa('Does it work in Incognito windows?', 'Only if you allow it: chrome://extensions → Details → Allow in Incognito.'),
      ...qa('Can I get around it?', 'Yes. Another browser, another profile or switching the extension off all work. The aim is to take away the effortless ways of losing an evening, not to lock you in.'),
      ...qa('Where is my data?', 'In this browser only. Settings → Data exports it, clears the history or deletes everything.'),
    ),
  );
}

// ---- page ---------------------------------------------------------------------------------------------------

function draw(): void {
  const hero = h(
    'header',
    { class: 'hero' },
    h('img', { class: 'icon', src: 'icons/icon128.png', alt: '' }),
    brandHeading(),
    h('p', { class: 'lead' }, 'Take your time back, without giving YouTube up.'),
  );
  if (mode === 'setup') {
    render(hero, howItWorks(), setupCard(), recorded(), startCard());
  } else if (mode === 'done') {
    render(hero, doneCard(), howItWorks());
  } else {
    render(
      hero,
      howItWorks(),
      legend(),
      faq(),
      recorded(),
      h('p', { class: 'row small muted' }, h('button', { class: 'link', onClick: () => openExtensionPage('options.html') }, 'Settings'), h('button', { class: 'link', onClick: () => openExtensionPage('report.html') }, 'Statistics')),
    );
  }
}

void load().catch((e: unknown) => {
  render(h('div', { class: 'card' }, h('p', {}, `The extension did not answer: ${e instanceof Error ? e.message : String(e)}`)));
});
