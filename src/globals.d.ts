/** Build stamp (version + build time) injected by build.mjs into every bundle. */
declare const __BUILD__: string;

/** A file's text, as the unit tests import it (`import html from '…/popup.html?raw'`). */
declare module '*?raw' {
  const text: string;
  export default text;
}
