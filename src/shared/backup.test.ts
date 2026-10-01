import { describe, expect, it } from 'vitest';
import { parseBackup } from './backup';
import { defaultConfig, newState } from './config';
import { newDayRecord } from './day';
import { T0 } from './fixtures';

const VIDEO = 'dQw4w9WgXcQ';

function sample(): Record<string, unknown> {
  const config = defaultConfig();
  const day = newDayRecord(config, '2026-08-22');
  day.videos[VIDEO] = { categoryId: 'learning', sec: 300, firstAt: 1, lastAt: 2 };
  const state = newState('2026-08-23');
  state.savedLinks = [{ url: `https://www.youtube.com/watch?v=${VIDEO}`, videoId: VIDEO, title: 'T', savedAt: 5, reason: 'daily' }];
  return {
    config,
    state,
    videoIndex: { [VIDEO]: { categoryId: 'learning', title: 'T', channelId: 'UC1', channelName: 'C', at: 9 } },
    'day:2026-08-22': day,
    'day:2026-08-23': newDayRecord(config, '2026-08-23'),
  };
}

describe('parseBackup', () => {
  it('reads an export wrapper and the bare storage object alike', () => {
    const data = sample();
    for (const json of [JSON.stringify({ app: 'youtube-budget', exportedAt: 'x', data }), JSON.stringify(data)]) {
      const r = parseBackup(json, T0);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.backup.days).toBe(2);
      expect(r.backup.videos).toBe(1);
      expect(r.backup.savedLinks).toBe(1);
      expect(r.backup.items).toEqual(data);
    }
  });

  it('refuses text that is not JSON or has no settings', () => {
    expect(parseBackup('not json', T0)).toEqual({ ok: false, error: 'Not valid JSON' });
    for (const json of ['{"x":1}', '[]', '"text"', 'null', '{"config":"x"}', '{"data":{"state":{}}}']) {
      const r = parseBackup(json, T0);
      expect(r.ok, json).toBe(false);
    }
  });

  it('ignores unknown keys and malformed day keys', () => {
    const r = parseBackup(
      JSON.stringify({ ...sample(), tabs: { 1: {} }, meta: { setupAt: 1 }, 'day:tomorrow': {}, 'day:2026-08-21': 'x', '__proto__x': 1 }),
      T0,
    );
    expect(r.ok && Object.keys(r.backup.items).sort()).toEqual(['config', 'day:2026-08-22', 'day:2026-08-23', 'state', 'videoIndex']);
  });

  it('sanitizes what it keeps', () => {
    const data = sample() as { config: { categories: { color: string }[] }; state: { savedLinks: unknown[] }; videoIndex: Record<string, unknown> };
    data.config.categories[0]!.color = 'url(https://example.com/x)';
    data.state.savedLinks.unshift({ url: `javascript://www.youtube.com/watch?x=%0aalert(1)//&v=${VIDEO}`, savedAt: 1, reason: 'daily' });
    const json = JSON.stringify(data).replace('"videoIndex":{', '"videoIndex":{"__proto__":{"title":"p"},"constructor":{"title":"c"},');
    const r = parseBackup(json, T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const items = r.backup.items as { config: { categories: { color: string }[] }; state: { savedLinks: { url: string }[] }; videoIndex: Record<string, unknown> };
    expect(items.config.categories[0]!.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(items.state.savedLinks.map((l) => l.url)).toEqual([`https://www.youtube.com/watch?v=${VIDEO}`]);
    expect(Object.keys(items.videoIndex)).toEqual([VIDEO]);
    expect(({} as Record<string, unknown>).title).toBeUndefined();
  });

  it('starts a fresh state when the backup has none', () => {
    const r = parseBackup(JSON.stringify({ config: defaultConfig() }), T0);
    expect(r.ok && (r.backup.items.state as { savedLinks: unknown[] }).savedLinks).toEqual([]);
    expect(r.ok && r.backup.days).toBe(0);
  });
});
