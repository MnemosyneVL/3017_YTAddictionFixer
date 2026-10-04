import { describe, expect, it } from 'vitest';
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
    expect(manifest.name).toBe(brand.name);
    expect(manifest.description).toBe(brand.summary);
    expect(manifest.action.default_title).toBe(brand.name);
  });

  it('respects the Chrome Web Store limits and the trademark form', () => {
    expect([...brand.name].length).toBeLessThanOrEqual(75);
    expect([...brand.summary].length).toBeLessThanOrEqual(132);
    // A Google trademark may only follow "for", with the ™ sign; it may not open the name.
    expect(brand.name.endsWith('for YouTube™')).toBe(true);
    expect(brand.name).toBe(`${brand.label} ${brand.suffix}`);
    expect(/youtube/i.test(brand.label)).toBe(false);
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
