// Shared constants.
export const HEARTBEAT_SEC = 5;
/** Tab registry entries older than this are ignored/pruned (tab closed without onRemoved, SW restart…). */
export const TAB_STALE_MS = 10 * 60 * 1000;
/** How long to wait for the MAIN-world bridge to report channel info before showing the prompt. */
export const BRIDGE_WAIT_MS = 2500;
/** Storage keys. */
export const KEY_CONFIG = 'config';
export const KEY_STATE = 'state';
export const KEY_VIDEO_INDEX = 'videoIndex';
export const KEY_TABS = 'tabs';
/** First-run state and other bookkeeping of this installation (src/shared/onboarding.ts). */
export const KEY_META = 'meta';
export const DAY_KEY_PREFIX = 'day:';
export function dayStorageKey(dayKey: string): string {
  return DAY_KEY_PREFIX + dayKey;
}
/** Alarm names. */
export const ALARM_ROLLOVER = 'rollover';
export const ALARM_OVERRIDE = 'override-end';
export const ALARM_SCHEDULE = 'schedule-boundary';
/** Notification ids. */
export const NOTIFY_DAILY = 'daily';
export const NOTIFY_CATEGORY = 'category:';
/** Newest saved-for-later links shown on the feed shelf. */
export const SHELF_ITEMS = 12;
