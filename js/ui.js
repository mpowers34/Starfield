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

export const ICONS = {
  back: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hex: '<svg width="40" height="44" viewBox="0 0 48 54" aria-hidden="true"><path d="M24 2 44 13.5v27L24 52 4 40.5v-27Z" fill="rgba(90,215,255,0.07)" stroke="currentColor" stroke-width="2"/><g transform="translate(24 27) scale(10)"><path d="M0 -1 .2 -.2 1 0 .2 .2 0 1 -.2 .2 -1 0 -.2 -.2Z" fill="currentColor"/></g></svg>',
  grip: '<svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="4" r="1.4"/><circle cx="10" cy="4" r="1.4"/><circle cx="4" cy="9" r="1.4"/><circle cx="10" cy="9" r="1.4"/><circle cx="4" cy="14" r="1.4"/><circle cx="10" cy="14" r="1.4"/></g></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
