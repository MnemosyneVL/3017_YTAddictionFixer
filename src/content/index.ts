// Isolated-world content script. Runs at document_start on every YouTube page.
//  - gate: asks the service worker whether this page/video may play before it can start;
//  - heartbeat: reports visibility/playback state every few seconds and on every state change;
//  - prompt: asks for the category of a new video while holding it paused;
//  - executes blocks (location.replace to the placeholder) and shows toasts;
//  - shows the saved-for-later shelf on the home/subscriptions feed (its data rides on heartbeat responses).
import { LOG_TAG } from '../shared/brand';
import { BRIDGE_WAIT_MS, HEARTBEAT_SEC } from '../shared/constants';
import type { DecideResponse, PushMessage, RequestMap, Response, VideoInfo } from '../shared/messages';
import type { Heartbeat } from '../shared/types';
import { feedKind, isVideoPage, parseYouTubeUrl } from '../shared/url';
import { sanitizeVideoInfo } from '../shared/validate';
import { request } from '../runtime/rpc';
import { adShowing, findVideo, isMainVideo, readPlayback } from './player';
import { showPrompt, type PromptHandle } from './prompt';
import { SavedShelf } from './shelf';
import { TimerPill } from './timer';
import { removeToasts, showToast } from './toast';

export {};

declare global {
  interface Window {
    __ytBudgetContent?: boolean;
  }
  interface Document {
    prerendering?: boolean;
  }
}

const BRIDGE_TAG = 'yt-budget';
const BLOCKED_PAGE = `${chrome.runtime.getURL('blocked.html')}?`;
/** Shown once, when the timer pill first appears with a category. */
const PILL_TIP =
  'The small timer on the video shows what is left of today’s budget and this video’s category. Click it if the category is wrong.';

if (!window.__ytBudgetContent) {
  window.__ytBudgetContent = true;
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', () => start(), { once: true });
  } else {
    start();
  }
}

function start(): void {
  let stopped = false;
  // Setup is not finished: nothing is sent to the worker and nothing is shown until an 'activate' message.
  let dormant = false;
  let hold = false; // keep the main video paused (gate / prompt / block in progress)
  let pausedByUs = false;
  let blocked = false;
  let flowToken = 0;
  let gatedKey = ''; // page key of the last gate() run
  let allowedVideoId: string | null = null; // video the last gate released
  let prompt: PromptHandle | null = null;
  let bridgeInfo: VideoInfo | null = null;
  let bridgeWaiters: (() => void)[] = [];
  let timer: number | undefined;
  const pill = new TimerPill();
  const shelf = new SavedShelf({
    onRemove: (url) => {
      void send('removeSavedLink', { url }).then(() => soon());
    },
    onSeeAll: () => void send('openOptions', { hash: 'saved' }),
  });

  function alive(): boolean {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
    prompt?.close();
    pill.destroy();
    shelf.destroy();
    removeToasts();
    hold = false;
  }

  async function send<T extends 'decide' | 'heartbeat' | 'videoInfo' | 'categorize' | 'promptInfo' | 'removeSavedLink' | 'openOptions'>(
    type: T,
    payload: RequestMap[T]['req'],
  ): Promise<Response<T> | null> {
    if (stopped || dormant) return null;
    if (!alive()) {
      stop();
      return null;
    }
    try {
      return await request(type, payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/context invalidated|Extension context/i.test(msg)) stop();
      else console.warn(LOG_TAG, type, msg);
      return null;
    }
  }

  // ---- video control ---------------------------------------------------------------------------------------

  function pauseVideo(): void {
    const v = findVideo();
    if (v && !v.paused) {
      v.pause();
      pausedByUs = true;
    }
    window.postMessage({ source: BRIDGE_TAG, type: 'cmd', cmd: 'pause' }, location.origin);
  }

  function release(): void {
    hold = false;
    allowedVideoId = urlVideoId();
    if (pausedByUs) {
      pausedByUs = false;
      const v = findVideo();
      if (v && v.paused && !v.ended) {
        debug('resuming playback');
        v.play().catch((e: unknown) => debug('play() rejected', e instanceof Error ? e.message : e));
        window.postMessage({ source: BRIDGE_TAG, type: 'cmd', cmd: 'play' }, location.origin);
      }
    }
  }

  function debug(...args: unknown[]): void {
    console.debug(LOG_TAG, ...args);
  }

  // Any playback start that was not released by the gate is paused again: while a decision is pending
  // (hold) or when a different video starts (SPA navigation, autoplay) before its gate has run.
  document.addEventListener(
    'play',
    (e) => {
      if (stopped || dormant || !isMainVideo(e.target)) return;
      const vid = urlVideoId();
      const unexpected = vid !== null && vid !== allowedVideoId;
      if (hold || unexpected) {
        e.target.pause();
        pausedByUs = true;
        if (!hold && unexpected && pageKey() !== gatedKey) void gate();
      }
    },
    true,
  );

  // ---- bridge ----------------------------------------------------------------------------------------------

  function urlVideoId(): string | null {
    const p = parseYouTubeUrl(location.href);
    return isVideoPage(p) ? p.videoId : null;
  }

  /** Identifies "the page" for gating purposes: the video, or the non-video URL. */
  function pageKey(): string {
    const vid = urlVideoId();
    return vid ? `v:${vid}` : `u:${location.pathname}${location.search}`;
  }

  /** Bridge info only if it describes the video in the URL (it can lag during navigation). */
  function matchingInfo(): VideoInfo | undefined {
    const id = urlVideoId();
    return bridgeInfo && id && bridgeInfo.videoId === id ? bridgeInfo : undefined;
  }

  function waitForBridge(ms: number): Promise<void> {
    if (matchingInfo()?.channelId) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done(): void {
        clearTimeout(t);
        bridgeWaiters = bridgeWaiters.filter((w) => w !== done);
        resolve();
      }
      bridgeWaiters.push(done);
    });
  }

  let lastSentInfo = '';
  window.addEventListener('message', (e: MessageEvent) => {
    if (stopped || e.source !== window) return;
    const data = e.data as { source?: unknown; type?: unknown; info?: unknown } | null;
    if (!data || typeof data !== 'object' || data.source !== BRIDGE_TAG || data.type !== 'info') return;
    // Any script in the page can post this message, not only our bridge: keep the checked fields, never the
    // object itself.
    const info = sanitizeVideoInfo(data.info);
    if (!info) return;
    bridgeInfo = info;
    const key = JSON.stringify(info);
    if (key !== lastSentInfo && !dormant) {
      lastSentInfo = key;
      void send('videoInfo', info);
    }
    if (prompt && matchingInfo()) {
      prompt.update({ title: info.title, channelName: info.channelName, channelId: info.channelId });
    }
    if (info.channelId) for (const w of [...bridgeWaiters]) w();
  });

  // ---- blocking --------------------------------------------------------------------------------------------

  function doBlock(blockedUrl: string | undefined): void {
    // Only ever navigate to our own placeholder page.
    if (blocked || !blockedUrl || !blockedUrl.startsWith(BLOCKED_PAGE)) return;
    blocked = true;
    hold = true;
    pauseVideo();
    prompt?.close();
    prompt = null;
    pill.destroy();
    shelf.destroy();
    location.replace(blockedUrl);
  }

  chrome.runtime.onMessage.addListener((msg: PushMessage) => {
    if (stopped || !msg || typeof msg !== 'object') return;
    if (msg.type === 'block') doBlock(msg.blockedUrl);
    else if (msg.type === 'toast') showToast(msg.text, msg.kind);
    else if (msg.type === 'activate') wake();
  });

  // ---- gate / navigation -----------------------------------------------------------------------------------

  function whenBodyReady(): Promise<void> {
    if (document.body) return Promise.resolve();
    return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
  }

  /** The worker said setup is pending: let the page be, show nothing, send nothing. */
  function sleep(): void {
    dormant = true;
    prompt?.close();
    prompt = null;
    pill.destroy();
    shelf.destroy();
    removeToasts();
    release();
  }

  /** Setup was finished while this page was open: start over as if the page had just loaded. */
  function wake(): void {
    if (!dormant || stopped) return;
    dormant = false;
    lastSentInfo = '';
    gatedKey = '';
    window.postMessage({ source: BRIDGE_TAG, type: 'cmd', cmd: 'refresh' }, location.origin);
    void gate();
    soon();
  }

  async function gate(): Promise<void> {
    if (dormant) return;
    const token = ++flowToken;
    const url = location.href;
    gatedKey = pageKey();
    if (!feedKind(url)) shelf.update(null);
    const videoId = urlVideoId();
    prompt?.close();
    prompt = null;
    if (videoId) {
      hold = true;
      allowedVideoId = null;
      pauseVideo();
    } else {
      allowedVideoId = null;
      release();
    }
    let res = await send('decide', { url, video: matchingInfo() });
    if (token !== flowToken || stopped) return;
    if (!res) {
      release();
      return;
    }
    if (res.inactive) {
      sleep();
      return;
    }
    debug('gate', url, JSON.stringify(res.decision));
    if (res.decision.action === 'prompt' && !matchingInfo()?.channelId) {
      await waitForBridge(BRIDGE_WAIT_MS);
      if (token !== flowToken || stopped) return;
      res = await send('decide', { url, video: matchingInfo() });
      if (token !== flowToken || stopped) return;
      if (!res) {
        release();
        return;
      }
    }
    await applyDecision(res, url, videoId, token);
  }

  async function applyDecision(res: DecideResponse, url: string, videoId: string | null, token: number): Promise<void> {
    switch (res.decision.action) {
      case 'block':
        doBlock(res.blockedUrl);
        return;
      case 'allow':
        release();
        return;
      case 'prompt': {
        if (!videoId) {
          release();
          return;
        }
        await whenBodyReady();
        if (token !== flowToken || stopped) return;
        hold = true;
        pauseVideo();
        const info = matchingInfo();
        prompt = showPrompt({
          categories: res.categories ?? [],
          title: info?.title ?? res.title ?? document.title.replace(/ - YouTube$/, ''),
          channelName: info?.channelName ?? res.channelName,
          channelId: info?.channelId,
          explain: res.tip === 'prompt',
          onChoose: (categoryId, rememberChannel) => {
            const current = matchingInfo();
            prompt?.close();
            prompt = null;
            // Resume synchronously so the user's click still counts as a gesture for play() (the
            // common outcome is "allow"). If the category turns out to be blocked, re-block below.
            release();
            void (async () => {
              const r = await send('categorize', {
                videoId,
                categoryId,
                url,
                channelRule: rememberChannel && current?.channelId ? { channelId: current.channelId, channelName: current.channelName ?? current.channelId } : undefined,
              });
              debug('categorized', categoryId, JSON.stringify(r?.decision), 'token ok:', token === flowToken);
              if (token !== flowToken || stopped) return;
              if (r && r.decision.action === 'block') doBlock(r.blockedUrl);
            })();
          },
        });
        return;
      }
    }
  }

  /** Re-opens the category prompt for the current video (pill click). */
  async function reprompt(): Promise<void> {
    if (stopped || blocked || prompt) return;
    const videoId = urlVideoId();
    if (!videoId) return;
    const token = ++flowToken;
    const url = location.href;
    hold = true;
    pauseVideo();
    const info = await send('promptInfo', { videoId });
    if (token !== flowToken || stopped || !info) {
      release();
      return;
    }
    const bridge = matchingInfo();
    prompt = showPrompt({
      categories: info.categories,
      title: bridge?.title ?? info.title ?? document.title.replace(/ - YouTube$/, ''),
      channelName: bridge?.channelName ?? info.channelName,
      channelId: bridge?.channelId ?? info.channelId,
      currentCategoryId: info.currentCategoryId,
      onChoose: (categoryId, rememberChannel) => {
        const current = matchingInfo();
        const channelId = current?.channelId ?? info.channelId;
        prompt?.close();
        prompt = null;
        release();
        void (async () => {
          const r = await send('categorize', {
            videoId,
            categoryId,
            url,
            channelRule: rememberChannel && channelId ? { channelId, channelName: current?.channelName ?? info.channelName ?? channelId } : undefined,
          });
          if (token !== flowToken || stopped) return;
          if (r && r.decision.action === 'block') doBlock(r.blockedUrl);
        })();
      },
    });
  }
  pill.onClick = () => void reprompt();

  for (const ev of ['yt-navigate-finish', 'yt-page-data-updated', 'yt-navigate-start']) {
    window.addEventListener(ev, () => {
      if (stopped) return;
      if (pageKey() !== gatedKey) void gate();
      else soon();
    });
  }
  // Every same-document URL change, including a bare history.pushState that YouTube's own events above do
  // not announce. (This is what webNavigation.onHistoryStateUpdated used to report to the worker.)
  (window as unknown as { navigation?: EventTarget }).navigation?.addEventListener('currententrychange', () => {
    if (!stopped && pageKey() !== gatedKey) void gate();
  });

  // ---- heartbeat -------------------------------------------------------------------------------------------

  function buildHeartbeat(): Heartbeat {
    const v = findVideo();
    const pb = readPlayback(v);
    const info = bridgeInfo;
    return {
      url: location.href,
      visible: document.visibilityState === 'visible',
      pip: !!document.pictureInPictureElement,
      playing: pb.playing,
      focused: document.hasFocus(),
      fullscreen: !!document.fullscreenElement,
      playerVideoId: info?.videoId ?? urlVideoId(),
      isLive: pb.isLive || !!info?.isLive,
      duration: pb.duration ?? info?.duration ?? null,
      currentTime: pb.currentTime,
      ended: pb.ended,
      adShowing: adShowing(),
    };
  }

  let ticking = false;
  async function tick(): Promise<void> {
    if (stopped || dormant || ticking) return;
    if (!alive()) {
      stop();
      return;
    }
    if (pageKey() !== gatedKey) void gate();
    ticking = true;
    try {
      const res = await send('heartbeat', buildHeartbeat());
      if (res?.inactive) sleep();
      else if (res?.decision.action === 'block') doBlock(res.blockedUrl);
      else if (res) {
        pill.update(res.overlay ?? null);
        shelf.update(res.shelf ?? null);
        if (res.tip === 'pill') showToast(PILL_TIP, 'info', 16000);
      }
    } finally {
      ticking = false;
    }
  }

  const soon = (): void => {
    setTimeout(() => void tick(), 50);
  };
  document.addEventListener('visibilitychange', soon);
  window.addEventListener('focus', soon);
  window.addEventListener('blur', soon);
  window.addEventListener('pageshow', soon);
  window.addEventListener('pagehide', () => {
    // Final report so the last interval is credited and the tab stops counting.
    if (stopped || !alive()) return;
    const hb = buildHeartbeat();
    hb.visible = false;
    hb.playing = false;
    hb.pip = false;
    void send('heartbeat', hb);
  });
  document.addEventListener('fullscreenchange', soon);
  for (const ev of ['play', 'pause', 'ended', 'enterpictureinpicture', 'leavepictureinpicture']) {
    document.addEventListener(ev, (e) => {
      if (isMainVideo(e.target)) soon();
    }, true);
  }
  timer = window.setInterval(() => void tick(), HEARTBEAT_SEC * 1000);

  void gate();
  soon();
}
