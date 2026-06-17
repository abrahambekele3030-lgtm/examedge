/**
 * ExamEdge Service Worker v3
 * Offline-first architecture:
 * - App shell (HTML/CSS/JS): network-first with cache fallback
 * - Question data (JSON files): cache-first, populate on first request
 * - MathJax CDN: cache-first for offline LaTeX rendering
 * - Google Fonts: cache-first
 */

const CACHE_VERSION = 'examedge-v3';
const DATA_CACHE = 'examedge-data-v3';
const FONT_CACHE = 'examedge-fonts-v3';

// Core app shell assets (always cache on install)
const SHELL_ASSETS = [
  './',
  './index.html',
  './css/main.css',
  './js/app.js',
  './manifest.json',
  './data/manifest.json',
];

// ============================================================
// INSTALL — cache shell assets
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.warn('[SW] Install cache error:', err);
        self.skipWaiting();
      })
  );
});

// ============================================================
// ACTIVATE — clean up old caches
// ============================================================
self.addEventListener('activate', event => {
  const validCaches = [CACHE_VERSION, DATA_CACHE, FONT_CACHE];
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(name => !validCaches.includes(name))
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — routing strategy
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // --- Question data files: cache-first (offline-ready) ---
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(cacheFirst(event.request, DATA_CACHE));
    return;
  }

  // --- MathJax CDN: cache-first ---
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(event.request, CACHE_VERSION));
    return;
  }

  // --- Google Fonts: cache-first ---
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request, FONT_CACHE));
    return;
  }

  // --- Free Dictionary API: network only (no caching) ---
  if (url.hostname === 'api.dictionaryapi.dev') {
    event.respondWith(fetch(event.request).catch(() => new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // --- App shell (HTML, CSS, JS): network-first with cache fallback ---
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event.request, CACHE_VERSION));
    return;
  }

  // --- Everything else: network only ---
  event.respondWith(fetch(event.request));
});

// ============================================================
// STRATEGIES
// ============================================================

/**
 * Cache-first: serve from cache, fetch & update cache if missing.
 */
async function cacheFirst(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Network-first: try network, fall back to cache.
 * For navigation requests, fall back to index.html.
 */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    // For navigation requests, return the app shell
    if (request.mode === 'navigate') {
      const indexCache = await cache.match('./index.html');
      if (indexCache) return indexCache;
    }

    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// ============================================================
// MESSAGE HANDLING — client can send messages to SW
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  // Pre-cache all question data files
  if (event.data && event.data.type === 'PRECACHE_DATA') {
    const files = event.data.files || [];
    caches.open(DATA_CACHE).then(cache => {
      // Batch cache data files
      const BATCH = 20;
      async function doBatch(index) {
        if (index >= files.length) return;
        const batch = files.slice(index, index + BATCH);
        await Promise.allSettled(
          batch.map(path => 
            cache.match(path).then(hit => {
              if (!hit) return fetch(path).then(r => r.ok ? cache.put(path, r) : null).catch(() => null);
            })
          )
        );
        await doBatch(index + BATCH);
      }
      doBatch(0);
    });
  }
});
