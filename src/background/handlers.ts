// Message handlers. Every handler runs inside the store's serialized queue.
import { applyHeartbeat, recheckLimits, type AccountingEvent } from '../shared/accounting';
import { parseBackup } from '../shared/backup';
import { categoryById, normalizeConfig, selectableCategories } from '../shared/config';
import { KEY_CONFIG, KEY_META, SHELF_ITEMS } from '../shared/constants';
import { answerFeedback, dueFeedback } from '../shared/feedback';
import { applyConfigToDay, dailyRemainingSec, dayTotals, limitsFromConfig, setVideoCategory } from '../shared/day';
import type {
  AnyRequest,
  BlockInfo,
  CategorizeRequest,
  CategoryStatus,
  DecideRequest,
  DecideResponse,
  HeartbeatResponse,
  PromptInfo,
  RequestMap,
  RequestType,
  StatusSnapshot,
} from '../shared/messages';
import { finishSetup, inertReply, isSetUp, markTip, tipDue } from '../shared/onboarding';
import { overlayInfo } from '../shared/overlay';
import { minuteInWindow, scheduleBlocked, scheduleUnblockAt } from '../shared/schedule';
import { evaluate, expireOverride, overrideActive, overridesLeft, startOverride } from '../shared/policy';
import { buildReport } from '../shared/report';
import { savedLinkViews, savedShelf } from '../shared/saved';
import { dayKeysInRange, formatDuration, nextBoundary } from '../shared/time';
import type { Config, Decision, Heartbeat, Millis } from '../shared/types';
import { feedKind, isVideoPage, parseYouTubeUrl } from '../shared/url';
import { scheduleBoundaryAlarm, scheduleOverrideEnd, scheduleRollover } from './alarms';
import { updateBadge } from './badge';
import { blockedUrlFor, enforceAll, enforceTab, policyContext, resolveCategory, saveLink } from './enforcement';
import { ensureTitle, mergeVideoInfo } from './metadata';
import { announce, notifySchedule } from './notifications';
import { ensureDay, loadDays, persist, pruneTabs, reload, type Store } from './store';
import { activateOpenTabs } from './tabs';

type Handler<T extends RequestType> = (s: Store, req: RequestMap[T]['req'], sender: chrome.runtime.MessageSender, now: Millis) => Promise<RequestMap[T]['res']>;

/** Shared reaction to accounting events: notify, and enforce when a block started or a budget ran out. */
async function react(s: Store, events: AccountingEvent[], now: Millis): Promise<void> {
  if (events.length === 0) return;
  await announce(s, events);
  const blockChanged = events.some((e) => e.type === 'dailyLimit' || e.type === 'categoryLimit' || e.type === 'grandfatherExhausted');
  if (blockChanged) await enforceAll(s, now);
}

/** Housekeeping at the start of every handler that may change time state. */
async function tick(s: Store, now: Millis): Promise<void> {
  const rolled = await ensureDay(s, now);
  if (rolled) {
    await scheduleRollover(s, now);
    await scheduleBoundaryAlarm(s, now);
  }
  if (expireOverride(s.state, now)) {
    await persist(s, ['state']);
    await enforceAll(s, now);
  }
  if (pruneTabs(s, now)) await persist(s, ['tabs']);
  await warnUpcomingWindows(s, now);
}

/** Warns once per window occurrence shortly before blocked hours begin (only while YouTube is open). */
async function warnUpcomingWindows(s: Store, now: Millis): Promise<void> {
  const warnMin = s.config.warnBeforeMin;
  if (warnMin <= 0 || Object.keys(s.tabs).length === 0) return;
  const windows = s.day.limits.windows;
  if (windows.length === 0 || scheduleBlocked(now, windows)) return;
  const d = new Date(now);
  const nowMin = d.getHours() * 60 + d.getMinutes();
  for (const w of windows) {
    const key = `${w.fromMin}-${w.toMin}`;
    if (s.state.warned.schedule[key]) continue;
    const minutesUntil = (w.fromMin - nowMin + 1440) % 1440;
    if (minutesUntil > 0 && minutesUntil <= warnMin && !minuteInWindow(nowMin, w)) {
      s.state.warned.schedule[key] = true;
      await persist(s, ['state']);
      await notifySchedule(s, w.fromMin);
    }
  }
}

const getBuild: Handler<'getBuild'> = async () => ({ build: __BUILD__, version: chrome.runtime.getManifest().version });

const decide: Handler<'decide'> = async (s, req: DecideRequest, sender, now) => {
  await tick(s, now);
  const parsed = parseYouTubeUrl(req.url);
  const videoId = isVideoPage(parsed) ? parsed.videoId : null;
  let indexChanged = false;
  if (req.video && req.video.videoId) indexChanged = mergeVideoInfo(s, req.video, now) || indexChanged;
  const before = videoId ? s.videoIndex[videoId]?.categoryId : undefined;
  const categoryId = resolveCategory(s, videoId, { channelId: req.video?.channelId, isShorts: parsed.pageType === 'shorts', now });
  if (videoId && before !== categoryId) indexChanged = true;
  const decision = evaluate(req.url, categoryId, policyContext(s, now));
  const res: DecideResponse = { decision };
  if (decision.action === 'block') {
    if (saveLink(s, req.url, decision, now)) await persist(s, ['state']);
    res.blockedUrl = blockedUrlFor(s, req.url, decision);
  } else if (decision.action === 'prompt') {
    res.categories = selectableCategories(s.config).map((c) => ({ id: c.id, name: c.name, color: c.color }));
    const entry = videoId ? s.videoIndex[videoId] : undefined;
    res.title = entry?.title;
    res.channelName = entry?.channelName;
    if (tipDue(s.meta, 'prompt')) res.tip = 'prompt';
  }
  if (indexChanged) await persist(s, ['videoIndex', 'day']);
  return res;
};

const heartbeat: Handler<'heartbeat'> = async (s, hb: Heartbeat, sender, now) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { decision: { action: 'allow', categoryId: null }, remainingSec: null };
  await tick(s, now);
  const parsed = parseYouTubeUrl(hb.url);
  // Make sure Shorts auto-categorisation is applied before the interval is attributed.
  if (hb.playerVideoId) resolveCategory(s, hb.playerVideoId, { isShorts: parsed.pageType === 'shorts', now });
  const result = applyHeartbeat({ ...s, now }, tabId, hb);
  await persist(s, ['state', 'day', 'tabs']);
  await react(s, result.events, now);
  await updateBadge(s, now);
  const categoryId = resolveCategory(s, isVideoPage(parsed) ? parsed.videoId : null, { isShorts: parsed.pageType === 'shorts', now });
  const decision = await enforceTab(s, tabId, hb.url, categoryId, now, hb.playerVideoId);
  const res: HeartbeatResponse = { decision, remainingSec: dailyRemainingSec(s.day) };
  if (decision.action === 'block') res.blockedUrl = blockedUrlFor(s, hb.url, decision);
  else if (isVideoPage(parsed)) {
    res.overlay = overlayInfo(s.config, s.day, categoryId, result.counts);
    // Once, when the pill first shows a category and the user is looking at it.
    if (res.overlay && categoryId && hb.visible && hb.focused && tipDue(s.meta, 'pill')) {
      res.tip = 'pill';
      markTip(s.meta, 'pill');
      await persist(s, ['meta']);
    }
  }
  else if (feedKind(hb.url)) res.shelf = savedShelf(policyContext(s, now), s.videoIndex, SHELF_ITEMS);
  return res;
};

const videoInfo: Handler<'videoInfo'> = async (s, info, sender, now) => {
  if (info.videoId && mergeVideoInfo(s, info, now)) await persist(s, ['videoIndex']);
  return { ok: true };
};

const categorize: Handler<'categorize'> = async (s, req: CategorizeRequest, sender, now) => {
  await tick(s, now);
  const cat = categoryById(s.config, req.categoryId);
  if (!cat || cat.archived || cat.builtin === 'uncategorized') throw new Error('unknown category');
  s.videoIndex[req.videoId] = { ...(s.videoIndex[req.videoId] ?? { at: now }), categoryId: req.categoryId, at: now };
  setVideoCategory(s.day, req.videoId, req.categoryId);
  const keys: ('config' | 'videoIndex' | 'day' | 'state' | 'meta')[] = ['videoIndex', 'day'];
  if (markTip(s.meta, 'prompt')) keys.push('meta');
  if (req.channelRule?.channelId) {
    s.config.channelRules[req.channelRule.channelId] = { categoryId: req.categoryId, channelName: req.channelRule.channelName, createdAt: now };
    s.videoIndex[req.videoId]!.channelId = req.channelRule.channelId;
    s.videoIndex[req.videoId]!.channelName = req.channelRule.channelName;
    keys.push('config');
  }
  const events = recheckLimits({ ...s, now });
  if (events.length) keys.push('state');
  await persist(s, keys);
  await react(s, events, now);
  await updateBadge(s, now);
  const decision = evaluate(req.url, req.categoryId, policyContext(s, now));
  const res: DecideResponse = { decision };
  if (decision.action === 'block') {
    if (saveLink(s, req.url, decision, now)) await persist(s, ['state']);
    res.blockedUrl = blockedUrlFor(s, req.url, decision);
    // From the popup there is no content script waiting on this reply; redirect the tab directly.
    if (req.tabId !== undefined) await enforceTab(s, req.tabId, req.url, req.categoryId, now);
  }
  return res;
};

const promptInfo: Handler<'promptInfo'> = async (s, req, _sender, now) => {
  if (await ensureTitle(s, req.videoId, now)) await persist(s, ['videoIndex']);
  const entry = s.videoIndex[req.videoId];
  const info: PromptInfo = {
    categories: selectableCategories(s.config).map((c) => ({ id: c.id, name: c.name, color: c.color })),
    currentCategoryId: entry?.categoryId ?? null,
  };
  if (entry?.title) info.title = entry.title;
  if (entry?.channelName) info.channelName = entry.channelName;
  if (entry?.channelId) info.channelId = entry.channelId;
  return info;
};

function buildStatus(s: Store, now: Millis): StatusSnapshot {
  const totals = dayTotals(s.day);
  const target = limitsFromConfig(s.config);
  const categories: CategoryStatus[] = s.config.categories
    .filter((c) => c.builtin !== 'uncategorized' || (totals.byCategory[c.id] ?? 0) > 0)
    .map((c) => {
      const limitSec = s.day.limits.category[c.id] ?? null;
      const targetSec = target.category[c.id] ?? null;
      const row: CategoryStatus = {
        categoryId: c.id,
        name: c.name,
        color: c.color,
        sec: totals.byCategory[c.id] ?? 0,
        limitSec,
        blocked: !!s.state.categoryBlocks[c.id],
      };
      if (c.builtin !== 'uncategorized' && targetSec !== limitSec) row.deferredLimitSec = targetSec;
      return row;
    });
  const grandfathered = [
    ...(s.state.dailyBlock?.grandfathers ?? []),
    ...Object.values(s.state.categoryBlocks).flatMap((b) => b.grandfathers),
  ].map((g) => g.videoId);
  const snapshot: StatusSnapshot = {
    setupDone: isSetUp(s.meta),
    dayKey: s.state.dayKey,
    now,
    scheduleBlockedUntil: scheduleBlocked(now, s.day.limits.windows) ? scheduleUnblockAt(now, s.day.limits.windows) : null,
    totalSec: totals.totalSec,
    dailyLimitSec: s.day.limits.dailySec,
    remainingSec: dailyRemainingSec(s.day),
    dailyBlocked: !!s.state.dailyBlock,
    grandfathered: Array.from(new Set(grandfathered)),
    overrideUntil: overrideActive(s.state, now) ? s.state.override!.until : null,
    overridesLeft: overridesLeft(s.config, s.day),
    categories,
    nextBoundary: nextBoundary(now, s.config.dayStartMinutes),
    savedLinks: s.state.savedLinks.length,
  };
  if (target.dailySec !== s.day.limits.dailySec) snapshot.deferredDailyLimitSec = target.dailySec;
  return snapshot;
}

const getStatus: Handler<'getStatus'> = async (s, _req, _sender, now) => {
  await tick(s, now);
  await updateBadge(s, now);
  return buildStatus(s, now);
};

const getConfig: Handler<'getConfig'> = async (s) => s.config;

const saveConfig: Handler<'saveConfig'> = async (s, req, _sender, now) => {
  const next: Config = normalizeConfig(req.config);
  const dayStartChanged = next.dayStartMinutes !== s.config.dayStartMinutes;
  s.config = next;
  const deferred = applyConfigToDay(s.day, s.config);
  const events = recheckLimits({ ...s, now });
  await persist(s, ['config', 'day', 'state']);
  if (dayStartChanged) {
    await ensureDay(s, now);
    await scheduleRollover(s, now);
  }
  await scheduleBoundaryAlarm(s, now);
  await react(s, events, now);
  await enforceAll(s, now); // added blocked hours apply immediately
  await updateBadge(s, now);
  return {
    config: s.config,
    deferredDaily: deferred.deferredDaily,
    deferredCategories: deferred.deferredCategories,
    deferredSchedule: deferred.deferredSchedule,
  };
};

function describeBlock(s: Store, decision: Decision, now: Millis): { reasonText: string; detailText: string } {
  if (decision.action !== 'block') {
    return { reasonText: 'You can watch this now', detailText: 'The block no longer applies.' };
  }
  const totals = dayTotals(s.day);
  switch (decision.reason) {
    case 'daily': {
      const limit = s.day.limits.dailySec ?? 0;
      const g = s.state.dailyBlock?.grandfathers.length ?? 0;
      return {
        reasonText: 'Daily YouTube limit reached',
        detailText: `${formatDuration(totals.totalSec)} of ${formatDuration(limit)} used today.${g ? ' You may still finish the video you were watching.' : ''}`,
      };
    }
    case 'category': {
      const name = categoryById(s.config, decision.categoryId)?.name ?? decision.categoryId ?? 'Category';
      const limit = (decision.categoryId ? s.day.limits.category[decision.categoryId] : null) ?? 0;
      const used = decision.categoryId ? (totals.byCategory[decision.categoryId] ?? 0) : 0;
      return {
        reasonText: `${name} limit reached`,
        detailText: `${formatDuration(used)} of ${formatDuration(limit)} used today. Other categories are still available.`,
      };
    }
    case 'shorts':
      return { reasonText: 'Shorts are blocked', detailText: 'Shorts are switched off in the settings.' };
    case 'schedule': {
      const until = scheduleUnblockAt(now, s.day.limits.windows);
      const at = new Date(until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return {
        reasonText: 'YouTube is closed right now',
        detailText: `Blocked hours are active — YouTube opens again at ${at}.`,
      };
    }
  }
}

const getBlockInfo: Handler<'getBlockInfo'> = async (s, req, _sender, now) => {
  await tick(s, now);
  const parsed = parseYouTubeUrl(req.url);
  const videoId = isVideoPage(parsed) ? parsed.videoId : null;
  // (No title lookup while setup is pending: nothing is blocked then, and nothing should be fetched or stored.)
  if (isSetUp(s.meta) && videoId && (await ensureTitle(s, videoId, now))) await persist(s, ['videoIndex']);
  const categoryId = resolveCategory(s, videoId, { isShorts: parsed.pageType === 'shorts', now });
  const decision = evaluate(req.url, categoryId, policyContext(s, now));
  const entry = videoId ? s.videoIndex[videoId] : undefined;
  const info: BlockInfo = {
    decision,
    url: req.url,
    videoId,
    title: entry?.title,
    channelName: entry?.channelName,
    ...describeBlock(s, decision, now),
    allowedAt:
      decision.action === 'block' && decision.reason === 'schedule'
        ? scheduleUnblockAt(now, s.day.limits.windows)
        : nextBoundary(now, s.config.dayStartMinutes),
    overridesLeft: overridesLeft(s.config, s.day),
    overrideMinutes: s.config.overrideMinutes,
    overrideUntil: overrideActive(s.state, now) ? s.state.override!.until : null,
    savedLinks: savedLinkViews(policyContext(s, now), s.videoIndex),
  };
  if (decision.action === 'block' && tipDue(s.meta, 'block')) info.firstBlock = true;
  return info;
};

const useOverride: Handler<'useOverride'> = async (s, req, _sender, now) => {
  await tick(s, now);
  const until = startOverride(s.config, s.state, s.day, now);
  if (until !== null) {
    await persist(s, ['state', 'day']);
    await scheduleOverrideEnd(until);
    await updateBadge(s, now);
  }
  return { until };
};

const getSavedLinks: Handler<'getSavedLinks'> = async (s, req, _sender, now) => {
  await tick(s, now); // roll the day over first so "available now" reflects today
  return savedLinkViews(policyContext(s, now), s.videoIndex, req.limit);
};

const removeSavedLink: Handler<'removeSavedLink'> = async (s, req) => {
  s.state.savedLinks = s.state.savedLinks.filter((l) => l.url !== req.url);
  await persist(s, ['state']);
  return { ok: true };
};

/** Opens the settings page for a content script (web pages cannot navigate to extension pages). */
const openOptions: Handler<'openOptions'> = async (_s, req) => {
  const hash = req.hash && /^[a-z][a-z0-9-]{0,31}$/i.test(req.hash) ? `#${req.hash}` : '';
  await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) });
  return { ok: true };
};

const getReport: Handler<'getReport'> = async (s, req, _sender, now) => {
  await tick(s, now);
  const keys = dayKeysInRange(req.from, req.to);
  const days = await loadDays(keys);
  return buildReport(days, s.videoIndex, s.config, req.from, req.to);
};

const exportData: Handler<'exportData'> = async () => {
  const all = await chrome.storage.local.get(null);
  return { json: JSON.stringify({ app: 'youtube-budget', exportedAt: new Date().toISOString(), data: all }, null, 2) };
};

/** After storage was replaced wholesale: re-read it and bring alarms and badge in line with the new data. */
async function restart(now: Millis): Promise<Store> {
  await chrome.storage.session.clear().catch(() => undefined);
  const next = await reload();
  await scheduleRollover(next, now);
  await scheduleBoundaryAlarm(next, now);
  await scheduleOverrideEnd(next.state.override && next.state.override.until > now ? next.state.override.until : null);
  await updateBadge(next, now);
  return next;
}

const importData: Handler<'importData'> = async (_s, req, _sender, now) => {
  // Validate and rebuild everything first; storage is only touched once the whole file made sense.
  const parsed = parseBackup(req.json, now);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { items, days, videos, savedLinks } = parsed.backup;
  // Write, then remove what the backup does not contain: storage is never empty in between. `meta` belongs to
  // this installation, not to the backup: importing neither finishes a pending setup nor undoes a finished one.
  const existing = Object.keys(await chrome.storage.local.get(null));
  await chrome.storage.local.set(items);
  const stale = existing.filter((k) => k !== KEY_META && !Object.hasOwn(items, k));
  if (stale.length) await chrome.storage.local.remove(stale);
  await restart(now);
  return { ok: true, days, videos, savedLinks };
};

const clearData: Handler<'clearData'> = async (s, req, _sender, now) => {
  const { config, meta } = s;
  await chrome.storage.local.clear();
  // "Clear all data" keeps the settings and the fact that setup was done; "Delete everything" keeps nothing,
  // which puts the installation back into its initial state, setup pending.
  if (req.keepConfig) await chrome.storage.local.set({ [KEY_CONFIG]: config, [KEY_META]: meta });
  await restart(now);
  return { ok: true };
};

/** The feedback reminder that is due right now, if any. Never while YouTube is closed for the user. */
function feedbackDue(s: Store, now: Millis): number | null {
  const blocked = !!s.state.dailyBlock || Object.keys(s.state.categoryBlocks).length > 0 || scheduleBlocked(now, s.day.limits.windows);
  return dueFeedback({ setupAt: s.meta.setupAt, done: s.meta.feedbackDone, enabled: s.config.feedbackReminders, blocked, now });
}

const getOnboarding: Handler<'getOnboarding'> = async (s, _req, _sender, now) => ({ setupDone: isSetUp(s.meta), feedbackDue: feedbackDue(s, now) });

const feedbackAction: Handler<'feedbackAction'> = async (s, req, _sender, now) => {
  const keys: ('config' | 'meta')[] = [];
  const due = feedbackDue(s, now);
  if (due !== null) {
    s.meta.feedbackDone = answerFeedback(s.meta.feedbackDone, due);
    keys.push('meta');
  }
  if (req.action === 'never' && s.config.feedbackReminders) {
    s.config.feedbackReminders = false;
    keys.push('config');
  }
  if (keys.length) await persist(s, keys);
  return { ok: true };
};

const ackTip: Handler<'ackTip'> = async (s, req) => {
  if (markTip(s.meta, req.tip)) await persist(s, ['meta']);
  return { ok: true };
};

const completeSetup: Handler<'completeSetup'> = async (s, req, _sender, now) => {
  // Only while pending: afterwards this would be a way to raise today's limits.
  if (isSetUp(s.meta)) return { ok: false, error: 'Setup is already finished. Change your limits in Settings.' };
  await ensureDay(s, now);
  s.config = normalizeConfig(req.config);
  s.meta = finishSetup(s.meta, s.day, s.config, now);
  await persist(s, ['config', 'day', 'meta']);
  await scheduleRollover(s, now);
  await scheduleBoundaryAlarm(s, now);
  await updateBadge(s, now);
  await activateOpenTabs();
  return { ok: true };
};

const handlers: { [T in RequestType]: Handler<T> } = {
  getBuild,
  promptInfo,
  decide,
  heartbeat,
  videoInfo,
  categorize,
  getStatus,
  getConfig,
  saveConfig,
  getBlockInfo,
  useOverride,
  getSavedLinks,
  removeSavedLink,
  openOptions,
  getReport,
  exportData,
  importData,
  clearData,
  getOnboarding,
  feedbackAction,
  ackTip,
  completeSetup,
};

/** Runs a request that already passed `checkRequest()` (known type, allowed for the sender, rebuilt payload). */
export async function handle(s: Store, req: AnyRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (!Object.hasOwn(handlers, req.type)) throw new Error(`unknown request type ${String(req.type)}`);
  // The one place that keeps a new installation quiet: until setup is finished, nothing that would record,
  // prompt or block reaches its handler.
  if (!isSetUp(s.meta)) {
    const inert = inertReply(req.type);
    if (inert !== undefined) return inert;
  }
  const h = handlers[req.type] as Handler<typeof req.type>;
  return h(s, req as never, sender, Date.now());
}

export async function handleAlarm(s: Store, name: string): Promise<void> {
  const now = Date.now();
  await tick(s, now);
  if (name === 'override-end') {
    if (expireOverride(s.state, now)) await persist(s, ['state']);
    await enforceAll(s, now);
  }
  if (name === 'schedule-boundary') {
    await enforceAll(s, now);
  }
  await scheduleRollover(s, now);
  await scheduleBoundaryAlarm(s, now);
  await updateBadge(s, now);
}

