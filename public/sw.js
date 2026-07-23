// CFP Coverage Board — service worker.
// Provides an installable PWA shell and receives web-push notifications.

const CACHE = 'cfp-shell-v2';
const SHELL = ['/', '/app.js', '/manifest.webmanifest', '/logo.png', '/icon-192.png'];

self.addEventListener('install', (event) => {
  // Activate this new worker immediately instead of waiting for old tabs to close.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-FIRST for the app shell so users always get the latest HTML/JS when
// online; fall back to cache only when offline. This is what lets deploys reach
// installed home-screen apps automatically — no delete-and-re-add needed.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return; // let network handle

  event.respondWith(
    fetch(request)
      .then((res) => {
        // Refresh the cached copy of shell assets on every successful fetch.
        if (res.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') ||
                       url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest') ||
                       url.pathname === '/' || url.pathname.endsWith('.html'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request)) // offline → serve last-known-good
  );
});

// Push: show a notification. Payload is JSON { title, body, url }.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'CFP Coverage';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking a notification focuses an existing tab (deep-linking) or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate(target); return client.focus(); }
      }
      return self.clients.openWindow(target);
    })
  );
});
