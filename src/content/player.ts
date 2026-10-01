// Access to YouTube's main <video> element from the isolated world.

const MAIN_VIDEO_SELECTORS = [
  'ytd-reel-video-renderer[is-active] video',
  '#movie_player video',
  '#shorts-player video',
  'video.html5-main-video',
];

export function findVideo(): HTMLVideoElement | null {
  for (const sel of MAIN_VIDEO_SELECTORS) {
    const v = document.querySelector<HTMLVideoElement>(sel);
    if (v) return v;
  }
  return null;
}

export function isMainVideo(el: EventTarget | null): el is HTMLVideoElement {
  return el instanceof HTMLVideoElement && el === findVideo();
}

export interface Playback {
  playing: boolean;
  ended: boolean;
  currentTime: number | null;
  duration: number | null;
  isLive: boolean;
}

export function readPlayback(v: HTMLVideoElement | null): Playback {
  if (!v) return { playing: false, ended: false, currentTime: null, duration: null, isLive: false };
  const dur = v.duration;
  const finite = Number.isFinite(dur) && dur > 0;
  return {
    playing: !v.paused && !v.ended && v.readyState >= 2,
    ended: v.ended,
    currentTime: Number.isFinite(v.currentTime) ? v.currentTime : null,
    duration: finite ? dur : null,
    isLive: dur === Infinity,
  };
}

export function adShowing(): boolean {
  return !!document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');
}

/** Container that overlays must live in so they are visible in fullscreen too. */
export function overlayRoot(): HTMLElement {
  const fs = document.fullscreenElement;
  return fs instanceof HTMLElement ? fs : document.body;
}
