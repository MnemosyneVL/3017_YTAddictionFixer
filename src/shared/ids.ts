// Validators for values that cross a trust boundary or become object keys. Pure.

/**
 * True for a string that is safe to use as a key of a plain object: every plain object inherits names such as
 * "constructor", "toString" and "__proto__", and a lookup or assignment with one of them reaches the prototype
 * instead of the data ("constructor" even has the 11 characters of a video id).
 */
export function isSafeKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && !(key in Object.prototype);
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isVideoId(v: unknown): v is string {
  return typeof v === 'string' && VIDEO_ID.test(v) && isSafeKey(v);
}

/** Channel ids are "UC" + 22 characters on YouTube; anything token-like is accepted, it is only ever a key. */
export function isChannelId(v: unknown): v is string {
  return typeof v === 'string' && TOKEN.test(v) && isSafeKey(v);
}

/** Category ids are slugs made by `newCategoryId`; ids already in storage may be longer, see `isStoredId`. */
export function isCategoryId(v: unknown): v is string {
  return typeof v === 'string' && TOKEN.test(v) && isSafeKey(v);
}

/** Looser rule for ids that are already in storage: any safe key of sane length keeps the user's history. */
export function isStoredId(v: unknown): v is string {
  return isSafeKey(v) && v.length <= 200;
}

export function isDayKey(v: unknown): v is string {
  return typeof v === 'string' && DAY_KEY.test(v);
}

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_COLOR.test(v);
}

/** A non-empty string cut to `max` characters, or undefined for anything else. */
export function clip(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

/** A finite number within [min, max], or undefined. */
export function finite(v: unknown, min = -Infinity, max = Infinity): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}
