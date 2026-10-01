# Design decisions

Append-only log of non-obvious choices. Newest at the bottom.

## 2026-08-23 — Raising a limit takes effect tomorrow

The previous failure mode was "bump the limit to finish this video, then waste the extra time tomorrow".
Raises are deferred to the next day; lowering applies immediately. A single logged emergency override per day
(15 min, hard cutoff) exists so the tool is not abandoned in a real emergency; it shows up in the report.

## 2026-08-23 — "Finish the current video" is a budget, not "until `ended`"

`ended` never fires with loop enabled (Shorts loop by default), live streams never end, and rewinding or
reloading would replay forever. The grandfathered video gets a seconds budget (remaining length + margin,
capped) that burns only while it plays; `ended` only consumes it early. Every video playing at block time is
grandfathered, not just the tab whose heartbeat tripped the limit.

## 2026-08-23 — Count non-playing time only when focused and not idle

Chrome marks minimized and fully covered windows as hidden, so the user's "not while minimized" requirement is
met by `document.visibilityState`. But a paused tab parked on a second monitor is *visible* all day; requiring
window focus and no system idle for non-playing time fixes that without affecting playback (which always counts
in the default mode).

## 2026-08-23 — Heartbeats from the page, not `chrome.tabs`/`windows` in the worker

Only the page knows about playback, picture-in-picture, fullscreen and occlusion-aware visibility.
Segment-based crediting with a global `lastCountedAt` gives wall-clock totals across any number of tabs.

## 2026-08-23 — Content-script gate at `document_start` instead of `declarativeNetRequest`

A worker-side redirect from `webNavigation` races the page (flash, sometimes audio). A gate message sent at
`document_start`, with the video held paused until the answer, removes the race with one code path that also
handles SPA navigations and per-category decisions (which DNR cannot). DNR remains a hardening option for the
daily block (redirect rule + allow rule for grandfathered ids) if the worker ever proves unreliable.

## 2026-08-23 — `onCommitted` rather than `onBeforeNavigate`; ignore prerendered frames

`youtu.be` links are server redirects; `onBeforeNavigate` only sees the original URL. Chrome prerenders
omnibox suggestions and bookmark hovers and reports them with the *visible* tab's id, so acting on anything but
`frameId === 0 && documentLifecycle === 'active'` would hijack the tab the user is still on.

## 2026-08-23 — Channel rules keyed by `channelId`

Handles can be renamed and some channels only have `/channel/UC…` URLs. The immutable id comes from YouTube's
player API in the MAIN world (`getPlayerResponse().videoDetails.channelId`); oEmbed supplies display data.

## 2026-08-23 — Derived totals

Day records store per-video seconds and a browsing counter; totals and per-category sums are derived on read
so re-categorizing or archiving a category can never leave the totals inconsistent.

## 2026-08-23 — No runtime dependencies, no UI framework

The extension must stay small, inspectable and buildable in seconds for years. Pages are plain DOM code;
charts are inline SVG. The only tooling is TypeScript, esbuild and Vitest.

## 2026-08-23 — Resume playback synchronously when a category is chosen

`HTMLMediaElement.play()` needs transient user activation. Awaiting the `categorize` round-trip before
resuming would consume the click's activation and let the browser's autoplay policy reject `play()`. The
content script therefore resumes optimistically inside the click handler (the common outcome is "allow") and
only re-blocks if the server says the chosen category is already exhausted.

## 2026-08-23 — Browser-spike findings (Chrome 152 for Testing)

Verified against real youtube.com: `yt-navigate-finish`/`yt-page-data-updated` fire on SPA navigation; the
MAIN-world bridge reads `getPlayerResponse().videoDetails` including the immutable `channelId`; oEmbed returns
title/author unauthenticated; `webNavigation.onCommitted` + `location.replace` to the web-accessible
`blocked.html` works and preserves the original URL; the daily limit trips, grandfathers the current video and
saves the blocked link. Note: Chrome for Testing does not actually start video playback in automation (it
buffers ~2 s then pauses, even with no extension and on a trusted click), so the e2e suite asserts on state,
storage and redirects rather than on wall-clock playback.

## 2026-08-26 — A finished grandfathered video is not "saved for later"

Real-world feedback: the finish-it video landed on the watch-later list the moment it ended, as if unwatched.
`state.finishedVideos` (per day) records videos whose grandfathered playback reached its natural end; the
saved-links logic skips them and the placeholder switches to a "you finished your video" screen. A video cut
off *mid-way* by an exhausted allowance is still saved — the rest of it is genuinely unwatched.

## 2026-08-26 — Blocked hours: hard cutoff, override exempt, removals wait until tomorrow

Confirmed with the user: a window start is a hard boundary (with the usual advance warning) — a
finish-your-video grace would defeat "no YouTube after 23:00". The once-a-day logged override lifts blocked
hours (it means "15 minutes no matter what"). The anti-cheat rule mirrors limit raises: added or extended
windows bind immediately (day snapshot is the union of old and new), removals only take effect at rollover.

## 2026-08-26 — After-limit allowance comes from the video's category

`Category.graceMin` caps the grandfather budget (null = to the end of the video, 0 = none). It applies to
whichever limit tripped — daily or the category's own — because what matters is what you are watching, not
which counter ran out. Existing budgets are not retrofitted when the setting changes.

## 2026-09-02 — Saved links show their *current* category, joined on read (no snapshot)

The saved-for-later list needs each video's category. Instead of copying the category onto the saved entry at
block time, the list is a view (`src/shared/saved.ts`) joined on read against `videoIndex` and the config, with
the precedence enforcement uses (`knownCategory`: video memory → channel rule → Shorts auto-category). A later
re-categorization, a channel rule added afterwards, or a renamed/recoloured category shows up at once; a deleted
category simply shows no chip; a video blocked before it was ever categorized says "no category yet" (the prompt
asks when it is opened). The storage schema stays unchanged. The view also says whether the link could be opened
right now (`evaluate()`), which the browsing surfaces use to mark videos that are blocked today.

## 2026-09-02 — Saved-for-later shelf: diegetic, fed by the heartbeat, plain links, never throws

Feedback: the saved list only lived in the settings page, so it never competed with YouTube's recommendations at
the moment of choosing a video. Of the surfaces considered (feed shelf, a block above "Up next", a floating
dock, a reminder toast, the popup) the feed shelf plus the popup list were chosen; the others stay on the roadmap.

- **Data rides on the heartbeat** like the timer pill: on home/subscriptions URLs the heartbeat response carries
  the shelf payload, so SPA navigations (which already trigger a heartbeat) and removals in other tabs refresh
  it within 5 s — no separate fetch or invalidation protocol.
- **Placement**: first child of `ytd-rich-grid-renderer > #contents` of the *visible* `ytd-browse` (YouTube keeps
  visited page renderers around with `hidden`), as a full-width flex row like YouTube's own sections; fallback
  right above the grid. A bounded retry after navigation and a re-check on every heartbeat put it back when
  YouTube re-renders the grid. Should the markup change so that nothing matches, the shelf simply does not
  appear — no errors; the popup and the settings list remain.
- **Cards are plain anchors**: a spike (`e2e/feed-dom.mjs`) showed that a link inside a shadow root in `#contents`
  triggers a full document load, so the normal `document_start` gate applies (prompt / block / allow) and
  middle-click works; nothing is dispatched into YouTube's router.
- **Blocked videos stay visible**, greyed with a "Blocked today" mark: the list is also tomorrow's plan, and
  hiding them would make the list look shorter than it is. The remove button is the only way off the shelf.

## 2026-09-02 — Counting modes describe videos; browsing counts while looked at in every mode

"Only while a video is playing" used to make feed/search/channel pages free, which read as a bug ("Browsing
stays at 0") because the setting is naturally understood as "a paused video does not count". Now the three modes
only decide how a *video* counts; a page without a video can only be watched by looking at it, so it counts while
visible, focused and not idle in every mode. The settings page explains each mode next to the dropdown. Someone
who wants feeds to be free can give the Browsing category its own budget instead.

## 2026-09-02 — A video played to its end leaves the saved-for-later list

The August rule only prevented a finished video from being *added* to the list that day; a link already on the
list stayed there after the video was watched through. Now any video that reaches its natural end (the `ended`
heartbeat outside an ad, grandfathered or not) is removed from the list and marked finished for the day, so it
is neither shown nor auto-saved again. Stopping short of the end does not count as watched: the end screen is
the one signal that is both cheap and unambiguous; a percentage threshold was considered and declined for now.

## 2026-10-01 — The page is hostile, a content script is only half trusted

Going public changes the threat model: with one user, "whatever runs on youtube.com" was the owner's own
browser; with many, it includes other extensions, userscripts and whatever YouTube itself ships. A review
before publication found that a page script could reach every background handler (the page-to-content message
was forwarded unchanged and a payload key named `type` replaced the request type), and that the worker answered
any message without looking at the sender.

- What the page posts is rebuilt field by field in the content script; nothing is forwarded as received.
- The worker classifies senders by origin (`page` / `content`) and gives a content script only the seven
  requests its own UI needs. A content script lives in YouTube's renderer process, so it is treated as possibly
  compromised: it cannot read the history, change the settings, export, import or wipe.
- Every request is rebuilt before a handler runs, and ids that become object keys must be safe keys
  (`constructor` has the 11 characters of a video id).
- Storage is closed to content scripts (`setAccessLevel`).

Accepted: `categorize` and `removeSavedLink` stay available to content scripts (the prompt and the shelf need
them), so a compromised renderer could still mis-file a video or drop a saved link. Both are visible to the
user and reversible.

## 2026-10-01 — No `webNavigation`: the content script is the only navigation watcher

Supersedes the worker-side half of the two 2026-08-23 navigation entries. `webNavigation` makes Chrome warn
"Read your browsing history" at install, which is the wrong first impression for a tool whose promise is that
nothing leaves the device, and its listeners were only a second path next to the gate.

What they covered, and what covers it now:

- full page loads, including the youtube.com target of a `youtu.be` link -> the gate at `document_start`;
- YouTube's in-page navigation -> the `yt-navigate-*` events, the capture-phase `play` listener, the 5 s tick;
- a URL change YouTube does not announce (`history.pushState`) -> the Navigation API's `currententrychange`
  in the content script, one-for-one what `onHistoryStateUpdated` reported;
- prerendered pages -> the script waits for `prerenderingchange`; nothing reports another tab's id any more.

What is lost: the worker can no longer act on a YouTube tab whose content script is not running. That window
is the moment between an extension update and re-injection; the next page load or heartbeat closes it.
`chrome.tabs.onUpdated` would have kept a worker-side path without the permission, but it cannot be filtered,
so it would wake the worker for every tab in the browser.

Verified with two e2e checks added before the removal: while the daily limit is active, a logo click and a
bare `history.pushState` both end on the placeholder (the second within 3 s; it fails without the Navigation
API listener).

## 2026-10-01 — Public name "Addiction Recovery for YouTube™"; neutral labels inside YouTube

The working name "YouTube Budget" cannot be published: the Chrome Web Store's branding rules forbid a Google
trademark as an extension's name and allow only the form "… for YouTube™" (with the ™ sign and an attribution
line in the listing). The owner chose a name that says what the tool is for. Known risk, accepted: Google's
brand rules let it object to uses of its marks it finds disparaging; a comparable name is live in the store,
and a fallback name is kept in the store-listing notes.

- One source of truth: `src/shared/brand.json` (name, label, the "for YouTube™" reference, summary, links),
  read by the bundles through `src/shared/brand.ts`. `brand.test.ts` keeps `public/manifest.json` and the HTML
  titles in step with it and checks the store's length limits (name <= 75, summary <= 132).
- Page headers show "Addiction Recovery" with the reference smaller beside it, as the store asks.
- **Inside YouTube pages and in notifications the product name is not shown.** The category prompt, toasts,
  the feed shelf and notification titles use "What is this video?" / "Time budget": they appear over a video
  or on the desktop where anyone looking at the screen can read them, and nobody should have the word
  "addiction" projected in a meeting because they installed a time budget. Downloaded files are named
  `youtube-time-budget-…` for the same reason.
- Internal identifiers do not change (`data-yt-budget`, storage keys, alarm ids, `app: 'youtube-budget'` in
  exports), so nothing migrates and old backups keep importing.

## 2026-10-01 — Nothing is recorded until setup is finished

Two problems, one answer. (1) The Chrome Web Store's user-data policy counts watch activity as user data even
when it never leaves the device, and wants what is recorded disclosed inside the product, with an explicit
action from the user before recording starts; a line in the listing does not count. (2) A fresh install used
to enforce a 60-minute day at once, pause the first video behind a prompt nobody had explained, and defer a
raise to tomorrow, so a new user's first day was the default's, not theirs.

So a new installation is inert until "Start" is pressed on a welcome page that explains the idea, asks for
the daily limit and the categories, and says plainly what is recorded and that it stays on the device.

- The state is a worker-owned `meta` record, not a field of `Config`: the settings page saves the whole
  config from a copy it loaded earlier and must not be able to clobber it, an import must not carry it, and
  `normalizeConfig({})` stays equal to `defaultConfig()`.
- Existing installations (settings stored, no `meta`) are never gated.
- Limits chosen during setup apply the same day. It is the single exception to "raises take effect tomorrow",
  and `completeSetup` is refused once setup is done so that it cannot be used as a raise later.
- "Delete everything" returns to the pending state; "Clear all data (keep settings)" does not.
- Starter categories are Learning and Entertainment, with Music, News, Gaming and Work offered on the welcome
  page and "add your own" ("Game dev" was the author's). Unit tests and the e2e harness pin their own
  categories (`fixtures.testCategories()`, `TEST_CATEGORIES`), so the starter set can change freely.
- The welcome page doubles as the permanent help page, so the explanation a new user saw stays one click away.

## 2026-10-01 — Asking for feedback and tips: one note, never in the way

The extension is free and stays free; the owner wants ratings and comments first and tips second, in a
personal voice. Surfaces were offered as a menu and the owner chose: a note after one week, one month and
three months of use, shown as a card in the popup, on the report page and in Settings, plus a permanent
Support block at the bottom of Settings with a switch to turn the reminders off.

Rules that follow from the store's policies and from not wanting to nag:

- Never a system notification (the Chrome Web Store forbids promotions in notifications), never inside a
  YouTube page, never on the placeholder page, and never while a block is active: those are moments of
  friction, where an ask reads as a paywall.
- Nothing is unlocked by rating or tipping, and the rating is not steered ("please rate", not "please give
  five stars"): incentivised or manipulated ratings are a store violation.
- Every answer, including "Later", puts the note away until the next milestone; after the third it never
  returns. A milestone missed while away does not stack up.
- The Ko-fi sentence and button only exist once a link is set in `brand.json`.

## 2026-10-01 — The store package is a separate, checked build

- The e2e harness needs a way into the worker (`__ytbTest`), the published extension should not carry one. A
  `define` flag does not remove it: esbuild keeps `if (false) { … }` when not minifying, and the code stays
  unminified so that reviewers and users can read it. The hook is therefore excluded by entry point:
  `index.dev.ts` imports the worker and then the hook, `--release` builds `index.ts` alone.
- `npm run package` builds that release variant into `release/unpacked` and refuses to produce a zip unless
  the manifest matches `brand.json`, the permission list is exactly the expected one, every referenced file
  exists, there is no source map, test hook or `eval`, and the required links and the license are in place.
  The expected permission list lives in the script on purpose: a new permission should be a decision.
- The zip is written by a small writer on `node:zlib` (sorted, forward-slash names, fixed timestamp, read back
  and compared in the same run) instead of a Windows tool, and `npm run e2e:release` starts the exact
  unpacked files in Chrome.

## 2026-10-01 — Icon: a syringe on pause; a capsule in the toolbar

The first icon (a red rounded square with a white play triangle) was a look-alike of YouTube's logo, which
the store does not accept. The owner's concept: a syringe filled with red liquid, a play triangle in it, and
a pause symbol on top ("pausing the YouTube addiction").

- The play triangle is dark red, not white: white on red is the logo's own composition.
- A syringe has too much detail for 16 px, so the toolbar sizes (16, 32) show a red capsule with the pause bars
  turned to sit inside it; 48 and 128 px show the full artwork. The tile has a slightly lighter rim so that it
  does not dissolve into a dark toolbar.
- Only the 128 px icon keeps 16 px of transparent padding (the store's rule); the others fill their canvas.
- Known risk, accepted by the owner: drug imagery next to "for YouTube™" may be judged disparaging by Google.
  `npm run icons -- --design ring` renders the fallback (pause bars in a progress ring) from the same script.
- Store graphics are generated (`e2e/store-shots.mjs`) from fictional data over a mock video page, so no
  third-party title, thumbnail or logo appears in the listing.
