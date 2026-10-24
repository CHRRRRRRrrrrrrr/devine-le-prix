// Cache de l'application pour l'installation PWA et le jeu hors ligne
// (les tuiles de carte restent en ligne). Incrémenter VERSION à chaque déploiement.
const VERSION = "dlp-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "icon.svg",
  "manifest.webmanifest",
  "data/lyon.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || e.request.url.includes("tile.openstreetmap.org")) return;
  // Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
