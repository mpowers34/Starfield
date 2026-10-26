// app.js — boots the app, owns navigation and the clock tick, and re-renders on data changes.
//
// Each screen module exports render(root, ctx) and optionally tick(now). Screens read data
// straight from storage.js and call its write functions; storage notifies us, we re-render.

import * as storage from './storage.js';
import { installDefs, starfield, BASE_SIZE } from './stars.js';
import { TAG_COLORS } from './storage.js';
import * as timer from './screens/timer.js';
import * as data from './screens/data.js';
import * as missions from './screens/missions.js';
import * as settings from './screens/settings.js';

const screens = { timer, data, missions, settings };

/** Shared UI state (not persisted as data: it's per-device view state). */
const ui = {
  screen: 'timer',
  scope: localStorage.getItem('holo.scope') || 'day', // last data view
  offset: 0, // 0 = current period, -1 = previous…
  hidden: new Set(JSON.parse(localStorage.getItem('holo.hidden') || '[]')), // filtered-out tag ids
  returnTo: 'timer', // where Back goes from Missions/Settings
};

const ctx = {
  ui,
  storage,
  go(screen, opts = {}) {
    if (screen === 'data' && opts.scope) {
      if (opts.scope !== ui.scope) ui.offset = 0;
      ui.scope = opts.scope;
      localStorage.setItem('holo.scope', ui.scope);
    }
    if (opts.offset !== undefined) ui.offset = opts.offset;
    if (screen === 'missions' || screen === 'settings') ui.returnTo = ui.screen;
    ui.screen = screen;
    screens[screen].onEnter?.(ctx);
    show();
  },
  back() { ctx.go(ui.returnTo === ui.screen ? 'timer' : ui.returnTo); },
  toggleHidden(tagId) {
    if (ui.hidden.has(tagId)) ui.hidden.delete(tagId); else ui.hidden.add(tagId);
    localStorage.setItem('holo.hidden', JSON.stringify([...ui.hidden]));
    renderNow();
  },
  accent: () => storage.getSettings().accent || '#ffb84a',
  rerender: () => renderNow(),
};

function show() {
  for (const [name] of Object.entries(screens)) {
    document.getElementById(`screen-${name}`).hidden = name !== ui.screen;
  }
  document.body.dataset.screen = ui.screen;
  renderNow();
  const root = document.getElementById(`screen-${ui.screen}`);
  const sc = root.querySelector('.scroll');
  if (sc) sc.scrollTop = 0;
}

let queued = false;
function renderSoon() { if (!queued) { queued = true; requestAnimationFrame(renderNow); } }
function renderNow() {
  queued = false;
  applyLook();
  const root = document.getElementById(`screen-${ui.screen}`);
  screens[ui.screen].render(root, ctx);
}

/** Settings › Look: accent color, scanlines, reduce motion. Also refresh star gradients. */
let lastDefsKey = '';
function applyLook() {
  const s = storage.getSettings();
  document.documentElement.style.setProperty('--accent', s.accent || '#ffb84a');
  document.body.classList.toggle('no-scanlines', !s.scanlines);
  document.body.classList.toggle('reduce-motion', !!s.reduce_motion);
  const colors = [...TAG_COLORS, '#8fa7bd', ...storage.listTags({ includeDeleted: true }).map((t) => t.color)];
  const key = colors.join();
  if (key !== lastDefsKey) { installDefs(colors); lastDefsKey = key; }
}

/** The see-through backdrop: star field + perspective floor grid (from the Main mock-up). */
function renderBackdrop() {
  const v = [];
  for (let i = -9; i <= 9; i++) v.push(`<line x1="${195 + 180 * i}" y1="995" x2="${195 + 30 * i}" y2="265.8"/>`);
  const hy = [973.7, 880.9, 806.3, 745, 684.5, 620, 557.5, 492.3, 427, 363.1, 295];
  const h = hy.map((y) => `<line x1="-1600" y1="${y}" x2="2000" y2="${y}"/>`);
  document.getElementById('backdrop').innerHTML = `
  <svg viewBox="0 0 390 844" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;left:0;transform:none">
    <defs>
      <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000"/><stop offset="0.62" stop-color="#555"/><stop offset="1" stop-color="#fff"/></linearGradient>
      <mask id="gm" maskUnits="userSpaceOnUse" x="-1600" y="0" width="3600" height="1000"><rect x="-1600" width="3600" height="1000" fill="url(#gf)"/></mask>
    </defs>
    ${starfield('backdrop', 150, -400, 0, 1190, 844, 0.45)}
    <g class="floor" mask="url(#gm)"><g stroke="#5ad7ff" stroke-width="0.8" opacity="0.3">${v.join('')}${h.join('')}</g></g>
  </svg>`;
}

/** One clock for the whole app. Timer digits update 4×/s; data views refresh slowly while a session is live. */
let lastSlow = 0;
function tick() {
  const now = Date.now();
  if (ui.screen === 'timer') timer.tick(now, ctx);
  else if (ui.screen === 'data' && storage.getActiveSession() && now - lastSlow > 20_000) { lastSlow = now; renderNow(); }
}

/**
 * Updates: every time the app opens or comes back to the foreground, ask the server whether sw.js
 * changed. If it did, the new version installs in the background and takes over; we then reload
 * once so the new code shows up immediately instead of on the launch after.
 * The reload is safe mid-session: the timer is rebuilt from stored timestamps.
 */
function setupUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller; // false on the very first install
  const openedAt = Date.now();
  let pending = false;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const check = () => reg.update().catch(() => { /* offline: try again next time */ });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (pending) location.reload(); // an update arrived while you were mid-use: apply it now
      else check();
    });
  }).catch((e) => console.warn('SW registration failed', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || pending) return;
    // Right after launch (or while hidden): reload now. Otherwise wait until the app is next
    // reopened, so a page reload never happens under your thumb.
    if (document.hidden || Date.now() - openedAt < 15_000) location.reload();
    else pending = true;
  });
}

async function boot() {
  try {
    await storage.init();
  } catch (err) {
    document.getElementById('screen-timer').innerHTML = `<p class="label" style="padding:40px 0">Storage unavailable: ${err.message}. Private browsing can block IndexedDB.</p>`;
    console.error(err);
    return;
  }
  renderBackdrop();
  storage.subscribe(renderSoon);
  show();
  setInterval(tick, 250);
  // Coming back to the app (phone unlocked, tab refocused): recompute from timestamps at once.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderNow(); });
  setupUpdates();
  window.holo = { storage, ctx, BASE_SIZE }; // handy in the console
}

boot();
