// Default configuration, seeding and normalisation/migration of stored config. Pure.
import { clip, isHexColor, isSafeKey, isStoredId } from './ids';
import {
  BUILTIN_BROWSING,
  BUILTIN_UNCATEGORIZED,
  type BlockedWindow,
  type Category,
  type CategoryId,
  type Config,
  type CountingMode,
  type OverlayCorner,
  type ShortsMode,
  type State,
  type DayKey,
} from './types';

export const SCHEMA_VERSION = 1;

const MAX_CATEGORIES = 100;
const MAX_CHANNEL_RULES = 5000;
const MAX_NAME = 60;
const MAX_CHANNEL_NAME = 120;

export const CATEGORY_COLORS = [
  '#42a5f5', '#66bb6a', '#ffa726', '#ab47bc', '#ef5350', '#26c6da', '#8d6e63', '#ec407a', '#9ccc65', '#5c6bc0',
];

export interface StarterCategory {
  id: CategoryId;
  name: string;
  color: string;
  /** Suggested own daily limit in minutes; null = bounded by the daily limit only. */
  limitMin: number | null;
  /** Ticked on the welcome page; these are also the categories of a config nobody has edited. */
  preselected: boolean;
}

/** The categories the welcome page offers. A new user ticks what fits and can add their own. */
export const STARTER_CATEGORIES: readonly StarterCategory[] = [
  { id: 'learning', name: 'Learning', color: '#42a5f5', limitMin: null, preselected: true },
  { id: 'entertainment', name: 'Entertainment', color: '#ffa726', limitMin: 60, preselected: true },
  { id: 'music', name: 'Music', color: '#ab47bc', limitMin: null, preselected: false },
  { id: 'news', name: 'News', color: '#26c6da', limitMin: null, preselected: false },
  { id: 'gaming', name: 'Gaming', color: '#66bb6a', limitMin: null, preselected: false },
  { id: 'work', name: 'Work', color: '#5c6bc0', limitMin: null, preselected: false },
];

export function builtinCategories(): Category[] {
  return [
    { id: BUILTIN_BROWSING, name: 'Browsing', color: '#8d6e63', limitMin: null, graceMin: null, builtin: 'browsing', order: 100 },
    { id: BUILTIN_UNCATEGORIZED, name: 'Uncategorized', color: '#9e9e9e', limitMin: null, graceMin: null, builtin: 'uncategorized', order: 101 },
  ];
}

export function defaultCategories(): Category[] {
  return [
    ...STARTER_CATEGORIES.filter((c) => c.preselected).map((c, order) => ({ id: c.id, name: c.name, color: c.color, limitMin: c.limitMin, graceMin: null, order })),
    ...builtinCategories(),
  ];
}

export function defaultConfig(): Config {
  return {
    schemaVersion: SCHEMA_VERSION,
    dailyLimitMin: 60,
    dayStartMinutes: 0,
    warnBeforeMin: 5,
    countingMode: 'visibleOrPlaying',
    heartbeatSec: 5,
    idleAfterSec: 120,
    categories: defaultCategories(),
    shortsMode: 'auto',
    shortsCategoryId: 'entertainment',
    channelRules: {},
    overrideMinutes: 15,
    overridesPerDay: 1,
    liveGraceMin: 30,
    maxGrandfatherMin: 240,
    showOverlayTimer: true,
    overlayCorner: 'tr',
    showSavedShelf: true,
    blockedWindows: [],
    feedbackReminders: true,
  };
}

export function newState(dayKey: DayKey): State {
  return {
    dayKey,
    lastCountedAt: 0,
    dailyBlock: null,
    categoryBlocks: {},
    override: null,
    warned: { daily: false, category: {}, schedule: {} },
    savedLinks: [],
    finishedVideos: [],
  };
}

const COUNTING_MODES: CountingMode[] = ['visibleOrPlaying', 'visibleOnly', 'playingOnly'];
const SHORTS_MODES: ShortsMode[] = ['auto', 'prompt', 'block'];

function num(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
function numOrNull(v: unknown, fallback: number | null, min = 0): number | null {
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback;
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/**
 * Turns whatever is in storage into a valid Config: fills defaults, clamps values, guarantees the built-in
 * categories exist and that referenced category ids resolve. Also the place for future schema migrations.
 */
export function normalizeConfig(raw: unknown): Config {
  const d = defaultConfig();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;

  const categories: Category[] = [];
  const seen = new Set<CategoryId>();
  if (Array.isArray(r.categories)) {
    for (const c of r.categories as unknown[]) {
      if (!c || typeof c !== 'object') continue;
      const cc = c as Record<string, unknown>;
      const id = str(cc.id, '');
      // Ids become object keys all over the accounting: an inherited name ("constructor") is never one.
      if (!isStoredId(id) || seen.has(id) || categories.length >= MAX_CATEGORIES) continue;
      seen.add(id);
      const builtin = cc.builtin === 'browsing' || cc.builtin === 'uncategorized' ? cc.builtin : undefined;
      const cat: Category = {
        id,
        name: clip(cc.name, MAX_NAME) ?? id,
        // Colours end up in style attributes: only "#rrggbb", as the colour picker produces.
        color: isHexColor(cc.color) ? cc.color : (CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length] ?? '#888888'),
        limitMin: builtin === 'uncategorized' ? null : numOrNull(cc.limitMin, null),
        graceMin: numOrNull(cc.graceMin, null),
        order: num(cc.order, builtin === 'browsing' ? 100 : builtin === 'uncategorized' ? 101 : categories.length),
      };
      if (builtin) cat.builtin = builtin;
      if (cc.archived === true && !builtin) cat.archived = true;
      categories.push(cat);
    }
  }
  for (const builtin of defaultCategories().filter((c) => c.builtin)) {
    if (!seen.has(builtin.id)) categories.push(builtin);
  }
  if (categories.filter((c) => !c.builtin).length === 0) {
    for (const c of defaultCategories().filter((c) => !c.builtin)) {
      if (!seen.has(c.id)) categories.unshift(c);
    }
  }
  categories.sort((a, b) => a.order - b.order);

  const selectable = categories.filter((c) => !c.builtin && !c.archived);
  const shortsCategoryId = (() => {
    const id = str(r.shortsCategoryId, '');
    if (id && categories.some((c) => c.id === id && c.builtin !== 'uncategorized')) return id;
    return selectable.find((c) => c.id === 'entertainment')?.id ?? selectable[0]?.id ?? categories[0]!.id;
  })();

  const channelRules: Config['channelRules'] = {};
  if (r.channelRules && typeof r.channelRules === 'object') {
    let rules = 0;
    for (const [channelId, rule] of Object.entries(r.channelRules as Record<string, unknown>)) {
      if (!rule || typeof rule !== 'object' || !isStoredId(channelId) || rules >= MAX_CHANNEL_RULES) continue;
      const rr = rule as Record<string, unknown>;
      const categoryId = str(rr.categoryId, '');
      if (!categoryId || !categories.some((c) => c.id === categoryId)) continue;
      channelRules[channelId] = {
        categoryId,
        channelName: clip(rr.channelName, MAX_CHANNEL_NAME) ?? channelId,
        createdAt: num(rr.createdAt, 0),
      };
      rules++;
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    dailyLimitMin: numOrNull(r.dailyLimitMin, d.dailyLimitMin),
    dayStartMinutes: num(r.dayStartMinutes, d.dayStartMinutes, 0, 23 * 60 + 59),
    warnBeforeMin: num(r.warnBeforeMin, d.warnBeforeMin, 0, 600),
    countingMode: COUNTING_MODES.includes(r.countingMode as CountingMode) ? (r.countingMode as CountingMode) : d.countingMode,
    heartbeatSec: num(r.heartbeatSec, d.heartbeatSec, 2, 60),
    idleAfterSec: num(r.idleAfterSec, d.idleAfterSec, 15, 3600),
    categories,
    shortsMode: SHORTS_MODES.includes(r.shortsMode as ShortsMode) ? (r.shortsMode as ShortsMode) : d.shortsMode,
    shortsCategoryId,
    channelRules,
    overrideMinutes: num(r.overrideMinutes, d.overrideMinutes, 1, 240),
    overridesPerDay: num(r.overridesPerDay, d.overridesPerDay, 0, 10),
    liveGraceMin: num(r.liveGraceMin, d.liveGraceMin, 1, 600),
    maxGrandfatherMin: num(r.maxGrandfatherMin, d.maxGrandfatherMin, 1, 1440),
    showOverlayTimer: typeof r.showOverlayTimer === 'boolean' ? r.showOverlayTimer : d.showOverlayTimer,
    overlayCorner: (['tr', 'tl', 'br', 'bl'] as OverlayCorner[]).includes(r.overlayCorner as OverlayCorner)
      ? (r.overlayCorner as OverlayCorner)
      : d.overlayCorner,
    showSavedShelf: typeof r.showSavedShelf === 'boolean' ? r.showSavedShelf : d.showSavedShelf,
    blockedWindows: normalizeWindows(r.blockedWindows),
    feedbackReminders: typeof r.feedbackReminders === 'boolean' ? r.feedbackReminders : d.feedbackReminders,
  };
}

export function normalizeWindows(raw: unknown): BlockedWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockedWindow[] = [];
  const seen = new Set<string>();
  for (const w of raw as unknown[]) {
    if (!w || typeof w !== 'object') continue;
    const ww = w as Record<string, unknown>;
    const fromMin = num(ww.fromMin, -1, 0, 1439);
    const toMin = num(ww.toMin, -1, 0, 1439);
    if (fromMin < 0 || toMin < 0 || fromMin === toMin) continue;
    const key = `${fromMin}|${toMin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fromMin, toMin });
  }
  return out;
}

export function categoryById(config: Config, id: CategoryId | null | undefined): Category | undefined {
  if (!id) return undefined;
  return config.categories.find((c) => c.id === id);
}

/** Categories offered in the prompt, in display order. */
export function selectableCategories(config: Config): Category[] {
  return config.categories.filter((c) => !c.archived && c.builtin !== 'uncategorized' && c.builtin !== 'browsing');
}

let idCounter = 0;
export function newCategoryId(name: string, existing: Category[]): CategoryId {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || 'category';
  // A name every object inherits ("constructor") must not become an id.
  if (!isSafeKey(base)) base = `${base}-category`;
  let id = base;
  while (existing.some((c) => c.id === id)) id = `${base}-${++idCounter}`;
  return id;
}
