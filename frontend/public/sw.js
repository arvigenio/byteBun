// Service worker for the installable client apps (registered by /client/boot.js on the
// bookings and client portal hosts only). Network first: nothing is cached except a small
// offline page, so people always see live bookings.
const OFFLINE = '/client/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('bb-offline-v1').then((c) => c.add(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
