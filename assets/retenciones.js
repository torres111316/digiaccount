/* =========================================================
   DigiAccount ERP — RETENCIONES
   Retenciones de IVA e ISLR: las practicadas y las sufridas, el comprobante
   impreso, el correlativo y la quincena.

   Salio de app.js por lo mismo que la nomina: es un bloque grande que casi
   no depende de nadie. De las veinte mil lineas del bloque grande solo usaba
   dos cosas —`esc` y `drawIcons`—, que ya viven en el nucleo.

   Se carga DESPUES de app.js: lo que expone (las retenciones de una factura,
   las del rango, el comprobante) lo consumen el modulo fiscal y el de
   compras a traves de `window.__*`, y lo que necesita de ellos tambien.
   ========================================================= */
(function () {
  'use strict';

  // Los dos nombres cortos que usa el cuerpo, apuntando al nucleo.
  const esc = window.__esc;
  const drawIcons = window.__drawIcons;

  /* =========================================================
     PESTAÑA RETENCIONES — Practicadas / Sufridas + recibo
     ========================================================= */
  (function retenciones() {
    const nav = document.getElementById('retDirNav');
    if (!nav) return;
    const dirBtns = nav.querySelectorAll('button');
    const views = document.querySelectorAll('.ret-view');
    const fchips = document.querySelectorAll('.ret-fchip');
    const summary = document.getElementById('retSummary');
    const countEl = document.getElementById('retCount');

    let curDir = 'practicadas';
    let curFilter = 'todos';

    const fmt = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const parseNum = (s) => {
      const t = (s || '').trim();
      if (!t || t === '—') return 0;
      return parseFloat(t.replace(/\./g, '').replace(',', '.')) || 0;
    };

    function activeView() {
      return document.querySelector('.ret-view[data-retview="' + curDir + '"]');
    }
    function rows() {
      return Array.from(activeView().querySelectorAll('tbody tr'));
    }

    // Aplica el filtro IVA/ISLR a las filas de la vista activa
    function applyFilter() {
      let shown = 0, total = 0;
      rows().forEach((tr) => {
        const t = tr.dataset.rettype;
        if (!t) { tr.hidden = false; return; } // fila de estado vacío
        const visible = curFilter === 'todos' || curFilter === t;
        tr.hidden = !visible;
        total++;
        if (visible) shown++;
      });
      const noun = curDir === 'practicadas' ? 'practicados' : 'sufridos';
      /* El total sale de los DATOS del período, no de las filas visibles: la
         tabla se pagina de 20 en 20 y antes decía "de 20" habiendo 47. */
      const arrDir = _retPageArr[curDir] || [];
      const totalPeriodo = curFilter === 'todos' ? arrDir.length : arrDir.filter((r) => r.tipo === curFilter).length;
      if (countEl) {
        countEl.innerHTML = totalPeriodo > shown
          ? 'Mostrando <strong>' + shown + '</strong> de <strong>' + totalPeriodo + '</strong> comprobantes ' + noun + ' del período'
          : 'Mostrando <strong>' + totalPeriodo + '</strong> comprobante' + (totalPeriodo === 1 ? '' : 's') + ' ' + noun + ' del período';
      }
    }

    /* Recalcula las tarjetas de resumen SOBRE LOS DATOS del período.

       Antes las sumaba leyendo las filas pintadas en la tabla, y la tabla
       está paginada de 20 en 20: el resumen mostraba el total de la PÁGINA,
       no el del período. Con más de 20 comprobantes el número salía corto y
       nada avisaba — la Forma 30, que sí usa los datos completos, daba otra
       cifra y era la buena.

       Es la clase de error que se descubre después de declarar. */
    function refreshSummary() {
      const arr = _retPageArr[curDir] || [];
      /* Los porcentajes se juntan TODOS, no se queda el último.
         Antes arrancaban en '75%' y '3%' escritos a mano y cada retención
         pisaba al anterior: con un proveedor al 75% y otro al 100%, el
         resumen mostraba el de la última fila leída y parecía que todas
         fueron a ese porcentaje. No siempre se retiene el 75%. */
      let ivaT = 0, ivaC = 0, islrT = 0, islrC = 0;
      const pctIva = new Set(), pctIslr = new Set();
      arr.forEach((r) => {
        const monto = Number(r.monto) || 0;
        const p = Number(r.pct) || 0;
        const pctTxt = (Number.isInteger(p) ? p : p.toFixed(2)) + '%';
        if (r.tipo === 'iva') { ivaT += monto; ivaC++; if (p) pctIva.add(pctTxt); }
        else { islrT += monto; islrC++; if (p) pctIslr.add(pctTxt); }
      });
      // Uno solo se nombra; varios se enumeran; ninguno no dice nada.
      const juntar = (s) => {
        const v = [...s].sort((a, b) => parseFloat(a) - parseFloat(b));
        return v.length === 0 ? '' : v.length <= 3 ? v.join(' y ') : v.length + ' porcentajes';
      };
      const ivaPct = juntar(pctIva), islrPct = juntar(pctIslr);
      const totT = ivaT + islrT, totC = ivaC + islrC;
      const q = (sel) => summary.querySelector('[data-sum="' + sel + '"]');
      q('iva').textContent = 'Bs ' + fmt(ivaT);
      q('iva-c').textContent = ivaC + ' comprobante' + (ivaC === 1 ? '' : 's') + (ivaPct ? ' · ' + ivaPct : '');
      q('islr').textContent = 'Bs ' + fmt(islrT);
      q('islr-c').textContent = islrC + ' comprobante' + (islrC === 1 ? '' : 's') + (islrPct ? ' · ' + islrPct : '');
      q('total').textContent = 'Bs ' + fmt(totT);
      /* El período REAL. Decía "2da quincena May 2026" escrito a mano desde la
         maqueta: se quedó ahí en mayo y siguió diciendo mayo en cualquier
         empresa y cualquier mes. */
      const noun = curDir === 'practicadas' ? _perLabelRet() : 'sufridas en ventas';
      q('total-c').textContent = totC + ' comprobante' + (totC === 1 ? '' : 's') + ' · ' + noun;
    }

    dirBtns.forEach((b) => b.addEventListener('click', () => {
      curDir = b.dataset.retdir;
      dirBtns.forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
      views.forEach((v) => (v.hidden = v.dataset.retview !== curDir));
      refreshSummary();
      applyFilter();
      drawIcons();
    }));

    fchips.forEach((c) => c.addEventListener('click', () => {
      curFilter = c.dataset.retfilter;
      fchips.forEach((x) => x.classList.toggle('active', x === c));
      applyFilter();
    }));

    /* ---- Recibo / reporte del período ---- */
    const overlay = document.getElementById('retReciboOverlay');
    const openBtn = document.getElementById('retReciboBtn');
    const closeBtn = document.getElementById('retReciboClose');
    const printBtn = document.getElementById('retReciboPrint');

    function buildRecibo() {
      /* Se arma sobre los DATOS del período, no sobre las filas pintadas.

         Antes leía `rows().filter(tr => !tr.hidden)`, y la tabla se pagina de
         20 en 20: el "recibo del período" salía con las 20 primeras. Un recibe
         incompleto de retenciones es peor que ninguno, porque parece completo. */
      const todas = (_retPageArr[curDir] || [])
        .filter((r) => curFilter === 'todos' || r.tipo === curFilter);
      const body = document.getElementById('rrTableBody');
      let ivaT = 0, ivaC = 0, islrT = 0, islrC = 0, gran = 0;
      body.innerHTML = '';
      todas.forEach((r) => {
        const monto = Number(r.monto) || 0;
        gran += monto;
        const esIva = r.tipo === 'iva';
        if (esIva) { ivaT += monto; ivaC++; } else { islrT += monto; islrC++; }
        const p = Number(r.pct) || 0;
        const pctTxt = (Number.isInteger(p) ? p : p.toFixed(2)) + '%';
        const tipoTag = esIva ? '<span class="tag cyan">IVA</span>' : '<span class="tag navy">ISLR</span>';
        body.insertAdjacentHTML('beforeend',
          '<tr><td>' + esc(r.fecha || '') + '</td><td class="mono">' + esc(r.comprobante || '') + '</td><td>' + tipoTag +
          '</td><td class="mono">' + esc(r.tercero_rif || '') + '</td><td>' + esc(r.tercero_nombre || '') + '</td><td class="mono">' + esc(r.factura || '') +
          '</td><td class="num">' + fmt(Number(r.base) || 0) + '</td><td class="num">' + pctTxt + '</td><td class="num">' + fmt(monto) + '</td></tr>');
      });
      document.getElementById('rrTableTotal').textContent = fmt(gran);

      /* Cabecera con los datos REALES. Venían escritos a mano de la maqueta:
         un RIF en blanco, la palabra "Contribuyente Especial" y una dirección
         de Valencia que no es de nadie. Un documento que se imprime y se
         archiva no puede llevar datos de ejemplo. */
      const emp = window.__EMPRESA_ACTIVA || {};
      const set = (id, txt) => { const el = document.getElementById(id); if (el) el.innerHTML = txt; };
      set('rrName', esc(emp.n || 'Empresa'));
      set('rrMeta', '<span class="mono">RIF ' + esc(emp.rif || '—') + '</span>'
        + (emp.cond ? ' · ' + esc(emp.cond) : '')
        + (emp.dom ? '<br>' + esc(emp.dom) : ''));
      const per = window.__fiscalPer;
      const perTxt = per && per.mm ? (_MESES_RET[parseInt(per.mm, 10) - 1] + ' 20' + per.aa) : '';
      set('rrPeriod', esc(perTxt) + (per && per.mm ? '<br><span class="mono">Período 20' + esc(per.aa) + '-' + esc(per.mm) + '</span>' : ''));
      set('rrTotIva', 'Bs ' + fmt(ivaT));
      set('rrCntIva', ivaC + ' comprobante' + (ivaC === 1 ? '' : 's'));
      set('rrTotIslr', 'Bs ' + fmt(islrT));
      set('rrCntIslr', islrC + ' comprobante' + (islrC === 1 ? '' : 's'));
      set('rrTotAll', 'Bs ' + fmt(gran));
      set('rrCntAll', (ivaC + islrC) + ' comprobante' + ((ivaC + islrC) === 1 ? '' : 's'));

      // Cabecera y totales según dirección
      const eyebrow = document.getElementById('rrEyebrow');
      const kind = document.getElementById('rrKind');
      if (curDir === 'practicadas') {
        eyebrow.textContent = 'Agente de Retención';
        kind.innerHTML = 'Recibo de Retenciones<br><span>Practicadas a proveedores</span>';
      } else {
        eyebrow.textContent = 'Sujeto Retenido';
        kind.innerHTML = 'Recibo de Retenciones<br><span>Sufridas — retenidas por clientes</span>';
      }
      const tg = document.getElementById('rrTotGrid');
      tg.querySelector('.iva .v').textContent = 'Bs ' + fmt(ivaT);
      tg.querySelector('.iva .c').textContent = ivaC + ' comprobante' + (ivaC === 1 ? '' : 's');
      tg.querySelector('.islr .v').textContent = 'Bs ' + fmt(islrT);
      tg.querySelector('.islr .c').textContent = islrC + ' comprobante' + (islrC === 1 ? '' : 's');
      tg.querySelector('.total .v').textContent = 'Bs ' + fmt(gran);
      tg.querySelector('.total .c').textContent = (ivaC + islrC) + ' comprobante' + ((ivaC + islrC) === 1 ? '' : 's');
    }

    if (openBtn) openBtn.addEventListener('click', () => {
      buildRecibo();
      overlay.hidden = false;
      drawIcons();
    });
    if (closeBtn) closeBtn.addEventListener('click', () => (overlay.hidden = true));
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
    if (printBtn) printBtn.addEventListener('click', () => {
      const doc = document.getElementById('retReciboDoc');
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = doc.cloneNode(true);
      clon.classList.add('reln-print');
      portal.appendChild(clon);
      document.body.classList.add('printing-comp');
      window.print();
    });
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
    });

    /* ---- Datos reales: registrar y cargar comprobantes de retención ---- */
    const normRif = (s) => (s || '').toUpperCase().replace(/[\s.\-]/g, '');
    function rowHtml(r) {
      const esIva = r.tipo === 'iva';
      const tag = esIva ? '<span class="tag cyan">IVA</span>' : '<span class="tag navy">ISLR</span>';
      const pct = Number(r.pct) || 0;
      const pctTxt = (Number.isInteger(pct) ? pct : pct.toFixed(2)) + '%';
      return '<tr data-rettype="' + (esIva ? 'iva' : 'islr') + '" data-id="' + esc(String(r.id)) + '" style="cursor:pointer;" title="Clic para editar o eliminar">'
        + '<td>' + esc(r.fecha || '') + '</td><td class="mono">' + esc(r.comprobante || '') + '</td><td>' + tag + '</td>'
        + '<td class="mono">' + esc(r.tercero_rif || '') + '</td><td class="primary">' + esc(r.tercero_nombre || '') + '</td>'
        + '<td class="mono">' + esc(r.factura || '') + '</td><td class="num">' + fmt(Number(r.base) || 0) + '</td>'
        + '<td class="num">' + pctTxt + '</td><td class="num">' + fmt(Number(r.monto) || 0) + '</td>'
        + '<td><span class="tag success">' + esc(r.estado || 'Registrado') + '</span> '
        /* Imprimir desde la propia fila, y SOLO en las practicadas.

           El comprobante de retención lo emite el AGENTE —quien retiene—
           con su propia numeración (Providencia SNAT/2015/0049). En una
           sufrida el agente es el CLIENTE: él nos manda su comprobante y
           nosotros lo archivamos.

           Aquí se ofrecía en las dos, y el comentario hasta lo defendía
           diciendo que en las sufridas «es donde más falta hace». Es al
           revés: imprimir una versión propia es fabricar un documento que
           uno no tiene autoridad para emitir, con la plantilla oficial y
           nuestros datos en la casilla del agente de retención. */
        + (r.direccion === 'practicada'
            ? '<button class="icon-btn ret-print" data-retprint="' + esc(String(r.id)) + '" title="Imprimir el comprobante">'
              + '<i data-lucide="printer"></i></button>'
            : '<span class="ret-sin-print" title="El comprobante de una retención sufrida lo emite el cliente: se archiva el suyo, no se imprime uno propio."></span>')
        + '</td></tr>';
    }
    const _retPage = { practicadas: 1, sufridas: 1 };   // página actual por dirección (20 por página)
    const _retPageArr = { practicadas: [], sufridas: [] }; // datos vigentes para re-pintar al paginar
    function pintar(dir, arr, page) {
      const v = document.querySelector('.ret-view[data-retview="' + dir + '"]');
      const tb = v && v.querySelector('tbody');
      if (!tb) return;
      _retPageArr[dir] = arr;
      if (!arr.length) {
        tb.innerHTML = '<tr class="ret-empty"><td colspan="10" style="text-align:center;color:var(--fg-muted);padding:16px;">Sin retenciones registradas. Usa “Registrar retención”.</td></tr>';
        return;
      }
      const PAG = 20;
      const totalPag = Math.max(1, Math.ceil(arr.length / PAG));
      const pag = Math.min(Math.max(1, page || 1), totalPag);
      _retPage[dir] = pag;
      const ini = (pag - 1) * PAG;
      let html = arr.slice(ini, ini + PAG).map(rowHtml).join('');
      if (totalPag > 1) {
        html += '<tr><td colspan="10" style="padding:6px 10px;"><div style="display:flex;justify-content:center;align-items:center;gap:14px;font-size:12px;color:var(--fg-muted);">'
          + '<button class="btn btn-ghost" data-rp="' + dir + '" data-rp-dir="-1"' + (pag <= 1 ? ' disabled' : '') + ' style="height:26px;font-size:11px;">« Anterior</button>'
          + '<span>Página ' + pag + ' de ' + totalPag + ' · ' + arr.length + ' retenciones</span>'
          + '<button class="btn btn-ghost" data-rp="' + dir + '" data-rp-dir="1"' + (pag >= totalPag ? ' disabled' : '') + ' style="height:26px;font-size:11px;">Siguiente »</button>'
          + '</div></td></tr>';
      }
      tb.innerHTML = html;
    }
    document.addEventListener('click', (e) => {
      const pr = e.target.closest('button[data-retprint]');
      if (pr) {
        e.stopPropagation(); // no abrir también el modal de editar
        const r = _retData.find((x) => String(x.id) === pr.dataset.retprint);
        if (r) imprimirComprobante(r);
        return;
      }
      const b = e.target.closest('button[data-rp]');
      if (b && !b.disabled) {
        pintar(b.dataset.rp, _retPageArr[b.dataset.rp] || [], (_retPage[b.dataset.rp] || 1) + parseInt(b.dataset.rpDir, 10));
        // El resumen ya no depende de lo pintado, pero el contador de
        // "Mostrando X de Y" sí: se refresca al cambiar de página.
        applyFilter();
      }
    });
    let _retData = []; // últimas retenciones cargadas (para editar/eliminar por id)

    /* Quincena que se está mirando en ESTE módulo. 0 = el mes completo.
       Vive aparte del período de Fiscal porque las dos obligaciones no van
       al mismo ritmo: una firma personal especial declara el IVA mensual y
       entera las retenciones cada quincena. */
    let _retQuincena = 0;
    // Las retenciones del MES completo, sin partir por quincena.
    let _retMes = [];
    (function selectorQuincenaRet() {
      const nav = document.getElementById('retQuincenaNav');
      if (!nav) return;
      const btns = nav.querySelectorAll('button');
      // Solo se ofrece a quien entera por quincena; a los demás les sobra.
      window.__syncRetQuincena = function () {
        const aplica = window.__retencionesPorQuincena && window.__retencionesPorQuincena();
        nav.hidden = !aplica;
        if (!aplica && _retQuincena !== 0) {
          // Al cambiar a una empresa que no separa, se vuelve al mes completo:
          // dejarla en "1ra" le escondería la mitad de sus retenciones.
          _retQuincena = 0;
          btns.forEach((b) => (b.dataset.active = b.dataset.retq === '0' ? 'true' : 'false'));
        }
      };
      btns.forEach((b) => b.addEventListener('click', () => {
        _retQuincena = parseInt(b.dataset.retq, 10) || 0;
        btns.forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
        if (window.cargarRetenciones) window.cargarRetenciones();
      }));
    })();

    // El período que se está mirando ahora mismo en el módulo Fiscal.
    const _MESES_RET = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    function _periodoVigente() {
      const p = window.__fiscalPer;
      if (p && p.mm && p.aa) return '20' + p.aa + '-' + p.mm;
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }
    /* El período que se está mirando, en palabras. Sigue al selector del
       módulo Fiscal, incluida la quincena cuando la empresa declara así. */
    function _perLabelRet() {
      const p = window.__fiscalPer;
      if (!p || !p.mm || !p.aa) return 'del período';
      const mes = _MESES_RET[parseInt(p.mm, 10) - 1] + ' 20' + p.aa;
      // La quincena es la del selector de ESTE módulo, no la de Fiscal.
      return _retQuincena ? (_retQuincena === 1 ? '1ra' : '2da') + ' quincena ' + mes : mes;
    }
    /* La lista arranca en el mes MÁS ALTO entre el que se está mirando y
       el real de hoy, y de ahí baja 24 meses.

       Antes bajaba desde el que se mira, y ahí estaba el fallo que reportó
       Luis: trabajando en julio, AGOSTO no existía en la lista — y una
       retención que llega tarde pertenece justamente a un período
       POSTERIOR al de la factura que se está revisando. */
    function _opcionesPeriodoRet() {
      const out = [];
      const mirado = _periodoVigente();
      const d = new Date();
      const hoy = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const base = mirado > hoy ? mirado : hoy;
      let y = parseInt(base.slice(0, 4), 10), m = parseInt(base.slice(5, 7), 10);
      for (let i = 0; i < 30; i++) {
        out.push({ value: y + '-' + String(m).padStart(2, '0'), label: _MESES_RET[m - 1] + ' ' + y });
        m--; if (m < 1) { m = 12; y--; }
      }
      return out;
    }

    /* El período que el propio comprobante declara.

       El N° de comprobante de retención de IVA empieza por AAAAMM: son el
       año y el mes del período en que el agente practicó la retención
       (Providencia SNAT/2015/0049, Art. 7). Es el dato más fiable que hay
       —está impreso en el documento— y hasta ahora nadie lo leía. */
    function _periodoDelComprobante(comp) {
      const d = String(comp || '').replace(/[^0-9]/g, '');
      if (d.length < 6) return null;
      const y = parseInt(d.slice(0, 4), 10), m = parseInt(d.slice(4, 6), 10);
      if (y < 2000 || y > 2100 || m < 1 || m > 12) return null;
      return y + '-' + String(m).padStart(2, '0');
    }

    // Mini-cuadro de retenciones dentro de una Forma 30 (compras=practicadas, ventas=sufridas)
    function renderMini(tableEl, arr) {
      if (!tableEl) return;
      const tb = tableEl.querySelector('tbody');
      if (tb) tb.innerHTML = arr.length ? arr.map((r) => {
        const esIva = r.tipo === 'iva';
        const pct = Number(r.pct) || 0;
        return '<tr><td class="mono">' + esc(r.comprobante || '') + '</td><td class="mono">' + esc(r.factura || '') + '</td>'
          + '<td><span class="op-tag ' + (esIva ? 'cyan' : 'navy') + '">' + (esIva ? 'IVA' : 'ISLR') + '</span></td>'
          + '<td class="num">' + fmt(Number(r.base) || 0) + '</td><td class="num">' + (Number.isInteger(pct) ? pct : pct.toFixed(2)) + '%</td>'
          + '<td class="num">' + fmt(Number(r.monto) || 0) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin retenciones registradas en el período</td></tr>';
      const ivaT = arr.filter((r) => r.tipo === 'iva').reduce((s, r) => s + (Number(r.monto) || 0), 0);
      const islrT = arr.filter((r) => r.tipo === 'islr').reduce((s, r) => s + (Number(r.monto) || 0), 0);
      const setFoot = (cls, val) => { const c = tableEl.querySelector('tfoot .' + cls + ' td:last-child'); if (c) c.textContent = fmt(val); };
      setFoot('t-iva', ivaT); setFoot('t-islr', islrT); setFoot('t-tot', ivaT + islrT);
    }

    /* El desglose por quincena de las retenciones de IVA practicadas.

       El período de trabajo sigue siendo el MES —el libro, la Forma 30 y el
       IVA son mensuales en una firma personal especial— pero las retenciones
       de IVA se enteran dos veces al mes. Esto no parte nada: es el mismo
       total del mes, dicho en sus dos mitades, para saber qué monto va en
       cada declaración quincenal sin tener que contarlo a mano contra el
       libro.

       SOLO EL IVA. El ISLR retenido se entera mensual, así que sumarlo aquí
       daría un número que no corresponde a ninguna declaración quincenal.

       Y solo en quien entera por quincena: a un ordinario le sobra. */
    function pintarQuincenasRet(practicadas) {
      const panel = document.querySelector('.fiscal-tab[data-tab="compras"] table.ret-mini');
      if (!panel || !panel.parentNode) return;
      const aplica = window.__retencionesPorQuincena && window.__retencionesPorQuincena();
      let caja = document.getElementById('retQuincenaResumen');
      if (!aplica) { if (caja) caja.remove(); return; }
      if (!caja) {
        caja = document.createElement('div');
        caja.id = 'retQuincenaResumen';
        caja.style.cssText = 'margin-top:8px;border:1px solid var(--border-strong);border-radius:9px;overflow:hidden;font-size:12px;';
        panel.parentNode.insertBefore(caja, panel.nextSibling);
      }
      const iva = (practicadas || []).filter((r) => r.tipo === 'iva');
      const de = (q) => {
        const f = iva.filter((r) => r.quincena === q);
        return { ops: f.length, monto: f.reduce((s, r) => s + (Number(r.monto) || 0), 0) };
      };
      const q1 = de(1), q2 = de(2);
      const sinQ = iva.filter((r) => r.quincena !== 1 && r.quincena !== 2);
      const sumaSinQ = sinQ.reduce((s, r) => s + (Number(r.monto) || 0), 0);
      const fila = (rot, d, dias) => '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 11px;border-top:1px solid var(--border);">'
        + '<span><strong>' + rot + '</strong> <span style="color:var(--fg-muted);">' + dias + '</span></span>'
        + '<span style="color:var(--fg-muted);">' + d.ops + ' retenc.</span>'
        + '<span class="mono"><strong>' + fmt(d.monto) + '</strong></span></div>';
      caja.innerHTML = '<div style="padding:7px 11px;background:var(--bg-subtle,var(--bg-surface));font-weight:600;">'
        + 'IVA retenido por quincena <span style="font-weight:400;color:var(--fg-muted);">— se entera una declaración por quincena</span></div>'
        + fila('1ra quincena', q1, '(01–15)')
        + fila('2da quincena', q2, '(16 al último día)')
        /* Se NOMBRAN, no solo se cuentan.

           Decir «3 sin quincena» obliga a ir a Retenciones y buscarlas una
           por una entre todas las del período. Aquí salen con su comprobante,
           su factura y su proveedor, y cada una abre su ficha de un clic —
           que es donde está el desplegable para asignarle la quincena. */
        + (sinQ.length
          ? '<div style="padding:7px 11px;border-top:1px solid var(--border);background:var(--da-amber-50,rgba(200,140,0,.09));">'
            + '<div><strong>' + sinQ.length + ' sin quincena · ' + fmt(sumaSinQ) + '</strong> — salen en las DOS y se enterarían dos veces.</div>'
            + '<div style="margin-top:5px;">' + sinQ.map((r) => '<button type="button" class="ret-sinq" data-ret-sinq="' + esc(r.id || '') + '"'
              + ' style="display:block;width:100%;text-align:left;background:none;border:0;border-top:1px dotted var(--border);'
              + 'padding:5px 0 4px;cursor:pointer;color:inherit;font:inherit;font-size:11.5px;">'
              + '<span class="mono">' + esc(r.comprobante || '(sin comprobante)') + '</span>'
              + ' · ' + esc((r.tercero_nombre || 'sin tercero').slice(0, 26))
              + (r.factura ? ' · factura ' + esc(r.factura) : '')
              + ' · <strong>' + fmt(Number(r.monto) || 0) + '</strong>'
              + ' <span style="color:var(--fg-muted);">— asignar quincena</span></button>').join('')
            + '</div></div>'
          : '')
        + '<div style="padding:6px 11px;border-top:1px solid var(--border);color:var(--fg-muted);">'
        + 'El ISLR retenido se entera <strong>mensual</strong>, por eso no se reparte aquí.</div>';

      caja.querySelectorAll('[data-ret-sinq]').forEach((b) => {
        b.addEventListener('mouseenter', () => { b.style.background = 'rgba(0,0,0,.05)'; });
        b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
        b.addEventListener('click', () => {
          const id = b.dataset.retSinq;
          if (!id || !window.__editRetencion) {
            if (window.toast) window.toast('Ábrela en Fiscal → Retenciones para asignarle la quincena.', 'info');
            return;
          }
          window.__editRetencion(id);
        });
      });
    }

    // Traslada las retenciones de IVA SUFRIDAS (las que nos retienen los clientes) a la
    // autoliquidación de la Forma 30 Ventas (ítem 66/38 → reduce el Total a Pagar) y
    // refleja el detalle en los mini-cuadros de cada Forma 30.
    /* Deja solo las retenciones del establecimiento que se esté mirando.

       Una retención hereda el establecimiento de SU factura (sucursal_id).

       El filtro es ESTRICTO: sin establecimiento no entra en el auxiliar de
       ninguno. El primer intento dejaba pasar las que tuvieran el campo en
       nulo, con la idea de no esconder ninguna retención — pero eso hacía
       justo lo contrario de lo que se pide: el auxiliar de una sucursal sin
       movimiento salía cargado con todas las retenciones de la casa matriz,
       que es exactamente el descuadre que había que resolver.

       Nada se pierde: el consolidado —sin establecimiento elegido— es la
       vista por defecto y la que alimenta la declaración, y ahí siguen
       apareciendo todas. Lo que no tenga establecimiento se asigna con
       sql/historico_a_casa_matriz.sql. */
    function delEstablecimiento(arr, tipo) {
      const filtro = window.__sucFiltroDe ? window.__sucFiltroDe(tipo) : '';
      if (!filtro) return arr;
      return arr.filter((r) => r.sucursal_id === filtro);
    }

    function aplicarAForma30(arr) {
      arr = arr || [];
      const ivaSuf = arr.filter((r) => r.direccion === 'sufrida' && r.tipo === 'iva').reduce((s, r) => s + (Number(r.monto) || 0), 0);
      window.__RET_IVA_SUFRIDA = ivaSuf;
      if (window.__recalcAutoliq) window.__recalcAutoliq();
      const practicadas = delEstablecimiento(arr.filter((r) => r.direccion === 'practicada'), 'compra');
      renderMini(document.querySelector('.fiscal-tab[data-tab="compras"] table.ret-mini'), practicadas);
      // El desglose ve el MES entero, aunque arriba se este mirando una quincena.
      pintarQuincenasRet(delEstablecimiento(
        (_retMes.length ? _retMes : arr).filter((r) => r.direccion === 'practicada'), 'compra'));
      /* Se busca en la PESTAÑA, no dentro de la vista de facturas.

         La tablita vive junto a la Forma 30, y esa salió de las dos vistas
         porque la declaración es una sola. El selector se quedó apuntando a
         `.ventas-view[data-ventasmode="facturas"]`, donde ya no está: no la
         encontraba y no la pintaba nunca. Se veía el IVA retenido en la
         casilla 66 de la Forma 30 y no había manera de ver de qué retención
         venía.

         Buscarla en la pestaña la deja además visible en las dos secciones,
         que es lo correcto: al cliente que paga con tique de máquina también
         se le puede retener. */
      renderMini(document.querySelector('.fiscal-tab[data-tab="ventas"] table.ret-mini'),
                 delEstablecimiento(arr.filter((r) => r.direccion === 'sufrida'), 'venta'));
      // Resumen de retenciones ISLR practicadas (panel del generador XML)
      const islrBody = document.getElementById('islrResumenBody');
      if (islrBody) {
        const islrP = arr.filter((r) => r.tipo === 'islr' && r.direccion === 'practicada');
        let tOp = 0, tRet = 0;
        islrBody.innerHTML = islrP.length ? islrP.map((r, i) => {
          const op = Number(r.base) || 0, ret = Number(r.monto) || 0; tOp += op; tRet += ret;
          const pctT = Number.isInteger(Number(r.pct)) ? Number(r.pct) : Number(r.pct).toFixed(2);
          return '<tr><td class="ctr">' + (i + 1) + '</td><td class="mono">' + esc(r.tercero_rif || '') + '</td><td class="primary">' + esc(r.tercero_nombre || '') + '</td><td class="mono">' + esc(r.factura || '') + '</td><td class="mono">' + esc(r.numero_control || '') + '</td><td>' + esc(r.fecha || '') + '</td><td class="ctr">' + esc(r.concepto_codigo || '') + '</td><td class="num">' + fmt(op) + '</td><td class="ctr">' + pctT + '%</td><td class="num">' + fmt(ret) + '</td></tr>';
        }).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin retenciones de ISLR practicadas. Regístralas en la pestaña Retenciones.</td></tr>';
        const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = fmt(v); };
        setT('islrResumenOp', tOp); setT('islrResumenRet', tRet);
        const c = document.getElementById('islrResumenCount'); if (c) c.textContent = String(islrP.length);
      }
      // Resumen de retenciones IVA practicadas (panel del generador TXT)
      const ivaP = arr.filter((r) => r.tipo === 'iva' && r.direccion === 'practicada');
      const setT2 = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      const ivaBase = ivaP.reduce((s, r) => s + (Number(r.base) || 0), 0);
      const ivaRet = ivaP.reduce((s, r) => s + (Number(r.monto) || 0), 0);
      setT2('ivaResumenCount', String(ivaP.length));
      setT2('ivaResumenNota', String(ivaP.length));
      setT2('ivaResumenBase', fmt(ivaBase));
      setT2('ivaResumenRet', fmt(ivaRet));
    }
    async function cargarRetenciones() {
      const vacio = () => { _retData = []; _retMes = []; pintar('practicadas', []); pintar('sufridas', []); refreshSummary(); applyFilter(); aplicarAForma30([]); };
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return vacio();
      const { data, error } = await window.__sbAll((q) => q.eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('fecha', { ascending: false }), 'retenciones', '*');
      if (error) { console.warn('[DigiAccount] No se pudieron cargar retenciones:', error.message); return vacio(); }
      // Solo las retenciones del PERÍODO DE DECLARACIÓN seleccionado (sigue al de la factura)
      const per = window.__fiscalPer;
      let arr = data || [];
      if (per && per.mm && per.aa) {
        const perDecl = '20' + per.aa + '-' + per.mm, suf = '/' + per.mm + '/' + per.aa;
        arr = arr.filter((r) => r.periodo ? r.periodo === perDecl : String(r.fecha || '').endsWith(suf));
        /* Las retenciones de IVA PRACTICADAS se enteran por quincena en todo
           contribuyente especial, sea C.A. o firma personal. Sin filtro, la de
           la primera quincena seguía apareciendo en la segunda y el cuadro
           sumaba dos veces algo que ya se enteró.

           La quincena sale del selector PROPIO de este módulo, no del de
           Fiscal: una firma personal declara el IVA mensual pero entera las
           retenciones cada quincena, así que allá no hay quincena que elegir.

           Las SUFRIDAS no se separan: se descuentan con la declaración de
           IVA, que en una firma personal es mensual.

           Una retención sin quincena registrada no se esconde: quedaría
           invisible en las dos, y una retención que no se ve es una que no
           se entera. Se muestra, y se nota que le falta el dato. */
        /* El mes completo, ANTES de partirlo por quincena. El desglose
           «IVA retenido por quincena» tiene que ver las dos mitades a la vez;
           si leyera lo ya filtrado mostraria una sola y la otra en cero. */
        _retMes = arr.slice();
        if (_retQuincena === 1 || _retQuincena === 2) {
          arr = arr.filter((r) => r.direccion !== 'practicada'
            || !(r.quincena === 1 || r.quincena === 2)
            || r.quincena === _retQuincena);
        }
      }
      _retData = arr;
      pintar('practicadas', arr.filter((r) => r.direccion === 'practicada'));
      pintar('sufridas', arr.filter((r) => r.direccion === 'sufrida'));
      refreshSummary(); applyFilter();
      aplicarAForma30(arr);
      // Los selectores de Comprobantes salen de estas mismas retenciones.
      if (window.__syncComprobantes) window.__syncComprobantes();
      if (window.__setTabCount) window.__setTabCount('retenciones', arr.length);
    }
    window.cargarRetenciones = cargarRetenciones;
    window.__getRetenciones = () => _retData.slice(); // para el generador XML de ISLR
    // La quincena que se está mirando, para que el TXT la ponga en su nombre.
    window.__retQuincenaActual = () => _retQuincena;
    window.__editRetencion = editRetencion;

    // El % de retención depende del impuesto: IVA = dropdown estricto 0/75/100;
    // ISLR = entrada libre con sugerencias comunes (varía por concepto del Decreto 1.808).
    /* Pinta el cálculo de la retención en vivo.

       Para IVA:  base (que es el IVA de la factura) x %  = retenido
       Para ISLR: base x % - sustraendo = retenido, y se muestra el CÓDIGO del
       Anexo 6.1 que se está aplicando, que es lo que va impreso en el
       comprobante y lo que revisa el SENIAT. */
    // Arma el bloque del comprobante; se usa en los dos caminos del cálculo.
    function bloqueCompDe(comp, fechaISO) {
      comp = (comp || '').trim();
      if (!comp) return '';
      const rev = revisarCompIva(comp, fechaISO);
      if (rev.error) return '<div class="ret-calc-comp mal">✗ ' + esc(rev.error) + '</div>';
      return '<div class="ret-calc-comp ok">✓ Comprobante · año <strong>' + esc(rev.anio)
        + '</strong> · mes <strong>' + esc(rev.mes) + '</strong> · correlativo <strong>' + esc(rev.correlativo) + '</strong></div>'
        + (rev.aviso ? '<div class="ret-calc-comp aviso">⚠ ' + esc(rev.aviso) + '</div>' : '');
    }

    function setupCalcRetencion(body) {
      const caja = body.querySelector('#retCalc');
      if (!caja) return;
      const val = (n) => { const el = body.querySelector('[data-name="' + n + '"]'); return el ? el.value : ''; };
      const pintar = () => {
        const esIslr = /islr/i.test(val('tipo'));
        const base = parseFloat(val('base')) || 0;
        const pct = parseFloat(String(val('pct')).replace('%', '')) || 0;
        if (!base || !pct) {
          caja.innerHTML = '<span class="ret-calc-vacio">Escribe la base y elige el porcentaje para ver cuánto se retiene.</span>'
            + (esIslr ? '' : bloqueCompDe(val('comprobante'), val('fecha')));
          return;
        }
        /* El desglose del comprobante de IVA, mientras se escribe. Es lo que
           permite cachar un dígito de más sin contar catorce a ojo. */
        let bloqueComp = '';
        if (!esIslr) {
          const comp = (val('comprobante') || '').trim();
          if (comp) {
            const rev = revisarCompIva(comp, val('fecha'));
            bloqueComp = rev.error
              ? '<div class="ret-calc-comp mal">✗ ' + esc(rev.error) + '</div>'
              : '<div class="ret-calc-comp ok">✓ Comprobante · año <strong>' + esc(rev.anio)
                + '</strong> · mes <strong>' + esc(rev.mes) + '</strong> · correlativo <strong>' + esc(rev.correlativo) + '</strong></div>'
                + (rev.aviso ? '<div class="ret-calc-comp aviso">⚠ ' + esc(rev.aviso) + '</div>' : '');
          }
        }

        if (esIslr) {
          const variant = variantIslr(val('concepto'), val('sujeto'));
          const cod = variant ? variant[0] : '—';
          const sust = parseFloat(val('sustraendo')) || 0;
          const monto = Math.max(0, base * pct / 100 - sust);
          caja.innerHTML =
            '<div class="ret-calc-fila"><span>Código del Anexo 6.1</span><strong class="mono">' + esc(cod) + '</strong></div>'
            + '<div class="ret-calc-fila"><span>Base del pago</span><strong class="mono">Bs ' + fmt(base) + '</strong></div>'
            + '<div class="ret-calc-fila"><span>Porcentaje</span><strong class="mono">' + pct + '%</strong></div>'
            + (sust > 0 ? '<div class="ret-calc-fila"><span>Menos sustraendo</span><strong class="mono">− Bs ' + fmt(sust) + '</strong></div>' : '')
            + '<div class="ret-calc-fila total"><span>Se retiene de ISLR</span><strong class="mono">Bs ' + fmt(monto) + '</strong></div>';
        } else {
          const monto = base * pct / 100;
          caja.innerHTML =
            '<div class="ret-calc-fila"><span>IVA de la factura</span><strong class="mono">Bs ' + fmt(base) + '</strong></div>'
            + '<div class="ret-calc-fila"><span>Porcentaje retenido</span><strong class="mono">' + pct + '%</strong></div>'
            + '<div class="ret-calc-fila total"><span>Se retiene de IVA</span><strong class="mono">Bs ' + fmt(monto) + '</strong></div>'
            + '<div class="ret-calc-fila"><span>Le queda al tercero</span><strong class="mono">Bs ' + fmt(base - monto) + '</strong></div>'
            + bloqueComp;
        }
      };
      // Se escucha en todo el formulario: el campo del porcentaje se vuelve a
      // dibujar al cambiar de impuesto, así que un oyente propio se perdería.
      body.addEventListener('input', pintar);
      body.addEventListener('change', pintar);
      pintar();
      return pintar;
    }

    /* La base significa cosas distintas según el impuesto, y confundirlas es
       el error más caro de este formulario.

       En la retención de IVA la base es el IVA DE LA FACTURA — no su base
       imponible—. En la de ISLR es el monto del pago por el servicio. Cuando
       el formulario se abre desde una factura del libro, se trae el número
       correcto para cada caso y se cambia solo al cambiar de impuesto. */
    function setupBaseSegunImpuesto(body, pre) {
      pre = pre || {};
      if (pre.baseIva == null && pre.baseIslr == null) return;
      const tipoSel = body.querySelector('[data-name="tipo"]');
      const baseEl = body.querySelector('[data-name="base"]');
      if (!tipoSel || !baseEl) return;

      const wrap = baseEl.closest('.fm-field');
      let pista = wrap ? wrap.querySelector('.ret-pista') : null;
      if (wrap && !pista) {
        pista = document.createElement('div');
        pista.className = 'ret-pista';
        wrap.appendChild(pista);
      }

      const rotulo = wrap ? wrap.querySelector('.fm-lbl') : null;
      const aplicar = () => {
        const esIslr = /islr/i.test(tipoSel.value);
        const quiero = esIslr ? pre.baseIslr : pre.baseIva;
        if (quiero != null) baseEl.value = Number(quiero).toFixed(2);
        /* El rótulo dice QUÉ monto es, y cambia con el impuesto.

           Decía «Base imponible» para los dos, y en una retención de IVA eso
           engaña: aquí va el IVA, mientras que en la factura la base
           imponible es justo lo OTRO, el monto del que sale ese IVA. Con el
           mismo nombre para las dos cosas es fácil escribir una donde va la
           otra, y la retención sale mal por un factor de seis. En ISLR sí se
           retiene sobre el pago, y ahí el nombre se mantiene. */
        if (rotulo) {
          rotulo.textContent = esIslr
            ? 'Monto del pago sobre el que se retiene (Bs)'
            : 'IVA de la factura (Bs) — la retención se calcula sobre esto';
        }
        if (pista) {
          pista.innerHTML = esIslr
            ? 'De la factura: base imponible <strong>Bs ' + fmt(Number(pre.baseIslr) || 0) + '</strong>. '
              + 'El ISLR se retiene sobre el monto del pago — ajústalo si tu caso es otro.'
            : 'De la factura: IVA <strong>Bs ' + fmt(Number(pre.baseIva) || 0) + '</strong>. '
              + 'La retención de IVA se calcula sobre el IVA, no sobre la base imponible.';
        }
        baseEl.dispatchEvent(new Event('input', { bubbles: true }));
      };
      tipoSel.addEventListener('change', aplicar);
      aplicar();
    }

    /* Comprueba el N° de comprobante de retención de IVA.

       El formato es AAAAMMSSSSSSSS: 4 dígitos de año, 2 de mes y 8 de
       correlativo — 14 en total (Providencia SNAT/2024/000102, Art. 11).

       Catorce dígitos seguidos no se revisan a ojo: por eso, además de
       contarlos, se devuelve el desglose para mostrarlo. Un año o un mes
       imposibles delatan un dígito de más o de menos mejor que cualquier
       recuento. */
    function revisarCompIva(comp, fechaISO) {
      const limpio = String(comp || '').replace(/[\s.\-\/]/g, '');
      if (!limpio) return { error: 'Falta el N° de comprobante.' };
      if (!/^[0-9]+$/.test(limpio)) return { error: 'El N° de comprobante lleva solo números. Quita letras y signos.' };
      if (limpio.length !== 14) {
        return { error: 'El N° de comprobante de IVA lleva 14 dígitos (año, mes y 8 de correlativo). Escribiste ' + limpio.length + '.' };
      }
      const anio = parseInt(limpio.slice(0, 4), 10);
      const mes = parseInt(limpio.slice(4, 6), 10);
      const ahora = new Date().getFullYear();
      if (mes < 1 || mes > 12) {
        return { error: 'Los dígitos 5 y 6 son el mes, del 01 al 12, y ahí dice "' + limpio.slice(4, 6) + '". Revisa el número.' };
      }
      if (anio < 2000 || anio > ahora + 1) {
        return { error: 'Los primeros 4 dígitos son el año y ahí dice "' + limpio.slice(0, 4) + '". Revisa el número.' };
      }
      let aviso = null;
      const p = String(fechaISO || '').split('-');
      if (p.length === 3 && (p[0] + p[1]) !== limpio.slice(0, 6)) {
        aviso = 'El comprobante dice ' + limpio.slice(4, 6) + '/' + limpio.slice(0, 4)
          + ' y la fecha que pusiste es ' + p[2] + '/' + p[1] + '/' + p[0] + '. Puede ser correcto, pero verifícalo.';
      }
      return {
        valor: limpio,
        anio: limpio.slice(0, 4), mes: limpio.slice(4, 6), correlativo: limpio.slice(6),
        aviso: aviso,
      };
    }

    /* El correlativo del comprobante de retención de ISLR.

       El de IVA lo fija la Providencia 000102: catorce dígitos con año, mes
       y correlativo. El de ISLR no tiene forma obligatoria, pero SÍ tiene que
       llevar número: es lo que identifica al comprobante que se le entrega al
       proveedor y lo que después se relaciona en el ARC del ejercicio. Sin
       número quedan veinte comprobantes indistinguibles entre sí.

       Se propone AAAAMM + cuatro dígitos (2026080001), que se lee igual que
       el de IVA pero más corto, y reinicia cada mes.

       PERO NO SE IMPONE: si la empresa ya viene numerando de otra manera, se
       sigue SU formato —su prefijo y su cantidad de dígitos— tomando el más
       alto del mismo mes. Basta con escribir a mano el primero para que el
       sistema siga esa serie. El sistema no le cambia la numeración a nadie.

       SOLO EN LAS PRACTICADAS. En una retención sufrida el comprobante lo
       emite el agente que retuvo: ese número se copia del documento que él
       entregó, y generarlo aquí sería inventarse un dato ajeno. */
    /* El siguiente comprobante que emite ESTA empresa.

       En una retención PRACTICADA la empresa es el agente de retención: el
       comprobante lo emite ella y su número es correlativo propio. En una
       SUFRIDA el número lo pone el cliente y cambia de uno a otro, así que ahí
       sí hay que escribirlo.

       IVA e ISLR llevan SERIES SEPARADAS. Antes esta función estaba cableada a
       ISLR y por eso al retener IVA de una compra el campo salía en blanco. */
    async function siguienteComprobante(empresaId, fechaISO, tipo) {
      if (!window.sb || !empresaId) return '';
      const { data, error } = await window.sb.from('retenciones')
        .select('comprobante')
        .eq('empresa_id', empresaId).eq('tipo', tipo).eq('direccion', 'practicada');
      if (error) { console.warn('[Comprobante ' + tipo + ']', error.message); return ''; }
      const usados = (data || []).map((r) => String(r.comprobante || '').trim()).filter(Boolean);

      /* El siguiente de una lista, conservando prefijo y cantidad de dígitos. */
      const siguienteDe = (lista, largoPorDefecto) => {
        let mejor = null, maxN = -1;
        lista.forEach((c) => {
          const m = String(c).match(/^(.*?)(\d+)$/);
          if (!m) return;
          const n = parseInt(m[2], 10);
          if (!isNaN(n) && n > maxN) { maxN = n; mejor = m; }
        });
        if (mejor) return mejor[1] + String(maxN + 1).padStart(mejor[2].length, '0');
        return String(1).padStart(largoPorDefecto, '0');
      };

      /* ── ISLR ──────────────────────────────────────────────────────────
         Un correlativo normal y corrido. NO lleva el AAAAMM del IVA, no se
         reinicia cada mes, y puede ir vacío: hay empresas que ni se lo ponen.

         Antes esto usaba la misma numeración del IVA, y el resultado era que
         al registrar la retención de ISLR de una factura salía el número que
         le tocaba al siguiente comprobante de IVA — dos series distintas
         comiéndose la misma numeración. */
      if (tipo !== 'iva') {
        return siguienteDe(usados, 4);
      }

      /* ── IVA ───────────────────────────────────────────────────────────
         Providencia SNAT/2015/0049: AAAAMM + secuencial.

         EL CORRELATIVO NO SE REINICIA CADA MES. Lo que cambia con el mes es
         el PREFIJO; el número sigue corriendo. Es la numeración propia del
         agente de retención, y en GATMA va continua desde el 000001 de
         octubre de 2025 hasta hoy, atravesando todos los meses.

         Antes se filtraba por el mes en curso y, al no haber ninguno todavía,
         se arrancaba de nuevo en 1: al pasar de agosto a septiembre proponía
         ...900000001 en lugar de ...900000019. Eso repetía números ya
         entregados a proveedores el año anterior. */
      const p2 = String(fechaISO || '').split('-');
      const aaaamm = (p2.length === 3) ? (p2[0] + p2[1])
        : (function () {
          const d = new Date();
          return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
        })();

      // El más alto de TODA la empresa, sea del mes que sea. Se conserva la
      // cantidad de dígitos que ella ya venía usando.
      let maxN = 0, largoCorrel = 8;
      usados.forEach((c) => {
        const d = String(c).replace(/\D/g, '');
        if (d.length <= 6) return;              // sin correlativo después del AAAAMM
        const correl = d.slice(6);
        const n = parseInt(correl, 10);
        if (!isNaN(n) && n > maxN) { maxN = n; largoCorrel = correl.length; }
      });
      return aaaamm + String(maxN + 1).padStart(largoCorrel, '0');
    }

    function setupPctField(body) {
      const tipoSel = body.querySelector('[data-name="tipo"]');
      const pctEl = body.querySelector('[data-name="pct"]');
      const wrap = pctEl ? pctEl.closest('.fm-field') : null;
      if (!tipoSel || !wrap) return;
      const render = () => {
        const esIva = /iva/i.test(tipoSel.value);
        const curEl = wrap.querySelector('[data-name="pct"]');
        const cur = curEl ? String(curEl.value).replace('%', '').trim() : '';
        const lbl = wrap.querySelector('.fm-lbl');
        const lblHtml = lbl ? lbl.outerHTML : '<span class="fm-lbl">% de retención</span>';
        if (esIva) {
          wrap.innerHTML = lblHtml + '<select data-name="pct">' + ['0', '75', '100'].map((o) =>
            '<option value="' + o + '%"' + ((cur === o || (cur === '' && o === '75')) ? ' selected' : '') + '>' + o + '%</option>').join('') + '</select>';
        } else {
          wrap.innerHTML = lblHtml + '<input data-name="pct" type="number" step="0.01" list="fm-dl-pctislr" placeholder="3" value="' + esc(cur) + '">'
            + '<datalist id="fm-dl-pctislr"><option value="1"></option><option value="2"></option><option value="3"></option><option value="5"></option></datalist>';
        }
      };
      tipoSel.addEventListener('change', render);
      render();
    }

    // ===== ISLR: Anexo 6.1 (Decreto 1.808) — set curado con códigos y % oficiales =====
    // v: por tipo de sujeto → [códigoConcepto, %] (% null = escalonado 15/22/34, se coloca a mano)
    const UT_BS = 43; // Unidad Tributaria vigente 2026 (confirmado por Luis)
    const SUSTRAENDO_CODS = ['002', '006', '010', '012', '014', '018', '025', '049', '053', '057', '061', '071', '073', '075', '077', '079', '083'];
    const CONCEPTOS_ISLR = [
      { act: 'Honorarios profesionales no mercantiles', v: { PNR: ['002', 3], PNNR: ['003', 34], PJD: ['004', 5], PJND: ['005', null] } },
      { act: 'Comisiones por venta de inmuebles', v: { PNR: ['014', 3], PNNR: ['015', 34], PJD: ['016', 5], PJND: ['017', 5] } },
      { act: 'Otras comisiones', v: { PNR: ['018', 3], PNNR: ['019', 34], PJD: ['020', 5], PJND: ['021', 5] } },
      { act: 'Intereses pagados por PJ a cualquier persona', v: { PNR: ['025', 3], PNNR: ['026', 34], PJD: ['027', 5], PJND: ['028', null] } },
      { act: 'Contratistas / subcontratistas (obras o servicios)', v: { PNR: ['053', 1], PNNR: ['054', 34], PJD: ['055', 2], PJND: ['056', null] } },
      { act: 'Arrendamiento de inmuebles', v: { PNR: ['057', 3], PNNR: ['058', 34], PJD: ['059', 5], PJND: ['060', null] } },
      { act: 'Arrendamiento de bienes muebles', v: { PNR: ['061', 3], PNNR: ['062', 34], PJD: ['063', 5], PJND: ['064', 5] } },
      { act: 'Tarjetas de crédito (venta de bienes/servicios)', v: { PNR: ['065', 3], PNNR: ['066', 34], PJD: ['067', 5], PJND: ['068', 5] } },
      { act: 'Fletes / transporte de carga', v: { PNR: ['071', 1], PJD: ['072', 3] } },
      { act: 'Seguros / corretaje / reaseguros (servicios)', v: { PNR: ['073', 3], PJD: ['074', 5] } },
      { act: 'Adquisición de fondos de comercio', v: { PNR: ['079', 3], PNNR: ['080', 34], PJD: ['081', 5], PJND: ['082', 5] } },
      { act: 'Publicidad y propaganda', v: { PNR: ['083', 3], PJD: ['084', 5], PJND: ['085', 5] } },
    ];
    // Variante (código y %) según el concepto + tipo de sujeto seleccionados
    function variantIslr(actividad, sujeto) {
      const c = CONCEPTOS_ISLR.find((x) => x.act === actividad);
      return c && c.v[sujeto] ? c.v[sujeto] : null;
    }
    function calcSustraendo(cod, sujeto, pct) {
      if (sujeto !== 'PNR' || SUSTRAENDO_CODS.indexOf(cod) < 0 || pct == null) return 0;
      return (pct / 100) * 83.3334 * UT_BS;
    }
    // En ISLR muestra concepto/sujeto/sustraendo y autollena código, % y sustraendo.
    // En IVA los oculta (no aplican).
    /* Qué quincena le toca a una fecha 'aaaa-mm-dd'. Del 1 al 15, la primera;
       del 16 al último día, la segunda. Es la regla del enteramiento y no
       depende de cuándo se cargue el registro. */
    function _quincenaDeISO(iso) {
      const d = parseInt(String(iso || '').slice(8, 10), 10);
      return (d >= 1 && d <= 15) ? '1' : (d >= 16 ? '2' : '');
    }

    function setupIslrFields(body) {
      const tipoSel = body.querySelector('[data-name="tipo"]');
      const concSel = body.querySelector('[data-name="concepto"]');
      const sujSel = body.querySelector('[data-name="sujeto"]');
      if (!tipoSel || !concSel || !sujSel) return;
      const hide = (name, on) => { const el = body.querySelector('[data-name="' + name + '"]'); const w = el && el.closest('.fm-field'); if (w) w.style.display = on ? 'none' : ''; };
      const aplicar = () => {
        const esIslr = /islr/i.test(tipoSel.value);
        hide('concepto', !esIslr); hide('sujeto', !esIslr); hide('sustraendo', !esIslr);
        if (!esIslr) return;
        const variant = variantIslr(concSel.value, sujSel.value);
        const pctEl = body.querySelector('[data-name="pct"]');
        const sustEl = body.querySelector('[data-name="sustraendo"]');
        if (variant) {
          const cod = variant[0], pct = variant[1];
          if (pctEl && pct != null) pctEl.value = pct;
          if (sustEl) { const s = calcSustraendo(cod, sujSel.value, pct); sustEl.value = s ? s.toFixed(2) : '0'; }
        }
      };
      tipoSel.addEventListener('change', aplicar);
      concSel.addEventListener('change', aplicar);
      sujSel.addEventListener('change', aplicar);
      aplicar();
    }

    /* `pre` permite abrir el formulario ya cargado desde otra pantalla.
       El caso real: en Venezuela la retencion casi nunca llega el mismo dia
       de la factura — el cliente la manda dias despues. Entonces uno esta en
       el Libro de Ventas, con la factura al frente, y desde ahi tiene que
       poder registrarla sin volver a escribir el tercero, el RIF, el numero
       de factura y la base. */
    async function registrarRetencion(pre) {
      pre = pre || {};
      // Lo que ya tiene retenida la factura elegida. Lo llena afterRender al
      // consultar la base, y lo lee onSave, que no puede esperar consultas.
      const _yaRetenida = { iva: null, islr: null };
      const terceros = (window.__getTerceros ? window.__getTerceros() : []);
      // Facturas reales registradas en los libros (compras + ventas) de la empresa activa,
      // para ofrecerlas a elegir según la dirección y el tercero de la retención.
      let facturas = [];
      if (window.sb && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
        /* Se pagina con __sbAll: PostgREST corta en 1000 filas y una empresa
           con libros históricos cargados se pasa de ese tope. Sin esto, las
           facturas recientes quedaban FUERA del corte y no aparecían al
           registrar la retención.

           Y se ordena por PERÍODO, no por fecha: 'fecha' es texto en formato
           dd/mm/aa, y ordenado como texto '31/12/24' va antes que '01/07/26'
           porque compara el 31 contra el 01. El período es 'aaaa-mm', que sí
           ordena cronológicamente. */
        const { data } = await window.__sbAll(
          (q) => q.eq('empresa_id', window.__EMPRESA_ACTIVA.id)
            .order('periodo', { ascending: false }).order('numero_factura', { ascending: false }),
          'libro_fiscal',
          'numero_factura, numero_control, tercero_nombre, tercero_rif, base, iva, tipo, fecha, periodo');
        facturas = data || [];
      }
      window.openFormModal && window.openFormModal({
        /* Sin adjetivo. El título seguía la pestaña donde estuvieras
           parado, así que decía «sufrida» aunque fueras a cargar una
           practicada. Lo que manda es el selector de adentro. */
        title: 'Registrar retención',
        saveLabel: 'Registrar',
        fields: [
          { name: 'direccion', label: '¿Quién retiene?', type: 'select', options: ['Practicada (yo retengo a un proveedor)', 'Sufrida (un cliente me retiene)'], value: pre.direccion || (curDir === 'sufridas' ? 'Sufrida (un cliente me retiene)' : 'Practicada (yo retengo a un proveedor)') },
          { name: 'tipo', label: 'Impuesto', type: 'select', options: ['IVA', 'ISLR'] },
          { name: 'concepto', label: 'Concepto de retención (ISLR)', col: 2, type: 'select', options: CONCEPTOS_ISLR.map((c) => c.act) },
          { name: 'sujeto', label: 'Tipo de sujeto (ISLR)', type: 'select', options: [{ value: 'PNR', label: 'PN Residente' }, { value: 'PNNR', label: 'PN No Residente' }, { value: 'PJD', label: 'PJ Domiciliada' }, { value: 'PJND', label: 'PJ No Domiciliada' }] },
          // Arranca en la fecha de la factura que se retiene, no en la de hoy:
          // se puede cambiar, pero el punto de partida es la operación.
          { name: 'fecha', label: 'Fecha de emisión del comprobante — cuándo practicas la retención, no la de la factura',
            type: 'date', value: pre.fechaFactura || window.__hoyISO() },
          /* EL PERÍODO SIGUE AL COMPROBANTE, NO A LA FACTURA.

             Aquí decía lo contrario —«sigue a la factura»— y era un error de
             fondo. El IVA retenido se descuenta del débito fiscal en el
             período en que la retención se practicó, y si el comprobante
             llega tarde, en aquel en que se recibe. Nunca en el de la
             factura. Por eso el número empieza por AAAAMM: el documento
             dice a qué período pertenece.

             Caso que lo destapó: un cliente de AGUERO manda en agosto las
             retenciones de facturas de julio, con comprobantes 202608…
             Van en la declaración de AGOSTO. */
          { name: 'periodo', label: 'Período en que se descuenta — el del COMPROBANTE, no el de la factura', type: 'select',
            options: _opcionesPeriodoRet(),
            value: _periodoDelComprobante(pre.comprobante) || _periodoVigente() },
          { name: 'avisoPeriodo', col: 2, type: 'static', label: '', html: '<div id="retAvisoPer"></div>' },
        ].concat((window.__retencionesPorQuincena && window.__retencionesPorQuincena()) ? [
          /* La quincena se pregunta AL NACER.

             Faltaba, así que toda retención nueva nacía sin ella y el cuadro
             del libro avisaba después de que se enterarían dos veces. Tres de
             las de Radian llegaron así el mismo día que se cargaron.

             Se propone la del selector de Retenciones si hay una elegida —que
             es la que se está mirando y casi siempre la correcta— pero se
             puede cambiar: la quincena es la del período en que se ENTERA, no
             la del día de la factura. */
          { name: 'quincena', col: 2, label: 'Quincena en que se entera',
            type: 'select',
            options: [{ value: '1', label: '1ra quincena (se entera del 1 al 15)' },
                      { value: '2', label: '2da quincena (se entera del 16 al último día)' },
                      { value: '', label: 'No sé todavía — la asigno después' }],
            /* Sale de la FECHA del comprobante, que es el criterio real: del 1
               al 15 es primera, del 16 en adelante segunda. Antes se proponía
               la del selector de arriba, así que quien estuviera mirando el
               mes completo registraba la retención sin quincena — y una
               retención sin quincena no entra en ningún TXT.

               Se sigue pudiendo cambiar: hay casos donde el comprobante se
               emite en una quincena y se entera en la otra. */
            /* Sale de la QUINCENA DE LA FACTURA que se está reteniendo, que
               ya se eligió al registrarla. Si no viene —una retención suelta,
               sin factura de origen— se deduce de la fecha del comprobante:
               del 1 al 15 la primera, del 16 en adelante la segunda.

               Deducirla de la fecha de HOY estaba mal: una factura de la
               primera quincena cargada el día 26 salía enterada en la
               segunda. Y proponerla desde el selector de la pantalla también,
               porque quien mirara el mes completo la guardaba sin quincena, y
               una retención sin quincena no entra en ningún TXT. */
            value: (pre.quincena === 1 || pre.quincena === 2)
              ? String(pre.quincena)
              : _quincenaDeISO(pre.fechaFactura || window.__hoyISO()) },
        ] : []).concat([
          { name: 'nombre', label: 'Tercero (escribe iniciales y elige)', col: 2, type: 'datalist', options: terceros.map((t) => t.nombre), placeholder: 'Proveedor o cliente…', value: pre.nombre || '' },
          { name: 'rif', label: 'RIF (mayúscula, sin guiones)', upper: true, placeholder: 'J123456789', value: pre.rif || '' },
          { name: 'factura', label: 'Factura afectada (elige una registrada)', type: 'datalist', options: [], placeholder: 'Primero elige el tercero…', value: pre.factura || '' },
          { name: 'numControl', label: 'N° de Control (se llena de la factura)', placeholder: '00-00000000', value: pre.numControl || '' },
          /* «lo propone el sistema» daba a entender que lo propone siempre.
             Solo lo hace en las PRACTICADAS de IVA, que son las únicas que
             uno numera. En una sufrida el número es el que trae el
             documento del cliente. */
          { name: 'comprobante', label: 'N° de comprobante · en una sufrida, cópialo del que envió el cliente', type: 'datalist', options: [], placeholder: 'Tal como viene en el documento' },
          { name: 'base', label: 'Monto sobre el que se retiene (Bs)', type: 'number', step: '0.01', placeholder: '0.00', value: pre.base != null ? String(pre.base) : '' },
          { name: 'pct', label: '% de retención', type: 'number', step: '0.01', placeholder: '75' },
          { name: 'sustraendo', label: 'Sustraendo (ISLR, automático)', type: 'number', step: '0.01', placeholder: '0.00' },
          /* Lo que de verdad se está reteniendo, calculado a la vista.
             Antes había que escoger el porcentaje y confiar: el monto solo
             aparecía después de guardar. En una retención, ese número es EL
             dato — es lo que va al comprobante y lo que el tercero descuenta. */
          { name: 'resumenRet', col: 2, type: 'static', label: '', html:
            '<div class="ret-calc" id="retCalc"></div>' },
        ]),
        afterRender: (body) => {
          /* EL COMPROBANTE MANDA SOBRE EL PERÍODO.

             Los primeros seis dígitos del N° de comprobante de IVA son el
             AAAAMM del período en que se practicó la retención. Al
             escribirlo, el período se ajusta solo — y se DICE, porque el
             caso que importa es justo cuando no coincide con la factura:
             una retención de una factura de julio que llega con
             comprobante 202608 se descuenta en AGOSTO.

             Deja de moverse en cuanto el usuario elige el período a mano.
             Puede haber razones que el sistema no conoce, y quien decide
             es el contador. */
          const _cmp = body.querySelector('[data-name="comprobante"]');
          const _selPer = body.querySelector('[data-name="periodo"]');
          const _avPer = body.querySelector('#retAvisoPer');
          const _selTipo = body.querySelector('[data-name="tipo"]');
          let _perAMano = false;
          if (_selPer) _selPer.addEventListener('change', () => { _perAMano = true; pintarAvisoPer(); });

          function nombreMes(p) {
            if (!p) return '';
            const m = parseInt(p.slice(5, 7), 10);
            return (_MESES_RET[m - 1] || '') + ' ' + p.slice(0, 4);
          }

          function pintarAvisoPer() {
            if (!_avPer) return;
            const esIslr = _selTipo && _selTipo.value === 'ISLR';
            const delComp = _periodoDelComprobante(_cmp && _cmp.value);
            const puesto = _selPer ? _selPer.value : '';
            let msg = '', alerta = false;

            if (esIslr) {
              msg = 'En <strong>ISLR</strong> el comprobante no lleva el período en el número. '
                + 'El crédito pertenece al <strong>ejercicio</strong> en que se generó el ingreso; '
                + 'el mes que elijas aquí es para ordenar tu trabajo.';
            } else if (delComp && puesto && delComp !== puesto) {
              alerta = true;
              msg = 'El comprobante dice <strong>' + esc(nombreMes(delComp)) + '</strong> '
                + '(empieza por ' + esc(String(_cmp.value).replace(/[^0-9]/g, '').slice(0, 6)) + ') '
                + 'y elegiste ' + esc(nombreMes(puesto)) + '. '
                + 'El IVA retenido se descuenta en el período del comprobante — revísalo.';
            } else if (delComp) {
              msg = 'Período tomado del <strong>número</strong> del comprobante: <strong>' + esc(nombreMes(delComp)) + '</strong>. '
                + 'Aunque la factura sea de un mes anterior, la retención se descuenta aquí.';
            } else if (puesto) {
              msg = 'Período tomado de la <strong>fecha</strong> del comprobante: <strong>' + esc(nombreMes(puesto)) + '</strong>. '
                + 'Es el mes en que se descuenta, aunque la factura sea anterior. '
                + 'Si escribes el N° de comprobante y empieza por AAAAMM, manda ese.';
            }

            _avPer.innerHTML = msg
              ? '<div style="font-size:11.5px;line-height:1.55;padding:8px 10px;border-radius:6px;'
                + (alerta
                  ? 'background:var(--da-amber-50,#fff8e6);color:var(--da-amber-700,#9a6700);'
                  : 'background:var(--bg-subtle,var(--bg-surface));color:var(--fg-muted);')
                + '">' + msg + '</div>'
              : '';
          }

          /* El período sigue, POR ORDEN: el número del comprobante si lo
             trae, y si no, su FECHA.

             La fecha faltaba, y es la que resolvía el caso real: en una
             sufrida el número lo pone el cliente y muchas veces se carga
             después o no se tiene a mano. Sin número, nada movía el
             período y se quedaba en el del mes que se estuviera mirando —
             así una retención fechada el 04/08 de una factura del 29/07
             terminó en JULIO. */
          const _fechaComp = body.querySelector('[data-name="fecha"]');
          function sincronizarPeriodo() {
            if (_perAMano || !_selPer) { pintarAvisoPer(); return; }
            const delNum = _periodoDelComprobante(_cmp && _cmp.value);
            const delDia = (_fechaComp && /^\d{4}-\d{2}/.test(_fechaComp.value || ''))
              ? _fechaComp.value.slice(0, 7) : null;
            const p = delNum || delDia;
            if (p) {
              const existe = Array.prototype.some.call(_selPer.options, (o) => o.value === p);
              if (existe) _selPer.value = p;
            }
            pintarAvisoPer();
          }
          if (_cmp) _cmp.addEventListener('input', sincronizarPeriodo);
          if (_fechaComp) { _fechaComp.addEventListener('change', sincronizarPeriodo); _fechaComp.addEventListener('input', sincronizarPeriodo); }
          if (_selTipo) _selTipo.addEventListener('change', pintarAvisoPer);
          sincronizarPeriodo();

          /* La quincena sigue a la fecha del comprobante mientras nadie la
             toque a mano. Si el usuario la elige él, deja de moverse: puede
             haber un comprobante emitido en una quincena y enterado en otra,
             y ese criterio es suyo, no del sistema. */
          const _fQuin = body.querySelector('[data-name="fecha"]');
          const _selQuin = body.querySelector('[data-name="quincena"]');

          /* Dos atajos para la fecha del comprobante, porque no hay un valor
             por defecto que sirva siempre: hay proveedores que mandan la
             factura el mismo día y otros que se tardan semanas — la madera en
             GATMA, el cemento en RADIAN. Elegir uno por el usuario acierta la
             mitad de las veces y obliga a corregir la otra mitad.

             Con los dos a la vista y a un clic, se ve cuál es cuál y la
             quincena se recalcula sola al pulsarlos. */
          if (_fQuin) {
            const dmy = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
            const hoy = window.__hoyISO();
            const atajos = document.createElement('div');
            atajos.className = 'fecha-atajos';
            let botones = '<button type="button" data-fecha="' + hoy + '">Hoy · ' + dmy(hoy) + '</button>';
            if (pre.fechaFactura && pre.fechaFactura !== hoy) {
              botones += '<button type="button" data-fecha="' + pre.fechaFactura + '">Fecha de la factura · ' + dmy(pre.fechaFactura) + '</button>';
            }
            atajos.innerHTML = botones;
            _fQuin.parentNode.appendChild(atajos);
            atajos.querySelectorAll('[data-fecha]').forEach((b) =>
              b.addEventListener('click', () => {
                _fQuin.value = b.dataset.fecha;
                // El cambio programático no dispara 'change': hay que avisarlo
                // para que la quincena y el correlativo se recalculen.
                _fQuin.dispatchEvent(new Event('change', { bubbles: true }));
              }));
          }
          if (_fQuin && _selQuin) {
            let _quinAMano = false;
            _selQuin.addEventListener('change', () => { _quinAMano = true; });
            _fQuin.addEventListener('change', () => {
              if (_quinAMano) return;
              const q = _quincenaDeISO(_fQuin.value);
              if (q) _selQuin.value = q;
            });
          }
          const dirSel = body.querySelector('[data-name="direccion"]');
          const tipoSel = body.querySelector('[data-name="tipo"]');
          const prov = body.querySelector('[data-name="nombre"]');
          const rif = body.querySelector('[data-name="rif"]');
          const factInput = body.querySelector('[data-name="factura"]');
          const baseInput = body.querySelector('[data-name="base"]');
          const dl = document.getElementById('fm-dl-factura');
          if (!prov) return;
          /* En ISLR practicada se propone el correlativo, si el campo está
             vacío. Nunca se pisa lo escrito: si el comprobante ya viene del
             documento —o el usuario lo corrigió— manda ese. */
          const compEl = body.querySelector('[data-name="comprobante"]');
          const fechaComp = body.querySelector('[data-name="fecha"]');
          /* Se recuerda si el número que hay en el campo lo puso el sistema.

             El guardián de antes era `if (compEl.value.trim()) return`, con la
             idea de no pisar nunca lo escrito. Pero también impedía reemplazar
             lo que el propio sistema había propuesto: el formulario abre en
             IVA, propone el correlativo de IVA, y al cambiar a ISLR ya no lo
             tocaba. Resultado: la retención de ISLR se llevaba el número que
             le tocaba al siguiente comprobante de IVA.

             Ahora solo se respeta lo que escribió una persona. */
          let compPropuesto = '';
          if (compEl) compEl.addEventListener('input', () => { compPropuesto = ''; });

          const proponerComp = () => {
            if (!compEl) return;
            const actual = compEl.value.trim();
            if (actual && actual !== compPropuesto) return;   // lo escribió el usuario
            const esPract = dirSel && /practicada/i.test(dirSel.value);
            const esIslrSel = tipoSel && /islr/i.test(tipoSel.value);
            const emp = window.__EMPRESA_ACTIVA || {};
            /* Solo el IVA lleva correlativo propuesto.

               El comprobante de retención de IVA es obligatorio y tiene
               formato impuesto por la Providencia SNAT/2015/0049: AAAAMM más
               ocho dígitos, correlativo por mes. El de ISLR no tiene formato
               impuesto y muchas empresas no lo numeran — GATMA entre ellas.
               Proponerle un número era inventarle una serie que nadie pidió.

               En una SUFRIDA tampoco: ahí el comprobante lo emite el cliente. */
            if (!esPract || esIslrSel || !emp.id) {
              if (actual && actual === compPropuesto) { compEl.value = ''; compPropuesto = ''; }
              return;
            }
            siguienteComprobante(emp.id, fechaComp ? fechaComp.value : '', 'iva').then((n) => {
              if (!n || !compEl) return;
              const ahora = compEl.value.trim();
              if (ahora && ahora !== compPropuesto) return;   // escribió mientras se consultaba
              compEl.value = n;
              compPropuesto = n;
              compEl.placeholder = 'Correlativo propuesto — cámbialo si tu numeración es otra';
            });
          };
          if (tipoSel) tipoSel.addEventListener('change', proponerComp);
          if (dirSel) dirSel.addEventListener('change', proponerComp);
          if (fechaComp) fechaComp.addEventListener('change', proponerComp);
          proponerComp();
          // Limitar terceros por dirección: practicada → solo proveedores; sufrida → solo clientes
          const tercDl = document.getElementById('fm-dl-nombre');
          const refrescarTerceros = () => {
            if (!tercDl) return;
            const esPract = dirSel && /practicada/i.test(dirSel.value);
            const lista = terceros.filter((t) => (esPract ? t.prov : t.cli) && t.nombre);
            tercDl.innerHTML = lista.map((t) => '<option value="' + esc(t.nombre) + '"></option>').join('');
            prov.placeholder = esPract ? 'Proveedor… (escribe iniciales)' : 'Cliente… (escribe iniciales)';
            const lbl = prov.closest('.fm-field') && prov.closest('.fm-field').querySelector('.fm-lbl');
            if (lbl) lbl.textContent = (esPract ? 'Proveedor' : 'Cliente') + ' (escribe iniciales y elige)';
          };
          const autollenarRif = () => { const t = terceros.find((x) => x.nombre.toLowerCase() === prov.value.trim().toLowerCase()); if (t && rif) rif.value = normRif(t.rif); };
          const facturasFiltradas = () => {
            const esPract = dirSel && /practicada/i.test(dirSel.value);
            const tipoLibro = esPract ? 'compra' : 'venta';
            const nom = (prov.value || '').trim().toLowerCase();
            const rifN = normRif(rif && rif.value);
            return facturas.filter((f) => f.tipo === tipoLibro
              && ((nom && (f.tercero_nombre || '').toLowerCase() === nom) || (rifN && normRif(f.tercero_rif) === rifN)));
          };
          const refrescarFacturas = () => {
            if (!dl) return;
            const fs = facturasFiltradas();
            dl.innerHTML = fs.map((f) => '<option value="' + esc(f.numero_factura || '') + '">' + esc((f.numero_factura || '(sin N°)') + ' · base ' + fmt(Number(f.base) || 0)) + '</option>').join('');
            if (factInput) factInput.placeholder = fs.length ? 'Elige entre ' + fs.length + ' factura(s)…' : 'Sin facturas registradas de este tercero';
          };
          const ctrlInput = body.querySelector('[data-name="numControl"]');
          const autollenarBase = () => {
            if (!factInput) return;
            const f = facturasFiltradas().find((x) => (x.numero_factura || '') === factInput.value.trim());
            if (!f) return;
            const esIva = !tipoSel || /iva/i.test(tipoSel.value);
            if (baseInput) baseInput.value = (esIva ? (Number(f.iva) || 0) : (Number(f.base) || 0)).toFixed(2);
            if (ctrlInput && f.numero_control) ctrlInput.value = f.numero_control;
          };
          prov.addEventListener('change', () => { autollenarRif(); refrescarFacturas(); });
          prov.addEventListener('input', () => { autollenarRif(); refrescarFacturas(); });
          if (dirSel) dirSel.addEventListener('change', () => { refrescarTerceros(); prov.value = ''; if (rif) rif.value = ''; refrescarFacturas(); });
          if (tipoSel) tipoSel.addEventListener('change', autollenarBase);
          if (factInput) { factInput.addEventListener('change', autollenarBase); factInput.addEventListener('input', autollenarBase); }
          // Sugerir comprobantes EXISTENTES del mismo proveedor (mismo tipo/dirección) para agrupar
          const compDl = document.getElementById('fm-dl-comprobante');
          const compInput = body.querySelector('[data-name="comprobante"]');
          const refrescarComprobantes = () => {
            if (!compDl) return;
            const rifN = normRif(rif && rif.value);
            const nom = (prov.value || '').trim().toLowerCase();
            /* Sin ancla al principio: basta con que la palabra esté. Anclado,
               reordenar el texto de la opción habría guardado toda practicada
               como sufrida, en silencio. */
            const dir = (dirSel && /practicada/i.test(dirSel.value)) ? 'practicada' : 'sufrida';
            const tip = (tipoSel && /islr/i.test(tipoSel.value)) ? 'islr' : 'iva';
            const seen = {};
            const list = _retData.filter((x) => x.tipo === tip && x.direccion === dir && (x.comprobante || '')
              && ((rifN && normRif(x.tercero_rif) === rifN) || (nom && (x.tercero_nombre || '').toLowerCase() === nom)))
              .filter((x) => { if (seen[x.comprobante]) return false; seen[x.comprobante] = true; return true; });
            compDl.innerHTML = list.map((x) => '<option value="' + esc(x.comprobante) + '">' + esc(x.comprobante + ' · ' + (x.fecha || '')) + '</option>').join('');
            if (compInput) compInput.placeholder = list.length ? 'Escríbelo, o elige uno existente para agrupar' : 'Escríbelo tal como viene en el comprobante';
          };
          /* Al escoger la factura se consulta si ya tiene retenciones y se
             dice ENSEGUIDA, no al guardar. Llenar catorce dígitos, el
             porcentaje y la base para que después le digan a uno que no, es
             la peor forma de decir que no. */
          const factEl = body.querySelector('[data-name="factura"]');
          const avisoDup = document.createElement('div');
          avisoDup.className = 'ret-dup';
          if (factEl && factEl.closest('.fm-field')) factEl.closest('.fm-field').appendChild(avisoDup);
          const revisarDuplicado = async () => {
            _yaRetenida.iva = null; _yaRetenida.islr = null;
            avisoDup.innerHTML = '';
            const nf = (factEl && factEl.value || '').trim();
            if (!nf) return;
            const dirAhora = /practicada/i.test((body.querySelector('[data-name="direccion"]') || {}).value || '') ? 'practicada' : 'sufrida';
            const rifAhora = (body.querySelector('[data-name="rif"]') || {}).value || '';
            const yaHay = await window.__retencionesDeFactura(nf, dirAhora, rifAhora);
            yaHay.forEach((x) => { if (x.tipo === 'iva' || x.tipo === 'islr') _yaRetenida[x.tipo] = x; });
            const partes = [];
            if (_yaRetenida.iva) partes.push('IVA por Bs ' + fmt(Number(_yaRetenida.iva.monto) || 0));
            if (_yaRetenida.islr) partes.push('ISLR por Bs ' + fmt(Number(_yaRetenida.islr.monto) || 0));
            if (!partes.length) return;
            avisoDup.innerHTML = '⚠ Esta factura ya tiene retención de <strong>' + esc(partes.join(' y ')) + '</strong>.'
              + (_yaRetenida.iva && _yaRetenida.islr
                ? ' No queda ninguna por cargar.'
                : ' Solo puedes cargarle la de <strong>' + (_yaRetenida.iva ? 'ISLR' : 'IVA') + '</strong>.');
          };
          /* El período de la factura manda sobre el de la fecha del comprobante.

             La misma retención vive en DOS períodos distintos según de qué lado
             se mire: quien la sufre la declara con su factura de venta; quien la
             practica, en el mes en que emitió el comprobante. Un cliente que
             manda en agosto la retención de una factura de julio va a
             declararla como practicada en AGOSTO, mientras que aquí va en
             JULIO. Las dos cosas son correctas y no tienen por qué coincidir.

             El sistema lo dice en voz alta en vez de dejarlo a la memoria. */
          const perEl = body.querySelector('[data-name="periodo"]');
          const perWrap = perEl ? perEl.closest('.fm-field') : null;
          let perPista = null;
          if (perWrap) {
            perPista = document.createElement('div');
            perPista.className = 'ret-pista';
            perWrap.appendChild(perPista);
          }
          const _mesTxt = (per) => {
            const p = String(per || '').split('-');
            if (p.length !== 2) return per || '';
            return _MESES_RET[parseInt(p[1], 10) - 1] + ' ' + p[0];
          };
          const ajustarPeriodo = () => {
            if (!perEl || !perPista) return;
            const nf = (factEl && factEl.value || '').trim().toLowerCase();
            const fac = facturas.find((f) => (f.numero_factura || '').trim().toLowerCase() === nf);
            const esSufrida = !/practicada/i.test((body.querySelector('[data-name="direccion"]') || {}).value || '');
            const perFac = fac && fac.periodo ? fac.periodo : null;
            const fechaComp = (body.querySelector('[data-name="fecha"]') || {}).value || '';
            const perComp = fechaComp.length >= 7 ? fechaComp.slice(0, 7) : null;

            if (!perFac) { perPista.innerHTML = ''; return; }

            // Se propone el período de la FACTURA, que es lo que se declara.
            if ([...perEl.options].some((o) => o.value === perFac)) perEl.value = perFac;

            let txt = 'La factura es de <strong>' + esc(_mesTxt(perFac)) + '</strong>';
            if (perComp && perComp !== perFac) {
              txt += ' y el comprobante es de <strong>' + esc(_mesTxt(perComp)) + '</strong>. '
                + 'Se declara con la factura.';
              if (esSufrida) {
                txt += ' Tu cliente la declarará como <strong>practicada en ' + esc(_mesTxt(perComp))
                  + '</strong>: son períodos distintos y ambos son correctos.';
              }
            } else {
              txt += '.';
            }
            perPista.innerHTML = txt;
          };
          if (factEl) {
            factEl.addEventListener('change', revisarDuplicado); factEl.addEventListener('input', revisarDuplicado);
            factEl.addEventListener('change', ajustarPeriodo); factEl.addEventListener('input', ajustarPeriodo);
          }
          const fechaEl = body.querySelector('[data-name="fecha"]');
          if (fechaEl) fechaEl.addEventListener('change', ajustarPeriodo);
          const dirEl2 = body.querySelector('[data-name="direccion"]');
          if (dirEl2) dirEl2.addEventListener('change', ajustarPeriodo);
          ajustarPeriodo();
          const dirEl = body.querySelector('[data-name="direccion"]');
          if (dirEl) dirEl.addEventListener('change', revisarDuplicado);
          revisarDuplicado();

          prov.addEventListener('change', refrescarComprobantes); prov.addEventListener('input', refrescarComprobantes);
          if (dirSel) dirSel.addEventListener('change', refrescarComprobantes);
          if (tipoSel) tipoSel.addEventListener('change', refrescarComprobantes);
          refrescarTerceros();
          refrescarFacturas();
          refrescarComprobantes();
          setupPctField(body);
          setupIslrFields(body);
          setupCalcRetencion(body);
          setupBaseSegunImpuesto(body, pre);
        },
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          if (!v.nombre) return 'Indica el tercero.';
          const esIslr = /islr/i.test(v.tipo);
          const base = parseFloat(v.base) || 0, pct = parseFloat(v.pct) || 0;
          let cod = '', suj = '', sust = 0, monto;
          if (esIslr) {
            suj = v.sujeto || '';
            const variant = variantIslr(v.concepto, suj);
            cod = variant ? variant[0] : '';
            sust = parseFloat(v.sustraendo) || 0;
            monto = Math.max(0, base * pct / 100 - sust);
          } else {
            monto = base * pct / 100;
          }
          const p = (v.fecha || '').split('-');
          const fecha = p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0].slice(2)) : '';
          const dir = /practicada/i.test(v.direccion) ? 'practicada' : 'sufrida';
          /* El N° de comprobante NO se inventa.

             En una retención SUFRIDA el número viene en el comprobante que
             manda el cliente: generarlo pondría en el sistema un número que no
             coincide con el papel, y ese descuadre solo aparece cuando ya está
             declarado. En una PRACTICADA lo asigna quien retiene, según su
             propio correlativo.

             Se autonumera solo lo que esta empresa emite por su cuenta: el
             número de factura y el de control de las VENTAS. */
          const comp = (v.comprobante || '').trim();
          /* El ISLR se registra MUCHAS VECES SIN número de comprobante: en la
             práctica no siempre lo hay, y obligarlo llevaba a inventar ceros
             para poder guardar. Se deja vacío y ya.

             El de IVA sí se exige: ese comprobante siempre trae su número de
             14 dígitos, y sin él la retención no puede salir en el archivo
             que se le entrega al SENIAT. */
          /* No dos veces el mismo impuesto sobre la misma factura.

             Aquí se usa lo que se consultó al elegir la factura (_yaRetenida).
             Guardar no puede esperar una consulta, así que la palabra final la
             tiene la llave única de la base: si algo se escapa de este lado,
             el insert la rechaza y se traduce el error 23505. */
          const nfac = (v.factura || '').trim();
          if (nfac && _yaRetenida[(esIslr ? 'islr' : 'iva')]) {
            const y = _yaRetenida[(esIslr ? 'islr' : 'iva')];
            return 'La factura ' + nfac + ' YA tiene retención de ' + (esIslr ? 'ISLR' : 'IVA')
              + (y.comprobante ? ' (comprobante ' + y.comprobante + ')' : '')
              + ' por Bs ' + fmt(Number(y.monto) || 0) + '. Cargarla otra vez duplicaría el monto en la declaración. '
              + 'Si esa retención está mal, ábrela en Retenciones y corrígela: allí puedes cambiarle la fecha, el comprobante y el monto.';
          }

          let compFinal = comp;
          if (!esIslr) {
            if (!comp) return 'Escribe el N° de comprobante de la retención de IVA — el que trae el documento, o elige uno existente para agrupar varias.';
            const rev = revisarCompIva(comp, v.fecha);
            if (rev.error) return rev.error;
            compFinal = rev.valor; // se guarda ya normalizado, sin guiones ni espacios
          }
          window.sb.from('retenciones').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
            direccion: dir, tipo: (v.tipo || 'IVA').toLowerCase(), fecha: fecha,
            periodo: v.periodo || _periodoVigente(), comprobante: compFinal,
            tercero_nombre: v.nombre, tercero_rif: normRif(v.rif), factura: v.factura, numero_control: v.numControl || null,
            base: base, pct: pct, monto: monto, estado: 'Registrado',
            // Nulo cuando la empresa no tiene sucursales o la factura es de
            // casa matriz: se comporta igual que siempre.
            sucursal_id: v.sucursal_id || null,
            concepto: esIslr ? v.concepto : null, concepto_codigo: esIslr ? cod : null, sujeto: esIslr ? suj : null, sustraendo: sust,
            // Solo en quien entera por quincena existe el campo; en los demás
            // ni se pregunta y la retención es del mes, como debe ser.
            ...(v.quincena === undefined ? {} : { quincena: v.quincena === '1' ? 1 : v.quincena === '2' ? 2 : null }),
          }).then(({ error }) => {
            if (error) {
              // 23505 = llave duplicada. Aquí solo puede ser la que impide dos
              // retenciones del mismo impuesto sobre la misma factura.
              if (window.toast) window.toast(error.code === '23505'
                ? 'Esa factura ya tiene retención de este impuesto. No se puede cargar dos veces.'
                : 'No se pudo guardar: ' + error.message, 'error');
              return;
            }
            if (window.cargarRetenciones) window.cargarRetenciones();
            if (window.toast) window.toast('Retención registrada · Bs ' + fmt(monto), 'success');
          });
        },
      });
    }
    const addBtn = document.getElementById('retAddBtn');
    if (addBtn) addBtn.addEventListener('click', () => registrarRetencion());
    window.__registrarRetencion = registrarRetencion;

    /* Qué retenciones tiene ya una factura.

       Se le pregunta a la BASE, no a la lista que tiene cargada la pantalla
       de Retenciones. Ese era el error: quien trabaja en el Libro sin haber
       abierto Retenciones tenía esa lista vacía, la comprobación no
       encontraba nada y dejaba cargar la retención dos veces. Una
       comprobación de duplicados no puede depender de qué pantalla se abrió
       antes. */
    window.__retencionesDeFactura = async (factura, direccion, rif) => {
      const nf = (factura || '').trim();
      if (!nf || !window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return [];
      const { data, error } = await window.sb.from('retenciones')
        .select('id, tipo, direccion, comprobante, monto, factura, tercero_rif, fecha')
        .eq('empresa_id', window.__EMPRESA_ACTIVA.id)
        .eq('direccion', direccion)
        .eq('factura', nf);
      if (error) { console.warn('[DigiAccount] No se pudo comprobar retenciones previas:', error.message); return []; }
      const nr = normRif(rif || '');
      return (data || []).filter((x) => !nr || normRif(x.tercero_rif || '') === nr);
    };

    /* Qué retenciones ya se cargaron contra los comprobantes de un día.

       `__retencionesDeFactura` busca un número exacto y aquí hace falta un
       RANGO: el Z dice «del 00001234 al 00001289» y la retención apunta a
       uno de ellos. Se comparan por su valor numérico y no como texto,
       porque los comprobantes vienen rellenos de ceros y '00001290' es
       menor que '999' comparando letra por letra. */
    window.__retencionesDelRango = async (desde, hasta, direccion) => {
      const num = (x) => {
        const d = String(x || '').replace(/[^0-9]/g, '');
        return d ? parseInt(d, 10) : null;
      };
      const a = num(desde), b = num(hasta);
      if (a == null || b == null || !window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return [];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const { data, error } = await window.sb.from('retenciones')
        .select('id, tipo, direccion, comprobante, monto, factura, tercero_nombre, tercero_rif, fecha')
        .eq('empresa_id', window.__EMPRESA_ACTIVA.id)
        .eq('direccion', direccion || 'sufrida');
      if (error) { console.warn('[DigiAccount] No se pudieron leer las retenciones del día:', error.message); return []; }
      return (data || []).filter((x) => {
        const n = num(x.factura);
        return n != null && n >= lo && n <= hi;
      });
    };

    // Comprobante de retención: clona el template OFICIAL completo (#compIva/#compIslr)
    // y lo llena con datos reales (firmas, partes, base legal SNAT/2025/000054 o Decreto 1.808).
    /* Con `destino` llena ESE comprobante y no imprime; sin él, clona la
       plantilla e imprime. Es la misma función porque llenar un comprobante
       de retención tiene demasiada regla —bases, alícuotas, sustraendo,
       quién es agente y quién retenido— como para tener dos versiones que
       se separen con el tiempo. La vista previa y lo que sale impreso
       tienen que decir lo mismo. */
    /* Pone la firma, el sello y el nombre de quien firma sobre la línea del
       agente de retención.

       Es un FACSÍMIL —la imagen de una firma manuscrita— y no una firma
       electrónica certificada. Para un comprobante de retención es la práctica
       normal, pero no conviene confundir una cosa con la otra.

       Si la empresa no cargó nada, o desactivó el estampado, el comprobante
       sale con la línea en blanco como siempre: no se inventa nada. */
    function estamparFirma(node, esPract) {
      const f = window.__firmaEmpresa && window.__firmaEmpresa();
      const firmas = node.querySelectorAll('.comp-sign');
      if (!firmas.length) return;

      /* El hueco va en LOS DOS bloques, aunque el segundo quede vacío. Es lo
         que mantiene las dos líneas a la misma altura sin depender de si hay
         estampado o no. Y va ANTES de la línea en el documento, que es lo que
         garantiza que se dibuje encima de ella. */
      firmas.forEach((bloque) => {
        if (bloque.querySelector('.comp-hueco-firma')) return;
        const hueco = document.createElement('div');
        hueco.className = 'comp-hueco-firma';
        bloque.insertBefore(hueco, bloque.firstChild);
      });

      if (!f) return;
      /* Solo el lado del AGENTE. En una retención sufrida el agente es el
         cliente: esa firma no es nuestra y ese comprobante lo emitió él. */
      if (!esPract) return;

      const hueco = firmas[0].querySelector('.comp-hueco-firma');
      if (!hueco) return;
      let html = '';
      if (f.sello_img) html += '<img class="cf-sello" src="' + f.sello_img + '" alt="Sello">';
      if (f.firma_img) html += '<img class="cf-firma" src="' + f.firma_img + '" alt="Firma">';
      hueco.innerHTML = html;

      // Quién firmó, debajo del trazo. Un comprobante debe decirlo.
      const linea = firmas[0].querySelector('.line');
      if (linea && (f.firmante_nombre || f.firmante_cedula || f.firmante_cargo)) {
        const quien = document.createElement('div');
        quien.className = 'comp-firmante';
        quien.innerHTML = [f.firmante_nombre, f.firmante_cedula, f.firmante_cargo]
          .filter(Boolean).map((x) => esc(x)).join(' · ');
        linea.parentNode.insertBefore(quien, linea.nextSibling);
      }
    }

    async function imprimirComprobante(r, destino) {
      const emp = window.__EMPRESA_ACTIVA || {};
      const esIslr = r.tipo === 'islr';
      const esPract = r.direccion === 'practicada';
      // El agente retiene; el sujeto retenido recibe. Se invierten según la dirección.
      const agente = esPract ? { n: emp.n, rif: emp.rif } : { n: r.tercero_nombre, rif: r.tercero_rif };
      const sujeto = esPract ? { n: r.tercero_nombre, rif: r.tercero_rif } : { n: emp.n, rif: emp.rif };
      // Cada comprobante tiene su propio N° correlativo (control MANUAL del contador). Se agrupan
      // SOLO las retenciones que comparten el mismo N° de comprobante (varias facturas en uno);
      // por defecto cada retención = su propio comprobante con su propio número.
      const ncomp = (r.comprobante || '').trim();
      /* Un comprobante es de UN proveedor: se exige tambien el RIF. Sin eso,
         dos proveedores a los que por error se les puso el mismo numero
         saldrian mezclados en un mismo documento. */
      const rifG = (x) => String(x.tercero_rif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      let grupo = (ncomp ? _retData.filter((x) => x.tipo === r.tipo && x.direccion === r.direccion
        && (x.comprobante || '').trim() === ncomp && rifG(x) === rifG(r)) : []);
      if (!grupo.length) grupo = [r];
      grupo.sort((a, b) => ((a.fecha || '').split('/').reverse().join('')).localeCompare((b.fecha || '').split('/').reverse().join('')));
      // Lookup de las facturas del período (montos exactos)
      const facMap = {};
      if (window.sb && emp.id) {
        const { data } = await window.sb.from('libro_fiscal')
          .select('numero_factura, fecha, total, base, exento, alicuota, iva')
          .eq('empresa_id', emp.id).eq('tipo', esPract ? 'compra' : 'venta');
        (data || []).forEach((f) => { facMap[(f.numero_factura || '').trim()] = f; });
      }
      const tmpl = document.getElementById(esIslr ? 'compIslr' : 'compIva');
      if (!tmpl) return;
      const node = destino || tmpl.cloneNode(true);
      if (!destino) { node.removeAttribute('id'); node.style.display = ''; }
      const set = (sel, val) => { const el = node.querySelector(sel); if (el != null) el.textContent = val; };
      const setN = (sel, i, val) => { const els = node.querySelectorAll(sel); if (els[i]) els[i].textContent = val; };
      const pctTxt = Number.isInteger(Number(r.pct)) ? String(Number(r.pct)) : Number(r.pct).toFixed(2);
      const p = (r.fecha || '').split('/');
      const anio = p.length === 3 ? (p[2].length === 2 ? '20' + p[2] : p[2]) : '';
      const mes = p.length === 3 ? p[1] : '';
      set('.comp-agent .agent-name', agente.n || '');
      const meta = node.querySelector('.comp-agent .agent-meta');
      if (meta) meta.innerHTML = '<span class="mono">RIF ' + esc(agente.rif || '') + '</span><br>'
        + esc(emp.cond || 'Contribuyente') + ' · ' + (esIslr ? 'Decreto 1.808 (Reglamento ISLR)' : 'Providencia SNAT/2025/000054');
      set('.comp-doc-title .num-box .v', r.comprobante || '');
      setN('.comp-meta-strip .cell .v', 0, r.fecha || '');
      setN('.comp-meta-strip .cell .v', 1, esIslr ? ('Ejercicio ' + anio) : ('Año ' + anio + ' · Mes ' + mes));
      setN('.comp-meta-strip .cell .v', 2, pctTxt + '%');
      setN('.comp-party-grid .pf .v', 0, sujeto.n || '');
      setN('.comp-party-grid .pf .v', 1, sujeto.rif || '');
      setN('.comp-party-grid .pf .v', 2, emp.dom && !esPract ? emp.dom : '—');
      const sujMap = { PNR: 'Natural Residente', PNNR: 'Natural No Residente', PJD: 'Jurídica Domiciliada', PJND: 'Jurídica No Domiciliada' };
      setN('.comp-party-grid .pf .v', 3, esIslr ? (sujMap[r.sujeto] || '—') : 'Contribuyente');
      const tb = node.querySelector('.comp-detail tbody');
      const tf = node.querySelector('.comp-detail tfoot');
      const words = node.querySelector('.comp-amount-words');
      let rowsHtml = '', tMonto = 0, tBase = 0, tTotal = 0, tIva = 0;
      grupo.forEach((rr) => {
        const pctT = Number.isInteger(Number(rr.pct)) ? String(Number(rr.pct)) : Number(rr.pct).toFixed(2);
        const monto = Number(rr.monto) || 0;
        if (esIslr) {
          const base = Number(rr.base) || 0;
          tBase += base; tMonto += monto;
          /* La fecha de la FILA es la de la factura retenida, no la del
             comprobante. Arriba, en «Fecha de emisión», va la de la retención:
             son dos fechas distintas y confundirlas descuadra el documento
             cuando se retiene una factura de un mes anterior.

             Si la factura no aparece en el libro se usa la de la retención,
             que es mejor que dejar la celda vacía. */
          const facI = facMap[(rr.factura || '').trim()] || null;
          const fechaFac = (facI && facI.fecha) || rr.fecha || '';
          rowsHtml += '<tr><td class="ctr">' + esc(fechaFac) + '</td><td class="ctr mono">—</td><td class="ctr">FACT</td>'
            + '<td class="ctr mono">' + esc(rr.factura || '—') + '</td><td class="ctr mono">' + esc(rr.numero_control || '—') + '</td>'
            + '<td class="num">' + fmt(base) + '</td><td class="num">' + fmt(base) + '</td><td class="num">' + fmt(base) + '</td>'
            + '<td class="ctr">' + pctT.replace('.', ',') + '</td>'
            + '<td class="concepto">' + esc(rr.concepto || '') + (rr.concepto_codigo ? ' (Cód. ' + esc(rr.concepto_codigo) + ')' : '') + '</td>'
            + '<td class="num">' + fmt(monto) + '</td></tr>';
        } else {
          const fac = facMap[(rr.factura || '').trim()] || null;
          const alic = fac && Number(fac.alicuota) ? Number(fac.alicuota) * 100 : 16;
          const ivaFact = fac ? (Number(fac.iva) || (Number(rr.base) || 0)) : (Number(rr.base) || 0);
          const baseImp = fac ? (Number(fac.base) || 0) : (alic ? ivaFact / (alic / 100) : 0);
          const exento = fac ? (Number(fac.exento) || 0) : 0;
          const total = fac ? (Number(fac.total) || (baseImp + ivaFact + exento)) : (baseImp + ivaFact + exento);
          tTotal += total; tBase += baseImp; tIva += ivaFact; tMonto += monto;
          // La fecha de la fila es la de la FACTURA, no la del comprobante.
          const fechaFac = (fac && fac.fecha) || rr.fecha || '';
          rowsHtml += '<tr><td>' + esc(fechaFac) + '</td><td class="mono">' + esc(rr.factura || '—') + '</td>'
            + '<td class="mono">' + esc(rr.numero_control || '—') + '</td><td></td><td></td>'
            + '<td class="num">' + fmt(total) + '</td><td class="num"></td><td class="num">' + fmt(baseImp) + '</td>'
            + '<td class="ctr">' + alic + '%</td><td class="num">' + fmt(ivaFact) + '</td><td class="ctr">' + pctT + '%</td>'
            + '<td class="num">' + fmt(monto) + '</td></tr>';
        }
      });
      if (tb) tb.innerHTML = rowsHtml;
      if (esIslr) {
        if (tf) tf.innerHTML = '<tr><td colspan="7" style="text-align:right;">Totales</td><td class="num">' + fmt(tBase) + '</td><td></td><td></td><td class="num highlight">' + fmt(tMonto) + '</td></tr>';
        if (words) words.innerHTML = 'Total ISLR retenido: <strong>Bs ' + fmt(tMonto) + '</strong> · ' + grupo.length + ' operación(es) en este comprobante.';
      } else {
        if (tf) tf.innerHTML = '<tr><td colspan="5" style="text-align:right;">Totales</td><td class="num">' + fmt(tTotal) + '</td><td class="num">0,00</td><td class="num">' + fmt(tBase) + '</td><td></td><td class="num">' + fmt(tIva) + '</td><td></td><td class="num highlight">' + fmt(tMonto) + '</td></tr>';
        if (words) words.innerHTML = 'Total IVA retenido: <strong>Bs ' + fmt(tMonto) + '</strong> · ' + grupo.length + ' factura(s) en este comprobante. Monto neto a cancelar: <strong>Bs ' + fmt(Math.max(0, tTotal - tMonto)) + '</strong>.';
      }
      /* La firma y el sello se estampan ANTES de decidir si esto es vista
         previa o impresión, para que lo que se ve en pantalla sea exactamente
         lo que sale por la impresora. Solo van en el lado del AGENTE: en el
         otro firma quien recibe, de su puño. */
      try { estamparFirma(node, esPract); } catch (e) { console.warn('[Firma]', e); }

      // Solo pintar la vista previa: no hay nada que imprimir todavía.
      if (destino) { if (window.lucide) window.lucide.createIcons(); return; }
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      portal.appendChild(node);
      document.body.classList.add('printing-comp');
      if (window.lucide) window.lucide.createIcons();
      window.print();
    }
    /* Llena el comprobante que se ve en la pestaña Comprobantes — que es el
       mismo que clona el botón de imprimir, así que lo que se ve es lo que
       sale. Antes mostraba la plantilla vacía y se podía imprimir en blanco. */
    window.__pintarComprobante = (r) => {
      const el = document.getElementById(r.tipo === 'islr' ? 'compIslr' : 'compIva');
      if (el) imprimirComprobante(r, el);
    };
    window.__perLabelRetPub = _perLabelRet;

    // Editar / eliminar: clic en cualquier fila de retención
    /* Publicada porque el cuadro del libro de compras necesita abrir una
       retención concreta —la que le falta la quincena— desde otro alcance. */
    function editRetencion(id) {
      const r = _retData.find((x) => String(x.id) === String(id));
      if (!r) return;
      window.openFormModal && window.openFormModal({
        title: 'Editar retención',
        saveLabel: 'Guardar cambios',
        fields: [
          { name: 'direccion', label: '¿Quién retiene?', type: 'select', options: ['Practicada (yo retengo a un proveedor)', 'Sufrida (un cliente me retiene)'], value: r.direccion === 'practicada' ? 'Practicada (yo retengo a un proveedor)' : 'Sufrida (un cliente me retiene)' },
          { name: 'tipo', label: 'Impuesto', type: 'select', options: ['IVA', 'ISLR'], value: r.tipo === 'islr' ? 'ISLR' : 'IVA' },
          { name: 'concepto', label: 'Concepto de retención (ISLR)', col: 2, type: 'select', options: CONCEPTOS_ISLR.map((c) => c.act), value: r.concepto || CONCEPTOS_ISLR[0].act },
          { name: 'sujeto', label: 'Tipo de sujeto (ISLR)', type: 'select', options: [{ value: 'PNR', label: 'PN Residente' }, { value: 'PNNR', label: 'PN No Residente' }, { value: 'PJD', label: 'PJ Domiciliada' }, { value: 'PJND', label: 'PJ No Domiciliada' }], value: r.sujeto || 'PNR' },
          { name: 'fecha', label: 'Fecha (dd/mm/aa)', value: r.fecha || '', placeholder: '27/08/26' },
          { name: 'nombre', label: 'Tercero', col: 2, value: r.tercero_nombre || '' },
          { name: 'rif', label: 'RIF', upper: true, value: r.tercero_rif || '' },
          { name: 'factura', label: 'Factura afectada', value: r.factura || '' },
          { name: 'numControl', label: 'N° de Control', value: r.numero_control || '' },
          { name: 'comprobante', label: 'N° Comprobante', value: r.comprobante || '' },
          { name: 'base', label: 'Monto sobre el que se retiene (Bs)', type: 'number', step: '0.01', value: r.base != null ? String(r.base) : '' },
          { name: 'pct', label: '% de retención', type: 'number', step: '0.01', value: r.pct != null ? String(r.pct) : '' },
          { name: 'sustraendo', label: 'Sustraendo (ISLR)', type: 'number', step: '0.01', value: r.sustraendo != null ? String(r.sustraendo) : '0' },
        ].concat((window.__retencionesPorQuincena && window.__retencionesPorQuincena()) ? [
          /* La quincena se ELIGE, no se deduce.

             Es la del período en que la retención se ENTERA, no la del día de
             la factura: en Radian hay nueve de octubre fechadas en septiembre
             —compras recibidas tarde— y por el día se irían a la quincena que
             no es. Por eso hay un desplegable y no un cálculo.

             Sin quincena la retención no se esconde: sale en las dos, y por
             eso el TXT avisa de que se enteraría dos veces. Aquí es donde se
             arregla. */
          { name: 'quincena', col: 2,
            label: 'Quincena en que se entera' + (r.quincena === 1 || r.quincena === 2 ? '' : ' — SIN ASIGNAR: hoy sale en las dos'),
            type: 'select',
            options: [{ value: '', label: 'Sin asignar todavía' },
                      { value: '1', label: '1ra quincena (se entera del 1 al 15)' },
                      { value: '2', label: '2da quincena (se entera del 16 al último día)' }],
            value: r.quincena === 1 ? '1' : r.quincena === 2 ? '2' : '' },
        ] : []),
        afterRender: (body) => { setupPctField(body); setupIslrFields(body); },
        extraLabel: 'Comprobante',
        /* Igual que en la fila: solo se imprime el de una practicada. En
           una sufrida el documento es el que emitió el cliente. */
        onExtra: r.direccion === 'practicada' ? () => imprimirComprobante(r) : null,
        onSave: (v) => {
          if (!window.sb) return 'Sin conexión.';
          if (!v.nombre) return 'Indica el tercero.';
          /* De esta fecha salen el TXT del IVA y el XML del ISLR. Se
             normaliza SIEMPRE: una fecha mal escrita no se nota hasta que el
             portal rebota el archivo. */
          const fechaOk = window.__normFecha ? window.__normFecha(v.fecha) : v.fecha;
          if (!fechaOk) return 'No entiendo la fecha "' + (v.fecha || '') + '". Escríbela como 27/08/26.';
          const esIslr = /islr/i.test(v.tipo);
          const base = parseFloat(v.base) || 0, pct = parseFloat(v.pct) || 0;
          let cod = '', suj = '', sust = 0, monto;
          if (esIslr) {
            suj = v.sujeto || '';
            const variant = variantIslr(v.concepto, suj);
            cod = variant ? variant[0] : '';
            sust = parseFloat(v.sustraendo) || 0;
            monto = Math.max(0, base * pct / 100 - sust);
          } else {
            monto = base * pct / 100;
          }
          const dir = /practicada/i.test(v.direccion) ? 'practicada' : 'sufrida';
          /* ══════════════════════════════════════════════════════════════
             EL PERIODO SIGUE A LA CORRECCION

             Antes se guardaba la fecha nueva y `periodo` se quedaba con el
             viejo. Una retencion cargada por error en agosto seguia en
             agosto por mucho que se corrigiera el dia: en pantalla parecia
             que el formulario no guardaba nada.

             En IVA el periodo lo manda el COMPROBANTE —sus seis primeros
             digitos son año y mes, asi lo define el SENIAT y es lo que se
             declara—. En ISLR, la fecha del documento.
             ══════════════════════════════════════════════════════════════ */
          const pf = String(fechaOk || '').split('/');        // dd/mm/aa
          const periodoFecha = pf.length === 3 ? ('20' + pf[2].slice(-2) + '-' + pf[1]) : null;
          let compOk = (v.comprobante || '').trim();
          const periodoOk = periodoFecha;
          if (!esIslr) {
            /* El numero del comprobante se revisa TAMBIEN al editar: antes no
               se miraba, y se podia dejar uno de 13 digitos o con letras que
               despues rebota el portal. */
            const rev = revisarCompIva(compOk, (pf.length === 3 ? ('20' + pf[2].slice(-2) + '-' + pf[1] + '-' + pf[0]) : ''));
            if (rev.error) return rev.error;
            compOk = rev.valor;
            /* El comprobante TIENE que ir con el periodo de la retencion: sus
               seis primeros digitos son ese año y ese mes. Si no coinciden, se
               para aqui y se dice que hay que cambiar — declarar un
               comprobante de otro mes es un archivo rebotado. */
            /* Si el comprobante no empieza por el año y mes de la retención
               se AVISA y se guarda igual: el número puede venir así del
               documento del proveedor, y quien declara es quien sabe. */
            const espera = periodoOk ? periodoOk.replace('-', '') : '';
            if (espera && rev.valor.slice(0, 6) !== espera && window.toast) {
              window.toast('Ojo: la retención es del ' + fechaOk + ' y su comprobante empieza por '
                + rev.valor.slice(0, 6) + ', no por ' + espera + '. Se guardó igual; revísalo antes de declarar.', 'warn');
            }
          }
          window.sb.from('retenciones').update({
            direccion: dir, tipo: (v.tipo || 'IVA').toLowerCase(), fecha: fechaOk,
            ...(periodoOk ? { periodo: periodoOk } : {}),
            comprobante: compOk, tercero_nombre: v.nombre, tercero_rif: normRif(v.rif),
            factura: v.factura, numero_control: v.numControl || null, base: base, pct: pct, monto: monto,
            concepto: esIslr ? v.concepto : null, concepto_codigo: esIslr ? cod : null, sujeto: esIslr ? suj : null, sustraendo: sust,
            // El campo solo existe en quien entera por quincena; si no está,
            // se deja como estaba en vez de borrarlo con un nulo.
            ...(v.quincena === undefined ? {} : { quincena: v.quincena === '1' ? 1 : v.quincena === '2' ? 2 : null }),
          }).eq('id', id).then(({ error }) => {
            if (error) { if (window.toast) window.toast('No se pudo actualizar: ' + error.message, 'error'); return; }
            if (window.cargarRetenciones) window.cargarRetenciones();
            if (window.__invalidarArrastres) window.__invalidarArrastres();   // cambiar de periodo mueve lo declarado
            if (window.toast) window.toast('Retención actualizada · Bs ' + fmt(monto)
              + (periodoOk ? ' · período ' + periodoOk : ''), 'success');
          });
        },
        onDelete: (closeModal) => {
          if (!window.confirm('¿Eliminar esta retención? Esta acción no se puede deshacer.')) return;
          window.sb.from('retenciones').delete().eq('id', id).then(({ error }) => {
            if (error) { if (window.toast) window.toast('No se pudo eliminar: ' + error.message, 'error'); return; }
            if (window.cargarRetenciones) window.cargarRetenciones();
            if (window.toast) window.toast('Retención eliminada', 'success');
          });
          closeModal();
        },
      });
    }
    views.forEach((v) => v.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) editRetencion(tr.dataset.id);
    }));

    // Estado inicial
    cargarRetenciones();
  })();
})();
