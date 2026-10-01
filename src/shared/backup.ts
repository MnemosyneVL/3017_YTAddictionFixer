// Reading a backup file. Everything is validated and rebuilt here, before anything in storage is touched. Pure.
import { normalizeConfig } from './config';
import { DAY_KEY_PREFIX, KEY_CONFIG, KEY_STATE, KEY_VIDEO_INDEX } from './constants';
import { isDayKey } from './ids';
import { normalizeDay, normalizeState, normalizeVideoIndex } from './normalize';
import { dayKeyFor } from './time';
import type { Millis } from './types';

export interface Backup {
  /** Storage items to write: `config`, `state`, `videoIndex` and one `day:YYYY-MM-DD` item per day. */
  items: Record<string, unknown>;
  days: number;
  videos: number;
  savedLinks: number;
}

export type BackupResult = { ok: true; backup: Backup } | { ok: false; error: string };

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/**
 * Parses an exported backup (`{ app, exportedAt, data }`, or the bare storage object) into sanitized storage
 * items. Unknown keys are ignored; every item goes through the same normalisers as data read from storage.
 */
export function parseBackup(json: string, now: Millis): BackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
  const root = obj(parsed);
  const data = obj(root?.data) ?? root;
  if (!data || !obj(data[KEY_CONFIG])) return { ok: false, error: 'This does not look like a backup of this extension' };

  const config = normalizeConfig(data[KEY_CONFIG]);
  const state = normalizeState(data[KEY_STATE], dayKeyFor(now, config.dayStartMinutes));
  const videoIndex = normalizeVideoIndex(data[KEY_VIDEO_INDEX]);
  const items: Record<string, unknown> = { [KEY_CONFIG]: config, [KEY_STATE]: state, [KEY_VIDEO_INDEX]: videoIndex };

  let days = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(DAY_KEY_PREFIX)) continue;
    const dayKey = key.slice(DAY_KEY_PREFIX.length);
    if (!isDayKey(dayKey) || !obj(value)) continue;
    items[key] = normalizeDay(value, config, dayKey);
    days++;
  }
  return { ok: true, backup: { items, days, videos: Object.keys(videoIndex).length, savedLinks: state.savedLinks.length } };
}
