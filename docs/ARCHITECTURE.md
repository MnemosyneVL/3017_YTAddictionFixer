# Architecture

Manifest V3 Chrome extension. Three runtime parts plus five extension pages. All decision logic is pure
TypeScript in `src/shared/` and unit-tested; the service worker and content scripts are adapters.

```
  youtube.com tab                                        service worker (src/background)
  +-------------------------------------------+          +---------------------------------------------+
  | content.js (isolated world, document_start)| --gate-> | ready(): load storage into memory            |
  |  - gate: ask before the page can play      | <decide- | queue: handlers run one at a time            |
  |  - heartbeat every 5 s + on state events   | --hb---> | accounting.apply() -> day record             |
  |  - category prompt overlay (Shadow DOM)    |          | policy.evaluate() -> allow | block | prompt  |
  |  - toast banners                           | <block-- | enforce(): message tab, fallback tabs.update |
  |  - on block: pause + location.replace()    |          | per-tab registry (storage.session)           |
  | bridge.js (MAIN world) -> postMessage      |          | notifications, badge, alarms, oEmbed         |
  |   {videoId, channelId, title, isLive, ...} |          |                                              |
  +-------------------------------------------+          +----------------------+----------------------+
                                                                                | chrome.storage.local (+session)
                           blocked.html, popup.html, options.html, report.html, welcome.html  (src/pages)
```

## Components

| Part | Files | Responsibility |
|---|---|---|
| Shared logic | `src/shared/*.ts` | Types, URL parsing, day keys, counting rule, time accounting, limits, policy, report derivations, storage defaults/migrations, message types, validation of everything that crosses a trust boundary, and the product name and links (`brand.json` / `brand.ts`). No `chrome.*`, no DOM. |
| Service worker | `src/background/*.ts` | Owns all state. Receives heartbeats, credits time, detects limits, decides allow/block, enforces, notifies, keeps the badge, schedules alarms, fetches video metadata (oEmbed). |
| Content script | `src/content/index.ts`, `player.ts`, `prompt.ts`, `timer.ts`, `toast.ts`, `shelf.ts` | Observes the page (visibility, focus, `<video>` state, fullscreen, PiP), sends heartbeats, shows the category prompt, the on-video timer pill, toasts and the saved-for-later shelf on the feed, executes blocks (`location.replace`). |
| Bridge | `src/content/bridge.ts` (MAIN world) | Reads YouTube's player API (`#movie_player`): video id, channel id, title, live flag, duration/current time, player state. Posts plain objects via `window.postMessage`. |
| Pages | `src/pages/*.ts` + `public/*.html` | Placeholder (blocked), popup (today's budgets, current video, newest saved links), options, report, welcome (first-run setup, afterwards the help page). Talk to the service worker with request/response messages. |

## Counting rule (`src/shared/counting.ts`)

A heartbeat carries `visible`, `pip`, `playing`, `focused`, `isLive`, video ids. The service worker adds the
system idle state (`chrome.idle`, threshold `idleAfterSec`). Whether the interval counts:

| Mode | Counts when |
|---|---|
| `visibleOrPlaying` (default) | `!locked && (playing || ((visible || pip) && focused && !idle))` |
| `visibleOnly` | `!locked && (visible || pip) && (playing || (focused && !idle))` |
| `playingOnly` | `!locked && playing` |
| any mode, page without a video (attributed to browsing) | `!locked && (visible || pip) && focused && !idle` — the modes describe videos; a feed or search page can only be looked at |

Minimized and fully covered windows are `hidden` to the page (Chrome's native occlusion tracking on Windows),
so they only count through `playing`. `focused && !idle` stops a paused tab parked on a second monitor from
counting all day.

## Time accounting (`src/shared/accounting.ts`)

Segment-based: each tab remembers its previous heartbeat (`prevAt`, whether it counted, what it was attributed
to). A heartbeat at `now` credits the interval since `prevAt` **using the previous heartbeat's state**, capped:
if `now - prevAt > 2 x heartbeatSec` the tab was throttled or asleep and nothing is credited. A single global
`lastCountedAt` clamps the credited interval to `now - max(prevAt, lastCountedAt)`, so several visible tabs
sum to wall-clock time, never N times.

Attribution: the playing video (from the bridge) -> its category, or `uncategorized` while the prompt is open
-> otherwise the video in the URL -> otherwise the built-in `browsing` category. Per video, per day:
`{ categoryId, sec, firstAt, lastAt }`. Totals and per-category sums are derived on read.

Day key = local date of `now - dayStartMinutes` (local date components, DST-safe). Rollover is checked on
every heartbeat and by an alarm at the next boundary: a new day record gets a snapshot of the effective
limits; blocks, grandfather budgets, warnings and the override are cleared; saved links persist.

## Limits and blocks (`src/shared/policy.ts`, `src/shared/limits.ts`)

- Daily: when the day total reaches `limits.dailySec` -> notification + toast, `state.dailyBlock` is created
  with a **grandfather budget** for every video playing at that moment: `remaining + max(120 s, 10 %)`,
  capped by `maxGrandfatherMin` and by the video's category `graceMin` (null = until the end, 0 = none);
  live/unknown duration -> `liveGraceMin` (also grace-capped). The budget burns only while that video plays;
  `ended` consumes it early (ignored during ads), marks the video finished for the day
  (`state.finishedVideos`; never auto-saved to the watch-later list) and the placeholder says so. When a
  budget runs out mid-video the tab goes to the normal placeholder and the link IS saved.
- Category limits work the same on the per-category sum.
- Blocked hours (`src/shared/schedule.ts`): clock windows in local wall-clock minutes (overnight wrap
  supported). Hard block of every YouTube page, no grandfathers; warned `warnBeforeMin` ahead (once per window
  per day); a `schedule-boundary` alarm plus the heartbeats enforce the boundary. The day snapshot
  (`day.limits.windows`) is the union of old and new windows on config save, so removals wait for rollover.
- `evaluate()` order: Shorts blocked mode -> block; blocked hours (unless the override is active) -> block;
  daily block -> only grandfathered videos; category block -> only grandfathered videos of that category; else
  allow (override lifts the time/schedule blocks). A watch page whose category is not yet known is allowed to
  load but held paused behind the prompt; the answer re-evaluates.
- Warnings `warnBeforeMin` before each limit, once per day each.
- Limit changes: settings hold target values; the day record holds today's effective values. Lowering updates
  today; raising waits for rollover.
- Override: at most `overridesPerDay`; sets `state.override.until`; time keeps being counted; an alarm and
  every heartbeat re-evaluate at expiry -> hard redirect.

## Enforcement (`src/background/enforcement.ts`)

All paths call `enforce(tabId, url, meta)`:

1. **Gate** - the content script sends `{type:'decide'}` at `document_start` and keeps any `<video>` paused
   (capture-phase `play` listener) until the decision arrives; on block it pauses and `location.replace()`s to
   `blocked.html?u=<original>&r=<reason>` (no history entry, so Back does not loop). `blocked.html` is a
   web-accessible resource for YouTube hosts for this reason.
2. **Navigation inside the page** - the same content script re-runs the gate whenever the page changes
   without a load: YouTube's `yt-navigate-start` / `yt-navigate-finish` / `yt-page-data-updated` events
   (autoplay, end screen, playlists, Shorts), the Navigation API's `currententrychange` (any same-document URL
   change, including a bare `history.pushState`), a `play` event for a video the gate has not released, and a
   `pageKey()` comparison on every 5 s tick as the last resort. A prerendered document starts on
   `prerenderingchange`; a page restored from the back/forward cache reports with `pageshow`. There is no
   worker-side navigation listener, so the extension needs no `webNavigation` permission (see DECISIONS,
   2026-10-01).
3. **Heartbeat / categorize / alarms / block transitions** - re-evaluate the tab; on a block transition every
   tab in the registry is evaluated, so paused videos in other tabs and the miniplayer are covered. The
   registry remembers a tab for up to ten minutes after its last heartbeat, so before the `tabs.update`
   fallback (and in the check 1.5 s after a delivered block message) `redirectTab()` re-reads the tab: it is
   only redirected while it still shows exactly the page the decision was made for. A tab that has left
   YouTube (its URL is no longer visible to us) loses its registry entry; one that has moved to another
   YouTube page is left to that page's own gate.

Blocked watch/Shorts URLs are added to `savedLinks` (deduped by video id). A video that plays to its natural end
(`ended` heartbeat outside an ad, grandfathered or not) is removed from `savedLinks` and marked finished for the
day (`finishedVideos`), so it is neither listed nor auto-saved again. The entry stores only the URL, id,
title and time: the saved list is a *view* (`src/shared/saved.ts`, `savedLinkViews()`) that joins each link on
read with its current category (`knownCategory()` in `src/shared/policy.ts`: video memory -> channel rule ->
Shorts auto-category), the channel name from `videoIndex`, and whether opening it now would be allowed
(`evaluate()`), so re-categorizing or editing categories is reflected immediately.

## Category prompt

`getVideoDecision(videoId, channelId, isShorts)` -> `allow(categoryId)` (known video, channel rule, Shorts
auto-category) | `prompt` | `block`. The prompt is a Shadow-DOM overlay mounted into
`document.fullscreenElement ?? document.body`, re-parented on `fullscreenchange`; buttons per category, a
checkbox "always use for this channel", no skip. The answer is sent as `categorize`; the service worker stores
it in `videoIndex`, moves the video's uncategorized seconds, re-evaluates and replies.

Channel identity: `channelId` from the bridge (`getPlayerResponse().videoDetails`), with oEmbed
(`/oembed?url=...&format=json`) and `document.title` as fallbacks for display data.

Re-categorizing: clicking the timer pill (or the popup's "Current video" select) fetches `promptInfo` and
reopens the same prompt with the current category badged; `categorize` re-labels today's seconds and
re-evaluates (a video moved into an exhausted category is blocked on the spot).

Content scripts are idempotent (window marker) and stop themselves when `chrome.runtime.id` disappears
(orphaned after an extension reload); `onInstalled` re-injects into open YouTube tabs via `chrome.scripting`
(`src/background/tabs.ts`), unless setup is still pending (see "First run").

## Saved-for-later shelf (`src/content/shelf.ts`)

On the home and subscriptions feeds (`feedKind()` in `src/shared/url.ts`) the heartbeat response carries the
shelf payload (`savedShelf()` in `src/shared/saved.ts`: total count plus the newest `SHELF_ITEMS` saved-link
views) and `SavedShelf.update()` renders it into an open Shadow-DOM host (`data-yt-budget="shelf"`). The host
is inserted as the first child of `ytd-rich-grid-renderer > #contents` of the visible `ytd-browse`
(`:not([hidden])` — YouTube keeps visited page renderers around), laid out as a full-width flex row like
YouTube's own sections; if `#contents` is missing it goes right above the grid. After a navigation a bounded
retry (250 ms × 12) waits for the grid; every heartbeat re-checks the position, so a grid YouTube re-renders
(filter chips, refresh) only loses the shelf until the next beat. Cards are rebuilt only when their content
changed (signature check). Cards are plain `<a>` links, so opening one is a full page load that passes through
the gate; the × button sends `removeSavedLink` and "See all" sends `openOptions` (the worker opens
`options.html#saved`, because a web page cannot navigate to an extension URL). The dark theme follows the `dark`
attribute on `<html>`. `gate()` removes the shelf on non-feed URLs; a null payload (toggle off, list empty)
removes it too. `e2e/feed-dom.mjs` dumps the markup the anchors rely on.

## First run (`src/shared/onboarding.ts`, `src/pages/welcome.ts`)

A new installation records and enforces nothing until the user has pressed "Start" on the welcome page. That
is the disclosure-and-consent step the Chrome Web Store requires before any data is handled, and it lets a new
user pick their own limit instead of being blocked by a default.

- State lives under the storage key `meta` (`{ setupAt }`), owned by the worker. `normalizeMeta()`: nothing
  stored -> pending; settings stored but no `meta` (an installation older than this step) -> set up as of now.
- **One choke point.** `handle()` asks `inertReply(type)` while setup is pending: `decide`, `heartbeat`,
  `videoInfo`, `categorize`, `promptInfo`, `removeSavedLink` and `useOverride` get a neutral answer without
  touching storage; page requests (reading and saving settings, `getOnboarding`, `completeSetup`, export,
  import, clear) run normally. No heartbeat is registered, so alarms and `enforceAll` have nothing to act on.
  The badge shows `!`, the popup a single "Finish setup" card, Settings a banner.
- **Content script.** A `decide` or `heartbeat` answer with `inactive: true` puts it to sleep: it sends
  nothing more and shows nothing. `onInstalled` (reason `install`) opens `welcome.html` and injects nothing.
- **`completeSetup {config}`** (page-only, refused once setup is done, otherwise it would be a way to raise
  today's limits): saves the chosen settings, `finishSetup()` takes today's limits straight from
  `limitsFromConfig()` instead of going through `applyConfigToDay()`, stamps `setupAt`, schedules the alarms
  and calls `activateOpenTabs()` (`src/background/tabs.ts`): open YouTube tabs get an `activate` push, tabs
  without a content script are injected, and each runs its gate as if freshly loaded.
- "Clear all data (keep settings)" keeps `meta`; "Delete everything" removes it, which returns the
  installation to the pending state; an import never changes it.
- **One-time tips** (`tipDue()` / `markTip()`, never before setup is done, all pre-marked for installations
  older than this step): `DecideResponse.tip = 'prompt'` makes the category prompt explain why it asks, until
  the first `categorize`; `HeartbeatResponse.tip = 'pill'` is sent once, with the first timer pill of a
  categorized video in a visible, focused tab, and the content script shows an info toast;
  `BlockInfo.firstBlock` makes the placeholder page explain what happened until "Got it" sends `ackTip`.
- `welcome.html` has three modes: setup (how it works, daily limit and starter categories from
  `STARTER_CATEGORIES`, what is recorded, Start), done (next steps), and help once setup is finished (how it
  works, badge legend, FAQ). It is opened from the popup footer, the Settings header and the placeholder page.

## Feedback reminder and support (`src/shared/feedback.ts`, `src/pages/feedback.ts`)

The only thing the extension ever asks for: a short note from the author (rate and comment; the Ko-fi link
second, shown only when `brand.json` has a `tips` link). `dueFeedback()` makes it due 7, 30 and 90 days after
`meta.setupAt`, unless `config.feedbackReminders` is off or a block is active; milestones that went by
unanswered collapse into the latest one. `getOnboarding` reports it as `feedbackDue`, and `feedbackCard()`
renders it at the top of the popup, the report page and Settings. Every button sends `feedbackAction`
(`rate` / `tips` / `later` / `never`), which records the milestone in `meta.feedbackDone`; `never` also clears
`config.feedbackReminders`. It is never a system notification and never appears inside YouTube or on the
placeholder page. The same note sits permanently in the Support block at the end of Settings, next to the
About card (version, help, and the privacy / source / issue links from `brand.json`, each hidden while empty).

## Storage (`chrome.storage.local`, small keys)

| Key | Content |
|---|---|
| `meta` | First-run state of this installation: `setupAt` (epoch ms, or null while setup is pending) `tipsSeen` (one-time tips already shown: `prompt`, `pill`, `block`) and `feedbackDone` (feedback-reminder milestones already answered). |
| `config` | Settings: limits, day start, warning, counting mode, heartbeat/idle seconds, categories (each with `limitMin` and `graceMin`), Shorts mode, channel rules, override and grandfather caps, timer pill (`showOverlayTimer`, `overlayCorner`), saved-for-later shelf (`showSavedShelf`), `blockedWindows`, `feedbackReminders`, `schemaVersion`. |
| `state` | `dayKey`, `lastCountedAt`, `dailyBlock`, `categoryBlocks`, `override`, `warned{daily, category, schedule}`, `savedLinks`, `finishedVideos`. |
| `day:YYYY-MM-DD` | `videos{videoId -> {categoryId, sec, firstAt, lastAt}}`, `browsingSec`, `limits` (effective that day: `dailySec`, `category`, `windows`), `overrides[]`, `events[]`. |
| `videoIndex` | `videoId -> {categoryId?, title?, channelId?, channelName?, at}` (categorization memory + metadata cache). |
| session `tabs` | Per-tab registry: last heartbeat state, used by accounting and block transitions. |

Config is normalised on every load by `normalizeConfig()` in `src/shared/config.ts` (missing or invalid fields
fall back to their defaults; `schemaVersion` is reserved for future migrations). `state`, day records and the
video index are repaired the same way by `normalizeState()`, `normalizeDay()` and `normalizeVideoIndex()` in
`src/shared/normalize.ts`: unknown fields are dropped, numbers must be finite, saved links must be http(s)
YouTube video URLs (`sanitizeSavedLinks()`), category colours must be `#rrggbb`, and only safe keys
(`isStoredId()`) become keys.

## Message protocol (`src/shared/messages.ts`)

Content -> worker: `decide` (the gate), `heartbeat`, `videoInfo`, `categorize`, `promptInfo`, `removeSavedLink`
and `openOptions` (shelf buttons). Worker -> content (push): `block`, `toast`. Heartbeat responses to video
pages carry the timer-pill payload (`src/shared/overlay.ts`: daily used/limit, the video's category with
name/color, warn flags, corner, and whether time is counting — the pill ticks locally between heartbeats only
while it is); on the home/subscriptions feed they carry the shelf payload instead (`shelf`, null when the shelf
is off or nothing is saved). Pages -> worker: `getBuild`, `promptInfo`, `getStatus`, `getConfig`, `saveConfig`, `getBlockInfo`,
`useOverride`, `getSavedLinks`, `removeSavedLink`, `getReport`, `exportData`, `importData`, `clearData`; the
popup also sends `categorize` (with `tabId`). `getSavedLinks {limit?}` (and `getBlockInfo.savedLinks`) returns
`SavedLinkView[]`: the saved links newest first, each with `category {id, name, color}`, `channelName`,
`available` and `blockedNow` (see "Enforcement"). First run: `getOnboarding`, `completeSetup {config}`, `ackTip {tip}` and `feedbackAction {action}` from the
pages, the `activate` push to content scripts, and `inactive: true` on `decide` / `heartbeat` answers
while setup is pending (see "First run").
Exact payloads are the TypeScript types in that file.

## Trust boundaries (`src/shared/ids.ts`, `src/shared/validate.ts`, `src/shared/access.ts`)

Three levels, least trusted first: the YouTube page, the content script (isolated world, but inside YouTube's
renderer process), the extension's own pages and service worker.

- **Page -> content script.** `bridge.js` runs in the page's own world and talks to the content script with
  `window.postMessage`, which every other script in the page can do as well. The content script treats the
  message as untrusted: `sanitizeVideoInfo()` rebuilds it field by field (11-character video id, token-like
  channel id, capped strings, finite numbers) and only the rebuilt object is kept or sent on.
- **Anyone -> service worker.** The `onMessage` listener answers only two kinds of sender, told apart by
  `sender.origin` in `senderRole()`: an extension page (`page`; in a tab it must be the top frame) and a content
  script in the top frame of a YouTube tab (`content`). `ACCESS` maps every request type to the least
  privileged role that may send it; a content script gets `decide`, `heartbeat`, `videoInfo`, `categorize`,
  `promptInfo`, `removeSavedLink` and `openOptions`, nothing that reads or rewrites the user's data.
  `checkRequest()` then rebuilds the request with `sanitizeRequest()` (ids checked, URLs bounded by
  `cleanUrl()`, numbers finite, `categorize.tabId` only from a page) before a handler sees it. Handlers are
  looked up as own properties. The e2e hook `__ytbTest` enters through the same check as a `page`.
- **Storage.** `chrome.storage.local.setAccessLevel('TRUSTED_CONTEXTS')` at worker start: content scripts
  cannot read or write storage themselves.
- **Request type.** `request()` in `src/runtime/rpc.ts` spreads the payload first and sets `type` last, so no
  payload can select a different handler.
- **Object keys.** Ids that become keys of plain objects pass `isSafeKey()`: names every object inherits
  (`constructor`, which happens to have the 11 characters of a video id, `__proto__`, `toString`, …) are
  rejected.
- **Redirects.** The content script only follows a `blockedUrl` that points at the extension's own
  `blocked.html`.
- **URLs.** `parseYouTubeUrl()` accepts only http and https (`javascript://www.youtube.com/…` has the right
  hostname too). The placeholder page checks its `?u=` parameter with it before showing it as a link.
- **Stored data.** Everything read from storage goes through the normalisers described under "Storage", so a
  damaged or hand-edited record cannot inject a script URL, a style value or an inherited key.
- **Overlays in the page.** The prompt, the timer pill and the shelf live in open shadow roots (the e2e tests
  read them), so a page script can reach their buttons. Their handlers act only on `event.isTrusted` clicks
  and key presses, i.e. real user input.
- **The placeholder page.** `blocked.html` is web-accessible for YouTube hosts, so a YouTube page could put it
  in an `<iframe>`. Framed, it renders nothing (`window.top !== window`), and the worker gives a framed
  extension page no role, so its buttons cannot be used on the user's behalf.
- **Where the scripts run.** The manifest's `exclude_matches` and `EXCLUDED_SUBDOMAINS` in `src/shared/url.ts`
  list the same hosts (`src/shared/manifest.test.ts` compares them); re-injection after install or update
  (`injectIntoOpenTabs`) uses the same rule.
- **Backups.** `importData` runs the file through `parseBackup()` (`src/shared/backup.ts`), which applies the
  same normalisers to every item and ignores unknown keys. Only then is storage written: the new items first,
  stale keys removed afterwards, so there is no moment with empty storage, and a file that is not a backup
  changes nothing. `clearData {keepConfig}` backs both "Clear all data (keep settings)" and "Delete
  everything"; after either, alarms and the badge are re-derived from what is left.
