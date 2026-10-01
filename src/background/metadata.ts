// Video metadata: merges facts from the page and from YouTube's public oEmbed endpoint into videoIndex.
import type { VideoInfo } from '../shared/messages';
import type { VideoId, VideoIndexEntry } from '../shared/types';
import { watchUrl } from '../shared/url';
import { sanitizeVideoInfo } from '../shared/validate';
import type { Store } from './store';

/** Merges page-reported facts into the index. Returns true if something changed. */
export function mergeVideoInfo(s: Store, info: VideoInfo, now: number): boolean {
  const cur = s.videoIndex[info.videoId];
  const next: VideoIndexEntry = { ...(cur ?? { at: now }) };
  let changed = !cur;
  if (info.title && info.title !== next.title) {
    next.title = info.title;
    changed = true;
  }
  if (info.channelId && info.channelId !== next.channelId) {
    next.channelId = info.channelId;
    changed = true;
  }
  if (info.channelName && info.channelName !== next.channelName) {
    next.channelName = info.channelName;
    changed = true;
  }
  if (changed) {
    next.at = now;
    s.videoIndex[info.videoId] = next;
  }
  return changed;
}

interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
}

const inflight = new Map<VideoId, Promise<OEmbed | null>>();

/** Fetches title/channel for a video from oEmbed (no auth). Cached per worker lifetime. */
export function fetchOEmbed(videoId: VideoId): Promise<OEmbed | null> {
  let p = inflight.get(videoId);
  if (!p) {
    p = (async () => {
      try {
        const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) return null;
        return (await res.json()) as OEmbed;
      } catch {
        return null;
      }
    })();
    inflight.set(videoId, p);
  }
  return p;
}

/** Ensures the index has a title for the video, fetching oEmbed when missing. Returns true if changed. */
export async function ensureTitle(s: Store, videoId: VideoId, now: number): Promise<boolean> {
  const cur = s.videoIndex[videoId];
  if (cur?.title) return false;
  const o = await fetchOEmbed(videoId);
  // A network response is checked like anything else that comes from outside.
  const info = sanitizeVideoInfo({ videoId, title: o?.title, channelName: o?.author_name });
  if (!info?.title) return false;
  return mergeVideoInfo(s, info, now);
}
