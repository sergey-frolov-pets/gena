/* Gena service worker: offline app shell + runtime cache for same-origin GET.
   Agent calls are cross-origin POST — they pass through untouched. */
const CACHE = "gena-cache-v0.2.37";
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-dark.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-dark-192.png",
  "./icon-dark-512.png",
  "./fsvibe-logo.svg",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // Активы: отдаём из кэша, параллельно тихо обновляем из сети
  // (stale-while-revalidate) — обновления иконки/сборки подхватываются
  // на следующей загрузке, а не «залипают» навсегда.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
      if (cached) {
        network.catch(() => undefined);
        return cached;
      }
      return network;
    }),
  );
});
