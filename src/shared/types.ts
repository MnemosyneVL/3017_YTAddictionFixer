// Core data types. Pure: no chrome.*, no DOM.

export type CategoryId = string;
export type VideoId = string;
/** Local calendar day, "YYYY-MM-DD", shifted by the configured day start. */
export type DayKey = string;
/** Epoch milliseconds. */
export type Millis = number;

export const BUILTIN_BROWSING: CategoryId = 'browsing';
export const BUILTIN_UNCATEGORIZED: CategoryId = 'uncategorized';

export type CountingMode = 'visibleOrPlaying' | 'visibleOnly' | 'playingOnly';
export type OverlayCorner = 'tr' | 'tl' | 'br' | 'bl';
export type ShortsMode = 'auto' | 'prompt' | 'block';
export type IdleState = 'active' | 'idle' | 'locked';

export interface Category {
  id: CategoryId;
  name: string;
  /** CSS color, e.g. "#4caf50". */
  color: string;
  /** Daily limit in minutes; null = unlimited (bounded only by the daily limit). */
  limitMin: number | null;
  /** Built-in categories cannot be deleted; "uncategorized" cannot be selected or limited. */
  builtin?: 'browsing' | 'uncategorized';
  /** Archived categories are hidden from the prompt but keep their history. */
  archived?: boolean;
  /** Once a limit trips, how long the current video of this category may keep playing:
   *  null = until the end of the video; N = at most N more minutes; 0 = stop immediately. */
  graceMin: number | null;
  order: number;
}

export interface ChannelRule {
  categoryId: CategoryId;
  channelName: string;
  createdAt: Millis;
}

export interface Config {
  schemaVersion: number;
  /** Daily limit in minutes; null = no daily limit. */
  dailyLimitMin: number | null;
  /** Minutes after local midnight at which a new day starts (0 = midnight, 240 = 04:00). */
  dayStartMinutes: number;
  /** Warn this many minutes before a limit is reached (0 = no warning). */
  warnBeforeMin: number;
  countingMode: CountingMode;
  heartbeatSec: number;
  /** Non-playing visible time stops counting after this many seconds without input. */
  idleAfterSec: number;
  categories: Category[];
  shortsMode: ShortsMode;
  shortsCategoryId: CategoryId;
  channelRules: Record<string, ChannelRule>;
  overrideMinutes: number;
  overridesPerDay: number;
  /** Allowance for a grandfathered live stream / video with unknown duration, minutes. */
  liveGraceMin: number;
  /** Absolute cap for any grandfather budget, minutes. */
  maxGrandfatherMin: number;
  /** Show the timer pill on top of videos. */
  showOverlayTimer: boolean;
  overlayCorner: OverlayCorner;
  /** Show the saved-for-later shelf at the top of the home and subscriptions feeds. */
  showSavedShelf: boolean;
  /** Clock windows during which all of YouTube is blocked (hard cutoff, override exempt). */
  blockedWindows: BlockedWindow[];
  /** Show the "did it help?" note after a week, a month and three months of use. */
  feedbackReminders: boolean;
}

export type BlockReason = 'daily' | 'category' | 'shorts' | 'schedule';

/** Clock window in local wall-clock minutes since midnight; fromMin > toMin wraps past midnight. */
export interface BlockedWindow {
  fromMin: number;
  toMin: number;
}

export interface Grandfather {
  videoId: VideoId;
  /** Seconds of playback still allowed for this video. */
  budgetSec: number;
}

export interface Block {
  since: Millis;
  grandfathers: Grandfather[];
}

export interface SavedLink {
  url: string;
  videoId?: VideoId;
  title?: string;
  savedAt: Millis;
  reason: BlockReason;
}

export interface State {
  dayKey: DayKey;
  lastCountedAt: Millis;
  dailyBlock: Block | null;
  categoryBlocks: Record<CategoryId, Block>;
  override: { startedAt: Millis; until: Millis } | null;
  warned: { daily: boolean; category: Record<CategoryId, boolean>; schedule: Record<string, boolean> };
  savedLinks: SavedLink[];
  /** Videos whose grandfathered playback reached its natural end today (never auto-saved for later). */
  finishedVideos: VideoId[];
}

export interface DayVideo {
  /** null = not categorized yet. */
  categoryId: CategoryId | null;
  sec: number;
  firstAt: Millis;
  lastAt: Millis;
}

export interface DayLimits {
  /** Effective daily limit for this day in seconds; null = unlimited. */
  dailySec: number | null;
  /** Effective per-category limits in seconds; missing or null = unlimited. */
  category: Record<CategoryId, number | null>;
  /** Effective blocked-hours windows for this day. */
  windows: BlockedWindow[];
}

export type DayEventType = 'dailyWarning' | 'dailyLimit' | 'categoryWarning' | 'categoryLimit' | 'override';

export interface DayEvent {
  at: Millis;
  type: DayEventType;
  categoryId?: CategoryId;
  minutes?: number;
}

export interface DayRecord {
  date: DayKey;
  videos: Record<VideoId, DayVideo>;
  /** Seconds spent on YouTube pages that are not a video (feed, search, channel pages). */
  browsingSec: number;
  limits: DayLimits;
  overrides: { at: Millis; minutes: number }[];
  events: DayEvent[];
}

export interface VideoIndexEntry {
  categoryId?: CategoryId;
  title?: string;
  channelId?: string;
  channelName?: string;
  /** Last update, epoch ms. */
  at: Millis;
}
export type VideoIndex = Record<VideoId, VideoIndexEntry>;

/** What a credited time interval is attributed to. */
export type Attribution =
  | { kind: 'video'; videoId: VideoId }
  | { kind: 'browsing' }
  | { kind: 'none' };

/** Sent by the content script every few seconds and on state changes. */
export interface Heartbeat {
  url: string;
  visible: boolean;
  pip: boolean;
  playing: boolean;
  focused: boolean;
  fullscreen: boolean;
  /** Video currently loaded in the player (may differ from the URL, e.g. miniplayer). */
  playerVideoId: VideoId | null;
  isLive: boolean;
  /** Finite seconds or null if unknown / live. */
  duration: number | null;
  currentTime: number | null;
  ended: boolean;
  adShowing: boolean;
}

/** Per-tab memory of the last heartbeat (service-worker registry, session storage). */
export interface TabRecord {
  tabId: number;
  url: string;
  /** When the last heartbeat arrived. */
  at: Millis;
  /** Whether the last heartbeat's state counts as YouTube time. */
  counts: boolean;
  attribution: Attribution;
  playing: boolean;
  playerVideoId: VideoId | null;
  isLive: boolean;
  duration: number | null;
  currentTime: number | null;
}

export type Decision =
  | { action: 'allow'; categoryId: CategoryId | null }
  | { action: 'prompt' }
  | { action: 'block'; reason: BlockReason; categoryId?: CategoryId };
