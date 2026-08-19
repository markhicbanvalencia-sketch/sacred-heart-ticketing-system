const CACHE  = 'mis-v1';
const STATIC = [
  '/offline.html',
  '/static/css/app.css',
  '/static/js/app.js',
  '/static/js/realtime.js',
];

// ── Install: pre-cache static shell ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// ── Activate: drop old caches ─────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategy ────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Static assets (CSS, JS, icons): cache-first, update in background
  if (url.pathname.startsWith('/static/') || url.pathname === '/offline.html') {
    e.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(res => {
          // Clone synchronously, before `res`'s body is touched anywhere else —
          // a Response can only be read once, and caches.open() below resolves
          // asynchronously, so cloning inside its .then() risks racing against
          // the caller (e.g. the browser rendering this resource) already having
          // started consuming the original body.
          const toCache = res.ok ? res.clone() : null;
          if (toCache) caches.open(CACHE).then(c => c.put(request, toCache)).catch(() => {});
          return res;
        });
        return cached || network;
      })
    );
    return;
  }

  // Page navigation: network-first, fall back to offline page
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // Everything else (API, SSE): always network, no cache
});
