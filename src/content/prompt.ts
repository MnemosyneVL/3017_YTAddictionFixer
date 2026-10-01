// Category prompt overlay (Shadow DOM). The video is held paused by the content script while it is open.
import { overlayRoot } from './player';

export interface PromptCategory {
  id: string;
  name: string;
  color: string;
}

export interface PromptOptions {
  categories: PromptCategory[];
  title?: string;
  channelName?: string;
  channelId?: string;
  /** Marked in the list when re-categorizing an already categorized video. */
  currentCategoryId?: string | null;
  /** The user has never answered this question: say why it is asked. */
  explain?: boolean;
  onChoose: (categoryId: string, rememberChannel: boolean) => void;
}

export interface PromptHandle {
  update(info: { title?: string; channelName?: string; channelId?: string }): void;
  close(): void;
  readonly open: boolean;
}

const STYLE = `
  :host { all: initial; }
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483646;
    background: rgba(0, 0, 0, 0.72); display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #e8eaed;
  }
  .card {
    width: min(520px, calc(100vw - 32px)); background: #1f2227; border-radius: 14px; padding: 22px 24px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.6); border: 1px solid #343941;
  }
  .kicker { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #9aa3ad; margin-bottom: 6px; }
  .title { font-size: 17px; font-weight: 600; line-height: 1.3; margin-bottom: 2px; }
  .channel { font-size: 13px; color: #9aa3ad; margin-bottom: 16px; min-height: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  button.cat {
    font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: #2a2f37; border: 1px solid #3a404a;
    border-left: 6px solid var(--c); border-radius: 10px; padding: 12px 12px; text-align: left; cursor: pointer;
  }
  button.cat:hover, button.cat:focus-visible { background: #343a44; outline: none; border-color: #5b6370; border-left-color: var(--c); }
  .kbd { float: right; font-size: 11px; color: #9aa3ad; font-weight: 400; }
  .cur { float: right; font-size: 10px; color: #9aa3ad; font-weight: 500; border: 1px solid #4a515c; border-radius: 999px; padding: 0 6px; margin-left: 6px; }
  label.rule { display: flex; gap: 8px; align-items: center; margin-top: 16px; font-size: 13px; color: #c6ccd3; cursor: pointer; }
  label.rule input { width: 16px; height: 16px; }
  .hint { margin-top: 12px; font-size: 12px; color: #7f8893; }
  .why { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: #2a2f37; border: 1px solid #3a404a; font-size: 13px; line-height: 1.45; color: #c6ccd3; }
  .why b { color: #fff; }
`;

export function showPrompt(opts: PromptOptions): PromptHandle {
  const host = document.createElement('div');
  host.setAttribute('data-yt-budget', 'prompt');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.append(style);

  const backdrop = el('div', 'backdrop');
  const card = el('div', 'card');
  const kicker = el('div', 'kicker', 'What is this video?');
  const title = el('div', 'title', opts.title ?? 'Loading title…');
  const channel = el('div', 'channel', opts.channelName ?? '');
  const grid = el('div', 'grid');
  const ruleLabel = document.createElement('label');
  ruleLabel.className = 'rule';
  const ruleBox = document.createElement('input');
  ruleBox.type = 'checkbox';
  const ruleText = document.createElement('span');
  ruleLabel.append(ruleBox, ruleText);
  const hint = el('div', 'hint', 'The video stays paused until you choose. Press 1–9 to pick quickly.');

  let open = true;
  let channelId = opts.channelId;
  let channelName = opts.channelName;

  function refreshRule(): void {
    ruleLabel.style.display = channelId ? 'flex' : 'none';
    ruleText.textContent = `Always use this category for ${channelName ?? 'this channel'}`;
  }
  refreshRule();

  opts.categories.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'cat';
    b.style.setProperty('--c', c.color);
    b.textContent = c.name;
    if (i < 9) {
      const k = el('span', 'kbd', String(i + 1));
      b.append(k);
    }
    if (opts.currentCategoryId === c.id) b.append(el('span', 'cur', 'current'));
    // Only a real click or key press chooses: the page can reach into the open shadow root and dispatch events.
    b.addEventListener('click', (e) => {
      if (e.isTrusted) choose(c.id);
    });
    grid.append(b);
  });

  function choose(id: string): void {
    if (!open) return;
    opts.onChoose(id, !!channelId && ruleBox.checked);
  }

  function onKey(e: KeyboardEvent): void {
    if (!open || !e.isTrusted) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, opts.categories.length)) {
      e.preventDefault();
      e.stopPropagation();
      choose(opts.categories[n - 1]!.id);
    } else if (e.key !== 'Tab' && e.key !== 'Shift' && e.key !== ' ' && e.key !== 'Enter') {
      // Swallow YouTube shortcuts (k, space, f…) while the prompt is open.
      e.stopPropagation();
    }
  }

  card.append(kicker, title, channel);
  if (opts.explain) {
    const why = el('div', 'why');
    why.append(
      el('b', '', 'Why am I asked? '),
      document.createTextNode(
        'Your time is budgeted by the kind of video, so each new video is filed once. Pick what fits; a click on the small timer on the video changes it later, and the box below files a whole channel for good.',
      ),
    );
    card.append(why);
  }
  card.append(grid, ruleLabel, hint);
  backdrop.append(card);
  shadow.append(backdrop);
  backdrop.addEventListener('keydown', onKey);
  document.addEventListener('keydown', onKey, true);

  function mount(): void {
    const root = overlayRoot();
    if (host.parentElement !== root) root.append(host);
  }
  const onFullscreen = (): void => mount();
  document.addEventListener('fullscreenchange', onFullscreen);
  mount();
  (grid.firstElementChild as HTMLElement | null)?.focus();

  return {
    get open() {
      return open;
    },
    update(info) {
      if (info.title) title.textContent = info.title;
      if (info.channelName) {
        channelName = info.channelName;
        channel.textContent = info.channelName;
      }
      if (info.channelId) channelId = info.channelId;
      refreshRule();
    },
    close() {
      if (!open) return;
      open = false;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFullscreen);
      host.remove();
    },
  };
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
