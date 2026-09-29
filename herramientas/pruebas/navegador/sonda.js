/* SONDA DE NAVEGADOR — se carga DENTRO de index.html, con Chrome de verdad.
 *
 * Hay fallos que no se ven leyendo el código (correr.js) ni con un DOM de
 * mentira (tablas.js), porque dependen de cómo el navegador PINTA las cosas.
 * Estos dos costaron caro y los dos aparecieron aquí:
 *
 *  1. El motor de tablas escribía el pie con innerHTML y con eso borraba los
 *     contadores que los módulos rellenan por `id` — 13 de 24. El módulo de
 *     Contactos reventaba después al escribir sobre algo que ya no existía.
 *
 *  2. Ctrl+P buscaba el botón de imprimir «visible» por su tamaño. Pero las
 *     ventanas de esta app no se esconden con display:none: se quedan con
 *     opacity 0. Todas medían, así que sin nada abierto pulsaba el botón de
 *     un recibo cerrado.
 *
 * Cómo se corre: ver el LEEME de esta carpeta.
 */
(function () {
  var LF = String.fromCharCode(10);
  var salida = [];
  var errores = [];
  window.addEventListener('error', function (e) { errores.push(e.message); });

  /* Los `id` que el HTML pone DENTRO de un pie de tabla. Si alguno falta del
     DOM después de arrancar, alguien lo borró. */
  var IDS_DEL_PIE = ['compShown', 'cuentasShown', 'despachosShown', 'invShown', 'invTotal',
    'leadsShown', 'pagosShown', 'socFundCount', 'socLiqTotal', 'socPorCobrar',
    'socReferidosCount', 'tercerosShown', 'tercerosTotal', 'despachosCount',
    'cxcCount', 'cxpCount', 'retCount', 'ventTabCount'];

  var fallas = 0;
  function ok(q, real, esperado) {
    var bien = String(real) === String(esperado);
    if (!bien) fallas++;
    salida.push((bien ? '  OK  ' : '  MAL ') + q + ' -> ' + real + (bien ? '' : '   (esperado ' + esperado + ')'));
  }
  function bloque(t) { salida.push('', t); }

  setTimeout(function () {
    /* ── 1. Nadie borra los contadores del pie ──────────────────────────── */
    bloque('Los contadores del pie siguen en su sitio');
    var faltan = IDS_DEL_PIE.filter(function (id) { return !document.getElementById(id); });
    ok('no falta ninguno de los ' + IDS_DEL_PIE.length, faltan.length ? faltan.join(', ') : 0, 0);

    /* ── 2. Las listas muestran TODAS sus filas ─────────────────────────── */
    bloque('Las listas muestran todo lo que se les mete');
    var CUANTAS = 11;
    var casos = [];
    [].slice.call(document.querySelectorAll('.data-table-wrap')).forEach(function (wrap) {
      var tabla = wrap.querySelector('table.data-table');
      if (!tabla || tabla.classList.contains('libro-table') || wrap.closest('.ret-view')) return;
      var tb = tabla.querySelector('tbody');
      if (!tb) return;
      var cols = tabla.querySelectorAll('thead th').length || 4;
      tb.innerHTML = '';
      for (var i = 1; i <= CUANTAS; i++) {
        var tr = document.createElement('tr'), tds = '';
        for (var c = 0; c < cols; c++) tds += '<td>' + (c ? 'x' : 'fila-' + i) + '</td>';
        tr.innerHTML = tds;
        tb.appendChild(tr);
      }
      casos.push({ wrap: wrap, tb: tb });
    });

    setTimeout(function () {
      var cortas = casos.filter(function (c) {
        return [].slice.call(c.tb.children).filter(function (r) { return r.style.display !== 'none'; }).length !== CUANTAS;
      });
      ok('las ' + casos.length + ' tablas muestran las ' + CUANTAS + ' filas', cortas.length, 0);

      /* ── 3. Ctrl+P pulsa el boton que toca, y solo cuando toca ────────── */
      bloque('Ctrl+P pulsa el boton que se este viendo');
      document.body.classList.add('authed');   // la app a la vista, como tras entrar

      var pulsado = null;
      document.querySelectorAll('button, .btn').forEach(function (b) {
        b.addEventListener('click', function (e) {
          if (/print/i.test(b.id) || /^imprimir\b/i.test((b.textContent || '').trim())) {
            pulsado = b.id || '(sin id)';
            e.stopImmediatePropagation();
            e.preventDefault();   // no imprimir de verdad
          }
        }, true);
      });
      function ctrlP() {
        pulsado = null;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }));
        return pulsado;
      }

      /* Sin nada abierto NO debe tocar nada: el navegador imprime como
         siempre. Aqui es donde se caia la version que miraba el tamaño. */
      ok('sin nada abierto no pulsa nada', ctrlP() || '(nadie)', '(nadie)');

      var ov = document.getElementById('reciboOverlay');
      ov.dataset.open = 'true';
      ok('con el recibo abierto pulsa el suyo', ctrlP() || '(nadie)', 'reciboPrint');

      /* Una ventana ENCIMA tapa el boton de abajo: entonces no se imprime
         nada, que es mejor que imprimir lo que quedo escondido. */
      var ficha = document.getElementById('prodRapidoModal');
      if (ficha) {
        ficha.hidden = false;
        ok('si otra ventana lo tapa, no pulsa', ctrlP() || '(nadie)', '(nadie)');
        ficha.hidden = true;
      }
      ov.dataset.open = 'false';

      bloque('Errores de JavaScript');
      ok('ninguno', errores.length ? errores.join(' | ') : 0, 0);

      salida.push('', fallas ? 'HAY ' + fallas + ' FALLA(S)' : 'TODO OK');
      var p = document.createElement('pre');
      p.id = 'SONDA';
      p.textContent = salida.join(LF);
      document.body.appendChild(p);
      document.title = fallas ? 'SONDA-FALLA' : 'SONDA-OK';
    }, 900);
  }, 2000);
})();
