import { describe, expect, it } from 'vitest';
import { checkRequest, cleanUrl, sanitizeHeartbeat, sanitizeVideoInfo } from './validate';

const VIDEO = 'dQw4w9WgXcQ';

describe('sanitizeVideoInfo', () => {
  it('keeps the known fields of a well-formed report', () => {
    expect(
      sanitizeVideoInfo({ videoId: VIDEO, title: 'A title', channelId: 'UCabc', channelName: 'Someone', isLive: false, duration: 212 }),
    ).toEqual({ videoId: VIDEO, title: 'A title', channelId: 'UCabc', channelName: 'Someone', isLive: false, duration: 212 });
  });

  it('never carries unknown keys on, in particular not a request type', () => {
    // JSON.parse yields an own "__proto__" key, as a structured-cloned message would.
    const hostile: unknown = JSON.parse(`{"videoId":"${VIDEO}","type":"clearData","keepConfig":false,"tabId":7,"__proto__":{"polluted":true}}`);
    const out = sanitizeVideoInfo(hostile);
    expect(out).toEqual({ videoId: VIDEO });
    expect(Object.keys(out!)).toEqual(['videoId']);
    expect((out as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects reports without a real video id', () => {
    for (const videoId of ['constructor', '__proto__', 'short', 'x'.repeat(12), '', 5, null, undefined]) {
      expect(sanitizeVideoInfo({ videoId }), String(videoId)).toBeNull();
    }
    expect(sanitizeVideoInfo(null)).toBeNull();
    expect(sanitizeVideoInfo('dQw4w9WgXcQ')).toBeNull();
  });

  it('caps text, drops malformed optional fields and keeps a null duration', () => {
    const out = sanitizeVideoInfo({
      videoId: VIDEO,
      title: 't'.repeat(1000),
      channelId: 'constructor',
      channelName: { toString: () => 'x' },
      isLive: 'yes',
      duration: Infinity,
    })!;
    expect(out.title).toHaveLength(300);
    expect(out.channelId).toBeUndefined();
    expect(out.channelName).toBeUndefined();
    expect(out.isLive).toBeUndefined();
    expect(out.duration).toBeUndefined();
    expect(sanitizeVideoInfo({ videoId: VIDEO, duration: null })!.duration).toBeNull();
    expect(sanitizeVideoInfo({ videoId: VIDEO, duration: -5 })!.duration).toBeUndefined();
  });
});

describe('cleanUrl', () => {
  it('passes ordinary URLs through unchanged', () => {
    const url = `https://www.youtube.com/watch?v=${VIDEO}&t=10s`;
    expect(cleanUrl(url)).toBe(url);
  });

  it('reduces an over-long video URL to the video and an over-long page URL to its path', () => {
    const pad = 'x'.repeat(3000);
    expect(cleanUrl(`https://www.youtube.com/watch?v=${VIDEO}&junk=${pad}`)).toBe(`https://www.youtube.com/watch?v=${VIDEO}`);
    expect(cleanUrl(`https://www.youtube.com/shorts/${VIDEO}?junk=${pad}`)).toBe(`https://www.youtube.com/shorts/${VIDEO}`);
    expect(cleanUrl(`https://www.youtube.com/results?search_query=${pad}`)).toBe('https://www.youtube.com/results');
  });

  it('rejects non-strings, the empty string, over-long foreign URLs and absurd input', () => {
    expect(cleanUrl(undefined)).toBeNull();
    expect(cleanUrl('')).toBeNull();
    expect(cleanUrl(`https://example.com/?${'x'.repeat(3000)}`)).toBeNull();
    expect(cleanUrl(`https://www.youtube.com/?${'x'.repeat(70000)}`)).toBeNull();
  });
});

describe('sanitizeHeartbeat', () => {
  it('coerces every field to the type the accounting expects', () => {
    const hb = sanitizeHeartbeat({
      url: `https://www.youtube.com/watch?v=${VIDEO}`,
      visible: true,
      pip: 0,
      playing: 'true',
      focused: true,
      fullscreen: undefined,
      playerVideoId: VIDEO,
      isLive: false,
      duration: 600,
      currentTime: 12.5,
      ended: false,
      adShowing: null,
      type: 'clearData',
    });
    expect(hb).toEqual({
      url: `https://www.youtube.com/watch?v=${VIDEO}`,
      visible: true,
      pip: false,
      playing: false,
      focused: true,
      fullscreen: false,
      playerVideoId: VIDEO,
      isLive: false,
      duration: 600,
      currentTime: 12.5,
      ended: false,
      adShowing: false,
    });
  });

  it('nulls a player id that is not a video id and numbers that are not finite', () => {
    const hb = sanitizeHeartbeat({ url: 'https://www.youtube.com/', playerVideoId: '__proto__', duration: NaN, currentTime: -1 })!;
    expect(hb.playerVideoId).toBeNull();
    expect(hb.duration).toBeNull();
    expect(hb.currentTime).toBeNull();
    expect(sanitizeHeartbeat({ url: 'https://www.youtube.com/', playerVideoId: 'constructor' })!.playerVideoId).toBeNull();
  });

  it('rejects a heartbeat without a usable URL', () => {
    expect(sanitizeHeartbeat({ visible: true })).toBeNull();
    expect(sanitizeHeartbeat(null)).toBeNull();
  });
});

describe('checkRequest', () => {
  const url = `https://www.youtube.com/watch?v=${VIDEO}`;

  it('refuses unknown types, including inherited object names', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'nope', 7, undefined]) {
      const r = checkRequest({ type }, 'page');
      expect('error' in r && r.error, String(type)).toMatch(/^unknown request type/);
    }
    expect(checkRequest(null, 'page')).toEqual({ error: 'invalid request' });
    expect(checkRequest('heartbeat', 'page')).toEqual({ error: 'invalid request' });
  });

  it('refuses page-only requests from a content script', () => {
    for (const type of ['clearData', 'importData', 'exportData', 'saveConfig', 'useOverride', 'getConfig']) {
      const r = checkRequest({ type, keepConfig: false, json: '{}', config: {}, url }, 'content');
      expect('error' in r, type).toBe(true);
    }
    expect('req' in checkRequest({ type: 'clearData', keepConfig: true }, 'page')).toBe(true);
  });

  it('rebuilds the request instead of passing the message on', () => {
    const r = checkRequest({ type: 'videoInfo', videoId: VIDEO, title: 'T', keepConfig: false, extra: { deep: true } }, 'content');
    expect(r).toEqual({ req: { type: 'videoInfo', videoId: VIDEO, title: 'T' } });
  });

  it('honours categorize.tabId only from an extension page', () => {
    const msg = { type: 'categorize', videoId: VIDEO, categoryId: 'learning', url, tabId: 42 };
    const fromContent = checkRequest(msg, 'content');
    const fromPage = checkRequest(msg, 'page');
    expect('req' in fromContent && 'tabId' in fromContent.req).toBe(false);
    expect('req' in fromPage && fromPage.req).toMatchObject({ tabId: 42 });
  });

  it('checks ids, keeps a channel rule only with a real channel id and bounds the URL', () => {
    expect('error' in checkRequest({ type: 'categorize', videoId: 'constructor', categoryId: 'learning', url }, 'content')).toBe(true);
    expect('error' in checkRequest({ type: 'categorize', videoId: VIDEO, categoryId: '__proto__', url }, 'content')).toBe(true);
    expect('error' in checkRequest({ type: 'promptInfo', videoId: '__proto__' }, 'content')).toBe(true);
    expect('error' in checkRequest({ type: 'decide' }, 'content')).toBe(true);
    const withRule = checkRequest(
      { type: 'categorize', videoId: VIDEO, categoryId: 'learning', url, channelRule: { channelId: 'UCabc', channelName: 'n'.repeat(500) } },
      'content',
    );
    expect('req' in withRule && withRule.req).toMatchObject({ channelRule: { channelId: 'UCabc', channelName: 'n'.repeat(120) } });
    const badRule = checkRequest({ type: 'categorize', videoId: VIDEO, categoryId: 'learning', url, channelRule: { channelId: 'constructor' } }, 'content');
    expect('req' in badRule && 'channelRule' in badRule.req).toBe(false);
  });

  it('validates the page-only requests too', () => {
    expect(checkRequest({ type: 'getReport', from: '2026-08-01', to: '2026-08-31' }, 'page')).toEqual({
      req: { type: 'getReport', from: '2026-08-01', to: '2026-08-31' },
    });
    expect('error' in checkRequest({ type: 'getReport', from: 'yesterday', to: '2026-08-31' }, 'page')).toBe(true);
    expect('error' in checkRequest({ type: 'clearData' }, 'page')).toBe(true);
    expect('error' in checkRequest({ type: 'clearData', keepConfig: 'yes' }, 'page')).toBe(true);
    expect('error' in checkRequest({ type: 'importData', json: {} }, 'page')).toBe(true);
    expect('error' in checkRequest({ type: 'saveConfig', config: 'x' }, 'page')).toBe(true);
    expect(checkRequest({ type: 'openOptions', hash: 'saved' }, 'content')).toEqual({ req: { type: 'openOptions', hash: 'saved' } });
    expect(checkRequest({ type: 'openOptions', hash: '../x' }, 'content')).toEqual({ req: { type: 'openOptions' } });
    expect(checkRequest({ type: 'getSavedLinks', limit: 5.7 }, 'page')).toEqual({ req: { type: 'getSavedLinks', limit: 5 } });
    expect(checkRequest({ type: 'getSavedLinks', limit: -1 }, 'page')).toEqual({ req: { type: 'getSavedLinks' } });
  });
});
