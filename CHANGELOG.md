# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- The README links to the extension's page in the Chrome Web Store, now that it is published: installing is
  one click on "Add to Chrome" there.

## [1.0.0] - 2026-10-01

The first public release, as **Addiction Recovery for YouTube™** in the Chrome Web Store. Earlier versions
were a personal tool called "YouTube Budget"; an installation of those keeps its data and settings.

### Added
- A welcome page opens when the extension is installed. It explains how the time budget works, lets you choose
  your daily limit and your categories (Learning and Entertainment are suggested, with Music, News, Gaming,
  Work or your own), and says plainly what is recorded and that it stays on your device. **Nothing is
  recorded, asked or blocked until you press "Start"**; until then the toolbar icon shows `!` and the popup
  offers to finish the setup. The limits you choose there apply the same day. Installations that are already in
  use are not sent through the setup.
- A help page that is always one click away ("Help" in the popup, "How it works" in Settings and on the
  placeholder page): how it works, what the toolbar icon shows, answers to common questions, and what is
  recorded.
- Settings ends with an **About** card (version, help, and links to the privacy policy, the source code and
  the issue tracker) and a **Support this project** block with a note from the author and a link to Ko-fi.
- The same note appears as a small card in the popup, on the report page and in Settings after one week, one
  month and three months of use: it asks for a rating and a comment, and mentions Ko-fi second. Any answer puts
  it away until the next time, "Don't ask again" (or the switch in Settings → Support) turns it off for good.
  It is never a system notification and never shows while YouTube is blocked.
- Explanations where there were none: Settings now says what each Shorts mode does, what "unlimited", "After
  limit", archive and delete mean for a category, what channel rules are, what export, import and the two
  delete buttons do, and how the emergency override works.
- Three one-time tips at the moment they matter: the first category question says why it is asked, the first
  timer on a video says what it shows and that a click changes the category, and the first time you are
  blocked the placeholder page explains what happened and what your options are.
- Settings → Data → "Delete everything": removes all stored data including your settings and categories, and
  returns the extension to its initial state ("Clear all data" keeps the settings, as before). Open YouTube tabs go
  quiet at once: the timer, any message and the saved-for-later shelf disappear until setup is finished again.

### Changed
- The project is now free software under the GNU General Public License, version 3 or later (`LICENSE`), with
  a privacy policy (`PRIVACY.md`), a security policy (`SECURITY.md`) and a README written for the public.
- The extension is now called **Addiction Recovery for YouTube™** (the Chrome Web Store does not allow
  "YouTube" as the name of an extension). The toolbar, the popup, Settings, the report and the placeholder page
  show the new name. Inside YouTube itself and in notifications it stays discreet: the category prompt just
  asks "What is this video?", and toasts, the saved-for-later shelf and notifications are labelled "Time
  budget". Exported files are named `youtube-time-budget-…`. Your data and settings are untouched.
- New icon: a syringe on pause, with a simpler pause-in-a-capsule mark at toolbar size. The old one looked too
  much like YouTube's own logo for the Chrome Web Store.
- The extension no longer asks for the permission behind Chrome's "Read your browsing history" warning. It
  only needs access to YouTube itself, notifications and local storage; blocking works as before.
- The popup shows a limit you raised today as "→ 2h 00m from tomorrow", next to today's limit that is still
  in force.
- For developers: `npm run package` produces the Chrome Web Store package from a release build that leaves
  out the development test hook, after checking the manifest, the permission list, the files and the links.
- Importing a backup checks the whole file before anything is replaced, asks for confirmation first and then
  tells you what it imported (days, videos, saved links). A file that is not a backup leaves your data alone;
  before, the existing data was wiped first.

### Fixed
- Saving the settings shows its confirmation ("Saved. Increases take effect tomorrow.") again: it sat in a bar
  that was hidden the moment the settings were saved.
- "See all" (popup, feed shelf) scrolls to the saved-for-later list in Settings; it used to run before the page
  was drawn.
- The "needs a reload" notice now says which thing to reload: this page (the extension was updated while it
  was open, with a button) or the extension itself.
- Security: a script running inside a YouTube page (the site's own code, another extension, a userscript) could
  post a crafted message and make the extension run any of its internal commands: wipe or replace all data,
  change the settings, spend the emergency override. What the page reports is now reduced to the few video
  facts the extension uses, and a message can no longer choose which command runs.
- Security: the background service now checks who is asking. Only the extension's own pages can read your
  history, change settings, export, import or clear data; the part that runs inside YouTube pages can only do
  what its own interface needs, cannot touch the stored data directly, and every request is validated before it
  is acted on.
- A tab that had been on YouTube and then moved to another site could be sent to the "blocked" page when a
  limit or blocked hours kicked in during the following ten minutes. Only tabs that are still showing YouTube
  are redirected now.
- Addresses are accepted only when they are real http(s) YouTube addresses (the placeholder page, the
  saved-for-later lists), category colours only as `#rrggbb`, and stored data is re-checked every time it is
  loaded. A damaged or hand-edited backup, for example one with a category whose id is `constructor`, can no
  longer break tracking or blocking.
- Returning to a video you were still allowed to finish within a second or two of landing on the "blocked"
  page could bounce the tab to the blocked page again. The follow-up check now only acts on a tab that is
  still showing the page that was blocked.
- The category prompt, the timer on the video and the saved-for-later shelf react only to real clicks and key
  presses, not to ones a page script makes up. The placeholder page stays blank when another page embeds it.
- On install or update the extension no longer adds itself to YouTube's sign-in, consent, Studio and support
  pages that happened to be open.

## [0.4.1] - 2026-09-02

### Fixed
- Browsing time (feeds, search, channel pages) is counted in every "Count time when" mode while the page is
  visible and you are active on it. Before, "Only while a video is playing" left Browsing at 0. The modes now
  only decide how videos count, and the settings page explains each one next to the dropdown.
- A saved-for-later video that you watch to its end is removed from the list (and from the feed shelf and the
  popup) instead of staying there.

## [0.4.0] - 2026-09-02

### Added
- "Saved for later" shelf at the top of the YouTube home and subscriptions feeds: your newest saved videos as
  cards (thumbnail, title, channel, category chip, "Blocked today" when a video cannot be watched right now),
  each with a remove button, plus "See all" (opens the settings list). Clicking a card opens the video the
  normal way, so the usual budget rules apply. Toggle under Settings → General ("Saved-for-later shelf"), on
  by default.

### Changed
- The saved-for-later list (Settings and the placeholder page) shows each video's category (colour and name)
  and channel. It is the video's *current* category, so re-categorizing a video or renaming a category is
  reflected at once; a video that was blocked before it was ever categorized says "no category yet".
- The toolbar popup lists the newest five saved-for-later videos with their category ("blocked today" marks
  one that cannot be watched right now) and a "See all" link, replacing the bare "Saved (n)" button.

## [0.3.0] - 2026-08-26

### Added
- Blocked hours: clock windows (overnight spans supported) during which YouTube is fully closed — advance
  warning, hard cutoff at the boundary, badge/popup/placeholder all say when it reopens. Extending windows
  applies immediately; removing them takes effect tomorrow. The emergency override lifts them.
- Per-category "After limit" allowance: how long the current video may keep playing once a limit trips —
  until the video ends (default), a fixed number of minutes, or 0 to stop immediately. Applies to both the
  daily and the category limit, based on the watched video's category.
- Re-categorize the current video: click the timer pill on the player (the prompt reopens with the current
  category marked) or use the new "Current video" row in the popup. Today's minutes move to the new category;
  moving a video into an exhausted category blocks it immediately.

### Fixed
- A grandfathered video that played to its natural end is no longer added to the saved-for-later list, and
  the placeholder now says "You finished your video" instead of presenting it as blocked content. A video cut
  off mid-way (allowance ran out) is still saved so the rest can be watched another day.

## [0.2.1] - 2026-08-24

### Fixed
- Saving settings from a freshly rebuilt options page could silently lose new settings (the tick reverted)
  when the background service worker was still running the previous build — Chrome only re-reads the worker
  when the extension is reloaded. The popup and options page now detect this and show a "needs a reload"
  banner instead of failing silently, and `start.bat` closes an already-running YouTube Budget browser before
  launching so the fresh build always loads.

## [0.2.0] - 2026-08-24

### Added
- On-video timer pill: today's remaining (or used) time plus the current video's category with its color,
  shown in a player corner (fullscreen included), click-through, ticking while time counts. Toggle and corner
  under Settings → General ("Timer on the video"). On by default.
- `start.bat` / `stop.bat` launchers. `start.bat` builds the extension and opens a dedicated Chrome (the
  "Chrome for Testing" downloaded by `npm install`) with the extension already loaded and a persistent profile
  in `.yt-budget-profile/`; `stop.bat` closes only that browser. Regular Chrome no longer loads unpacked
  extensions from the command line, so the launchers use the dedicated browser; the main-Chrome alternative
  (load `dist/` once via `chrome://extensions`) is documented in the README.


## [0.1.0] - 2026-08-23

### Added
- Popup: today's total against the daily limit, per-category budgets with progress bars, block/override status.
- Options page: daily limit, day start, warning, counting mode and idle threshold; category create/edit/color/
  limit/archive/delete; Shorts mode and category; channel-rule list; saved-for-later list; JSON export/import
  and a keep-settings data reset. Increases are flagged as taking effect tomorrow.
- Report page: today / 7-day / 30-day / custom range, a stacked per-day SVG chart with the daily-limit line,
  category split with shares, top channels and videos, override/limit counts, and CSV export.
- UI render smoke test (`npm run e2e:ui`) that seeds data and screenshots every page.
- Service worker: in-memory store with a `ready()` gate and a serialized handler queue, split storage keys,
  day rollover via `chrome.alarms`, per-tab registry in session storage, idle/focus tracking, toolbar badge,
  system notifications and metadata fetch (oEmbed).
- Content script: a `document_start` gate that holds new videos paused until the service worker decides, a
  MAIN-world bridge that reads the player API (video id, immutable channel id, title, live flag, duration),
  the category prompt overlay (Shadow DOM, fullscreen-aware, keyboard 1–9), in-page toasts, orphan-script
  self-termination, and re-injection into open tabs after an extension reload.
- Enforcement across the gate, `webNavigation.onCommitted`/`onHistoryStateUpdated`, heartbeats and block
  transitions; blocked pages redirect to a placeholder that preserves the original URL and auto-saves the link.
- Placeholder page: reason and figures, the blocked video with copy/open/close, the emergency override, and the
  saved-for-later list.
- Puppeteer end-to-end smoke suite (`npm run e2e`) exercising the full pipeline against real youtube.com (18 checks).
- Core logic (pure, unit-tested): YouTube URL classification, day boundaries with a configurable day start,
  the counting rule (visible-or-playing / visible-only / playing-only), segment-based time accounting with
  multi-tab de-duplication, daily and per-category limit detection with warnings, grandfather budgets for the
  video being watched when a limit trips, allow/block/prompt policy, deferred limit raises, the emergency
  override, report aggregation and CSV export, config normalisation with seeded default categories.
- Project scaffold: Manifest V3 extension skeleton, TypeScript + esbuild build (`npm run build` / `npm run watch`),
  Vitest test setup, generated icons (`npm run icons`), documentation set (`README.md`, `docs/`), and a
  pre-commit hook that refuses code commits without a changelog entry.
