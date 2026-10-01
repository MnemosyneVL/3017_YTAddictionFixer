import { describe, expect, it } from 'vitest';
import { STARTER_CATEGORIES, defaultCategories, defaultConfig, newCategoryId, normalizeConfig, selectableCategories } from './config';
import { makeConfig } from './fixtures';

describe('normalizeConfig', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeConfig(undefined)).toEqual(defaultConfig());
    expect(normalizeConfig('x')).toEqual(defaultConfig());
    expect(normalizeConfig({})).toEqual(defaultConfig());
  });

  it('keeps valid values, clamps invalid ones, restores built-ins and drops broken rules', () => {
    const c = normalizeConfig({
      dailyLimitMin: 45,
      dayStartMinutes: 99999,
      warnBeforeMin: -3,
      countingMode: 'bogus',
      heartbeatSec: 1,
      categories: [
        { id: 'music', name: 'Music', color: '#123456', limitMin: 30, order: 0, archived: true },
        { id: 'music', name: 'Duplicate' },
        { name: 'no id' },
        { id: 'uncategorized', name: 'Unc', builtin: 'uncategorized', limitMin: 5 },
      ],
      shortsMode: 'block',
      shortsCategoryId: 'does-not-exist',
      channelRules: { UC1: { categoryId: 'music', channelName: 'M' }, UC2: { categoryId: 'nope' }, UC3: 'bad' },
      overridesPerDay: 99,
    });
    expect(c.dailyLimitMin).toBe(45);
    expect(c.dayStartMinutes).toBe(23 * 60 + 59);
    expect(c.warnBeforeMin).toBe(0);
    expect(c.countingMode).toBe('visibleOrPlaying');
    expect(c.heartbeatSec).toBe(2);
    expect(c.categories.map((x) => x.id)).toEqual(['music', 'browsing', 'uncategorized']);
    expect(c.categories[0]).toMatchObject({ archived: true, limitMin: 30 });
    expect(c.categories.find((x) => x.id === 'uncategorized')!.limitMin).toBeNull();
    expect(c.shortsMode).toBe('block');
    expect(c.shortsCategoryId).toBe('music'); // only non-builtin category, even though archived
    expect(Object.keys(c.channelRules)).toEqual(['UC1']);
    expect(c.overridesPerDay).toBe(10);
  });

  it('seeds default categories when none are user-defined', () => {
    const c = normalizeConfig({ categories: [{ id: 'browsing', name: 'B', builtin: 'browsing' }] });
    expect(c.categories.map((x) => x.id)).toEqual(['learning', 'entertainment', 'browsing', 'uncategorized']);
  });

  it('uses the pre-selected starter categories as defaults, and offers more', () => {
    expect(defaultCategories().filter((c) => !c.builtin).map((c) => c.id)).toEqual(
      STARTER_CATEGORIES.filter((c) => c.preselected).map((c) => c.id),
    );
    expect(STARTER_CATEGORIES.length).toBeGreaterThan(defaultCategories().filter((c) => !c.builtin).length);
    expect(new Set(STARTER_CATEGORIES.map((c) => c.id)).size).toBe(STARTER_CATEGORIES.length);
    // Shorts go to Entertainment unless the user chooses otherwise.
    expect(defaultConfig().shortsCategoryId).toBe('entertainment');
  });

  it('selectable categories exclude built-ins and archived', () => {
    const c = makeConfig();
    c.categories[0]!.archived = true;
    expect(selectableCategories(c).map((x) => x.id)).toEqual(['gamedev', 'entertainment']);
  });

  it('keeps the saved-shelf toggle and defaults it to on', () => {
    expect(defaultConfig().showSavedShelf).toBe(true);
    expect(normalizeConfig({ showSavedShelf: false }).showSavedShelf).toBe(false);
    expect(normalizeConfig({ showSavedShelf: 'yes' }).showSavedShelf).toBe(true);
  });

  it('keeps the feedback-reminder switch and defaults it to on', () => {
    expect(defaultConfig().feedbackReminders).toBe(true);
    expect(normalizeConfig({ feedbackReminders: false }).feedbackReminders).toBe(false);
    expect(normalizeConfig({ feedbackReminders: 'no' }).feedbackReminders).toBe(true);
  });

  it('generates unique slug ids', () => {
    const c = defaultConfig();
    expect(newCategoryId('Music & Podcasts', c.categories)).toBe('music-podcasts');
    expect(newCategoryId('Learning', c.categories)).toMatch(/^learning-\d+$/);
    expect(newCategoryId('***', c.categories)).toBe('category');
  });

  it('never generates an id that is an inherited object name, and keeps ids short', () => {
    expect(newCategoryId('Constructor', [])).toBe('constructor-category');
    expect(newCategoryId('x'.repeat(200), [])).toHaveLength(48);
  });

  it('drops categories and channel rules whose id is an inherited object name', () => {
    const c = normalizeConfig(
      JSON.parse(`{
        "categories": [{ "id": "constructor", "name": "Constructor" }, { "id": "__proto__", "name": "P" }, { "id": "music", "name": "Music" }],
        "channelRules": { "constructor": { "categoryId": "music" }, "__proto__": { "categoryId": "music" }, "UC1": { "categoryId": "music" } }
      }`),
    );
    expect(c.categories.map((x) => x.id)).toEqual(['music', 'browsing', 'uncategorized']);
    expect(Object.keys(c.channelRules)).toEqual(['UC1']);
  });

  it('accepts only #rrggbb colours and caps names', () => {
    const c = normalizeConfig({
      categories: [
        { id: 'a', name: 'A', color: 'url(https://example.com/x)' },
        { id: 'b', name: 'n'.repeat(200), color: '#ABCDEF' },
        { id: 'c', name: 'C', color: 'red' },
      ],
    });
    expect(c.categories[0]!.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(c.categories[1]).toMatchObject({ color: '#ABCDEF' });
    expect(c.categories[1]!.name).toHaveLength(60);
    expect(c.categories[2]!.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
