// metrics.js — the "MISSION DATA" cards under each grid.
//
// Each card is { id, title, render(d) → HTML string }. CARDS[scope] lists the cards in order.
// To add a metric later: write a card object and push it into the scope's list. Nothing else changes.
//
// d (the data every card receives):
//   period    { scope, start, end, key }
//   sessions  sessions in the period with tag filters applied (sorted by start)
//   all       finished sessions, all time, filters applied (for streaks etc.)
//   tags      Map id → tag
//   elapsed   fn(session) → ms
//   now       timestamp
//   isCurrent whether this period contains today

import { fmtHM, fmtHShort, fmtRange, fmtTime, addDays, startOfDay, DOW, MON, MIN, HOUR, esc } from './util.js';
import { starIcon } from './stars.js';
import { currentStreak, bestStreak } from './missions.js';

const tagColor = (d, s) => d.tags.get(s.tag_id)?.color || '#8fa7bd';
const tagName = (d, s) => d.tags.get(s.tag_id)?.name || 'Untagged';
const sumMs = (d, list) => list.reduce((a, s) => a + d.elapsed(s), 0);
const empty = (msg) => `<div class="empty">${msg}</div>`;

/** Total focus per local day within [start, end). Returns Map dayStartMs → { ms, sessions }. */
function byDay(d) {
  const m = new Map();
  for (let t = startOfDay(d.period.start); t < d.period.end; t = addDays(t, 1)) m.set(t.getTime(), { ms: 0, sessions: [] });
  for (const s of d.sessions) {
    const k = startOfDay(new Date(s.started_at)).getTime();
    const e = m.get(k);
    if (e) { e.ms += d.elapsed(s); e.sessions.push(s); }
  }
  return m;
}

/** Minutes of focus per hour of the day (0–23), splitting sessions that cross an hour. */
function byHour(d) {
  const mins = new Array(24).fill(0);
  for (const s of d.sessions) {
    // Walk the session in its focused span (ignoring pauses is close enough for a time-of-day chart).
    let t = Date.parse(s.started_at);
    let left = d.elapsed(s);
    while (left > 0) {
      const dt = new Date(t);
      const nextHour = new Date(dt); nextHour.setMinutes(60, 0, 0);
      const chunk = Math.min(left, nextHour - dt);
      mins[dt.getHours()] += chunk / MIN;
      left -= chunk; t += chunk;
    }
  }
  return mins;
}

// ---------- Day ----------

const PENCIL = '<svg class="pencil" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9.6 2.2l2.2 2.2-7 7H2.6V9.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

/** A session's notes, each with its time, shown under its row. */
const notesList = (s) => (s.notes && s.notes.length
  ? `<div class="sess-notes">${s.notes.map((n) => `<div><b>${fmtTime(new Date(n.at))}</b>${esc(n.text)}</div>`).join('')}</div>`
  : '');

const daySessions = {
  id: 'day-sessions',
  title: 'HOUR BY HOUR · SESSIONS',
  // Tap a session to correct its tag or times (inline editor); "+ ADD SESSION" logs a forgotten one.
  render(d) {
    const ed = d.editor;
    const rows = d.sessions.map((s) => {
      const live = !s.ended_at;
      const ms = d.elapsed(s);
      const range = live ? `${fmtTime(new Date(s.started_at))} – now` : fmtRange(new Date(s.started_at), new Date(s.ended_at));
      const open = ed.open === s.id;
      return `<button type="button" class="lrow sess${open ? ' open' : ''}" data-edit-session="${s.id}" aria-expanded="${open}" aria-label="Edit ${esc(tagName(d, s))} session, ${range}">${starIcon(tagColor(d, s), ms / MIN, { ring: live })}
        <div class="grow"><div class="name">${esc(tagName(d, s))}</div><div class="meta">${range}</div></div>
        ${live ? '<span class="pill">LIVE</span>' : ''}<div class="val">${fmtHM(ms)}</div>${PENCIL}</button>${notesList(s)}${open ? d.renderEditor() : ''}`;
    }).join('');
    const none = d.sessions.length ? '' : empty(d.isCurrent ? 'NO STARS YET TODAY · START ONE FROM THE TIMER' : 'NO FOCUS THIS DAY');
    const adding = ed.open === 'new';
    return `${rows}${none}${adding ? d.renderEditor() : ''}
      <button type="button" class="new-tag add-session" data-act="add-session" aria-expanded="${adding}">${adding ? 'ADDING A SESSION' : '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>ADD SESSION'}</button>`;
  },
};

// ---------- Week ----------

const weekDays = {
  id: 'week-days',
  title: 'DAY BY DAY',
  render(d) {
    const today = startOfDay(new Date(d.now)).getTime();
    return [...byDay(d)].map(([k, e]) => {
      const day = new Date(k);
      const future = k > today;
      const isToday = k === today;
      const lab = `${DOW[day.getDay()]} ${day.getDate()}`;
      const stars = e.sessions.slice(0, 9).map((s) => starIcon(tagColor(d, s), d.elapsed(s) / MIN, { box: 26 })).join('');
      return `<div class="drow${future ? ' future' : ''}"><div class="day${isToday ? ' accent' : ''}">${lab}</div>
        <div class="ministars">${stars}</div>
        <div class="val${isToday ? ' accent' : ''}">${future || !e.ms ? '—' : fmtHM(e.ms)}</div></div>`;
    }).join('');
  },
};

/** 24-bar chart of focus by hour of day, peak hour in the accent color. Geometry from the mock. */
function hourChart(d) {
  const mins = byHour(d);
  const max = Math.max(...mins);
  const peak = max > 0 ? mins.indexOf(max) : -1;
  const h12 = (h) => `${h % 12 || 12}${h < 12 ? 'A' : 'P'}`;
  let bars = '';
  mins.forEach((m, h) => {
    const x = 18 + 13.5 * h;
    if (m <= 0) { bars += `<rect x="${x}" y="90.8" width="11.5" height="1.2" fill="#8fa7bd" opacity="0.35"/>`; return; }
    const hgt = Math.max(3, (m / max) * 62);
    const y = (92 - hgt).toFixed(1);
    const c = h === peak ? 'var(--accent)' : '#5ad7ff';
    bars += `<rect x="${x}" y="${y}" width="11.5" height="${hgt.toFixed(1)}" fill="${c}" opacity="${h === peak ? 0.34 : 0.28}"/>`
      + `<rect x="${x}" y="${y}" width="11.5" height="1.6" fill="${c}" filter="url(#glow)"/>`
      + `<path d="M${x} ${y}V92M${x + 11.5} ${y}V92" stroke="${c}" stroke-width="0.7" opacity="0.6"/>`;
  });
  const peakLab = peak >= 0 ? `<text x="${(18 + 13.5 * peak + 5.75).toFixed(1)}" y="22" text-anchor="middle" class="svg-mono" font-size="9" letter-spacing="1" fill="var(--accent)">PEAK ${h12(peak).replace(/[AP]$/, '')}–${h12((peak + 1) % 24)}</text>` : '';
  const axis = [[0, '12A'], [6, '6A'], [12, '12P'], [18, '6P'], [23, '11P']]
    .map(([h, t]) => `<text x="${(18 + 13.5 * h + 5.75).toFixed(1)}" y="105" text-anchor="middle" class="svg-mono" font-size="9" letter-spacing="1" fill="#8fa7bd">${t}</text>`).join('');
  const total = Math.round(mins.reduce((a, b) => a + b, 0));
  return `<svg class="chart" viewBox="0 0 350 118" role="img" aria-label="Focus minutes by hour of day: ${total} minutes in all${peak >= 0 ? `, most between ${h12(peak)} and ${h12((peak + 1) % 24)}` : ''}.">
    <line x1="14" y1="92" x2="340" y2="92" stroke="#5ad7ff" stroke-width="1" opacity="0.5"/>
    <g stroke="#5ad7ff" stroke-width="0.6" opacity="0.14"><line x1="14" y1="61" x2="340" y2="61"/><line x1="14" y1="30" x2="340" y2="30"/></g>
    ${bars}${peakLab}${axis}</svg>`;
}

const weekHours = {
  id: 'week-hours',
  title: 'FOCUS BY TIME OF DAY',
  render(d) { return d.sessions.length ? hourChart(d) : empty('NOTHING LOGGED THIS WEEK'); },
};

// ---------- Month ----------

const monthWeeks = {
  id: 'month-weeks',
  title: 'WEEK BY WEEK',
  render(d) {
    // Monday-start weeks, clipped to the month ("OCT 1–4", "OCT 5–11", …).
    const rows = [];
    let a = new Date(d.period.start);
    while (a < d.period.end) {
      let b = addDays(a, 1);
      while (b < d.period.end && b.getDay() !== 1) b = addDays(b, 1);
      const list = d.sessions.filter((s) => { const t = Date.parse(s.started_at); return t >= a && t < b; });
      rows.push({ a, b: addDays(b, -1), list, ms: sumMs(d, list) });
      a = b;
    }
    const max = Math.max(1, ...rows.map((r) => r.ms));
    const now = new Date(d.now);
    return rows.map((r) => {
      const cur = now >= r.a && now < addDays(r.b, 1);
      const future = r.a > now;
      const lab = `${MON[r.a.getMonth()]} ${r.a.getDate()}${r.b.getDate() !== r.a.getDate() ? `–${r.b.getDate()}` : ''}`;
      return `<div class="brow tight${future ? ' future' : ''}"><div class="lab"><div class="a${cur ? ' accent' : ''}">${lab}</div></div>
        <div class="bar${cur ? ' amber' : ''}"><div style="width:${Math.round((r.ms / max) * 100)}%"></div></div>
        <div class="val${cur ? ' accent' : ''}">${future ? '—' : fmtHM(r.ms)}</div></div>`;
    }).join('');
  },
};

/** Calendar heat map: level 0–4 by focus that day; today outlined in the accent; future dashed. */
const LEVELS = [0, 0.1, 0.25, 0.4, 0.62];
const levelOf = (ms) => (ms <= 0 ? 0 : ms < 45 * MIN ? 1 : ms < 90 * MIN ? 2 : ms < 150 * MIN ? 3 : 4);
const monthHeat = {
  id: 'month-heat',
  title: 'DAY HEAT MAP',
  render(d) {
    const days = byDay(d);
    const first = (d.period.start.getDay() + 6) % 7; // Monday = 0
    const nDays = days.size;
    const rows = Math.ceil((first + nDays) / 7);
    const today = startOfDay(new Date(d.now)).getTime();
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => `<text x="${36 + 47 * i}" y="10" text-anchor="middle" class="svg-mono" font-size="9" letter-spacing="1" fill="#8fa7bd">${l}</text>`).join('');
    let i = 0;
    for (const [k, e] of days) {
      const pos = first + i++;
      const x = 15 + 47 * (pos % 7);
      const y = 16 + 25 * Math.floor(pos / 7);
      const day = new Date(k).getDate();
      const lv = levelOf(e.ms);
      if (k > today) {
        cells += `<rect x="${x}" y="${y}" width="42" height="21" rx="3" fill="none" stroke="#8fa7bd" stroke-width="0.8" stroke-dasharray="2 2.5" opacity="0.35"/>`
          + `<text x="${x + 21}" y="${y + 14}" text-anchor="middle" class="svg-mono" font-size="9.5" fill="#8fa7bd" opacity="0.5">${day}</text>`;
        continue;
      }
      const isToday = k === today;
      cells += `<rect x="${x}" y="${y}" width="42" height="21" rx="3" fill="#5ad7ff" fill-opacity="${LEVELS[lv]}" stroke="${isToday ? 'var(--accent)' : '#5ad7ff'}" stroke-width="${isToday ? 1.4 : 0.8}" stroke-opacity="${isToday ? 1 : (0.25 + lv * 0.12).toFixed(2)}"/>`
        + `<text x="${x + 21}" y="${y + 14}" text-anchor="middle" class="svg-mono" font-size="9.5" font-weight="500" fill="${isToday ? 'var(--accent)' : '#cfeeff'}" opacity="${lv ? 0.95 : 0.6}">${day}</text>`;
    }
    const h = 16 + rows * 25;
    const legend = LEVELS.map((o, j) => `<rect x="${246 + j * 15}" y="${h + 2}" width="11" height="8" rx="2" fill="#5ad7ff" fill-opacity="${o}" stroke="#5ad7ff" stroke-width="0.6" stroke-opacity="${0.25 + j * 0.12}"/>`).join('');
    return `<svg class="chart" viewBox="0 0 354 ${h + 14}" role="img" aria-label="Heat map of the month, brighter cyan means more focus that day.">${cells}
      <text x="240" y="${h + 9.5}" text-anchor="end" class="svg-mono" font-size="8.5" fill="#8fa7bd">LESS</text>${legend}<text x="322" y="${h + 9.5}" class="svg-mono" font-size="8.5" fill="#8fa7bd">MORE</text></svg>`;
  },
};

const monthStats = {
  id: 'month-stats',
  title: 'ACTIVE DAYS · BEST DAY · STREAK',
  render(d) {
    const days = [...byDay(d)];
    const today = startOfDay(new Date(d.now)).getTime();
    const elapsedDays = days.filter(([k]) => k <= today).length;
    const active = days.filter(([, e]) => e.ms > 0).length;
    const best = days.reduce((b, x) => (x[1].ms > b[1].ms ? x : b), [0, { ms: 0 }]);
    const streak = currentStreak(d.all, new Date(d.now));
    return `<div class="stats3">
      <div class="stat"><div class="label">ACTIVE</div><div class="v">${active}<small> / ${elapsedDays}</small></div><div class="s">DAYS</div></div>
      <div class="stat"><div class="label">BEST DAY</div><div class="v">${best[1].ms ? fmtHShort(best[1].ms) : '—'}</div><div class="s">${best[1].ms ? `${MON[new Date(best[0]).getMonth()]} ${new Date(best[0]).getDate()}` : '&nbsp;'}</div></div>
      <div class="stat amber"><div class="label">STREAK</div><div class="v">${streak}</div><div class="s">BEST ${bestStreak(d.all)}</div></div>
    </div>`;
  },
};

// ---------- Year ----------

function byMonth(d) {
  const out = Array.from({ length: 12 }, () => ({ ms: 0, n: 0 }));
  for (const s of d.sessions) { const m = new Date(s.started_at).getMonth(); out[m].ms += d.elapsed(s); out[m].n++; }
  return out;
}

const yearChart = {
  id: 'year-hours',
  title: 'HOURS BY MONTH',
  render(d) {
    const ms = byMonth(d);
    const max = Math.max(HOUR, ...ms.map((m) => m.ms));
    const now = new Date(d.now);
    const curM = d.period.start.getFullYear() === now.getFullYear() ? now.getMonth() : -1;
    const isFuture = (i) => d.period.start.getFullYear() > now.getFullYear() || (curM >= 0 && i > curM);
    let g = '';
    ms.forEach((m, i) => {
      const x = +(12 + 27.8 * i).toFixed(1);
      const L = 'JFMAMJJASOND'[i];
      g += `<text x="${x + 9}" y="113" text-anchor="middle" class="svg-mono" font-size="8.5" letter-spacing="0.6" fill="${i === curM ? 'var(--accent)' : '#8fa7bd'}">${L}</text>`;
      if (!m.ms || isFuture(i)) { g += `<rect x="${x}" y="98.8" width="18" height="1.2" fill="#8fa7bd" opacity="0.35"/>`; return; }
      const h = Math.max(3, (m.ms / max) * 70);
      const y = (100 - h).toFixed(1);
      const c = i === curM ? 'var(--accent)' : '#5ad7ff';
      g += `<rect x="${x}" y="${y}" width="18" height="${h.toFixed(1)}" fill="${c}" opacity="0.26"/>`
        + `<path d="M${x} 100V${y}H${(x + 18).toFixed(1)}V100" fill="none" stroke="${c}" stroke-width="0.9" opacity="0.85"/>`
        + `<rect x="${x}" y="${y}" width="18" height="1.8" fill="${c}" filter="url(#glow)"/>`
        + `<text x="${x + 9}" y="${(+y - 6).toFixed(1)}" text-anchor="middle" font-family="Chakra Petch" font-size="11" font-weight="600" fill="${i === curM ? 'var(--accent)' : '#6fe6ff'}">${Math.round(m.ms / HOUR)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 350 118" role="img" aria-label="Hours focused per month: ${ms.map((m, i) => `${MON[i]} ${Math.round(m.ms / HOUR)}`).join(', ')}.">
      <line x1="6" y1="100" x2="344" y2="100" stroke="#5ad7ff" stroke-width="1" opacity="0.5"/>
      <g stroke="#5ad7ff" stroke-width="0.6" opacity="0.14"><line x1="6" y1="65" x2="344" y2="65"/><line x1="6" y1="30" x2="344" y2="30"/></g>${g}</svg>`;
  },
};

/** Hours per tag for the period, longest first, each bar in its tag's color. */
const tagBreakdown = {
  id: 'tag-hours',
  title: 'HOURS BY TAG',
  render(d) {
    const by = new Map();
    for (const s of d.sessions) {
      const e = by.get(s.tag_id) || { ms: 0, n: 0 };
      e.ms += d.elapsed(s); e.n++;
      by.set(s.tag_id, e);
    }
    if (!by.size) return empty('NOTHING LOGGED YET');
    const rows = [...by].sort((a, b) => b[1].ms - a[1].ms);
    const max = rows[0][1].ms || 1;
    const total = rows.reduce((a, [, e]) => a + e.ms, 0) || 1;
    return rows.map(([id, e]) => {
      const t = d.tags.get(id);
      const color = t?.color || '#8fa7bd';
      return `<div class="brow tight tagrow-bar">
        <div class="lab tag">${starIcon(color, 60, { box: 18 })}<span class="a">${esc(t?.name || 'Untagged')}</span></div>
        <div class="bar"><div style="width:${Math.round((e.ms / max) * 100)}%;background:${color};box-shadow:0 0 10px ${color}"></div></div>
        <div class="val">${fmtHShort(e.ms)}<small> ${Math.round((e.ms / total) * 100)}%</small></div></div>`;
    }).join('');
  },
};

/** Cards per scope, in display order. Add new metric cards here. */
export const CARDS = {
  day: [daySessions],
  week: [weekDays, weekHours],
  month: [monthHeat, monthWeeks, monthStats],
  year: [yearChart, tagBreakdown],
};

