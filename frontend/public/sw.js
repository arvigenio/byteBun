// Service worker for the installable client apps (registered by /client/boot.js on the bookings,
// client portal and scanner hosts). Network first: nothing is cached except the offline page and
// the app icons, so people always see live bookings and check-ins.
const CACHE = 'bb-offline-v2';
const OFFLINE = '/client/offline.html';
const PRECACHE = [OFFLINE, '/client/bookings-icon.svg', '/client/portal-icon.svg', '/client/scanner-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

// Drop older caches (bb-offline-v1), then take over open pages.
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
