/* =========================================================
   DigiAccount ERP — FACTURAS
   El visor de la factura fiscal venezolana: la factura en pantalla y
   en papel, el ticket y como se comparte, y las notas de credito y de
   debito que la corrigen sin tocarla.

   Solo usaba dos nombres privados del bloque grande —`esc` y
   `drawIcons`—, que ya viven en el nucleo. (El tercero, `fmtF`, no lo
   tenia nadie: faltaba, y por eso el boton de Notas reventaba.)

   Se carga DESPUES de app.js: lo que expone —la factura, su lista, el
   ticket en PDF y el compartir— lo consumen ventas, tesoreria y el
   modulo fiscal
   a traves de `window.*`, y lo que necesita de ellos tambien.
   ========================================================= */
(function () {
  'use strict';

  // Los nombres cortos que usa el cuerpo, apuntando al nucleo.
  const esc = window.__esc;
  const drawIcons = window.__drawIcons;

  /* =========================================================
     VISOR DE FACTURA FISCAL (venezolana)
     ========================================================= */
  (function facturas() {
    const overlay = document.getElementById('facturaOverlay');
    const doc = document.getElementById('facturaDoc');
    const modalTitle = document.getElementById('facturaModalTitle');
    if (!overlay || !doc) return;

    /* El formateo de numero. Faltaba aqui: `emitirNota` lo usaba para armar el
       modal, pero las unicas dos `fmtF` del archivo estan dentro de OTROS
       modulos (Libros y Fiscal), y desde este cierre no se ven. Resultado: el
       boton de Notas reventaba antes de abrir, y no se podia emitir ninguna
       nota de credito ni de debito. El modulo de Libros ya tenia la suya por
       esta misma razon; a este se le habia olvidado. */
    const fmtF = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Datos del emisor/receptor propios: SIEMPRE la empresa activa real (nunca quemados)
    const EMPRESA = {
      get n() { return (window.__EMPRESA_ACTIVA || {}).n || '—'; },
      get rif() { return (window.__EMPRESA_ACTIVA || {}).rif || '—'; },
      get dom() { return (window.__EMPRESA_ACTIVA || {}).dom || ''; },
      get cond() { return (window.__EMPRESA_ACTIVA || {}).cond || ''; },
    };
    const IMPRENTA = { n: 'Gráficas El Sol, C.A.', rif: 'J-31002030-4', prov: 'SNAT/INTI/GRTI/RCO/2024/0185', desde: '00012001', hasta: '00015000' };
    const MAQ = { n: 'Z7C0025982', serial: 'VE-FISCAL-0044712', modelo: 'The Factory HKA PP-80 (homologado SENIAT)' };
    const ELEC = { prov: 'DigiFactura Electrónica, C.A.', rif: 'J-40551203-7', prov_aut: 'SNAT/2024/00102-DE-0087' };

    // Generador de un código QR ilustrativo (placeholder determinista) para la factura electrónica
    function qrSvg(seed) {
      const n = 21; let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      let rects = '';
      const inFinder = (x, y, fx, fy) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let on;
        if (inFinder(x, y, 0, 0) || inFinder(x, y, n - 7, 0) || inFinder(x, y, 0, n - 7)) {
          const fx = x < 7 ? 0 : (n - 7), fy = y < 7 ? 0 : (n - 7), lx = x - fx, ly = y - fy;
          on = (lx === 0 || lx === 6 || ly === 0 || ly === 6) || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
        } else on = rnd() > 0.5;
        if (on) rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
      return '<svg viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/><g fill="#0b1e3a">' + rects + '</g></svg>';
    }
    const fmt = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // Catálogo de facturas (ventas y compras) con sus renglones
    const DB = {};   // las facturas/recibos reales vienen de Supabase

    function calcFactura(f) {
      const subtotal = f.items.reduce((a, it) => a + it.c * it.p, 0);
      const iva = subtotal * f.alic;
      const igtf = f.igtf ? subtotal * 0.03 : 0;
      const total = subtotal + iva + igtf;
      return { subtotal, iva, igtf, total };
    }

    let lastText = '', lastName = 'factura.txt', currentFac = null;

    function openFactura(num, yaEspero) {
      const f = DB[num];
      if (!f) return;
      /* El dolar del recibo sale de la tasa del momento de emision: si el
         historial aun no llego, se pinta cuando llegue (una sola espera). */
      if (!yaEspero && f.tipo === 'venta' && !window.__TASAS_USD && window.__cargarTasasUSD) {
        window.__cargarTasasUSD().then(() => openFactura(num, true));
        return;
      }
      const t = calcFactura(f);
      const emisor = f.tipo === 'venta' ? (window.__EMPRESA_ACTIVA || EMPRESA) : f.parte;
      const receptor = f.tipo === 'venta' ? f.parte : EMPRESA;
      currentFac = { num: num, f: f, emisor: emisor, receptor: receptor };
      const alicLabel = (f.alic * 100).toLocaleString('es-VE') + '%';
      const _rec = window.__esRecibo ? window.__esRecibo() : true;
      modalTitle.textContent = (f.tipo === 'venta' ? ((_rec ? 'Recibo' : 'Factura') + ' de venta · ') : 'Factura de compra · ') + num;

      const itemRows = f.items.map((it, i) =>
        '<tr><td class="mono">ART-' + String(i + 1).padStart(3, '0') + '</td><td>' + it.d + '</td><td class="num">' + it.c + '</td><td class="num">' + fmt(it.p) + '</td>' + (_rec ? '' : '<td class="ctr">' + alicLabel + '</td>') + '<td class="num">' + fmt(it.c * it.p) + '</td></tr>'
      ).join('');

      const letras = window.__montoEnLetras ? cap(window.__montoEnLetras(t.total)) : ('Bs ' + fmt(t.total));

      // Medio de emisión: adapta el título y el pie legal de la factura
      const medio = _rec ? 'forma-libre' : (window.medioEmision || 'forma-libre');
      const tituloDoc = _rec ? 'RECIBO DE VENTA'
        : medio === 'electronica' ? 'FACTURA ELECTRÓNICA'
        : medio === 'maquina-fiscal' ? 'FACTURA · MÁQ. FISCAL' : 'FACTURA';
      const ctrlDigital = num.replace(/\D/g, '') + '-' + f.fecha.replace(/\D/g, '');
      let pieMedio;
      if (medio === 'maquina-fiscal') {
        pieMedio = '<div class="fac-legal"><strong>Máquina Fiscal:</strong> N° de registro ' + MAQ.n + ' · Serial ' + MAQ.serial + ' · Modelo ' + MAQ.modelo + '. Número de documento asignado por la máquina fiscal; reporte Z diario obligatorio. Documento emitido conforme a la Providencia Administrativa SNAT/2024/00102. El IGTF (3%) aplica a pagos en moneda extranjera o criptoactivos (Decreto Constituyente). Generado por DigiAccount.</div>';
      } else if (medio === 'electronica') {
        pieMedio = '<div class="fac-legal-e"><div class="fle-qr">' + qrSvg(num + ctrlDigital) + '</div>'
          + '<div class="fle-txt"><strong>Factura Electrónica</strong> · Certificada por ' + ELEC.prov + ' (RIF ' + ELEC.rif + ') · Autorización ' + ELEC.prov_aut + '.<br>N° de control digital: <span class="mono">' + ctrlDigital + '</span>. Verifique la validez de este documento escaneando el código QR en el portal del SENIAT. Emitido conforme a la Providencia Administrativa SNAT/2024/00102. El IGTF (3%) aplica a pagos en moneda extranjera o criptoactivos.</div></div>';
      } else if (_rec) {
        pieMedio = '<div class="fac-legal"><strong>RECIBO DE VENTA — Documento no fiscal.</strong> Este comprobante no constituye una factura ni genera crédito fiscal. Emitido por DigiAccount. El IGTF (3%) aplica a pagos en moneda extranjera o criptoactivos (Decreto Constituyente).</div>';
      } else {
        pieMedio = '<div class="fac-legal">Imprenta autorizada: <strong>' + IMPRENTA.n + '</strong> · RIF ' + IMPRENTA.rif + ' · Providencia N° ' + IMPRENTA.prov + ' · Facturas autorizadas del N° ' + IMPRENTA.desde + ' al ' + IMPRENTA.hasta + '. Documento emitido conforme a la Providencia Administrativa SNAT/2024/00102 sobre las normas generales de emisión de facturas y otros documentos. El IGTF (3%) aplica a pagos en moneda extranjera o criptoactivos (Decreto Constituyente). Generado por DigiAccount.</div>';
      }

      if (_rec) {
        // ===== RECIBO DE CAJA (rollo angosto, NO fiscal) =====
        /* EL RECIBO DE VENTA VA EN DOLARES, SIN BOLIVARES.

           Un total en bolivares le da al cliente una cifra de la que
           agarrarse: vuelve dias despues a pagar «lo que dice el papel», y
           ese bolivar ya no vale lo mismo. El dolar pactado no cambia.

           El dolar sale de la tasa del MOMENTO EN QUE SE EMITIO (f._emitida):
           con esa tasa se convirtieron los precios, asi que es la unica que
           devuelve el dolar exacto — no la de hoy, ni la de la fecha escrita.
           Sin tasa para ese momento no se inventa nada: sale en bolivares. */
        /* La tasa CON LA QUE SE EMITIO, guardada en el documento. Solo los
           recibos anteriores a esa columna la reconstruyen por su fecha. */
        const _tasaTk = Number(f._tasa) || ((window.__tasaUSDEn && window.__tasaUSDEn(f._emitida)) || 0);
        const _enUsd = _tasaTk > 0;
        const _fmtUsd = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const _m = (bs) => (_enUsd ? '$' + _fmtUsd(bs / _tasaTk) : fmt(bs));
        const _n = (bs) => (_enUsd ? _fmtUsd(bs / _tasaTk) : fmt(bs));
        const _mon = _enUsd ? '$' : 'Bs';
        const _totalUsd = Number(f._usd) > 0 ? Number(f._usd)
          : (_enUsd ? Math.round((t.total / _tasaTk) * 100) / 100 : 0);
        const _letrasTk = (_enUsd && window.__montoEnLetras) ? cap(window.__montoEnLetras(_totalUsd, 'USD')) : letras;
        const tkItems = f.items.map((it) => {
          const m = it.c * it.p;
          return '<div class="tk-item"><div class="tk-item-d">' + it.d.toUpperCase() + '</div>'
            + '<div class="tk-item-l"><span>' + it.c + ' x ' + _m(it.p) + '</span><span>' + _m(m) + '</span></div></div>';
        }).join('');
        doc.innerHTML =
          '<div class="fac-ticket">'
          /* El logo tambien en el ticket. El arreglo anterior solo llego al
             formato documento, y quien vende por mostrador usa este: su logo
             seguia sin aparecer. */
          + '<div class="tk-head">'
          + ((window.__logoEmpresa && window.__logoEmpresa()) ? '<img class="tk-logo-img" src="' + window.__logoEmpresa() + '" alt="">' : '')
          + '<div class="tk-co">' + emisor.n.toUpperCase() + '</div>'
          + '<div class="tk-line">RIF: ' + emisor.rif + '</div>'
          + (emisor.dom ? '<div class="tk-line">' + emisor.dom + '</div>' : '') + '</div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-doc">RECIBO DE VENTA</div>'
          + '<div class="tk-row"><span>N°</span><span>' + num + '</span></div>'
          + '<div class="tk-row"><span>FECHA</span><span>' + f.fecha + '</span></div>'
          + '<div class="tk-line">CLIENTE: ' + receptor.n + '</div>'
          + '<div class="tk-line">RIF/CI: ' + receptor.rif + '</div>'
          + '<div class="tk-sep dashed"></div>'
          + tkItems
          + '<div class="tk-sep dashed"></div>'
          + (f.igtf ? '<div class="tk-row"><span>SUBTOTAL ' + _mon + '</span><span>' + _n(t.subtotal) + '</span></div>' : '')
          + (f.igtf ? '<div class="tk-row"><span>IGTF 3% ' + _mon + '</span><span>' + _n(t.igtf) + '</span></div>' : '')
          + '<div class="tk-total"><span>TOTAL ' + _mon + '</span><span>' + (_enUsd ? _fmtUsd(_totalUsd) : fmt(t.total)) + '</span></div>'
          /* Se dice en el papel, porque es justo la discusion que se quiere evitar. */
          + (_enUsd ? '<div class="tk-line tk-center tk-nota-tasa">Precios en dólares. Si paga en bolívares, se calcula a la tasa BCV del día en que pague.</div>' : '')
          + '<div class="tk-sep"></div>'
          + '<div class="tk-words">SON: ' + _letrasTk + '</div>'
          + ((window.__pagoMovilTicket && window.__pagoMovilTicket()) || '')
          + '<div class="tk-sep dashed"></div>'
          + '<div class="tk-line tk-center">Documento no fiscal · no constituye una factura</div>'
          + '<div class="tk-thanks">¡GRACIAS POR SU COMPRA!</div>'
          + '<div class="tk-line tk-center">Generado por DigiAccount</div>'
          + '</div>';
      } else if (medio === 'maquina-fiscal') {
        // ===== Formato TICKET de impresora fiscal (rollo angosto) =====
        const hora = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        const tasaLetra = f.alic === 0.16 ? 'T' : f.alic === 0.08 ? 'R' : 'E';
        const tasaDesc = f.alic === 0.16 ? 'TASA GENERAL 16%' : f.alic === 0.08 ? 'TASA REDUCIDA 8%' : 'EXENTO';
        const tkItems = f.items.map((it) =>
          '<div class="tk-item"><div class="tk-item-d">' + it.d.toUpperCase() + '</div>'
          + '<div class="tk-item-l"><span>' + it.c + ' x ' + fmt(it.p) + '</span><span>' + fmt(it.c * it.p) + ' ' + tasaLetra + '</span></div></div>'
        ).join('');
        doc.innerHTML =
          '<div class="fac-ticket">'
          + '<div class="tk-head"><div class="tk-co">' + emisor.n.toUpperCase() + '</div>'
          + '<div class="tk-line">RIF: ' + emisor.rif + '</div>'
          + (emisor.dom ? '<div class="tk-line">' + emisor.dom + '</div>' : '') + '</div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-row"><span>MÁQUINA FISCAL</span><span>' + MAQ.n + '</span></div>'
          + '<div class="tk-row"><span>FECHA</span><span>' + f.fecha + '</span></div>'
          + '<div class="tk-row"><span>HORA</span><span>' + hora + '</span></div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-doc">FACTURA   N° ' + num.replace(/\D/g, '') + '</div>'
          + '<div class="tk-line">CLIENTE: ' + receptor.n + '</div>'
          + '<div class="tk-line">RIF/CI: ' + receptor.rif + '</div>'
          + '<div class="tk-sep dashed"></div>'
          + tkItems
          + '<div class="tk-sep dashed"></div>'
          + '<div class="tk-row"><span>SUBTOTAL Bs</span><span>' + fmt(t.subtotal) + '</span></div>'
          + '<div class="tk-row"><span>IVA (' + alicLabel + ') ' + tasaLetra + '</span><span>' + fmt(t.iva) + '</span></div>'
          + (f.igtf ? '<div class="tk-row"><span>IGTF 3%</span><span>' + fmt(t.igtf) + '</span></div>' : '')
          + '<div class="tk-sep"></div>'
          + '<div class="tk-total"><span>TOTAL Bs</span><span>' + fmt(t.total) + '</span></div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-line tk-center">' + tasaLetra + ' = ' + tasaDesc + '</div>'
          + '<div class="tk-words">SON: ' + letras + '</div>'
          + '<div class="tk-sep dashed"></div>'
          + '<div class="tk-fiscal"><div class="tk-logo">▮ tt ▮</div>'
          + '<div class="tk-line tk-center">SERIAL: ' + MAQ.serial + '</div>'
          + '<div class="tk-line tk-center">' + MAQ.modelo + '</div></div>'
          + '<div class="tk-thanks">¡GRACIAS POR SU COMPRA!</div>'
          + '<div class="tk-line tk-center">Generado por DigiAccount</div>'
          + '</div>';
      } else {
        // ===== Formato documento (Forma libre / Electrónica) — media carta =====
        doc.innerHTML =
          '<div class="fac' + (medio === 'electronica' ? ' fac-e' : '') + '">'
          + (medio === 'electronica' ? '<div class="fac-e-band"><i data-lucide="shield-check"></i> DOCUMENTO ELECTRÓNICO CERTIFICADO · SENIAT</div>' : '')
          + '<div class="fac-head">'
          + '<div class="fac-emisor">'
          /* El logo de la empresa, si lo subio. Va en los DOS medios: una
             forma libre tambien lleva el logo de quien la emite. Si no hay
             logo se mantienen las iniciales del modo electronico, que es
             como se venia viendo. */
          + (function () {
            const logo = (window.__logoEmpresa && window.__logoEmpresa()) || '';
            if (logo) return '<img class="fac-logo-img" src="' + logo + '" alt="">';
            if (medio !== 'electronica') return '';
            return '<div class="fac-logo">'
              + (emisor.n.replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase() || 'AV')
              + '</div>';
          })()
          + '<div class="fac-emisor-txt"><div class="fac-co">' + emisor.n + '</div>'
          + '<div class="fac-meta"><span class="mono">RIF ' + emisor.rif + '</span>' + (emisor.cond ? ' · ' + emisor.cond : '') + '<br>' + emisor.dom + '</div></div></div>'
          + '<div class="fac-num"><div class="t">' + tituloDoc + '</div>'
          + '<div class="r"><span>N°</span><strong>' + num + '</strong></div>'
          + (_rec ? '' : '<div class="c"><span>N° de Control</span><strong>' + f.control + '</strong></div>') + '</div>'
          + '</div>'
          + '<div class="fac-cliente"><div class="fc-grid">'
          + '<div class="fc-f"><span class="l">Nombre o Razón Social</span><span class="v">' + receptor.n + '</span></div>'
          + '<div class="fc-f"><span class="l">RIF / C.I.</span><span class="v mono">' + receptor.rif + '</span></div>'
          + '<div class="fc-f"><span class="l">Fecha de Emisión</span><span class="v">' + f.fecha + '</span></div>'
          + '<div class="fc-f"><span class="l">Condición de Pago</span><span class="v">' + f.cond + '</span></div>'
          + '<div class="fc-f wide"><span class="l">Domicilio Fiscal</span><span class="v">' + receptor.dom + '</span></div>'
          + '</div></div>'
          + '<table class="fac-table"><thead><tr><th>Cód.</th><th>Descripción</th><th class="num">Cant.</th><th class="num">P. Unitario</th>' + (_rec ? '' : '<th class="ctr">Alíc.</th>') + '<th class="num">Monto</th></tr></thead>'
          + '<tbody>' + itemRows + '</tbody></table>'
          + '<div class="fac-bottom">'
          + '<div class="fac-words">Son: <strong>' + letras + '</strong></div>'
          + '<div class="fac-tot">'
          + (_rec ? '' : '<div class="ft-row"><span>Base imponible (' + alicLabel + ')</span><span class="mono">' + fmt(t.subtotal) + '</span></div>')
          + (_rec ? '' : '<div class="ft-row"><span>IVA (' + alicLabel + ')</span><span class="mono">' + fmt(t.iva) + '</span></div>')
          + (f.igtf ? '<div class="ft-row"><span>IGTF (3%)</span><span class="mono">' + fmt(t.igtf) + '</span></div>' : '')
          + '<div class="ft-row total"><span>TOTAL A PAGAR</span><span class="mono">Bs ' + fmt(t.total) + '</span></div>'
          + '</div></div>'
          + '<div class="fac-firmas"><div class="ff"><div class="line"></div>Por el emisor</div><div class="ff"><div class="line"></div>Recibido conforme · RIF/C.I.</div></div>'
          + pieMedio
          + '</div>';
      }

      lastText = _rec
        ? ('RECIBO DE VENTA N° ' + num + '\r\n'
          + 'Emisor: ' + emisor.n + ' - RIF ' + emisor.rif + '\r\n'
          + 'Cliente: ' + receptor.n + ' - RIF ' + receptor.rif + '\r\n'
          + 'Fecha: ' + f.fecha + '\r\n----------------------------------------\r\n'
          + f.items.map((it) => '  ' + it.d + '  ' + it.c + ' x ' + fmt(it.p) + ' = ' + fmt(it.c * it.p)).join('\r\n')
          + '\r\n----------------------------------------\r\n'
          + (f.igtf ? ('Subtotal: Bs ' + fmt(t.subtotal) + '\r\n' + 'IGTF 3%: Bs ' + fmt(t.igtf) + '\r\n') : '')
          + 'TOTAL: Bs ' + fmt(t.total) + '\r\n'
          + 'Documento no fiscal - no constituye una factura\r\n')
        : ((f.tipo === 'venta' ? 'FACTURA DE VENTA' : 'FACTURA DE COMPRA') + ' N° ' + num + ' (Control ' + f.control + ')\r\n'
          + 'Emisor: ' + emisor.n + ' - RIF ' + emisor.rif + '\r\n'
          + (f.tipo === 'venta' ? 'Cliente: ' : 'Proveedor: ') + receptor.n + ' - RIF ' + receptor.rif + '\r\n'
          + 'Fecha: ' + f.fecha + '\r\n----------------------------------------\r\n'
          + f.items.map((it) => '  ' + it.d + '  ' + it.c + ' x ' + fmt(it.p) + ' = ' + fmt(it.c * it.p)).join('\r\n')
          + '\r\n----------------------------------------\r\n'
          + 'Base imponible: Bs ' + fmt(t.subtotal) + '\r\n'
          + 'IVA (' + alicLabel + '): Bs ' + fmt(t.iva) + '\r\n'
          + (f.igtf ? 'IGTF (3%): Bs ' + fmt(t.igtf) + '\r\n' : '')
          + 'TOTAL: Bs ' + fmt(t.total) + '\r\n');
      lastName = 'Factura_' + num + '.txt';

      // Botón "Cobrar": solo en recibos de venta con saldo pendiente (y no anulados)
      const anulada = /anulada/i.test(f.estado || '');
      const cobrarBtn = document.getElementById('facturaCobrar');
      if (cobrarBtn) {
        const cobrado = window.__cobradoDe ? window.__cobradoDe(num) : 0;
        const pend = Math.max(0, t.total - cobrado);
        if (f.tipo === 'venta' && pend > 0.01 && !anulada) { cobrarBtn.hidden = false; cobrarBtn.dataset.pend = pend.toFixed(2); }
        else cobrarBtn.hidden = true;
      }
      // Botón "Anular": solo recibos de venta SIN cobros registrados y no anulados ya
      /* Anular o emitir nota: nunca los dos.

         En modo RECIBO se anula como siempre — un recibo no es una factura y
         nadie que trabaje hoy se ve afectado. En modo FACTURA se esconde
         Anular y aparece la nota de credito, porque la 000121 (Art. 3.d) solo
         admite corregir o anular una factura mediante notas, conservando el
         documento original inalterable. */
      const _esFactura = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.modo_doc) === 'factura';
      const anularBtn = document.getElementById('facturaAnular');
      const notaBtn = document.getElementById('facturaNota');
      const cobrado2 = window.__cobradoDe ? window.__cobradoDe(num) : 0;
      const esVentaViva = f.tipo === 'venta' && !anulada && f._id;
      /* En un recibo el boton es ELIMINAR (no fiscal: se borra y se hace de
         nuevo). Se muestra aunque tenga cobros: antes se escondia y nadie
         entendia por que no estaba — ahora esta y dice que falta. */
      /* En CUALQUIER recibo: tambien el anulado —que es el que mas se quiere
         borrar— y el que ya tiene cobros. Antes se pedia `esVentaViva`, que
         excluye los anulados, y el boton desaparecia sin explicar por que. */
      if (anularBtn) anularBtn.hidden = !(f.tipo === 'venta' && f._id && !_esFactura);
      /* La nota SI se puede emitir aunque la factura tenga cobros: para eso
         existe. Devolver mercancia ya pagada es el caso mas comun de todos. */
      if (notaBtn) notaBtn.hidden = !(esVentaViva && _esFactura);

      /* Un ticket se le MANDA al cliente: el boton dice Compartir. Las
         facturas y demas documentos siguen con su Descargar de siempre. */
      const dlBtn = document.getElementById('facturaDownload');
      if (dlBtn) dlBtn.innerHTML = doc.querySelector('.fac-ticket')
        ? '<i data-lucide="share-2"></i> Compartir'
        : '<i data-lucide="download"></i> Descargar';

      overlay.dataset.open = 'true';
      drawIcons();
    }

    function close() { overlay.dataset.open = 'false'; }
    // Cobrar: abre el registro de cobro prefilleado con el cliente, el recibo y el saldo pendiente
    const cobrarBtnEl = document.getElementById('facturaCobrar');
    if (cobrarBtnEl) cobrarBtnEl.addEventListener('click', () => {
      if (!currentFac) return;
      const pre = { tipo: 'ingreso', tercero: currentFac.receptor.n, factura: currentFac.num, monto: cobrarBtnEl.dataset.pend };
      close();
      if (window.__registrarCobro) window.__registrarCobro(pre);
      else if (window.toast) window.toast('Abre el módulo de Tesorería para registrar el cobro.', 'error');
    });
    /* ══════════════════════════════════════════════════════════════════
       ELIMINAR EL RECIBO · anular es de la factura fiscal

       Una factura autorizada no se borra: el numero queda usado y el
       documento debe seguir existiendo, anulado. Un recibo no es fiscal;
       si salio con un error se borra y se hace de nuevo, y su numero vuelve
       a quedar libre porque el correlativo sale del mayor emitido.

       Se va el asiento de la venta y vuelve el stock. El asiento se ELIMINA
       en vez de reversarse: el documento deja de existir, y un reverso que
       apunta a un recibo inexistente no le sirve a nadie.

       CON COBROS NO SE BORRA. Primero se elimina el cobro en Tesoreria —que
       hace su propio reverso—. Borrar la venta dejando el dinero colgando de
       un documento que ya no existe es como aparecen los descuadres.
       ══════════════════════════════════════════════════════════════════ */
    const anularBtnEl = document.getElementById('facturaAnular');
    if (anularBtnEl) anularBtnEl.addEventListener('click', async () => {
      if (!currentFac || !currentFac.f || !currentFac.f._id) return;
      const num = currentFac.num, f = currentFac.f;
      const cobrado = window.__cobradoDe ? window.__cobradoDe(num) : 0;
      /* Si ya estaba ANULADO, el stock se repuso al anularlo. */
      const anuladoYa = /anulada/i.test(f.estado || '');
      const ok = window.confirm('¿ELIMINAR el recibo ' + num + '?'
        + (anuladoYa ? ' (está anulado)' : '') + '\n\n'
        + '· Se borra de la base y de la lista de ventas\n'
        + (cobrado > 0.01
          ? '· Se borran también sus COBROS por Bs ' + fmt(cobrado) + ' (ese dinero sale de Tesorería)\n'
          : '')
        + (anuladoYa
          ? '· El stock NO se toca: ya se repuso al anularlo\n'
          : '· Vuelve el stock de los productos\n')
        + '· Se eliminan sus asientos contables\n'
        + '· El número ' + num + ' queda libre para el próximo recibo\n\n'
        + 'No se puede deshacer.');
      if (!ok) return;

      const empId = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) || null;
      /* Los cobros primero: si algo falla despues, queda el recibo con su
         cobro —coherente— y no un cobro suelto sin documento. */
      /* Se intenta SIEMPRE, sepamos o no de cobros: `__cobradoDe` lee la lista
         de Tesoreria, y si ese modulo no se ha cargado devuelve 0. Un cobro
         suelto sin documento es peor que un borrado de mas que no borra nada. */
      if (empId) {
        const { error: eM } = await window.sb.from('movimientos_tesoreria').delete()
          .eq('empresa_id', empId).eq('factura_ref', num);
        if (eM) { if (window.toast) window.toast('No se pudieron eliminar los cobros: ' + eM.message, 'error'); return; }
      }

      const { error } = await window.sb.from('facturas').delete().eq('id', f._id);
      if (error) { if (window.toast) window.toast('No se pudo eliminar: ' + error.message, 'error'); return; }

      /* TODOS los asientos de este documento: venta, cobro, anulacion y
         reversos llevan su numero como referencia, y el documento entero
         deja de existir. */
      const _modo = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.modo) || 'recibos';
      if (window.sb && _modo !== 'libro' && empId) {
        const { error: eA } = await window.sb.from('asientos').delete()
          .eq('empresa_id', empId).eq('referencia', num);
        if (eA) console.warn('[DigiAccount] No se pudieron eliminar los asientos de ' + num + ':', eA.message);
        if (window.cargarAsientos) window.cargarAsientos();
      }

      // Reponer el stock de los productos del recibo
      const ups = (anuladoYa ? [] : (f.items || [])).filter((it) => it.pid).map((it) => {
        const prod = (window.__getProductos ? window.__getProductos() : []).find((x) => x.id === it.pid);
        const nuevo = (Number(prod ? prod.stock : 0) || 0) + (Number(it.c) || 0);
        return window.sb.from('productos').update({ stock: nuevo }).eq('id', it.pid);
      });
      if (ups.length) Promise.all(ups).then(() => { if (window.cargarProductos) window.cargarProductos(); });
      close();
      if (window.toast) window.toast('Recibo ' + num + ' eliminado' + (anuladoYa ? '' : ' · stock repuesto'), 'success');
      if (window.cargarFacturas) window.cargarFacturas();
      if (window.cargarTesoreria) window.cargarTesoreria();
      if (window.cargarDashboard) window.cargarDashboard();
    });
    /* Emitir una nota de credito o de debito sobre la factura abierta.

       La factura original NO se toca: la nota es un documento NUEVO que
       apunta a ella. Que la factura este anulada se averigua buscando sus
       notas, no leyendo un campo que alguien tuvo que cambiar. */
    const notaBtnEl = document.getElementById('facturaNota');
    if (notaBtnEl) notaBtnEl.addEventListener('click', () => {
      if (!currentFac || !currentFac.f || !currentFac.f._id) return;
      emitirNota(currentFac);
    });

    // Los motivos son los que de verdad ocurren, no una lista generica.
    const MOTIVOS_NOTA = {
      NC: ['Devolución de mercancía', 'Descuento o ajuste al precio pactado',
        'Factura emitida por equivocación', 'Otro'],
      ND: ['Cargo adicional no facturado', 'Ajuste de precio al alza',
        'Intereses o gastos de cobranza', 'Otro'],
    };

    function emitirNota(fac) {
      const f = fac.f, num = fac.num;
      const t = calcFactura(f);
      const cobrado = window.__cobradoDe ? window.__cobradoDe(num) : 0;

      window.openFormModal && window.openFormModal({
        title: 'Emitir nota sobre la factura ' + num,
        saveLabel: 'Emitir la nota',
        fields: [
          { name: 'tipo', label: 'Tipo de documento', type: 'select', options: [
            { value: 'NC', label: 'Nota de CRÉDITO — disminuye lo facturado' },
            { value: 'ND', label: 'Nota de DÉBITO — aumenta lo facturado' } ] },
          { name: 'alcance', label: '¿Por cuánto?', type: 'select', options: [
            { value: 'total', label: 'Por el total de la factura (' + fmtF(t.total) + ')' },
            { value: 'parcial', label: 'Por una parte' } ] },
          { name: 'monto', label: 'Monto de la nota (Bs)', type: 'number', step: '0.01', value: t.total.toFixed(2) },
          { name: 'motivo', label: 'Motivo', type: 'select', options: MOTIVOS_NOTA.NC },
          { name: 'detalle', label: 'Explicación (queda impresa en la nota)', col: 2,
            placeholder: 'Ej. El cliente devolvió 2 sillas por defecto de fábrica' },
          { name: 'aviso', col: 2, type: 'static', label: '', html:
            '<div style="font-size:11.5px;color:var(--fg-muted);line-height:1.5;border-left:3px solid var(--da-cyan-600);padding-left:10px;">'
            + 'La factura <strong>' + esc(num) + '</strong> no se modifica: queda tal como se emitió. '
            + 'La nota es un documento aparte que la corrige, y así lo exige la Providencia 000121.'
            + (cobrado > 0.01 ? '<br><br>Esta factura tiene <strong>Bs ' + fmtF(cobrado) + '</strong> cobrados. '
              + 'Emitir la nota no devuelve ese dinero: el reintegro, si lo hay, se registra por Tesorería.' : '')
            + '</div>' },
        ],
        afterRender: (body) => {
          const tipoEl = body.querySelector('[data-name="tipo"]');
          const alcEl = body.querySelector('[data-name="alcance"]');
          const montoEl = body.querySelector('[data-name="monto"]');
          const motivoEl = body.querySelector('[data-name="motivo"]');
          const pintarMotivos = () => {
            const lista = MOTIVOS_NOTA[tipoEl.value] || MOTIVOS_NOTA.NC;
            motivoEl.innerHTML = lista.map((m) => '<option>' + esc(m) + '</option>').join('');
          };
          const pintarMonto = () => {
            const wrap = montoEl.closest('.fm-field');
            const parcial = alcEl.value === 'parcial';
            if (wrap) wrap.style.display = parcial ? '' : 'none';
            if (!parcial) montoEl.value = t.total.toFixed(2);
          };
          tipoEl.addEventListener('change', pintarMotivos);
          alcEl.addEventListener('change', pintarMonto);
          pintarMotivos(); pintarMonto();
        },
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID) return 'Sin conexión.';
          const tipo = v.tipo === 'ND' ? 'ND' : 'NC';
          const monto = v.alcance === 'parcial' ? (parseFloat(v.monto) || 0) : t.total;
          if (monto <= 0) return 'El monto de la nota tiene que ser mayor que cero.';
          if (tipo === 'NC' && monto > t.total + 0.01) {
            return 'Una nota de crédito no puede superar el total de la factura (Bs ' + fmtF(t.total) + ').';
          }
          const motivo = (v.motivo || '') + ((v.detalle || '').trim() ? ' — ' + v.detalle.trim() : '');
          if (!motivo.trim()) return 'Indica el motivo de la nota.';
          guardarNota({ fac: fac, tipo: tipo, monto: monto, motivo: motivo });
        },
      });
    }

    async function guardarNota(arg) {
      const fac = arg.fac, tipo = arg.tipo, monto = arg.monto, motivo = arg.motivo;
      const f = fac.f, num = fac.num;
      const empId = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) || null;

      // Correlativo propio de las notas, por empresa y por tipo.
      const previas = await window.sb.from('facturas')
        .select('numero').eq('empresa_id', empId).eq('tipo_doc', tipo);
      const usados = ((previas && previas.data) || [])
        .map((x) => parseInt(String(x.numero || '').replace(/[^0-9]/g, ''), 10))
        .filter((n) => !isNaN(n));
      const numeroNota = tipo + '-' + String((usados.length ? Math.max.apply(null, usados) : 0) + 1).padStart(8, '0');

      /* El N de CONTROL lo asigna la imprenta digital, no nosotros
         (000102 Art. 7 numeral 4). Mientras no haya imprenta contratada se
         deja vacio: inventarlo aqui seria justo lo que la providencia evita. */
      const hoy = new Date();
      const fecha = String(hoy.getDate()).padStart(2, '0') + '/' + String(hoy.getMonth() + 1).padStart(2, '0') + '/' + hoy.getFullYear();
      const tf = calcFactura(f);
      const proporcion = tf.total > 0 ? monto / tf.total : 0;
      const alic = Number(f.alic) || 0;

      const ins = await window.sb.from('facturas').insert({
        cuenta_id: window.__CUENTA_ID, empresa_id: empId,
        numero: numeroNota, control: '', tipo: 'venta', tipo_doc: tipo,
        factura_afectada: f._id, motivo: motivo,
        fecha: fecha, emitida_en: hoy.toISOString(),
        cliente_nombre: (f.parte && f.parte.n) || '', cliente_rif: (f.parte && f.parte.rif) || '',
        cliente_dom: (f.parte && f.parte.dom) || '',
        alicuota: alic, igtf: false, condicion: f.cond || 'Contado',
        items: [{ d: 'Nota de ' + (tipo === 'NC' ? 'crédito' : 'débito') + ' sobre la factura ' + num + ' · ' + motivo,
          c: 1, p: monto / (1 + alic) }],
        subtotal: tf.subtotal * proporcion, iva: tf.iva * proporcion, igtf_monto: 0, total: monto,
        estado: 'Emitida',
      });
      if (ins && ins.error) { if (window.toast) window.toast('No se pudo emitir la nota: ' + ins.error.message, 'error'); return; }

      /* Asiento del ajuste. La NC reversa proporcionalmente lo que la venta
         registro; la ND lo aumenta. Solo en modo recibos: en modo libro la
         contabilizacion la hace el Libro de Ventas. */
      const _modo = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.modo) || 'recibos';
      if (window.__postAsiento && _modo !== 'libro') {
        const sub = tf.subtotal * proporcion, iva = tf.iva * proporcion;
        const ln = [];
        if (tipo === 'NC') {
          ln.push({ cta: '4.1.1.01 · Venta de mercancía', debe: sub, haber: 0 });
          if (iva > 0.005) ln.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: iva, haber: 0 });
          ln.push({ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: 0, haber: monto });
        } else {
          ln.push({ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: monto, haber: 0 });
          ln.push({ cta: '4.1.1.01 · Venta de mercancía', debe: 0, haber: sub });
          if (iva > 0.005) ln.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: 0, haber: iva });
        }
        window.__postAsiento(numeroNota + ' sobre factura ' + num + ' · ' + motivo, numeroNota, ln, 'auto')
          .then((r) => { if (r && r.error) console.warn('[DigiAccount] Asiento de la nota:', r.error.message); });
      }

      close();
      if (window.toast) window.toast(numeroNota + ' emitida sobre la factura ' + num + ' · Bs ' + fmtF(monto), 'success');
      if (window.cargarFacturas) window.cargarFacturas();
      if (window.cargarTesoreria) window.cargarTesoreria();
      if (window.cargarDashboard) window.cargarDashboard();
    }

    const cb = document.getElementById('facturaClose');
    if (cb) cb.addEventListener('click', close);
    // Despachar: genera la Guía de Despacho a partir de la factura abierta
    const despBtn = document.getElementById('facturaDespachar');
    if (despBtn) despBtn.addEventListener('click', () => {
      if (currentFac && window.crearDespacho) { close(); window.crearDespacho(currentFac); }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.dataset.open === 'true') close(); });
    /* ══════════════════════════════════════════════════════════════════
       EL TICKET EN EL TELEFONO: un PDF que ya mide 72 mm

       En la PC, Chrome obedece el @page de 72 mm y la hoja sale del tamaño
       del rollo. En ANDROID no: el dialogo del sistema ignora el tamaño que
       pide la pagina y usa el de la impresora elegida («Guardar como PDF» =
       Carta). Ninguna regla de CSS lo cambia.

       Por eso en el telefono no se llama a window.print(): se dibuja el
       ticket y se arma un PDF de 72 mm de ancho y EXACTAMENTE el alto del
       ticket. Ese archivo se comparte —a la app de la impresora termica, a
       WhatsApp— o se descarga. La hoja es el ticket.

       Las librerias se cargan solo la primera vez que alguien lo usa.
       ══════════════════════════════════════════════════════════════════ */
    window.__esTelefono = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    function cargarScript(src) {
      return new Promise((ok, mal) => {
        if (document.querySelector('script[src="' + src + '"]')) return ok();
        const sc = document.createElement('script');
        sc.src = src; sc.onload = () => ok(); sc.onerror = () => mal(new Error('No se pudo cargar ' + src));
        document.head.appendChild(sc);
      });
    }
    /* ══════════════════════════════════════════════════════════════════
       EL TICKET, PINTADO DIRECTO EN UN CANVAS

       Antes se usaba html2canvas, que CLONA EL DOCUMENTO ENTERO —todas las
       vistas de la app— y vuelve a resolver todas las hojas de estilo para
       pintar un rectangulo de 72 mm. En un telefono eran segundos.

       El navegador ya sabe donde va cada letra. Se monta el ticket fuera de
       pantalla a ancho de rollo (272 px = 72 mm), se le pregunta la posicion
       de cada palabra, cada borde, cada fondo y el logo, y se pinta eso.
       ══════════════════════════════════════════════════════════════════ */
    const ESCALA_TICKET = 3;          // 816 px en 72 mm ≈ 288 ppp: nitido en papel y en pantalla
    async function dibujarTicket(ticketEl) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:272px;background:#fff;pointer-events:none;';
      const clon = ticketEl.cloneNode(true);
      clon.classList.remove('ticket-print');
      clon.style.cssText = 'width:272px;max-width:none;margin:0;padding:8px 10px;box-sizing:border-box;background:#fff;';
      host.appendChild(clon);
      document.body.appendChild(host);
      try {
        /* Fuentes y logo listos, pero con TOPE: una espera que no termina
           dejaria el boton colgado. Pasado el tope se pinta con lo que haya. */
        const conTope = (pr, ms) => Promise.race([Promise.resolve(pr).catch(() => {}), new Promise((ok) => setTimeout(ok, ms))]);
        if (document.fonts && document.fonts.ready) await conTope(document.fonts.ready, 1200);
        const imgs = Array.from(clon.querySelectorAll('img'));
        await conTope(Promise.all(imgs.map((im) => (im.complete && im.naturalWidth ? null : (im.decode ? im.decode() : null)))), 1200);

        const base = clon.getBoundingClientRect();
        const W = 272, H = Math.ceil(base.height);
        const cv = document.createElement('canvas');
        cv.width = W * ESCALA_TICKET; cv.height = H * ESCALA_TICKET;
        const ctx = cv.getContext('2d');
        ctx.scale(ESCALA_TICKET, ESCALA_TICKET);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        const X = (r) => r.left - base.left, Y = (r) => r.top - base.top;
        const visible = (c) => c.display !== 'none' && c.visibility !== 'hidden' && parseFloat(c.opacity) !== 0;
        const hayColor = (c) => c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c);

        // 1 · Fondos, bordes e imagenes, en orden de documento
        const els = [clon].concat(Array.from(clon.querySelectorAll('*')));
        for (const el of els) {
          const c = getComputedStyle(el);
          if (!visible(c)) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const x = X(r), y = Y(r);
          if (el !== clon && hayColor(c.backgroundColor)) {
            ctx.fillStyle = c.backgroundColor; ctx.fillRect(x, y, r.width, r.height);
          }
          [['Top', x, y, x + r.width, y], ['Bottom', x, y + r.height, x + r.width, y + r.height],
           ['Left', x, y, x, y + r.height], ['Right', x + r.width, y, x + r.width, y + r.height]].forEach(([lado, x1, y1, x2, y2]) => {
            const bw = parseFloat(c['border' + lado + 'Width']) || 0;
            const bs = c['border' + lado + 'Style'];
            if (!bw || bs === 'none' || bs === 'hidden' || !hayColor(c['border' + lado + 'Color'])) return;
            ctx.save();
            ctx.strokeStyle = c['border' + lado + 'Color']; ctx.lineWidth = bw;
            ctx.setLineDash(bs === 'dashed' ? [3, 2] : bs === 'dotted' ? [1, 2] : []);
            const off = bw / 2, hor = y1 === y2;
            ctx.beginPath();
            ctx.moveTo(x1 + (hor ? 0 : (lado === 'Left' ? off : -off)), y1 + (hor ? (lado === 'Top' ? off : -off) : 0));
            ctx.lineTo(x2 + (hor ? 0 : (lado === 'Left' ? off : -off)), y2 + (hor ? (lado === 'Top' ? off : -off) : 0));
            ctx.stroke();
            ctx.restore();
          });
          if (el.tagName === 'IMG' && el.naturalWidth) {
            // object-fit: contain — la imagen entera, centrada en su caja
            const k = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
            const iw = el.naturalWidth * k, ih = el.naturalHeight * k;
            try { ctx.drawImage(el, x + (r.width - iw) / 2, y + (r.height - ih) / 2, iw, ih); } catch (e) { /* imagen ajena: se omite */ }
          }
        }

        // 2 · El texto, palabra por palabra, donde el navegador lo puso
        const rango = document.createRange();
        const tw = document.createTreeWalker(clon, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          const txt = n.nodeValue;
          if (!txt || !txt.trim()) continue;
          const c = getComputedStyle(n.parentElement);
          if (!visible(c)) continue;
          ctx.font = c.fontStyle + ' ' + c.fontWeight + ' ' + c.fontSize + ' ' + c.fontFamily;
          ctx.fillStyle = c.color;
          ctx.textBaseline = 'alphabetic';
          if ('letterSpacing' in ctx) ctx.letterSpacing = c.letterSpacing === 'normal' ? '0px' : c.letterSpacing;
          const mayus = c.textTransform === 'uppercase';
          const m = ctx.measureText('Hg');
          const asc = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || parseFloat(c.fontSize) * 0.8;
          const desc = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || parseFloat(c.fontSize) * 0.2;
          const re = /\S+/g;
          let w;
          while ((w = re.exec(txt))) {
            rango.setStart(n, w.index); rango.setEnd(n, w.index + w[0].length);
            const rects = rango.getClientRects();
            if (!rects.length) continue;
            if (rects.length === 1) {
              const rr = rects[0];
              const yb = Y(rr) + (rr.height - (asc + desc)) / 2 + asc;
              ctx.fillText(mayus ? w[0].toUpperCase() : w[0], X(rr), yb);
            } else {
              // Palabra partida en dos lineas (break-word): letra por letra
              for (let i = 0; i < w[0].length; i++) {
                rango.setStart(n, w.index + i); rango.setEnd(n, w.index + i + 1);
                const rr = rango.getBoundingClientRect();
                if (!rr.width) continue;
                const ch = w[0][i];
                ctx.fillText(mayus ? ch.toUpperCase() : ch, X(rr), Y(rr) + (rr.height - (asc + desc)) / 2 + asc);
              }
            }
          }
        }
        return cv;
      } finally { host.remove(); }
    }

    /* Un PDF de una pagina con una imagen JPEG adentro, armado a mano.
       Son cinco objetos y la tabla de posiciones: no hace falta una libreria
       de 350 KB que ademas habia que bajar. La pagina mide lo que el ticket. */
    async function pdfDeJpeg(jpeg, pxW, pxH, mmW) {
      const img = new Uint8Array(await jpeg.arrayBuffer());
      const ptW = mmW * 72 / 25.4, ptH = ptW * pxH / pxW;
      const f = (n) => n.toFixed(2);
      const cont = 'q ' + f(ptW) + ' 0 0 ' + f(ptH) + ' 0 0 cm /Im0 Do Q';
      const enc = new TextEncoder();
      const partes = [], offs = [];
      let largo = 0;
      const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; partes.push(b); largo += b.length; };
      put(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));   // %PDF-1.4 + marca binaria
      const obj = (num, cuerpo) => { offs[num] = largo; put(num + ' 0 obj\n'); cuerpo(); put('\nendobj\n'); };
      obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
      obj(2, () => put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
      obj(3, () => put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(ptW) + ' ' + f(ptH) + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'));
      obj(4, () => {
        put('<< /Type /XObject /Subtype /Image /Width ' + pxW + ' /Height ' + pxH
          + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.length + ' >>\nstream\n');
        put(img); put('\nendstream');
      });
      obj(5, () => put('<< /Length ' + cont.length + ' >>\nstream\n' + cont + '\nendstream'));
      const xref = largo;
      let t = 'xref\n0 6\n0000000000 65535 f \n';
      for (let i = 1; i <= 5; i++) t += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
      put(t + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
      return new Blob(partes, { type: 'application/pdf' });
    }

    /* El ticket como ARCHIVO.
         pdf  · 72 mm de ancho y el alto exacto: para imprimir o archivar
         jpg  · una imagen: WhatsApp la muestra en el chat sin abrir nada */
    window.__ticketArchivo = async function (ticketEl, nombre, formato) {
      const canvas = await dibujarTicket(ticketEl);
      const base = String(nombre || 'ticket').replace(/[^\w\-]+/g, '_');
      const jpeg = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
      if (formato === 'jpg') return new File([jpeg], base + '.jpg', { type: 'image/jpeg' });
      const pdf = await pdfDeJpeg(jpeg, canvas.width, canvas.height, 72);
      return new File([pdf], base + '.pdf', { type: 'application/pdf' });
    };

    /* Abre el menu Compartir del telefono con el archivo (WhatsApp, correo,
       la app de la impresora...). Donde no hay menu Compartir, se descarga. */
    async function compartirOdescargar(file) {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: file.name }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; /* sin permiso: se descarga */ }
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (window.toast) window.toast('Descargado: ' + file.name, 'success');
    }

    window.__ticketPDF = async function (ticketEl, nombre) {
      if (window.toast) window.toast('Preparando el ticket…', 'info');
      try { await compartirOdescargar(await window.__ticketArchivo(ticketEl, nombre, 'pdf')); }
      catch (err) { if (window.toast) window.toast('No se pudo armar el ticket: ' + (err && err.message ? err.message : err), 'error'); }
    };

    /* ENVIAR EL RECIBO AL CLIENTE: se elige el formato y se comparte.
       Se pregunta ANTES de dibujar: el toque en la opcion es el que le da
       permiso al navegador para abrir el menu Compartir. */
    window.__compartirTicket = function (ticketEl, nombre) {
      const viejo = document.getElementById('tkShare');
      if (viejo) viejo.remove();
      const scrim = document.createElement('div');
      scrim.id = 'tkShare';
      scrim.className = 'tk-share-scrim';
      scrim.innerHTML = '<div class="tk-share-sheet" role="dialog" aria-label="Enviar el recibo">'
        + '<div class="tk-share-tt">Enviar el recibo</div>'
        + '<div class="tk-share-sub">Por WhatsApp, correo o la app que prefieras</div>'
        + '<button type="button" class="tk-share-op" data-fmt="jpg"><i data-lucide="image"></i><span><strong>Imagen (JPG)</strong><small>Se ve directo en el chat de WhatsApp</small></span></button>'
        + '<button type="button" class="tk-share-op" data-fmt="pdf"><i data-lucide="file-text"></i><span><strong>PDF</strong><small>Para imprimir o archivar · tamaño ticket</small></span></button>'
        + '<button type="button" class="tk-share-cancel">Cancelar</button>'
        + '</div>';
      document.body.appendChild(scrim);
      if (window.lucide) window.lucide.createIcons();
      const cerrar = () => scrim.remove();
      scrim.addEventListener('click', async (e) => {
        if (e.target === scrim || e.target.closest('.tk-share-cancel')) return cerrar();
        const op = e.target.closest('.tk-share-op');
        if (!op) return;
        scrim.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        op.querySelector('small').textContent = 'Preparando…';
        try { await compartirOdescargar(await window.__ticketArchivo(ticketEl, nombre, op.dataset.fmt)); }
        catch (err) { if (window.toast) window.toast('No se pudo preparar el recibo: ' + (err && err.message ? err.message : err), 'error'); }
        cerrar();
      });
    };

    const pr = document.getElementById('facturaPrint');
    if (pr) pr.addEventListener('click', () => {
      const isTicket = !!doc.querySelector('.fac-ticket');
      if (isTicket && window.__esTelefono()) {
        const ref = ((doc.querySelector('.fac-ticket') || {}).textContent || '').match(/REC-\d+/);
        window.__ticketPDF(doc.querySelector('.fac-ticket'), ref ? ref[0] : 'recibo-venta');
        return;
      }
      const isElec = !!doc.querySelector('.fac-e');
      const facEl = doc.querySelector('.fac-ticket, .fac') || doc;
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = facEl.cloneNode(true);
      clon.classList.add(isTicket ? 'ticket-print' : 'fac-print');
      if (isElec) clon.classList.add('fac-e-print');
      portal.appendChild(clon);
      // Tamaño de papel según el formato: ticket (rollo 72mm), electrónica (carta) o
      // forma libre (media carta). Chrome ignora un @page nuevo cuando ya existe otro
      // @page en conflicto, así que se cambia el size de TODAS las reglas @page vía CSSOM.
      let size = '5.5in 8.5in', margin = '9mm';
      /* Alto AUTOMATICO: un rollo no tiene hoja, tiene metros. Con 200 mm
         fijos un ticket de cuatro renglones sacaba veinte centimetros de
         papel en blanco, y uno largo se partia en dos. */
      if (isTicket) { size = '72mm auto'; margin = '3mm'; }
      else if (isElec) { size = '8.5in 11in'; margin = '12mm'; }
      setFacturaPageSize(size, margin);
      document.body.classList.add('printing-comp');
      window.print();
    });
    /* El tamaño de papel de la impresión.

       ANTES esto recorría las hojas de estilo y le asignaba `size` a cada
       regla @page vía CSSOM. No funcionaba: Chrome NO permite escribir
       `size` en `CSSPageRule.style` —la asignación se ignora sin dar
       error— y el ticket terminaba saliendo en el tamaño carta del @page
       general. Se imprimía un rollo de 72 mm en media resma.

       Ahora se inyecta una hoja al final del <head>: el último @page que
       declara `size` es el que manda, sin depender de una API que el
       navegador no implementa. Al terminar de imprimir se retira. */
    function setFacturaPageSize(sizeVal, marginVal) {
      const ID = 'facPageSize';
      let st = document.getElementById(ID);
      if (!sizeVal) { if (st) st.remove(); return; }
      if (!st) { st = document.createElement('style'); st.id = ID; document.head.appendChild(st); }
      st.textContent = '@media print{@page{size:' + sizeVal + ';margin:' + (marginVal || '0') + ';}}';
    }

    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
      setFacturaPageSize(false);
    });
    const dl = document.getElementById('facturaDownload');
    if (dl) dl.addEventListener('click', () => {
      const tk = doc.querySelector('.fac-ticket');
      if (tk) {
        const ref = (tk.textContent || '').match(/REC-\d+/);
        window.__compartirTicket(tk, ref ? ref[0] : 'recibo-venta');
        return;
      }
      const blob = new Blob([lastText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = lastName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // Agregar botón "Ver" a las filas de las tablas de Ventas y Compras del Módulo Fiscal
    // (se excluye el Libro legal, que muestra el N° de comprobante en su última columna)
    ['ventas', 'compras'].forEach((tab) => {
      const pane = document.querySelector('.fiscal-tab[data-tab="' + tab + '"]');
      const table = pane && pane.querySelector('table.data-table:not(.libro-table)');
      if (!table) return;
      const headRow = table.querySelector('thead tr');
      if (headRow) headRow.appendChild(document.createElement('th'));
      table.querySelectorAll('tbody tr').forEach((tr) => {
        // localizar el número de factura en la fila
        let num = null;
        tr.querySelectorAll('td.mono').forEach((td) => {
          const txt = td.textContent.trim();
          if (/^[AF]-\d+/.test(txt) && DB[txt]) num = txt;
        });
        const td = document.createElement('td');
        if (num) {
          td.innerHTML = '<button class="btn btn-ghost" style="height:26px;font-size:11px;padding:0 9px;"><i data-lucide="eye"></i> Ver</button>';
          td.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); openFactura(num); });
        }
        tr.appendChild(td);
      });
    });
    // Conectar los botones "Ver" del módulo de Ventas (data-ver-factura)
    document.querySelectorAll('[data-ver-factura]').forEach((b) => {
      b.addEventListener('click', () => openFactura(b.dataset.verFactura));
    });
    // ---- Emisión de factura de venta (formulario) ----
    (function nuevaFacturaForm() {
      const overlay = document.getElementById('facturaNuevaModal');
      if (!overlay) return;
      const linesEl = document.getElementById('fvLines');
      const selCli = document.getElementById('fvCliente');
      const rifEl = document.getElementById('fvRif');
      const idEl = document.getElementById('fvIdSis');
      const igtfChk = document.getElementById('fvIgtf');
      const msgEl = document.getElementById('fvMsg');
      const idSis = (rif) => String(rif || '').replace(/^[A-Za-z]/, '');
      let clientes = [];
      function fillCliente(c) { rifEl.value = c ? c.rif : ''; idEl.value = c ? (c.id || idSis(c.rif)) : ''; }

      function addLine() {
        const prods = (window.__getProductos ? window.__getProductos() : []);
        /* Se llevan los DOS precios: el de bolívares y el de dólares si el
           artículo está anclado en divisa. Así el renglón puede mostrar el
           precio en la moneda que se esté capturando sin volver a consultar. */
        const opts = '<option value="">Elegir producto…</option>' + prods.map((p) =>
          '<option value="' + p.id + '" data-precio="' + (Number(p.precio) || 0) + '"'
          + ' data-precio-usd="' + (Number(p.precio_usd) || 0) + '"'
          + ' data-moneda="' + String(p.moneda_precio || 'BS') + '"'
          + ' data-stock="' + (Number(p.stock) || 0) + '" data-nombre="' + String(p.nombre || '').replace(/"/g, '&quot;') + '">' + (p.nombre || '') + ' (stock ' + (Number(p.stock) || 0) + ')</option>').join('');
        const row = document.createElement('div');
        row.className = 'fv-line';
        /* Cantidad y precio van con su TITULO y la cantidad con − y +.
           En la PC los titulos y los botones se esconden (CSS): la fila sigue
           en una linea. En el telefono cada producto es una tarjeta. */
        row.innerHTML = '<select class="fv-desc">' + opts + '</select>'
          + '<div class="fv-cant-box"><span class="fv-ll">Cantidad</span>'
          + '<div class="fv-step"><button type="button" class="fv-menos" aria-label="Restar uno">−</button>'
          + '<input type="number" class="fv-cant" placeholder="0" step="any" inputmode="decimal">'
          + '<button type="button" class="fv-mas" aria-label="Sumar uno">+</button></div></div>'
          + '<div class="fv-precio-box"><span class="fv-ll fv-ll-precio">Precio</span>'
          + '<input type="number" class="fv-precio" placeholder="0.00" step="0.01" inputmode="decimal"></div>'
          + '<span class="fv-monto">Bs 0,00</span>'
          + '<button type="button" class="fv-del" title="Eliminar"><i data-lucide="trash-2"></i></button>';
        const cantEl = row.querySelector('.fv-cant');
        const pasoCant = (d) => {
          const v = parseFloat(cantEl.value) || 0;
          cantEl.value = Math.max(1, Math.round((v + d) * 1000) / 1000);
          recalc();
        };
        row.querySelector('.fv-menos').addEventListener('click', () => pasoCant(-1));
        row.querySelector('.fv-mas').addEventListener('click', () => pasoCant(1));
        const sel = row.querySelector('.fv-desc');
        sel.addEventListener('change', () => {
          const o = sel.options[sel.selectedIndex];
          row.dataset.pid = sel.value || '';
          row.dataset.pname = o ? (o.getAttribute('data-nombre') || '') : '';
          row.dataset.stock = o ? (o.getAttribute('data-stock') || '') : '';
          /* El precio se autocompleta EN LA MONEDA QUE SE ESTÁ CAPTURANDO.
              Si el artículo nació en dólares se parte de su precio en dólares
              y se convierte; si nació en bolívares, al revés. Convertir desde
              el bolívar guardado de un artículo anclado en divisa arrastraría
              la tasa del día en que se cargó, no la de hoy. */
          const tasa = Number(window.__bcvRate) || 0;
          const enUsd = (o ? o.getAttribute('data-moneda') : 'BS') === 'USD';
          const pBs = o ? (parseFloat(o.getAttribute('data-precio')) || 0) : 0;
          const pUsd = o ? (parseFloat(o.getAttribute('data-precio-usd')) || 0) : 0;
          const capturaUsd = monedaCaptura() === 'USD';
          let precio;
          if (capturaUsd) precio = enUsd ? pUsd : (tasa > 0 ? pBs / tasa : 0);
          else precio = enUsd ? (tasa > 0 ? pUsd * tasa : 0) : pBs;
          row.querySelector('.fv-precio').value = precio ? Math.round(precio * 100) / 100 : '';
          // Elegido el producto, lo normal es vender uno: se arranca en 1.
          if (sel.value && !(parseFloat(cantEl.value) > 0)) cantEl.value = 1;
          recalc();
        });
        row.querySelector('.fv-del').addEventListener('click', () => { row.remove(); recalc(); });
        row.querySelectorAll('input').forEach((i) => i.addEventListener('input', recalc));
        linesEl.appendChild(row);
        drawIcons();
        // En el telefono el renglon nuevo queda abajo: se baja hasta el.
        if (linesEl.children.length > 1 && window.matchMedia('(max-width: 560px)').matches) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      /* En qué moneda se están escribiendo los precios de ESTE recibo. */
      function monedaCaptura() {
        const s = document.getElementById('fvMoneda');
        return (s && s.value === 'USD') ? 'USD' : 'BS';
      }
      const fmtUsd = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      function recalc() {
        const rec = window.__esRecibo ? window.__esRecibo() : true;
        const alic = rec ? 0 : (parseFloat(document.getElementById('fvAlic').value) || 0);
        const usd = monedaCaptura() === 'USD';
        const tasa = Number(window.__bcvRate) || 0;
        const sig = usd ? '$' : 'Bs ';
        const fmtC = (n) => (usd ? '$' + fmtUsd(n) : 'Bs ' + fmt(n));
        /* El equivalente: si se captura en dólares se muestra en bolívares y
           al revés. Sin tasa cargada no se inventa una conversión. */
        const otra = (n) => {
          if (!(tasa > 0)) return '—';
          return usd ? ('Bs ' + fmt(n * tasa)) : ('$' + fmtUsd(n / tasa));
        };

        let base = 0;
        linesEl.querySelectorAll('.fv-line').forEach((r) => {
          const c = parseFloat(r.querySelector('.fv-cant').value) || 0;
          const p = parseFloat(r.querySelector('.fv-precio').value) || 0;
          const m = c * p;
          r.querySelector('.fv-monto').innerHTML = fmtC(m)
            + '<small class="fv-eq">' + otra(m) + '</small>';
          base += m;
        });
        const iva = base * alic, igtf = igtfChk.checked ? base * 0.03 : 0;
        const total = base + iva + igtf;
        document.getElementById('fvBase').textContent = fmtC(base);
        document.getElementById('fvIva').textContent = fmtC(iva);
        document.getElementById('fvIgtfRow').hidden = !igtfChk.checked;
        document.getElementById('fvIgtfVal').textContent = fmtC(igtf);
        document.getElementById('fvTotal').textContent = fmtC(total);

        const eqLbl = document.getElementById('fvEquivLbl');
        const eqVal = document.getElementById('fvEquiv');
        if (eqLbl && eqVal) {
          eqLbl.textContent = tasa > 0
            ? ('Equivalente · BCV ' + fmt(tasa) + ' por $')
            : 'Equivalente (sin tasa del BCV cargada)';
          eqVal.textContent = otra(total);
        }
        /* La cabecera de la columna dice en qué se está escribiendo, para que
           nadie teclee dólares creyendo que son bolívares. */
        const th = document.querySelector('.fv-lines-head span:nth-child(3)');
        if (th) th.textContent = 'P. unitario (' + (usd ? '$' : 'Bs') + ')';
        linesEl.querySelectorAll('.fv-ll-precio').forEach((l) => { l.textContent = 'Precio (' + (usd ? '$' : 'Bs') + ')'; });
      }
      function open() {
        clientes = (window.__clientes ? window.__clientes() : []);
        if (!clientes.length) clientes = [{ n: '(Aún no hay clientes con recibos)', rif: '—', dom: '' }];
        selCli.innerHTML = clientes.map((c, i) => '<option value="' + i + '">' + c.n + '</option>').join('');
        fillCliente(clientes[0]);
        linesEl.innerHTML = ''; addLine();
        igtfChk.checked = false; msgEl.textContent = '';
        recalc(); overlay.hidden = false; drawIcons();
      }
      function close() { overlay.hidden = true; }
      selCli.addEventListener('change', () => fillCliente(clientes[parseInt(selCli.value, 10)]));
      // Registrar cliente nuevo → lleva a la ficha de Terceros (premarcado como cliente)
      const nuevoCliBtn = document.getElementById('fvNuevoCliente');
      if (nuevoCliBtn) nuevoCliBtn.addEventListener('click', () => {
        close();
        if (window.showView) window.showView('terceros', 'Terceros · Clientes y Proveedores');
        if (window.openNuevoTercero) window.openNuevoTercero({ cliente: true });
      });
      document.getElementById('fvAlic').addEventListener('change', recalc);
      igtfChk.addEventListener('change', recalc);
      /* Al cambiar de moneda se CONVIERTE lo ya escrito, no se deja el mismo
         numero con otro signo: 100 bolivares no son 100 dolares, y dejarlo
         igual convertiria un recibo de cien en uno de ochenta mil sin que
         nadie lo note. */
      const selMoneda = document.getElementById('fvMoneda');
      if (selMoneda) {
        let monedaPrev = selMoneda.value;
        selMoneda.addEventListener('change', () => {
          const tasa = Number(window.__bcvRate) || 0;
          const aUsd = selMoneda.value === 'USD';
          if (tasa > 0 && monedaPrev !== selMoneda.value) {
            linesEl.querySelectorAll('.fv-line').forEach((row) => {
              const el = row.querySelector('.fv-precio');
              const v = parseFloat(el.value) || 0;
              if (!v) return;
              el.value = Math.round((aUsd ? v / tasa : v * tasa) * 100) / 100;
            });
          }
          monedaPrev = selMoneda.value;
          recalc();
        });
      }
      document.getElementById('fvAddLine').addEventListener('click', addLine);
      document.getElementById('fvClose').addEventListener('click', close);
      document.getElementById('fvCancel').addEventListener('click', close);
      // Clic fuera NO cierra (evita perder datos del formulario). Usa Cancelar o la X.

      document.getElementById('fvEmitir').addEventListener('click', async () => {
        const setMsg = (m) => { msgEl.textContent = m; msgEl.classList.add('error'); };
        msgEl.classList.remove('error'); msgEl.textContent = '';
        const cli = clientes[parseInt(selCli.value, 10)];
        if (!cli) return setMsg('Selecciona un cliente.');
        /* El recibo se GUARDA EN BOLIVARES, siempre: es la moneda de curso
           legal y la que va al libro. Si se capturo en dolares, aqui es donde
           se convierte, con la tasa del dia. */
        const _usdCap = monedaCaptura() === 'USD';
        const _tasaCap = Number(window.__bcvRate) || 0;
        if (_usdCap && !(_tasaCap > 0)) {
          return setMsg('No hay tasa del BCV cargada, así que no puedo convertir los dólares a bolívares. Carga la tasa o escribe los precios en bolívares.');
        }
        const items = [];
        let stockError = '';
        linesEl.querySelectorAll('.fv-line').forEach((r) => {
          const pid = r.dataset.pid || '';
          const d = (r.dataset.pname || '').trim();
          const c = parseFloat(r.querySelector('.fv-cant').value) || 0;
          const pCap = parseFloat(r.querySelector('.fv-precio').value) || 0;
          const p = _usdCap ? Math.round(pCap * _tasaCap * 100) / 100 : pCap;
          if (d && c > 0 && p > 0) {
            if (pid && r.dataset.stock !== '' && r.dataset.stock != null && c > parseFloat(r.dataset.stock)) {
              stockError = 'No hay stock suficiente de "' + d + '" (disponible: ' + parseFloat(r.dataset.stock) + ').';
            }
            items.push({ d: d, c: c, p: p, pid: pid });
          }
        });
        if (!items.length) return setMsg('Agrega al menos un renglón: elige un producto, una cantidad y un precio.');
        if (stockError) return setMsg(stockError);
        const esRec = window.__esRecibo ? window.__esRecibo() : true;
        // Correlativo REAL: se consulta a la BASE DE DATOS y es POR EMPRESA.
        // (Nunca más desde la memoria: evita heredar números de otra sesión/cuenta.)
        let numsBD = [];
        if (window.sb && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
          const { data: fs } = await window.sb.from('facturas').select('numero, control')
            .eq('tipo', 'venta').eq('empresa_id', window.__EMPRESA_ACTIVA.id);
          numsBD = fs || [];
        }
        let num, ctrl;
        if (esRec) {
          const recs = numsBD.map((f) => /^REC-/.test(f.numero || '') ? parseInt(f.numero.slice(4), 10) : NaN).filter((n) => !isNaN(n));
          num = 'REC-' + String((recs.length ? Math.max(...recs) : 0) + 1).padStart(6, '0');
          ctrl = '';
        } else {
          const nums = numsBD.map((f) => /^A-/.test(f.numero || '') ? parseInt(f.numero.slice(2), 10) : NaN).filter((n) => !isNaN(n));
          num = 'A-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(8, '0');
          const ctrls = numsBD.map((f) => parseInt((f.control || '').replace(/\D/g, ''), 10)).filter((n) => !isNaN(n));
          ctrl = '00-' + String((ctrls.length ? Math.max(...ctrls) : 0) + 1).padStart(6, '0');
        }
        const fechaRaw = document.getElementById('fvFecha').value;
        const fecha = fechaRaw ? fechaRaw.split('-').reverse().join('/') : (function () { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })();
        const alic = esRec ? 0 : (parseFloat(document.getElementById('fvAlic').value) || 0);
        DB[num] = { tipo: 'venta', control: ctrl, fecha: fecha, parte: { n: cli.n, rif: cli.rif, dom: cli.dom || '' }, alic: alic, igtf: igtfChk.checked, cond: document.getElementById('fvCond').value, items: items, _emitida: new Date().toISOString(),
          _usd: _usdCap ? Math.round((calcFactura({ items: items, alic: alic, igtf: igtfChk.checked }).total / _tasaCap) * 100) / 100 : null, _tasa: _tasaCap || null };
        const t = calcFactura(DB[num]);
        // Guardar la factura REAL en Supabase
        if (window.sb && window.__CUENTA_ID) {
          window.sb.from('facturas').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) || null, numero: num, control: ctrl, tipo: 'venta', fecha: fecha,
            cliente_nombre: cli.n, cliente_rif: cli.rif, cliente_dom: cli.dom || '',
            alicuota: alic, igtf: igtfChk.checked, condicion: document.getElementById('fvCond').value,
            items: items, subtotal: t.subtotal, iva: t.iva, igtf_monto: t.igtf, total: t.total, estado: 'Por cobrar',
            /* Si el recibo se escribio en dolares, ese es SU monto para
               siempre: el bolivar de hoy no vuelve a decidirlo. */
            moneda: _usdCap ? 'USD' : 'BS',
            tasa: _tasaCap || null,
            total_usd: _usdCap ? Math.round((t.total / _tasaCap) * 100) / 100 : null,
          }).then(({ error }) => {
            if (error) { console.warn('[DigiAccount] No se pudo guardar la factura:', error.message); if (window.toast) window.toast('No se pudo guardar en la base: ' + error.message, 'error'); return; }
            // Asiento contable de la venta: Debe CxC / Haber Ingresos (+ IVA débito / IGTF por pagar).
            // Solo en modo "recibos" (empresa). En modo "libro" (contador) la venta la contabiliza el Libro de Ventas.
            const _modo = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.modo) || 'recibos';
            if (window.__postAsiento && _modo !== 'libro') {
              const ln = [{ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: t.total, haber: 0 },
                { cta: '4.1.1.01 · Venta de mercancía', debe: 0, haber: t.subtotal }];
              if (t.iva > 0.005) ln.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: 0, haber: t.iva });
              if (t.igtf > 0.005) ln.push({ cta: '2.1.4.03 · IGTF por pagar', debe: 0, haber: t.igtf });
              window.__postAsiento('Venta s/' + (esRec ? 'recibo ' : 'factura ') + num + ' · ' + cli.n, num, ln, 'auto').then((r) => { if (r && r.error) console.warn('[DigiAccount] No se pudo contabilizar la venta:', r.error.message); });
            }
            if (window.cargarTesoreria) window.cargarTesoreria(); // refresca CxC con el nuevo recibo
            if (window.cargarFacturas) window.cargarFacturas();   // refresca la lista y los KPIs de Ventas
            if (window.cargarDashboard) window.cargarDashboard(); // refresca los KPIs del Dashboard
          });
          // Descontar el stock del inventario por cada producto vendido
          const ups = items.filter((it) => it.pid).map((it) => {
            const prod = (window.__getProductos ? window.__getProductos() : []).find((x) => x.id === it.pid);
            const nuevo = (Number(prod ? prod.stock : 0) || 0) - it.c;
            return window.sb.from('productos').update({ stock: nuevo }).eq('id', it.pid);
          });
          if (ups.length) Promise.all(ups).then(() => { if (window.cargarProductos) window.cargarProductos(); });
        }
        const tb = document.querySelector('.ventas-tab[data-tab="facturas"] table.data-table tbody');
        if (tb) {
          const fc = fecha.slice(0, 6) + fecha.slice(8); // dd/mm/yy
          const tr = document.createElement('tr');
          /* Ver va junto al numero: es lo que mas se toca en esta pantalla y
             al final de la fila obligaba a rodar la tabla entera. */
          tr.innerHTML = '<td>' + fc + '</td><td class="mono">' + num + '</td>'
            + '<td class="col-ver"><button class="btn btn-ghost" data-ver-factura="' + num + '" style="height:26px;font-size:11px;padding:0 9px;white-space:nowrap;"><i data-lucide="eye"></i> Ver</button></td>'
            + '<td class="primary">' + cli.n + '</td><td class="mono">' + cli.rif + '</td><td class="mono">' + ctrl + '</td>'
            + '<td class="num">' + fmt(t.total) + '</td><td><span class="tag cyan">Por cobrar</span></td>';
          tb.insertBefore(tr, tb.firstChild);
          tr.querySelector('[data-ver-factura]').addEventListener('click', () => openFactura(num));
          drawIcons();
        }
        if (window.toast) window.toast((esRec ? 'Recibo ' : 'Factura ') + num + (esRec ? ' emitido · Bs ' : ' emitida · Bs ') + fmt(t.total), 'success');
        close();
        openFactura(num);
        // Venta de CONTADO: abre el cobro prefilleado para registrar a qué cuenta/Caja entró el dinero
        if (/contado/i.test(DB[num].cond || '') && window.__registrarCobro) {
          setTimeout(() => window.__registrarCobro({ tipo: 'ingreso', tercero: cli.n, factura: num, monto: t.total }), 150);
        }
      });

      window.openNuevaFactura = open;
    })();

    window.openFactura = openFactura; // reutilizable
    window.__setPageSize = setFacturaPageSize; // reutilizable por el visor de despacho
    // Acceso a las facturas de venta para el módulo de Despachos
    window.__getFactura = function (num) {
      const f = DB[num]; if (!f) return null;
      const em = f.tipo === 'venta' ? EMPRESA : f.parte;
      const re = f.tipo === 'venta' ? f.parte : EMPRESA;
      return { num: num, f: f, emisor: em, receptor: re };
    };
    window.__listaFacturasVenta = Object.keys(DB).filter((k) => DB[k].tipo === 'venta').map((k) => ({ num: k, cliente: DB[k].parte.n }));

    // Carga las facturas de venta reales desde Supabase y las pinta en la tabla de Ventas
    async function cargarFacturas() {
      if (!window.sb) return;
      const { data, error } = await window.sb.from('facturas').select('*').eq('tipo', 'venta').order('creado_en', { ascending: false });
      if (error) { console.warn('[DigiAccount] No se pudieron cargar facturas:', error.message); return; }
      // Limpiar la memoria antes de rellenar: sin residuos de otra cuenta/sesión
      Object.keys(DB).forEach((k) => delete DB[k]);
      const tb = document.querySelector('.ventas-tab[data-tab="facturas"] table.data-table tbody');
      if (tb) tb.innerHTML = '';
      (data || []).forEach((f) => {
        DB[f.numero] = { tipo: 'venta', control: f.control, fecha: f.fecha, parte: { n: f.cliente_nombre, rif: f.cliente_rif, dom: f.cliente_dom || '' }, alic: Number(f.alicuota) || 0, igtf: !!f.igtf, cond: f.condicion, items: Array.isArray(f.items) ? f.items : [], _id: f.id, estado: f.estado || 'Por cobrar', _emitida: f.emitida_en || f.creado_en || null, _usd: f.total_usd, _tasa: f.tasa };
        if (tb) {
          const fc = (f.fecha || '').slice(0, 6) + (f.fecha || '').slice(8);
          const tr = document.createElement('tr');
          tr.innerHTML = '<td>' + fc + '</td><td class="mono">' + f.numero + '</td>'
            + '<td class="col-ver"><button class="btn btn-ghost" data-ver-factura="' + f.numero + '" style="height:26px;font-size:11px;padding:0 9px;white-space:nowrap;"><i data-lucide="eye"></i> Ver</button></td>'
            + '<td class="primary">' + (f.cliente_nombre || '') + '</td><td class="mono">' + (f.cliente_rif || '') + '</td><td class="mono">' + (f.control || '') + '</td>'
            + '<td class="num">' + fmt(Number(f.total) || 0) + '</td><td><span class="tag ' + (/anulada/i.test(f.estado || '') ? 'danger' : /cobrada|pagada/i.test(f.estado || '') ? 'success' : /abonada/i.test(f.estado || '') ? 'warn' : 'cyan') + '">' + (f.estado || 'Por cobrar') + '</span></td>';
          tb.appendChild(tr);
          tr.querySelector('[data-ver-factura]').addEventListener('click', () => openFactura(f.numero));
        }
      });
      // Los recibos ANULADOS no cuentan en los KPIs
      const arr = (data || []).filter((f) => !/anulada/i.test(f.estado || ''));
      const tot = arr.reduce((s, f) => s + (Number(f.total) || 0), 0);
      const setK = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setK('ventKpiFacturado', fmt(tot));
      setK('ventKpiCount', String(arr.length));
      setK('ventTabCount', String(arr.length));
      setK('ventKpiTicket', fmt(arr.length ? tot / arr.length : 0));
      setK('ventTotalToolbar', 'Bs ' + fmt(tot));
      // Cobrado y Por cobrar REALES: suma de los cobros (movimientos) vinculados a cada recibo
      try {
        let cobrado = 0;
        const refs = arr.map((f) => f.numero).filter(Boolean);
        if (refs.length) {
          const { data: movs } = await window.sb.from('movimientos_tesoreria')
            .select('monto, factura_ref').eq('tipo', 'ingreso').in('factura_ref', refs);
          const porRef = {};
          (movs || []).forEach((m) => { porRef[m.factura_ref] = (porRef[m.factura_ref] || 0) + (Number(m.monto) || 0); });
          arr.forEach((f) => { cobrado += Math.min(porRef[f.numero] || 0, Number(f.total) || 0); });
        }
        setK('ventKpiCobrado', fmt(cobrado));
        setK('ventKpiCobrar', fmt(Math.max(0, tot - cobrado)));
      } catch (e) { console.warn('[Ventas] KPIs de cobro:', e); }
      console.log('[DigiAccount] Facturas cargadas:', arr.length);
      drawIcons();
    }
    window.cargarFacturas = cargarFacturas;

    // Aplica el modo de documento. En 'recibo' (por defecto) cambia los textos visibles
    // a "Recibo" y oculta lo fiscal. En 'factura' (al homologar) deja los textos originales.
    function aplicarModoDoc() {
      const esRec = window.__esRecibo ? window.__esRecibo() : true;
      // Letrero del modo REAL: recibos (sin homologar) o facturación homologada
      const modoBadge = document.getElementById('ventasModoBadge');
      if (modoBadge) modoBadge.innerHTML = esRec
        ? '<i data-lucide="receipt"></i> Recibos de venta'
        : '<i data-lucide="shield-check"></i> Facturación homologada';
      // RIF de la empresa activa (nada de RIF quemado)
      const ventasRif = document.getElementById('ventasRif');
      if (ventasRif) ventasRif.textContent = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.rif) || '—';
      if (!esRec) return; // modo factura = textos fiscales originales
      const nb = document.getElementById('nuevaFacturaBtn'); if (nb) nb.innerHTML = '<i data-lucide="plus"></i> Nuevo recibo';
      const mb = document.getElementById('medioEmisionBtn'); if (mb) mb.style.display = 'none';
      document.querySelectorAll('#view-ventas .overline').forEach((ov) => { if (/Facturaci/i.test(ov.textContent)) ov.textContent = 'Recibos de venta'; });
      const ft = document.querySelector('.fv-title'); if (ft) ft.textContent = 'Emitir recibo de venta';
      const fs = document.querySelector('.fv-subtitle'); if (fs) fs.textContent = 'Genera el N° de recibo automáticamente';
      const fe = document.getElementById('fvEmitir'); if (fe) fe.innerHTML = '<i data-lucide="check"></i> Emitir recibo';
      const tabla = document.querySelector('.ventas-tab[data-tab="facturas"] table.data-table');
      if (tabla) tabla.querySelectorAll('thead th').forEach((th) => { const t = th.textContent.trim(); if (t === 'N° Factura') th.textContent = 'N° Recibo'; else if (t === 'N° Control') th.textContent = ''; });
      // Un recibo no desglosa impuestos: ocultar Alícuota IVA, IGTF y las filas de Base/IVA
      const al = document.getElementById('fvAlic'); if (al && al.closest('.fv-f')) al.closest('.fv-f').style.display = 'none';
      const baseEl = document.getElementById('fvBase'); if (baseEl && baseEl.closest('.fv-tot-row')) baseEl.closest('.fv-tot-row').style.display = 'none';
      const ivaEl = document.getElementById('fvIva'); if (ivaEl && ivaEl.closest('.fv-tot-row')) ivaEl.closest('.fv-tot-row').style.display = 'none';
      if (window.lucide) window.lucide.createIcons();
    }
    aplicarModoDoc();
    window.__aplicarModoDoc = aplicarModoDoc;
    cargarFacturas();
    drawIcons();
  })();
})();
