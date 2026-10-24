// demo.js — "Load demo data": fills the app with a realistic year of sessions.
// Deterministic (seeded), so screenshots and bug reports are reproducible.
// Weekdays get 1–4 sessions, weekends fewer, with occasional rest days. Lengths cluster on
// 25/45/50/60/90 with small overruns; start times bunch in the morning and mid-afternoon.

import { rng, hashSeed, startOfDay, addDays, MIN } from './util.js';

const TAG_WEIGHTS = { Review: 0.36, Outline: 0.2, Read: 0.17, French: 0.15, Novel: 0.12 };
const LENGTHS = [[25, 0.12], [45, 0.3], [50, 0.2], [60, 0.2], [90, 0.15], [110, 0.03]];

function pick(r, pairs) {
  let x = r() * pairs.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

/** Build session records from Jan 1 of this year up to (but not including) the current minute. */
export function buildDemo(storage, now = new Date()) {
  const r = rng(hashSeed('holo-demo-v1'));
  const tags = storage.listTags();
  const byName = Object.fromEntries(tags.map((t) => [t.name, t.id]));
  const tagPairs = Object.entries(TAG_WEIGHTS).filter(([n]) => byName[n]).map(([n, w]) => [byName[n], w]);
  if (!tagPairs.length) tags.forEach((t) => tagPairs.push([t.id, 1]));
  // Don't overlap anything that already exists.
  const taken = storage.listSessions().map((s) => [Date.parse(s.started_at), s.ended_at ? Date.parse(s.ended_at) : Infinity]);

  const out = [];
  const end = now.getTime();
  for (let day = new Date(now.getFullYear(), 0, 1); day <= now; day = addDays(day, 1)) {
    const dow = day.getDay();
    const weekend = dow === 0 || dow === 6;
    if (r() < (weekend ? 0.42 : 0.12)) continue; // rest day
    const n = weekend ? 1 + Math.floor(r() * 1.6) : 1 + Math.floor(r() * (r() < 0.15 ? 4 : 2.2));
    // Morning block from ~8:30, an afternoon block from ~13:30, sometimes an evening one.
    let cursor = startOfDay(day).getTime() + (8.5 + r() * 1.2) * 60 * MIN;
    for (let i = 0; i < n; i++) {
      if (i === 2) cursor = Math.max(cursor, startOfDay(day).getTime() + (13.5 + r()) * 60 * MIN);
      if (i === 3) cursor = Math.max(cursor, startOfDay(day).getTime() + (19 + r()) * 60 * MIN);
      const planned = pick(r, LENGTHS);
      const actual = Math.max(12, Math.round(planned + (r() < 0.25 ? r() * 12 : -r() * 6)));
      const st = cursor;
      const en = st + actual * MIN;
      if (en > end - MIN) break;
      if (!taken.some(([a, b]) => st < b && en > a)) {
        out.push({ tag_id: pick(r, tagPairs), planned_minutes: planned, started_at: new Date(st).toISOString(), ended_at: new Date(en).toISOString(), pauses: [] });
      }
      cursor = en + (10 + r() * 40) * MIN;
    }
  }
  return out;
}

export function loadDemo(storage) {
  const list = buildDemo(storage);
  storage.logSessions(list);
  return list.length;
}
