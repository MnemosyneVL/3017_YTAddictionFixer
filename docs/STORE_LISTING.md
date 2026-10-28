# Chrome Web Store listing

Everything that has to be typed or uploaded in the developer dashboard, ready to paste. Keep this file in
step with the extension: a new permission or a change in what is recorded changes the answers below.

Dashboard: <https://chrome.google.com/webstore/devconsole>

Listing: <https://chromewebstore.google.com/detail/addiction-recovery-for-yo/fojplifgklngfhhipbpnmkgmjlnkmhdp>
(item ID `fojplifgklngfhhipbpnmkgmjlnkmhdp`). A new or renamed item can be opened by this address at once; the
store's own search picks it up later.

**Status** (checked 2026-10-28): version 1.0.1 has been live since 2026-10-06, in Workflow & Planning, with the
title, summary and description below. The graphics are still the ones uploaded with 1.0.0 (the same files
`node e2e/store-shots.mjs` wrote then). Update this line whenever a new version or listing change goes live.

## Before an upload

1. `npm run package` and `npm run e2e:release` are green; the file to upload is
   `release/addiction-recovery-for-youtube-<version>.zip`.
2. Only when the graphics change: `node e2e/store-shots.mjs` writes the screenshots and the promo tile to
   `release/store/`.
3. `PRIVACY.md` is reachable at its public URL (the privacy-policy URL below) and is still true for this version.

## Store listing tab

**Title** (comes from the package: `title` in `src/shared/brand.json`, 75 characters at most):
`Addiction Recovery for YouTube™ – Time Limit, Tracker & Blocker`

The product's name stays `Addiction Recovery for YouTube™` (`name` in `brand.json`): that is what the
extension's own pages and the toolbar tooltip show. The title adds what it does, in the words people search for.

**Summary** (comes from the package: `summary` in `brand.json`, 132 characters at most):

> YouTube detox for focus and productivity: a daily time budget, time tracker, statistics and a distraction blocker. Fully on-device.

**Category:** Workflow & Planning  **Language:** English

Google describes Workflow & Planning as "time trackers, tools to stay focused, …", and the comparable
extensions are filed there (see "Search" below). The dashboard follows the language of the Google account and
translates the category names with it; in Russian this one is «Работа и планирование» (Well-being, the first
plan, is «Здоровье»).

**Description:**

```
A daily time limit for YouTube that follows what you watch, lets you finish the video you are on, and then closes the site until tomorrow.

Banning the site outright also takes away what is worth watching there. A flat daily timer fails the other way: a 15-minute tutorial leaves 45 minutes for scrolling, and a 2-hour lecture forces the limit up for good. This extension budgets your time by category instead, so learning stays and doomscrolling goes: a detox you can keep up, not a ban.

HOW IT WORKS
• Daily time budget. A time tracker counts the minutes a video plays or you are actively browsing; the toolbar icon and a small timer on the player show what is left.
• One question per video: what is this? Learning, Entertainment, Music, or categories of your own. One click, or file a whole channel for good.
• Budgets per category. An hour of Entertainment a day while Learning may use the rest.
• Finish what you are watching. When a budget runs out, whatever is playing may run to its end; then the site is closed until tomorrow.
• Nothing is lost. Everything you were stopped on is saved for later and shown at the top of your feed.
• Blocked hours. A distraction blocker for the hours when you need your focus: the site stays closed during work or at night.
• Shorts on your terms. Count them against a category without being asked, or block them entirely.
• Statistics. See where your screen time went: per day, per category, per channel and per video, with CSV export.
• No easy way out. Raising a limit takes effect tomorrow. One 15-minute emergency override a day, and it shows in your statistics.

WHO IT IS FOR
Students, people working from home, and anyone who opens one tutorial and looks up two hours later. It is a productivity and self-control tool against procrastination: it protects your focus without taking away the tutorials, lectures and music you came for.

PRIVATE BY DESIGN
• Everything stays in your browser. No account, no server, no analytics, no ads.
• Nothing is recorded until you press Start on the welcome page, which tells you exactly what is kept.
• Export or delete your data whenever you like. Open source (GPL-3.0).

GOOD TO KNOW
• Works on youtube.com in Chrome on a computer. The music site, the mobile app and other browsers are not covered.
• It is a self-control tool, not a parental control: you can always switch it off. It is not medical or psychological treatment.

Free, with no paid features. If it helps you, a rating and a comment are the best way to say so.

YouTube is a trademark of Google LLC. Use of this trademark is subject to Google Permissions. This extension is not affiliated with, sponsored by or endorsed by YouTube or Google.
```

**Graphics** (from `release/store/`):

| Asset | File | Size |
|---|---|---|
| Store icon | `icon128.png` (the 128 px icon from the package) | 128x128 |
| Screenshot 1 | `1-prompt.png` — the category question on a video | 1280x800 |
| Screenshot 2 | `2-popup.png` — today's budget in the toolbar popup | 1280x800 |
| Screenshot 3 | `3-report.png` — the statistics | 1280x800 |
| Screenshot 4 | `4-blocked.png` — the limit reached, the video saved for later | 1280x800 |
| Screenshot 5 | `5-welcome.png` — the welcome page with the setup | 1280x800 |
| Small promo tile | `promo-440x280.png` | 440x280 |

The store still shows the screenshots uploaded with 1.0.0, so the statistics screenshot (`3-report.png`) carries
the old heading "Report" (the page is called Statistics since 1.0.1). `node e2e/store-shots.mjs` regenerates all
of them when they are next replaced.

**Additional fields:** Homepage URL <https://github.com/MnemosyneVL/3017_YTAddictionFixer>, Support URL <https://github.com/MnemosyneVL/3017_YTAddictionFixer/issues>. Mature content: no.

## Search: which words go where

The store's search ranks on the listing's texts (title, summary, description) and on how the item is doing
(ratings, installs against uninstalls); Google does not publish the weights. Its rules for the texts (listing
guide and spam-policy FAQ, read on 2026-10-04):

- The title says what the extension does; it is not a list of keywords.
- A keyword appears fewer than five times and only where it is true of the extension. No keyword lists, no
  names of other extensions, nothing off-topic.
- The store shows the summary above the description, so the description does not repeat it.

| Search terms | Where they are |
|---|---|
| addiction, time limit, tracker, blocker | title |
| detox, focus, productivity, distraction, time tracker, statistics, budget | summary |
| timer, Shorts, screen time, doomscrolling, procrastination, self-control, blocked hours | description |

`brand.test.ts` checks the lengths, that the title carries the trademark once, that no word keeps repeating in
title and summary, and that the search terms stay under five in the description above.

Comparable extensions and their categories on 2026-10-04: Unhook, StayFocusd, Forest, LeechBlock NG and YouTube
Detox are in Workflow & Planning, BlockSite in Tools; Well-being holds two small ones.

What else moves the ranking, and what must not be done:

- Ratings and reviews by real users. Never rate or review the extension yourself, and never have friends,
  family or other accounts do it: the store treats that as manipulating placement. Asking users for an honest
  rating is fine (the extension does); offering anything in return is not.
- The Featured badge raises the ranking. It can be requested through the store's One Stop Support form once
  the listing is complete and current, which includes screenshots that match the current version.
- A listing is found in the languages it is written in. Translating title, summary and description
  (`_locales/`) is the next step if users who do not search in English matter.

## Updating the listing

- Title and summary are part of the package: change `brand.json` and `public/manifest.json`, release a new
  version and upload its zip (Package tab, "Upload new package").
- Description, category, graphics and the privacy answers are changed in the dashboard.
- Either way nothing goes live before "Submit for review" and a passed review; until then the published
  listing stays as it is. While a review is pending the draft cannot be edited: wait for the result, or use
  "Cancel review" in the item's menu, make all changes and submit once.

## Privacy practices tab

**Single purpose:**

> Helps the user limit and understand the time they spend on YouTube: it counts watch time against a daily budget and per-category limits the user sets, asks for each video's category, closes YouTube when a budget is used up, and shows statistics.

**Permission justifications:**

| Permission | Justification |
|---|---|
| Host permission `*://*.youtube.com/*`, `*://*.youtube-nocookie.com/*` | The extension only works on YouTube. Its content script observes whether a video is playing and visible to count watch time, shows the category question, the timer and the saved-for-later list on the page, and replaces a page with the extension's placeholder when the user's limit is reached. The background service looks up a video's title from YouTube's public oEmbed address. |
| `storage` | Stores the user's settings, the per-day watch time, the category of each video and the saved-for-later list locally in the browser. |
| `unlimitedStorage` | The report keeps the user's watch history for as long as they want it. It is stored only locally and can grow past the default quota after long use; without this permission tracking would stop saving. |
| `alarms` | Starts a new day at the time the user chose, ends the one emergency override, and starts and ends the user's blocked hours when no YouTube tab is reporting. |
| `notifications` | Warns the user a few minutes before a limit is reached and tells them when it is reached. Used only for these messages. |
| `idle` | Stops counting time when the user is away from the computer or the screen is locked. |
| `scripting` | Injects the extension's own content script into YouTube tabs that were already open when the extension is installed or updated, so that tracking works without reloading them. No remote code is injected. |

**Remote code:** No, I am not using remote code.

**Data usage** — tick **Web history** only ("the list of web pages a user has visited, as well as associated
data such as page title and time of visit": the extension records the YouTube videos the user opens, with
title and watch time). It is stored on the device and never transmitted. Tick nothing else: no personally
identifiable information, health, financial, authentication, personal communications, location, user activity
(no clicks, keystrokes or mouse movement are logged) or website content beyond the video title and channel
name that belong to the web-history entry. If the dashboard's wording has changed, answer in that spirit.

Certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** <https://github.com/MnemosyneVL/3017_YTAddictionFixer/blob/main/PRIVACY.md>

## Distribution tab

Free, all regions, visibility Public. Unticking "publish automatically after review" lets you choose the
moment.

## Notes for the reviewer (test instructions field)

```
No account or login is needed.

1. After installation a welcome page opens. Until "Start" is pressed there, the extension records and enforces nothing (the toolbar badge shows "!").
2. Choose a daily limit and press "Start". Open any YouTube video: a question asks for the video's category and the video stays paused until one is chosen.
3. A small timer appears on the player; the toolbar badge shows the minutes left. The popup shows today's totals.
4. To see a limit being enforced quickly: open the extension's Settings, set "Daily limit" to 1 minute and save (lowering a limit applies at once). After a minute of watching, a notification appears, the current video may finish, and any other YouTube page is replaced by the extension's placeholder page, which keeps the link and offers one 15-minute emergency override per day.
5. Settings → Data offers export, import and deletion of everything the extension stores. All data stays in chrome.storage.local; the extension has no server and makes no requests except to YouTube (video titles via oEmbed, thumbnails).
```

## If the name is rejected

The name follows the "… for YouTube™" form the branding guidelines ask for. Should review object to the word
"addiction" next to the trademark, resubmit as **Watch Budget for YouTube™** with the summary unchanged, and
keep "addiction recovery" in the description only. Changing it means editing `src/shared/brand.json`
(`name`, `title`, `label`, `slug`), `public/manifest.json` and the HTML titles (`brand.test.ts` says which).
1.0.0 and 1.0.1 (with the longer title) were accepted as they are; this only matters if a later review objects.

## If the icon is rejected

`node scripts/make-icons.mjs --design ring` renders the fallback (a pause symbol inside a progress ring, no
syringe, no play triangle). Rebuild, regenerate the screenshots, resubmit. The icon was accepted with 1.0.0.

## Developer account checklist

Done on 2026-10-01; the declaration is non-trader.

- Registered with a dedicated account (its e-mail can never be changed later); one-time registration fee paid.
- 2-step verification is on (mandatory for publishing).
- Publisher name "onXI Digital"; contact e-mail verified.
- Trader / non-trader declaration made. It is a legal self-declaration under EU law: as a trader your legal
  name, address and phone number are shown on the listing.

## Ko-fi page

Name: onXI Digital. Connect PayPal with a **Business** account, otherwise supporters see your legal name and
e-mail on their receipt.

About text:

```
I make Addiction Recovery for YouTube™, a free and open-source Chrome extension that gives your YouTube time a daily budget, lets you finish the video you are on, and saves the rest for later. Everything it records stays on your device.

The extension is free, with nothing locked behind a payment. What helps most is a rating and a comment in the Chrome Web Store. If you would also like to buy me a coffee, thank you: it pays for the time that goes into keeping the extension working as YouTube changes.

Let's reclaim our lives!
```

The page is <https://ko-fi.com/onxidigital>; the same address is in `src/shared/brand.json` (`links.tips`).
