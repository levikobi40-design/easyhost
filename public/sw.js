/* ════════════════════════════════════════════════════════════════
   EasyHost AI — Service Worker
   Strategy:
     • App shell (HTML / JS / CSS / fonts / icons) → Cache-First
     • API calls  (/api/*)                          → Network-First
     • Everything else                              → StaleWhileRevalidate
   ════════════════════════════════════════════════════════════════ */

const APP_NAME    = 'easyhost-ai';
const CACHE_VER   = 'v3';                          // bump to bust old caches
const SHELL_CACHE = `${APP_NAME}-shell-${CACHE_VER}`;
const DATA_CACHE  = `${APP_NAME}-data-${CACHE_VER}`;

/* Pre-cache the critical app shell */
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/icon-maskable.svg',
  '/favicon.ico',
];

/* ── Install: pre-cache shell ─────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      // addAll fails if any request fails — use individual adds for resilience
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] Pre-cache skipped: ${url}`, err)
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: clean stale caches ────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith(APP_NAME) && ![SHELL_CACHE, DATA_CACHE].includes(k))
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: routing logic ─────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ── 1. Skip non-GET and cross-origin requests ───────────────
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin &&
      !url.hostname.includes('fonts.googleapis.com') &&
      !url.hostname.includes('fonts.gstatic.com')) return;

  // ── 2. API calls → Network-First (fresh data, cache fallback) ─
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // ── 3. Google Fonts → StaleWhileRevalidate ───────────────────
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // ── 4. HTML navigation → Network-First, fallback to /index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then(r => r || caches.match('/'))
      )
    );
    return;
  }

  // ── 5. Static assets (JS / CSS / images / icons) → Cache-First ─
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

/* ════════════════════════════════════════════════════════════════
   Strategy helpers
   ════════════════════════════════════════════════════════════════ */

/** Cache-First: serve from cache, fall back to network and cache the response */
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    // offline + no cache → return a simple offline response for non-HTML
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/** Network-First: try network, fall back to cache */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ offline: true, error: 'No network or cache available' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/** StaleWhileRevalidate: serve cache immediately, refresh in background */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);

  return cached || await networkFetch || new Response('Offline', { status: 503 });
}

/* ── Background Sync: retry failed task completions ──────────── */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-task-completion') {
    event.waitUntil(retrySyncQueue());
  }
});

async function retrySyncQueue() {
  // Simple retry: dispatch any pending PATCH requests stored in IndexedDB
  // (The actual queue management lives in the app JS via idb-keyval or similar)
  console.log('[SW] Retrying sync queue…');
}

/* ── Push Notifications ──────────────────────────────────────── */
self.addEventListener('push', event => {
  let data = { title: 'EasyHost AI', body: '⚡ New mission alert' };
  try { data = event.data?.json() || data; } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'EasyHost AI', {
      body:    data.body  || '⚡ Mission update',
      icon:    '/icon.svg',
      badge:   '/icon.svg',
      tag:     data.tag   || 'easyhost-notif',
      renotify: true,
      vibrate: [100, 50, 100],
      data:    { url: data.url || '/' },
      actions: [
        { action: 'open',    title: '🏨 Open App' },
        { action: 'dismiss', title: '✕ Dismiss'  },
      ],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
      const existing = all.find(c => c.url.includes(location.origin));
      if (existing) {
        existing.focus();
        existing.navigate(targetUrl);
      } else {
        clients.openWindow(targetUrl);
      }
    })
  );
});
