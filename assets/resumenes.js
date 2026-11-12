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

  /* Lo que proponen los módulos (sql/contabilidad_16): cómo se llama cada uno. */
  function origenBorrador(b) {
    const t = b.origen_tabla || '', r = String(b.referencia || '');
    if (t === 'declaraciones') return 'Declaración';
    if (t === 'declaraciones_pago') return 'Pago de declaración';
    if (t === 'depreciacion') return 'Depreciación de activos';
    if (t === 'activos_fijos') return 'Baja de activo fijo';
    if (t === 'revaluacion') return 'Revaluación de saldos en dólares';
    if (/^NOM-/.test(r)) return 'Nómina';
    if (/^F30-/.test(r)) return 'Liquidación de la Forma 30';
    if (r === 'CRIPTO') return 'Criptoactivos (VEN-NIF 12)';
    if (r === 'IMP-DIF') return 'Impuesto diferido (VEN-NIF 11)';
    return 'Otro módulo';
  }
  window.__resumenesPuros.origenBorrador = origenBorrador;

  let ITEMS = [], CTAS = [], _ctasDe = null, _turno = 0, _abrirAlCargar = null;
  const vista = () => document.getElementById('porContabVista');
  const hoyPer = () => (window.__hoyISO ? window.__hoyISO() : new Date().toISOString().slice(0, 10)).slice(0, 7);
  let _desde = '', _hasta = '';

  // ¿La empresa activa va en revisión (resumen + propuestas)? Se lee una vez por empresa.
  let _revDe = null, _rev = false;
  window.__enRevision = async function () {
    const e = emp();
    if (!e.id || !window.sb) return false;
    if (_revDe === e.id) return _rev;
    const r = await window.sb.from('empresas').select('contab_resumen').eq('id', e.id).maybeSingle();
    _rev = !!(r && !r.error && r.data && r.data.contab_resumen); _revDe = e.id;
    return _rev;
  };
  window.__olvidarRevision = () => { _revDe = null; };

  // Un resumen (SQL 15) o un borrador (SQL 16) como renglón de la lista.
  function deResumen(f) {
    return {
      clase: 'resumen', periodo: f.periodo, quincena: f.quincena, titulo: TIPOS[f.tipo] || f.tipo,
      nota: f.con_asiento_propio ? f.con_asiento_propio + ' ya con asiento propio (no se suman)' : '',
      documentos: f.documentos, propuesta: f.propuesta || [], actual: f.lineas, corregido: f.corregido,
      estado: f.estado === 'desactualizado' && !f.documentos ? 'borrar' : f.estado,
      aprobable: f.documentos > 0,
      aprobar: (lin) => window.sb.rpc('contab_aprobar_resumen', { p_empresa: emp().id, p_tipo: f.tipo, p_periodo: f.periodo,
        p_quincena: f.quincena, p_lineas: lin, p_huella: f.huella }),
      deshacer: f.resumen_id ? () => window.sb.rpc('contab_deshacer_resumen', { p_resumen: f.resumen_id }) : null,
    };
  }
  function deBorrador(b) {
    const borrar = !(b.propuesta || []).length;
    return {
      clase: 'borrador', periodo: b.periodo || '', quincena: null, titulo: origenBorrador(b),
      nota: b.descripcion || '', documentos: null, propuesta: b.propuesta || [], actual: b.aprobado, corregido: b.corregido,
      estado: b.pendiente ? (borrar ? 'borrar' : (b.asiento_id ? 'desactualizado' : 'pendiente')) : 'aprobado',
      aprobable: b.pendiente, origen: b.origen_tabla || '', ref: b.referencia || '',
      aprobar: (lin) => window.sb.rpc('contab_aprobar_borrador', { p_borrador: b.id, p_lineas: lin, p_version: b.version }),
      descartar: b.pendiente ? () => window.sb.rpc('contab_descartar_borrador', { p_borrador: b.id }) : null,
    };
  }

  async function cargar() {
    const cont = vista();
    if (!cont || !window.sb) return;
    const e = emp();
    if (!e.id) { cont.innerHTML = '<div class="ap-vacio">Elige una empresa.</div>'; return; }
    if (!_hasta) { _hasta = hoyPer(); _desde = mesMenos(_hasta, 11); }
    const turno = ++_turno;
    cont.innerHTML = '<div class="ap-vacio">Calculando lo que hay por contabilizar…</div>';
    const [modo, lista, bors] = await Promise.all([
      window.sb.from('empresas').select('contab_resumen').eq('id', e.id).maybeSingle(),
      window.sb.rpc('contab_por_contabilizar', { p_empresa: e.id, p_desde: _desde, p_hasta: _hasta }),
      // Las propuestas pendientes de cualquier mes, y las aprobadas del rango.
      window.sb.from('contab_borradores').select('*').eq('empresa_id', e.id)
        .or('pendiente.eq.true,and(periodo.gte.' + _desde + ',periodo.lte.' + _hasta + ')').order('periodo'),
    ]);
    if (turno !== _turno || emp().id !== e.id) return;   // llegó tarde: se cambió de empresa o de rango
    if (lista.error) {
      cont.innerHTML = '<div class="ap-vacio">' + (/contab_por_contabilizar|PGRST202/.test((lista.error.message || '') + (lista.error.code || ''))
        ? 'Falta correr sql/contabilidad_15_resumen_por_periodo.sql en Supabase.' : 'No se pudo calcular: ' + esc(lista.error.message)) + '</div>';
      return;
    }
    if (_ctasDe !== e.id) {
      const pl = await window.sb.rpc('plan_de_empresa', { p_empresa: e.id });
      if (turno !== _turno || emp().id !== e.id) return;
      if (!pl.error) {
        CTAS = (pl.data || []).filter((c) => !/grupo/i.test(c.tipo || '')).map((c) => ({ codigo: c.codigo, nombre: c.nombre }));
        _ctasDe = e.id;
      }
    }
    // Sin el SQL 16 la tabla de borradores no existe: la lista sigue con los resúmenes.
    const borradores = bors && !bors.error ? (bors.data || []) : [];
    ITEMS = (lista.data || []).map(deResumen).concat(borradores.map(deBorrador))
      .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : (a.quincena || 0) - (b.quincena || 0)));
    _rev = !!(modo.data && modo.data.contab_resumen); _revDe = e.id;
    pintar(_rev, bors && bors.error ? 'Las propuestas de los módulos necesitan sql/contabilidad_16_propuestas.sql.' : '');
    // Si se llegó desde un módulo, se abre su propuesta.
    if (_abrirAlCargar) {
      const q = _abrirAlCargar; _abrirAlCargar = null;
      const it = ITEMS.find((x) => x.estado !== 'aprobado' && x.periodo === q.periodo && (!q.que || q.que(x)));
      if (it) abrir(it);
    }
  }
  window.cargarPorContabilizar = cargar;

  /* Ir desde cualquier módulo: Contabilidad › Por contabilizar, en ese período,
     con la primera propuesta pendiente que le corresponda ya abierta. */
  window.__irAPorContabilizar = function (periodo, que) {
    const per = /^\d{4}-\d{2}$/.test(periodo || '') ? periodo : hoyPer();
    _desde = per; _hasta = per; _abrirAlCargar = { periodo: per, que: que || null };
    if (window.showView) window.showView('contabilidad', 'Contabilidad · Libros');
    const tab = document.querySelector('#contaTabs button[data-tab="porcontab"]');
    if (tab) tab.click(); else cargar();
  };

  const ETIQ = { aprobado: 'Aprobado', pendiente: 'Pendiente', desactualizado: 'Cambió el documento', borrar: 'Pide quitar el asiento' };
  function pintar(enRevision, aviso) {
    const cont = vista();
    if (!cont) return;
    const pend = ITEMS.filter((f) => f.estado !== 'aprobado' && f.aprobable);
    const tag = (f) => f.estado === 'aprobado'
      ? '<span class="tag green">Aprobado' + (f.corregido ? ' · corregido' : '') + '</span>'
      : '<span class="tag ' + (f.estado === 'pendiente' ? 'slate' : 'amber') + '">' + ETIQ[f.estado] + '</span>';
    let html = '<div class="data-table-wrap"><div class="table-toolbar" style="flex-wrap:wrap;gap:8px;">'
      + '<strong style="color:var(--fg-primary);">Por contabilizar</strong>'
      + '<label style="font-size:12px;color:var(--fg-muted);display:inline-flex;gap:6px;align-items:center;">Desde <input type="month" id="pcDesde" value="' + _desde + '" style="height:30px;"></label>'
      + '<label style="font-size:12px;color:var(--fg-muted);display:inline-flex;gap:6px;align-items:center;">Hasta <input type="month" id="pcHasta" value="' + _hasta + '" style="height:30px;"></label>'
      + '<div class="right">'
      + (pend.length ? '<button class="btn btn-ghost" id="pcAprobarTodo" style="height:30px;font-size:12px;"><i data-lucide="check-check"></i> Aprobar las ' + pend.length + ' pendientes tal cual</button>' : '')
      + '</div></div>';
    if (!enRevision) {
      html += '<p class="ap-aviso" style="margin:10px 14px;">Esta empresa contabiliza <strong>sola, un asiento por documento</strong>: cada factura, retención y movimiento de los módulos lleva el suyo. '
        + 'Para revisar y aprobar todo desde aquí, cámbialo en la ficha de la empresa («Contabilidad»).</p>';
    }
    if (aviso) html += '<p class="ap-aviso" style="margin:10px 14px;">' + esc(aviso) + '</p>';
    if (!ITEMS.length) {
      html += '<div class="ap-vacio" style="padding:24px;">Nada por contabilizar en ese rango.</div></div>';
    } else {
      html += '<div class="table-scroll"><table class="data-table" style="min-width:760px;"><thead><tr><th>Período</th><th>Qué</th>'
        + '<th class="num">Documentos</th><th class="num">Total del asiento</th><th>Estado</th><th></th></tr></thead><tbody>'
        + ITEMS.map((f, i) => '<tr><td>' + esc(f.periodo ? etiquetaPeriodo(f.periodo, f.quincena) : '—') + '</td><td class="primary">' + esc(f.titulo)
          + (f.nota ? '<div style="font-size:11px;color:var(--fg-muted);">' + esc(f.nota) + '</div>' : '') + '</td>'
          + '<td class="num">' + (f.documentos == null ? '—' : f.documentos) + '</td>'
          + '<td class="num">' + bs(totalDebe(f.estado === 'aprobado' ? f.actual : f.propuesta)) + '</td>'
          + '<td>' + tag(f) + '</td>'
          + '<td><button class="btn btn-ghost" data-pc-ver="' + i + '" style="height:28px;font-size:12px;">' + (f.estado === 'aprobado' ? 'Ver' : 'Revisar') + '</button></td></tr>').join('')
        + '</tbody></table></div></div>';
    }
    cont.innerHTML = html;
    cont.querySelectorAll('[data-pc-ver]').forEach((b) => b.addEventListener('click', () => abrir(ITEMS[parseInt(b.dataset.pcVer, 10)])));
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
      const empId = emp().id;
      if (!confirm('Se aprueban ' + pend.length + ' asientos tal como los proponen el sistema y los módulos (incluidos los que piden quitar un asiento).\n\n¿Continuar?')) return;
      todo.disabled = true;
      let ok = 0; const fallas = [];
      for (const f of pend) {
        if (emp().id !== empId) { fallas.push('Se cambió de empresa: se detuvo la aprobación.'); break; }
        const { data, error } = await f.aprobar(null);
        if (error || (data && data.ok === false)) fallas.push((f.periodo ? etiquetaPeriodo(f.periodo, f.quincena) + ' · ' : '') + f.titulo + ': ' + (error ? error.message : data.motivo));
        else ok++;
      }
      toast(ok + ' asiento(s) aprobado(s)' + (fallas.length ? ' · ' + fallas.length + ' con problema' : ''), fallas.length ? 'error' : 'success');
      if (fallas.length) alert('No se aprobaron:\n\n' + fallas.join('\n'));
      despues();
    });
    if (window.lucide) window.lucide.createIcons();
  }

  function despues() { cargar(); if (window.cargarAsientos) window.cargarAsientos(); }

  // ── Revisar, corregir y aprobar (un resumen o una propuesta de un módulo) ─
  function opcionesCta(sel) {
    const cod = String(sel || '').split(' · ')[0];
    const lista = CTAS.slice();
    if (cod && !lista.some((c) => c.codigo === cod)) lista.unshift({ codigo: cod, nombre: String(sel).split(' · ')[1] || '' });
    return '<option value=""' + (cod ? '' : ' selected') + '>Elige la cuenta…</option>'
      + lista.map((c) => '<option value="' + esc(c.codigo) + '"' + (c.codigo === cod ? ' selected' : '') + '>' + esc(c.codigo + ' · ' + c.nombre) + '</option>').join('');
  }

  function abrir(f) {
    if (!f) return;
    const ya = document.getElementById('pcModal'); if (ya) ya.remove();
    const borrar = f.estado === 'borrar';
    let filas = JSON.parse(JSON.stringify((f.estado === 'aprobado' ? f.actual : (borrar ? f.actual : f.propuesta)) || []));
    const intro = f.estado === 'aprobado' ? 'Este es el asiento aprobado' + (f.corregido ? ' (corregido: se había propuesto otra cosa)' : '') + '.'
      : borrar ? (f.clase === 'resumen' ? 'Los documentos de este período se borraron o se anularon: el asiento aprobado ya no tiene con qué sostenerse. Deshazlo.'
                                       : 'El módulo anuló o borró su documento y pide quitar este asiento (el que ves es el aprobado hoy). Apruébalo para quitarlo, o descártalo para dejarlo.')
      : f.estado === 'desactualizado' ? 'Ya tenía un asiento aprobado, pero cambió el documento: esta es la propuesta con los datos de hoy.'
      : 'Esta es la propuesta: corrígela si hace falta y apruébala.';
    const ov = document.createElement('div');
    ov.className = 'asiento-overlay'; ov.id = 'pcModal';
    ov.innerHTML = '<div class="asiento-modal"><div class="am-bar"><span class="am-title"><i data-lucide="book-text"></i> '
      + esc(f.titulo + (f.periodo ? ' · ' + etiquetaPeriodo(f.periodo, f.quincena) : '')) + '</span>'
      + '<button class="icon-btn" data-pc-cerrar title="Cerrar"><i data-lucide="x"></i></button></div>'
      + '<div class="am-body"><p style="font-size:12px;color:var(--fg-muted);margin:0 0 10px;">'
      + (f.documentos ? f.documentos + ' documento(s) del libro. ' : (f.nota ? esc(f.nota) + '. ' : '')) + intro + '</p>'
      + '<div class="am-lines-head"><span>Cuenta contable</span><span class="num">Debe (Bs)</span><span class="num">Haber (Bs)</span><span class="del-col"></span></div>'
      + '<div id="pcLines"></div>' + (borrar ? '' : '<button class="btn btn-ghost am-add" id="pcAdd"><i data-lucide="plus"></i> Agregar línea</button>')
      + '<div class="am-totals"><span class="am-cuadre" id="pcCuadre"></span><div class="am-tot-vals"><span>Total Debe <strong id="pcTD">0,00</strong></span><span>Total Haber <strong id="pcTH">0,00</strong></span></div></div>'
      + '</div><div class="am-foot"><span class="am-msg" id="pcMsg"></span><div class="am-actions">'
      + (f.deshacer ? '<button class="btn btn-ghost" id="pcDeshacer"><i data-lucide="undo-2"></i> Deshacer</button>' : '')
      + (f.descartar ? '<button class="btn btn-ghost" id="pcDescartar" title="Ignorar lo que pide el módulo">Descartar</button>' : '')
      + (borrar ? '' : '<button class="btn btn-ghost" id="pcPropuesta" title="Volver a lo propuesto">Ver la propuesta</button>')
      + '<button class="btn btn-ghost" data-pc-cerrar>Cancelar</button>'
      + (f.aprobable ? '<button class="btn btn-primary" id="pcAprobar"><i data-lucide="check"></i> ' + (borrar ? 'Quitar el asiento' : 'Aprobar') + '</button>' : '')
      + '</div></div></div>';
    document.body.appendChild(ov);
    const $ = (id) => document.getElementById(id);
    const leer = () => {
      if (borrar) return;
      filas = Array.from(ov.querySelectorAll('.am-line')).map((row) => ({
        cta: row.querySelector('select').value,
        debe: parseFloat(String(row.querySelector('[data-k="debe"]').value).replace(',', '.')) || 0,
        haber: parseFloat(String(row.querySelector('[data-k="haber"]').value).replace(',', '.')) || 0,
      }));
    };
    const totales = () => {
      const c = cuadre(filas);
      $('pcTD').textContent = bs(c.debe); $('pcTH').textContent = bs(c.haber);
      $('pcCuadre').innerHTML = borrar ? '' : (c.cuadra ? '<i data-lucide="check-circle-2"></i> Cuadra' : '<i data-lucide="alert-circle"></i> No cuadra · diferencia ' + bs(Math.abs(c.debe - c.haber)));
      if (!borrar) $('pcMsg').textContent = !igualQuePropuesta(filas, f.propuesta) ? 'Corregido: distinto de lo propuesto.' : '';
      if ($('pcAprobar')) $('pcAprobar').disabled = !borrar && !c.cuadra;
      if (window.lucide) window.lucide.createIcons();
    };
    const pintarLineas = () => {
      $('pcLines').innerHTML = filas.map((l, i) => '<div class="am-line" data-i="' + i + '"><select' + (borrar ? ' disabled' : '') + '>' + opcionesCta(l.cta) + '</select>'
        + '<input data-k="debe" type="number" step="0.01"' + (borrar ? ' disabled' : '') + ' value="' + (Number(l.debe) ? r2(l.debe) : '') + '">'
        + '<input data-k="haber" type="number" step="0.01"' + (borrar ? ' disabled' : '') + ' value="' + (Number(l.haber) ? r2(l.haber) : '') + '">'
        + (borrar ? '<span></span>' : '<button class="icon-btn" data-pc-quitar="' + i + '" title="Quitar"><i data-lucide="x"></i></button>') + '</div>').join('');
      $('pcLines').querySelectorAll('select, input').forEach((el) => el.addEventListener('input', () => { leer(); totales(); }));
      $('pcLines').querySelectorAll('[data-pc-quitar]').forEach((b) => b.addEventListener('click', () => { leer(); filas.splice(parseInt(b.dataset.pcQuitar, 10), 1); pintarLineas(); }));
      totales();
    };
    pintarLineas();
    ov.querySelectorAll('[data-pc-cerrar]').forEach((b) => b.addEventListener('click', () => ov.remove()));
    if ($('pcAdd')) $('pcAdd').addEventListener('click', () => { leer(); filas.push({ cta: '', debe: 0, haber: 0 }); pintarLineas(); });
    if ($('pcPropuesta')) $('pcPropuesta').addEventListener('click', () => { filas = JSON.parse(JSON.stringify(f.propuesta || [])); pintarLineas(); });
    const ap = $('pcAprobar');
    if (ap) ap.addEventListener('click', async () => {
      leer();
      if (!borrar && !cuadre(filas).cuadra) return;
      if (!borrar && filas.some((l) => !String(l.cta || '').trim() && (Number(l.debe) || Number(l.haber)))) { $('pcMsg').textContent = 'Hay una línea con monto y sin cuenta.'; return; }
      const corregido = !borrar && !igualQuePropuesta(filas, f.propuesta);
      ap.disabled = true;
      const { data, error } = await f.aprobar(corregido ? lineasParaGuardar(filas) : null);
      if (error || (data && data.ok === false)) { $('pcMsg').textContent = error ? error.message : data.motivo; ap.disabled = false; return; }
      toast(borrar ? 'Asiento quitado' : 'Asiento N° ' + data.asiento + (corregido ? ' aprobado con tus correcciones' : ' aprobado'), 'success');
      ov.remove(); despues();
    });
    const accion = (id, fn, pregunta, hecho) => {
      const b = $(id);
      if (b) b.addEventListener('click', async () => {
        if (!confirm(pregunta)) return;
        const { data, error } = await fn();
        if (error || (data && data.ok === false)) { $('pcMsg').textContent = error ? error.message : data.motivo; return; }
        toast(hecho, 'info'); ov.remove(); despues();
      });
    };
    if (f.deshacer) accion('pcDeshacer', f.deshacer, 'Se borra el asiento resumen de este período y vuelve a «pendiente». ¿Continuar?', 'Resumen deshecho');
    if (f.descartar) accion('pcDescartar', f.descartar, 'Se ignora lo que pide el módulo: el asiento aprobado (si lo hay) queda como está. ¿Continuar?', 'Propuesta descartada');
  }

  // ── El botón «Contabilizar» en cada módulo ──────────────────────────────
  /* Lleva a Por contabilizar en el período que se está mirando, con la
     propuesta de ese módulo abierta. Solo aparece en las empresas en revisión. */
  const perFiscal = () => { const p = window.__fiscalPer; return p && p.aa && p.mm ? '20' + p.aa + '-' + p.mm : hoyPer(); };
  const BOTONES = [
    { sel: '.fiscal-tab[data-tab="compras"]', txt: 'Contabilizar las compras y sus retenciones', per: perFiscal,
      que: (x) => /Compras|practicadas/.test(x.titulo) },
    { sel: '.fiscal-tab[data-tab="ventas"]', txt: 'Contabilizar las ventas, el IGTF y las retenciones sufridas', per: perFiscal,
      que: (x) => /Ventas|sufridas/.test(x.titulo) },
    { sel: '.fiscal-tab[data-tab="retenciones"]', txt: 'Contabilizar las retenciones del período', per: perFiscal, que: (x) => /Retenciones/.test(x.titulo) },
    { sel: '.fiscal-tab[data-tab="declaraciones"]', txt: 'Contabilizar las declaraciones, pagos y la liquidación de la Forma 30', per: perFiscal,
      que: (x) => /Declaración|Pago de declaración|Forma 30/.test(x.titulo) },
    { sel: '.fiscal-tab[data-tab="igtf"]', txt: 'Contabilizar el IGTF (Forma 21)', per: perFiscal, que: (x) => /Declaración|Pago/.test(x.titulo) },
    { sel: '#view-nomina', txt: 'Ver la nómina en Por contabilizar', per: hoyPer, que: (x) => x.titulo === 'Nómina' },
    { sel: '.conta-tab[data-tab="activos"]', txt: 'Ver la depreciación y las bajas en Por contabilizar', per: hoyPer, que: (x) => /activo|Depreciación/i.test(x.titulo) },
    { sel: '.conta-tab[data-tab="cripto"]', txt: 'Ver los criptoactivos en Por contabilizar', per: hoyPer, que: (x) => /Cripto/.test(x.titulo) },
    { sel: '.conta-tab[data-tab="diferido"]', txt: 'Ver el impuesto diferido en Por contabilizar', per: hoyPer, que: (x) => /diferido/.test(x.titulo) },
  ];
  function ponerBotones() {
    BOTONES.forEach((b) => {
      const pane = document.querySelector(b.sel);
      if (!pane || pane.querySelector(':scope > .pc-ir')) return;
      const d = document.createElement('div');
      d.className = 'pc-ir';
      d.style.cssText = 'display:none;justify-content:flex-end;margin:0 0 10px;';
      d.innerHTML = '<button class="btn btn-ghost" style="height:30px;font-size:12px;"><i data-lucide="book-check"></i> ' + esc(b.txt) + ' →</button>';
      d.querySelector('button').addEventListener('click', () => window.__irAPorContabilizar(b.per(), b.que));
      pane.insertBefore(d, pane.firstChild);
    });
    if (window.lucide) window.lucide.createIcons();
  }
  // Se muestran según la empresa activa (y se vuelven a mirar al cambiar de empresa).
  async function mostrarBotones() {
    ponerBotones();
    const si = await window.__enRevision();
    document.querySelectorAll('.pc-ir').forEach((d) => { d.style.display = si ? 'flex' : 'none'; });
  }
  window.__mostrarBotonesContabilizar = mostrarBotones;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mostrarBotones, 0));
  else setTimeout(mostrarBotones, 0);
})();
