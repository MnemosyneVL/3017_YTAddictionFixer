// Statistics page: category split, per-day chart, top channels and videos over a range. The interface calls it
// "Statistics" ("Report" read like "report this extension"); files, types and requests keep the name "report".
import { FILE_STEM } from '../shared/brand';
import { reportToCsv, type Report } from '../shared/report';
import { addDays, dayKeyFor, formatDuration } from '../shared/time';
import { request } from '../runtime/rpc';
import { bar, brandHeading, clear, h, pct, render, swatch } from './dom';
import { feedbackCard } from './feedback';

export {};

type RangeKey = 'today' | '7' | '30' | 'custom';
let range: RangeKey = '7';
let customFrom = '';
let customTo = '';

function rangeDates(): { from: string; to: string } {
  const today = dayKeyFor(Date.now(), 0);
  if (range === 'today') return { from: today, to: today };
  if (range === '7') return { from: addDays(today, -6), to: today };
  if (range === '30') return { from: addDays(today, -29), to: today };
  return { from: customFrom || addDays(today, -6), to: customTo || today };
}

async function load(): Promise<void> {
  const { from, to } = rangeDates();
  let report: Report;
  try {
    report = await request('getReport', { from, to });
  } catch (e) {
    render(h('p', {}, `Could not load the statistics: ${e instanceof Error ? e.message : String(e)}`));
    return;
  }
  draw(report, await feedbackCard(() => void load()));
}

function rangeBar(): HTMLElement {
  const mk = (key: RangeKey, label: string): HTMLElement =>
    h('button', { class: range === key ? 'active' : '', onClick: () => { range = key; void load(); } }, label);
  const row = h('div', { class: 'ranges' }, mk('today', 'Today'), mk('7', 'Last 7 days'), mk('30', 'Last 30 days'), mk('custom', 'Custom'));
  if (range === 'custom') {
    const from = h('input', { type: 'date', value: customFrom || rangeDates().from }) as HTMLInputElement;
    const to = h('input', { type: 'date', value: customTo || rangeDates().to }) as HTMLInputElement;
    from.addEventListener('change', () => { customFrom = from.value; void load(); });
    to.addEventListener('change', () => { customTo = to.value; void load(); });
    row.append(h('span', { class: 'row small' }, from, '→', to));
  }
  return row;
}

/** Stacked per-day bar chart as inline SVG. */
function chart(report: Report): HTMLElement {
  const days = report.days;
  const maxSec = Math.max(1, ...days.map((d) => d.totalSec));
  const W = 720;
  const H = 220;
  const padL = 8;
  const padB = 18;
  const gap = 4;
  const n = Math.max(1, days.length);
  const bw = Math.max(2, (W - padL) / n - gap);
  const catColor = new Map(report.categories.map((c) => [c.categoryId, c.color]));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  const chartH = H - padB;
  days.forEach((d, i) => {
    const x = padL + i * (bw + gap);
    let y = chartH;
    const ids = Object.keys(d.byCategory).sort();
    for (const id of ids) {
      const sec = d.byCategory[id] ?? 0;
      const hgt = (sec / maxSec) * (chartH - 4);
      if (hgt <= 0) continue;
      y -= hgt;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(bw));
      rect.setAttribute('height', String(hgt));
      rect.setAttribute('fill', catColor.get(id) ?? '#9e9e9e');
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = `${d.date} · ${formatDuration(sec)}`;
      rect.append(t);
      svg.append(rect);
    }
    if (d.limitSec) {
      const ly = chartH - (d.limitSec / maxSec) * (chartH - 4);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x - 1));
      line.setAttribute('x2', String(x + bw + 1));
      line.setAttribute('y1', String(ly));
      line.setAttribute('y2', String(ly));
      line.setAttribute('stroke', 'var(--muted)');
      line.setAttribute('stroke-dasharray', '3 2');
      line.setAttribute('opacity', '0.7');
      svg.append(line);
    }
    if (n <= 31) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x + bw / 2));
      label.setAttribute('y', String(H - 6));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '9');
      label.setAttribute('fill', 'var(--muted)');
      label.textContent = d.date.slice(8);
      svg.append(label);
    }
  });
  return svg as unknown as HTMLElement;
}

function legend(report: Report): HTMLElement {
  return h('div', { class: 'legend' }, ...report.categories.map((c) => h('span', {}, swatch(c.color), c.name)));
}

function draw(report: Report, feedback: HTMLElement | null = null): void {
  const empty = report.totalSec === 0;
  const catRows = report.categories.map((c) =>
    h(
      'div',
      { class: 'catrow' },
      h('div', {}, swatch(c.color), c.name),
      bar(c.sec, report.totalSec, c.color),
      h('div', { class: 'num' }, formatDuration(c.sec)),
      h('div', { class: 'num muted' }, `${Math.round(pct(c.sec, report.totalSec))}%`),
    ),
  );

  const videoRows = report.videos.slice(0, 15).map((v) =>
    h('tr', {}, h('td', {}, h('a', { href: `https://www.youtube.com/watch?v=${v.videoId}`, target: '_blank' }, v.title)), h('td', { class: 'muted' }, v.channelName), h('td', {}, catName(report, v.categoryId)), h('td', { class: 'num' }, formatDuration(v.sec))),
  );
  const channelRows = report.channels.slice(0, 10).map((c) =>
    h('tr', {}, h('td', {}, c.channelName), h('td', { class: 'num muted' }, `${c.videos}`), h('td', { class: 'num' }, formatDuration(c.sec))),
  );

  render(
    h('div', { class: 'row between' }, brandHeading('Statistics'), h('button', { onClick: () => exportCsv(report) }, 'Export CSV')),
    feedback,
    rangeBar(),
    h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, 'Total'), h('span', {}, formatDuration(report.totalSec))), empty ? h('p', { class: 'muted' }, 'No YouTube time recorded in this range.') : chart(report), empty ? null : legend(report)),
    empty ? null : h('div', { class: 'card' }, h('h2', {}, 'By category'), ...catRows),
    h('div', { class: 'card' }, h('h2', {}, 'Overrides & limits'), h('p', { class: 'muted' }, `${report.overrides} override(s) used · daily limit reached on ${report.limitHits.daily} day(s)`)),
    report.channels.length ? h('div', { class: 'card' }, h('h2', {}, 'Top channels'), h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Channel'), h('th', { class: 'num' }, 'Videos'), h('th', { class: 'num' }, 'Time'))), h('tbody', {}, ...channelRows))) : null,
    report.videos.length ? h('div', { class: 'card' }, h('h2', {}, 'Top videos'), h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Video'), h('th', {}, 'Channel'), h('th', {}, 'Category'), h('th', { class: 'num' }, 'Time'))), h('tbody', {}, ...videoRows))) : null,
  );
}

function catName(report: Report, id: string): string {
  return report.categories.find((c) => c.categoryId === id)?.name ?? id;
}

async function exportCsv(report: Report): Promise<void> {
  const config = await request('getConfig', {});
  const csv = reportToCsv(report, config);
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${FILE_STEM}-statistics-${report.from}_${report.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

void clear;
void load();
