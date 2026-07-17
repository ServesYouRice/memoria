/**
 * Privacy-preserving service worker.
 *
 * Authenticated documents and API responses are deliberately network-only.
 * Cache Storage is limited to public, immutable application assets and a
 * dedicated offline document that contains no user data.
 */

const CACHE_NAME = "memoria-public-v2";
const UNSAFE_LEGACY_CACHES = new Set(["canvascollect-v1"]);
const PUBLIC_FALLBACKS = ["/offline", "/manifest.json"];

function isPublicAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.json")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_FALLBACKS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name !== CACHE_NAME || UNSAFE_LEGACY_CACHES.has(name),
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
    return;
  }

  if (!isPublicAsset(url)) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, response.clone()));
          }
          return response;
        }),
    ),
  );
});
