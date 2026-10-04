// The product's name and its external links. They live in brand.json so that the bundles, the unit tests and
// the packaging script all read the same values. Pure.
import brand from './brand.json';

/**
 * The product's name, as the extension's own pages show it. The store listing and the browser's extension list
 * use `title` from brand.json (the manifest's `name`): this name followed by a few words on what it does.
 */
export const APP_NAME: string = brand.name;
/** The name without the "for YouTube™" reference; page headers show the reference smaller next to it. */
export const APP_LABEL: string = brand.label;
export const APP_SUFFIX: string = brand.suffix;
/**
 * What the extension calls itself inside YouTube pages and in notifications. Those are read by whoever can
 * see the screen, so they do not carry the product name.
 */
export const NEUTRAL_LABEL: string = brand.neutral;
/** Stem of the files the user downloads (backup, CSV export of the statistics). */
export const FILE_STEM: string = brand.fileStem;
export const AUTHOR: string = brand.author;
/** Prefix of console messages. */
export const LOG_TAG = '[yt-budget]';

export type LinkKey = keyof typeof brand.links;

/** An external link, or null while it is not set; the UI then leaves the element out. Only https counts. */
export function link(key: LinkKey): string | null {
  const url: unknown = brand.links[key];
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/** This extension's reviews page in the Chrome Web Store. */
export function storeReviewsUrl(extensionId: string): string {
  return `https://chromewebstore.google.com/detail/${encodeURIComponent(extensionId)}/reviews`;
}
