/* Near service worker.
   App files (HTML/JS/CSS/manifest): network-first, so a new release shows on the next open; cache is the offline fallback.
   Fonts and icons: cache-first (they rarely change).
   VERSION is stamped automatically by the build — never edit it by hand. */
const VERSION = "near-202610092317-f5cbcaf"; // set by scripts/build.py on every build
const SHELL = ["./", "./index.html", "./src/app.css", "./src/i18n.js", "./src/palette.js", "./src/platform.js", "./src/store.js", "./src/app.js", "./manifest.webmanifest", "./manifest-ru.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function put(req, res) {
  if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin && url.pathname.startsWith("/api/")) return; // usage signal and stats go straight to the network
  const isFont = url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com");
  const isAppFile = sameOrigin && (req.mode === "navigate" || /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/"));

  if (isAppFile) {
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then(res => put(req, res))
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }
  if (sameOrigin || isFont) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => put(req, res))));
  }
});
