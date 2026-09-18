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
        const numero = (asientoNum || 0) + 1;
        const lineasDB = lineas.map((l) => ({ cta: l.cta, debe: l.d, haber: l.h }));
        window.sb.from('asientos').insert({
          cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
          numero: numero, fecha: fecha, descripcion: desc, referencia: ref, origen: 'manual',
          lineas: lineasDB, total: totD,
        }).then(({ error }) => {
          if (error) { setMsg('No se pudo guardar: ' + error.message); return; }
          toast('Asiento #0' + numero + ' registrado · ' + lineas.length + ' líneas · cuadra en Bs ' + fmt2(totD));
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
      // Carga los asientos reales de la empresa activa desde Supabase (Diario paginado: 10 por página)
      let _diarioPage = 1, _diarioMes = '';
      const _asiMes = (a) => { const p = String(a.fecha || '').split('/'); return p.length === 3 ? ('20' + (p[2].length === 2 ? p[2] : p[2].slice(2)) + '-' + String(p[1]).padStart(2, '0')) : ''; };
      const _MESES_D = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      async function cargarAsientos(page) {
        if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return;
        const journal = view.querySelector('.conta-tab[data-tab="diario"] .journal');
        if (!journal) return;
        const { data, error } = await window.__sbAll((q) => q.eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('numero', { ascending: false }), 'asientos', '*');
        if (error) { console.warn('[DigiAccount] No se pudieron cargar asientos:', error.message); return; }
        journal.innerHTML = '';
        let maxNum = 0;
        (data || []).forEach((a) => { if (a.numero > maxNum) maxNum = a.numero; });
        asientoNum = maxNum;
        asientosData = data || [];
        // Poblar el selector de meses (una vez por carga) con los meses que tienen asientos
        const sel = document.getElementById('diarioMesSel');
        if (sel) {
          const meses = Array.from(new Set(asientosData.map(_asiMes).filter(Boolean))).sort().reverse();
          const cur = sel.value;
          sel.innerHTML = '<option value="">Todos los meses</option>' + meses.map((m) => '<option value="' + m + '">' + _MESES_D[parseInt(m.slice(5, 7), 10) - 1] + ' ' + m.slice(0, 4) + '</option>').join('');
          if (meses.indexOf(cur) >= 0) sel.value = cur; else _diarioMes = '';
          _diarioMes = sel.value;
        }
        // Asientos del mes seleccionado (o todos), en orden cronológico para el Diario
        const delMes = (_diarioMes ? asientosData.filter((a) => _asiMes(a) === _diarioMes) : asientosData.slice())
          .sort((a, b) => (a.numero || 0) - (b.numero || 0));
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
        window.__diarioDelMes = delMes; // para imprimir el período visible
        if (typeof renderReportes === 'function') renderReportes();   // recalcula Mayor y Balance
        // KPIs de la cabecera de Contabilidad (datos reales)
        const totDebe = delMes.reduce((s, a) => s + (Number(a.total) || 0), 0);
        const ctas = new Set();
        asientosData.forEach((a) => { (Array.isArray(a.lineas) ? a.lineas : []).forEach((l) => { const c = (l.cta || '').split(' · ')[0]; if (c) ctas.add(c); }); });
        const setC = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const fmt2 = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        setC('contaKpiAsientos', String(asientosData.length));
        setC('contaKpiDebe', fmt2(totDebe));
        setC('contaKpiHaber', fmt2(totDebe));
        setC('contaKpiCuentas', String(ctas.size));
        setC('contaDiarioCount', String(delMes.length));
        setC('contaMovMes', 'Bs ' + fmt2(totDebe));
        console.log('[DigiAccount] Asientos cargados:', (data || []).length);
        drawIcons();
      }
      window.cargarAsientos = cargarAsientos;
      // Datos para imprimir el Libro Diario del mes seleccionado (todos los asientos, sin paginar)
      window.__diarioPrintData = () => {
        const sel = document.getElementById('diarioMesSel');
        const lbl = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : 'Todos los meses';
        const arr = window.__diarioDelMes || [];
        // Ejercicio derivado de los asientos impresos (no fijo): un año, o rango si abarca varios
        const anios = Array.from(new Set(arr.map((a) => { const m = _asiMes(a); return m ? m.slice(0, 4) : ''; }).filter(Boolean))).sort();
        const ej = anios.length ? (anios.length === 1 ? anios[0] : anios[0] + '–' + anios[anios.length - 1]) : String(new Date().getFullYear());
        return { html: arr.map(asientoHTML).join(''), titulo: 'Libro Diario · ' + lbl, sub: 'Ejercicio ' + ej + ' · Expresado en bolívares (Bs)' };
      };
      view.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-dp-dir]');
        if (b && !b.disabled) cargarAsientos(_diarioPage + parseInt(b.dataset.dpDir, 10));
      });
      // Cambio de mes en el Libro Diario
      view.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'diarioMesSel') { _diarioMes = e.target.value; _diarioPage = 1; cargarAsientos(1); }
      });
    })();

    // Ayudante reutilizable: cualquier módulo puede generar un asiento contable (depreciación, cripto, etc.)
    window.__postAsiento = async function (descripcion, referencia, lineas, origen) {
      if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return { error: { message: 'No hay una empresa activa' } };
      const total = (lineas || []).reduce((s, l) => s + (Number(l.debe) || 0), 0);
      const hoy = new Date();
      const fecha = String(hoy.getDate()).padStart(2, '0') + '/' + String(hoy.getMonth() + 1).padStart(2, '0') + '/' + hoy.getFullYear();
      const res = await window.sb.from('asientos').insert({
        cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
        numero: (asientoNum || 0) + 1, fecha: fecha, descripcion: descripcion, referencia: referencia || '', origen: origen || 'auto',
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

    // ---- Plan de cuentas: cuentas PROPIAS de la empresa (persisten en Supabase) ----
    function filaCuentaCustom(c) {
      const tagTipo = c.tipo === 'Grupo' ? 'navy' : 'slate';
      const nivel = (c.codigo || '').split('.').length - 1;
      const indent = '&nbsp;'.repeat(nivel * 3);
      return '<tr data-custom="1"><td class="mono">' + (c.codigo || '') + '</td><td class="primary">' + indent + (c.nombre || '') + '</td>'
        + '<td><span class="tag ' + tagTipo + '">' + (c.tipo || 'Cuenta') + '</span></td><td>' + (c.naturaleza || '') + '</td>'
        + '<td class="num">0,00</td><td><span class="tag cyan">Propia</span></td></tr>';
    }
    async function cargarCuentasContables() {
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return;
      const tbody = view.querySelector('.conta-tab[data-tab="plan"] table.data-table tbody');
      if (!tbody) return;
      tbody.querySelectorAll('tr[data-custom]').forEach((tr) => tr.remove());   // limpia las de la empresa anterior
      const { data, error } = await window.sb.from('cuentas_contables').select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('codigo');
      if (error) { console.warn('[DigiAccount] No se pudieron cargar cuentas contables:', error.message); return; }
      (data || []).forEach((c) => tbody.insertAdjacentHTML('beforeend', filaCuentaCustom(c)));
      console.log('[DigiAccount] Cuentas contables propias:', (data || []).length);
      if (window.refreshTables) window.refreshTables();
      drawIcons();
    }
    window.cargarCuentasContables = cargarCuentasContables;

    // ======= ETAPA 3: Libro Mayor + Balance de Comprobación (de los asientos reales) =======
    const parseCta = (s) => { const i = (s || '').indexOf(' · '); return i < 0 ? { c: '—', n: s || '' } : { c: s.slice(0, i), n: s.slice(i + 3) }; };

    // Agrupa los movimientos por cuenta (debe, haber y lista de movimientos)
    function agregarPorCuenta() {
      const map = new Map();
      (asientosData || []).forEach((a) => {
        (Array.isArray(a.lineas) ? a.lineas : []).forEach((l) => {
          const p = parseCta(l.cta);
          if (!map.has(p.c)) map.set(p.c, { code: p.c, nombre: p.n, debe: 0, haber: 0, movs: [] });
          const e = map.get(p.c);
          const d = Number(l.debe) || 0, h = Number(l.haber) || 0;
          e.debe += d; e.haber += h;
          e.movs.push({ fecha: a.fecha, num: a.numero, desc: a.descripcion, ref: a.referencia, d: d, h: h });
        });
      });
      return map;
    }

    // Ejercicio fiscal derivado de los asientos: año calendario (1 ene → 31 dic),
    // salvo el PRIMER ejercicio, que va desde el inicio de actividades (primer
    // asiento) hasta el 31 dic de ese año. El "corte" es la fecha del último asiento.
    const _MESES_EJ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    function ejercicioInfo() {
      const parse = (f) => { const p = String(f || '').split('/'); if (p.length < 3) return null; let y = p[2]; y = y.length === 2 ? '20' + y : y; const o = { y: +y, m: +p[1], d: +p[0] }; o.key = o.y * 10000 + o.m * 100 + o.d; return o; };
      const ps = (asientosData || []).map((a) => parse(a.fecha)).filter(Boolean).sort((a, b) => a.key - b.key);
      const fstr = (p) => p.d + ' de ' + _MESES_EJ[p.m - 1] + ' de ' + p.y;
      if (!ps.length) { const y = new Date().getFullYear(); return { anio: y, corteStr: '', inicioStr: '', label: 'Ejercicio ' + y, periodo: 'Ejercicio ' + y }; }
      const corte = ps[ps.length - 1], anio = corte.y;
      // Los estados son acumulados: el período va desde el inicio de actividades
      // (primer asiento) hasta el corte. Si algún día se filtra por ejercicio, aquí
      // se aplicaría 1-ene→31-dic salvo el primer ejercicio (desde el inicio).
      const ini = ps[0];
      return { anio: anio, corteStr: fstr(corte), inicioStr: fstr(ini), label: 'Ejercicio ' + anio, periodo: 'Del ' + fstr(ini) + ' al ' + fstr(corte) };
    }
    window.__ejercicioInfo = ejercicioInfo;

    function renderBalance(map) {
      const tbody = view.querySelector('.conta-tab[data-tab="balance"] table.balance-table tbody');
      const tfoot = view.querySelector('.conta-tab[data-tab="balance"] table.balance-table tfoot');
      if (!tbody) return;
      const cuentas = Array.from(map.values()).filter((c) => c.debe !== 0 || c.haber !== 0).sort((a, b) => a.code.localeCompare(b.code));
      let tDebe = 0, tHaber = 0, tSD = 0, tSA = 0;
      tbody.innerHTML = cuentas.map((c) => {
        const saldo = c.debe - c.haber, sd = saldo > 0 ? saldo : 0, sa = saldo < 0 ? -saldo : 0;
        tDebe += c.debe; tHaber += c.haber; tSD += sd; tSA += sa;
        return '<tr><td class="mono">' + c.code + '</td><td class="primary">' + c.nombre + '</td><td class="num">—</td>'
          + '<td class="num">' + (c.debe ? fmt2(c.debe) : '—') + '</td><td class="num">' + (c.haber ? fmt2(c.haber) : '—') + '</td>'
          + '<td class="num">' + (sd ? fmt2(sd) : '—') + '</td><td class="num">' + (sa ? fmt2(sa) : '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:14px;">Aún no hay movimientos. Registra asientos en el Libro Diario.</td></tr>';
      if (tfoot) tfoot.innerHTML = '<tr><td colspan="3" class="lbl-cell">Totales</td>'
        + '<td class="num" style="text-align:right;">' + fmt2(tDebe) + '</td><td class="num" style="text-align:right;">' + fmt2(tHaber) + '</td>'
        + '<td class="num" style="text-align:right;">' + fmt2(tSD) + '</td><td class="num" style="text-align:right;">' + fmt2(tSA) + '</td></tr>';
      const ok = Math.abs(tDebe - tHaber) < 0.009 && Math.abs(tSD - tSA) < 0.009;
      const okEl = view.querySelector('.conta-tab[data-tab="balance"] .balance-ok');
      if (okEl) okEl.innerHTML = ok ? '<i data-lucide="check-circle-2"></i> Sumas iguales · cuadrado' : '<i data-lucide="alert-circle"></i> Descuadrado';
      const cnt = view.querySelector('.conta-tab[data-tab="balance"] .table-footer .count');
      if (cnt) cnt.innerHTML = cuentas.length + ' cuentas con movimiento · <strong>Débitos = Créditos</strong> y <strong>Saldos deudores = acreedores</strong>';
    }

    let _mayorPage = 1, _mayorCode = null, _mayorMap = null; // paginación del Mayor (20 movimientos por página)
    function renderMayorLedger(code, map, page) {
      const c = map.get(code); if (!c) return;
      _mayorCode = code; _mayorMap = map;
      const setTxt = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
      const saldo = c.debe - c.haber;
      setTxt('mayorBadge', c.code); setTxt('mayorTitle', c.nombre);
      setTxt('mayorSub', 'Naturaleza ' + (saldo >= 0 ? 'deudora' : 'acreedora'));
      setTxt('mayorSaldoLbl', saldo >= 0 ? 'Saldo final deudor' : 'Saldo final acreedor');
      setTxt('mayorSaldoVal', 'Bs ' + fmt2(Math.abs(saldo)));
      const tbody = document.getElementById('mayorBody');
      // Saldo corrido calculado sobre TODOS los movimientos (correcto en cualquier página)
      let run = 0;
      const movs = (c.movs || []).map((m) => { run += (m.d || 0) - (m.h || 0); return { m: m, run: run }; });
      const MP = 20;
      const totalPagM = Math.max(1, Math.ceil(movs.length / MP));
      _mayorPage = Math.min(Math.max(1, page || 1), totalPagM);
      const iniM = (_mayorPage - 1) * MP;
      let rows = movs.slice(iniM, iniM + MP).map((x) => {
        const m = x.m;
        return '<tr><td>' + (m.fecha || '') + '</td><td class="mono">#0' + m.num + '</td><td class="primary">' + (m.desc || '') + '</td>'
          + '<td class="mono">' + (m.ref || '—') + '</td><td class="num">' + (m.d ? fmt2(m.d) : '—') + '</td><td class="num">' + (m.h ? fmt2(m.h) : '—') + '</td>'
          + '<td class="saldo">' + fmt2(Math.abs(x.run)) + '</td></tr>';
      }).join('');
      if (totalPagM > 1) {
        rows += '<tr><td colspan="7" style="padding:6px 10px;"><div style="display:flex;justify-content:center;align-items:center;gap:14px;font-size:12px;color:var(--fg-muted);">'
          + '<button class="btn btn-ghost" data-mp-dir="-1"' + (_mayorPage <= 1 ? ' disabled' : '') + ' style="height:26px;font-size:11px;">« Anterior</button>'
          + '<span>Página ' + _mayorPage + ' de ' + totalPagM + ' · ' + movs.length + ' movimientos</span>'
          + '<button class="btn btn-ghost" data-mp-dir="1"' + (_mayorPage >= totalPagM ? ' disabled' : '') + ' style="height:26px;font-size:11px;">Siguiente »</button></div></td></tr>';
      }
      if (tbody) tbody.innerHTML = rows || '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin movimientos</td></tr>';
      setTxt('mayorTotDeb', fmt2(c.debe)); setTxt('mayorTotHaber', fmt2(c.haber)); setTxt('mayorTotSaldo', fmt2(Math.abs(saldo)));
    }
    view.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mp-dir]');
      if (b && !b.disabled && _mayorCode && _mayorMap) renderMayorLedger(_mayorCode, _mayorMap, _mayorPage + parseInt(b.dataset.mpDir, 10));
    });

    function renderMayorTree(map) {
      const body = view.querySelector('.conta-tab[data-tab="mayor"] .account-tree-body');
      if (!body) return;
      const cuentas = Array.from(map.values()).filter((c) => c.debe !== 0 || c.haber !== 0).sort((a, b) => a.code.localeCompare(b.code));
      const grupos = { '1': '1 · Activo', '2': '2 · Pasivo', '3': '3 · Patrimonio', '4': '4 · Ingresos', '5': '5 · Costos', '6': '6 · Gastos' };
      let html = '', lastG = '';
      cuentas.forEach((c) => {
        const g = c.code.charAt(0);
        if (g !== lastG) { html += '<div class="acc-group-label">' + (grupos[g] || g) + '</div>'; lastG = g; }
        html += '<div class="acc-item" data-code="' + c.code + '"><span class="code">' + c.code + '</span><span class="nm">' + c.nombre + '</span><span class="bal">' + fmt2(Math.abs(c.debe - c.haber)) + '</span></div>';
      });
      body.innerHTML = html || '<div class="acc-group-label">Sin movimientos aún</div>';
      body.querySelectorAll('.acc-item').forEach((it) => it.addEventListener('click', () => {
        body.querySelectorAll('.acc-item').forEach((x) => x.removeAttribute('data-active'));
        it.dataset.active = 'true'; renderMayorLedger(it.dataset.code, map);
      }));
      const first = body.querySelector('.acc-item');
      if (first) { first.dataset.active = 'true'; renderMayorLedger(first.dataset.code, map); }
      if (window.lucide) window.lucide.createIcons();
    }

    // Saldo según naturaleza: Activo/Costo/Gasto (1,5,6) = debe−haber; Pasivo/Patrimonio/Ingreso (2,3,4) = haber−debe
    function saldoNatural(c) {
      const g = c.code.charAt(0);
      return (g === '1' || g === '5' || g === '6') ? (c.debe - c.haber) : (c.haber - c.debe);
    }

    // ===== Estados financieros por NIVELES (práctica del contador): =====
    // nivel 1 = solo cuentas mayores, cada nivel baja un escalón del plan; 0 = detalle completo.
    let _finNivel = 0;
    let _planNombres = null;
    function nombreCta(code) {
      if (!_planNombres) {
        _planNombres = { '1': 'Activo', '2': 'Pasivo', '3': 'Patrimonio', '4': 'Ingresos', '5': 'Costos', '6': 'Gastos' };
        try { getCuentasPlan().forEach((c) => { if (!_planNombres[c.code]) _planNombres[c.code] = c.name; }); } catch (e) { /* plan aún no pintado */ }
      }
      return _planNombres[code] || code;
    }
    // Enrolla los saldos de las cuentas hijas hacia su cuenta padre a la profundidad pedida
    function rollUp(cuentas, nivel) {
      if (!nivel) return cuentas;
      const m = new Map();
      cuentas.forEach((c) => {
        const code = c.code.split('.').slice(0, nivel).join('.');
        if (!m.has(code)) m.set(code, { code: code, nombre: nombreCta(code), debe: 0, haber: 0 });
        const e = m.get(code);
        e.debe += c.debe; e.haber += c.haber;
      });
      return Array.from(m.values());
    }

    function renderEstadoResultados(map) {
      const tab = view.querySelector('.conta-tab[data-tab="resultados"]');
      if (!tab) return 0;
      const cuentas = rollUp(Array.from(map.values()).filter((c) => c.debe !== 0 || c.haber !== 0), _finNivel);
      const porGrupo = (g) => cuentas.filter((c) => c.code.charAt(0) === g).sort((a, b) => a.code.localeCompare(b.code));
      const sum = (arr) => arr.reduce((s, c) => s + saldoNatural(c), 0);
      const ing = porGrupo('4'), cos = porGrupo('5'), gas = porGrupo('6');
      const totIng = sum(ing), totCos = sum(cos), totGas = sum(gas);
      const utilBruta = totIng - totCos, utilOper = utilBruta - totGas, utilNeta = utilOper;
      const linea = (c) => '<tr class="line-detail"><td class="label"><span class="sub-acc">' + c.code + '</span>' + c.nombre + '</td><td class="amount">' + fmt2(Math.abs(saldoNatural(c))) + '</td><td class="amount pct"></td></tr>';
      const sh = (t) => '<tr class="section-head"><td class="label">' + t + '</td><td class="amount"></td><td class="amount pct"></td></tr>';
      const st = (t, v) => '<tr class="subtotal"><td class="label">' + t + '</td><td class="amount">' + fmt2(v) + '</td><td class="amount pct"></td></tr>';
      let html = sh('Ingresos') + (ing.map(linea).join('') || '<tr class="line-detail"><td class="label">Sin ingresos</td><td class="amount">—</td><td class="amount pct"></td></tr>') + st('Total ingresos', totIng);
      html += sh('Costo de ventas') + (cos.map(linea).join('') || '<tr class="line-detail"><td class="label">Sin costos</td><td class="amount">—</td><td class="amount pct"></td></tr>') + st('Utilidad bruta', utilBruta);
      html += sh('Gastos') + (gas.map(linea).join('') || '<tr class="line-detail"><td class="label">Sin gastos</td><td class="amount">—</td><td class="amount pct"></td></tr>') + st('Total gastos', totGas);
      html += '<tr class="grand-total"><td class="label">' + (utilNeta >= 0 ? 'Utilidad' : 'Pérdida') + ' neta del ejercicio</td><td class="amount">' + fmt2(Math.abs(utilNeta)) + '</td><td class="amount pct"></td></tr>';
      const tbody = tab.querySelector('.fin-table tbody'); if (tbody) tbody.innerHTML = html;
      const hv = tab.querySelectorAll('.fin-hi .v'), hd = tab.querySelectorAll('.fin-hi .d');
      if (hv[0]) hv[0].textContent = 'Bs ' + fmt2(totIng);
      if (hv[1]) hv[1].textContent = 'Bs ' + fmt2(utilBruta);
      if (hv[2]) hv[2].textContent = 'Bs ' + fmt2(utilOper);
      if (hv[3]) hv[3].textContent = 'Bs ' + fmt2(utilNeta);
      hd.forEach((d) => (d.innerHTML = ''));
      const co = tab.querySelector('.fin-statement-head .co');
      if (co && window.__EMPRESA_ACTIVA) co.textContent = window.__EMPRESA_ACTIVA.n + ' · ' + (window.__EMPRESA_ACTIVA.rif || '');
      const perER = tab.querySelector('.fin-statement-head .period'); if (perER) perER.textContent = ejercicioInfo().periodo;
      return utilNeta;
    }

    function renderBalanceGeneral(map, utilNeta) {
      const tab = view.querySelector('.conta-tab[data-tab="general"]');
      if (!tab) return;
      // El Balance necesita separar corriente/no corriente → profundidad mínima 2
      const nivelBG = _finNivel === 1 ? 2 : _finNivel;
      const cuentas = rollUp(Array.from(map.values()).filter((c) => c.debe !== 0 || c.haber !== 0), nivelBG);
      const byPfx = (p) => cuentas.filter((c) => c.code.indexOf(p) === 0).sort((a, b) => a.code.localeCompare(b.code));
      const sum = (arr) => arr.reduce((s, c) => s + saldoNatural(c), 0);
      const aC = byPfx('1.1'), aNC = byPfx('1.2'), pC = byPfx('2.1'), pNC = byPfx('2.2'), pat = cuentas.filter((c) => c.code.charAt(0) === '3').sort((a, b) => a.code.localeCompare(b.code));
      const tAC = sum(aC), tANC = sum(aNC), tAct = tAC + tANC, tPC = sum(pC), tPNC = sum(pNC), tPas = tPC + tPNC, tPat = sum(pat) + utilNeta;
      const linea = (c) => '<tr class="line-detail"><td class="label"><span class="sub-acc">' + c.code + '</span>' + c.nombre + '</td><td class="amount">' + fmt2(Math.abs(saldoNatural(c))) + '</td></tr>';
      const sh = (t) => '<tr class="section-head"><td class="label">' + t + '</td><td class="amount"></td></tr>';
      const st = (t, v) => '<tr class="subtotal"><td class="label">' + t + '</td><td class="amount">' + fmt2(v) + '</td></tr>';
      const gt = (t, v) => '<tr class="grand-total"><td class="label">' + t + '</td><td class="amount">' + fmt2(v) + '</td></tr>';
      let hA = sh('Activo Corriente') + aC.map(linea).join('') + st('Total activo corriente', tAC) + sh('Activo No Corriente') + aNC.map(linea).join('') + st('Total activo no corriente', tANC) + gt('Total activo', tAct);
      let hP = sh('Pasivo Corriente') + pC.map(linea).join('') + st('Total pasivo corriente', tPC) + sh('Pasivo No Corriente') + pNC.map(linea).join('') + st('Total pasivo', tPas);
      hP += sh('Patrimonio') + pat.map(linea).join('') + '<tr class="line-detail"><td class="label"><span class="sub-acc">3.2.3</span>' + (utilNeta >= 0 ? 'Utilidad' : 'Pérdida') + ' del ejercicio</td><td class="amount">' + fmt2(Math.abs(utilNeta)) + '</td></tr>' + st('Total patrimonio', tPat) + gt('Pasivo + Patrimonio', tPas + tPat);
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
      const coBG = tab.querySelector('.fin-statement-head .co');
      if (coBG && window.__EMPRESA_ACTIVA) coBG.textContent = window.__EMPRESA_ACTIVA.n + ' · ' + (window.__EMPRESA_ACTIVA.rif || '');
      tab.querySelectorAll('.fin-statement-head .period').forEach((p) => { p.textContent = 'Al ' + ejercicioInfo().corteStr + ' · Bs'; });
      // Expone los totales para el módulo de Grandes Patrimonios (IGP)
      window.__BALANCE = { activo: tAct, pasivo: tPas, patrimonio: tPat };
      if (window.__renderIGP) window.__renderIGP();
    }

    // Flujo de Efectivo (método directo): clasifica los movimientos de caja/bancos por su contrapartida
    function renderFlujo() {
      const tab = view.querySelector('.conta-tab[data-tab="flujo"]');
      if (!tab) return;
      const esCaja = (code) => code.indexOf('1.1.1') === 0;
      const cats = { op: new Map(), inv: new Map(), fin: new Map() };
      let efectivoFinal = 0;
      (asientosData || []).forEach((a) => {
        const lineas = (Array.isArray(a.lineas) ? a.lineas : []).map((l) => { const p = parseCta(l.cta); return { code: p.c, nombre: p.n, d: Number(l.debe) || 0, h: Number(l.haber) || 0 }; });
        lineas.forEach((l) => { if (esCaja(l.code)) efectivoFinal += l.d - l.h; });
        const cajaLines = lineas.filter((l) => esCaja(l.code));
        const counters = lineas.filter((l) => !esCaja(l.code));
        if (!cajaLines.length || !counters.length) return;
        const netCash = cajaLines.reduce((s, l) => s + (l.d - l.h), 0);
        const codes = counters.map((c) => c.code);
        let cat = 'op';
        if (codes.some((c) => c.indexOf('1.2') === 0)) cat = 'inv';
        else if (codes.some((c) => c.charAt(0) === '3' || c.indexOf('2.2') === 0)) cat = 'fin';
        const primary = counters.reduce((x, y) => ((y.d + y.h) > (x.d + x.h) ? y : x), counters[0]);
        const m = cats[cat];
        if (!m.has(primary.code)) m.set(primary.code, { nombre: primary.nombre, monto: 0 });
        m.get(primary.code).monto += netCash;
      });
      const fmtM = (v) => v < 0 ? '(' + fmt2(Math.abs(v)) + ')' : fmt2(v);
      const clsM = (v) => v < 0 ? 'amount fin-neg' : 'amount fin-pos';
      function seccion(titulo, m, nombreFlujo) {
        let h = '<tr class="section-head"><td class="label">' + titulo + '</td><td class="amount"></td></tr>';
        let tot = 0;
        const ent = Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        if (!ent.length) h += '<tr class="line-detail"><td class="label">Sin movimientos</td><td class="amount">—</td></tr>';
        ent.forEach((kv) => { tot += kv[1].monto; h += '<tr class="line-detail"><td class="label">' + kv[1].nombre + '</td><td class="' + clsM(kv[1].monto) + '">' + fmtM(kv[1].monto) + '</td></tr>'; });
        h += '<tr class="subtotal"><td class="label">Flujo neto de ' + nombreFlujo + '</td><td class="' + clsM(tot) + '">' + fmtM(tot) + '</td></tr>';
        return { h: h, tot: tot };
      }
      const sOp = seccion('Actividades de operación', cats.op, 'operación');
      const sInv = seccion('Actividades de inversión', cats.inv, 'inversión');
      const sFin = seccion('Actividades de financiamiento', cats.fin, 'financiamiento');
      const variacion = sOp.tot + sInv.tot + sFin.tot, inicial = 0, final = inicial + variacion;
      let html = sOp.h + sInv.h + sFin.h;
      html += '<tr class="subtotal"><td class="label">Aumento neto de efectivo</td><td class="' + clsM(variacion) + '">' + fmtM(variacion) + '</td></tr>';
      html += '<tr class="line-detail"><td class="label">Efectivo al inicio del período</td><td class="amount">' + fmt2(inicial) + '</td></tr>';
      html += '<tr class="grand-total"><td class="label">Efectivo al final del período</td><td class="amount">' + fmt2(final) + '</td></tr>';
      const tbody = tab.querySelector('.fin-table tbody'); if (tbody) tbody.innerHTML = html;
      const hv = tab.querySelectorAll('.fin-hi .v'), hd = tab.querySelectorAll('.fin-hi .d');
      if (hv[0]) hv[0].textContent = 'Bs ' + fmt2(inicial);
      if (hv[1]) hv[1].textContent = 'Bs ' + fmt2(sOp.tot);
      if (hv[2]) hv[2].textContent = 'Bs ' + fmt2(variacion);
      if (hv[3]) hv[3].textContent = 'Bs ' + fmt2(final);
      hd.forEach((d) => (d.innerHTML = ''));
      const co = tab.querySelector('.fin-statement-head .co');
      if (co && window.__EMPRESA_ACTIVA) co.textContent = window.__EMPRESA_ACTIVA.n + ' · ' + (window.__EMPRESA_ACTIVA.rif || '');
      const per = tab.querySelector('.fin-statement-head .period'); if (per) per.textContent = ejercicioInfo().periodo + ' · Método directo';
      const banner = tab.querySelector('.balance-check-banner');
      if (banner) banner.innerHTML = '<i data-lucide="check-circle-2"></i> Conciliado · Efectivo final Bs ' + fmt2(final) + ' coincide con el saldo de Caja y Bancos.';
    }

    // Selector de nivel (1 / 2 / 3 / Detalle) en Resultados y Balance General
    (function wireNiveles() {
      ['resultados', 'general'].forEach((t) => {
        const head = view.querySelector('.conta-tab[data-tab="' + t + '"] .fin-statement-head');
        if (!head || head.querySelector('.fin-nivel')) return;
        const d = document.createElement('div');
        d.className = 'fin-nivel';
        d.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:6px;';
        d.innerHTML = '<span style="font-size:11px;color:var(--fg-muted);font-weight:600;">Nivel de detalle:</span>'
          + [1, 2, 3, 0].map((n) => '<button class="btn btn-ghost" data-fin-nivel="' + n + '" style="height:24px;font-size:11px;padding:0 8px;"' + (n === _finNivel ? ' data-active="true"' : '') + '>' + (n === 0 ? 'Detalle' : 'Nivel ' + n) + '</button>').join('');
        head.appendChild(d);
      });
      view.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-fin-nivel]');
        if (!b) return;
        _finNivel = parseInt(b.dataset.finNivel, 10);
        view.querySelectorAll('button[data-fin-nivel]').forEach((x) => {
          if (parseInt(x.dataset.finNivel, 10) === _finNivel) { x.dataset.active = 'true'; } else { x.removeAttribute('data-active'); }
        });
        renderReportes();
      });
    })();

    function renderReportes() {
      const map = agregarPorCuenta();
      renderBalance(map);
      renderMayorTree(map);
      const utilNeta = renderEstadoResultados(map);
      renderBalanceGeneral(map, utilNeta || 0);
      renderFlujo();
      // Expone el enriquecimiento neto acumulado para el medidor de ISLR del ejercicio
      window.__UTILIDAD_NETA = utilNeta || 0;
      // Cabecera de Contabilidad: overline y chip de período reflejan el ejercicio real
      const ej = ejercicioInfo();
      const ov = view.querySelector('.dash-header .overline'); if (ov) ov.textContent = 'Libros legales · ' + ej.label;
      const dr = view.querySelector('.dash-header .date-range'); if (dr) dr.innerHTML = '<button data-active="true">' + ej.label + '</button>';
      if (window.__renderISLRanual) window.__renderISLRanual();
      if (window.lucide) window.lucide.createIcons();
    }
    // Al cargar (sin empresa/datos), pinta los reportes en cero → limpia el mock estático del HTML
    setTimeout(() => { try { renderReportes(); } catch (e) { console.warn('[DigiAccount] reportes init:', e.message); } }, 0);

    // ---- Registrar activo fijo ----
    const registrarActivo = document.getElementById('registrarActivoBtn');
    if (registrarActivo) registrarActivo.addEventListener('click', () => {
      window.openFormModal({
        title: 'Registrar activo fijo',
        saveLabel: 'Registrar activo',
        fields: [
          { name: 'cod', label: 'Código', placeholder: 'Ej. AF-025' },
          { name: 'nombre', label: 'Activo', col: 2, placeholder: 'Ej. Computador de oficina' },
          { name: 'cat', label: 'Categoría', type: 'select', options: ['Equipos', 'Vehículos', 'Inmuebles', 'Mobiliario', 'Maquinaria'] },
          { name: 'fecha', label: 'Fecha de adquisición', type: 'date', value: window.__hoyISO() },
          { name: 'costo', label: 'Costo (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
          { name: 'vida', label: 'Vida útil (años)', type: 'number', value: '5' },
          { name: 'metodo', label: 'Método', type: 'select', options: ['Línea recta', 'Saldos decrecientes'] },
        ],
        onSave: (v) => {
          const costo = parseFloat(v.costo);
          if (!v.cod || !v.nombre) return 'El código y el nombre del activo son obligatorios.';
          if (!(costo > 0)) return 'El costo debe ser mayor a cero.';
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          const fecha = v.fecha ? v.fecha.split('-').reverse().join('/') : '';
          window.sb.from('activos_fijos').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
            codigo: v.cod, nombre: v.nombre, categoria: v.cat, fecha_adq: fecha,
            costo: costo, vida_util: parseInt(v.vida, 10) || 5, metodo: v.metodo,
          }).then(({ error }) => {
            if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
            if (window.cargarActivosFijos) window.cargarActivosFijos();
            toast('Activo ' + v.cod + ' registrado · valor neto Bs ' + fmt2(costo));
          });
        },
      });
    });

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
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--fg-muted);padding:14px;">' + txt + '</td></tr>';
        setStats(0, 0, 0, 0); setDepPreview(0);
        if (footer) footer.textContent = '0 activos registrados';
        if (dmsg) dmsg.textContent = 'Sin depreciación pendiente';
        if (tabCount) tabCount.textContent = '0';
      };
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { activosData = []; vacio('Sin activos registrados.'); return; }
      const { data, error } = await window.sb.from('activos_fijos').select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('codigo');
      if (error) { console.warn('[DigiAccount] No se pudieron cargar activos fijos:', error.message); activosData = []; vacio('No se pudieron cargar los activos (¿creaste la tabla?).'); return; }
      activosData = data || [];
      if (!activosData.length) { vacio('Sin activos registrados. Usa "Registrar activo fijo".'); if (window.refreshTables) window.refreshTables(); return; }
      let cTot = 0, dTot = 0, mesTot = 0;
      tbody.innerHTML = activosData.map((a) => {
        const costo = Number(a.costo) || 0, dep = Number(a.depreciacion_acum) || 0, neto = costo - dep, vida = Number(a.vida_util) || 5;
        cTot += costo; dTot += dep; mesTot += Math.min(vida > 0 ? costo / (vida * 12) : 0, Math.max(0, costo - dep));
        const pct = costo ? Math.round(dep / costo * 100) : 0;
        return '<tr><td class="mono">' + (a.codigo || '') + '</td><td class="primary">' + (a.nombre || '') + '</td>'
          + '<td><span class="tag slate">' + (a.categoria || '') + '</span></td><td>' + (a.fecha_adq || '') + '</td>'
          + '<td class="num">' + fmt2(costo) + '</td><td>' + (a.vida_util || 5) + ' años</td><td>' + (a.metodo || 'Línea recta') + '</td>'
          + '<td class="num">' + fmt2(dep) + '</td><td class="num">' + fmt2(neto) + '</td>'
          + '<td><span class="depr-bar"><span style="width:' + pct + '%"></span></span><span class="depr-pct">' + pct + '%</span></td></tr>';
      }).join('');
      setStats(cTot, dTot, cTot - dTot, mesTot);
      if (footer) footer.textContent = activosData.length + ' activos · Costo total Bs ' + fmt2(cTot);
      if (dmsg) dmsg.textContent = mesTot > 0.009 ? ('Depreciación pendiente de contabilizar · ' + activosData.length + ' activos · Bs ' + fmt2(mesTot)) : 'Sin depreciación pendiente';
      if (tabCount) tabCount.textContent = String(activosData.length);
      setDepPreview(mesTot);
      if (window.refreshTables) window.refreshTables();
      drawIcons();
    }
    window.cargarActivosFijos = cargarActivosFijos;
    cargarActivosFijos();   // limpia los activos de ejemplo al cargar la página

    // ---- Depreciación del mes (genera asiento contable real) ----
    const deprBtn = document.getElementById('deprRunBtn');
    if (deprBtn) deprBtn.addEventListener('click', async () => {
      if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { toast('No hay una empresa activa', 'error'); return; }
      let total = 0; const updates = [];
      (activosData || []).forEach((a) => {
        const costo = Number(a.costo) || 0, dep = Number(a.depreciacion_acum) || 0, vida = Number(a.vida_util) || 5;
        const mensual = vida > 0 ? costo / (vida * 12) : 0;       // línea recta
        const cuota = Math.min(mensual, Math.max(0, costo - dep)); // sin pasar del costo
        if (cuota > 0.009) { total += cuota; updates.push(window.sb.from('activos_fijos').update({ depreciacion_acum: dep + cuota }).eq('id', a.id)); }
      });
      if (total < 0.009) { toast('No hay depreciación pendiente este mes', 'info'); return; }
      const hoy = new Date();
      const fecha = String(hoy.getDate()).padStart(2, '0') + '/' + String(hoy.getMonth() + 1).padStart(2, '0') + '/' + hoy.getFullYear();
      const { error: eAsi } = await window.sb.from('asientos').insert({
        cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
        numero: (asientoNum || 0) + 1, fecha: fecha, descripcion: 'Depreciación del período', referencia: 'DEPR', origen: 'auto',
        lineas: [{ cta: '6.1.1.06 · Depreciación', debe: total, haber: 0 }, { cta: '1.2.1.06 · Depreciación acumulada (−)', debe: 0, haber: total }],
        total: total,
      });
      if (eAsi) { toast('No se pudo generar el asiento: ' + eAsi.message, 'error'); return; }
      await Promise.all(updates);
      const msg = document.getElementById('deprStatusMsg');
      if (msg) msg.textContent = 'Depreciación contabilizada · asiento generado por Bs ' + fmt2(total);
      const bar = document.getElementById('deprStatusBar'); if (bar) bar.classList.remove('pending');
      if (window.cargarAsientos) window.cargarAsientos();        // refresca Diario, Mayor, Balance, Estados
      if (window.cargarActivosFijos) window.cargarActivosFijos();
      drawIcons();
      toast('Depreciación del mes contabilizada · Bs ' + fmt2(total));
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
      csvDownload(rows, 'Libro_Diario_Ejercicio_' + ejercicioInfo().anio + '.csv');
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

    /* =========================================================
       LIBRO MAYOR — movimientos de la cuenta derivados del Diario
       ========================================================= */
    const mayorBody = document.getElementById('mayorBody');
    const DEUDORAS = ['1', '5', '6']; // activo, costos, gastos
    // Saldo final conocido de cada cuenta (Bs) → la apertura se calcula para que
    // el acumulado del Mayor cierre exactamente en este saldo.
    const SALDOS_FINALES = {
      '1.1.1.02': 0, '1.1.2.01': 0, '1.1.4.02': 0,
      '2.1.1.01': 0, '2.1.4.01': 0, '2.1.4.05': 0,
      '3.1.1.01': 0, '4.1.1.01': 0, '5.1.1.01': 0,
      '6.1.1.01': 0, '6.2.1.01': 0,
    };
    const num2 = (s) => {
      const t = (s || '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
      return parseFloat(t) || 0;
    };

    function renderMayor(code, name) {
      if (!mayorBody) return;
      const deudora = DEUDORAS.includes(code.charAt(0));

      /* Los movimientos salen de los DATOS del período, no de los asientos
         pintados en el Diario.

         El Diario se pagina de 10 en 10. Leyéndolo del DOM, el Mayor de una
         cuenta solo recogía los movimientos de los 10 asientos de la página
         que estuviera abierta — y con eso el saldo de la cuenta salía mal, sin
         que nada avisara. Es el mismo error que tenía el resumen de
         retenciones: calcular sobre lo que se ve en vez de sobre lo que hay.

         Se usa __diarioDelMes, que es el mes seleccionado SIN paginar, para
         que el Mayor siga al filtro de mes del Diario como siempre. */
      const delPeriodo = (window.__diarioDelMes || asientosData || [])
        .slice()
        .sort((a, b) => (a.numero || 0) - (b.numero || 0));
      const movs = [];
      delPeriodo.forEach((a) => {
        const fecha = a.fecha || '';
        const anum = a.numero != null ? String(a.numero).padStart(4, '0') : '';
        const desc = a.descripcion || '';
        const ref = a.referencia || '';
        (Array.isArray(a.lineas) ? a.lineas : []).forEach((l) => {
          // La cuenta viene como '1.1.1.01 · Nombre'; se compara solo el código.
          const cod = String(l.cta || '').split(' · ')[0].trim();
          if (cod !== code) return;
          movs.push({ fecha, anum, desc, ref, deb: Number(l.debe) || 0, haber: Number(l.haber) || 0 });
        });
      });

      // Movimiento neto del período según la naturaleza + sumas de columnas
      let netMov = 0, sumDeb = 0, sumHaber = 0;
      movs.forEach((m) => { netMov += deudora ? (m.deb - m.haber) : (m.haber - m.deb); sumDeb += m.deb; sumHaber += m.haber; });
      // Apertura: tal que apertura + movimientos = saldo final conocido
      const target = SALDOS_FINALES[code] != null ? SALDOS_FINALES[code] : netMov;
      let saldo = target - netMov;
      let html = '<tr class="opening"><td>01/05/26</td><td class="mono">—</td><td>Saldo de apertura</td><td class="mono">—</td><td class="num">—</td><td class="num">—</td><td class="saldo">' + fmt2(saldo) + '</td></tr>';
      if (movs.length === 0) {
        html += '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:18px;">Sin movimientos en el período · el saldo se mantiene en la apertura.</td></tr>';
      } else {
        movs.forEach((m) => {
          saldo += deudora ? (m.deb - m.haber) : (m.haber - m.deb);
          html += '<tr><td>' + m.fecha + '</td><td class="mono">' + m.anum + '</td>'
            + '<td class="primary">' + m.desc + '</td><td class="mono">' + (m.ref || '—') + '</td>'
            + '<td class="num">' + (m.deb ? fmt2(m.deb) : '—') + '</td>'
            + '<td class="num">' + (m.haber ? fmt2(m.haber) : '—') + '</td>'
            + '<td class="saldo">' + fmt2(saldo) + '</td></tr>';
        });
      }
      mayorBody.innerHTML = html;

      // Encabezado y saldo final
      const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setT('mayorBadge', code);
      setT('mayorTitle', name);
      const tipoNat = deudora ? 'deudora' : 'acreedora';
      const grupo = { '1': 'Activo', '2': 'Pasivo', '3': 'Patrimonio', '4': 'Ingreso', '5': 'Costo', '6': 'Gasto' }[code.charAt(0)] || '';
      setT('mayorSub', grupo + ' · Naturaleza ' + tipoNat + ' · ' + ejercicioInfo().label);
      setT('mayorSaldoLbl', 'Saldo final ' + tipoNat);
      setT('mayorSaldoVal', 'Bs ' + fmt2(saldo));
      // Totales del pie
      setT('mayorTotDeb', fmt2(sumDeb));
      setT('mayorTotHaber', fmt2(sumHaber));
      setT('mayorTotSaldo', fmt2(saldo));
      drawIcons();
    }

    // Click en una cuenta del árbol → renderiza su mayor
    view.querySelectorAll('.account-tree .acc-item').forEach((item) => {
      item.addEventListener('click', () => {
        const code = ((item.querySelector('.code') || {}).textContent || '').trim();
        const name = ((item.querySelector('.nm') || {}).textContent || '').trim();
        if (code) renderMayor(code, name);
      });
    });

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
      balance: { nombre: 'Balance de Comprobación', orient: 'landscape', subFn: () => 'Al ' + ejercicioInfo().corteStr + ' · Bs', sel: 'table.balance-table', head: true },
      resultados: { nombre: 'Estado de Resultados', orient: 'portrait', sel: '.fin-statement', head: false },
      general: { nombre: 'Balance General', orient: 'portrait', subFn: () => 'Al ' + ejercicioInfo().corteStr + ' · Bs', sel: '.fin-two-col', head: true },
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
      printContaDoc(panel, { titulo: 'Libro Mayor · ' + code, sub: name + ' · ' + ejercicioInfo().label, orient: 'portrait' });
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
