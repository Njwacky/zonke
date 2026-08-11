const CACHE_NAME = 'zonke-cache-v2';
const ASSETS_TO_CACHE = [
    'index.html',
    'style.css',
    'game.js',
    'manifest.json',
    'icon.svg'
];

// URLs that must NEVER be cached: realtime socket polling/upgrade traffic and live
// telemetry endpoints. Without this, the cache grows unbounded with polling responses
// and stale telemetry would be served offline.
const NEVER_CACHE = ['/api/', '/socket.io/', '/telemetry'];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[Zonke PWA SW] Caching offline game assets');
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== CACHE_NAME) {
                    console.log('[Zonke PWA SW] Removing old cache:', key);
                    return caches.delete(key);
                }
            }));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (NEVER_CACHE.some(path => event.request.url.includes(path))) return;
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            return fetch(event.request).then(networkResponse => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            }).catch(() => {
                // Fallback to index.html if offline navigation
                if (event.request.mode === 'navigate') {
                    return caches.match('index.html');
                }
            });
        })
    );
});
