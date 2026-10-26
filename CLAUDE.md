# Starfield / Holo Timer — notes for Claude

Michael's personal focus-timer PWA (vanilla JS, no build step), hosted on GitHub Pages from `main`.
He is not a coder: he describes changes in plain English; Claude edits, tests, and pushes.

## Releasing a change (every time)
1. Bump `VERSION` in `sw.js` AND `APP_VERSION` in `js/version.js` (same number; shown in Settings).
2. If you add a new file the app loads, add it to the `FILES` list in `sw.js` (offline cache).
3. Test headless at phone sizes (390x844 with safe areas, 375x667, and a ~390x664 Safari tab), not just one.
4. Commit to `main` with a plain-English message and push. Pages deploys in about a minute.
5. Tell Michael: fully close the app and reopen it; the update applies on that first reopen.

## Never
- Touch user data shape without a migration: data is an append-only event log in IndexedDB (`js/storage.js`).
- Add pop-ups, modals, or reward screens (ADHD: rewards must never slow him down).
- Make Start take more than one tap.

See README.md for architecture and design decisions.
