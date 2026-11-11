/* =========================================================
   DigiAccount ERP — CONTABILIDAD
   Los asientos y el libro diario, el plan de cuentas, los activos fijos
   y el ejercicio: de ahi salen el balance y la utilidad neta.

   Solo usaba un nombre privado del bloque grande —`drawIcons`—, que ya
   vive en el nucleo.

   Se carga DESPUES de app.js: lo que expone —el balance, la utilidad
   neta, el diario del mes y el asiento— lo consumen el panel y el
   modulo fiscal
   a traves de `window.*`, y lo que necesita de ellos tambien.
   ========================================================= */
(function () {
  'use strict';

  // Los nombres cortos que usa el cuerpo, apuntando al nucleo.
  const drawIcons = window.__drawIcons;

  /* =========================================================
     CONTABILIDAD — acciones (nuevo asiento, cuenta, activo, exportar, etc.)
     ========================================================= */
  (function contaActions() {
    const view = document.getElementById('view-contabilidad');
    if (!view) return;
    const fmt2 = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const csvDownload = (rows, name) => {
      const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // Helper unificado de impresión de documentos contables (orientación por estado)
    function printContaDoc(sourceEl, opts) {
      if (!sourceEl) return;
      opts = opts || {};
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const doc = document.createElement('div');
      doc.className = 'conta-print';
      if (!opts.noHead) {
        doc.innerHTML = '<div class="cp-head"><div class="cp-co">' + (((window.__EMPRESA_ACTIVA || {}).n) || '—') + ' · RIF ' + (((window.__EMPRESA_ACTIVA || {}).rif) || '—') + '</div>'
          + '<div class="cp-title">' + (opts.titulo || '') + '</div>'
          + '<div class="cp-sub">' + (opts.sub || ((window.__ejercicioInfo ? window.__ejercicioInfo().label : 'Ejercicio') + ' · Expresado en bolívares (Bs)')) + '</div></div>';
      }
      const clone = sourceEl.cloneNode(true);
      clone.classList.remove('conta-tab');
      clone.removeAttribute('data-active');
      // Quitar controles y bloques que no van en el PDF
      clone.querySelectorAll('.fin-actions, .table-toolbar, .table-footer, .quick-search, .pager, .fin-highlights, .recon-status-bar, button').forEach((e) => e.remove());
      doc.appendChild(clone);
      portal.appendChild(doc);
      // Orientación: vertical (portrait) u horizontal (landscape)
      if (window.__setPageSize) window.__setPageSize(opts.orient === 'landscape' ? 'letter landscape' : 'letter portrait', '12mm');
      document.body.classList.add('printing-comp');
      drawIcons();
      window.print();
    }

    // Lista de cuentas (combina el árbol del Mayor y el Plan de Cuentas, sin grupos)
    function getCuentas() {
      const map = new Map();
      view.querySelectorAll('.account-tree .acc-item').forEach((it) => {
        const code = (it.querySelector('.code') || {}).textContent || '';
        const name = (it.querySelector('.nm') || {}).textContent || '';
        if (code) map.set(code.trim(), code.trim() + ' · ' + name.trim());
      });
      const tbody = view.querySelector('.conta-tab[data-tab="plan"] table.data-table tbody');
      if (tbody) tbody.querySelectorAll('tr').forEach((tr) => {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 3) return;
        const code = tds[0].textContent.trim();
        const tipo = tds[2].textContent || '';
        if (/grupo/i.test(tipo) || !code.includes('.')) return;
        map.set(code, code + ' · ' + tds[1].textContent.replace(/ /g, '').trim());
      });
      return Array.from(map.values()).sort().map((v) => ({ value: v, label: v }));
    }

    // ---- Nuevo asiento (partida doble) ----
    let asientoNum = 313;
    let asientosData = [];   // asientos cargados desde Supabase (para Mayor y Balance)
    let _cargaAsientos = 0;  // cuántas veces se cargaron (el cuadre con la F30 se vuelve a pedir al recargar)
    let activosData = [];    // activos fijos cargados desde Supabase
    // ===== Modal de asiento (partida doble multi-línea) =====
    (function asientoModal() {
      const overlay = document.getElementById('asientoModal');
      const nuevoAsiento = document.getElementById('nuevoAsientoBtn');
      if (!overlay || !nuevoAsiento) return;
      const linesEl = document.getElementById('amLines');
      const totDebeEl = document.getElementById('amTotDebe');
      const totHaberEl = document.getElementById('amTotHaber');
      const cuadreEl = document.getElementById('amCuadre');
      const msgEl = document.getElementById('amMsg');
      const split = (s) => { const i = s.indexOf(' · '); return i < 0 ? { c: '—', n: s } : { c: s.slice(0, i), n: s.slice(i + 3) }; };

      // Lista de autocompletado de cuentas (se busca por código o por nombre al escribir)
      function buildDatalist() {
        let dl = document.getElementById('amCuentasList');
        if (!dl) { dl = document.createElement('datalist'); dl.id = 'amCuentasList'; overlay.appendChild(dl); }
        dl.innerHTML = getCuentas().map((o) => '<option value="' + o.value.replace(/"/g, '&quot;') + '"></option>').join('');
      }
      function addLine(tipo) {
        const row = document.createElement('div');
        row.className = 'am-line';
        row.innerHTML = '<input class="am-cta" list="amCuentasList" placeholder="Código o nombre de la cuenta…" autocomplete="off">'
          + '<input type="number" class="am-debe" step="0.01" placeholder="0,00"' + (tipo === 'haber' ? ' disabled' : '') + '>'
          + '<input type="number" class="am-haber" step="0.01" placeholder="0,00"' + (tipo === 'debe' ? ' disabled' : '') + '>'
          + '<button class="am-del" title="Eliminar línea"><i data-lucide="trash-2"></i></button>';
        linesEl.appendChild(row);
        // Al escribir en un lado, se bloquea el otro (una cuenta es debe o haber)
        const deb = row.querySelector('.am-debe'), hab = row.querySelector('.am-haber');
        deb.addEventListener('input', () => { hab.disabled = parseFloat(deb.value) > 0; recalc(); });
        hab.addEventListener('input', () => { deb.disabled = parseFloat(hab.value) > 0; recalc(); });
        row.querySelector('.am-del').addEventListener('click', () => { row.remove(); recalc(); });
        drawIcons();
      }
      function recalc() {
        let d = 0, h = 0;
        linesEl.querySelectorAll('.am-line').forEach((r) => {
          d += parseFloat(r.querySelector('.am-debe').value) || 0;
          h += parseFloat(r.querySelector('.am-haber').value) || 0;
        });
        totDebeEl.textContent = fmt2(d);
        totHaberEl.textContent = fmt2(h);
        const ok = d > 0 && Math.abs(d - h) < 0.009;
        cuadreEl.innerHTML = ok ? '<i data-lucide="check-circle-2"></i> Partida cuadrada'
          : '<i data-lucide="alert-circle"></i> Diferencia: Bs ' + fmt2(Math.abs(d - h));
        cuadreEl.className = 'am-cuadre ' + (ok ? 'ok' : 'bad');
        drawIcons();
      }
      function open() {
        linesEl.innerHTML = '';
        document.getElementById('amRef').value = '';
        document.getElementById('amDesc').value = '';
        msgEl.textContent = '';
        buildDatalist();
        addLine('debe'); addLine('haber');
        recalc();
        overlay.hidden = false;
        drawIcons();
      }
      function close() { overlay.hidden = true; }
      nuevoAsiento.addEventListener('click', open);
      document.getElementById('amClose').addEventListener('click', close);
      document.getElementById('amCancel').addEventListener('click', close);
      // Clic fuera NO cierra (evita perder datos del formulario). Usa Cancelar o la X.
      document.getElementById('amAddLine').addEventListener('click', () => addLine());

      document.getElementById('amSave').addEventListener('click', () => {
        const desc = document.getElementById('amDesc').value.trim();
        const ref = document.getElementById('amRef').value.trim();
        const fechaRaw = document.getElementById('amFecha').value;
        const lineas = [];
        let totD = 0, totH = 0, faltaCuenta = false;
        linesEl.querySelectorAll('.am-line').forEach((r) => {
          const cta = r.querySelector('.am-cta').value;
          const d = parseFloat(r.querySelector('.am-debe').value) || 0;
          const h = parseFloat(r.querySelector('.am-haber').value) || 0;
          if (d <= 0 && h <= 0) return;
          if (!cta || cta.indexOf(' · ') < 0) { faltaCuenta = true; return; }
          lineas.push({ cta: cta, d: d, h: h });
          totD += d; totH += h;
        });
        const setMsg = (m) => { msgEl.textContent = m; msgEl.classList.add('error'); };
        if (!desc) return setMsg('Indica la descripción del asiento.');
        if (lineas.length < 2) return setMsg('El asiento requiere al menos dos líneas con monto.');
        if (faltaCuenta) return setMsg('Hay líneas con monto pero sin cuenta seleccionada.');
        if (Math.abs(totD - totH) > 0.009) return setMsg('El asiento no cuadra: Debe ' + fmt2(totD) + ' ≠ Haber ' + fmt2(totH) + '.');
        if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return setMsg('No hay sesión o empresa activa. Selecciona una empresa arriba.');
        const fecha = fechaRaw ? fechaRaw.split('-').reverse().join('/') : '';
        const lineasDB = lineas.map((l) => ({ cta: l.cta, debe: l.d, haber: l.h }));
        window.sb.from('asientos').insert({
          cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
          fecha: fecha, descripcion: desc, referencia: ref, origen: 'manual',   // el número lo pone la base
          lineas: lineasDB, total: totD,
        }).select('numero').single().then(({ data: guardado, error }) => {
          if (error) { setMsg('No se pudo guardar: ' + error.message); return; }
          toast('Asiento #0' + ((guardado && guardado.numero) || '') + ' registrado · ' + lineas.length + ' líneas · cuadra en Bs ' + fmt2(totD));
          if (window.cargarAsientos) window.cargarAsientos();
          close();
        });
      });

      // Pinta un asiento (registro de Supabase) como bloque del Libro Diario
      function asientoHTML(a) {
        const lineas = Array.isArray(a.lineas) ? a.lineas : [];
        const rows = lineas.map((l) => {
          const s = split(l.cta); const d = Number(l.debe) || 0, h = Number(l.haber) || 0; const esHaber = h > 0;
          return '<tr><td class="acc-code">' + s.c + '</td><td class="acc-name' + (esHaber ? ' haber-indent' : '') + '">' + s.n + '</td>'
            + '<td class="deb' + (d ? '' : ' zero') + '">' + (d ? fmt2(d) : '—') + '</td>'
            + '<td class="haber' + (h ? '' : ' zero') + '">' + (h ? fmt2(h) : '—') + '</td></tr>';
        }).join('');
        const tot = Number(a.total) || 0;
        return '<div class="asiento"><div class="asiento-head">'
          + '<span class="asiento-num">#0' + a.numero + '</span>'
          + '<span class="asiento-date"><i data-lucide="calendar"></i> ' + (a.fecha || '') + '</span>'
          + '<span style="flex:1"></span>'
          + '<span class="asiento-ref">Ref: ' + (a.referencia || '—') + '</span>'
          + '<span class="asiento-origin manual"><i data-lucide="pencil"></i> ' + (a.origen === 'manual' ? 'Manual' : (a.origen || 'Manual')) + '</span></div>'
          + '<table class="ledger-lines"><tbody>' + rows
          + '</tbody><tfoot><tr class="asiento-foot"><td colspan="2" class="total-label">Sumas iguales</td><td class="deb">' + fmt2(tot) + '</td><td class="haber">' + fmt2(tot) + '</td></tr></tfoot></table>'
          + '<div class="asiento-glosa"><strong>Concepto:</strong> ' + (a.descripcion || '') + '</div></div>';
      }
      // Carga los asientos reales de la empresa activa desde Supabase. El Diario
      // muestra los del período de la barra común de reportes, 10 por página.
      let _diarioPage = 1;
      async function cargarAsientos(page) {
        if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return;
        const journal = view.querySelector('.conta-tab[data-tab="diario"] .journal');
        if (!journal) return;
        const empId = window.__EMPRESA_ACTIVA.id;
        const { data, error } = await window.__sbAll((q) => q.eq('empresa_id', empId).order('numero', { ascending: false }), 'asientos', '*');
        if (error) { console.warn('[DigiAccount] No se pudieron cargar asientos:', error.message); return; }
        if (!window.__EMPRESA_ACTIVA || window.__EMPRESA_ACTIVA.id !== empId) return;   // se cambió de empresa mientras cargaba
        let maxNum = 0;
        (data || []).forEach((a) => { if (a.numero > maxNum) maxNum = a.numero; });
        asientoNum = maxNum;
        asientosData = data || [];
        _cargaAsientos++;
        // Otra empresa: el período arranca en el mes de su último asiento.
        if (_rep.empresa !== empId) {
          _rep.empresa = empId;
          _rep.ancla = ultimaFechaAsientos() || (window.__hoyISO ? window.__hoyISO() : '');
          if (window.__pintarBarraReportes) window.__pintarBarraReportes();
        }
        pintarPeriodo(page);
        console.log('[DigiAccount] Asientos cargados:', asientosData.length);
      }
      window.cargarAsientos = cargarAsientos;
      // Repinta el Diario y los reportes con el período de la barra (sin volver a la base).
      function pintarPeriodo(page) {
        const journal = view.querySelector('.conta-tab[data-tab="diario"] .journal');
        if (!journal) return;
        journal.innerHTML = '';
        const r = _rango();
        const delMes = (asientosData || []).filter((a) => { const f = fechaAsientoISO(a.fecha); return r.desde === '' || (f && f >= r.desde && f <= r.hasta); })
          .sort((a, b) => { const fa = fechaAsientoISO(a.fecha), fb = fechaAsientoISO(b.fecha); return fa < fb ? -1 : fa > fb ? 1 : (a.numero || 0) - (b.numero || 0); });
        const DIARIO_PAG = 10;
        const totalPagD = Math.max(1, Math.ceil(delMes.length / DIARIO_PAG));
        _diarioPage = Math.min(Math.max(1, page || _diarioPage || 1), totalPagD);
        const iniD = (_diarioPage - 1) * DIARIO_PAG;
        if (!delMes.length) journal.innerHTML = '<div style="text-align:center;color:var(--fg-muted);padding:32px;">Sin asientos en el período seleccionado.</div>';
        delMes.slice(iniD, iniD + DIARIO_PAG).forEach((a) => journal.insertAdjacentHTML('beforeend', asientoHTML(a)));
        if (totalPagD > 1) {
          journal.insertAdjacentHTML('beforeend', '<div style="display:flex;justify-content:center;align-items:center;gap:14px;padding:10px;font-size:12px;color:var(--fg-muted);">'
            + '<button class="btn btn-ghost" data-dp-dir="-1"' + (_diarioPage <= 1 ? ' disabled' : '') + ' style="height:26px;font-size:11px;">« Anterior</button>'
            + '<span>Página ' + _diarioPage + ' de ' + totalPagD + ' · ' + delMes.length + ' asientos</span>'
            + '<button class="btn btn-ghost" data-dp-dir="1"' + (_diarioPage >= totalPagD ? ' disabled' : '') + ' style="height:26px;font-size:11px;">Siguiente »</button></div>');
        }
        window.__diarioDelMes = delMes; // para imprimir y exportar el período visible
        if (typeof renderReportes === 'function') renderReportes();   // recalcula Mayor, Balance y estados
        // KPIs de la cabecera de Contabilidad (datos reales)
        const totDebe = delMes.reduce((s, a) => s + (Number(a.total) || 0), 0);
        const ctas = new Set();
        asientosData.forEach((a) => { (Array.isArray(a.lineas) ? a.lineas : []).forEach((l) => { const c = (l.cta || '').split(' · ')[0]; if (c) ctas.add(c); }); });
        const setC = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        setC('contaKpiAsientos', String(asientosData.length));
        setC('contaKpiDebe', fmt2(totDebe));
        setC('contaKpiHaber', fmt2(totDebe));
        setC('contaKpiCuentas', String(ctas.size));
        setC('contaDiarioCount', String(delMes.length));
        setC('contaMovMes', 'Bs ' + fmt2(totDebe));
        drawIcons();
      }
      window.__repintarPeriodo = pintarPeriodo;
      // Datos para imprimir el Libro Diario del período (todos los asientos, sin paginar)
      window.__diarioPrintData = () => {
        const arr = window.__diarioDelMes || [];
        return { html: arr.map(asientoHTML).join(''), titulo: 'Libro Diario · ' + _rango().etiqueta, sub: periodoTexto() + ' · Expresado en bolívares (Bs)' };
      };
      view.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-dp-dir]');
        if (b && !b.disabled) pintarPeriodo(_diarioPage + parseInt(b.dataset.dpDir, 10));
      });
    })();

    // Ayudante reutilizable: cualquier módulo puede generar un asiento contable (depreciación, cripto, etc.)
    /* El número lo pone la base (trg_asiento_numero): calcularlo aquí chocaba
       cuando dos asientos entraban a la vez. La fecha es dd/mm/aaaa; si no se
       pasa, la de hoy según el reloj del equipo (no la UTC, que pasadas las
       8 p. m. en Venezuela ya es mañana). Las filas del libro fiscal NO pasan por aquí: su asiento lo
       hace la base (sql/contabilidad_04_motor.sql). */
    window.__postAsiento = async function (descripcion, referencia, lineas, origen, fecha) {
      if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return { error: { message: 'No hay una empresa activa' } };
      const total = (lineas || []).reduce((s, l) => s + (Number(l.debe) || 0), 0);
      if (!fecha) { const p = window.__hoyISO().split('-'); fecha = p[2] + '/' + p[1] + '/' + p[0]; }
      const res = await window.sb.from('asientos').insert({
        cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
        fecha: fecha, descripcion: descripcion, referencia: referencia || '', origen: origen || 'auto',
        lineas: lineas, total: total,
      });
      if (!res.error && window.cargarAsientos) await window.cargarAsientos();
      return res;
    };

    // ---- Nueva cuenta (ubicación amigable por cuenta padre) ----
    const nuevaCuenta = document.getElementById('nuevaCuentaBtn');
    function getCuentasPlan() {
      const tbody = view.querySelector('.conta-tab[data-tab="plan"] table.data-table tbody');
      const arr = [];
      if (tbody) tbody.querySelectorAll('tr').forEach((tr) => {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 2) return;
        const code = tds[0].textContent.trim();
        const name = (tds[1].textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
        if (code) arr.push({ code: code, name: name, tr: tr });
      });
      return arr;
    }
    if (nuevaCuenta) nuevaCuenta.addEventListener('click', () => {
      const plan = getCuentasPlan();
      const opciones = [{ value: '__raiz__', label: '◆ Raíz · nuevo grupo principal' }]
        .concat(plan.map((c) => ({ value: c.code, label: c.code + ' · ' + c.name })));
      window.openFormModal({
        title: 'Nueva cuenta contable',
        saveLabel: 'Crear cuenta',
        fields: [
          { name: 'padre', label: 'Ubicar dentro de (cuenta padre)', col: 2, type: 'select', options: opciones },
          { name: 'nombre', label: 'Nombre de la cuenta', col: 2, placeholder: 'Ej. Inventario de mercancías' },
          { name: 'tipo', label: 'Tipo', type: 'select', options: ['Cuenta', 'Subcuenta', 'Grupo'] },
          { name: 'nat', label: 'Naturaleza', type: 'select', options: ['(Heredar del padre)', 'Deudora', 'Acreedora'] },
          { name: 'cod', label: 'Código (auto si se deja vacío)', col: 2, placeholder: 'Se genera bajo la cuenta padre' },
          { name: 'nota', label: ' ', col: 2, type: 'static', html: '<div style="font-size:12px;color:var(--fg-muted);line-height:1.5;">La cuenta se insertará <strong>debajo de la cuenta padre</strong>, con su código y sangría según el nivel. El código se autogenera a partir del padre si lo dejas vacío.</div>' },
        ],
        onSave: (v) => {
          if (!v.nombre) return 'El nombre de la cuenta es obligatorio.';
          const tbody = view.querySelector('.conta-tab[data-tab="plan"] table.data-table tbody');
          if (!tbody) return;
          const esRaiz = v.padre === '__raiz__';
          // Código: usar el indicado o autogenerar bajo el padre
          let cod = (v.cod || '').trim();
          if (!cod) {
            if (esRaiz) {
              const maxRaiz = Math.max(0, ...plan.filter((c) => /^\d+$/.test(c.code)).map((c) => parseInt(c.code, 10)));
              cod = String(maxRaiz + 1);
            } else {
              const hijos = plan.filter((c) => c.code.indexOf(v.padre + '.') === 0 && c.code.split('.').length === v.padre.split('.').length + 1);
              const next = String(hijos.length + 1).padStart(2, '0');
              cod = v.padre + '.' + next;
            }
          }
          // Naturaleza: heredar del padre (por primer dígito) o la indicada
          let nat = v.nat;
          if (nat === '(Heredar del padre)') {
            const raiz = (esRaiz ? cod : v.padre).charAt(0);
            nat = ['1', '5', '6'].includes(raiz) ? 'Deudora' : 'Acreedora';
          }
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          window.sb.from('cuentas_contables').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
            codigo: cod, nombre: v.nombre, tipo: v.tipo, naturaleza: nat,
          }).then(({ error }) => {
            if (error) { toast('No se pudo guardar la cuenta: ' + error.message, 'error'); return; }
            if (window.cargarCuentasContables) window.cargarCuentasContables();
            toast('Cuenta ' + cod + ' creada' + (esRaiz ? ' como grupo principal' : ' bajo ' + v.padre));
          });
        },
      });
    });

    /* ---- Plan de cuentas: viene completo de la base ----
       La base (plan_cuentas_base, una para todos) más las cuentas propias de
       la empresa (cuentas_contables). Antes la base eran filas fijas dentro de
       index.html, y la base de datos no podía nombrar las cuentas de los
       asientos que genera ella misma. data-uso marca en qué cuentas se puede
       clasificar una compra (costo, gasto, activo fijo). */
    function filaCuenta(c) {
      const esc = window.__esc || ((s) => String(s == null ? '' : s));
      const tagTipo = c.tipo === 'Grupo' ? 'navy' : 'slate';
      const nivel = (c.codigo || '').split('.').length - 1;
      const indent = '&nbsp;'.repeat(nivel * 3);
      const estado = c.propia ? '<span class="tag cyan">Propia</span>' : '<span class="tag success">Activa</span>';
      return '<tr' + (c.propia ? ' data-custom="1"' : '') + (c.uso ? ' data-uso="' + esc(c.uso) + '"' : '') + '>'
        + '<td class="mono">' + esc(c.codigo) + '</td><td class="primary">' + indent + esc(c.nombre) + '</td>'
        + '<td><span class="tag ' + tagTipo + '">' + esc(c.tipo || 'Cuenta') + '</span></td><td>' + esc(c.naturaleza) + '</td>'
        + '<td class="num">0,00</td><td>' + estado + '</td></tr>';
    }
    async function cargarCuentasContables() {
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return;
      const tbody = view.querySelector('.conta-tab[data-tab="plan"] table.data-table tbody');
      if (!tbody) return;
      const { data, error } = await window.sb.rpc('plan_de_empresa', { p_empresa: window.__EMPRESA_ACTIVA.id });
      if (error) {
        console.warn('[DigiAccount] No se pudo cargar el plan de cuentas:', error.message);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--fg-muted);padding:14px;">No se pudo cargar el plan de cuentas.</td></tr>';
        return;
      }
      tbody.innerHTML = (data || []).map(filaCuenta).join('');
      _clasificables = (data || []).filter((c) => c.uso && c.tipo !== 'Grupo').map((c) => ({ codigo: c.codigo, nombre: c.nombre, uso: c.uso }));
      _efectivo = (data || []).filter((c) => String(c.codigo).indexOf('1.1.1.') === 0 && c.tipo !== 'Grupo').map((c) => ({ codigo: c.codigo, nombre: c.nombre }));
      if (window.refreshTables) window.refreshTables();
      drawIcons();
    }
    // Cuentas en que se puede clasificar una compra (costo, gasto o activo
    // fijo): las usan la ficha del proveedor y el registro de compras.
    let _clasificables = [];
    window.__cuentasClasificables = () => _clasificables.slice();
    // Cuentas de efectivo y bancos (grupo 1.1.1, incluidas las subcuentas
    // propias de cada banco): de dónde salió el pago de un impuesto.
    let _efectivo = [];
    window.__cuentasEfectivo = () => _efectivo.slice();
    window.cargarCuentasContables = cargarCuentasContables;

    // ======= REPORTES: Diario, Mayor, Comprobación, Resultados, Balance General y Flujo =======
    /* Todos salen SOLO de los asientos guardados (spec §7), con una barra común:
       período (Todo, Día, Semana, Mes, Año, con flechas) y nivel (1 Detalle,
       2 Cuenta, 3 Grupo, 4 Clase). Las funciones de cálculo son puras (sin DOM)
       y se prueban en herramientas/pruebas/correr.js. */
    const parseCta = (s) => { const i = (s || '').indexOf(' · '); return i < 0 ? { c: '—', n: s || '' } : { c: s.slice(0, i), n: s.slice(i + 3) }; };
    const _pad2 = (n) => String(n).padStart(2, '0');
    // Fecha de un asiento (dd/mm/aa o dd/mm/aaaa) → 'aaaa-mm-dd'; '' si no se entiende.
    function fechaAsientoISO(f) {
      const n = window.__normFecha ? window.__normFecha(f) : null;
      if (!n) return '';
      const p = n.split('/');
      return '20' + p[2] + '-' + p[1] + '-' + p[0];
    }
    const _MESES_R = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const _isoDe = (dt) => dt.getFullYear() + '-' + _pad2(dt.getMonth() + 1) + '-' + _pad2(dt.getDate());
    const _dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
    const _partes = (iso) => iso.split('-').map((x) => parseInt(x, 10));
    /* El rango [desde, hasta] (ISO, inclusive) de un período. 'todo' no tiene
       límite inferior. La semana va de lunes a domingo. */
    function rangoPeriodo(tipo, ancla) {
      if (tipo === 'todo' || !ancla) return { desde: '', hasta: '9999-12-31', etiqueta: 'Todo el registro' };
      const [y, m, d] = _partes(ancla);
      if (tipo === 'dia') return { desde: ancla, hasta: ancla, etiqueta: _dmy(ancla) };
      if (tipo === 'semana') {
        const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
        const ini = _isoDe(new Date(y, m - 1, d - dow)), fin = _isoDe(new Date(y, m - 1, d - dow + 6));
        return { desde: ini, hasta: fin, etiqueta: 'Semana del ' + _dmy(ini) + ' al ' + _dmy(fin) };
      }
      if (tipo === 'anio') return { desde: y + '-01-01', hasta: y + '-12-31', etiqueta: 'Año ' + y };
      return { desde: y + '-' + _pad2(m) + '-01', hasta: _isoDe(new Date(y, m, 0)), etiqueta: _MESES_R[m - 1] + ' ' + y };
    }
    // La flecha: el mismo período, uno antes (-1) o uno después (+1).
    function moverAncla(tipo, ancla, dir) {
      const [y, m, d] = _partes(ancla);
      if (tipo === 'dia') return _isoDe(new Date(y, m - 1, d + dir));
      if (tipo === 'semana') return _isoDe(new Date(y, m - 1, d + 7 * dir));
      if (tipo === 'anio') return _isoDe(new Date(y + dir, 0, 1));
      return _isoDe(new Date(y, m - 1 + dir, 1));
    }
    // Nivel → segmentos del código a los que se enrolla (0 = sin enrollar).
    const segDeNivel = (n) => ({ 1: 0, 2: 3, 3: 2, 4: 1 })[n] || 0;
    /* El nombre de un código. Uno cortado que no está en el plan (3.1.1) toma
       el de su única cuenta hija; si tiene varias, el del ancestro más cercano. */
    function nombreNivel(code, nombres) {
      if (nombres[code]) return nombres[code];
      const hijas = Object.keys(nombres).filter((k) => k.indexOf(code + '.') === 0);
      if (hijas.length === 1) return nombres[hijas[0]];
      const p = code.split('.');
      for (let i = p.length - 1; i > 0; i--) { const a = p.slice(0, i).join('.'); if (nombres[a]) return nombres[a]; }
      return code;
    }
    /* Por cuenta: `ant` = debe − haber antes de `desde`; `debe`, `haber` y
       `movs` = lo de dentro del rango. Lo posterior a `hasta` no entra. Un
       asiento con fecha ilegible va al saldo anterior (no se pierde). */
    function saldosEnRango(asientos, desde, hasta) {
      const map = new Map();
      const orden = (asientos || []).map((a) => ({ a: a, f: fechaAsientoISO(a.fecha) }))
        .sort((x, y) => (x.f < y.f ? -1 : x.f > y.f ? 1 : (x.a.numero || 0) - (y.a.numero || 0)));
      orden.forEach((o) => {
        if (o.f > hasta) return;
        const dentro = !!o.f && o.f >= desde;
        (Array.isArray(o.a.lineas) ? o.a.lineas : []).forEach((l) => {
          const p = parseCta(l.cta);
          if (!map.has(p.c)) map.set(p.c, { code: p.c, nombre: p.n, ant: 0, debe: 0, haber: 0, movs: [] });
          const e = map.get(p.c);
          const d = Number(l.debe) || 0, h = Number(l.haber) || 0;
          if (!dentro) { e.ant += d - h; return; }
          e.debe += d; e.haber += h;
          e.movs.push({ fecha: o.a.fecha, iso: o.f, num: o.a.numero, desc: o.a.descripcion, ref: o.a.referencia, d: d, h: h });
        });
      });
      return map;
    }
    // Enrolla las cuentas a `seg` segmentos (0 = detalle), sumando saldos y movimientos.
    function rollUp(cuentas, seg, nombres) {
      if (!seg) return cuentas;
      const m = new Map();
      cuentas.forEach((c) => {
        const code = c.code.split('.').slice(0, seg).join('.');
        if (!m.has(code)) m.set(code, { code: code, nombre: nombreNivel(code, nombres || {}), ant: 0, debe: 0, haber: 0, movs: [] });
        const e = m.get(code);
        e.ant += c.ant || 0; e.debe += c.debe; e.haber += c.haber;
        e.movs = e.movs.concat(c.movs || []);
      });
      m.forEach((e) => e.movs.sort((x, y) => (x.iso < y.iso ? -1 : x.iso > y.iso ? 1 : (x.num || 0) - (y.num || 0))));
      return Array.from(m.values());
    }
    /* Flujo de Efectivo, método directo. En cada asiento con efectivo (1.1.1),
       cada línea que no es efectivo aporta su haber − debe: como el asiento
       cuadra, la suma es exactamente lo que entró o salió de caja y bancos. */
    const RUBROS_FLUJO = [
      [/^1\.1\.2\.04/, 'op', 'Anticipos a proveedores'],
      [/^1\.1\.2/, 'op', 'Cobros a clientes y otras cuentas por cobrar'],
      [/^4/, 'op', 'Cobros por ventas y otros ingresos'],
      [/^2\.1\.6/, 'op', 'Anticipos recibidos de clientes'],
      [/^2\.1\.1/, 'op', 'Pagos a proveedores'],
      [/^(5|1\.1\.4)/, 'op', 'Pagos de compras y costos'],
      [/^(2\.1\.2|2\.1\.3\.(0[4-9]|1[01]))/, 'op', 'Pagos al personal, aportes y retenciones de nómina'],
      [/^(1\.1\.3|2\.1\.3|2\.1\.4)/, 'op', 'Pagos de impuestos (IVA, ISLR, IGTF y otros)'],
      [/^6\.3/, 'op', 'Gastos financieros e IGTF'],
      [/^6/, 'op', 'Pagos de gastos'],
      [/^1\.1\.5/, 'op', 'Gastos pagados por anticipado'],
      [/^1\.1\.6/, 'inv', 'Criptoactivos'],
      [/^1\.2\.1/, 'inv', 'Propiedad, planta y equipo'],
      [/^1\.2\.2/, 'inv', 'Activos intangibles'],
      [/^1\.2/, 'inv', 'Inversiones permanentes'],
      [/^2\.2/, 'fin', 'Préstamos y financiamientos a largo plazo'],
      [/^3/, 'fin', 'Aportes y retiros de los socios'],
    ];
    const esEfectivo = (code) => code === '1.1.1' || code.indexOf('1.1.1.') === 0;
    function rubroFlujo(code) {
      for (let i = 0; i < RUBROS_FLUJO.length; i++) if (RUBROS_FLUJO[i][0].test(code)) return { act: RUBROS_FLUJO[i][1], rubro: RUBROS_FLUJO[i][2], orden: i };
      return { act: 'op', rubro: 'Otros cobros y pagos', orden: 99 };
    }
    function flujoDirecto(asientos, desde, hasta) {
      const r = { inicial: 0, cajaRango: 0, act: { op: new Map(), inv: new Map(), fin: new Map() } };
      (asientos || []).forEach((a) => {
        const f = fechaAsientoISO(a.fecha);
        if (f > hasta) return;
        const lin = (Array.isArray(a.lineas) ? a.lineas : []).map((l) => ({ code: parseCta(l.cta).c, d: Number(l.debe) || 0, h: Number(l.haber) || 0 }));
        const caja = lin.filter((l) => esEfectivo(l.code)).reduce((s, l) => s + l.d - l.h, 0);
        if (!f || f < desde) { r.inicial += caja; return; }
        r.cajaRango += caja;
        if (!lin.some((l) => esEfectivo(l.code))) return;
        lin.forEach((l) => {
          if (esEfectivo(l.code) || Math.abs(l.h - l.d) < 0.005) return;
          const rb = rubroFlujo(l.code), m = r.act[rb.act];
          if (!m.has(rb.rubro)) m.set(rb.rubro, { rubro: rb.rubro, orden: rb.orden, monto: 0 });
          m.get(rb.rubro).monto += l.h - l.d;
        });
      });
      const tot = (m) => Array.from(m.values()).reduce((s, x) => s + x.monto, 0);
      r.op = tot(r.act.op); r.inv = tot(r.act.inv); r.fin = tot(r.act.fin);
      r.variacion = r.op + r.inv + r.fin;
      r.final = r.inicial + r.variacion;
      r.cajaFin = r.inicial + r.cajaRango;
      r.cuadra = Math.abs(r.final - r.cajaFin) < 0.01;
      return r;
    }
    window.__reportesPuros = { fechaAsientoISO, rangoPeriodo, moverAncla, segDeNivel, nombreNivel, saldosEnRango, rollUp, flujoDirecto, rubroFlujo };
    // ── fin de las funciones puras de reportes ──

    // Estado común de la barra: período y nivel.
    const _rep = { tipo: 'mes', ancla: '', nivel: 1, empresa: null };
    const _rango = () => rangoPeriodo(_rep.tipo, _rep.ancla);
    // El último día con asientos (para que el período arranque donde hay datos).
    function ultimaFechaAsientos() {
      return (asientosData || []).map((a) => fechaAsientoISO(a.fecha)).filter(Boolean).sort().pop() || '';
    }
    // El corte visible: el fin del rango, o el último asiento si el rango es «todo».
    function corteISO() {
      const r = _rango();
      return r.hasta === '9999-12-31' ? (ultimaFechaAsientos() || (window.__hoyISO ? window.__hoyISO() : _isoDe(new Date()))) : r.hasta;
    }
    function nombresPlan() {
      const n = { '1': 'Activo', '2': 'Pasivo', '3': 'Patrimonio', '4': 'Ingresos', '5': 'Costos', '6': 'Gastos' };
      try { getCuentasPlan().forEach((c) => { if (c.code && c.name) n[c.code] = c.name; }); } catch (e) { /* plan aún no pintado */ }
      (asientosData || []).forEach((a) => (Array.isArray(a.lineas) ? a.lineas : []).forEach((l) => { const p = parseCta(l.cta); if (p.c && !n[p.c]) n[p.c] = p.n; }));
      return n;
    }
    const conMovimiento = (c) => Math.abs(c.ant || 0) > 0.004 || c.debe !== 0 || c.haber !== 0;

    // Ejercicio fiscal derivado de los asientos (lo usan el ISLR anual, la impresión y los exports).
    const _MESES_EJ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    function ejercicioInfo() {
      const fs = (asientosData || []).map((a) => fechaAsientoISO(a.fecha)).filter(Boolean).sort();
      const fstr = (iso) => parseInt(iso.slice(8, 10), 10) + ' de ' + _MESES_EJ[parseInt(iso.slice(5, 7), 10) - 1] + ' de ' + iso.slice(0, 4);
      if (!fs.length) { const y = new Date().getFullYear(); return { anio: y, corteStr: '', inicioStr: '', label: 'Ejercicio ' + y, periodo: 'Ejercicio ' + y }; }
      const ini = fs[0], corte = fs[fs.length - 1];
      return { anio: parseInt(corte.slice(0, 4), 10), corteStr: fstr(corte), inicioStr: fstr(ini), label: 'Ejercicio ' + corte.slice(0, 4), periodo: 'Del ' + fstr(ini) + ' al ' + fstr(corte) };
    }
    window.__ejercicioInfo = ejercicioInfo;
    // Lo que dice la cabecera de cada reporte.
    function periodoTexto() {
      const r = _rango();
      if (r.desde === '') return ejercicioInfo().periodo;
      return r.etiqueta + ' · del ' + _dmy(r.desde) + ' al ' + _dmy(r.hasta);
    }
    window.__periodoReportes = () => ({ desde: _rango().desde, hasta: _rango().hasta, etiqueta: _rango().etiqueta, texto: periodoTexto(), corte: _dmy(corteISO()) });

    // Saldo según naturaleza: Activo/Costo/Gasto (1,5,6) = debe−haber; Pasivo/Patrimonio/Ingreso (2,3,4) = haber−debe
    function saldoNatural(c) {
      const g = c.code.charAt(0);
      const s = (c.ant || 0) + c.debe - c.haber;
      return (g === '1' || g === '5' || g === '6') ? s : -s;
    }
    // Lo del rango solamente (Resultados): sin el saldo anterior.
    const movNatural = (c) => saldoNatural({ code: c.code, ant: 0, debe: c.debe, haber: c.haber });

    function renderBalance(cuentasNivel) {
      const tbody = view.querySelector('.conta-tab[data-tab="balance"] table.balance-table tbody');
      const tfoot = view.querySelector('.conta-tab[data-tab="balance"] table.balance-table tfoot');
      if (!tbody) return;
      const cuentas = cuentasNivel.filter(conMovimiento).sort((a, b) => a.code.localeCompare(b.code));
      let tAnt = 0, tDebe = 0, tHaber = 0, tSD = 0, tSA = 0;
      const sAnt = (v) => (Math.abs(v) < 0.005 ? '—' : fmt2(Math.abs(v)) + (v > 0 ? ' D' : ' A'));
      tbody.innerHTML = cuentas.map((c) => {
        const saldo = (c.ant || 0) + c.debe - c.haber, sd = saldo > 0 ? saldo : 0, sa = saldo < 0 ? -saldo : 0;
        tAnt += c.ant || 0; tDebe += c.debe; tHaber += c.haber; tSD += sd; tSA += sa;
        return '<tr><td class="mono">' + c.code + '</td><td class="primary">' + c.nombre + '</td><td class="num">' + sAnt(c.ant || 0) + '</td>'
          + '<td class="num">' + (c.debe ? fmt2(c.debe) : '—') + '</td><td class="num">' + (c.haber ? fmt2(c.haber) : '—') + '</td>'
          + '<td class="num">' + (sd ? fmt2(sd) : '—') + '</td><td class="num">' + (sa ? fmt2(sa) : '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin movimientos en el período.</td></tr>';
      if (tfoot) tfoot.innerHTML = '<tr><td colspan="2" class="lbl-cell">Totales</td><td class="num" style="text-align:right;">' + sAnt(tAnt) + '</td>'
        + '<td class="num" style="text-align:right;">' + fmt2(tDebe) + '</td><td class="num" style="text-align:right;">' + fmt2(tHaber) + '</td>'
        + '<td class="num" style="text-align:right;">' + fmt2(tSD) + '</td><td class="num" style="text-align:right;">' + fmt2(tSA) + '</td></tr>';
      const ok = Math.abs(tDebe - tHaber) < 0.009 && Math.abs(tSD - tSA) < 0.009;
      const okEl = view.querySelector('.conta-tab[data-tab="balance"] .balance-ok');
      if (okEl) okEl.innerHTML = ok ? '<i data-lucide="check-circle-2"></i> Sumas iguales · cuadrado' : '<i data-lucide="alert-circle"></i> Descuadrado';
      const cnt = view.querySelector('.conta-tab[data-tab="balance"] .table-footer .count');
      if (cnt) cnt.innerHTML = cuentas.length + ' cuentas · ' + periodoTexto() + ' · <strong>Débitos = Créditos</strong> y <strong>Saldos deudores = acreedores</strong>';
    }

    let _mayorPage = 1, _mayorCode = null, _mayorMap = null; // paginación del Mayor (20 movimientos por página)
    function renderMayorLedger(code, map, page) {
      const c = map.get(code); if (!c) return;
      _mayorCode = code; _mayorMap = map;
      const setTxt = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
      const final = (c.ant || 0) + c.debe - c.haber;
      setTxt('mayorBadge', c.code); setTxt('mayorTitle', c.nombre);
      setTxt('mayorSub', 'Naturaleza ' + (final >= 0 ? 'deudora' : 'acreedora') + ' · ' + periodoTexto());
      setTxt('mayorSaldoLbl', final >= 0 ? 'Saldo final deudor' : 'Saldo final acreedor');
      setTxt('mayorSaldoVal', 'Bs ' + fmt2(Math.abs(final)));
      const tbody = document.getElementById('mayorBody');
      // Saldo corrido desde el saldo anterior (correcto en cualquier página)
      let run = c.ant || 0;
      const movs = (c.movs || []).map((m) => { run += (m.d || 0) - (m.h || 0); return { m: m, run: run }; });
      const MP = 20;
      const totalPagM = Math.max(1, Math.ceil(movs.length / MP));
      _mayorPage = Math.min(Math.max(1, page || 1), totalPagM);
      const iniM = (_mayorPage - 1) * MP;
      const r = _rango();
      let rows = '<tr class="opening"><td>' + (r.desde ? _dmy(r.desde) : '—') + '</td><td class="mono">—</td><td>Saldo anterior</td><td class="mono">—</td><td class="num">—</td><td class="num">—</td>'
        + '<td class="saldo">' + fmt2(Math.abs(c.ant || 0)) + '</td></tr>';
      rows += movs.slice(iniM, iniM + MP).map((x) => {
        const m = x.m;
        return '<tr><td>' + (m.fecha || '') + '</td><td class="mono">#0' + m.num + '</td><td class="primary">' + (m.desc || '') + '</td>'
          + '<td class="mono">' + (m.ref || '—') + '</td><td class="num">' + (m.d ? fmt2(m.d) : '—') + '</td><td class="num">' + (m.h ? fmt2(m.h) : '—') + '</td>'
          + '<td class="saldo">' + fmt2(Math.abs(x.run)) + '</td></tr>';
      }).join('');
      if (!movs.length) rows += '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin movimientos en el período · el saldo es el anterior.</td></tr>';
      if (totalPagM > 1) {
        rows += '<tr><td colspan="7" style="padding:6px 10px;"><div style="display:flex;justify-content:center;align-items:center;gap:14px;font-size:12px;color:var(--fg-muted);">'
          + '<button class="btn btn-ghost" data-mp-dir="-1"' + (_mayorPage <= 1 ? ' disabled' : '') + ' style="height:26px;font-size:11px;">« Anterior</button>'
          + '<span>Página ' + _mayorPage + ' de ' + totalPagM + ' · ' + movs.length + ' movimientos</span>'
          + '<button class="btn btn-ghost" data-mp-dir="1"' + (_mayorPage >= totalPagM ? ' disabled' : '') + ' style="height:26px;font-size:11px;">Siguiente »</button></div></td></tr>';
      }
      if (tbody) tbody.innerHTML = rows;
      setTxt('mayorTotDeb', fmt2(c.debe)); setTxt('mayorTotHaber', fmt2(c.haber)); setTxt('mayorTotSaldo', fmt2(Math.abs(final)));
    }
    view.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mp-dir]');
      if (b && !b.disabled && _mayorCode && _mayorMap) renderMayorLedger(_mayorCode, _mayorMap, _mayorPage + parseInt(b.dataset.mpDir, 10));
    });

    function renderMayorTree(cuentasNivel) {
      const body = view.querySelector('.conta-tab[data-tab="mayor"] .account-tree-body');
      if (!body) return;
      const cuentas = cuentasNivel.filter(conMovimiento).sort((a, b) => a.code.localeCompare(b.code));
      const map = new Map(cuentas.map((c) => [c.code, c]));
      const grupos = { '1': '1 · Activo', '2': '2 · Pasivo', '3': '3 · Patrimonio', '4': '4 · Ingresos', '5': '5 · Costos', '6': '6 · Gastos' };
      let html = '', lastG = '';
      cuentas.forEach((c) => {
        const g = c.code.charAt(0);
        if (g !== lastG) { html += '<div class="acc-group-label">' + (grupos[g] || g) + '</div>'; lastG = g; }
        html += '<div class="acc-item" data-code="' + c.code + '"><span class="code">' + c.code + '</span><span class="nm">' + c.nombre + '</span><span class="bal">' + fmt2(Math.abs((c.ant || 0) + c.debe - c.haber)) + '</span></div>';
      });
      body.innerHTML = html || '<div class="acc-group-label">Sin movimientos en el período</div>';
      body.querySelectorAll('.acc-item').forEach((it) => it.addEventListener('click', () => {
        body.querySelectorAll('.acc-item').forEach((x) => x.removeAttribute('data-active'));
        it.dataset.active = 'true'; renderMayorLedger(it.dataset.code, map);
      }));
      // Se queda en la cuenta que se estaba mirando, si sigue en la lista.
      const sigue = _mayorCode && body.querySelector('.acc-item[data-code="' + _mayorCode + '"]');
      const first = sigue || body.querySelector('.acc-item');
      if (first) { first.dataset.active = 'true'; renderMayorLedger(first.dataset.code, map, sigue ? _mayorPage : 1); }
      else {
        _mayorCode = null;
        const tb = document.getElementById('mayorBody');
        if (tb) tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin movimientos en el período.</td></tr>';
      }
      if (window.lucide) window.lucide.createIcons();
    }

    function cabecera(tab, texto) {
      const co = tab.querySelector('.fin-statement-head .co');
      if (co && window.__EMPRESA_ACTIVA) co.textContent = window.__EMPRESA_ACTIVA.n + ' · ' + (window.__EMPRESA_ACTIVA.rif || '');
      tab.querySelectorAll('.fin-statement-head .period').forEach((p) => { p.textContent = texto; });
    }

    function renderEstadoResultados(cuentasNivel) {
      const tab = view.querySelector('.conta-tab[data-tab="resultados"]');
      if (!tab) return 0;
      const cuentas = cuentasNivel.filter((c) => c.debe !== 0 || c.haber !== 0);
      const porGrupo = (g) => cuentas.filter((c) => c.code.charAt(0) === g).sort((a, b) => a.code.localeCompare(b.code));
      const sum = (arr) => arr.reduce((s, c) => s + movNatural(c), 0);
      const ing = porGrupo('4'), cos = porGrupo('5'), gas = porGrupo('6');
      const totIng = sum(ing), totCos = sum(cos), totGas = sum(gas);
      const utilBruta = totIng - totCos, utilOper = utilBruta - totGas, utilNeta = utilOper;
      const pct = (v) => (Math.abs(totIng) > 0.005 ? (v / totIng * 100).toFixed(1) + '%' : '');
      const linea = (c) => '<tr class="line-detail"><td class="label"><span class="sub-acc">' + c.code + '</span>' + c.nombre + '</td><td class="amount">' + fmt2(Math.abs(movNatural(c))) + '</td><td class="amount pct">' + pct(movNatural(c)) + '</td></tr>';
      const sh = (t) => '<tr class="section-head"><td class="label">' + t + '</td><td class="amount"></td><td class="amount pct"></td></tr>';
      const st = (t, v) => '<tr class="subtotal"><td class="label">' + t + '</td><td class="amount">' + fmt2(v) + '</td><td class="amount pct">' + pct(v) + '</td></tr>';
      let html = sh('Ingresos') + (ing.map(linea).join('') || '<tr class="line-detail"><td class="label">Sin ingresos</td><td class="amount">—</td><td class="amount pct"></td></tr>') + st('Total ingresos', totIng);
      html += sh('Costo de ventas') + (cos.map(linea).join('') || '<tr class="line-detail"><td class="label">Sin costos</td><td class="amount">—</td><td class="amount pct"></td></tr>') + st('Utilidad bruta', utilBruta);
      html += sh('Gastos') + (gas.map(linea).join('') || '<tr class="line-detail"><td class="label">Sin gastos</td><td class="amount">—</td><td class="amount pct"></td></tr>') + st('Total gastos', totGas);
      html += '<tr class="grand-total"><td class="label">' + (utilNeta >= 0 ? 'Utilidad' : 'Pérdida') + ' neta del período</td><td class="amount">' + fmt2(Math.abs(utilNeta)) + '</td><td class="amount pct">' + pct(utilNeta) + '</td></tr>';
      const tbody = tab.querySelector('.fin-table tbody'); if (tbody) tbody.innerHTML = html;
      const hv = tab.querySelectorAll('.fin-hi .v'), hd = tab.querySelectorAll('.fin-hi .d');
      if (hv[0]) hv[0].textContent = 'Bs ' + fmt2(totIng);
      if (hv[1]) hv[1].textContent = 'Bs ' + fmt2(utilBruta);
      if (hv[2]) hv[2].textContent = 'Bs ' + fmt2(utilOper);
      if (hv[3]) hv[3].textContent = 'Bs ' + fmt2(utilNeta);
      hd.forEach((d) => (d.innerHTML = ''));
      cabecera(tab, periodoTexto());
      return utilNeta;
    }

    /* Balance General AL corte. Sin asientos de cierre, el resultado de las
       cuentas 4, 5 y 6 se parte: lo del ejercicio (desde el 1 de enero del año
       del corte) y lo de ejercicios anteriores. Así la ecuación cuadra. */
    function renderBalanceGeneral(nombres) {
      const tab = view.querySelector('.conta-tab[data-tab="general"]');
      if (!tab) return;
      const corte = corteISO(), iniEj = corte.slice(0, 4) + '-01-01';
      const todas = Array.from(saldosEnRango(asientosData, iniEj, corte).values());
      const res = (c) => '456'.indexOf(c.code.charAt(0)) >= 0;
      const nat456 = (c, v) => (c.code.charAt(0) === '4' ? v : -v);   // ingreso positivo, costo y gasto restan
      const utilEj = todas.filter(res).reduce((s, c) => s + nat456(c, c.haber - c.debe), 0);
      const utilAnt = todas.filter(res).reduce((s, c) => s + nat456(c, -(c.ant || 0)), 0);
      // El Balance necesita separar corriente / no corriente → nunca menos de Grupo.
      const seg = segDeNivel(_rep.nivel), segBG = seg === 1 ? 2 : seg;
      const cuentas = rollUp(todas.filter((c) => !res(c)), segBG, nombres)
        .map((c) => ({ code: c.code, nombre: c.nombre, ant: (c.ant || 0) + c.debe - c.haber, debe: 0, haber: 0 }))
        .filter((c) => Math.abs(c.ant) > 0.004);
      const byPfx = (p) => cuentas.filter((c) => c.code === p || c.code.indexOf(p + '.') === 0).sort((a, b) => a.code.localeCompare(b.code));
      const sum = (arr) => arr.reduce((s, c) => s + saldoNatural(c), 0);
      const aC = byPfx('1.1'), aNC = byPfx('1.2'), pC = byPfx('2.1'), pNC = byPfx('2.2'), pat = byPfx('3');
      const tAC = sum(aC), tANC = sum(aNC), tAct = tAC + tANC, tPC = sum(pC), tPNC = sum(pNC), tPas = tPC + tPNC, tPat = sum(pat) + utilAnt + utilEj;
      const linea = (c) => '<tr class="line-detail"><td class="label"><span class="sub-acc">' + c.code + '</span>' + c.nombre + '</td><td class="amount">' + (saldoNatural(c) < 0 ? '(' + fmt2(-saldoNatural(c)) + ')' : fmt2(saldoNatural(c))) + '</td></tr>';
      const sh = (t) => '<tr class="section-head"><td class="label">' + t + '</td><td class="amount"></td></tr>';
      const st = (t, v) => '<tr class="subtotal"><td class="label">' + t + '</td><td class="amount">' + fmt2(v) + '</td></tr>';
      const gt = (t, v) => '<tr class="grand-total"><td class="label">' + t + '</td><td class="amount">' + fmt2(v) + '</td></tr>';
      const lRes = (t, v) => '<tr class="line-detail"><td class="label"><span class="sub-acc">3.2</span>' + (v >= 0 ? 'Utilidad' : 'Pérdida') + ' ' + t + '</td><td class="amount">' + (v < 0 ? '(' + fmt2(-v) + ')' : fmt2(v)) + '</td></tr>';
      let hA = sh('Activo Corriente') + aC.map(linea).join('') + st('Total activo corriente', tAC) + sh('Activo No Corriente') + aNC.map(linea).join('') + st('Total activo no corriente', tANC) + gt('Total activo', tAct);
      let hP = sh('Pasivo Corriente') + pC.map(linea).join('') + st('Total pasivo corriente', tPC) + sh('Pasivo No Corriente') + pNC.map(linea).join('') + st('Total pasivo', tPas);
      hP += sh('Patrimonio') + pat.map(linea).join('') + (Math.abs(utilAnt) > 0.004 ? lRes('de ejercicios anteriores', utilAnt) : '') + lRes('del ejercicio ' + corte.slice(0, 4), utilEj) + st('Total patrimonio', tPat) + gt('Pasivo + Patrimonio', tPas + tPat);
      const tbs = tab.querySelectorAll('.fin-two-col .fin-statement .fin-table tbody');
      if (tbs[0]) tbs[0].innerHTML = hA;
      if (tbs[1]) tbs[1].innerHTML = hP;
      const cuadra = Math.abs(tAct - (tPas + tPat)) < 0.009;
      const banner = tab.querySelector('.balance-check-banner');
      if (banner) banner.innerHTML = (cuadra ? '<i data-lucide="check-circle-2"></i> Ecuación contable cuadrada · ' : '<i data-lucide="alert-circle"></i> Descuadrado · ') + 'Activo Bs ' + fmt2(tAct) + ' = Pasivo Bs ' + fmt2(tPas) + ' + Patrimonio Bs ' + fmt2(tPat);
      const hv = tab.querySelectorAll('.fin-hi .v'), hd = tab.querySelectorAll('.fin-hi .d');
      if (hv[0]) hv[0].textContent = 'Bs ' + fmt2(tAct);
      if (hv[1]) hv[1].textContent = 'Bs ' + fmt2(tPas);
      if (hv[2]) hv[2].textContent = 'Bs ' + fmt2(tPat);
      if (hv[3]) hv[3].textContent = (tPC ? (tAC / tPC).toFixed(2) : '—') + '×';
      hd.forEach((d) => (d.innerHTML = ''));
      cabecera(tab, 'Al ' + _dmy(corte) + ' · Bs');
    }

    function renderFlujo() {
      const tab = view.querySelector('.conta-tab[data-tab="flujo"]');
      if (!tab) return;
      const r = _rango();
      const f = flujoDirecto(asientosData, r.desde, r.hasta);
      const fmtM = (v) => v < 0 ? '(' + fmt2(Math.abs(v)) + ')' : fmt2(v);
      const clsM = (v) => v < 0 ? 'amount fin-neg' : 'amount fin-pos';
      function seccion(titulo, m, nombreFlujo, tot) {
        let h = '<tr class="section-head"><td class="label">' + titulo + '</td><td class="amount"></td></tr>';
        const ent = Array.from(m.values()).sort((a, b) => a.orden - b.orden);
        if (!ent.length) h += '<tr class="line-detail"><td class="label">Sin movimientos</td><td class="amount">—</td></tr>';
        ent.forEach((x) => { h += '<tr class="line-detail"><td class="label">' + x.rubro + '</td><td class="' + clsM(x.monto) + '">' + fmtM(x.monto) + '</td></tr>'; });
        return h + '<tr class="subtotal"><td class="label">Flujo neto de ' + nombreFlujo + '</td><td class="' + clsM(tot) + '">' + fmtM(tot) + '</td></tr>';
      }
      let html = seccion('Actividades de operación', f.act.op, 'operación', f.op)
        + seccion('Actividades de inversión', f.act.inv, 'inversión', f.inv)
        + seccion('Actividades de financiamiento', f.act.fin, 'financiamiento', f.fin);
      html += '<tr class="subtotal"><td class="label">' + (f.variacion >= 0 ? 'Aumento' : 'Disminución') + ' neto de efectivo</td><td class="' + clsM(f.variacion) + '">' + fmtM(f.variacion) + '</td></tr>';
      html += '<tr class="line-detail"><td class="label">Efectivo al inicio del período</td><td class="amount">' + fmtM(f.inicial) + '</td></tr>';
      html += '<tr class="grand-total"><td class="label">Efectivo al final del período</td><td class="amount">' + fmtM(f.final) + '</td></tr>';
      const tbody = tab.querySelector('.fin-table tbody'); if (tbody) tbody.innerHTML = html;
      const hv = tab.querySelectorAll('.fin-hi .v'), hd = tab.querySelectorAll('.fin-hi .d');
      if (hv[0]) hv[0].textContent = 'Bs ' + fmt2(f.inicial);
      if (hv[1]) hv[1].textContent = 'Bs ' + fmt2(f.op);
      if (hv[2]) hv[2].textContent = 'Bs ' + fmt2(f.variacion);
      if (hv[3]) hv[3].textContent = 'Bs ' + fmt2(f.final);
      hd.forEach((d) => (d.innerHTML = ''));
      cabecera(tab, periodoTexto() + ' · Método directo');
      const banner = tab.querySelector('.balance-check-banner');
      if (banner) banner.innerHTML = f.cuadra
        ? '<i data-lucide="check-circle-2"></i> Conciliado · el efectivo final Bs ' + fmt2(f.final) + ' es el saldo de Caja y Bancos (1.1.1) al cierre del período.'
        : '<i data-lucide="alert-circle"></i> No concilia · el flujo da Bs ' + fmt2(f.final) + ' y Caja y Bancos tienen Bs ' + fmt2(f.cajaFin) + ': hay un asiento descuadrado en el período.';
    }

    // ── La barra común de período y nivel ──────────────────────────────────
    const TABS_REPORTE = ['diario', 'mayor', 'balance', 'resultados', 'general', 'flujo'];
    (function barraReportes() {
      const tabs = document.getElementById('contaTabs');
      if (!tabs || document.getElementById('contaRepBar')) return;
      const bar = document.createElement('div');
      bar.id = 'contaRepBar';
      bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin:0 0 14px;font-size:12px;color:var(--fg-muted);';
      const btn = 'height:28px;font-size:12px;padding:0 10px;';
      bar.innerHTML = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span style="font-weight:600;">Período:</span>'
        + '<select id="crbTipo" style="height:28px;border:1px solid var(--border-strong);border-radius:8px;padding:0 6px;font:inherit;background:var(--bg-surface);color:var(--fg-primary);">'
        + '<option value="todo">Todo</option><option value="dia">Día</option><option value="semana">Semana</option><option value="mes" selected>Mes</option><option value="anio">Año</option></select>'
        + '<button class="btn btn-ghost" data-crb-dir="-1" style="' + btn + '" title="Período anterior">‹</button>'
        + '<strong id="crbEtq" style="color:var(--fg-primary);min-width:120px;text-align:center;">—</strong>'
        + '<button class="btn btn-ghost" data-crb-dir="1" style="' + btn + '" title="Período siguiente">›</button></div>'
        + '<div id="crbNivel" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span style="font-weight:600;">Nivel:</span>'
        + [[1, 'Detalle'], [2, 'Cuenta'], [3, 'Grupo'], [4, 'Clase']].map((n) => '<button class="btn btn-ghost" data-crb-nivel="' + n[0] + '" style="' + btn + '">' + n[0] + ' · ' + n[1] + '</button>').join('')
        + '</div>';
      tabs.insertAdjacentElement('afterend', bar);
      const pintarBarra = () => {
        const r = _rango();
        const etq = document.getElementById('crbEtq'); if (etq) etq.textContent = r.etiqueta;
        bar.querySelectorAll('[data-crb-dir]').forEach((b) => { b.disabled = _rep.tipo === 'todo'; });
        bar.querySelectorAll('[data-crb-nivel]').forEach((b) => {
          if (parseInt(b.dataset.crbNivel, 10) === _rep.nivel) b.dataset.active = 'true'; else b.removeAttribute('data-active');
        });
      };
      const visible = () => {
        const act = tabs.querySelector('button[data-active="true"]');
        const t = act ? act.dataset.tab : 'diario';
        bar.style.display = TABS_REPORTE.indexOf(t) >= 0 ? 'flex' : 'none';
        const niv = document.getElementById('crbNivel');
        if (niv) niv.style.display = t === 'diario' ? 'none' : 'flex';   // el Diario no se enrolla
      };
      tabs.addEventListener('click', () => setTimeout(visible, 0));
      const cambio = () => { pintarBarra(); if (window.__repintarPeriodo) window.__repintarPeriodo(1); else renderReportes(); };
      bar.addEventListener('change', (e) => {
        if (e.target.id !== 'crbTipo') return;
        _rep.tipo = e.target.value;
        if (!_rep.ancla) _rep.ancla = ultimaFechaAsientos() || (window.__hoyISO ? window.__hoyISO() : _isoDe(new Date()));
        cambio();
      });
      bar.addEventListener('click', (e) => {
        const d = e.target.closest('[data-crb-dir]');
        if (d && !d.disabled) { _rep.ancla = moverAncla(_rep.tipo, _rep.ancla || ultimaFechaAsientos() || _isoDe(new Date()), parseInt(d.dataset.crbDir, 10)); cambio(); return; }
        const n = e.target.closest('[data-crb-nivel]');
        if (n) { _rep.nivel = parseInt(n.dataset.crbNivel, 10); pintarBarra(); renderReportes(); }
      });
      window.__pintarBarraReportes = pintarBarra;
      pintarBarra(); visible();
    })();

    // ── Cuadre con la Forma 30 (sql/contabilidad_13): en el Balance de Comprobación ──
    let _cuadreTurno = 0, _cuadreClave = '';
    async function renderCuadreF30() {
      const tab = view.querySelector('.conta-tab[data-tab="balance"]');
      const emp = window.__EMPRESA_ACTIVA;
      if (!tab || !window.sb || !emp || !emp.id) return;
      let box = document.getElementById('cuadreF30');
      if (!box) {
        box = document.createElement('div');
        box.id = 'cuadreF30';
        box.style.cssText = 'margin:0 0 14px;font-size:12px;';
        const wrap = tab.querySelector('.data-table-wrap');
        if (wrap) wrap.insertAdjacentElement('beforebegin', box); else tab.prepend(box);
      }
      const r = _rango();
      /* Cambiar de nivel repinta los reportes pero no cambia el cuadre: solo se
         vuelve a pedir con otro período, otra empresa o asientos recargados. */
      const clave = emp.id + '|' + r.desde + '|' + r.hasta + '|' + _cargaAsientos;
      if (clave === _cuadreClave) return;
      _cuadreClave = clave;
      if (r.desde === '') { box.innerHTML = '<div style="color:var(--fg-muted);">Cuadre con la Forma 30: elige un mes o un año para verlo.</div>'; return; }
      // Los meses del rango (un día o una semana caen en uno o dos meses).
      const meses = [];
      for (let m = r.desde.slice(0, 7); m <= r.hasta.slice(0, 7) && meses.length < 12;) {
        meses.push(m);
        const [y, mm] = m.split('-').map((x) => parseInt(x, 10));
        m = mm === 12 ? (y + 1) + '-01' : y + '-' + _pad2(mm + 1);
      }
      const turno = ++_cuadreTurno;
      const pedidos = [];
      meses.forEach((m) => {
        const quin = window.__ivaPorQuincenaEn ? window.__ivaPorQuincenaEn(m) : false;
        (quin ? [1, 2] : [null]).forEach((q) => pedidos.push({ m: m, q: q }));
      });
      const res = await Promise.all(pedidos.map((p) => window.sb.rpc('contab_cuadre_iva', { p_empresa: emp.id, p_periodo: p.m, p_quincena: p.q })));
      if (turno !== _cuadreTurno) return;   // llegó tarde: ya se pidió otro período
      const err = res.find((x) => x.error);
      if (err) {
        box.innerHTML = '<div style="color:var(--fg-muted);">Cuadre con la Forma 30: ' + (/contab_cuadre_iva|PGRST202/.test((err.error.message || '') + (err.error.code || ''))
          ? 'falta correr sql/contabilidad_13_apertura_y_cuadre.sql en Supabase.' : 'no se pudo calcular (' + err.error.message + ').') + '</div>';
        return;
      }
      const filas = res.map((x, i) => ({ p: pedidos[i], d: x.data || {} }))
        .filter((x) => Math.abs(Number(x.d.debito_contable) || 0) + Math.abs(Number(x.d.debito_fiscal) || 0) + Math.abs(Number(x.d.credito_contable) || 0) + Math.abs(Number(x.d.credito_fiscal) || 0) > 0.004);
      if (!filas.length) { box.innerHTML = '<div style="color:var(--fg-muted);">Cuadre con la Forma 30: sin IVA en el período.</div>'; return; }
      const n = (v) => fmt2(Number(v) || 0);
      const mesTxt = (p) => _MESES_R[parseInt(p.m.slice(5, 7), 10) - 1] + ' ' + p.m.slice(0, 4) + (p.q ? ' · ' + p.q + 'ª quincena' : '');
      const dif = (v) => (Math.abs(Number(v) || 0) < 0.01 ? '—' : '<strong style="color:var(--danger-600,#c0392b);">' + n(v) + '</strong>');
      box.innerHTML = '<div class="data-table-wrap"><div class="table-toolbar"><strong style="color:var(--fg-primary);">Cuadre con la Forma 30</strong>'
        + '<span style="margin-left:8px;color:var(--fg-muted);">IVA de la contabilidad contra el del libro que declara el módulo Fiscal</span></div>'
        + '<div class="table-scroll"><table class="data-table" style="min-width:760px;"><thead><tr><th>Período de IVA</th>'
        + '<th class="num">Débito contable</th><th class="num">Débito del libro</th><th class="num">Diferencia</th>'
        + '<th class="num">Crédito contable</th><th class="num">Crédito del libro</th><th class="num">Diferencia</th><th></th></tr></thead><tbody>'
        + filas.map((x) => '<tr><td>' + mesTxt(x.p) + '</td>'
          + '<td class="num">' + n(x.d.debito_contable) + '</td><td class="num">' + n(x.d.debito_fiscal) + '</td><td class="num">' + dif(x.d.dif_debito) + '</td>'
          + '<td class="num">' + n(x.d.credito_contable) + '</td><td class="num">' + n(x.d.credito_fiscal) + '</td><td class="num">' + dif(x.d.dif_credito) + '</td>'
          + '<td>' + (x.d.cuadra ? '<span class="tag green">Cuadra</span>' : '<span class="tag red">No cuadra</span>') + '</td></tr>').join('')
        + '</tbody></table></div></div>';
    }

    function renderReportes() {
      const r = _rango(), nombres = nombresPlan(), seg = segDeNivel(_rep.nivel);
      const cuentas = rollUp(Array.from(saldosEnRango(asientosData, r.desde, r.hasta).values()), seg, nombres);
      renderBalance(cuentas);
      renderMayorTree(cuentas);
      renderEstadoResultados(cuentas);
      renderBalanceGeneral(nombres);
      renderFlujo();
      renderCuadreF30();
      /* El medidor de ISLR y el IGP miran el ACUMULADO de todo lo registrado,
         como antes: no cambian con el período que se esté mirando. */
      const todo = Array.from(saldosEnRango(asientosData, '', '9999-12-31').values());
      const sNat = (pfx) => todo.filter((c) => c.code.charAt(0) === pfx).reduce((s, c) => s + saldoNatural(c), 0);
      const utilTodo = sNat('4') - sNat('5') - sNat('6');
      window.__UTILIDAD_NETA = utilTodo;
      window.__BALANCE = { activo: sNat('1'), pasivo: sNat('2'), patrimonio: sNat('3') + utilTodo };
      if (window.__renderIGP) window.__renderIGP();
      // Cabecera de Contabilidad: overline y chip de período reflejan lo que se mira
      const ej = ejercicioInfo();
      const ov = view.querySelector('.dash-header .overline'); if (ov) ov.textContent = 'Libros legales · ' + ej.label;
      const dr = view.querySelector('.dash-header .date-range'); if (dr) dr.innerHTML = '<button data-active="true">' + r.etiqueta + '</button>';
      if (window.__renderISLRanual) window.__renderISLRanual();
      if (window.lucide) window.lucide.createIcons();
    }
    // Al cargar (sin empresa/datos), pinta los reportes en cero → limpia el mock estático del HTML
    setTimeout(() => { try { renderReportes(); } catch (e) { console.warn('[DigiAccount] reportes init:', e.message); } }, 0);

    // ---- Activos fijos ----
    /* La ficha vive en activos_fijos; las cuotas, la depreciación y la baja
       las hace la base (sql/contabilidad_07_activos.sql). Un activo comprado
       nace de su factura (libro_fiscal_id): el asiento de la compra ya lo hizo
       el motor del libro con la cuenta 1.2.1.x de la factura. */
    const CATEGORIAS_AF = ['Equipos', 'Mobiliario', 'Maquinaria', 'Vehículos', 'Inmuebles', 'Terrenos'];
    const CAT_DE_CUENTA = { '1.2.1.01': 'Terrenos', '1.2.1.02': 'Inmuebles', '1.2.1.03': 'Maquinaria', '1.2.1.04': 'Equipos', '1.2.1.05': 'Vehículos' };
    window.__categoriaDeCuentaActivo = (cta) => CAT_DE_CUENTA[cta] || 'Equipos';
    const esTerreno = (a) => /terreno/i.test(a.categoria || '');
    function siguienteCodigoAF() {
      const n = (activosData || []).reduce((m, a) => Math.max(m, parseInt(String(a.codigo || '').replace(/\D/g, ''), 10) || 0), 0);
      return 'AF-' + String(n + 1).padStart(3, '0');
    }
    /* Formulario de la ficha. `pref` viene de la compra (libro_fiscal_id,
       nombre, categoria, fecha ISO, costo); sin él es un registro manual
       (migraciones), que además pide lo ya depreciado. */
    window.__abrirFichaActivo = function (pref) {
      pref = pref || {};
      const deCompra = !!pref.libro_fiscal_id;
      const fields = [
        { name: 'cod', label: 'Código', value: siguienteCodigoAF() },
        { name: 'nombre', label: 'Activo', col: 2, value: pref.nombre || '', placeholder: 'Ej. Computador de oficina' },
        { name: 'cat', label: 'Categoría', type: 'select', options: CATEGORIAS_AF, value: pref.categoria || 'Equipos' },
        { name: 'fecha', label: 'Fecha de adquisición', type: 'date', value: pref.fecha || window.__hoyISO() },
        { name: 'costo', label: 'Costo (Bs, sin IVA)', type: 'number', step: '0.01', value: pref.costo != null ? pref.costo : '' },
        { name: 'residual', label: 'Valor residual (Bs)', type: 'number', step: '0.01', value: '0' },
        { name: 'vida', label: 'Vida útil (años)', type: 'number', value: '5' },
        { name: 'metodo', label: 'Método', type: 'select', options: ['Línea recta', 'Saldos decrecientes'] },
      ];
      if (!deCompra) fields.push({ name: 'inicial', label: 'Depreciación acumulada a la fecha (Bs)', type: 'number', step: '0.01', value: '0' });
      window.openFormModal({
        title: deCompra ? 'Ficha del activo comprado' : 'Registrar activo fijo',
        saveLabel: 'Registrar activo',
        fields: fields,
        onSave: (v) => {
          const costo = Math.round((parseFloat(v.costo) || 0) * 100) / 100;
          const residual = Math.round((parseFloat(v.residual) || 0) * 100) / 100;
          const inicial = deCompra ? 0 : Math.round((parseFloat(v.inicial) || 0) * 100) / 100;
          const vida = parseInt(v.vida, 10);
          if (!v.cod || !v.nombre) return 'El código y el nombre del activo son obligatorios.';
          if (!(costo > 0)) return 'El costo debe ser mayor a cero.';
          if (!(vida > 0)) return 'La vida útil debe ser de al menos un año.';
          if (residual < 0 || residual >= costo) return 'El valor residual debe ser menor que el costo.';
          if (inicial < 0 || inicial > costo - residual) return 'Lo ya depreciado no puede pasar de costo menos valor residual.';
          if (!v.fecha) return 'Falta la fecha de adquisición.';
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          window.sb.from('activos_fijos').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
            codigo: v.cod, nombre: v.nombre, categoria: v.cat, fecha_adq: v.fecha.split('-').reverse().join('/'),
            costo: costo, valor_residual: residual, vida_util: vida, metodo: v.metodo,
            depreciacion_inicial: inicial, depreciacion_acum: inicial,
            libro_fiscal_id: pref.libro_fiscal_id || null,
          }).then(({ error }) => {
            if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
            if (window.cargarActivosFijos) window.cargarActivosFijos();
            toast('Activo ' + v.cod + ' registrado · se deprecia desde el mes siguiente a su compra', 'success');
          });
        },
      });
    };
    const registrarActivo = document.getElementById('registrarActivoBtn');
    if (registrarActivo) registrarActivo.addEventListener('click', () => window.__abrirFichaActivo());

    // Cuota estimada del mes en curso (la de verdad la calcula la base al depreciar).
    function cuotaEstimada(a) {
      if ((a.estado || 'en uso') !== 'en uso' || esTerreno(a)) return 0;
      const costo = Number(a.costo) || 0, res = Number(a.valor_residual) || 0, dep = Number(a.depreciacion_acum) || 0, vida = Number(a.vida_util) || 0;
      if (!(vida > 0)) return 0;
      const q = /decreciente/i.test(a.metodo || '') ? (costo - dep) * 2 / vida / 12 : (costo - res) / (vida * 12);
      return Math.max(0, Math.min(q, costo - res - dep));
    }

    // Carga los activos fijos de la empresa activa y arma la tabla (con depreciación y valor neto)
    async function cargarActivosFijos() {
      const tbody = view.querySelector('.conta-tab[data-tab="activos"] table.data-table tbody');
      if (!tbody) return;
      const setStats = (costo, dep, neto, mes) => {
        const vs = view.querySelectorAll('.conta-tab[data-tab="activos"] .recon-stats .recon-stat .v');
        if (vs[0]) vs[0].innerHTML = '<small>Bs</small> ' + fmt2(costo);
        if (vs[1]) vs[1].innerHTML = '<small>Bs</small> ' + fmt2(dep);
        if (vs[2]) vs[2].innerHTML = '<small>Bs</small> ' + fmt2(neto);
        if (vs[3]) vs[3].innerHTML = '<small>Bs</small> ' + fmt2(mes);
      };
      const footer = view.querySelector('.conta-tab[data-tab="activos"] .table-footer .count');
      const dmsg = document.getElementById('deprStatusMsg');
      const tabCount = document.querySelector('#contaTabs button[data-tab="activos"] .count');
      const setDepPreview = (v) => {
        const ced = document.getElementById('deprCedulaTotal'); if (ced) ced.textContent = fmt2(v);
        const deb = document.getElementById('deprAsientoDebe'); if (deb) deb.textContent = fmt2(v);
        const hab = document.getElementById('deprAsientoHaber'); if (hab) hab.textContent = '(' + fmt2(v) + ')';
      };
      const vacio = (txt) => {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--fg-muted);padding:14px;">' + txt + '</td></tr>';
        setStats(0, 0, 0, 0); setDepPreview(0);
        if (footer) footer.textContent = '0 activos registrados';
        if (dmsg) dmsg.textContent = 'Sin depreciación pendiente';
        if (tabCount) tabCount.textContent = '0';
      };
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { activosData = []; vacio('Sin activos registrados.'); return; }
      const { data, error } = await window.sb.from('activos_fijos').select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('codigo');
      if (error) { console.warn('[DigiAccount] No se pudieron cargar activos fijos:', error.message); activosData = []; vacio('No se pudieron cargar los activos.'); return; }
      activosData = data || [];
      if (!activosData.length) { vacio('Sin activos registrados. Nacen al registrar una compra con una cuenta de activo fijo, o con «Registrar activo».'); if (window.refreshTables) window.refreshTables(); return; }
      let cTot = 0, dTot = 0, mesTot = 0, enUso = 0;
      tbody.innerHTML = activosData.map((a) => {
        const costo = Number(a.costo) || 0, dep = Number(a.depreciacion_acum) || 0, neto = costo - dep;
        const activo = (a.estado || 'en uso') === 'en uso';
        if (activo) { cTot += costo; dTot += dep; enUso++; mesTot += cuotaEstimada(a); }
        const pct = costo ? Math.round(dep / costo * 100) : 0;
        const accion = activo
          ? '<button class="btn btn-ghost" style="height:26px;font-size:11px;" data-af-baja="' + a.id + '">Dar de baja</button>'
          : '<span class="tag slate">' + (a.estado === 'vendido' ? 'Vendido' : 'Desincorporado') + ' · ' + String(a.fecha_baja || '').split('-').reverse().join('/') + '</span> '
            + '<button class="btn btn-ghost" style="height:26px;font-size:11px;" data-af-anular="' + a.id + '">Anular baja</button>';
        return '<tr' + (activo ? '' : ' style="opacity:.6;"') + '><td class="mono">' + (a.codigo || '') + '</td><td class="primary">' + (a.nombre || '') + '</td>'
          + '<td><span class="tag slate">' + (a.categoria || '') + '</span></td><td>' + (a.fecha_adq || '') + '</td>'
          + '<td class="num">' + fmt2(costo) + '</td><td>' + (a.vida_util || 5) + ' años</td><td>' + (a.metodo || 'Línea recta') + '</td>'
          + '<td class="num">' + fmt2(dep) + '</td><td class="num">' + fmt2(neto) + '</td>'
          + '<td><span class="depr-bar"><span style="width:' + pct + '%"></span></span><span class="depr-pct">' + pct + '%</span></td>'
          + '<td>' + accion + '</td></tr>';
      }).join('');
      setStats(cTot, dTot, cTot - dTot, mesTot);
      if (footer) footer.textContent = activosData.length + ' activos (' + enUso + ' en uso) · Costo en uso Bs ' + fmt2(cTot);
      if (dmsg) dmsg.textContent = mesTot > 0.009 ? ('Depreciación estimada del mes · ' + enUso + ' activos en uso · Bs ' + fmt2(mesTot) + ' · se contabiliza al cerrar el mes') : 'Sin depreciación pendiente';
      if (tabCount) tabCount.textContent = String(activosData.length);
      setDepPreview(mesTot);
      if (window.refreshTables) window.refreshTables();
      drawIcons();
    }
    window.cargarActivosFijos = cargarActivosFijos;
    cargarActivosFijos();   // limpia los activos de ejemplo al cargar la página

    // Venta o desincorporación: el asiento lo hace la base (contab_baja_activo).
    const tbodyAF = view.querySelector('.conta-tab[data-tab="activos"] table.data-table tbody');
    if (tbodyAF) tbodyAF.addEventListener('click', async (ev) => {
      const bBaja = ev.target.closest('[data-af-baja]'), bAnular = ev.target.closest('[data-af-anular]');
      if (bAnular) {
        const a = (activosData || []).find((x) => x.id === bAnular.dataset.afAnular);
        if (!a || !window.confirm('¿Anular la baja de ' + a.codigo + '?\n\nSe borra su asiento, el activo vuelve a estar en uso y los meses ya depreciados desde la baja se rehacen con él.')) return;
        const { error } = await window.sb.rpc('contab_anular_baja', { p_activo: a.id });
        if (error) { toast('No se pudo anular la baja: ' + error.message, 'error'); return; }
        if (window.cargarAsientos) window.cargarAsientos();
        cargarActivosFijos();
        toast('Baja anulada · ' + a.codigo + ' vuelve a estar en uso', 'success');
        return;
      }
      if (!bBaja) return;
      const a = (activosData || []).find((x) => x.id === bBaja.dataset.afBaja);
      if (!a) return;
      const bancos = window.__cuentasEfectivo ? window.__cuentasEfectivo() : [];
      window.openFormModal({
        title: 'Dar de baja ' + a.codigo + ' · ' + a.nombre, saveLabel: 'Dar de baja',
        fields: [
          { name: 'x', label: ' ', col: 2, type: 'static', html: '<div style="font-size:12.5px;color:var(--fg-body);">Costo Bs ' + fmt2(Number(a.costo) || 0)
            + ' · depreciado Bs ' + fmt2(Number(a.depreciacion_acum) || 0) + '. Con precio 0 es una desincorporación (la pérdida va a 6.3.1.05); con precio, una venta. Ojo: el ingreso lo registra esta baja; si además cargas la factura de la venta en el libro de ventas, entraría dos veces.</div>' },
          { name: 'fecha', label: 'Fecha de la baja', type: 'date', value: window.__hoyISO() },
          { name: 'precio', label: 'Precio de venta (Bs, sin IVA)', type: 'number', step: '0.01', value: '0' },
          { name: 'cobro', label: 'Dónde entra el dinero', type: 'select', value: '1.1.1.03',
            options: (bancos.length ? bancos : [{ codigo: '1.1.1.03', nombre: 'Bancos' }]).map((c) => ({ value: c.codigo, label: c.codigo + ' · ' + c.nombre }))
              .concat([{ value: '1.1.2.01', label: '1.1.2.01 · Cuentas por cobrar (a crédito)' }]) },
        ],
        onSave: (v) => {
          const precio = parseFloat(v.precio) || 0;
          if (!v.fecha) return 'Falta la fecha de la baja.';
          if (precio < 0) return 'El precio no puede ser negativo.';
          window.sb.rpc('contab_baja_activo', { p_activo: a.id, p_fecha: v.fecha, p_precio: precio, p_cuenta_cobro: v.cobro }).then(({ error }) => {
            if (error) { toast('No se pudo dar de baja: ' + error.message, 'error'); return; }
            if (window.cargarAsientos) window.cargarAsientos();
            cargarActivosFijos();
            toast((precio > 0 ? 'Venta' : 'Desincorporación') + ' de ' + a.codigo + ' contabilizada · revisa el asiento en el Libro Diario', 'success');
          });
        },
      });
    });

    // ---- Depreciación de un mes (la calcula y contabiliza la base) ----
    /* Rehacer un mes da lo mismo: la base guarda una cuota por activo y mes.
       «Cerrar mes» también la corre antes de la liquidación. */
    const deprBtn = document.getElementById('deprRunBtn');
    if (deprBtn) deprBtn.addEventListener('click', () => {
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { toast('No hay una empresa activa', 'error'); return; }
      const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      const h = window.__hoyISO().split('-');
      const meses = [];
      for (let i = 0; i < 13; i++) {
        const d = new Date(+h[0], +h[1] - 1 - i, 1, 12);
        meses.push({ value: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: MES[d.getMonth()] + ' ' + d.getFullYear() });
      }
      window.openFormModal({
        title: 'Depreciación del mes', saveLabel: 'Calcular y contabilizar',
        fields: [{ name: 'mes', label: 'Mes', type: 'select', options: meses, value: meses[1].value }],
        onSave: (v) => {
          window.sb.rpc('contab_depreciar', { p_empresa: window.__EMPRESA_ACTIVA.id, p_periodo: v.mes }).then(({ data: total, error }) => {
            if (error) { toast('No se pudo depreciar: ' + error.message, 'error'); return; }
            if (window.cargarAsientos) window.cargarAsientos();        // refresca Diario, Mayor, Balance, Estados
            cargarActivosFijos();
            const et = (meses.find((m) => m.value === v.mes) || {}).label || v.mes;
            toast(Number(total) > 0 ? ('Depreciación de ' + et + ' contabilizada · Bs ' + fmt2(Number(total))) : ('Sin depreciación en ' + et), Number(total) > 0 ? 'success' : 'info');
          });
        },
      });
    });

    // ---- Exportar (libro diario) ----
    const exportDiario = document.getElementById('contaExportBtn');
    if (exportDiario) exportDiario.addEventListener('click', () => {
      const rows = [['Asiento', 'Fecha', 'Descripción', 'Referencia', 'Cuenta', 'Debe', 'Haber']];
      /* Se exportan los DATOS del período, no los asientos pintados. El Diario
         se pagina de 10 en 10: leyendo el DOM salía un CSV con diez asientos
         que parecía el libro completo. */
      const _exp = (window.__diarioDelMes || []).slice().sort((a, b) => (a.numero || 0) - (b.numero || 0));
      _exp.forEach((a) => {
        const num = a.numero != null ? String(a.numero).padStart(4, '0') : '';
        const fecha = a.fecha || '';
        const desc = a.descripcion || '';
        const ref = a.referencia || '';
        (Array.isArray(a.lineas) ? a.lineas : []).forEach((l) => {
          rows.push([num, fecha, desc, ref, l.cta || '',
            Number(l.debe) || 0 ? String(l.debe) : '', Number(l.haber) || 0 ? String(l.haber) : '']);
        });
      });
      csvDownload(rows, 'Libro_Diario_' + _rango().etiqueta.replace(/[^0-9A-Za-zÁÉÍÓÚáéíóúñÑ]+/g, '_') + '.csv');
      toast('Libro Diario exportado a CSV');
    });

    // ---- Exportar (activos fijos) ----
    const exportActivos = document.getElementById('activosExportBtn');
    if (exportActivos) exportActivos.addEventListener('click', () => {
      const table = view.querySelector('.conta-tab[data-tab="activos"] table.data-table');
      if (!table) return;
      const rows = [];
      rows.push([...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()));
      table.querySelectorAll('tbody tr').forEach((tr) => {
        rows.push([...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
      });
      csvDownload(rows, 'Activos_Fijos_Ejercicio_' + ejercicioInfo().anio + '.csv');
      toast('Registro de activos exportado a CSV');
    });

    // ---- Imprimir Libro Diario (vertical) ----
    const diarioPrint = document.getElementById('diarioPrintBtn');
    if (diarioPrint) diarioPrint.addEventListener('click', () => {
      // Imprime TODOS los asientos del mes seleccionado (no solo la página visible)
      const d = window.__diarioPrintData ? window.__diarioPrintData() : null;
      const tmp = document.createElement('div');
      tmp.className = 'journal';
      tmp.innerHTML = d && d.html ? d.html : '<div style="padding:20px;">Sin asientos en el período.</div>';
      printContaDoc(tmp, { titulo: d ? d.titulo : 'Libro Diario', sub: d ? d.sub : undefined, orient: 'portrait' });
    });
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
    });

    // ---- Búsqueda en el Libro Diario (filtra asientos) ----
    const diarioSearch = view.querySelector('.conta-tab[data-tab="diario"] .quick-search input');
    if (diarioSearch) diarioSearch.addEventListener('input', () => {
      const q = diarioSearch.value.trim().toLowerCase();
      view.querySelectorAll('.conta-tab[data-tab="diario"] .asiento').forEach((a) => {
        a.style.display = (!q || a.textContent.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    /* El Mayor lo pinta renderMayorTree / renderMayorLedger con el período de la barra. */

    // ---- Exportar Mayor (CSV de la cuenta activa) ----
    const mayorExport = document.getElementById('mayorExportBtn');
    if (mayorExport) mayorExport.addEventListener('click', () => {
      const code = (document.getElementById('mayorBadge') || {}).textContent || '';
      const name = (document.getElementById('mayorTitle') || {}).textContent || '';
      const rows = [['Cuenta: ' + code + ' · ' + name], [], ['Fecha', 'Asiento', 'Descripción', 'Referencia', 'Debe', 'Haber', 'Saldo']];
      view.querySelectorAll('#mayorBody tr').forEach((tr) => {
        rows.push([...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
      });
      csvDownload(rows, 'Mayor_' + code + '_Ejercicio_' + ejercicioInfo().anio + '.csv');
      toast('Mayor de ' + code + ' exportado a CSV');
    });

    // ---- Estados financieros: Imprimir / Exportar (Balance, Resultados, General, Flujo) ----
    // Cada estado clona solo su contenido esencial. Resultados/Flujo ya traen su propia
    // cabecera (noHead); Balance/General usan la cabecera generada.
    const finMeta = {
      balance: { nombre: 'Balance de Comprobación', orient: 'landscape', subFn: () => periodoTexto() + ' · Bs', sel: 'table.balance-table', head: true },
      resultados: { nombre: 'Estado de Resultados', orient: 'portrait', sel: '.fin-statement', head: false },
      general: { nombre: 'Balance General', orient: 'portrait', subFn: () => 'Al ' + _dmy(corteISO()) + ' · Bs', sel: '.fin-two-col', head: true },
      flujo: { nombre: 'Flujo de Efectivo', orient: 'portrait', sel: '.fin-statement', head: false },
    };
    view.querySelectorAll('[data-fin-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pane = btn.closest('.conta-tab');
        if (!pane) return;
        const meta = finMeta[pane.dataset.tab] || { nombre: pane.dataset.tab, orient: 'portrait', sel: 'table', head: true };
        const metaSub = meta.subFn ? meta.subFn() : meta.sub;
        if (btn.dataset.finAction === 'export') {
          const table = pane.querySelector('table');
          if (!table) { toast('No hay tabla para exportar', 'error'); return; }
          const rows = [];
          table.querySelectorAll('tr').forEach((tr) => {
            const cells = tr.querySelectorAll('th,td');
            if (cells.length) rows.push([...cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
          });
          csvDownload(rows, meta.nombre.replace(/ /g, '_') + '_Ejercicio_' + ejercicioInfo().anio + '.csv');
          toast(meta.nombre + ' exportado a CSV');
        } else {
          const src = pane.querySelector(meta.sel) || pane;
          printContaDoc(src, { titulo: meta.nombre, orient: meta.orient, sub: metaSub, noHead: !meta.head });
        }
      });
    });

    // ---- Imprimir Mayor (vertical) ----
    const mayorPrint = document.getElementById('mayorPrintBtn');
    if (mayorPrint) mayorPrint.addEventListener('click', () => {
      const panel = view.querySelector('.conta-tab[data-tab="mayor"] .panel');
      const code = (document.getElementById('mayorBadge') || {}).textContent || '';
      const name = (document.getElementById('mayorTitle') || {}).textContent || '';
      printContaDoc(panel, { titulo: 'Libro Mayor · ' + code, sub: name + ' · ' + periodoTexto(), orient: 'portrait' });
    });

    // ---- Imprimir Plan de Cuentas (vertical, solo la tabla) ----
    const planPrint = document.getElementById('planPrintBtn');
    if (planPrint) planPrint.addEventListener('click', () => {
      const table = view.querySelector('.conta-tab[data-tab="plan"] table.data-table');
      printContaDoc(table, { titulo: 'Plan de Cuentas', sub: 'Catálogo de cuentas · VEN-NIF · ' + ejercicioInfo().anio, orient: 'portrait' });
    });

    // ---- Imprimir Activos Fijos (horizontal, solo el registro) ----
    const activosPrint = document.getElementById('activosPrintBtn');
    if (activosPrint) activosPrint.addEventListener('click', () => {
      const table = view.querySelector('.conta-tab[data-tab="activos"] .data-table-wrap table.data-table');
      printContaDoc(table, { titulo: 'Registro de Activos Fijos y Depreciación', sub: ejercicioInfo().label + ' · Bs', orient: 'landscape' });
    });
  })();
})();
