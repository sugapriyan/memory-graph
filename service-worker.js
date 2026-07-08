const CACHE_NAME = 'memory-graph-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell only. Anything going to googleapis.com
// (Drive API, auth) always goes to the network — never cached, since
// that's live personal data, not static assets.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin.includes('googleapis.com') || url.origin.includes('google.com')) {
    return; // let it hit the network normally
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
