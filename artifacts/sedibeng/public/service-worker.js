const CACHE_NAME = "sedibeng-public-shell-v2";
const APP_SCOPE = self.registration.scope;
const OFFLINE_URL = new URL("offline.html", APP_SCOPE).toString();
const PUBLIC_STATIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|png|svg|webmanifest|webp|woff2)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll([
          APP_SCOPE,
          OFFLINE_URL,
          new URL("manifest.webmanifest", APP_SCOPE).toString(),
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("sedibeng-public-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const scopePath = new URL(APP_SCOPE).pathname;
  if (!url.pathname.startsWith(scopePath)) return;

  // Never cache API responses, authentication routes, or user-specific data.
  if (url.pathname.startsWith(`${scopePath}api/`)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match(request)) ||
          (await cache.match(APP_SCOPE)) ||
          (await cache.match(OFFLINE_URL))
        );
      }),
    );
    return;
  }

  if (!PUBLIC_STATIC_FILE.test(url.pathname)) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then(async (response) => {
          if (response.ok && response.type === "basic") {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        }),
    ),
  );
});
