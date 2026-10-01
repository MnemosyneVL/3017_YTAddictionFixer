import { describe, expect, it } from 'vitest';
import { ACCESS } from './access';
import { applyConfigToDay, newDayRecord } from './day';
import { T0, makeConfig } from './fixtures';
import type { RequestType } from './messages';
import { TIPS, finishSetup, freshMeta, inertReply, isSetUp, markTip, normalizeMeta, tipDue } from './onboarding';

describe('normalizeMeta', () => {
  it('starts a new installation with setup pending', () => {
    const meta = normalizeMeta(undefined, { existingInstall: false, now: T0 });
    expect(meta).toEqual({ setupAt: null, tipsSeen: [], feedbackDone: [] });
    expect(isSetUp(meta)).toBe(false);
  });

  it('treats an installation that predates the setup step as set up from now on', () => {
    const meta = normalizeMeta(undefined, { existingInstall: true, now: T0 });
    // …and they have long seen what the beginner tips would tell them.
    expect(meta).toEqual({ setupAt: T0, tipsSeen: ['prompt', 'pill', 'block'], feedbackDone: [] });
    expect(isSetUp(meta)).toBe(true);
  });

  it('keeps stored state, pending or done, whatever else is stored', () => {
    expect(normalizeMeta({ setupAt: null }, { existingInstall: true, now: T0 })).toEqual({ setupAt: null, tipsSeen: [], feedbackDone: [] });
    expect(normalizeMeta({ setupAt: 12345, tipsSeen: ['pill', 'bogus', 'prompt'], feedbackDone: [30, 8, 7] }, { existingInstall: false, now: T0 })).toEqual({
      setupAt: 12345,
      tipsSeen: ['prompt', 'pill'],
      feedbackDone: [7, 30],
    });
  });

  it('reads a damaged record as pending rather than as done', () => {
    for (const raw of [{}, { setupAt: 'yes' }, { setupAt: true }, { setupAt: -5 }, { setupAt: 0 }, { setupAt: NaN }]) {
      expect(normalizeMeta(raw, { existingInstall: true, now: T0 }), JSON.stringify(raw)).toEqual({ setupAt: null, tipsSeen: [], feedbackDone: [] });
    }
    expect(normalizeMeta([1], { existingInstall: false, now: T0 })).toEqual(freshMeta());
  });
});

describe('finishSetup', () => {
  it("applies the chosen limits today, even when they are higher than the day's snapshot", () => {
    const defaults = makeConfig(); // 60 minutes a day, Entertainment 60
    const day = newDayRecord(defaults, '2026-08-23');
    const chosen = makeConfig({ dailyLimitMin: 180 });
    chosen.categories.find((c) => c.id === 'entertainment')!.limitMin = 120;

    // The ordinary path would defer both raises to tomorrow…
    const ordinary = newDayRecord(defaults, '2026-08-23');
    expect(applyConfigToDay(ordinary, chosen)).toMatchObject({ deferredDaily: true, deferredCategories: ['entertainment'] });
    expect(ordinary.limits.dailySec).toBe(3600);

    // …setup does not: these are the user's first limits, not a raise.
    const meta = finishSetup(freshMeta(), day, chosen, T0);
    expect(meta).toEqual({ setupAt: T0, tipsSeen: [], feedbackDone: [] });
    expect(day.limits.dailySec).toBe(180 * 60);
    expect(day.limits.category['entertainment']).toBe(120 * 60);
  });

  it('accepts "no daily limit"', () => {
    const day = newDayRecord(makeConfig(), '2026-08-23');
    finishSetup(freshMeta(), day, makeConfig({ dailyLimitMin: null }), T0);
    expect(day.limits.dailySec).toBeNull();
  });
});

describe('one-time tips', () => {
  it('are never due before setup is finished', () => {
    for (const tip of TIPS) expect(tipDue(freshMeta(), tip), tip).toBe(false);
  });

  it('are due once, until marked', () => {
    const meta = { ...freshMeta(), setupAt: T0 };
    expect(tipDue(meta, 'prompt')).toBe(true);
    expect(markTip(meta, 'prompt')).toBe(true);
    expect(markTip(meta, 'prompt')).toBe(false);
    expect(tipDue(meta, 'prompt')).toBe(false);
    expect(tipDue(meta, 'pill')).toBe(true);
    expect(meta.tipsSeen).toEqual(['prompt']);
  });
});

describe('inertReply', () => {
  it('answers everything a content script may send without recording, prompting or blocking', () => {
    for (const type of (Object.keys(ACCESS) as RequestType[]).filter((t) => ACCESS[t] === 'content')) {
      const reply = inertReply(type);
      if (type === 'openOptions') {
        expect(reply).toBeUndefined();
        continue;
      }
      expect(reply, type).toBeDefined();
      const decision = (reply as { decision?: { action: string } }).decision;
      if (decision) expect(decision.action, type).toBe('allow');
    }
    expect(inertReply('decide')).toMatchObject({ inactive: true });
    expect(inertReply('heartbeat')).toMatchObject({ inactive: true, remainingSec: null });
    expect(inertReply('useOverride')).toEqual({ until: null });
  });

  it('lets the extension pages read and change settings while setup is pending', () => {
    for (const type of ['getConfig', 'saveConfig', 'getStatus', 'getOnboarding', 'completeSetup', 'feedbackAction', 'ackTip', 'exportData', 'importData', 'clearData'] as const) {
      expect(inertReply(type), type).toBeUndefined();
    }
  });
});
