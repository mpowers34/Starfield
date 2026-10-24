// sw.js — offline support. The whole app is a handful of static files, so we precache all of
// them and serve cache-first. Your data lives in IndexedDB, which the service worker never touches.
//
// Releasing a change: bump VERSION. The new worker installs in the background, takes over,
// and the next launch runs the new files.

const VERSION = 'holo-v0.1.0';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/util.js',
  'js/storage.js',
  'js/stars.js',
  'js/metrics.js',
  'js/missions.js',
  'js/demo.js',
  'js/ui.js',
  'js/screens/timer.js',
  'js/screens/data.js',
  'js/screens/missions.js',
  'js/screens/settings.js',
  'fonts/chakra-petch-regular.woff',
  'fonts/chakra-petch-medium.woff',
  'fonts/chakra-petch-semibold.woff',
  'fonts/ibm-plex-mono-regular.woff',
  'fonts/ibm-plex-mono-medium.woff',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      // Cache anything else same-origin we fetch, so it's there next time we're offline.
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
