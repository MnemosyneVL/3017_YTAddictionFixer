import { describe, expect, it } from 'vitest';
import { clip, finite, isCategoryId, isChannelId, isDayKey, isHexColor, isSafeKey, isStoredId, isVideoId } from './ids';

describe('isSafeKey', () => {
  it('rejects names every object inherits', () => {
    for (const k of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', '__defineGetter__']) {
      expect(isSafeKey(k), k).toBe(false);
    }
  });

  it('accepts ordinary keys and rejects non-strings and the empty string', () => {
    expect(isSafeKey('learning')).toBe(true);
    expect(isSafeKey('v1')).toBe(true);
    expect(isSafeKey('')).toBe(false);
    expect(isSafeKey(42)).toBe(false);
    expect(isSafeKey(null)).toBe(false);
  });
});

describe('isVideoId', () => {
  it('accepts 11-character ids', () => {
    expect(isVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(isVideoId('a-b_c-d_e-f')).toBe(true);
  });

  it('rejects wrong lengths, other characters and "constructor" (11 letters, but inherited)', () => {
    expect(isVideoId('dQw4w9WgXc')).toBe(false);
    expect(isVideoId('dQw4w9WgXcQQ')).toBe(false);
    expect(isVideoId('dQw4w9WgXc!')).toBe(false);
    expect(isVideoId('constructor')).toBe(false);
    expect(isVideoId('__proto__')).toBe(false);
    expect(isVideoId(undefined)).toBe(false);
  });
});

describe('channel, category and stored ids', () => {
  it('accepts token-like ids up to 64 characters', () => {
    expect(isChannelId('UCuAXFkgsw1L7xaCfnd5JJOw')).toBe(true);
    expect(isChannelId('UC1')).toBe(true);
    expect(isCategoryId('music-podcasts')).toBe(true);
    expect(isCategoryId('a'.repeat(64))).toBe(true);
  });

  it('rejects inherited names, spaces and over-long values', () => {
    expect(isChannelId('constructor')).toBe(false);
    expect(isCategoryId('toString')).toBe(false);
    expect(isCategoryId('two words')).toBe(false);
    expect(isCategoryId('a'.repeat(65))).toBe(false);
    expect(isChannelId('')).toBe(false);
  });

  it('keeps unusual ids that are already stored, as long as they are safe keys', () => {
    expect(isStoredId('v1')).toBe(true);
    expect(isStoredId('a'.repeat(120))).toBe(true);
    expect(isStoredId('a'.repeat(201))).toBe(false);
    expect(isStoredId('constructor')).toBe(false);
  });
});

describe('isDayKey / isHexColor', () => {
  it('matches the storage formats only', () => {
    expect(isDayKey('2026-08-23')).toBe(true);
    expect(isDayKey('2026-8-23')).toBe(false);
    expect(isDayKey('day:2026-08-23')).toBe(false);
    expect(isHexColor('#42a5f5')).toBe(true);
    expect(isHexColor('#FFF')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('url(https://example.com/x)')).toBe(false);
  });
});

describe('clip / finite', () => {
  it('cuts long strings and drops everything that is not a non-empty string', () => {
    expect(clip('abcdef', 3)).toBe('abc');
    expect(clip('abc', 3)).toBe('abc');
    expect(clip('', 3)).toBeUndefined();
    expect(clip(5, 3)).toBeUndefined();
    expect(clip({ toString: () => 'x' }, 3)).toBeUndefined();
  });

  it('keeps finite numbers inside the range', () => {
    expect(finite(5, 0, 10)).toBe(5);
    expect(finite(-1, 0, 10)).toBeUndefined();
    expect(finite(Infinity)).toBeUndefined();
    expect(finite(NaN)).toBeUndefined();
    expect(finite('5')).toBeUndefined();
  });
});
