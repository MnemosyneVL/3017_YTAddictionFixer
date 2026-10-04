# Chrome Web Store listing

Everything that has to be typed or uploaded in the developer dashboard, ready to paste. Keep this file in
step with the extension: a new permission or a change in what is recorded changes the answers below.

Dashboard: <https://chrome.google.com/webstore/devconsole>

Listing: <https://chromewebstore.google.com/detail/addiction-recovery-for-yo/fojplifgklngfhhipbpnmkgmjlnkmhdp>
(item ID `fojplifgklngfhhipbpnmkgmjlnkmhdp`). A new or renamed item can be opened by this address at once; the
store's own search picks it up later.

## Before the first upload

1. `npm run package` and `npm run e2e:release` are green; upload `release/addiction-recovery-for-youtube-<version>.zip`.
2. `node e2e/store-shots.mjs` has produced the screenshots and the promo tile in `release/store/`.
3. `PRIVACY.md` is reachable at its public URL (it is the privacy-policy URL below).

## Store listing tab

**Name** (comes from the package): `Addiction Recovery for YouTube™`

**Summary** (comes from the package, 132 characters at most):

> Take your time back from YouTube: a daily time budget, per-category limits, a watch-time tracker and statistics. Fully on-device.

**Category:** Well-being  **Language:** English

The dashboard follows the language of the Google account, and the category names are translated with it:
Well-being is the last entry of the Lifestyle group (in Russian the group is «Образ жизни» and the category
«Здоровье»).

**Description:**

```
Blocking YouTube outright also blocks what is worth watching there. A flat daily timer fails the other way: a 15-minute tutorial leaves 45 minutes for scrolling, and a 2-hour lecture forces the limit up for good.

Addiction Recovery for YouTube™ gives your watching a budget that follows what you watch, and it lets you finish the video you are on.

HOW IT WORKS
• A daily time budget. A watch-time tracker counts the time a video plays or you are actively looking at the site; the toolbar icon shows the minutes you have left.
• One question per video: what is this? Learning, Entertainment, Music, or categories of your own. One click, or file a whole channel for good.
• Budgets per category. An hour of Entertainment a day while Learning may use the rest.
• Finish what you are watching. When a budget runs out, the current video may play to its end; then the site is closed until tomorrow.
• Nothing is lost. Every video you were stopped on is saved for later and shown at the top of your feed.
• Blocked hours. Close the site completely during work or at night.
• Statistics. A report shows where your time went: per day, per category, per channel and per video, with CSV export.
• No easy way out. Raising a limit takes effect tomorrow. One 15-minute emergency override a day, and it shows in your report.

PRIVATE BY DESIGN
• Everything stays in your browser. No account, no server, no analytics, no ads.
• Nothing is recorded until you press Start on the welcome page, which tells you exactly what is kept.
• Export or delete your data at any time. Open source (GPL-3.0).

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

**Additional fields:** Homepage URL <https://github.com/MnemosyneVL/3017_YTAddictionFixer>, Support URL <https://github.com/MnemosyneVL/3017_YTAddictionFixer/issues>. Mature content: no.

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
(`name`, `label`, `slug`) and the HTML titles (`brand.test.ts` says which).

## If the icon is rejected

`node scripts/make-icons.mjs --design ring` renders the fallback (a pause symbol inside a progress ring, no
syringe, no play triangle). Rebuild, regenerate the screenshots, resubmit.

## Developer account checklist

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
