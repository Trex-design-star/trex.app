/* Trex service worker: fast app shell + offline page. Money data (/api) is NEVER cached. */
const VERSION = "trex-v2";
const SHELL = VERSION + "-shell", RUNTIME = VERSION + "-runtime";
const PRECACHE = ["/", "/index.html", "/signin.html", "/onboarding.html", "/offline.html", "/css/app.css", "/js/api.js", "/js/app.js", "/js/trex.js", "/js/pwa.js", "/js/chat.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); if (e.data === "clear") caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))); });

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;           // never touch other sites or writes
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return;   // live money data: network only
  if (req.mode === "navigate") {                                                 // pages: network first, cached copy, then offline page
    e.respondWith(
      fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(RUNTIME).then((c) => c.put(req, cp)); } return r; })
        .catch(() => caches.match(req).then((m) => m || caches.match("/offline.html")))
    );
    return;
  }
  e.respondWith(                                                                 // assets: instant from cache, refreshed in background
    caches.match(req).then((m) => {
      const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(RUNTIME).then((c) => c.put(req, cp)); } return r; }).catch(() => m);
      return m || net;
    })
  );
});
