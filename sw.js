// Offline support: the app files come from the network when online (so fixes arrive at once) and from the
// cache when offline; the stuhmer.hu photos and the fonts are cached as they are first shown.
const APP = "szc-app-v1";
const EXT = "szc-ext-v1";
const FILES = ["./", "index.html", "app.js", "match.js", "data.js", "manifest.webmanifest", "icon-180.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== EXT).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin === self.location.origin) {
    e.respondWith(fetch(req)
      .then((res) => { const copy = res.clone(); caches.open(APP).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.open(EXT).then((c) => c.match(req).then((hit) => {
      const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});
