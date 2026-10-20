/* =========================================================
   DigiAccount ERP — IMPORTAR LIBROS DESDE EXCEL
   Para que un contador que llega con su historia la cargue solo.

   Lee el Excel de compras o de ventas tal como lo llevan los contadores
   (una hoja por mes) o la plantilla de DigiAccount, y antes de escribir
   nada muestra cada hoja con su período, sus totales y si cuadra contra
   el renglón de TOTALES. El contador revisa y confirma.

   Es la misma lógica de herramientas/revisar_libros.py, con la que se
   migraron GATMA, Radian y José Agüero 4 al centavo:
     · las columnas se ubican por su NOMBRE, nunca por su posición
       (el reparto cambia entre hojas: la de IGTF aparece en febrero)
     · el período es el de la HOJA, que es donde se declaró, no la fecha
       de la factura
     · las anuladas conservan su número; la línea de una sucursal no se
       carga; un reporte Z se carga como tal
     · no se carga dos veces la misma factura
   Los terceros salen solos de los libros, sin duplicar por RIF.

   La librería de Excel (assets/vendor/xlsx.full.min.js, SheetJS 0.18.5)
   pesa casi 900 KB y solo se carga al abrir el importador.
   ========================================================= */
(function () {
  'use strict';

  const esc = window.__esc || ((s) => String(s == null ? '' : s));
  const toast = (m, t) => { if (window.toast) window.toast(m, t); };
  const TOL = 0.02;
  const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
    septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const NOMBRE_MES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // ── Texto y números ───────────────────────────────────────────────
  const plano = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const texto = (v) => { const t = String(v == null ? '' : v).trim(); return /^(nan|none)$/i.test(t) ? '' : t; };
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let t = texto(v).replace(/\s/g, '');
    if (!t || t === '-') return null;
    if (t.indexOf(',') >= 0 && t.indexOf('.') >= 0) {
      t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (t.indexOf(',') >= 0) t = t.replace(',', '.');
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  }
  const n0 = (v) => num(v) || 0;
  const fmt = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const normRif = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const rifUtil = (s) => String(s || '').replace(/\D/g, '').length >= 7;

  // Una fecha de celda: objeto Date, número de serie de Excel o texto dd/mm/aaaa.
  function leerFecha(v) {
    if (v instanceof Date && !isNaN(v)) return { a: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const f = new Date(Math.round((v - 25569) * 86400000));
      return { a: f.getUTCFullYear(), m: f.getUTCMonth() + 1, d: f.getUTCDate() };
    }
    const t = texto(v);
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { a: +m[1], m: +m[2], d: +m[3] };
    m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) { let a = +m[3]; if (a < 100) a += 2000; return { a: a, m: +m[2], d: +m[1] }; }
    return null;
  }
  const valida = (f) => f && f.m >= 1 && f.m <= 12 && f.d >= 1 && f.d <= 31 && f.a > 1990;
  const ddmmaa = (f) => String(f.d).padStart(2, '0') + '/' + String(f.m).padStart(2, '0') + '/' + String(f.a % 100).padStart(2, '0');
  const perDe = (f) => f.a + '-' + String(f.m).padStart(2, '0');

  // ── Las columnas, por su nombre (las mismas de revisar_libros.py) ──
  // '=' delante: el encabezado tiene que ser EXACTAMENTE eso.
  const COLUMNAS = {
    fecha: ['fecha de la factura'],
    nombre: ['proveedor o razon social', 'nombre o razon social'],
    factura: ['=n de factura', '=numero de factura'],
    control: ['n control de factura', '=n de control'],
    total: ['total compras internas incluyendo el iva', 'total ventas incluyendo el iva'],
    exento: ['compras sin derecho a credito iva', 'ventas internas no gravadas'],
    base: ['base imponible'],
    alicuota: ['alicuota'],
    iva: ['impuesto iva', '=iva'],
    igtf: ['igtf'],
    retenido: ['iva retenido al vendedor', 'iva retenido por el comprador'],
    rif: ['=no r i f', '=r i f', 'r i f', 'rif'],
    comprobante: ['comprobante de retencion', 'comprobante de iva'],
    maquina: ['maquina fiscal'],
    zeta: ['numero de zeta', 'n de zeta', 'zeta'],
    comp_desde: ['primer comprobante'],
    comp_hasta: ['ultimo comprobante'],
    // Notas de crédito y de débito: van en sus propias columnas del libro.
    nc: ['nota de credito'],
    nd: ['nota de debito'],
  };
  function mapear(fila) {
    const enc = fila.map(plano), mapa = {};
    const usados = () => Object.keys(mapa).map((k) => mapa[k]);
    [true, false].forEach((exactos) => {
      Object.keys(COLUMNAS).forEach((campo) => {
        if (campo in mapa) return;
        for (const a of COLUMNAS[campo]) {
          if (a.charAt(0) === '=' !== exactos) continue;
          const i = enc.findIndex((e, k) => usados().indexOf(k) < 0 && (exactos ? e === a.slice(1) : e.indexOf(a) >= 0));
          if (i >= 0) { mapa[campo] = i; break; }
        }
      });
    });
    return mapa;
  }
  const esEncabezado = (fila) => { const p = fila.map(plano);
    return p.some((c) => c.indexOf('fecha de la factura') >= 0) && p.some((c) => c.indexOf('base imponible') >= 0); };

  // El período de la hoja: primero el rango del encabezado
  // («Mes Junio: 01/06/2026 al 30/06/2026», que dice además la quincena),
  // si no, el nombre de la hoja («JUNIO 2026»).
  function periodoDeHoja(nombre, filas) {
    const cab = filas.slice(0, 12).map((f) => f.map(texto).join(' ')).join(' ');
    const m = cab.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*al\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m && m[2] === m[5] && m[3] === m[6]) {
      const d1 = +m[1], d2 = +m[4];
      const quincena = (d1 === 1 && d2 >= 28) ? null : (d1 <= 15 && d2 <= 16 ? 1 : 2);
      return { periodo: m[3] + '-' + String(+m[2]).padStart(2, '0'), quincena: quincena, origen: 'encabezado' };
    }
    const p = plano(nombre).split(' ');
    const mes = p.map((w) => MESES[w]).find(Boolean);
    const anio = p.find((w) => /^20\d\d$/.test(w));
    if (mes && anio) {
      const q = /(2da|segunda|2) quincena/.test(plano(nombre)) ? 2 : (/(1ra|primera|1) quincena/.test(plano(nombre)) ? 1 : null);
      return { periodo: anio + '-' + String(mes).padStart(2, '0'), quincena: q, origen: 'nombre de la hoja' };
    }
    return { periodo: '', quincena: null, origen: '' };
  }

  // ── Leer una hoja: operaciones, anuladas, reportes Z y su revisión ──
  function leerHoja(nombre, filas, tipoEsperado) {
    const h = { nombre: nombre, ops: [], avisos: [], errorGrave: '', totales: null, tipo: '', sucursales: [] };
    Object.assign(h, periodoDeHoja(nombre, filas));
    const iEnc = filas.findIndex(esEncabezado);
    if (iEnc < 0) { h.errorGrave = 'No tiene la fila de encabezados del libro (Fecha de la factura … Base imponible).'; return h; }
    const mapa = mapear(filas[iEnc]);
    const faltan = ['fecha', 'total', 'base', 'iva'].filter((c) => !(c in mapa));
    if (faltan.length) { h.errorGrave = 'Faltan columnas: ' + faltan.join(', ') + '.'; return h; }
    h.tipo = (mapa.nombre != null && plano(filas[iEnc][mapa.nombre]).indexOf('proveedor') >= 0) ? 'compra' : 'venta';
    if (tipoEsperado && h.tipo !== tipoEsperado) {
      h.errorGrave = 'Parece un libro de ' + h.tipo + 's y estás en el de ' + tipoEsperado + 's.';
      return h;
    }
    const c = (f, k) => (mapa[k] != null && mapa[k] < f.length ? f[mapa[k]] : '');
    let cerrada = false, ultimaFecha = null;
    for (const f of filas.slice(iEnc + 1)) {
      const crudo = f.map(texto).join(' ');
      if (!crudo.trim()) continue;
      // «TOTAL» o «TOTALES»: el de ventas viene en singular y se contaba como una venta más.
      if (/^\s*total(es)?\s*:?\s*$/.test(plano(texto(f[0])))) {
        if (!cerrada) {
          const t = { total: num(c(f, 'total')), exento: num(c(f, 'exento')), base: num(c(f, 'base')), iva: num(c(f, 'iva')) };
          h.totales = Object.keys(t).every((k) => t[k] == null) ? null : t;
          cerrada = true;
        }
        continue;
      }
      if (cerrada) continue;   // debajo de TOTALES viene el cuadro de la Forma 30
      const fecha = leerFecha(c(f, 'fecha'));
      const r = {
        fecha: valida(fecha) ? fecha : null, rif: texto(c(f, 'rif')), nombre: texto(c(f, 'nombre')),
        factura: texto(c(f, 'factura')), control: texto(c(f, 'control')),
        total: n0(c(f, 'total')), exento: n0(c(f, 'exento')), base: n0(c(f, 'base')), iva: n0(c(f, 'iva')),
        igtf: n0(c(f, 'igtf')), retenido: n0(c(f, 'retenido')), alicuota: num(c(f, 'alicuota')),
        comprobante: texto(c(f, 'comprobante')), maquina: texto(c(f, 'maquina')), zeta: texto(c(f, 'zeta')),
        comp_desde: texto(c(f, 'comp_desde')), comp_hasta: texto(c(f, 'comp_hasta')),
        nc: texto(c(f, 'nc')), nd: texto(c(f, 'nd')),
      };
      // Una nota se guarda como NC/ND con su propio número; el sistema le pone
      // el signo por el tipo de documento (sql/libro_notas_signo.sql).
      r.doc = r.nc ? 'NC' : (r.nd ? 'ND' : '');
      if (r.doc && !r.factura) r.factura = r.nc || r.nd;
      // La línea de resumen de una sucursal no es una operación: contaría dos
      // veces. Se guarda solo para cuadrar, porque el TOTAL de la casa matriz
      // sí la incluye.
      if (/sucursal/.test(plano(r.rif + ' ' + r.nombre + ' ' + crudo)) && !r.factura) {
        h.sucursales.push({ total: r.total, base: r.base, iva: r.iva });
        continue;
      }
      const hayMonto = Math.abs(r.total) > TOL || Math.abs(r.base) > TOL;
      if (!hayMonto && !r.fecha && !r.factura) continue;   // fila del formato, vacía
      // Sin fecha (suele pasar en las anuladas): la de la operación anterior,
      // que la ubica en su sitio del correlativo.
      if (!r.fecha && ultimaFecha) r.fechaPuesta = true;
      r.fecha = r.fecha || ultimaFecha;
      if (r.fecha) ultimaFecha = r.fecha;
      r.clase = (r.maquina && r.zeta) ? 'zeta' : (hayMonto ? 'operacion' : 'anulada');
      r.ref = r.clase === 'zeta' ? 'Z' + r.zeta : (r.factura || (r.fecha ? ddmmaa(r.fecha) : '(sin fecha)'));
      h.ops.push(r);
    }
    revisar(h);
    return h;
  }

  function revisar(h) {
    const s = { total: 0, exento: 0, base: 0, iva: 0 };
    h.cuenta = { operaciones: 0, anuladas: 0, zetas: 0, retenciones: 0 };
    const hoy = new Date();
    for (const r of h.ops) {
      if (r.clase === 'anulada') { h.cuenta.anuladas++; continue; }
      h.cuenta[r.clase === 'zeta' ? 'zetas' : 'operaciones']++;
      s.total += r.total; s.exento += r.exento; s.base += r.base; s.iva += r.iva;
      if (r.retenido > TOL) h.cuenta.retenciones++;
      const partes = r.exento + r.base + r.iva + r.igtf;
      if (Math.abs(r.total - partes) > TOL) h.avisos.push(r.ref + ': el total ' + fmt(r.total) + ' no es la suma de sus partes (' + fmt(partes) + ').');
      if (r.alicuota && r.base) {
        const a = r.alicuota < 1 ? r.alicuota : r.alicuota / 100;
        if (Math.abs(r.iva - r.base * a) > TOL) h.avisos.push(r.ref + ': el IVA ' + fmt(r.iva) + ' no corresponde a la base al ' + Math.round(a * 100) + '% (' + fmt(r.base * a) + ').');
      }
      if (!r.fecha) h.avisos.push(r.ref + ': sin fecha legible.');
      else if (new Date(r.fecha.a, r.fecha.m - 1, r.fecha.d) > hoy) h.avisos.push(r.ref + ': fecha en el futuro (' + ddmmaa(r.fecha) + ').');
      else if (h.periodo && perDe(r.fecha) > h.periodo) h.avisos.push(r.ref + ': fecha ' + ddmmaa(r.fecha) + ' posterior al período de la hoja.');
      else if (h.periodo && h.tipo === 'venta' && perDe(r.fecha) < h.periodo) h.avisos.push(r.ref + ': venta con fecha ' + ddmmaa(r.fecha) + ' anterior al período de la hoja.');
      if (r.clase === 'zeta') continue;
      if (!rifUtil(r.rif) || !r.nombre) h.avisos.push(r.ref + ': operación de ' + fmt(r.total) + ' sin RIF o sin nombre completos.');
      if (!r.factura) h.avisos.push('Operación de ' + fmt(r.total) + ' sin número de factura.');
      if (r.doc) h.cuenta.notas = (h.cuenta.notas || 0) + 1;
    }
    h.suma = s;
    h.cuadra = null;   // null = la hoja no trae TOTALES con qué contrastar
    if (h.totales) {
      const propio = (k) => s[k] + (h.sucursales || []).reduce((a, x) => a + x[k], 0);
      h.cuadra = ['total', 'base', 'iva'].every((k) => Math.abs((h.totales[k] || 0) - propio(k)) <= TOL);
      if (!h.cuadra) ['total', 'base', 'iva'].forEach((k) => {
        const d = (h.totales[k] || 0) - propio(k);
        if (Math.abs(d) > TOL) h.avisos.push('TOTALES: la hoja dice ' + fmt(h.totales[k]) + ' de ' + k + ' y sus filas suman ' + fmt(propio(k)) + ' (diferencia ' + fmt(d) + ').');
      });
    }
  }
  // Para las pruebas automáticas (herramientas/pruebas/correr.js).
  window.__importador = { leerHoja: leerHoja, periodoDeHoja: periodoDeHoja, mapear: mapear, num: num, leerFecha: leerFecha };

  // ── La librería de Excel, solo cuando hace falta ────────────────────
  let cargandoXlsx = null;
  function xlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!cargandoXlsx) cargandoXlsx = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = 'assets/vendor/xlsx.full.min.js';
      s.onload = () => ok(window.XLSX);
      s.onerror = () => { cargandoXlsx = null; mal(new Error('No se pudo cargar el lector de Excel. Revisa tu conexión.')); };
      document.head.appendChild(s);
    });
    return cargandoXlsx;
  }

  // ── Lo que ya hay en la base ────────────────────────────────────────
  async function todas(consulta) {
    const out = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await consulta().range(i, i + 999);
      if (error) throw error;
      out.push.apply(out, data || []);
      if (!data || data.length < 1000) return out;
    }
  }
  const llave = (tipo, factura, periodo, maquina, zeta) => zeta ? 'Z|' + (maquina || '') + '|' + zeta : 'F|' + tipo + '|' + (factura || '') + '|' + periodo;
  const TIPO_PERSONA = { J: 'Persona jurídica (J)', V: 'Persona natural · Venezolano (V)', E: 'Persona natural · Extranjero (E)', G: 'Ente gubernamental (G)' };

  // ── La ventana ─────────────────────────────────────────────────────
  let estado = null;   // { tipo, empresa, hojas, existentes, terceros }
  function ventana() {
    let ov = document.getElementById('impOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'impOverlay';
    ov.className = 'imp-overlay';
    ov.hidden = true;
    ov.innerHTML = '<div class="imp-modal" role="dialog" aria-modal="true" aria-labelledby="impTitulo">'
      + '<div class="imp-head"><h3 id="impTitulo">Importar libro</h3><button type="button" class="imp-x" id="impCerrar" aria-label="Cerrar">×</button></div>'
      + '<div class="imp-body" id="impCuerpo"></div>'
      + '<div class="imp-foot" id="impPie"></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#impCerrar').addEventListener('click', cerrar);
    return ov;
  }
  function cerrar() { const ov = document.getElementById('impOverlay'); if (ov) ov.hidden = true; estado = null; }
  const $ = (id) => document.getElementById(id);

  window.abrirImportadorLibro = function (tipo) {
    const emp = window.__EMPRESA_ACTIVA;
    if (!emp || !emp.id) { toast('Elige primero la empresa a la que pertenece el libro.', 'info'); return; }
    estado = { tipo: tipo, empresa: emp };
    const ov = ventana();
    $('impTitulo').textContent = 'Importar libro de ' + tipo + 's · ' + (emp.nombre || '');
    $('impCuerpo').innerHTML =
      '<p class="imp-p">Sube el Excel del libro de <strong>' + tipo + 's</strong>, con <strong>una hoja por mes</strong> (o por quincena). '
      + 'Sirve el formato que ya llevas si tiene los encabezados usuales del libro (Fecha de la factura, RIF, Base imponible…), o la plantilla de DigiAccount.</p>'
      + '<p class="imp-p">¿No tienes un formato? Descarga la plantilla de DigiAccount, con una hoja por mes: '
      + ['2025', '2026'].map((a) => '<a href="assets/plantillas/plantilla-libro-' + (tipo === 'compra' ? 'compras' : 'ventas') + '-' + a + '.xlsx" download>' + tipo + 's ' + a + '</a>').join(' · ') + '</p>'
      + '<label class="imp-archivo"><input type="file" id="impArchivo" accept=".xlsx,.xls,.xlsm"><span>Elegir el archivo Excel…</span></label>'
      + '<p class="imp-p imp-suave">Nada se guarda todavía: primero vas a ver cada hoja con sus totales para confirmar que cuadra con tu libro.</p>';
    $('impPie').innerHTML = '<button type="button" class="btn btn-ghost" id="impCancelar">Cancelar</button>';
    $('impCancelar').addEventListener('click', cerrar);
    $('impArchivo').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) leerArchivo(f); });
    ov.hidden = false;
  };

  async function leerArchivo(file) {
    $('impCuerpo').innerHTML = '<p class="imp-p">Leyendo <strong>' + esc(file.name) + '</strong>…</p>';
    try {
      const X = await xlsx();
      const buf = await file.arrayBuffer();
      // sheetRows: hay hojas con un millón de filas «fantasma» de formato.
      const libro = X.read(buf, { type: 'array', cellDates: true, sheetRows: 3000 });
      // La hoja de instrucciones de la plantilla no es un mes.
      const hojas = libro.SheetNames.filter((n) => plano(n) !== 'instrucciones').map((n) => leerHoja(n, X.utils.sheet_to_json(libro.Sheets[n], { header: 1, raw: true, defval: '', blankrows: false }), estado.tipo))
        .filter((h) => h.ops.length || h.errorGrave);
      if (!hojas.length) throw new Error('El archivo no trae ninguna hoja con operaciones.');
      estado.archivo = file.name;
      estado.hojas = hojas;
      // Lo ya cargado de esta empresa, para no repetirlo
      const emp = estado.empresa;
      const ya = await todas(() => window.sb.from('libro_fiscal').select('numero_factura,periodo,numero_zeta,maquina_fiscal').eq('empresa_id', emp.id).eq('tipo', estado.tipo));
      estado.existentes = new Set(ya.map((r) => llave(estado.tipo, r.numero_factura, r.periodo, r.maquina_fiscal, r.numero_zeta)));
      estado.terceros = await todas(() => window.sb.from('terceros').select('id,rif,es_cliente,es_proveedor,agente_retencion').eq('cuenta_id', window.__CUENTA_ID));
      const yaRet = await todas(() => window.sb.from('retenciones').select('factura,comprobante,direccion').eq('empresa_id', emp.id).eq('tipo', 'iva'));
      estado.retExistentes = new Set(yaRet.map((r) => r.direccion + '|' + (r.factura || '') + '|' + (r.comprobante || '')));
      hojas.forEach((h) => { h.marcada = !h.errorGrave && !!h.periodo && h.cuadra !== false; });
      vistaPrevia();
    } catch (err) {
      console.error('[Importador]', err);
      $('impCuerpo').innerHTML = '<p class="imp-p imp-error">' + esc(err.message || err) + '</p>';
    }
  }

  // Lo que efectivamente se cargaría con las hojas marcadas
  function plan() {
    const tipo = estado.tipo, filas = [], rets = [], nuevosRif = new Map(), rolesFaltan = new Map();
    const porRif = new Map(estado.terceros.map((t) => [normRif(t.rif), t]));
    const vistos = new Set();
    let repetidas = 0;
    const dir = tipo === 'venta' ? 'sufrida' : 'practicada';
    for (const h of estado.hojas) {
      if (!h.marcada || h.errorGrave || !h.periodo) continue;
      for (const r of h.ops) {
        const k = llave(tipo, r.factura, h.periodo, r.clase === 'zeta' ? r.maquina : '', r.clase === 'zeta' ? r.zeta : '');
        if (estado.existentes.has(k) || vistos.has(k)) { repetidas++; continue; }
        vistos.add(k);
        const anulada = r.clase === 'anulada', zeta = r.clase === 'zeta';
        const f = r.fecha || { a: +h.periodo.slice(0, 4), m: +h.periodo.slice(5, 7), d: h.quincena === 2 ? 16 : 1 };
        let alic = r.alicuota || 0.16; if (alic > 1) alic = alic / 100;
        const rifOk = !anulada && rifUtil(r.rif) ? normRif(r.rif) : '';
        filas.push({
          cuenta_id: window.__CUENTA_ID, empresa_id: estado.empresa.id, tipo: tipo,
          fecha: ddmmaa(f), periodo: h.periodo, quincena: h.quincena,
          tercero_nombre: anulada ? 'ANULADA' : r.nombre, tercero_rif: rifOk,
          numero_factura: r.factura, numero_control: r.control,
          tipo_doc: r.doc || (tipo === 'compra' ? 'FC' : 'FV'),
          // En positivo siempre: si el Excel trae la nota en negativo, el signo
          // ya lo pone el tipo de documento y restarla dos veces la sumaría.
          exento: anulada ? 0 : Math.abs(r.exento), base: anulada ? 0 : Math.abs(r.base), alicuota: alic,
          iva: anulada ? 0 : Math.abs(r.iva), igtf: anulada ? 0 : Math.abs(r.igtf), total: anulada ? 0 : Math.abs(r.total),
          base_gen: anulada ? 0 : Math.abs(r.base), iva_gen: anulada ? 0 : Math.abs(r.iva), base_red: 0, iva_red: 0, base_adic: 0, iva_adic: 0,
          maquina_fiscal: zeta ? r.maquina : null, numero_zeta: zeta ? r.zeta : null,
          comprobante_desde: zeta ? r.comp_desde : null, comprobante_hasta: zeta ? r.comp_hasta : null,
        });
        // La retención de IVA del renglón: la que le hizo el cliente (venta)
        // o la que se le practicó al proveedor (compra).
        if (!anulada && !r.doc && r.retenido > TOL && r.iva > TOL) {
          const kr = dir + '|' + r.factura + '|' + r.comprobante;
          if (!estado.retExistentes.has(kr)) rets.push({
            cuenta_id: window.__CUENTA_ID, empresa_id: estado.empresa.id, direccion: dir, tipo: 'iva',
            fecha: ddmmaa(f), comprobante: r.comprobante, tercero_nombre: r.nombre, tercero_rif: rifOk,
            factura: r.factura, numero_control: r.control, base: r.iva, monto: r.retenido,
            pct: Math.round(r.retenido / r.iva * 100), estado: 'Registrado', periodo: h.periodo, quincena: h.quincena, sustraendo: 0,
          });
        }
        // El tercero, si no existe; o el rol que le falte
        if (rifOk) {
          const agente = tipo === 'venta' && r.retenido > TOL;
          const t = porRif.get(rifOk);
          if (!t) {
            const n = nuevosRif.get(rifOk);
            if (!n) nuevosRif.set(rifOk, {
              cuenta_id: window.__CUENTA_ID, rif: rifOk, nombre: r.nombre,
              tipo_persona: TIPO_PERSONA[rifOk.charAt(0)] || '',
              es_cliente: tipo === 'venta', es_proveedor: tipo === 'compra',
              condicion_fiscal: agente ? 'Contribuyente especial' : 'Contribuyente ordinario', agente_retencion: agente,
            });
            else if (agente && !n.agente_retencion) { n.agente_retencion = true; n.condicion_fiscal = 'Contribuyente especial'; }
          } else {
            const falta = {};
            if (tipo === 'venta' && !t.es_cliente) falta.es_cliente = true;
            if (tipo === 'compra' && !t.es_proveedor) falta.es_proveedor = true;
            if (agente && !t.agente_retencion) { falta.agente_retencion = true; falta.condicion_fiscal = 'Contribuyente especial'; }
            if (Object.keys(falta).length) rolesFaltan.set(t.id, Object.assign(rolesFaltan.get(t.id) || {}, falta));
          }
        }
      }
    }
    return { filas: filas, rets: rets, nuevos: Array.from(nuevosRif.values()), roles: rolesFaltan, repetidas: repetidas };
  }

  function vistaPrevia() {
    const p = plan();
    const filasTabla = estado.hojas.map((h, i) => {
      const cuadre = h.errorGrave ? '<span class="imp-tag mal">No se pudo leer</span>'
        : h.cuadra === true ? '<span class="imp-tag bien">Cuadra con TOTALES</span>'
        : h.cuadra === false ? '<span class="imp-tag mal">No cuadra</span>'
        : '<span class="imp-tag">Sin fila TOTALES</span>';
      return '<tr' + (h.errorGrave ? ' class="imp-off"' : '') + '>'
        + '<td><input type="checkbox" data-hoja="' + i + '"' + (h.marcada ? ' checked' : '') + (h.errorGrave ? ' disabled' : '') + ' aria-label="Cargar ' + esc(h.nombre) + '"></td>'
        + '<td><strong>' + esc(h.nombre) + '</strong>' + (h.errorGrave ? '<div class="imp-suave">' + esc(h.errorGrave) + '</div>' : '') + '</td>'
        + '<td><input type="month" data-per="' + i + '" value="' + esc(h.periodo) + '"' + (h.errorGrave ? ' disabled' : '') + '>'
        + (h.quincena ? '<div class="imp-suave">' + h.quincena + 'ª quincena</div>' : '') + '</td>'
        + '<td class="num">' + (h.cuenta ? h.cuenta.operaciones + h.cuenta.zetas : '—') + (h.cuenta && h.cuenta.anuladas ? '<div class="imp-suave">+' + h.cuenta.anuladas + ' anuladas</div>' : '') + '</td>'
        + '<td class="num">' + (h.suma ? fmt(h.suma.base) : '—') + '</td>'
        + '<td class="num">' + (h.suma ? fmt(h.suma.iva) : '—') + '</td>'
        + '<td>' + cuadre + (h.avisos.length ? '<div class="imp-suave">' + h.avisos.length + ' aviso(s)</div>' : '') + '</td></tr>';
    }).join('');
    const avisos = estado.hojas.filter((h) => h.avisos.length && !h.errorGrave).map((h) =>
      '<details><summary>' + esc(h.nombre) + ' · ' + h.avisos.length + ' aviso(s)</summary><ul>'
      + h.avisos.slice(0, 40).map((a) => '<li>' + esc(a) + '</li>').join('') + (h.avisos.length > 40 ? '<li>… y ' + (h.avisos.length - 40) + ' más</li>' : '') + '</ul></details>').join('');
    const base = p.filas.reduce((a, r) => a + r.base, 0), iva = p.filas.reduce((a, r) => a + r.iva, 0);
    $('impCuerpo').innerHTML =
      '<p class="imp-p"><strong>' + esc(estado.archivo) + '</strong> · revisa cada hoja. Las que no cuadran contra su fila TOTALES vienen desmarcadas: corrige el Excel o márcalas si ya lo revisaste.</p>'
      + '<div class="imp-tabla"><table><thead><tr><th></th><th>Hoja</th><th>Período</th><th class="num">Operaciones</th><th class="num">Base</th><th class="num">IVA</th><th>Cuadre</th></tr></thead><tbody>' + filasTabla + '</tbody></table></div>'
      + (avisos ? '<div class="imp-avisos"><p class="imp-p"><strong>Avisos</strong> — no impiden cargar, pero conviene revisarlos:</p>' + avisos + '</div>' : '')
      + '<div class="imp-resumen">'
      + '<div><span>Se cargarían</span><strong>' + p.filas.length + '</strong><em>renglones</em></div>'
      + '<div><span>Base</span><strong>' + fmt(base) + '</strong><em>IVA ' + fmt(iva) + '</em></div>'
      + '<div><span>Terceros nuevos</span><strong>' + p.nuevos.length + '</strong><em>' + (p.roles.size ? p.roles.size + ' existentes se actualizan' : 'los demás ya existen') + '</em></div>'
      + '<div><span>Retenciones de IVA</span><strong>' + p.rets.length + '</strong><em>' + (p.repetidas ? p.repetidas + ' ya cargadas se omiten' : 'nada repetido') + '</em></div>'
      + '</div>';
    $('impPie').innerHTML = '<button type="button" class="btn btn-ghost" id="impCancelar">Cancelar</button>'
      + '<button type="button" class="btn btn-primary" id="impConfirmar"' + (p.filas.length ? '' : ' disabled') + '>Cargar ' + p.filas.length + ' renglones</button>';
    $('impCancelar').addEventListener('click', cerrar);
    $('impConfirmar').addEventListener('click', confirmar);
    $('impCuerpo').querySelectorAll('[data-hoja]').forEach((c) => c.addEventListener('change', () => { estado.hojas[+c.dataset.hoja].marcada = c.checked; vistaPrevia(); }));
    $('impCuerpo').querySelectorAll('[data-per]').forEach((c) => c.addEventListener('change', () => {
      const h = estado.hojas[+c.dataset.per]; h.periodo = c.value; revisar(h); vistaPrevia();
    }));
  }

  async function confirmar() {
    const p = plan();
    if (!p.filas.length) return;
    const btn = $('impConfirmar');
    btn.disabled = true;
    const paso = (t) => { btn.textContent = t; };
    try {
      // 1) Terceros primero: el libro los nombra por RIF
      for (let i = 0; i < p.nuevos.length; i += 200) {
        paso('Terceros ' + Math.min(i + 200, p.nuevos.length) + '/' + p.nuevos.length + '…');
        const { error } = await window.sb.from('terceros').insert(p.nuevos.slice(i, i + 200));
        if (error) throw new Error('No se pudieron crear los terceros: ' + error.message);
      }
      for (const [id, falta] of p.roles) {
        const { error } = await window.sb.from('terceros').update(falta).eq('id', id);
        if (error) console.warn('[Importador] rol de tercero:', error.message);
      }
      // 2) El libro, de a lotes: un corte a mitad deja cargado lo anterior,
      //    y al repetir la importación lo ya cargado se omite solo.
      for (let i = 0; i < p.filas.length; i += 200) {
        paso('Libro ' + Math.min(i + 200, p.filas.length) + '/' + p.filas.length + '…');
        const { error } = await window.sb.from('libro_fiscal').insert(p.filas.slice(i, i + 200));
        if (error) throw new Error('Se detuvo en el renglón ' + (i + 1) + ': ' + error.message + '. Lo anterior quedó guardado; vuelve a importar el mismo archivo y continúa donde quedó.');
      }
      // 3) Las retenciones
      for (let i = 0; i < p.rets.length; i += 200) {
        paso('Retenciones ' + Math.min(i + 200, p.rets.length) + '/' + p.rets.length + '…');
        const { error } = await window.sb.from('retenciones').insert(p.rets.slice(i, i + 200));
        if (error) throw new Error('El libro quedó cargado, pero las retenciones no: ' + error.message);
      }
      const n = p.filas.length, tipo = estado.tipo;   // antes de cerrar: cerrar() borra el estado
      cerrar();
      toast(n + ' renglones cargados en el libro de ' + tipo + 's' + (p.nuevos.length ? ' · ' + p.nuevos.length + ' terceros nuevos' : ''), 'success');
      if (window.cargarLibroFiscal) window.cargarLibroFiscal(tipo);
      if (window.cargarTerceros) window.cargarTerceros();
    } catch (err) {
      console.error('[Importador]', err);
      btn.disabled = false;
      btn.textContent = 'Reintentar';
      const pie = $('impPie');
      let m = document.getElementById('impMsg');
      if (!m) { m = document.createElement('p'); m.id = 'impMsg'; m.className = 'imp-p imp-error'; pie.prepend(m); }
      m.textContent = err.message || String(err);
    }
  }

  // Los botones «Importar Excel» de los dos libros
  // (atributo propio: los [data-libro-action] los toma app.js y los manda a imprimir)
  document.querySelectorAll('[data-importar-libro]').forEach((b) =>
    b.addEventListener('click', () => window.abrirImportadorLibro(b.dataset.importarLibro)));
})();
