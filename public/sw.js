// SCWS Tech Service Worker
const CACHE_NAME = 'scws-tech-v1';
const OFFLINE_URL = '/tech/offline';

// Assets to cache for offline use
const STATIC_ASSETS = [
  '/tech',
  '/tech/offline',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip API requests - they should not be cached
  if (url.pathname.startsWith('/api/')) return;

  // For navigation requests, try network first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the page for offline use
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Return cached version or offline page
          return caches.match(request).then((cached) => {
            return cached || caches.match(OFFLINE_URL);
          });
        })
    );
    return;
  }

  // For other requests, try cache first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      
      return fetch(request).then((response) => {
        // Cache successful responses
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      });
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-job-updates') {
    event.waitUntil(syncJobUpdates());
  }
});

async function syncJobUpdates() {
  // Sync any pending job updates when back online
  const pendingUpdates = await getStoredUpdates();
  for (const update of pendingUpdates) {
    try {
      await fetch(update.url, {
        method: update.method,
        headers: update.headers,
        body: update.body,
      });
      await removeStoredUpdate(update.id);
    } catch (error) {
      console.log('[SW] Failed to sync update:', error);
    }
  }
}

// Helpers for IndexedDB storage (placeholder - implement as needed)
async function getStoredUpdates() {
  return [];
}

async function removeStoredUpdate(id) {
  // Remove synced update from storage
}

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/tech',
    },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/tech';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window/tab open
      for (const client of clientList) {
        if (client.url.includes('/tech') && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window if needed
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
