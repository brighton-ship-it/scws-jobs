// SCWS Service Worker - v3 (Network-first, minimal caching)
const CACHE_NAME = 'scws-v3';

// Only cache essential offline assets
const OFFLINE_ASSETS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// Install - cache only essentials
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v3');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_ASSETS);
    })
  );
  // Immediately take over
  self.skipWaiting();
});

// Activate - clear ALL old caches aggressively
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v3 - clearing all old caches');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch - ALWAYS go to network, no caching of HTML/JS
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // NEVER cache API requests
  if (url.pathname.startsWith('/api/')) return;

  // For navigation requests (HTML pages), always go to network
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        // Only show offline page if network completely fails
        return caches.match('/tech/offline') || new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // For other assets, network first with no caching
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request);
    })
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
});
