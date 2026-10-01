// Data for the on-video timer pill. Pure.
import { categoryById } from './config';
import { dayTotals } from './day';
import type { CategoryId, Config, DayRecord, OverlayCorner } from './types';

export interface OverlayLine {
  usedSec: number;
  /** null = unlimited. */
  limitSec: number | null;
  /** Within the warning window (or over the limit). */
  warn: boolean;
}

export interface OverlayInfo {
  corner: OverlayCorner;
  /** Whether time is currently being counted (drives the local per-second tick). */
  counts: boolean;
  daily: OverlayLine;
  category?: OverlayLine & { name: string; color: string };
}

function line(usedSec: number, limitSec: number | null, warnSec: number): OverlayLine {
  return {
    usedSec,
    limitSec,
    warn: limitSec !== null && limitSec - usedSec <= warnSec,
  };
}

/** Returns the pill contents for a video page, or null when the feature is off. */
export function overlayInfo(config: Config, day: DayRecord, categoryId: CategoryId | null, counts: boolean): OverlayInfo | null {
  if (!config.showOverlayTimer) return null;
  const totals = dayTotals(day);
  const warnSec = config.warnBeforeMin * 60;
  const info: OverlayInfo = {
    corner: config.overlayCorner,
    counts,
    daily: line(totals.totalSec, day.limits.dailySec, warnSec),
  };
  const cat = categoryById(config, categoryId);
  if (cat && cat.builtin !== 'uncategorized') {
    info.category = {
      ...line(totals.byCategory[cat.id] ?? 0, day.limits.category[cat.id] ?? null, warnSec),
      name: cat.name,
      color: cat.color,
    };
  }
  return info;
}
