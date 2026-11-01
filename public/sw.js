/**
 * Privacy-preserving service worker.
 *
 * Authenticated documents and API responses are deliberately network-only.
 * Cache Storage is limited to public, immutable application assets, a
 * dedicated offline document that contains no user data, and (IMP-045) the
 * shells of canvas pages a signed-in user opened. A canvas shell is the same
 * HTML for everyone and holds no user data; the page itself stores it
 * (`rememberCanvasShell` in `src/lib/collaboration/sync/offline-store.ts`)
 * and deletes it on sign-out. It is served only when the network fails, so
 * the canvas can open its device copy from IndexedDB.
 */

const CACHE_NAME = "memoria-public-v2";
// Keep in step with CANVAS_SHELL_CACHE in offline-store.ts.
const CANVAS_SHELL_CACHE = "memoria-canvas-shells-v1";
const CANVAS_PAGE = /^\/canvas\/[a-z0-9]+$/;
const UNSAFE_LEGACY_CACHES = new Set(["canvascollect-v1"]);
const MEMORIA_CACHE_PREFIX = "memoria-";
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
              (name) =>
                name !== CACHE_NAME &&
                name !== CANVAS_SHELL_CACHE &&
                (name.startsWith(MEMORIA_CACHE_PREFIX) ||
                  UNSAFE_LEGACY_CACHES.has(name)),
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
    event.respondWith(
      fetch(request).catch(() =>
        (CANVAS_PAGE.test(url.pathname)
          ? caches
              .open(CANVAS_SHELL_CACHE)
              .then((cache) => cache.match(url.pathname))
          : Promise.resolve(undefined)
        ).then((shell) => shell || caches.match("/offline")),
      ),
    );
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
