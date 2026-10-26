// sessionEditor.js — add and correct sessions from the Day view (no pop-ups: the editor opens
// inline, under the session you tap).
//
// You can change a session's tag, start and end time, or delete it (with Undo). "+ ADD SESSION"
// logs one you forgot to time. Rules: it must be in the past, at least 1 minute long, at most
// 16 hours, and can't overlap another session (that would count the same time twice).
// A live session can have its tag and start time changed; its end is "now".

import { fmtHM, fmtRange, fmtTime, startOfDay, addDays, MIN, HOUR, esc } from './util.js';
import { chipStar } from './stars.js';
import { showToast } from './ui.js';

/** Editor state. open: session id, 'new', or null. draft: what's in the fields right now. */
export const editor = { open: null, dayStart: 0, draft: null, error: '' };

export const isEditing = () => editor.open !== null;
export function close() { editor.open = null; editor.draft = null; editor.error = ''; }

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "HH:MM" on the given day → Date. */
function atTime(dayStart, value) {
  const [h, m] = value.split(':').map(Number);
  const d = new Date(dayStart);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Turn the draft into real timestamps. An end earlier than the start means it ran past midnight. */
function resolve(draft, dayStart) {
  const start = atTime(dayStart, draft.start);
  let end = draft.live ? null : atTime(dayStart, draft.end);
  if (end && end <= start) end = addDays(end, 1);
  return { start, end };
}

function validate(storage, draft, dayStart, excludeId) {
  if (!draft.start || (!draft.live && !draft.end)) return 'Enter a start and end time';
  const { start, end } = resolve(draft, dayStart);
  const now = Date.now();
  if (start.getTime() > now) return 'Start is in the future';
  if (end && end.getTime() > now + MIN) return 'End is in the future';
  const ms = (end ? end.getTime() : now) - start.getTime();
  if (ms < MIN) return 'Must be at least 1 minute';
  if (ms > 16 * HOUR) return 'Longer than 16 hours, check the times';
  const o = storage.findOverlap(start.toISOString(), end ? end.toISOString() : null, excludeId);
  if (o) {
    const tag = storage.getTag(o.tag_id)?.name || 'another session';
    const range = o.ended_at ? fmtRange(new Date(o.started_at), new Date(o.ended_at)) : `${fmtTime(new Date(o.started_at))} – now`;
    return `Overlaps ${tag}, ${range}`;
  }
  return '';
}

function durationText(draft, dayStart) {
  if (!draft.start || (!draft.live && !draft.end)) return '';
  const { start, end } = resolve(draft, dayStart);
  const ms = (end ? end.getTime() : Date.now()) - start.getTime();
  return ms > 0 ? `= ${fmtHM(ms)}${end && end.getDate() !== start.getDate() ? ' · ends next day' : ''}` : '';
}

// ---------- Opening ----------

export function openFor(storage, session, dayStart) {
  editor.dayStart = dayStart;
  editor.open = session.id;
  editor.error = '';
  editor.draft = {
    tag: session.tag_id,
    start: hhmm(new Date(session.started_at)),
    end: session.ended_at ? hhmm(new Date(session.ended_at)) : '',
    live: !session.ended_at,
  };
}

export function openNew(storage, dayStart) {
  const set = storage.getSettings();
  const len = (set.count_up ? 45 : set.default_minutes) * MIN;
  const today = startOfDay(new Date()).getTime() === dayStart;
  let end;
  if (today) { end = new Date(Math.floor(Date.now() / (5 * MIN)) * 5 * MIN); } // now, rounded down to 5 min
  else { end = new Date(dayStart); end.setHours(9, 0, 0, 0); end = new Date(end.getTime() + len); }
  let start = new Date(end.getTime() - len);
  if (start < new Date(dayStart)) start = new Date(dayStart);
  editor.dayStart = dayStart;
  editor.open = 'new';
  editor.error = '';
  editor.draft = { tag: set.last_tag_id || storage.listTags()[0]?.id || null, start: hhmm(start), end: hhmm(end), live: false };
}

// ---------- Rendering ----------

/** The inline editor's HTML. */
export function renderEditor(storage) {
  const d = editor.draft;
  const tags = storage.listTags();
  const isNew = editor.open === 'new';
  const chips = tags.map((t) => `<button type="button" class="chip mini" data-ed-tag="${t.id}" aria-pressed="${t.id === d.tag}" style="${t.id === d.tag ? `border-color:${t.color};background:${t.color}1f` : ''}">${chipStar(t.color, 12)}${esc(t.name)}</button>`).join('');
  return `<div class="sess-editor" role="group" aria-label="${isNew ? 'Add a session' : 'Edit session'}">
    <div class="chips ed-chips" role="group" aria-label="Tag">${chips}</div>
    <div class="ed-times">
      <label><span class="label">START</span><input type="time" data-ed-field="start" value="${d.start}"></label>
      <label><span class="label">END</span>${d.live
        ? '<span class="ed-live">RUNNING</span>'
        : `<input type="time" data-ed-field="end" value="${d.end}">`}</label>
      <div class="ed-dur" data-ed-dur>${durationText(d, editor.dayStart)}</div>
    </div>
    <div class="ed-error" data-ed-error ${editor.error ? '' : 'hidden'}>${esc(editor.error)}</div>
    <div class="ed-actions">
      ${isNew ? '' : '<button type="button" class="btn-pill danger" data-ed="delete">DELETE</button>'}
      <span style="flex:1"></span>
      <button type="button" class="btn-pill ghost" data-ed="cancel">CANCEL</button>
      <button type="button" class="btn-pill solid" data-ed="save">${isNew ? 'ADD' : 'SAVE'}</button>
    </div>
  </div>`;
}

// ---------- Events (delegated from the Day view) ----------

/** Handle a click inside the Mission Data area. Returns true if it was the editor's. */
export function handleClick(e, ctx, dayStart) {
  const { storage } = ctx;
  const b = e.target.closest('button');
  if (!b) return false;
  if (b.dataset.editSession) {
    const s = storage.listSessions().find((x) => x.id === b.dataset.editSession);
    if (editor.open === b.dataset.editSession) close(); else if (s) openFor(storage, s, dayStart);
    ctx.rerender();
    return true;
  }
  if (b.dataset.act === 'add-session') { if (editor.open === 'new') close(); else openNew(storage, dayStart); ctx.rerender(); return true; }
  if (b.dataset.edTag) { editor.draft.tag = b.dataset.edTag; ctx.rerender(); return true; }
  const act = b.dataset.ed;
  if (!act) return false;
  const id = editor.open;
  if (act === 'cancel') { close(); ctx.rerender(); return true; }
  if (act === 'delete') {
    close();
    storage.deleteSession(id);
    showToast('SESSION DELETED', { action: 'UNDO', onAction: () => storage.restoreSession(id), ms: 6000 });
    return true;
  }
  if (act === 'save') {
    const d = editor.draft;
    const err = validate(storage, d, editor.dayStart, id === 'new' ? null : id);
    if (err) { editor.error = err; ctx.rerender(); return true; }
    const { start, end } = resolve(d, editor.dayStart);
    if (id === 'new') {
      storage.addSession({ tagId: d.tag, startedAt: start.toISOString(), endedAt: end.toISOString() });
      if (d.tag) storage.setSetting('last_tag_id', d.tag);
      close();
      showToast(`ADDED · ${fmtHM(end - start)}`);
    } else {
      const s = storage.listSessions().find((x) => x.id === id);
      const fields = {};
      if (s.tag_id !== d.tag) fields.tag_id = d.tag;
      if (s.started_at !== start.toISOString() && hhmm(new Date(s.started_at)) !== d.start) fields.started_at = start.toISOString();
      if (end && s.ended_at && hhmm(new Date(s.ended_at)) !== d.end) fields.ended_at = end.toISOString();
      close();
      if (Object.keys(fields).length) storage.editSession(id, fields);
      else ctx.rerender();
    }
    return true;
  }
  return false;
}

/** Typing in a time field: keep the draft and refresh the duration preview without re-rendering. */
export function handleInput(e) {
  const f = e.target.dataset.edField;
  if (!f || !editor.draft) return;
  editor.draft[f] = e.target.value;
  const root = e.target.closest('.sess-editor');
  const dur = root.querySelector('[data-ed-dur]');
  if (dur) dur.textContent = durationText(editor.draft, editor.dayStart);
  const er = root.querySelector('[data-ed-error]');
  if (er && editor.error) { editor.error = ''; er.hidden = true; }
}
