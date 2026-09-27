/* RESCATE · la puerta de salida cuando la app no abre
   ===================================================

   POR QUÉ EXISTE

   El service worker nuevo NO se activa solo: espera a que la app muestre el
   botón «Actualizar». Eso está bien cuando la app abre — nadie pierde lo que
   está haciendo a mitad de una factura.

   Pero si el que está activo es justamente el que impide abrir la app, ese
   botón no aparece nunca. El nuevo se queda esperando para siempre y el roto
   sigue sirviendo. Desinstalar la PWA no arregla nada: el service worker y su
   copia viven en el ORIGEN, no en la instalación — se reinstala y se
   encuentra exactamente lo mismo.

   Le pasó a Luis: desinstaló, reinstaló, y la app seguía sin abrir en el
   teléfono, mientras que desde el navegador entraba sin problema.

   Este archivo es lo primero que carga la página, antes que todo lo demás, y
   hace dos cosas.

   1. `?reset` en la dirección: borra el service worker y toda la copia
      guardada, y vuelve a cargar limpio. Es la puerta que se puede abrir
      SIEMPRE, aunque la app esté muerta, porque lo único que hace falta es
      que llegue el HTML.

          https://app.digiaccount.io/?reset

   2. Si pasan quince segundos y la app no dio señales de haber arrancado,
      pinta una pantalla que lo dice y ofrece el mismo botón. Sin esto, «no
      abre» es una pantalla en blanco sin nada que tocar y sin nada que
      contar.

   Y de paso enseña en qué estado está todo — qué service worker controla, qué
   copias hay guardadas — que es lo que hace falta para arreglarlo y no se
   puede ver desde un teléfono. */
(function () {
  'use strict';

  var SEGUNDOS = 15;
  var arranco = false;

  /* La llama app.js cuando termina de ejecutarse. Que app.js llegue hasta el
     final significa que todos los archivos llegaron y se entendieron, que es
     justo lo que falla cuando la copia guardada está mal. */
  window.__digiArranco = function () { arranco = true; };

  function limpiarTodo() {
    var tareas = [];

    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      tareas.push(navigator.serviceWorker.getRegistrations()
        .then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }).catch(function () {}));
    }

    if (window.caches && caches.keys) {
      tareas.push(caches.keys()
        .then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }).catch(function () {}));
    }

    return Promise.all(tareas).catch(function () {});
  }

  /* ── 1. La puerta: ?reset ────────────────────────────────────────────── */

  if (/(^|[?&#])(reset|reparar)\b/i.test(location.search + location.hash)) {
    limpiarTodo().then(function () {
      /* `replace` y no `href`: así el botón atrás no devuelve a la dirección
         con ?reset, que volvería a limpiar en bucle. */
      location.replace(location.pathname);
    });
    return;
  }

  /* ── 2. El vigilante ─────────────────────────────────────────────────── */

  function estado() {
    var partes = [];
    try {
      var ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
      partes.push(ctrl ? 'Controlada por un service worker.' : 'Sin service worker activo.');
    } catch (e) { partes.push('No se pudo leer el service worker.'); }
    return partes.join(' ');
  }

  function pintarRescate() {
    if (!document.body) return;

    var capa = document.createElement('div');
    capa.id = 'rescateDigi';
    capa.style.cssText = 'position:fixed;inset:0;z-index:2147483647;' +
      'background:#0a2342;color:#fff;display:flex;align-items:center;' +
      'justify-content:center;padding:24px;' +
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;';

    capa.innerHTML =
      '<div style="max-width:420px;width:100%;text-align:center;">' +
        '<div style="font-size:22px;font-weight:700;line-height:1.3;">' +
          'La app no terminó de abrir</div>' +
        '<div style="font-size:15px;line-height:1.6;margin-top:12px;opacity:.85;">' +
          'Casi siempre es la copia guardada en este dispositivo, que quedó a ' +
          'medias. Repararla la borra y la vuelve a bajar. ' +
          '<strong>No se pierde ningún dato</strong>: todo está en el servidor.' +
        '</div>' +
        '<button id="rescateBtn" type="button" style="width:100%;margin-top:22px;' +
        'padding:16px;border:none;border-radius:12px;background:#fff;' +
        'color:#0a2342;font-size:16px;font-weight:700;cursor:pointer;">' +
          'Reparar la app</button>' +
        '<button id="rescateEsperar" type="button" style="width:100%;margin-top:10px;' +
        'padding:14px;border:1px solid rgba(255,255,255,.35);border-radius:12px;' +
        'background:transparent;color:#fff;font-size:15px;cursor:pointer;">' +
          'Seguir esperando</button>' +
        '<div style="font-size:12px;line-height:1.5;margin-top:18px;opacity:.6;">' +
          estado() + '</div>' +
      '</div>';

    document.body.appendChild(capa);

    var btn = document.getElementById('rescateBtn');
    if (btn) btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Reparando…';
      limpiarTodo().then(function () { location.replace(location.pathname); });
    });

    var esperar = document.getElementById('rescateEsperar');
    if (esperar) esperar.addEventListener('click', function () { capa.remove(); });
  }

  setTimeout(function () {
    if (arranco) return;
    if (document.body) { pintarRescate(); return; }
    document.addEventListener('DOMContentLoaded', pintarRescate);
  }, SEGUNDOS * 1000);
})();
