// Decides whether a heartbeat interval counts as YouTube time. Pure.
import type { CountingMode, IdleState } from './types';

export interface CountingInput {
  visible: boolean;
  pip: boolean;
  playing: boolean;
  focused: boolean;
  idle: IdleState;
  /** The interval would be attributed to browsing (feed, search, channel page), not to a video. */
  browsing: boolean;
}

/**
 * The modes describe how *videos* count:
 * - visibleOrPlaying: playback always counts (background audio, covered window); a non-playing video page
 *   counts only while it is visible, focused and the user is not idle (a paused tab parked on a second
 *   monitor while working elsewhere does not count).
 * - visibleOnly: the page must be visible (or in picture-in-picture); playback in a hidden tab is free.
 * - playingOnly: only actual playback counts; a paused video is free.
 * Pages without a video (feed, search, channel) can only be "watched" by being looked at, so in every mode they
 * count while visible, focused and not idle. A locked screen never counts.
 */
export function shouldCount(mode: CountingMode, i: CountingInput): boolean {
  if (i.idle === 'locked') return false;
  const shown = i.visible || i.pip;
  const attentive = i.focused && i.idle === 'active';
  if (i.browsing) return shown && attentive;
  switch (mode) {
    case 'visibleOrPlaying':
      return i.playing || (shown && attentive);
    case 'visibleOnly':
      return shown && (i.playing || attentive);
    case 'playingOnly':
      return i.playing;
  }
}
