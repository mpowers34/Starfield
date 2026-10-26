// ui.js — tiny shared UI pieces: the undo toast and a few icons.
// The toast is the ONLY transient message in the app. It never blocks a tap and dismisses itself.

let toastTimer = null;

/** Show a one-line message with an optional action (e.g. UNDO). Replaces any current toast. */
export function showToast(text, { action, onAction, ms = 4000 } = {}) {
  const host = document.getElementById('toast-host');
  clearTimeout(toastTimer);
  host.innerHTML = `<div class="toast" role="status"><span>${text}</span>${action ? `<button type="button" class="btn-pill">${action}</button>` : ''}</div>`;
  const btn = host.querySelector('button');
  if (btn) btn.onclick = () => { host.innerHTML = ''; clearTimeout(toastTimer); onAction?.(); };
  toastTimer = setTimeout(() => { host.innerHTML = ''; }, ms);
}

/**
 * Call cb('left' | 'right') when a horizontal swipe ends on el. Taps, short drags and vertical
 * scrolls are ignored, as are swipes that START on an element matching `ignore` (e.g. the
 * sideways-scrolling tag row). Safe to call on every render: it replaces, never stacks, handlers.
 */
export function onSwipe(el, cb, { ignore = null } = {}) {
  if (!el) return;
  if (el._swipe) { el.removeEventListener('touchstart', el._swipe.start); el.removeEventListener('touchend', el._swipe.end); }
  let x0 = null;
  let y0 = null;
  const start = (e) => {
    if (e.touches.length !== 1 || (ignore && e.target.closest(ignore))) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  };
  const end = (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.8) return;
    cb(dx > 0 ? 'right' : 'left');
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', end, { passive: true });
  el._swipe = { start, end };
}

export const ICONS = {
  back: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hex: '<svg width="40" height="44" viewBox="0 0 48 54" aria-hidden="true"><path d="M24 2 44 13.5v27L24 52 4 40.5v-27Z" fill="rgba(90,215,255,0.07)" stroke="currentColor" stroke-width="2"/><g transform="translate(24 27) scale(10)"><path d="M0 -1 .2 -.2 1 0 .2 .2 0 1 -.2 .2 -1 0 -.2 -.2Z" fill="currentColor"/></g></svg>',
  grip: '<svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="4" r="1.4"/><circle cx="10" cy="4" r="1.4"/><circle cx="4" cy="9" r="1.4"/><circle cx="10" cy="9" r="1.4"/><circle cx="4" cy="14" r="1.4"/><circle cx="10" cy="14" r="1.4"/></g></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
