// MAIN-world bridge. Runs inside the page (no chrome.* access) and reads YouTube's player API for facts the
// isolated world cannot get reliably: the loaded video id, its channel id, title, live flag and length.
// Talks to the content script with window.postMessage; accepts a "pause" command.
export {};

interface PlayerApi {
  getVideoData?: () => { video_id?: string; author?: string; title?: string; isLive?: boolean } | undefined;
  getPlayerResponse?: () => {
    videoDetails?: { videoId?: string; channelId?: string; author?: string; title?: string; lengthSeconds?: string; isLive?: boolean; isLiveContent?: boolean };
  } | undefined;
  pauseVideo?: () => void;
  playVideo?: () => void;
}

interface BridgeInfo {
  videoId: string;
  channelId?: string;
  channelName?: string;
  title?: string;
  isLive: boolean;
  duration: number | null;
}

const TAG = 'yt-budget';
const MARK = '__ytBudgetBridge';

(() => {
  const w = window as unknown as Record<string, unknown>;
  if (w[MARK]) return;
  w[MARK] = true;

  function findPlayer(): (Element & PlayerApi) | null {
    const candidates = [
      document.querySelector('ytd-reel-video-renderer[is-active] .html5-video-player'),
      document.getElementById('movie_player'),
      document.getElementById('shorts-player'),
      document.querySelector('.html5-video-player'),
    ];
    for (const c of candidates) {
      if (c && typeof (c as PlayerApi).getVideoData === 'function') return c as Element & PlayerApi;
    }
    return null;
  }

  function read(): BridgeInfo | null {
    const p = findPlayer();
    if (!p) return null;
    let vd: ReturnType<NonNullable<PlayerApi['getVideoData']>> | undefined;
    let details: NonNullable<ReturnType<NonNullable<PlayerApi['getPlayerResponse']>>>['videoDetails'] | undefined;
    try {
      vd = p.getVideoData?.();
    } catch {
      /* ignore */
    }
    try {
      details = p.getPlayerResponse?.()?.videoDetails;
    } catch {
      /* ignore */
    }
    const videoId = vd?.video_id || details?.videoId;
    if (!videoId) return null;
    // Only trust videoDetails when they describe the same video (they can lag during navigation).
    const d = details && details.videoId === videoId ? details : undefined;
    const len = d?.lengthSeconds ? Number(d.lengthSeconds) : NaN;
    const info: BridgeInfo = {
      videoId,
      isLive: !!(d?.isLive || vd?.isLive),
      duration: Number.isFinite(len) && len > 0 ? len : null,
    };
    if (d?.channelId) info.channelId = d.channelId;
    const author = d?.author || vd?.author;
    if (author) info.channelName = author;
    const title = d?.title || vd?.title;
    if (title) info.title = title;
    return info;
  }

  let lastKey = '';
  function publish(): void {
    const info = read();
    if (!info) return;
    const key = JSON.stringify(info);
    if (key === lastKey) return;
    lastKey = key;
    window.postMessage({ source: TAG, type: 'info', info }, location.origin);
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return;
    const data = e.data as { source?: string; type?: string; cmd?: string } | null;
    if (!data || data.source !== TAG || data.type !== 'cmd') return;
    if (data.cmd === 'pause') {
      try {
        findPlayer()?.pauseVideo?.();
      } catch {
        /* ignore */
      }
    } else if (data.cmd === 'play') {
      try {
        findPlayer()?.playVideo?.();
      } catch {
        /* ignore */
      }
    } else if (data.cmd === 'refresh') {
      lastKey = '';
      publish();
    }
  });

  for (const ev of ['yt-navigate-finish', 'yt-page-data-updated', 'yt-navigate-start']) {
    window.addEventListener(ev, () => {
      lastKey = '';
      setTimeout(publish, 0);
      setTimeout(publish, 300);
    });
  }
  setInterval(publish, 1000);
  publish();
})();
