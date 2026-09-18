/* =========================================================
   DigiAccount ERP — INVENTARIO
   Los articulos, la materia prima, los servicios y las ordenes de
   compra, con el descuento de existencias al vender.

   Solo usaba un nombre privado del bloque grande —`esc`—, que ya vive
   en el nucleo.

   Se carga DESPUES de app.js: lo que expone —la lista de productos y el
   descuento de existencias— lo consumen ventas y compras
   a traves de `window.*`, y lo que necesita de ellos tambien.
   ========================================================= */
(function () {
  'use strict';

  // Los nombres cortos que usa el cuerpo, apuntando al nucleo.
  const esc = window.__esc;

  /* =========================================================
     INVENTARIO — acciones (crear artículo/MP/orden/servicio, exportar, OC…)
     ========================================================= */
  (function inventoryActions() {
    const view = document.getElementById('view-inventario');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const fmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const currentMode = () => { const c = view.querySelector('.inv-mode-card[data-active="true"]'); return c ? c.dataset.mode : 'comercial'; };
    const ICONS = ['package', 'package-2', 'box', 'coffee', 'milk', 'wheat', 'droplet'];

    // Contadores de correlativos (memoria)
    let skuSeq = 269, mpSeq = 39, opSeq = 46, srvSeq = 45;

    function tbodyOf(paneClass, tab) {
      const pane = view.querySelector('.' + paneClass + '[data-tab="' + tab + '"]');
      return pane ? pane.querySelector('table.data-table tbody') : null;
    }

    // Construye el HTML de una fila de artículo a partir de un registro de la base
    function filaArticulo(p) {
      const stock = Number(p.stock) || 0, min = Number(p.stock_min) || 0, costo = Number(p.costo) || 0;
      const estado = stock <= min ? (stock < min / 2 ? '<span class="tag danger">Crítico</span>' : '<span class="tag warn">Bajo</span>') : '<span class="tag success">Óptimo</span>';
      const tag = p.alicuota === 'Exento' ? '<span class="tag slate">Exento</span>' : '<span class="tag navy">' + (p.alicuota || '16%') + '</span>';
      const nombre = p.nombre || '', sku = p.sku || '', cat = p.categoria || '';
      return '<td><div class="prod-cell"><div class="prod-thumb"><i data-lucide="package"></i></div><div class="info"><div class="n">' + nombre + '</div><div class="sku">' + sku + '</div></div></div></td>'
        + '<td>' + cat + '</td>'
        + '<td><div class="stock-cell"><div class="qty">' + stock + ' <span class="unit">' + (p.unidad || 'und') + '</span></div><div class="stock-bar"><span style="width:60%"></span></div><div class="min-note">Mín. ' + min + '</div></div></td>'
        + '<td class="num">' + fmt(costo) + '</td><td class="num">' + fmt(Number(p.precio) || 0) + '</td><td>' + tag + '</td>'
        + '<td class="num">' + fmt(stock * costo) + '</td><td style="white-space:nowrap;">' + estado
        + ' <button class="btn btn-ghost" data-prod-edit="' + (p.id || '') + '" title="Editar o eliminar" style="height:22px;font-size:10px;padding:0 7px;margin-left:4px;"><i data-lucide="pencil" style="width:11px;height:11px;"></i></button></td>';
    }
    /* Carga los artículos de LA EMPRESA ACTIVA.

       Antes traía todos los de la cuenta: un producto registrado en una
       empresa aparecía en todas las demás, con su precio y su existencia.
       La RLS aísla por cuenta, no por empresa — si la consulta no filtra,
       no filtra nadie.

       Con el stock eso es más grave que con los terceros. Un tercero
       repetido es una comodidad; una existencia compartida entre negocios
       que no tienen relación es un inventario que miente en los dos.

       Los que quedaron sin empresa (`empresa_id` nulo) NO se pintan, pero
       tampoco se esconden: se cuentan y se ofrecen para traerlos aquí.
       Hacerlos desaparecer en silencio sería peor que el fallo. */
    let _prodHuerfanos = [];

    /* Los artículos que quedaron sin empresa, de cuando el catálogo era uno
       solo para toda la cuenta. Se dicen aquí, con el botón para traerlos,
       porque el sitio donde se echan de menos es este. */
    function pintarHuerfanos(tb) {
      if (!tb || !_prodHuerfanos.length) return;
      const emp = window.__EMPRESA_ACTIVA || {};
      const n = _prodHuerfanos.length;
      const nombres = _prodHuerfanos.slice(0, 4).map((p) => p.nombre).filter(Boolean).join(', ')
        + (n > 4 ? ' y ' + (n - 4) + ' más' : '');
      const fila = document.createElement('tr');
      fila.innerHTML = '<td colspan="9" style="padding:10px 12px;">'
        + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px;line-height:1.5;'
        + 'background:var(--da-amber-50,#fff8e6);color:var(--da-amber-700,#9a6700);padding:10px 12px;border-radius:6px;">'
        + '<span><strong>' + n + ' artículo' + (n === 1 ? '' : 's') + ' sin empresa asignada</strong> '
        + '(' + esc(nombres) + '). Vienen de cuando el catálogo era uno solo para toda la cuenta, '
        + 'y por eso no se muestran aquí.</span>'
        + '<button class="btn btn-ghost" id="prodAdoptar" style="height:28px;font-size:11px;white-space:nowrap;">'
        + 'Traerlos a ' + esc(emp.nombre || 'esta empresa') + '</button></div></td>';
      tb.appendChild(fila);
      const btn = fila.querySelector('#prodAdoptar');
      if (btn) btn.addEventListener('click', async () => {
        if (!emp.id) { toast('Elige una empresa primero.', 'error'); return; }
        if (!window.confirm('¿Asignar ' + n + ' artículo' + (n === 1 ? '' : 's') + ' a '
          + (emp.nombre || 'esta empresa') + '?\n\nSi son de otra empresa, cancélalo: '
          + 'después habría que moverlos uno por uno.')) return;
        btn.disabled = true;
        const { error } = await window.sb.from('productos')
          .update({ empresa_id: emp.id }).is('empresa_id', null);
        if (error) { toast('No se pudo asignar: ' + error.message, 'error'); btn.disabled = false; return; }
        toast(n + ' artículo' + (n === 1 ? '' : 's') + ' asignado' + (n === 1 ? '' : 's')
          + ' a ' + (emp.nombre || 'esta empresa'), 'success');
        _prodHuerfanos = [];
        cargarProductos();
      });
    }

    async function cargarProductos() {
      if (!window.sb) return;
      const tb = tbodyOf('invpane-com', 'articulos'); if (!tb) return;
      const emp = window.__EMPRESA_ACTIVA || {};
      let data = null, error = null;
      if (emp.id) {
        const r = await window.sb.from('productos').select('*').eq('empresa_id', emp.id).order('nombre');
        data = r.data; error = r.error;
      }
      /* Si la columna todavía no existe en la base —falta correr
         sql/catalogo_por_empresa.sql— se sigue como antes en vez de dejar
         la pantalla en blanco, y se dice por qué. */
      if (error && /empresa_id/.test(error.message || '')) {
        console.warn('[DigiAccount] La tabla productos aún no tiene empresa_id. '
          + 'Corre sql/catalogo_por_empresa.sql para separar el catálogo por empresa.');
        const r2 = await window.sb.from('productos').select('*').order('nombre');
        data = r2.data; error = r2.error;
      } else if (!error && emp.id) {
        // Los que quedaron sin dueño, para poder ofrecerlos.
        const h = await window.sb.from('productos').select('id,nombre,stock').is('empresa_id', null);
        _prodHuerfanos = (h.error ? [] : (h.data || []));
      }
      if (error) { console.warn('[DigiAccount] No se pudieron cargar productos:', error.message); return; }
      const arr = data || [];
      window.__PRODUCTOS = arr;   // disponible para el recibo (selector de productos)
      tb.innerHTML = arr.map((p) => '<tr>' + filaArticulo(p) + '</tr>').join('');
      pintarHuerfanos(tb);
      tb.querySelectorAll('[data-prod-edit]').forEach((b) => b.addEventListener('click', () => editarArticulo(b.dataset.prodEdit)));
      // Actualizar KPIs y contadores con datos reales
      const total = arr.length;
      const valor = arr.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.costo) || 0), 0);
      const critico = arr.filter((p) => (Number(p.stock) || 0) <= (Number(p.stock_min) || 0)).length;
      const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      setTxt('invKpiArticulos', total); setTxt('invKpiValor', fmt(valor)); setTxt('invKpiCritico', critico);
      setTxt('invTabArticulos', total); setTxt('invShown', total); setTxt('invTotal', total);
      console.log('[DigiAccount] Productos cargados:', total);
      if (window.lucide) window.lucide.createIcons();
    }
    window.cargarProductos = cargarProductos;
    window.__getProductos = () => window.__PRODUCTOS || [];
    cargarProductos();

    // Categorías: las base + las que el usuario haya creado en sus productos
    const CATS_BASE = ['Alimentos', 'Bebidas', 'Limpieza', 'Cuidado personal', 'Charcutería', 'Ferretería', 'Repuestos', 'Otros'];
    function catsActuales() {
      const set = {};
      CATS_BASE.forEach((c) => { set[c] = 1; });
      (window.__PRODUCTOS || []).forEach((p) => { if (p.categoria) set[p.categoria] = 1; });
      return Object.keys(set).sort();
    }
    const UNIDADES = { 'Unidad / pieza': 'und', 'Kg': 'kg', 'Gramo': 'g', 'Litro': 'L', 'Ml': 'ml', 'Metro': 'm', 'Caja': 'caja', 'Bulto': 'bulto', 'Docena': 'doc' };

    /* ── El precio en dólares ────────────────────────────────────────
       El ancla es por artículo: un abasto tiene la harina en bolívares y
       el whisky en dólares. La conversión va a la tasa del BCV, que es la
       que exige el SENIAT en la factura. */
    const MONEDAS_PRECIO = ['Bolívares (Bs)', 'Dólares ($)'];
    const monedaClave = (txt) => (/\$|d[oó]lar/i.test(String(txt || '')) ? 'USD' : 'BS');
    const monedaTexto = (clave) => (clave === 'USD' ? MONEDAS_PRECIO[1] : MONEDAS_PRECIO[0]);

    /* Los dos campos de precio cambian de etiqueta con la moneda elegida, y
       debajo se muestra el equivalente con la tasa vigente. Se calcula a la
       vista y no al guardar: quien carga un catálogo necesita ver el número
       antes de confirmarlo, no después. */
    function montarMonedaPrecio(body) {
      if (!body) return;
      const selMon = body.querySelector('[data-name="moneda"]');
      const elCosto = body.querySelector('[data-name="costo"]');
      const elPrecio = body.querySelector('[data-name="precio"]');
      const nota = body.querySelector('#artEquiv');
      if (!selMon || !elCosto || !elPrecio) return;

      const lblDe = (el) => {
        const campo = el.closest('.fm-field');
        return campo ? campo.querySelector('.fm-lbl') : null;
      };
      const fmtBs = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      function pintar() {
        const esUsd = monedaClave(selMon.value) === 'USD';
        const uni = esUsd ? '($)' : '(Bs)';
        const lc = lblDe(elCosto), lp = lblDe(elPrecio);
        if (lc) lc.textContent = 'Costo ' + uni + ' por unidad';
        if (lp) lp.textContent = 'Precio venta ' + uni + ' por unidad';

        if (!nota) return;
        const tasa = Number(window.__bcvRate) || 0;
        if (!esUsd) {
          nota.innerHTML = 'El precio queda fijo en bolívares. Para que siga a la tasa del día, '
            + 'elige <strong>Dólares</strong>.';
          return;
        }
        if (!(tasa > 0)) {
          nota.innerHTML = '<span style="color:var(--da-danger);">No hay tasa del BCV cargada todavía, '
            + 'así que no puedo mostrarte el equivalente en bolívares.</span>';
          return;
        }
        const c = Number(elCosto.value) || 0, p = Number(elPrecio.value) || 0;
        nota.innerHTML = 'A la tasa de hoy (<strong>Bs ' + fmtBs(tasa) + '</strong> por $): '
          + 'costo <strong>Bs ' + fmtBs(c * tasa) + '</strong> · '
          + 'venta <strong>Bs ' + fmtBs(p * tasa) + '</strong>.'
          + '<br>Se guarda el precio en dólares; los bolívares se recalculan con la tasa de cada día.';
      }

      selMon.addEventListener('change', pintar);
      elCosto.addEventListener('input', pintar);
      elPrecio.addEventListener('input', pintar);
      pintar();
    }

    /* Los campos de precio que comparten los dos formularios. `p` es el
       artículo al editar, o nada al crear. */
    function camposPrecio(p) {
      const esUsd = String((p || {}).moneda_precio || 'BS') === 'USD';
      const valCosto = esUsd ? (p || {}).costo_usd : (p || {}).costo;
      const valPrecio = esUsd ? (p || {}).precio_usd : (p || {}).precio;
      const uni = esUsd ? '($)' : '(Bs)';
      return [
        { name: 'moneda', label: 'Precio fijado en', col: 2, type: 'select',
          options: MONEDAS_PRECIO, value: monedaTexto(esUsd ? 'USD' : 'BS') },
        { name: 'costo', label: 'Costo ' + uni + ' por unidad', type: 'number', step: '0.01',
          value: p ? String(Number(valCosto) || 0) : '', placeholder: '0.00' },
        { name: 'precio', label: 'Precio venta ' + uni + ' por unidad', type: 'number', step: '0.01',
          value: p ? String(Number(valPrecio) || 0) : '', placeholder: '0.00' },
        { name: 'equiv', col: 2, type: 'static', label: '',
          html: '<div id="artEquiv" style="font-size:11.5px;color:var(--fg-muted);line-height:1.55;"></div>' },
      ];
    }

    /* Lo que se guarda. En dólares manda `*_usd` y el bolívar se deriva —el
       disparador de la base lo vuelve a calcular al escribir, así que aquí se
       manda ya convertido solo para que la pantalla no muestre un cero
       mientras llega la respuesta. */
    /* Si la base todavía no tiene las columnas del precio en dólares, se
       guarda en bolívares y se avisa. Vale más un artículo bien registrado en
       bolívares que un formulario que no deja guardar nada. */
    function sinColumnasUsd(patch) {
      const p = Object.assign({}, patch);
      delete p.moneda_precio; delete p.costo_usd; delete p.precio_usd;
      return p;
    }
    const faltaColumnaUsd = (msg) => /moneda_precio|costo_usd|precio_usd/.test(String(msg || ''));

    function patchPrecio(v) {
      const esUsd = monedaClave(v.moneda) === 'USD';
      const c = Number(v.costo) || 0, p = Number(v.precio) || 0;
      if (!esUsd) {
        return { moneda_precio: 'BS', costo: c, precio: p, costo_usd: null, precio_usd: null };
      }
      const tasa = Number(window.__bcvRate) || 0;
      return {
        moneda_precio: 'USD',
        costo_usd: c, precio_usd: p,
        costo: tasa > 0 ? Math.round(c * tasa * 100) / 100 : 0,
        precio: tasa > 0 ? Math.round(p * tasa * 100) / 100 : 0,
      };
    }

    // ---- Editar / eliminar artículo ----
    function editarArticulo(id) {
      const p = (window.__PRODUCTOS || []).find((x) => String(x.id) === String(id));
      if (!p) return;
      const UNI_INV = {}; Object.keys(UNIDADES).forEach((k) => { UNI_INV[UNIDADES[k]] = k; });
      window.openFormModal && window.openFormModal({
        title: 'Editar artículo · ' + (p.sku || ''), saveLabel: 'Guardar cambios',
        fields: [
          { name: 'nombre', label: 'Nombre del artículo', col: 2, value: p.nombre || '' },
          { name: 'cat', label: 'Categoría (elige o escribe una nueva)', type: 'datalist', options: catsActuales(), value: p.categoria || '' },
          { name: 'unidad', label: 'Se vende por', type: 'select', options: Object.keys(UNIDADES), value: UNI_INV[p.unidad] || 'Unidad / pieza' },
          { name: 'alic', label: 'Alícuota IVA', type: 'select', options: ['16%', '8%', 'Exento'], value: p.alicuota || '16%' },
          { name: 'stock', label: 'Stock', type: 'number', step: '0.001', value: String(Number(p.stock) || 0) },
          { name: 'min', label: 'Stock mínimo', type: 'number', step: '0.001', value: String(Number(p.stock_min) || 0) },
        ].concat(camposPrecio(p)),
        afterRender: (body) => montarMonedaPrecio(body),
        onSave: (v) => {
          if (!v.nombre) return 'Indica el nombre del artículo.';
          const patch = Object.assign({
            nombre: v.nombre, categoria: (v.cat || 'Otros').trim(), alicuota: v.alic, unidad: UNIDADES[v.unidad] || 'und',
            stock: Number(v.stock) || 0, stock_min: Number(v.min) || 0,
          }, patchPrecio(v));
          window.sb.from('productos').update(patch).eq('id', p.id).then(({ error }) => {
            if (error && faltaColumnaUsd(error.message)) {
              window.sb.from('productos').update(sinColumnasUsd(patch)).eq('id', p.id).then(({ error: e3 }) => {
                if (e3) { toast('No se pudo guardar: ' + e3.message, 'error'); return; }
                toast('Guardado en bolívares. Para fijar precios en dólares, corre sql/precio_en_dolares.sql', 'info');
                cargarProductos();
              });
              return;
            }
            if (error && /unidad/.test(error.message || '')) {
              delete patch.unidad;
              window.sb.from('productos').update(patch).eq('id', p.id).then(({ error: e2 }) => {
                if (e2) { toast('No se pudo guardar: ' + e2.message, 'error'); return; }
                toast('Artículo actualizado (corre el SQL de la columna unidad)', 'info'); cargarProductos();
              });
              return;
            }
            if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
            toast('Artículo actualizado', 'success'); cargarProductos();
          });
        },
        onDelete: (closeModal) => {
          const escrito = window.prompt('⚠️ Vas a ELIMINAR este artículo del inventario (no se puede deshacer).\n\nPara confirmar, escribe el nombre exacto:\n\n' + (p.nombre || ''));
          if (escrito === null) return;
          if ((escrito || '').trim() !== String(p.nombre || '').trim()) { toast('El nombre no coincide — eliminación cancelada.', 'info'); return; }
          window.sb.from('productos').delete().eq('id', p.id).then(({ error }) => {
            if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return; }
            toast('Artículo "' + p.nombre + '" eliminado', 'success'); cargarProductos();
          });
          closeModal();
        },
      });
    }

    // ---- Nuevo artículo (comercial) ----
    function nuevoArticulo() {
      window.openFormModal && window.openFormModal({
        title: 'Nuevo artículo', saveLabel: 'Crear artículo',
        fields: [
          { name: 'nombre', label: 'Nombre del artículo', col: 2, placeholder: 'Ej. Queso blanco' },
          { name: 'cat', label: 'Categoría (elige o escribe una nueva)', type: 'datalist', options: catsActuales(), placeholder: 'Ej. Charcutería' },
          { name: 'unidad', label: 'Se vende por', type: 'select', options: ['Unidad / pieza', 'Kg', 'Gramo', 'Litro', 'Ml', 'Metro', 'Caja', 'Bulto', 'Docena'] },
          { name: 'alic', label: 'Alícuota IVA', type: 'select', options: ['16%', '8%', 'Exento'] },
          { name: 'stock', label: 'Stock inicial', type: 'number', step: '0.001', placeholder: '0' },
          { name: 'min', label: 'Stock mínimo', type: 'number', step: '0.001', placeholder: '0' },
        ].concat(camposPrecio(null)),
        afterRender: (body) => montarMonedaPrecio(body),
        onSave: (v) => {
          if (!v.nombre) return 'Indica el nombre del artículo.';
          if (!window.sb || !window.__CUENTA_ID) return 'No hay sesión activa. Inicia sesión de nuevo.';
          const sku = 'SKU-' + String(Date.now()).slice(-5);
          const UNI = { 'Unidad / pieza': 'und', 'Kg': 'kg', 'Gramo': 'g', 'Litro': 'L', 'Ml': 'ml', 'Metro': 'm', 'Caja': 'caja', 'Bulto': 'bulto', 'Docena': 'doc' };
          const fila = {
            cuenta_id: window.__CUENTA_ID,
            /* De QUÉ empresa es. Sin esto el artículo nace huérfano y
               aparece en todas: es el fallo que se está corrigiendo. */
            empresa_id: (window.__EMPRESA_ACTIVA || {}).id || null,
            nombre: v.nombre, sku: sku, categoria: (v.cat || 'Otros').trim(), alicuota: v.alic,
            unidad: UNI[v.unidad] || 'und',
            stock: Number(v.stock) || 0, stock_min: Number(v.min) || 0,
          };
          Object.assign(fila, patchPrecio(v));
          window.sb.from('productos').insert(fila).then(({ error }) => {
            if (error && faltaColumnaUsd(error.message)) {
              window.sb.from('productos').insert(sinColumnasUsd(fila)).then(({ error: e3 }) => {
                if (e3) { toast('No se pudo guardar: ' + e3.message, 'error'); return; }
                toast('Artículo creado en bolívares. Para fijar precios en dólares, corre sql/precio_en_dolares.sql', 'info');
                cargarProductos();
              });
              return;
            }
            if (error && /unidad/.test(error.message || '')) {
              // columna 'unidad' aún no existe en la BD: guarda sin ella para no bloquear
              delete fila.unidad;
              window.sb.from('productos').insert(fila).then(({ error: e2 }) => {
                if (e2) { toast('No se pudo guardar: ' + e2.message, 'error'); return; }
                toast('Artículo creado (sin unidad: corre el SQL de la columna unidad)', 'info'); cargarProductos();
              });
              return;
            }
            if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
            toast('Artículo "' + v.nombre + '" creado · ' + sku, 'success');
            cargarProductos();
          });
        },
      });
    }

    // ---- Nueva materia prima (manufactura) ----
    function nuevaMP() {
      window.openFormModal && window.openFormModal({
        title: 'Nueva materia prima', saveLabel: 'Registrar MP',
        fields: [
          { name: 'nombre', label: 'Materia prima / insumo', col: 2, placeholder: 'Ej. Cacao en grano' },
          { name: 'tipo', label: 'Tipo', type: 'select', options: ['Directa', 'Indirecta'] },
          { name: 'unidad', label: 'Unidad', type: 'select', options: ['kg', 'L', 'uds', 'm', 'ton'] },
          { name: 'exist', label: 'Existencia', type: 'number', placeholder: '0' },
          { name: 'costo', label: 'Costo unit. (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
        ],
        onSave: (v) => {
          if (!v.nombre) return 'Indica el nombre de la materia prima.';
          const tb = tbodyOf('invpane-mfg', 'mp'); if (!tb) return;
          const cod = 'MP-' + String(mpSeq++).padStart(2, '0');
          const exist = Number(v.exist) || 0, costo = Number(v.costo) || 0;
          const tr = document.createElement('tr');
          tr.innerHTML = '<td><div class="prod-cell"><div class="prod-thumb"><i data-lucide="box"></i></div><div class="info"><div class="n">' + v.nombre + '</div><div class="sku">' + cod + '</div></div></div></td>'
            + '<td>' + v.tipo + '</td>'
            + '<td><div class="stock-cell"><div class="qty">' + exist + ' <span class="unit">' + v.unidad + '</span></div><div class="stock-bar"><span style="width:60%"></span></div><div class="min-note">Mín. —</div></div></td>'
            + '<td class="num">' + fmt(costo) + '</td><td>' + v.unidad + '</td><td class="num">' + fmt(exist * costo) + '</td><td><span class="tag success">Óptimo</span></td>';
          tb.insertBefore(tr, tb.firstChild);
          if (window.lucide) window.lucide.createIcons();
          toast('Materia prima "' + v.nombre + '" registrada · ' + cod, 'success');
        },
      });
    }

    // ---- Nueva orden de producción (manufactura) ----
    function nuevaOrden() {
      window.openFormModal && window.openFormModal({
        title: 'Nueva orden de producción', saveLabel: 'Crear orden',
        fields: [
          { name: 'prod', label: 'Producto a fabricar', col: 2, placeholder: 'Ej. Café Premium 1 kg' },
          { name: 'bom', label: 'Receta (BOM)', col: 2, placeholder: 'Ej. Café verde 1,05 kg + empaque ×1' },
          { name: 'cant', label: 'Cantidad (uds)', type: 'number', placeholder: '0' },
          { name: 'fin', label: 'Fecha fin', type: 'date', value: '2026-06-10' },
        ],
        onSave: (v) => {
          if (!v.prod) return 'Indica el producto a fabricar.';
          const tb = tbodyOf('invpane-mfg', 'ordenes'); if (!tb) return;
          const num = 'OP-2026-' + String(opSeq++).padStart(3, '0');
          const fin = v.fin ? v.fin.split('-').reverse().join('/').slice(0, 8) : '—';
          const tr = document.createElement('tr');
          tr.innerHTML = '<td class="mono">' + num + '</td><td class="primary">' + v.prod + '</td><td class="caption">' + (v.bom || '—') + '</td>'
            + '<td class="num">' + (Number(v.cant) || 0).toLocaleString('es-VE') + ' uds</td>'
            + '<td><div style="display:flex;align-items:center;gap:8px;"><div class="bar-mini" style="width:90px;"><span style="width:0%"></span></div><span class="caption">0%</span></div></td>'
            + '<td>' + fin + '</td><td><span class="tag slate">Programada</span></td>';
          tb.insertBefore(tr, tb.firstChild);
          if (window.lucide) window.lucide.createIcons();
          toast('Orden ' + num + ' creada · ' + v.prod, 'success');
        },
      });
    }

    // ---- Nuevo servicio (servicios) ----
    function nuevoServicio() {
      window.openFormModal && window.openFormModal({
        title: 'Nuevo servicio', saveLabel: 'Crear servicio',
        fields: [
          { name: 'nombre', label: 'Nombre del servicio', col: 2, placeholder: 'Ej. Instalación de equipos' },
          { name: 'cat', label: 'Categoría', type: 'select', options: ['Logística', 'Técnico', 'Consultoría', 'Otros'] },
          { name: 'alic', label: 'Alícuota IVA', type: 'select', options: ['16%', '8%', '0%'] },
          { name: 'precio', label: 'Precio (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
        ],
        onSave: (v) => {
          if (!v.nombre) return 'Indica el nombre del servicio.';
          const tb = tbodyOf('invpane-srv', 'catalogo'); if (!tb) return;
          const cod = 'SRV' + String(srvSeq++).padStart(2, '0');
          const tagCls = v.alic === '0%' ? 'slate' : v.alic === '8%' ? 'cyan' : 'navy';
          const tr = document.createElement('tr');
          tr.innerHTML = '<td><div class="prod-cell"><div class="prod-thumb"><i data-lucide="briefcase"></i></div><div class="info"><div class="n">' + v.nombre + '</div></div></div></td>'
            + '<td class="mono">' + cod + '</td><td>' + v.cat + '</td><td class="num">' + fmt(Number(v.precio) || 0) + '</td>'
            + '<td><span class="tag ' + tagCls + '">' + v.alic + '</span></td><td class="num">0 órdenes</td><td><span class="tag success">Activo</span></td>';
          tb.insertBefore(tr, tb.firstChild);
          if (window.lucide) window.lucide.createIcons();
          toast('Servicio "' + v.nombre + '" creado · ' + cod, 'success');
        },
      });
    }

    // Acción principal del header (según modo activo)
    const primaryBtn = document.getElementById('invPrimaryBtn');
    if (primaryBtn) primaryBtn.addEventListener('click', () => {
      const m = currentMode();
      if (m === 'manufactura') nuevaOrden();
      else if (m === 'servicios') nuevoServicio();
      else nuevoArticulo();
    });

    // Botones primary dentro de las pestañas (Nueva MP / Nueva orden / Nuevo servicio)
    view.querySelectorAll('.btn.btn-primary').forEach((b) => {
      if (b === primaryBtn) return;
      const txt = b.textContent.trim();
      if (/Nueva MP/i.test(txt)) b.addEventListener('click', nuevaMP);
      else if (/Nueva orden/i.test(txt)) b.addEventListener('click', nuevaOrden);
      else if (/Nuevo servicio/i.test(txt)) b.addEventListener('click', nuevoServicio);
      else if (/Generar .* órdenes/i.test(txt)) b.addEventListener('click', () => toast('Órdenes de compra generadas y enviadas a los proveedores sugeridos', 'success'));
    });

    // Botones "OC" (orden de compra por artículo crítico)
    view.querySelectorAll('.invpane-com[data-tab="critico"] tbody .btn').forEach((b) => {
      b.addEventListener('click', () => {
        const tr = b.closest('tr');
        const art = (tr.querySelector('.prod-cell .n') || {}).textContent || 'el artículo';
        const sug = (tr.children[5] || {}).textContent || '';
        const prov = (tr.children[6] || {}).textContent || 'proveedor';
        toast('Orden de compra creada: ' + sug.trim() + ' uds de ' + art + ' a ' + prov.trim(), 'success');
      });
    });

    // Botones "Exportar" → CSV de la tabla del pane correspondiente
    view.querySelectorAll('.btn').forEach((b) => {
      if (!/Exportar/i.test(b.textContent)) return;
      b.addEventListener('click', () => {
        const wrap = b.closest('.invpane-com, .invpane-mfg, .invpane-srv, .inv-mode-pane') || view;
        const table = wrap.querySelector('table.data-table');
        if (!table) { toast('Exportado'); return; }
        const rows = [];
        rows.push([...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()).filter((x) => x));
        table.querySelectorAll('tbody tr').forEach((tr) => rows.push([...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim())));
        const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Inventario_' + currentMode() + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        toast('Inventario exportado a CSV');
      });
    });

    // Selector de artículo en el Kardex
    const kxSel = view.querySelector('.invpane-com[data-tab="kardex"] .txt-select');
    if (kxSel) { kxSel.style.cursor = 'pointer'; kxSel.addEventListener('click', () => {
      window.openFormModal && window.openFormModal({
        title: 'Kardex — seleccionar artículo', saveLabel: 'Ver kardex',
        fields: [{ name: 'art', label: 'Artículo', col: 2, type: 'select', options: ['Café Premium 1 kg · SKU-01', 'Azúcar refinada 1 kg · SKU-02', 'Harina de maíz 1 kg · SKU-03', 'Arroz blanco 1 kg · SKU-04', 'Aceite vegetal 1 L · SKU-05'] }],
        onSave: (v) => { const val = kxSel.querySelector('.val'); if (val) val.innerHTML = v.art + ' <i data-lucide="chevron-down"></i>'; if (window.lucide) window.lucide.createIcons(); toast('Kardex de ' + v.art); },
      });
    }); }

    // ---- Estructura de costos (ficha de costo + precio + rentabilidad, en vivo) ----
    function calcCosto(pane) {
      const mode = pane.dataset.costMode;
      const get = (k) => { const el = pane.querySelector('[data-k="' + k + '"]'); return el ? (parseFloat(el.value) || 0) : 0; };
      const setOut = (k, val) => pane.querySelectorAll('[data-out="' + k + '"]').forEach((el) => (el.textContent = val));
      const bs = (n) => 'Bs ' + fmt(n);            // monto en bolívares
      const usd = (n) => '$ ' + (Number(n)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const cant = get('cantidad') || 1;
      const tasa = get('tasaUsd') || 1;

      let costoLote = 0;
      if (mode === 'manufactura') {
        let mp = 0;
        pane.querySelectorAll('[data-mp-row]').forEach((r) => {
          const q = parseFloat((r.querySelector('[data-mpq]') || {}).value) || 0;
          const c = parseFloat((r.querySelector('[data-mpc]') || {}).value) || 0;
          const sub = q * c;
          const subEl = r.querySelector('[data-mp-sub]'); if (subEl) subEl.textContent = bs(sub);
          mp += sub;
        });
        const mod = get('modHoras') * get('modTarifa');
        const cif = get('cif');
        costoLote = mp + mod + cif;
        setOut('mp', bs(mp)); setOut('mod', bs(mod));
      } else {
        costoLote = get('compra') + get('flete') + get('importacion') + get('otros') + get('igtf');
      }
      const costoUnit = costoLote / cant;
      setOut('costoLote', bs(costoLote));
      setOut('costoUnit', bs(costoUnit));

      // Estructura de precio
      const costoOverhead = costoUnit * (1 + get('gastos') / 100);
      const precioSinIva = costoOverhead * (1 + get('margen') / 100);
      const iva = precioSinIva * (get('alicuota') / 100);
      const precioFinal = precioSinIva + iva;
      setOut('costoOverhead', bs(costoOverhead));
      setOut('precioSinIva', bs(precioSinIva));
      setOut('iva', bs(iva));
      setOut('precioFinal', bs(precioFinal));

      // Rentabilidad
      const mcUnit = precioSinIva - costoUnit;
      setOut('mcUnit', bs(mcUnit));
      setOut('markup', costoUnit ? (mcUnit / costoUnit * 100).toFixed(1) + '%' : '—');
      setOut('margenReal', precioSinIva ? (mcUnit / precioSinIva * 100).toFixed(1) + '%' : '—');
      const cf = get('cfAlquiler') + get('cfSueldos') + get('cfServicios') + get('cfOtros');
      setOut('costosFijos', bs(cf));
      const peUds = mcUnit > 0 ? Math.ceil(cf / mcUnit) : 0;
      const peBs = peUds * precioSinIva;
      setOut('peUds', mcUnit > 0 ? peUds.toLocaleString('es-VE') : '∞');
      setOut('peBs', mcUnit > 0 ? bs(peBs) : '—');

      // Referencia en USD (ambas monedas en las cifras clave)
      setOut('costoUsd', usd(costoUnit / tasa));
      setOut('precioUsd', usd(precioFinal / tasa));
      setOut('peUsd', mcUnit > 0 ? usd(peBs / tasa) : '—');
    }
    view.querySelectorAll('[data-cost-pane]').forEach((pane) => {
      pane.addEventListener('input', () => calcCosto(pane));
      calcCosto(pane); // cálculo inicial
    });

    // Descuento de stock desde el despacho (match por nombre de artículo)
    window.descontarStock = function (nombre, cant) {
      const tb = tbodyOf('invpane-com', 'articulos'); if (!tb) return false;
      let hit = false;
      [...tb.querySelectorAll('tr')].forEach((tr) => {
        const n = tr.querySelector('.prod-cell .n');
        if (!n || n.textContent.trim().toLowerCase() !== String(nombre).trim().toLowerCase()) return;
        const qtyEl = tr.querySelector('.stock-cell .qty');
        if (!qtyEl) return;
        const uni = (qtyEl.querySelector('.unit') || {}).textContent || 'und';
        const cur = parseFloat(qtyEl.textContent.replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
        const next = Math.max(0, cur - (Number(cant) || 0));
        qtyEl.innerHTML = next + ' <span class="unit">' + uni + '</span>';
        hit = true;
      });
      return hit;
    };
  })();
})();
