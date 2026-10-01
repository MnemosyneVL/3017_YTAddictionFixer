// In-page toast messages (mirror of system notifications, which Windows may suppress).
import { NEUTRAL_LABEL } from '../shared/brand';
import { overlayRoot } from './player';

const STYLE = `
  :host { all: initial; }
  .stack { position: fixed; right: 16px; bottom: 16px; z-index: 2147483645; display: flex; flex-direction: column; gap: 8px;
           font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .toast { max-width: 360px; background: #1f2227; color: #e8eaed; border: 1px solid #343941; border-left: 5px solid #5c6bc0;
           border-radius: 10px; padding: 10px 14px; font-size: 13px; line-height: 1.4; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
           animation: in 160ms ease-out; }
  .toast.warn { border-left-color: #ffa726; }
  .toast.limit { border-left-color: #ef5350; }
  .toast b { display: block; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #9aa3ad; margin-bottom: 2px; }
  @keyframes in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
`;

let host: HTMLElement | null = null;
let stack: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (!host || !stack) {
    host = document.createElement('div');
    host.setAttribute('data-yt-budget', 'toast');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    stack = document.createElement('div');
    stack.className = 'stack';
    shadow.append(style, stack);
    document.addEventListener('fullscreenchange', () => {
      if (host && host.parentElement !== overlayRoot()) overlayRoot().append(host);
    });
  }
  if (host.parentElement !== overlayRoot()) overlayRoot().append(host);
  return stack;
}

export function showToast(text: string, kind: 'info' | 'warn' | 'limit' = 'info', ms = 9000): void {
  if (!document.body) return;
  const s = ensure();
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  const b = document.createElement('b');
  b.textContent = NEUTRAL_LABEL;
  const span = document.createElement('span');
  span.textContent = text;
  t.append(b, span);
  s.append(t);
  setTimeout(() => t.remove(), ms);
}

export function removeToasts(): void {
  host?.remove();
  host = null;
  stack = null;
}
