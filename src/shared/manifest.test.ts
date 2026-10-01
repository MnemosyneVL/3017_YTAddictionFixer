import { describe, expect, it } from 'vitest';
import manifest from '../../public/manifest.json';
import { EXCLUDED_SUBDOMAINS } from './url';

describe('public/manifest.json', () => {
  it('keeps the content scripts off the same YouTube subdomains that isYouTubeHost() excludes', () => {
    const expected = EXCLUDED_SUBDOMAINS.map((sub) => `*://${sub}.youtube.com/*`).sort();
    expect(manifest.content_scripts.length).toBeGreaterThan(0);
    for (const script of manifest.content_scripts) {
      expect([...script.exclude_matches].sort()).toEqual(expected);
    }
  });

  it('runs content scripts in the top frame only and exposes just the placeholder page', () => {
    for (const script of manifest.content_scripts) expect(script.all_frames).toBe(false);
    expect(manifest.web_accessible_resources.flatMap((r) => r.resources)).toEqual(['blocked.html']);
  });
});
