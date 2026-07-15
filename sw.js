/* Service Worker · DigiAccount PWA
   Estrategia: network-first (con conexión siempre trae lo último; usa la copia
   en caché como respaldo cuando no hay red).

   Actualizaciones: la versión nueva NO se activa sola (nada de skipWaiting al
   instalar). Queda "esperando" y la app muestra el aviso "Hay una versión nueva
   → Actualizar". Al pulsarlo, la app manda ACTIVAR_YA y recién ahí toma el
   control. Así el usuario nunca pierde lo que está haciendo, pero tampoco se
   queda atascado en una versión vieja (en el teléfono no hay Ctrl+Shift+R). */
const CACHE = 'digiaccount-v5';
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
  // Se precarga el caché nuevo, pero NO se activa: espera el visto bueno del usuario.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La app pide activar la versión nueva (botón "Actualizar")
self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'ACTIVAR_YA') self.skipWaiting();
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
