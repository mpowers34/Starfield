// screens/timer.js — the home screen: Today's Total, the hologram projector, tag chips, controls.
//
// States: idle → running ⇄ paused → (overtime, once a countdown passes zero) → ended.
// Everything shown is computed from the stored session timestamps on each tick, so a reload,
// a locked phone or another device never loses time.
//
// ADHD rules baked in: START is one tap and never blocked; the tag can be changed mid-session
// by tapping a chip; End is undoable for 5 s; no pop-ups, ever.

import { fmtHM, fmtClock, fmtTime, fmtDayLabel, startOfDay, addDays, MIN, esc, clamp } from '../util.js';
import { chipStar, starBody, starOpacity } from '../stars.js';
import { showToast } from '../ui.js';

const RING_C = 2 * Math.PI * 118; // progress ring circumference (r = 118)
let picking = false; // "Ask for a tag before starting": waiting for a chip tap
let pickTimer = null;
let chimedFor = null; // session id we already chimed for at zero
let lastText = {}; // cache to avoid touching the DOM when nothing changed

// ---------- Helpers ----------

function currentTag(ctx) {
  const { storage } = ctx;
  const tags = storage.listTags();
  const active = storage.getActiveSession();
  const id = active ? active.tag_id : storage.getSettings().last_tag_id;
  return tags.find((t) => t.id === id) || tags[0] || null;
}

function todayMs(storage, now) {
  const from = startOfDay(new Date(now));
  return storage.listSessions({ from, to: addDays(from, 1) }).reduce((a, s) => a + storage.sessionElapsed(s, now), 0);
}

/** Everything the projector shows, for a given instant. */
function model(ctx, now) {
  const { storage } = ctx;
  const set = storage.getSettings();
  const s = storage.getActiveSession();
  if (!s) {
    const planned = set.count_up ? null : set.default_minutes * MIN;
    return { mode: 'idle', s: null, elapsed: 0, planned, frac: 0 };
  }
  const elapsed = storage.sessionElapsed(s, now);
  const planned = s.planned_minutes ? s.planned_minutes * MIN : null;
  const paused = storage.isPaused(s);
  const over = planned != null && elapsed >= planned;
  const frac = planned ? clamp(elapsed / planned, 0, 1) : (elapsed % (60 * MIN)) / (60 * MIN); // count-up: one lap per hour
  return { mode: paused ? 'paused' : over ? 'overtime' : 'running', s, elapsed, planned, frac, over };
}

/** Text for the digits, the line under them, and the two readouts. */
function texts(m, ctx, now) {
  const set = ctx.storage.getSettings();
  const t = {};
  if (m.mode === 'idle') {
    t.digits = m.planned ? fmtClock(m.planned) : '00:00';
    t.of = picking ? 'PICK A TAG BELOW' : m.planned ? 'READY' : 'COUNT UP · READY';
    t.lLab = m.planned ? 'LENGTH' : 'MODE';
    t.lVal = m.planned ? `${set.default_minutes} MIN` : 'OPEN';
    t.rLab = m.planned ? 'ENDS AT' : 'DAILY GOAL';
    t.rVal = m.planned ? fmtTime(new Date(now + m.planned)) : fmtHM(set.daily_goal_minutes * MIN);
    return t;
  }
  t.digits = fmtClock(m.elapsed);
  const started = fmtTime(new Date(m.s.started_at));
  if (!m.planned) {
    t.of = m.mode === 'paused' ? 'PAUSED · COUNTING UP' : 'COUNTING UP';
    t.lLab = 'STARTED'; t.lVal = started;
    t.rLab = 'TODAY'; t.rVal = fmtHM(todayMs(ctx.storage, now));
  } else if (m.over) {
    t.of = `${m.mode === 'paused' ? 'PAUSED · ' : ''}OF ${fmtClock(m.planned)} · OVERTIME`;
    t.lLab = 'OVERTIME'; t.lVal = `+${fmtClock(m.elapsed - m.planned)}`;
    t.rLab = 'STARTED'; t.rVal = started;
  } else {
    t.of = `${m.mode === 'paused' ? 'PAUSED · ' : ''}OF ${fmtClock(m.planned)}`;
    t.lLab = 'REMAINING'; t.lVal = fmtClock(m.planned - m.elapsed + 999); // round up, like a countdown
    t.rLab = 'ENDS AT'; t.rVal = fmtTime(new Date(now + (m.planned - m.elapsed)));
  }
  return t;
}

// ---------- Rendering ----------

/** Small stars for today's finished sessions, sitting around the projector base. */
function baseStars(ctx, now) {
  const { storage } = ctx;
  const from = startOfDay(new Date(now));
  const done = storage.listSessions({ from, to: addDays(from, 1), includeActive: false });
  const tags = new Map(storage.listTags({ includeDeleted: true }).map((t) => [t.id, t]));
  // Alternate left/right around the outer base ring (rx 150, ry 24), working toward the front.
  const n = done.length;
  const small = n > 8;
  return done.slice(-12).map((s, i) => {
    // First pair sits at ±20° on the ring (the mock's 34,438 and 316,438); later ones step round the front.
    const side = i % 2 ? 1 : -1;
    const step = Math.floor(i / 2);
    const th = (step === 0 ? 20 : -15 - step * (small ? 18 : 28)) * (Math.PI / 180);
    const x = 175 + side * 150 * Math.cos(th);
    const y = 446 - 24 * Math.sin(th);
    const label = step === 0 && n <= 6; // only the first pair has room for a label underneath
    const mins = storage.sessionElapsed(s, now) / MIN;
    const sc = clamp(4 + 0.11 * mins, 5, 12) * (small ? 0.75 : 1);
    const col = tags.get(s.tag_id)?.color || '#8fa7bd';
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${sc.toFixed(1)})" opacity="${(starOpacity(mins) * 0.78).toFixed(2)}">${starBody(col)}</g>`
      + (!label ? '' : `<text x="${x.toFixed(1)}" y="${(y + 34).toFixed(1)}" text-anchor="middle" class="svg-mono" font-size="11" fill="#8fa7bd">${Math.round(mins)}m</text>`);
  }).join('');
}

function projectorSVG(m, t, tag, ctx, now) {
  const live = m.mode !== 'idle';
  const accent = live ? 'var(--accent)' : '#5ad7ff'; // amber is reserved for what's live
  const len = (RING_C * (m.over ? 1 : m.frac)).toFixed(1);
  const ang = (m.over ? 1 : m.frac) * 2 * Math.PI;
  const dot = { x: 175 + 118 * Math.sin(ang), y: 210 - 118 * Math.cos(ang) };
  const name = tag ? tag.name.toUpperCase() : 'UNTAGGED';
  const nameW = name.length * 10.6;
  const tagCol = tag ? tag.color : '#8fa7bd';
  const aria = live
    ? `Session ${m.mode}: ${t.digits} focused${m.planned ? ` of ${fmtClock(m.planned)}` : ''}, tagged ${tag ? tag.name : 'untagged'}.`
    : `Ready to start a ${t.lVal.toLowerCase()} session tagged ${tag ? tag.name : 'untagged'}.`;
  return `
<svg class="projector ${m.mode}" viewBox="0 0 350 490" role="img" aria-label="${esc(aria)}">
  <defs>
    <linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5ad7ff" stop-opacity="0.2"/><stop offset="0.6" stop-color="#5ad7ff" stop-opacity="0.05"/><stop offset="1" stop-color="#5ad7ff" stop-opacity="0"/></linearGradient>
    <pattern id="slice" width="4" height="3.4" patternUnits="userSpaceOnUse"><rect width="4" height="2.2" fill="#fff"/></pattern>
    <mask id="scan" maskUnits="userSpaceOnUse" x="0" y="0" width="350" height="490"><rect width="350" height="490" fill="url(#slice)"/></mask>
  </defs>
  <g fill="none" stroke="rgba(90,215,255,0.3)" stroke-width="1"><path d="M2 26V2H26"/><path d="M324 2H348V26"/><path d="M2 464V488H26"/><path d="M324 488H348V464"/></g>
  <g>
    <polygon points="123,446 227,446 296,214 54,214" fill="url(#beam)"/>
    <line x1="123" y1="446" x2="54" y2="214" stroke="rgba(90,215,255,0.16)" stroke-width="0.8"/>
    <line x1="227" y1="446" x2="296" y2="214" stroke="rgba(90,215,255,0.16)" stroke-width="0.8"/>
    <ellipse cx="175" cy="446" rx="150" ry="24" fill="none" stroke="rgba(90,215,255,0.3)" stroke-width="0.8"/>
    <ellipse cx="175" cy="446" rx="100" ry="16" fill="none" stroke="rgba(90,215,255,0.2)" stroke-width="0.8"/>
    <ellipse cx="175" cy="446" rx="52" ry="8" fill="rgba(90,215,255,0.06)" stroke="rgba(90,215,255,0.5)" stroke-width="0.9"/>
  </g>
  <g mask="url(#scan)">
    <g class="sweep"><path d="M175 210 L192.4 111.5 A100 100 0 0 1 269 175.8Z" fill="rgba(90,215,255,0.05)"/><line x1="175" y1="210" x2="192.4" y2="111.5" stroke="rgba(90,215,255,0.4)" stroke-width="0.8"/></g>
    <line x1="14" y1="210" x2="68" y2="210" stroke="rgba(90,215,255,0.28)" stroke-width="0.8"/>
    <line x1="282" y1="210" x2="336" y2="210" stroke="rgba(90,215,255,0.28)" stroke-width="0.8"/>
    <line x1="175" y1="22" x2="175" y2="62" stroke="rgba(90,215,255,0.28)" stroke-width="0.8"/>
    <circle cx="175" cy="210" r="140" fill="none" stroke="rgba(143,167,189,0.4)" stroke-width="3" stroke-dasharray="1.2 13.46"/>
    <circle cx="175" cy="210" r="140" fill="none" stroke="rgba(111,230,255,0.6)" stroke-width="7" stroke-dasharray="1.6 218.3"/>
    <circle cx="175" cy="210" r="118" fill="none" stroke="rgba(90,215,255,0.3)" stroke-width="0.9"/>
    <circle cx="175" cy="210" r="100" fill="none" stroke="rgba(90,215,255,0.2)" stroke-width="0.8" stroke-dasharray="2 6"/>
    <circle cx="175" cy="210" r="86" fill="none" stroke="rgba(90,215,255,0.12)" stroke-width="0.8"/>
  </g>
  <g class="ring-prog" ${live ? '' : 'opacity="0"'}>
    <circle id="t-ring-soft" cx="175" cy="210" r="118" fill="none" stroke="${accent}" stroke-width="9" stroke-dasharray="${len} ${RING_C.toFixed(1)}" transform="rotate(-90 175 210)" opacity="0.1"/>
    <g filter="url(#tglow)">
      <circle id="t-ring" cx="175" cy="210" r="118" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${len} ${RING_C.toFixed(1)}" transform="rotate(-90 175 210)" opacity="0.95"/>
      <circle id="t-dot" cx="${dot.x.toFixed(1)}" cy="${dot.y.toFixed(1)}" r="3.2" fill="#fff" opacity="0.9"/>
    </g>
  </g>
  <g transform="translate(175 165)">
    <g transform="translate(${(-nameW / 2 - 14).toFixed(1)} 0) scale(6.5)" opacity="0.9"><path d="M0 -1 .2 -.2 1 0 .2 .2 0 1 -.2 .2 -1 0 -.2 -.2Z" fill="${tagCol}"/></g>
    <text x="0" y="4.5" text-anchor="middle" class="svg-mono" font-size="13" letter-spacing="2.9" fill="${tagCol}" opacity="0.9">${esc(name)}</text>
  </g>
  <g mask="url(#scan)" class="digits">
    <text id="t-dig-ghost" x="172.5" y="232" text-anchor="middle" fill="none" stroke="#5ad7ff" stroke-width="0.8" opacity="0.55" font-family="Chakra Petch" font-weight="500" font-size="${t.digits.length > 5 ? 58 : 70}" letter-spacing="1.4">${t.digits}</text>
    <text id="t-dig" x="175" y="232" text-anchor="middle" fill="${accent}" fill-opacity="0.2" stroke="${accent}" stroke-width="1.1" filter="url(#tglow)" font-family="Chakra Petch" font-weight="500" font-size="${t.digits.length > 5 ? 58 : 70}" letter-spacing="1.4">${t.digits}</text>
  </g>
  <rect x="104" y="205" width="142" height="1.4" fill="${accent}" opacity="0.35"/>
  <text id="t-of" x="175" y="262" text-anchor="middle" class="svg-mono" font-size="13" letter-spacing="1.8" fill="${picking ? 'var(--accent)' : '#8fa7bd'}">${t.of}</text>
  <text id="t-l-lab" x="22" y="384" class="svg-mono" font-size="10.5" letter-spacing="1.5" fill="${m.over ? 'var(--accent)' : '#8fa7bd'}">${t.lLab}</text>
  <text id="t-l-val" x="22" y="406" font-family="Chakra Petch" font-size="20" font-weight="500" fill="${m.over ? 'var(--accent)' : '#6fe6ff'}" opacity="0.9">${t.lVal}</text>
  <text id="t-r-lab" x="328" y="384" text-anchor="end" class="svg-mono" font-size="10.5" letter-spacing="1.5" fill="#8fa7bd">${t.rLab}</text>
  <text id="t-r-val" x="328" y="406" text-anchor="end" font-family="Chakra Petch" font-size="20" font-weight="500" fill="#6fe6ff" opacity="0.9">${t.rVal}</text>
  ${baseStars(ctx, now)}
</svg>`;
}

const ICON = {
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9"/></svg>',
  bars: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4" height="8" rx="1" fill="currentColor"/><rect x="10" y="8" width="4" height="13" rx="1" fill="currentColor"/><rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor"/></svg>',
  chev: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="4" y="3" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="13" y="3" width="5" height="16" rx="1.5" fill="currentColor"/></svg>',
  play: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M6 3.5v15l13-7.5z" fill="currentColor"/></svg>',
  stop: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor"/></svg>',
  start: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.8v12.4L14 8z" fill="currentColor"/></svg>',
};

export function render(root, ctx) {
  const { storage } = ctx;
  const now = Date.now();
  const set = storage.getSettings();
  const m = model(ctx, now);
  const t = texts(m, ctx, now);
  const tag = currentTag(ctx);
  const tags = storage.listTags();
  const chipsScroll = root.querySelector('.chips')?.scrollLeft || 0;

  const chips = tags.map((tg) => `<button type="button" class="chip" data-tag="${tg.id}" aria-pressed="${tag && tg.id === tag.id}">${chipStar(tg.color)}${esc(tg.name)}</button>`).join('');

  const controls = m.mode === 'idle'
    ? `<button type="button" class="btn-main" data-act="start">${ICON.start}Start<span class="len">${set.count_up ? 'COUNT UP' : `${set.default_minutes}:00`}</span></button>`
    : `<button type="button" class="btn-pause" data-act="${m.mode === 'paused' ? 'resume' : 'pause'}" aria-label="${m.mode === 'paused' ? 'Resume session' : 'Pause session'}">${m.mode === 'paused' ? ICON.play : ICON.pause}</button>
       <button type="button" class="btn-main" data-act="end">${ICON.stop}End session</button>`;

  root.innerHTML = `
  <div class="top-row">
    <button type="button" class="btn-top" data-act="settings" aria-label="Open settings">${ICON.gear}SETTINGS</button>
    <button type="button" class="btn-top" data-act="data" aria-label="Open data views">${ICON.bars}DATA${ICON.chev}</button>
  </div>
  <div class="today">
    <div class="label">TODAY'S TOTAL</div>
    <div class="total" id="t-total">${fmtHM(todayMs(storage, now))}</div>
    <div class="date">${fmtDayLabel(new Date(now))}</div>
  </div>
  ${projectorSVG(m, t, tag, ctx, now)}
  <div class="timer-spacer"></div>
  <div class="chips${picking ? ' pick' : ''}" role="group" aria-label="Tag">${chips}</div>
  <div class="actions">${controls}</div>`;

  const ch = root.querySelector('.chips');
  if (ch) ch.scrollLeft = chipsScroll;
  lastText = { ...t, mode: m.mode, total: root.querySelector('#t-total').textContent };
  root.onclick = (e) => onClick(e, ctx);
}

/** Cheap per-tick update: only text and the ring move. Re-render fully when the state changes. */
export function tick(now, ctx) {
  const root = document.getElementById('screen-timer');
  const m = model(ctx, now);
  if (m.mode !== lastText.mode) { render(root, ctx); return; }
  // Countdown just reached zero: chime once, keep running into overtime.
  if (m.over && m.s && chimedFor !== m.s.id) {
    chimedFor = m.s.id;
    const justNow = m.elapsed - m.planned < 5000; // not on a reload long after zero
    if (justNow && ctx.storage.getSettings().sound_haptics) chime();
  }
  const t = texts(m, ctx, now);
  const set = (id, v) => { const el = root.querySelector(id); if (el && el.textContent !== v) el.textContent = v; };
  if (t.digits.length !== lastText.digits.length || t.lLab !== lastText.lLab) { render(root, ctx); return; }
  set('#t-dig', t.digits); set('#t-dig-ghost', t.digits);
  set('#t-of', t.of); set('#t-l-val', t.lVal); set('#t-r-val', t.rVal);
  set('#t-total', fmtHM(todayMs(ctx.storage, now)));
  if (m.mode !== 'idle') {
    const f = m.over ? 1 : m.frac;
    const len = `${(RING_C * f).toFixed(1)} ${RING_C.toFixed(1)}`;
    root.querySelector('#t-ring')?.setAttribute('stroke-dasharray', len);
    root.querySelector('#t-ring-soft')?.setAttribute('stroke-dasharray', len);
    const a = f * 2 * Math.PI;
    const dot = root.querySelector('#t-dot');
    if (dot) { dot.setAttribute('cx', (175 + 118 * Math.sin(a)).toFixed(1)); dot.setAttribute('cy', (210 - 118 * Math.cos(a)).toFixed(1)); }
    document.title = `${t.digits} · Holo`;
  } else document.title = 'Holo Timer';
  lastText = { ...t, mode: m.mode };
}

// ---------- Actions ----------

function onClick(e, ctx) {
  const { storage } = ctx;
  const btn = e.target.closest('button');
  if (!btn) return;
  const act = btn.dataset.act;
  const active = storage.getActiveSession();

  if (btn.dataset.tag) {
    const tagId = btn.dataset.tag;
    if (active) { if (active.tag_id !== tagId) storage.retagSession(active.id, tagId); }
    else if (picking) { start(ctx, tagId); }
    else storage.setSetting('last_tag_id', tagId);
    return;
  }
  switch (act) {
    case 'settings': ctx.go('settings'); break;
    case 'data': ctx.go('data'); break;
    case 'start': {
      // With "ask for a tag" on, the first tap asks; a second tap (or 8 s) starts anyway. Never blocks.
      if (storage.getSettings().ask_tag_first && !picking) {
        picking = true;
        clearTimeout(pickTimer);
        pickTimer = setTimeout(() => { if (picking) start(ctx, null); }, 8000);
        ctx.rerender();
      } else start(ctx, null);
      break;
    }
    case 'pause': if (active) storage.pauseSession(active.id); break;
    case 'resume': if (active) storage.resumeSession(active.id); break;
    case 'end': if (active) end(ctx, active); break;
    default: break;
  }
}

function start(ctx, tagId) {
  const { storage } = ctx;
  picking = false;
  clearTimeout(pickTimer);
  const set = storage.getSettings();
  const tag = tagId ? storage.getTag(tagId) : currentTag(ctx);
  unlockAudio();
  storage.startSession({ tagId: tag ? tag.id : null, plannedMinutes: set.count_up ? null : set.default_minutes });
  haptic();
}

function end(ctx, session) {
  const { storage } = ctx;
  const { discarded } = storage.endSession(session.id);
  haptic();
  const mins = Math.round(storage.sessionElapsed(session) / MIN);
  showToast(discarded ? 'UNDER 2 MIN · NOT SAVED' : `STAR LOGGED · ${fmtHM(mins * MIN)}`, {
    action: 'UNDO',
    onAction: () => storage.reopenSession(session.id),
    ms: 5000,
  });
}

// ---------- Sound & haptics ----------
// iOS only lets a page play audio after a tap, so the AudioContext is created on Start.
// Web vibration isn't supported on iPhone; navigator.vibrate is a no-op there (works on Android).

let audio = null;
function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* no audio: fine */ }
}
function chime() {
  if (!audio) return;
  const t0 = audio.currentTime;
  [[880, 0], [1318.5, 0.18]].forEach(([f, d]) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + d);
    g.gain.linearRampToValueAtTime(0.12, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 1.2);
    o.connect(g).connect(audio.destination);
    o.start(t0 + d);
    o.stop(t0 + d + 1.3);
  });
  haptic();
}
function haptic() { try { navigator.vibrate?.(20); } catch { /* ignore */ } }
