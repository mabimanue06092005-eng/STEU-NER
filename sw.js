const CACHE_NAME = 'setu-ner-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './src/styles.css',
  './src/api/http.js',
  './src/api/endpoints.js',
  './src/api/ws.js',
  './src/offline/queue.js',
  './src/notifications/channels.js',
  './src/data/ner_graph.js',
  './src/engine/risk_engine.js',
  './src/engine/router.js',
  './src/engine/vision_ai.js',
  './src/engine/mesh_simulator.js',
  './src/engine/dispatch.js',
  './src/engine/sms_ivr.js',
  './src/engine/map_ai.js',
  './src/engine/community_pool.js',
  './src/engine/camp_broadcast.js',
  './src/map/googleMapsLoader.js',
  './src/map/googleProvider.js',
  './src/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.log('Asset cache warning:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cache first, refresh in background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {/* Offline fallback */});
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
