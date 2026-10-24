// util.js — small shared helpers: ids, time math, calendar keys, seeded randomness.
// Everything here is pure (no DOM, no storage), so it is easy to test and reuse.

/** RFC 4122 v4 UUID. crypto.randomUUID needs a secure context, so fall back if missing. */
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowISO = () => new Date().toISOString();
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// ---------- Formatting ----------

/** 7140000 ms -> "1h 59m"; under an hour -> "24m". */
export function fmtHM(ms, { zero = '0m' } = {}) {
  const m = Math.floor(ms / MIN);
  if (m <= 0) return zero;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
}

/** Short total for tight spots: "22h", "45m". */
export function fmtHShort(ms) {
  const m = Math.round(ms / MIN);
  return m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
}

/** 1458000 ms -> "24:18"; over an hour -> "1:04:18". */
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

/** Date -> "2:00 PM". */
export function fmtTime(d, { suffix = true } = {}) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return suffix ? `${h}:${m} ${ap}` : `${h}:${m}`;
}

/** "9:05 – 9:50 AM" or "11:30 AM – 12:15 PM". */
export function fmtRange(a, b) {
  const sameHalf = (a.getHours() >= 12) === (b.getHours() >= 12);
  return sameHalf ? `${fmtTime(a, { suffix: false })} – ${fmtTime(b)}` : `${fmtTime(a)} – ${fmtTime(b)}`;
}

export const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const DOW_LONG = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
export const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const MON_LONG = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** "THURSDAY · OCT 22" */
export const fmtDayLabel = (d) => `${DOW_LONG[d.getDay()]} · ${MON[d.getMonth()]} ${d.getDate()}`;

// ---------- Calendar (all in the device's local time zone) ----------

export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
/** Weeks start on Monday, matching the mock-ups. */
export function startOfWeek(d) { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }
export function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** ISO-8601 week key, e.g. "2026-W43". ISO weeks also start Monday. */
export function weekKey(d) {
  const t = startOfDay(d);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // Thursday of this week decides the year
  const firstThu = new Date(t.getFullYear(), 0, 4);
  const wk = 1 + Math.round(((t - firstThu) / DAY - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${pad(wk)}`;
}

/**
 * A period is { scope, start, end, key }, end exclusive.
 * scope: 'day' | 'week' | 'month' | 'year'. offset moves by whole periods (-1 = previous).
 */
export function period(scope, ref = new Date(), offset = 0) {
  let start;
  let end;
  if (scope === 'day') { start = addDays(startOfDay(ref), offset); end = addDays(start, 1); }
  else if (scope === 'week') { start = addDays(startOfWeek(ref), 7 * offset); end = addDays(start, 7); }
  else if (scope === 'month') { const m = startOfMonth(ref); start = new Date(m.getFullYear(), m.getMonth() + offset, 1); end = new Date(start.getFullYear(), start.getMonth() + 1, 1); }
  else { start = new Date(ref.getFullYear() + offset, 0, 1); end = new Date(start.getFullYear() + 1, 0, 1); }
  const key = scope === 'day' ? dayKey(start)
    : scope === 'week' ? weekKey(start)
      : scope === 'month' ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}`
        : `${start.getFullYear()}`;
  return { scope, start, end, key };
}

// ---------- Seeded randomness (for deterministic star placement and demo data) ----------

/** Hash a string to a 32-bit seed (cyrb53, folded). */
export function hashSeed(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

/** mulberry32 PRNG: returns a function producing floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle of [0..n-1] using a seeded PRNG. */
export function seededShuffle(n, seedStr) {
  const r = rng(hashSeed(seedStr));
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
