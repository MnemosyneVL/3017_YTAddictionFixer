import { describe, expect, it } from 'vitest';
import { shouldCount, type CountingInput } from './counting';

function i(o: Partial<CountingInput>): CountingInput {
  return { visible: false, pip: false, playing: false, focused: false, idle: 'active', browsing: false, ...o };
}

describe('shouldCount', () => {
  it('visibleOrPlaying: playback always counts, attention counts, parked tabs do not', () => {
    const m = 'visibleOrPlaying';
    expect(shouldCount(m, i({ playing: true }))).toBe(true); // background audio / covered window
    expect(shouldCount(m, i({ visible: true, focused: true }))).toBe(true); // reading comments
    expect(shouldCount(m, i({ pip: true, focused: true }))).toBe(true);
    expect(shouldCount(m, i({ visible: true, focused: false }))).toBe(false); // second monitor, paused
    expect(shouldCount(m, i({ visible: true, focused: true, idle: 'idle' }))).toBe(false); // walked away
    expect(shouldCount(m, i({ visible: false, focused: true }))).toBe(false); // minimized, paused
    expect(shouldCount(m, i({ playing: true, idle: 'locked' }))).toBe(false);
  });
  it('visibleOnly: hidden playback is free', () => {
    const m = 'visibleOnly';
    expect(shouldCount(m, i({ playing: true }))).toBe(false);
    expect(shouldCount(m, i({ playing: true, visible: true }))).toBe(true);
    expect(shouldCount(m, i({ playing: true, pip: true }))).toBe(true);
    expect(shouldCount(m, i({ visible: true, focused: true }))).toBe(true);
    expect(shouldCount(m, i({ visible: true, focused: false }))).toBe(false);
  });
  it('playingOnly: only playback', () => {
    const m = 'playingOnly';
    expect(shouldCount(m, i({ playing: true }))).toBe(true);
    expect(shouldCount(m, i({ visible: true, focused: true }))).toBe(false); // a paused video
    expect(shouldCount(m, i({ playing: true, idle: 'locked' }))).toBe(false);
  });
});

describe('shouldCount for pages without a video', () => {
  it('browsing counts while looked at, in every mode', () => {
    for (const m of ['visibleOrPlaying', 'visibleOnly', 'playingOnly'] as const) {
      expect(shouldCount(m, i({ browsing: true, visible: true, focused: true })), m).toBe(true);
      expect(shouldCount(m, i({ browsing: true, visible: true, focused: false })), m).toBe(false); // second monitor
      expect(shouldCount(m, i({ browsing: true, visible: true, focused: true, idle: 'idle' })), m).toBe(false); // walked away
      expect(shouldCount(m, i({ browsing: true, visible: false, focused: true })), m).toBe(false); // minimized
      expect(shouldCount(m, i({ browsing: true, visible: true, focused: true, idle: 'locked' })), m).toBe(false);
    }
  });
});
