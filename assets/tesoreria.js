/* =========================================================
   DigiAccount ERP — TESORERIA
   Cuentas de banco y caja, movimientos, cobros y pagos, la conciliacion
   contra el estado de cuenta, y las cuentas por cobrar y por pagar.

   Salio sin arrastrar nada: es el unico modulo grande que no usaba
   ningun nombre privado del bloque grande. Todo lo que necesita de los
   demas ya se lo pedia a `window.__*`.

   Se carga DESPUES de app.js: lo que expone —el cobrado de una
   factura, el recibo de cobro, la recarga de la vista— lo consumen
   ventas, compras y el panel
   a traves de `window.*`, y lo que necesita de ellos tambien.
   ========================================================= */
(function () {
  'use strict';

  /* =========================================================
     TESORERÍA — cuentas bancarias/caja y movimientos (por empresa, Supabase)
     ========================================================= */
  (function tesoreriaModule() {
    const view = document.getElementById('view-tesoreria');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const fmt = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fechaKey = (f) => { const p = (f || '').split('/'); if (p.length < 3) return 0; const yy = p[2].length === 2 ? '20' + p[2] : p[2]; return parseInt(yy + (p[1] || '').padStart(2, '0') + (p[0] || '').padStart(2, '0'), 10) || 0; };
    const PALETA = ['#003057', '#00aeef', '#1c8f5a', '#c0392b', '#c97a14', '#6f4cb8', '#0f766e', '#545e67'];
    let _cuentas = [], _movs = [], _facturas = [];
    const _cxPage = { venta: 1, compra: 1 }; // página actual de CxC/CxP (20 por página, como el Libro Fiscal)

    function saldoDe(cid) {
      const c = _cuentas.find((x) => x.id === cid);
      let s = c ? Number(c.saldo_inicial) || 0 : 0;
      _movs.filter((m) => m.cuenta_teso_id === cid).forEach((m) => { s += (m.tipo === 'ingreso' ? 1 : -1) * (Number(m.monto) || 0); });
      return s;
    }

    async function cargarTesoreria() {
      const emp = window.__EMPRESA_ACTIVA;
      _cxPage.venta = 1; _cxPage.compra = 1; // vuelve a la página 1 al (re)cargar la vista
      const rifEl = document.getElementById('tesoRif'); if (rifEl) rifEl.textContent = (emp && emp.rif) || '—';
      if (!window.sb || !emp || !emp.id) { _cuentas = []; _movs = []; _facturas = []; render(); return; }
      /* EN UN NEGOCIO, LA COMPRA *ES* UNA CUENTA POR PAGAR.

         En una firma contable no: ahí el Libro de Compras es de cada cliente
         y solo sirve para declararle sus impuestos, no es plata que la firma
         deba. Por eso las compras no se cargaban aquí.

         Pero una empresa que lleva su propio control —un emprendimiento, sin
         módulo fiscal— registra la compra porque la tiene que PAGAR. Se
         cargaba, y no aparecía por ningún lado: ni en Compras ni en
         Tesorería, solo como saldo en la ficha del proveedor.

         La regla es la misma que ya usa el Panel: en modo libro no hay CxP;
         en modo recibos, sí. */
      const _modoLibro = !!(emp.fiscalActivo || emp.modo === 'libro');
      const [r1, r2, r3, r4] = await Promise.all([
        window.sb.from('cuentas_tesoreria').select('*').eq('empresa_id', emp.id).order('creado_en'),
        // Movimientos pueden superar 1000 filas → paginado (evita el tope de PostgREST)
        window.__sbAll((q) => q.eq('empresa_id', emp.id), 'movimientos_tesoreria', '*'),
        // Ventas = RECIBOS emitidos (control de cobros), por empresa. NO el libro de ventas (ese es solo para declarar).
        window.__sbAll((q) => q.eq('tipo', 'venta').eq('empresa_id', emp.id), 'facturas', 'numero, cliente_nombre, cliente_rif, total, total_usd, tasa, moneda, fecha, estado, condicion, emitida_en, creado_en'),
        _modoLibro ? Promise.resolve({ data: [] })
          : window.__sbAll((q) => q.eq('tipo', 'compra').eq('empresa_id', emp.id), 'libro_fiscal', 'id, numero_factura, tercero_nombre, tercero_rif, total, total_usd, tasa, moneda, fecha, tipo_doc, creado_en'),
        /* El historial de tasas se espera AQUI, con el resto.

           Antes se pedia por su cuenta y la tabla se pintaba sin el: sin tasa
           cada fila cae al bolivar —correcto, no se inventa una conversion—
           pero nadie volvia a pintarla. El dolar no aparecia nunca. */
        window.__cargarTasasUSD ? window.__cargarTasasUSD() : null,
      ]);
      if (r1.error) { console.warn('[DigiAccount] Tesorería:', r1.error.message); }
      _cuentas = r1.data || []; _movs = r2.data || [];
      const ventas = (r3.data || []).filter((f) => !/anulada/i.test(f.estado || '')).map((f) => ({ ref: f.numero, tercero_nombre: f.cliente_nombre, tercero_rif: f.cliente_rif, total: f.total, fecha: f.fecha, tipo: 'venta', condicion: f.condicion, estado: f.estado, emitida: f.emitida_en || f.creado_en || null,
        total_usd: f.total_usd, tasa: f.tasa, moneda: f.moneda }));
      /* Las compras del negocio: lo que le debe a cada proveedor. Su pago se
         registra igual que un cobro, vinculado por el número del documento. */
      const compras = (r4.data || []).map((f) => ({
        ref: f.numero_factura || '', tercero_nombre: f.tercero_nombre, tercero_rif: f.tercero_rif,
        total: f.total, fecha: f.fecha, tipo: 'compra', tipo_doc: f.tipo_doc || 'FC',
        total_usd: f.total_usd, tasa: f.tasa, moneda: f.moneda,
        _id: f.id, emitida: f.creado_en || null,
      }));
      _facturas = ventas.concat(compras);
      render();
      if (window.__cargarSaldosTerceros) window.__cargarSaldosTerceros();   // la columna Saldo de Terceros
    }
    window.cargarTesoreria = cargarTesoreria;
    // Cuánto se ha cobrado de un recibo (suma de ingresos vinculados por factura_ref). Lo usa el botón "Cobrar".
    window.__cobradoDe = (ref) => _movs.filter((m) => m.tipo === 'ingreso' && (m.factura_ref || '').trim() === String(ref || '').trim()).reduce((s, m) => s + (Number(m.monto) || 0), 0);

    function render() {
      const cont = document.getElementById('tesoBankCards');
      if (cont) {
        cont.innerHTML = _cuentas.length ? _cuentas.map((c, i) => {
          const saldo = saldoDe(c.id);
          const esCaja = /efectivo|caja/i.test((c.tipo || '') + ' ' + (c.nombre || ''));
          const ini = ((c.banco || c.nombre || '?').replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || 'CT').toUpperCase();
          const logo = esCaja
            ? '<div class="bank-logo" style="background:#1c8f5a;"><i data-lucide="wallet" style="width:16px;height:16px;color:#fff;"></i></div>'
            : '<div class="bank-logo" style="background:' + esc(c.color || PALETA[i % PALETA.length]) + ';">' + esc(ini) + '</div>';
          const nmov = _movs.filter((m) => m.cuenta_teso_id === c.id).length;
          return '<div class="bank-card"><div class="bank-card-head">' + logo
            + '<button class="status-pill paused" data-teso-delcuenta="' + esc(c.id) + '" title="Eliminar cuenta" style="font-size:9px;cursor:pointer;border:0;"><i data-lucide="trash-2" style="width:11px;height:11px;"></i></button></div>'
            + '<div><div class="acct-type">' + esc(c.nombre) + '</div><div class="acct-num">' + esc(esCaja ? (c.numero || 'Efectivo en caja') : (c.numero || c.tipo || '')) + '</div></div>'
            + '<div class="acct-bal"><span class="cur">' + esc(c.moneda || 'Bs') + '</span> ' + fmt(saldo) + '</div>'
            + '<div class="acct-foot"><span>' + esc(esCaja ? 'Caja · Efectivo' : (c.tipo || '')) + '</span><span class="usd">' + nmov + ' mov.</span></div></div>';
        }).join('') : '<div style="padding:18px;color:var(--fg-muted);font-size:13px;">Aún no hay cuentas. Usa "Agregar cuenta".</div>';
      }
      const dispBs = _cuentas.filter((c) => (c.moneda || 'Bs') !== 'USD').reduce((s, c) => s + saldoDe(c.id), 0);
      const dEl = document.getElementById('tesoDisponible'); if (dEl) dEl.textContent = fmt(dispBs);
      const neto = _movs.reduce((s, m) => s + (m.tipo === 'ingreso' ? 1 : -1) * (Number(m.monto) || 0), 0);
      const pEl = document.getElementById('tesoPosicion'); if (pEl) pEl.textContent = fmt(neto);
      const cc = document.getElementById('tesoCuentasCount'); if (cc) cc.textContent = String(_cuentas.length);
      const tb = document.getElementById('tesoMovBody');
      if (tb) {
        const cmap = {}; _cuentas.forEach((c) => { cmap[c.id] = c; });
        const asc = _movs.slice().sort((a, b) => (fechaKey(a.fecha) - fechaKey(b.fecha)) || ((a.creado_en || '') < (b.creado_en || '') ? -1 : 1));
        const run = {};
        asc.forEach((m) => { if (run[m.cuenta_teso_id] == null) run[m.cuenta_teso_id] = cmap[m.cuenta_teso_id] ? Number(cmap[m.cuenta_teso_id].saldo_inicial) || 0 : 0; run[m.cuenta_teso_id] += (m.tipo === 'ingreso' ? 1 : -1) * (Number(m.monto) || 0); m.__saldo = run[m.cuenta_teso_id]; });
        const desc = asc.slice().reverse();
        tb.innerHTML = desc.length ? desc.map((m) => {
          const c = cmap[m.cuenta_teso_id]; const ing = m.tipo === 'ingreso';
          const clip = m.comprobante_path ? '<button class="btn btn-ghost" data-teso-vercomp="' + esc(m.comprobante_path) + '" title="Ver comprobante" style="height:22px;font-size:10px;padding:0 6px;color:var(--da-cyan-700);"><i data-lucide="paperclip" style="width:11px;height:11px;"></i></button> ' : '';
          return '<tr><td>' + esc(m.fecha || '') + '</td><td class="primary">' + esc(m.concepto || '') + (m.comprobante_path ? ' <i data-lucide="paperclip" style="width:11px;height:11px;color:var(--da-cyan-700);vertical-align:middle;"></i>' : '') + '</td><td>' + esc(c ? c.nombre : '—') + '</td>'
            + '<td class="mono">' + esc(m.referencia || '') + '</td><td class="num" style="color:var(--da-' + (ing ? 'success' : 'danger') + ');">' + (ing ? '+ ' : '− ') + fmt(m.monto) + '</td>'
            /* Solo los COBROS vinculados a un recibo llevan comprobante: un
               egreso o un movimiento suelto no tienen saldo que informar. */
            + '<td class="num">' + fmt(m.__saldo) + ' ' + clip
            + ((ing && (m.factura_ref || '').trim())
              ? '<button class="btn btn-ghost" data-teso-recibo="' + esc(m.id) + '" title="Recibo de cobro" style="height:22px;font-size:10px;padding:0 6px;color:var(--da-cyan-700);"><i data-lucide="receipt" style="width:11px;height:11px;"></i></button> '
                + '<button class="btn btn-ghost" data-teso-compartir="' + esc(m.id) + '" title="Compartir el recibo de cobro" style="height:22px;font-size:10px;padding:0 6px;color:var(--da-cyan-700);"><i data-lucide="share-2" style="width:11px;height:11px;"></i></button> '
              : '')
            + '<button class="btn btn-ghost" data-teso-delmov="' + esc(m.id) + '" title="Eliminar" style="height:22px;font-size:10px;padding:0 6px;color:#c0392b;"><i data-lucide="x" style="width:11px;height:11px;"></i></button></td></tr>';
        }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--fg-muted);padding:16px;">Sin movimientos. Usa "Registrar movimiento".</td></tr>';
      }
      const cf = view.querySelector('.teso-tab[data-tab="resumen"] .table-footer .count');
      if (cf) cf.innerHTML = 'Mostrando <strong>' + _movs.length + '</strong> movimiento' + (_movs.length === 1 ? '' : 's');
      renderCxCxP();
      if (window.lucide) window.lucide.createIcons();
    }

    /* ══════════════════════════════════════════════════════════════════
       RECIBO DE COBRO · lo que abonó y lo que sigue debiendo

       El vendedor a plazos necesita dejarle constancia a su cliente de cada
       abono. Hasta aquí el sistema sabía todo eso —lo muestra en Cuentas por
       Cobrar— pero no había papel que entregar.

       Los números NO se recalculan por otro camino: el acumulado sale de
       `pagadoDe`, el mismo que alimenta la pantalla. Dos cálculos paralelos
       del mismo saldo terminan discrepando el día que uno se toca.
       ══════════════════════════════════════════════════════════════════ */
    window.__reciboDeCobro = function (movId, accion, yaEspero) {
      if (!yaEspero && !window.__TASAS_USD && window.__cargarTasasUSD) {
        window.__cargarTasasUSD().then(() => window.__reciboDeCobro(movId, accion, true));
        return;
      }
      const mov = _movs.find((m) => String(m.id) === String(movId));
      if (!mov) { if (window.toast) window.toast('No encuentro ese movimiento.', 'error'); return; }
      const ref = (mov.factura_ref || '').trim();
      const fac = _facturas.find((f) => (f.ref || '').trim() === ref && f.tipo === 'venta');

      const emp = window.__EMPRESA_ACTIVA || {};
      const tasaEn = (x) => (window.__tasaUSDEn && window.__tasaUSDEn(x)) || 0;
      /* La tasa del ABONO: con ella se muestra el dolar de lo que se pago hoy. */
      const tasa = tasaEn(mov.creado_en);
      const abono = Number(mov.monto) || 0;
      const total = fac ? (Number(fac.total) || 0) : 0;
      const acum = fac ? pagadoDe(fac) : abono;
      /* EL SALDO SE RESTA EN DOLARES, no se convierte.
           total $   = total Bs  / tasa del momento de la venta
           abonado $ = cada abono Bs / tasa del momento de ESE abono
           saldo $   = total $ - abonado $
         Convertir el saldo en bolivares con la tasa de hoy cobraria de mas o
         de menos segun cuanto subio el dolar. Si falta alguna tasa, sale en
         bolivares: no se inventa una conversion. */
      const movsFac = fac ? _movs.filter((m) => m.tipo === 'ingreso' && (m.factura_ref || '').trim() === ref) : [];
      const tVenta = fac ? tasaEn(fac.emitida) : 0;
      const enUsd = !!fac && tasa > 0 && tVenta > 0 && movsFac.every((m) => tasaEn(m.creado_en) > 0);
      const totalUsd = enUsd ? ((window.__usdDoc && window.__usdDoc(fac)) || (total / tVenta)) : 0;
      const acumUsd = enUsd ? movsFac.reduce((a, m) => a + (Number(m.monto) || 0) / tasaEn(m.creado_en), 0) : 0;
      const saldo = enUsd
        ? Math.max(0, Math.round((totalUsd - acumUsd) * 100) / 100)
        : Math.max(0, total - acum);

      const usd = (n) => (tasa > 0
        ? '$' + Number(n / tasa).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '');
      /* DOS formas de mostrar un monto, y la diferencia no es de estilo:

         `linea` es para lo que YA OCURRIO —la venta, el abono de hoy—: paso a
         una tasa concreta, su bolivar es un hecho y se imprime.

         `lineaUsd` es para lo que TODAVIA SE DEBE. Ese monto no tiene tasa
         aun, porque se pagara a la del dia en que paguen. Imprimir un saldo
         en bolivares seria entregarle al cliente una cifra que caduca esa
         misma noche, y de la que se va a agarrar cuando vuelva. */
      const linea = (rot, bs, fuerte) => '<div class="tk-row' + (fuerte ? ' tk-total' : '') + '"><span>' + rot + '</span>'
        + '<span>' + fmt(bs) + '</span></div>'
        + (tasa > 0 ? '<div class="tk-item-usd">' + usd(bs) + '</div>' : '');
      const lineaUsd = (rot, n, fuerte) => '<div class="tk-row' + (fuerte ? ' tk-total' : '') + '"><span>' + rot + (enUsd ? '' : ' Bs') + '</span>'
        + '<span>' + (enUsd ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmt(n)) + '</span></div>';

      const logo = (window.__logoEmpresa && window.__logoEmpresa()) || '';
      const html = '<div class="fac-ticket">'
        + '<div class="tk-head">'
        + (logo ? '<img class="tk-logo-img" src="' + logo + '" alt="">' : '')
        + '<div class="tk-co">' + esc(String(emp.n || emp.nombre || 'Empresa').toUpperCase()) + '</div>'
        + '<div class="tk-line">RIF: ' + esc(emp.rif || '—') + '</div>'
        + '</div>'
        + '<div class="tk-sep doble"></div>'
        /* En negativo y a todo el ancho: es lo primero que ve quien recibe el
           papel, y lo que impide confundirlo con el recibo de la venta. */
        + '<div class="tk-doc tk-cobro">RECIBO DE COBRO</div>'
        + '<div class="tk-row"><span>FECHA</span><span>' + esc(mov.fecha || '') + '</span></div>'
        + '<div class="tk-line">CLIENTE: ' + esc(mov.tercero_nombre || '—') + '</div>'
        + (mov.tercero_rif ? '<div class="tk-line">RIF/CI: ' + esc(mov.tercero_rif) + '</div>' : '')
        + '<div class="tk-line">POR EL RECIBO: ' + esc(ref || '—') + '</div>'
        + (mov.referencia ? '<div class="tk-line">REF. PAGO: ' + esc(mov.referencia) + '</div>' : '')
        + '<div class="tk-sep dashed"></div>'
        + linea('ABONA HOY Bs', abono, true)
        + '<div class="tk-sep dashed"></div>'
        /* El saldo va ENMARCADO: es el número por el que el cliente va a
           volver, y tiene que encontrarse sin leer el resto. */
        + (fac ? (lineaUsd('TOTAL DEL RECIBO', enUsd ? totalUsd : total)
          + lineaUsd('ABONADO EN TOTAL', enUsd ? acumUsd : acum)
          + '<div class="tk-saldo">' + lineaUsd('SALDO', saldo, true) + '</div>')
          : '<div class="tk-line tk-center">Cobro sin recibo de venta asociado</div>')
        + (tasa > 0 ? '<div class="tk-line tk-center tk-tasa">Abono recibido a Bs ' + fmt(tasa) + ' por $</div>' : '')
        /* Se dice explicitamente, porque es la fuente de discusion numero uno
           entre quien vende a plazos y quien paga. */
        + (fac && saldo > 0.01
          ? '<div class="tk-line tk-center tk-nota-tasa">El saldo se paga a la tasa del día en que se cancele.</div>'
          : '')
        + '<div class="tk-sep doble"></div>'
        + '<div class="tk-sep dashed"></div>'
        + (fac && saldo <= 0.01
          ? '<div class="tk-cancelado">CANCELADO EN SU TOTALIDAD</div>'
          : '<div class="tk-line tk-center">Este documento deja constancia del abono recibido.</div>')
        /* Solo cuando queda saldo: a quien ya pagó todo no hay que decirle
           por dónde seguir pagando. */
        + ((fac && saldo > 0.01 && window.__pagoMovilTicket) ? (window.__pagoMovilTicket() || '') : '')
        + '<div class="tk-line tk-center">Documento no fiscal · no constituye una factura</div>'
        + '<div class="tk-line tk-center">Generado por DigiAccount</div>'
        + '</div>';

      /* COMPARTIR: la misma hoja del recibo de venta — imagen JPG o PDF de
         72 mm — y el menu Compartir del telefono. */
      if (accion === 'compartir' && window.__compartirTicket) {
        const tmpS = document.createElement('div');
        tmpS.innerHTML = html;
        window.__compartirTicket(tmpS.firstChild, 'cobro-' + (ref || mov.fecha || ''));
        return;
      }

      /* En el telefono, el mismo PDF de 72 mm que el recibo de venta. */
      if (window.__esTelefono && window.__esTelefono() && window.__ticketPDF) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        window.__ticketPDF(tmp.firstChild, 'cobro-' + (ref || mov.fecha || ''));
        return;
      }

      /* Se imprime por el mismo portal que el resto de documentos, con el
         rollo de 72 mm: es el mismo papel del recibo de venta. */
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = html;
      const t = portal.querySelector('.fac-ticket');
      if (t) t.classList.add('ticket-print');
      let st = document.getElementById('facPageSize');
      if (!st) { st = document.createElement('style'); st.id = 'facPageSize'; document.head.appendChild(st); }
      st.textContent = '@media print{@page{size:72mm auto;margin:3mm;}}';
      document.body.classList.add('printing-comp');
      window.print();
    };

    // Cuánto se ha cobrado/pagado de una factura: suma de movimientos vinculados por factura_ref
    function pagadoDe(fac) {
      const ref = (fac.ref || '').trim(); if (!ref) return 0;
      const wantTipo = fac.tipo === 'venta' ? 'ingreso' : 'egreso';
      return _movs.filter((m) => m.tipo === wantTipo && (m.factura_ref || '').trim() === ref).reduce((s, m) => s + (Number(m.monto) || 0), 0);
    }
    function badge(txt, color, bg) { return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;color:' + color + ';background:' + bg + ';">' + txt + '</span>'; }
    /* LA DEUDA SE PIENSA EN DOLARES.

       Quien compra y vende en divisas no debe «54.972,18 Bs»: debe 74,50 $.
       El bolivar de esa deuda cambia cada dia; el dolar pactado, no.

       El dolar del documento lo da `window.__usdDoc` —el mismo para toda la
       app—: primero lo GUARDADO, y solo si no lo tiene se reconstruye con la
       tasa de su fecha. Cada pago se lleva a dolares con la tasa del dia en
       que se pago, asi que el pendiente es una resta en dolares. */
    const _tasaEn = (x) => ((window.__tasaUSDEn && window.__tasaUSDEn(x)) || 0);

    /* dd/mm/aa(aa) → un numero comparable (aaaammdd). Si no hay fecha, se
       usa el momento en que se cargo, que al menos respeta el orden real. */
    function _claveFecha(f) {
      const p = String((f && f.fecha) || '').split('/');
      if (p.length === 3) {
        const aa = p[2].length === 2 ? '20' + p[2] : p[2];
        return parseInt(aa + p[1].padStart(2, '0') + p[0].padStart(2, '0'), 10) || 0;
      }
      const d = new Date((f && (f.emitida || f.creado_en)) || 0);
      return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 86400000);
    }

    function _movsDe(f) {
      const ref = (f.ref || '').trim(); if (!ref) return [];
      const quiere = f.tipo === 'venta' ? 'ingreso' : 'egreso';
      return _movs.filter((m) => m.tipo === quiere && (m.factura_ref || '').trim() === ref);
    }

    function renderCxList(tipo, bodyId, totalId, countId, tabCountId) {
      const body = document.getElementById(bodyId); if (!body) return;
      const rows = _facturas.filter((f) => f.tipo === tipo).map((f) => {
        const total = Number(f.total) || 0; const pagReal = pagadoDe(f);
        // Presunción de pago (modo libro): si no hay pagos reales registrados, se toma como pagada.
        const pag = (f.presuntoPagado && pagReal <= 0.01) ? total : pagReal;
        const pend = Math.max(0, total - pag);
        const lista = _movsDe(f);
        const totalUsd = (window.__usdDoc && window.__usdDoc(f)) || 0;
        const enUsd = totalUsd > 0 && lista.every((m) => _tasaEn(m.creado_en) > 0);
        const pagUsd = enUsd
          ? (f.presuntoPagado && pagReal <= 0.01 ? totalUsd : lista.reduce((a, m) => a + (Number(m.monto) || 0) / _tasaEn(m.creado_en), 0))
          : 0;
        return { f: f, total: total, pag: pag, pend: pend, presunto: f.presuntoPagado && pagReal <= 0.01,
          enUsd: enUsd, totalUsd: totalUsd, pagUsd: pagUsd,
          pendUsd: enUsd ? Math.max(0, Math.round((totalUsd - pagUsd) * 100) / 100) : 0 };
      /* Por FECHA, lo mas reciente arriba: es como se busca un documento.
         Antes se ordenaba por monto pendiente y nadie busca por ahi. */
      }).sort((a, b) => _claveFecha(b.f) - _claveFecha(a.f));
      const esVenta = tipo === 'venta';
      // Totales SIEMPRE sobre TODAS las facturas (la paginación es solo visual, igual que en el Libro Fiscal)
      let totalPend = 0, pendientes = 0, totalPendUsd = 0, todoEnUsd = true;
      rows.forEach((r) => {
        if (r.pend > 0.01) {
          pendientes++; totalPend += r.pend; totalPendUsd += r.pendUsd;
          if (!r.enUsd) todoEnUsd = false;          // con una sola fila sin tasa, el total va en bolivares
        }
      });
      const _sumaUsd = todoEnUsd && pendientes > 0;
      // Paginación: 20 facturas por página (igual que el Libro de Ventas/Compras en Fiscal)
      const PAG_FILAS = 20;
      const totalPag = Math.max(1, Math.ceil(rows.length / PAG_FILAS));
      const pag = Math.min(Math.max(1, _cxPage[tipo] || 1), totalPag);
      _cxPage[tipo] = pag;
      const inicio = (pag - 1) * PAG_FILAS;
      const rowsPag = rows.slice(inicio, inicio + PAG_FILAS);
      const html = rowsPag.map((r) => {
        const estado = r.presunto ? badge('Pagada', '#0a7a44', '#d5f0e0') : (r.pend <= 0.01 ? badge('Pagada', '#0a7a44', '#d5f0e0') : (r.pag > 0.01 ? badge('Parcial', '#9a6700', '#fdf0d0') : badge('Pendiente', '#b42318', '#fde0dd')));
        let accion = '';
        if (r.pend > 0.01) {
          accion = ' <button class="btn btn-ghost" data-cx-accion="' + (esVenta ? 'cobrar' : 'pagar') + '" data-ref="' + esc(r.f.ref || '') + '" data-terc="' + esc(r.f.tercero_nombre || '') + '" data-pend="' + r.pend.toFixed(2) + '" style="height:22px;font-size:10px;padding:0 9px;margin-left:6px;">' + (esVenta ? 'Cobrar' : 'Pagar') + '</button>';
        }
        // Compras: eliminar la compra registrada (sin necesidad del módulo Fiscal)
        if (!esVenta && r.f._id) {
          accion += ' <button class="btn btn-ghost" data-cx-del="' + esc(r.f._id) + '" data-ref="' + esc(r.f.ref || '') + '" data-terc="' + esc(r.f.tercero_nombre || '') + '" title="Eliminar esta compra" style="height:22px;font-size:10px;padding:0 7px;margin-left:4px;color:#c0392b;">&#10005;</button>';
        }
        // Compras: editar la factura registrada (sin necesidad del módulo Fiscal)
        if (!esVenta && r.f._id) {
          accion += ' <button class="btn btn-ghost" data-cx-edit="' + esc(r.f._id) + '" title="Editar o eliminar esta compra" style="height:22px;font-size:10px;padding:0 7px;margin-left:4px;"><i data-lucide="pencil" style="width:11px;height:11px;"></i></button>';
        }
        /* El dolar es el numero grande; el bolivar del documento va debajo,
           en pequeno, porque es lo que se declara y lo que se paga. */
        const cifra = (bs, usd) => (r.enUsd
          ? '$ ' + fmt(usd) + '<div class="cx-bs">Bs ' + fmt(bs) + '</div>'
          : 'Bs ' + fmt(bs));
        return '<tr><td class="primary">' + esc(r.f.tercero_nombre || '—') + '</td><td class="mono">' + esc(r.f.tercero_rif || '') + '</td><td>' + esc(r.f.ref || '') + '</td><td>' + esc(r.f.fecha || '') + '</td>'
          + '<td class="num">' + cifra(r.total, r.totalUsd) + '</td><td class="num" style="color:#0a7a44;">' + cifra(r.pag, r.pagUsd) + '</td>'
          + '<td class="num" style="font-weight:700;' + (r.pend > 0.01 ? 'color:#b42318;' : 'color:var(--fg-muted);') + '">' + cifra(r.pend, r.pendUsd) + '</td><td style="white-space:nowrap;">' + estado + accion + '</td></tr>';
      });
      body.innerHTML = html.length ? html.join('') : '<tr><td colspan="8" style="text-align:center;color:var(--fg-muted);padding:24px;">' + (esVenta ? 'Sin recibos de venta emitidos.' : 'Sin facturas de compra registradas.') + '</td></tr>';
      const tEl = document.getElementById(totalId); if (tEl) tEl.textContent = (_sumaUsd ? '$ ' + fmt(totalPendUsd) : 'Bs ' + fmt(totalPend));
      const cEl = document.getElementById(countId);
      if (cEl) {
        const pagerHtml = totalPag > 1
          ? '<div style="display:flex;align-items:center;gap:10px;margin-top:6px;font-size:11px;color:var(--fg-muted);">'
            + '<button class="btn btn-ghost" data-cxp-lp="' + tipo + '" data-cxp-lp-dir="-1"' + (pag <= 1 ? ' disabled' : '') + ' style="height:24px;font-size:10px;">« Anterior</button>'
            + '<span>Página ' + pag + ' de ' + totalPag + '</span>'
            + '<button class="btn btn-ghost" data-cxp-lp="' + tipo + '" data-cxp-lp-dir="1"' + (pag >= totalPag ? ' disabled' : '') + ' style="height:24px;font-size:10px;">Siguiente »</button>'
            + '</div>'
          : '';
        cEl.innerHTML = '<strong>' + pendientes + '</strong> con saldo pendiente · ' + rows.length + ' factura' + (rows.length === 1 ? '' : 's') + ' en total' + pagerHtml;
      }
      const tc = document.getElementById(tabCountId); if (tc) { tc.textContent = String(pendientes); tc.style.display = pendientes > 0 ? '' : 'none'; }
      // KPI de la vista Compras y CxP
      if (!esVenta) {
        const k = document.getElementById('cxpKpiTotal');
        if (k) {
          k.textContent = fmt(_sumaUsd ? totalPendUsd : totalPend);
          const moneda = k.parentElement && k.parentElement.querySelector('.currency');
          if (moneda) moneda.textContent = _sumaUsd ? '$' : 'Bs';
        }
        const km = document.getElementById('cxpKpiMeta'); if (km) km.textContent = pendientes + ' factura' + (pendientes === 1 ? '' : 's') + ' pendiente' + (pendientes === 1 ? '' : 's');
      }
    }
    function renderCxCxP() {
      renderCxList('venta', 'cxcBody', 'cxcTotalSum', 'cxcCount', 'cxcTabCount');
      renderCxList('compra', 'cxpBody', 'cxpTotalSum', 'cxpCount', 'cxpTabCount');
    }

    /* EN EL DOCUMENTO, no en la pantalla de Tesoreria.

       La tabla de Cuentas por Pagar vive en la pantalla de COMPRAS, y este
       manejador estaba atado a `view-tesoreria`: ahi dentro los botones
       existian y no hacian nada —el paginador, Pagar, el lapiz y la
       papelera—. Los selectores son propios, asi que no pisan a nadie. */
    document.addEventListener('click', async (e) => {
      const pb = e.target.closest('button[data-cxp-lp]');
      if (pb && !pb.disabled) {
        const tipo = pb.dataset.cxpLp;
        _cxPage[tipo] = (_cxPage[tipo] || 1) + parseInt(pb.dataset.cxpLpDir, 10);
        renderCxCxP();
        return;
      }
      const dc = e.target.closest('[data-teso-delcuenta]');
      const dm = e.target.closest('[data-teso-delmov]');
      const vc = e.target.closest('[data-teso-vercomp]');
      /* El recibo de cobro va aquí arriba, con los demás. Estaba dentro de la
         rama del botón de eliminar, así que no se alcanzaba nunca: para
         entrar ahí hay que haber pulsado ESE otro botón. */
      const rb = e.target.closest('[data-teso-recibo]');
      if (rb) { window.__reciboDeCobro(rb.dataset.tesoRecibo); return; }
      const rs = e.target.closest('[data-teso-compartir]');
      if (rs) { window.__reciboDeCobro(rs.dataset.tesoCompartir, 'compartir'); return; }
      if (vc) {
        const { data, error } = await window.sb.storage.from('comprobantes-tesoreria').createSignedUrl(vc.dataset.tesoVercomp, 120);
        if (error || !data) { toast('No se pudo abrir el comprobante: ' + (error && error.message), 'error'); return; }
        window.open(data.signedUrl, '_blank'); return;
      }
      if (dc) {
        if (!window.confirm('¿Eliminar esta cuenta y TODOS sus movimientos? No se puede deshacer.')) return;
        const { error } = await window.sb.from('cuentas_tesoreria').delete().eq('id', dc.dataset.tesoDelcuenta);
        if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return; }
        toast('Cuenta eliminada', 'success'); cargarTesoreria();
      } else if (dm) {
        const mov = _movs.find((m) => m.id === dm.dataset.tesoDelmov);
        const vinculado = mov && mov.factura_ref && mov.tercero_nombre;
        if (!window.confirm('¿Eliminar este movimiento?' + (vinculado ? '\n\nComo está vinculado al documento ' + mov.factura_ref + ', se generará el asiento de REVERSO y se recalculará su estado (vuelve a quedar por cobrar/pagar).' : ''))) return;
        const { error } = await window.sb.from('movimientos_tesoreria').delete().eq('id', dm.dataset.tesoDelmov);
        if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return; }
        // Reverso contable del cobro/pago eliminado (misma lógica de anticipos con que se contabilizó)
        if (vinculado && window.__postAsiento) {
          const refDoc = (mov.factura_ref || '').trim();
          const doc = _facturas.find((x) => (x.ref || '') === refDoc && x.tipo === (mov.tipo === 'ingreso' ? 'venta' : 'compra'));
          const totalDoc = doc ? (Number(doc.total) || 0) : null;
          const previoSin = _movs.filter((m) => m.id !== mov.id && m.tipo === mov.tipo && (m.factura_ref || '').trim() === refDoc)
            .reduce((s, m) => s + (Number(m.monto) || 0), 0);
          const monto = Number(mov.monto) || 0;
          const pend = (totalDoc == null) ? monto : Math.max(0, totalDoc - previoSin);
          const aplicado = Math.min(monto, pend);
          const exceso = Math.round((monto - aplicado) * 100) / 100;
          const c = _cuentas.find((x) => x.id === mov.cuenta_teso_id);
          const esCaja = c && /efectivo|caja/i.test((c.tipo || '') + ' ' + (c.nombre || ''));
          const ctaCash = esCaja ? '1.1.1.01 · Caja' : '1.1.1.03 · Bancos';
          let lineas;
          if (mov.tipo === 'ingreso') {
            lineas = [];
            if (aplicado > 0.005) lineas.push({ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: aplicado, haber: 0 });
            if (exceso > 0.005) lineas.push({ cta: '2.1.6.01 · Anticipos de clientes', debe: exceso, haber: 0 });
            lineas.push({ cta: ctaCash, debe: 0, haber: monto });
          } else {
            lineas = [{ cta: ctaCash, debe: monto, haber: 0 }];
            if (aplicado > 0.005) lineas.push({ cta: '2.1.1.01 · Cuentas por pagar comerciales', debe: 0, haber: aplicado });
            if (exceso > 0.005) lineas.push({ cta: '1.1.2.04 · Anticipos a proveedores', debe: 0, haber: exceso });
          }
          window.__postAsiento('Reverso ' + (mov.tipo === 'ingreso' ? 'cobro' : 'pago') + ' ' + refDoc + ' · ' + (mov.tercero_nombre || ''), refDoc, lineas, 'auto')
            .then((r) => { if (r && r.error) console.warn('[DigiAccount] Reverso:', r.error.message); });
          if (mov.tipo === 'ingreso') actualizarEstadoRecibo(refDoc);
        }
        toast('Movimiento eliminado' + (vinculado ? ' · asiento reversado y estado recalculado' : ''), 'success');
        cargarTesoreria();
        if (window.cargarFacturas) window.cargarFacturas();
        if (window.cargarDashboard) window.cargarDashboard();
      }
    });

    function agregarCuenta() {
      window.openFormModal && window.openFormModal({
        title: 'Agregar cuenta de tesorería', saveLabel: 'Agregar',
        fields: [
          { name: 'nombre', label: 'Nombre de la cuenta', col: 2, placeholder: 'Ej. Banesco · Corriente Bs' },
          { name: 'banco', label: 'Banco / Entidad', placeholder: 'Banesco' },
          { name: 'tipo', label: 'Tipo', type: 'select', options: ['Corriente', 'Ahorro', 'Divisas', 'Efectivo / Caja'] },
          { name: 'moneda', label: 'Moneda', type: 'select', options: ['Bs', 'USD'] },
          { name: 'numero', label: 'N° de cuenta / referencia', placeholder: '0134····4782' },
          { name: 'saldoInicial', label: 'Saldo inicial', type: 'number', step: '0.01', placeholder: '0.00' },
        ],
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          if (!v.nombre) return 'Indica el nombre de la cuenta.';
          window.sb.from('cuentas_tesoreria').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
            nombre: v.nombre, banco: v.banco, tipo: v.tipo, moneda: v.moneda, numero: v.numero,
            saldo_inicial: parseFloat(v.saldoInicial) || 0, color: PALETA[_cuentas.length % PALETA.length],
          }).then(({ error }) => { if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; } toast('Cuenta agregada', 'success'); cargarTesoreria(); });
        },
      });
    }
    /* ══════════════════════════════════════════════════════════════════
       EL ESTADO SE DECIDE EN DOLARES

       Comparaba bolivares con bolivares, y asi un recibo quedaba COBRADA
       debiendo todavia: el REC-000002 se emitio por 107,50 $ y el cliente
       pago dias despues el bolivar impreso, que ya solo eran 106,26 $. En
       bolivares cuadraba; en lo que de verdad se debe, no.

       El dolar del recibo lo da `__usdDoc` —lo guardado, o la tasa de su
       emision— y cada abono se lleva a dolares con la tasa del dia en que se
       pago. Sin alguna de esas tasas se compara en bolivares, como antes:
       una conversion inventada decidiria mal el estado de una cuenta.
       ══════════════════════════════════════════════════════════════════ */
    async function actualizarEstadoRecibo(ref) {
      try {
        const { data: f } = await window.sb.from('facturas')
          .select('id, total, total_usd, tasa, fecha, emitida_en, creado_en')
          .eq('numero', ref).eq('tipo', 'venta').maybeSingle();
        if (!f) return;
        const { data: movs } = await window.sb.from('movimientos_tesoreria')
          .select('monto, creado_en').eq('factura_ref', ref).eq('tipo', 'ingreso');
        const lista = movs || [];
        const pagado = lista.reduce((s, m) => s + (Number(m.monto) || 0), 0);

        if (window.__cargarTasasUSD) await window.__cargarTasasUSD();
        const tasaEn = (x) => ((window.__tasaUSDEn && window.__tasaUSDEn(x)) || 0);
        const usdRecibo = (window.__usdDoc && window.__usdDoc({
          tipo: 'venta', total: f.total, total_usd: f.total_usd, tasa: f.tasa,
          emitida: f.emitida_en || f.creado_en, fecha: f.fecha,
        })) || 0;
        const enUsd = usdRecibo > 0 && lista.every((m) => tasaEn(m.creado_en) > 0);
        const pagadoUsd = enUsd ? lista.reduce((s, m) => s + (Number(m.monto) || 0) / tasaEn(m.creado_en), 0) : 0;

        const estado = enUsd
          ? (pagadoUsd >= usdRecibo - 0.005 ? 'Cobrada' : (pagadoUsd > 0.005 ? 'Abonada' : 'Por cobrar'))
          : (pagado >= (Number(f.total) || 0) - 0.01 ? 'Cobrada' : (pagado > 0.01 ? 'Abonada' : 'Por cobrar'));
        await window.sb.from('facturas').update({ estado: estado }).eq('id', f.id);
        if (window.cargarFacturas) window.cargarFacturas();
      } catch (e) { console.warn('[Tesorería] No se pudo actualizar el estado del recibo:', e); }
    }
    async function registrarMovimiento(pre) {
      pre = pre || {};
      let fileEl = null;
      // Recargar las cuentas de la empresa activa: garantiza que aparezcan TODAS (bancos
      // incluidos), aunque el cobro se abra desde Ventas/CxC sin haber entrado a Tesorería.
      if (window.sb && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
        const { data: cc } = await window.sb.from('cuentas_tesoreria').select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('creado_en');
        if (cc) _cuentas = cc;
      }
      // El selector incluye bancos Y la Caja (efectivo). Si no hay caja, se crea sola al usarla.
      const cajaExist = _cuentas.find((c) => /efectivo|caja/i.test((c.tipo || '') + ' ' + (c.nombre || '')));
      const cuentaOpts = _cuentas.map((c) => ({ value: c.id, label: c.nombre }));
      if (!cajaExist) cuentaOpts.push({ value: '__caja__', label: '💵 Caja (Efectivo) — se crea automáticamente' });
      // Terceros (clientes/proveedores) y documentos para VINCULAR el movimiento.
      // ventas = RECIBOS (cobros) · compras = libro de compras (pagos). Ya cargados en _facturas.
      const terceros = (window.__getTerceros ? window.__getTerceros() : []);
      const facturas = _facturas;
      window.openFormModal && window.openFormModal({
        /* El título tiene que decir de qué lado está el dinero.

           Decía «Registrar cobro» SIEMPRE, aunque se abriera desde una
           factura de COMPRA con tipo 'egreso'. El movimiento se guardaba
           bien —el egreso era egreso— pero el cartel decía lo contrario, y
           ver «Registrar cobro» encima de una compra que uno acaba de
           cargar hace dudar de si el sistema entendió algo al revés.

           Los demás rótulos (proveedor, factura de compra) ya se adaptaban
           en `refrescarTerceros`; faltaba este, que es el que más se lee. */
        title: pre.factura
          ? (/egreso/i.test(pre.tipo || '') ? 'Registrar pago · ' : 'Registrar cobro · ') + pre.factura
          : 'Registrar movimiento',
        saveLabel: 'Registrar',
        fields: [
          { name: 'cuenta', label: 'Cuenta / Caja (banco o efectivo)', col: 2, type: 'select', options: cuentaOpts },
          { name: 'tipo', label: 'Tipo de movimiento', type: 'select', value: pre.tipo || 'ingreso', options: [{ value: 'ingreso', label: 'Ingreso · cobro de una venta' }, { value: 'egreso', label: 'Egreso · pago de una compra' }] },
          { name: 'fecha', label: 'Fecha', type: 'date', value: window.__hoyISO() },
          { name: 'tercero', label: 'Cliente (a quién le cobras)', col: 2, type: 'datalist', value: pre.tercero || '', options: [], placeholder: 'Escribe las iniciales y elige' },
          { name: 'factura', label: 'Recibo de venta asociado', type: 'datalist', value: pre.factura || '', options: [], placeholder: 'Elige primero el cliente' },
          { name: 'concepto', label: 'Concepto', col: 2, placeholder: 'Se completa solo al elegir la factura' },
          { name: 'referencia', label: 'Referencia (N° transferencia, pago móvil…)', placeholder: 'Ej. 0123456789' },
          { name: 'monto', label: 'Monto a cobrar/pagar (Bs) — edítalo si es un abono parcial', type: 'number', step: '0.01', value: pre.monto != null ? String(pre.monto) : '', placeholder: '0.00' },
          { name: 'igtfDivisas', label: 'IGTF (solo si el PAGO es en divisas/cripto)', type: 'select', options: [{ value: 'no', label: 'No aplica' }, { value: 'si', label: 'Sí — sumar 3% IGTF' }] },
          { name: 'comprobante', label: 'Comprobante · foto/capture del pago (opcional)', col: 2, type: 'file' },
        ],
        afterRender: (body) => {
          fileEl = body.querySelector('[data-name="comprobante"]');
          const tipoSel = body.querySelector('[data-name="tipo"]');
          const terc = body.querySelector('[data-name="tercero"]');
          const tercDl = document.getElementById('fm-dl-tercero');
          const fact = body.querySelector('[data-name="factura"]');
          const factDl = document.getElementById('fm-dl-factura');
          const montoEl = body.querySelector('[data-name="monto"]');
          const concEl = body.querySelector('[data-name="concepto"]');
          if (!tipoSel || !terc) return;
          const esIng = () => /ingreso/i.test(tipoSel.value);
          const setLbl = (el, txt) => { const w = el && el.closest('.fm-field'); const l = w && w.querySelector('.fm-lbl'); if (l) l.textContent = txt; };
          const refrescarTerceros = () => {
            const lista = terceros.filter((t) => (esIng() ? t.cli : t.prov) && t.nombre);
            if (tercDl) tercDl.innerHTML = lista.map((t) => '<option value="' + esc(t.nombre) + '"></option>').join('');
            setLbl(terc, esIng() ? 'Cliente (a quién le cobras)' : 'Proveedor (a quién le pagas)');
            terc.placeholder = esIng() ? 'Cliente…' : 'Proveedor…';
            setLbl(fact, esIng() ? 'Recibo de venta asociado' : 'Factura de compra asociada');
          };
          const facturasDe = () => {
            const tipoDoc = esIng() ? 'venta' : 'compra';
            const nom = (terc.value || '').trim().toLowerCase();
            return facturas.filter((f) => f.tipo === tipoDoc && nom && (f.tercero_nombre || '').toLowerCase() === nom);
          };
          const refrescarFacturas = () => {
            const fs = facturasDe();
            const docW = esIng() ? 'recibo' : 'factura';
            if (factDl) factDl.innerHTML = fs.map((f) => '<option value="' + esc(f.ref || '') + '">' + esc((f.ref || '(sin N°)') + ' · Bs ' + fmt(Number(f.total) || 0)) + '</option>').join('');
            if (fact) fact.placeholder = fs.length ? 'Elige entre ' + fs.length + ' ' + docW + '(s)…' : 'Sin ' + docW + 's de este tercero';
          };
          const autollenar = () => {
            const f = facturasDe().find((x) => (x.ref || '') === fact.value.trim());
            if (!f) return;
            if (montoEl && !montoEl.value) montoEl.value = (Number(f.total) || 0).toFixed(2);
            if (concEl) concEl.value = (esIng() ? 'Cobro · ' : 'Pago · ') + (terc.value || '') + (esIng() ? ' · Recibo ' : ' · Factura ') + (f.ref || '');
          };
          // Si se cambia el tipo a mano, el título sigue al cambio.
          const tituloEl = document.getElementById('fmTitle');
          const refrescarTitulo = () => {
            if (!tituloEl || !pre.factura) return;
            tituloEl.textContent = (esIng() ? 'Registrar cobro · ' : 'Registrar pago · ') + pre.factura;
          };
          tipoSel.addEventListener('change', () => { refrescarTerceros(); refrescarFacturas(); refrescarTitulo(); });
          terc.addEventListener('change', refrescarFacturas); terc.addEventListener('input', refrescarFacturas);
          fact.addEventListener('change', autollenar); fact.addEventListener('input', autollenar);
          refrescarTerceros(); refrescarFacturas(); refrescarTitulo(); autollenar();
          // 🤖 OCR del comprobante (Agente IA): al adjuntar la foto del pago, la lee y
          // rellena referencia/monto/fecha solos. El usuario revisa y corrige antes de guardar.
          const refEl = body.querySelector('[data-name="referencia"]');
          const fechaEl = body.querySelector('[data-name="fecha"]');
          if (fileEl && window.__ocrComprobante) fileEl.addEventListener('change', async () => {
            const file = fileEl.files && fileEl.files[0];
            if (!file) return;
            // OCR del comprobante + conciliación de cobros: función GRATIS para todas las
            // cuentas (Asistente IA incluido). El costo de lectura es despreciable.
            toast('🤖 Leyendo el comprobante con IA…', 'info');
            const d = await window.__ocrComprobante(file);
            if (!d || !d.ok) { toast('No se pudo leer el comprobante' + (d && d.error ? ': ' + d.error : '') + ' — regístralo manual', 'error'); return; }
            if (refEl && d.referencia) refEl.value = d.referencia;
            if (montoEl && !montoEl.value && d.monto != null) montoEl.value = Number(d.monto).toFixed(2);
            if (fechaEl && d.fecha) { const p = String(d.fecha).split('/'); if (p.length === 3) fechaEl.value = p[2] + '-' + p[1] + '-' + p[0]; }
            const conf = d.confianza != null ? Math.round(d.confianza * 100) + '%' : '';
            toast('✓ Comprobante leído' + (d.banco ? ' · ' + d.banco : '') + (d.monto != null ? ' · Bs ' + fmt(Number(d.monto)) : '') + (d.referencia ? ' · ref. ' + d.referencia : '') + (conf ? ' · certeza ' + conf : ''), 'success');
            // 🤖 CONCILIACIÓN DE COBROS: con lo leído, el agente ata cabos solo.
            try {
              // (1) ANTI-FRAUDE: ¿esta referencia ya fue registrada antes?
              const refN = String(d.referencia || '').replace(/\D/g, '').replace(/^0+/, '');
              if (refN.length >= 4) {
                const dup = _movs.find((m) => {
                  const r = String(m.referencia || '').replace(/\D/g, '').replace(/^0+/, '');
                  return r && (r === refN || (r.length >= 6 && refN.length >= 6 && (r.endsWith(refN) || refN.endsWith(r))));
                });
                if (dup) setTimeout(() => toast('🚨 OJO: la referencia ' + d.referencia + ' YA está registrada (' + (dup.concepto || 'movimiento') + (dup.fecha ? ' del ' + dup.fecha : '') + ') — posible comprobante repetido', 'error'), 700);
              }
              // (2) SUGERIR EL RECIBO: candidatos = ventas por cobrar cuyo saldo pendiente
              //     coincide con el monto del pago (±5 céntimos).
              //     REGLA (pedida por Luis): el monto solo NO identifica a nadie (puede ser
              //     un abono de otro cliente) → se AUTO-ASIGNA únicamente con una SEGUNDA
              //     coincidencia (el teléfono del pagador = teléfono del cliente). Con solo
              //     el monto, se sugiere en un aviso y el contador decide.
              if (esIng() && d.monto != null && fact && !fact.value.trim()) {
                const monto = Number(d.monto);
                const cand = _facturas
                  .filter((f) => f.tipo === 'venta' && !/cobrada|anulada/i.test(f.estado || ''))
                  .map((f) => ({ f: f, pend: (Number(f.total) || 0) - (window.__cobradoDe ? window.__cobradoDe(f.ref) : 0) }))
                  .filter((x) => x.pend > 0.01 && Math.abs(x.pend - monto) <= 0.05);
                // Segunda firma: teléfono del pagador (pago móvil) vs teléfono del cliente
                const telPago = String(d.telefono || '').replace(/\D/g, '').slice(-7);
                const telDe = (nombre) => {
                  const t = terceros.find((x) => (x.nombre || '').toLowerCase() === (nombre || '').toLowerCase());
                  return String((t && t.tel) || '').replace(/\D/g, '').slice(-7);
                };
                const conTel = telPago.length === 7 ? cand.filter((x) => telDe(x.f.tercero_nombre) === telPago) : [];
                const elegir = (x, firma) => {
                  if (terc && !terc.value.trim()) { terc.value = x.f.tercero_nombre || ''; terc.dispatchEvent(new Event('input')); }
                  fact.value = x.f.ref || '';
                  fact.dispatchEvent(new Event('input'));
                  setTimeout(() => toast('🤖 Cobro asignado al recibo ' + (x.f.ref || '') + ' de ' + (x.f.tercero_nombre || '') + ' (monto + ' + firma + ' coinciden · pendiente Bs ' + fmt(x.pend) + ') — verifica y registra', 'success'), 1400);
                };
                if (conTel.length === 1) {
                  elegir(conTel[0], 'teléfono del pagador');
                } else if (cand.length === 1) {
                  // Solo coincide el monto: NO se asigna — se sugiere
                  const f = cand[0].f;
                  setTimeout(() => toast('🤖 Sugerencia: el monto coincide con el recibo ' + (f.ref || '¿?') + ' de ' + (f.tercero_nombre || '') + ' (pendiente Bs ' + fmt(cand[0].pend) + '). Si es ese, elige el cliente — si es un abono de otro, ignora esto', 'info'), 1400);
                } else if (cand.length > 1) {
                  setTimeout(() => toast('🤖 El monto coincide con ' + cand.length + ' recibos por cobrar: ' + cand.slice(0, 3).map((x) => (x.f.ref || '¿?') + ' · ' + (x.f.tercero_nombre || '')).join(' / ') + (cand.length > 3 ? '…' : '') + ' — elige el cliente para afinar', 'info'), 1400);
                }
              }
            } catch (e) { console.warn('[Tesorería] Sugerencia de conciliación:', e); }
          });
        },
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          if (!v.cuenta) return 'Elige la cuenta o caja.';
          const monto = parseFloat(v.monto) || 0; if (monto <= 0) return 'Indica un monto mayor a cero.';
          // Aviso ANTES de guardar si el monto excede el saldo pendiente (¿error de tipeo o anticipo real?)
          if (v.factura) {
            const refDoc = v.factura.trim();
            const doc = _facturas.find((x) => (x.ref || '') === refDoc && x.tipo === (v.tipo === 'ingreso' ? 'venta' : 'compra'));
            if (doc) {
              const previo = _movs.filter((m) => m.tipo === v.tipo && (m.factura_ref || '').trim() === refDoc).reduce((s, m) => s + (Number(m.monto) || 0), 0);
              const pend = Math.max(0, (Number(doc.total) || 0) - previo);
              if (monto > pend + 0.01) {
                const exc = Math.round((monto - pend) * 100) / 100;
                const ok = window.confirm('⚠️ El monto (Bs ' + fmt(monto) + ') EXCEDE el saldo pendiente del documento (Bs ' + fmt(pend) + ').\n\nEl excedente de Bs ' + fmt(exc) + ' quedará como ' + (v.tipo === 'ingreso' ? 'SALDO A FAVOR del cliente (Anticipos de clientes).' : 'anticipo a TU favor (Anticipos a proveedores).') + '\n\n¿Registrar así?');
                if (!ok) return 'Ajusta el monto o confirma el excedente.';
              }
            }
          }
          const p = (v.fecha || '').split('-'); const fecha = p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0].slice(2)) : '';
          const file = fileEl && fileEl.files && fileEl.files[0];
          const t = terceros.find((x) => x.nombre.toLowerCase() === (v.tercero || '').trim().toLowerCase());
          const tercRif = t ? t.rif : '';
          const insertar = (cuentaId, comprobante_path) => {
            window.sb.from('movimientos_tesoreria').insert({
              cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, cuenta_teso_id: cuentaId,
              fecha: fecha, concepto: v.concepto, tipo: v.tipo, referencia: v.referencia, monto: monto, comprobante_path: comprobante_path || null,
              tercero_nombre: v.tercero || null, tercero_rif: tercRif || null, factura_ref: v.factura || null,
            }).then(({ error }) => {
              if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
              toast((v.tipo === 'ingreso' ? 'Ingreso (cobro)' : 'Egreso (pago)') + ' registrado' + (comprobante_path ? ' con comprobante' : ''), 'success');
              // Asiento contable automático: solo si el movimiento está vinculado a un recibo/factura
              if (v.factura && v.tercero && window.__postAsiento) {
                const cta = _cuentas.find((c) => c.id === cuentaId);
                const esCaja = cta && /efectivo|caja/i.test((cta.tipo || '') + ' ' + (cta.nombre || ''));
                const ctaCash = esCaja ? '1.1.1.01 · Caja' : '1.1.1.03 · Bancos';
                const cashName = cta ? cta.nombre : (esCaja ? 'Caja' : 'Bancos');
                // PAGO EN EXCESO → ANTICIPO: lo que exceda el saldo pendiente del documento
                // NO abona a CxC/CxP (quedaría en negativo): va a una cuenta de anticipos.
                const refDoc = (v.factura || '').trim();
                const doc = _facturas.find((x) => (x.ref || '') === refDoc && x.tipo === (v.tipo === 'ingreso' ? 'venta' : 'compra'));
                const totalDoc = doc ? (Number(doc.total) || 0) : null;
                const previo = _movs.filter((m) => m.tipo === v.tipo && (m.factura_ref || '').trim() === refDoc)
                  .reduce((s, m) => s + (Number(m.monto) || 0), 0);
                const pendiente = (totalDoc == null) ? monto : Math.max(0, totalDoc - previo);
                const aplicado = Math.min(monto, pendiente);
                const exceso = Math.round((monto - aplicado) * 100) / 100;
                let lineas, desc;
                if (v.tipo === 'ingreso') {
                  lineas = [{ cta: ctaCash, debe: monto, haber: 0 }];
                  if (aplicado > 0.005) lineas.push({ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: 0, haber: aplicado });
                  if (exceso > 0.005) lineas.push({ cta: '2.1.6.01 · Anticipos de clientes', debe: 0, haber: exceso });
                  desc = 'Cobro recibo ' + v.factura + ' · ' + v.tercero + ' (' + cashName + ')' + (exceso > 0.005 ? ' · anticipo Bs ' + fmt(exceso) : '');
                } else {
                  lineas = [];
                  if (aplicado > 0.005) lineas.push({ cta: '2.1.1.01 · Cuentas por pagar comerciales', debe: aplicado, haber: 0 });
                  if (exceso > 0.005) lineas.push({ cta: '1.1.2.04 · Anticipos a proveedores', debe: exceso, haber: 0 });
                  lineas.push({ cta: ctaCash, debe: 0, haber: monto });
                  desc = 'Pago factura ' + v.factura + ' · ' + v.tercero + ' (' + cashName + ')' + (exceso > 0.005 ? ' · anticipo Bs ' + fmt(exceso) : '');
                }
                window.__postAsiento(desc, v.factura, lineas, 'auto').then((r) => { if (r && r.error) console.warn('[DigiAccount] No se pudo contabilizar el movimiento:', r.error.message); });
                if (exceso > 0.005) {
                  toast(v.tipo === 'ingreso'
                    ? 'Bs ' + fmt(exceso) + ' exceden el recibo: quedaron como SALDO A FAVOR del cliente (Anticipos de clientes)'
                    : 'Bs ' + fmt(exceso) + ' exceden la factura: quedaron como saldo a TU favor (Anticipos a proveedores)', 'info');
                }
              }
              // IGTF 3% cuando el PAGO se hace en divisas/cripto: egreso adicional + asiento de gasto
              if (v.tipo === 'egreso' && v.igtfDivisas === 'si') {
                const igtf = Math.round(monto * 0.03 * 100) / 100;
                if (igtf > 0.005) {
                  const cta = _cuentas.find((c) => c.id === cuentaId);
                  const esCaja = cta && /efectivo|caja/i.test((cta.tipo || '') + ' ' + (cta.nombre || ''));
                  const ctaCash = esCaja ? '1.1.1.01 · Caja' : '1.1.1.03 · Bancos';
                  const concIgtf = 'IGTF 3% s/pago en divisas' + (v.factura ? ' · ' + v.factura : '');
                  window.sb.from('movimientos_tesoreria').insert({
                    cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, cuenta_teso_id: cuentaId,
                    fecha: fecha, concepto: concIgtf, tipo: 'egreso', referencia: v.referencia, monto: igtf,
                  }).then(({ error: e2 }) => {
                    if (e2) { console.warn('[DigiAccount] IGTF:', e2.message); return; }
                    if (window.__postAsiento) window.__postAsiento(concIgtf, v.factura || 'IGTF', [{ cta: '6.3.1.04 · IGTF (gasto)', debe: igtf, haber: 0 }, { cta: ctaCash, debe: 0, haber: igtf }], 'auto');
                    cargarTesoreria();
                  });
                }
              }
              // El recibo asociado pasa a "Cobrada" (o "Abonada" si fue parcial)
              if (v.tipo === 'ingreso' && v.factura) actualizarEstadoRecibo(v.factura.trim());
              cargarTesoreria();
              if (window.cargarDashboard) window.cargarDashboard();
            });
          };
          const proceder = (cuentaId) => {
            if (file) {
              const safe = (s) => (s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
              const path = window.__CUENTA_ID + '/' + window.__EMPRESA_ACTIVA.id + '/' + Date.now() + '_' + safe(file.name);
              window.sb.storage.from('comprobantes-tesoreria').upload(path, file, { upsert: false, contentType: file.type || undefined }).then(({ error }) => {
                if (error) { toast('No se pudo subir el comprobante: ' + error.message, 'error'); return; }
                insertar(cuentaId, path);
              });
            } else { insertar(cuentaId, null); }
          };
          // Si eligió "Caja" y no existe, la crea primero y luego registra el movimiento
          if (v.cuenta === '__caja__') {
            window.sb.from('cuentas_tesoreria').insert({ cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, nombre: 'Caja (Efectivo)', tipo: 'Efectivo / Caja', moneda: 'Bs', saldo_inicial: 0, color: '#1c8f5a' }).select().single().then(({ data, error }) => {
              if (error || !data) { toast('No se pudo crear la Caja: ' + (error && error.message), 'error'); return; }
              _cuentas.push(data); // que el asiento la reconozca como CAJA (no Bancos)
              proceder(data.id);
            });
          } else { proceder(v.cuenta); }
        },
      });
    }
    function transferir() {
      if (_cuentas.length < 2) { toast('Necesitas al menos 2 cuentas (o Caja) para transferir.', 'error'); return; }
      const opts = _cuentas.map((c) => ({ value: c.id, label: c.nombre + ' · saldo ' + fmt(saldoDe(c.id)) }));
      window.openFormModal && window.openFormModal({
        title: 'Transferencia entre cuentas', saveLabel: 'Transferir',
        fields: [
          { name: 'origen', label: 'Desde (sale el dinero)', col: 2, type: 'select', options: opts },
          { name: 'destino', label: 'Hacia (entra el dinero)', col: 2, type: 'select', options: opts },
          { name: 'monto', label: 'Monto (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
          { name: 'fecha', label: 'Fecha', type: 'date', value: window.__hoyISO() },
          { name: 'concepto', label: 'Concepto', col: 2, value: 'Transferencia entre cuentas' },
        ],
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay empresa activa.';
          if (!v.origen || !v.destino) return 'Elige las cuentas de origen y destino.';
          if (v.origen === v.destino) return 'El origen y el destino deben ser distintos.';
          const monto = parseFloat(v.monto) || 0; if (monto <= 0) return 'Indica un monto mayor a cero.';
          const p = (v.fecha || '').split('-'); const fecha = p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0].slice(2)) : '';
          const cOri = _cuentas.find((c) => c.id === v.origen), cDes = _cuentas.find((c) => c.id === v.destino);
          const ref = 'TRF-' + String(Date.now()).slice(-8);
          const base = { cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, fecha: fecha, referencia: ref, monto: monto };
          window.sb.from('movimientos_tesoreria').insert([
            Object.assign({}, base, { cuenta_teso_id: v.origen, tipo: 'egreso', concepto: v.concepto + ' → ' + (cDes ? cDes.nombre : '') }),
            Object.assign({}, base, { cuenta_teso_id: v.destino, tipo: 'ingreso', concepto: v.concepto + ' ← ' + (cOri ? cOri.nombre : '') }),
          ]).then(({ error }) => {
            if (error) { toast('No se pudo transferir: ' + error.message, 'error'); return; }
            const code = (c) => (c && /efectivo|caja/i.test((c.tipo || '') + ' ' + (c.nombre || ''))) ? '1.1.1.01 · Caja' : '1.1.1.03 · Bancos';
            const oc = code(cOri), dc = code(cDes);
            if (window.__postAsiento && oc !== dc) {
              window.__postAsiento('Transferencia ' + (cOri ? cOri.nombre : '') + ' → ' + (cDes ? cDes.nombre : ''), ref,
                [{ cta: dc, debe: monto, haber: 0 }, { cta: oc, debe: 0, haber: monto }], 'auto');
            }
            toast('Transferencia registrada · Bs ' + fmt(monto), 'success');
            cargarTesoreria();
          });
        },
      });
    }
    const addBtn = document.getElementById('tesoAddCuentaBtn'); if (addBtn) addBtn.addEventListener('click', agregarCuenta);
    const trBtn = document.getElementById('tesoTransferBtn'); if (trBtn) trBtn.addEventListener('click', transferir);
    const movBtn = document.getElementById('tesoMovBtn'); if (movBtn) movBtn.addEventListener('click', () => registrarMovimiento());
    // Permite registrar un cobro/pago prefilleado desde otro módulo (p. ej. botón "Cobrar" del recibo de venta)
    window.__registrarCobro = (pre) => registrarMovimiento(pre);

    /* La conciliación bancaria vive en assets/conciliacion.js, la misma de
       Contabilidad: cada línea del estado de cuenta se clasifica y su asiento lo
       hace la base. La de aquí cruzaba solo por monto, contra la regla de la
       doble coincidencia, y hacía los asientos desde el navegador. */
    // Botones "Cobrar" (CxC en Ventas) y "Pagar" (CxP en Compras): abren el movimiento prefilleado
    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cx-accion]');
      if (b) { registrarMovimiento({ tipo: b.dataset.cxAccion === 'cobrar' ? 'ingreso' : 'egreso', tercero: b.dataset.terc, factura: b.dataset.ref, monto: b.dataset.pend }); return; }
      const ed = e.target.closest('[data-cx-edit]');
      if (ed && window.__editLibroFiscal) { window.__editLibroFiscal(ed.dataset.cxEdit, 'compra'); return; }
      /* ELIMINAR UNA COMPRA desde Compras y CxP.

         Se lleva lo que cuelga de ella: sus pagos —ese dinero salio por este
         documento— y sus asientos. Igual que el recibo de venta: un pago
         colgando de un documento que ya no existe descuadra la caja. */
      const dl = e.target.closest('[data-cx-del]');
      if (dl) {
        const ref = (dl.dataset.ref || '').trim(), terc = dl.dataset.terc || '';
        const pagos = _movs.filter((m) => m.tipo === 'egreso' && (m.factura_ref || '').trim() === ref);
        const sumaPagos = pagos.reduce((a, m) => a + (Number(m.monto) || 0), 0);
        const aviso = ['\u00bfELIMINAR la compra ' + (ref || 'sin n\u00famero') + ' de ' + (terc || '\u2014') + '?', '',
          '\u00b7 Se borra de Compras y del libro'];
        if (sumaPagos > 0.01) aviso.push('\u00b7 Se borran tambi\u00e9n sus PAGOS por Bs ' + fmt(sumaPagos) + ' (ese dinero vuelve a Tesorer\u00eda)');
        aviso.push('\u00b7 Se eliminan sus asientos contables', '', 'No se puede deshacer.');
        if (!window.confirm(aviso.join('\n'))) return;
        const empAct = window.__EMPRESA_ACTIVA || {};
        if (ref && empAct.id) {
          const { error: eM } = await window.sb.from('movimientos_tesoreria').delete()
            .eq('empresa_id', empAct.id).eq('factura_ref', ref);
          if (eM) { toast('No se pudieron eliminar los pagos: ' + eM.message, 'error'); return; }
        }
        const { error: eC } = await window.sb.from('libro_fiscal').delete().eq('id', dl.dataset.cxDel);
        if (eC) { toast('No se pudo eliminar: ' + eC.message, 'error'); return; }
        if (ref && empAct.id) {
          const { error: eA } = await window.sb.from('asientos').delete().eq('empresa_id', empAct.id).eq('referencia', ref);
          if (eA) console.warn('[DigiAccount] Asientos de la compra ' + ref + ':', eA.message);
          if (window.cargarAsientos) window.cargarAsientos();
        }
        toast('Compra ' + ref + ' eliminada', 'success');
        cargarTesoreria();
        if (window.cargarLibroFiscal) window.cargarLibroFiscal('compra');
        if (window.cargarDashboard) window.cargarDashboard();
        return;
      }
    });
    cargarTesoreria();
  })();
})();
