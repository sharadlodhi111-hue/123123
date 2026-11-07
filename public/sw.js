const CACHE = 'murlidhar-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/murlidhar-classes.jpg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put('/', copy)); return response;
    }).catch(() => caches.match('/')));
    return;
  }
  const url = new URL(event.request.url);
  const cacheable = url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/murlidhar-classes.jpg';
  if (!cacheable) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) { const copy = response.clone(); cache.put(event.request, copy); }
    return response;
  }));
});
