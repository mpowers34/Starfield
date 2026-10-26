// screens/data.js — Day / Week / Month / Year. Same layout for all four; only the scale changes.
// Header (prev/next, period label, total, hex badge) → star grid → MISSION DATA cards →
// tag filter chips → tab bar.

import { period, fmtHM, fmtDayLabel, MON, MON_LONG, addDays, MIN, esc } from '../util.js';
import { renderGrid, chipStar } from '../stars.js';
import { CARDS } from '../metrics.js';
import { ICONS, onSwipe } from '../ui.js';
import * as sessionEditor from '../sessionEditor.js';

const SCOPES = ['day', 'week', 'month', 'year'];

function periodLabel(p, offset) {
  const s = p.start;
  const e = addDays(p.end, -1);
  if (p.scope === 'day') return fmtDayLabel(s);
  if (p.scope === 'week') {
    const range = s.getMonth() === e.getMonth()
      ? `${MON[s.getMonth()]} ${s.getDate()}–${e.getDate()}`
      : `${MON[s.getMonth()]} ${s.getDate()}–${MON[e.getMonth()]} ${e.getDate()}`;
    return offset === 0 ? `THIS WEEK · ${range}` : offset === -1 ? `LAST WEEK · ${range}` : range;
  }
  if (p.scope === 'month') return `${MON_LONG[s.getMonth()]} ${s.getFullYear()}`;
  return offset === 0 ? `${s.getFullYear()} · YEAR TO DATE` : `${s.getFullYear()}`;
}

/** Thin amber arc under the Day total showing progress toward the daily goal (Settings › Missions). */
function goalArc(ms, goalMin) {
  if (!goalMin) return '';
  const f = Math.min(1, ms / (goalMin * MIN));
  // A shallow arc from (6,12) to (154,12) bowing up to y=2; length ≈ 150.
  const L = 150.6;
  const pct = Math.round(f * 100);
  return `<svg class="goal-arc" width="160" height="16" viewBox="0 0 160 16" role="img" aria-label="Daily goal ${pct}% of ${fmtHM(goalMin * MIN)}">
    <path d="M6 13 Q80 1 154 13" fill="none" stroke="rgba(143,167,189,0.3)" stroke-width="1"/>
    <path d="M6 13 Q80 1 154 13" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="${(L * f).toFixed(1)} ${L}" ${f >= 1 ? 'filter="url(#glow)"' : ''}/>
  </svg>`;
}

export function render(root, ctx) {
  const { storage, ui } = ctx;
  const now = Date.now();
  const scope = ui.scope;
  const p = period(scope, new Date(now), ui.offset);
  const tags = new Map(storage.listTags({ includeDeleted: true }).map((t) => [t.id, t]));
  const visibleTags = storage.listTags();
  const inPeriod = storage.listSessions({ from: p.start, to: p.end });
  const shown = inPeriod.filter((s) => !ui.hidden.has(s.tag_id));
  const elapsed = (s) => storage.sessionElapsed(s, now);
  const total = shown.reduce((a, s) => a + elapsed(s), 0);
  const isCurrent = ui.offset === 0;
  const accent = ctx.accent();
  const set = storage.getSettings();

  // Close the session editor if you've moved to another day or view.
  if (sessionEditor.isEditing() && (scope !== 'day' || sessionEditor.editor.dayStart !== p.start.getTime())) sessionEditor.close();
  const d = {
    period: p, sessions: shown, tags, elapsed, now, isCurrent,
    editor: sessionEditor.editor, renderEditor: () => sessionEditor.renderEditor(storage),
    all: storage.listSessions({ includeActive: false }).filter((s) => !ui.hidden.has(s.tag_id)),
  };
  const cards = CARDS[scope];
  const cardsHTML = cards.map((c) => `<div class="card"><div class="label-cyan">${c.title}</div>${c.render(d)}</div>`).join('');

  const gridLabel = `${p.scope} as a grid of slots in space. ${shown.length} star${shown.length === 1 ? '' : 's'} earned, one per focus session.`;
  const sc = root.querySelector('.scroll');
  const keep = sc && root.dataset.view === `${scope}|${ui.offset}` ? sc.scrollTop : 0;
  const chipsLeft = root.querySelector('.chips')?.scrollLeft || 0;

  root.dataset.view = `${scope}|${ui.offset}`;
  root.innerHTML = `
  <div class="period-head">
    <button type="button" class="btn-square" data-act="prev" aria-label="Previous ${scope}">${ICONS.back}</button>
    <div class="mid">
      <div class="label">${periodLabel(p, ui.offset)}</div>
      <div class="row">
        <div class="total">${fmtHM(total)}</div>
      </div>
      ${scope === 'day' ? goalArc(total, set.daily_goal_minutes) : ''}
    </div>
    <button type="button" class="btn-square" data-act="next" ${isCurrent ? 'disabled aria-label="Next, unavailable"' : `aria-label="Next ${scope}"`}>${ICONS.next}</button>
  </div>
  <div class="grid-wrap">${renderGrid({ scope, key: p.key, sessions: placementOrder(inPeriod), tags, hidden: ui.hidden, accent, now, label: gridLabel })}</div>
  <div class="mission">
    <div class="mission-head"><div class="label">MISSION DATA</div><div class="label">DISPLAYING: ${cards.length} METRIC${cards.length === 1 ? '' : 'S'}</div></div>
    <div class="scroll">${cardsHTML}</div>
  </div>
  <div class="foot">
    <div class="label">FILTER · TAP TO TOGGLE</div>
    <div class="chips" role="group" aria-label="Filter by tag">${visibleTags.map((t) => {
      const on = !ui.hidden.has(t.id);
      return `<button type="button" class="chip filter" data-filter="${t.id}" aria-pressed="${on}" style="border-color:${t.color};background:${t.color}1f">${chipStar(t.color)}${esc(t.name)}</button>`;
    }).join('')}</div>
    <nav class="tabbar" aria-label="Views">
      <button type="button" class="timer" data-act="timer">Timer</button>
      ${SCOPES.map((s) => `<button type="button" data-scope="${s}" ${s === scope ? 'aria-current="page"' : ''}>${s[0].toUpperCase()}${s.slice(1)}</button>`).join('')}
    </nav>
  </div>`;

  const nsc = root.querySelector('.scroll');
  if (nsc) nsc.scrollTop = keep;
  const ch = root.querySelector('.chips');
  if (ch) ch.scrollLeft = chipsLeft;

  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (sessionEditor.handleClick(e, ctx, p.start.getTime())) return;
    if (b.dataset.filter) { ctx.toggleHidden(b.dataset.filter); return; }
    if (b.dataset.scope) { ctx.go('data', { scope: b.dataset.scope }); return; }
    switch (b.dataset.act) {
      case 'prev': ctx.go('data', { offset: ui.offset - 1 }); break;
      case 'next': if (ui.offset < 0) ctx.go('data', { offset: ui.offset + 1 }); break;
      case 'timer': ctx.go('timer'); break;
      default: break;
    }
  };
  root.oninput = sessionEditor.handleInput;
  attachSwipe(root.querySelector('.grid-wrap'), ctx);
}

/**
 * Stars take grid slots in the order sessions were CREATED, not by start time. So adding a
 * forgotten session or editing a start time never shuffles the stars already on the grid;
 * the new one simply takes the next free slot.
 */
function placementOrder(list) {
  const key = (s) => s.created_at || s.started_at;
  return [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/**
 * Swipe across the grid to move along the tab bar: right → one tab left (Year → Month → Week →
 * Day → Timer), left → one tab right (Day → Week → Month → Year). To move within a scope
 * (e.g. 2026 → 2025), use the arrows at the top.
 */
function attachSwipe(el, ctx) {
  onSwipe(el, (dir) => {
    const i = SCOPES.indexOf(ctx.ui.scope) + (dir === 'right' ? -1 : 1);
    if (i < 0) ctx.go('timer');
    else if (i < SCOPES.length) ctx.go('data', { scope: SCOPES[i] });
  });
}
