# Addiction Recovery for YouTube™

A Chrome extension that gives your YouTube time a budget: it keeps what is worth watching and stops the rest
from eating the day.

Blocking YouTube outright also blocks the things worth learning from it. A flat daily limit does not work
either: a 15-minute tutorial leaves 45 minutes of doomscrolling, and a 2-hour video forces the limit up,
which is then wasted tomorrow. This extension replaces both with budgets that follow *what* you watch:

- **Daily budget.** Time on YouTube is tracked (including fullscreen and picture-in-picture; not while the
  browser is minimized). When the budget is used up you get a notification: the video you are watching is
  allowed to finish, but no other video can be started until tomorrow.
- **Nothing is lost.** Blocked pages are replaced by a placeholder that keeps the original link, and every
  blocked video is saved to a *watch later* list, so tabs you opened for tomorrow survive; a saved video you
  later watch to its end leaves the list on its own. The newest saved videos show up as a *Saved for later*
  shelf at the top of the YouTube home and subscriptions feeds (with their category, and marked when they
  cannot be watched today) and in the toolbar popup, so your own list competes with the recommendations right
  where you decide what to watch next.
- **Categories.** Every new video asks for a category you chose yourself (Learning, Entertainment, Music, …).
  The question pauses the video until you answer; a channel can be set to always use one category. Reports
  show where the time actually goes. Misjudged a video? Click the timer on the player (or use the popup's
  "Current video" row) to change its category; today's minutes move with it.
- **Finish-it allowances per category.** How long the current video may continue once a limit is reached is a
  per-category setting: Learning can run to the end of the video, Entertainment can be capped at, say, 30
  extra minutes (0 = stop immediately). A video that plays to its end goes straight to a "you finished your
  video" screen and is *not* added to the saved list.
- **Per-category budgets.** Entertainment can get 1 hour a day while Learning is bounded only by the daily
  budget. When a category budget runs out, the current video finishes and further videos of that category are
  blocked; other categories keep working.
- **Blocked hours.** Optional clock windows (work hours, nighttime; overnight spans work) during which
  YouTube is fully closed: a warning beforehand, then a hard cutoff. Extending them applies today; removing
  them waits until tomorrow. The emergency override still works.
- **A timer where you look.** An optional small timer on the video itself (fullscreen included) shows how much
  of today's budget is left and the current video's category with its color; corner and on/off in Settings.
- **No easy escape hatch.** Raising a budget takes effect tomorrow (lowering applies immediately). There is one
  logged *emergency override* per day: 15 extra minutes, cut off hard when they are over, visible in the report.
- **Statistics.** A report with the category split per day, the top channels and videos, the limits you hit
  and the overrides you used, exportable as CSV.

It is a self-control tool, not a parental control and not medical treatment: you can always switch it off.

## Install

**From the Chrome Web Store.** The listing is in preparation; this section gets the link once it is live.

**From source.**

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable *Developer mode*, choose *Load unpacked* and select the `dist/` folder.

Works in Chrome 120 or newer on a computer, on youtube.com. YouTube Music, the mobile apps and embedded
players on other sites are not covered.

## Using it

- **First run.** After installing, a welcome page explains the idea and asks for your daily limit and your
  categories. Nothing is recorded or blocked until you press *Start* there; the same page stays available as
  *Help* in the popup.
- **The toolbar icon** shows the minutes left today (orange when the warning threshold is reached, `✕` when
  blocked, `OV` during an override, `!` while setup is not finished). Click it for today's breakdown, the
  current video's category and the newest videos on your saved-for-later list.
- **Settings** (right-click the icon → Options): daily budget, when your "day" starts, warning time, what
  counts as time, the on-video timer, the saved-for-later shelf, categories and their budgets, Shorts, blocked
  hours, channel rules, saved links, and your data: export, import (checked before anything is replaced),
  clear the history, or delete everything. Every setting says what it does.
- **Report**: category split per day / 7 days / 30 days / custom range, top channels and videos, overrides.
- **Incognito windows** are only covered if you enable *Allow in Incognito* in the extension's details.

### What counts as time

The *Count time when* setting decides how **videos** count:

- **Visible or playing** (default): a playing video always counts, even in a background tab or a covered window
  (fullscreen and picture-in-picture included). A paused video counts while its tab is visible, the window is
  focused and you are active.
- **Only while the tab is visible**: nothing counts in a hidden tab, not even a playing video. A visible video
  counts while it plays or while you are active on the page.
- **Only while a video is playing**: a video counts only while it actually plays; a paused video is free.

Feed, search and channel pages have nothing to play, so in every mode they count while they are visible and you
are active on them, as the built-in *Browsing* category, which can have its own budget. "Active" means the
window has focus and you used the keyboard or mouse within the idle timeout (2 minutes by default). A tab parked
on a second monitor while you work elsewhere, a minimized window or a locked screen never count. Shorts are
assigned to a category of your choice without a question (or can be blocked entirely).

### FAQ

**I raised my limit but it didn't change.** Raises apply from the next day on purpose; lowering applies now.

**The video I was watching got cut off.** The "finish your video" allowance is a time budget (remaining length
plus a small margin, capped in Settings); looping, rewinding or a live stream will run into it.

**Can I get around it?** Yes. Another browser, another profile, or disabling the extension all work. The design
goal is to remove the *frictionless* ways of wasting time, not to be a prison.

## Privacy

Everything the extension records (the videos you open, how long you watch, your categories, your saved list and
your settings) stays in your browser, on your device. There is no account, no server, no analytics and no
advertising, and nothing is recorded before you press *Start*. The only requests it makes go to YouTube itself,
for video titles and thumbnails. You can export or delete your data at any time. The full text is in
[PRIVACY.md](PRIVACY.md); how the extension is protected against the pages it runs on is in
[SECURITY.md](SECURITY.md).

It asks for access to youtube.com and youtube-nocookie.com, storage, alarms, notifications, idle detection and
scripting, and for nothing else; in particular not for your browsing history.

## Feedback and support

The extension is free, with nothing locked behind a payment. After a week, a month and three months of use a
small card asks whether it helped and for a rating; it can be switched off under *Settings → Support this
project*. A rating and a comment in the Chrome Web Store are the most useful thing you can give. Bugs and ideas
belong in the [issue tracker](https://github.com/MnemosyneVL/3017_YTAddictionFixer/issues). If you would like to support the work:
[ko-fi.com/onxidigital](https://ko-fi.com/onxidigital).

## Roadmap

- Count embedded YouTube players on other sites (without redirecting them).
- Optional `declarativeNetRequest` hard-block mode that works even while the service worker is asleep.
- `music.youtube.com` support (currently excluded).
- Carry over-budget time as debt into the next day (optional).
- More surfaces for the saved-for-later list: a block above "Up next" on watch pages, a floating "Saved" dock,
  a reminder toast when the feed opens.
- Automatic deletion of old history (a retention setting).
- Translations.
- A listing for Microsoft Edge.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Design decisions: [docs/DECISIONS.md](docs/DECISIONS.md). Changes: [CHANGELOG.md](CHANGELOG.md). Texts and
answers for the store listing: [docs/STORE_LISTING.md](docs/STORE_LISTING.md).

## License and trademarks

Copyright © 2026 onXI Digital.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See
[LICENSE](LICENSE) for the full text.

YouTube is a trademark of Google LLC. Use of this trademark is subject to Google Permissions. This extension is
not affiliated with, sponsored by or endorsed by YouTube or Google.
