// In-memory cache of everything the service worker needs, loaded once per worker lifetime, persisted
// after every mutation. Handlers run through `enqueue()` so they never interleave.
import { normalizeConfig } from '../shared/config';
import { KEY_CONFIG, KEY_META, KEY_STATE, KEY_TABS, KEY_VIDEO_INDEX, TAB_STALE_MS, dayStorageKey } from '../shared/constants';
import { rollover } from '../shared/day';
import { normalizeDay, normalizeState, normalizeVideoIndex } from '../shared/normalize';
import { normalizeMeta, type Meta } from '../shared/onboarding';
import { dayKeyFor } from '../shared/time';
import type { Config, DayRecord, IdleState, Millis, State, TabRecord, VideoIndex } from '../shared/types';

export interface Store {
  config: Config;
  state: State;
  day: DayRecord;
  videoIndex: VideoIndex;
  /** First-run state of this installation (setup finished or pending). */
  meta: Meta;
  tabs: Record<number, TabRecord>;
  idle: IdleState;
}

export type PersistKey = 'config' | 'state' | 'day' | 'videoIndex' | 'meta' | 'tabs';

let store: Store | null = null;
let loading: Promise<Store> | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function load(): Promise<Store> {
  const now = Date.now();
  const local = await chrome.storage.local.get([KEY_CONFIG, KEY_STATE, KEY_VIDEO_INDEX, KEY_META]);
  const config = normalizeConfig(local[KEY_CONFIG]);
  // Settings without `meta` belong to an installation older than the setup step: it is not sent through it.
  const meta = normalizeMeta(local[KEY_META], { existingInstall: !!local[KEY_CONFIG], now });
  const todayKey = dayKeyFor(now, config.dayStartMinutes);
  const state = normalizeState(local[KEY_STATE], todayKey);
  const dayRaw = (await chrome.storage.local.get(dayStorageKey(state.dayKey)))[dayStorageKey(state.dayKey)];
  let day = normalizeDay(dayRaw, config, state.dayKey);
  const videoIndex = normalizeVideoIndex(local[KEY_VIDEO_INDEX]);

  let tabs: Record<number, TabRecord> = {};
  let idle: IdleState = 'active';
  try {
    const session = await chrome.storage.session.get([KEY_TABS, 'idle']);
    if (session[KEY_TABS] && typeof session[KEY_TABS] === 'object') tabs = session[KEY_TABS] as Record<number, TabRecord>;
    if (session['idle'] === 'idle' || session['idle'] === 'locked') idle = session['idle'];
  } catch {
    // session storage unavailable (should not happen in MV3)
  }

  const s: Store = { config, state, day, videoIndex, meta, tabs, idle };
  if (state.dayKey !== todayKey) {
    day = rollover(state, config, todayKey, now);
    s.day = day;
    await persist(s, ['state', 'day']);
  } else if (!dayRaw) {
    await persist(s, ['state', 'day']);
  }
  if (!local[KEY_CONFIG]) await persist(s, ['config']);
  if (!local[KEY_META]) await persist(s, ['meta']);
  store = s;
  return s;
}

/** Resolves once storage has been read into memory. Safe to call from every handler. */
export function ready(): Promise<Store> {
  if (!loading) loading = load();
  return loading;
}

/** Runs `fn` after the store is ready and after every previously enqueued handler has finished. */
export function enqueue<T>(fn: (s: Store) => Promise<T> | T): Promise<T> {
  const run = chain.then(ready).then(fn);
  chain = run.catch(() => undefined);
  return run;
}

export async function persist(s: Store, keys: PersistKey[]): Promise<void> {
  const local: Record<string, unknown> = {};
  let tabs = false;
  for (const k of keys) {
    if (k === 'config') local[KEY_CONFIG] = s.config;
    else if (k === 'state') local[KEY_STATE] = s.state;
    else if (k === 'day') local[dayStorageKey(s.day.date)] = s.day;
    else if (k === 'videoIndex') local[KEY_VIDEO_INDEX] = s.videoIndex;
    else if (k === 'meta') local[KEY_META] = s.meta;
    else if (k === 'tabs') tabs = true;
  }
  const ops: Promise<void>[] = [];
  if (Object.keys(local).length) ops.push(chrome.storage.local.set(local));
  if (tabs) ops.push(chrome.storage.session.set({ [KEY_TABS]: s.tabs }).catch(() => undefined));
  await Promise.all(ops);
}

/** Rolls the day over if the boundary has passed. Returns true if a new day started. */
export async function ensureDay(s: Store, now: Millis): Promise<boolean> {
  const key = dayKeyFor(now, s.config.dayStartMinutes);
  if (key === s.state.dayKey) return false;
  s.day = rollover(s.state, s.config, key, now);
  await persist(s, ['state', 'day']);
  return true;
}

/** Forgets tab records that have not reported for a long time. */
export function pruneTabs(s: Store, now: Millis): boolean {
  let changed = false;
  for (const [id, t] of Object.entries(s.tabs)) {
    if (now - t.at > TAB_STALE_MS) {
      delete s.tabs[Number(id)];
      changed = true;
    }
  }
  return changed;
}

export async function setIdle(s: Store, idle: IdleState): Promise<void> {
  s.idle = idle;
  await chrome.storage.session.set({ idle }).catch(() => undefined);
}

export async function loadDays(keys: string[]): Promise<DayRecord[]> {
  if (keys.length === 0) return [];
  const raw = await chrome.storage.local.get(keys.map(dayStorageKey));
  const s = await ready();
  return keys
    .filter((k) => raw[dayStorageKey(k)])
    .map((k) => (k === s.day.date ? s.day : normalizeDay(raw[dayStorageKey(k)], s.config, k)));
}

/** Drops the in-memory cache and reads storage again (after import/clear). */
export function reload(): Promise<Store> {
  store = null;
  loading = load();
  return loading;
}

export function currentStore(): Store | null {
  return store;
}
