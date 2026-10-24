// stars.js — star glyphs, the holographic grid projection, and deterministic placement.
//
// Projection (taken from the mock-ups): the grid is the square u,w ∈ [-1, 1] on a ground
// plane. A pinhole camera puts a ground point at depth z = D + w, and on screen at
//   x = CX + F·u / z        y = Y0 + K / z
// With D=5.5, F=742, K=3591, Y0=-484.5 the near edge lands at y=313.5 and the far edge at
// y=68, inside a 390×294 viewBox that starts at y=30. Any N×N grid uses the same square,
// so bigger grids simply have smaller cells — the "camera pulls back" effect.

import { seededShuffle, hashSeed, rng, clamp, MIN } from './util.js';
import { sessionElapsed } from './storage.js';

const D = 5.5, F = 742, K = 3591, Y0 = -484.5, CX = 195;
export const project = (u, w) => { const z = D + w; return { x: CX + (F * u) / z, y: Y0 + K / z, z }; };
/** On-screen width of one cell at depth z for an N×N grid. */
const cellWidth = (N, z) => (F * (2 / N)) / z;

/** Base grid size per scope, and the sizes it grows through when a period fills up. */
export const BASE_SIZE = { day: 5, week: 6, month: 11, year: 26 };
const LADDER = [5, 6, 8, 11, 15, 20, 26, 32, 40, 50, 64];
/** Grow to the next size once this share of slots is taken, so there's always visible room. */
const FILL = 0.85;

// ---------- Star look ----------

/** Star radius as a fraction of cell width, by session length (longer = bigger). */
export const starFrac = (minutes) => clamp(0.13 + 0.0031 * minutes, 0.16, 0.5);
/** Brightness by session length. */
export const starOpacity = (minutes) => clamp(0.5 + 0.0055 * minutes, 0.55, 0.98);

const gradId = (color) => `h${color.replace('#', '')}`;
const STAR_PATH = 'M0 -1 .2 -.2 1 0 .2 .2 0 1 -.2 .2 -1 0 -.2 -.2Z';
const CHIP_PATH = 'M0 -7.5 1.5 -1.5 7.5 0 1.5 1.5 0 7.5 -1.5 1.5 -7.5 0 -1.5 -1.5Z';

/**
 * Shared <defs> (halo gradients per color + glow filter), injected once into the page so
 * every inline SVG can reference them. Call again when tag colors change.
 */
export function installDefs(colors) {
  let host = document.getElementById('svg-defs');
  if (!host) {
    host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.id = 'svg-defs';
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.style.position = 'absolute';
    document.body.prepend(host);
  }
  const grads = [...new Set(colors)].map((c) => `<radialGradient id="${gradId(c)}"><stop offset="0" stop-color="${c}" stop-opacity="0.55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`).join('');
  host.innerHTML = `<defs>${grads}
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="tglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
}

/** A star (halo + four-point glyph + white core) centred at 0,0, unit size; wrap in a transform. */
export const starBody = (color, halo = 2.2) =>
  `<circle r="${halo}" fill="url(#${gradId(color)})"/><path d="${STAR_PATH}" fill="${color}"/><circle r=".3" fill="#eafcff"/>`;

/** A standalone star icon for lists. minutes sets size/brightness, like on the grid. */
export function starIcon(color, minutes, { box = 30, ring = false, accent = '#ffb84a' } = {}) {
  const scale = clamp(3.4 + 0.075 * minutes, 4.4, 10);
  const vb = ring ? 15 : 12;
  return `<svg width="${box}" height="${box}" viewBox="-${vb} -${vb} ${vb * 2} ${vb * 2}" aria-hidden="true">${ring ? `<circle r="12" fill="none" stroke="${accent}" stroke-width="1.2" stroke-dasharray="3 3"/>` : ''}<g transform="scale(${scale.toFixed(1)})" opacity="${starOpacity(minutes).toFixed(2)}">${starBody(color, 1.7)}</g></svg>`;
}

/** The flat sparkle used on tag chips. */
export const chipStar = (color, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="-8 -8 16 16" aria-hidden="true"><path d="${CHIP_PATH}" fill="${color}"/></svg>`;

// ---------- Placement ----------

const capOf = (N) => Math.floor(FILL * N * N);
const center = (cell, N) => ({ u: -1 + (2 * (cell % N) + 1) / N, w: -1 + (2 * Math.floor(cell / N) + 1) / N });

/** The free cell of an N grid nearest to normalized point (u, w). Searches outward in square rings. */
function nearestFree(u, w, N, occupied) {
  const c0 = clamp(Math.round(((u + 1) / 2) * N - 0.5), 0, N - 1);
  const r0 = clamp(Math.round(((w + 1) / 2) * N - 0.5), 0, N - 1);
  for (let rad = 0; rad < N; rad++) {
    let best = -1;
    let bestD = Infinity;
    for (let r = r0 - rad; r <= r0 + rad; r++) {
      for (let c = c0 - rad; c <= c0 + rad; c++) {
        if (r < 0 || c < 0 || r >= N || c >= N) continue;
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad) continue; // ring only
        const cell = r * N + c;
        if (occupied.has(cell)) continue;
        const p = center(cell, N);
        const d = (p.u - u) ** 2 + (p.w - w) ** 2;
        if (d < bestD) { bestD = d; best = cell; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

const placementCache = new Map();

/**
 * Where the first `count` stars of a period sit. Deterministic: same key + count → same answer.
 *
 * Rule: star k takes the k-th slot of a seeded shuffle of the grid (seed = period key + size).
 * When the period fills past 85%, the grid steps up to the next size. Existing stars keep their
 * spot in space (snapped to the nearest cell of the finer grid, in order) and new stars draw
 * from the new grid's shuffle. Nothing ever reshuffles; the field just gets finer.
 *
 * Returns { N, cells: [cellIndex per star] }.
 */
export function placeStars(scope, key, count) {
  const ck = `${scope}|${key}|${count}`;
  if (placementCache.has(ck)) return placementCache.get(ck);
  let li = LADDER.indexOf(BASE_SIZE[scope]);
  let N = LADDER[li];
  let order = seededShuffle(N * N, `${key}:${N}`);
  let ptr = 0;
  let occupied = new Set();
  const home = []; // normalized position where each star was first placed
  const cells = [];
  for (let k = 0; k < count; k++) {
    while (k >= capOf(N) && li < LADDER.length - 1) {
      li += 1;
      N = LADDER[li];
      order = seededShuffle(N * N, `${key}:${N}`);
      ptr = 0;
      occupied = new Set();
      for (let j = 0; j < k; j++) {
        cells[j] = nearestFree(home[j].u, home[j].w, N, occupied);
        occupied.add(cells[j]);
      }
    }
    while (ptr < order.length && occupied.has(order[ptr])) ptr++;
    const cell = ptr < order.length ? order[ptr++] : nearestFree(0, 0, N, occupied);
    occupied.add(cell);
    cells.push(cell);
    home.push(center(cell, N));
  }
  const out = { N, cells };
  if (placementCache.size > 200) placementCache.clear();
  placementCache.set(ck, out);
  return out;
}

// ---------- The grid scene ----------

/** Faint background star field, seeded so it doesn't flicker between renders. */
function starfield(seedStr, n, x0, y0, w, h, maxOp = 0.52) {
  const r = rng(hashSeed(seedStr));
  let s = '';
  for (let i = 0; i < n; i++) {
    s += `<circle cx="${(x0 + r() * w).toFixed(1)}" cy="${(y0 + r() * h).toFixed(1)}" r="${(0.4 + r() * 0.9).toFixed(1)}" opacity="${(0.11 + r() * (maxOp - 0.11)).toFixed(2)}"/>`;
  }
  return `<g fill="#cfeeff">${s}</g>`;
}
export { starfield };

const SCOPES = ['day', 'week', 'month', 'year'];

/**
 * Render a period's grid as an SVG string.
 * @param o.scope 'day'|'week'|'month'|'year'
 * @param o.key period key, e.g. "2026-W43" (seeds placement)
 * @param o.sessions all non-deleted sessions in the period, sorted by start (filters NOT applied)
 * @param o.tags Map id → tag
 * @param o.hidden Set of tag ids filtered out (their stars vanish, their slots stay taken)
 * @param o.accent accent color for the newest/live ring
 * @param o.label accessible description
 */
export function renderGrid({ scope, key, sessions, tags, hidden = new Set(), accent, now = Date.now(), label = '' }) {
  const { N, cells } = placeStars(scope, key, sessions.length);
  const big = N > 15; // year-scale grids: thinner lines, no base ellipses
  const live = sessions.find((s) => !s.ended_at);
  const newest = live || sessions[sessions.length - 1];

  // Grid lines: N+1 in each direction.
  let lines = '';
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 * i) / N;
    const a = project(t, -1), b = project(t, 1); // "vertical" (receding) line
    const c = project(-1, t), d = project(1, t); // horizontal line
    lines += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/><line x1="${c.x.toFixed(1)}" y1="${c.y.toFixed(1)}" x2="${d.x.toFixed(1)}" y2="${d.y.toFixed(1)}"/>`;
  }
  const q = [project(-1, -1), project(1, -1), project(1, 1), project(-1, 1)];
  const quad = `M${q.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')}Z`;

  // Which cells hold a visible star.
  const items = sessions.map((s, i) => ({ s, cell: cells[i] }));
  const shown = items.filter((it) => !hidden.has(it.s.tag_id));
  const shownCells = new Set(shown.map((it) => it.cell));

  // Empty-slot dots.
  const dotR = big ? 0.7 : 1.2;
  let dots = '';
  for (let cell = 0; cell < N * N; cell++) {
    if (shownCells.has(cell)) continue;
    const c = center(cell, N);
    const p = project(c.u, c.w);
    dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dotR}"/>`;
  }

  // Stars, back (far, high w) to front.
  shown.sort((a, b) => center(b.cell, N).w - center(a.cell, N).w);
  let stars = '';
  for (const { s, cell } of shown) {
    const tag = tags.get(s.tag_id);
    const color = tag ? tag.color : '#8fa7bd';
    const mins = sessionElapsed(s, now) / MIN;
    const c = center(cell, N);
    const p = project(c.u, c.w);
    const cw = cellWidth(N, p.z);
    const scale = cw * starFrac(mins);
    const stem = big ? cw * 0.18 : cw * 0.26;
    const sy = p.y - stem;
    let g = '';
    if (!big) g += `<ellipse cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" rx="${(cw * 0.22).toFixed(1)}" ry="${(cw * 0.11).toFixed(1)}" fill="rgba(90,215,255,0.1)" stroke="${color}" stroke-width="0.7" opacity="0.7"/>`;
    g += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${color}" stroke-width="${big ? 0.5 : 0.7}" opacity="0.5"/>`;
    if (s === newest) g += `<circle class="${s === live ? 'live-ring' : ''}" cx="${p.x.toFixed(1)}" cy="${sy.toFixed(1)}" r="${Math.max(6, scale * 2).toFixed(1)}" fill="none" stroke="${accent}" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    g += `<g transform="translate(${p.x.toFixed(1)} ${sy.toFixed(1)}) scale(${scale.toFixed(2)})" opacity="${starOpacity(mins).toFixed(2)}">${starBody(color)}</g>`;
    stars += g;
  }

  const si = SCOPES.indexOf(scope);
  const scopeDots = SCOPES.map((_, i) => (i === si
    ? `<circle cx="${330 + 13 * i}" cy="41" r="3.2" fill="${accent}"/>`
    : `<circle cx="${330 + 13 * i}" cy="41" r="2.6" fill="none" stroke="#8fa7bd" stroke-width="1" opacity="0.45"/>`)).join('');

  return `<svg class="grid-svg" viewBox="0 30 390 294" role="img" aria-label="${label}">
    ${starfield(`field:${scope}`, 46, 0, 30, 390, 294)}
    <g stroke="#5ad7ff" stroke-width="${big ? 0.55 : 0.8}" opacity="${big ? 0.24 : 0.3}" fill="none">${lines}</g>
    <path d="${quad}" fill="rgba(90,215,255,0.04)" stroke="#5ad7ff" stroke-width="1.2" opacity="0.8"/>
    <g fill="#5ad7ff" opacity="0.32">${dots}</g>
    ${stars}
    <text x="22" y="44" class="svg-mono" font-size="9.5" letter-spacing="1.6" fill="#5ad7ff" opacity="0.9">SCOPE · ${scope.toUpperCase()}${N !== BASE_SIZE[scope] ? ` · ${N}×${N}` : ''}</text>
    ${scopeDots}
  </svg>`;
}
