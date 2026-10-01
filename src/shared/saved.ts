// View model for the saved-for-later list: joins each saved link with what we know about the video. Pure.
import { categoryById } from './config';
import { evaluate, knownCategory, type PolicyContext } from './policy';
import type { BlockReason, CategoryId, SavedLink, VideoIndex } from './types';
import { parseYouTubeUrl } from './url';

export interface SavedLinkView extends SavedLink {
  /** The video's current category — live, so re-categorizing or editing a category is reflected at once. */
  category?: { id: CategoryId; name: string; color: string };
  channelName?: string;
  /** Opening the link right now is allowed (or prompts for a category). */
  available: boolean;
  /** Why it cannot be opened right now (set when `available` is false). */
  blockedNow?: BlockReason;
}

/**
 * Saved links newest first, each with its category (same precedence as enforcement: explicit memory, channel
 * rule, Shorts auto-category), the channel name and whether it could be opened right now. A category that no
 * longer exists yields no chip. `limit` caps the number of entries.
 */
export function savedLinkViews(ctx: PolicyContext, videoIndex: VideoIndex, limit = Infinity): SavedLinkView[] {
  const out: SavedLinkView[] = [];
  for (const link of ctx.state.savedLinks) {
    if (out.length >= limit) break;
    const parsed = parseYouTubeUrl(link.url);
    const entry = link.videoId ? videoIndex[link.videoId] : undefined;
    const categoryId = knownCategory(ctx.config, entry, { isShorts: parsed.pageType === 'shorts' });
    const cat = categoryById(ctx.config, categoryId);
    const decision = evaluate(link.url, categoryId, ctx);
    const view: SavedLinkView = { ...link, available: decision.action !== 'block' };
    if (cat) view.category = { id: cat.id, name: cat.name, color: cat.color };
    if (entry?.channelName) view.channelName = entry.channelName;
    if (decision.action === 'block') view.blockedNow = decision.reason;
    out.push(view);
  }
  return out;
}

export interface SavedShelfInfo {
  /** Number of saved links overall (the shelf lists only the newest few). */
  total: number;
  items: SavedLinkView[];
}

/** Contents of the feed shelf, or null when it is switched off or nothing is saved. */
export function savedShelf(ctx: PolicyContext, videoIndex: VideoIndex, limit: number): SavedShelfInfo | null {
  if (!ctx.config.showSavedShelf || ctx.state.savedLinks.length === 0) return null;
  return { total: ctx.state.savedLinks.length, items: savedLinkViews(ctx, videoIndex, limit) };
}
