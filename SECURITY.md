# Security

## Reporting a problem

If you find a way to make the extension do something it should not (read or change someone's data, run code,
act on a page it has no business on), please report it privately rather than in a public issue:

- use **Report a vulnerability** under the *Security* tab of <https://github.com/MnemosyneVL/3017_YTAddictionFixer>, or
- write to the contact address shown on the extension's page in the Chrome Web Store.

Say what you did, what happened and which version you used. You will get an answer, and a fix is released
before the details are made public. Only the latest published version is supported.

Bugs that are not security problems belong in the ordinary issue tracker.

## What the extension is built to withstand

It runs on youtube.com, a site that executes other people's code (YouTube's own, other extensions',
userscripts'). The design treats three parties with different trust:

1. **The YouTube page is hostile.** Whatever it posts to the extension is rebuilt field by field before it
   is used; it cannot choose which command runs, cannot inject a key such as `__proto__` or `constructor`,
   and cannot make the extension navigate anywhere except to its own placeholder page. Clicks and key
   presses a page script makes up are ignored by the extension's overlays.
2. **The content script is half trusted.** It lives in YouTube's renderer process, so the background
   service gives it only the seven requests its interface needs. It cannot read your history, change the
   settings, export, import or delete data, and it has no direct access to the extension's storage.
3. **The extension's own pages and its background service are trusted.** Every request is still validated,
   stored data is re-checked each time it is loaded, and a backup file is validated completely before
   anything is replaced.

Other properties:

- No remote code: everything the extension runs is in the package. No `eval`, no analytics, no third-party
  libraries at run time.
- Nothing is sent anywhere except two kinds of request to YouTube itself (see `PRIVACY.md`).
- The permissions are the minimum that works: YouTube's two hosts, storage, alarms, notifications, idle
  detection and scripting. The packaging script refuses to build a store package if that list changes.
- The published package is not minified, so what it does can be read.

Details are in `docs/ARCHITECTURE.md` ("Trust boundaries") and `docs/DECISIONS.md`.

## Known and accepted limits

- **It is not a parental control.** The person using the browser can switch the extension off, use another
  browser or profile, or delete its data. It removes the effortless ways of losing time; it does not lock
  anyone in.
- **YouTube can tell that the extension is installed** (it shows elements on the page, and its placeholder
  page is reachable from YouTube pages) and can read what those elements display: the remaining time, the
  category names, the saved-for-later titles.
- **A compromised YouTube page process could still** file a video under a wrong category or remove an entry
  from the saved-for-later list. Both are visible to you and can be undone.
