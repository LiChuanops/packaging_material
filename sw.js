const CACHE_NAME = 'pwa-photo-app-cache-v1';
const URLS_TO_CACHE = [
    '/',
    'index.html',
    'styles.css',
    'app.js',
    'manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// --- INSTALL: Cache the application shell ---
self.addEventListener('install', event => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching app shell');
                return cache.addAll(URLS_TO_CACHE);
            })
            .then(() => {
                console.log('Service Worker: Install complete');
                return self.skipWaiting(); // Force the waiting service worker to become the active one.
            })
    );
});

// --- ACTIVATE: Clean up old caches ---
self.addEventListener('activate', event => {
    console.log('Service Worker: Activating...');
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('Service Worker: Deleting old cache', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker: Activation complete');
            return self.clients.claim(); // Take control of all open clients.
        })
    );
});

// --- FETCH: Serve from cache first (Cache-First Strategy) ---
self.addEventListener('fetch', event => {
    // We only want to cache GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // For Supabase API calls, always go to the network.
    // This is a simple check; you might need a more robust one depending on your URL structure.
    if (event.request.url.includes('supabase.co')) {
        // Always fetch from the network.
        return fetch(event.request);
    }

    // For other requests, try the cache first.
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // If we have a cached response, return it.
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Otherwise, fetch the request from the network.
                return fetch(event.request);
            })
    );
});
