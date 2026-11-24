/**
 * Guest-site service worker.
 *
 * Hand-rolled (no build tooling, no dependencies) and served fresh by the
 * Worker (Cache-Control: no-cache), so updates always propagate.
 *
 * Strategy:
 *  - /api/*  -> never touched (network only): the lock screen, unlock and
 *               RSVP data must always be current.
 *  - /media/* -> never touched: guest-site photos stay network-fresh.
 *  - /assets/* -> cache-first: Vite emits content-hashed, immutable bundles.
 *  - navigations -> network-first; the last good shell is cached so the app
 *               opens offline ("Add to Home Screen" keeps working).
 *  - everything else same-origin (manifest, icons, favicon) -> network-first
 *    with a cached fallback.
 */
// v2: pages became lazy-loaded chunks; a new name drops any v1 entry that
// cached a non-OK /assets/* response.
// The Worker fills in the brand-slug placeholder when it serves this file
// (worker/src/brand.js), so the cache name stays what it was before.
const CACHE = '%WP_BRAND_SLUG%-v2';
const CORE = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/media/')) return;

  // Immutable hashed build assets: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            // Only a real file is immutable: a 404 for a stale chunk name
            // must not be cached forever.
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
      )
    );
    return;
  }

  // Navigations: network-first with the cached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then((hit) => hit || caches.match('/'))
        )
    );
    return;
  }

  // Manifest, icons, favicon, anything else same-origin: network-first with a
  // cached fallback so they stay fresh but the install survives offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
// Push notifications from the planner's assistant chat (plan portal only;
// guests never subscribe). The payload is encrypted end-to-end by the Worker
// (worker/src/push.js): { title, body, url, tag, kind }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Wedding planner';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || 'planner',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/assistant' },
    })
  );
});

// Tapping a notification opens (or focuses) the planner on that chat.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target = '/assistant';
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '/assistant', self.location.origin);
    // Only ever navigate within this site.
    if (u.origin === self.location.origin) target = u.pathname + u.search;
  } catch (e) {
    /* keep the default */
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          return w.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : undefined));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
