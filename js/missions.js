// missions.js — medal definitions and how they're computed from real sessions.
// Pure logic, no DOM. Medals are personal: no sharing, no pop-ups. A newly earned medal only
// lights the amber dot on the hex badge until Completed Missions has been opened once.

import { dayKey, weekKey, startOfDay, addDays, MIN, HOUR } from './util.js';

/** The 12 medals, in display order. `fmt` turns progress numbers into the "x / y" text. */
export const MEDALS = [
  { id: 'streak3', group: 'STREAKS', glyph: '3', name: '3 in a row', desc: 'Focus 3 days running', goal: 3 },
  { id: 'streak4', group: 'STREAKS', glyph: '4', name: '4 in a row', desc: 'Focus 4 days running', goal: 4 },
  { id: 'streak7', group: 'STREAKS', glyph: '7', name: '7 in a row', desc: 'Focus 7 days running', goal: 7 },
  { id: 'streak14', group: 'STREAKS', glyph: '14', name: 'Fortnight', desc: 'Focus 14 days running', goal: 14 },
  { id: 'hour1', group: 'TIME', glyph: '1h', name: 'First hour', desc: 'One hour in a day', goal: 60, unit: 'm' },
  { id: 'week10', group: 'TIME', glyph: '10h', name: '10-hour week', desc: '10 hours in a week', goal: 10, unit: 'h' },
  { id: 'h100', group: 'TIME', glyph: '100h', name: 'Century', desc: '100 hours, all time', goal: 100 },
  { id: 'h500', group: 'TIME', glyph: '500h', name: 'Half a thousand', desc: '500 hours, all time', goal: 500 },
  { id: 's90', group: 'SESSIONS & RANGE', glyph: '90m', name: 'Deep star', desc: 'A single 90-minute session', goal: 90 },
  { id: 's120', group: 'SESSIONS & RANGE', glyph: '2h', name: 'Supergiant', desc: 'A single 2-hour session', goal: 120 },
  { id: 'month20', group: 'SESSIONS & RANGE', glyph: '20d', name: 'Full month', desc: '20 active days in a month', goal: 20 },
  { id: 'tags5', group: 'SESSIONS & RANGE', glyph: '5★', name: 'Five colors', desc: 'Use 5 different tags', goal: 5 },
];

/** Active-day keys (days with any finished focus) → Set. */
function activeDays(sessions) { return new Set(sessions.map((s) => dayKey(new Date(s.started_at)))); }

/**
 * Current streak in days. Today counts if it has focus; if it doesn't yet, the streak
 * runs through yesterday (it isn't broken until the day is over).
 */
export function currentStreak(sessions, now = new Date()) {
  const days = activeDays(sessions);
  let d = startOfDay(now);
  if (!days.has(dayKey(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

/** Longest streak ever, in days. */
export function bestStreak(sessions) {
  const keys = [...activeDays(sessions)].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/**
 * Compute every medal from finished sessions.
 * @returns [{...medal, state: 'earned'|'new'|'locked', earned_at: Date|null, have, goal}]
 */
export function computeMedals(storage, now = new Date()) {
  const done = storage.listSessions({ includeActive: false });
  const seen = new Set(storage.getSettings().missions_seen || []);
  const earned = {};
  const mark = (id, at) => { if (!earned[id]) earned[id] = at; };

  // Walk sessions in time order, noting the moment each threshold is first crossed.
  const dayT = new Map(); const weekT = new Map(); const monthDays = new Map(); const tagSet = new Set();
  let total = 0; let longest = 0; let run = 0; let prevDay = null;
  for (const s of done) {
    const st = new Date(s.started_at);
    const at = new Date(s.ended_at);
    const ms = storage.sessionElapsed(s);
    const dk = dayKey(st); const wk = weekKey(st); const mk = dk.slice(0, 7);
    if (dk !== prevDay) { // streak bookkeeping on each new active day
      run = prevDay && dayKey(addDays(new Date(`${prevDay}T12:00:00`), 1)) === dk ? run + 1 : 1;
      prevDay = dk;
      [3, 4, 7, 14].forEach((n) => { if (run >= n) mark(`streak${n}`, at); });
      if (!monthDays.has(mk)) monthDays.set(mk, new Set());
      monthDays.get(mk).add(dk);
      if (monthDays.get(mk).size >= 20) mark('month20', at);
    }
    dayT.set(dk, (dayT.get(dk) || 0) + ms); if (dayT.get(dk) >= HOUR) mark('hour1', at);
    weekT.set(wk, (weekT.get(wk) || 0) + ms); if (weekT.get(wk) >= 10 * HOUR) mark('week10', at);
    total += ms; if (total >= 100 * HOUR) mark('h100', at); if (total >= 500 * HOUR) mark('h500', at);
    longest = Math.max(longest, ms); if (ms >= 90 * MIN) mark('s90', at); if (ms >= 120 * MIN) mark('s120', at);
    if (s.tag_id) { tagSet.add(s.tag_id); if (tagSet.size >= 5) mark('tags5', at); }
  }

  // Progress for locked medals: where you stand now.
  const streakNow = currentStreak(done, now);
  const today = dayKey(now);
  const have = {
    streak3: streakNow, streak4: streakNow, streak7: streakNow, streak14: streakNow,
    hour1: Math.floor((dayT.get(today) || 0) / MIN),
    week10: Math.floor((weekT.get(weekKey(now)) || 0) / HOUR),
    h100: Math.floor(total / HOUR), h500: Math.floor(total / HOUR),
    s90: Math.floor(longest / MIN), s120: Math.floor(longest / MIN),
    month20: monthDays.get(today.slice(0, 7))?.size || 0,
    tags5: tagSet.size,
  };

  return MEDALS.map((m) => {
    const at = earned[m.id] || null;
    return { ...m, earned_at: at, state: !at ? 'locked' : seen.has(m.id) ? 'earned' : 'new', have: Math.min(have[m.id], m.goal) };
  });
}

/** Is anything newly earned? Drives the amber dot on the hex badge. */
export const hasNew = (storage) => computeMedals(storage).some((m) => m.state === 'new');
