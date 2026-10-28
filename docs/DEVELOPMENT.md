# Development

## Prerequisites

- Node.js 20+ (developed with 22), npm.
- Google Chrome (Manifest V3; Chrome 120+).

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs dev dependencies and points git at `.githooks/` (pre-commit hook). |
| `npm run build` | Cleans and rebuilds `dist/` (bundles `src/` with esbuild, copies `public/`). This is the development build: it includes the hook the e2e harness talks to (`src/background/test-hook.ts`). |
| `npm run package` | The store package: typecheck, unit tests, a release build without the test hook into `release/unpacked/`, then `scripts/package.mjs` checks it (store title and summary against `brand.json` and their lengths, version, the exact permission list, every referenced file, icon sizes, no source maps, no test hook, no `eval`, required links, `LICENSE`) and writes `release/<slug>-<version>.zip`, read back and verified. `-- --draft` packs although links or the license are still missing, as `…-draft.zip`. |
| `npm run e2e:release` | Smoke test of `release/unpacked` in Chrome for Testing: the worker starts without the test hook, the welcome page opens, Start works, every page renders. |
| `npm run watch` | Rebuilds bundles on change (static files in `public/` are copied only at start). |
| `npm run typecheck` | `tsc --noEmit` over `src/`. |
| `npm test` | Unit tests (Vitest) for the pure logic in `src/shared/`. |
| `npm run check` | typecheck + test + build — must pass before every commit. |
| `npm run icons` | Regenerates `public/icons/*.png` (no dependencies). `-- --design ring` renders the fallback design, `-- --preview <file.png>` also writes a sheet with every size enlarged on a light and a dark toolbar colour. |
| `npm run e2e` | Browser smoke tests with Puppeteer + Chrome for Testing against live youtube.com (see "Environment notes"). `npm run e2e -- --headless` runs them without a window, as does `npm run e2e:setup -- --headless`; the other harnesses are always headless. |
| `npm run e2e:setup` | First-run flow against real youtube.com: nothing is recorded before "Start", the chosen limit applies the same day, an open video is picked up, "Delete everything" returns to the first-run state, an older installation is not gated. |
| `npm run e2e:ui [dir]` | Screenshots every extension page into `dir` (default: the temp folder): the welcome page, popup and settings of a fresh installation, then popup, settings, statistics (`report.png`) and the help page with sample data. Fails on a page error or an unrendered page. |
| `npm run e2e:stale` | Verifies the stale-service-worker banner (no banner when builds match, banner on mismatch). |
| `node e2e/shot.mjs` | Ad-hoc: screenshots the player with the timer pill (`%TEMP%\ytb-pill.png`). |
| `node e2e/shelf-shot.mjs` | Ad-hoc: seeds three saved links and screenshots the saved-for-later shelf on the home feed in both themes (`%TEMP%\ytb-shelf-{light,dark}.png`). |
| `node e2e/feed-dom.mjs [--profile <dir>]` | Ad-hoc: dumps YouTube's markup around the feed grid (home, subscriptions) and checks what a link inside a shadow root does — for re-verifying the saved-for-later shelf's anchors when YouTube changes its layout. `--profile .yt-budget-profile` (with the dedicated browser closed) shows a signed-in feed; the extension itself is not loaded, so no time is counted. |
| `node e2e/store-shots.mjs` | The Chrome Web Store graphics into `release/store/`: five 1280x800 screenshots and the 440x280 promo tile, from seeded sample data and a mock video page (no third-party content). |
| `start.bat` / `stop.bat` | Windows: a dedicated browser with the extension loaded (see "A dedicated browser" below); `start.bat` rebuilds first and restarts a running instance. |

## Loading the extension in Chrome

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. **Load unpacked** → select the `dist/` folder.
4. Optional but recommended: open the extension's *Details* and enable **Allow in Incognito**, otherwise an
   incognito window is an easy way around the limits.
5. After changing code: `npm run build`, then click the reload icon on the extension card. Open YouTube tabs
   are re-injected automatically on reload (see `onInstalled` in the service worker).
   **Do not skip the reload:** extension pages load fresh from disk, but the service worker keeps running the
   old build until the extension is reloaded — an old worker strips config fields it does not know, and the
   popup/options page will show a "needs a reload" banner (build stamps compared via `getBuild`).

## A dedicated browser (Windows)

After the one-time `npm install`, the launchers in the project folder give you a separate browser window with
the development build loaded:

- **`start.bat`** rebuilds the extension and opens it. Sign in to YouTube once in that window; the login and the
  extension's data are remembered in `.yt-budget-profile/` (git-ignored; never zip or publish that folder).
- **`stop.bat`** closes that browser, and nothing else.

They use the "Chrome for Testing" browser that `npm install` downloads, because regular Chrome no longer loads
unpacked extensions from the command line.

## Environment notes

- Developed on Windows 11 with Node 22. In Windows PowerShell 5.1 `&&` is not a valid separator (use `;` or
  separate commands).
- Branded Chrome ≥ 137 ignores `--load-extension` (also with `--disable-features=DisableLoadExtensionCommandLineSwitch`).
  Only "Chrome for Testing" (`%USERPROFILE%\.cache\puppeteer\chrome\win64-*`, installed by `npm install`) honours it;
  that is what the launchers and the e2e harness use.
- Chrome for Testing does not start video playback in automation (buffers ~2 s, then pauses; even a trusted
  click does not help). Playback-dependent behaviour is unit-tested; e2e asserts on state and redirects.
- A fresh profile in the EU gets YouTube's consent page/dialog; `e2e/lib.mjs:dismissConsent` clicks "Reject all".
  The in-page dialog is rendered a second or two after load and covers the player, so a real mouse click lands
  on it; pass `{ waitMs }` to keep looking for it. The overlays only react to real (trusted) input, so tests
  click them through an element handle (`page.evaluateHandle(…)` + `.click()`), never with `dispatchEvent`.
- A fresh, logged-out profile gets an *empty* home feed (`ytd-rich-grid-renderer > #contents` exists but has no
  items) and no subscriptions feed, so the e2e shelf checks only assert placement and contents; how the shelf
  sits next to real videos is checked by hand in a signed-in browser (`start.bat`).
- The worker persists a fresh `state` during its initial load: a harness that seeds storage must first await any
  request (`rpc(worker, 'getBuild')`) or the seed is overwritten.
- Every `launch()` is a fresh installation, so setup is pending and the welcome tab opens. By default `launch()`
  finishes setup (`completeSetup` with the fixed `TEST_CATEGORIES` and a 60-minute day) and closes that tab:
  left open it keeps the focus, and time only counts in a focused tab. Pass `{ setup: false }` to test the
  first-run state itself (`e2e/setup.mjs`, `e2e/ui.mjs`).
- Every bundle carries a build stamp (`__BUILD__`, set in `build.mjs`); pages compare it with the worker's via
  `getBuild` and show a red banner when the worker is stale.

## Upgrading the running extension

Main Chrome: `npm run build` (or `start.bat`, which builds too), then `chrome://extensions` → reload arrow on
the extension's card. Dedicated browser: just run `start.bat` (it rebuilds, stops the old instance and
relaunches). Open YouTube tabs are re-injected automatically after a reload.

## Debugging

- Service worker logs: `chrome://extensions` → the extension card → **Inspect views: service worker**.
- Content script logs: DevTools on the YouTube tab, console context named after the extension (messages are prefixed `[yt-budget]`).
- Storage: in the service worker console, `chrome.storage.local.get(null, console.log)`.
- Reset everything: Settings page → Data → *Delete everything* (*Clear all data* keeps the settings), or
  `chrome.storage.local.clear()` in the service worker console.

## Manual test checklist (run before a release)

0. Fresh profile (or Settings → Data → *Delete everything*): the welcome page opens, the badge shows `!`, a
   YouTube video plays untouched. Choose a limit and categories, press *Start*: the badge shows the minutes, the
   open video asks for its category, and *Help* in the popup opens the same page as a help page. On this fresh
   installation the first question explains why it asks, the first timer shows a tip once, and the first
   placeholder page explains what happened until *Got it*.
1. Set the daily limit to 2 minutes and the warning to 1 minute. Watch any video.
2. At 1 minute: warning notification and in-page toast.
3. At 2 minutes: "limit reached" notification; the current video keeps playing.
4. Open another video (new tab, end screen, or autoplay): it is redirected to the placeholder page showing the
   correct original link; the link appears in *Saved for later*.
5. Click *Use emergency override*: YouTube works again; after the override minutes it is cut off immediately.
6. Set *Entertainment* to 1 minute. Categorize a video as Entertainment; after it ends, the next Entertainment
   video is blocked while a *Learning* video still plays.
7. The Statistics page shows the time split by category; raising a limit shows "effective tomorrow".
8. Minimize the window while a video plays → time keeps counting (playing). Pause and minimize → it does not.
9. Let the finish-it video play to its end → the "you finished your video" screen appears and the video is NOT
   in the saved list. Click the timer pill mid-video → the prompt reopens and re-categorizing moves the minutes.
10. Add a blocked-hours window covering now → everything is blocked with the schedule message; remove the
   window → still blocked today ("takes effect tomorrow"); the override lifts it.
11. With a few saved links, open the home feed and the subscriptions feed: the "Saved for later" shelf sits
    above the first row (check light and dark theme), cards show the category chip and channel, a video whose
    category is exhausted is greyed with "Blocked today" and leads to the placeholder, × removes it, "See all"
    opens the settings list, middle-click opens a new tab, switching the shelf off in settings hides it within a
    few seconds, and feed → video → back brings it back. The settings list and the popup show the categories.

## Release checklist

1. `npm run check`, `npm run e2e`, `npm run e2e:setup` and `npm run e2e:ui` are green and the manual checklist
   passed.
2. Bump `version` in `package.json`, `public/manifest.json` and the two `version` entries at the top of
   `package-lock.json`.
3. In `CHANGELOG.md`, rename `[Unreleased]` to `[x.y.z] - YYYY-MM-DD` and add a fresh empty `[Unreleased]`.
4. Commit `docs: release x.y.z`, tag `vx.y.z`.
5. `npm run package`, then `npm run e2e:release`.
6. Push `main` and the tag (`git push origin main`, `git push origin vx.y.z`).
7. In the Chrome Web Store developer dashboard: upload `release/<slug>-<version>.zip` (Package tab), change
   there whatever the package does not carry (description, category, graphics, privacy answers: see
   `docs/STORE_LISTING.md`, "Updating the listing"), and submit for review.
8. Once the review has passed, check the public listing (version, title) and update the Status line in
   `docs/STORE_LISTING.md`.

A new permission makes `npm run package` fail on purpose: add it to `EXPECTED_PERMISSIONS` in
`scripts/package.mjs` only together with its justification in `docs/STORE_LISTING.md`.
