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
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cache if found
        if (response) {
          return response;
        }
        
        // Otherwise fetch from network
        return fetch(event.request).then(
          function(networkResponse) {
            // Optional: Clone the response and add to cache dynamically
            // (Skipping dynamic caching here to keep it simple and safe for large question banks)
            return networkResponse;
          }
        ).catch(() => {
          // Fallback if offline and not in cache
          console.log('Offline and resource not found in cache.');
        });
      })
  );
});
