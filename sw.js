// MatchPoint service worker: makes the app installable and lets it open without a connection.
// Pages and scripts are network-first (so updates arrive at once); the cache is only a fallback.
// Supabase data is never cached here.
const CACHE = "matchpoint-v1";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "privacy.html", "delete-account.html",
  "icons/logo-512.png", "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;          // live data only
  if (url.pathname.endsWith("version.txt")) return;          // the update check must reach the network
  const sameOrigin = url.origin === self.location.origin;
  const isLib = url.hostname === "cdn.jsdelivr.net" || url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com");
  if (!sameOrigin && !isLib) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && (sameOrigin || isLib)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: sameOrigin}).then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});
