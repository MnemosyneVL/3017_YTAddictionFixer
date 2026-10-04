import { describe, expect, it } from 'vitest';
import storeListing from '../../docs/STORE_LISTING.md?raw';
import blockedHtml from '../../public/blocked.html?raw';
import manifest from '../../public/manifest.json';
import optionsHtml from '../../public/options.html?raw';
import popupHtml from '../../public/popup.html?raw';
import reportHtml from '../../public/report.html?raw';
import welcomeHtml from '../../public/welcome.html?raw';
import { APP_NAME, link, storeReviewsUrl } from './brand';
import brand from './brand.json';

function titleOf(html: string): string {
  return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
}

describe('brand', () => {
  it('keeps the manifest in step with brand.json', () => {
    // The store and the browser's extension list show the title; the toolbar tooltip keeps the plain name.
    expect(manifest.name).toBe(brand.title);
    expect(manifest.description).toBe(brand.summary);
    expect(manifest.action.default_title).toBe(brand.name);
  });

  it('respects the Chrome Web Store limits and the trademark form', () => {
    expect([...brand.title].length).toBeLessThanOrEqual(75);
    expect([...brand.summary].length).toBeLessThanOrEqual(132);
    // A Google trademark may only follow "for", with the ™ sign; it may not open the name.
    expect(brand.name.endsWith('for YouTube™')).toBe(true);
    expect(brand.name).toBe(`${brand.label} ${brand.suffix}`);
    expect(/youtube/i.test(brand.label)).toBe(false);
  });

  it('builds the store title from the name plus a short description, without a second trademark', () => {
    expect(brand.title.startsWith(`${brand.name} – `)).toBe(true);
    expect(brand.title.match(/youtube/gi)).toHaveLength(1);
    // The store's spam rules: a keyword that keeps coming back in the listing texts draws scrutiny.
    for (const text of [brand.title, brand.summary]) {
      const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
      for (const w of new Set(words)) expect(words.filter((x) => x === w).length, `"${w}" in "${text}"`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the store texts in docs/STORE_LISTING.md in step and within the keyword rule', () => {
    expect(storeListing).toContain(`\`${brand.title}\``);
    expect(storeListing).toContain(`> ${brand.summary}`);
    const description = /\*\*Description:\*\*\s*```\r?\n([\s\S]*?)```/.exec(storeListing)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(500);
    // "Keep instances of a specific keyword to under 5" (spam-policy FAQ). The two mentions in the trademark
    // attribution at the end count too.
    const text = description.toLowerCase();
    for (const term of ['youtube', 'limit', 'budget', 'tracker', 'block', 'focus', 'distraction', 'productivity', 'detox', 'statistics', 'timer']) {
      expect(text.split(term).length - 1, term).toBeLessThan(5);
    }
    // The summary sits above the description in the store; the description does not say it again.
    expect(description).not.toContain(brand.summary);
    expect(description).toContain('YouTube is a trademark of Google LLC.');
  });

  it('names every extension page after the product', () => {
    for (const [page, html] of Object.entries({ blockedHtml, optionsHtml, popupHtml, reportHtml, welcomeHtml })) {
      expect(titleOf(html), page).toContain(APP_NAME);
    }
  });

  it('calls the statistics page "Statistics", not "Report"', () => {
    // "Report" next to an extension reads like "report this extension"; only the file keeps that name.
    expect(titleOf(reportHtml).startsWith('Statistics')).toBe(true);
  });

  it('only ever hands out https links, and none while a link is not set', () => {
    for (const [key, url] of Object.entries(brand.links)) {
      expect(url === '' || url.startsWith('https://'), key).toBe(true);
      expect(link(key as keyof typeof brand.links)).toBe(url === '' ? null : url);
    }
    expect(storeReviewsUrl('abcdefghijklmnopabcdefghijklmnop')).toBe(
      'https://chromewebstore.google.com/detail/abcdefghijklmnopabcdefghijklmnop/reviews',
    );
  });
});
