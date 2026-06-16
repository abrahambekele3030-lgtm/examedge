const CACHE_NAME = 'examedge-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/main.css',
  './js/app.js',
  './manifest.json',
  './visuals_manifest.json'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request).then(
          function(networkResponse) {
            // Dynamically cache everything that is successfully fetched
            // This ensures questions (data/*.json) and MathJax fonts are cached for true offline support
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic' || event.request.url.includes('cdn.jsdelivr.net')) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          }
        ).catch(() => {
          console.log('Offline and resource not found in cache.');
        });
      })
  );
});
