/* =========================================================
   DigiAccount — Conciliación bancaria (Contabilidad y Tesorería)

   Una sola lógica con dos puertas (spec §6): la pestaña «Conciliación» de
   Contabilidad, para los clientes de la firma, y la de Tesorería. Cada línea
   del estado de cuenta se clasifica y, al conciliarla, la base hace su asiento
   (sql/contabilidad_08_conciliacion.sql).
   ========================================================= */
(function () {
  'use strict';

  /* SUGERENCIAS — regla de Luis: para asignar una línea a una factura, a una
     declaración o a un tercero hacen falta DOS coincidencias: el monto y una
     de estas (número del documento o referencia, RIF, teléfono, nombre). Con
     una sola, se sugiere pero no es «segura»: no entra en «Aprobar las
     seguras» y nunca se elige sola entre varias.

     linea: { id, fecha 'dd/mm/aaaa', descripcion, referencia, monto (+ entra, − sale) }
     ctx:   { documentos: [{ id, tipo:'venta'|'compra', numero, rif, tercero, saldo }],
              declaraciones: [{ id, impuesto, numero, a_pagar, pagada }],
              terceros: [{ nombre, rif, telefono }],
              otrasLineas: [{ id, cuenta_contable, fecha, monto }] }
     Devuelve { clase, seguro, motivo, ... } o null. */
  function sugerirLinea(linea, ctx) {
    ctx = ctx || {};
    const monto = Number(linea.monto) || 0;
    const abs = Math.round(Math.abs(monto) * 100) / 100;
    const texto = (String(linea.descripcion || '') + ' ' + String(linea.referencia || ''));
    const bajo = texto.toLowerCase();
    // Los números del texto, sin ceros a la izquierda (el banco y el libro los escriben distinto).
    const numeros = (texto.match(/\d+/g) || []).map((n) => n.replace(/^0+/, '')).filter(Boolean);
    const digitosTexto = texto.replace(/\D/g, '');
    const igual = (a, b) => Math.abs(a - b) <= 0.01;
    const dias = (f1, f2) => {
      const d = (f) => { const p = String(f || '').split('/'); return p.length === 3 ? Date.UTC(+p[2] < 100 ? 2000 + +p[2] : +p[2], +p[1] - 1, +p[0]) : NaN; };
      return Math.abs(d(f1) - d(f2)) / 86400000;
    };

    if (/comisi[oó]n|cargo por servicio|mantenimiento de cuenta/i.test(texto)) {
      return { clase: 'comision', seguro: true, motivo: 'La descripción dice que es una comisión del banco.' };
    }
    if (/\bigtf\b|grandes transacciones/i.test(texto)) {
      return { clase: 'igtf', seguro: true, motivo: 'La descripción dice que es IGTF.' };
    }

    // ¿Qué más coincide con este documento, además del monto?
    const segunda = (doc) => {
      const num = String(doc.numero || '').replace(/\D/g, '').replace(/^0+/, '');
      if (num.length >= 3 && numeros.indexOf(num) >= 0) return 'el número ' + doc.numero;
      const rif = String(doc.rif || '').replace(/\D/g, '');
      if (rif.length >= 6 && digitosTexto.indexOf(rif) >= 0) return 'el RIF';
      const palabras = String(doc.tercero || '').toUpperCase().split(/[^A-ZÁÉÍÓÚÑ]+/).filter((w) => w.length >= 4);
      if (palabras.some((w) => new RegExp('(^|[^A-ZÁÉÍÓÚÑ])' + w + '([^A-ZÁÉÍÓÚÑ]|$)').test(texto.toUpperCase()))) return 'el nombre';
      const ter = (ctx.terceros || []).find((t) => (doc.rif && t.rif === doc.rif) || (t.nombre && t.nombre === doc.tercero));
      const tel = String((ter && ter.telefono) || '').replace(/\D/g, '');
      if (tel.length >= 7 && digitosTexto.indexOf(tel.slice(-7)) >= 0) return 'el teléfono';
      return null;
    };

    // Impuesto: sale dinero por lo que se paga de una declaración sin pago.
    if (monto < 0) {
      const decl = (ctx.declaraciones || []).filter((d) => !d.pagada && igual(Number(d.a_pagar) || 0, abs));
      if (decl.length) {
        const conPlanilla = decl.find((d) => { const n = String(d.numero || '').replace(/\D/g, '').replace(/^0+/, ''); return n.length >= 4 && numeros.indexOf(n) >= 0; });
        const dice = /seniat|tesoro|impuesto/i.test(texto);
        const d = conPlanilla || (decl.length === 1 ? decl[0] : null);
        if (d && (conPlanilla || dice)) {
          return { clase: 'impuesto', seguro: true, declaracion_id: d.id, motivo: 'Monto de la declaración ' + (d.impuesto || '') + ' y ' + (conPlanilla ? 'su número de planilla.' : 'la descripción dice SENIAT.') };
        }
        return { clase: 'impuesto', seguro: false, declaracion_id: decl.length === 1 ? decl[0].id : null, motivo: 'Solo coincide el monto con una declaración por pagar: revísala.' };
      }
    }

    // Un documento: si entra dinero, una venta; si sale, una compra.
    const tipo = monto > 0 ? 'venta' : 'compra';
    const cand = (ctx.documentos || []).filter((d) => d.tipo === tipo && igual(Number(d.saldo) || 0, abs));
    if (cand.length) {
      const seguros = cand.map((d) => ({ d: d, por: segunda(d) })).filter((x) => x.por);
      const clase = monto > 0 ? 'cobro' : 'pago';
      if (seguros.length === 1) {
        const d = seguros[0].d;
        return { clase: clase, seguro: true, libro_fiscal_id: d.id, tercero_nombre: d.tercero || null, tercero_rif: d.rif || null,
          motivo: 'Monto de la factura ' + (d.numero || '') + ' y ' + seguros[0].por + '.' };
      }
      return { clase: clase, seguro: false, libro_fiscal_id: cand.length === 1 ? cand[0].id : null,
        motivo: cand.length === 1 ? 'Solo coincide el monto con la factura ' + (cand[0].numero || '') + ': revísala.'
          : 'Solo coincide el monto, con ' + cand.length + ' facturas: elige cuál.' };
    }

    // Transferencia entre bancos propios: el monto contrario en otro banco, a 3 días o menos.
    const par = (ctx.otrasLineas || []).find((o) => igual(Number(o.monto) || 0, -monto) && dias(o.fecha, linea.fecha) <= 3);
    if (par) {
      return { clase: 'transferencia', seguro: false, extracto_par_id: par.id, cuenta_contra: par.cuenta_contable,
        motivo: 'Hay un movimiento contrario por el mismo monto en otro de tus bancos.' };
    }
    return null;
  }
  window.__sugerirLinea = sugerirLinea;

  /* =========================================================
     LA PANTALLA — se monta en cada [data-concil-puerta]
     ========================================================= */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toast = (m, t) => { if (window.toast) window.toast(m, t); };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const CLASES = [
    { v: 'cobro', n: 'Cobro de cliente (CxC)' }, { v: 'pago', n: 'Pago a proveedor (CxP)' },
    { v: 'comision', n: 'Comisión bancaria' }, { v: 'igtf', n: 'IGTF del banco' },
    { v: 'impuesto', n: 'Pago de un impuesto (declaración)' }, { v: 'transferencia', n: 'Transferencia entre mis bancos' },
    { v: 'registrado', n: 'Ya registrado contra «Bancos» (nómina, Tesorería…)' }, { v: 'otra', n: 'Otra cuenta' },
  ];
  const nombreClase = (c) => (CLASES.find((x) => x.v === c) || {}).n || '—';
  const mesTxt = (p) => (p ? MESES[parseInt(p.slice(5, 7), 10) - 1] + ' ' + p.slice(0, 4) : '');
  const mesMas = (p, n) => { const d = new Date(+p.slice(0, 4), +p.slice(5, 7) - 1 + n, 1, 12); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const fechaNum = (f) => { const p = String(f || '').split('/'); return p.length === 3 ? (+p[2] < 100 ? 2000 + +p[2] : +p[2]) * 10000 + +p[1] * 100 + +p[0] : 0; };
  const normNum = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

  /* El lector de CSV que tenía Tesorería: columnas fecha / descripción /
     referencia / monto, o débito y crédito por separado. */
  function numCsv(s) {
    s = String(s == null ? '' : s).trim().replace(/[^\d.,-]/g, '');
    if (!s) return 0;
    if (s.indexOf(',') > -1 && s.indexOf('.') > -1) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.indexOf(',') > -1) s = s.replace(',', '.');
    return parseFloat(s) || 0;
  }
  function leerCSV(text) {
    const first = (text.split(/\r?\n/).find((r) => r.trim()) || '');
    const delim = first.split(';').length > first.split(',').length ? ';' : ',';
    const rows = text.split(/\r?\n/).filter((r) => r.trim()).map((r) => r.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));
    if (!rows.length) return [];
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const head = rows[0].map(norm);
    const col = (...kw) => head.findIndex((h) => kw.some((k) => h.indexOf(k) > -1));
    let cF = col('fecha', 'date'), cD = col('descrip', 'concepto', 'detalle'), cR = col('referencia', 'comprobante', 'documento', 'nro', 'numero', 'ref'), cM = col('monto', 'importe', 'valor');
    const cDeb = col('debito', 'debe', 'cargo', 'retiro'), cCre = col('credito', 'haber', 'abono', 'deposito');
    const conCab = cF > -1 || cM > -1 || (cDeb > -1 && cCre > -1);
    const cuerpo = conCab ? rows.slice(1) : rows;
    if (!conCab) { cF = 0; cD = 1; cR = 2; cM = 3; }
    return cuerpo.map((r) => {
      const monto = cM > -1 ? numCsv(r[cM]) : ((cCre > -1 ? numCsv(r[cCre]) : 0) - (cDeb > -1 ? numCsv(r[cDeb]) : 0));
      return { fecha: (cF > -1 && r[cF]) || '', descripcion: (cD > -1 && r[cD]) || '', referencia: (cR > -1 && r[cR]) || '', monto: monto };
    }).filter((l) => Math.abs(l.monto) > 0.005);
  }

  const instancias = [];
  function montar(el) {
    const st = { el: el, bancos: [], banco: '', mes: '', lineas: [], ctx: null, plan: [], cargado: false };
    const h = (window.__hoyISO ? window.__hoyISO() : new Date().toISOString().slice(0, 10)).slice(0, 7);
    st.mes = mesMas(h, -1);
    const opcMes = [];
    for (let i = -1; i < 24; i++) opcMes.push(mesMas(h, -i));
    el.innerHTML = '<div class="data-table-wrap" style="margin-bottom:16px;">'
      + '<div class="table-toolbar" style="flex-wrap:wrap;gap:10px;">'
      + '<label style="font-size:12px;display:flex;align-items:center;gap:6px;">Banco: <select data-c="banco" style="height:32px;border:1px solid var(--border);border-radius:8px;padding:0 8px;font:inherit;background:var(--bg-elev);color:inherit;"></select></label>'
      + '<button class="btn btn-ghost" data-c="nuevoBanco" style="height:32px;font-size:12px;"><i data-lucide="plus"></i> Banco</button>'
      + '<label style="font-size:12px;display:flex;align-items:center;gap:6px;">Mes: <select data-c="mes" style="height:32px;border:1px solid var(--border);border-radius:8px;padding:0 8px;font:inherit;background:var(--bg-elev);color:inherit;">'
      + opcMes.map((m) => '<option value="' + m + '"' + (m === st.mes ? ' selected' : '') + '>' + mesTxt(m) + '</option>').join('') + '</select></label>'
      + '<label class="btn btn-ghost" style="height:32px;font-size:12px;cursor:pointer;"><i data-lucide="upload"></i> Estado de cuenta (PDF o Excel/CSV)'
      + '<input type="file" data-c="archivo" accept=".pdf,.csv,.txt,application/pdf,text/csv" style="display:none;"></label>'
      + '<span data-c="archivoNombre" style="font-size:11px;color:var(--fg-muted);"></span>'
      + '<button class="btn btn-primary" data-c="cargar" style="height:32px;font-size:12px;"><i data-lucide="file-up"></i> Cargar</button>'
      + '<div class="right" style="display:flex;gap:8px;">'
      + '<button class="btn btn-primary" data-c="aprobar" style="height:32px;font-size:12px;" disabled><i data-lucide="check-check"></i> Aprobar las seguras (0)</button>'
      + '<button class="btn btn-ghost" data-c="presuncion" style="height:32px;font-size:12px;"><i data-lucide="hand-coins"></i> Dar por cobrado y pagado</button>'
      + '</div></div>'
      + '<div data-c="msg" style="padding:10px 14px;font-size:12px;color:var(--fg-muted);">Elige el banco y el mes, y carga su estado de cuenta. Cada línea se clasifica y, al conciliarla, su asiento lo hace el sistema.</div></div>'
      + '<section class="kpi-row" data-c="resumen"></section>'
      + '<div class="data-table-wrap"><div class="table-scroll"><table class="data-table" style="min-width:980px;"><thead><tr>'
      + '<th>Fecha</th><th>Descripción</th><th>Referencia</th><th class="num">Monto</th><th>Clasificación</th><th>Estado</th><th></th>'
      + '</tr></thead><tbody data-c="lineas"><tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin líneas cargadas para este banco y mes.</td></tr></tbody></table></div></div>';
    const $ = (k) => el.querySelector('[data-c="' + k + '"]');
    const msg = (t) => { const m = $('msg'); if (m) m.innerHTML = t; };
    st.$ = $; st.msg = msg;

    $('banco').addEventListener('change', () => { st.banco = $('banco').value; cargarMes(st); });
    $('mes').addEventListener('change', () => { st.mes = $('mes').value; cargarMes(st); });
    $('archivo').addEventListener('change', () => { const f = $('archivo').files[0]; $('archivoNombre').textContent = f ? f.name : ''; });
    $('nuevoBanco').addEventListener('click', () => nuevoBanco(st));
    $('cargar').addEventListener('click', () => cargarArchivo(st));
    $('aprobar').addEventListener('click', () => aprobarSeguras(st));
    $('presuncion').addEventListener('click', () => darPorCobrado(st));
    $('lineas').addEventListener('click', (ev) => {
      const bc = ev.target.closest('[data-conciliar]'), bd = ev.target.closest('[data-deshacer]');
      if (bc) { const l = st.lineas.find((x) => x.id === bc.dataset.conciliar); if (l) conciliar(st, l); }
      if (bd) { const l = st.lineas.find((x) => x.id === bd.dataset.deshacer); if (l) deshacer(st, l); }
    });
    $('resumen').addEventListener('click', (ev) => { if (ev.target.closest('[data-saldo-banco]')) editarSaldoBanco(st); });
    instancias.push(st);
    return st;
  }

  const empresa = () => window.__EMPRESA_ACTIVA || {};
  const listo = () => !!(window.sb && empresa().id);

  async function cargarTodo(st) {
    if (!listo()) return;
    st.cargado = true;
    const { data: bancos, error } = await window.sb.from('cuentas_tesoreria').select('id, nombre, banco, tipo, cuenta_contable').eq('empresa_id', empresa().id).order('creado_en');
    if (error) { st.msg('No se pudieron leer los bancos: ' + esc(error.message)); return; }
    st.bancos = bancos || [];
    const sel = st.$('banco');
    sel.innerHTML = st.bancos.length ? st.bancos.map((b) => '<option value="' + b.id + '">' + esc(b.nombre) + (b.cuenta_contable ? ' · ' + esc(b.cuenta_contable) : '') + '</option>').join('')
      : '<option value="">(sin bancos — agrega uno)</option>';
    if (!st.bancos.some((b) => b.id === st.banco)) st.banco = st.bancos.length ? st.bancos[0].id : '';
    sel.value = st.banco;
    const { data: plan } = await window.sb.rpc('plan_de_empresa', { p_empresa: empresa().id });
    st.plan = (plan || []).filter((c) => c.tipo !== 'Grupo');
    await cargarMes(st);
  }

  // Los documentos con lo que les falta por cobrar o pagar, las declaraciones,
  // los terceros y las líneas de los otros bancos: lo que necesita sugerirLinea.
  async function cargarContexto(st) {
    const e = empresa().id;
    const meses = [st.mes, mesMas(st.mes, -1), mesMas(st.mes, -2)];
    const [lib, ret, lig, dec, otras] = await Promise.all([
      window.sb.from('libro_fiscal').select('id, tipo, numero_factura, numero_zeta, tercero_nombre, tercero_rif, total, igtf, periodo').eq('empresa_id', e).in('periodo', meses),
      window.sb.from('retenciones').select('factura, tercero_rif, direccion, monto, estado').eq('empresa_id', e).gte('periodo', meses[2]),
      window.sb.from('extracto_bancario').select('libro_fiscal_id, monto').eq('empresa_id', e).eq('estado', 'conciliada').not('libro_fiscal_id', 'is', null),
      window.sb.from('declaraciones').select('id, impuesto, periodo, quincena, numero, a_pagar, fecha_pago').eq('empresa_id', e).gt('a_pagar', 0).gte('periodo', mesMas(st.mes, -3)),
      window.sb.from('extracto_bancario').select('id, cuenta_teso_id, fecha, monto, estado').eq('empresa_id', e).eq('periodo', st.mes).neq('cuenta_teso_id', st.banco || '00000000-0000-0000-0000-000000000000'),
    ]);
    const retenido = (doc) => (ret.data || []).filter((r) => !/anulad/i.test(r.estado || '')
        && r.direccion === (doc.tipo === 'venta' ? 'sufrida' : 'practicada')
        && normNum(r.factura) && normNum(r.factura) === normNum(doc.numero_factura || doc.numero_zeta)
        && (!r.tercero_rif || !doc.tercero_rif || r.tercero_rif === doc.tercero_rif))
      .reduce((s, r) => s + (Number(r.monto) || 0), 0);
    const cobrado = {};
    (lig.data || []).forEach((x) => { cobrado[x.libro_fiscal_id] = (cobrado[x.libro_fiscal_id] || 0) + Math.abs(Number(x.monto) || 0); });
    const subDe = {};
    st.bancos.forEach((b) => { subDe[b.id] = b.cuenta_contable; });
    st.ctx = {
      documentos: (lib.data || []).filter((d) => !/anulad/i.test(d.tercero_nombre || '')).map((d) => ({
        id: d.id, tipo: d.tipo, numero: d.numero_factura || d.numero_zeta || '', rif: d.tercero_rif || '', tercero: d.tercero_nombre || '',
        saldo: Math.round(((Number(d.total) || 0) + (d.tipo === 'venta' ? (Number(d.igtf) || 0) : 0) - retenido(d) - (cobrado[d.id] || 0)) * 100) / 100,
      })).filter((d) => d.saldo > 0.01),
      declaraciones: (dec.data || []).map((d) => ({ id: d.id, impuesto: d.impuesto, periodo: d.periodo, quincena: d.quincena, numero: d.numero, a_pagar: Number(d.a_pagar) || 0, pagada: !!d.fecha_pago })),
      terceros: (window.__getTerceros ? window.__getTerceros() : []).map((t) => ({ nombre: t.nombre, rif: t.rif, telefono: t.tel })),
      otrasLineas: (otras.data || []).filter((o) => o.estado !== 'conciliada').map((o) => ({ id: o.id, cuenta_contable: subDe[o.cuenta_teso_id], fecha: o.fecha, monto: o.monto })),
    };
  }

  async function cargarMes(st) {
    if (!listo()) return;
    const body = st.$('lineas');
    if (!st.banco) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:14px;">Agrega un banco con «+ Banco» para empezar.</td></tr>'; pintarResumen(st, null); return; }
    const { data, error } = await window.sb.from('extracto_bancario').select('*').eq('cuenta_teso_id', st.banco).eq('periodo', st.mes);
    if (error) { st.msg('No se pudieron leer las líneas: ' + esc(error.message)); return; }
    st.lineas = (data || []).sort((a, b) => fechaNum(a.fecha) - fechaNum(b.fecha));
    await cargarContexto(st);
    st.lineas.forEach((l) => { l._sug = l.estado === 'conciliada' ? null : sugerirLinea(l, st.ctx); });
    pintarLineas(st);
    const { data: res } = await window.sb.rpc('contab_conciliacion_resumen', { p_cuenta_teso: st.banco, p_periodo: st.mes });
    pintarResumen(st, res);
  }

  function detalle(st, l) {
    if (l.clase === 'cobro' || l.clase === 'pago') {
      return l.tercero_nombre ? esc(l.tercero_nombre) : (l.libro_fiscal_id ? 'con su factura' : 'sin factura');
    }
    if (l.clase === 'impuesto') { const d = (st.ctx.declaraciones || []).find((x) => x.id === l.declaracion_id); return d ? esc(d.impuesto + ' ' + d.periodo) : ''; }
    if (l.clase === 'otra' || l.clase === 'registrado' || l.clase === 'transferencia') return esc(l.cuenta_contra || '');
    return '';
  }

  function pintarLineas(st) {
    const body = st.$('lineas');
    if (!st.lineas.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin líneas de ' + esc(mesTxt(st.mes)) + ' en este banco. Carga su estado de cuenta.</td></tr>';
    } else {
      body.innerHTML = st.lineas.map((l) => {
        const m = Number(l.monto) || 0, neg = m < 0;
        let clas, estado, accion;
        if (l.estado === 'conciliada') {
          clas = '<strong>' + esc(nombreClase(l.clase)) + '</strong><br><span style="font-size:11px;color:var(--fg-muted);">' + detalle(st, l) + '</span>';
          estado = '<span class="tag" style="background:#d5f0e0;color:#0a7a44;">Conciliada</span>';
          accion = '<button class="btn btn-ghost" data-deshacer="' + l.id + '" style="height:26px;font-size:11px;">Deshacer</button>';
        } else {
          const s = l._sug;
          clas = s ? (esc(nombreClase(s.clase)) + '<br><span style="font-size:11px;color:var(--fg-muted);">' + esc(s.motivo || '') + '</span>') : '<span style="color:var(--fg-muted);">Sin sugerencia</span>';
          estado = s ? (s.seguro ? '<span class="tag" style="background:#e0f2fe;color:#075985;">Segura</span>' : '<span class="tag" style="background:#fff8e6;color:#9a6700;">Revisar</span>') : '<span class="tag slate">Pendiente</span>';
          accion = '<button class="btn btn-primary" data-conciliar="' + l.id + '" style="height:26px;font-size:11px;">Conciliar…</button>';
        }
        return '<tr><td>' + esc(l.fecha) + '</td><td class="primary">' + esc(l.descripcion || '—') + '</td><td class="mono">' + esc(l.referencia || '') + '</td>'
          + '<td class="num" style="color:' + (neg ? '#b42318' : '#0a7a44') + ';">' + (neg ? '− ' : '+ ') + fmt(Math.abs(m)) + '</td>'
          + '<td style="font-size:12px;">' + clas + '</td><td>' + estado + '</td><td>' + accion + '</td></tr>';
      }).join('');
    }
    const seguras = st.lineas.filter((l) => l.estado !== 'conciliada' && l._sug && l._sug.seguro).length;
    const ap = st.$('aprobar');
    ap.disabled = !seguras;
    ap.innerHTML = '<i data-lucide="check-check"></i> Aprobar las seguras (' + seguras + ')';
    const conc = st.lineas.filter((l) => l.estado === 'conciliada').length;
    st.msg(st.lineas.length ? (st.lineas.length + ' líneas · ' + conc + ' conciliadas · ' + seguras + ' sugerencias seguras. Las que dicen «Revisar» coinciden solo en el monto: ábrelas y decide.')
      : 'Elige el banco y el mes, y carga su estado de cuenta.');
    if (window.lucide) window.lucide.createIcons();
  }

  function pintarResumen(st, r) {
    const box = st.$('resumen');
    if (!r) { box.innerHTML = ''; return; }
    const kpi = (lbl, val, sub) => '<div class="kpi"><div class="kpi-head"><span class="label">' + lbl + '</span></div><div class="kpi-value">' + val + '</div>' + (sub ? '<div class="kpi-sub"><span class="meta">' + sub + '</span></div>' : '') + '</div>';
    const sb = r.saldo_banco == null ? '<span style="font-size:14px;color:var(--fg-muted);">sin cargar</span>' : '<span class="currency">Bs</span> ' + fmt(r.saldo_banco);
    const dif = r.diferencia == null ? '—' : '<span class="currency">Bs</span> ' + fmt(r.diferencia);
    const ok = r.diferencia != null && Math.abs(Number(r.diferencia)) < 0.01;
    box.innerHTML = kpi('Saldo según el banco', sb, '<a href="#" data-saldo-banco style="color:var(--da-cyan-700);">' + (r.saldo_banco == null ? 'Escribir el saldo final' : 'Corregir') + '</a>')
      + kpi('Saldo según libros', '<span class="currency">Bs</span> ' + fmt(r.saldo_libros), 'asientos hasta el fin del mes')
      + kpi('Por conciliar', String((r.pendientes || {}).cantidad || 0), 'Bs ' + fmt((r.pendientes || {}).suma) + ' · en tránsito Bs ' + fmt((r.transito || {}).suma))
      + kpi('Diferencia', dif, r.diferencia == null ? 'falta el saldo del banco' : (ok ? '✓ Conciliado' : 'concilia las líneas pendientes'));
  }

  function opcionesBancos(st) {
    return st.bancos.filter((b) => b.id !== st.banco && b.cuenta_contable).map((b) => ({ value: b.cuenta_contable, label: b.cuenta_contable + ' · ' + b.nombre }));
  }

  function conciliar(st, l) {
    const s = l._sug || {};
    const m = Number(l.monto) || 0;
    const tipoDoc = m > 0 ? 'venta' : 'compra';
    const docs = (st.ctx.documentos || []).filter((d) => d.tipo === tipoDoc);
    const decls = (st.ctx.declaraciones || []).slice().sort((a, b) => (a.pagada === b.pagada ? 0 : a.pagada ? 1 : -1));
    window.openFormModal({
      title: 'Conciliar · ' + (l.descripcion || '') + ' · Bs ' + fmt(Math.abs(m)) + (m < 0 ? ' (sale)' : ' (entra)'),
      saveLabel: 'Conciliar',
      fields: [
        { name: 'x', label: ' ', col: 2, type: 'static', html: s.motivo ? '<div style="font-size:12px;color:var(--fg-muted);">Sugerencia: ' + esc(s.motivo) + '</div>' : '' },
        { name: 'clase', label: 'Qué es', col: 2, type: 'select', value: s.clase || l.clase || (m > 0 ? 'cobro' : 'pago'), options: CLASES.map((c) => ({ value: c.v, label: c.n })) },
        { name: 'doc', label: 'Factura (cobro o pago) · opcional', col: 2, type: 'select', value: s.libro_fiscal_id || l.libro_fiscal_id || '',
          options: [{ value: '', label: '— sin factura —' }].concat(docs.map((d) => ({ value: d.id, label: (d.numero || '(sin número)') + ' · ' + d.tercero + ' · por ' + (d.tipo === 'venta' ? 'cobrar' : 'pagar') + ' Bs ' + fmt(d.saldo) }))) },
        { name: 'decl', label: 'Declaración (pago de un impuesto)', col: 2, type: 'select', value: s.declaracion_id || l.declaracion_id || '',
          options: [{ value: '', label: '—' }].concat(decls.map((d) => ({ value: d.id, label: d.impuesto + ' ' + d.periodo + (d.quincena ? ' · ' + d.quincena + 'ª q.' : '') + ' · planilla ' + (d.numero || '') + ' · Bs ' + fmt(d.a_pagar) + (d.pagada ? ' (ya tiene pago)' : '') }))) },
        { name: 'banco2', label: 'El otro banco (transferencia)', col: 2, type: 'select', value: s.cuenta_contra || '',
          options: [{ value: '', label: '—' }].concat(opcionesBancos(st)) },
        { name: 'cuenta', label: 'Cuenta (otra, o «ya registrado»: por defecto 1.1.1.03 Bancos)', col: 2, type: 'datalist', value: l.cuenta_contra || '',
          options: st.plan.map((c) => ({ value: c.codigo, label: c.codigo + ' · ' + c.nombre })) },
      ],
      onSave: (v) => {
        const fila = { clase: v.clase, libro_fiscal_id: null, declaracion_id: null, cuenta_contra: null, extracto_par_id: null, tercero_nombre: null, tercero_rif: null, estado: 'conciliada' };
        if (v.clase === 'cobro' || v.clase === 'pago') {
          const d = docs.find((x) => x.id === v.doc);
          if (d) { fila.libro_fiscal_id = d.id; fila.tercero_nombre = d.tercero || null; fila.tercero_rif = d.rif || null; }
        } else if (v.clase === 'impuesto') {
          if (!v.decl) return 'Elige la declaración que se pagó.';
          fila.declaracion_id = v.decl;
        } else if (v.clase === 'transferencia') {
          if (!v.banco2) return 'Elige el otro banco.';
          fila.cuenta_contra = v.banco2;
          if (s.extracto_par_id && s.cuenta_contra === v.banco2) fila.extracto_par_id = s.extracto_par_id;
        } else if (v.clase === 'otra') {
          const c = String(v.cuenta || '').trim().split(' ')[0];
          if (!st.plan.some((x) => x.codigo === c)) return 'Elige una cuenta del plan.';
          fila.cuenta_contra = c;
        } else if (v.clase === 'registrado') {
          const c = String(v.cuenta || '').trim().split(' ')[0];
          fila.cuenta_contra = c && st.plan.some((x) => x.codigo === c) ? c : '1.1.1.03';
        }
        guardar(st, [{ id: l.id, fila: fila }]);
        return undefined;
      },
    });
  }

  async function guardar(st, cambios) {
    let fallas = 0;
    for (const c of cambios) {
      const { error } = await window.sb.from('extracto_bancario').update(c.fila).eq('id', c.id);
      if (error) { fallas++; console.warn('[Conciliación]', error.message); if (fallas === 1) toast('No se pudo conciliar: ' + error.message, 'error'); }
    }
    if (!fallas) toast(cambios.length === 1 ? 'Línea conciliada · su asiento está en el Libro Diario' : cambios.length + ' líneas conciliadas', 'success');
    if (window.cargarAsientos) window.cargarAsientos();
    if (window.cargarDeclaraciones) window.cargarDeclaraciones();
    await cargarMes(st);
  }

  function aprobarSeguras(st) {
    const sel = st.lineas.filter((l) => l.estado !== 'conciliada' && l._sug && l._sug.seguro);
    if (!sel.length) return;
    if (!window.confirm('¿Aprobar ' + sel.length + ' sugerencias seguras?\n\nSon las que coinciden en el monto y en otro dato (número, RIF, teléfono o nombre), o las comisiones e IGTF del banco. Cada una genera su asiento.')) return;
    guardar(st, sel.map((l) => ({ id: l.id, fila: {
      clase: l._sug.clase, libro_fiscal_id: l._sug.libro_fiscal_id || null, declaracion_id: l._sug.declaracion_id || null,
      cuenta_contra: l._sug.cuenta_contra || null, extracto_par_id: l._sug.extracto_par_id || null,
      tercero_nombre: l._sug.tercero_nombre || null, tercero_rif: l._sug.tercero_rif || null, estado: 'conciliada' } })));
  }

  function deshacer(st, l) {
    if (!window.confirm('¿Deshacer la conciliación de esta línea?\n\nSu asiento se borra' + (l.clase === 'impuesto' ? ' y la declaración vuelve a quedar sin pago, si el pago lo había puesto esta línea' : '') + '.')) return;
    (async () => {
      const { error } = await window.sb.from('extracto_bancario').update({ estado: 'pendiente' }).eq('id', l.id);
      if (error) { toast('No se pudo deshacer: ' + error.message, 'error'); return; }
      toast('Conciliación deshecha', 'success');
      if (window.cargarAsientos) window.cargarAsientos();
      if (window.cargarDeclaraciones) window.cargarDeclaraciones();
      await cargarMes(st);
    })();
  }

  function nuevoBanco(st) {
    if (!listo()) { toast('Elige primero una empresa.', 'error'); return; }
    window.openFormModal({
      title: 'Agregar banco o caja', saveLabel: 'Agregar',
      fields: [
        { name: 'nombre', label: 'Nombre (como lo quieres ver)', col: 2, placeholder: 'Ej. Banesco corriente 1234' },
        { name: 'banco', label: 'Banco', placeholder: 'Ej. Banesco' },
        { name: 'numero', label: 'N° de cuenta (opcional)' },
        { name: 'tipo', label: 'Tipo', type: 'select', options: ['Corriente', 'Ahorro', 'Efectivo / Caja'] },
        { name: 'moneda', label: 'Moneda', type: 'select', options: ['Bs', 'USD'] },
      ],
      onSave: (v) => {
        if (!String(v.nombre || '').trim()) return 'Escribe el nombre.';
        window.sb.from('cuentas_tesoreria').insert({
          cuenta_id: window.__CUENTA_ID, empresa_id: empresa().id, nombre: v.nombre.trim(), banco: (v.banco || '').trim() || null,
          numero: (v.numero || '').trim() || null, tipo: v.tipo, moneda: v.moneda, saldo_inicial: 0,
        }).select('id, cuenta_contable').single().then(({ data, error }) => {
          if (error) { toast('No se pudo agregar: ' + error.message, 'error'); return; }
          st.banco = data.id;
          toast('Banco agregado · su cuenta contable es ' + (data.cuenta_contable || '(se crea al correr el SQL 08)'), 'success');
          if (window.cargarCuentasContables) window.cargarCuentasContables();
          if (window.cargarTesoreria) window.cargarTesoreria();
          instancias.forEach((i) => cargarTodo(i));
        });
      },
    });
  }

  async function cargarArchivo(st) {
    const f = st.$('archivo').files[0];
    if (!f) { st.msg('Primero elige el archivo del estado de cuenta (PDF del banco o Excel/CSV).'); return; }
    if (!st.banco) { st.msg('Agrega o elige primero el banco.'); return; }
    let cab = { periodo: st.mes, banco: null, saldo_inicial: null, saldo_final: null };
    let movs = [];
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name || '')) {
      if (!(window.__ES_FUNDADOR || window.__ADDON_AGENTES)) { st.msg('La lectura de PDF es parte del add-on <strong>Agentes IA</strong>. Mientras tanto carga el estado de cuenta en Excel/CSV.'); return; }
      if (!window.__extraerEstadoCuenta || !window.__esperarTrabajoIA) { st.msg('El lector de PDF no está disponible.'); return; }
      st.$('cargar').disabled = true;
      st.msg('Enviando el estado de cuenta al <strong>Agente IA</strong>…');
      const envio = await window.__extraerEstadoCuenta(f);
      if (!envio.ok) { st.msg('No se pudo enviar: ' + esc(envio.error || '')); st.$('cargar').disabled = false; return; }
      const res = await window.__esperarTrabajoIA(envio.job, (n, seg) => st.msg('Leyendo el estado de cuenta… ' + (seg < 60 ? seg + ' s' : Math.round(seg / 6) / 10 + ' min') + ' (hasta ~7 min en los largos). No recargues la página.'));
      st.$('cargar').disabled = false;
      if (!res || !res.ok) { st.msg('No se pudo leer el PDF: ' + esc((res && res.error) || 'error desconocido')); return; }
      const p = String(res.periodo_desde || '').split('/');
      if (p.length === 3) cab.periodo = p[2] + '-' + p[1];
      cab.banco = res.banco || null; cab.saldo_inicial = res.saldo_inicial; cab.saldo_final = res.saldo_final;
      movs = res.movimientos || [];
      if (res.cuadra === false) toast('Ojo: la lectura del PDF no cuadra con los saldos del banco (dif. Bs ' + fmt(Math.abs(res.diferencia || 0)) + '). Revísala contra el PDF.', 'error');
    } else {
      movs = leerCSV(await f.text());
      if (!movs.length) { st.msg('No pude leer líneas. Revisa que el archivo tenga columnas fecha y monto (o débito y crédito).'); return; }
    }
    // La cabecera, una por banco y mes: cargarla de nuevo la actualiza.
    const filaCab = { cuenta_id: window.__CUENTA_ID, empresa_id: empresa().id, cuenta_teso_id: st.banco, periodo: cab.periodo, banco: cab.banco, archivo: f.name };
    if (cab.saldo_final != null) { filaCab.saldo_inicial = cab.saldo_inicial; filaCab.saldo_final = cab.saldo_final; }
    const { error: eC } = await window.sb.from('estados_cuenta').upsert(filaCab, { onConflict: 'cuenta_teso_id,periodo' });
    if (eC) { st.msg('No se pudo guardar el estado de cuenta: ' + esc(eC.message) + ' (¿se corrió sql/contabilidad_08_conciliacion.sql?)'); return; }
    // Las líneas, con la misma huella de siempre: cargar el mismo archivo dos veces no las duplica.
    const vistos = {};
    const filas = movs.map((m) => {
      const base = [m.fecha, m.referencia, m.monto, m.descripcion].join('|');
      const k = (vistos[base] = (vistos[base] || 0) + 1);
      return { cuenta_id: window.__CUENTA_ID, empresa_id: empresa().id, cuenta_teso_id: st.banco, fecha: m.fecha || '', descripcion: m.descripcion || '',
        referencia: m.referencia || '', monto: m.monto, periodo: cab.periodo, huella: base + '|' + k };
    });
    for (let i = 0; i < filas.length; i += 200) {
      const { error } = await window.sb.from('extracto_bancario').upsert(filas.slice(i, i + 200), { onConflict: 'cuenta_teso_id,huella', ignoreDuplicates: true });
      if (error) { st.msg('No se pudieron guardar las líneas: ' + esc(error.message)); return; }
    }
    st.mes = cab.periodo;
    const selM = st.$('mes');
    if (![...selM.options].some((o) => o.value === st.mes)) selM.insertAdjacentHTML('beforeend', '<option value="' + st.mes + '">' + mesTxt(st.mes) + '</option>');
    selM.value = st.mes;
    toast(filas.length + ' líneas de ' + mesTxt(st.mes) + ' cargadas', 'success');
    await cargarMes(st);
    if (cab.saldo_final == null) editarSaldoBanco(st);
  }

  function editarSaldoBanco(st) {
    if (!st.banco) return;
    window.openFormModal({
      title: 'Saldo del estado de cuenta · ' + mesTxt(st.mes), saveLabel: 'Guardar',
      fields: [
        { name: 'x', label: ' ', col: 2, type: 'static', html: '<div style="font-size:12px;color:var(--fg-muted);">Cópialo del estado de cuenta: con él se calcula la diferencia de la conciliación.</div>' },
        { name: 'ini', label: 'Saldo inicial (Bs)', type: 'number', step: '0.01' },
        { name: 'fin', label: 'Saldo final (Bs)', type: 'number', step: '0.01' },
      ],
      onSave: (v) => {
        const fin = parseFloat(v.fin);
        if (!isFinite(fin)) return 'Escribe el saldo final.';
        window.sb.from('estados_cuenta').upsert({ cuenta_id: window.__CUENTA_ID, empresa_id: empresa().id, cuenta_teso_id: st.banco, periodo: st.mes,
          saldo_inicial: isFinite(parseFloat(v.ini)) ? parseFloat(v.ini) : null, saldo_final: fin }, { onConflict: 'cuenta_teso_id,periodo' })
          .then(({ error }) => { if (error) toast('No se pudo guardar: ' + error.message, 'error'); else cargarMes(st); });
      },
    });
  }

  /* «Dar por cobrado y pagado»: para el cliente que no manda estado de
     cuenta. Pasa lo pendiente de CxC y CxP al cierre del mes a la cuenta
     elegida, en un solo asiento que se rehace igual si se corre de nuevo. */
  function darPorCobrado(st, mesFijo) {
    if (!listo()) { toast('Elige primero una empresa.', 'error'); return; }
    const opciones = st.bancos.filter((b) => b.cuenta_contable).map((b) => ({ value: b.cuenta_contable, label: b.cuenta_contable + ' · ' + b.nombre }))
      .concat([{ value: '1.1.1.03', label: '1.1.1.03 · Bancos (sin identificar)' }, { value: '1.1.1.01', label: '1.1.1.01 · Caja' }]);
    window.openFormModal({
      title: 'Dar por cobrado y pagado', saveLabel: 'Aplicar',
      fields: [
        { name: 'x', label: ' ', col: 2, type: 'static', html: '<div style="font-size:12px;line-height:1.55;">Para el cliente que no manda estado de cuenta: lo que quede por cobrar (CxC) y por pagar (CxP) al cierre del mes pasa a la cuenta que elijas, en un solo asiento al último día del mes. Lo ya conciliado no se vuelve a cancelar, y correrlo de nuevo lo recalcula.</div>' },
        { name: 'mes', label: 'Mes', type: 'select', value: mesFijo || st.mes, options: [...st.$('mes').options].map((o) => ({ value: o.value, label: o.textContent })) },
        { name: 'cuenta', label: 'Contra', type: 'select', value: opciones[0].value, options: opciones },
      ],
      onSave: (v) => {
        window.sb.rpc('contab_dar_por_cobrado', { p_empresa: empresa().id, p_periodo: v.mes, p_cuenta: v.cuenta }).then(({ data, error }) => {
          if (error) { toast('No se pudo aplicar: ' + error.message, 'error'); return; }
          toast('Listo en ' + mesTxt(v.mes) + ': por cobrado Bs ' + fmt(data && data.cxc) + ' · por pagado Bs ' + fmt(data && data.cxp), 'success');
          if (window.cargarAsientos) window.cargarAsientos();
          cargarMes(st);
        });
      },
    });
  }
  window.__darPorCobrado = (mes) => { const st = instancias[0]; if (!st) return; (st.cargado ? Promise.resolve() : cargarTodo(st)).then(() => darPorCobrado(st, mes)); };

  document.querySelectorAll('[data-concil-puerta]').forEach(montar);
  // Se cargan al abrir su pestaña (no al arrancar) y al cambiar de empresa.
  window.__recargarConciliacion = () => instancias.forEach((st) => { if (st.cargado) cargarTodo(st); });
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('#contaTabs button[data-tab="conciliacion"], button[data-tab="concil"]');
    if (!b) return;
    instancias.forEach((st) => { if (!st.cargado || st.el.closest('.conta-tab, .teso-tab') === document.querySelector('[data-tab="' + b.dataset.tab + '"].conta-tab, [data-tab="' + b.dataset.tab + '"].teso-tab')) cargarTodo(st); });
  });
})();
