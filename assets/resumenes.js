/* ══════════════════════════════════════════════════════════════════════
   POR CONTABILIZAR · asientos resumen por período (sql/contabilidad_15)

   En las empresas en modo resumen (las de la firma), compras, ventas y
   retenciones van en UN asiento por período, con la periodicidad con que se
   declara cada impuesto. La base propone el asiento (las mismas reglas del
   motor, sumadas y neteadas por cuenta); aquí se revisa, se corrige si hace
   falta y se aprueba. Lo propuesto y lo aprobado quedan guardados
   (contab_resumenes): de ahí aprenden los agentes.

   El navegador no arma asientos: todo pasa por las RPC de la base.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const TIPOS = {
    ventas: 'Ventas',
    compras: 'Compras',
    ret_iva_practicadas: 'Retenciones de IVA practicadas',
    ret_islr_practicadas: 'Retenciones de ISLR practicadas',
    ret_iva_sufridas: 'Retenciones de IVA sufridas',
    ret_islr_sufridas: 'Retenciones de ISLR sufridas',
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const bs = (n) => (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toast = (m, t) => { if (window.toast) window.toast(m, t); };
  const emp = () => window.__EMPRESA_ACTIVA || {};

  // ── Funciones puras (se prueban en herramientas/pruebas/correr.js) ──────
  const pad2 = (n) => String(n).padStart(2, '0');
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  // 'aaaa-mm' de n meses antes (o después, n negativo).
  function mesMenos(per, n) {
    const y = parseInt(per.slice(0, 4), 10), m = parseInt(per.slice(5, 7), 10) - 1 - n;
    const d = new Date(y, m, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }
  const etiquetaPeriodo = (per, q) => MESES[parseInt(per.slice(5, 7), 10) - 1] + ' ' + per.slice(0, 4) + (q ? ' · ' + q + 'ª quincena' : '');
  const totalDebe = (lin) => r2((lin || []).reduce((s, l) => s + (Number(l.debe) || 0), 0));
  // Las líneas de la pantalla, listas para la base: código, debe y haber; sin las vacías.
  function lineasParaGuardar(filas) {
    return (filas || []).map((l) => ({ cta: String(l.cta || '').split(' · ')[0].trim(), debe: r2(l.debe), haber: r2(l.haber) }))
      .filter((l) => l.cta && (l.debe > 0 || l.haber > 0));
  }
  // ¿Son las mismas líneas (código, debe, haber) que la propuesta?
  function igualQuePropuesta(filas, prop) {
    const k = (arr) => lineasParaGuardar(arr).map((l) => l.cta + '|' + l.debe.toFixed(2) + '|' + l.haber.toFixed(2)).join(';');
    return k(filas) === k(prop);
  }
  function cuadre(filas) {
    const lin = lineasParaGuardar(filas);
    const d = r2(lin.reduce((s, l) => s + l.debe, 0)), h = r2(lin.reduce((s, l) => s + l.haber, 0));
    return { debe: d, haber: h, cuadra: Math.abs(d - h) < 0.005 && d > 0 };
  }
  window.__resumenesPuros = { mesMenos, etiquetaPeriodo, totalDebe, lineasParaGuardar, igualQuePropuesta, cuadre };
  // ── fin de las funciones puras de resúmenes ──

  let FILAS = [], CTAS = [], _ctasDe = null, _turno = 0;
  const vista = () => document.getElementById('porContabVista');
  const hoyPer = () => (window.__hoyISO ? window.__hoyISO() : new Date().toISOString().slice(0, 10)).slice(0, 7);
  let _desde = '', _hasta = '';

  async function cargar() {
    const cont = vista();
    if (!cont || !window.sb) return;
    const e = emp();
    if (!e.id) { cont.innerHTML = '<div class="ap-vacio">Elige una empresa.</div>'; return; }
    if (!_hasta) { _hasta = hoyPer(); _desde = mesMenos(_hasta, 11); }
    const turno = ++_turno;
    cont.innerHTML = '<div class="ap-vacio">Calculando lo que hay por contabilizar…</div>';
    const [modo, lista] = await Promise.all([
      window.sb.from('empresas').select('contab_resumen').eq('id', e.id).maybeSingle(),
      window.sb.rpc('contab_por_contabilizar', { p_empresa: e.id, p_desde: _desde, p_hasta: _hasta }),
    ]);
    if (turno !== _turno || emp().id !== e.id) return;   // llegó tarde: se cambió de empresa o de rango
    if (lista.error) {
      cont.innerHTML = '<div class="ap-vacio">' + (/contab_por_contabilizar|PGRST202/.test((lista.error.message || '') + (lista.error.code || ''))
        ? 'Falta correr sql/contabilidad_15_resumen_por_periodo.sql en Supabase.' : 'No se pudo calcular: ' + esc(lista.error.message)) + '</div>';
      return;
    }
    if (_ctasDe !== e.id) {
      const pl = await window.sb.rpc('plan_de_empresa', { p_empresa: e.id });
      CTAS = ((pl && pl.data) || []).filter((c) => !/grupo/i.test(c.tipo || '')).map((c) => ({ codigo: c.codigo, nombre: c.nombre }));
      _ctasDe = e.id;
    }
    FILAS = lista.data || [];
    pintar(!!(modo.data && modo.data.contab_resumen));
  }
  window.cargarPorContabilizar = cargar;

  function pintar(enResumen) {
    const cont = vista();
    if (!cont) return;
    const pend = FILAS.filter((f) => f.estado !== 'aprobado' && f.documentos > 0);
    const tag = (f) => f.estado === 'aprobado'
      ? '<span class="tag green">Aprobado' + (f.corregido ? ' · corregido' : '') + '</span>'
      : f.estado === 'desactualizado' ? '<span class="tag amber">Cambió un documento</span>' : '<span class="tag slate">Pendiente</span>';
    let html = '<div class="data-table-wrap"><div class="table-toolbar" style="flex-wrap:wrap;gap:8px;">'
      + '<strong style="color:var(--fg-primary);">Por contabilizar</strong>'
      + '<label style="font-size:12px;color:var(--fg-muted);display:inline-flex;gap:6px;align-items:center;">Desde <input type="month" id="pcDesde" value="' + _desde + '" style="height:30px;"></label>'
      + '<label style="font-size:12px;color:var(--fg-muted);display:inline-flex;gap:6px;align-items:center;">Hasta <input type="month" id="pcHasta" value="' + _hasta + '" style="height:30px;"></label>'
      + '<div class="right">'
      + (pend.length ? '<button class="btn btn-ghost" id="pcAprobarTodo" style="height:30px;font-size:12px;"><i data-lucide="check-check"></i> Aprobar las ' + pend.length + ' pendientes tal cual</button>' : '')
      + '</div></div>';
    if (!enResumen) {
      html += '<p class="ap-aviso" style="margin:10px 14px;">Esta empresa contabiliza <strong>un asiento por documento</strong>: cada factura y retención ya lleva el suyo. '
        + 'Para llevarla en resumen por período, cámbialo en la ficha de la empresa («Contabilidad de compras, ventas y retenciones»).</p>';
    }
    if (!FILAS.length) {
      html += '<div class="ap-vacio" style="padding:24px;">No hay documentos en ese rango.</div></div>';
    } else {
      html += '<div class="table-scroll"><table class="data-table" style="min-width:760px;"><thead><tr><th>Período</th><th>Qué</th>'
        + '<th class="num">Documentos</th><th class="num">Total del asiento</th><th>Estado</th><th></th></tr></thead><tbody>'
        + FILAS.map((f, i) => '<tr><td>' + esc(etiquetaPeriodo(f.periodo, f.quincena)) + '</td><td class="primary">' + esc(TIPOS[f.tipo] || f.tipo)
          + (f.con_asiento_propio ? '<div style="font-size:11px;color:var(--fg-muted);">' + f.con_asiento_propio + ' ya con asiento propio (no se suman)</div>' : '') + '</td>'
          + '<td class="num">' + f.documentos + '</td><td class="num">' + bs(totalDebe(f.estado === 'aprobado' ? f.lineas : f.propuesta)) + '</td>'
          + '<td>' + tag(f) + '</td>'
          + '<td><button class="btn btn-ghost" data-pc-ver="' + i + '" style="height:28px;font-size:12px;">' + (f.estado === 'aprobado' ? 'Ver' : 'Revisar') + '</button></td></tr>').join('')
        + '</tbody></table></div></div>';
    }
    cont.innerHTML = html;
    cont.querySelectorAll('[data-pc-ver]').forEach((b) => b.addEventListener('click', () => abrir(FILAS[parseInt(b.dataset.pcVer, 10)])));
    ['pcDesde', 'pcHasta'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => {
        const d = document.getElementById('pcDesde').value, h = document.getElementById('pcHasta').value;
        if (!d || !h || d > h) { toast('El rango no es válido.', 'error'); return; }
        if (mesMenos(h, 35) > d) { toast('Hasta 36 meses de una vez.', 'error'); return; }
        _desde = d; _hasta = h; cargar();
      });
    });
    const todo = document.getElementById('pcAprobarTodo');
    if (todo) todo.addEventListener('click', async () => {
      if (!confirm('Se aprueban ' + pend.length + ' resúmenes tal como los propone el sistema.\n\nLos que hayas corregido antes y luego cambió un documento también se rehacen con la propuesta nueva. ¿Continuar?')) return;
      let ok = 0; const fallas = [];
      for (const f of pend) {
        const { data, error } = await window.sb.rpc('contab_aprobar_resumen', { p_empresa: emp().id, p_tipo: f.tipo, p_periodo: f.periodo, p_quincena: f.quincena, p_lineas: null });
        if (error || (data && data.ok === false)) fallas.push(etiquetaPeriodo(f.periodo, f.quincena) + ' · ' + (TIPOS[f.tipo] || f.tipo) + ': ' + (error ? error.message : data.motivo));
        else ok++;
      }
      toast(ok + ' resumen(es) aprobado(s)' + (fallas.length ? ' · ' + fallas.length + ' con problema' : ''), fallas.length ? 'error' : 'success');
      if (fallas.length) alert('No se aprobaron:\n\n' + fallas.join('\n'));
      despues();
    });
    if (window.lucide) window.lucide.createIcons();
  }

  function despues() { cargar(); if (window.cargarAsientos) window.cargarAsientos(); }

  // ── El asiento de un período: revisar, corregir y aprobar ───────────────
  function opcionesCta(sel) {
    const cod = String(sel || '').split(' · ')[0];
    const lista = CTAS.slice();
    if (cod && !lista.some((c) => c.codigo === cod)) lista.unshift({ codigo: cod, nombre: String(sel).split(' · ')[1] || '' });
    return lista.map((c) => '<option value="' + esc(c.codigo) + '"' + (c.codigo === cod ? ' selected' : '') + '>' + esc(c.codigo + ' · ' + c.nombre) + '</option>').join('');
  }

  function abrir(f) {
    if (!f) return;
    const ya = document.getElementById('pcModal'); if (ya) ya.remove();
    let filas = JSON.parse(JSON.stringify(f.estado === 'aprobado' ? f.lineas : f.propuesta || []));
    const ov = document.createElement('div');
    ov.className = 'asiento-overlay'; ov.id = 'pcModal';
    ov.innerHTML = '<div class="asiento-modal"><div class="am-bar"><span class="am-title"><i data-lucide="book-text"></i> '
      + esc((TIPOS[f.tipo] || f.tipo) + ' · ' + etiquetaPeriodo(f.periodo, f.quincena)) + '</span>'
      + '<button class="icon-btn" data-pc-cerrar title="Cerrar"><i data-lucide="x"></i></button></div>'
      + '<div class="am-body"><p style="font-size:12px;color:var(--fg-muted);margin:0 0 10px;">' + f.documentos + ' documento(s) del libro. '
      + (f.estado === 'aprobado' ? 'Este es el asiento aprobado' + (f.corregido ? ' (corregido: el sistema había propuesto otra cosa)' : '') + '.'
        : f.estado === 'desactualizado' ? 'Ya tenía un asiento aprobado, pero cambió un documento: esta es la propuesta con los datos de hoy.'
        : 'Esta es la propuesta del sistema: corrígela si hace falta y apruébala.') + '</p>'
      + '<div class="am-lines-head"><span>Cuenta contable</span><span class="num">Debe (Bs)</span><span class="num">Haber (Bs)</span><span class="del-col"></span></div>'
      + '<div id="pcLines"></div><button class="btn btn-ghost am-add" id="pcAdd"><i data-lucide="plus"></i> Agregar línea</button>'
      + '<div class="am-totals"><span class="am-cuadre" id="pcCuadre"></span><div class="am-tot-vals"><span>Total Debe <strong id="pcTD">0,00</strong></span><span>Total Haber <strong id="pcTH">0,00</strong></span></div></div>'
      + '</div><div class="am-foot"><span class="am-msg" id="pcMsg"></span><div class="am-actions">'
      + (f.resumen_id ? '<button class="btn btn-ghost" id="pcDeshacer"><i data-lucide="undo-2"></i> Deshacer</button>' : '')
      + '<button class="btn btn-ghost" id="pcPropuesta" title="Volver a lo que propone el sistema">Ver la propuesta</button>'
      + '<button class="btn btn-ghost" data-pc-cerrar>Cancelar</button>'
      + '<button class="btn btn-primary" id="pcAprobar"><i data-lucide="check"></i> ' + (f.estado === 'aprobado' ? 'Guardar cambios' : 'Aprobar') + '</button>'
      + '</div></div></div>';
    document.body.appendChild(ov);
    const $ = (id) => document.getElementById(id);
    const leer = () => {
      filas = Array.from(ov.querySelectorAll('.am-line')).map((row) => ({
        cta: row.querySelector('select').value,
        debe: parseFloat(String(row.querySelector('[data-k="debe"]').value).replace(',', '.')) || 0,
        haber: parseFloat(String(row.querySelector('[data-k="haber"]').value).replace(',', '.')) || 0,
      }));
    };
    const totales = () => {
      const c = cuadre(filas);
      $('pcTD').textContent = bs(c.debe); $('pcTH').textContent = bs(c.haber);
      $('pcCuadre').innerHTML = c.cuadra ? '<i data-lucide="check-circle-2"></i> Cuadra' : '<i data-lucide="alert-circle"></i> No cuadra · diferencia ' + bs(Math.abs(c.debe - c.haber));
      const cambio = !igualQuePropuesta(filas, f.propuesta);
      $('pcMsg').textContent = cambio ? 'Corregido: distinto de lo que propone el sistema.' : '';
      $('pcAprobar').disabled = !c.cuadra;
      if (window.lucide) window.lucide.createIcons();
    };
    const pintarLineas = () => {
      $('pcLines').innerHTML = filas.map((l, i) => '<div class="am-line" data-i="' + i + '"><select>' + opcionesCta(l.cta) + '</select>'
        + '<input data-k="debe" type="number" step="0.01" value="' + (Number(l.debe) ? r2(l.debe) : '') + '">'
        + '<input data-k="haber" type="number" step="0.01" value="' + (Number(l.haber) ? r2(l.haber) : '') + '">'
        + '<button class="icon-btn" data-pc-quitar="' + i + '" title="Quitar"><i data-lucide="x"></i></button></div>').join('');
      $('pcLines').querySelectorAll('select, input').forEach((el) => el.addEventListener('input', () => { leer(); totales(); }));
      $('pcLines').querySelectorAll('[data-pc-quitar]').forEach((b) => b.addEventListener('click', () => { leer(); filas.splice(parseInt(b.dataset.pcQuitar, 10), 1); pintarLineas(); }));
      totales();
    };
    pintarLineas();
    ov.querySelectorAll('[data-pc-cerrar]').forEach((b) => b.addEventListener('click', () => ov.remove()));
    $('pcAdd').addEventListener('click', () => { leer(); filas.push({ cta: '', debe: 0, haber: 0 }); pintarLineas(); });
    $('pcPropuesta').addEventListener('click', () => { filas = JSON.parse(JSON.stringify(f.propuesta || [])); pintarLineas(); });
    $('pcAprobar').addEventListener('click', async () => {
      leer();
      if (!cuadre(filas).cuadra) return;
      const corregido = !igualQuePropuesta(filas, f.propuesta);
      $('pcAprobar').disabled = true;
      const { data, error } = await window.sb.rpc('contab_aprobar_resumen', { p_empresa: emp().id, p_tipo: f.tipo, p_periodo: f.periodo,
        p_quincena: f.quincena, p_lineas: corregido ? lineasParaGuardar(filas) : null });
      if (error || (data && data.ok === false)) { $('pcMsg').textContent = error ? error.message : data.motivo; $('pcAprobar').disabled = false; return; }
      toast('Asiento resumen N° ' + data.asiento + (data.corregido ? ' aprobado con tus correcciones' : ' aprobado'), 'success');
      ov.remove(); despues();
    });
    const des = $('pcDeshacer');
    if (des) des.addEventListener('click', async () => {
      if (!confirm('Se borra el asiento resumen de este período y vuelve a «pendiente». ¿Continuar?')) return;
      const { data, error } = await window.sb.rpc('contab_deshacer_resumen', { p_resumen: f.resumen_id });
      if (error || (data && data.ok === false)) { $('pcMsg').textContent = error ? error.message : data.motivo; return; }
      toast('Resumen deshecho', 'info'); ov.remove(); despues();
    });
  }
})();
