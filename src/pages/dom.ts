// Tiny DOM helpers for the extension pages (no innerHTML with untrusted data).
import { APP_LABEL, APP_NAME, APP_SUFFIX } from '../shared/brand';
import { request } from '../runtime/rpc';

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void) | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') el.className = v as string;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function app(): HTMLElement {
  const el = document.getElementById('app');
  if (!el) throw new Error('#app missing');
  return el;
}

export function render(...children: Child[]): void {
  const root = app();
  clear(root);
  for (const c of children) if (c) root.append(typeof c === 'string' ? document.createTextNode(c) : c);
}

export function pct(part: number, whole: number | null): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

export function bar(part: number, whole: number | null, color?: string): HTMLElement {
  const fill = h('span');
  fill.style.width = `${pct(part, whole)}%`;
  if (color) fill.style.background = color;
  const cls = whole === null ? 'bar ok' : part >= whole ? 'bar' : part >= whole * 0.85 ? 'bar warn' : 'bar ok';
  return h('div', { class: cls }, fill);
}

export function swatch(color: string): HTMLElement {
  const s = h('span', { class: 'swatch' });
  s.style.background = color;
  return s;
}

export function openExtensionPage(path: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}

/**
 * The page heading: the product name with its "for YouTube™" reference set smaller beside it (the form the
 * Chrome Web Store asks for when a name refers to a Google product), optionally followed by the page's name.
 */
export function brandHeading(page?: string): HTMLElement {
  return h(
    'h1',
    { class: 'brand' },
    APP_LABEL,
    ' ',
    h('span', { class: 'brand-suffix' }, APP_SUFFIX),
    page ? h('span', { class: 'brand-page' }, ` — ${page}`) : null,
  );
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The build-time part of a build stamp ("1.0.0.1790000000000"), or 0. */
function stampTime(stamp: string): number {
  const t = Number(stamp.slice(stamp.lastIndexOf('.') + 1));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Detects a page and a service worker from different builds, and says which of the two has to be reloaded.
 * - The page is older: the extension was updated while this page stayed open. Reloading the page fixes it.
 * - The worker is older: the unpacked-extension trap (rebuilt on disk, but Chrome only re-reads the worker on
 *   extension reload). An old worker strips config fields it does not know, so this must not pass silently.
 */
export async function staleWorkerBanner(): Promise<HTMLElement | null> {
  let workerBuild: string | null = null;
  try {
    workerBuild = (await request('getBuild', {})).build;
    if (workerBuild === __BUILD__) return null;
  } catch (e) {
    // An old worker does not know getBuild at all — that IS the stale-worker case.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/unknown request type/i.test(msg)) return null;
  }
  if (workerBuild !== null && stampTime(workerBuild) > stampTime(__BUILD__)) {
    return h(
      'div',
      { class: 'notice danger' },
      h('b', {}, 'This page needs a reload. '),
      'The extension was updated while it was open. ',
      h('button', { onClick: () => location.reload() }, 'Reload this page'),
    );
  }
  return h(
    'div',
    { class: 'notice danger' },
    h('b', {}, 'The extension needs a reload. '),
    'Its background service is still running an older version than this page, so saving settings or tracking may misbehave. Open ',
    h('span', { class: 'mono' }, 'chrome://extensions'),
    ` and click the reload arrow on ${APP_NAME}, or restart the browser.`,
  );
}
