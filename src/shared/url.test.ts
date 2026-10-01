import { describe, expect, it } from 'vitest';
import { feedKind, isVideoPage, isYouTubeHost, parseYouTubeUrl } from './url';

describe('parseYouTubeUrl', () => {
  it('recognises watch pages in all forms', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s&list=PLx',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch_popup?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=5',
    ]) {
      const p = parseYouTubeUrl(url);
      expect(p.isYouTube, url).toBe(true);
      expect(p.pageType, url).toBe('watch');
      expect(p.videoId, url).toBe('dQw4w9WgXcQ');
      expect(isVideoPage(p)).toBe(true);
    }
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx').listId).toBe('PLx');
  });

  it('recognises shorts, live, embed', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject({ pageType: 'shorts', videoId: 'dQw4w9WgXcQ' });
    expect(parseYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share')).toMatchObject({ pageType: 'live', videoId: 'dQw4w9WgXcQ' });
    expect(parseYouTubeUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toMatchObject({ pageType: 'embed', videoId: 'dQw4w9WgXcQ', isYouTube: true });
    expect(parseYouTubeUrl('https://www.youtube.com/v/dQw4w9WgXcQ')).toMatchObject({ pageType: 'embed', videoId: 'dQw4w9WgXcQ' });
  });

  it('treats everything else on YouTube as browsing', () => {
    for (const url of [
      'https://www.youtube.com/',
      'https://www.youtube.com/feed/subscriptions',
      'https://www.youtube.com/results?search_query=rust',
      'https://www.youtube.com/@SomeChannel/videos',
      'https://www.youtube.com/playlist?list=PLx',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/watch?v=constructor', // 11 letters, but a name every object inherits
    ]) {
      const p = parseYouTubeUrl(url);
      expect(p.isYouTube, url).toBe(true);
      expect(isVideoPage(p), url).toBe(false);
    }
    expect(parseYouTubeUrl('https://www.youtube.com/playlist?list=PLx').listId).toBe('PLx');
  });

  it('excludes other sites and YouTube Music', () => {
    expect(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ').isYouTube).toBe(false);
    expect(parseYouTubeUrl('https://notyoutube.com/').isYouTube).toBe(false);
    expect(parseYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ isYouTube: false, isMusic: true });
    expect(parseYouTubeUrl('https://consent.youtube.com/m?continue=x').isYouTube).toBe(false);
    expect(parseYouTubeUrl('https://accounts.youtube.com/accounts/SetSID').isYouTube).toBe(false);
    expect(parseYouTubeUrl('not a url').pageType).toBe('other');
    expect(isYouTubeHost('www.youtube.com')).toBe(true);
    expect(isYouTubeHost('youtu.be')).toBe(true);
    expect(isYouTubeHost('youtube.com.evil.com')).toBe(false);
  });

  it('accepts only http and https', () => {
    for (const url of [
      'javascript://www.youtube.com/%0aalert(1)',
      'javascript://www.youtube.com/watch?x=%0aalert(1)//&v=dQw4w9WgXcQ',
      'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'data:text/html,https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'chrome-extension://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      const p = parseYouTubeUrl(url);
      expect(p.isYouTube, url).toBe(false);
      expect(isVideoPage(p), url).toBe(false);
    }
    expect(parseYouTubeUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ').isYouTube).toBe(true);
    // The host decides, not what precedes the "@".
    expect(parseYouTubeUrl('https://www.youtube.com@evil.example/watch?v=dQw4w9WgXcQ').isYouTube).toBe(false);
    expect(parseYouTubeUrl('https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ').isYouTube).toBe(true);
  });
});

describe('feedKind', () => {
  it('recognises the home page and the subscriptions feed, query ignored', () => {
    expect(feedKind('https://www.youtube.com/')).toBe('home');
    expect(feedKind('https://www.youtube.com')).toBe('home');
    expect(feedKind('https://www.youtube.com/?bp=wgUCEAE%3D')).toBe('home');
    expect(feedKind('https://www.youtube.com/feed/subscriptions')).toBe('subscriptions');
    expect(feedKind('https://www.youtube.com/feed/subscriptions/?flow=2')).toBe('subscriptions');
  });

  it('returns null for every other page', () => {
    for (const url of [
      'https://www.youtube.com/feed/history',
      'https://www.youtube.com/results?search_query=rust',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/@channel/videos',
      'https://music.youtube.com/',
      'https://youtu.be/',
      'https://example.com/',
      'not a url',
    ]) {
      expect(feedKind(url), url).toBeNull();
    }
  });
});
