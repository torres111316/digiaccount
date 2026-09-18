/* =========================================================
   DigiAccount ERP — TERCEROS
   El registro unico de clientes y proveedores, con sus saldos.

   Solo usaba un nombre privado del bloque grande —`esc`—, que ya vive
   en el nucleo.

   Se carga DESPUES de app.js: lo que expone —la lista de terceros y sus
   saldos— lo consumen ventas, compras, tesoreria y retenciones
   a traves de `window.*`, y lo que necesita de ellos tambien.
   ========================================================= */
(function () {
  'use strict';

  // Los nombres cortos que usa el cuerpo, apuntando al nucleo.
  const esc = window.__esc;

  /* =========================================================
     TERCEROS — registro unificado de clientes y proveedores
     ========================================================= */
  (function tercerosModule() {
    const view = document.getElementById('view-terceros');
    const overlay = document.getElementById('terModal');
    if (!view || !overlay) return;
    const tbody = document.getElementById('tercerosBody');
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const fmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const normRif = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const idSistema = (rif) => String(rif || '').replace(/^[A-Za-z]/, ''); // RIF sin la letra inicial

    // Catálogo de terceros (memoria) — registro único por RIF
    const DB = [];   // los terceros reales se cargan desde Supabase con cargarTerceros()

    const rolDe = (t) => t.cli && t.prov ? 'ambos' : t.cli ? 'cliente' : t.prov ? 'proveedor' : 'otro';
    function rolBadges(t) {
      if (t.cli && t.prov) return '<span class="tag" style="background:var(--da-cyan-500);color:var(--da-navy-900);">Cliente + Proveedor</span>';
      if (t.cli) return '<span class="tag success">Cliente</span>';
      if (t.prov) return '<span class="tag warn">Proveedor</span>';
      return '<span class="tag slate">Otro</span>';
    }
    /* ════════════════════════════════════════════════════════════════
       EL SALDO DE CADA TERCERO, CALCULADO

       Antes se leian `terceros.cxc` y `terceros.cxp`: campos que nada
       actualiza. Siempre 0, la columna siempre «—», aunque hubiera
       recibos pendientes.

       Ahora sale de la misma fuente que el Panel, repartida por RIF:
         Te debe  · recibos de venta menos sus cobros, EN DOLARES con la
                    tasa de cada momento (el mismo calculo del recibo de
                    cobro). Sin tasa para algun momento: en bolivares.
         Le debes · compras del libro menos sus pagos, en bolivares.
       En modo libro no se llevan cuentas por cobrar ni por pagar.
       ════════════════════════════════════════════════════════════════ */
    let SALDOS = null;              // { RIF: { cxcUsd, cxcBs, cxp } } · { __libro: true }
    let _saldosSeq = 0;
    function calcularSaldos(ventas, compras, movs, tasaEn) {
      const out = {};
      const de = (rif) => (out[normRif(rif)] = out[normRif(rif)] || { cxcUsd: 0, cxcBs: 0, cxp: 0, cxpUsd: 0 });
      /* dd/mm/aa del libro → la fecha con la que se busca su tasa. */
      const fechaLibroISO = (f) => {
        const p = String(f || '').split('/');
        if (p.length !== 3) return null;
        const aa = p[2].length === 2 ? '20' + p[2] : p[2];
        return aa + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0') + 'T12:00:00';
      };
      const porRef = (tipo) => {
        const o = {};
        movs.filter((m) => m.tipo === tipo).forEach((m) => {
          const r = (m.factura_ref || '').trim();
          if (r) (o[r] = o[r] || []).push(m);
        });
        return o;
      };
      const cobros = porRef('ingreso'), pagos = porRef('egreso');
      ventas.filter((f) => !/anulada/i.test(f.estado || '')).forEach((f) => {
        const lista = cobros[(f.numero || '').trim()] || [];
        const total = Number(f.total) || 0;
        const enUsd = (window.__usdDoc && window.__usdDoc(Object.assign({ tipo: 'venta' }, f))) || 0;
        if (enUsd > 0 && lista.every((m) => tasaEn(m.creado_en) > 0)) {
          const s = enUsd - lista.reduce((a, m) => a + (Number(m.monto) || 0) / tasaEn(m.creado_en), 0);
          if (s > 0.005) de(f.cliente_rif).cxcUsd += s;
        } else {
          const s = total - lista.reduce((a, m) => a + (Number(m.monto) || 0), 0);
          if (s > 0.01) de(f.cliente_rif).cxcBs += s;
        }
      });
      /* Al proveedor tambien se le debe en DOLARES: la compra se hizo a una
         tasa y cada pago a la suya, asi que el saldo es una resta en dolares.
         Sin alguna de esas tasas, esa compra se queda en bolivares. */
      compras.forEach((f) => {
        const lista = pagos[(f.numero_factura || '').trim()] || [];
        const total = Number(f.total) || 0;
        const enUsd = (window.__usdDoc && window.__usdDoc(Object.assign({ tipo: 'compra' }, f))) || 0;
        if (enUsd > 0 && lista.every((m) => tasaEn(m.creado_en) > 0)) {
          const s = enUsd - lista.reduce((a, m) => a + (Number(m.monto) || 0) / tasaEn(m.creado_en), 0);
          if (s > 0.005) de(f.tercero_rif).cxpUsd += s;
        } else {
          const s = total - lista.reduce((a, m) => a + (Number(m.monto) || 0), 0);
          if (s > 0.01) de(f.tercero_rif).cxp += s;
        }
      });
      return out;
    }
    async function cargarSaldosTerceros() {
      const seq = ++_saldosSeq;
      const emp = window.__EMPRESA_ACTIVA;
      if (!window.sb || !window.__sbAll || !emp || !emp.id) { SALDOS = null; render(); return; }
      if (emp.fiscalActivo || emp.modo === 'libro') { SALDOS = { __libro: true }; render(); return; }
      const [rf, rl, rm] = await Promise.all([
        window.__sbAll((q) => q.eq('tipo', 'venta').eq('empresa_id', emp.id), 'facturas', 'numero, cliente_rif, total, total_usd, tasa, estado, emitida_en, creado_en'),
        window.__sbAll((q) => q.eq('tipo', 'compra').eq('empresa_id', emp.id), 'libro_fiscal', 'numero_factura, tercero_rif, total, total_usd, tasa, fecha'),
        window.__sbAll((q) => q.eq('empresa_id', emp.id), 'movimientos_tesoreria', 'tipo, monto, factura_ref, creado_en'),
        window.__cargarTasasUSD ? window.__cargarTasasUSD() : null,
      ]);
      if (seq !== _saldosSeq) return;          // cambio la empresa mientras llegaban los datos
      if (rf.error || rl.error || rm.error) { console.warn('[DigiAccount] Saldos de terceros:', (rf.error || rl.error || rm.error).message); return; }
      const tasaEn = (x) => (window.__tasaUSDEn && window.__tasaUSDEn(x)) || 0;
      SALDOS = calcularSaldos(rf.data || [], rl.data || [], rm.data || [], tasaEn);
      render();
    }
    window.__cargarSaldosTerceros = cargarSaldosTerceros;

    function saldoCell(t) {
      const nada = '<span style="color:var(--fg-muted);">—</span>';
      if (!SALDOS) return nada;
      if (SALDOS.__libro) return '<span style="color:var(--fg-muted);" title="En modo libro no se llevan cuentas por cobrar ni por pagar">—</span>';
      const s = SALDOS[normRif(t.rif)];
      if (!s) return nada;
      const usd = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const parts = [];
      if (s.cxcUsd > 0.005) parts.push('<span class="ter-saldo" style="color:var(--da-success);"><small>Te debe</small> ' + usd(s.cxcUsd) + '</span>');
      if (s.cxcBs > 0.01) parts.push('<span class="ter-saldo" style="color:var(--da-success);"><small>Te debe</small> Bs ' + fmt(s.cxcBs) + '</span>');
      if (s.cxpUsd > 0.005) parts.push('<span class="ter-saldo" style="color:#8a5410;"><small>Le debes</small> ' + usd(s.cxpUsd) + '</span>');
      if (s.cxp > 0.01) parts.push('<span class="ter-saldo" style="color:#8a5410;"><small>Le debes</small> Bs ' + fmt(s.cxp) + '</span>');
      return parts.length ? parts.join('<br>') : nada;
    }
    // Tipo de RIF venezolano (V, E, J, P, G, C) derivado del prefijo
    const prefijoTipo = (tipo) => { const m = (tipo || '').match(/\(([A-Z])\)/); return m ? m[1] : ''; };
    const iconTipo = (tipo) => {
      if (/F\.P\./.test(tipo)) return 'stamp';
      if (/Emprendimiento/i.test(tipo)) return 'rocket';
      const l = prefijoTipo(tipo);
      return l === 'G' ? 'landmark' : l === 'J' ? 'building-2' : l === 'C' ? 'users' : 'user';
    };
    function tipoCell(tipo) {
      const l = prefijoTipo(tipo);
      const cortos = { J: 'Jurídica', V: 'Natural', E: 'Extranjero', G: 'Gobierno', P: 'Pasaporte', C: 'Comunal' };
      let corto = cortos[l] || tipo;
      if (/F\.P\./.test(tipo)) corto = 'Firma P.';
      else if (/Emprendimiento/i.test(tipo)) corto = 'Emprend.';
      const cls = l === 'J' ? 'navy' : l === 'G' ? 'cyan' : l === 'E' ? 'warn' : 'slate';
      return '<span class="tag ' + cls + '" style="font-family:var(--font-mono);">' + (l || '?') + '</span> ' + corto;
    }

    let filtroRol = 'todos', query = '';
    function pasa(t) {
      if (filtroRol === 'cliente' && !(t.cli && !t.prov)) return false;
      if (filtroRol === 'proveedor' && !(t.prov && !t.cli)) return false;
      if (filtroRol === 'ambos' && !(t.cli && t.prov)) return false;
      if (query) {
        const blob = (t.nombre + ' ' + t.rif + ' ' + t.tel).toLowerCase();
        if (!blob.includes(query)) return false;
      }
      return true;
    }
    /* 20 por página, como la tabla de retenciones. La página vive fuera de
       render() para que sobreviva a un re-pintado, pero se vuelve a la 1
       cuando cambia el filtro: si buscas algo y te deja en la página 7,
       parece que no hay resultados. */
    let _terPag = 1;
    function render(page) {
      const vis = DB.filter(pasa);
      const PAG = 20;
      const totalPag = Math.max(1, Math.ceil(vis.length / PAG));
      _terPag = Math.min(Math.max(1, page || _terPag), totalPag);
      const ini = (_terPag - 1) * PAG;
      const pagina = vis.slice(ini, ini + PAG);
      tbody.innerHTML = pagina.map((t, i) => {
        /* El índice es el de DB, NO el de la página: los botones de Ficha y
           Eliminar lo usan para buscar el tercero. Si aquí se pusiera el de
           la página, en la página 2 se abriría la ficha equivocada — un
           fallo que no da error y borra a quien no era. */
        const idx = DB.indexOf(t);
        return '<tr data-idx="' + idx + '">'
          + '<td><div class="prod-cell"><div class="prod-thumb" style="background:var(--da-navy-50);color:var(--da-navy-700);"><i data-lucide="' + iconTipo(t.tipo) + '"></i></div><div class="info"><div class="n">' + esc(t.nombre) + '</div><div class="sku">ID ' + esc(idSistema(t.rif)) + (t.email ? ' · ' + esc(t.email) : '') + '</div></div></div></td>'
          + '<td class="mono">' + esc(t.rif) + '</td><td>' + tipoCell(t.tipo) + '</td>'
          + '<td>' + rolBadges(t) + '</td><td>' + esc(t.fiscal) + '</td><td class="mono">' + esc(t.tel || '—') + '</td>'
          + '<td class="num">' + saldoCell(t) + '</td>'
          + '<td style="white-space:nowrap;"><button class="btn btn-ghost" data-ver-tercero="' + idx + '" style="height:26px;font-size:11px;padding:0 9px;white-space:nowrap;"><i data-lucide="eye"></i> Ficha</button>'
          + '<button class="icon-btn" data-borrar-tercero="' + idx + '" title="Eliminar del directorio" style="width:26px;height:26px;margin-left:4px;"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button></td></tr>';
      }).join('');
      if (!vis.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--fg-muted);padding:16px;">'
          + (DB.length ? 'Ningún tercero coincide con el filtro.' : 'El directorio está vacío.') + '</td></tr>';
      } else if (totalPag > 1) {
        tbody.innerHTML += '<tr><td colspan="8" style="padding:6px 10px;">'
          + '<div style="display:flex;justify-content:center;align-items:center;gap:14px;font-size:12px;color:var(--fg-muted);">'
          + '<button class="btn btn-ghost" data-terpag="-1"' + (_terPag <= 1 ? ' disabled' : '') + ' style="height:26px;font-size:11px;">« Anterior</button>'
          + '<span>Página ' + _terPag + ' de ' + totalPag + ' · ' + vis.length + ' tercero' + (vis.length === 1 ? '' : 's') + '</span>'
          + '<button class="btn btn-ghost" data-terpag="1"' + (_terPag >= totalPag ? ' disabled' : '') + ' style="height:26px;font-size:11px;">Siguiente »</button>'
          + '</div></td></tr>';
      }
      const shown = document.getElementById('tercerosShown'); if (shown) shown.textContent = vis.length;
      const totalEl = document.getElementById('tercerosTotal'); if (totalEl) totalEl.textContent = DB.length;
      tbody.querySelectorAll('[data-ver-tercero]').forEach((b) => b.addEventListener('click', () => openFicha(DB[parseInt(b.dataset.verTercero, 10)])));
      tbody.querySelectorAll('[data-borrar-tercero]').forEach((b) =>
        b.addEventListener('click', () => borrarTercero(DB[parseInt(b.dataset.borrarTercero, 10)])));
      tbody.querySelectorAll('[data-terpag]').forEach((b) =>
        b.addEventListener('click', () => render(_terPag + parseInt(b.dataset.terpag, 10))));
      if (window.lucide) window.lucide.createIcons();
    }

    /* Eliminar del directorio.

       No se borra a quien tenga movimiento. Las facturas guardan el tercero
       como texto, así que borrarlo NO las rompe —seguirían mostrando su
       nombre y su RIF— pero desaparecería del desplegable y la próxima
       factura de ese mismo proveedor se escribiría a mano, con otra grafía.
       El duplicado vuelve por donde se fue.

       Así que se cuenta primero, y si tiene movimiento se dice cuánto y no
       se borra. Para lo que sí se puede borrar —una ficha recién creada por
       equivocación, o un duplicado— se pide confirmación con el nombre
       delante, porque el botón está al lado de "Ficha". */
    async function borrarTercero(t) {
      if (!t || !t._id) return;
      if (!window.sb) { toast('No hay sesión activa.', 'error'); return; }
      const rif = normRif(t.rif);
      let usos = 0;
      if (rif) {
        for (const tabla of ['libro_fiscal', 'retenciones', 'movimientos_tesoreria']) {
          const { count } = await window.sb.from(tabla)
            .select('id', { count: 'exact', head: true }).eq('tercero_rif', rif);
          usos += count || 0;
        }
      }
      if (usos) {
        window.openFormModal && window.openFormModal({
          title: 'No se puede eliminar', saveLabel: 'Entendido', fields: [],
          afterRender: (b) => {
            b.innerHTML = '<div style="font-size:13px;line-height:1.6;">'
              + '<strong>' + esc(t.nombre) + '</strong> aparece en <strong>' + usos
              + '</strong> registro' + (usos === 1 ? '' : 's') + ' (libros, retenciones o tesorería).<br><br>'
              + 'Si lo eliminas del directorio esos registros no se pierden —guardan el nombre y el RIF por su cuenta— '
              + 'pero dejaría de aparecer al registrar una factura, y la próxima se escribiría a mano con otra grafía. '
              + 'Si lo que quieres es que no se ofrezca más, quítale los roles de cliente y proveedor en su ficha.</div>';
          },
          onSave: () => {},
        });
        return;
      }
      window.openFormModal && window.openFormModal({
        title: 'Eliminar del directorio', saveLabel: 'Sí, eliminar',
        fields: [],
        afterRender: (b) => {
          b.innerHTML = '<div style="font-size:13px;line-height:1.6;">Se va a eliminar <strong>'
            + esc(t.nombre) + '</strong> (' + esc(rif || 'sin RIF') + ').<br><br>'
            + 'No tiene ningún movimiento registrado, así que no se pierde nada. No se puede deshacer.</div>';
        },
        onSave: () => {
          window.sb.from('terceros').delete().eq('id', t._id).then(({ error }) => {
            if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return; }
            toast('"' + t.nombre + '" eliminado del directorio');
            if (window.cargarTerceros) window.cargarTerceros();
          });
        },
      });
    }
    function updateKPIs() {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('terKpiTotal', DB.length);
      set('terKpiCli', DB.filter((t) => t.cli).length);
      set('terKpiProv', DB.filter((t) => t.prov).length);
      set('terKpiAmbos', DB.filter((t) => t.cli && t.prov).length);
      const nb = document.getElementById('navTercerosBadge'); if (nb) { nb.textContent = DB.length; nb.style.display = DB.length ? '' : 'none'; }
    }

    // Mapea una fila de Supabase a la forma que usa este módulo
    function fromRow(r) {
      return {
        _id: r.id,
        tipo: r.tipo_persona || 'Persona jurídica (J)',
        rif: r.rif || '', nombre: r.nombre || '',
        cli: !!r.es_cliente, prov: !!r.es_proveedor,
        fiscal: r.condicion_fiscal || 'Contribuyente ordinario',
        agenteRet: r.agente_retencion ? 'Sí' : 'No',
        tel: r.telefono || '', email: r.email || '', dom: r.domicilio || '',
        cxc: Number(r.cxc) || 0, cxp: Number(r.cxp) || 0,
        cont: Array.isArray(r.contactos) ? r.contactos : []
      };
    }
    // Carga los terceros reales de la cuenta desde Supabase
    async function cargarTerceros() {
      if (!window.sb) return;
      const { data, error } = await window.sb.from('terceros').select('*').order('nombre');
      if (error) { console.warn('[DigiAccount] No se pudieron cargar terceros:', error.message); return; }
      DB.length = 0;
      (data || []).forEach((r) => DB.push(fromRow(r)));
      console.log('[DigiAccount] Terceros cargados:', DB.length);
      render(); updateKPIs();
      cargarSaldosTerceros();
    }
    window.cargarTerceros = cargarTerceros;
    // Getter para que otros módulos (Fiscal) ofrezcan los terceros como autocompletado
    window.__getTerceros = () => DB.map((t) => ({ id: t._id, nombre: t.nombre, rif: t.rif, cli: t.cli, prov: t.prov, fiscal: t.fiscal, tel: t.tel }));

    // ---- Filtros y búsqueda ----
    document.getElementById('tercerosFilters').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        document.getElementById('tercerosFilters').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        filtroRol = b.dataset.rol; render(1);   // filtrar vuelve a la pagina 1
      });
    });
    const search = document.getElementById('tercerosSearch');
    if (search) search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(1); });

    // ---- Modal: pestañas, roles, contactos ----
    const tabsWrap = document.getElementById('terTabs');
    const panes = overlay.querySelectorAll('.ter-pane');
    function setTab(tab) {
      tabsWrap.querySelectorAll('button').forEach((b) => (b.dataset.active = b.dataset.tab === tab ? 'true' : 'false'));
      panes.forEach((p) => (p.dataset.active = p.dataset.tab === tab ? 'true' : 'false'));
    }
    tabsWrap.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { if (!b.disabled) setTab(b.dataset.tab); }));

    const get = (k) => overlay.querySelector('[data-tk="' + k + '"]');
    function syncRolesTabs() {
      const cli = get('esCliente').checked, prov = get('esProveedor').checked;
      tabsWrap.querySelector('[data-rol="cliente"]').disabled = !cli;
      tabsWrap.querySelector('[data-rol="proveedor"]').disabled = !prov;
    }
    get('esCliente').addEventListener('change', syncRolesTabs);
    get('esProveedor').addEventListener('change', syncRolesTabs);
    // ID del sistema = RIF sin la letra inicial (se actualiza al escribir)
    get('rif').addEventListener('input', () => { const e = get('idsis'); if (e) e.value = idSistema(get('rif').value); });

    // Contactos dinámicos
    const contactsEl = document.getElementById('terContacts');
    function addContact(c) {
      c = c || { n: '', cargo: '', tel: '', email: '' };
      const row = document.createElement('div');
      row.className = 'ter-contact';
      row.innerHTML = '<input type="text" data-c="n" placeholder="Nombre" value="' + (c.n || '') + '">'
        + '<input type="text" data-c="cargo" placeholder="Cargo" value="' + (c.cargo || '') + '">'
        + '<input type="text" data-c="tel" placeholder="Teléfono" value="' + (c.tel || '') + '">'
        + '<input type="text" data-c="email" placeholder="Email" value="' + (c.email || '') + '">'
        + '<button class="ter-cdel" title="Eliminar"><i data-lucide="trash-2"></i></button>';
      row.querySelector('.ter-cdel').addEventListener('click', () => row.remove());
      contactsEl.appendChild(row);
      if (window.lucide) window.lucide.createIcons();
    }
    document.getElementById('terAddContact').addEventListener('click', () => addContact());

    // 🤖 Lector de RIF (Asistente IA · gratis): al adjuntar el RIF de un cliente/proveedor,
    // llena tipo, RIF, nombre, condición fiscal y domicilio. El usuario revisa antes de guardar.
    const terOcrBox = document.getElementById('terOcrBox');
    const terRifFile = document.getElementById('terRifFile');
    const terRifBtn = document.getElementById('terRifBtn');
    function resetTerOcr() {
      if (!terOcrBox) return;
      terOcrBox.classList.remove('loading', 'done');
      terOcrBox.querySelector('.ter-ocr-txt strong').textContent = '¿Tienes el RIF a la mano?';
      terOcrBox.querySelector('.ter-ocr-txt span').textContent = 'Adjúntalo (PDF o foto) y el Asistente IA llena los datos.';
      if (terRifFile) terRifFile.value = '';
    }
    const TIPO_POR_LETRA = { J: 'Persona jurídica (J)', V: 'Persona natural · Venezolano (V)', E: 'Persona natural · Extranjero (E)', G: 'Ente gubernamental (G)', P: 'Pasaporte (P)', C: 'Consejo comunal (C)' };
    async function leerRifTercero() {
      const file = terRifFile && terRifFile.files && terRifFile.files[0];
      if (!file || !window.__ocrRif) return;
      const setTxt = (a, b) => { terOcrBox.querySelector('.ter-ocr-txt strong').textContent = a; terOcrBox.querySelector('.ter-ocr-txt span').textContent = b; };
      terOcrBox.classList.remove('done'); terOcrBox.classList.add('loading');
      setTxt('🤖 Leyendo el RIF…', 'El Asistente IA está leyendo ' + file.name + '.');
      if (window.lucide) window.lucide.createIcons();
      const d = await window.__ocrRif(file);
      terOcrBox.classList.remove('loading'); terOcrBox.classList.add('done');
      if (!d || !d.ok) { setTxt('No se pudo leer el RIF', (d && d.error ? d.error + ' — ' : '') + 'complétalo a mano.'); return; }
      const letra = (d.rif || '').charAt(0).toUpperCase();
      if (TIPO_POR_LETRA[letra]) get('tipo').value = TIPO_POR_LETRA[letra];
      if (d.rif) { get('rif').value = d.rif; const e = get('idsis'); if (e) e.value = idSistema(d.rif); }
      if (d.razon_social) get('nombre').value = d.razon_social;
      if (d.domicilio) get('dom').value = d.domicilio;
      if (d.condicion) get('fiscalCond').value = d.condicion === 'especial' ? 'Contribuyente especial' : 'Contribuyente ordinario';
      const conf = d.confianza != null ? ' · certeza ' + Math.round(d.confianza * 100) + '%' : '';
      setTxt('🤖 RIF leído ✓' + conf, 'Datos cargados: revisa y marca si es cliente, proveedor o ambos.');
      toast('🤖 RIF leído' + (d.razon_social ? ' · ' + d.razon_social : ''), 'success');
    }
    if (terRifBtn) terRifBtn.addEventListener('click', () => terRifFile.click());
    if (terRifFile) terRifFile.addEventListener('change', () => { if (terRifFile.files && terRifFile.files.length) leerRifTercero(); });

    let editIdx = null;
    function openFicha(t) {
      editIdx = t ? DB.indexOf(t) : null;
      resetTerOcr();
      document.getElementById('terModalTitle').textContent = t ? t.nombre : 'Nuevo tercero';
      document.getElementById('terMsg').textContent = '';
      const setV = (k, v) => { const e = get(k); if (e) e.value = v; };
      setV('tipo', (t && t.tipo) || 'Persona jurídica');
      setV('rif', (t && t.rif) || '');
      setV('idsis', idSistema(t && t.rif));
      setV('nombre', (t && t.nombre) || '');
      get('esCliente').checked = !!(t && t.cli);
      get('esProveedor').checked = !!(t && t.prov);
      setV('tel', (t && t.tel) || ''); setV('email', (t && t.email) || ''); setV('dom', (t && t.dom) || '');
      setV('fiscalCond', (t && t.fiscal) || 'Contribuyente ordinario');
      setV('agenteRet', (t && t.agenteRet) || 'No');
      const out = (k, v) => { const e = overlay.querySelector('[data-tk-out="' + k + '"]'); if (e) e.textContent = v; };
      out('saldoCxc', 'Bs ' + fmt((t && t.cxc) || 0));
      out('saldoCxp', 'Bs ' + fmt((t && t.cxp) || 0));
      contactsEl.innerHTML = '';
      ((t && t.cont) || []).forEach(addContact);
      syncRolesTabs();
      setTab('general');
      overlay.hidden = false;
      if (window.lucide) window.lucide.createIcons();
    }
    function close() { overlay.hidden = true; window.__terOnSavedOnce = null; }
    document.getElementById('nuevoTerceroBtn').addEventListener('click', () => openFicha(null));
    document.getElementById('terClose').addEventListener('click', close);
    document.getElementById('terCancel').addEventListener('click', close);
    // Clic fuera del cuadro NO cierra (evita perder el registro por accidente). Usa Cancelar o la X.

    document.getElementById('terSave').addEventListener('click', () => {
      const msg = document.getElementById('terMsg');
      const setMsg = (m) => { msg.textContent = m; msg.classList.add('error'); };
      msg.classList.remove('error'); msg.textContent = '';
      const nombre = get('nombre').value.trim().toUpperCase();
      const rif = normRif(get('rif').value); // RIF sin guiones (formato SENIAT)
      const cli = get('esCliente').checked, prov = get('esProveedor').checked;
      if (!nombre) return setMsg('Indica la razón social o nombre.');
      if (!rif) return setMsg('El RIF / C.I. es obligatorio.');
      if (!cli && !prov) return setMsg('Marca al menos un rol: cliente o proveedor.');
      // Detección de duplicados por RIF (solo al crear nuevo)
      const dup = DB.find((x, i) => normRif(x.rif) === normRif(rif) && i !== editIdx);
      if (dup) return setMsg('Ya existe un tercero con ese RIF: "' + dup.nombre + '". Abre su ficha para añadirle el rol y evitar duplicados.');
      const cont = [...contactsEl.querySelectorAll('.ter-contact')].map((r) => ({
        n: r.querySelector('[data-c="n"]').value.trim(), cargo: r.querySelector('[data-c="cargo"]').value.trim(),
        tel: r.querySelector('[data-c="tel"]').value.trim(), email: r.querySelector('[data-c="email"]').value.trim(),
      })).filter((c) => c.n);
      if (!window.sb || !window.__CUENTA_ID) return setMsg('No hay sesión activa. Inicia sesión de nuevo.');
      const fila = {
        cuenta_id: window.__CUENTA_ID,
        tipo_persona: get('tipo').value,
        rif: rif, nombre: nombre,
        es_cliente: cli, es_proveedor: prov,
        condicion_fiscal: get('fiscalCond').value,
        agente_retencion: !!(get('agenteRet') && get('agenteRet').value === 'Sí'),
        telefono: get('tel').value.trim(), email: get('email').value.trim(),
        domicilio: get('dom').value.trim().toUpperCase(),
        contactos: cont,
      };
      /* Un solo guardado a la vez.

         La comprobación de duplicados de arriba mira `DB`, la lista que ya
         está en memoria, y el segundo clic llega ANTES de que esa lista se
         refresque: los dos pasan la comprobación y entran los dos. Así quedó
         "INVERSIONES MADERERA ALIBETZ, C.A." dos veces, con el mismo RIF y
         creada en el mismo segundo.

         El índice único de la base es lo que de verdad lo impide —hay más
         caminos que esta pantalla—; esto evita el viaje de ida y el mensaje
         de error feo. */
      const btn = document.getElementById('terSave');
      if (btn.dataset.guardando === 'true') return;
      btn.dataset.guardando = 'true';
      btn.disabled = true;
      const rotuloBtn = btn.textContent;
      btn.textContent = 'Guardando…';
      const soltar = () => {
        btn.dataset.guardando = 'false';
        btn.disabled = false;
        btn.textContent = rotuloBtn;
      };
      const accion = (editIdx != null && DB[editIdx] && DB[editIdx]._id)
        ? window.sb.from('terceros').update(fila).eq('id', DB[editIdx]._id)
        : window.sb.from('terceros').insert(fila);
      accion.then(({ error }) => {
        soltar();
        if (error) {
          // 23505 = el índice único de la base. Pasa cuando el tercero se
          // creó desde otra pestaña o por la carga masiva mientras esta
          // ficha estaba abierta: el mensaje tiene que decir qué hacer.
          setMsg(error.code === '23505'
            ? 'Ya existe un tercero con el RIF ' + rif + ' en esta cuenta. Ciérralo, búscalo en la lista y añádele el rol que falte.'
            : 'No se pudo guardar: ' + error.message);
          return;
        }
        toast('Tercero "' + nombre + '" ' + (editIdx != null ? 'actualizado' : 'registrado'));
        if (window.cargarTerceros) window.cargarTerceros();
        const cb = window.__terOnSavedOnce;
        close();
        if (cb) cb({ nombre: nombre, rif: rif });
      });
    });

    // Exportar CSV
    document.getElementById('tercerosExportBtn').addEventListener('click', () => {
      const rows = [['Nombre', 'RIF', 'Tipo', 'Rol', 'Condición fiscal', 'Teléfono', 'Email', 'CxC', 'CxP']];
      DB.forEach((t) => rows.push([t.nombre, t.rif, t.tipo, rolDe(t), t.fiscal, t.tel, t.email, t.cxc, t.cxp]));
      const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Terceros.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast('Directorio de terceros exportado a CSV');
    });

    // Clientes disponibles para emitir facturas (lo usa el módulo de Ventas)
    window.__clientes = () => DB.filter((t) => t.cli).map((t) => ({ n: t.nombre, rif: t.rif, id: idSistema(t.rif), dom: t.dom }));
    // Abrir la ficha de un nuevo tercero (opcionalmente premarcado como cliente/proveedor,
    // con el nombre ya escrito, y un aviso onSaved(t) para cuando quien lo abrió necesita
    // enterarse — p. ej. un formulario de venta/compra que se autocompleta al crearlo).
    window.openNuevoTercero = function (preset) {
      openFicha(null);
      if (preset && preset.nombre) { const el = get('nombre'); if (el) el.value = preset.nombre; }
      if (preset && preset.cliente) get('esCliente').checked = true;
      if (preset && preset.proveedor) get('esProveedor').checked = true;
      if (preset && (preset.cliente || preset.proveedor)) syncRolesTabs();
      setTab('general');
      window.__terOnSavedOnce = (preset && preset.onSaved) || null;
      const rifEl = get('rif'); if (rifEl) rifEl.focus();
    };

    render(); updateKPIs();
    cargarTerceros();
  })();
})();
