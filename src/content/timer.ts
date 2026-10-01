// On-video timer pill: daily time left plus the current video's category, in a player corner.
// Clickable (opens the re-categorize prompt); ticks locally each second while time is counting and
// resyncs from every heartbeat response.
import type { OverlayInfo } from '../shared/overlay';
import { formatClock, formatDuration } from '../shared/time';
import { findVideo } from './player';

const STYLE = `
  :host { all: initial; }
  .pill {
    position: absolute; z-index: 2147483000; pointer-events: auto; cursor: pointer;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 12px; line-height: 1.4;
    color: #fff; background: rgba(15, 17, 21, 0.78); border-radius: 8px; padding: 5px 10px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4); white-space: nowrap; text-shadow: 0 1px 1px rgba(0,0,0,0.5);
  }
  .pill.tr { top: 12px; right: 12px; }
  .pill.tl { top: 12px; left: 12px; }
  .pill.br { bottom: 64px; right: 12px; }
  .pill.bl { bottom: 64px; left: 12px; }
  .row { display: flex; align-items: center; gap: 6px; }
  .daily { font-weight: 600; }
  .warn { color: #ffa726; }
  .over { color: #ff6e63; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .cat { opacity: 0.95; }
  .pill:hover { background: rgba(15, 17, 21, 0.92); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55); }
`;

function fmt(sec: number): string {
  const s = Math.max(0, sec);
  return s < 600 ? formatClock(s) : formatDuration(s);
}

export class TimerPill {
  /** Invoked when the user clicks the pill (opens the re-categorize prompt). */
  onClick: (() => void) | null = null;
  private host: HTMLElement | null = null;
  private pill: HTMLElement | null = null;
  private dailyEl: HTMLElement | null = null;
  private catRow: HTMLElement | null = null;
  private dot: HTMLElement | null = null;
  private catEl: HTMLElement | null = null;
  private info: OverlayInfo | null = null;
  private syncedAt = 0;
  private ticker: number | undefined;

  /** Called with every heartbeat response; null hides the pill. */
  update(info: OverlayInfo | null): void {
    this.info = info;
    this.syncedAt = Date.now();
    if (!info) {
      this.destroy();
      return;
    }
    this.mount();
    this.render();
    if (this.ticker === undefined) {
      this.ticker = window.setInterval(() => this.render(), 1000);
    }
  }

  destroy(): void {
    if (this.ticker !== undefined) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    this.host?.remove();
    this.host = null;
    this.pill = null;
  }

  /** The player container the pill lives in (re-attaches when YouTube swaps players). */
  private container(): HTMLElement | null {
    const video = findVideo();
    const c = video?.closest('.html5-video-player');
    return c instanceof HTMLElement ? c : null;
  }

  private mount(): void {
    const container = this.container();
    if (!container) return;
    if (!this.host) {
      this.host = document.createElement('div');
      this.host.setAttribute('data-yt-budget', 'timer');
      const shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      this.pill = document.createElement('div');
      this.pill.title = "Change this video's category";
      this.pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.isTrusted) this.onClick?.();
      });
      const daily = document.createElement('div');
      daily.className = 'row';
      this.dailyEl = document.createElement('span');
      this.dailyEl.className = 'daily';
      daily.append(this.dailyEl);
      this.catRow = document.createElement('div');
      this.catRow.className = 'row cat';
      this.dot = document.createElement('span');
      this.dot.className = 'dot';
      this.catEl = document.createElement('span');
      this.catRow.append(this.dot, this.catEl);
      this.pill.append(daily, this.catRow);
      shadow.append(style, this.pill);
    }
    if (this.host.parentElement !== container) container.append(this.host);
  }

  private render(): void {
    const info = this.info;
    if (!info || !this.pill || !this.dailyEl || !this.catRow || !this.dot || !this.catEl) return;
    if (!this.host?.isConnected) this.mount();
    this.pill.className = `pill ${info.corner}`;
    // Advance locally while time is counting; every heartbeat resyncs.
    const drift = info.counts ? (Date.now() - this.syncedAt) / 1000 : 0;

    const d = info.daily;
    const dUsed = d.usedSec + drift;
    if (d.limitSec === null) {
      this.dailyEl.textContent = `${fmt(dUsed)} today`;
      this.dailyEl.className = 'daily';
    } else {
      const left = Math.max(0, d.limitSec - dUsed);
      this.dailyEl.textContent = `${fmt(left)} left today`;
      this.dailyEl.className = 'daily' + (left <= 0 ? ' over' : d.warn ? ' warn' : '');
    }

    const c = info.category;
    this.catRow.style.display = c ? 'flex' : 'none';
    if (c) {
      const cUsed = c.usedSec + drift;
      this.dot.style.background = c.color;
      this.catEl.textContent = c.limitSec === null ? `${c.name} · ${fmt(cUsed)}` : `${c.name} · ${fmt(cUsed)} / ${fmt(c.limitSec)}`;
      const cLeft = c.limitSec === null ? null : c.limitSec - cUsed;
      this.catEl.className = cLeft !== null && cLeft <= 0 ? 'over' : c.warn ? 'warn' : '';
    }
  }
}
