const CACHE_NAME = 'todo-app-v1';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  if (evt.request.method !== 'GET') return;

  const reqUrl = new URL(evt.request.url);

  // Network-first for API requests (avoid serving stale task lists)
  if (reqUrl.pathname.startsWith('/tasks')) {
    evt.respondWith(
      fetch(evt.request)
        .then((res) => {
          // update cache for offline fallback
          caches.open(CACHE_NAME).then((cache) => {
            try { cache.put(evt.request, res.clone()); } catch (e) {}
          });
          return res;
        })
        .catch(() => caches.match(evt.request))
    );
    return;
  }

  // For navigation requests prefer cached shell, then network, then fallback to cached index
  if (evt.request.mode === 'navigate') {
    evt.respondWith(
      caches.match('/index.html').then((cachedIndex) => cachedIndex || fetch(evt.request))
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Cache-first for other static assets
  evt.respondWith(
    caches.match(evt.request).then((cached) => {
      if (cached) return cached;
      return fetch(evt.request)
        .then((res) => {
          return caches.open(CACHE_NAME).then((cache) => {
            try { cache.put(evt.request, res.clone()); } catch (e) {}
            return res;
          });
        })
        .catch(() => {});
    })
  );
});
