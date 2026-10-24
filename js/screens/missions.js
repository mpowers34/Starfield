// screens/missions.js — Completed Missions: medals grouped Streaks / Time / Sessions & Range.
// States: earned (cyan), new (amber + NEW pill), locked (dashed, with x / y progress).
// Opening this screen marks everything currently earned as seen, which clears the badge dot;
// the NEW pills stay visible for the rest of this visit so you can see what changed.

import { computeMedals } from '../missions.js';
import { MON } from '../util.js';
import { ICONS } from '../ui.js';

const HEX = 'M24 2 44 13.5v27L24 52 4 40.5v-27Z';

function hexIcon(m) {
  const small = m.glyph.length >= 3;
  const ty = small ? 32.0 : 33.1;
  const fs = small ? 14 : 17;
  if (m.state === 'locked') {
    return `<svg width="46" height="52" viewBox="0 0 48 54" aria-hidden="true"><path d="${HEX}" fill="none" stroke="rgba(143,167,189,0.6)" stroke-width="1.4" stroke-dasharray="3 3"/><text x="24" y="${ty}" text-anchor="middle" font-family="Chakra Petch" font-size="${fs}" font-weight="600" fill="#6c7f92">${m.glyph}</text></svg>`;
  }
  const isNew = m.state === 'new';
  return `<svg width="46" height="52" viewBox="0 0 48 54" aria-hidden="true"><path d="${HEX}" fill="${isNew ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'rgba(90,215,255,0.08)'}" stroke="${isNew ? 'var(--accent)' : '#5ad7ff'}" stroke-width="${isNew ? 2 : 1.6}"/><text x="24" y="${ty}" text-anchor="middle" font-family="Chakra Petch" font-size="${fs}" font-weight="600" fill="${isNew ? 'var(--accent)' : '#6fe6ff'}">${m.glyph}</text></svg>`;
}

function right(m) {
  if (m.state === 'new') return '<span class="pill">NEW</span>';
  if (m.state === 'earned') return `<div class="when">${MON[m.earned_at.getMonth()]} ${m.earned_at.getDate()}</div>`;
  const pct = Math.round((m.have / m.goal) * 100);
  return `<div class="prog"><div class="n">${m.have} / ${m.goal}</div><div class="bar"><div style="width:${pct}%"></div></div></div>`;
}

let visitNew = new Set(); // medals that were NEW when this screen was opened

/** Called by app.js each time the screen is opened. */
export function onEnter(ctx) {
  const { storage } = ctx;
  const medals = computeMedals(storage);
  visitNew = new Set(medals.filter((m) => m.state === 'new').map((m) => m.id));
  const ids = medals.filter((m) => m.state !== 'locked').map((m) => m.id);
  if (visitNew.size) storage.setSetting('missions_seen', ids); // clears the badge dot
}

export function render(root, ctx) {
  const { storage } = ctx;
  const medals = computeMedals(storage).map((m) => (m.state === 'earned' && visitNew.has(m.id) ? { ...m, state: 'new' } : m));
  const earned = medals.filter((m) => m.state !== 'locked');
  const groups = [...new Set(medals.map((m) => m.group))];
  const body = groups.map((g) => `<div class="label-cyan group-label">${g}</div>`
    + medals.filter((m) => m.group === g).map((m) => `
      <div class="medal ${m.state}" role="listitem" aria-label="${m.name}: ${m.state === 'locked' ? `locked, ${m.have} of ${m.goal}` : m.state === 'new' ? 'newly earned' : 'earned'}">
        ${hexIcon(m)}
        <div style="flex:1;min-width:0"><div class="name">${m.name}</div><div class="sub">${m.desc}</div></div>
        ${right(m)}
      </div>`).join('')).join('');

  root.innerHTML = `
  <div class="period-head">
    <button type="button" class="btn-square" data-act="back" aria-label="Back">${ICONS.back}</button>
    <div class="mid">
      <div class="label">COMPLETED MISSIONS</div>
      <div class="total" style="margin-top:2px">${earned.length} <span style="font-size:20px;color:var(--dim);font-weight:500;text-shadow:none">of ${medals.length}</span></div>
    </div>
    <div style="width:48px"></div>
  </div>
  <div class="scroll" role="list" style="margin-top:8px">${body}</div>`;

  root.onclick = (e) => { if (e.target.closest('[data-act=back]')) ctx.back(); };
}
