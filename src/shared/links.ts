// Saved-for-later links. Pure.
import type { BlockReason, Millis, State, VideoId, VideoIndex } from './types';
import { isVideoPage, parseYouTubeUrl } from './url';

/** The list keeps the newest links only. */
export const MAX_SAVED_LINKS = 500;

/**
 * Remembers a blocked video link so it can be watched another day. Skips non-video pages, duplicates and
 * videos the user already finished today (the grandfathered video that played to its end must not come back
 * as "watch later"). Returns true when the list changed.
 */
export function addSavedLink(state: State, videoIndex: VideoIndex, url: string, reason: BlockReason, now: Millis): boolean {
  const parsed = parseYouTubeUrl(url);
  if (!isVideoPage(parsed) || !parsed.videoId) return false;
  const videoId = parsed.videoId;
  if (state.finishedVideos.includes(videoId)) return false;
  if (state.savedLinks.some((l) => l.videoId === videoId)) return false;
  state.savedLinks.unshift({
    url,
    videoId,
    title: videoIndex[videoId]?.title,
    savedAt: now,
    reason,
  });
  if (state.savedLinks.length > MAX_SAVED_LINKS) state.savedLinks.length = MAX_SAVED_LINKS;
  return true;
}

/** Marks a video as finished for today (dedup). */
export function markFinished(state: State, videoId: string): void {
  if (!state.finishedVideos.includes(videoId)) state.finishedVideos.push(videoId);
}

/** Drops a video from the saved-for-later list (it was watched to its end). Returns true when it was there. */
export function removeSavedVideo(state: State, videoId: VideoId): boolean {
  const before = state.savedLinks.length;
  state.savedLinks = state.savedLinks.filter((l) => l.videoId !== videoId);
  return state.savedLinks.length !== before;
}
