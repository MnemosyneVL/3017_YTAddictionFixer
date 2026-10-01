// Test fixtures for the pure modules (not bundled into the extension).
import type { AccountingContext } from './accounting';
import { builtinCategories, defaultConfig, newState } from './config';
import { newDayRecord } from './day';
import type { Category, Config, Heartbeat, VideoIndex } from './types';

export const T0 = Date.UTC(2026, 7, 23, 10, 0, 0); // arbitrary fixed instant

/** The categories the tests are written against. Fixed here, so the product's starter categories can change. */
export function testCategories(): Category[] {
  return [
    { id: 'learning', name: 'Learning', color: '#42a5f5', limitMin: null, graceMin: null, order: 0 },
    { id: 'gamedev', name: 'Game dev', color: '#66bb6a', limitMin: null, graceMin: null, order: 1 },
    { id: 'entertainment', name: 'Entertainment', color: '#ffa726', limitMin: 60, graceMin: null, order: 2 },
    ...builtinCategories(),
  ];
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig(), categories: testCategories(), ...overrides };
}

export function makeContext(overrides: Partial<AccountingContext> = {}, config?: Partial<Config>): AccountingContext {
  const cfg = makeConfig(config);
  const state = newState('2026-08-23');
  return {
    config: cfg,
    state,
    day: newDayRecord(cfg, '2026-08-23'),
    tabs: {},
    videoIndex: {} as VideoIndex,
    idle: 'active',
    now: T0,
    ...overrides,
  };
}

export function hb(overrides: Partial<Heartbeat> = {}): Heartbeat {
  return {
    url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    visible: true,
    pip: false,
    playing: true,
    focused: true,
    fullscreen: false,
    playerVideoId: 'aaaaaaaaaaa',
    isLive: false,
    duration: 600,
    currentTime: 10,
    ended: false,
    adShowing: false,
    ...overrides,
  };
}
