/* SONDA DE NAVEGADOR — se carga DENTRO de index.html, con Chrome de verdad.
 *
 * Hay fallos que no se ven leyendo el código (correr.js) ni con un DOM de
 * mentira (tablas.js), porque dependen de cómo el navegador PINTA y MIDE.
 * Los tres que la motivaron:
 *
 *  1. El motor de tablas escribía el pie con innerHTML y con eso borraba los
 *     contadores que los módulos rellenan por `id` — 13 de 24.
 *
 *  2. Ctrl+P buscaba el botón de imprimir «visible» por su tamaño. Las
 *     ventanas de esta app no se esconden con display:none: se quedan con
 *     opacity 0. Todas medían, así que sin nada abierto pulsaba el botón de
 *     un recibo cerrado.
 *
 *  3. `.app` medía `100vh`, que en un móvil es lo que se vería SIN la barra
 *     del navegador. El último trozo de la app —donde vive el pie de las
 *     listas con su paginador— quedaba debajo de esa barra, inalcanzable.
 *
 *  4. Un parche borró `let lastReciboText = '';` en nomina.js. Sintaxis
 *     válida, así que nada avisó; pero al pulsar «Recibo» saltaba un
 *     ReferenceError y NO se abría el recibo de ningún trabajador. Aquí se
 *     abre uno por el camino de verdad: botón de la tabla, clic, modal.
 *
 *  (el 3 sigue abajo)
 *     del navegador. El último trozo de la app —donde vive el pie de las
 *     listas con su paginador— quedaba debajo de esa barra, inalcanzable.
 *
 * Ninguno da error en consola. Cómo se corre: ver el LEEME de esta carpeta.
 */
(function () {
  var LF = String.fromCharCode(10);
  var salida = [];
  var errores = [];
  var fallas = 0;
  window.addEventListener('error', function (e) { errores.push(e.message); });

  var ESTRECHO = window.innerWidth <= 560;   // la app cambia de traje aquí

  /* Los `id` que el HTML pone DENTRO de un pie de tabla. Si alguno falta del
     DOM después de arrancar, alguien lo borró. */
  var IDS_DEL_PIE = ['compShown', 'cuentasShown', 'despachosShown', 'invShown', 'invTotal',
    'leadsShown', 'pagosShown', 'socFundCount', 'socLiqTotal', 'socPorCobrar',
    'socReferidosCount', 'tercerosShown', 'tercerosTotal', 'despachosCount',
    'cxcCount', 'cxpCount', 'retCount', 'ventTabCount'];

  function ok(q, real, esperado) {
    var bien = String(real) === String(esperado);
    if (!bien) fallas++;
    salida.push((bien ? '  OK  ' : '  MAL ') + q + ' -> ' + real + (bien ? '' : '   (esperado ' + esperado + ')'));
  }
  function bloque(t) { salida.push('', t); }

  setTimeout(function () {
    document.body.classList.add('authed');   // la app a la vista, como tras entrar

    /* ── 0. SE ABRE EL RECIBO DE UN TRABAJADOR ───────────────────────────

       Por el camino de verdad: se le da a la app un Supabase de mentira con
       un trabajador, se carga Nomina, se pulsa «Recibo» en la tabla y se mira
       si el modal se abre. Va PRIMERO porque las demas comprobaciones
       rellenan todas las tablas con filas de prueba, esta incluida. */
    var sbReal = window.sb, empresaReal = window.__EMPRESA_ACTIVA, cuentaReal = window.__CUENTA_ID;
    var TRABAJADOR = {
      id: 'emp-1', cuenta_id: 'c1', empresa_id: 'e1', nombre: 'TRABAJADOR DE PRUEBA',
      cedula: 'V-1.234.567', cargo: 'Panadero', depto: 'Produccion', tipo: 'Planta',
      ingreso: '2023-02-03', salario_mes: 7000, bono_usd: 0, bono_label: '',
      forma_pago: 'Transferencia bancaria', frecuencia: 'semanal', color: '#0a2540',
      ini: 'TP', activo: true, sujeto_dpp: true, transporte_usd: 0, prestamo_cuota: 0,
      caja_ahorro_pct: 0, contingencia_bs: 0, contingencia_usd: 0,
    };
    function tablaFalsa(nombre) {
      var datos = nombre === 'empleados' ? [TRABAJADOR] : [];
      var api = {
        select: function () { return api; }, eq: function () { return api; },
        is: function () { return api; }, in: function () { return api; },
        order: function () { return Promise.resolve({ data: datos, error: null }); },
        limit: function () { return Promise.resolve({ data: datos, error: null }); },
        single: function () { return Promise.resolve({ data: datos[0] || null, error: null }); },
        then: function (f) { return Promise.resolve({ data: datos, error: null }).then(f); },
        insert: function () { return Promise.resolve({ data: null, error: null }); },
        update: function () { return api; }, delete: function () { return api; },
      };
      return api;
    }
    window.__CUENTA_ID = 'c1';
    window.__EMPRESA_ACTIVA = { id: 'e1', n: 'EMPRESA DE PRUEBA', rif: 'J000000000' };
    window.sb = { from: tablaFalsa, auth: { getSession: function () { return Promise.resolve({ data: { session: null } }); } } };

    var erroresRecibo = [];
    var oirErrores = function (e) { erroresRecibo.push(e.message); };

    bloque('Se abre el recibo de un trabajador');
    if (!window.cargarEmpleados) {
      ok('existe window.cargarEmpleados', false, true);
    } else {
      window.cargarEmpleados();
    }

    setTimeout(function () {
      var btnRecibo = document.querySelector('button[data-emp-idx]');
      ok('la tabla de Nomina tiene el boton «Recibo»', !!btnRecibo, true);
      window.addEventListener('error', oirErrores);
      if (btnRecibo) btnRecibo.click();

      setTimeout(function () {
        window.removeEventListener('error', oirErrores);
        var ovR = document.getElementById('reciboOverlay');
        var hojaR = document.getElementById('reciboHoja');
        ok('al pulsarlo no salta ningun error', erroresRecibo.length ? erroresRecibo.join(' | ') : 0, 0);
        ok('el recibo se abre', ovR && ovR.dataset.open, 'true');
        /* En pantalla, UN recibo (asi lo pidio Luis: la pareja se veia mal). */
        ok('en pantalla se ve un solo recibo',
          hojaR ? hojaR.querySelectorAll('.recibo-doc').length : 0, 1);
        /* Y al imprimir, los dos: se dispara lo mismo que dispara el navegador. */
        window.dispatchEvent(new Event('beforeprint'));
        var portalR = document.getElementById('printPortal');
        ok('al imprimir salen las dos copias',
          portalR ? portalR.querySelectorAll('.recibo-mitad .recibo-doc').length : 0, 2);
        window.dispatchEvent(new Event('afterprint'));
        ok('y la pantalla sigue con uno despues de imprimir',
          hojaR ? hojaR.querySelectorAll('.recibo-doc').length : 0, 1);

        /* Se deja todo como estaba para lo que viene detras. */
        if (ovR) ovR.dataset.open = 'false';
        window.sb = sbReal; window.__EMPRESA_ACTIVA = empresaReal; window.__CUENTA_ID = cuentaReal;
        seguir();
      }, 700);
    }, 900);
  }, 2000);

  function seguir() {
    /* ── 1. Nadie borra los contadores del pie ──────────────────────────── */
    bloque('Los contadores del pie siguen en su sitio');
    var faltan = IDS_DEL_PIE.filter(function (id) { return !document.getElementById(id); });
    ok('no falta ninguno de los ' + IDS_DEL_PIE.length, faltan.length ? faltan.join(', ') : 0, 0);

    /* ── 2. El alto de la app es el que SE VE ───────────────────────────── */
    bloque('El alto de la app es el que se ve, no el teorico');
    var app = document.getElementById('app') || document.querySelector('.app');
    ok('el navegador entiende dvh', window.CSS && CSS.supports && CSS.supports('height', '100dvh'), true);
    ok('el alto de .app es el alto visible',
      Math.round(parseFloat(getComputedStyle(app).height)), window.innerHeight);

    /* ── 3. Las listas muestran TODAS sus filas ─────────────────────────── */
    bloque('Las listas muestran todo lo que se les mete');
    var CUANTAS = 25;   // mas de una pagina, para que HAYA paginador
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
      var POR_PAGINA = 20;
      var cortas = casos.filter(function (c) {
        var v = [].slice.call(c.tb.children).filter(function (r) { return r.style.display !== 'none'; }).length;
        return v !== POR_PAGINA && v !== CUANTAS;   // 20 si pagina, 25 si el modulo manda
      });
      ok('las ' + casos.length + ' tablas pintan su pagina entera', cortas.length, 0);

      /* ── 4. SE LLEGA AL PAGINADOR ─────────────────────────────────────

         Esto es lo que Luis no podia hacer desde el telefono. Los botones
         estaban puestos, con su tamaño, respondiendo — debajo de la barra
         del navegador.

         La pagina no se desplaza (`body` con overflow hidden): el que se
         mueve es `.content`. Se le empuja hasta el final y se mira si el
         paginador queda DENTRO de su area visible. */
      bloque('Se llega al paginador de la lista de Ventas');
      var vista = document.getElementById('view-ventas');
      if (vista) { vista.hidden = false; vista.dataset.active = 'true'; vista.style.display = ''; }
      var pane = document.querySelector('.ventas-tab[data-tab="facturas"]');
      var wrap = pane && pane.querySelector('.data-table-wrap');
      var pager = wrap && wrap.querySelector('.pager');

      if (!pager || !pager.querySelector('button')) {
        ok('hay paginador en la lista de Ventas', 'no hay', 'lo hay');
      } else {
        var scroller = null;
        for (var m = pager.parentElement; m && m !== document.documentElement; m = m.parentElement) {
          var cs = getComputedStyle(m);
          if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && m.scrollHeight > m.clientHeight + 2) { scroller = m; break; }
        }
        ok('algo se desplaza para alcanzarlo', !!scroller, true);
        if (scroller) {
          scroller.scrollTop = scroller.scrollHeight;
          var rp = pager.getBoundingClientRect();
          var rs = scroller.getBoundingClientRect();
          ok('el paginador entra en el area visible',
            rp.bottom <= rs.bottom + 1 && rp.top >= rs.top - 1, true);
          ok('y dentro de la pantalla',
            rp.bottom <= window.innerHeight + 1, true);
        }

        /* En el telefono, un boton de 28px se falla con el dedo. */
        if (ESTRECHO) {
          var b = pager.querySelector('button');
          var rb = b.getBoundingClientRect();
          ok('el boton se puede pulsar con el dedo (>=40px)',
            Math.round(rb.width) >= 40 && Math.round(rb.height) >= 40,
            true);
        }
      }

      /* ── 5. Ctrl+P pulsa el boton que toca, y solo cuando toca ────────── */
      bloque('Ctrl+P pulsa el boton que se este viendo');
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

      salida.unshift('pantalla: ' + window.innerWidth + ' x ' + window.innerHeight
        + (ESTRECHO ? '  (traje de telefono)' : '  (traje de escritorio)'));
      salida.push('', fallas ? 'HAY ' + fallas + ' FALLA(S)' : 'TODO OK');
      var p = document.createElement('pre');
      p.id = 'SONDA';
      p.textContent = salida.join(LF);
      document.body.appendChild(p);
      document.title = fallas ? 'SONDA-FALLA' : 'SONDA-OK';
    }, 900);
  }
})();
