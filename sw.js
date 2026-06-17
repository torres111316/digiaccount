/* Service Worker Â· DigiAccount PWA
   Estrategia: network-first (siempre trae lo Ãºltimo con conexiÃ³n;
   usa la copia en cachÃ© como respaldo cuando no hay red). */
const CACHE = 'digiaccount-v4';
const ASSETS = [
  './',
  './index.html',
  './assets/app.css',
  './assets/digiaccount.css',
  './assets/fonts.css',
  './assets/app.js',
  './assets/lucide.min.js',
  './assets/isotipo.png',
  './assets/isotipo-on-dark.png',
  './assets/pwa-192.png',
  './assets/pwa-512.png',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
