const CACHE_NAME = "anime-va-cache-v2";

const URLS_TO_CACHE = [
  "/anime-va-updates/web/",
  "/anime-va-updates/web/index.html",
  "/anime-va-updates/web/style.css",
  "/anime-va-updates/web/app.js",
  "/anime-va-updates/web/manifest.webmanifest",
  "/anime-va-updates/web/icons/icon-192.png",
  "/anime-va-updates/web/icons/icon-512.png",
  "/anime-va-updates/data/anime_va_mobile.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request);
    })
  );
});
