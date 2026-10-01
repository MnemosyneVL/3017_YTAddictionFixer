import { describe, expect, it } from 'vitest';
import { newState } from './config';
import { addSavedLink, markFinished, removeSavedVideo } from './links';
import { T0 } from './fixtures';
import type { VideoIndex } from './types';

const WATCH = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const index: VideoIndex = { aaaaaaaaaaa: { title: 'A video', at: 0 } };

describe('addSavedLink', () => {
  it('saves blocked video links with their title, once', () => {
    const state = newState('2026-08-24');
    expect(addSavedLink(state, index, WATCH, 'daily', T0)).toBe(true);
    expect(state.savedLinks).toEqual([{ url: WATCH, videoId: 'aaaaaaaaaaa', title: 'A video', savedAt: T0, reason: 'daily' }]);
    expect(addSavedLink(state, index, WATCH + '&t=10', 'daily', T0)).toBe(false); // same video
    expect(state.savedLinks).toHaveLength(1);
  });

  it('never saves a video the user finished today', () => {
    const state = newState('2026-08-24');
    markFinished(state, 'aaaaaaaaaaa');
    markFinished(state, 'aaaaaaaaaaa');
    expect(state.finishedVideos).toEqual(['aaaaaaaaaaa']);
    expect(addSavedLink(state, index, WATCH, 'daily', T0)).toBe(false);
    expect(state.savedLinks).toEqual([]);
  });

  it('ignores non-video pages', () => {
    const state = newState('2026-08-24');
    expect(addSavedLink(state, index, 'https://www.youtube.com/feed/subscriptions', 'schedule', T0)).toBe(false);
  });
});

describe('removeSavedVideo', () => {
  it('drops the video from the list and reports whether it was there', () => {
    const state = newState('2026-08-24');
    addSavedLink(state, index, WATCH, 'daily', T0);
    expect(removeSavedVideo(state, 'bbbbbbbbbbb')).toBe(false);
    expect(state.savedLinks).toHaveLength(1);
    expect(removeSavedVideo(state, 'aaaaaaaaaaa')).toBe(true);
    expect(state.savedLinks).toEqual([]);
  });
});
