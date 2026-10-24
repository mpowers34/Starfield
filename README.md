# Holo Timer — prototype v0.1

A personal focus timer (Forest replacement). Every finished session is a star; Day/Week/Month/Year
show the same holographic grid at different scales. Vanilla JS, no build step, works offline.

## Files

```
index.html              page shell, iOS meta tags
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline cache) — bump VERSION when you change files
css/styles.css          all styles; colour tokens at the top
js/app.js               boot, navigation, clock tick, Look settings
js/storage.js           THE persistence layer (event log on IndexedDB) — only file to change for Supabase
js/util.js              time/calendar helpers, seeded random
js/stars.js             star glyph, grid projection, deterministic placement + growth rule
js/metrics.js           Mission Data cards (add new metrics here: write a card, push it into CARDS)
js/missions.js          the 12 medals, computed from sessions
js/demo.js              "Load demo data"
js/ui.js                undo toast, icons
js/screens/*.js         timer, data (Day/Week/Month/Year), missions, settings
fonts/                  Chakra Petch + IBM Plex Mono (OFL), self-hosted for offline
icons/                  app icons (icon.svg is the source)
```

## Design decisions worth knowing

- **Data model.** Append-only event log: UUID ids, UTC ISO `occurred_at`, snake_case, soft deletes,
  a `device_id` and per-device `seq` on every event. State is rebuilt by folding the log. To sync:
  upload local events, download remote ones, union by `id`, re-fold. Export/Import already work this way
  (importing the same file twice adds nothing).
- **Timer.** Elapsed = (end or now) − start − paused time. Nothing ticks in storage, so reloads, a locked
  phone, or ending on another device all give the right number.
- **Countdown at zero** chimes once and keeps running into amber overtime until you tap End.
- **Short sessions.** Under 2 minutes is discarded on End; every End shows a 5-second UNDO.
- **Grid growth.** A period grows to the next size (5→6→8→11→15→20→26→32…) when it passes 85% full.
  Stars keep their place in space (snapped to the nearest cell of the finer grid); nothing reshuffles.
  The scope label shows the size when it has grown, e.g. `SCOPE · DAY · 6×6`.
- **Medals.** Earned → the hex badge gets an amber dot. Opening Completed Missions clears the dot; NEW
  pills stay for that visit.
- **Daily goal** is the thin amber arc under the Day total.
- **No pop-ups anywhere.** Erase uses tap-twice; tag edits are inline.

## Test checklist (on the iPhone)

1. Open the app from the Home Screen icon: no Safari bars, content clear of the notch and home bar.
2. Tap **Start** once: a 45:00 session starts with the last tag. No other step.
3. Tap another tag chip mid-session: the label and star color change straight away.
4. Pause, wait, resume: paused time isn't counted. Lock the phone for a few minutes, reopen: time is right.
5. Swipe the app away entirely and reopen: the session is still running with the correct time.
6. Let a short countdown (set 25 min, or test with a past session) pass zero: one chime, then amber overtime.
7. End a session, then tap **UNDO** within 5 s: it keeps running. End one under 2 min: "NOT SAVED".
8. Settings › Data › **Load demo data**, then check Day/Week/Month/Year, prev/next and swiping the grid.
9. Tap tag filters on a data view: those stars and their minutes disappear; tap again to bring them back.
10. Hex badge shows an amber dot → open Completed Missions → NEW pills shown → back: the dot is gone.
11. Settings: change accent color, turn scanlines off, turn on Reduce motion (radar sweep stops).
12. Rename a tag, drag one by its handle, add a New Tag, delete one and UNDO.
13. **Export** (share sheet → Save to Files), **Erase** (tap twice), **Import** the file: everything is back.
14. Turn on Airplane Mode and launch from the Home Screen: the app opens and works.
15. Erase once more before using it for real, to clear the demo data.

## Put it on your iPhone (GitHub Pages, free)

A service worker needs HTTPS, so the app has to be hosted somewhere (opening the file directly won't
install offline). GitHub Pages is the simplest free option:

1. On github.com, create a new **public** repository, e.g. `holo-timer`.
2. Click **Add file › Upload files** and drag in the *contents* of this folder (index.html, sw.js, the
   css/js/fonts/icons folders, …), so `index.html` is at the top level. Commit.
3. Repository **Settings › Pages** → Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)** → Save.
4. After a minute the site is at `https://<your-username>.github.io/holo-timer/`.
5. Open that address in **Safari** on the iPhone → **Share** → **Add to Home Screen** → Add.
6. Launch it once while online (this caches everything). From then on it works offline.

On the Mac: open the same URL in Safari and use **File › Add to Dock** (or Chrome's install button).
The Mac and iPhone keep **separate** data until sync exists; use Export/Import to move data between them.

**Updating later:** upload the changed files and bump `VERSION` in `sw.js`. The app picks up the new
version the next time it's opened (sometimes the launch after that).

**Backups:** data lives only on the device until sync exists. Export now and then. Home Screen apps
aren't subject to Safari's 7-day cleanup of website data, but deleting the icon deletes its data.

## Running it locally on the Mac

```
cd holo-timer
python3 -m http.server 8000
```
Then open http://localhost:8000. (localhost counts as secure, so offline mode works there too.)

## Known limits (iOS web apps)

- No vibration on iPhone. The web vibration API isn't supported, so "haptics" only works on Android.
- The chime plays only while the app is on screen. Background alerts would need notifications (out of scope).
- Opening the app in Safari and from the Home Screen gives you two separate data stores. Use the icon.
