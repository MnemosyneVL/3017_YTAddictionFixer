// Message protocol between content scripts / pages and the service worker. Types only.
import type { TipId } from './onboarding';
import type { OverlayInfo } from './overlay';
import type { Report } from './report';
import type { SavedLinkView, SavedShelfInfo } from './saved';
import type {
  BlockReason,
  Category,
  CategoryId,
  Config,
  DayKey,
  Decision,
  Heartbeat,
  Millis,
  VideoId,
} from './types';

/** Video facts gathered by the content script / MAIN-world bridge. */
export interface VideoInfo {
  videoId: VideoId;
  title?: string;
  channelId?: string;
  channelName?: string;
  isLive?: boolean;
  duration?: number | null;
}

export interface DecideRequest {
  url: string;
  video?: VideoInfo;
}

export interface DecideResponse {
  decision: Decision;
  /** Categories to offer when the decision is `prompt`. */
  categories?: Pick<Category, 'id' | 'name' | 'color'>[];
  /** Known display data for the prompt. */
  title?: string;
  channelName?: string;
  blockedUrl?: string;
  /** Setup is not finished: nothing is recorded or enforced, and the content script should go quiet. */
  inactive?: boolean;
  /** With a `prompt` decision: this user has never answered the question, so the prompt explains itself. */
  tip?: 'prompt';
}

export interface HeartbeatResponse {
  decision: Decision;
  blockedUrl?: string;
  /** Setup is not finished (see `DecideResponse.inactive`). */
  inactive?: boolean;
  /** Sent once, with the first timer pill of a categorized video: the content script explains the pill. */
  tip?: 'pill';
  /** Seconds left today (null = unlimited). */
  remainingSec: number | null;
  /** Timer pill contents; absent on non-video pages or when the feature is off. */
  overlay?: OverlayInfo | null;
  /** Saved-for-later shelf contents; only on home/subscriptions feed pages. Absent or null hides the shelf. */
  shelf?: SavedShelfInfo | null;
}

export interface CategorizeRequest {
  videoId: VideoId;
  categoryId: CategoryId;
  /** When set, future videos of this channel get the category without a prompt. */
  channelRule?: { channelId: string; channelName: string };
  url: string;
  /** When sent from the popup: the tab showing the video, so a now-blocked video is redirected at once. */
  tabId?: number;
}

/** Data needed to (re)open the category prompt for a video. */
export interface PromptInfo {
  categories: Pick<Category, 'id' | 'name' | 'color'>[];
  currentCategoryId: CategoryId | null;
  title?: string;
  channelName?: string;
  channelId?: string;
}

export interface CategoryStatus {
  categoryId: CategoryId;
  name: string;
  color: string;
  sec: number;
  limitSec: number | null;
  blocked: boolean;
  /** The configured limit differs from today's effective one (raise takes effect tomorrow). */
  deferredLimitSec?: number | null;
}

/** How the user answered the feedback reminder. */
export const FEEDBACK_ACTIONS = ['rate', 'tips', 'later', 'never'] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

/** First-run state as the pages need it. */
export interface OnboardingInfo {
  /** False until the user pressed "Start" on the welcome page; nothing is recorded or enforced before that. */
  setupDone: boolean;
  /** The feedback reminder to show now (days after setup: 7, 30 or 90), or null. */
  feedbackDue: number | null;
}

export interface StatusSnapshot {
  /** See `OnboardingInfo.setupDone`. While false the rest of the snapshot is an empty day. */
  setupDone: boolean;
  dayKey: DayKey;
  now: Millis;
  /** Set while blocked hours are active: when they end. */
  scheduleBlockedUntil?: Millis | null;
  totalSec: number;
  dailyLimitSec: number | null;
  deferredDailyLimitSec?: number | null;
  remainingSec: number | null;
  dailyBlocked: boolean;
  grandfathered: VideoId[];
  overrideUntil: Millis | null;
  overridesLeft: number;
  categories: CategoryStatus[];
  nextBoundary: Millis;
  savedLinks: number;
}

export interface BlockInfo {
  decision: Decision;
  url: string;
  videoId: VideoId | null;
  title?: string;
  channelName?: string;
  reasonText: string;
  detailText: string;
  /** When the block is expected to lift (next day boundary), epoch ms. */
  allowedAt: Millis;
  overridesLeft: number;
  overrideMinutes: number;
  overrideUntil: Millis | null;
  savedLinks: SavedLinkView[];
  /** The first time this user is blocked: the placeholder explains what happened until "Got it" (`ackTip`). */
  firstBlock?: boolean;
}

/** A request without fields (callers pass `{}`). */
export type NoPayload = Record<never, never>;

export interface RequestMap {
  getBuild: { req: NoPayload; res: { build: string; version: string } };
  promptInfo: { req: { videoId: VideoId }; res: PromptInfo };
  decide: { req: DecideRequest; res: DecideResponse };
  heartbeat: { req: Heartbeat; res: HeartbeatResponse };
  videoInfo: { req: VideoInfo; res: { ok: true } };
  categorize: { req: CategorizeRequest; res: DecideResponse };
  getStatus: { req: NoPayload; res: StatusSnapshot };
  getConfig: { req: NoPayload; res: Config };
  saveConfig: {
    req: { config: Config };
    res: { config: Config; deferredDaily: boolean; deferredCategories: CategoryId[]; deferredSchedule: boolean };
  };
  getBlockInfo: { req: { url: string }; res: BlockInfo };
  useOverride: { req: { url: string }; res: { until: Millis | null } };
  /** Saved links newest first, joined with category, channel and current availability; `limit` caps the count. */
  getSavedLinks: { req: { limit?: number }; res: SavedLinkView[] };
  removeSavedLink: { req: { url: string }; res: { ok: true } };
  /** Opens the settings page in a new tab (content scripts cannot navigate to extension pages themselves). */
  openOptions: { req: { hash?: string }; res: { ok: true } };
  getReport: { req: { from: DayKey; to: DayKey }; res: Report };
  exportData: { req: NoPayload; res: { json: string } };
  /** Replaces all stored data with a validated backup; on success reports what was read. */
  importData: { req: { json: string }; res: { ok: boolean; error?: string; days?: number; videos?: number; savedLinks?: number } };
  clearData: { req: { keepConfig: boolean }; res: { ok: true } };
  getOnboarding: { req: NoPayload; res: OnboardingInfo };
  /**
   * The user answered the feedback reminder. Every answer puts it away until the next milestone; `never` also
   * switches the reminders off (`config.feedbackReminders`).
   */
  feedbackAction: { req: { action: FeedbackAction }; res: { ok: true } };
  /** The user dismissed a one-time explanation; it is not shown again. */
  ackTip: { req: { tip: TipId }; res: { ok: true } };
  /**
   * Finishes setup with the settings chosen on the welcome page: they apply today (no "raise takes effect
   * tomorrow"), and recording starts. Refused once setup is done.
   */
  completeSetup: { req: { config: Config }; res: { ok: boolean; error?: string } };
}

export type RequestType = keyof RequestMap;
export type Request<T extends RequestType = RequestType> = { type: T } & RequestMap[T]['req'];
export type Response<T extends RequestType> = RequestMap[T]['res'];
/** Any request, as a union discriminated on `type`. */
export type AnyRequest = { [T in RequestType]: Request<T> }[RequestType];

/** Pushed from the service worker to a YouTube tab. */
export type PushMessage =
  | { type: 'block'; reason: BlockReason; categoryId?: CategoryId; blockedUrl: string }
  | { type: 'toast'; text: string; kind: 'info' | 'warn' | 'limit' }
  /** Setup was just finished: a dormant content script starts working and runs its gate. */
  | { type: 'activate' };

export function blockedPageUrl(base: string, originalUrl: string, reason: BlockReason, categoryId?: CategoryId, finished = false): string {
  const params = new URLSearchParams({ u: originalUrl, r: reason });
  if (categoryId) params.set('c', categoryId);
  if (finished) params.set('f', '1');
  return `${base}?${params.toString()}`;
}
