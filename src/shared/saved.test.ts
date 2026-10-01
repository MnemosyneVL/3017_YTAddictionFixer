import { describe, expect, it } from 'vitest';
import { newState } from './config';
import { T0, makeConfig } from './fixtures';
import type { PolicyContext } from './policy';
import { savedLinkViews, savedShelf } from './saved';
import type { SavedLink, VideoIndex } from './types';

const A = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
const S = 'https://www.youtube.com/shorts/sssssssssss';

function link(url: string, videoId: string, savedAt = T0, title?: string): SavedLink {
  return { url, videoId, title, savedAt, reason: 'daily' };
}

function ctx(links: SavedLink[], overrides: Partial<PolicyContext> = {}): PolicyContext {
  const state = newState('2026-08-23');
  state.savedLinks = links;
  return { config: makeConfig(), state, windows: [], now: T0, ...overrides };
}

describe('savedLinkViews', () => {
  it('joins category, channel and availability from the video index', () => {
    const index: VideoIndex = { aaaaaaaaaaa: { categoryId: 'learning', title: 'Rust', channelName: 'Jon', at: 0 } };
    const views = savedLinkViews(ctx([link(A, 'aaaaaaaaaaa', T0, 'Rust'), link(B, 'bbbbbbbbbbb')]), index);
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      url: A,
      title: 'Rust',
      channelName: 'Jon',
      available: true,
      category: { id: 'learning', name: 'Learning', color: '#42a5f5' },
    });
    // Unknown category: opening it prompts rather than blocks, so it is available; no chip, no channel.
    expect(views[1]).toMatchObject({ url: B, available: true });
    expect(views[1]!.category).toBeUndefined();
    expect(views[1]!.channelName).toBeUndefined();
    expect(views[1]!.blockedNow).toBeUndefined();
  });

  it('applies channel rules and the Shorts auto-category like enforcement does', () => {
    const c = ctx([link(A, 'aaaaaaaaaaa'), link(S, 'sssssssssss')]);
    c.config.channelRules['UC1'] = { categoryId: 'gamedev', channelName: 'GD', createdAt: 0 };
    const index: VideoIndex = { aaaaaaaaaaa: { channelId: 'UC1', at: 0 } };
    let views = savedLinkViews(c, index);
    expect(views[0]!.category?.id).toBe('gamedev');
    expect(views[1]!.category?.id).toBe('entertainment'); // config.shortsCategoryId
    c.config.categories.find((x) => x.id === 'gamedev')!.archived = true;
    views = savedLinkViews(c, index);
    expect(views[0]!.category).toBeUndefined();
  });

  it('shows no chip for a category that no longer exists', () => {
    const views = savedLinkViews(ctx([link(A, 'aaaaaaaaaaa')]), { aaaaaaaaaaa: { categoryId: 'gone', at: 0 } });
    expect(views[0]!.category).toBeUndefined();
    expect(views[0]!.available).toBe(true);
  });

  it('marks links that cannot be opened right now', () => {
    const index: VideoIndex = {
      aaaaaaaaaaa: { categoryId: 'entertainment', at: 0 },
      bbbbbbbbbbb: { categoryId: 'learning', at: 0 },
    };
    const c = ctx([link(A, 'aaaaaaaaaaa'), link(B, 'bbbbbbbbbbb')]);
    c.state.categoryBlocks['entertainment'] = { since: T0, grandfathers: [] };
    let views = savedLinkViews(c, index);
    expect(views.map((v) => [v.available, v.blockedNow])).toEqual([[false, 'category'], [true, undefined]]);

    c.state.dailyBlock = { since: T0, grandfathers: [] };
    views = savedLinkViews(c, index);
    expect(views.map((v) => v.blockedNow)).toEqual(['daily', 'daily']);

    c.state.override = { startedAt: T0, until: T0 + 60_000 };
    expect(savedLinkViews(c, index).every((v) => v.available)).toBe(true);

    const sched = ctx([link(A, 'aaaaaaaaaaa')], { windows: [{ fromMin: 0, toMin: 1439 }] });
    expect(savedLinkViews(sched, index)[0]).toMatchObject({ available: false, blockedNow: 'schedule' });

    const shorts = ctx([link(S, 'sssssssssss')]);
    shorts.config.shortsMode = 'block';
    expect(savedLinkViews(shorts, {})[0]).toMatchObject({ available: false, blockedNow: 'shorts' });
  });

  it('keeps the newest-first order and honours the limit', () => {
    const c = ctx([link(A, 'aaaaaaaaaaa', T0 + 2), link(B, 'bbbbbbbbbbb', T0 + 1), link(S, 'sssssssssss', T0)]);
    expect(savedLinkViews(c, {}).map((v) => v.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'sssssssssss']);
    expect(savedLinkViews(c, {}, 2).map((v) => v.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(savedLinkViews(ctx([]), {})).toEqual([]);
  });
});

describe('savedShelf', () => {
  it('lists the newest links with the overall total, and hides when off or empty', () => {
    const c = ctx([link(A, 'aaaaaaaaaaa', T0 + 2), link(B, 'bbbbbbbbbbb', T0 + 1), link(S, 'sssssssssss', T0)]);
    const shelf = savedShelf(c, {}, 2)!;
    expect(shelf.total).toBe(3);
    expect(shelf.items.map((v) => v.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(savedShelf(ctx([]), {}, 12)).toBeNull();
    c.config.showSavedShelf = false;
    expect(savedShelf(c, {}, 12)).toBeNull();
  });
});
