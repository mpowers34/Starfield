// screens/settings.js — Timer, Tags, Missions, Look, Data & Sync.
// Every control writes through storage.setSetting / saveTag / reorderTags, so settings are part
// of the same event log and will sync like everything else.
//
// No modal dialogs anywhere: Erase uses tap-twice-to-confirm, tag edits happen inline.

import { fmtHM, HOUR, MIN, esc } from '../util.js';
import { starIcon } from '../stars.js';
import { TAG_COLORS } from '../storage.js';
import { ICONS, showToast } from '../ui.js';
import { loadDemo } from '../demo.js';
import { APP_VERSION } from '../version.js';

const ACCENTS = ['#ffb84a', '#5ad7ff', '#ff9db8', '#8be9a8'];
const LENGTHS = [25, 45, 60, 90];
let editing = null; // tag id whose inline editor is open
let focusEditor = false; // focus the name field once, right after the editor opens
let eraseArmed = false;
let eraseTimer = null;

const sw = (key, on, label) => `<button type="button" class="switch" role="switch" data-switch="${key}" aria-checked="${!!on}" aria-label="${label}"></button>`;
const row = (name, sub, control, last = false) => `<div class="srow${last ? ' last' : ''}"><div class="grow"><div class="name">${name}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${control}</div>`;

export function render(root, ctx) {
  const { storage } = ctx;
  const s = storage.getSettings();
  const tags = storage.listTags();
  const keep = root.querySelector('.scroll')?.scrollTop || 0;
  const hoursByTag = new Map();
  for (const x of storage.listSessions({ includeActive: false })) hoursByTag.set(x.tag_id, (hoursByTag.get(x.tag_id) || 0) + storage.sessionElapsed(x));

  const tagRows = tags.map((t, i) => {
    const ms = hoursByTag.get(t.id) || 0;
    const editor = editing === t.id ? `
      <div class="tag-edit" data-editor="${t.id}">
        ${TAG_COLORS.map((c) => `<button type="button" class="swatch" data-tagcolor="${c}" aria-pressed="${c === t.color}" aria-label="Color ${c}" style="border-color:${c === t.color ? c : ''}"><i style="background:${c}"></i></button>`).join('')}
        <button type="button" class="btn-pill danger" data-act="del-tag" style="margin-left:auto">DELETE</button>
        <button type="button" class="btn-pill" data-act="done-tag">DONE</button>
      </div>` : '';
    return `<div class="srow tagrow" data-tagrow="${t.id}" data-index="${i}">
        ${starIcon(t.color, 60)}
        <div class="grow">${editing === t.id
          ? `<div class="name"><input type="text" value="${esc(t.name)}" maxlength="20" data-tagname="${t.id}" aria-label="Tag name" enterkeyhint="done"></div>`
          : `<button type="button" data-edit="${t.id}" style="all:unset;cursor:pointer;display:block;width:100%"><div class="name">${esc(t.name)}</div></button>`}
          <div class="sub">${ms >= HOUR ? `${Math.round(ms / HOUR)}h` : fmtHM(ms)} all time</div></div>
        <button type="button" class="drag" data-drag="${t.id}" aria-label="Reorder ${esc(t.name)}">${ICONS.grip}</button>
      </div>${editor}`;
  }).join('');

  root.innerHTML = `
  <div class="period-head">
    <button type="button" class="btn-square" data-act="back" aria-label="Back to timer">${ICONS.back}</button>
    <div class="mid"><div class="header-title">Settings</div></div>
    <div style="width:48px"></div>
  </div>
  <div class="scroll" style="margin-top:4px">
    <div class="label-cyan set-group">TIMER</div>
    ${row('Default length', 'Starts every new session at this', `<div class="seg" role="group" aria-label="Default length">${LENGTHS.map((m) => `<button type="button" data-len="${m}" aria-pressed="${s.default_minutes === m && !s.count_up}">${m}</button>`).join('')}</div>`)}
    ${row('Count up instead', 'No fixed length, stop whenever', sw('count_up', s.count_up, 'Count up instead'))}
    ${row('Sound &amp; haptics at end', 'A soft chime when the countdown hits zero', sw('sound_haptics', s.sound_haptics, 'Sound and haptics at end'), true)}

    <div class="label-cyan set-group">TAGS · STARS</div>
    <div id="tag-list">${tagRows}</div>
    <button type="button" class="new-tag" data-act="new-tag">${ICONS.plus}NEW TAG</button>

    <div class="label-cyan set-group">MISSIONS</div>
    ${row('Celebrate new medals', 'Badge dot only, never a pop-up', '<span class="value-btn" style="cursor:default">Quietly</span>')}
    ${row('Daily goal', 'Shown as the amber arc on Day', `<div class="stepper"><button type="button" data-goal="-15" aria-label="Lower daily goal">−</button><span class="v">${s.daily_goal_minutes ? fmtHM(s.daily_goal_minutes * MIN) : 'OFF'}</span><button type="button" data-goal="15" aria-label="Raise daily goal">+</button></div>`, true)}

    <div class="label-cyan set-group">LOOK</div>
    ${row('Accent color', 'Active timer, today, streaks', `<div class="swatches" role="group" aria-label="Accent color">${ACCENTS.map((c) => `<button type="button" class="swatch" data-accent="${c}" aria-pressed="${s.accent === c}" aria-label="Accent ${c}" style="${s.accent === c ? `border-color:${c}` : ''}"><i style="background:${c};${s.accent === c ? `box-shadow:0 0 10px ${c}` : ''}"></i></button>`).join('')}</div>`)}
    ${row('Scanlines', 'Faint hologram texture', sw('scanlines', s.scanlines, 'Scanlines'))}
    ${row('Reduce motion', 'Stops the radar sweep and spinning rings', sw('reduce_motion', s.reduce_motion, 'Reduce motion'), true)}

    <div class="label-cyan set-group">DATA &amp; SYNC</div>
    ${row('Cloud sync', 'Not connected yet', '<div class="status-pill"><i></i>LOCAL ONLY</div>')}
    ${row('Saved on this device', '<span data-storage-info>Checking…</span>', '')}
    ${row('Export all data', 'Sessions, tags and settings as JSON', '<button type="button" class="btn-pill" data-act="export">EXPORT</button>')}
    ${row('Import data', 'Merges a JSON export (no duplicates)', '<button type="button" class="btn-pill" data-act="import">IMPORT</button><input type="file" accept="application/json,.json" data-import hidden>')}
    ${row('Load demo data', 'A realistic year of sessions, for trying things out', '<button type="button" class="btn-pill" data-act="demo">LOAD</button>')}
    ${row('Erase everything on this device', eraseArmed ? 'Tap again to confirm' : 'Cannot be undone', `<button type="button" class="btn-pill danger" data-act="erase">${eraseArmed ? 'TAP AGAIN' : 'ERASE'}</button>`, true)}
    <div class="version">HOLO-TABLE · VERSION ${APP_VERSION}</div>
  </div>`;

  root.querySelector('.scroll').scrollTop = keep;
  // Fill in the storage line (async). Shows how many sessions are saved, since when, and
  // whether this is the Home Screen app, which keeps its data separate from Safari.
  storage.storageInfo().then((i) => {
    const el = root.querySelector('[data-storage-info]');
    if (!el) return;
    const since = i.oldest ? ` since ${new Date(i.oldest).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
    el.textContent = `${i.sessions} session${i.sessions === 1 ? '' : 's'}${since} · ${i.standalone ? 'Home Screen app' : 'browser tab (separate from the Home Screen app)'}${i.persisted ? ' · protected' : ''}`;
  });
  const input = root.querySelector('[data-tagname]');
  if (input && focusEditor) { focusEditor = false; input.focus(); input.select(); }

  root.onclick = (e) => onClick(e, ctx);
  root.onchange = (e) => onChange(e, ctx);
  root.onkeydown = (e) => { if (e.key === 'Enter' && e.target.dataset.tagname) { commitName(e.target, ctx); editing = null; ctx.rerender(); } };
  root.onfocusout = (e) => { if (e.target.dataset.tagname) commitName(e.target, ctx); };
  wireDrag(root, ctx);
}

/** Save the name if it changed. Doesn't close the editor (so a tap on a color still lands). */
function commitName(input, ctx) {
  const t = ctx.storage.getTag(input.dataset.tagname);
  const name = input.value.trim();
  if (t && name && name !== t.name) ctx.storage.saveTag({ id: t.id, name, color: t.color });
}

function onClick(e, ctx) {
  const { storage } = ctx;
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.len) { storage.setSetting('count_up', false); storage.setSetting('default_minutes', +d.len); return; }
  if (d.switch) { storage.setSetting(d.switch, !storage.getSettings()[d.switch]); return; }
  if (d.accent) { storage.setSetting('accent', d.accent); return; }
  if (d.goal) { storage.setSetting('daily_goal_minutes', Math.max(0, Math.min(16 * 60, storage.getSettings().daily_goal_minutes + +d.goal))); return; }
  if (d.edit) { editing = editing === d.edit ? null : d.edit; focusEditor = !!editing; ctx.rerender(); return; }
  if (d.tagcolor) { const t = storage.getTag(editing); if (t) storage.saveTag({ id: t.id, name: t.name, color: d.tagcolor }); return; }
  switch (d.act) {
    case 'back': ctx.back(); break;
    case 'new-tag': { const t = storage.saveTag({ name: 'New tag' }); editing = t.id; focusEditor = true; ctx.rerender(); break; }
    case 'done-tag': {
      const inp = e.currentTarget.querySelector('[data-tagname]');
      if (inp) commitName(inp, ctx);
      editing = null; ctx.rerender(); break;
    }
    case 'del-tag': {
      const t = storage.getTag(editing);
      if (t) { editing = null; storage.deleteTag(t.id); showToast(`DELETED ${esc(t.name.toUpperCase())} · ITS STARS STAY`, { action: 'UNDO', onAction: () => storage.restoreTag(t.id) }); }
      break;
    }
    case 'export': exportData(ctx); break;
    case 'import': e.currentTarget.querySelector('[data-import]').click(); break;
    case 'demo': { const n = loadDemo(storage); showToast(`ADDED ${n} DEMO SESSIONS`); break; }
    case 'erase':
      if (!eraseArmed) {
        eraseArmed = true; ctx.rerender();
        clearTimeout(eraseTimer);
        eraseTimer = setTimeout(() => { eraseArmed = false; ctx.rerender(); }, 4000);
      } else {
        eraseArmed = false; clearTimeout(eraseTimer);
        storage.eraseAll().then(() => showToast('ERASED · FRESH START'));
      }
      break;
    default: break;
  }
}

async function onChange(e, ctx) {
  if (!e.target.matches('[data-import]')) return;
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const { added } = await ctx.storage.importJSON(JSON.parse(await file.text()));
    showToast(`IMPORTED ${added} EVENT${added === 1 ? '' : 'S'}`);
  } catch (err) {
    showToast(`IMPORT FAILED · ${esc(err.message).toUpperCase()}`);
  }
  e.target.value = '';
}

/** Export: on iPhone the share sheet ("Save to Files"); elsewhere a normal download. */
async function exportData(ctx) {
  const json = JSON.stringify(ctx.storage.exportJSON(), null, 1);
  const name = `holo-timer-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Drag a tag by its handle to reorder (pointer events: works with touch and mouse). */
function wireDrag(root, ctx) {
  const list = root.querySelector('#tag-list');
  if (!list) return;
  list.onpointerdown = (e) => {
    const h = e.target.closest('[data-drag]');
    if (!h) return;
    e.preventDefault();
    if (editing) { editing = null; ctx.rerender(); return; } // close the editor first; drag again
    const rows = [...list.querySelectorAll('[data-tagrow]')];
    const rowEl = h.closest('[data-tagrow]');
    const from = rows.indexOf(rowEl);
    const H = rowEl.getBoundingClientRect().height;
    const y0 = e.clientY;
    let to = from;
    rowEl.classList.add('dragging');
    h.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dy = ev.clientY - y0;
      rowEl.style.transform = `translateY(${dy}px)`;
      to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / H)));
      rows.forEach((r, i) => {
        if (r === rowEl) return;
        const shift = from < to && i > from && i <= to ? -H : from > to && i < from && i >= to ? H : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
        r.style.transition = 'transform .12s';
      });
    };
    const up = () => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      rows.forEach((r) => { r.style.transform = ''; r.style.transition = ''; });
      rowEl.classList.remove('dragging');
      if (to !== from) {
        const ids = rows.map((r) => r.dataset.tagrow);
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        ctx.storage.reorderTags(ids);
      }
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  };
}
