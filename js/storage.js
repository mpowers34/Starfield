// storage.js — the ONLY module that knows how data is persisted.
//
// Model: an append-only event log (IndexedDB "events" store). Every change the app
// makes is a new event; nothing is ever updated in place. Current state (tags,
// sessions, settings) is a projection rebuilt by folding the log in time order.
//
// Why: this is the shape that syncs cleanly later. To add Supabase, push local
// events to an `events` table and pull remote ones; merging is "union by id, then
// re-fold". Ids are UUIDs, timestamps are UTC ISO strings, fields are snake_case,
// and deletes are soft (an event that sets deleted_at).
//
// The UI calls only the exported functions below. Reads are synchronous against the
// in-memory projection (fast, never blocks a tap); writes update memory first, then
// persist in the background.

import { uuid, nowISO } from './util.js';

const DB_NAME = 'holo-timer';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;
/** Sessions shorter than this are discarded on End (Undo restores them). */
export const MIN_SESSION_MS = 2 * 60_000;

export const DEFAULT_SETTINGS = {
  default_minutes: 45,
  count_up: false,
  ask_tag_first: false,
  sound_haptics: true,
  celebrate: 'quiet', // badge dot only, never a pop-up (the only option, by design)
  daily_goal_minutes: 120,
  accent: '#ffb84a',
  scanlines: true,
  reduce_motion: false,
  last_tag_id: null,
  missions_seen: [], // medal ids already viewed; anything earned and not in here is NEW
};

/** Tag palette. Amber is deliberately absent: it is reserved for live/today/streak. */
export const TAG_COLORS = ['#5ad7ff', '#b9a2ff', '#8be9a8', '#ff9db8', '#ff9f68', '#7fa8ff', '#5ef0d0', '#e8a6ff'];

const DEFAULT_TAGS = [
  ['Review', '#5ad7ff'], ['Outline', '#b9a2ff'], ['Read', '#8be9a8'], ['French', '#ff9db8'], ['Novel', '#ff9f68'],
];

// ---------- In-memory state ----------

let db = null;
let events = []; // the full log, sorted
let deviceId = null;
let seq = 0; // per-device counter, tie-breaks events that share a millisecond
const listeners = new Set();
const state = { tags: new Map(), sessions: new Map(), settings: { ...DEFAULT_SETTINGS } };

// ---------- IndexedDB plumbing ----------

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('events')) {
        const s = d.createObjectStore('events', { keyPath: 'id' });
        s.createIndex('occurred_at', 'occurred_at');
      }
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const getAll = (store) => new Promise((resolve, reject) => {
  const r = db.transaction(store).objectStore(store).getAll();
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

// ---------- Event log ----------

const cmp = (a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1
  : (a.seq ?? 0) - (b.seq ?? 0) || (a.id < b.id ? -1 : 1));

function makeEvent(type, entityId, payload, occurredAt = nowISO()) {
  return {
    id: uuid(),
    type,
    entity_id: entityId,
    occurred_at: occurredAt,
    device_id: deviceId,
    seq: ++seq,
    schema_version: SCHEMA_VERSION,
    payload,
  };
}

/** Append events: apply to memory now, persist in the background. */
function append(evts) {
  const list = Array.isArray(evts) ? evts : [evts];
  const inOrder = !events.length || list.every((e) => cmp(events[events.length - 1], e) <= 0);
  events.push(...list);
  if (inOrder) list.forEach(applyEvent); // fast path: live actions
  else rebuild(); // back-dated events (demo data, imports)
  tx('events', 'readwrite', (s) => list.forEach((e) => s.put(e))).catch((err) => console.error('persist failed', err));
  emit();
  return list;
}

function rebuild() {
  events.sort(cmp);
  state.tags.clear();
  state.sessions.clear();
  state.settings = structuredClone(DEFAULT_SETTINGS);
  events.forEach(applyEvent);
}

/** The reducer: how each event type changes the projection. */
function applyEvent(e) {
  const p = e.payload || {};
  const S = state.sessions;
  const s = S.get(e.entity_id);
  switch (e.type) {
    case 'tag_created':
      state.tags.set(e.entity_id, { id: e.entity_id, name: p.name, color: p.color, sort_order: p.sort_order ?? state.tags.size, created_at: e.occurred_at, deleted_at: null });
      break;
    case 'tag_updated': {
      const t = state.tags.get(e.entity_id);
      if (t) Object.assign(t, p.fields);
      break;
    }
    case 'tag_deleted': {
      const t = state.tags.get(e.entity_id);
      if (t) t.deleted_at = e.occurred_at;
      break;
    }
    case 'setting_changed':
      state.settings[p.key] = p.value;
      break;
    case 'session_started':
      S.set(e.entity_id, { id: e.entity_id, tag_id: p.tag_id, planned_minutes: p.planned_minutes ?? null, started_at: p.started_at || e.occurred_at, ended_at: null, pauses: [], deleted_at: null, device_id: e.device_id });
      break;
    case 'session_logged': // a complete past session in one event (demo data, manual entry, imports from other apps)
      S.set(e.entity_id, { id: e.entity_id, tag_id: p.tag_id, planned_minutes: p.planned_minutes ?? null, started_at: p.started_at, ended_at: p.ended_at, pauses: p.pauses || [], deleted_at: null, device_id: e.device_id });
      break;
    case 'session_paused':
      if (s && !s.ended_at && !openPause(s)) s.pauses.push({ start: p.at || e.occurred_at, end: null });
      break;
    case 'session_resumed': {
      const op = s && openPause(s);
      if (op) op.end = p.at || e.occurred_at;
      break;
    }
    case 'session_retagged':
      if (s) s.tag_id = p.tag_id;
      break;
    case 'session_ended':
      if (s && !s.ended_at) {
        const op = openPause(s);
        if (op) op.end = p.ended_at; // ending while paused closes the pause
        s.ended_at = p.ended_at || e.occurred_at;
        if (p.discarded) s.deleted_at = s.ended_at;
      }
      break;
    case 'session_reopened': // Undo End: the session keeps running from its original start
      if (s) { s.ended_at = null; s.deleted_at = null; const lp = s.pauses[s.pauses.length - 1]; if (lp && lp.end === p.ended_at) lp.end = null; }
      break;
    case 'session_deleted':
      if (s) s.deleted_at = e.occurred_at;
      break;
    default:
      // Unknown types (from a newer app version) are kept in the log and ignored here.
      break;
  }
}

const openPause = (s) => s.pauses.find((x) => !x.end) || null;

function emit() { listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } }); }

// ---------- Public API ----------

export async function init() {
  db = await openDB();
  const meta = await getAll('meta');
  deviceId = meta.find((m) => m.key === 'device_id')?.value;
  if (!deviceId) {
    deviceId = uuid();
    await tx('meta', 'readwrite', (s) => s.put({ key: 'device_id', value: deviceId }));
  }
  events = await getAll('events');
  seq = events.reduce((mx, e) => (e.device_id === deviceId ? Math.max(mx, e.seq || 0) : mx), 0);
  rebuild();
  if (!state.tags.size) seedDefaults();
}

function seedDefaults() {
  const at = nowISO();
  append(DEFAULT_TAGS.map(([name, color], i) => makeEvent('tag_created', uuid(), { name, color, sort_order: i, seeded: true }, at)));
}

/** Call fn whenever data changes. Returns an unsubscribe function. */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ----- Sessions -----

/** Focused milliseconds: (end or now) − start − paused time. Never a stored counter. */
export function sessionElapsed(s, now = Date.now()) {
  const end = s.ended_at ? Date.parse(s.ended_at) : now;
  let paused = 0;
  for (const p of s.pauses) paused += (p.end ? Date.parse(p.end) : end) - Date.parse(p.start);
  return Math.max(0, end - Date.parse(s.started_at) - paused);
}
export const isPaused = (s) => !!(s && !s.ended_at && openPause(s));

/** Non-deleted sessions whose start falls in [from, to). Sorted by start. Includes the live one. */
export function listSessions({ from = null, to = null, includeActive = true } = {}) {
  const f = from ? from.getTime() : -Infinity;
  const t = to ? to.getTime() : Infinity;
  const out = [];
  for (const s of state.sessions.values()) {
    if (s.deleted_at) continue;
    if (!includeActive && !s.ended_at) continue;
    const st = Date.parse(s.started_at);
    if (st >= f && st < t) out.push(s);
  }
  return out.sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
}

/** The running (or paused) session, if any. If two devices both started one, the newest wins. */
export function getActiveSession() {
  let best = null;
  for (const s of state.sessions.values()) {
    if (!s.ended_at && !s.deleted_at && (!best || s.started_at > best.started_at)) best = s;
  }
  return best;
}

export function startSession({ tagId, plannedMinutes }) {
  const at = nowISO();
  const id = uuid();
  const evts = [makeEvent('session_started', id, { tag_id: tagId, planned_minutes: plannedMinutes, started_at: at }, at)];
  if (tagId && tagId !== state.settings.last_tag_id) evts.push(makeEvent('setting_changed', 'last_tag_id', { key: 'last_tag_id', value: tagId }, at));
  append(evts);
  return state.sessions.get(id);
}

export function pauseSession(id) { append(makeEvent('session_paused', id, { at: nowISO() })); }
export function resumeSession(id) { append(makeEvent('session_resumed', id, { at: nowISO() })); }

/** End a session. Under MIN_SESSION_MS it is soft-deleted. Returns { session, discarded }. */
export function endSession(id) {
  const s = state.sessions.get(id);
  if (!s || s.ended_at) return { session: s, discarded: false };
  const at = nowISO();
  const discarded = sessionElapsed(s, Date.parse(at)) < MIN_SESSION_MS;
  append(makeEvent('session_ended', id, { ended_at: at, discarded }, at));
  return { session: s, discarded };
}

/** Undo an End: the session resumes as if never stopped (the gap counts as focus). */
export function reopenSession(id) {
  const s = state.sessions.get(id);
  if (!s || !s.ended_at) return;
  append(makeEvent('session_reopened', id, { ended_at: s.ended_at }));
}

export function retagSession(id, tagId) {
  const at = nowISO();
  append([
    makeEvent('session_retagged', id, { tag_id: tagId }, at),
    makeEvent('setting_changed', 'last_tag_id', { key: 'last_tag_id', value: tagId }, at),
  ]);
}

export function deleteSession(id) { append(makeEvent('session_deleted', id, {})); }

/** Bulk-add finished sessions (demo data). Each: {tag_id, started_at, ended_at, planned_minutes, pauses}. */
export function logSessions(list) {
  append(list.map((x) => makeEvent('session_logged', uuid(), x, x.ended_at)));
}

// ----- Tags -----

export function listTags({ includeDeleted = false } = {}) {
  return [...state.tags.values()].filter((t) => includeDeleted || !t.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
}
export const getTag = (id) => state.tags.get(id) || null;

/** Create (no id) or update (with id) a tag. Returns the tag. */
export function saveTag({ id, name, color }) {
  if (id && state.tags.has(id)) {
    append(makeEvent('tag_updated', id, { fields: { name, color } }));
    return state.tags.get(id);
  }
  const nid = uuid();
  const used = new Set(listTags().map((t) => t.color));
  const c = color || TAG_COLORS.find((x) => !used.has(x)) || TAG_COLORS[state.tags.size % TAG_COLORS.length];
  append(makeEvent('tag_created', nid, { name, color: c, sort_order: Math.max(-1, ...[...state.tags.values()].map((t) => t.sort_order)) + 1 }));
  return state.tags.get(nid);
}

export function reorderTags(ids) {
  const at = nowISO();
  append(ids.map((id, i) => makeEvent('tag_updated', id, { fields: { sort_order: i } }, at)));
}
export function deleteTag(id) { append(makeEvent('tag_deleted', id, {})); }
export function restoreTag(id) { append(makeEvent('tag_updated', id, { fields: { deleted_at: null } })); }

// ----- Settings -----

export const getSettings = () => state.settings;
export function setSetting(key, value) {
  if (JSON.stringify(state.settings[key]) === JSON.stringify(value)) return;
  append(makeEvent('setting_changed', key, { key, value }));
}

// ----- Export / import / erase -----

export function exportJSON() {
  return { app: 'holo-timer', schema_version: SCHEMA_VERSION, exported_at: nowISO(), device_id: deviceId, events: [...events] };
}

/** Merge an export into this device. Events already present (same id) are skipped. */
export async function importJSON(data) {
  if (!data || !Array.isArray(data.events)) throw new Error('Not a Holo-Timer export');
  const have = new Set(events.map((e) => e.id));
  const fresh = data.events.filter((e) => e && e.id && e.type && e.occurred_at && !have.has(e.id));
  // A fresh install seeds 5 default tags. If nothing else has happened on this device yet,
  // drop those so importing a backup doesn't leave duplicate "Review", "Outline", … tags.
  const pristine = fresh.some((e) => e.type === 'tag_created') && !state.sessions.size
    && events.every((e) => (e.type === 'tag_created' && e.payload?.seeded) || e.type === 'setting_changed');
  if (pristine) {
    const seedIds = events.filter((e) => e.payload?.seeded).map((e) => e.id);
    events = events.filter((e) => !e.payload?.seeded);
    await tx('events', 'readwrite', (st) => seedIds.forEach((id) => st.delete(id)));
    rebuild();
  }
  if (fresh.length) append(fresh);
  return { added: fresh.length, skipped: data.events.length - fresh.length };
}

export async function eraseAll() {
  events = [];
  await tx('events', 'readwrite', (s) => s.clear());
  rebuild();
  seedDefaults();
}

/** For debugging in the console: window.holo.storage.debug() */
export const debug = () => ({ deviceId, eventCount: events.length, state });
