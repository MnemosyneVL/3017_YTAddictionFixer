// Report aggregation over a range of day records. Pure.
import { categoryById } from './config';
import { dayTotals } from './day';
import {
  BUILTIN_BROWSING,
  BUILTIN_UNCATEGORIZED,
  type CategoryId,
  type Config,
  type DayKey,
  type DayRecord,
  type VideoId,
  type VideoIndex,
} from './types';

export interface ReportCategoryRow {
  categoryId: CategoryId;
  name: string;
  color: string;
  sec: number;
  /** 0..1 share of the range total. */
  share: number;
}

export interface ReportDayRow {
  date: DayKey;
  totalSec: number;
  byCategory: Record<CategoryId, number>;
  limitSec: number | null;
  overrides: number;
}

export interface ReportVideoRow {
  videoId: VideoId;
  title: string;
  channelId: string;
  channelName: string;
  categoryId: CategoryId;
  sec: number;
}

export interface ReportChannelRow {
  channelId: string;
  channelName: string;
  sec: number;
  videos: number;
}

export interface Report {
  from: DayKey;
  to: DayKey;
  totalSec: number;
  days: ReportDayRow[];
  categories: ReportCategoryRow[];
  videos: ReportVideoRow[];
  channels: ReportChannelRow[];
  overrides: number;
  limitHits: { daily: number; category: Record<CategoryId, number> };
}

export function categoryLabel(config: Config, id: CategoryId): { name: string; color: string } {
  const c = categoryById(config, id);
  if (c) return { name: c.name, color: c.color };
  if (id === BUILTIN_BROWSING) return { name: 'Browsing', color: '#8d6e63' };
  if (id === BUILTIN_UNCATEGORIZED) return { name: 'Uncategorized', color: '#9e9e9e' };
  return { name: `(deleted: ${id})`, color: '#9e9e9e' };
}

export function buildReport(days: DayRecord[], videoIndex: VideoIndex, config: Config, from: DayKey, to: DayKey, topN = 25): Report {
  const byCategory: Record<CategoryId, number> = {};
  const byVideo = new Map<VideoId, ReportVideoRow>();
  const byChannel = new Map<string, ReportChannelRow>();
  const limitHits = { daily: 0, category: {} as Record<CategoryId, number> };
  let totalSec = 0;
  let overrides = 0;
  const dayRows: ReportDayRow[] = [];

  for (const day of [...days].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const totals = dayTotals(day);
    totalSec += totals.totalSec;
    overrides += day.overrides.length;
    for (const [id, sec] of Object.entries(totals.byCategory)) byCategory[id] = (byCategory[id] ?? 0) + sec;
    dayRows.push({
      date: day.date,
      totalSec: totals.totalSec,
      byCategory: totals.byCategory,
      limitSec: day.limits.dailySec,
      overrides: day.overrides.length,
    });
    for (const e of day.events) {
      if (e.type === 'dailyLimit') limitHits.daily++;
      if (e.type === 'categoryLimit' && e.categoryId) {
        limitHits.category[e.categoryId] = (limitHits.category[e.categoryId] ?? 0) + 1;
      }
    }
    for (const [videoId, v] of Object.entries(day.videos)) {
      if (v.sec <= 0) continue;
      const meta = videoIndex[videoId];
      const categoryId = v.categoryId ?? BUILTIN_UNCATEGORIZED;
      const row = byVideo.get(videoId) ?? {
        videoId,
        title: meta?.title ?? videoId,
        channelId: meta?.channelId ?? '',
        channelName: meta?.channelName ?? 'Unknown channel',
        categoryId,
        sec: 0,
      };
      row.sec += v.sec;
      row.categoryId = categoryId;
      byVideo.set(videoId, row);
    }
  }

  for (const v of byVideo.values()) {
    const key = v.channelId || `name:${v.channelName}`;
    const row = byChannel.get(key) ?? { channelId: v.channelId, channelName: v.channelName, sec: 0, videos: 0 };
    row.sec += v.sec;
    row.videos += 1;
    byChannel.set(key, row);
  }

  const categories: ReportCategoryRow[] = Object.entries(byCategory)
    .map(([categoryId, sec]) => ({ categoryId, ...categoryLabel(config, categoryId), sec, share: totalSec > 0 ? sec / totalSec : 0 }))
    .sort((a, b) => b.sec - a.sec);

  return {
    from,
    to,
    totalSec,
    days: dayRows,
    categories,
    videos: [...byVideo.values()].sort((a, b) => b.sec - a.sec).slice(0, topN),
    channels: [...byChannel.values()].sort((a, b) => b.sec - a.sec).slice(0, topN),
    overrides,
    limitHits,
  };
}

/** CSV export of the per-day/per-category table. */
export function reportToCsv(report: Report, config: Config): string {
  const ids = Array.from(new Set(report.days.flatMap((d) => Object.keys(d.byCategory)))).sort();
  const header = ['date', 'total_sec', ...ids.map((id) => `${categoryLabel(config, id).name.replace(/[",\n]/g, ' ')}_sec`), 'limit_sec', 'overrides'];
  const lines = [header.join(',')];
  for (const d of report.days) {
    lines.push([d.date, Math.round(d.totalSec), ...ids.map((id) => Math.round(d.byCategory[id] ?? 0)), d.limitSec ?? '', d.overrides].join(','));
  }
  return lines.join('\n') + '\n';
}
