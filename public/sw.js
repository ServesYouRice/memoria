/**
 * Service Worker
 * Basic PWA functionality
 *
 * Only static assets are cached. HTML pages (including authenticated,
 * personalized pages like /dashboard) and API responses are always served
 * from the network so users never see another session's state or a stale
 * app shell after a deploy.
 */

// Bump the version when caching behavior or precached assets change.
const CACHE_NAME = "memoria-static-v2";
const STATIC_CACHE = [
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

function isCacheableStaticAsset(request) {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;

  // Never cache pages or data — only immutable/static assets.
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.startsWith("/icons/")) return true;
  if (url.pathname === "/manifest.json") return true;
  return /\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/.test(url.pathname);
}

// Install event - cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_CACHE);
    }),
  );
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
    }),
  );
  self.clients.claim();
});

// Fetch event - static assets: network first with cache fallback; everything
// else goes straight to the network.
self.addEventListener("fetch", (event) => {
  if (!isCacheableStaticAsset(event.request)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request);
      }),
  );
});
