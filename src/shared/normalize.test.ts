import { describe, expect, it } from 'vitest';
import { defaultConfig, newState } from './config';
import { newDayRecord } from './day';
import { normalizeDay, normalizeState, normalizeVideoIndex, sanitizeSavedLinks } from './normalize';

const DAY = '2026-08-23';
const VIDEO = 'dQw4w9WgXcQ';
const watch = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** Parsed like data read from storage or a backup file: "__proto__" arrives as an own key. */
function stored(json: string): unknown {
  return JSON.parse(json);
}

describe('sanitizeSavedLinks', () => {
  it('keeps http(s) YouTube video links and takes the id from the URL', () => {
    const links = sanitizeSavedLinks([
      { url: watch(VIDEO), videoId: 'somethingelse', title: 'A', savedAt: 5, reason: 'category' },
      { url: 'https://www.youtube.com/shorts/aaaaaaaaaaa', savedAt: 6, reason: 'bogus' },
    ]);
    expect(links).toEqual([
      { url: watch(VIDEO), videoId: VIDEO, title: 'A', savedAt: 5, reason: 'category' },
      { url: 'https://www.youtube.com/shorts/aaaaaaaaaaa', videoId: 'aaaaaaaaaaa', savedAt: 6, reason: 'daily' },
    ]);
  });

  it('drops script URLs, other sites, non-video pages, duplicates and junk', () => {
    const links = sanitizeSavedLinks([
      { url: `javascript://www.youtube.com/watch?x=%0aalert(1)//&v=${VIDEO}` },
      { url: 'https://example.com/watch?v=aaaaaaaaaaa' },
      { url: 'https://www.youtube.com/feed/subscriptions' },
      { url: watch('bbbbbbbbbbb') },
      { url: `${watch('bbbbbbbbbbb')}&t=5` },
      { url: 42 },
      null,
      'text',
    ]);
    expect(links.map((l) => l.videoId)).toEqual(['bbbbbbbbbbb']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ url: watch(`v${String(i).padStart(10, '0')}`) }));
    expect(sanitizeSavedLinks(many)).toHaveLength(500);
    expect(sanitizeSavedLinks('nope')).toEqual([]);
  });
});

describe('normalizeState', () => {
  it('returns a fresh state for garbage', () => {
    expect(normalizeState(undefined, DAY)).toEqual(newState(DAY));
    expect(normalizeState('x', DAY)).toEqual(newState(DAY));
    expect(normalizeState([], DAY)).toEqual(newState(DAY));
  });

  it('keeps well-formed state', () => {
    const state = {
      dayKey: DAY,
      lastCountedAt: 123,
      dailyBlock: { since: 100, grandfathers: [{ videoId: VIDEO, budgetSec: 90 }] },
      categoryBlocks: { entertainment: { since: 50, grandfathers: [] } },
      override: { startedAt: 10, until: 20 },
      warned: { daily: true, category: { entertainment: true }, schedule: { '1380-420': true } },
      savedLinks: [{ url: watch(VIDEO), videoId: VIDEO, title: 'T', savedAt: 7, reason: 'daily' }],
      finishedVideos: [VIDEO],
    };
    expect(normalizeState(state, '2026-01-01')).toEqual(state);
  });

  it('never lets an inherited name become a key or a block', () => {
    const s = normalizeState(
      stored(`{
        "categoryBlocks": { "constructor": { "since": 1, "grandfathers": [] }, "__proto__": { "since": 1 }, "learning": { "since": 2 } },
        "warned": { "daily": 1, "category": { "__proto__": true, "learning": true, "music": "yes" } },
        "finishedVideos": ["${VIDEO}", "constructor", 7]
      }`),
      DAY,
    );
    expect(Object.keys(s.categoryBlocks)).toEqual(['learning']);
    expect(s.categoryBlocks['learning']).toEqual({ since: 2, grandfathers: [] });
    expect(Object.getPrototypeOf(s.categoryBlocks)).toBe(Object.prototype);
    expect(s.warned).toEqual({ daily: false, category: { learning: true }, schedule: {} });
    expect(s.finishedVideos).toEqual([VIDEO]);
  });

  it('repairs blocks, the override and the day key', () => {
    const s = normalizeState(
      {
        dayKey: 'yesterday',
        lastCountedAt: 'soon',
        dailyBlock: { grandfathers: [{ videoId: VIDEO, budgetSec: -5 }, { videoId: VIDEO, budgetSec: 30 }, 'x'] },
        override: { startedAt: 1 },
      },
      DAY,
    );
    expect(s.dayKey).toBe(DAY);
    expect(s.lastCountedAt).toBe(0);
    expect(s.dailyBlock).toEqual({ since: 0, grandfathers: [{ videoId: VIDEO, budgetSec: 30 }] });
    expect(s.override).toBeNull();
  });
});

describe('normalizeDay', () => {
  const config = defaultConfig();

  it('returns a fresh record for garbage', () => {
    expect(normalizeDay(null, config, DAY)).toEqual(newDayRecord(config, DAY));
  });

  it('keeps a well-formed record and always uses the requested date', () => {
    const day = {
      date: 'whatever',
      videos: { [VIDEO]: { categoryId: 'learning', sec: 120, firstAt: 1, lastAt: 2 }, v1: { categoryId: null, sec: 5, firstAt: 3, lastAt: 4 } },
      browsingSec: 60,
      limits: { dailySec: 3600, category: { learning: null, entertainment: 1800 }, windows: [{ fromMin: 60, toMin: 120 }] },
      overrides: [{ at: 9, minutes: 15 }],
      events: [{ at: 9, type: 'override', minutes: 15 }, { at: 10, type: 'categoryLimit', categoryId: 'entertainment' }],
    };
    expect(normalizeDay(day, config, DAY)).toEqual({ ...day, date: DAY });
  });

  it('drops unsafe keys, unknown events and malformed numbers', () => {
    const d = normalizeDay(
      stored(`{
        "videos": { "__proto__": { "sec": 5 }, "constructor": { "sec": 5 }, "${VIDEO}": { "categoryId": "constructor", "sec": "many" } },
        "browsingSec": -3,
        "limits": { "dailySec": "lots", "category": { "__proto__": 5, "learning": "x", "music": 600 }, "windows": [{ "fromMin": 5, "toMin": 5 }] },
        "overrides": [{ "at": 1, "minutes": 15 }, "x"],
        "events": [{ "type": "hack" }, { "at": 1, "type": "dailyLimit", "categoryId": "__proto__" }]
      }`),
      config,
      DAY,
    );
    expect(Object.keys(d.videos)).toEqual([VIDEO]);
    expect(d.videos[VIDEO]).toEqual({ categoryId: null, sec: 0, firstAt: 0, lastAt: 0 });
    expect(d.browsingSec).toBe(0);
    expect(d.limits).toEqual({ dailySec: null, category: { music: 600 }, windows: [] });
    expect(d.overrides).toEqual([{ at: 1, minutes: 15 }]);
    expect(d.events).toEqual([{ at: 1, type: 'dailyLimit' }]);
    expect(({} as Record<string, unknown>).sec).toBeUndefined();
  });
});

describe('normalizeVideoIndex', () => {
  it('keeps entries under safe keys and clips text', () => {
    const index = normalizeVideoIndex(
      stored(`{
        "${VIDEO}": { "categoryId": "learning", "title": "T", "channelId": "UC1", "channelName": "C", "at": 5, "extra": 1 },
        "v1": { "title": "${'t'.repeat(400)}" },
        "__proto__": { "title": "polluted" },
        "constructor": { "title": "x" },
        "junk": 7
      }`),
    );
    expect(Object.keys(index).sort()).toEqual([VIDEO, 'v1'].sort());
    expect(index[VIDEO]).toEqual({ categoryId: 'learning', title: 'T', channelId: 'UC1', channelName: 'C', at: 5 });
    expect(index['v1']!.title).toHaveLength(300);
    expect(index['v1']!.at).toBe(0);
    expect(({} as Record<string, unknown>).title).toBeUndefined();
    expect(normalizeVideoIndex(null)).toEqual({});
    expect(normalizeVideoIndex(['a'])).toEqual({});
  });
});
