/* Service Worker · DigiAccount PWA
   Estrategia: network-first (con conexión siempre trae lo último; usa la copia
   en caché como respaldo cuando no hay red).

   Actualizaciones: la versión nueva NO se activa sola (nada de skipWaiting al
   instalar). Queda "esperando" y la app muestra el aviso "Hay una versión nueva
   → Actualizar". Al pulsarlo, la app manda ACTIVAR_YA y recién ahí toma el
   control. Así el usuario nunca pierde lo que está haciendo, pero tampoco se
   queda atascado en una versión vieja (en el teléfono no hay Ctrl+Shift+R). */
/* Sube de número en cada cambio de estos archivos: es lo que hace que el
   navegador se traiga la versión nueva en vez de servir la del caché. */
const CACHE = 'digiaccount-v151';
const ASSETS = [
  './',
  './index.html',
  './assets/app.css',
  './assets/digiaccount.css',
  './assets/fonts.css',
  './assets/rescate.js',
  './assets/supabase-init.js',
  './assets/core.js',
  './assets/app.js',
  './assets/retenciones.js',
  './assets/tesoreria.js',
  './assets/facturas.js',
  './assets/contabilidad.js',
  './assets/inventario.js',
  './assets/terceros.js',
  './assets/nomina.js',
  './assets/lucide.min.js',
  './assets/vendor/supabase.js',
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

/* CUANTO SE ESPERA A LA RED ANTES DE USAR LA COPIA GUARDADA.

   Esto faltaba, y es lo que hacia que la app no abriera.

   La estrategia era «primero la red» SIN limite de tiempo. Una peticion que
   no falla pero tampoco contesta —datos moviles flojos, la red del local a
   media tarde— deja la app esperando para siempre. El `catch` de abajo solo
   salta cuando la red falla DE VERDAD; una que se queda pensando no lo
   dispara nunca.

   Por eso en el escritorio pasaba «a veces» —ahi casi siempre contesta— y en
   el telefono no abria nunca. Y por eso cerrar y volver a abrir a veces lo
   arreglaba: era otro intento con mejor suerte.

   Cuatro segundos: mas que suficiente para una red que funciona, y poco para
   quedarse mirando una pantalla en blanco.

   LO QUE NO CAMBIA: si la red contesta, gana la red. Un despliegue nuevo
   sigue llegando en la primera recarga con conexion buena. La copia solo
   entra cuando la red no llego a tiempo — y aun asi la peticion sigue su
   curso y deja el archivo fresco para la proxima. */
const ESPERA_RED = 4000;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  e.respondWith(new Promise((resolve) => {
    let resuelto = false;
    const responder = (r) => { if (!resuelto) { resuelto = true; resolve(r); } };

    /* Si la red tarda mas de la cuenta y hay copia, se sirve la copia. Si NO
       hay copia no se hace nada: mas vale seguir esperando que devolver un
       error cuando la red todavia puede contestar. */
    const reloj = setTimeout(() => {
      if (resuelto) return;
      caches.match(req).then((r) => { if (r) responder(r); });
    }, ESPERA_RED);

    fetch(req)
      .then((res) => {
        clearTimeout(reloj);
        /* Solo se guarda lo que salio BIEN y es nuestro.

           Antes se guardaba cualquier respuesta: si el servidor contestaba
           una vez con un 500 o con la pagina de error de Cloudflare, esa
           basura quedaba en la copia y se seguia sirviendo aunque el
           servidor ya estuviera sano.

           Esto se hace AUNQUE la copia ya se haya servido por el reloj: asi
           la proxima vez la copia es la buena. */
        if (res && res.ok && res.type === 'basic') {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        }
        responder(res);
      })
      .catch(() => {
        clearTimeout(reloj);
        caches.match(req).then((r) => {
          if (r) { responder(r); return; }
          /* El index.html SOLO sirve de respaldo para una NAVEGACION.

             Antes se devolvia para cualquier cosa que fallara, incluidos el
             CSS y el JS. El navegador pedia la hoja de estilos y recibia
             HTML: la pagina quedaba sin estilos, con todo desplegado hacia
             abajo y aspecto de formulario viejo, como si el sistema se
             hubiera roto. Para un archivo que no es navegacion es mejor
             fallar de verdad —asi el navegador lo reintenta— que entregarle
             un contenido que no es el que pidio. */
          if (req.mode === 'navigate') {
            caches.match('./index.html').then((idx) => responder(idx || Response.error()));
            return;
          }
          responder(Response.error());
        });
      });
  }));
});
