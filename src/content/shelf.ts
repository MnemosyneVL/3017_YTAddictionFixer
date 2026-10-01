// "Saved for later" shelf at the top of the home / subscriptions feed: the newest saved links as YouTube-like
// cards (thumbnail, title, channel, category chip, blocked-today mark, remove) plus "See all". Its data arrives
// with every heartbeat response on feed pages (like the timer pill); null hides it. The host lives in YouTube's
// light DOM as the first child of the feed grid's #contents and re-inserts itself whenever YouTube re-renders
// the grid. Everything is built with createElement/textContent (youtube.com enforces Trusted Types).
import { NEUTRAL_LABEL } from '../shared/brand';
import type { SavedLinkView, SavedShelfInfo } from '../shared/saved';
import { feedKind, thumbnailUrl } from '../shared/url';

export interface ShelfCallbacks {
  onRemove(url: string): void;
  onSeeAll(): void;
}

/** Mount retry while the feed grid is still rendering after a navigation. */
const RETRY_MS = 250;
const RETRY_MAX = 12;

const STYLE = `
  :host {
    all: initial; display: block; width: 100%; box-sizing: border-box; contain: layout style;
    --n: var(--ytd-rich-grid-items-per-row, 4); --gap: var(--ytd-rich-grid-item-margin, 16px);
    --t1: #0f0f0f; --t2: #606060; --chip: rgba(0, 0, 0, 0.05); --hover: rgba(0, 0, 0, 0.1); --ph: rgba(0, 0, 0, 0.06);
    font-family: Roboto, Arial, sans-serif; color: var(--t1);
  }
  :host(.dark) { --t1: #f1f1f1; --t2: #aaaaaa; --chip: rgba(255, 255, 255, 0.1); --hover: rgba(255, 255, 255, 0.2); --ph: rgba(255, 255, 255, 0.1); }
  .shelf { padding: 0 calc(var(--gap) / 2) 4px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px; }
  .titles { display: flex; flex-direction: column; min-width: 0; }
  .kicker { font-size: 12px; line-height: 18px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--t2); }
  .title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 700; }
  .count { font-size: 14px; font-weight: 500; color: var(--t2); }
  .seeall { font: inherit; font-size: 14px; font-weight: 500; line-height: 36px; height: 36px; padding: 0 16px; border: 0; border-radius: 18px;
            background: var(--chip); color: var(--t1); cursor: pointer; white-space: nowrap; }
  .seeall:hover { background: var(--hover); }
  .row { display: flex; gap: var(--gap); overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; padding-bottom: 4px; }
  .row::-webkit-scrollbar { display: none; }
  .card { position: relative; flex: 0 0 calc((100% - (var(--n) - 1) * var(--gap)) / var(--n)); min-width: 210px; max-width: 420px; scroll-snap-align: start; }
  .link { display: block; color: inherit; text-decoration: none; outline: none; }
  .link:focus-visible .thumb { outline: 2px solid #3ea6ff; outline-offset: 2px; }
  .thumb { position: relative; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: var(--ph); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card.blocked .thumb img { opacity: 0.55; filter: grayscale(0.6); }
  .badge { position: absolute; left: 8px; bottom: 8px; font-size: 12px; line-height: 18px; font-weight: 500; padding: 0 5px; border-radius: 4px;
           background: rgba(0, 0, 0, 0.8); color: #fff; }
  .meta { padding: 12px 0 0; }
  .vt { margin: 0 0 4px; font-size: 16px; line-height: 22px; font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .sub { font-size: 14px; line-height: 20px; color: var(--t2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-top: 6px; font-size: 12px; line-height: 18px; color: var(--t2); }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 12px; background: var(--chip); color: var(--t1); font-weight: 500; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .x { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: rgba(0, 0, 0, 0.7);
       color: #fff; font: 20px/28px Roboto, Arial, sans-serif; text-align: center; cursor: pointer; opacity: 0; transition: opacity 120ms; }
  .card:hover .x, .x:focus-visible { opacity: 1; }
  .x:hover { background: rgba(0, 0, 0, 0.9); }
`;

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function badgeText(l: SavedLinkView): string | null {
  if (l.available) return null;
  switch (l.blockedNow) {
    case 'schedule':
      return 'Blocked now';
    case 'shorts':
      return 'Shorts blocked';
    default:
      return 'Blocked today';
  }
}

function formatSaved(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export class SavedShelf {
  private host: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private info: SavedShelfInfo | null = null;
  private signature = '';
  private retry: number | undefined;
  private retriesLeft = 0;
  private themeObserver: MutationObserver | null = null;

  constructor(private readonly cb: ShelfCallbacks) {}

  /** Called with every heartbeat response; null (or an empty list) hides the shelf. */
  update(info: SavedShelfInfo | null): void {
    if (!info || info.items.length === 0) {
      this.destroy();
      return;
    }
    this.info = info;
    this.ensureHost();
    this.render();
    if (this.mount()) this.stopRetry();
    else this.startRetry();
  }

  destroy(): void {
    this.stopRetry();
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.host?.remove();
    this.host = null;
    this.body = null;
    this.info = null;
    this.signature = '';
  }

  private ensureHost(): void {
    if (this.host) return;
    const host = document.createElement('div');
    host.setAttribute('data-yt-budget', 'shelf');
    // Lays out as one full-width row inside the feed grid (flex-wrap today; grid-column covers a grid variant).
    host.style.cssText = 'display:block;width:100%;flex:0 0 100%;grid-column:1/-1;box-sizing:border-box;margin:0 0 24px;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const body = el('section', 'shelf');
    body.setAttribute('aria-label', 'Saved for later');
    shadow.append(style, body);
    this.host = host;
    this.body = body;
    this.themeObserver = new MutationObserver(() => this.applyTheme());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
    this.applyTheme();
  }

  /** YouTube's theme is the `dark` attribute on <html>, not prefers-color-scheme. */
  private applyTheme(): void {
    this.host?.classList.toggle('dark', document.documentElement.hasAttribute('dark'));
  }

  /** Where the shelf goes: first child of the visible feed grid's #contents, else right above the grid. */
  private anchor(): { parent: Element; before: Element | null } | null {
    if (!feedKind(location.href)) return null;
    // YouTube keeps previously visited page renderers around with `hidden`; only the visible one counts.
    const browse = document.querySelector('ytd-page-manager > ytd-browse:not([hidden])') ?? document.querySelector('ytd-browse');
    const grid = browse?.querySelector('ytd-rich-grid-renderer');
    if (!grid) return null;
    const contents = grid.querySelector(':scope > #contents');
    if (contents) {
      const first = this.host && contents.firstElementChild === this.host ? this.host.nextElementSibling : contents.firstElementChild;
      return { parent: contents, before: first };
    }
    return grid.parentElement ? { parent: grid.parentElement, before: grid } : null;
  }

  /** (Re)inserts the host at its anchor. Returns false while the feed grid is not there yet. */
  private mount(): boolean {
    const host = this.host;
    if (!host) return false;
    const a = this.anchor();
    if (!a) return false;
    if (host.parentElement !== a.parent || host.nextElementSibling !== a.before) a.parent.insertBefore(host, a.before);
    return true;
  }

  private startRetry(): void {
    if (this.retry !== undefined) return;
    this.retriesLeft = RETRY_MAX;
    this.retry = window.setInterval(() => {
      if (!this.info || this.retriesLeft-- <= 0) {
        this.stopRetry();
        return;
      }
      if (this.mount()) this.stopRetry();
    }, RETRY_MS);
  }

  private stopRetry(): void {
    if (this.retry !== undefined) {
      clearInterval(this.retry);
      this.retry = undefined;
    }
  }

  /** Rebuilds the cards only when something visible changed (no image flicker on every heartbeat). */
  private render(): void {
    const info = this.info;
    const body = this.body;
    if (!info || !body) return;
    const sig = [
      info.total,
      ...info.items.map((i) =>
        [i.url, i.available ? 1 : 0, i.blockedNow ?? '', i.category?.id ?? '', i.category?.name ?? '', i.category?.color ?? '', i.title ?? '', i.channelName ?? ''].join('|'),
      ),
    ].join('\n');
    if (sig === this.signature) return;
    this.signature = sig;
    const row = el('div', 'row');
    for (const item of info.items) row.append(this.card(item));
    body.replaceChildren(this.header(info), row);
  }

  private header(info: SavedShelfInfo): HTMLElement {
    const head = el('header', 'head');
    const titles = el('div', 'titles');
    titles.append(el('div', 'kicker', NEUTRAL_LABEL));
    const title = el('h2', 'title', 'Saved for later');
    title.append(el('span', 'count', ` · ${info.total}`));
    titles.append(title);
    const seeAll = document.createElement('button');
    seeAll.type = 'button';
    seeAll.className = 'seeall';
    seeAll.textContent = 'See all';
    seeAll.title = 'Open the full list in the extension settings';
    seeAll.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isTrusted) this.cb.onSeeAll();
    });
    head.append(titles, seeAll);
    return head;
  }

  private card(l: SavedLinkView): HTMLElement {
    const card = el('article', l.available ? 'card' : 'card blocked');
    // A plain link: a full page load goes through the normal gate; middle-click opens a tab as usual.
    const link = document.createElement('a');
    link.className = 'link';
    link.href = l.url;
    link.title = l.title ?? l.url;
    const thumb = el('div', 'thumb');
    if (l.videoId) {
      const img = document.createElement('img');
      img.src = thumbnailUrl(l.videoId);
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => img.remove(), { once: true });
      thumb.append(img);
    }
    const badge = badgeText(l);
    if (badge) thumb.append(el('span', 'badge', badge));
    const meta = el('div', 'meta');
    meta.append(el('h3', 'vt', l.title ?? l.videoId ?? l.url));
    if (l.channelName) meta.append(el('div', 'sub', l.channelName));
    const chips = el('div', 'chips');
    if (l.category) {
      const chip = el('span', 'chip');
      const dot = el('i', 'dot');
      dot.style.background = l.category.color;
      chip.append(dot, document.createTextNode(l.category.name));
      chips.append(chip);
    } else {
      chips.append(el('span', 'nocat', 'no category yet'));
    }
    chips.append(el('span', 'date', `Saved ${formatSaved(l.savedAt)}`));
    meta.append(chips);
    link.append(thumb, meta);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'x';
    remove.textContent = '×';
    remove.title = 'Remove from saved for later';
    remove.setAttribute('aria-label', 'Remove from saved for later');
    remove.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.isTrusted) return; // a script in the page, not the user
      card.remove();
      this.cb.onRemove(l.url);
    });
    card.append(link, remove);
    return card;
  }
}
