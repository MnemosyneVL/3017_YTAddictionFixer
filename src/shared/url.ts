// YouTube URL classification. Pure.
import { isVideoId } from './ids';

export type PageType = 'watch' | 'shorts' | 'live' | 'embed' | 'browse' | 'other';

export interface ParsedUrl {
  /** True for youtube.com, youtube-nocookie.com and youtu.be hosts (music.youtube.com excluded). */
  isYouTube: boolean;
  isMusic: boolean;
  pageType: PageType;
  videoId: string | null;
  listId: string | null;
}

/**
 * Subdomains that are not the video site (consent/sign-in flows, studio, …). The manifest's `exclude_matches`
 * must list the same hosts (a unit test compares them).
 */
export const EXCLUDED_SUBDOMAINS = ['music', 'consent', 'accounts', 'studio', 'support', 'admin', 'developers', 'families', 'tv'];

export function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase();
  if (EXCLUDED_SUBDOMAINS.some((sub) => h === `${sub}.youtube.com`)) return false;
  return (
    h === 'youtube.com' ||
    h.endsWith('.youtube.com') ||
    h === 'youtube-nocookie.com' ||
    h.endsWith('.youtube-nocookie.com') ||
    h === 'youtu.be'
  );
}

function validId(id: string | null | undefined): string | null {
  return isVideoId(id) ? id : null;
}

export function parseYouTubeUrl(url: string): ParsedUrl {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { isYouTube: false, isMusic: false, pageType: 'other', videoId: null, listId: null };
  }
  // A page is only ever http(s). "javascript://www.youtube.com/…" has that hostname too.
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { isYouTube: false, isMusic: false, pageType: 'other', videoId: null, listId: null };
  }
  const host = u.hostname.toLowerCase();
  if (host === 'music.youtube.com') {
    return { isYouTube: false, isMusic: true, pageType: 'other', videoId: null, listId: null };
  }
  if (!isYouTubeHost(host)) {
    return { isYouTube: false, isMusic: false, pageType: 'other', videoId: null, listId: null };
  }
  const listId = u.searchParams.get('list');
  const segments = u.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  const second = segments[1] ?? '';

  if (host === 'youtu.be') {
    return { isYouTube: true, isMusic: false, pageType: 'watch', videoId: validId(first), listId };
  }
  if (first === 'watch' || first === 'watch_popup') {
    return { isYouTube: true, isMusic: false, pageType: 'watch', videoId: validId(u.searchParams.get('v')), listId };
  }
  if (first === 'shorts') {
    return { isYouTube: true, isMusic: false, pageType: 'shorts', videoId: validId(second), listId };
  }
  if (first === 'live') {
    return { isYouTube: true, isMusic: false, pageType: 'live', videoId: validId(second), listId };
  }
  if (first === 'embed' || first === 'v') {
    return { isYouTube: true, isMusic: false, pageType: 'embed', videoId: validId(second), listId };
  }
  return { isYouTube: true, isMusic: false, pageType: 'browse', videoId: null, listId };
}

/** Pages that show a single video (the category prompt and per-video limits apply). */
export function isVideoPage(p: ParsedUrl): boolean {
  return p.isYouTube && p.videoId !== null && p.pageType !== 'browse';
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

export type FeedKind = 'home' | 'subscriptions';

/** Feed pages that get the saved-for-later shelf: the home page and the subscriptions feed (query ignored). */
export function feedKind(url: string): FeedKind | null {
  const p = parseYouTubeUrl(url);
  if (!p.isYouTube || p.pageType !== 'browse') return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
  if (pathname === '') return 'home';
  if (pathname === '/feed/subscriptions') return 'subscriptions';
  return null;
}
