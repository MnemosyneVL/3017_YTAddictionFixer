import { describe, expect, it } from 'vitest';
import { ACCESS, isRequestType, mayCall, senderRole } from './access';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT = `chrome-extension://${ID}`;

describe('senderRole', () => {
  it('recognises the extension pages, with or without a tab', () => {
    expect(senderRole({ id: ID, origin: EXT, url: `${EXT}/popup.html` }, ID)).toBe('page');
    expect(senderRole({ id: ID, origin: EXT, url: `${EXT}/options.html`, tab: { id: 3 }, frameId: 0 }, ID)).toBe('page');
    expect(senderRole({ id: ID, url: `${EXT}/blocked.html?u=x`, tab: { id: 3 }, frameId: 0 }, ID)).toBe('page');
  });

  it('gives a framed extension page no role', () => {
    expect(senderRole({ id: ID, origin: EXT, url: `${EXT}/blocked.html?u=x`, tab: { id: 3 }, frameId: 12 }, ID)).toBeNull();
  });

  it('recognises a content script in the top frame of a YouTube tab', () => {
    expect(senderRole({ id: ID, origin: 'https://www.youtube.com', tab: { id: 5 }, frameId: 0 }, ID)).toBe('content');
    expect(senderRole({ id: ID, url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', tab: { id: 5 }, frameId: 0 }, ID)).toBe('content');
    expect(senderRole({ id: ID, origin: 'https://www.youtube-nocookie.com', tab: { id: 5 }, frameId: 0 }, ID)).toBe('content');
  });

  it('rejects subframes, tab-less senders, excluded subdomains and look-alike origins', () => {
    expect(senderRole({ id: ID, origin: 'https://www.youtube.com', tab: { id: 5 }, frameId: 4 }, ID)).toBeNull();
    expect(senderRole({ id: ID, origin: 'https://www.youtube.com' }, ID)).toBeNull();
    expect(senderRole({ id: ID, origin: 'https://music.youtube.com', tab: { id: 5 }, frameId: 0 }, ID)).toBeNull();
    expect(senderRole({ id: ID, origin: 'https://youtube.com.evil.example', tab: { id: 5 }, frameId: 0 }, ID)).toBeNull();
    expect(senderRole({ id: ID, origin: 'null', tab: { id: 5 }, frameId: 0 }, ID)).toBeNull();
    expect(senderRole({ id: ID, origin: `chrome-extension://${'z'.repeat(32)}`, tab: { id: 5 }, frameId: 0 }, ID)).toBeNull();
  });

  it('rejects other extensions and empty senders', () => {
    expect(senderRole({ id: 'someoneelse', origin: EXT }, ID)).toBeNull();
    expect(senderRole({}, ID)).toBeNull();
    expect(senderRole({ id: ID }, ID)).toBeNull();
    expect(senderRole({ id: '', origin: 'chrome-extension://' }, '')).toBeNull();
  });
});

describe('access table', () => {
  it('lets content scripts send only what their UI needs', () => {
    const content = (Object.keys(ACCESS) as (keyof typeof ACCESS)[]).filter((t) => mayCall(t, 'content')).sort();
    expect(content).toEqual(['categorize', 'decide', 'heartbeat', 'openOptions', 'promptInfo', 'removeSavedLink', 'videoInfo']);
  });

  it('lets extension pages send everything', () => {
    for (const t of Object.keys(ACCESS) as (keyof typeof ACCESS)[]) expect(mayCall(t, 'page'), t).toBe(true);
  });

  it('keeps the data-changing requests away from content scripts', () => {
    for (const t of ['saveConfig', 'importData', 'exportData', 'clearData', 'useOverride', 'getConfig', 'getReport'] as const) {
      expect(mayCall(t, 'content'), t).toBe(false);
    }
  });

  it('only knows its own request names', () => {
    expect(isRequestType('heartbeat')).toBe(true);
    expect(isRequestType('constructor')).toBe(false);
    expect(isRequestType('toString')).toBe(false);
    expect(isRequestType('__proto__')).toBe(false);
    expect(isRequestType(undefined)).toBe(false);
  });
});
