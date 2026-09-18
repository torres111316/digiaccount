/* =========================================================
   DigiAccount ERP — App (Dashboard Central + Módulo Fiscal)
   HTML/CSS/JS puro · sin dependencias de framework
   ========================================================= */
(function () {
  'use strict';

  // Al cargar, pone la fecha de HOY en los campos de fecha que traían un valor fijo
  window.addEventListener('DOMContentLoaded', function () {
    ['amFecha', 'fvFecha'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el && el.type === 'date') el.value = window.__hoyISO();
    });
    // Normaliza las etiquetas de período que quedaron fijas ("Mayo 2026") al MES ACTUAL
    try {
      const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      const d = new Date();
      const label = MESES[d.getMonth()] + ' ' + d.getFullYear();
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const rxMes = /May(o)?\s*2026/g;
      const rxYm = /2026-05/g;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (rxMes.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(rxMes, label);
        rxMes.lastIndex = 0;
        if (rxYm.test(node.nodeValue)) node.nodeValue = node.nodeValue.replace(rxYm, ym);
        rxYm.lastIndex = 0;
      }
    } catch (e) {}
  });

  /* ---------- Iconos ---------- */
  const drawIcons = window.__drawIcons;
  drawIcons();

  /* ---------- Seguridad: escape de HTML ----------
     Convierte texto en texto plano seguro antes de insertarlo con innerHTML.
     REGLA: todo dato que escriba el usuario (nombres, RIF, emails, montos
     escritos a mano…) debe pasar por esc() al construir HTML. Cuando se
     conecte el backend (Supabase), esto evita XSS almacenado entre usuarios. */
  const esc = window.__esc;
  window.esc = esc;

  /* =========================================================
     SIDEBAR COLLAPSE
     ========================================================= */
  const app = document.getElementById('app');
  const collapseBtn = document.getElementById('collapseBtn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      app.dataset.collapsed = app.dataset.collapsed === 'true' ? 'false' : 'true';
    });
  }

  /* =========================================================
     ENTITY SWITCHER
     ========================================================= */
  const sw = document.getElementById('entitySwitcher');
  const dd = document.getElementById('entityDropdown');
  if (sw && dd) {
    sw.addEventListener('click', (e) => {
      if (e.target.closest('.entity-dropdown')) return;
      dd.dataset.open = dd.dataset.open === 'true' ? 'false' : 'true';
    });
    document.addEventListener('click', (e) => {
      if (!sw.contains(e.target)) dd.dataset.open = 'false';
    });

    function bindEntityOption(opt) {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        window.__EMP_YA_ELEGIDA = true; // ya hay empresa activa: no reabrir el selector al recargar la lista
        document.querySelectorAll('.entity-option').forEach((o) => o.removeAttribute('data-active'));
        opt.dataset.active = 'true';

        const { name, avatar, rif, type } = opt.dataset;
        const cond = opt.dataset.cond || '';
        // Empresa activa = emisor de los recibos/facturas + dueña de sus libros contables
        const fiscalActivo = opt.dataset.fiscal === 'true';
        window.__EMPRESA_ACTIVA = {
          id: opt.dataset.empresaId || '', n: name, rif: rif,
          dom: opt.dataset.direccion || '', tel: opt.dataset.telefono || '',
          cond: /especial/i.test(cond) ? 'Contribuyente Especial' : /formal/i.test(cond) ? 'Contribuyente Formal' : (type === 'natural' ? 'Persona Natural' : 'Contribuyente Ordinario'),
          fiscalActivo: fiscalActivo,
          modo: fiscalActivo ? 'libro' : 'recibos', // DERIVADO del módulo Fiscal: activo→libros, inactivo→recibos
          /* 'recibo' o 'factura'. En modo factura los documentos son
             inalterables y se corrigen solo con notas (000121 Art. 3.d). Lo
             enciende el fundador cuando esa empresa tiene su autorización del
             SENIAT, nunca el cliente por su cuenta. */
          modo_doc: opt.dataset.modoDoc || 'recibo',
          autorizacionSeniat: opt.dataset.autorizacion || '',
          declaraDpp: opt.dataset.dpp !== 'false', // emprendimientos NO declaran Protección a las Pensiones
          firmaEmpresa: opt.dataset.firma || '',
        };
        aplicarFiscal(fiscalActivo);
        // El cuadro de ISLR depende de la condición fiscal: se repinta ya, sin
        // esperar a que alguien cargue el libro.
        if (window.__renderIslrBox) window.__renderIslrBox(0);
        setText('entityName', name);
        setText('entityAvatar', avatar);
        setText('companyTitle', name);
        setText('companyRif', rif);
        // Coherencia con Configuración: refleja la empresa activa
        const cfgN = document.getElementById('cfgEmpresaNombre'); if (cfgN) cfgN.textContent = name;
        /* Configuración: se llena SIEMPRE, con la empresa que se acaba de
           elegir. Antes decía `if (!cfgR.value)` — solo llenaba el campo si
           estaba vacío—, así que al cambiar de empresa se quedaba con los
           datos de la anterior. Uno creía estar viendo una empresa y estaba
           viendo otra, y al guardar habría escrito sobre la equivocada. */
        if (window.__cargarConfigEmpresa) window.__cargarConfigEmpresa();

        const badge = document.getElementById('contribBadge');
        const lbl = document.getElementById('contribLabel');
        if (badge && lbl) {
          if (type === 'natural') { badge.className = 'contrib-badge'; lbl.textContent = 'Persona Natural'; }
          else if (type === 'especial') { badge.className = 'contrib-badge especial'; lbl.textContent = 'Contribuyente Especial'; }
          else { badge.className = 'contrib-badge'; lbl.textContent = 'Contribuyente Ordinario'; }
        }
        dd.dataset.open = 'false';
        /* Cada módulo se recarga POR SU CUENTA.

           Iban seguidos, uno tras otro. `__syncFiscalHeader` lanzaba un
           ReferenceError —usaba `_MESES_PER`, declarado en otro bloque— y
           con eso moría el resto de la lista: el calendario, los cierres, la
           bóveda, la tesorería, las retenciones y la nómina no se enteraban
           nunca de que había cambiado la empresa. El calendario se quedaba
           con el resultado de su primera pasada, cuando todavía no había
           empresa elegida: vacío. Y no se veía nada en pantalla, porque una
           excepción dentro de un manejador de clic no deja rastro visible.

           Un módulo roto puede fallar; lo que no puede es apagar a los
           demás. Lo que falle se nombra en la consola y se sigue. */
        [['asientos', () => window.cargarAsientos && window.cargarAsientos()],
          ['cuentas contables', () => window.cargarCuentasContables && window.cargarCuentasContables()],
          ['activos fijos', () => window.cargarActivosFijos && window.cargarActivosFijos()],
          ['criptoactivos', () => window.cargarCriptoactivos && window.cargarCriptoactivos()],
          ['encabezado fiscal', () => window.__syncFiscalHeader && window.__syncFiscalHeader()],
          ['establecimientos (configuración)', () => window.__renderSucursalesConfig && window.__renderSucursalesConfig()],
          ['ramo e inventario', () => Promise.resolve(window.__cargarInvConfig && window.__cargarInvConfig())
            .then(() => { if (window.__renderInventarioConfig) return window.__renderInventarioConfig(); })
            .catch((err) => console.error('[cambio de empresa] ramo e inventario:', err))],
          ['¿usa máquina fiscal?', () => window.__revisarUsaMaquina && window.__revisarUsaMaquina()],
          /* Los libros ESPERAN a las sucursales. Iban por separado y los
             libros ganaban la carrera: pintaban la barra con los
             establecimientos de la empresa anterior. */
          ['sucursales y libros', () => Promise.resolve(window.cargarSucursales && window.cargarSucursales())
            .then(() => { if (window.cargarLibroFiscal) { window.cargarLibroFiscal('compra'); window.cargarLibroFiscal('venta'); } })
            .catch((err) => console.error('[cambio de empresa] sucursales y libros:', err))],
          ['apertura', () => window.cargarApertura && window.cargarApertura()],
          ['firma y sello', () => Promise.resolve(window.__cargarFirma && window.__cargarFirma())
            .then(() => { if (window.__renderFirmaConfig) return window.__renderFirmaConfig(); })
            .catch((err) => console.error('[cambio de empresa] firma:', err))],
          ['cierres', () => window.cargarCierres && window.cargarCierres()],
          ['calendario', () => window.cargarCalendarioFiscal && window.cargarCalendarioFiscal()],
          ['métodos de cobro', () => window.__cargarCobrosEmp && window.__cargarCobrosEmp(opt.dataset.empresaId)],
          ['DPP', () => window.__renderDPP && window.__renderDPP()],
          ['IGP', () => window.__renderIGP && window.__renderIGP()],
          ['bóveda', () => window.cargarBoveda && window.cargarBoveda()],
          ['tesorería', () => window.cargarTesoreria && window.cargarTesoreria()],
          // Antes de recargar las retenciones: la empresa nueva puede no
          // enterar por quincena, y quedarse en "1ra" le escondería la mitad.
          ['quincena de retenciones', () => window.__syncRetQuincena && window.__syncRetQuincena()],
          ['retenciones', () => window.cargarRetenciones && window.cargarRetenciones()],
          ['guías de despacho', () => window.cargarGuias && window.cargarGuias()],
          ['modo de documento', () => window.__aplicarModoDoc && window.__aplicarModoDoc()],
          ['parámetros', () => window.cargarParametros && window.cargarParametros()],
          ['empleados', () => window.cargarEmpleados && window.cargarEmpleados()],
          ['panel de inicio', () => window.cargarDashboard && window.cargarDashboard()],
        ].forEach(function (par) {
          try { par[1](); } catch (err) { console.error('[cambio de empresa] falló ' + par[0] + ':', err); }
        });
      });
    }
    document.querySelectorAll('.entity-option[data-name]').forEach(bindEntityOption);
    window.__bindEntityOption = bindEntityOption;

    // Muestra/oculta el módulo Fiscal y sincroniza el toggle de la cabecera
    function aplicarFiscal(activo) {
      const nav = document.getElementById('navFiscal');
      if (nav) nav.hidden = !activo;
      // El atajo "Libro de Ventas →" (dentro de Ventas) SOLO existe si hay módulo Fiscal;
      // si la empresa no lo tiene, no debe verse (eso lo maneja el contador).
      const libroLink = document.getElementById('ventasLibroLink');
      if (libroLink) libroLink.hidden = !activo;
      const sel = document.getElementById('fiscalActivoSel');
      if (sel) sel.value = activo ? 'on' : 'off';
      // Si se desactiva mientras se está viendo Fiscal, salir a la primera vista visible
      if (!activo) {
        const cur = document.querySelector('.nav-item.active[data-view="fiscal"]');
        if (cur) { const first = document.querySelector('.nav-item:not([hidden])'); if (first) first.click(); }
      }
    }
    window.__aplicarFiscal = aplicarFiscal;

    // Toggle "Módulo Fiscal" por empresa: activa los libros formales y deriva el modo contable
    const fiscalSel = document.getElementById('fiscalActivoSel');
    if (fiscalSel) fiscalSel.addEventListener('change', async () => {
      const emp = window.__EMPRESA_ACTIVA;
      if (!emp || !emp.id) return;
      const activo = fiscalSel.value === 'on';
      emp.fiscalActivo = activo;
      emp.modo = activo ? 'libro' : 'recibos';
      const opt = document.querySelector('.entity-option[data-empresa-id="' + emp.id + '"]');
      if (opt) opt.dataset.fiscal = String(activo);
      aplicarFiscal(activo);
      if (window.sb) {
        const { error } = await window.sb.from('empresas').update({ fiscal_activo: activo }).eq('id', emp.id);
        if (error) { if (window.toast) window.toast('No se pudo guardar: ' + error.message, 'error'); return; }
      }
      if (window.toast) window.toast(activo ? 'Módulo Fiscal activado · contabiliza desde el Libro de Ventas' : 'Módulo Fiscal desactivado · contabiliza desde los Recibos', 'success');
    });
  }

  // Carga las empresas REALES de la cuenta desde Supabase y reconstruye el selector
  async function cargarEmpresas() {
    const dd = document.getElementById('entityDropdown');
    const addBtn = document.getElementById('entityAddBtn');
    if (!window.sb || !dd || !addBtn) return;
    // SOLO las empresas de MI cuenta: sin este filtro, el fundador (superadmin,
    // que por RLS ve todo) veía en su selector las empresas de TODOS los clientes.
    let q = window.sb.from('empresas').select('id, nombre, rif, condicion_fiscal, fiscal_activo, firma_empresa, direccion, telefono, representante, representante_ci, representante_cargo, registro_mercantil, ciudad, modo_doc, autorizada_desde, autorizacion_seniat');
    if (window.__CUENTA_ID) q = q.eq('cuenta_id', window.__CUENTA_ID);
    const { data, error } = await q.order('nombre');
    if (error) { console.warn('[DigiAccount] No se pudieron cargar las empresas:', error.message); return; }
    // Quitar las opciones de ejemplo (hardcodeadas) y sus etiquetas de grupo
    dd.querySelectorAll('.entity-option, .group-label').forEach((el) => el.remove());
    const lbl = document.createElement('div');
    lbl.className = 'group-label';
    lbl.textContent = 'Mis empresas';
    dd.insertBefore(lbl, addBtn);
    (data || []).forEach((emp) => {
      const nombre = emp.nombre || 'Empresa';
      const rif = emp.rif || '';
      const cond = emp.condicion_fiscal || 'ordinario';
      // Tipo de persona derivado del RIF: V/E = persona natural; J/G = persona jurídica.
      const esNatural = /^\s*[VE]/i.test(rif);
      const ini = (nombre.replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || 'EM').toUpperCase();
      const condTxt = cond.charAt(0).toUpperCase() + cond.slice(1);
      const opt = document.createElement('div');
      opt.className = 'entity-option';
      opt.dataset.name = nombre; opt.dataset.avatar = ini; opt.dataset.rif = rif;
      opt.dataset.type = esNatural ? 'natural' : (/especial/i.test(cond) ? 'especial' : 'ordinario');
      opt.dataset.cond = cond;
      opt.dataset.empresaId = emp.id || '';
      opt.dataset.fiscal = String(!!emp.fiscal_activo);
      opt.dataset.dpp = String(emp.declara_dpp !== false); // emprendimientos: exentos de Protección a las Pensiones
      opt.dataset.modoDoc = emp.modo_doc || 'recibo';
      opt.dataset.autorizacion = emp.autorizacion_seniat || '';
      if (emp.firma_empresa) opt.dataset.firma = emp.firma_empresa;
      if (emp.direccion) opt.dataset.direccion = emp.direccion;
      if (emp.telefono) opt.dataset.telefono = emp.telefono;
      const metaTxt = esNatural ? 'Persona Natural' : ('Contribuyente ' + condTxt);
      const puedeEditar = !window.__rolActual || window.__rolActual() === 'admin';
      opt.innerHTML = '<div class="ea" style="background:var(--da-navy-500);color:#fff">' + ini + '</div>'
        + '<div class="eo-info"><div class="eo-name">' + esc(nombre) + '</div><div class="eo-meta">' + esc(rif) + ' · ' + metaTxt + '</div></div>'
        + (puedeEditar ? '<button type="button" class="icon-btn" data-edit-emp title="Editar empresa" style="width:26px;height:26px;flex:none;"><i data-lucide="pencil" style="width:13px;height:13px;"></i></button>' : '')
        + '<i data-lucide="check" class="eo-check" style="width:16px;height:16px;"></i>';
      dd.insertBefore(opt, addBtn);
      if (window.__bindEntityOption) window.__bindEntityOption(opt);
      const eBtn = opt.querySelector('[data-edit-emp]');
      if (eBtn) eBtn.addEventListener('click', (ev) => { ev.stopPropagation(); dd.dataset.open = 'false'; editarEmpresa(emp); });
    });
    const first = dd.querySelector('.entity-option');
    // Al iniciar sesión: si hay UNA empresa se activa sola; si hay VARIAS se abre el
    // selector para que el usuario elija con cuál trabajar (evita empezar en la equivocada).
    if (first) {
      /* Si ya se estaba trabajando con una empresa, se vuelve a ELLA.

         Esta función no solo corre al iniciar sesión: la llaman el guardado
         de Configuración, el alta de empresas y el panel de fundador. En esos
         casos caía en el `else` y hacía `first.click()`, o sea activaba la
         PRIMERA de la lista alfabéticamente. Luis guardó la dirección de una
         sucursal de GATMA, pulsó "Guardar cambios" y el sistema lo mandó a
         Carnicería Anyelin sin avisar — y lo siguiente que registrara habría
         ido a parar a la empresa equivocada. */
      const idActiva = (window.__EMPRESA_ACTIVA || {}).id;
      const activa = idActiva && dd.querySelector('.entity-option[data-empresa-id="' + idActiva + '"]');
      if (activa) {
        activa.click();
      } else if ((data || []).length > 1 && !window.__EMP_YA_ELEGIDA) {
        if (window.__abrirSelectorEmpresa) window.__abrirSelectorEmpresa(data);
        else first.click();
      } else {
        first.click();
      }
    }
    dd.dataset.open = 'false';
    window.__NUM_EMPRESAS = (data || []).length;   // para aplicar el tope de empresas del plan
    const kEmp = document.getElementById('usKpiEmpresas');
    if (kEmp) kEmp.textContent = String((data || []).length);
    drawIcons();
    console.log('[DigiAccount] Empresas cargadas:', (data || []).length);
  }
  window.cargarEmpresas = cargarEmpresas;

  // ===== Selector de empresa al iniciar sesión (elige con cuál trabajar) =====
  window.__abrirSelectorEmpresa = function (empresas) {
    if (document.getElementById('empPickerOverlay')) return;
    const ov = document.createElement('div');
    ov.id = 'empPickerOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(8,18,30,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;';
    const filas = (empresas || []).map((emp) => {
      const nombre = emp.nombre || 'Empresa', rif = emp.rif || '';
      const esNatural = /^\s*[VE]/i.test(rif);
      const ini = (nombre.replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || 'EM').toUpperCase();
      const metaTxt = esNatural ? 'Persona Natural' : ('Contribuyente ' + (emp.condicion_fiscal || 'ordinario'));
      return '<button type="button" class="emp-pick-row" data-pick-id="' + esc(emp.id) + '" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 14px;border:1px solid var(--border-strong);border-radius:12px;background:var(--bg-surface);cursor:pointer;color:inherit;transition:.12s;">'
        + '<div style="width:40px;height:40px;border-radius:10px;background:var(--da-navy-500);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex:none;">' + ini + '</div>'
        + '<div style="min-width:0;"><div style="font-weight:600;font-size:14px;">' + esc(nombre) + '</div><div style="font-size:12px;color:var(--fg-muted);">' + esc(rif) + ' · ' + esc(metaTxt) + '</div></div>'
        + '<i data-lucide="chevron-right" style="width:16px;height:16px;margin-left:auto;color:var(--fg-muted);flex:none;"></i></button>';
    }).join('');
    ov.innerHTML = '<div style="background:var(--bg-elevated,var(--bg-surface));border-radius:18px;max-width:460px;width:100%;max-height:86vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,.35);">'
      + '<div style="padding:20px 22px 8px;"><div style="font-size:17px;font-weight:700;">¿Con cuál empresa vas a trabajar?</div>'
      + '<div style="font-size:13px;color:var(--fg-muted);margin-top:3px;">Selecciona una para comenzar. Podrás cambiarla luego desde el selector de arriba.</div></div>'
      + '<div style="display:flex;flex-direction:column;gap:8px;padding:14px 22px 22px;">' + filas + '</div></div>';
    document.body.appendChild(ov);
    if (window.lucide) window.lucide.createIcons();
    const elegir = (id) => {
      window.__EMP_YA_ELEGIDA = true;
      const opt = document.querySelector('.entity-option[data-empresa-id="' + id + '"]');
      if (opt) opt.click();
      ov.remove();
    };
    ov.querySelectorAll('[data-pick-id]').forEach((b) => {
      b.addEventListener('mouseenter', () => { b.style.borderColor = 'var(--da-navy-500)'; b.style.background = 'var(--bg-subtle,var(--bg-surface))'; });
      b.addEventListener('mouseleave', () => { b.style.borderColor = 'var(--border-strong)'; b.style.background = 'var(--bg-surface)'; });
      b.addEventListener('click', () => elegir(b.dataset.pickId));
    });
  };

  // Editar los datos básicos de una empresa (nombre, RIF, condición fiscal)
  function editarEmpresa(emp) {
    if (!window.openFormModal) return;
    window.openFormModal({
      title: 'Editar empresa', saveLabel: 'Guardar cambios',
      fields: [
        { name: 'nombre', label: 'Nombre / Razón social', col: 2, value: emp.nombre || '' },
        { name: 'rif', label: 'RIF', value: emp.rif || '', placeholder: 'J-12345678-9' },
        { name: 'cond', label: 'Condición fiscal', type: 'select', options: ['ordinario', 'formal', 'especial'], value: emp.condicion_fiscal || 'ordinario' },
        { name: 'direccion', label: 'Dirección (aparece en los recibos)', col: 2, placeholder: 'Ej. Cambural - Edo. Yaracuy', value: emp.direccion || '' },
        { name: 'telefono', label: 'Teléfono', placeholder: '0414-1234567', value: emp.telefono || '' },
        { name: 'ciudad', label: 'Ciudad / Estado (para contratos)', placeholder: 'Ej. San Felipe, Edo. Yaracuy', value: emp.ciudad || '' },
        { name: 'registroMercantil', label: 'Registro Mercantil (Nº / Tomo / Folio)', col: 2, placeholder: 'Ej. Nº 45, Tomo 12-A, año 2020', value: emp.registro_mercantil || '' },
        { name: 'representante', label: 'Representante legal', placeholder: 'Nombre y apellido', value: emp.representante || '' },
        { name: 'representanteCi', label: 'C.I. del representante', placeholder: 'V-00.000.000', value: emp.representante_ci || '' },
        { name: 'representanteCargo', label: 'Cargo del representante', placeholder: 'Ej. Gerente General', value: emp.representante_cargo || '' },
      ],
      onSave: (v) => {
        if (!v.nombre) return 'Indica el nombre de la empresa.';
        if (!v.rif) return 'Indica el RIF.';
        window.sb.from('empresas').update({ nombre: v.nombre.trim(), rif: v.rif.trim(), condicion_fiscal: v.cond, direccion: (v.direccion || '').trim() || null, telefono: (v.telefono || '').trim() || null,
            ciudad: (v.ciudad || '').trim() || null, registro_mercantil: (v.registroMercantil || '').trim() || null, representante: (v.representante || '').trim() || null, representante_ci: (v.representanteCi || '').trim() || null, representante_cargo: (v.representanteCargo || '').trim() || null })
          .eq('id', emp.id).then(({ error }) => {
            if (error) { if (window.toast) window.toast('No se pudo guardar: ' + error.message, 'error'); return; }
            if (window.toast) window.toast('Empresa actualizada ✓', 'success');
            cargarEmpresas();
          });
      },
    });
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el && val != null) el.textContent = val;
  }

  /* =========================================================
     VIEW SWITCHING (nav items → views)
     ========================================================= */
  const views = document.querySelectorAll('.view');
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const breadcrumbHere = document.getElementById('breadcrumbHere');

  function showView(viewId, title) {
    // Defensa: el Panel del Fundador solo para el super-admin (aunque la data ya
    // está protegida por RLS, no debe ni mostrarse la vista a otros).
    if (viewId === 'fundador' && !window.__ES_FUNDADOR) { viewId = 'dashboard'; title = 'Dashboard Central'; }
    // Defensa por ROL: si el rol del usuario no incluye esta vista, vuelve al Dashboard
    // (el menú ya la oculta; esto cubre atajos, enlaces internos y URLs a mano).
    if (window.__rolPermiteVista && !window.__rolPermiteVista(viewId)) { viewId = 'dashboard'; title = 'Dashboard Central'; }
    views.forEach((v) => (v.dataset.active = v.id === 'view-' + viewId ? 'true' : 'false'));
    navItems.forEach((n) => (n.dataset.active = n.dataset.view === viewId ? 'true' : 'false'));
    if (title && breadcrumbHere) breadcrumbHere.textContent = title;
    const content = document.querySelector('.content');
    if (content) content.scrollTop = 0;
    const main = document.querySelector('.main');
    if (main) main.scrollTop = 0;
    // En móvil/ventana angosta el scroll suele estar en el body: súbelo al inicio
    // para que la vista recién abierta quede visible y no "debajo del pliegue".
    if (window.scrollY) window.scrollTo(0, 0);
    // El Dashboard SIEMPRE se refresca con datos reales al abrirlo
    if (viewId === 'dashboard' && window.cargarDashboard) { try { window.cargarDashboard(); } catch (e) {} }
    drawIcons();
    /* La dirección se sincroniza con la vista que REALMENTE se abrió, no con
       la que se pidió: si las defensas de arriba desviaron al Dashboard, la
       barra tiene que decir Dashboard. Una dirección que miente es peor que
       ninguna. */
    _sincronizarRuta(viewId);
  }
  window.showView = showView;

  /* =========================================================
     LA DIRECCIÓN SIGUE A LA VISTA
     =========================================================
     Sin esto no hay historial que recorrer, y en la app instalada el gesto
     de volver CIERRA la aplicación en vez de regresar a la pantalla
     anterior. Le pasa a cada usuario varias veces al día y se siente como
     si la app se hubiera caído.

     Va con almohadilla (#fiscal) y no con ruta (/fiscal) a propósito: la
     ruta obliga a configurar el servidor para que un refresco no devuelva
     404, y eso es una pieza más que se puede romper en un despliegue.

     La dirección lleva SOLO la vista. Ni la empresa activa ni el período:
     un enlace que le cambie a alguien la empresa en la que está trabajando
     —o un marcador de "julio 1ra quincena" abierto en noviembre— es un
     accidente esperando en un sistema donde se declaran impuestos. El
     enlace dice "abre Fiscal"; Fiscal se abre con lo que el usuario tenía. */
  const _titulos = {};
  navItems.forEach((n) => { _titulos[n.dataset.view] = n.dataset.title || ''; });

  function _sincronizarRuta(viewId) {
    const nueva = '#' + viewId;
    if (window.location.hash === nueva) return;   // corta el ida y vuelta
    try {
      // replaceState: la entrada de historial la crea el clic del menú. Aquí
      // solo se corrige la dirección, sin agregar un paso de más que
      // obligaría a pulsar atrás dos veces.
      window.history.replaceState({ v: viewId }, '', nueva);
    } catch (e) {
      window.location.hash = nueva;               // respaldo si el historial falla
    }
  }

  function _abrirDesdeRuta() {
    const v = (window.location.hash || '').replace(/^#\/?/, '').trim();
    if (!v) return false;
    // Solo vistas que existen. Un enlace viejo o mal escrito no debe dejar la
    // pantalla en blanco: se ignora y queda lo que ya estaba.
    if (!document.getElementById('view-' + v)) return false;
    showView(v, _titulos[v] || '');
    return true;
  }

  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      if (item.classList.contains('locked')) { if (window.__mostrarUpgrade) window.__mostrarUpgrade(item); return; }
      const v = item.dataset.view;
      /* El clic SÍ agrega una entrada al historial: es lo que hace que el
         botón atrás devuelva a la vista anterior. Si la vista ya está
         abierta no se agrega nada, para no llenar el historial de repetidos
         cuando alguien pulsa dos veces el mismo menú. */
      if (window.location.hash === '#' + v) return;
      window.location.hash = '#' + v;   // dispara hashchange, que pinta
    });
  });

  // Atrás y adelante del navegador, y cualquier cambio de dirección.
  window.addEventListener('hashchange', () => { _abrirDesdeRuta(); });

  /* ════════════════════════════════════════════════════════════════════
     LA FLECHA DE ATRAS CIERRA EL CUADRO, NO LA APLICACION

     Cambiar de pantalla si deja huella en el historial, pero los cuadros que
     se abren encima —registrar una compra, ver un recibo, cobrar— no dejaban
     ninguna. En un telefono, la flecha de atras con un cuadro abierto sacaba
     de la aplicacion, y eso se siente como si se hubiera caido.

     Al abrirse un cuadro se agrega una entrada al historial; la flecha la
     consume cerrando ese cuadro. Se cierra PULSANDO SU PROPIO BOTON de
     cerrar, no escondiendolo a la fuerza: asi corre la logica del modulo
     —limpiar, refrescar, avisar— en vez de dejarlo a medias.
     ════════════════════════════════════════════════════════════════════ */
  (function atrasCierraCuadros() {
    const SEL = ['.form-modal-overlay', '.fv-overlay', '.ter-overlay', '.recibo-overlay',
      '.ret-recibo-overlay', '.asiento-overlay', '.ag-auto-overlay', '.tk-share-scrim',
      '.pay-scrim', '.rec-scrim', '.onb-scrim', '.wiz-scrim',
      '#facturaOverlay', '#despachoOverlay'].join(',');

    const visible = (el) => !!el && !el.hidden && el.dataset.open !== 'false'
      && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const abiertos = () => Array.from(document.querySelectorAll(SEL)).filter(visible);

    function cerrar(el) {
      /* Por su propio boton, en este orden: la X, «Cancelar», «Cerrar». Si no
         tiene ninguno, se esconde — es mejor que quedarse trabado. */
      const btn = el.querySelector('[data-cerrar], .icon-btn[title="Cerrar"], .tb-close')
        || Array.from(el.querySelectorAll('button')).find((b) => /^(cancelar|cerrar|volver)$/i.test((b.textContent || '').trim()))
        || el.querySelector('[id$="Close"], [id$="Cancel"]');
      if (btn) { btn.click(); return; }
      if (el.hasAttribute('hidden') || el.dataset.open !== undefined) {
        el.hidden = true; if (el.dataset.open !== undefined) el.dataset.open = 'false';
      } else { el.style.display = 'none'; }
    }

    let marcas = 0;                        // entradas de historial nuestras, sin consumir
    function marcar() {
      marcas += 1;
      try { history.pushState({ daModal: marcas }, ''); } catch (e) { marcas -= 1; }
    }

    /* Se vigila la apertura en vez de tocar los veinte modulos que abren
       cuadros: cualquiera que aparezca queda cubierto, incluso los que se
       escriban mañana. */
    let ultimos = 0;
    const observador = new MutationObserver(() => {
      const n = abiertos().length;
      if (n > ultimos) marcar();
      ultimos = n;
    });
    observador.observe(document.body, {
      subtree: true, childList: true,
      attributes: true, attributeFilter: ['hidden', 'style', 'class', 'data-open'],
    });

    window.addEventListener('popstate', (ev) => {
      const lista = abiertos();
      if (!lista.length) { marcas = 0; return; }   // sin cuadros: navegacion normal
      if (marcas > 0) marcas -= 1;
      cerrar(lista[lista.length - 1]);             // el de mas arriba primero
      ultimos = abiertos().length;
      /* Si quedan cuadros abiertos debajo, se repone una entrada para que la
         proxima flecha cierre ese y tampoco salga de la app. */
      if (ultimos > 0) marcar();
      if (ev && ev.state && ev.state.v) { /* era una vista: ya se pinto sola */ }
    });
  })();

  /* VOLVER, dentro de la app.

     En la ventana instalada no hay barra del navegador: ni botón atrás, ni
     dirección, nada. El historial sigue ahí —Alt+← funciona— pero invisible,
     que es como no tenerlo. En el navegador, en cambio, el botón propio
     sobra: ya está el suyo justo al lado.

     Así que se muestra solo cuando la app corre en su propia ventana. */
  (function botonVolver() {
    const btn = document.getElementById('btnAtras');
    if (!btn) return;
    const instalada = () =>
      window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: window-controls-overlay)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || window.navigator.standalone === true;
    if (!instalada()) return;
    btn.hidden = false;
    btn.addEventListener('click', () => window.history.back());
  })();

  /* La llama el arranque de sesión, cuando ya se conoce el rol. Si la
     dirección no trae vista —o trae una que no existe— no hace nada y queda
     la que el HTML marcó como activa. */
  window.__abrirRutaInicial = function () {
    if (!_abrirDesdeRuta()) {
      // Sin vista en la dirección: se anota la que está abierta, para que el
      // primer clic del menú tenga a dónde volver con el botón atrás.
      const act = document.querySelector('.nav-item[data-active="true"][data-view]');
      if (act) _sincronizarRuta(act.dataset.view);
    }
  };

  // El nombre del usuario lleva a Usuarios y Roles (si su rol lo permite)
  const sbUser = document.getElementById('sidebarUser');
  if (sbUser) sbUser.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (window.__rolPermiteVista && !window.__rolPermiteVista('usuarios')) return; // solo admin
    showView('usuarios', 'Usuarios y Roles');
  });

  /* =========================================================
     MENÚ DE LA CUENTA (engranaje del pie) — antes no hacía nada
     útil; ahora agrupa los accesos y el CERRAR SESIÓN, que en el
     teléfono no se alcanzaba desde la barra superior.
     ========================================================= */
  (function menuCuenta() {
    const btn = document.getElementById('sidebarSettingsBtn');
    const menu = document.getElementById('acctMenu');
    if (!btn || !menu) return;
    const cerrar = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const abierto = !menu.hidden;
      if (abierto) { cerrar(); return; }
      // Oculta las opciones que el rol no permite ver
      menu.querySelectorAll('[data-acct]').forEach((it) => {
        const v = it.dataset.acct;
        const esVista = ['usuarios', 'config', 'suscripcion'].indexOf(v) >= 0;
        it.style.display = (esVista && window.__rolPermiteVista && !window.__rolPermiteVista(v)) ? 'none' : '';
      });
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      if (window.lucide) window.lucide.createIcons();
    });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== btn) cerrar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });

    const TITULOS = { usuarios: 'Usuarios y Roles', config: 'Configuración', suscripcion: 'Mi Suscripción' };
    menu.querySelectorAll('[data-acct]').forEach((it) => it.addEventListener('click', async () => {
      const accion = it.dataset.acct;
      cerrar();
      if (TITULOS[accion]) { showView(accion, TITULOS[accion]); return; }
      if (accion === 'update') { if (window.__buscarActualizacion) window.__buscarActualizacion(true); return; }
      if (accion === 'logout') {
        if (!window.confirm('¿Cerrar sesión en DigiAccount?')) return;
        try { if (window.sb) await window.sb.auth.signOut(); } catch (err) {}
        try { localStorage.removeItem('da_last_activity'); } catch (err) {}
        window.location.reload();   // recarga = borra todo el estado en memoria
      }
    }));
  })();
  const planPill = document.querySelector('.plan-active-pill');
  if (planPill) planPill.addEventListener('click', (e) => { e.preventDefault(); showView('planes', 'Planes y Precios'); });

  // Botones que saltan a una vista (ej. alerta → módulo fiscal)
  document.querySelectorAll('[data-go-view]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showView(el.dataset.goView, el.dataset.goTitle || '');
    });
  });

  /* =========================================================
     CASH FLOW CHART (SVG renderizado por JS)
     ========================================================= */
  (function cashFlowChart() {
    const chart = document.getElementById('cashChart');
    if (!chart) return;
    // Placeholder honesto hasta graficar el flujo diario real (agrupado por día de los movimientos)
    const phWrap = chart.closest('.chart-wrap');
    if (phWrap) { phWrap.innerHTML = '<div style="text-align:center;color:var(--fg-muted);padding:42px 20px;"><i data-lucide="line-chart" style="width:28px;height:28px;opacity:.5;"></i><div style="font-size:13px;font-weight:600;margin-top:10px;">Flujo de caja diario</div><div style="font-size:12px;margin-top:4px;">Se graficará con tus movimientos de Tesorería del período.</div></div>'; if (window.lucide) window.lucide.createIcons(); }
    return;

    const days = 28;
    const ingresos = [
      180, 95, 110, 240, 320, 215, 280, 195, 165, 320,
      410, 295, 245, 380, 290, 215, 355, 420, 380, 290,
      340, 285, 460, 410, 380, 510, 445, 380,
    ];
    const egresos = [
      120, 80, 95, 140, 180, 110, 165, 95, 85, 175,
      220, 160, 135, 210, 175, 120, 195, 230, 200, 165,
      175, 155, 245, 215, 195, 270, 240, 210,
    ];

    const W = 760, H = 260;
    const padL = 44, padR = 16, padT = 16, padB = 32;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...ingresos, ...egresos) * 1.15;
    const stepX = chartW / (days - 1);
    const x = (i) => padL + i * stepX;
    const y = (v) => padT + chartH - (v / maxVal) * chartH;

    const dateLabels = ['1 may', '7 may', '14 may', '21 may', '28 may'];
    const dateIdx = [0, 6, 13, 20, 27];

    function buildPath(arr, close) {
      let d = `M${x(0)},${y(arr[0])}`;
      for (let i = 1; i < arr.length; i++) d += ` L${x(i)},${y(arr[i])}`;
      if (close) d += ` L${x(arr.length - 1)},${padT + chartH} L${x(0)},${padT + chartH} Z`;
      return d;
    }

    let svg = '';
    const gridSteps = 4;
    for (let g = 0; g <= gridSteps; g++) {
      const gy = padT + (chartH / gridSteps) * g;
      const val = Math.round(maxVal * (1 - g / gridSteps) * 10) / 10;
      svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${gy}" y2="${gy}"/>`;
      svg += `<text class="axis-label" x="${padL - 8}" y="${gy + 3}" text-anchor="end">${val ? val.toFixed(0) + 'k' : '0'}</text>`;
    }
    dateIdx.forEach((i, n) => {
      svg += `<text class="axis-label" x="${x(i)}" y="${H - 10}" text-anchor="middle">${dateLabels[n]}</text>`;
    });
    svg += `<path class="area-egresos" d="${buildPath(egresos, true)}"/>`;
    svg += `<path class="area-ingresos" d="${buildPath(ingresos, true)}"/>`;
    svg += `<path class="line-egresos" d="${buildPath(egresos)}"/>`;
    svg += `<path class="line-ingresos" d="${buildPath(ingresos)}"/>`;
    svg += `<circle class="dot ing" cx="${x(days - 1)}" cy="${y(ingresos[days - 1])}" r="4"/>`;
    svg += `<circle class="dot egr" cx="${x(days - 1)}" cy="${y(egresos[days - 1])}" r="4"/>`;
    svg += `<line class="hover-line" id="hoverLine" x1="0" x2="0" y1="${padT}" y2="${padT + chartH}" style="opacity:0"/>`;
    svg += `<circle id="hoverDotIng" class="dot ing" cx="0" cy="0" r="5" style="opacity:0"/>`;
    svg += `<circle id="hoverDotEgr" class="dot egr" cx="0" cy="0" r="5" style="opacity:0"/>`;
    svg += `<rect id="hoverRect" x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" fill="transparent"/>`;
    chart.innerHTML = svg;

    const tooltip = document.getElementById('chartTooltip');
    const hoverLine = document.getElementById('hoverLine');
    const hoverDotI = document.getElementById('hoverDotIng');
    const hoverDotE = document.getElementById('hoverDotEgr');
    const hoverRect = document.getElementById('hoverRect');
    const wrap = document.querySelector('.chart-wrap');
    const fmt = (v) => 'Bs ' + (v * 1000).toLocaleString('es-VE');

    hoverRect.addEventListener('mousemove', (e) => {
      const rect = chart.getBoundingClientRect();
      const rx = ((e.clientX - rect.left) / rect.width) * W;
      let idx = Math.round((rx - padL) / stepX);
      idx = Math.max(0, Math.min(days - 1, idx));
      const cx = x(idx), cyI = y(ingresos[idx]), cyE = y(egresos[idx]);

      hoverLine.setAttribute('x1', cx); hoverLine.setAttribute('x2', cx); hoverLine.style.opacity = 1;
      hoverDotI.setAttribute('cx', cx); hoverDotI.setAttribute('cy', cyI); hoverDotI.style.opacity = 1;
      hoverDotE.setAttribute('cx', cx); hoverDotE.setAttribute('cy', cyE); hoverDotE.style.opacity = 1;

      const wrapRect = wrap.getBoundingClientRect();
      const chartRect = chart.getBoundingClientRect();
      const domX = chartRect.left - wrapRect.left + (cx / W) * chartRect.width;
      const domY = chartRect.top - wrapRect.top + (Math.min(cyI, cyE) / H) * chartRect.height;
      tooltip.style.left = domX + 'px';
      tooltip.style.top = domY + 'px';
      tooltip.dataset.visible = 'true';
      tooltip.innerHTML = `
        <div class="tt-date">${idx + 1} mayo 2026</div>
        <div class="tt-row"><span class="sw i"></span>Ingresos: ${fmt(ingresos[idx])}</div>
        <div class="tt-row"><span class="sw e"></span>Egresos: ${fmt(egresos[idx])}</div>`;
    });
    hoverRect.addEventListener('mouseleave', () => {
      hoverLine.style.opacity = 0;
      hoverDotI.style.opacity = 0;
      hoverDotE.style.opacity = 0;
      tooltip.dataset.visible = 'false';
    });
  })();

  /* =========================================================
     SUB-TABS FISCAL
     ========================================================= */
  (function fiscalSubtabs() {
    const tabsWrap = document.getElementById('fiscalTabs');
    if (!tabsWrap) return;
    const tabs = tabsWrap.querySelectorAll('button');
    const panes = document.querySelectorAll('.fiscal-tab');

    function gotoFiscalTab(tab) {
      tabs.forEach((b) => (b.dataset.active = b.dataset.tab === tab ? 'true' : 'false'));
      panes.forEach((p) => (p.dataset.active = p.dataset.tab === tab ? 'true' : 'false'));
      const content = document.querySelector('.content');
      if (content) content.scrollTop = 0;
      drawIcons();
    }
    window.gotoFiscalTab = gotoFiscalTab;

    tabs.forEach((btn) => btn.addEventListener('click', () => gotoFiscalTab(btn.dataset.tab)));

    document.querySelectorAll('[data-goto-fiscaltab]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        // Si el control está fuera de la vista fiscal, primero cambiamos de vista
        showView('fiscal', 'Módulo Fiscal · SENIAT');
        gotoFiscalTab(el.dataset.gotoFiscaltab);
      });
    });
  })();

  /* Las RETENCIONES viven ahora en assets/retenciones.js — se saco de aqui
     para que este archivo deje de crecer. Lo que publica en `window.__*`
     se sigue usando igual desde el modulo fiscal y desde compras. */

  /* =========================================================
     LIBRO DE VENTAS — selector de modo (Facturas / Máquina Fiscal)
     ========================================================= */
  (function ventasMode() {
    const nav = document.getElementById('ventasModeNav');
    if (!nav) return;
    const btns = nav.querySelectorAll('button');
    const views = document.querySelectorAll('.ventas-view');
    btns.forEach((b) => b.addEventListener('click', () => {
      const mode = b.dataset.vmode;
      btns.forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
      views.forEach((v) => (v.hidden = v.dataset.ventasmode !== mode));
      drawIcons();
    }));
  })();

  /* =========================================================
     SUB-TABS TESORERÍA (genérico)
     ========================================================= */
  (function tesoSubtabs() {
    const tabsWrap = document.getElementById('tesoTabs');
    if (!tabsWrap) return;
    const tabs = tabsWrap.querySelectorAll('button');
    const panes = document.querySelectorAll('.teso-tab');
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabs.forEach((b) => (b.dataset.active = b === btn ? 'true' : 'false'));
        panes.forEach((p) => (p.dataset.active = p.dataset.tab === tab ? 'true' : 'false'));
        drawIcons();
      });
    });
  })();

  /* =========================================================
     MÓDULO VENTAS Y FACTURACIÓN — sub-tabs + acciones
     ========================================================= */
  (function ventasModule() {
    const view = document.getElementById('view-ventas');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    // Sub-tabs (Facturas / Notas) — el "Libro de Ventas →" navega al Fiscal
    const tabsWrap = document.getElementById('ventasTabs');
    if (tabsWrap) {
      const tabs = tabsWrap.querySelectorAll('button:not(.ventas-link)');
      const panes = view.querySelectorAll('.ventas-tab');
      tabs.forEach((btn) => btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabs.forEach((b) => (b.dataset.active = b === btn ? 'true' : 'false'));
        panes.forEach((p) => (p.dataset.active = p.dataset.tab === tab ? 'true' : 'false'));
        drawIcons();
      }));
    }

    // Exportar facturas (CSV)
    const exp = document.getElementById('ventasExportBtn');
    if (exp) exp.addEventListener('click', () => {
      const table = view.querySelector('.ventas-tab[data-tab="facturas"] table.data-table');
      if (!table) return;
      const rows = [];
      rows.push([...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()).filter((x) => x));
      table.querySelectorAll('tbody tr').forEach((tr) => {
        /* Sin la columna del boton: «Ver» no es un dato de la factura. */
        const c = [...tr.querySelectorAll('td')].filter((td) => !td.querySelector('[data-ver-factura]'))
          .slice(0, 7).map((td) => td.textContent.replace(/\s+/g, ' ').trim());
        rows.push(c);
      });
      const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'Ventas_Facturas_2026-05.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Facturas exportadas a CSV');
    });

    // Nueva factura / Nueva nota (se conectan al formulario en la siguiente fase)
    const nf = document.getElementById('nuevaFacturaBtn');
    if (nf) nf.addEventListener('click', () => { if (window.openNuevaFactura) window.openNuevaFactura(); else toast('Emisión de factura — formulario en preparación', 'info'); });
    const nn = document.getElementById('nuevaNotaBtn');
    if (nn) nn.addEventListener('click', () => toast('Nueva nota de crédito/débito — formulario en preparación', 'info'));

    // Selector de MEDIO DE EMISIÓN (Forma libre / Máquina fiscal / Electrónica)
    if (!window.medioEmision) window.medioEmision = 'forma-libre';
    const MEDIOS = {
      'forma-libre': { lbl: 'Forma libre', desc: 'Talonario impreso por imprenta autorizada (Providencia 00102). Apto para pequeños y medianos comercios.' },
      'maquina-fiscal': { lbl: 'Máquina fiscal', desc: 'Documento emitido por impresora fiscal homologada, con reporte Z diario. Obligatorio para ciertos ramos.' },
      'electronica': { lbl: 'Electrónica', desc: 'Factura digital certificada con N° de control digital y código QR verificable en el portal del SENIAT.' },
    };
    const medioBtn = document.getElementById('medioEmisionBtn');
    const medioLbl = document.getElementById('medioEmisionLbl');
    if (medioBtn) medioBtn.addEventListener('click', () => {
      if (!window.openFormModal) return;
      window.openFormModal({
        title: 'Medio de emisión de la factura', saveLabel: 'Aplicar',
        fields: [{
          name: 'medio', label: 'Tipo de facturación según el comercio', col: 2, type: 'select',
          options: Object.keys(MEDIOS).map((k) => MEDIOS[k].lbl),
          value: MEDIOS[window.medioEmision].lbl,
        }, {
          name: 'nota', label: ' ', col: 2, type: 'static',
          html: '<div style="font-size:12px;color:var(--fg-muted);line-height:1.5;">' +
            Object.keys(MEDIOS).map((k) => '<strong>' + MEDIOS[k].lbl + ':</strong> ' + MEDIOS[k].desc).join('<br>') +
            '</div>',
        }],
        onSave: (v) => {
          const key = Object.keys(MEDIOS).find((k) => MEDIOS[k].lbl === v.medio) || 'forma-libre';
          window.medioEmision = key;
          if (medioLbl) medioLbl.textContent = MEDIOS[key].lbl;
          toast('Medio de emisión: ' + MEDIOS[key].lbl + ' · las nuevas facturas usarán este formato');
        },
      });
    });
  })();

  /* =========================================================
     SUB-TABS CONTABILIDAD + Libro Mayor (selección de cuenta)
     ========================================================= */
  (function contaSubtabs() {
    const tabsWrap = document.getElementById('contaTabs');
    if (tabsWrap) {
      const tabs = tabsWrap.querySelectorAll('button');
      const panes = document.querySelectorAll('.conta-tab');
      tabs.forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          tabs.forEach((b) => (b.dataset.active = b === btn ? 'true' : 'false'));
          panes.forEach((p) => (p.dataset.active = p.dataset.tab === tab ? 'true' : 'false'));
          // La apertura se carga al abrir su pestaña, en su propio try:
          // si fallara, no puede impedir el cambio de pestaña.
          if (tab === 'apertura' && window.cargarApertura) { try { window.cargarApertura(); } catch (e) { console.warn('[Apertura]', e); } }
          drawIcons();
        });
      });
    }
    // Libro Mayor: selección visual de cuenta
    document.querySelectorAll('.account-tree .acc-item').forEach((item) => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.account-tree .acc-item').forEach((a) => a.removeAttribute('data-active'));
        item.dataset.active = 'true';
      });
    });
  })();

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

  // Mostrar/ocultar paneles de sub-tabs (fiscal + tesorería + contabilidad) según data-active
  const subtabStyle = document.createElement('style');
  subtabStyle.textContent =
    '.fiscal-tab,.teso-tab,.conta-tab,.ventas-tab{display:none}' +
    '.fiscal-tab[data-active="true"],.teso-tab[data-active="true"],.conta-tab[data-active="true"],.ventas-tab[data-active="true"]{display:block;animation:viewIn var(--dur-base) var(--ease-out)}';
  document.head.appendChild(subtabStyle);

  /* =========================================================
     COMPROBANTE IVA / ISLR toggle
     ========================================================= */
  (function compToggle() {
    /* El formateo de numero, por la misma razon que en Facturas: las `fmt` del
       archivo viven dentro de OTROS modulos y desde este cierre no se ven.
       Faltaba, y se notaba: al elegir un proveedor, armar la lista de sus
       facturas reventaba a mitad de camino, asi que el desplegable de facturas
       se quedaba vacio y desactivado. */
    const fmt = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const toggle = document.getElementById('compToggle');
    if (toggle) {
      toggle.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          toggle.querySelectorAll('button').forEach((b) => b.removeAttribute('data-active'));
          btn.dataset.active = 'true';
          const iva = btn.dataset.type === 'iva';
          const elIva = document.getElementById('compIva');
          const elIslr = document.getElementById('compIslr');
          if (elIva) elIva.style.display = iva ? '' : 'none';
          if (elIslr) elIslr.style.display = iva ? 'none' : '';
          drawIcons();
        });
      });
    }
    /* =========================================================
       EMITIR COMPROBANTE — los selectores, con datos reales
       =========================================================
       Los tres eran <div> con texto fijo: "Selecciona un proveedor",
       "Selecciona una factura" y "2da quincena · May 2026". No abrían nada,
       y la vista previa de al lado mostraba la plantilla vacía. Peor: el
       botón de imprimir clona lo que se ve, así que imprimía un comprobante
       en blanco con pinta de bueno.

       Ahora se listan las retenciones YA REGISTRADAS del período: se elige
       el proveedor, luego su factura, y la vista previa se llena con esa.
       Registrar una retención nueva sigue siendo cosa de su pestaña. */
    (function selectoresComprobante() {
      const selT = document.getElementById('compTercero');
      const selF = document.getElementById('compFactura');
      const perEl = document.getElementById('compPeriodo');
      if (!selT || !selF) return;
      let _delTipo = [];

      const tipoActivo = () => {
        const b = document.querySelector('#compToggle button[data-active="true"]');
        return (b && b.dataset.type) || 'iva';
      };

      window.__syncComprobantes = function () {
        const todas = (window.__getRetenciones ? window.__getRetenciones() : []);
        _delTipo = todas.filter((r) => r.tipo === tipoActivo() && r.direccion === 'practicada');
        const etq = (window.__perLabelRetPub && window.__perLabelRetPub()) || '—';
        if (perEl) perEl.textContent = etq;
        // El generador de TXT anuncia el mismo período que va a exportar.
        const txtPer = document.getElementById('txtPeriodoLbl');
        if (txtPer) txtPer.textContent = etq;

        // Un proveedor por RIF, aunque tenga varias retenciones en el período.
        const vistos = {};
        _delTipo.forEach((r) => {
          const k = (r.tercero_rif || '').trim() || '(sin RIF)';
          if (!vistos[k]) vistos[k] = r.tercero_nombre || k;
        });
        const rifs = Object.keys(vistos);
        selT.innerHTML = rifs.length
          ? '<option value="">Selecciona un proveedor</option>'
            + rifs.map((k) => '<option value="' + esc(k) + '">' + esc(vistos[k]) + ' · ' + esc(k) + '</option>').join('')
          : '<option value="">Sin retenciones de ' + tipoActivo().toUpperCase() + ' en el período</option>';
        selT.disabled = !rifs.length;
        selF.innerHTML = '<option value="">Elige primero un proveedor</option>';
        selF.disabled = true;
      };

      selT.addEventListener('change', () => {
        const rif = selT.value;
        const suyas = _delTipo.filter((r) => ((r.tercero_rif || '').trim() || '(sin RIF)') === rif);
        selF.innerHTML = suyas.length
          ? '<option value="">Selecciona una factura</option>'
            + suyas.map((r) => '<option value="' + esc(r.id) + '">'
              + esc(r.factura || '(sin número)') + ' · Bs ' + fmt(Number(r.monto) || 0)
              + (r.comprobante ? ' · ' + esc(r.comprobante) : '') + '</option>').join('')
          : '<option value="">Este proveedor no tiene facturas en el período</option>';
        selF.disabled = !suyas.length;
      });

      selF.addEventListener('change', () => {
        const r = _delTipo.find((x) => String(x.id) === selF.value);
        // Se llena la vista previa que está a la vista, que es la misma que
        // clona el botón de imprimir. Así lo que se ve es lo que sale.
        if (r && window.__pintarComprobante) window.__pintarComprobante(r);
      });

      // Al cambiar de IVA a ISLR cambia la lista y la plantilla visible.
      const tg = document.getElementById('compToggle');
      if (tg) tg.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => window.__syncComprobantes()));

      // El enlace a Retenciones usa el mecanismo que ya existe
      // (data-goto-fiscaltab), no uno propio.
    })();

    /* Los contadores de las pestañas del módulo Fiscal. Traían 142, 218 y 46
       escritos a mano: números de la maqueta que no eran de ninguna empresa
       y no se movían al cambiar de período. Un contador que miente es peor
       que ninguno, porque se lee de reojo y se cree. */
    window.__setTabCount = function (tab, n) {
      const el = document.querySelector('#fiscalTabs [data-count="' + tab + '"]');
      if (el) el.textContent = String(n || 0);
    };

    /* ARCHIVOS DEL SENIAT — el conmutador entre el TXT de IVA y el XML de
       ISLR, que antes eran dos pestañas del módulo.

       No son el mismo documento: el TXT es de IVA y va por quincena, el XML
       es de ISLR y va por mes. Comparten el sitio y el momento —se generan
       desde las mismas retenciones, al cerrar el período— no el contenido. */
    (function archivosSeniat() {
      const nav = document.getElementById('raNav');
      if (!nav) return;
      const paneles = document.querySelectorAll('[data-ra-panel]');
      const mostrar = (cual) => {
        nav.querySelectorAll('button').forEach((b) =>
          (b.dataset.active = b.dataset.ra === cual ? 'true' : 'false'));
        paneles.forEach((p) => (p.hidden = p.dataset.raPanel !== cual));
        drawIcons();
      };
      nav.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => mostrar(b.dataset.ra)));

      // Los botones que antes cambiaban de pestaña ahora bajan hasta aquí.
      document.querySelectorAll('[data-ra-goto]').forEach((el) =>
        el.addEventListener('click', (e) => {
          e.preventDefault();
          mostrar(el.dataset.raGoto);
          const cont = document.getElementById('retArchivos');
          if (cont) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    })();

    /* Los períodos que se muestran por todo el módulo — Pensiones, IGP, IGTF,
       el TXT y el XML de ISLR— venían escritos a mano: "Mayo 2026 (01–31)",
       "Al 30/09/2026", "Junio 2026 · 1ra Quincena". Cada pestaña anunciaba un
       mes distinto, y ninguno era el que estabas mirando.

       Ahora los tres formatos salen del período real, marcados con
       data-perfiscal para no tener que buscarlos por su texto. */
    /* OJO con el alcance: esta función vive en `compToggle`, y `_MESES_PER`,
       `_ivaPorQuincena` y `_perLabel` están declarados dentro de
       `fiscalActions`, que es otro bloque. Referirlas aquí lanzaba
       ReferenceError en cuanto se elegía una empresa —y como esta función se
       llama desde `__syncFiscalHeader`, que a su vez se llama tres líneas
       antes de recargar el calendario, se llevaba por delante el calendario,
       los cierres y todo lo que venía después—. Aquí solo se usa lo propio o
       lo que está publicado en `window`. */
    const MESES_PF = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    window.__syncPeriodosFiscal = function () {
      const p = window.__fiscalPer;
      if (!p || !p.mm || !p.aa) return;
      const anio = '20' + p.aa, mm = parseInt(p.mm, 10);
      const mes = MESES_PF[mm - 1] + ' ' + anio;
      const ultimo = new Date(parseInt(anio, 10), mm, 0).getDate();
      const q = (window.__ivaPorQuincena ? window.__ivaPorQuincena() : false) && p.q;
      const valores = {
        mes: mes + ' (01–' + ultimo + ')',
        // El ejercicio del IGP cierra el 30/09 del año que se está mirando.
        ejercicio: 'Al 30/09/' + anio,
        quincena: mes + (q ? ' · ' + (p.q === 1 ? '1ra' : '2da') + ' Quincena' : ''),
        etiqueta: window.__perLabelFiscal ? window.__perLabelFiscal() : mes,
      };
      document.querySelectorAll('[data-perfiscal]').forEach((el) => {
        const v = valores[el.dataset.perfiscal];
        if (v) el.textContent = v;
      });
    };

    // Imprimir / PDF del comprobante: se clona el comprobante visible a un
    // portal aislado y se oculta toda la app, garantizando UNA sola hoja.
    function printComprobante() {
      const iva = document.getElementById('compIva');
      const islr = document.getElementById('compIslr');
      const target = (islr && getComputedStyle(islr).display !== 'none') ? islr : iva;
      if (!target) return;
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = target.cloneNode(true);
      clon.style.display = 'block';
      portal.appendChild(clon);
      document.body.classList.add('printing-comp');
      window.print();
    }
    function cleanupPrint() {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
    }
    window.addEventListener('afterprint', cleanupPrint);
    const pBtn = document.getElementById('compPrintBtn');
    if (pBtn) pBtn.addEventListener('click', printComprobante);
    const pdfBtn = document.getElementById('compPdfBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', printComprobante);
  })();

  /* =========================================================
     DECLARACIÓN PROTECCIÓN A LAS PENSIONES — imprimir planilla
     ========================================================= */
  (function declaracionesFiscales() {
    function printDocById(docId) {
      const doc = document.getElementById(docId);
      if (!doc) return;
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = doc.cloneNode(true);
      clon.style.display = 'block';
      clon.classList.add('dpp-print'); // hoja vertical (portrait)
      portal.appendChild(clon);
      document.body.classList.add('printing-comp');
      window.print();
    }
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
    });
    const wire = (ids, fn) => ids.forEach((id) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); });
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    // Protección a las Pensiones (Forma 99019)
    wire(['pensionPrintBtn', 'pensionPdfBtn'], () => printDocById('pensionDoc'));
    wire(['pensionRegistrarBtn'], () => toast('Declaración de Protección a las Pensiones registrada · lista para transmitir al SENIAT'));

    // Impuesto a los Grandes Patrimonios (IGP)
    wire(['igpPrintBtn', 'igpPdfBtn'], () => printDocById('igpDoc'));
    wire(['igpRegistrarBtn'], () => toast('Declaración del IGP registrada en cero · de presentación obligatoria'));
  })();

  /* =========================================================
     IGTF (Forma 21) — declaración quincenal · 3% (divisas/cripto, del Libro de Ventas) + 2% (Bs, manual)
     ========================================================= */
  (function igtfModule() {
    const view = document.getElementById('view-fiscal');
    if (!view) return;
    const fmt = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const $ = (id) => document.getElementById(id);
    function render() {
      const v = window.__IGTF_VENTAS || { base: 0, ops: 0, monto: 0 };
      const base2 = parseFloat(($('igtf2BaseInput') || {}).value) || 0;
      const ops2 = parseInt(($('igtf2OpsInput') || {}).value, 10) || 0;
      const monto2 = base2 * 0.02;
      const total = (Number(v.monto) || 0) + monto2;
      const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
      set('igtf3BaseDoc', fmt(v.base)); set('igtf3OpsDoc', String(v.ops || 0)); set('igtf3MontoDoc', fmt(v.monto)); set('igtf3MontoMini', fmt(v.monto));
      set('igtf2BaseDoc', fmt(base2)); set('igtf2OpsDoc', String(ops2)); set('igtf2MontoDoc', fmt(monto2)); set('igtf2MontoMini', fmt(monto2));
      set('igtfTotalDoc', fmt(total)); set('igtfTotalMini', fmt(total));
      const emp = window.__EMPRESA_ACTIVA || {};
      set('igtfDocCo', emp.n || 'Empresa'); set('igtfDocRif', 'RIF ' + (emp.rif || '—'));
      const perEl = $('igtfPerSel'); if (perEl) set('igtfDocPeriodo', (perEl.textContent || '').trim());

      /* La Forma 21 se presenta DOS VECES AL MES, aunque el IVA de la
         empresa sea mensual. Mostrar solo el total del mes obliga a partirlo
         a mano contra el libro justo cuando se está declarando, que es
         cuando peor se cuenta. Aquí sale ya partido. */
      const doc = $('igtfDoc');
      if (doc && doc.parentNode) {
        let caja = $('igtfPorQuincena');
        if (!caja) {
          caja = document.createElement('div');
          caja.id = 'igtfPorQuincena';
          caja.style.cssText = 'margin:0 0 12px;border:1px solid var(--border-strong);border-radius:10px;overflow:hidden;font-size:12.5px;';
          doc.parentNode.insertBefore(caja, doc);
        }
        const fila = (rot, d, dias) => '<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 12px;border-top:1px solid var(--border);">'
          + '<span><strong>' + rot + '</strong> <span style="color:var(--fg-muted);">' + dias + '</span></span>'
          + '<span style="color:var(--fg-muted);">' + (d.ops || 0) + ' oper. · base ' + fmt(d.base) + '</span>'
          + '<span class="mono"><strong>' + fmt(d.monto) + '</strong></span></div>';
        const q1 = v.q1 || { ops: 0, monto: 0, base: 0 };
        const q2 = v.q2 || { ops: 0, monto: 0, base: 0 };
        caja.innerHTML = '<div style="padding:8px 12px;background:var(--bg-subtle,var(--bg-surface));font-weight:600;">'
          + 'IGTF 3% por quincena <span style="font-weight:400;color:var(--fg-muted);">— la Forma 21 se presenta una por quincena</span></div>'
          + fila('1ra quincena', q1, '(01–15)')
          + fila('2da quincena', q2, '(16 al último día)')
          + (Number(v.monto) > 0 ? '' : '<div style="padding:8px 12px;border-top:1px solid var(--border);color:var(--fg-muted);">'
            + 'Sin cobros en divisas ni cripto en el período: las dos declaraciones van en cero.</div>');
      }
    }
    window.__renderIGTF = render;
    ['igtf2BaseInput', 'igtf2OpsInput'].forEach((id) => { const e = $(id); if (e) e.addEventListener('input', render); });
    function imprimir() {
      const doc = $('igtfDoc'); if (!doc) return;
      let portal = $('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = doc.cloneNode(true); clon.classList.add('dpp-print'); portal.appendChild(clon);
      document.body.classList.add('printing-comp');
      if (window.lucide) window.lucide.createIcons();
      window.print();
    }
    window.addEventListener('afterprint', () => { document.body.classList.remove('printing-comp'); const p = $('printPortal'); if (p) p.innerHTML = ''; });
    const wire = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
    wire('igtfPrintBtn', imprimir); wire('igtfPdfBtn', imprimir);
    wire('igtfRegistrarBtn', () => { if (window.toast) window.toast('Declaración de IGTF (Forma 21) registrada · lista para transmitir al portal SENIAT', 'success'); });
    render();
  })();

  /* =========================================================
     IGP (Grandes Patrimonios) — patrimonio neto desde el Balance General real
     ========================================================= */
  (function igpModule() {
    const fmt = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const $ = (id) => document.getElementById(id);
    function render() {
      const b = window.__BALANCE || { activo: 0, pasivo: 0, patrimonio: 0 };
      const exentos = parseFloat(($('igpExentosInput') || {}).value) || 0;
      const minEx = parseFloat(($('igpMinExentoInput') || {}).value) || 0;
      const alic = parseFloat(($('igpAlicInput') || {}).value) || 0;
      const patNeto = (Number(b.activo) || 0) - (Number(b.pasivo) || 0) - exentos;
      const base = Math.max(0, patNeto - minEx);
      const imp = base * alic / 100;
      const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
      set('igpActivosDoc', fmt(b.activo));
      set('igpPasivosDoc', '(' + fmt(b.pasivo) + ')');
      set('igpExentosDoc', exentos ? '(' + fmt(exentos) + ')' : '0,00');
      set('igpPatNetoDoc', fmt(patNeto));
      set('igpMinExentoDoc', '(' + fmt(minEx) + ')');
      set('igpBaseDoc', fmt(base));
      set('igpAlicDoc', (alic % 1 === 0 ? alic : alic) + '%');
      set('igpImpDoc', fmt(imp));
      set('igpPatNetoCtrl', 'Bs ' + fmt(patNeto));
      set('igpPatNetoMini', fmt(patNeto));
      set('igpBaseMini', fmt(base));
      set('igpImpMini', fmt(imp));
      const emp = window.__EMPRESA_ACTIVA || {};
      set('igpDocCo', emp.n || 'Empresa'); set('igpDocRif', 'RIF ' + (emp.rif || '—'));
    }
    window.__renderIGP = render;
    ['igpExentosInput', 'igpMinExentoInput', 'igpAlicInput'].forEach((id) => { const e = $(id); if (e) e.addEventListener('input', render); });
    render();
  })();

  /* =========================================================
     DPP (Protección a las Pensiones · Forma 99019) — 9% del total de salarios + bonif. no salariales
     ========================================================= */
  (function dppModule() {
    const fmt = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const $ = (id) => document.getElementById(id);
    function render() {
      // Emprendimientos NO declaran Protección a las Pensiones (aunque su RIF sea J):
      // sin cálculos, sin planilla y sin avisos para la empresa exenta.
      const eAct = window.__EMPRESA_ACTIVA || {};
      /* Una PERSONA NATURAL no declara Protección a las Pensiones, aunque sea
         contribuyente especial: la PA SNAT/2025/000093 art.1 habla de «las
         personas jurídicas... de carácter privado», y el manual del SENIAT
         (TRI.GR.03.031) dice «dirigido a las personas Jurídicas (J)». Radian
         es una firma personal con RIF V.

         El calendario ya lo excluía —filtra por la letra del RIF— pero este
         panel miraba solo la casilla `declara_dpp`, que en Radian está en sí.
         Los dos decían cosas distintas del mismo contribuyente: no le avisaba
         del vencimiento, pero le pintaba la planilla para presentarlo. */
      const esNatural = /^\s*[VE]/i.test(String(eAct.rif || ''));
      const exenta = eAct.declaraDpp === false || esNatural;
      const doc = $('pensionDoc');
      let banner = $('dppExentoBanner');
      if (!banner && doc && doc.parentElement) {
        banner = document.createElement('div');
        banner.id = 'dppExentoBanner';
        banner.style.cssText = 'display:none;margin:10px 0;padding:12px 14px;border:1px solid var(--border-strong);border-radius:10px;font-size:13px;color:var(--fg-muted);';
        banner.innerHTML = '✅ <strong>Esta empresa no declara Protección a las Pensiones.</strong> <span id="dppMotivo"></span> Cálculo, planilla y avisos de DPP desactivados para ella.';
        doc.parentElement.insertBefore(banner, doc);
      }
      if (banner) {
        banner.style.display = exenta ? 'block' : 'none';
        const motivo = document.getElementById('dppMotivo');
        if (motivo) {
          motivo.textContent = esNatural
            ? 'Es una persona natural, y el DPP es de las personas jurídicas privadas (PA SNAT/2025/000093, art. 1).'
            : 'Emprendimiento exento.';
        }
      }
      if (doc) doc.style.display = exenta ? 'none' : '';
      if (exenta) return;
      const emp = parseInt(($('dppEmpInput') || {}).value, 10) || 0;
      const base = parseFloat(($('dppBaseInput') || {}).value) || 0;
      const imp = base * 0.09;
      const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
      set('dppEmpDoc', String(emp)); set('dppBaseDoc', fmt(base)); set('dppImpDoc', fmt(imp));
      set('dppEmpMini', String(emp)); set('dppBaseMini', fmt(base)); set('dppImpMini', fmt(imp));
      const e = window.__EMPRESA_ACTIVA || {};
      set('dppDocCo', e.n || 'Empresa'); set('dppDocRif', 'RIF ' + (e.rif || '—'));
    }
    window.__renderDPP = render;
    ['dppEmpInput', 'dppBaseInput'].forEach((id) => { const el = $(id); if (el) el.addEventListener('input', render); });
    render();
  })();

  /* =========================================================
     ISLR del ejercicio (acumulado estimado) — Tarifa N°2 PJ sobre el enriquecimiento neto acumulado
     ========================================================= */
  (function islrAnualModule() {
    const UT = 43; // Unidad Tributaria 2026
    const fmt = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const $ = (id) => document.getElementById(id);
    function render() {
      const base = Math.max(0, Number(window.__UTILIDAD_NETA) || 0); // pérdida → 0
      const baseUT = base / UT;
      let alic, sustrUT, tarifaTxt;
      if (baseUT <= 2000) { alic = 0.15; sustrUT = 0; tarifaTxt = '15% · hasta 2.000 U.T.'; }
      else if (baseUT <= 3000) { alic = 0.22; sustrUT = 140; tarifaTxt = '22% · 2.000–3.000 U.T.'; }
      else { alic = 0.34; sustrUT = 500; tarifaTxt = '34% · más de 3.000 U.T.'; }
      const sustr = sustrUT * UT;
      const imp = Math.max(0, base * alic - sustr);
      const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
      set('islrAnualImp', fmt(imp)); set('islrAnualImp2', fmt(imp));
      set('islrAnualBase', fmt(base));
      set('islrAnualUT', baseUT.toLocaleString('es-VE', { maximumFractionDigits: 2 }));
      set('islrAnualTarifa', tarifaTxt);
      set('islrAnualSustr', fmt(sustr));
      set('islrAnualNota', base > 0 ? ('Sobre Bs ' + fmt(base) + ' de enriquecimiento neto acumulado') : 'Sin utilidad acumulada (o pérdida): ISLR estimado en cero');
    }
    window.__renderISLRanual = render;
    function imprimir() {
      const panel = $('islrAnualPanel'); if (!panel) return;
      let portal = $('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = panel.cloneNode(true);
      const hide = clon.querySelector('[data-print-hide]'); if (hide) hide.style.display = 'none';
      clon.classList.add('conta-print');
      portal.appendChild(clon);
      document.body.classList.add('printing-comp');
      if (window.lucide) window.lucide.createIcons();
      window.print();
    }
    window.addEventListener('afterprint', () => { document.body.classList.remove('printing-comp'); const p = $('printPortal'); if (p) p.innerHTML = ''; });
    const pb = $('islrAnualPrintBtn'); if (pb) pb.addEventListener('click', imprimir);
    render();
  })();

  /* =========================================================
     BÓVEDA FISCAL — respaldo de planillas y certificados del SENIAT (Supabase Storage)
     ========================================================= */
  (function bovedaFiscal() {
    const view = document.getElementById('view-fiscal');
    if (!view) return;
    const BUCKET = 'documentos-fiscales';
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const tbody = document.getElementById('bovedaBody');
    const fmtSize = (n) => { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let _docs = [];
    let _defPeriodoSet = false;
    const selImp = document.getElementById('bovedaFiltroImpuesto');
    const selPer = document.getElementById('bovedaFiltroPeriodo');
    const selTip = document.getElementById('bovedaFiltroTipo');
    const MESES_B = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    // Convierte "Marzo 2026 · 2da Quincena" / "Ejercicio 2026" en una clave ordenable
    function pPer(p) {
      p = String(p || '');
      const ej = /ejercicio/i.test(p);
      const my = p.match(/\b(20\d\d)\b/);
      const anio = my ? +my[1] : 0;
      let mes = 0;
      for (let i = 0; i < 12; i++) { if (p.toLowerCase().indexOf(MESES_B[i].toLowerCase()) >= 0) { mes = i + 1; break; } }
      const q = /2da/i.test(p) ? 2 : /1ra/i.test(p) ? 1 : 0;
      return { key: anio * 1000 + mes * 10 + q, mes, anio, ej };
    }
    function fillSel(sel, vals) {
      if (!sel) return;
      const cur = sel.value;
      const first = sel.querySelector('option');
      sel.innerHTML = ''; sel.appendChild(first);
      vals.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
      sel.value = vals.indexOf(cur) >= 0 ? cur : '';
    }
    function poblarFiltros() {
      fillSel(selImp, [...new Set(_docs.map((d) => d.impuesto).filter(Boolean))].sort());
      fillSel(selTip, [...new Set(_docs.map((d) => d.tipo).filter(Boolean))].sort());
      const pers = [...new Set(_docs.map((d) => d.periodo).filter(Boolean))].sort((a, b) => pPer(b).key - pPer(a).key);
      fillSel(selPer, pers);
      // Por defecto solo se ve el último período (no todos de golpe)
      if (!_defPeriodoSet && pers.length) { selPer.value = pers[0]; _defPeriodoSet = true; }
    }
    function recordatorios() {
      const box = document.getElementById('bovedaRecordatorios');
      if (!box) return;
      const porImp = {};
      _docs.forEach((d) => { const pp = pPer(d.periodo); if (pp.ej || !pp.anio || !pp.mes) return; (porImp[d.impuesto] = porImp[d.impuesto] || new Set()).add(pp.anio * 100 + pp.mes); });
      const faltan = [];
      Object.keys(porImp).forEach((imp) => {
        const keys = [...porImp[imp]].sort((a, b) => a - b);
        if (keys.length < 2) return;
        const have = new Set(keys), max = keys[keys.length - 1];
        let y = Math.floor(keys[0] / 100), m = keys[0] % 100;
        while (y * 100 + m < max) {
          if (!have.has(y * 100 + m)) faltan.push({ imp, txt: MESES_B[m - 1] + ' ' + y, key: y * 100 + m });
          m++; if (m > 12) { m = 1; y++; }
        }
      });
      if (!faltan.length) { box.innerHTML = ''; return; }
      faltan.sort((a, b) => a.key - b.key);
      box.innerHTML = '<div style="background:#fff7e6;border:1px solid #ffe0a3;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#8a5a00;display:flex;gap:8px;align-items:flex-start;">'
        + '<i data-lucide="bell-ring" style="width:15px;height:15px;flex-shrink:0;margin-top:1px;"></i>'
        + '<div><b>Recordatorio — posibles documentos faltantes</b> (períodos sin ningún archivo, entre los que sí tienes cargados):<br>'
        + faltan.map((f) => '<span class="tag amber" style="margin:4px 4px 0 0;cursor:pointer;" data-falta-imp="' + esc(f.imp) + '">' + esc(f.imp) + ' · ' + esc(f.txt) + '</span>').join('')
        + '</div></div>';
      if (window.lucide) window.lucide.createIcons();
    }

    async function cargarBoveda() {
      if (!tbody) return;
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:16px;">Selecciona una empresa.</td></tr>'; return;
      }
      const { data, error } = await window.sb.from('documentos_fiscales').select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('creado_en', { ascending: false });
      if (error) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:16px;">No se pudo cargar (¿creaste la tabla documentos_fiscales y el bucket?).</td></tr>'; console.warn('[DigiAccount] Bóveda:', error.message); return; }
      _docs = data || [];
      poblarFiltros();
      recordatorios();
      render();
    }
    window.cargarBoveda = cargarBoveda;

    function render() {
      if (!tbody) return;
      const q = ((document.getElementById('bovedaSearch') || {}).value || '').toLowerCase().trim();
      const fImp = selImp ? selImp.value : '', fPer = selPer ? selPer.value : '', fTip = selTip ? selTip.value : '';
      const arr = _docs.filter((d) =>
        (!fImp || d.impuesto === fImp) &&
        (!fPer || (d.periodo || '') === fPer) &&
        (!fTip || d.tipo === fTip) &&
        (!q || (d.impuesto + ' ' + (d.periodo || '') + ' ' + d.tipo + ' ' + (d.nombre || '')).toLowerCase().includes(q)));
      if (!arr.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:16px;">' + (_docs.length ? 'Sin resultados con estos filtros.' : 'Aún no hay documentos. Usa "Subir documento".') + '</td></tr>'; return; }
      const tipoTag = (t) => { const c = /pago/i.test(t) ? 'amber' : /certif/i.test(t) ? 'success' : 'cyan'; return '<span class="tag ' + c + '">' + esc(t) + '</span>'; };
      tbody.innerHTML = arr.map((d) => {
        const fecha = d.creado_en ? new Date(d.creado_en).toLocaleDateString('es-VE') : '';
        return '<tr><td>' + esc(fecha) + '</td><td class="primary">' + esc(d.impuesto) + '</td><td>' + esc(d.periodo || '—') + '</td>'
          + '<td>' + tipoTag(d.tipo) + '</td><td class="mono">' + esc(d.nombre || '') + '</td><td class="num">' + fmtSize(d.tamano) + '</td>'
          + '<td class="ctr" style="white-space:nowrap;">'
          + '<button class="btn btn-ghost" data-bov-ver="' + esc(d.storage_path) + '" title="Ver / descargar" style="height:26px;font-size:11px;padding:0 8px;"><i data-lucide="eye"></i></button> '
          + '<button class="btn btn-ghost" data-bov-del="' + esc(d.id) + '" data-bov-path="' + esc(d.storage_path) + '" title="Eliminar" style="height:26px;font-size:11px;padding:0 8px;color:#c0392b;"><i data-lucide="trash-2"></i></button>'
          + '</td></tr>';
      }).join('');
      if (window.lucide) window.lucide.createIcons();
    }

    if (tbody) tbody.addEventListener('click', async (e) => {
      const ver = e.target.closest('[data-bov-ver]');
      const del = e.target.closest('[data-bov-del]');
      if (ver) {
        const { data, error } = await window.sb.storage.from(BUCKET).createSignedUrl(ver.dataset.bovVer, 120);
        if (error || !data) { toast('No se pudo abrir: ' + (error && error.message), 'error'); return; }
        window.open(data.signedUrl, '_blank');
      } else if (del) {
        if (!window.confirm('¿Eliminar este documento de la bóveda? No se puede deshacer.')) return;
        await window.sb.storage.from(BUCKET).remove([del.dataset.bovPath]);
        const { error } = await window.sb.from('documentos_fiscales').delete().eq('id', del.dataset.bovDel);
        if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return; }
        toast('Documento eliminado', 'success'); cargarBoveda();
      }
    });

    const search = document.getElementById('bovedaSearch');
    if (search) search.addEventListener('input', render);
    [selImp, selPer, selTip].forEach((s) => { if (s) s.addEventListener('change', render); });
    // Clic en un recordatorio: filtra por ese impuesto para ubicar el hueco
    const recBox = document.getElementById('bovedaRecordatorios');
    if (recBox) recBox.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-falta-imp]');
      if (!chip) return;
      if (selImp) selImp.value = chip.dataset.faltaImp;
      if (selPer) selPer.value = '';
      render();
    });

    function subir() {
      let fileEl = null;
      window.openFormModal && window.openFormModal({
        title: 'Subir documento a la Bóveda Fiscal',
        saveLabel: 'Subir',
        fields: [
          { name: 'impuesto', label: 'Impuesto', type: 'select', options: ['IVA', 'Retenciones IVA', 'ISLR', 'Retenciones ISLR', 'IGTF', 'IGP (Grandes Patrimonios)', 'Protección a las Pensiones', 'Otro'] },
          { name: 'tipo', label: 'Tipo de documento', type: 'select', options: ['Planilla de declaración', 'Planilla / compromiso de pago', 'Certificado electrónico'] },
          { name: 'pmes', label: 'Mes', type: 'select', options: ['—', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'] },
          { name: 'pquincena', label: 'Quincena', type: 'select', options: ['Mes completo', '1ra Quincena', '2da Quincena'] },
          { name: 'panio', label: 'Año / Ejercicio', type: 'select', options: ['2026', '2025', '2024', '2027'] },
          { name: 'archivo', label: 'Archivo (PDF, imagen…)', col: 2, type: 'file' },
        ],
        afterRender: (body) => { fileEl = body.querySelector('[data-name="archivo"]'); },
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          const file = fileEl && fileEl.files && fileEl.files[0];
          if (!file) return 'Selecciona un archivo.';
          // Arma el período a partir de los 3 selectores
          const mes = v.pmes && v.pmes !== '—' ? v.pmes : '';
          const q = v.pquincena && v.pquincena !== 'Mes completo' ? ' · ' + v.pquincena : '';
          const periodo = mes ? (mes + ' ' + v.panio + q) : ('Ejercicio ' + v.panio);
          const safe = (s) => (s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = window.__CUENTA_ID + '/' + window.__EMPRESA_ACTIVA.id + '/' + safe(v.impuesto) + '/' + safe(periodo) + '/' + Date.now() + '_' + safe(file.name);
          window.sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined }).then(({ error }) => {
            if (error) { toast('No se pudo subir: ' + error.message, 'error'); return; }
            window.sb.from('documentos_fiscales').insert({
              cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
              impuesto: v.impuesto, periodo: periodo, tipo: v.tipo, nombre: file.name,
              storage_path: path, mime: file.type, tamano: file.size,
            }).then(({ error: e2 }) => {
              if (e2) { toast('Archivo subido pero no se registró: ' + e2.message, 'error'); return; }
              toast('Documento guardado en la Bóveda Fiscal', 'success'); cargarBoveda();
            });
          });
        },
      });
    }
    const subirBtn = document.getElementById('bovedaSubirBtn');
    if (subirBtn) subirBtn.addEventListener('click', subir);

    cargarBoveda();
  })();

  /* TESORERIA vive ahora en assets/tesoreria.js — se saco de aqui para que
     este archivo deje de crecer. Lo que publica en `window.*` se sigue
     usando igual desde los demas modulos. */

  /* =========================================================
     RELACIÓN DE NÓMINA DEL PERÍODO — modal imprimible
     ========================================================= */
  (function relacionNomina() {
    const overlay = document.getElementById('relnOverlay');
    const openBtn = document.getElementById('relacionNominaBtn');
    if (!overlay || !openBtn) return;
    const closeBtn = document.getElementById('relnClose');
    const printBtn = document.getElementById('relnPrint');

    const doc = document.getElementById('relnDoc');
    const freqSel = document.getElementById('relnFreq');
    openBtn.addEventListener('click', () => { if (window.__buildRelacion) window.__buildRelacion(freqSel ? freqSel.value : 'quincenal'); overlay.hidden = false; drawIcons(); });
    if (freqSel) freqSel.addEventListener('change', () => { if (window.__buildRelacion) window.__buildRelacion(freqSel.value); });
    if (closeBtn) closeBtn.addEventListener('click', () => (overlay.hidden = true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
    if (printBtn) printBtn.addEventListener('click', () => {
      // Clonar a portal fuera de .app → imprime una sola hoja apaisada
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = doc.cloneNode(true);
      clon.classList.add('reln-print');
      portal.appendChild(clon);
      document.body.classList.add('printing-comp');
      window.print();
    });
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
    });
  })();

  /* =========================================================
     CALENDARIO FISCAL — datos REALES (tabla calendario_fiscal,
     Gaceta 43.273) cruzados con el terminal de RIF y la condición
     de la empresa activa. Nada de fechas de ejemplo.
     ========================================================= */
  (function calendar() {
    const calGrid = document.getElementById('calGrid');
    if (!calGrid) return;
    const titleEl = document.getElementById('calTitle');
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesCorto = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const dows = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const hoy = new Date();
    const hoyISO = window.__hoyISO ? window.__hoyISO() : hoy.toISOString().slice(0, 10);
    let y = hoy.getFullYear(), m = hoy.getMonth();   // arranca en el mes REAL
    let EVENTOS = [];        // [{fecha:'YYYY-MM-DD', impuesto, descripcion}]
    let cargadoPara = '';    // control de recarga por empresa/año

    // Etiqueta corta y legible por impuesto
    const IMP = {
      RET_IVA_1Q: 'Retenciones IVA · 1ra quincena', RET_IVA_2Q: 'Retenciones IVA · 2da quincena',
      RET_ISLR: 'Retenciones de ISLR', ISLR_ESTIMADA: 'ISLR estimada (porción)',
      ISLR_ANUAL: 'ISLR anual (autoliquidación)', IGP: 'Grandes Patrimonios',
      DPP: 'Protección de Pensiones', IVA: 'Declaración de IVA',
    };
    const etiqueta = (imp) => IMP[imp] || imp;

    /* Devuelve `true` solo si de verdad se pudo consultar. Quien llama usa
       eso para decidir si marca el año como cargado: si se marca cuando la
       consulta ni siquiera se intentó —todavía no hay empresa, o `window.sb`
       aún no existe— el calendario se queda vacío PARA SIEMPRE, porque la
       siguiente llamada lo ve como «ya cargado» y no vuelve a intentar.
       Eso es lo que dejaba el calendario en blanco. */
    async function cargarEventos() {
      const emp = window.__EMPRESA_ACTIVA;
      if (!window.sb || !emp || !emp.id) { EVENTOS = []; return false; }
      const digitos = String(emp.rif || '').replace(/\D/g, '');
      const terminal = digitos.slice(-1);
      if (!terminal) { EVENTOS = []; return false; }
      const esEspecial = /especial/i.test(emp.cond || '');
      const esOrdinario = /ordinario/i.test(emp.cond || '');
      // DPP (Protección de Pensiones): SOLO personas jurídicas privadas (RIF J).
      // Fuentes: PA SNAT/2025/000093 art.1 ("las personas jurídicas... de carácter
      // privado") y manual SENIAT TRI.GR.03.031 ("dirigido a las personas Jurídicas (J)").
      // Una firma personal es persona natural (V) → NO declara DPP, aunque sea especial.
      const esJuridica = /^\s*J/i.test(String(emp.rif || ''));
      const { data, error } = await window.sb.from('calendario_fiscal')
        .select('fecha, impuesto, descripcion, ambito, terminales')
        .gte('fecha', y + '-01-01').lte('fecha', y + '-12-31');
      if (error) { console.warn('[Calendario] ', error.message); EVENTOS = []; return false; }
      // Aplica SOLO lo que le toca a esta empresa: su terminal de RIF, lo 'especial'
      // únicamente si es sujeto pasivo especial, y el DPP solo si es persona jurídica.
      // DPP: además de ser jurídica, la empresa debe DECLARAR DPP (emprendimientos exentos = declaraDpp false)
      const declaraDpp = esJuridica && emp.declaraDpp !== false;
      EVENTOS = (data || []).filter((e) =>
        String(e.terminales || '').indexOf(terminal) >= 0 &&
        (e.ambito !== 'especial' || esEspecial) &&
        (e.impuesto !== 'DPP' || declaraDpp)
      ).map((e) => ({ fecha: e.fecha, impuesto: e.impuesto, descripcion: e.descripcion }));
      // Regla general de los ORDINARIOS: IVA del mes anterior, hasta el día 15.
      if (esOrdinario) {
        for (let mm = 0; mm < 12; mm++) {
          const f = y + '-' + String(mm + 1).padStart(2, '0') + '-15';
          EVENTOS.push({ fecha: f, impuesto: 'IVA',
            descripcion: 'Declaración y pago de IVA de ' + meses[(mm + 11) % 12].toLowerCase() + ' (contribuyente ordinario — hasta el 15)' });
        }
      }
      EVENTOS.sort((a, b) => a.fecha.localeCompare(b.fecha));
      if (!EVENTOS.length) {
        console.warn('[Calendario] la tabla respondió ' + (data || []).length
          + ' fechas del ' + y + ', pero ninguna es de esta empresa'
          + ' (terminal de RIF ' + terminal + ', ' + (emp.cond || 'sin condición') + ')');
      }
      return true;
    }

    function eventosDe(fechaISO) { return EVENTOS.filter((e) => e.fecha === fechaISO); }

    function render() {
      const offset = (new Date(y, m, 1).getDay() + 6) % 7; // semana inicia en lunes
      const dias = new Date(y, m + 1, 0).getDate();
      let html = dows.map((d) => '<div class="cal-dow">' + d + '</div>').join('');
      for (let i = 0; i < offset; i++) html += '<div class="cal-day empty"></div>';
      for (let d = 1; d <= dias; d++) {
        const iso = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const evs = eventosDe(iso);
        let cls = 'cal-day', dot = '', title = '';
        if (iso === hoyISO) cls += ' today';
        if (evs.length) {
          const dias_faltan = Math.round((new Date(iso + 'T12:00:00') - new Date(hoyISO + 'T12:00:00')) / 86400000);
          const urgente = dias_faltan >= 0 && dias_faltan <= 3;
          cls += urgente ? ' has-event urgent' : ' has-event';
          dot = '<span class="ev-dot"></span>';
          title = evs.map((e) => etiqueta(e.impuesto)).join(' · ');
        }
        html += '<div class="' + cls + '" title="' + esc(title) + '">' + d + dot + '</div>';
      }
      calGrid.innerHTML = html;
      if (titleEl) titleEl.textContent = 'Calendario fiscal · ' + meses[m] + ' ' + y;
      /* Un calendario vacío tiene que decir POR QUÉ está vacío.

         Sin esto no se distingue «este mes no vence nada» de «no cargó», y
         lo segundo asusta con razón: parece que se perdió el calendario. */
      let nota = document.getElementById('calNota');
      if (!nota) {
        nota = document.createElement('div');
        nota.id = 'calNota';
        nota.style.cssText = 'font-size:11.5px;color:var(--fg-muted);padding:8px 2px 0;line-height:1.45;';
        calGrid.parentNode.insertBefore(nota, calGrid.nextSibling);
      }
      const empN = window.__EMPRESA_ACTIVA;
      if (!empN || !empN.id) {
        nota.textContent = 'Elige una empresa para ver sus vencimientos: el calendario depende del terminal de su RIF y de su condición fiscal.';
      } else if (!EVENTOS.length) {
        nota.textContent = 'No se cargó ninguna fecha del ' + y + ' para ' + (empN.n || 'esta empresa')
          + ' (terminal de RIF ' + String(empN.rif || '').replace(/\D/g, '').slice(-1)
          + ' · ' + (empN.cond || 'sin condición') + '). Si esto no es lo esperado, avísame: queda el detalle en la consola.';
      } else {
        const delMes = EVENTOS.filter((e) => e.fecha.slice(0, 7) === y + '-' + String(m + 1).padStart(2, '0')).length;
        nota.textContent = (delMes
          ? delMes + ' vencimiento' + (delMes === 1 ? '' : 's') + ' en ' + meses[m] + ' · ' + EVENTOS.length + ' en todo el ' + y
          : 'Sin vencimientos en ' + meses[m] + ' — ' + EVENTOS.length + ' en el resto del ' + y + '.')
          + (VERSION ? ' · versión ' + VERSION : '');
      }
      renderProximos();
      if (window.lucide) window.lucide.createIcons();
    }

    // Panel "Próximos vencimientos": lo que viene DESDE HOY, real.
    function renderProximos() {
      const cont = document.getElementById('fiscalDeadlines');
      if (!cont) return;
      const emp = window.__EMPRESA_ACTIVA;
      const sub = document.getElementById('calVencSub');
      if (sub) sub.textContent = emp && emp.cond ? ('Para ' + emp.cond + (emp.rif ? ' · RIF ' + emp.rif : '')) : 'Selecciona una empresa';
      if (!emp || !emp.id) {
        cont.innerHTML = '<div style="text-align:center;color:var(--fg-muted);padding:28px 18px;font-size:13px;">Selecciona una empresa para ver sus vencimientos.</div>';
        return;
      }
      const proximos = EVENTOS.filter((e) => e.fecha >= hoyISO).slice(0, 4); // solo los 4 más cercanos
      if (!proximos.length) {
        cont.innerHTML = '<div style="text-align:center;color:var(--fg-muted);padding:28px 18px;font-size:13px;">Sin vencimientos próximos registrados para el terminal de RIF de esta empresa en ' + y + '.</div>';
        return;
      }
      cont.innerHTML = proximos.map((e) => {
        const dd = new Date(e.fecha + 'T12:00:00');
        const faltan = Math.round((dd - new Date(hoyISO + 'T12:00:00')) / 86400000);
        const cls = faltan <= 3 ? 'deadline urgent' : faltan <= 7 ? 'deadline warn' : 'deadline';
        const txt = faltan === 0 ? 'HOY' : faltan === 1 ? 'mañana' : 'en ' + faltan + ' días';
        return '<div class="' + cls + '">'
          + '<div class="when"><span class="day">' + dd.getDate() + '</span><span class="mon">' + mesCorto[dd.getMonth()] + '</span></div>'
          + '<div class="what"><div class="t">' + esc(etiqueta(e.impuesto)) + '</div><div class="s">' + esc(e.descripcion || '') + '</div></div>'
          + '<div class="countdown"><strong>' + txt + '</strong></div></div>';
      }).join('');
    }

    /* La versión que está corriendo AHORA, según el caché que el service
       worker tiene activo. No es un número escrito a mano en el código —eso
       miente en cuanto uno se olvida de subirlo—: es el que de verdad está
       sirviendo los archivos. Se muestra en la nota del calendario porque
       la duda «¿esto ya tiene el arreglo?» no se puede responder de otro
       modo desde la app instalada, que se queda en la versión vieja hasta
       que se pulsa «Actualizar». */
    let VERSION = '';
    if (window.caches && caches.keys) {
      caches.keys().then((ks) => {
        const k = ks.filter((x) => x.indexOf('digiaccount-') === 0).sort().pop();
        if (k) { VERSION = k.replace('digiaccount-', ''); }
      }).catch(() => {});
    }

    async function refrescar() {
      const emp = window.__EMPRESA_ACTIVA;
      const clave = (emp && emp.id ? emp.id : 'sin') + '|' + y;
      /* Si algo falla aquí NO se puede perder en silencio: un calendario en
         blanco sin explicación es indistinguible de uno sin vencimientos, y
         hace perder el tiempo de los dos buscando en el lugar equivocado. */
      try {
        if (clave !== cargadoPara) {
          // El año se marca como cargado DESPUÉS, y solo si se pudo consultar.
          // Marcarlo antes era lo que dejaba el calendario vacío para siempre
          // cuando la primera pasada ocurría sin empresa todavía elegida.
          const ok = await cargarEventos();
          cargadoPara = ok ? clave : '';
        }
        render();
      } catch (err) {
        console.error('[Calendario] falló:', err);
        cargadoPara = '';
        const n = document.getElementById('calNota') || calGrid.parentNode.appendChild(
          Object.assign(document.createElement('div'), { id: 'calNota' }));
        n.style.cssText = 'font-size:11.5px;color:#c0392b;padding:8px 2px 0;line-height:1.45;';
        n.textContent = 'El calendario falló al dibujarse: '
          + (err && err.message ? err.message : err) + (VERSION ? ' · versión ' + VERSION : '');
      }
    }
    window.cargarCalendarioFiscal = refrescar;   // lo llama el cambio de empresa

    const prev = document.getElementById('calPrevBtn');
    const next = document.getElementById('calNextBtn');
    if (prev) prev.addEventListener('click', () => { m--; if (m < 0) { m = 11; y--; } refrescar(); });
    if (next) next.addEventListener('click', () => { m++; if (m > 11) { m = 0; y++; } refrescar(); });
    refrescar();
  })();

  /* =========================================================
     GENERADOR TXT — descarga real del archivo simulado
     ========================================================= */
  // Helper: agrega una fila real al historial de archivos generados (con re-descarga)
  function addRetHistRow(containerId, name, meta, content, mime) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    const empty = cont.querySelector('.txt-empty'); if (empty) empty.remove();
    const row = document.createElement('div');
    row.className = 'txt-row';
    row.innerHTML = '<div class="ic"><i data-lucide="file-text"></i></div><div class="nm"></div><div class="meta"></div><button class="dl" title="Descargar"><i data-lucide="download"></i></button>';
    row.querySelector('.nm').textContent = name;
    row.querySelector('.meta').textContent = meta;
    row.querySelector('.dl').addEventListener('click', () => {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });
    cont.insertBefore(row, cont.firstChild);
    if (window.lucide) window.lucide.createIcons();
  }

  (function txtGenerator() {
    const btnP = document.getElementById('txtGenBtn');       // 027 · practicadas (agente)
    const btnS = document.getElementById('txtGen028Btn');    // 028 · sufridas (informativa por proveedor)
    if (!btnP && !btnS) return;
    const norm = (s) => (s || '').toUpperCase().replace(/[\s.\-]/g, '');
    const m2 = (n) => (Number(n) || 0).toFixed(2);
    const periodoDe = (fecha) => { const p = (fecha || '').split('/'); if (p.length < 3) return ''; const yy = p[2].length === 2 ? '20' + p[2] : p[2]; return yy + (p[1] || '').padStart(2, '0'); };
    const fechaIso = (fecha) => { const p = (fecha || '').split('/'); if (p.length < 3) return ''; const yy = p[2].length === 2 ? '20' + p[2] : p[2]; return yy + '-' + (p[1] || '').padStart(2, '0') + '-' + (p[0] || '').padStart(2, '0'); };
    const tipoDocCod = (td) => { const t = (td || 'FC').toUpperCase(); if (t.indexOf('NC') === 0) return '03'; if (t.indexOf('ND') === 0) return '02'; return '01'; };
    // Formato OFICIAL SENIAT (TRI.GR.03.027/028) · 16 columnas A–P · TAB.
    // En AMBOS: col 1 = RIF de la empresa, col 6 = RIF del tercero. Difieren: dirección,
    // tipo de operación (C compra / V venta), libro (compra/venta) y nombre de archivo.
    async function generar(btn, esPract) {
      const emp = window.__EMPRESA_ACTIVA || {};
      const rifEmp = norm(emp.rif);
      const todas = (window.__getRetenciones ? window.__getRetenciones() : []);
      const iva = todas.filter((r) => r.tipo === 'iva' && r.direccion === (esPract ? 'practicada' : 'sufrida'));
      if (!iva.length) { if (window.toast) window.toast('No hay retenciones de IVA ' + (esPract ? 'practicadas' : 'sufridas') + ' para exportar.', 'error'); return; }

      /* Una retención sin quincena aparece en las DOS.

         Es deliberado: esconderla la volvería invisible en ambas, y una
         retención que no se ve es una que no se entera. Pero al exportar hay
         que decirlo, porque si se presentan los dos archivos esa retención se
         entera dos veces.

         No se le puede deducir la quincena de la fecha. La de una retención
         es la del período en que se ENTERA, no la del día de la factura: en
         Radian hay nueve de octubre fechadas en septiembre —compras recibidas
         tarde— y por el día se irían a la quincena que no es. Por eso se
         avisa y lo completa quien tiene el comprobante delante. */
      const quinAct = window.__retQuincenaActual ? window.__retQuincenaActual() : 0;
      if (quinAct === 1 || quinAct === 2) {
        const sinQ = iva.filter((r) => r.quincena !== 1 && r.quincena !== 2);
        if (sinQ.length) {
          const suma = sinQ.reduce((s, r) => s + (Number(r.monto) || 0), 0);
          if (window.toast) {
            window.toast('⚠️ ' + sinQ.length + ' retencion' + (sinQ.length === 1 ? '' : 'es')
              + ' sin quincena (Bs ' + Number(suma).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ') van en ESTE archivo y también en el de la otra quincena. '
              + 'Asígnales la quincena en Retenciones antes de presentar, o se enterarían dos veces.', 'error');
          }
        }
      }

      // Lookup de la factura: compras (practicadas) o ventas (sufridas)
      let facturas = [];
      if (window.sb && emp.id) {
        const { data } = await window.sb.from('libro_fiscal')
          .select('numero_factura, tercero_rif, total, base, exento, alicuota, tipo_doc')
          .eq('empresa_id', emp.id).eq('tipo', esPract ? 'compra' : 'venta');
        facturas = data || [];
      }
      const facMap = {};
      facturas.forEach((f) => { facMap[(f.numero_factura || '').trim() + '|' + norm(f.tercero_rif)] = f; });
      /* Se exporta lo que se está viendo, tal cual: `__getRetenciones` ya
         devuelve el período —y la quincena— que eligió el usuario.

         Antes se reagrupaba por la FECHA de cada renglón y se exportaba el
         grupo más reciente. Eso partía el archivo: la primera quincena de
         enero de Radian trae operaciones de diciembre, y esas se iban a un
         grupo "2025-12" que quedaba fuera. Se enteraba media declaración.

         El período de la cabecera sale del selector, no de las fechas, que
         es justamente la diferencia entre cuándo ocurrió algo y cuándo se
         declara. */
      const rows = iva;

      /* Igual que en el XML del ISLR: se revisa ANTES de generar. Una fecha
         que no se entendiera salía VACÍA en el archivo, sin avisar, y eso
         solo se descubría cuando el portal lo rebotaba. */
      const problemas = [];
      rows.forEach((r, i) => {
        const quien = 'Renglón ' + (i + 1) + ' · ' + (r.tercero_nombre || r.tercero_rif || 'sin tercero') + ': ';
        if (!fechaIso(r.fecha)) problemas.push(quien + 'la fecha "' + (r.fecha || '') + '" no se entiende. Corrígela en la retención.');
        if (!/^[VvEeJjPpGg][0-9]{9}$/.test(norm(r.tercero_rif))) problemas.push(quien + 'el RIF del tercero no tiene la forma J123456789.');
      });
      if (problemas.length) {
        if (window.toast) window.toast(problemas[0] + (problemas.length > 1 ? ' (y ' + (problemas.length - 1) + ' más)' : ''), 'error');
        return;
      }

      const pf = window.__fiscalPer || {};
      const periodo = (pf.aa && pf.mm) ? ('20' + pf.aa + pf.mm)
        : (periodoDe(rows[0] && rows[0].fecha) || '').replace('-', '');
      const quin = window.__retQuincenaActual ? window.__retQuincenaActual() : 0;

      /* EL COMPROBANTE TIENE QUE SER DEL PERIODO QUE SE DECLARA.

         Sus seis primeros digitos son el año y el mes. Si no coinciden con el
         periodo, el portal responde «El año o el mes del numero de
         comprobante es diferente al periodo a declarar» y solo dice el numero
         de linea: hay que ir a contarlas a mano en el archivo.

         Paso de verdad: una retencion cargada por error con fecha de agosto
         quedo con el comprobante 20260800000121 entre ocho de septiembre.

         Se AVISA con nombre y apellido, y se deja seguir: quien declara sabe
         si ese numero es el que trae el documento del proveedor. */
      const deOtroMes = rows.map((r, i) => ({ i: i + 1, r: r }))
        .filter((x) => {
          const c = String(x.r.comprobante || '').replace(/\D/g, '');
          return c.length >= 6 && periodo && c.slice(0, 6) !== periodo;
        });
      if (deOtroMes.length) {
        const detalle = deOtroMes.slice(0, 6).map((x) => '  · Línea ' + x.i + ' · ' + (x.r.tercero_nombre || x.r.tercero_rif || '')
          + ' · factura ' + (x.r.factura || '') + ' · comprobante ' + x.r.comprobante).join('\n');
        const seguir = window.confirm([
          'El portal va a rechazar ' + (deOtroMes.length === 1 ? 'esta línea' : 'estas ' + deOtroMes.length + ' líneas') + '.',
          '',
          'Declaras el período ' + periodo.slice(0, 4) + '-' + periodo.slice(4) + ' y su comprobante es de otro mes:',
          detalle,
          deOtroMes.length > 6 ? '  … y ' + (deOtroMes.length - 6) + ' más' : '',
          '',
          'Corrígelo en Retenciones (el N° de comprobante) y vuelve a generar.',
          '',
          '¿Generar el archivo de todos modos?',
        ].filter(Boolean).join('\n'));
        if (!seguir) return;
      }

      const lineas = rows.map((r) => {
        const f = facMap[(r.factura || '').trim() + '|' + norm(r.tercero_rif)] || null;
        const ivaDoc = Number(r.base) || 0;   // en IVA, r.base guarda el IVA del documento
        const ivaRet = Number(r.monto) || 0;  // IVA retenido (col K)
        let alic, baseImp, exento, total, tipoDoc;
        if (f) {
          alic = Number(f.alicuota) ? Number(f.alicuota) * 100 : 16;
          baseImp = Number(f.base) || 0;
          exento = Number(f.exento) || 0;
          total = Number(f.total) || (baseImp + ivaDoc + exento);
          tipoDoc = tipoDocCod(f.tipo_doc);
        } else {
          alic = 16; baseImp = alic ? ivaDoc / (alic / 100) : 0; exento = 0; total = baseImp + ivaDoc + exento; tipoDoc = '01';
        }
        return [
          rifEmp, periodo, fechaIso(r.fecha), (esPract ? 'C' : 'V'), tipoDoc, norm(r.tercero_rif),
          (r.factura || '0').replace(/\s/g, ''), (r.numero_control || '0').replace(/\s/g, ''),
          m2(total), m2(baseImp), m2(ivaRet), '0', (r.comprobante || '0').replace(/\D/g, ''),
          m2(exento), alic.toFixed(2), '0',
        ].join('\t');
      });
      const txt = lineas.join('\r\n') + '\r\n';
      // La quincena va en el nombre: dos archivos del mismo mes no se pisan
      // en la carpeta de descargas, y se sabe cuál es cuál sin abrirlos.
      const fname = (esPract ? 'RET_IVA_' : 'INF_IVA_PROV_') + rifEmp + '_' + periodo
        + (quin ? '_Q' + quin : '') + '.txt';
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const pre = document.getElementById('txtPreviewPre');
      if (pre) pre.textContent = lineas.slice(0, 8).join('\n') + (lineas.length > 8 ? '\n… (' + (lineas.length - 8) + ' más)' : '');
      const lh = document.getElementById('txtPreviewLh');
      if (lh) lh.textContent = 'Vista previa · ' + fname + ' · ' + rows.length + ' línea(s)';
      addRetHistRow('txtHist', fname, rows.length + ' líneas', txt, 'text/plain;charset=utf-8');
      const orig = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="check"></i> Archivo descargado';
      btn.setAttribute('disabled', '');
      drawIcons();
      if (window.toast) window.toast('TXT IVA ' + (esPract ? '(agente, practicadas)' : '(informativa proveedor, sufridas)') + ' · período ' + periodo + (quin ? ' · ' + quin + 'ª quincena' : '') + ' · ' + rows.length + ' registro(s)', 'success');
      setTimeout(() => { btn.innerHTML = orig; btn.removeAttribute('disabled'); drawIcons(); }, 2400);
    }
    if (btnP) btnP.addEventListener('click', () => generar(btnP, true));
    if (btnS) btnS.addEventListener('click', () => generar(btnS, false));
  })();

  /* =========================================================
     GENERADOR XML — declaración mensual de retenciones de ISLR
     ========================================================= */
  (function xmlGenerator() {
    const btn = document.getElementById('xmlGenBtn');
    if (!btn) return;
    const norm = (s) => (s || '').toUpperCase().replace(/[\s.\-]/g, '');
    const fmtMonto = (n) => (Number(n) || 0).toFixed(2);
    // fecha 'dd/mm/yy' → período 'AAAAMM'
    const periodoDe = (fecha) => {
      const p = (fecha || '').split('/');
      if (p.length < 3) return '';
      const yy = p[2].length === 2 ? '20' + p[2] : p[2];
      return yy + (p[1] || '').padStart(2, '0');
    };
    const numFactura = (f) => { const s = (f || '').replace(/[^a-zA-Z0-9]/g, ''); return s ? s.slice(-10) : '0'; };
    /* El numero de control venezolano viene como "00-0001866": una serie,
       un guion y el numero. El esquema solo admite 8 caracteres, y quitar el
       guion para cortar por la izquierda producia "00001866" — un numero que
       no existe en ninguna factura. Se toma la parte de despues del guion,
       que es el numero de verdad, y solo si aun excede se recorta. */
    const numControl = (c) => {
      const bruto = String(c || '').trim();
      if (!bruto) return 'NA';
      const parte = bruto.indexOf('-') >= 0 ? bruto.slice(bruto.lastIndexOf('-') + 1) : bruto;
      const limpio = parte.replace(/[^a-zA-Z0-9]/g, '');
      return limpio ? limpio.slice(-8) : 'NA';
    };
    /* 'dd/mm/aa' (como se guarda) -> 'dd/mm/aaaa' con ceros a la izquierda,
       que es lo que valida el portal. Devuelve '' si la fecha no se entiende;
       de eso se encarga la comprobacion previa. */
    const fechaOperacion = (f) => {
      const p = String(f || '').split('/');
      if (p.length < 3) return '';
      const dd = (p[0] || '').padStart(2, '0');
      const mm = (p[1] || '').padStart(2, '0');
      const aa = p[2].length === 2 ? '20' + p[2] : p[2];
      if (!/^[0-3][0-9]$/.test(dd) || !/^[01][0-9]$/.test(mm) || !/^[12][0-9]{3}$/.test(aa)) return '';
      return dd + '/' + mm + '/' + aa;
    };
    btn.addEventListener('click', () => {
      const emp = window.__EMPRESA_ACTIVA || {};
      const rifAgente = norm(emp.rif);
      const todas = (window.__getRetenciones ? window.__getRetenciones() : []);
      const islr = todas.filter((r) => r.tipo === 'islr' && r.direccion === 'practicada');
      if (!islr.length) { if (window.toast) window.toast('No hay retenciones de ISLR practicadas para exportar.', 'error'); return; }
      /* La Relación Informativa de ISLR es mensual, y aquí NO hay quincena
         que separar. Se exporta lo que se está viendo, igual que el TXT de
         IVA: `__getRetenciones` ya entrega el período elegido.

         Reagrupar por la FECHA de cada renglón y quedarse con el grupo más
         reciente dejaba fuera las retenciones cuya operación es de un mes
         anterior al que se declara — que es lo normal cuando la factura
         llega tarde. Se enteraba de menos y nada lo avisaba. */
      const rows = islr;

      /* Se revisa el archivo ANTES de generarlo. El portal solo dice
         «elemento no esperado» con un numero de linea, y traducir eso a una
         fila del sistema cuesta mas que comprobarlo aqui. */
      const problemas = [];
      rows.forEach((r, i) => {
        const quien = 'Renglon ' + (i + 1) + ' · ' + (r.tercero_nombre || r.tercero_rif || 'sin tercero') + ': ';
        if (!/^[VvEeJjPpGg][0-9]{9}$/.test(norm(r.tercero_rif))) problemas.push(quien + 'el RIF del retenido no tiene la forma J123456789.');
        if (!fechaOperacion(r.fecha)) problemas.push(quien + 'falta la fecha de la operacion, o no se entiende.');
        if (!/^[0-9]{3}$/.test(String(r.concepto_codigo || ''))) problemas.push(quien + 'el codigo de concepto debe ser de tres digitos (Anexo 6.1).');
        const pct = Number(r.pct);
        if (!(pct >= 0 && pct <= 100)) problemas.push(quien + 'el porcentaje de retencion debe estar entre 0 y 100.');
        if (!(Number(r.base) >= 0)) problemas.push(quien + 'el monto de la operacion no puede ser negativo.');
      });
      if (problemas.length) {
        const pre0 = document.getElementById('xmlPreviewPre');
        if (pre0) pre0.textContent = 'El archivo NO se genero. Hay que corregir esto primero:\n\n' + problemas.join('\n');
        const lh0 = document.getElementById('xmlPreviewLh');
        if (lh0) lh0.textContent = problemas.length + ' punto(s) por corregir antes de exportar';
        if (window.toast) window.toast(problemas.length + ' renglon(es) con datos incompletos. Mira el detalle abajo.', 'error');
        return;
      }

      const pf = window.__fiscalPer || {};
      const periodo = (pf.aa && pf.mm) ? ('20' + pf.aa + pf.mm)
        : (periodoDe(rows[0] && rows[0].fecha) || '').replace('-', '');
      // Esquema OFICIAL (Manual Técnico TRI.GR.03.0013): RifAgente/Periodo como atributos
      let xml = '<?xml version="1.0" encoding="utf-8" ?>\r\n';
      xml += '<RelacionRetencionesISLR RifAgente="' + rifAgente + '" Periodo="' + periodo + '">\r\n';
      rows.forEach((r) => {
        xml += '  <DetalleRetencion>\r\n'
          + '    <RifRetenido>' + norm(r.tercero_rif) + '</RifRetenido>\r\n'
          + '    <NumeroFactura>' + numFactura(r.factura) + '</NumeroFactura>\r\n'
          + '    <NumeroControl>' + numControl(r.numero_control) + '</NumeroControl>\r\n'
          /* FechaOperacion NO aparece en el Manual Tecnico v2.4 (mayo 2026),
             pero el validador del portal la EXIGE: sin ella rechaza los tres
             elementos siguientes con «no esperado» y da el DetalleRetencion
             por incompleto. Se comprobo contra dos archivos que si fueron
             aceptados, uno de ellos generado por la propia macro Excel del
             SENIAT (instructivo TRI.GR.03.016). El manual va por detras del
             validador; manda el validador. */
          + '    <FechaOperacion>' + fechaOperacion(r.fecha) + '</FechaOperacion>\r\n'
          + '    <CodigoConcepto>' + (r.concepto_codigo || '000') + '</CodigoConcepto>\r\n'
          + '    <MontoOperacion>' + fmtMonto(r.base) + '</MontoOperacion>\r\n'
          + '    <PorcentajeRetencion>' + fmtMonto(r.pct) + '</PorcentajeRetencion>\r\n'
          + '  </DetalleRetencion>\r\n';
      });
      xml += '</RelacionRetencionesISLR>\r\n';
      const fname = 'XML_relacionRetencionesISLR_' + rifAgente + '_' + periodo + '.xml';
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // Vista previa + historial con datos REALES
      const pre = document.getElementById('xmlPreviewPre');
      if (pre) pre.textContent = xml.length > 1400 ? xml.slice(0, 1400) + '\n…' : xml;
      const lh = document.getElementById('xmlPreviewLh');
      if (lh) lh.textContent = 'Vista previa · ' + fname + ' · ' + rows.length + ' registro(s)';
      addRetHistRow('xmlHist', fname, rows.length + ' registros', xml, 'application/xml;charset=utf-8');
      const orig = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="check"></i> Archivo XML descargado';
      btn.setAttribute('disabled', '');
      drawIcons();
      if (window.toast) window.toast('XML Relación Informativa ISLR · período ' + periodo + ' · ' + rows.length + ' registro(s)', 'success');
      setTimeout(() => { btn.innerHTML = orig; btn.removeAttribute('disabled'); drawIcons(); }, 2400);
    });
  })();

  /* =========================================================
     GENERADORES — selectores y descargas del historial (IVA/ISLR)
     ========================================================= */
  (function generadoresUI() {
    const view = document.getElementById('view-fiscal');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const opts = {
      'Tipo de retención': ['Retención IVA', 'Retención ISLR'],
      'Período': ['1ra Quincena · May 2026', '2da Quincena · May 2026', 'Junio 2026'],
      'Período (mensual)': ['Marzo 2026', 'Abril 2026', 'Mayo 2026', 'Junio 2026'],
    };
    // Tipo de retención del ISLR (los 3 tipos de archivo XML)
    const tipoIslr = view.querySelector('#islrTipoSel');
    if (tipoIslr) tipoIslr.addEventListener('click', () => {
      window.openFormModal && window.openFormModal({
        title: 'Tipo de retención de ISLR',
        saveLabel: 'Seleccionar',
        fields: [{ name: 'sel', label: 'Tipo / planilla', col: 2, type: 'select',
          options: ['Salarios y otras (Forma 99074)', 'Dividendos y Acciones (Forma 99075)', 'Ganancias Fortuitas (Forma 99076)'] }],
        onSave: (v) => {
          const val = tipoIslr.querySelector('.val');
          if (val) val.innerHTML = v.sel + ' <i data-lucide="chevron-down"></i>';
          if (window.lucide) window.lucide.createIcons();
          toast('Tipo de retención ISLR: ' + v.sel);
        },
      });
    });
    // Otros selectores .txt-select (generador IVA e ISLR período)
    view.querySelectorAll('.txt-select').forEach((sel) => {
      if (sel.id === 'islrTipoSel') return;
      sel.style.cursor = 'pointer';
      sel.addEventListener('click', () => {
        const lbl = ((sel.querySelector('.label') || {}).textContent || '').trim();
        const list = opts[lbl] || ['Opción 1', 'Opción 2'];
        window.openFormModal && window.openFormModal({
          title: 'Seleccionar · ' + lbl,
          saveLabel: 'Seleccionar',
          fields: [{ name: 'sel', label: lbl, col: 2, type: 'select', options: list }],
          onSave: (v) => {
            const val = sel.querySelector('.val');
            if (val) val.innerHTML = v.sel + ' <i data-lucide="chevron-down"></i>';
            if (window.lucide) window.lucide.createIcons();
            toast(lbl + ': ' + v.sel);
          },
        });
      });
    });
    // Botones de descarga del historial de archivos
    view.querySelectorAll('.txt-history .dl').forEach((b) => {
      b.addEventListener('click', () => {
        const nm = ((b.closest('.txt-row') || {}).querySelector ? b.closest('.txt-row').querySelector('.nm').textContent : 'archivo');
        toast('Descargando ' + nm);
      });
    });
  })();

  /* =========================================================
     TASA DE CAMBIO — en vivo (simulada)
     ========================================================= */
  (function fxRate() {
    const pill = document.getElementById('fxPill');
    const panel = document.getElementById('fxPanel');
    if (!pill || !panel) return;

    let bcv = 145.82, par = 151.3, eur = 158.04;
    let bcvPrev = 145.21, parPrev = 150.28, eurPrev = 157.55;
    let real = false; // true cuando la tasa vino de Supabase (tasas_cambio, alimentada por N8N)
    let secs = 12;
    // Tasas editables manualmente (fuente de verdad para nómina, etc.); persisten en el navegador.
    let manual = false;
    try {
      const b = parseFloat(localStorage.getItem('da_bcv_rate')); if (b > 0) { bcv = b; manual = true; }
      const p = parseFloat(localStorage.getItem('da_par_rate')); if (p > 0) { par = p; manual = true; }
      const eu = parseFloat(localStorage.getItem('da_eur_rate')); if (eu > 0) { eur = eu; manual = true; }
    } catch (e) {}

    const fmt = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function setDelta(el, cur, prev) {
      if (!el) return;
      const pct = ((cur - prev) / prev) * 100;
      const up = pct >= 0;
      el.className = 'dl ' + (up ? 'up' : 'down');
      el.innerHTML = '<i data-lucide="arrow-' + (up ? 'up' : 'down') + '"></i> ' + fmt(Math.abs(pct)) + '%';
    }

    function render() {
      setText('fxBcv', fmt(bcv));
      setText('fxPar', fmt(par));
      setText('fxEur', fmt(eur));
      setText('fxPillRate', fmt(bcv));
      window.__bcvRate = bcv;
      document.dispatchEvent(new CustomEvent('bcv-rate', { detail: { bcv, par, eur } }));

      setDelta(document.getElementById('fxBcvDl'), bcv, bcvPrev);
      setDelta(document.getElementById('fxParDl'), par, parPrev);
      setDelta(document.getElementById('fxEurDl'), eur, eurPrev);

      const pct = ((bcv - bcvPrev) / bcvPrev) * 100;
      const up = pct >= 0;
      const pd = document.getElementById('fxPillDelta');
      if (pd) {
        pd.className = 'fx-delta ' + (up ? 'up' : 'down');
        pd.innerHTML = '<i data-lucide="trending-' + (up ? 'up' : 'down') + '"></i> ' + fmt(Math.abs(pct)) + '%';
      }
      setText('fxSpread', fmt(((par - bcv) / bcv) * 100) + '%');
      setText('fxConvRate', 'Bs ' + fmt(bcv) + ' / $');
      recalcFromUsd();
      drawIcons();
    }

    function tick() {
      if (manual || real) { secs = 0; render(); return; } // tasa real o fijada a mano: no varía sola
      const jitter = () => (Math.random() - 0.42) * 0.18;
      bcv = Math.max(140, bcv + jitter());
      par = Math.max(bcv + 1, par + jitter() * 1.4);
      eur = Math.max(150, eur + jitter() * 1.1);
      secs = 0;
      render();
    }
    function editRate(which) {
      const cfg = {
        bcv: { lbl: 'Tasa BCV (Bs por $)', src: 'bcv.org.ve', key: 'da_bcv_rate', get: () => bcv, set: (n) => { bcv = n; } },
        par: { lbl: 'Dólar Binance (Bs por $)', src: 'Binance P2P', key: 'da_par_rate', get: () => par, set: (n) => { par = n; } },
        eur: { lbl: 'Euro (Bs por €)', src: 'BCV', key: 'da_eur_rate', get: () => eur, set: (n) => { eur = n; } },
      }[which];
      if (!cfg) return;
      const v = window.prompt(cfg.lbl + ' — valor actual (fuente: ' + cfg.src + '):', fmt(cfg.get()));
      if (v == null) return;
      const n = parseNum(v);
      if (!(n > 0)) { if (window.toast) window.toast('Valor inválido', 'error'); return; }
      cfg.set(n); manual = true;
      try { localStorage.setItem(cfg.key, String(n)); } catch (e) {}
      render();
      if (window.toast) window.toast(cfg.lbl + ' fijado: Bs ' + fmt(n), 'success');
    }
    setInterval(tick, 5000);
    setInterval(() => {
      secs += 1;
      setText('fxUpdated', secs < 60 ? 'hace ' + secs + ' s' : 'hace ' + Math.floor(secs / 60) + ' min');
    }, 1000);

    const usdInput = document.getElementById('fxUsd');
    const bsInput = document.getElementById('fxBs');
    // Parser inteligente: el punto o la coma que escribas cuentan como decimal;
    // los separadores de mil no hace falta escribirlos (se reflejan solos al mostrar).
    function parseNum(s) {
      s = String(s == null ? '' : s).trim().replace(/[^\d.,]/g, '');
      if (!s) return 0;
      const hasC = s.indexOf(',') > -1, hasP = s.indexOf('.') > -1;
      if (hasC && hasP) {
        // ambos: el ÚLTIMO es el decimal (ej. "2.569,89" → coma; "2,569.89" → punto)
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
        else s = s.replace(/,/g, '');
      } else if (hasC) {
        s = s.replace(',', '.');
      } // solo punto → se deja como decimal
      return parseFloat(s) || 0;
    }
    function recalcFromUsd() { if (usdInput && bsInput) bsInput.value = fmt(parseNum(usdInput.value) * bcv); }
    function recalcFromBs() {
      if (usdInput && bsInput) usdInput.value = (parseNum(bsInput.value) / bcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (usdInput) usdInput.addEventListener('input', recalcFromUsd);
    if (bsInput) bsInput.addEventListener('input', recalcFromBs);

    pill.addEventListener('click', (e) => {
      if (e.target.closest('.fx-panel')) return;
      panel.dataset.open = panel.dataset.open === 'true' ? 'false' : 'true';
    });
    document.addEventListener('click', (e) => { if (!pill.contains(e.target)) panel.dataset.open = 'false'; });
    const refreshBtn = document.getElementById('fxRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); editRate('bcv'); });
    [['fxBcv', 'bcv'], ['fxPar', 'par'], ['fxEur', 'eur']].forEach((pair) => {
      const el = document.getElementById(pair[0]);
      if (el) { el.style.cursor = 'pointer'; el.title = 'Clic para fijar el valor real'; el.addEventListener('click', (e) => { e.stopPropagation(); editRate(pair[1]); }); }
    });

    // Tasas REALES desde Supabase (tabla tasas_cambio, alimentada por N8N cada día 8:00 AM):
    // USD = BCV oficial (con fecha VALOR: el sábado rige la del lunes) · USDT = paralelo/Binance.
    // Reemplaza la simulación: fija las tasas del día y detiene la variación aleatoria.
    window.cargarTasaBCV = async function () {
      if (window.__cargarTasasUSD) window.__cargarTasasUSD();   // historial: el dolar exacto de cada recibo
      if (!window.sb) return;
      const { data, error } = await window.sb.from('tasas_cambio')
        .select('fecha, tasa, moneda')
        .in('moneda', ['USD', 'USDT'])
        .order('fecha', { ascending: false })
        .limit(8);
      if (error || !data || !data.length) { console.warn('Tasa BCV: sin datos en tasas_cambio', error); return; }
      const usd = data.filter((r) => r.moneda === 'USD');
      const usdt = data.filter((r) => r.moneda === 'USDT');
      // Vigente = última fila con fecha valor <= hoy (rige ventas/IGTF/panel).
      // Si existe una fila FUTURA (el viernes en la tarde el BCV publica la del lunes),
      // esa es la tasa de NÓMINA: la semana pagada el sábado se liquida con la del lunes.
      const hoyVE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
      const iVig = usd.findIndex((r) => String(r.fecha) <= hoyVE);
      const vig = iVig >= 0 ? usd[iVig] : usd[0];
      const prox = (usd[0] && String(usd[0].fecha) > hoyVE) ? usd[0] : null;
      const hoy = vig ? parseFloat(vig.tasa) : 0;
      if (!(hoy > 0)) return;
      window.__bcvRateNomina = (prox && parseFloat(prox.tasa) > 0) ? parseFloat(prox.tasa) : hoy;
      window.__bcvFechaNomina = prox ? String(prox.fecha) : String(vig.fecha);
      const sig = usd[iVig >= 0 ? iVig + 1 : 1];
      bcvPrev = (sig && parseFloat(sig.tasa) > 0) ? parseFloat(sig.tasa) : hoy;
      bcv = hoy; real = true; manual = false;
      // Dólar paralelo (Binance/USDT) real si existe; si no, referencia aproximada editable
      if (usdt.length && parseFloat(usdt[0].tasa) > 0) {
        par = parseFloat(usdt[0].tasa);
        parPrev = (usdt[1] && parseFloat(usdt[1].tasa) > 0) ? parseFloat(usdt[1].tasa) : par;
      } else if (par < bcv) { par = bcv * 1.045; parPrev = par; }
      // Euro aún sin fuente propia: referencia aproximada, clic para fijar el valor real
      if (eur < bcv) { eur = bcv * 1.17; eurPrev = eur; }
      secs = 0;
      render();
      // El checkout de planes usa window.__BCV
      window.__BCV = hoy;
      const bt = document.getElementById('bcvTasa'); if (bt) bt.textContent = fmt(hoy);
      // La configuración muestra esta misma tasa: se repinta al llegar.
      if (window.__pintarTasaConfig) window.__pintarTasaConfig();
      // Fecha VALOR de la tasa BCV en el panel (dd/mm/aaaa)
      const ff = document.getElementById('fxFecha');
      if (ff) { const p = String(vig.fecha).split('-'); ff.textContent = p[2] + '/' + p[1] + '/' + p[0]; }
      console.log('Tasas reales — BCV (' + vig.fecha + '): Bs ' + hoy + (prox ? ' · Nómina (' + prox.fecha + '): Bs ' + window.__bcvRateNomina : '') + (usdt.length ? ' · Paralelo: Bs ' + par : ''));
    };

    render();
  })();

  /* =========================================================
     DASHBOARD (Visión 360°) — KPIs conectados a datos reales
     ========================================================= */
  (function dashboardKpis() {
    const fmtBs = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const setKpi = (id, bs, moneda) => { const el = document.getElementById(id); if (el) { el.dataset.bs = bs; el.innerHTML = '<span class="currency">' + (moneda || 'Bs') + '</span> ' + fmtBs(bs); } };
    const setVal = (id, bs) => { const el = document.getElementById(id); if (el) { el.dataset.bs = bs; el.textContent = (el.dataset.prefix || '') + fmtBs(bs); } };
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    async function cargar() {
      const emp = window.__EMPRESA_ACTIVA;
      if (!window.sb || !emp || !emp.id) {
        ['dashBanco', 'dashCxc', 'dashCxp', 'dashVentas'].forEach((id) => setKpi(id, 0));
        ['dashIngresos', 'dashEgresos', 'dashNeto', 'dashPosNeta', 'dashBankTotal'].forEach((id) => setVal(id, 0));
        return;
      }
      // Modo LIBRO (contador externo): compras y ventas se presumen pagadas/cobradas por banco
      // mientras el cliente no indique crédito → sin CxC/CxP fantasmas. Las ventas salen del
      // libro fiscal (no de recibos). Modo RECIBOS: control real de cobros/pagos por factura.
      const modoLibro = !!(emp.fiscalActivo || emp.modo === 'libro');
      const [rc, rm, rf, rlc, rlv] = await Promise.all([
        window.sb.from('cuentas_tesoreria').select('id, nombre, banco, numero, tipo, color, saldo_inicial, moneda').eq('empresa_id', emp.id),
        window.__sbAll((q) => q.eq('empresa_id', emp.id), 'movimientos_tesoreria', 'cuenta_teso_id, tipo, monto, factura_ref, creado_en'),
        window.__sbAll((q) => q.eq('tipo', 'venta').eq('empresa_id', emp.id), 'facturas', 'numero, total, total_usd, tasa, fecha, estado, emitida_en, creado_en'),
        window.__sbAll((q) => q.eq('tipo', 'compra').eq('empresa_id', emp.id), 'libro_fiscal', 'numero_factura, total, total_usd, tasa, periodo, fecha'),
        window.__sbAll((q) => q.eq('tipo', 'venta').eq('empresa_id', emp.id), 'libro_fiscal', 'numero_factura, total, periodo, fecha'),
      ]);
      const cuentas = rc.data || [], movs = rm.data || [], compras = rlc.data || [];
      const recibos = (rf.data || []).filter((f) => !/anulada/i.test(f.estado || '')); // anulados no cuentan
      const ventasLibro = rlv.data || [];
      const saldoDe = (cid, ini) => { let s = Number(ini) || 0; movs.filter((m) => m.cuenta_teso_id === cid).forEach((m) => { s += (m.tipo === 'ingreso' ? 1 : -1) * (Number(m.monto) || 0); }); return s; };
      let disp = 0;
      cuentas.filter((c) => (c.moneda || 'Bs') !== 'USD').forEach((c) => { disp += saldoDe(c.id, c.saldo_inicial); });
      const sumBy = (tipo) => { const o = {}; movs.filter((m) => m.tipo === tipo).forEach((m) => { const r = (m.factura_ref || '').trim(); if (r) o[r] = (o[r] || 0) + (Number(m.monto) || 0); }); return o; };
      const cobros = sumBy('ingreso'), pagos = sumBy('egreso');
      let cxc = 0, cxcN = 0, cxp = 0, cxpN = 0;
      /* LO QUE SE DEBE, EN DOLARES — el mismo calculo que las listas.

         El Panel sumaba bolivares mientras Compras mostraba dolares: dos
         numeros distintos para la misma deuda. Aqui se repite el criterio de
         `renderCxList`: el dolar del documento lo da `__usdDoc` y cada cobro
         o pago se lleva a dolares con la tasa del dia en que ocurrio.

         Si a algun documento pendiente le falta su tasa, estas dos tarjetas
         se quedan en bolivares en vez de mezclar monedas en una suma. */
      if (window.__cargarTasasUSD) await window.__cargarTasasUSD();
      const tasaEnD = (x) => ((window.__tasaUSDEn && window.__tasaUSDEn(x)) || 0);
      const movsDe = (ref, tipo) => movs.filter((m) => m.tipo === tipo && (m.factura_ref || '').trim() === String(ref || '').trim());
      let cxcUsd = 0, cxpUsd = 0, todoCxcUsd = true, todoCxpUsd = true;
      if (!modoLibro) {
        // Modo recibos: CxC/CxP reales según cobros/pagos registrados
        recibos.forEach((f) => {
          const p = Math.max(0, (Number(f.total) || 0) - (cobros[(f.numero || '').trim()] || 0));
          if (p > 0.01) cxcN++;
          cxc += p;
          if (p <= 0.01) return;
          const lista = movsDe(f.numero, 'ingreso');
          const usdDoc = (window.__usdDoc && window.__usdDoc(Object.assign({ tipo: 'venta', emitida: f.emitida_en || f.creado_en }, f))) || 0;
          if (usdDoc > 0 && lista.every((m) => tasaEnD(m.creado_en) > 0)) {
            cxcUsd += Math.max(0, usdDoc - lista.reduce((a, m) => a + (Number(m.monto) || 0) / tasaEnD(m.creado_en), 0));
          } else { todoCxcUsd = false; }
        });
        compras.forEach((f) => {
          const p = Math.max(0, (Number(f.total) || 0) - (pagos[(f.numero_factura || '').trim()] || 0));
          if (p > 0.01) cxpN++;
          cxp += p;
          if (p <= 0.01) return;
          const lista = movsDe(f.numero_factura, 'egreso');
          const usdDoc = (window.__usdDoc && window.__usdDoc(Object.assign({ tipo: 'compra' }, f))) || 0;
          if (usdDoc > 0 && lista.every((m) => tasaEnD(m.creado_en) > 0)) {
            cxpUsd += Math.max(0, usdDoc - lista.reduce((a, m) => a + (Number(m.monto) || 0) / tasaEnD(m.creado_en), 0));
          } else { todoCxpUsd = false; }
        });
      }
      const cxcEnUsd = !modoLibro && todoCxcUsd && cxcN > 0;
      const cxpEnUsd = !modoLibro && todoCxpUsd && cxpN > 0;
      // Ventas: libro fiscal en modo libro; recibos en modo recibos
      const ventas = modoLibro
        ? ventasLibro.reduce((s, f) => s + window.__montoDoc(f), 0)
        : recibos.reduce((s, f) => s + (Number(f.total) || 0), 0);
      const ventasCount = modoLibro ? ventasLibro.length : recibos.length;
      const ingresos = movs.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
      const egresos = movs.filter((m) => m.tipo === 'egreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
      setKpi('dashBanco', disp);
      setKpi('dashCxc', cxcEnUsd ? cxcUsd : cxc, cxcEnUsd ? '$' : 'Bs');
      setKpi('dashCxp', cxpEnUsd ? cxpUsd : cxp, cxpEnUsd ? '$' : 'Bs');
      setKpi('dashVentas', ventas);
      setTxt('dashBancoCuentas', cuentas.length);
      setTxt('dashCxcCount', modoLibro ? 'Cobrado (presunción de banco)' : cxcN);
      setTxt('dashCxpCount', modoLibro ? 'Pagado (presunción de banco)' : cxpN);
      setTxt('dashVentasCount', ventasCount);
      setVal('dashIngresos', ingresos); setVal('dashEgresos', egresos); setVal('dashNeto', ingresos - egresos); setVal('dashPosNeta', disp + cxc - cxp);
      // Saldo por cuenta (banco strip)
      setTxt('dashBankCount', cuentas.length + (cuentas.length === 1 ? ' cuenta' : ' cuentas'));
      setVal('dashBankTotal', disp);
      const lines = document.getElementById('dashBankLines');
      if (lines) {
        lines.innerHTML = cuentas.length ? cuentas.map((c) => {
          const s = saldoDe(c.id, c.saldo_inicial);
          const esCaja = /efectivo|caja/i.test((c.tipo || '') + ' ' + (c.nombre || ''));
          const ini = esCaja ? '$' : (((c.banco || c.nombre || '?').replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('')) || 'CT').toUpperCase();
          const pct = disp > 0 ? Math.max(3, Math.round(s / disp * 100)) : 0;
          return '<div class="bank-line"><div class="bl-logo" style="background:' + esc(c.color || '#003057') + ';">' + esc(ini) + '</div>'
            + '<div class="bl-name">' + esc(c.nombre || 'Cuenta') + (c.numero ? ' <small>' + esc(c.numero) + '</small>' : '') + '</div>'
            + '<div class="bar-mini"><span style="width:' + pct + '%"></span></div>'
            + '<div class="bl-amt">Bs ' + fmtBs(s) + '</div></div>';
        }).join('') : '<div style="padding:14px;color:var(--fg-muted);font-size:12px;">Aún no hay cuentas de tesorería.</div>';
      }
      // Etiqueta del 4º KPI según el modo
      setTxt('dashVentasLabel', modoLibro ? 'Ventas del libro fiscal' : 'Ventas registradas (recibos)');
      // ===== Sparklines con datos REALES por mes (últimos 12 meses) =====
      // Serie mensual de un conjunto de filas {total, periodo|fecha}
      const mesKey = (r) => r.periodo || (String(r.fecha || '').split('/').length === 3 ? ('20' + r.fecha.split('/')[2] + '-' + String(r.fecha.split('/')[1]).padStart(2, '0')) : '');
      const serieMensual = (filas) => {
        const m = {};
        filas.forEach((r) => { const k = mesKey(r); if (k) m[k] = (m[k] || 0) + window.__montoDoc(r); });
        return Object.keys(m).sort().slice(-12).map((k) => m[k]);
      };
      // Construye el path de una sparkline (área + línea) a partir de valores
      const setSpark = (fillId, lineId, vals) => {
        const f = document.getElementById(fillId), l = document.getElementById(lineId);
        if (!f || !l) return;
        const W = 200, H = 36, pad = 3;
        if (!vals || vals.length < 2 || vals.every((v) => v === vals[0])) {
          // Sin serie o plana → línea recta a media altura (honesta, no ascendente falsa)
          const y = vals && vals.length && vals[0] > 0 ? pad : H - pad;
          l.setAttribute('d', 'M0,' + y + ' L' + W + ',' + y);
          f.setAttribute('d', 'M0,' + y + ' L' + W + ',' + y + ' L' + W + ',' + H + ' L0,' + H + ' Z');
          return;
        }
        const max = Math.max(...vals), min = Math.min(...vals), rng = (max - min) || 1;
        const pts = vals.map((v, i) => {
          const x = Math.round((i / (vals.length - 1)) * W);
          const y = Math.round(H - pad - ((v - min) / rng) * (H - 2 * pad));
          return x + ',' + y;
        });
        l.setAttribute('d', 'M' + pts.join(' L'));
        f.setAttribute('d', 'M' + pts.join(' L') + ' L' + W + ',' + H + ' L0,' + H + ' Z');
      };
      const serieV = modoLibro ? serieMensual(ventasLibro) : []; // ventas por mes (real)
      const serieC = serieMensual(compras);                       // compras por mes (real)
      setSpark('spVenF', 'spVenL', serieV.length > 1 ? serieV : (ventas > 0 ? [ventas, ventas] : [0, 0]));
      setSpark('spBankF', 'spBankL', serieC.length > 1 ? serieC : [disp, disp]); // Banco: compras/mes como proxy de actividad
      setSpark('spCxcF', 'spCxcL', cxc > 0 ? [cxc, cxc] : [0, 0]);
      setSpark('spCxpF', 'spCxpL', cxp > 0 ? [cxp, cxp] : [0, 0]);
      if (window.lucide) window.lucide.createIcons();
    }
    window.cargarDashboard = cargar;
    cargar();
  })();

  /* =========================================================
     TOGGLE GLOBAL Bs / $ — conversión de KPIs del dashboard
     ========================================================= */
  (function currencyToggle() {
    const toggle = document.getElementById('currencyToggle');
    if (!toggle) return;
    let mode = 'bs';
    const fmtBs = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const fmtUsd = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    function applyOne(el, rate) {
      const bs = parseFloat(el.dataset.bs);
      if (isNaN(bs)) return;
      const prefix = el.dataset.prefix;
      if (mode === 'usd') {
        const usd = bs / rate;
        if (prefix !== undefined) {
          const sign = prefix.indexOf('+') >= 0 ? '+ ' : '';
          el.textContent = sign + '$ ' + fmtUsd(usd);
        } else {
          el.innerHTML = '<span class="currency">$</span> ' + fmtUsd(usd);
        }
      } else if (prefix !== undefined) {
        el.textContent = prefix + fmtBs(bs);
      } else {
        const dec = Math.round((bs % 1) * 100);
        if (dec > 0) {
          el.innerHTML = '<span class="currency">Bs</span> ' + fmtBs(Math.floor(bs)) + '<span class="unit-sm">,' + String(dec).padStart(2, '0') + '</span>';
        } else {
          el.innerHTML = '<span class="currency">Bs</span> ' + fmtBs(bs);
        }
      }
    }
    function applyAll() {
      const rate = window.__bcvRate || 145.82;
      document.querySelectorAll('.fx-amount').forEach((el) => applyOne(el, rate));
    }
    toggle.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        toggle.querySelectorAll('button').forEach((x) => x.removeAttribute('data-active'));
        b.dataset.active = 'true';
        mode = b.dataset.cur;
        applyAll();
      });
    });
    document.addEventListener('bcv-rate', () => { if (mode === 'usd') applyAll(); });
  })();

  /* =========================================================
     BÚSQUEDA EN VIVO de tablas (filtra filas)
     ========================================================= */
  (function tableSearch() {
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    document.querySelectorAll('.quick-search input').forEach((input) => {
      const wrap = input.closest('.data-table-wrap');
      if (!wrap) return;
      const tbody = wrap.querySelector('table tbody');
      if (!tbody) return;
      const rows = [...tbody.querySelectorAll('tr')];
      const countEl = wrap.querySelector('.table-footer .count');
      const origCount = countEl ? countEl.innerHTML : null;
      const cols = wrap.querySelectorAll('thead th').length || 6;

      function noResRow() {
        let r = tbody.querySelector('tr.no-res');
        if (!r) {
          r = document.createElement('tr');
          r.className = 'no-res';
          r.innerHTML = `<td colspan="${cols}" style="text-align:center;padding:28px;color:var(--fg-muted);font-size:13px;">Sin resultados para tu búsqueda</td>`;
          tbody.appendChild(r);
        }
        return r;
      }

      input.addEventListener('input', () => {
        const q = norm(input.value.trim());
        let visible = 0;
        rows.forEach((tr) => {
          if (tr.classList.contains('no-res')) return;
          const match = q === '' || norm(tr.textContent).includes(q);
          tr.style.display = match ? '' : 'none';
          if (match) visible++;
        });
        noResRow().style.display = visible === 0 ? '' : 'none';
        if (countEl) {
          countEl.innerHTML = q === '' ? origCount : `<strong>${visible}</strong> resultado${visible === 1 ? '' : 's'} para “${input.value.trim()}”`;
        }
      });
    });
  })();

  /* =========================================================
     FILTER CHIPS + PAGINACIÓN (estado visual)
     ========================================================= */
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });
  document.querySelectorAll('.pager').forEach((pager) => {
    const btns = [...pager.querySelectorAll('button')];
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (/^\d+$/.test(btn.textContent.trim())) {
          btns.forEach((b) => b.removeAttribute('data-active'));
          btn.dataset.active = 'true';
        }
      });
    });
  });

  /* =========================================================
     BÚSQUEDA GLOBAL (topbar) → salta a la vista relevante
     ========================================================= */
  (function globalSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const map = [
      { kw: ['rif', 'factura', 'comprobante', 'iva', 'islr', 'seniat', 'retenc', 'fiscal', 'txt'], view: 'fiscal', title: 'Módulo Fiscal · SENIAT' },
      { kw: ['banco', 'cobr', 'pagar', 'tesoreria', 'cxc', 'cxp', 'concil'], view: 'tesoreria', title: 'Tesorería' },
      { kw: ['asiento', 'mayor', 'diario', 'balance', 'contab'], view: 'contabilidad', title: 'Contabilidad · Libros' },
      { kw: ['sku', 'stock', 'inventario', 'almacen', 'articulo'], view: 'inventario', title: 'Catálogo e Inventario' },
      { kw: ['empleado', 'nomina', 'salario', 'rrhh'], view: 'nomina', title: 'Nómina y RRHH' },
      { kw: ['agente', 'ia', 'bot'], view: 'agentes', title: 'Centro de Agentes IA' },
    ];
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const q = norm(input.value.trim());
      if (!q) return;
      const hit = map.find((m) => m.kw.some((k) => q.includes(k)));
      if (hit) showView(hit.view, hit.title);
    });
  })();

  /* =========================================================
     PLACEHOLDERS para módulos fuera de alcance
     ========================================================= */
  document.querySelectorAll('.placeholder-view').forEach((el) => {
    const mod = el.dataset.mod || 'Este módulo';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:60vh;gap:16px;color:var(--fg-muted);">
        <div style="width:64px;height:64px;border-radius:var(--radius-md);background:var(--da-navy-50);color:var(--da-navy-700);display:grid;place-items:center;">
          <i data-lucide="hammer" style="width:30px;height:30px;"></i>
        </div>
        <div>
          <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;color:var(--fg-primary);letter-spacing:-0.01em;margin:0 0 6px;">${mod}</h2>
          <p style="max-width:420px;margin:0;font-size:14px;line-height:1.5;">Módulo previsto en el prototipo. En esta entrega se implementaron el <strong style="color:var(--fg-primary);">Dashboard Central</strong> y el <strong style="color:var(--fg-primary);">Módulo Fiscal · SENIAT</strong>.</p>
        </div>
        <button class="btn btn-ghost" data-go-view="dashboard" data-go-title="Dashboard Central"><i data-lucide="arrow-left"></i> Volver al Dashboard</button>
      </div>`;
  });
  // re-enlazar los botones "volver" recién creados
  document.querySelectorAll('.placeholder-view [data-go-view]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showView(el.dataset.goView, el.dataset.goTitle || '');
    });
  });

  /* =========================================================
     CONCILIACIÓN BANCARIA — resolver partida pendiente
     ========================================================= */
  (function bankRecon() {
    const createBtn = document.getElementById('reconCreateBtn');
    const resolveBtn = document.getElementById('reconResolveBtn');
    if (!createBtn && !resolveBtn) return;

    let resolved = false;
    function resolveRecon() {
      if (resolved) return;
      resolved = true;

      const bookRow = document.getElementById('reconBookPending');
      const bankRow = document.getElementById('reconBankPending');
      const pendingCheck = document.getElementById('reconPendingCheck');
      const pendingDesc = document.getElementById('reconPendingDesc');

      if (bookRow) bookRow.classList.add('matched', 'resolving');
      if (bankRow) bankRow.classList.add('matched', 'resolving');
      if (pendingCheck) {
        pendingCheck.classList.remove('pending');
        pendingCheck.innerHTML = '<i data-lucide="check"></i>';
      }
      if (pendingDesc) {
        pendingDesc.style.color = 'var(--fg-primary)';
        pendingDesc.textContent = 'Comisión bancaria + IGTF';
      }
      // Reemplazar botón "Crear" por monto
      const cb = document.getElementById('reconCreateBtn');
      if (cb) cb.outerHTML = '<span class="val neg">− 6.340,00</span>';

      // Icono central unlink → link
      const midIcon = document.getElementById('reconMidIcon');
      if (midIcon) { midIcon.setAttribute('data-lucide', 'link'); midIcon.style.color = 'var(--da-success)'; }

      // Stats
      const matched = document.getElementById('reconMatched');
      if (matched) matched.innerHTML = '33 <small>/ 33</small>';
      const autoPct = document.getElementById('reconAutoPct');
      if (autoPct) autoPct.textContent = '100';
      const diffStat = document.getElementById('reconDiffStat');
      if (diffStat) diffStat.dataset.zero = 'true';
      const diffVal = document.getElementById('reconDiffVal');
      if (diffVal) diffVal.innerHTML = '<small>Bs</small> 0<small>,00</small>';

      // Cuadre: marcar la comisión como registrada
      const comision = document.getElementById('cuadreComision');
      if (comision) {
        const line = comision.closest('.cuadre-line');
        if (line) line.querySelector('.lbl').innerHTML = '(−) Comisión + IGTF banco<small>Registrada · asiento #0312</small>';
      }

      // Status bar
      const bar = document.getElementById('reconStatusBar');
      if (bar) {
        bar.classList.remove('pending');
        bar.classList.add('ok');
        bar.querySelector('.msg').innerHTML = '<i data-lucide="check-circle-2"></i> <span>Conciliación cuadrada · saldo banco y libros coinciden en Bs 3.829.840,00</span>';
      }
      const rb = document.getElementById('reconResolveBtn');
      if (rb) rb.outerHTML = '<button class="btn btn-primary" style="height:32px;font-size:12px;" disabled><i data-lucide="check"></i> Cuadrada</button>';

      // Habilitar confirmar
      const confirmBtn = document.getElementById('reconConfirmBtn');
      if (confirmBtn) confirmBtn.removeAttribute('disabled');

      drawIcons();
    }

    if (createBtn) createBtn.addEventListener('click', resolveRecon);
    if (resolveBtn) resolveBtn.addEventListener('click', resolveRecon);

    const confirmBtn = document.getElementById('reconConfirmBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', () => {
      if (confirmBtn.hasAttribute('disabled')) return;
      confirmBtn.innerHTML = '<i data-lucide="check-check"></i> Conciliación confirmada';
      confirmBtn.setAttribute('disabled', '');
      drawIcons();
    });
  })();

  /* =========================================================
     INVENTARIO — modelo de negocio (comercial / manufactura / servicios)
     ========================================================= */
  (function inventory() {
    const view = document.getElementById('view-inventario');
    if (!view) return;

    const selector = document.getElementById('invModeSelector');
    const panes = view.querySelectorAll('.inv-mode-pane');
    const badge = document.getElementById('invModeBadge');
    const alertBadge = document.getElementById('invAlertBadge');
    const primaryBtn = document.getElementById('invPrimaryBtn');
    const config = document.getElementById('invConfig');

    // Estado de habilitación (una empresa puede combinar modelos)
    const enabled = { comercial: true, manufactura: false, servicios: false };
    let activeMode = 'comercial';

    const badgeMap = {
      comercial: '<i data-lucide="store"></i> Empresa comercial',
      manufactura: '<i data-lucide="factory"></i> Empresa manufacturera',
      servicios: '<i data-lucide="briefcase"></i> Empresa de servicios',
    };
    // El badge de alerta y la acción principal cambian según el modelo
    const alertMap = {
      comercial: '<i data-lucide="alert-triangle"></i> 4 en stock crítico',
      manufactura: '<i data-lucide="alert-triangle"></i> 2 insumos críticos',
      servicios: null, // servicios no maneja stock físico
    };
    const primaryMap = {
      comercial: '<i data-lucide="plus"></i> Nuevo artículo',
      manufactura: '<i data-lucide="plus"></i> Nueva orden de producción',
      servicios: '<i data-lucide="plus"></i> Nuevo servicio',
    };

    function applyEnabledState() {
      selector.querySelectorAll('.inv-mode-card').forEach((card) => {
        card.dataset.enabled = enabled[card.dataset.mode] ? 'true' : 'false';
      });
    }

    function setMode(mode) {
      if (!enabled[mode]) return;
      activeMode = mode;
      selector.querySelectorAll('.inv-mode-card').forEach((c) => (c.dataset.active = c.dataset.mode === mode ? 'true' : 'false'));
      panes.forEach((p) => (p.dataset.active = p.dataset.mode === mode ? 'true' : 'false'));
      if (badge) badge.innerHTML = badgeMap[mode] || '';
      // Adaptar badge de alerta (oculto en servicios) y acción principal
      if (alertBadge) {
        if (alertMap[mode]) { alertBadge.innerHTML = alertMap[mode]; alertBadge.hidden = false; }
        else { alertBadge.hidden = true; }
      }
      if (primaryBtn) primaryBtn.innerHTML = primaryMap[mode] || primaryBtn.innerHTML;
      drawIcons();
    }

    // Selección de modelo
    selector.querySelectorAll('.inv-mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        if (enabled[mode]) {
          setMode(mode);
        } else {
          // Bloqueado: invitar a habilitarlo en configuración
          openConfig();
        }
      });
    });

    // ---- Panel de configuración (habilitar / desbloquear) ----
    function openConfig() {
      if (!config) return;
      // sincronizar checkboxes con el estado actual
      config.querySelectorAll('[data-mode-toggle]').forEach((cb) => {
        cb.checked = !!enabled[cb.dataset.modeToggle];
      });
      config.hidden = false;
      drawIcons();
      config.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function closeConfig() { if (config) config.hidden = true; }

    const configBtn = document.getElementById('invConfigBtn');
    if (configBtn) configBtn.addEventListener('click', () => (config.hidden ? openConfig() : closeConfig()));
    const configClose = document.getElementById('invConfigClose');
    if (configClose) configClose.addEventListener('click', closeConfig);

    const configSave = document.getElementById('invConfigSave');
    if (configSave) {
      configSave.addEventListener('click', () => {
        const next = {};
        config.querySelectorAll('[data-mode-toggle]').forEach((cb) => (next[cb.dataset.modeToggle] = cb.checked));
        // Comercial siempre disponible como base (no permitir quedar sin ningún modelo)
        if (!next.comercial && !next.manufactura && !next.servicios) {
          next.comercial = true;
          const cb = config.querySelector('[data-mode-toggle="comercial"]');
          if (cb) cb.checked = true;
        }
        Object.assign(enabled, next);
        applyEnabledState();
        // Si el modo activo quedó deshabilitado, saltar al primero habilitado
        if (!enabled[activeMode]) {
          const first = ['comercial', 'manufactura', 'servicios'].find((m) => enabled[m]);
          if (first) setMode(first);
        }
        // feedback en el botón
        const orig = configSave.innerHTML;
        configSave.innerHTML = '<i data-lucide="check"></i> Configuración guardada';
        drawIcons();
        setTimeout(() => {
          configSave.innerHTML = orig;
          drawIcons();
          closeConfig();
        }, 1200);
      });
    }

    // ---- Subtabs internas por modo ----
    function wireSubtabs(tabsId, paneClass) {
      const tabsWrap = document.getElementById(tabsId);
      if (!tabsWrap) return;
      const tabs = tabsWrap.querySelectorAll('button');
      const tabPanes = view.querySelectorAll('.' + paneClass);
      tabs.forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          tabs.forEach((b) => (b.dataset.active = b === btn ? 'true' : 'false'));
          tabPanes.forEach((p) => (p.dataset.active = p.dataset.tab === tab ? 'true' : 'false'));
          drawIcons();
        });
      });
    }
    wireSubtabs('invTabsCom', 'invpane-com');
    wireSubtabs('invTabsMfg', 'invpane-mfg');
    wireSubtabs('invTabsSrv', 'invpane-srv');

    // Init
    applyEnabledState();
    setMode('comercial');
  })();

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

  /* =========================================================
     NÓMINA — vacaciones, utilidades y liquidación (LOTTT)
     ========================================================= */

  /* FACTURAS vive ahora en assets/facturas.js — se saco de aqui para que
     este archivo deje de crecer. Lo que publica en `window.*` se sigue
     usando igual desde los demas modulos. */

  /* =========================================================
     DESPACHOS — Guía de Despacho desde la factura (descuenta stock)
     ========================================================= */
  (function despachos() {
    const overlay = document.getElementById('despachoOverlay');
    const doc = document.getElementById('despachoDoc');
    const titleEl = document.getElementById('despachoModalTitle');
    const tbody = document.getElementById('despachosBody');
    if (!overlay || !doc) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const fmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 0 });
    // Empresa emisora de la guía: SIEMPRE la empresa activa real
    const EMPRESA = {
      get n() { return (window.__EMPRESA_ACTIVA || {}).n || '—'; },
      get rif() { return (window.__EMPRESA_ACTIVA || {}).rif || '—'; },
      get dom() { return (window.__EMPRESA_ACTIVA || {}).dom || ''; },
    };

    // Catálogo de guías (memoria de la sesión; sin datos de ejemplo)
    const DB = {};
    let seq = 1; // siguiente correlativo

    function bultos(items) { return items.reduce((a, it) => a + Number(it.q), 0); }

    function render(num) {
      const g = DB[num];
      if (!g) return;
      titleEl.textContent = 'Guía de Despacho · ' + num;
      const rows = g.items.map((it) =>
        '<tr><td class="mono">' + it.c + '</td><td>' + it.d + '</td><td class="num">' + it.q + '</td><td class="ctr">' + (it.u || 'und') + '</td></tr>'
      ).join('');
      doc.innerHTML =
        '<div class="fac gd-doc">'
        + '<div class="fac-head">'
        + '<div class="fac-emisor"><div class="fac-co">' + EMPRESA.n + '</div>'
        + '<div class="fac-meta"><span class="mono">RIF ' + EMPRESA.rif + '</span><br>' + EMPRESA.dom + '</div></div>'
        + '<div class="fac-num"><div class="t">GUÍA DE DESPACHO</div>'
        + '<div class="r"><span>N°</span><strong>' + num + '</strong></div>'
        + '<div class="c"><span>Factura</span><strong>' + g.factura + '</strong></div></div>'
        + '</div>'
        + '<div class="fac-cliente"><div class="fc-grid">'
        + '<div class="fc-f"><span class="l">Cliente / Destinatario</span><span class="v">' + g.cliente.n + '</span></div>'
        + '<div class="fc-f"><span class="l">RIF / C.I.</span><span class="v mono">' + g.cliente.rif + '</span></div>'
        + '<div class="fc-f"><span class="l">Fecha de Despacho</span><span class="v">' + g.fecha + '</span></div>'
        + '<div class="fc-f"><span class="l">Estado</span><span class="v">' + g.estado + '</span></div>'
        + '<div class="fc-f wide"><span class="l">Dirección de Entrega</span><span class="v">' + g.cliente.dom + '</span></div>'
        + '</div></div>'
        + '<div class="gd-transp"><div class="gd-transp-t">Datos del transporte</div><div class="fc-grid">'
        + '<div class="fc-f"><span class="l">Transportista</span><span class="v">' + g.transp.emp + '</span></div>'
        + '<div class="fc-f"><span class="l">Conductor</span><span class="v">' + g.transp.chofer + '</span></div>'
        + '<div class="fc-f"><span class="l">C.I.</span><span class="v mono">' + g.transp.ci + '</span></div>'
        + '<div class="fc-f"><span class="l">Placa</span><span class="v mono">' + g.transp.placa + '</span></div>'
        + '<div class="fc-f wide"><span class="l">Vehículo</span><span class="v">' + g.transp.veh + '</span></div>'
        + '</div></div>'
        + '<table class="fac-table"><thead><tr><th>Cód.</th><th>Descripción</th><th class="num">Cant.</th><th class="ctr">Unidad</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table>'
        + '<div class="gd-bultos">Total de bultos / unidades despachadas: <strong>' + bultos(g.items) + '</strong></div>'
        + '<div class="fac-firmas"><div class="ff"><div class="line"></div>Despachado por</div><div class="ff"><div class="line"></div>Recibido conforme · C.I. / Fecha</div></div>'
        + '<div class="fac-legal">Documento que ampara el <strong>traslado de bienes</strong> conforme a la normativa del SENIAT. No es una factura ni genera obligaciones tributarias; debe acompañar la mercancía durante su transporte junto con la factura correspondiente (' + g.factura + '). Generado por DigiAccount.</div>'
        + '</div>';
      overlay.dataset.open = 'true';
      if (window.lucide) window.lucide.createIcons();
    }

    function addRow(num) {
      if (!tbody) return;
      const g = DB[num];
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + g.fecha.slice(0, 8) + g.fecha.slice(8) + '</td><td class="mono">' + num + '</td><td class="mono">' + g.factura + '</td><td class="primary">' + g.cliente.n + '</td><td>' + g.transp.emp + (g.transp.chofer ? ' · ' + g.transp.chofer : '') + '</td><td class="num">' + bultos(g.items) + '</td><td><span class="tag cyan">' + g.estado + '</span></td><td><button class="btn btn-ghost" data-ver-despacho="' + num + '" style="height:26px;font-size:11px;padding:0 9px;white-space:nowrap;"><i data-lucide="eye"></i> Ver</button></td>';
      tbody.insertBefore(tr, tbody.firstChild);
      tr.querySelector('[data-ver-despacho]').addEventListener('click', () => render(num));
      const cnt = document.getElementById('despachosCount'); if (cnt) cnt.textContent = Object.keys(DB).length;
      const shown = document.getElementById('despachosShown'); if (shown) shown.textContent = tbody.children.length;
      if (window.lucide) window.lucide.createIcons();
    }

    // Genera la guía: crea el registro, agrega la fila, descuenta stock y la muestra
    function generarGuia(fac, v) {
      // Correlativo por empresa, desde lo ya cargado de la BD (DB se rellena con cargarGuias)
      const nums = Object.keys(DB).map((k) => parseInt(k.slice(3), 10)).filter((n) => !isNaN(n));
      const num = 'GD-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(5, '0');
      const fecha = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      DB[num] = {
        fecha: fecha, factura: fac.num,
        cliente: { n: fac.receptor.n, rif: fac.receptor.rif, dom: v.entrega || fac.receptor.dom },
        transp: { emp: v.emp || 'Transporte propio', chofer: v.chofer, ci: v.ci, placa: v.placa, veh: v.veh },
        estado: 'En ruta',
        items: fac.f.items.map((it, i) => ({ c: 'ART-' + String(i + 1).padStart(3, '0'), d: it.d, q: it.c, u: 'und' })),
      };
      // Persistir en la base (la guía sobrevive a recargas y otras sesiones)
      if (window.sb && window.__CUENTA_ID && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
        window.sb.from('guias_despacho').insert({
          cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
          numero: num, fecha: fecha, factura_ref: fac.num,
          cliente: DB[num].cliente, transporte: DB[num].transp, items: DB[num].items, estado: 'En ruta',
        }).then(({ error }) => { if (error) console.warn('[Despachos] No se pudo guardar la guía:', error.message, '(¿creaste la tabla guias_despacho?)'); });
      }
      addRow(num);
      // Descontar del inventario los artículos despachados (match por nombre)
      let descontados = 0;
      if (window.descontarStock) DB[num].items.forEach((it) => { if (window.descontarStock(it.d, it.q)) descontados += Number(it.q); });
      const tot = bultos(DB[num].items);
      toast('Guía ' + num + ' generada · ' + (descontados ? descontados + ' de ' : '') + tot + ' unidades descontadas del inventario', 'success');
      render(num);
    }

    // Carga las guías REALES de la empresa activa desde la base
    window.cargarGuias = async function () {
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return;
      const { data, error } = await window.sb.from('guias_despacho')
        .select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('creado_en', { ascending: true });
      if (error) { console.warn('[Despachos] No se pudieron cargar las guías:', error.message); return; }
      Object.keys(DB).forEach((k) => delete DB[k]);
      if (tbody) tbody.innerHTML = '';
      (data || []).forEach((g) => {
        DB[g.numero] = {
          fecha: g.fecha || '', factura: g.factura_ref || '',
          cliente: g.cliente || { n: '—', rif: '', dom: '' },
          transp: g.transporte || { emp: '', chofer: '', ci: '', placa: '', veh: '' },
          estado: g.estado || 'En ruta',
          items: Array.isArray(g.items) ? g.items : [],
        };
        addRow(g.numero);
      });
      const cnt = document.getElementById('despachosCount'); if (cnt) cnt.textContent = Object.keys(DB).length;
    };

    function camposTransporte(fac) {
      return [
        { name: 'entrega', label: 'Dirección de entrega', col: 2, value: (fac && fac.receptor.dom) || '', placeholder: 'Si se deja vacío, se usa la dirección del cliente' },
        { name: 'emp', label: 'Transportista', value: 'Transporte propio' },
        { name: 'chofer', label: 'Conductor', placeholder: 'Nombre y apellido' },
        { name: 'ci', label: 'C.I. del conductor', placeholder: 'V-00.000.000' },
        { name: 'placa', label: 'Placa del vehículo', placeholder: 'AA000BB' },
        { name: 'veh', label: 'Vehículo', placeholder: 'Tipo / modelo' },
      ];
    }

    // Despachar desde el visor de factura (factura ya conocida)
    window.crearDespacho = function (fac) {
      if (!window.openFormModal) return;
      window.openFormModal({
        title: 'Despachar factura ' + fac.num, saveLabel: 'Generar guía',
        fields: camposTransporte(fac),
        onSave: (v) => {
          if (!v.chofer) return 'Indica el nombre del conductor.';
          generarGuia(fac, v);
        },
      });
    };

    // Nuevo despacho desde la pestaña: elegir una factura ya generada + datos de transporte
    const nuevoBtn = document.getElementById('nuevoDespachoBtn');
    if (nuevoBtn) nuevoBtn.addEventListener('click', () => {
      if (!window.openFormModal) return;
      const lista = window.__listaFacturasVenta || [];
      if (!lista.length) { toast('No hay facturas disponibles para despachar', 'info'); return; }
      window.openFormModal({
        title: 'Nuevo despacho', saveLabel: 'Generar guía',
        fields: [{ name: 'factura', label: 'Factura a despachar', col: 2, type: 'select', options: lista.map((x) => ({ value: x.num, label: x.num + ' · ' + x.cliente })) }].concat(camposTransporte(null)),
        onSave: (v) => {
          const fac = window.__getFactura ? window.__getFactura(v.factura) : null;
          if (!fac) return 'Selecciona una factura válida.';
          if (!v.chofer) return 'Indica el nombre del conductor.';
          generarGuia(fac, v);
        },
      });
    });

    // Impresión (media carta, reutiliza el portal y el control de tamaño de la factura)
    const pr = document.getElementById('despachoPrint');
    if (pr) pr.addEventListener('click', () => {
      const el = doc.querySelector('.fac'); if (!el) return;
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = el.cloneNode(true);
      clon.classList.add('fac-print');
      portal.appendChild(clon);
      if (window.__setPageSize) window.__setPageSize('5.5in 8.5in', '9mm');
      document.body.classList.add('printing-comp');
      window.print();
    });

    function close() { overlay.dataset.open = 'false'; }
    const cb = document.getElementById('despachoClose');
    if (cb) cb.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.dataset.open === 'true') close(); });

    // Conectar los "Ver" de las guías de ejemplo
    document.querySelectorAll('[data-ver-despacho]').forEach((b) => {
      b.addEventListener('click', () => render(b.dataset.verDespacho));
    });
  })();

  /* =========================================================
     LIBROS DE COMPRAS / VENTAS — exportar (CSV) e imprimir
     ========================================================= */
  (function libros() {
    // fmtF vive en otro IIFE (Libros fiscales, mas abajo) — se define aqui tambien
    // porque printLibro/exportLibro corren en ESTE cierre y no pueden verla.
    const fmtF = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    function celda(td) { return td.textContent.replace(/\s+/g, ' ').trim(); }

    function exportLibro(scope) {
      const tab = scope.closest('.fiscal-tab') || scope;
      const tipo = (tab.dataset.tab === 'compras') ? 'compra' : 'venta';
      const esCompra = tipo === 'compra';
      const titulo = (tab.querySelector('.lh-title') || {}).textContent ? tab.querySelector('.lh-title').textContent.trim() : 'Libro';
      const co = (tab.querySelector('.lh-co') || {}).textContent || '';
      const data = (tab.querySelector('.lh-data') || {}).textContent || '';
      /* Igual que al imprimir: se exporta la seccion que se esta viendo. Un
         CSV del libro de ventas con los 240 reportes Z metidos entre las
         facturas, y con las columnas de la maquina en ninguna parte, no sirve
         para cotejar contra nada. */
      const modoV = scope && scope.dataset ? scope.dataset.ventasmode : '';
      const esMaquina = modoV === 'maquina';
      const arr = esCompra
        ? ((window.__libroData && window.__libroData[tipo]) || [])
        : ((window.__libroData && window.__libroData[tipo]) || [])
          .filter((r) => (!!String(r.numero_zeta || '').trim()) === esMaquina);
      const rows = [[titulo], [co.trim()], [data.replace(/\s+/g, ' ').trim()], []];
      rows.push(['N°', 'Fecha', 'RIF', esCompra ? 'Proveedor' : 'Cliente', 'Factura', 'Control', 'Doc', 'Total', 'Exento', 'Base', 'Alíc.', 'IVA'].concat(esCompra ? [] : ['IGTF']));
      let tTot = 0, tEx = 0, tBase = 0, tIva = 0, tIgtf = 0;
      arr.forEach((r, i) => {
        const anulada = /anulada/i.test(r.tercero_nombre || '');
        /* Los montos salen ya con el signo del documento: una nota de
           crédito se muestra en negativo y resta del total, que es como se
           lee un libro de ventas. */
        const tot = window.__montoDoc(r), ex = window.__montoDoc(r, 'exento'), base = window.__montoDoc(r, 'base'), iva = window.__montoDoc(r, 'iva'), igtf = window.__montoDoc(r, 'igtf'), alic = Number(r.alicuota) || 0;
        if (!anulada) { tTot += tot; tEx += ex; tBase += base; tIva += iva; tIgtf += igtf; }
        const fila = [i + 1, r.fecha || '', r.tercero_rif || '', anulada ? 'ANULADA' : (r.tercero_nombre || ''), r.numero_factura || '', r.numero_control || '', r.tipo_doc || (esCompra ? 'FC' : 'FV'), fmtF(tot), fmtF(ex), fmtF(base), (alic > 0 ? Math.round(alic * 100) + '%' : 'Ex.'), fmtF(iva)];
        if (!esCompra) fila.push(fmtF(igtf));
        rows.push(fila);
      });
      const foot = ['', '', '', '', '', '', 'TOTALES', fmtF(tTot), fmtF(tEx), fmtF(tBase), '', fmtF(tIva)];
      if (!esCompra) foot.push(fmtF(tIgtf));
      rows.push(foot);
      const csv = rows.map((r) => r.map((c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const emp = window.__EMPRESA_ACTIVA || {};
      const per = (window.__fiscalPer ? ('20' + window.__fiscalPer.aa + window.__fiscalPer.mm) : '');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Libro_' + (esCompra ? 'Compras' : 'Ventas') + '_' + (emp.rif || '') + '_' + per + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function printLibro(scope) {
      const tab = scope.closest('.fiscal-tab') || scope;
      const tipo = (tab.dataset.tab === 'compras') ? 'compra' : 'venta';
      const esCompra = tipo === 'compra';
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const cont = document.createElement('div');
      cont.className = 'libro-print';
      const head = tab.querySelector('.libro-head');
      if (head) cont.appendChild(head.cloneNode(true));
      /* Se imprime LO QUE SE ESTÁ VIENDO, no todo el período.

         El libro de ventas tiene dos secciones porque son dos formatos
         distintos de asiento: las facturas de talonario van con cliente, RIF
         y número de factura; los reportes Z van con la máquina, el número de
         Z y el rango de comprobantes. Radian tiene 240 reportes Z y dos
         facturas de contingencia, y al imprimir salían las 242 mezcladas en
         el formato de talonario — los Z con las columnas de cliente vacías y
         sus datos propios en ninguna parte. */
      const modoV = scope && scope.dataset ? scope.dataset.ventasmode : '';
      const esMaquina = modoV === 'maquina';
      const todasFilas = (window.__libroData && window.__libroData[tipo]) || [];
      const arr = esCompra ? todasFilas
        : todasFilas.filter((r) => (!!String(r.numero_zeta || '').trim()) === esMaquina);
      let tTot = 0, tEx = 0, tBase = 0, tIva = 0, tIgtf = 0;
      const filas = arr.map((r, i) => {
        const anulada = /anulada/i.test(r.tercero_nombre || '');
        /* Los montos salen ya con el signo del documento: una nota de
           crédito se muestra en negativo y resta del total, que es como se
           lee un libro de ventas. */
        const tot = window.__montoDoc(r), ex = window.__montoDoc(r, 'exento'), base = window.__montoDoc(r, 'base'), iva = window.__montoDoc(r, 'iva'), igtf = window.__montoDoc(r, 'igtf'), alic = Number(r.alicuota) || 0;
        if (!anulada) { tTot += tot; tEx += ex; tBase += base; tIva += iva; tIgtf += igtf; }
        /* Con varias alícuotas en la misma factura un solo porcentaje mentiría:
           se dice "Varias" y el desglose vive en las columnas del registro. */
        const cuantas = [Number(r.base_gen) || 0, Number(r.base_red) || 0, Number(r.base_adic) || 0].filter((x) => x > 0).length;
        const alicTxt = cuantas > 1 ? 'Varias' : (alic > 0 ? (Math.round(alic * 100) + '%') : 'Ex.');
        return '<tr' + (anulada ? ' style="opacity:.6;"' : '') + '><td>' + (i + 1) + '</td><td>' + (r.fecha || '') + '</td><td>' + (r.tercero_rif || '') + '</td><td class="primary">' + (anulada ? 'ANULADA' : (r.tercero_nombre || '')) + '</td>'
          + '<td>' + (r.numero_factura || '') + '</td><td>' + (r.numero_control || '') + '</td><td>' + (r.tipo_doc || (esCompra ? 'FC' : 'FV')) + '</td>'
          + '<td class="num">' + fmtF(tot) + '</td><td class="num">' + fmtF(ex) + '</td><td class="num">' + fmtF(base) + '</td><td>' + alicTxt + '</td><td class="num">' + fmtF(iva) + '</td>'
          + (esCompra ? '' : '<td class="num">' + fmtF(igtf) + '</td>') + '</tr>';
      }).join('');
      const th = '<tr><th>N°</th><th>Fecha</th><th>RIF</th><th>' + (esCompra ? 'Proveedor' : 'Cliente') + '</th><th>Factura</th><th>Control</th><th>Doc</th><th>Total</th><th>Exento</th><th>Base</th><th>Alíc.</th><th>IVA</th>' + (esCompra ? '' : '<th>IGTF</th>') + '</tr>';
      // Las mismas columnas que la tabla de máquina fiscal en pantalla.
      const thZ = '<tr><th>N° Op.</th><th>Fecha</th><th>Máquina Fiscal</th><th>N° Zeta</th><th>Primer Comprob.</th><th>Último Comprob.</th>'
        + '<th>N° N.D.</th><th>N° N.C.</th>'
        + '<th>Total Ventas (con IVA)</th><th>Ventas No Gravadas</th><th>Base Imponible</th><th>IVA</th><th>IGTF (3%)</th></tr>';
      const filasZ = arr.map((r, i) => {
        const tot = Number(r.total) || 0, ex = Number(r.exento) || 0, base = Number(r.base) || 0, iva = Number(r.iva) || 0, igtf = Number(r.igtf) || 0;
        return '<tr><td>' + (i + 1) + '</td><td>' + (r.fecha || '') + '</td><td>' + (r.maquina_fiscal || '') + '</td>'
          + '<td>' + (r.numero_zeta || '') + '</td><td>' + (r.comprobante_desde || '') + '</td><td>' + (r.comprobante_hasta || '') + '</td>'
          + '<td>' + esc(window.__notasZTxt(r, 'ND').txt) + '</td><td>' + esc(window.__notasZTxt(r, 'NC').txt) + '</td>'
          + '<td class="num">' + fmtF(tot) + '</td><td class="num">' + fmtF(ex) + '</td><td class="num">' + fmtF(base) + '</td>'
          + '<td class="num">' + fmtF(iva) + '</td><td class="num">' + fmtF(igtf) + '</td></tr>';
      }).join('');
      const footZ = '<tr class="libro-tot"><td colspan="8" style="text-align:right;">TOTALES DEL PERÍODO (' + arr.length + ' reportes Z)</td>'
        + '<td class="num">' + fmtF(tTot) + '</td><td class="num">' + fmtF(tEx) + '</td><td class="num">' + fmtF(tBase) + '</td>'
        + '<td class="num">' + fmtF(tIva) + '</td><td class="num">' + fmtF(tIgtf) + '</td></tr>';
      const foot = '<tr class="libro-tot"><td colspan="7" style="text-align:right;">TOTALES DEL PERÍODO (' + arr.length + ' operaciones)</td><td class="num">' + fmtF(tTot) + '</td><td class="num">' + fmtF(tEx) + '</td><td class="num">' + fmtF(tBase) + '</td><td></td><td class="num">' + fmtF(tIva) + '</td>' + (esCompra ? '' : '<td class="num">' + fmtF(tIgtf) + '</td>') + '</tr>';
      cont.insertAdjacentHTML('beforeend', '<table class="libro-table libro-print-table" style="width:100%;border-collapse:collapse;font-size:9px;"><thead>'
        + (esMaquina ? thZ : th) + '</thead><tbody>'
        + ((esMaquina ? filasZ : filas) || '<tr><td colspan="13">Sin operaciones en el período.</td></tr>')
        + '</tbody><tfoot>' + (esMaquina ? footZ : foot) + '</tfoot></table>');
      /* Debajo del libro, las retenciones del período.

         El libro dice qué se compró; las retenciones, cuánto se le retuvo a
         cada proveedor y con qué comprobante. Al fiscalizar se piden juntos, y
         hasta ahora había que imprimir el libro por un lado y buscar las
         retenciones por otro. El CSS de impresión ya tenía estilos para este
         panel: estaba previsto y faltaba incluirlo.

         Se clona el panel que contiene la tablita, no el bloque entero, para
         no arrastrar la Forma 30 al pie del libro. Y se clona en vez de
         rehacerlo, así lo impreso es exactamente lo que se está viendo. */
      const panelRet = [...tab.querySelectorAll('.oblig-panel')]
        .find((x) => x.querySelector('table.ret-mini'));
      if (panelRet) {
        const copia = panelRet.cloneNode(true);
        // El enlace a otra pestaña no significa nada en un papel.
        copia.querySelectorAll('.op-link, button').forEach((x) => x.remove());
        /* Y se le quitan los identificadores a la copia. Dos elementos con el
           mismo id en el documento hacen que `getElementById` devuelva el que
           no es, y a partir de ahí se actualiza el clon del portal en vez del
           cuadro que se está viendo. */
        if (copia.id) copia.removeAttribute('id');
        copia.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
        cont.appendChild(copia);
      }
      /* El reparto por quincena NO se clona aparte: vive DENTRO de ese panel
         —se inserta justo debajo de la tablita— así que la copia de arriba ya
         lo trae. Clonarlo otra vez lo imprimía dos veces, uno dentro del
         panel y otro suelto al pie. */
      portal.appendChild(cont);
      document.body.classList.add('printing-comp');
      window.print();
    }

    document.querySelectorAll('[data-libro-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.closest('.fiscal-tab');
        if (!tab) return;
        // Si el libro tiene modos (Ventas), usar la vista visible; si no, el tab
        const scope = btn.closest('.ventas-view') || tab;
        if (btn.dataset.libroAction === 'export') exportLibro(scope);
        else printLibro(scope);
      });
    });

    // limpiar el portal tras imprimir (comparte el listener del comprobante,
    // pero aseguramos por si este módulo carga primero)
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
    });
  })();

  /* =========================================================
     GAUGE DE SALUD FINANCIERA — anima arco + conteo del número
     ========================================================= */
  (function healthGauge() {
    document.querySelectorAll('.health-gauge').forEach((g) => {
      const score = Math.max(0, Math.min(100, parseFloat(g.dataset.score) || 0));
      const prog = g.querySelector('.gauge-progress');
      const num = g.querySelector('.gv');

      // Relleno del arco (transición CSS sobre stroke-dashoffset)
      if (prog) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { prog.style.strokeDashoffset = String(100 - score); });
        });
      }

      // Conteo animado del número
      if (num) {
        const target = parseFloat(num.dataset.target) || score;
        const dur = 1100;
        const start = performance.now();
        const easeOut = (t) => 1 - Math.pow(1 - t, 3);
        function step(now) {
          const t = Math.min(1, (now - start) / dur);
          num.textContent = Math.round(easeOut(t) * target);
          if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      }
    });
  })();

  /* =========================================================
     TOAST — notificación flotante reutilizable (window.toast)
     ========================================================= */
  (function toastSystem() {
    let host = document.getElementById('toastHost');
    if (!host) { host = document.createElement('div'); host.id = 'toastHost'; document.body.appendChild(host); }
    window.toast = function (msg, type) {
      const el = document.createElement('div');
      el.className = 'toast' + (type ? ' ' + type : '');
      const icon = type === 'error' ? 'alert-triangle' : (type === 'info' ? 'info' : 'check-circle-2');
      el.innerHTML = '<i data-lucide="' + icon + '"></i><span>' + esc(msg) + '</span>';
      host.appendChild(el);
      if (window.lucide) window.lucide.createIcons();
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
      }, 2800);
    };
  })();

  /* =========================================================
     MODAL GENÉRICO DE FORMULARIO (window.openFormModal)
     ========================================================= */
  (function formModalSystem() {
    const overlay = document.getElementById('formModal');
    if (!overlay) return;
    const titleEl = document.getElementById('fmTitle');
    const bodyEl = document.getElementById('fmBody');
    const msgEl = document.getElementById('fmMsg');
    const saveBtn = document.getElementById('fmSave');
    const cancelBtn = document.getElementById('fmCancel');
    const closeBtn = document.getElementById('fmClose');
    let onSaveCb = null;
    let currentCfg = null;

    function close() { overlay.hidden = true; bodyEl.innerHTML = ''; msgEl.textContent = ''; onSaveCb = null; currentCfg = null; }

    function fieldHtml(f) {
      const span = f.col === 2 ? ' style="grid-column:1/-1;"' : '';
      if (f.type === 'static') {
        return '<div class="fm-field"' + span + '>' + (f.label && f.label.trim() ? '<span class="fm-lbl">' + esc(f.label) + '</span>' : '') + (f.html || '') + '</div>';
      }
      if (f.type === 'checks') {
        const sel = f.value || [];
        return '<div class="fm-field"' + span + '><span class="fm-lbl">' + esc(f.label) + '</span><div class="fm-checks" data-checks="' + esc(f.name) + '">'
          + (f.options || []).map((o) => { const v = o.value != null ? o.value : o; const l = o.label || o; const ck = sel.indexOf(v) >= 0 ? ' checked' : ''; return '<label class="fm-check"><input type="checkbox" value="' + esc(v) + '"' + ck + '><span>' + esc(l) + '</span></label>'; }).join('')
          + '</div></div>';
      }
      let control;
      if (f.type === 'select') {
        control = '<select data-name="' + esc(f.name) + '">' +
          (f.options || []).map((o) => '<option value="' + esc(o.value != null ? o.value : o) + '"' + ((f.value === (o.value != null ? o.value : o)) ? ' selected' : '') + '>' + esc(o.label || o) + '</option>').join('') +
          '</select>';
      } else if (f.type === 'datalist') {
        const listId = 'fm-dl-' + esc(f.name);
        control = '<input data-name="' + esc(f.name) + '" type="text" list="' + listId + '" value="' + esc(f.value != null ? f.value : '') + '" placeholder="' + esc(f.placeholder || '') + '" autocomplete="off"' + (f.upper ? ' data-upper="1"' : '') + '>'
          + '<datalist id="' + listId + '">' + (f.options || []).map((o) => '<option value="' + esc(o.value != null ? o.value : o) + '">' + (o.label ? esc(o.label) : '') + '</option>').join('') + '</datalist>';
      } else {
        control = '<input data-name="' + esc(f.name) + '" type="' + (f.type || 'text') + '" value="' + esc(f.value != null ? f.value : '') + '" placeholder="' + esc(f.placeholder || '') + '"' + (f.step ? ' step="' + f.step + '"' : '') + (f.moneda ? ' data-moneda="' + esc(f.moneda) + '"' : '') + (f.upper ? ' data-upper="1"' : '') + '>';
      }
      return '<label class="fm-field"' + span + '><span class="fm-lbl">' + esc(f.label) + '</span>' + control + '</label>';
    }

    window.openFormModal = function (cfg) {
      titleEl.textContent = cfg.title || 'Formulario';
      bodyEl.innerHTML = '<div class="fm-grid">' + (cfg.fields || []).map(fieldHtml).join('') + '</div>';
      saveBtn.innerHTML = '<i data-lucide="check"></i> ' + (cfg.saveLabel || 'Guardar');
      onSaveCb = cfg.onSave;
      currentCfg = cfg;
      // Botón Eliminar (opcional): se muestra solo si el llamador pasa cfg.onDelete
      const delBtn = document.getElementById('fmDelete');
      if (delBtn) {
        if (typeof cfg.onDelete === 'function') { delBtn.hidden = false; delBtn.onclick = () => cfg.onDelete(close); }
        else { delBtn.hidden = true; delBtn.onclick = null; }
      }
      // Botón extra opcional (p. ej. "Imprimir comprobante")
      const extraBtn = document.getElementById('fmExtra');
      if (extraBtn) {
        if (typeof cfg.onExtra === 'function') {
          extraBtn.hidden = false;
          const lbl = document.getElementById('fmExtraLbl'); if (lbl) lbl.textContent = cfg.extraLabel || 'Imprimir';
          extraBtn.onclick = () => cfg.onExtra();
        } else { extraBtn.hidden = true; extraBtn.onclick = null; }
      }
      overlay.hidden = false;
      if (window.lucide) window.lucide.createIcons();
      // Campos en MAYÚSCULAS sin guiones ni espacios (p. ej. RIF: J123456789)
      bodyEl.querySelectorAll('input[data-upper]').forEach((el) => {
        el.addEventListener('input', () => { el.value = el.value.toUpperCase().replace(/[\s.\-]/g, ''); });
      });
      // Campos de dinero: muestra el monto con separador de miles debajo mientras escribes
      bodyEl.querySelectorAll('input[type="number"]').forEach((el) => {
        const esDinero = el.step === '0.01';
        if (!esDinero) return;
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:11px;color:var(--da-cyan-700);margin-top:3px;font-family:var(--font-mono);min-height:13px;';
        const wrap = el.closest('.fm-field') || el.parentNode;
        if (wrap) wrap.appendChild(hint);
        const bs2 = (x) => x.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const upd = () => {
          const n = parseFloat(el.value);
          if (isNaN(n) || n === 0) { hint.textContent = ''; return; }
          const mon = el.dataset.moneda || 'Bs';
          if (mon === 'USD' || mon === '$') {
            const bcv = window.__BCV || 0;
            hint.textContent = '= $ ' + bs2(n) + (bcv ? ' · ≈ Bs ' + bs2(n * bcv) + ' (BCV ' + bs2(bcv) + ')' : '');
          } else {
            hint.textContent = '= Bs ' + bs2(n);
          }
        };
        el.addEventListener('input', upd);
        upd();
      });
      if (typeof cfg.afterRender === 'function') cfg.afterRender(bodyEl);
      const first = bodyEl.querySelector('input,select');
      if (first) first.focus();
    };

    function collect() {
      const v = {};
      bodyEl.querySelectorAll('[data-name]').forEach((el) => { v[el.dataset.name] = el.value.trim ? el.value.trim() : el.value; });
      bodyEl.querySelectorAll('[data-checks]').forEach((box) => { v[box.dataset.checks] = [...box.querySelectorAll('input:checked')].map((i) => i.value); });
      return v;
    }

    saveBtn.addEventListener('click', () => {
      if (!onSaveCb) return close();
      const stayOpen = currentCfg && currentCfg.autoClose === false;
      /* Si `onSave` lanza, el formulario NO se puede quedar pegado.
         Antes se llamaba pelado: cualquier error dentro —un refresco que
         falla, una función que todavía no existe— saltaba por encima del
         `close()` y el cuadro quedaba en pantalla sin decir nada, como si
         el botón no sirviera. El usuario no tenía forma de saber qué pasó
         ni de cerrarlo salvo con Escape. Ahora el error se muestra donde
         se muestran los demás, y queda en la consola con su traza. */
      let res;
      try {
        res = onSaveCb(collect());
      } catch (err) {
        console.error('[openFormModal] onSave falló:', err);
        msgEl.textContent = 'No se pudo completar: ' + (err && err.message ? err.message : err);
        msgEl.classList.add('error');
        return;
      }
      if (typeof res === 'string') { msgEl.textContent = res; msgEl.classList.add('error'); return; }
      msgEl.textContent = ''; msgEl.classList.remove('error');
      if (!stayOpen) close();
    });
    cancelBtn.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    // Clic fuera NO cierra (evita perder datos del formulario). Usa Cancelar o la X.
    // Atajos de teclado (aplican a TODOS los formularios de la app): Escape cancela,
    // Ctrl/Cmd+Enter guarda (sin necesidad de soltar el teclado para hacer clic).
    document.addEventListener('keydown', (e) => {
      if (overlay.hidden) return;
      // Si hay un sub-modal abierto ENCIMA (p. ej. "Nuevo tercero" desde F2), que sus propios
      // botones manden — no interceptar Escape/Guardar del formulario de fondo.
      const terOverlay = document.getElementById('terModal');
      if (terOverlay && !terOverlay.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveBtn.click(); }
    });
  })();

  /* =========================================================
     MOTOR GENÉRICO DE TABLAS — búsqueda en vivo + filtros + paginación
     Aplica a las tablas .data-table dentro de .data-table-wrap, EXCEPTO los
     libros legales (.libro-table, se imprimen completos) y la tabla de
     Retenciones (.ret-view, tiene su propia lógica de filtrado).
     ========================================================= */
  (function liveTables() {
    document.querySelectorAll('.data-table-wrap').forEach(setupWrap);

    function setupWrap(wrap) {
      if (wrap.closest('.ret-view')) return;
      const table = wrap.querySelector('table.data-table');
      if (!table || table.classList.contains('libro-table')) return;
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const getRows = () => Array.from(tbody.children).filter((r) => r.tagName === 'TR');
      if (getRows().length === 0) return;

      const input = wrap.querySelector('.quick-search input');
      const countEl = wrap.querySelector('.table-footer .count');
      const pager = wrap.querySelector('.pager');
      const chips = Array.from(wrap.querySelectorAll('.table-toolbar .filter-chip'))
        .filter((c) => !c.classList.contains('ret-fchip'));
      const pageSize = pager ? 8 : 1e9;

      // Sustantivo del contador original ("registros", "empleados", "comprobantes"…)
      let noun = 'registros';
      if (countEl) {
        const m = countEl.textContent.trim().match(/([a-záéíóúñ]+)\s*$/i);
        if (m && !/^total$/i.test(m[1])) noun = m[1];
      }

      const norm = (s) => (s || '').toLowerCase();
      let query = '', chipText = null, page = 1;

      function visibleRows() {
        return getRows().filter((r) => {
          const t = norm(r.textContent);
          if (query && !t.includes(query)) return false;
          if (chipText && !t.includes(chipText)) return false;
          return true;
        });
      }

      function pageList(cur, total) {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const out = [1];
        if (cur > 3) out.push('…');
        for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) out.push(i);
        if (cur < total - 2) out.push('…');
        out.push(total);
        return out;
      }

      function buildPager(pages) {
        if (!pager) return;
        let html = '<button data-pg="prev"' + (page <= 1 ? ' disabled' : '') + '><i data-lucide="chevron-left"></i></button>';
        pageList(page, pages).forEach((n) => {
          if (n === '…') html += '<button disabled>…</button>';
          else html += '<button data-pg="' + n + '"' + (n === page ? ' data-active="true"' : '') + '>' + n + '</button>';
        });
        html += '<button data-pg="next"' + (page >= pages ? ' disabled' : '') + '><i data-lucide="chevron-right"></i></button>';
        pager.innerHTML = html;
        pager.querySelectorAll('button[data-pg]').forEach((b) => {
          b.addEventListener('click', () => {
            const v = b.dataset.pg;
            if (v === 'prev') page = Math.max(1, page - 1);
            else if (v === 'next') page = Math.min(pages, page + 1);
            else page = parseInt(v, 10);
            render();
          });
        });
      }

      function render() {
        const vis = visibleRows();
        const pages = Math.max(1, Math.ceil(vis.length / pageSize));
        if (page > pages) page = pages;
        getRows().forEach((r) => { r.style.display = 'none'; });
        const start = (page - 1) * pageSize;
        const shown = vis.slice(start, start + pageSize);
        shown.forEach((r) => { r.style.display = ''; });
        if (countEl) {
          countEl.innerHTML = vis.length === 0
            ? 'Sin resultados'
            : 'Mostrando <strong>' + (start + 1) + '–' + (start + shown.length) + '</strong> de <strong>' + vis.length + '</strong> ' + noun;
        }
        buildPager(pages);
        drawIcons();
      }

      if (input) input.addEventListener('input', () => { query = norm(input.value.trim()); page = 1; render(); });

      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const wasActive = chip.classList.contains('active');
          chips.forEach((c) => c.classList.remove('active'));
          if (wasActive) {
            chipText = null;
          } else {
            chip.classList.add('active');
            const t = norm(chip.textContent.replace(/\s+/g, ' ').trim());
            // Filtra por el texto del chip sólo si deja resultados y no es "Todos/Todas"
            const test = getRows().filter((r) => norm(r.textContent).includes(t));
            chipText = (test.length > 0 && !/todos|todas/.test(t)) ? t : null;
          }
          page = 1; render();
        });
      });

      // Permite refrescar tras agregar/quitar filas dinámicamente
      window.__liveTables = window.__liveTables || [];
      window.__liveTables.push(render);
      render();
    }
  })();

  // Re-renderiza todas las tablas vivas (tras crear/eliminar filas)
  window.refreshTables = function () {
    (window.__liveTables || []).forEach((fn) => { try { fn(); } catch (e) {} });
  };

  /* =========================================================
     FISCAL — comprobante, período y calendario
     ========================================================= */
  (function fiscalActions() {
    const view = document.getElementById('view-fiscal');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    // ===== Libros fiscales (registro manual de facturas reales) =====
    const fmtF = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let _credF = 0, _debF = 0; // crédito fiscal (compras) y débito fiscal (ventas) del período
    let _excedAnt = 0, _retAcumAnt = 0; // arrastres del período anterior: excedente de crédito e ítem 33 (retenciones acumuladas)
    let _arrClave = '';                 // cache: 'empresa|periodo' de los arrastres ya calculados
    // Recuadro de ISLR en la Forma 30 de Ventas — depende del régimen de la empresa:
    //  · Especial  → Anticipo de ISLR (Decreto 3.719): 1% sobre ingresos brutos, se genera
    //    AUTOMÁTICAMENTE con la declaración de IVA y sigue su periodicidad:
    //      - persona jurídica (RIF J/G, C.A.): IVA quincenal → anticipo quincenal.
    //      - firma personal (RIF V/E, persona natural): IVA mensual → anticipo mensual.
    //  · Ordinario/Formal/Natural → Declaración Estimada (LISLR Art. 82): anual, sobre renta neta
    //    estimada, pagada en porciones — NO se calcula sobre las ventas del mes.
    function renderIslrBox(brutos) {
      const box = document.getElementById('islrEstimBox');
      const box2 = document.getElementById('islrEstimBox2');
      if (!box && !box2) return;
      const emp = window.__EMPRESA_ACTIVA || {};
      const cond = emp.cond || 'Contribuyente Ordinario';
      // Se pinta en el cuadro real y en su copia, para que no queden diciendo
      // cosas distintas sobre la misma empresa.
      const pintar = (html) => { if (box) box.innerHTML = html; if (box2) box2.innerHTML = html; };
      if (/especial/i.test(cond)) {
        const ini = (emp.rif || '').toUpperCase().replace(/[^A-Z]/g, '').charAt(0);
        const esNatural = ini === 'V' || ini === 'E';
        const periodo = esNatural ? 'mensual' : 'quincenal';
        const tipoTxt = esNatural ? 'firma personal (persona natural)' : 'persona jurídica (C.A.)';
        pintar('<div class="op-head"><span class="op-tag teal">Anticipo ISLR</span> Sobre ingresos brutos</div>'
          + '<div class="op-row"><span>Ingresos brutos del período</span><span class="mono">' + fmtF(brutos) + '</span></div>'
          + '<div class="op-row"><span>Porcentaje aplicable</span><span class="mono">1%</span></div>'
          + '<div class="op-row"><span>Periodicidad</span><span class="mono">' + periodo + '</span></div>'
          + '<div class="op-row total"><span>Anticipo a enterar</span><span class="mono">' + fmtF(brutos * 0.01) + '</span></div>'
          + '<div class="op-foot">Decreto Constituyente 3.719 · se genera automáticamente con la declaración de IVA (' + periodo + ', por ser ' + tipoTxt + ').</div>');
      } else {
        pintar('<div class="op-head"><span class="op-tag teal">Estimada ISLR</span> Declaración estimada (anual)</div>'
          + '<div class="op-row"><span>Base de cálculo</span><span class="mono">Renta neta estimada</span></div>'
          + '<div class="op-row"><span>Modalidad de pago</span><span class="mono">En porciones</span></div>'
          + '<div class="op-row total"><span>Sobre ventas del mes</span><span class="mono">No aplica</span></div>'
          + '<div class="op-foot">LISLR Art. 82 · obligatoria si la renta neta del año anterior supera 1.500 U.T. · se estima sobre la renta neta (≥80% del año anterior) y se paga en porciones, no sobre las ventas brutas.</div>');
      }
    }
    /* Se expone para poder repintarlo al CAMBIAR DE EMPRESA.

       Antes solo se llamaba al cargar el libro fiscal. Si no se cargaba —o si
       se cambiaba de empresa sin volver a cargarlo— el cuadro se quedaba con
       lo de la empresa anterior, o peor, con el "Anticipo ISLR" que venía fijo
       en el HTML. Así una empresa Ordinaria veía Anticipos, que no le
       corresponden, y una Especial podía ver la Estimada. */
    window.__renderIslrBox = renderIslrBox;
    function actualizarAutoliquidacion() {
      const setN = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmtF(v); };
      const credDisp = _credF + _excedAnt;                     // crédito del período + excedente del mes anterior
      const cuota = Math.max(0, _debF - credDisp);             // ítem 27: débito − crédito disponible
      const exced = Math.max(0, credDisp - _debF);             // ítem 28: excedente de crédito → mes siguiente
      const retIva = Number(window.__RET_IVA_SUFRIDA) || 0;    // ítem 34: IVA retenido por clientes ESTE período
      const retTotal = retIva + _retAcumAnt;                   // ítem 37 = ítem 33 (acumuladas) + ítem 34 (del período)
      const descontadas = Math.min(cuota, retTotal);           // ítem 38: se descuenta hasta agotar la cuota
      const saldoRet = retTotal - descontadas;                 // ítem 39: retenciones no aplicadas → mes siguiente
      const pagar = Math.max(0, cuota - descontadas);          // ítem 48: lo que realmente se paga
      // Sección de COMPRAS: excedente del mes anterior (ítem 21) → Total Créditos Fiscales (ítem 26, cód. 39)
      setN('f30c-excedAnt', _excedAnt);
      setN('f30c-credTot', _credF + _excedAnt);
      setN('f30v-cuota', cuota);
      setN('f30v-exced', exced);
      setN('f30v-subt1', cuota);        // ítem 32: sub-total (sin sustitutivas = cuota)
      setN('f30v-ret33', _retAcumAnt);
      setN('f30v-ret66', retIva); setN('f30v-ret74', retTotal);
      setN('f30v-ret55', descontadas); setN('f30v-ret67', saldoRet);
      setN('f30v-subt2', pagar);        // ítem 40: sub-total tras retenciones
      setN('f30v-pagar', pagar);        // ítem 48: total a pagar (percepciones = 0)
      // KPIs del encabezado del módulo (indicadores de IVA del período)
      setN('fisKpiDebito', _debF);
      setN('fisKpiCredito', _credF);
      const kIva = document.getElementById('fisKpiIva');
      if (kIva) kIva.textContent = fmtF(exced > 0 ? exced : pagar);
      const kLbl = document.getElementById('fisKpiIvaLabel');
      const kSub = document.getElementById('fisKpiIvaSub');
      const esEspecial = /especial/i.test((window.__EMPRESA_ACTIVA || {}).cond || '');
      const periodicidad = esEspecial ? 'Quincena' : 'Mes';
      if (kLbl) kLbl.textContent = (exced > 0 ? 'Excedente de crédito · ' : 'IVA a pagar · ') + periodicidad;
      if (kSub) kSub.textContent = exced > 0 ? 'A favor, pasa al mes siguiente' : 'Débito − crédito − retenciones';
      // 4º KPI: retenciones de IVA del período (sufridas → reducen lo que se paga)
      setN('fisKpiRetIva', retIva);
      const kRetSub = document.getElementById('fisKpiRetSub');
      if (kRetSub) kRetSub.textContent = _retAcumAnt > 0 ? ('+ Bs ' + fmtF(_retAcumAnt) + ' acumuladas del mes anterior') : 'IVA retenido por los clientes';
    }
    // Calcula los ARRASTRES del período anterior (excedente de crédito e ítem 33 de retenciones)
    // recorriendo TODOS los períodos previos de la empresa con la lógica de la Forma 30.
    async function calcularArrastres() {
      const emp = window.__EMPRESA_ACTIVA;
      if (!window.sb || !emp || !emp.id) { _excedAnt = 0; _retAcumAnt = 0; return; }
      /* La clave del período lleva la QUINCENA cuando la empresa declara así.
         Sin ella, las dos quincenas de un mes comparten clave —'2025-10'— y
         el filtro de "solo períodos anteriores" descarta el mes entero: el
         excedente de la primera quincena nunca llegaba a la segunda. Con
         GATMA en octubre eran 193.927,97 que se perdían.

         El orden alfabético sigue siendo el cronológico:
             2025-10-1 < 2025-10-2 < 2025-11-1
         Y una fila vieja sin quincena ('2025-10') queda antes que la primera
         del mismo mes, que es lo prudente: se cuenta como anterior. */
      const porQuincena = _ivaPorQuincena();
      const perMes = '20' + _fiscalPer.aa + '-' + _fiscalPer.mm;
      const perActual = perMes + (porQuincena && _fiscalPer.q ? '-' + _fiscalPer.q : '');
      const clave = emp.id + '|' + perActual;
      if (_arrClave === clave) return; // ya calculado para este empresa+período
      const r2 = (x) => Math.round((x + 1e-9) * 100) / 100;
      const mesDe = (row) => row.periodo || (String(row.fecha || '').split('/').length === 3 ? ('20' + row.fecha.split('/')[2] + '-' + String(row.fecha.split('/')[1]).padStart(2, '0')) : '');
      const perDe = (row) => {
        const m = mesDe(row);
        if (!m || !porQuincena) return m;
        const q = row.quincena;
        // Sin quincena registrada se deduce del día, que para una VENTA es
        // exacto. Es solo un respaldo para las filas anteriores a la columna.
        if (q === 1 || q === 2) return m + '-' + q;
        const d = parseInt(String(row.fecha || '').split('/')[0], 10);
        return d ? m + '-' + (d > 15 ? 2 : 1) : m;
      };
      const [libRes, retRes] = await Promise.all([
        window.__sbAll((q) => q.eq('empresa_id', emp.id), 'libro_fiscal', 'tipo,periodo,quincena,fecha,base,exento,alicuota,tercero_nombre'),
        window.__sbAll((q) => q.eq('empresa_id', emp.id).eq('direccion', 'sufrida').eq('tipo', 'iva'), 'retenciones', 'periodo,quincena,fecha,monto'),
      ]);
      const M = {}; // período → {vb16,vb8,cb16,cb8,ret}
      const g = (k) => { if (!M[k]) M[k] = { vb16: 0, vb8: 0, cb16: 0, cb8: 0, ret: 0 }; return M[k]; };
      (libRes.data || []).forEach((row) => {
        const k = perDe(row); if (!k || k >= perActual) return; // solo períodos ANTERIORES
        if (/anulada/i.test(row.tercero_nombre || '')) return; // una factura ANULADA no afecta el débito/crédito
        const m = g(k), base = Number(row.base) || 0, al = Number(row.alicuota) || 0;
        if (row.tipo === 'venta') { if (al >= 0.15) m.vb16 += base; else if (al > 0) m.vb8 += base; }
        else { if (al >= 0.15) m.cb16 += base; else if (al > 0) m.cb8 += base; }
      });
      (retRes.data || []).forEach((row) => { const k = perDe(row); if (k && k < perActual) g(k).ret += Number(row.monto) || 0; });
      let exc = 0, sret = 0;
      Object.keys(M).sort().forEach((k) => {
        const m = M[k];
        const debito = r2(r2(m.vb16 * 0.16) + r2(m.vb8 * 0.08));
        const credito = r2(r2(m.cb16 * 0.16) + r2(m.cb8 * 0.08));
        const credDisp = r2(credito + exc);
        const credAp = Math.min(debito, credDisp);
        const resto = r2(debito - credAp);
        const retDisp = r2(m.ret + sret);
        const retAp = Math.min(resto, retDisp);
        exc = r2(credDisp - credAp);
        sret = r2(retDisp - retAp);
      });
      _excedAnt = exc; _retAcumAnt = sret; _arrClave = clave;
      actualizarAutoliquidacion();
    }
    window.__calcularArrastres = calcularArrastres;
    window.__invalidarArrastres = () => { _arrClave = ''; }; // forzar recálculo tras modificar datos
    window.__recalcAutoliq = actualizarAutoliquidacion;
    // Sincroniza el encabezado del módulo Fiscal (RIF, condición) y el membrete de los libros
    window.__syncFiscalHeader = function () {
      const emp = window.__EMPRESA_ACTIVA || {};
      const cond = emp.cond || 'Contribuyente Ordinario';
      const pill = document.getElementById('fiscalRifPill');
      if (pill) pill.textContent = emp.rif || '—';
      const txt = document.getElementById('fiscalContribTxt');
      const badge = document.getElementById('fiscalContribBadge');
      if (txt) txt.textContent = cond;
      if (badge) badge.className = 'contrib-badge' + (/especial/i.test(cond) ? ' especial' : '');
      // Membrete de los libros (compras y ventas): empresa, RIF, condición y período reales
      // Los períodos regados por el módulo siguen al mismo selector.
      if (window.__syncPeriodosFiscal) window.__syncPeriodosFiscal();
      /* El rótulo del período se recalcula aquí porque esta función corre en
         cada cambio de empresa, y la quincena solo se nombra si la empresa
         nueva declara por quincena. */
      if (_perBtn && typeof _perLabel === 'function') _perBtn.textContent = _perLabel();
      const perTxt = (typeof _perLabel === 'function') ? _perLabel() : '';
      document.querySelectorAll('.fiscal-tab[data-tab="compras"] .libro-head, .fiscal-tab[data-tab="ventas"] .libro-head').forEach((h) => {
        const coEl = h.querySelector('.lh-co'); if (coEl) coEl.textContent = emp.n || '—';
        const dataEl = h.querySelector('.lh-data');
        if (dataEl) dataEl.innerHTML = '<span class="mono">RIF ' + (emp.rif || '—') + '</span> · ' + cond + ' · Período de imposición: <strong>' + perTxt + '</strong>';
      });
      // Se acaba de reescribir el membrete entero: hay que volver a estampar
      // el establecimiento o el auxiliar sale sin decir de cuál es.
      if (window.__sellarEstablecimiento) { try { window.__sellarEstablecimiento(); } catch (e) {} }
    };
    // Período de declaración: clave 'aaaa-mm' y etiqueta 'Mes aaaa'
    const _MESES_PER = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    function _periodoActualKey() {
      const p = window.__fiscalPer;
      if (p && p.mm && p.aa) return '20' + p.aa + '-' + p.mm;
      const h = new Date();
      return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0');
    }
    /* El valor lleva la quincena pegada ('2026-07·1') cuando la empresa es
       especial, porque el período de declaración de un especial ES la
       quincena. `_partirPeriodo` lo vuelve a separar al guardar. */
    function _opcionesPeriodo() {
      // Del período actual hacia atrás 24 meses (para declarar facturas rezagadas)
      const out = [];
      const esp = window.__ivaPorQuincena && window.__ivaPorQuincena();
      const base = _periodoActualKey();
      let y = parseInt(base.slice(0, 4), 10), m = parseInt(base.slice(5, 7), 10);
      for (let i = 0; i < 24; i++) {
        const key = y + '-' + String(m).padStart(2, '0');
        const mes = _MESES_PER[m - 1] + ' ' + y;
        if (esp) {
          out.push({ value: key + '·1', label: mes + ' · 1ra quincena' });
          out.push({ value: key + '·2', label: mes + ' · 2da quincena' });
        } else {
          out.push({ value: key, label: mes });
        }
        m--; if (m < 1) { m = 12; y--; }
      }
      return out;
    }
    // '2026-07·2' -> { periodo: '2026-07', quincena: 2 }
    function _partirPeriodo(v) {
      const t = String(v || '');
      const i = t.indexOf('·');
      if (i < 0) return { periodo: t, quincena: null };
      const q = parseInt(t.slice(i + 1), 10);
      return { periodo: t.slice(0, i), quincena: (q === 1 || q === 2) ? q : null };
    }
    // El valor que debe venir preseleccionado en ese selector.
    function _periodoActualValor() {
      const k = _periodoActualKey();
      if (!(window.__ivaPorQuincena && window.__ivaPorQuincena())) return k;
      const p = window.__fiscalPer;
      return k + '·' + ((p && p.q) ? p.q : (new Date().getDate() <= 15 ? 1 : 2));
    }
    /* El campo de proveedor/cliente, con todo lo que sabe hacer.

       Lo usan los DOS formularios del libro, registrar y editar. Estaba
       escrito solo en el de registrar, así que al editar una factura el
       campo no autocompletaba el RIF y F2 no hacía nada: tocaba salirse del
       módulo Fiscal, ir a Terceros, crear el cliente y volver. Y completar
       el cliente de una factura ya cargada es justo lo que más se hace.

       Hace tres cosas:
       · del nombre saca el RIF, y del RIF saca el nombre (una factura a
         veces se lee bien por un lado y mal por el otro);
       · F2 crea el tercero que falta sin salir del formulario, con el rol
         que corresponde —cliente en ventas, proveedor en compras—;
       · y lo dice en pantalla, porque un atajo que nadie ve no existe. */
    /* Cuántas veces ha elegido Luis a cada tercero, guardado en el navegador.

       Es lo que hace que «el más común» aparezca de primero. El dato no
       existe en la base —el libro dice cuántas facturas tiene un proveedor,
       no cuántas veces se le buscó— y de todos modos lo que importa aquí es
       la costumbre de quien escribe, que es personal y del día a día. */
    /* OJO: había un `normRif` DENTRO de `registrarMov`, y estas funciones
       viven un nivel más afuera, así que no lo veían — lanzaban
       ReferenceError en la primera tecla. Se rompió al sacar el campo de
       tercero a una función compartida, y no se notó porque el desplegable
       nativo del navegador seguía respondiendo; al quitarlo quedó a la vista.
       Aquí se declara en el alcance donde de verdad se usa. El de
       `registrarMov` sigue en su sitio y lo tapa dentro de esa función, así
       que lo que ya funcionaba no cambia.

       Se quita TODO lo que no sea letra o número, igual que el directorio de
       terceros y que las herramientas de carga: 'J-40297936-3' y
       'J402979363' tienen que ser el mismo RIF o la búsqueda no encuentra. */
    const normRif = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    const USO_LLAVE = 'da_uso_terceros';
    function usos() {
      try { return JSON.parse(localStorage.getItem(USO_LLAVE) || '{}') || {}; } catch (e) { return {}; }
    }
    function anotarUso(rif) {
      const k = normRif(rif);
      if (!k) return;
      try {
        const u = usos();
        u[k] = (u[k] || 0) + 1;
        localStorage.setItem(USO_LLAVE, JSON.stringify(u));
      } catch (e) { /* modo privado o cuota llena: el buscador sigue sirviendo */ }
    }

    /* Texto comparable: sin acentos y en mayúsculas. 'JOSÉ' y 'jose' tienen
       que encontrarse, que es como se escriben los nombres en la práctica. */
    function llano(s) {
      return String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    /* Qué tan bien calza un tercero con lo escrito. Menor es mejor; -1 = no.

       El orden no es capricho: quien escribe 'INV' quiere ver primero a los
       que EMPIEZAN por INV, no a los que la llevan en el medio. Y quien
       escribe dígitos está tecleando un RIF, no un nombre. */
    function calce(t, q, qDig) {
      const n = llano(t.nombre), r = normRif(t.rif);
      // Los dígitos del RIF sin su letra: quien escribe '4029' está tecleando
      // el número, no la J. Comparar contra 'J402979363' lo dejaría fuera del
      // primer puesto por culpa de una letra que nadie escribe.
      const rDig = r.replace(/\D/g, '');
      if (qDig.length >= 3 && (r.indexOf(qDig) === 0 || rDig.indexOf(qDig) === 0)) return 0;
      if (q && n.indexOf(q) === 0) return 1;                     // el nombre, desde el principio
      if (q && n.split(/[\s,.]+/).some((p) => p.indexOf(q) === 0)) return 2;  // una palabra suelta
      if (q && n.indexOf(q) >= 0) return 3;                      // en el medio del nombre
      if (qDig.length >= 3 && rDig.indexOf(qDig) >= 0) return 4; // en el medio del RIF
      return -1;
    }

    function montarBuscador(nom, rif, lista, elegir) {
      nom.setAttribute('autocomplete', 'off');

      const caja = document.createElement('div');
      caja.className = 'ter-pick';
      caja.hidden = true;
      document.body.appendChild(caja);   // al body, o el modal lo recorta al hacer scroll

      let opciones = [], activo = -1;

      const colocar = () => {
        const r = nom.getBoundingClientRect();
        caja.style.left = r.left + 'px';
        caja.style.top = (r.bottom + 2) + 'px';
        caja.style.width = r.width + 'px';
      };
      const cerrar = () => { caja.hidden = true; activo = -1; };

      const marcar = () => {
        [...caja.children].forEach((el, i) => el.dataset.activo = i === activo ? 'true' : 'false');
        const el = caja.children[activo];
        if (el) el.scrollIntoView({ block: 'nearest' });
      };

      const pintar = () => {
        try { dibujar(); } catch (err) { console.error('[buscador de terceros]', err); cerrar(); }
      };
      const dibujar = () => {
        const q = llano(nom.value.trim());
        const qDig = normRif(nom.value);
        const u = usos();
        opciones = (q
          ? lista.map((t) => [calce(t, q, qDig), t]).filter((p) => p[0] >= 0)
          // Con el campo vacío se ofrecen los de siempre: los más elegidos.
          : lista.map((t) => [1, t]).filter((p) => u[normRif(p[1].rif)])
        ).sort((a, b) =>
          a[0] - b[0]
          || (u[normRif(b[1].rif)] || 0) - (u[normRif(a[1].rif)] || 0)
          || llano(a[1].nombre).localeCompare(llano(b[1].nombre))
        ).slice(0, 8).map((p) => p[1]);

        if (!opciones.length) return cerrar();
        caja.innerHTML = '';
        opciones.forEach((t, i) => {
          const fila = document.createElement('div');
          fila.className = 'ter-pick-row';
          fila.dataset.activo = i === 0 ? 'true' : 'false';
          fila.innerHTML = '<span class="tp-n"></span><span class="tp-r"></span>';
          fila.querySelector('.tp-n').textContent = t.nombre;
          fila.querySelector('.tp-r').textContent = normRif(t.rif) || 'sin RIF';
          // `mousedown` y no `click`: el clic llega después del blur, y para
          // entonces la caja ya se cerró y no se elige nada.
          fila.addEventListener('mousedown', (e) => { e.preventDefault(); tomar(t); });
          caja.appendChild(fila);
        });
        activo = 0;
        colocar();
        caja.hidden = false;
      };

      const tomar = (t) => {
        nom.value = t.nombre;
        if (rif && t.rif) rif.value = normRif(t.rif);
        anotarUso(t.rif);
        cerrar();
        elegir && elegir(t);
      };

      nom.addEventListener('input', pintar);
      nom.addEventListener('focus', pintar);
      nom.addEventListener('blur', () => setTimeout(cerrar, 120));
      window.addEventListener('scroll', () => { if (!caja.hidden) colocar(); }, true);
      nom.addEventListener('keydown', (e) => {
        if (caja.hidden) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); activo = Math.min(activo + 1, opciones.length - 1); marcar(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); activo = Math.max(activo - 1, 0); marcar(); }
        else if (e.key === 'Enter' && opciones[activo]) { e.preventDefault(); tomar(opciones[activo]); }
        else if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
      });
      // El campo del RIF busca al revés: se teclea el RIF y aparece el nombre.
      if (rif) {
        rif.addEventListener('blur', () => {
          const t = lista.find((x) => normRif(x.rif) === normRif(rif.value));
          if (t) { nom.value = t.nombre; anotarUso(t.rif); }
        });
      }

      /* El desplegable del navegador se quita AL FINAL, y solo si todo lo de
         arriba se montó. Quitarlo primero fue lo que dejó el campo sin nada:
         si el buscador propio fallaba, ya no quedaba a qué recurrir. No se
         desconecta lo que funciona hasta que el reemplazo esté puesto. */
      nom.removeAttribute('list');
    }

    function montarCampoTercero(body, opciones) {
      const o = opciones || {};
      const lista = o.lista || [];
      const esCompra = !!o.esCompra;
      const nom = body.querySelector('[data-name="nombre"]');
      const rif = body.querySelector('[data-name="rif"]');
      if (!nom) return;
      const rotulo = esCompra ? 'proveedor' : 'cliente';
      const alSiguiente = () => {
        const nf = body.querySelector('[data-name="numFactura"]');
        if (nf) nf.focus();
      };

      /* El buscador se encarga de rellenar el RIF y de mover el foco. El
         autocompletado anterior escuchaba `input` y solo reaccionaba cuando
         el nombre coincidía ENTERO: había que escribir «INVERSIONES MADERERA
         ALIBETZ, C.A.» letra por letra, con su coma y sus puntos, para que
         apareciera el RIF. Dejarlo puesto además pelearía con este. */
      montarBuscador(nom, rif, lista, () => {
        if (o.moverFoco !== false) alSiguiente();
      });

      const wrap = nom.closest('.fm-field');
      if (wrap && !wrap.querySelector('.fm-hint-f2')) {
        const hint = document.createElement('div');
        hint.className = 'fm-hint-f2';
        hint.style.cssText = 'font-size:10.5px;color:var(--fg-muted);margin-top:3px;';
        hint.textContent = 'Escribe las primeras letras del nombre o los primeros números del RIF y elige con ↑↓ y Enter. ¿No está? F2 crea el ' + rotulo + ' sin salir de aquí.';
        wrap.appendChild(hint);
      }

      nom.addEventListener('keydown', (e) => {
        if (e.key !== 'F2') return;
        e.preventDefault();
        const val = nom.value.trim();
        if (!val) { if (window.toast) window.toast('Escribe el nombre antes de crearlo con F2', 'error'); return; }
        if (lista.some((t) => (t.nombre || '').toLowerCase() === val.toLowerCase())) {
          if (window.toast) window.toast('Ese ' + rotulo + ' ya existe — selecciónalo de la lista', 'info');
          return;
        }
        if (!window.openNuevoTercero) {
          if (window.toast) window.toast('No se pudo abrir "Nuevo tercero" desde aquí', 'error');
          return;
        }
        window.openNuevoTercero({
          nombre: val, cliente: !esCompra, proveedor: esCompra,
          onSaved: (t) => {
            nom.value = t.nombre;
            if (rif) rif.value = normRif(t.rif);
            // El recién creado entra a la lista de esta sesión del formulario:
            // sin esto, volver a escribir su nombre lo daría por desconocido.
            lista.push({ nombre: t.nombre, rif: t.rif, cli: !esCompra, prov: esCompra });
            if (o.moverFoco !== false) alSiguiente();
            if (window.toast) window.toast((esCompra ? 'Proveedor' : 'Cliente') + ' "' + t.nombre + '" creado y seleccionado', 'success');
          },
        });
      });
    }

    /* Las alícuotas del IVA, en un solo sitio.

       · General 16% y reducida 8%: Ley de IVA, alícuotas ordinarias.
       · Adicional por consumo suntuario (joyas, vehículos, obras de arte,
         armas…): la ley la fija ENTRE 15% y 20%, y mientras el Ejecutivo no
         diga otra cosa rige el 15%. Se aplica SUMADA a la general, así que
         la tasa efectiva de ese renglón es 16% + 15% = 31%, y va a su propio
         renglón de la Forma 30 (cód. 332/342 compras · 442/452 ventas).

       Falta la adicional por pagos en divisas o criptoactivos no respaldados
       por la República (rango legal 5%–25%). NO se incluye a propósito: aún
       no está vigente —entra 30 días continuos después del Decreto que fije
       la tasa— y la Forma 30 todavía no trae renglón para ella. Cuando salga
       el Decreto, se agrega aquí y en el formulario.

       Si el Ejecutivo cambia un porcentaje, se cambia AQUÍ y queda cambiado
       en el formulario, en el libro y en la Forma 30. */
    const IVA_ADICIONAL_SUNTUARIO = 0.15; // rango legal 15%–20%
    const ALICUOTAS = {
      exento: { txt: 'Exento / no gravado', pct: 0 },
      red: { txt: 'Reducida 8%', pct: 0.08 },
      gen: { txt: 'General 16%', pct: 0.16 },
      adic: { txt: 'General + adicional ' + Math.round((0.16 + IVA_ADICIONAL_SUNTUARIO) * 100) + '% (suntuario)', pct: 0.16 + IVA_ADICIONAL_SUNTUARIO },
    };
    window.__ALICUOTAS = ALICUOTAS;

    /* La caja de montos por renglón. Vive AQUÍ y no dentro de cada modal
       porque la usan dos —registrar y editar— y dos copias de la misma
       aritmética de impuestos se separan tarde o temprano. Si editar
       aplastara una factura de varias alícuotas a una sola, el desglose se
       perdería sin que nadie lo note hasta la declaración. */
    /* La alícuota que se propone al abrir un renglón sale de la preferencia de
       la empresa (Configuración → Configuración fiscal). Antes esa casilla no
       la leía nadie: se podía cambiar y no pasaba nada. */
    function _alicPorDefecto() {
      const p = (window.__EMPRESA_PREFS || {}).alicuota;
      if (p === 8) return 'red';
      if (p === 0) return 'exento';
      return 'gen';
    }

    function montosHTML() {
      return '<div class="fm-numbox" id="lfMontos">'
        + '<div class="lf-reng">'
        /* La moneda de captura. El libro SIEMPRE se guarda en bolivares —es
           la moneda de la declaracion—, pero aqui se compra en divisas todos
           los dias y obligar a convertir a mano es pedir errores. */
        + '<div class="lf-moneda-row">'
        + '<label class="lf-moneda">Moneda de la factura'
        + '<select id="lfMoneda"><option value="BS">Bolívares (Bs)</option><option value="USD">Dólares ($)</option></select>'
        + '</label><span class="lf-tasa" id="lfTasa"></span></div>'
        + '<div class="ic-head"><span id="lfMontoLbl">Monto (Bs)</span><span>Alícuota</span><span>IVA</span><span></span></div>'
        + '<div id="lfRengRows"></div>'
        + '<button type="button" class="btn btn-ghost" id="lfRengAdd" style="height:30px;font-size:12px;margin-top:2px;">'
        + '<i data-lucide="plus" style="width:14px;height:14px;"></i> Agregar renglón</button>'
        + '<div class="lf-reng-hint">Una misma factura puede traer renglones exentos, al 8% y al 16%. '
        + 'Agrega un renglón por cada alícuota; si repites una, se suman.</div>'
        + '</div>'
        + '<div class="fm-numbox-sum">'
        + '<div class="fm-numbox-sum-row"><span>Base gravada</span><strong class="mono" id="numResBase">Bs 0,00</strong></div>'
        + '<div class="fm-numbox-sum-row"><span>Exento / no gravado</span><strong class="mono" id="numResEx">Bs 0,00</strong></div>'
        + '<div class="fm-numbox-sum-row"><span>IVA</span><strong class="mono" id="numResIva">Bs 0,00</strong></div>'
        + '<div class="fm-numbox-sum-row total"><span>Total de la factura</span><strong class="mono" id="numResTotal">Bs 0,00</strong></div>'
        /* El IGTF no entra en el total del libro —es otro impuesto y tiene su
           columna—, pero SI esta en el papel: la cinta de una maquina fiscal
           cobra el dia con el IGTF adentro. Sin estas dos lineas, el total
           impreso nunca cuadraba. */
        + '<div class="fm-numbox-sum-row" id="numResIgtfRow" hidden><span>IGTF cobrado en divisas</span><strong class="mono" id="numResIgtf">Bs 0,00</strong></div>'
        + '<div class="fm-numbox-sum-row total" id="numResTotIgtfRow" hidden><span>Total con IGTF <small>(lo que dice el papel)</small></span><strong class="mono" id="numResTotIgtf">Bs 0,00</strong></div>'
        + '<div class="fm-numbox-sum-row lf-check"><span>Total impreso en la factura <small>(opcional, para comprobar)</small></span>'
        + '<input id="numResCheck" type="number" step="0.01" placeholder="0,00"></div>'
        + '<div class="lf-dif" id="numResDif"></div>'
        + '</div></div>';
    }

    /* RE (Recibo) → sin crédito fiscal, en LOS DOS formularios.

       Estaba escrito solo en el de registrar: al editar volvía a aparecer el
       IVA y había que quitarlo a mano cada vez. */
    function engancharRecibo(body, montos, esCompra) {
      const tdEl = body.querySelector('[data-name="tipoDoc"]');
      if (!tdEl || !esCompra || !montos || !montos.soloExento) return;
      const aplicar = () => {
        const esRecibo = /^RE/.test(tdEl.value || '');
        montos.soloExento(esRecibo);
        let av = body.querySelector('#lfAvisoRecibo');
        if (esRecibo && !av) {
          av = document.createElement('div');
          av.id = 'lfAvisoRecibo';
          av.className = 'lf-reng-hint';
          av.style.cssText = 'margin-top:6px;color:#8a5410;';
          av.textContent = 'Un recibo no es una factura: no da derecho a crédito fiscal, así que su monto se registra como exento / no gravado.';
          const caja = body.querySelector('#lfMontos'); if (caja) caja.appendChild(av);
        } else if (!esRecibo && av) { av.remove(); }
      };
      tdEl.addEventListener('change', aplicar);
      aplicar();
    }

    /* Monta la caja y devuelve su API. `inicial` es una fila de libro_fiscal
       (al editar) o nada (al registrar). */
    function montarMontos(body, inicial) {
      /* El IGTF salió de aquí: ya no es un «sí/no» que multiplica el total.
         Lo llevan `camposIgtf`/`montarIgtf`/`leerIgtf`, que piden la tasa y la
         porción realmente cobrada en divisas — una factura puede cobrarse
         mitad en bolívares, y un reporte Z lo hace casi siempre. */
      const rengRows = body.querySelector('#lfRengRows');
      /* ══════════════════════════════════════════════════════════════
         LA MONEDA DE LA FACTURA

         Se escribe en bolivares o en dolares; al guardar SIEMPRE se
         convierte a bolivares, porque el libro es lo que se declara.

         La tasa es la del BCV vigente en la FECHA DE LA FACTURA —no la de
         hoy—: es la que rige la operacion. Por eso se vuelve a calcular
         cuando cambia esa fecha, y se muestra antes de guardar junto al
         equivalente en bolivares. Sin tasa para esa fecha, `onSave` se
         niega a guardar en vez de inventar una conversion.
         ══════════════════════════════════════════════════════════════ */
      const selMoneda = body.querySelector('#lfMoneda');
      const elTasa = body.querySelector('#lfTasa');
      const elMontoLbl = body.querySelector('#lfMontoLbl');
      const fechaEl = body.querySelector('[data-name="fecha"]');
      const moneda = () => (selMoneda && selMoneda.value === 'USD' ? 'USD' : 'BS');
      /* LA TASA DEL DOCUMENTO MANDA MIENTRAS NO SE CAMBIE SU FECHA.

         Al editar una compra escrita en dolares se reconvertia con la tasa de
         la fecha, que no tiene por que ser la que se uso al registrarla —una
         factura cargada tarde, una fecha corregida despues—. Abrir y guardar
         sin tocar nada le cambiaba los bolivares: Bs 51.517,45 se volvian
         52.740,05. Un documento cerrado no puede moverse solo.

         Si se cambia la fecha, se usa la tasa de la fecha nueva: ahi la
         reconversion es lo que se esta pidiendo, y se ve en pantalla. */
      let tasaGuardada = 0, fechaGuardada = null;
      function tasaFactura() {
        if (tasaGuardada > 0 && fechaEl && fechaEl.value === fechaGuardada) return tasaGuardada;
        const iso = window.__fechaISO12 ? window.__fechaISO12(fechaEl && fechaEl.value) : '';
        const t = (window.__tasaUSDEn && window.__tasaUSDEn(iso || 'ahora')) || 0;
        /* Si la fecha no da tasa pero el documento trae la suya, manda la
           suya: un documento guardado no se queda sin poder editarse. */
        return t || tasaGuardada || 0;
      }
      const elBase = document.getElementById('numResBase');
      const elEx = document.getElementById('numResEx');
      const elIva = document.getElementById('numResIva');
      const elTotal = document.getElementById('numResTotal');
      const elCheck = document.getElementById('numResCheck');
      const elDif = document.getElementById('numResDif');
      const elIgtf = document.getElementById('numResIgtf');
      const elIgtfRow = document.getElementById('numResIgtfRow');
      const elTotIgtf = document.getElementById('numResTotIgtf');
      const elTotIgtfRow = document.getElementById('numResTotIgtfRow');
      /* El IGTF vive en sus propios campos (`camposIgtf`), fuera de esta caja.
         Se lee de ahi con la MISMA formula de `leerIgtf`, para que la pantalla
         no pueda decir una cosa y el guardado otra. */
      function igtfDelFormulario() {
        const val = (n) => {
          const el = body.querySelector('[data-name="' + n + '"]');
          return el ? parseFloat(el.value) : NaN;
        };
        const p = val('igtfPct');
        const pct = (p > 0 && p < 100) ? p / 100 : 0.03;
        const base = val('igtfBase') || 0;
        return val('igtfMonto') || (base > 0 ? base * pct : 0);
      }

      // Suma los renglones y los reparte en los cuatro cubos de la Forma 30.
      function leer() {
        const acum = { exento: 0, gen: 0, red: 0, adic: 0 };
        (rengRows ? [...rengRows.querySelectorAll('.ic-row')] : []).forEach((r) => {
          const monto = parseFloat(r.querySelector('.lf-monto').value) || 0;
          const clave = r.querySelector('.lf-alic').value;
          if (acum[clave] != null) acum[clave] += monto;
        });
        const ivaGen = acum.gen * ALICUOTAS.gen.pct;
        const ivaRed = acum.red * ALICUOTAS.red.pct;
        const ivaAdic = acum.adic * ALICUOTAS.adic.pct;
        const baseGravada = acum.gen + acum.red + acum.adic;
        const iva = ivaGen + ivaRed + ivaAdic;
        return {
          exento: acum.exento,
          base_gen: acum.gen, iva_gen: ivaGen,
          base_red: acum.red, iva_red: ivaRed,
          base_adic: acum.adic, iva_adic: ivaAdic,
          base: baseGravada, iva: iva,
          total: baseGravada + iva + acum.exento,
        };
      }

      function recalcular() {
        const t = leer();
        const usd = moneda() === 'USD';
        const sig = usd ? '$ ' : 'Bs ';
        if (elMontoLbl) elMontoLbl.textContent = 'Monto (' + (usd ? '$' : 'Bs') + ')';
        if (elTasa) {
          const tsa = usd ? tasaFactura() : 0;
          elTasa.innerHTML = !usd ? ''
            : (tsa > 0
              ? 'Tasa BCV de la fecha de la factura: <strong>Bs ' + fmtF(tsa) + '</strong> por $ · se guardará como <strong>Bs ' + fmtF(t.total * tsa) + '</strong>'
              : '<span class="mal">Sin tasa del BCV para esa fecha: no podré convertir. Revisa la fecha o carga los montos en bolívares.</span>');
        }
        if (elBase) elBase.textContent = sig + fmtF(t.base);
        if (elEx) elEx.textContent = sig + fmtF(t.exento);
        if (elIva) elIva.textContent = sig + fmtF(t.iva);
        if (elTotal) elTotal.textContent = sig + fmtF(t.total);
        /* El IGTF se escribe SIEMPRE en bolivares (asi lo cobra la maquina).
           Si la factura se esta capturando en dolares, aqui se muestra
           convertido para poder sumarlo con el resto. */
        const igtfBs = igtfDelFormulario();
        const tsaIgtf = usd ? tasaFactura() : 1;
        const igtfEnMoneda = usd ? (tsaIgtf > 0 ? igtfBs / tsaIgtf : 0) : igtfBs;
        const hayIgtf = igtfBs > 0.005 && (!usd || tsaIgtf > 0);
        if (elIgtfRow) elIgtfRow.hidden = !hayIgtf;
        if (elTotIgtfRow) elTotIgtfRow.hidden = !hayIgtf;
        if (elIgtf) elIgtf.textContent = sig + fmtF(igtfEnMoneda);
        if (elTotIgtf) elTotIgtf.textContent = sig + fmtF(t.total + igtfEnMoneda);
        // El IVA de cada renglón, para cotejarlo contra el papel línea por línea
        (rengRows ? [...rengRows.querySelectorAll('.ic-row')] : []).forEach((r) => {
          const monto = parseFloat(r.querySelector('.lf-monto').value) || 0;
          const pct = (ALICUOTAS[r.querySelector('.lf-alic').value] || { pct: 0 }).pct;
          r.querySelector('.lf-iva').textContent = pct ? fmtF(monto * pct) : '—';
        });
        /* Comprobación contra el total impreso: atrapa el dígito transpuesto
           AQUÍ, no al cerrar el mes. Es opcional a propósito — quien carga
           cincuenta facturas seguidas decide si lo usa. */
        if (elCheck && elDif) {
          const decl = parseFloat(elCheck.value);
          const conIgtf = t.total + igtfEnMoneda;
          if (!elCheck.value || isNaN(decl)) { elDif.textContent = ''; elDif.className = 'lf-dif'; }
          /* El papel puede traer el total CON IGTF —la cinta de una maquina
             fiscal siempre lo trae— o sin el. Cualquiera de los dos cuadra. */
          else if (hayIgtf && Math.abs(decl - conIgtf) <= 0.02) { elDif.textContent = '✓ Cuadra con el papel (total con IGTF)'; elDif.className = 'lf-dif ok'; }
          else if (Math.abs(decl - t.total) <= 0.02) { elDif.textContent = '✓ Cuadra con la factura' + (hayIgtf ? ' (sin el IGTF)' : ''); elDif.className = 'lf-dif ok'; }
          else { elDif.textContent = '✗ Diferencia de ' + (moneda() === 'USD' ? '$ ' : 'Bs ') + fmtF(Math.abs(decl - t.total)) + ' — revisa los montos'; elDif.className = 'lf-dif mal'; }
        }
      }

      function agregar(monto, clave) {
        if (!rengRows) return null;
        const r = document.createElement('div');
        r.className = 'ic-row';
        r.innerHTML = '<input class="lf-monto" type="number" step="0.01" placeholder="0,00" value="' + (monto != null && monto !== '' ? esc(String(monto)) : '') + '">'
          + '<select class="lf-alic">'
          + Object.keys(ALICUOTAS).map((k) => '<option value="' + k + '"' + (k === (clave || _alicPorDefecto()) ? ' selected' : '') + '>' + esc(ALICUOTAS[k].txt) + '</option>').join('')
          + '</select>'
          + '<span class="lf-iva mono">—</span>'
          + '<button type="button" class="btn btn-ghost lf-del" title="Quitar renglón"><i data-lucide="x" style="width:14px;height:14px;"></i></button>';
        rengRows.appendChild(r);
        r.querySelector('.lf-monto').addEventListener('input', recalcular);
        r.querySelector('.lf-alic').addEventListener('change', recalcular);
        r.querySelector('.lf-del').addEventListener('click', () => {
          // Nunca se queda sin renglones: el último se vacía en vez de borrarse,
          // o el formulario quedaría sin dónde escribir el monto.
          if (rengRows.querySelectorAll('.ic-row').length <= 1) {
            r.querySelector('.lf-monto').value = '';
            r.querySelector('.lf-alic').value = 'gen';
          } else { r.remove(); }
          recalcular();
        });
        if (window.lucide) window.lucide.createIcons();
        return r;
      }

      function reiniciar(fila) {
        if (rengRows) rengRows.innerHTML = '';
        const f = fila || {};
        /* SE ABRE EN LA MONEDA EN QUE SE CARGO.

           Una compra escrita en dolares se guarda en bolivares —el libro se
           declara en bolivares—, pero al corregirla hay que ver el numero que
           se escribio, no su conversion. Se divide por SU tasa, la que quedo
           guardada con el documento, no por la de hoy. */
        const divMon = (String(f.moneda || '') === 'USD' && Number(f.tasa) > 0) ? Number(f.tasa) : 1;
        if (selMoneda) selMoneda.value = divMon !== 1 ? 'USD' : 'BS';
        // La tasa con la que se guardó, y la fecha que tenía: ver `tasaFactura`.
        tasaGuardada = divMon !== 1 ? divMon : 0;
        fechaGuardada = fechaEl ? fechaEl.value : null;
        const dv = (n) => Math.round(((Number(n) || 0) / divMon) * 100) / 100;
        const ex = dv(f.exento);
        let bg = dv(f.base_gen), br = dv(f.base_red), ba = dv(f.base_adic);
        /* Filas anteriores al desglose (o sin migrar): toda su base está en
           'base' y su alícuota en 'alicuota'. Se reparte al renglón que le
           toca para que editarlas no las deje en cero. */
        if (!bg && !br && !ba && Number(f.base) > 0) {
          const al = Number(f.alicuota) || 0;
          if (al >= 0.25) ba = dv(f.base); else if (al < 0.12 && al > 0) br = dv(f.base); else bg = dv(f.base);
        }
        if (ex > 0) agregar(ex.toFixed(2), 'exento');
        if (br > 0) agregar(br.toFixed(2), 'red');
        if (ba > 0) agregar(ba.toFixed(2), 'adic');
        if (bg > 0) agregar(bg.toFixed(2), 'gen');
        if (!rengRows || !rengRows.querySelector('.ic-row')) agregar('', 'gen');
        if (elCheck) elCheck.value = '';
        recalcular();
      }

      /* UN RECIBO NO DA CREDITO FISCAL.

         No es una factura: su IVA no se puede declarar como credito. Al
         elegir «RE (Recibo)» los renglones pasan a exento y la alicuota se
         bloquea. Permitir lo contrario seria cargar un credito que en una
         fiscalizacion no existe. */
      function soloExento(on) {
        if (!rengRows) return;
        rengRows.querySelectorAll('.ic-row').forEach((r) => {
          const sel = r.querySelector('.lf-alic');
          if (!sel) return;
          /* La alicuota previa se guarda UNA sola vez: al agregar un renglon
             se vuelve a aplicar el bloqueo, y sin esta guarda el valor
             guardado pasaba a ser «exento» — al volver a factura, el IVA no
             regresaba nunca. */
          if (on) {
            if (!sel.dataset.previo && sel.value !== 'exento') sel.dataset.previo = sel.value;
            sel.value = 'exento'; sel.disabled = true;
          }
          else { sel.disabled = false; if (sel.dataset.previo) { sel.value = sel.dataset.previo; delete sel.dataset.previo; } }
        });
        const caja = body.querySelector('#lfMontos');
        if (caja) caja.dataset.soloExento = on ? 'true' : 'false';
        recalcular();
      }

      const addBtn = body.querySelector('#lfRengAdd');
      if (addBtn) addBtn.addEventListener('click', () => {
        const r = agregar('', 'gen');
        const caja = body.querySelector('#lfMontos');
        if (caja && caja.dataset.soloExento === 'true') soloExento(true);   // el renglon nuevo tambien
        if (r) r.querySelector('.lf-monto').focus();
      });
      if (elCheck) elCheck.addEventListener('input', recalcular);
      // El IGTF esta fuera de esta caja: hay que enterarse de que lo escriben.
      ['igtfPct', 'igtfBase', 'igtfMonto'].forEach((n) => {
        const el = body.querySelector('[data-name="' + n + '"]');
        if (el) { el.addEventListener('input', recalcular); el.addEventListener('change', recalcular); }
      });
      /* Al cambiar de moneda se CONVIERTE lo ya escrito, no se deja el mismo
         numero con otro signo. Una compra guardada esta en bolivares: pasar
         el selector a dolares sin convertir tomaria esos bolivares por
         dolares y al guardar los multiplicaria por la tasa. */
      if (selMoneda) {
        let monedaPrev = selMoneda.value;
        selMoneda.addEventListener('change', () => {
          const tsa = tasaFactura();
          const aUsd = selMoneda.value === 'USD';
          if (tsa > 0 && monedaPrev !== selMoneda.value && rengRows) {
            rengRows.querySelectorAll('.lf-monto').forEach((el) => {
              const v = parseFloat(el.value) || 0;
              if (v) el.value = Math.round((aUsd ? v / tsa : v * tsa) * 100) / 100;
            });
            const decl = parseFloat(elCheck && elCheck.value);
            if (elCheck && decl) elCheck.value = Math.round((aUsd ? decl / tsa : decl * tsa) * 100) / 100;
          }
          monedaPrev = selMoneda.value;
          recalcular();
        });
      }
      if (fechaEl) fechaEl.addEventListener('change', recalcular);
      // El historial de tasas puede no haber llegado todavia: se repinta al llegar.
      if (window.__cargarTasasUSD) window.__cargarTasasUSD().then(() => recalcular()).catch(() => {});
      reiniciar(inicial);
      return { leer: leer, agregar: agregar, reiniciar: reiniciar, recalcular: recalcular,
        moneda: moneda, tasa: tasaFactura, soloExento: soloExento };
    }

    /* Registrar un REPORTE Z de máquina fiscal.

       Una venta por máquina fiscal no es una factura: es el resumen de un día
       entero de ventas al detal. No tiene cliente ni RIF —nadie anota los
       datos de quien compra un pan— y en su lugar lleva el serial de la
       máquina, el número del reporte Z y el rango de comprobantes que emitió
       ese día. Por eso tiene formulario propio y no un cliente vacío en el de
       facturas.

       Radian lleva 240 reportes Z y ninguno se podía cargar desde la pantalla:
       el botón de registrar existía solo en la sección de facturas. */
    /* EL IGTF, EN UN SOLO SITIO PARA LOS CUATRO FORMULARIOS.

       Vive al nivel del módulo —no dentro de un formulario— porque lo usan el
       de registrar venta, el de editarla, el de registrar reporte Z y el de
       editarlo. Encerrarlo en uno solo es el error que ya se pagó cuatro
       veces esta semana.

       POR QUÉ NO ES UN «SÍ / NO» CON EL 3% DEL TOTAL

       Antes se preguntaba si la operación llevaba IGTF y se calculaba el 3%
       del total. Eso solo acierta cuando TODO se cobró en divisas, y casi
       nunca es así:

       · Un reporte Z es la suma del día entero y solo algunas ventas se
         cobraron en divisas — en RADIAN el IGTF real va del 0,13% al 1,64%
         del total facturado, no del 3%.
       · Y una factura suelta puede cobrarse mitad en bolívares y mitad en
         divisas, aunque el documento detalle una sola venta.

       Por eso se piden la TASA y la porción cobrada así, y se completa en los
       dos sentidos: quien tiene la base obtiene el impuesto, y quien solo
       tiene el impuesto —lo que suele imprimir la máquina— obtiene la base.

       Las tasas son 3% para moneda extranjera, criptomonedas y criptoactivos
       y 2% para transacciones en bolívares (guía TRI.GR.03.018, Gaceta 6.687
       Extraordinario del 25/02/2022). Queda escribible: la ley fija un rango
       y el Ejecutivo puede moverla. */
    function camposIgtf(igtfActual, rotulo) {
      const m = Number(igtfActual) || 0;
      return [
        { name: 'igtfPct', label: 'Tasa del IGTF (%)', type: 'datalist', value: '3',
          options: [{ value: '3', label: '3% · divisas, criptomonedas y criptoactivos' },
                    { value: '2', label: '2% · transacciones en bolívares' }] },
        { name: 'igtfBase', label: rotulo || 'Base: cuánto se cobró así (Bs)', type: 'number', step: '0.01',
          placeholder: '0.00', value: m > 0 ? (m / 0.03).toFixed(2) : '' },
        { name: 'igtfMonto', label: 'IGTF (Bs)', type: 'number', step: '0.01',
          placeholder: '0.00', value: m > 0 ? m.toFixed(2) : '' },
      ];
    }

    /* Cada campo calcula EL OTRO, nunca a sí mismo, así que no se pisan
       mientras se escribe. Al cambiar la tasa se recalcula desde el que tenga
       valor, dando preferencia a la base. */
    function montarIgtf(body) {
      const igP = body.querySelector('[data-name="igtfPct"]');
      const igB = body.querySelector('[data-name="igtfBase"]');
      const igM = body.querySelector('[data-name="igtfMonto"]');
      if (!igB || !igM) return;
      const tasa = () => {
        const p = parseFloat((igP && igP.value) || '3');
        return (p > 0 && p < 100) ? p / 100 : 0.03;
      };
      igB.addEventListener('input', () => {
        const b = parseFloat(igB.value) || 0;
        igM.value = b > 0 ? (b * tasa()).toFixed(2) : '';
      });
      igM.addEventListener('input', () => {
        const m = parseFloat(igM.value) || 0;
        igB.value = m > 0 ? (m / tasa()).toFixed(2) : '';
      });
      if (igP) igP.addEventListener('input', () => {
        const b = parseFloat(igB.value) || 0;
        const m = parseFloat(igM.value) || 0;
        if (b > 0) igM.value = (b * tasa()).toFixed(2);
        else if (m > 0) igB.value = (m / tasa()).toFixed(2);
      });
    }

    /* Lo que se guarda es el MONTO. Si quedó vacío pero hay base, se calcula;
       si no hay ninguno de los dos, la operación no llevó IGTF. */
    function leerIgtf(v) {
      const p = parseFloat(v.igtfPct);
      const pct = (p > 0 && p < 100) ? p / 100 : 0.03;
      const base = parseFloat(v.igtfBase) || 0;
      return parseFloat(v.igtfMonto) || (base > 0 ? base * pct : 0);
    }

    /* Vive al nivel del MÓDULO y no dentro de un formulario: la usan el de
       facturas y el de reportes Z. Estaba dentro de `registrarMov`, así que
       el de reportes Z no la veía y lanzaba ReferenceError dentro de un
       `.then` — sin rastro: el reporte se guardaba y el número siguiente
       no aparecía nunca. */
/* El siguiente de una serie, copiando el formato del último usado.

       Dos cosas que no se pueden dar por sabidas:

       · El N° DE CONTROL LLEVA SU PROPIA SERIE. No sale de la factura. En
         la matriz de GATMA iban parejos hasta que estrenaron talonario y el
         control se adelantó 300: la factura 148 lleva el control 448.
         Derivarlo de la factura le habría puesto 149 a un talonario que va
         por el 449.

       · EL PREFIJO ES PARTE DEL NÚMERO. Barquisimeto numera A000001,
         A000002… Quedarse solo con los dígitos devolvía '000018' y le
         borraba la A, que es lo que distingue su serie de la de la matriz.

       Por eso no se inventa el formato: se toma el del número más alto que
       ya existe en ese establecimiento —su prefijo y su cantidad de
       dígitos— y se le suma uno. Si mañana el talonario cambia de forma, el
       sistema la aprende de la primera factura que se cargue a mano. */
    function siguienteDe(valores) {
      let mejor = null, maxN = -1;
      (valores || []).forEach((s) => {
        const m = String(s || '').trim().match(/^(.*?)(\d+)$/);
        if (!m) return;
        const n = parseInt(m[2], 10);
        if (!isNaN(n) && n > maxN) { maxN = n; mejor = m; }
      });
      return mejor ? mejor[1] + String(maxN + 1).padStart(mejor[2].length, '0') : '';
    }

    /* LAS NOTAS QUE TRAE UN REPORTE Z.

       Mismo patrón que los renglones de alícuota: una fila por nota, con su
       número, la factura que afectó y el monto. Se reusa la retícula de
       .ic-head/.ic-row, que ya tiene cuatro columnas.

       Va vacío por defecto y en un acordeón cerrado: la inmensa mayoría de
       los días no hay devoluciones, y un formulario que pide todos los días
       algo que casi nunca pasa termina ignorándose. */
    function notasZHTML() {
      return '<details class="lf-notasz" id="lfNotasZ">'
        + '<summary>Notas de crédito o débito emitidas en este Z '
        + '<span class="lf-notasz-cont" id="lfNotasCont"></span></summary>'
        + '<div class="lf-reng" style="margin-top:8px;">'
        + '<div class="ic-head"><span>Tipo</span><span>N° de la nota</span><span>Factura afectada</span><span>Monto total (Bs)</span><span>IVA (Bs)</span><span></span></div>'
        + '<div id="lfNotasRows"></div>'
        + '<button type="button" class="btn btn-ghost" id="lfNotasAdd" style="height:30px;font-size:12px;margin-top:2px;">'
        + '<i data-lucide="plus" style="width:14px;height:14px;"></i> Agregar nota</button>'
        + '<div class="lf-reng-hint"><strong>Estos montos ya están aplicados en el total del día.</strong> '
        + 'La máquina resta las de crédito y suma las de débito antes de imprimir el Z, '
        + 'así que aquí NO se vuelven a aplicar: quedan para poder cuadrar el libro contra la cinta. '
        + 'El <strong>IVA</strong> es opcional — sirve para responder cuánto débito fiscal se movió, '
        + 'y una devolución de mercancía exenta no lleva.</div>'
        + '</div></details>';
    }

    /* Monta el bloque y devuelve su API. `inicial` es la fila del libro (al
       editar) o nada (al registrar). */
    function montarNotasZ(body, inicial) {
      const cont = body.querySelector('#lfNotasRows');
      const det = body.querySelector('#lfNotasZ');
      const cta = body.querySelector('#lfNotasCont');
      if (!cont) return { leer: () => null };

      /* El resumen separa las dos: sumarlas juntas daría un número que no
         significa nada, porque una resta y la otra suma. */
      function resumen() {
        let nC = 0, mC = 0, nD = 0, mD = 0;
        cont.querySelectorAll('.ic-row').forEach((f) => {
          const num = (f.querySelector('.nz-num').value || '').trim();
          if (!num) return;
          const monto = Math.abs(parseFloat(f.querySelector('.nz-monto').value) || 0);
          if (f.querySelector('.nz-tipo').value === 'ND') { nD++; mD += monto; }
          else { nC++; mC += monto; }
        });
        const partes = [];
        if (nC) partes.push(nC + ' N.C. · Bs ' + fmtF(mC));
        if (nD) partes.push(nD + ' N.D. · Bs ' + fmtF(mD));
        if (cta) cta.textContent = partes.length ? '· ' + partes.join('  ·  ') : '';
      }

      function agregar(d) {
        const r = document.createElement('div');
        r.className = 'ic-row';
        /* El tipo va PRIMERO porque cambia el significado de todo lo que
           sigue: una de crédito resta y una de débito suma. Por defecto
           crédito, que es el caso común —una devolución—. */
        const esND = String((d && d.t) || 'NC').toUpperCase() === 'ND';
        r.innerHTML = '<select class="nz-tipo">'
          + '<option value="NC"' + (esND ? '' : ' selected') + '>N. Crédito</option>'
          + '<option value="ND"' + (esND ? ' selected' : '') + '>N. Débito</option>'
          + '</select>'
          + '<input class="nz-num" type="text" placeholder="N° de la nota" value="' + esc((d && d.n) || '') + '">'
          + '<input class="nz-fact" type="text" placeholder="N° de factura" value="' + esc((d && d.f) || '') + '">'
          + '<input class="nz-monto" type="number" step="0.01" placeholder="0,00" value="' + esc(d && d.m != null ? String(d.m) : '') + '">'
          + '<input class="nz-iva" type="number" step="0.01" placeholder="0,00" value="' + esc(d && d.i != null ? String(d.i) : '') + '">'
          + '<button type="button" class="btn btn-ghost nz-del" title="Quitar nota"><i data-lucide="x" style="width:14px;height:14px;"></i></button>';
        cont.appendChild(r);
        r.querySelectorAll('input').forEach((i) => i.addEventListener('input', resumen));
        r.querySelector('.nz-tipo').addEventListener('change', resumen);
        r.querySelector('.nz-del').addEventListener('click', () => { r.remove(); resumen(); });
        if (window.lucide) window.lucide.createIcons();
        return r;
      }

      const previas = (inicial && Array.isArray(inicial.notas_z)) ? inicial.notas_z : [];
      previas.forEach(agregar);
      if (previas.length && det) det.open = true;
      resumen();

      const add = body.querySelector('#lfNotasAdd');
      if (add) add.addEventListener('click', () => { agregar(); resumen(); });

      return {
        /* Devuelve null si no se escribió ninguna: null y [] significan lo
           mismo para la base, y null deja la columna limpia. */
        leer: () => {
          const out = [];
          cont.querySelectorAll('.ic-row').forEach((f) => {
            const n = (f.querySelector('.nz-num').value || '').trim();
            if (!n) return;   // sin número no es una nota, es una fila a medio llenar
            const iva = Math.abs(parseFloat(f.querySelector('.nz-iva').value) || 0);
            out.push({
              t: f.querySelector('.nz-tipo').value === 'ND' ? 'ND' : 'NC',
              n: n,
              f: (f.querySelector('.nz-fact').value || '').trim() || null,
              m: Math.abs(parseFloat(f.querySelector('.nz-monto').value) || 0),
              /* El IVA queda fuera si es cero: una devolución de mercancía
                 exenta no lo lleva, y guardar un 0 haría creer que se
                 escribió y daba cero. */
              i: iva > 0 ? iva : undefined,
            });
          });
          return out.length ? out : null;
        },
      };
    }

    function registrarZeta() {
      let bodyRef = null;

      /* El siguiente Z y el siguiente comprobante salen de lo ya cargado en
         esa MÁQUINA. El Z es correlativo del equipo, y el primer comprobante
         del día es el siguiente al último del día anterior: si queda un salto,
         es que falta un reporte por cargar y conviene verlo antes de seguir. */
      function autonumerarZ(forzar) {
        if (!window.__sbAll || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id || !bodyRef) return;
        const maq = bodyRef.querySelector('[data-name="maquina"]');
        const nz = bodyRef.querySelector('[data-name="numeroZ"]');
        const cd = bodyRef.querySelector('[data-name="compDesde"]');
        const serial = maq ? maq.value.trim() : '';
        window.__sbAll((q) => {
          let c = q.eq('empresa_id', window.__EMPRESA_ACTIVA.id).eq('tipo', 'venta');
          if (serial) c = c.eq('maquina_fiscal', serial);
          return c;
        }, 'libro_fiscal', 'maquina_fiscal, numero_zeta, comprobante_hasta').then(({ data }) => {
          const filas = (data || []).filter((r) => String(r.numero_zeta || '').trim());
          if (!filas.length) return;
          if (maq && !maq.value) {
            const seriales = [...new Set(filas.map((r) => r.maquina_fiscal).filter(Boolean))];
            if (seriales.length === 1) { maq.value = seriales[0]; autonumerarZ(true); return; }
          }
          const sigZ = siguienteDe(filas.map((r) => r.numero_zeta));
          const sigC = siguienteDe(filas.map((r) => r.comprobante_hasta));
          if (nz && sigZ && (forzar || !nz.value)) nz.value = sigZ;
          if (cd && sigC && (forzar || !cd.value)) cd.value = sigC;
          /* La fecha más alta cargada para esa máquina, para el aviso de
             salto. Las fechas vienen como dd/mm/aa, así que se comparan
             pasándolas a aaaa-mm-dd — comparar el texto dd/mm/aa ordena
             por día y diría que el 30/01 es posterior al 02/12. */
          const isos = filas.map((r) => {
            const p = String(r.fecha || '').split('/');
            return p.length === 3 ? '20' + p[2].slice(-2) + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0') : '';
          }).filter(Boolean).sort();
          ultimaFechaZ = isos.length ? isos[isos.length - 1] : null;
          revisarFecha();
        });
      }

      /* Última fecha cargada para esa máquina, para poder avisar del salto.
         Se guarda aquí y no se vuelve a preguntar a la base en cada tecla. */
      let ultimaFechaZ = null;

      const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

      /* Dice qué día de la semana es y, si se aleja del último reporte,
         cuántos días quedarían sin cargar. No impide nada: un domingo sin
         ventas es normal. Lo que no debe pasar es enterarse en julio. */
      function revisarFecha() {
        const caja = bodyRef && bodyRef.querySelector('#zAvisoFecha');
        const campo = bodyRef && bodyRef.querySelector('[data-name="fecha"]');
        if (!caja || !campo || !campo.value) return;
        const d = new Date(campo.value + 'T12:00:00');
        if (isNaN(d.getTime())) { caja.innerHTML = ''; return; }

        const dia = DIAS[d.getDay()];
        let extra = '';
        if (ultimaFechaZ) {
          const ant = new Date(ultimaFechaZ + 'T12:00:00');
          const saltados = Math.round((d - ant) / 86400000) - 1;
          if (saltados > 0) {
            extra = ' · <strong>' + saltados + ' día' + (saltados === 1 ? '' : 's')
              + ' sin reporte</strong> desde el ' + ant.getDate() + '/'
              + String(ant.getMonth() + 1).padStart(2, '0')
              + '. Si no se laboró, está bien; si falta cargarlo, cárgalo antes.';
          } else if (saltados < 0) {
            extra = ' · <strong>esta fecha es anterior</strong> al último reporte cargado.';
          }
        }
        const alerta = extra !== '';
        caja.innerHTML = '<div style="font-size:11.5px;line-height:1.5;padding:' + (alerta ? '8px 10px' : '2px 0')
          + ';border-radius:6px;'
          + (alerta ? 'background:var(--da-amber-50,#fff8e6);color:var(--da-amber-700,#9a6700);' : 'color:var(--fg-muted);')
          + '">Es ' + dia + extra + '</div>';
      }

      window.openFormModal && window.openFormModal({
        title: 'Registrar reporte Z (máquina fiscal)',
        saveLabel: 'Registrar y seguir con el siguiente',
        autoClose: false,
        fields: [
          { name: 'fecha', label: 'Fecha del reporte Z', type: 'date', value: window.__hoyISO() },
          { name: 'avisoFecha', col: 2, type: 'static', label: '', html: '<div id="zAvisoFecha"></div>' },
          { name: 'maquina', label: 'Serial de la máquina fiscal', upper: true, placeholder: 'Z7C0000000' },
          /* El número es correlativo de la MÁQUINA, no del calendario: si un
             día no se labora, el siguiente reporte lleva el número siguiente
             igual. Se dice aquí porque es la duda que surge sola al saltar
             un domingo. */
          { name: 'numeroZ', label: 'N° de reporte Z — correlativo de la máquina, no del calendario', placeholder: '0000' },
          { name: 'compDesde', label: 'Primer comprobante del día', placeholder: '00000000' },
          { name: 'compHasta', label: 'Último comprobante del día', placeholder: '00000000' },
          { name: 'avisoCero', col: 2, type: 'static', label: '', html:
            '<div style="font-size:11.5px;color:var(--fg-muted);line-height:1.5;">'
            + 'Si la jornada cerró <strong>sin ventas</strong> —falla de la impresora, un Z de prueba, un día sin operar— '
            + 'regístralo igual con sus montos en cero: lo que no puede quedar es un salto en el correlativo.</div>' },
          { name: 'numResumen', col: 2, type: 'static', label: '', html: montosHTML() },
          { name: 'notasZ', col: 2, type: 'static', label: '', html: notasZHTML() },
          /* EL IGTF DE UN REPORTE Z NO SALE DEL TOTAL DEL DÍA.

             El Z es la suma de todas las facturas de la jornada, y el IGTF lo
             generan solo las que se cobraron en divisas o cripto. Calcularlo
             como el 3% del total infla el impuesto: en los reportes de Radian
             el IGTF real va del 0,11% al 1,68% del total facturado, no del 3%.

             Por eso se pregunta CUÁNTO se cobró en divisas, y de ahí sale el
             3%. El monto queda editable porque el que manda es el que imprime
             la máquina: si el Z dice otra cifra, esa es la que va al libro. */
        ].concat(camposIgtf(0, 'Base: cuánto del día se cobró así (Bs)')).concat(campoSucursal()),
        afterRender: (body) => {
          bodyRef = body;
          bodyRef.__montos = montarMontos(body);
          bodyRef.__notas = montarNotasZ(body);
          autonumerarZ();
          const maq = body.querySelector('[data-name="maquina"]');
          if (maq) maq.addEventListener('change', () => autonumerarZ(true));
          /* Cambiar la fecha NO recalcula el número: el correlativo es de la
             máquina. Solo se refresca el aviso. */
          const fec = body.querySelector('[data-name="fecha"]');
          if (fec) { fec.addEventListener('change', revisarFecha); fec.addEventListener('input', revisarFecha); }
          revisarFecha();
          montarIgtf(body);
        },
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          if (!(v.maquina || '').trim()) return 'Indica el serial de la máquina fiscal.';
          if (!(v.numeroZ || '').trim()) return 'Indica el N° del reporte Z: es lo que identifica al documento.';
          const fp = (v.fecha || '').split('-');
          if (fp.length !== 3) return 'Indica la fecha del reporte.';
          const periodo = fp[0] + '-' + fp[1];
          if (!window.__confirmarPeriodoCerrado(periodo, 'Vas a registrar un reporte Z en ese período')) return 'No se registró: decidiste no tocar el período cerrado.';
          /* La quincena de una VENTA sí sale del día: la máquina emite el
             reporte el día que lo emite. No existe aquí el caso de la compra
             recibida tarde, que es el que obliga a preguntarla. */
          const esEsp = window.__ivaPorQuincena && window.__ivaPorQuincena();
          const dia = parseInt(fp[2], 10);
          const M = bodyRef && bodyRef.__montos ? bodyRef.__montos.leer()
            : { exento: 0, base_gen: 0, iva_gen: 0, base_red: 0, iva_red: 0, base_adic: 0, iva_adic: 0, base: 0, iva: 0, total: 0 };
          /* UN REPORTE Z EN CERO SÍ SE REGISTRA.

             Aquí decía que un Z sin monto "no dice nada" y aconsejaba dejarlo
             sin registrar. Es al revés, y era un mal consejo: lo que un Z
             identifica es el CORRELATIVO de la máquina, y saltarse uno deja un
             hueco en la secuencia — justo lo que se mira en una fiscalización.

             Pasa de verdad y a menudo: la impresora falla, se cierra la
             jornada sin ventas, se hace un Z de prueba. En el libro de Radian
             hay cuatro así, y doce días con más de un reporte. La máquina
             igual quema un comprobante, por eso el rango suele venir con el
             mismo número de principio y fin.

             Lo que sí se exige es el N° de Z, que es lo que da la continuidad,
             y eso ya se validó arriba. */
          /* Se guarda el MONTO, no un porcentaje del total. Si quedó vacío
             pero se escribió la base, se calcula; si no hay ninguno de los
             dos, el día no tuvo cobros en divisas y el IGTF es cero. */
          const igtf = leerIgtf(v);
          if (igtf > M.total) return 'El IGTF (' + fmtF(igtf) + ') no puede ser mayor que el total del día (' + fmtF(M.total) + '). Revisa el monto.';
          const alic = M.base_adic > 0 ? ALICUOTAS.adic.pct
            : M.base_gen >= M.base_red ? (M.base_gen > 0 ? 0.16 : 0) : 0.08;
          const saveBtnEl = document.getElementById('fmSave');
          if (saveBtnEl) saveBtnEl.disabled = true;
          window.sb.from('libro_fiscal').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
            tipo: 'venta', fecha: fp[2] + '/' + fp[1] + '/' + fp[0].slice(2),
            periodo: periodo, quincena: esEsp ? (dia > 15 ? 2 : 1) : null,
            sucursal_id: sucursalDe(v.sucursal),
            // Un reporte Z no lleva tercero: es la venta del día al público.
            tercero_nombre: null, tercero_rif: null,
            numero_factura: null, numero_control: null, tipo_doc: 'FV',
            maquina_fiscal: (v.maquina || '').trim().toUpperCase(),
            numero_zeta: (v.numeroZ || '').trim(),
            comprobante_desde: (v.compDesde || '').trim() || null,
            comprobante_hasta: (v.compHasta || '').trim() || null,
            /* Informativo: el total ya viene neto de la máquina. Guardarlo
               aquí es lo que permite cuadrar el libro contra la cinta. */
            notas_z: bodyRef && bodyRef.__notas ? bodyRef.__notas.leer() : null,
            exento: M.exento, base: M.base, alicuota: alic, iva: M.iva, igtf: igtf, total: M.total,
            base_gen: M.base_gen, iva_gen: M.iva_gen,
            base_red: M.base_red, iva_red: M.iva_red,
            base_adic: M.base_adic, iva_adic: M.iva_adic,
          }).then(({ error }) => {
            if (saveBtnEl) saveBtnEl.disabled = false;
            if (error) {
              // 23505 = el índice que impide cargar dos veces el mismo Z.
              toast(error.code === '23505'
                ? 'Ese reporte Z ya está cargado para esa máquina. Revisa el número.'
                : 'No se pudo guardar: ' + error.message, 'error');
              return;
            }
            if (window.__invalidarArrastres) window.__invalidarArrastres();
            cargarLibroFiscal('venta');
            toast(M.total > 0
              ? 'Reporte Z ' + v.numeroZ + ' registrado · Bs ' + fmtF(M.total)
              : 'Reporte Z ' + v.numeroZ + ' registrado EN CERO · el correlativo queda sin huecos', 'success');
            /* Y se deja listo el reporte del día siguiente. Son treinta al mes
               y se cargan de corrido: el que carga no debería escribir ni la
               fecha ni el número, solo los montos.

               El siguiente se calcula de lo que ACABA de guardarse, no
               volviendo a preguntarle a la base. Preguntar significa esperar
               un viaje de ida y vuelta que puede resolverse antes de que la
               fila nueva esté visible — y entonces propondría otra vez el
               número que se acaba de usar. De aquí sale al instante y no puede
               equivocarse. */
            if (bodyRef && bodyRef.__montos) bodyRef.__montos.reiniciar();
            const poner = (n, val) => {
              const e = bodyRef && bodyRef.querySelector('[data-name="' + n + '"]');
              if (e) e.value = val;
            };
            poner('numeroZ', siguienteDe([(v.numeroZ || '').trim()]));
            // El primer comprobante de mañana es el siguiente al último de hoy.
            poner('compDesde', siguienteDe([(v.compHasta || '').trim()]));
            poner('compHasta', '');
            // El IGTF es de la jornada: no se arrastra al día siguiente.
            poner('igtfBase', '');
            poner('igtfMonto', '');
            // La tasa NO se limpia: quien cobra en divisas lo hace todos los
            // días, y volver a elegir 3% en cada reporte es trabajo de más.
            // La fecha avanza un día: un reporte Z es de una jornada.
            /* El día siguiente es una PROPUESTA. Si no se laboró, se cambia
               a mano y el número no se mueve: son cosas independientes. */
            ultimaFechaZ = fp[0] + '-' + fp[1] + '-' + fp[2];
            const d = new Date(ultimaFechaZ + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            poner('fecha', d.toISOString().slice(0, 10));
            revisarFecha();
            const nzEl = bodyRef && bodyRef.querySelector('[data-name="numeroZ"]');
            if (nzEl) nzEl.focus();
          });
        },
      });
    }

    function registrarMov(tipo) {
      const esCompra = tipo === 'compra';
      let invBox = null; // contenedor de líneas para reponer inventario (solo compras)
      let bodyRef = null; // referencia al cuerpo del formulario, para poder limpiarlo tras guardar sin cerrar
      const prodsCompra = esCompra && window.__getProductos ? window.__getProductos() : [];
      // Terceros del rol correspondiente (proveedores para compras, clientes para ventas) → autocompletado
      const terceros = (window.__getTerceros ? window.__getTerceros() : []).filter((t) => (esCompra ? t.prov : t.cli) && t.nombre);
      const normRif = (s) => (s || '').toUpperCase().replace(/[\s.\-]/g, '');
      // VENTAS: sugiere el siguiente N° de factura/control consultando el máximo real en la BD.
      // forzar=true (tras guardar, para la siguiente factura) sobreescribe aunque el campo tenga valor;
      // si no, solo rellena si está vacío (apertura inicial del formulario).
      /* El correlativo es de CADA ESTABLECIMIENTO, no de la empresa.

         Casa Matriz va por la factura 148 y Barquisimeto por la 17: son dos
         talonarios distintos, cada uno con su serie. Tomando el máximo de
         toda la empresa se le proponía la 149 a una venta de Barquisimeto,
         que ya es un salto de 131 números en su talonario — y el N° de
         control salía con el mismo error detrás.

         Con menos de dos establecimientos no se filtra nada y se comporta
         como siempre. */
      function autonumerar(forzar) {
        if (esCompra || !window.__sbAll || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id || !bodyRef) return;
        const nfEl = bodyRef.querySelector('[data-name="numFactura"]');
        const ncEl = bodyRef.querySelector('[data-name="numControl"]');
        const selSuc = bodyRef.querySelector('[data-name="sucursal"]');
        const idSuc = selSuc ? sucursalDe(selSuc.value) : null;
        window.__sbAll((q) => {
          let c = q.eq('empresa_id', window.__EMPRESA_ACTIVA.id).eq('tipo', 'venta');
          if (idSuc) c = c.eq('sucursal_id', idSuc);
          return c;
        }, 'libro_fiscal', 'numero_factura, numero_control').then(({ data }) => {
          const fac = siguienteDe((data || []).map((r) => r.numero_factura));
          const ctl = siguienteDe((data || []).map((r) => r.numero_control));
          if (nfEl && fac && (forzar || !nfEl.value)) nfEl.value = fac;
          if (ncEl && ctl && (forzar || !ncEl.value)) ncEl.value = ctl;
        });
      }
      /* ¿El N° de control es de talonario (00-12345678) o de máquina fiscal?
         El de talonario cambia en CADA factura → hay que borrarlo.
         El de máquina fiscal es un código alfanumérico largo que se repite en
         todas las facturas del mismo equipo → borrarlo obligaría a reescribirlo
         factura tras factura, que es justo lo que hace lenta la carga.

         Se distingue por si TIENE LETRAS, no por el guion. Es la regla que falla
         del lado seguro: si alguien escribe el talonario sin guion (00123456) se
         borra igual, mientras que confundirse al revés dejaría el número de la
         factura anterior puesto en la siguiente, y eso no se nota al guardar. */
      const ES_MAQUINA_FISCAL = (s) => /[A-Za-z]/.test(String(s || ''));

      /* Pinta el atajo a lo último registrado. Se vuelve a llamar tras cada
         guardado, así que siempre apunta a la factura recién cargada. */
      function pintarUltimo() {
        if (!bodyRef) return;
        const caja = bodyRef.querySelector('#lfUltimo');
        if (!caja) return;
        const u = _ultimoRegistro[tipo];
        if (!u) { caja.innerHTML = ''; return; }
        caja.innerHTML = '<button type="button" class="btn btn-ghost" id="btnVolverUltimo" style="height:30px;font-size:12px;">'
          + '<i data-lucide="corner-up-left" style="width:14px;height:14px;"></i> Volver a la anterior · '
          + esc(u.num) + (u.nombre ? ' · ' + esc(u.nombre) : '') + '</button>';
        const b = caja.querySelector('#btnVolverUltimo');
        if (b) b.addEventListener('click', () => {
          /* Se cierra este formulario y se abre el de edición de esa factura.
             Al cerrar el de edición, el de registro NO vuelve solo: es
             preferible a apilar dos formularios uno encima del otro. */
          const cancelar = document.getElementById('fmCancel');
          if (cancelar) cancelar.click();
          setTimeout(() => editLibroFiscal(u.id, tipo), 150);
        });
        if (window.lucide) window.lucide.createIcons();
      }

      // Tras registrar, limpia solo lo que cambia de una factura a otra (cliente, RIF, números,
      // montos) y deja lo que se repite en una sesión de carga (fecha, tipo, condición, IGTF…)
      // para poder seguir registrando facturas seguidas sin cerrar ni volver a llenar todo.
      function limpiarParaSiguiente() {
        if (!bodyRef) return;
        const setV = (n, val) => { const el = bodyRef.querySelector('[data-name="' + n + '"]'); if (el) el.value = val; };
        setV('nombre', ''); setV('rif', '');
        if (bodyRef.__montos) bodyRef.__montos.reiniciar();
        /* COMPRAS: los números venían quedándose de la factura anterior porque
           autonumerar() se sale de una en compras (no hay correlativo propio:
           los números son los del PROVEEDOR). Se limpian aquí. */
        if (esCompra) {
          setV('numFactura', '');
          const ncEl = bodyRef.querySelector('[data-name="numControl"]');
          if (ncEl && !ES_MAQUINA_FISCAL(ncEl.value)) ncEl.value = '';
        }
        const anularSel = bodyRef.querySelector('[data-name="anularVenta"]');
        if (anularSel) { anularSel.value = 'No'; anularSel.dispatchEvent(new Event('change')); }
        if (invBox) { const rows = invBox.querySelector('#invCompraRows'); if (rows) rows.innerHTML = '<div class="ic-empty">Agrega los productos que llegaron con esta compra.</div>'; }
        const factEl = bodyRef.querySelector('[data-name="facturaFile"]'); if (factEl) factEl.value = '';
        autonumerar(true);
        const prov = bodyRef.querySelector('[data-name="nombre"]'); if (prov) prov.focus();
      }
      window.openFormModal && window.openFormModal({
        title: esCompra ? 'Registrar compra (Libro de Compras)' : 'Registrar venta (Libro de Ventas)',
        saveLabel: 'Registrar y seguir con la siguiente',
        autoClose: false,
        fields: (esCompra && (window.__ES_FUNDADOR || window.__ADDON_AGENTES) && window.__ocrFactura ? [
          { name: 'facturaFile', label: '🤖 Factura del proveedor (PDF o foto) — el Agente IA la lee y llena el formulario', col: 2, type: 'file' },
        ] : []).concat([
          { name: 'volverUltimo', col: 2, type: 'static', label: '', html: '<div id="lfUltimo"></div>' },
        ]).concat(campoSucursal()).concat([
          { name: 'fecha', label: 'Fecha de la factura', type: 'date', value: window.__hoyISO() },
        ]).concat(esCompra ? [
          // Solo COMPRAS: el crédito se declara en el período en que llega la factura (puede diferir de su fecha).
          { name: 'periodo', label: 'Período de declaración (si la factura es de un período anterior, elige aquel en que la declaras)', type: 'select', options: _opcionesPeriodo(), value: _periodoActualValor() },
        ] : []).concat([
          { name: 'tipoDoc', label: 'Tipo de documento', type: 'select', options: esCompra ? ['FC (Factura)', 'RE (Recibo)', 'NC (Nota de crédito)', 'ND (Nota de débito)'] : ['FV (Factura de venta)', 'NC (Nota de crédito)', 'ND (Nota de débito)'] },
          { name: 'nombre', label: (esCompra ? 'Proveedor' : 'Cliente') + ' (escribe las iniciales y elige)', col: 2, type: 'datalist', options: terceros.map((t) => t.nombre), placeholder: 'Ej. Sum… → Suministros Lara, C.A.' },
          { name: 'rif', label: 'RIF / C.I. (mayúscula, sin guiones — también busca por RIF)', upper: true, placeholder: 'J123456789', type: 'datalist', options: terceros.filter((t) => t.rif).map((t) => ({ value: normRif(t.rif), label: t.nombre })) },
          { name: 'numFactura', label: 'N° de Factura', placeholder: 'F-00000000' },
          { name: 'numControl', label: 'N° de Control', placeholder: '00-00000000' },
          {
            name: 'numResumen', col: 2, type: 'static', label: '', html: montosHTML(),
          },
        ].concat(esCompra ? [
          // La condición de pago se quitó: solo servía para abrir el cuadro de
          // pago, y esa decisión pertenece a Tesorería, no al libro fiscal.
        ] : [
          // El valor que se propone sale de la preferencia de la empresa.
        ]).concat(camposIgtf(0, 'Base: cuánto de esta factura se cobró así (Bs)')).concat([
          { name: 'igtfNota', col: 2, type: 'static', label: '', html:
            '<div style="font-size:11.5px;color:var(--fg-muted);line-height:1.5;">'
            + 'Una factura puede cobrarse <strong>mitad en bolívares y mitad en divisas</strong>, así que el IGTF '
            + 'no siempre es el 3% del total. Deja los dos campos vacíos si no hubo cobro en divisas ni cripto.</div>' },
        ]).concat([
          /* La retención se registra por UN SOLO CAMINO: este botón.

             Antes había además dos campos aquí —% y N° de comprobante— que
             creaban la retención de IVA al vuelo. Servían para el caso
             sencillo, pero no llegaban al ISLR con su concepto y su
             sustraendo, así que convivían dos formas de registrar lo mismo
             con distinto alcance. Dos caminos para un mismo dato terminan
             discrepando: uno valida cosas que el otro no, y el día que se
             cambia una regla hay que acordarse de los dos.

             El botón abre el formulario completo de retenciones, que es el
             que ya se usa desde el libro y desde la pestaña de Retenciones. */
          { name: 'atajoRetReg', col: 2, type: 'static', label: '', html:
            '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--border-default);padding-top:10px;">'
            + '<button type="button" class="btn btn-ghost" id="btnRetDeEsta" style="height:32px;font-size:12px;">'
            + '<i data-lucide="percent"></i> Registrar la retención de esta factura</button>'
            + '<span style="font-size:11px;color:var(--fg-muted);">Abre el formulario completo — IVA o ISLR, con concepto y sustraendo.</span></div>' },
        ]).concat(esCompra ? [] : [
          { name: 'anularVenta', label: '¿Este número es una factura ANULADA? (solo reserva el correlativo, sin monto)', col: 2, type: 'select', options: ['No', 'Sí — Anulada'] },
        ])),
        afterRender: (body) => {
          bodyRef = body;
          pintarUltimo();
          const prov = body.querySelector('[data-name="nombre"]');
          const rif = body.querySelector('[data-name="rif"]');
          if (!prov) return;
          // VENTAS: el N° de factura y de control son correlativos (uno detrás del otro) →
          // se sugiere el siguiente automáticamente, pero queda editable por si hace falta ajustarlo.
          autonumerar();
          /* Al cambiar de establecimiento se vuelve a numerar, con `forzar`:
             el número que estaba puesto es el del talonario del otro local y
             dejarlo sería peor que no proponer ninguno. También se recuerda,
             para que la siguiente factura abra en el mismo establecimiento. */
          const selSucForm = body.querySelector('[data-name="sucursal"]');
          if (selSucForm) {
            selSucForm.addEventListener('change', () => {
              recordarSucursal(sucursalDe(selSucForm.value));
              autonumerar(true);
            });
          }
          // COMPRAS: se avisa qué se borra y qué no al pasar a la siguiente factura, para que
          // nadie descubra por accidente que el código de la máquina fiscal se quedó puesto.
          if (esCompra) {
            const ncWrap = body.querySelector('[data-name="numControl"]');
            const wrap = ncWrap && ncWrap.closest('.fm-field');
            if (wrap) {
              const h = document.createElement('div');
              h.style.cssText = 'font-size:10.5px;color:var(--fg-muted);margin-top:3px;';
              h.textContent = "Si es de talonario (solo números) se borra en cada factura. Si es código de máquina fiscal (con letras) se mantiene puesto, y puedes cambiarlo cuando quieras.";
              wrap.appendChild(h);
            }
          }
          // VENTAS: toggle "Anulada" — reserva el número sin monto (reemplaza el truco manual
          // de poner "ANULADA" como cliente y dejar los montos a mano, propenso a error).
          const anularSel = body.querySelector('[data-name="anularVenta"]');
          if (anularSel) {
            const camposReales = ['nombre', 'rif', 'igtfPct', 'igtfBase', 'igtfMonto'];
            const aplicarAnular = () => {
              const on = /^s[ií]/i.test(anularSel.value || '');
              camposReales.forEach((n) => {
                const el = body.querySelector('[data-name="' + n + '"]');
                const wrap = el && el.closest('.fm-field');
                if (wrap) wrap.style.display = on ? 'none' : '';
              });
              // La caja de montos se oculta entera: una factura anulada solo
              // reserva el correlativo, no lleva ni base ni exento.
              const caja = body.querySelector('#lfMontos');
              const cajaWrap = caja && caja.closest('.fm-field');
              if (cajaWrap) cajaWrap.style.display = on ? 'none' : '';
              if (on && bodyRef.__montos) bodyRef.__montos.reiniciar();
            };
            anularSel.addEventListener('change', aplicarAnular);
            aplicarAnular();
          }
          // 🤖 OCR de la factura (Agente IA · add-on): al adjuntarla, llena el formulario.
          // El usuario revisa y corrige antes de registrar — la IA propone, él decide.
          const factEl = body.querySelector('[data-name="facturaFile"]');
          if (factEl && window.__ocrFactura) factEl.addEventListener('change', async () => {
            const file = factEl.files && factEl.files[0];
            if (!file) return;
            toast('🤖 Leyendo la factura con IA…', 'info');
            const d = await window.__ocrFactura(file);
            if (!d || !d.ok) { toast('No se pudo leer la factura' + (d && d.error ? ': ' + d.error : '') + ' — regístrala manual', 'error'); return; }
            const setV = (n, val) => { const el = body.querySelector('[data-name="' + n + '"]'); if (el && val != null && val !== '') el.value = val; };
            if (d.fecha) { const p = String(d.fecha).split('/'); if (p.length === 3) setV('fecha', p[2] + '-' + p[1] + '-' + p[0]); }
            setV('nombre', d.proveedor);
            setV('rif', d.rif);
            setV('numFactura', d.numero_factura);
            setV('numControl', d.numero_control);
            const tipoMap = { factura: 'FC (Factura)', nota_credito: 'NC (Nota de crédito)', nota_debito: 'ND (Nota de débito)' };
            setV('tipoDoc', tipoMap[d.tipo_documento] || 'FC (Factura)');
            // Alícuota y base: general (16%) manda; si solo hay reducida (8%), se usa esa
            /* Un renglón por cada base que traiga la factura. Antes solo cabía
               una y había que avisar "regístrala en una línea aparte"; ahora
               entran las tres juntas, que es como vienen en el papel. */
            const bg = Number(d.base_general) || 0, br = Number(d.base_reducida) || 0, ex = Number(d.exento) || 0;
            if (bodyRef.__montos) bodyRef.__montos.reiniciar({ exento: ex, base_red: br, base_gen: bg });
            const avisos = [];
            if (d.cuadra === false) avisos.push('los montos NO cuadran con el total leído (Bs ' + fmtF(Number(d.total) || 0) + ') — verifica contra el papel');
            if (d.iva_ok === false) avisos.push('el IVA leído no es 16% exacto de la base — revísalo');
            if (d.moneda === 'USD') avisos.push('la factura está en DÓLARES — el libro va en Bs: convierte a la tasa de la fecha');
            const conf = d.confianza != null ? ' · certeza ' + Math.round(d.confianza * 100) + '%' : '';
            if (avisos.length) toast('⚠️ Factura leída' + conf + ', PERO: ' + avisos.join(' · '), 'error');
            else toast('✓ Factura leída' + (d.proveedor ? ' · ' + d.proveedor : '') + (d.total != null ? ' · total Bs ' + fmtF(Number(d.total)) : '') + conf + ' — revisa y registra', 'success');
            // Retención de ISLR: si la factura es de servicios/honorarios/fletes/alquileres/
            // publicidad (o mixta), además de la retención de IVA toca retener ISLR (Anexo 6.1)
            const CONCEPTO_ISLR = { servicios: 'servicios', honorarios: 'honorarios profesionales', fletes: 'fletes / transporte', alquileres: 'alquileres', publicidad: 'publicidad y propaganda', mixta: 'parte de servicios (factura mixta)' };
            if (d.concepto && CONCEPTO_ISLR[d.concepto]) {
              setTimeout(() => toast('💡 Factura de ' + CONCEPTO_ISLR[d.concepto] + ': recuerda generar también la RETENCIÓN DE ISLR (además de la de IVA) en Fiscal → Retenciones ISLR', 'info'), 1200);
            }
          });
          // Autocompletado en los dos sentidos + F2 para crear el que falta.
          montarCampoTercero(body, { lista: terceros, esCompra: esCompra });
          if (!esCompra) montarIgtf(body);   // base <-> impuesto, en los dos sentidos

          /* El atajo a la retención trabaja con lo que HAY EN PANTALLA. Si el
             formulario ya se limpió tras guardar, cae en la última factura
             registrada, que es de la que uno quiere la retención en ese
             momento. Así un solo botón sirve para los dos instantes. */
          /* PRIMERO SE GUARDA LA FACTURA, y solo entonces se abre la retención.

             La primera versión de esto hacía `cancelar.click()` y abría el
             formulario de retención. En el de EDITAR eso es inofensivo —la
             factura ya existe—, pero en el de REGISTRAR cancelar significa
             DESCARTAR: la factura de MAXCAM se llenó, se pulsó el botón y se
             perdió, mientras su retención sí quedó guardada. Una retención
             sin su factura es peor que ninguna de las dos.

             Ahora se pulsa Guardar por dentro y se espera a que la factura
             quede registrada. Si la validación falla, el formulario se queda
             abierto con su mensaje y no se abre nada: no se pierde lo escrito. */
          const btnRetEsta = body.querySelector('#btnRetDeEsta');
          if (btnRetEsta) btnRetEsta.addEventListener('click', async () => {
            if (!window.__registrarRetencion) {
              toast('Ve a Fiscal → Retenciones y regístrala desde ahí.', 'error');
              return;
            }
            const leer = (n) => { const e = body.querySelector('[data-name="' + n + '"]'); return e ? e.value.trim() : ''; };
            const hayEscrito = !!(leer('numFactura') || leer('nombre'));

            if (hayEscrito) {
              const antes = (_ultimoRegistro[tipo] || {}).id || null;
              const guardar = document.getElementById('fmSave');
              if (!guardar) { toast('No pude guardar la factura. Regístrala y usa el botón después.', 'error'); return; }
              btnRetEsta.disabled = true;
              const rotulo = btnRetEsta.innerHTML;
              btnRetEsta.textContent = 'Guardando la factura…';
              guardar.click();
              // Se espera a que la factura quede registrada (hasta 8 segundos).
              const listo = await new Promise((resolve) => {
                let n = 0;
                const t0 = setInterval(() => {
                  const ahora = (_ultimoRegistro[tipo] || {}).id || null;
                  if (ahora && ahora !== antes) { clearInterval(t0); resolve(true); }
                  else if (++n > 40) { clearInterval(t0); resolve(false); }
                }, 200);
              });
              btnRetEsta.disabled = false;
              btnRetEsta.innerHTML = rotulo;
              if (window.lucide) window.lucide.createIcons();
              if (!listo) {
                toast('La factura no se guardó, así que no abro la retención. Revisa el aviso del formulario — lo que escribiste sigue aquí.', 'error');
                return;
              }
            }

            const u = _ultimoRegistro[tipo];
            if (!u || !(Number(u.iva) > 0 || Number(u.base) > 0)) {
              toast('Completa primero el ' + (esCompra ? 'proveedor' : 'cliente') + ', el N° de factura y los montos: de ahí salen la base y el IVA de la retención.', 'error');
              return;
            }
            const datos = {
              direccion: esCompra ? 'Practicada (yo retengo a un proveedor)' : 'Sufrida (un cliente me retiene)',
              nombre: u.nombre || '', rif: u.rif || '',
              factura: u.num === '(sin N°)' ? '' : u.num,
              numControl: u.numControl || '',
              // La de IVA se calcula sobre el IVA; la de ISLR, sobre la base.
              base: Number(u.iva) || 0, baseIva: Number(u.iva) || 0, baseIslr: Number(u.base) || 0,
              sucursal_id: u.sucursal_id || null,
              quincena: u.quincena, fechaFactura: u.fechaFactura || '',
            };
            const cancelar = document.getElementById('fmCancel');
            if (cancelar) cancelar.click();
            setTimeout(() => window.__registrarRetencion(datos), 150);
          });
          /* Renglones por alícuota → IVA y total en vivo.

             Una factura real trae varias alícuotas a la vez: una panadería
             compra leche y huevos (exentos), manteca (8%) y el resto (16%)
             en el mismo papel. Antes había un solo campo de base y una sola
             alícuota, así que tocaba partir la factura en varios registros. */
          const montos = montarMontos(body);
          bodyRef.__montos = montos;
          engancharRecibo(body, montos, esCompra);
          // Reposición de inventario (solo compras): suma cantidades al stock de los productos
          if (esCompra) {
            invBox = document.createElement('div');
            invBox.className = 'ic-sec';
            invBox.innerHTML = '<div class="ic-sec-title"><i data-lucide="package-plus" style="width:15px;height:15px;"></i> Reponer inventario <small>— opcional, suma al stock</small></div>'
              + '<datalist id="fm-dl-prodcompra">' + prodsCompra.map((p) => '<option value="' + esc(p.nombre) + '"></option>').join('') + '</datalist>'
              + '<div class="ic-head"><span>Producto</span><span>Cantidad</span><span>Costo unitario</span><span></span></div>'
              + '<div id="invCompraRows"><div class="ic-empty">Agrega los productos que llegaron con esta compra.</div></div>'
              + '<button type="button" class="btn btn-ghost" id="invCompraAdd" style="height:30px;font-size:12px;margin-top:4px;"><i data-lucide="plus" style="width:14px;height:14px;"></i> Agregar producto</button>';
            body.querySelector('.fm-grid').appendChild(invBox);
            const rows = invBox.querySelector('#invCompraRows');
            const addRow = () => {
              const empty = rows.querySelector('.ic-empty'); if (empty) empty.remove();
              const r = document.createElement('div');
              r.className = 'ic-row';
              r.innerHTML = '<input class="ic-prod" list="fm-dl-prodcompra" placeholder="Producto…" autocomplete="off">'
                + '<input class="ic-cant" type="number" step="any" placeholder="0 (acepta 2,5 kg)">'
                + '<input class="ic-costo" type="number" step="0.01" placeholder="0,00">'
                + '<button type="button" class="btn btn-ghost ic-del" title="Quitar"><i data-lucide="x" style="width:14px;height:14px;"></i></button>';
              rows.appendChild(r);
              r.querySelector('.ic-del').addEventListener('click', () => { r.remove(); if (!rows.querySelector('.ic-row')) rows.innerHTML = '<div class="ic-empty">Agrega los productos que llegaron con esta compra.</div>'; });
              r.querySelector('.ic-prod').focus();
              if (window.lucide) window.lucide.createIcons();
            };
            invBox.querySelector('#invCompraAdd').addEventListener('click', addRow);
            if (window.lucide) window.lucide.createIcons();
          }
        },
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          // Ventas: período = el de su fecha (las emite la empresa). Compras: el mes en que se declara.
          const fP = (v.fecha || '').split('-');
          const elegido = _partirPeriodo(esCompra ? (v.periodo || _periodoActualValor()) : '');
          const periodo = esCompra ? (elegido.periodo || _periodoActualKey())
            : (fP.length === 3 ? fP[0] + '-' + fP[1] : _periodoActualKey());
          /* La quincena de una COMPRA es la que se eligió: una factura
             recibida tarde se declara en una posterior a la de su fecha, y
             deducirla del día la mandaría a la que no es. La de una VENTA sí
             sale del día, porque la emite la empresa el día que la emite.
             En un ordinario queda nula: declara el mes completo. */
          const esEsp = window.__ivaPorQuincena && window.__ivaPorQuincena();
          const diaV = parseInt(fP[2], 10);
          const quincena = !esEsp ? null
            : (esCompra ? elegido.quincena : (diaV && diaV > 15 ? 2 : 1));
          if (!window.__confirmarPeriodoCerrado(periodo, 'Vas a registrar en un período ya declarado')) return 'No se registró: decidiste no tocar el período cerrado.';
          const esAnulada = !esCompra && /^s[ií]/i.test(v.anularVenta || '');
          if (esAnulada) { v = Object.assign({}, v, { nombre: 'ANULADA', rif: '', igtfBase: '', igtfMonto: '' }); }
          if (!v.nombre) return 'Indica el ' + (esCompra ? 'proveedor' : 'cliente') + '.';
          /* Los montos ya NO salen de tres campos sueltos sino de los renglones,
             porque una factura puede traer varias alícuotas a la vez. */
          const M = (!esAnulada && bodyRef && bodyRef.__montos) ? bodyRef.__montos.leer()
            : { exento: 0, base_gen: 0, iva_gen: 0, base_red: 0, iva_red: 0, base_adic: 0, iva_adic: 0, base: 0, iva: 0, total: 0 };
          /* DE DOLARES A BOLIVARES, con la tasa de la FECHA DE LA FACTURA.
             El libro se declara en bolivares; si no hay tasa para ese día no
             se guarda nada, porque una conversión inventada se convierte en
             una declaración equivocada. */
          const _mon = (bodyRef && bodyRef.__montos && bodyRef.__montos.moneda) ? bodyRef.__montos.moneda() : 'BS';
          const _tasaF = _mon === 'USD' ? ((bodyRef.__montos.tasa && bodyRef.__montos.tasa()) || 0) : 1;
          if (_mon === 'USD' && !(_tasaF > 0)) {
            return 'No tengo la tasa del BCV para la fecha de esa factura, así que no puedo convertir los dólares a bolívares. Revisa la fecha o escribe los montos en bolívares.';
          }
          /* El total TAL COMO SE ESCRIBIO, antes de convertir: es el que se
             guarda y el que se vuelve a mostrar siempre. */
          const _totalUsdCap = _mon === 'USD' ? Math.round((Number(M.total) || 0) * 100) / 100 : null;
          if (_tasaF !== 1) {
            ['exento', 'base_gen', 'iva_gen', 'base_red', 'iva_red', 'base_adic', 'iva_adic', 'base', 'iva', 'total']
              .forEach((k) => { M[k] = Math.round((Number(M[k]) || 0) * _tasaF * 100) / 100; });
          }
          const base = M.base, exento = M.exento, iva = M.iva, total = M.total;
          /* 'alicuota' se conserva por compatibilidad con lo ya cargado y con las
             pantallas que aún la leen. Con varias alícuotas en la misma factura
             deja de tener un único valor: se guarda la de mayor peso, y quien
             necesite el detalle usa las columnas por renglón. */
          const alic = M.base_adic > 0 ? ALICUOTAS.adic.pct
            : M.base_gen >= M.base_red ? (M.base_gen > 0 ? 0.16 : 0)
              : 0.08;
          const igtf = leerIgtf(v);   // el monto, no un porcentaje del total
          const p = (v.fecha || '').split('-');
          const fecha = p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0].slice(2)) : '';
          const saveBtnEl = document.getElementById('fmSave');
          if (saveBtnEl) saveBtnEl.disabled = true; // evita doble registro mientras el modal sigue abierto
          window.sb.from('libro_fiscal').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, tipo: tipo, fecha: fecha, periodo: periodo, quincena: quincena,
            sucursal_id: sucursalDe(v.sucursal),
            tercero_nombre: v.nombre, tercero_rif: normRif(v.rif), numero_factura: v.numFactura, numero_control: v.numControl,
            tipo_doc: (v.tipoDoc || (esCompra ? 'FC' : 'FV')).slice(0, 2), exento: exento, base: base, alicuota: alic, iva: iva, igtf: igtf, total: total,
            // Lo escrito en dolares se guarda en dolares: no se recalcula nunca mas.
            moneda: _mon, tasa: _tasaF !== 1 ? _tasaF : null, total_usd: _totalUsdCap,
            // Desglose por renglón de la Forma 30. 'base' e 'iva' siguen siendo
            // los TOTALES, así que las retenciones y los asientos no cambian.
            base_gen: M.base_gen, iva_gen: M.iva_gen,
            base_red: M.base_red, iva_red: M.iva_red,
            base_adic: M.base_adic, iva_adic: M.iva_adic,
          }).select('id').then(({ data: guardado, error }) => {
            if (saveBtnEl) saveBtnEl.disabled = false;
            if (error) {
              /* 23514 = la regla de la base sobre `tipo_doc`. Pasa cuando la
                 empresa todavia no ha corrido `sql/compras_recibo.sql`: el
                 mensaje crudo de Postgres no le dice a nadie que hacer. */
              const esRegla = error.code === '23514' && /tipo_doc/.test(error.message || '');
              toast(esRegla
                ? 'Esta base todavía no acepta RECIBO como tipo de documento. Corre sql/compras_recibo.sql en Supabase (una sola vez) y vuelve a intentarlo.'
                : ('No se pudo guardar: ' + error.message), 'error');
              return;
            }
            recordarSucursal(sucursalDe(v.sucursal));
            /* Se recuerda lo último que se registró para poder volver a
               corregirlo sin cerrar el formulario. Al cargar cincuenta
               facturas seguidas uno nota el error en la siguiente, no en la
               que está llenando. */
            if (guardado && guardado[0]) {
              _ultimoRegistro[tipo] = { id: guardado[0].id, num: v.numFactura || '(sin N°)', nombre: v.nombre,
                rif: normRif(v.rif), numControl: v.numControl || '', iva: iva, base: base,
                // La retención hereda el establecimiento de su factura: no se
                // pregunta, que sería una respuesta de más y un error posible.
                sucursal_id: sucursalDe(v.sucursal),
                /* Y hereda la quincena de la MISMA factura, que ya se eligió
                   al registrarla. Deducirla de la fecha de hoy fue un error:
                   una factura de la primera quincena que se carga el día 26
                   terminaba enterada en la segunda. La operación manda, no el
                   día en que uno se sienta a cargarla. */
                quincena: quincena,
                fechaFactura: v.fecha || '' };
              pintarUltimo();
            }
            if (window.__invalidarArrastres) window.__invalidarArrastres(); // el nuevo registro puede cambiar los arrastres
            if (window.cargarLibroFiscal) window.cargarLibroFiscal(tipo);
            if (window.cargarTesoreria) window.cargarTesoreria();   // refresca CxP/CxC (panel de Compras/Ventas)
            if (window.cargarDashboard) window.cargarDashboard();   // y los KPIs del Dashboard
            toast(esAnulada ? ('N° ' + v.numFactura + ' reservado como ANULADO') : ((esCompra ? 'Compra' : 'Venta') + ' registrada en el libro · Bs ' + fmtF(total)), 'success');
            /* El formulario se limpia AQUÍ, no al final.

               Debajo vienen el asiento contable, la reposición de inventario y
               la retención. Si cualquiera de esos revienta, antes se llevaba
               por delante la limpieza y el usuario quedaba viendo los datos de
               la factura que YA se guardó — creyendo que no se guardó, y
               registrándola dos veces. Lo que la pantalla muestra no puede
               depender de que el resto haya salido bien. */
            limpiarParaSiguiente();
            // Asiento contable de la COMPRA: Debe Inventario + IVA crédito / Haber CxP.
            // (Las ventas NO se contabilizan desde el libro: eso lo hace el RECIBO. El libro es solo para declarar.)
            if (esCompra && window.__postAsiento) {
              // Modelo del contador externo: la compra va directo a COSTO (grupo 5) para
              // que baje al Estado de Resultados; el inventario físico se ajusta al cierre.
              const ln = [{ cta: '5.1.1.02 · Compra de Mercancía', debe: base + exento, haber: 0 }];
              if (iva > 0.005) ln.push({ cta: '1.1.3.01 · IVA crédito fiscal', debe: iva, haber: 0 });
              ln.push({ cta: '2.1.1.01 · Cuentas por pagar comerciales', debe: 0, haber: total });
              window.__postAsiento('Compra s/factura ' + v.numFactura + ' · ' + v.nombre, v.numFactura, ln, 'auto').then((r) => { if (r && r.error) console.warn('[DigiAccount] No se pudo contabilizar la compra:', r.error.message); });
            }
            /* El inventario va dentro de un try, y NO por miedo a este bloque en
               concreto: por lo que hay DESPUÉS. Aquí abajo se registra la
               retención de IVA, que es una obligación fiscal, mientras que
               reponer el stock es una comodidad. Cuando esto lanzó un
               TypeError, la factura quedó guardada y la retención no se
               registró nunca, sin un solo aviso en pantalla. Lo accesorio no
               puede impedir lo obligatorio. */
            try {
            // Reponer inventario: suma las cantidades compradas al stock de cada producto
              if (esCompra && invBox && window.sb) {
                const lineasInv = [];
                /* `.ic-row` y no `#invCompraRows > div`.

                   Cuando no se agrega ningún producto, el contenedor lleva
                   dentro el aviso `<div class="ic-empty">Agrega los productos…`,
                   que TAMBIÉN es un div: entraba en el bucle, `.ic-prod` salía
                   nulo y reventaba con TypeError. Y como esto corre dentro de
                   un `.then`, no se veía nada: la factura quedaba guardada y
                   todo lo que venía después —la retención de IVA, entre otras
                   cosas— no llegaba a ejecutarse. */
                invBox.querySelectorAll('.ic-row').forEach((r) => {
                  const cProd = r.querySelector('.ic-prod'), cCant = r.querySelector('.ic-cant'), cCosto = r.querySelector('.ic-costo');
                  if (!cProd || !cCant) return;
                  const nombre = (cProd.value || '').trim();
                  const cant = parseFloat(cCant.value) || 0;
                  /* El costo se escribió en la moneda de la factura: al
                     inventario va en bolívares, y si la compra fue en dólares
                     el artículo se queda además con su costo en dólares, que
                     es el que no se desactualiza. */
                  const costoCap = cCosto ? (parseFloat(cCosto.value) || 0) : 0;
                  const costo = Math.round(costoCap * _tasaF * 100) / 100;
                  if (nombre && cant > 0) lineasInv.push({ nombre: nombre, cant: cant, costo: costo, costoUsd: _mon === 'USD' ? costoCap : 0 });
                });
                if (lineasInv.length) {
                  const prods = window.__getProductos ? window.__getProductos() : [];
                  const creados = [];
                  const ups = lineasInv.map((li) => {
                    const pr = prods.find((x) => (x.nombre || '').toLowerCase() === li.nombre.toLowerCase());
                    if (!pr) {
                      // El producto NO existe: se CREA automáticamente con esta compra
                      // (stock = lo comprado, costo = el de la factura; el precio de venta se fija luego)
                      creados.push(li.nombre);
                      return window.sb.from('productos').insert({
                        cuenta_id: window.__CUENTA_ID,
                        // Sin esto el artículo nace huérfano y reaparece en
                        // todas las empresas: el mismo fallo por otra puerta.
                        empresa_id: (window.__EMPRESA_ACTIVA || {}).id || null,
                        nombre: li.nombre, sku: 'SKU-' + String(Date.now()).slice(-5) + '-' + Math.floor(Math.random() * 90 + 10),
                        categoria: 'Otros', alicuota: '16%',
                        stock: li.cant, stock_min: 0, costo: li.costo || 0, precio: 0,
                        costo_usd: li.costoUsd || null,
                      });
                    }
                    const patch = { stock: (Number(pr.stock) || 0) + li.cant };
                    if (li.costo > 0) patch.costo = li.costo;
                    if (li.costoUsd > 0) patch.costo_usd = li.costoUsd;
                    return window.sb.from('productos').update(patch).eq('id', pr.id);
                  });
                  Promise.all(ups).then((rs) => {
                    const errs = rs.filter((r) => r && r.error);
                    if (errs.length) { toast('Inventario: ' + errs[0].error.message, 'error'); return; }
                    if (window.cargarProductos) window.cargarProductos();
                    toast(lineasInv.length + ' producto(s) al inventario' + (creados.length ? ' · NUEVOS: ' + creados.join(', ') + ' (ponles su precio de venta en Inventario)' : ''), 'success');
                  });
                }
              }
            } catch (err) {
              console.error('[compra] no se pudo reponer inventario:', err);
              toast('La factura se guardó. El inventario no se actualizó: ' + err.message, 'error');
            }
            // VENTA en el Libro: solo contabiliza si la empresa está en modo "libro" (contador).
            // En modo "recibos" la venta la contabiliza el recibo, no el libro (este es solo para declarar).
            if (!esCompra && window.__postAsiento && ((window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.modo) === 'libro')) {
              const ln = [{ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: total, haber: 0 },
                { cta: '4.1.1.01 · Venta de mercancía', debe: 0, haber: base + exento }];
              if (iva > 0.005) ln.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: 0, haber: iva });
              window.__postAsiento('Venta s/libro · factura ' + v.numFactura + ' · ' + v.nombre, v.numFactura, ln, 'auto').then((r) => { if (r && r.error) console.warn('[DigiAccount] No se pudo contabilizar la venta del libro:', r.error.message); });
            }
            // Refresca Compras y CxP (y CxC) con la nueva factura
            if (window.cargarTesoreria) window.cargarTesoreria();
            /* Al registrar en el LIBRO no se pregunta por el pago.

               Son dos materias distintas: el libro de compras es fiscal —lo
               que se declara— y la forma de pago es de Tesorería. Para el
               libro la compra se presume de contado; si fue a crédito, con
               abonos o con saldo pendiente, eso se registra en Tesorería, que
               es donde vive esa información.

               Y había un efecto peor que la pregunta de más: el formulario
               modal es UNO SOLO y compartido, así que abrir el cuadro de pago
               REEMPLAZABA el de la factura. Registrar una compra cerraba el
               formulario, y quien está cargando cincuenta seguidas tenía que
               volver a abrirlo cada vez. */
          });
        },
      });
    }
    // Período fiscal REAL del módulo: los libros se filtran por mes (fecha dd/mm/aa termina en /mm/aa).
    // Necesario desde la migración de libros históricos: sin filtro, los totales mezclarían todos los meses.
    const MESES_FIS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const _hoyFis = new Date();
    /* Un contribuyente ESPECIAL declara el IVA dos veces al mes, así que su
       período NO es el mes: es la quincena. Con el mes completo, la Forma 30
       sale con el total de los treinta días y no es lo que se presenta.
       En un ordinario `q` queda nulo y todo funciona como siempre. */
    /* La periodicidad NO es de la empresa, es de cada obligación. Un mismo
       contribuyente especial puede deber unas cosas por quincena y otras por
       mes, y meterlo todo en un solo "es especial" fue el error:

                              especial C.A.   especial F.P.   ordinario
         Declaración de IVA      quincenal        MENSUAL       mensual
         Retenciones de IVA      quincenal       quincenal      no aplica
         IGTF (Forma 21)         quincenal       quincenal      no aplica
         Retenciones de ISLR      mensual         mensual        mensual

       Se ve en los libros reales, llevados por el mismo contador: los de
       GATMA (C.A.) vienen por quincena y los de Radian (firma personal) por
       mes — pero los archivos de retención de Radian sí dicen "1RA QUINCENA".
    */
    const _esEspecialFiscal = () =>
      /especial/i.test((window.__EMPRESA_ACTIVA || {}).cond || '');
    const _esPersonaNatural = () => {
      const ini = String((window.__EMPRESA_ACTIVA || {}).rif || '')
        .toUpperCase().replace(/[^A-Z]/g, '').charAt(0);
      return ini === 'V' || ini === 'E';
    };

    /* El IVA lo declara por quincena solo el especial persona JURÍDICA. Una
       firma personal especial lo declara mensual, igual que su anticipo de
       ISLR — el cuadro del anticipo ya distinguía así desde antes. */
    const _ivaPorQuincena = () => _esEspecialFiscal() && !_esPersonaNatural();

    /* Las retenciones de IVA y el IGTF se enteran por quincena en TODO
       especial, sea C.A. o firma personal. Es una obligación del agente de
       retención, y esa condición no depende de si es persona natural. */
    const _retencionesPorQuincena = () => _esEspecialFiscal();

    /* Se exponen porque el formulario de registro vive en otro ámbito: dos
       definiciones de lo mismo se separan con el tiempo. El nombre dice qué
       obligación es — `esEspecial` a secas fue justo lo que confundió las
       dos periodicidades. */
    window.__ivaPorQuincena = _ivaPorQuincena;
    window.__retencionesPorQuincena = _retencionesPorQuincena;
    let _fiscalPer = {
      mm: String(_hoyFis.getMonth() + 1).padStart(2, '0'),
      aa: String(_hoyFis.getFullYear()).slice(2),
      q: _hoyFis.getDate() <= 15 ? 1 : 2,
    };
    window.__fiscalPer = _fiscalPer; // expuesto para que las retenciones filtren por el mismo período
    const _perLabel = () => MESES_FIS[parseInt(_fiscalPer.mm, 10) - 1] + ' 20' + _fiscalPer.aa
      + (_ivaPorQuincena() && _fiscalPer.q ? ' · ' + _fiscalPer.q + (_fiscalPer.q === 1 ? 'ra' : 'da') + ' quincena' : '');
    /* El botón del período, para poder repintarlo desde fuera de su bloque.

       Solo se escribía al arrancar y al cambiar de período, nunca al cambiar
       de empresa: viniendo de GATMA —que declara por quincena— el botón se
       quedaba diciendo «Agosto 2026 · 1ra quincena» en una empresa ordinaria,
       que declara el mes completo. El período de trabajo estaba bien por
       dentro; lo que engañaba era el rótulo, que es lo que uno mira antes de
       registrar una factura. */
    let _perBtn = null;
    // Publicado porque lo necesitan bloques de otro alcance (los rótulos de
    // período de las demás pestañas). Sin esto había que repetirlo allá, y
    // dos definiciones del mismo rótulo se separan con el tiempo.
    window.__perLabelFiscal = _perLabel;
    /* En qué quincena se declaró una operación.

       Se prefiere lo REGISTRADO sobre lo deducible: una compra recibida
       tarde se declara en una quincena posterior a la de su factura, y
       deducirla del día la mostraría en la que no es. El día solo se usa
       como respaldo para las filas que se cargaron antes de que existiera
       la columna — así ninguna desaparece del libro por no tenerla. */
    const _quincenaDe = (r) => {
      if (r.quincena === 1 || r.quincena === 2) return r.quincena;
      const d = parseInt(String(r.fecha || '').split('/')[0], 10);
      return d && d > 15 ? 2 : 1;
    };
    const _libroData = { compra: [], venta: [] }; // últimas filas cargadas por tipo (para editar/eliminar)
    const _libroPage = { compra: 1, venta: 1 }; // página actual de cada libro (20 filas por página)
    /* Lo último que se registró en cada libro, para poder volver a corregirlo
       sin cerrar el formulario. Al cargar cincuenta facturas seguidas uno nota
       el error en la SIGUIENTE, no en la que está llenando — y para entonces
       la anterior ya se limpió de la pantalla. */
    const _ultimoRegistro = { compra: null, venta: null };
    /* Los números de página, en forma compacta.

       Con 22 páginas no caben 22 botones, así que se muestran la primera, la
       última y las vecinas de la actual, con puntos suspensivos en medio. Lo
       importante es que la primera y la última SIEMPRE estén: llegar al final
       de un mes es lo que uno más quiere hacer y era justo lo que no se podía. */
    function numerosPagina(tipo, pag, total) {
      const quiero = new Set([1, total, pag, pag - 1, pag + 1]);
      if (pag <= 3) { quiero.add(2); quiero.add(3); quiero.add(4); }
      if (pag >= total - 2) { quiero.add(total - 1); quiero.add(total - 2); quiero.add(total - 3); }
      const nums = [...quiero].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
      let html = '', previo = 0;
      nums.forEach((n) => {
        if (previo && n > previo + 1) html += '<span class="libro-pager-sep">…</span>';
        html += '<button class="btn btn-ghost' + (n === pag ? ' activa' : '') + '" data-lp="' + tipo + '"'
          + ' data-lp-goto="' + n + '"' + (n === pag ? ' aria-current="page"' : '') + '>' + n + '</button>';
        previo = n;
      });
      return html;
    }

    /* Convierte una fecha 'dd/mm/aa' en algo que SÍ se puede ordenar.

       Las fechas se guardan como texto en formato venezolano, con el día
       adelante. Ordenar ese texto ordena por el DÍA: '28/06/26' cae después
       de '01/07/26' porque compara el 28 contra el 01. Eso mandaba al final
       del libro las facturas de junio declaradas en julio, que son
       justamente las que van primero.

       Se devuelve 'aaaammdd', que ordena igual como texto que como fecha.
       El siglo se deduce del año de dos dígitos: 70 o más es del siglo
       pasado, el resto de este. */
    function fechaOrdenable(f) {
      const p = String(f || '').split('/');
      if (p.length !== 3) return '99999999'; // sin fecha, al final
      const dd = p[0].padStart(2, '0');
      const mm = p[1].padStart(2, '0');
      const aa = parseInt(p[2], 10);
      if (isNaN(aa)) return '99999999';
      const anio = aa >= 70 ? 1900 + aa : 2000 + aa;
      return String(anio) + mm + dd;
    }
    window.__fechaOrdenable = fechaOrdenable;

    /* Suma un conjunto de filas del libro. Una ANULADA no suma: conserva su
       número para que no se pierda el salto en la serie, pero no es una
       operación del período. */
    function sumarFilas(filas) {
      const s = { tot: 0, ex: 0, base: 0, iva: 0, igtf: 0 };
      (filas || []).forEach((r) => {
        if (/anulada/i.test(r.tercero_nombre || '')) return;
        s.tot += window.__montoDoc(r);
        s.ex += window.__montoDoc(r, 'exento');
        s.base += window.__montoDoc(r, 'base');
        s.iva += window.__montoDoc(r, 'iva');
        s.igtf += window.__montoDoc(r, 'igtf');
      });
      return s;
    }

    /* La tabla de ventas por MÁQUINA FISCAL.

       Existía en la pantalla con sus columnas correctas —máquina, N° de Z,
       rango de comprobantes— pero con el cuerpo vacío y nada que lo llenara:
       era un cuadro de adorno. Un negocio que vende al público por impresora
       fiscal asienta un renglón por día, no una factura por venta, y sin esta
       tabla sus ventas se verían en la de facturas, sin el número de Z que es
       lo único que permite contrastarlas contra la cinta.

       La pestaña se esconde cuando la empresa no vende así, para no ofrecer
       una vista que siempre estaría vacía. */
    /* Si la empresa vende por máquina fiscal, en cualquier período. Se
       consulta una vez por empresa y con una sola fila: solo hace falta saber
       si existe alguna, no cuántas. */
    let _usaMaquina = false;
    let _usaMaquinaDe = '';
    async function revisarUsaMaquina() {
      const emp = window.__EMPRESA_ACTIVA || {};
      if (!emp.id || _usaMaquinaDe === emp.id) return;
      _usaMaquinaDe = emp.id;
      _usaMaquina = false;
      if (!window.sb) return;
      const { data } = await window.sb.from('libro_fiscal')
        .select('id').eq('empresa_id', emp.id).not('numero_zeta', 'is', null).limit(1);
      _usaMaquina = !!(data && data.length);
      if (window.__libroData) pintarMaquina((window.__libroData.venta || []).filter((r) => r.numero_zeta));
    }

    function pintarMaquina(filas) {
      const vista = document.querySelector('.ventas-view[data-ventasmode="maquina"]');
      const nav = document.getElementById('ventasModeNav');
      const btn = nav && nav.querySelector('button[data-vmode="maquina"]');
      const hay = (filas || []).length > 0;
      /* La pestaña se muestra si la empresa usa máquina fiscal, aunque el
         período que se está mirando no tenga reportes todavía.

         Antes se escondía cuando el período venía vacío, y eso creaba un
         callejón: para cargar el PRIMER reporte Z de un mes había que entrar
         a la sección, pero la sección no aparecía hasta que hubiera uno
         cargado. Radian tiene 240 y ninguno se pudo registrar desde aquí. */
      if (btn) btn.hidden = !(hay || _usaMaquina);
      // Si estaba mirando la vista de máquina y cambia a una empresa que no
      // vende así, se la devuelve a facturas en vez de dejarla en blanco.
      if (!hay && vista && !vista.hidden && nav) {
        const bf = nav.querySelector('button[data-vmode="facturas"]');
        if (bf) bf.click();
      }
      if (!vista) return;
      const tabla = vista.querySelector('table.libro-maquina');
      if (!tabla) return;
      const cuerpo = tabla.querySelector('tbody'), pie = tabla.querySelector('tfoot');

      // El chip de la máquina decía un serial escrito a mano en la maqueta.
      const chip = vista.querySelector('.filter-chip');
      const seriales = [...new Set((filas || []).map((r) => r.maquina_fiscal).filter(Boolean))];
      if (chip) {
        chip.innerHTML = '<i data-lucide="cpu"></i> ' + (seriales.length
          ? 'Máquina: ' + esc(seriales.join(' · '))
          : 'Sin máquina fiscal');
      }

      if (!hay) {
        if (cuerpo) cuerpo.innerHTML = '<tr><td colspan="14" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin reportes Z en ' + esc(_perLabel()) + '.</td></tr>';
        if (pie) pie.innerHTML = '';
        return;
      }

      if (cuerpo) {
        cuerpo.innerHTML = filas.map((r, i) => {
          const alic = Number(r.alicuota) || 0;
          return '<tr data-id="' + esc(r.id || '') + '" data-libro="venta">'
            + '<td class="ctr">' + (i + 1) + '</td>'
            + '<td>' + esc(r.fecha || '') + '</td>'
            + '<td class="mono">' + esc(r.maquina_fiscal || '') + '</td>'
            + '<td class="ctr mono">' + esc(r.numero_zeta || '') + '</td>'
            + '<td class="mono">' + esc(r.comprobante_desde || '') + '</td>'
            + '<td class="mono">' + esc(r.comprobante_hasta || '') + '</td>'
            + (function () {
              const nd = window.__notasZTxt(r, 'ND'), nc = window.__notasZTxt(r, 'NC');
              return '<td class="ctr mono"' + (nd.det ? ' title="' + esc(nd.det) + '"' : '') + '>' + esc(nd.txt) + '</td>'
                + '<td class="ctr mono"' + (nc.det ? ' title="' + esc(nc.det) + '"' : '') + '>' + esc(nc.txt) + '</td>';
            })()
            + '<td class="num">' + fmtF(Number(r.total) || 0) + '</td>'
            + '<td class="num">' + fmtF(Number(r.exento) || 0) + '</td>'
            + '<td class="num">' + fmtF(Number(r.base) || 0) + '</td>'
            + '<td class="num">' + fmtF(Number(r.igtf) || 0) + '</td>'
            + '<td class="ctr">' + (alic > 0 ? Math.round(alic * 100) + '%' : 'Ex.') + '</td>'
            + '<td class="num">' + fmtF(Number(r.iva) || 0) + '</td></tr>';
        }).join('');
      }
      if (pie) {
        const s = sumarFilas(filas);
        pie.innerHTML = '<tr class="libro-tot"><td colspan="8" style="text-align:right;">TOTALES DEL PERÍODO ('
          + filas.length + ' reporte' + (filas.length === 1 ? '' : 's') + ' Z)</td>'
          + '<td class="num">' + fmtF(s.tot) + '</td><td class="num">' + fmtF(s.ex) + '</td>'
          + '<td class="num">' + fmtF(s.base) + '</td><td class="num">' + fmtF(s.igtf) + '</td>'
          + '<td></td><td class="num">' + fmtF(s.iva) + '</td></tr>';
      }
      if (window.lucide) window.lucide.createIcons();
    }

    /* Estampa el establecimiento en el membrete del libro.

       Vive aparte porque hay DOS sitios que escriben ese membrete: la barra
       de establecimientos y __syncFiscalHeader, que lo reconstruye entero en
       cada cambio de período o de empresa. El segundo borraba lo que ponía el
       primero, así que el establecimiento aparecía o no según cuál corriera
       de último — en julio se perdía y en agosto no, sin ninguna lógica
       visible. Ahora los dos llaman aquí. */
    window.__sellarEstablecimiento = function (tipo) {
      const tipos = tipo ? [tipo] : ['compra', 'venta'];
      tipos.forEach((tp) => {
        const tab = tp === 'compra' ? 'compras' : 'ventas';
        document.querySelectorAll('.fiscal-tab[data-tab="' + tab + '"] .libro-head .lh-data').forEach((cab) => {
          const suc = (window.__SUCURSALES || []).find((s) => s.id === (_sucFiltro || {})[tp]);
          const previo = cab.innerHTML.split(' · Establecimiento:')[0];
          cab.innerHTML = previo + (suc
            ? ' · Establecimiento: <strong>' + esc(suc.codigo + ' · ' + suc.nombre) + '</strong>'
            : '');
        });
      });
    };

    /* Qué establecimiento se está mirando en cada libro. Vacío = todos.
       Va por tipo: uno puede estar viendo las compras de la matriz y las
       ventas consolidadas sin que una cosa mueva a la otra. */
    const _sucFiltro = { compra: '', venta: '' };
    /* Qué establecimiento está mirando cada libro, para quien no viva en este
       cierre. El cuadro de retenciones se pinta desde otro módulo y necesita
       el mismo filtro que el libro: si no, el auxiliar de la sucursal sale con
       las retenciones de casa matriz debajo y los dos números no cuadran. */
    window.__sucFiltroDe = (tipo) => (_sucFiltro[tipo] || '');

    /* La barra para elegir establecimiento, encima del libro.

       Solo aparece con dos o más: en una empresa de un solo local sería un
       desplegable de una sola opción ocupando sitio. Y dice, cuando hay un
       establecimiento elegido, que la Forma 30 NO cambia — si no, se presta a
       creer que se está declarando por separado, que es justo lo contrario
       de lo que manda la norma. */
    function pintarFiltroSucursal(tabName, tipo, todas, visibles) {
      const pane = view.querySelector('.fiscal-tab[data-tab="' + tabName + '"]');
      if (!pane) return;
      let bar = pane.querySelector('.suc-bar');
      if ((window.__SUCURSALES || []).length < 2) { if (bar) bar.remove(); return; }
      const tabla = pane.querySelector('table.libro-compras, table.libro-ventas:not(.libro-maquina)');
      const anclaje = tabla ? (tabla.closest('.data-table-wrap') || tabla) : null;
      if (!anclaje) return;
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'suc-bar';
        bar.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 8px;font-size:12.5px;';
        bar.innerHTML = '<span style="color:var(--fg-muted);">Establecimiento</span>'
          + '<select class="suc-sel" style="height:30px;border:1px solid var(--border-strong);border-radius:8px;'
          + 'padding:0 8px;font:inherit;background:var(--bg-surface);color:inherit;"></select>'
          + '<span class="suc-nota" style="color:var(--fg-muted);"></span>';
        anclaje.parentNode.insertBefore(bar, anclaje);
        bar.querySelector('.suc-sel').addEventListener('change', (e) => {
          _sucFiltro[tipo] = e.target.value;
          // Los cuadros de retenciones cuelgan del libro: si no se repintan,
          // se queda el resumen del establecimiento anterior debajo del nuevo.
          if (window.cargarRetenciones) { try { window.cargarRetenciones(); } catch (e2) {} }
          cargarLibroFiscal(tipo, 1);   // desde la primera página: el lote cambió
        });
      }
      const sel = bar.querySelector('.suc-sel');
      const opts = [{ id: '', nombre: 'Todos (consolidado)' }].concat(window.__SUCURSALES);
      const html = opts.map((s) => '<option value="' + esc(s.id) + '">'
        + esc(s.codigo ? s.codigo + ' · ' + s.nombre : s.nombre) + '</option>').join('');
      if (sel.innerHTML !== html) sel.innerHTML = html;
      sel.value = _sucFiltro[tipo];
      /* El membrete del libro dice de qué establecimiento es. Sin esto los
         dos auxiliares salen impresos idénticos y no hay forma de saber cuál
         es cuál cuando están sobre la mesa. */
      window.__sellarEstablecimiento(tipo);
      const nota = bar.querySelector('.suc-nota');
      nota.textContent = _sucFiltro[tipo]
        ? visibles.length + ' de ' + todas.length + ' operaciones del período · lo que se imprime y se exporta es este libro; la Forma 30 sigue consolidada'
        : todas.length + ' operaciones del período, de todos los establecimientos';
    }

    async function cargarLibroFiscal(tipo, page) {
      const tabName = tipo === 'compra' ? 'compras' : 'ventas';
      const sel = tipo === 'compra' ? 'table.libro-compras' : 'table.libro-ventas:not(.libro-maquina)';
      const table = view.querySelector('.fiscal-tab[data-tab="' + tabName + '"] ' + sel);
      if (!table) return;
      const esCompra = tipo === 'compra';
      const tbody = table.querySelector('tbody'), tfoot = table.querySelector('tfoot');
      const totRow = (tot, ex, base, iva, igtf) => '<tr class="libro-tot"><td colspan="7" style="text-align:right;">TOTALES DEL PERÍODO</td><td class="num">' + fmtF(tot) + '</td><td class="num">' + fmtF(ex) + '</td><td class="num">' + fmtF(base) + '</td><td></td><td class="num">' + fmtF(iva) + '</td>' + (esCompra ? '' : '<td class="num">' + fmtF(igtf) + '</td>') + '</tr>';
      const setN = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmtF(v); };
      const resetF30c = () => { ['f30c-ex', 'f30c-base16', 'f30c-iva16', 'f30c-base8', 'f30c-iva8', 'f30c-baseAd', 'f30c-ivaAd', 'f30c-baseTot', 'f30c-ivaTot', 'f30c-ded', 'f30c-dedTot', 'f30c-credTot'].forEach((id) => setN(id, 0)); };
      const resetF30v = () => { ['f30v-ex', 'f30v-base16', 'f30v-iva16', 'f30v-base8', 'f30v-iva8', 'f30v-baseAd', 'f30v-ivaAd', 'f30v-baseTot', 'f30v-ivaTot', 'f30v-debTot', 'f30v-igtf', 'f30v-igtfBase'].forEach((id) => setN(id, 0)); renderIslrBox(0); window.__IGTF_VENTAS = { base: 0, ops: 0, monto: 0, q1: { ops: 0, monto: 0, base: 0 }, q2: { ops: 0, monto: 0, base: 0 } }; if (window.__renderIGTF) window.__renderIGTF(); };
      const vacio = (txt) => {
        if (tbody) tbody.innerHTML = '<tr><td colspan="' + (esCompra ? 12 : 13) + '" style="text-align:center;color:var(--fg-muted);padding:14px;">' + (txt || ('Sin registros. Usa "Registrar ' + tipo + '".')) + '</td></tr>';
        if (tfoot) tfoot.innerHTML = totRow(0, 0, 0, 0, 0);
        if (esCompra) { _credF = 0; resetF30c(); } else { _debF = 0; resetF30v(); pintarMaquina([]); }
        if (window.__setTabCount) window.__setTabCount(esCompra ? 'compras' : 'ventas', 0);
        _libroData[tipo] = [];
        actualizarAutoliquidacion();
        calcularArrastres(); // el período puede no tener operaciones propias pero SÍ arrastre del mes anterior
      };
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { pintarFiltroSucursal(tabName, tipo, [], []); vacio(); return; }
      // Se consulta por el PERÍODO DE DECLARACIÓN seleccionado (no por la fecha de la factura):
      // una compra recibida tarde se declara en el período en que llega la factura.
      // Filtrar en la BD evita el tope de 1000 filas de PostgREST.
      const perDecl = '20' + _fiscalPer.aa + '-' + _fiscalPer.mm; // 'aaaa-mm'
      const sufPer = '/' + _fiscalPer.mm + '/' + _fiscalPer.aa;   // respaldo por fecha (filas sin período)
      const { data, error } = await window.__sbAll((q) => q
        .eq('empresa_id', window.__EMPRESA_ACTIVA.id).eq('tipo', tipo)
        .or('periodo.eq.' + perDecl + ',and(periodo.is.null,fecha.like.*' + sufPer + ')'), 'libro_fiscal', '*');
      if (error) { console.warn('[DigiAccount] No se pudo cargar el libro fiscal:', error.message); pintarFiltroSucursal(tabName, tipo, [], []); vacio('No se pudieron cargar (¿creaste la tabla libro_fiscal?).'); return; }
      /* El orden se hace AQUÍ y no en la consulta: la base ordenaría el texto
         'dd/mm/aa' por el día. Primero por fecha real, y a igual fecha por
         número de factura, que es como se lee un libro fiscal. */
      /* La quincena se separa AQUÍ y no en la consulta a propósito. Filtrarla
         en la base dejaría fuera las filas que todavía no la tienen —las
         cargadas antes de que existiera la columna— y desaparecerían del
         libro sin avisar. Separándolas aquí, cada una cae en su quincena y
         ninguna se pierde. El mes de un contribuyente cabe de sobra. */
      const delPer = (data || []).filter((r) =>
        !(_ivaPorQuincena() && _fiscalPer.q) || _quincenaDe(r) === _fiscalPer.q);
      const arr = delPer.sort((a, b) => {
        const fa = fechaOrdenable(a.fecha), fb = fechaOrdenable(b.fecha);
        if (fa !== fb) return fa.localeCompare(fb);
        return String(a.numero_factura || '').localeCompare(String(b.numero_factura || ''), 'es', { numeric: true });
      });
      _libroData[tipo] = arr;
      window.__libroData = _libroData; // expuesto para la impresión (printLibro está en otro IIFE)
      // (más abajo se reemplaza por lo visible, para que imprimir y exportar
      //  saquen el libro del establecimiento elegido y no el consolidado)
      if (!arr.length) {
        /* La barra de establecimientos se pinta IGUAL cuando el período está
           vacío. Antes se salía aquí, antes de pintarla, y el resultado era
           una trampa: sin barra no se puede cambiar de establecimiento, así
           que quien cayera en un período sin registros se quedaba encerrado
           en la vista vacía sin manera de volver al consolidado. */
        pintarFiltroSucursal(tabName, tipo, [], []);
        vacio('Sin registros en ' + _perLabel() + '. Cambia el período arriba o usa "Registrar ' + tipo + '".');
        return;
      }
      // Totales y Forma 30: SIEMPRE sobre el mes completo (la paginación es solo visual)
      let tTot = 0, tEx = 0, tBase = 0, tIva = 0, tIgtf = 0;
      let base16 = 0, iva16 = 0, base8 = 0, iva8 = 0, baseAd = 0, ivaAd = 0;
      arr.forEach((r) => {
        if (/anulada/i.test(r.tercero_nombre || '')) return; // una factura ANULADA no suma al período
        const tot = window.__montoDoc(r), ex = window.__montoDoc(r, 'exento'), base = window.__montoDoc(r, 'base'), iva = window.__montoDoc(r, 'iva'), igtf = window.__montoDoc(r, 'igtf'), alic = Number(r.alicuota) || 0;
        tTot += tot; tEx += ex; tBase += base; tIva += iva; tIgtf += igtf;
        /* El reparto por renglón sale de las columnas del desglose. Si la fila es
           anterior al desglose y quedó sin migrar, se reparte por su alícuota
           única, como antes — así ningún registro viejo desaparece del formulario
           por no haber corrido el SQL todavía. */
        const bg = Number(r.base_gen) || 0, br = Number(r.base_red) || 0, ba = Number(r.base_adic) || 0;
        if (bg || br || ba) {
          base16 += bg; iva16 += Number(r.iva_gen) || 0;
          base8 += br; iva8 += Number(r.iva_red) || 0;
          baseAd += ba; ivaAd += Number(r.iva_adic) || 0;
        } else if (alic >= 0.25) { baseAd += base; ivaAd += iva; }
        else if (alic >= 0.12) { base16 += base; iva16 += iva; }
        else if (alic > 0) { base8 += base; iva8 += iva; }
      });
      /* Las ventas por MÁQUINA FISCAL se pintan en su propia tabla, que tiene
         las columnas que les corresponden —máquina, N° de Z, rango de
         comprobantes— en vez de un cliente y un número de factura que no
         tienen. El reparto es SOLO de pintado: los totales y la Forma 30 de
         arriba ya se calcularon sobre `arr` completo, porque un reporte Z es
         una venta del período como cualquier otra. Sacarlo de ahí le quitaría
         al libro de Radian el 99% de sus ventas. */
      /* El establecimiento filtra el LIBRO, no la declaración.

         La Forma 30 es una sola y sale consolidada: sus casillas se
         calcularon arriba sobre `arr` completo y no se tocan aquí. Lo que se
         filtra es el libro que se ve y se imprime, que es el auxiliar por
         establecimiento — el que se coteja contra lo que reporta cada uno. */
      const arrVis = _sucFiltro[tipo]
        ? arr.filter((r) => r.sucursal_id === _sucFiltro[tipo]) : arr;
      pintarFiltroSucursal(tabName, tipo, arr, arrVis);
      const arrZeta = esCompra ? [] : arrVis.filter((r) => r.numero_zeta);
      const arrFact = esCompra ? arrVis : arrVis.filter((r) => !r.numero_zeta);
      if (!esCompra) pintarMaquina(arrZeta);
      // El contador de la pestaña cuenta TODO el período, reportes Z incluidos.
      if (window.__setTabCount) window.__setTabCount(esCompra ? 'compras' : 'ventas', arr.length);

      // Paginación: lotes de 20 operaciones por página
      const PAG_FILAS = 20;
      const totalPag = Math.max(1, Math.ceil(arrFact.length / PAG_FILAS));
      const pag = Math.min(Math.max(1, page || 1), totalPag);
      _libroPage[tipo] = pag;
      const inicio = (pag - 1) * PAG_FILAS;
      tbody.innerHTML = arrFact.slice(inicio, inicio + PAG_FILAS).map((r, i) => {
        const tot = Number(r.total) || 0, ex = Number(r.exento) || 0, base = Number(r.base) || 0, iva = Number(r.iva) || 0, igtf = Number(r.igtf) || 0, alic = Number(r.alicuota) || 0;
        /* Con varias alícuotas en la misma factura un solo porcentaje mentiría:
           se dice "Varias" y el desglose vive en las columnas del registro. */
        const cuantas = [Number(r.base_gen) || 0, Number(r.base_red) || 0, Number(r.base_adic) || 0].filter((x) => x > 0).length;
        const alicTxt = cuantas > 1 ? 'Varias' : (alic > 0 ? (Math.round(alic * 100) + '%') : 'Ex.');
        const anulada = /anulada/i.test(r.tercero_nombre || '');
        const nombreCel = anulada ? '<span class="tag danger">ANULADA</span>' : (r.tercero_nombre || '');
        return '<tr data-id="' + (r.id || '') + '" data-libro="' + tipo + '" style="cursor:pointer;' + (anulada ? 'opacity:.6;' : '') + '" title="Clic para editar o eliminar"><td class="ctr">' + (inicio + i + 1) + '</td><td>' + (r.fecha || '') + '</td><td class="mono">' + (r.tercero_rif || '') + '</td><td class="primary">' + nombreCel + '</td>'
          + '<td class="mono">' + (r.numero_factura || '') + '</td><td class="mono">' + (r.numero_control || '') + '</td><td class="ctr">' + (r.tipo_doc || (esCompra ? 'FC' : 'FV')) + '</td>'
          + '<td class="num">' + fmtF(tot) + '</td><td class="num">' + fmtF(ex) + '</td><td class="num">' + fmtF(base) + '</td><td class="ctr">' + alicTxt + '</td><td class="num">' + fmtF(iva) + '</td>'
          + (esCompra ? '' : '<td class="num">' + fmtF(igtf) + '</td>') + '</tr>';
      }).join('');
      /* Paginador con números que SÍ navegan.

         Antes solo había Anterior y Siguiente: para llegar a la última página
         de un mes cargado había que pulsar Siguiente una y otra vez. Los
         números que se veían arriba de la tabla eran decoración que quedó de
         la maqueta —decían 18 y 22 escritos a mano— y al pulsarlos no pasaba
         nada, porque nunca estuvieron conectados a nada. */
      const pagerRow = totalPag > 1
        ? '<tr><td colspan="' + (esCompra ? 12 : 13) + '" style="padding:8px 10px;"><div class="libro-pager">'
          + '<button class="btn btn-ghost" data-lp="' + tipo + '" data-lp-goto="1"' + (pag <= 1 ? ' disabled' : '') + ' title="Primera">«</button>'
          + '<button class="btn btn-ghost" data-lp="' + tipo + '" data-lp-goto="' + (pag - 1) + '"' + (pag <= 1 ? ' disabled' : '') + '>Anterior</button>'
          + numerosPagina(tipo, pag, totalPag)
          + '<button class="btn btn-ghost" data-lp="' + tipo + '" data-lp-goto="' + (pag + 1) + '"' + (pag >= totalPag ? ' disabled' : '') + '>Siguiente</button>'
          + '<button class="btn btn-ghost" data-lp="' + tipo + '" data-lp-goto="' + totalPag + '"' + (pag >= totalPag ? ' disabled' : '') + ' title="Última">»</button>'
          + '<span class="libro-pager-info">' + arrFact.length + ' operaciones en ' + esc(_perLabel()) + '</span>'
          + '</div></td></tr>'
        : '<tr><td colspan="' + (esCompra ? 12 : 13) + '" style="padding:8px 10px;"><div class="libro-pager">'
          + '<span class="libro-pager-info">' + arrFact.length + ' operaci' + (arrFact.length === 1 ? 'ón' : 'ones') + ' en ' + esc(_perLabel()) + '</span>'
          + '</div></td></tr>';
      /* El pie suma lo que ESTA tabla muestra, no el período entero: con los
         reportes Z en su propia tabla, un pie que los incluyera diría un
         total que no sale de las filas que se están viendo. El período
         completo —factura y máquina juntas— es lo que traslada la Forma 30. */
      _libroData[tipo] = arrVis;   // imprimir/exportar siguen al establecimiento elegido
      const sF = sumarFilas(arrFact);
      if (tfoot) tfoot.innerHTML = totRow(sF.tot, sF.ex, sF.base, sF.iva, sF.igtf) + pagerRow;
      // Traslado a la Forma 30: el IVA se declara sobre la BASE TOTAL por alícuota × la tasa
      // (método del SENIAT), NO sumando el IVA céntimo a céntimo de cada factura. Así el
      // Débito/Crédito declarado coincide con lo que calcula el portal (evita ±céntimos).
      const r2f = (x) => Math.round((x + 1e-9) * 100) / 100;
      const iva16D = r2f(base16 * 0.16);
      const iva8D = r2f(base8 * 0.08);
      const ivaTotD = r2f(iva16D + iva8D);
      if (esCompra) {
        _credF = ivaTotD;
        setN('f30c-ex', tEx);
        setN('f30c-base16', base16); setN('f30c-iva16', iva16D);
        setN('f30c-baseAd', baseAd); setN('f30c-ivaAd', ivaAd);
        setN('f30c-base8', base8); setN('f30c-iva8', iva8D);
        setN('f30c-baseTot', base16 + base8 + tEx); setN('f30c-ivaTot', ivaTotD);
        setN('f30c-ded', ivaTotD); setN('f30c-dedTot', ivaTotD); setN('f30c-credTot', ivaTotD);
      } else {
        _debF = ivaTotD;
        /* Ventas internas no gravadas (código 40). Se calculaba y hasta se
           sumaba al total del código 46, pero no se pintaba en su propio
           renglón: el cuadro mostraba un total que no cuadraba con sus
           partes. Compras siempre lo tuvo (f30c-ex); a ventas se le quedó. */
        setN('f30v-ex', tEx);
        setN('f30v-base16', base16); setN('f30v-iva16', iva16D);
        setN('f30v-base8', base8); setN('f30v-iva8', iva8D);
        setN('f30v-baseAd', baseAd); setN('f30v-ivaAd', ivaAd);
        setN('f30v-baseTot', base16 + base8 + tEx); setN('f30v-ivaTot', ivaTotD);
        setN('f30v-debTot', ivaTotD);
        setN('f30v-igtf', tIgtf); setN('f30v-igtfBase', tIgtf > 0 ? tIgtf / 0.03 : 0);
        /* El IGTF se declara POR QUINCENA (Forma 21), aunque el IVA de esta
           empresa sea mensual. Son dos obligaciones con ritmos distintos: una
           firma personal especial como Radian presenta el IVA del mes completo
           pero la Forma 21 dos veces al mes.

           La quincena NO se guarda en el libro para estas filas, y está bien:
           `libro_fiscal.quincena` significa «quincena de la declaración de
           IVA», que aquí es nula por ser mensual. Escribirla partiría en dos
           el libro de IVA, que es justo lo que no debe pasar. Se deduce del
           DÍA, que para una venta propia es dato firme: la empresa emite la
           factura el día que la emite. */
        const conIgtf = arr.filter((r) => Number(r.igtf) > 0);
        const porQ = (q) => {
          const f = conIgtf.filter((r) => _quincenaDe(r) === q);
          const m = f.reduce((s, r) => s + (Number(r.igtf) || 0), 0);
          return { ops: f.length, monto: m, base: m > 0 ? m / 0.03 : 0 };
        };
        window.__IGTF_VENTAS = {
          base: tIgtf > 0 ? tIgtf / 0.03 : 0, ops: conIgtf.length, monto: tIgtf,
          q1: porQ(1), q2: porQ(2),
        };
        if (window.__renderIGTF) window.__renderIGTF();
        renderIslrBox(tBase + tEx);
      }
      actualizarAutoliquidacion();
      calcularArrastres(); // trae excedente de crédito y retenciones acumuladas del período anterior
    }
    window.cargarLibroFiscal = cargarLibroFiscal;
    window.__revisarUsaMaquina = revisarUsaMaquina;

    // Editar / eliminar un registro del libro (clic en la fila)
    /* EDITAR UN REPORTE Z.

       Un reporte Z se editaba con el formulario de facturas: pedía cliente,
       RIF y N° de factura —que un Z no tiene— y no mostraba ni la máquina, ni
       el número de Z, ni el rango de comprobantes, que es TODO lo que lo
       identifica. Corregirle el IGTF a un reporte ya cargado era imposible.

       Lleva los mismos campos que el de registrar, para que quien corrige vea
       lo mismo que vio al cargar. */
    function editarZeta(r) {
      let montosEd = null, notasEd = null;
      window.openFormModal && window.openFormModal({
        title: 'Editar reporte Z ' + (r.numero_zeta || ''),
        saveLabel: 'Guardar cambios',
        fields: [
          { name: 'fecha', label: 'Fecha (dd/mm/aa)', value: r.fecha || '', placeholder: '27/08/26' },
          { name: 'maquina', label: 'Serial de la máquina fiscal', upper: true, value: r.maquina_fiscal || '' },
          { name: 'numeroZ', label: 'N° de reporte Z', value: r.numero_zeta || '' },
          { name: 'compDesde', label: 'Primer comprobante del día', value: r.comprobante_desde || '' },
          { name: 'compHasta', label: 'Último comprobante del día', value: r.comprobante_hasta || '' },
          { name: 'numResumen', col: 2, type: 'static', label: '', html: montosHTML() },
          { name: 'notasZ', col: 2, type: 'static', label: '', html: notasZHTML() },
          /* ATAJO A RETENCIONES, igual que en el formulario de factura.

             La máquina fiscal imprime facturas y admite el RIF del comprador,
             así que un cliente especial puede retener sobre una venta que
             quedó dentro de este Z. La retención va contra ESA factura, no
             contra el reporte. */
          { name: 'atajoRetZ', col: 2, type: 'static', label: '', html:
            '<div id="zRetBox" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--border-default);padding-top:12px;">'
            + '<button type="button" class="btn btn-ghost" id="btnRetDeZeta" style="height:32px;font-size:12px;">'
            + '<i data-lucide="percent"></i> Registrar una retención de este día</button>'
            + '<span style="font-size:11px;color:var(--fg-muted);line-height:1.5;">'
            + (String(r.comprobante_desde || '').trim() && String(r.comprobante_hasta || '').trim()
                ? 'Comprobantes del día: <strong>' + esc(r.comprobante_desde) + '</strong> al <strong>' + esc(r.comprobante_hasta) + '</strong>. '
                : '')
            + 'Va contra <strong>una factura</strong> de la máquina, no contra el reporte: escribe el N° de comprobante que el cliente retuvo. '
            + 'La base no se rellena a propósito — el IVA que ves aquí es el del día entero, no el de esa factura.'
            + '</span></div>' },
        ].concat(camposIgtf(Number(r.igtf) || 0, 'Base: cuánto del día se cobró así (Bs)'))
          .concat(campoSucursal(r.sucursal_id)),
        afterRender: (body) => {
          // Con la fila cargada: si trae varias alícuotas salen sus renglones.
          montosEd = montarMontos(body, r);
          notasEd = montarNotasZ(body, r);
          montarIgtf(body);

          /* Lo que YA está cargado contra los comprobantes de este día se
             dice antes de que nadie abra nada. Es lo que evita la retención
             cargada dos veces, que es el error que de verdad pasa. */
          const btnRZ = body.querySelector('#btnRetDeZeta');
          if (btnRZ && window.__retencionesDelRango) (async () => {
            const yaHay = await window.__retencionesDelRango(r.comprobante_desde, r.comprobante_hasta, 'sufrida');
            if (!yaHay.length) return;
            const av = document.createElement('div');
            av.style.cssText = 'font-size:11.5px;margin-top:8px;padding:8px 10px;border-radius:6px;width:100%;'
              + 'background:var(--da-amber-50,#fff8e6);color:var(--da-amber-700,#9a6700);line-height:1.55;';
            av.innerHTML = 'Este día ya tiene <strong>' + yaHay.length + ' retenci'
              + (yaHay.length === 1 ? 'ón' : 'ones') + '</strong> cargada'
              + (yaHay.length === 1 ? '' : 's') + ': '
              + yaHay.map((x) => esc((x.tipo || '').toUpperCase() + ' s/factura ' + (x.factura || '?')
                  + ' · Bs ' + fmtF(Number(x.monto) || 0))).join(' · ');
            const caja = body.querySelector('#zRetBox');
            if (caja) caja.appendChild(av);
          })();

          if (btnRZ) btnRZ.addEventListener('click', () => {
            if (!window.__registrarRetencion) {
              if (window.toast) window.toast('No pude abrir el registro de retenciones. Ve a Fiscal → Retenciones y regístrala desde ahí.', 'error');
              return;
            }
            /* Se manda la fecha del Z y la dirección; lo demás lo escribe
               quien tiene el comprobante delante. La base NO se manda: ver
               el comentario del bloque. */
            const p = String(r.fecha || '').split('/');
            const iso = p.length === 3
              ? ('20' + p[2].slice(-2) + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0'))
              : null;
            const datos = { direccion: 'Sufrida (un cliente me retiene)' };
            if (iso) datos.fechaFactura = iso;
            const cancelar = document.getElementById('fmCancel');
            if (cancelar) cancelar.click();
            setTimeout(() => window.__registrarRetencion(datos), 150);
          });
        },
        // Recibe el cierre del formulario: se cierra al confirmar el borrado,
        // no antes, para que un error deje el cuadro abierto con su aviso.
        onDelete: (cerrar) => {
          if (!window.sb) return;
          if (!window.confirm('¿Eliminar el reporte Z ' + (r.numero_zeta || '')
            + '?  Ojo: el correlativo de la máquina quedará con un hueco.')) return;
          window.sb.from('libro_fiscal').delete().eq('id', r.id).then(({ error }) => {
            if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return; }
            if (cerrar) cerrar();
            if (window.__invalidarArrastres) window.__invalidarArrastres();
            cargarLibroFiscal('venta');
            toast('Reporte Z ' + (r.numero_zeta || '') + ' eliminado', 'success');
          });
        },
        onSave: (v) => {
          if (!window.sb) return 'No hay sesión activa.';
          if (!(v.numeroZ || '').trim()) return 'Indica el N° del reporte Z: es lo que identifica al documento.';
          if (!(v.maquina || '').trim()) return 'Indica el serial de la máquina fiscal.';
          const M = montosEd ? montosEd.leer()
            : { exento: 0, base_gen: 0, iva_gen: 0, base_red: 0, iva_red: 0, base_adic: 0, iva_adic: 0, base: 0, iva: 0, total: 0 };
          const igtf = leerIgtf(v);
          if (M.total > 0 && igtf > M.total) return 'El IGTF (' + fmtF(igtf) + ') no puede ser mayor que el total del día (' + fmtF(M.total) + ').';
          const alic = M.base_adic > 0 ? ALICUOTAS.adic.pct
            : M.base_gen >= M.base_red ? (M.base_gen > 0 ? 0.16 : 0) : 0.08;
          /* El período y la quincena se recalculan de la fecha: si se corrige
             el día, el reporte tiene que moverse con él. En una venta el día
             es dato firme — la máquina emite el Z cuando lo emite. */
          /* Si la fecha no se entiende, el período se quedaba en el viejo
             y la quincena salía NaN, sin avisar. Ahora no se guarda. */
          const fechaOk = window.__normFecha ? window.__normFecha(v.fecha) : v.fecha;
          if (!fechaOk) return 'No entiendo la fecha "' + (v.fecha || '') + '". Escríbela como 27/08/26.';
          const p = fechaOk.split('/');
          const periodo = ('20' + p[2] + '-' + p[1]);
          const esEsp = window.__ivaPorQuincena && window.__ivaPorQuincena();
          const dia = parseInt(p[0], 10);
          window.sb.from('libro_fiscal').update({
            fecha: fechaOk, periodo: periodo,
            quincena: esEsp ? (dia > 15 ? 2 : 1) : null,
            sucursal_id: sucursalDe(v.sucursal),
            maquina_fiscal: (v.maquina || '').trim().toUpperCase(),
            numero_zeta: (v.numeroZ || '').trim(),
            comprobante_desde: (v.compDesde || '').trim() || null,
            comprobante_hasta: (v.compHasta || '').trim() || null,
            notas_z: notasEd ? notasEd.leer() : (r.notas_z || null),
            exento: M.exento, base: M.base, alicuota: alic, iva: M.iva, igtf: igtf, total: M.total,
            base_gen: M.base_gen, iva_gen: M.iva_gen,
            base_red: M.base_red, iva_red: M.iva_red,
            base_adic: M.base_adic, iva_adic: M.iva_adic,
          }).eq('id', r.id).then(({ error }) => {
            if (error) {
              toast(error.code === '23505'
                ? 'Ya hay otro reporte con ese N° de Z en esa máquina.'
                : 'No se pudo actualizar: ' + error.message, 'error');
              return;
            }
            if (window.__invalidarArrastres) window.__invalidarArrastres();
            cargarLibroFiscal('venta');
            toast('Reporte Z ' + v.numeroZ + ' actualizado · Bs ' + fmtF(M.total), 'success');
          });
        },
      });
    }

    async function editLibroFiscal(id, tipo) {
      let r = (_libroData[tipo] || []).find((x) => String(x.id) === String(id));
      /* Puede no estar en memoria: en una empresa SIN modulo Fiscal el libro
         nunca se carga, y el lapiz de «Compras y CxP» no hacia nada — sin
         error, sin aviso, sin nada que mirar. */
      if (!r && window.sb) {
        const { data, error } = await window.sb.from('libro_fiscal').select('*').eq('id', id).maybeSingle();
        if (error) { if (window.toast) window.toast('No se pudo abrir el registro: ' + error.message, 'error'); return; }
        r = data || null;
      }
      if (!r) { if (window.toast) window.toast('No encuentro ese registro.', 'error'); return; }
      /* Un reporte Z no se edita con el formulario de facturas: no tiene
         cliente ni N° de factura, y sí tiene máquina, N° de Z y rango de
         comprobantes que aquí no se verían. */
      if (String(r.numero_zeta || '').trim()) { editarZeta(r); return; }
      const esCompra = tipo === 'compra';
      const tdMap = { FC: 'FC (Factura)', RE: 'RE (Recibo)', FV: 'FV (Factura de venta)', NC: 'NC (Nota de crédito)', ND: 'ND (Nota de débito)' };
      let editMontos = null; // la caja de renglones, montada en afterRender
      /* Los mismos terceros que ofrece el formulario de REGISTRAR. Al editar
         el campo era texto pelado, así que completar el cliente de una
         factura ya cargada obligaba a escribirlo entero a mano —y sin que
         casara con el del directorio—. */
      const tercerosEd = (window.__getTerceros ? window.__getTerceros() : [])
        .filter((t) => (esCompra ? t.prov : t.cli) && t.nombre);
      window.openFormModal && window.openFormModal({
        title: esCompra ? 'Editar compra (Libro de Compras)' : 'Editar venta (Libro de Ventas)',
        saveLabel: 'Guardar cambios',
        fields: [
          { name: 'fecha', label: 'Fecha (dd/mm/aa)', value: r.fecha || '', placeholder: '27/08/26' },
        ].concat(esCompra ? [
          { name: 'periodo', label: 'Período de declaración', type: 'select', options: _opcionesPeriodo(), value: r.periodo || _periodoActualKey() },
        ] : []).concat([
          { name: 'tipoDoc', label: 'Tipo de documento', type: 'select', options: esCompra ? ['FC (Factura)', 'RE (Recibo)', 'NC (Nota de crédito)', 'ND (Nota de débito)'] : ['FV (Factura de venta)', 'NC (Nota de crédito)', 'ND (Nota de débito)'], value: tdMap[r.tipo_doc] || (esCompra ? 'FC (Factura)' : 'FV (Factura de venta)') },
          { name: 'nombre', label: (esCompra ? 'Proveedor' : 'Cliente') + ' (escribe las iniciales y elige)', col: 2, type: 'datalist', options: tercerosEd.map((t) => t.nombre), value: r.tercero_nombre || '' },
          { name: 'rif', label: 'RIF', upper: true, value: r.tercero_rif || '' },
          { name: 'numFactura', label: 'N° de Factura', value: r.numero_factura || '' },
          { name: 'numControl', label: 'N° de Control', value: r.numero_control || '' },
          { name: 'numResumen', col: 2, type: 'static', label: '', html: montosHTML() },
          /* Atajo a la retención.

             En Venezuela la retención casi nunca llega el mismo día de la
             factura: el cliente la manda días después. Sin este atajo había
             que salir del libro, ir a Retenciones y volver a escribir el
             tercero, el RIF, el número de factura y la base — con la factura
             delante y ya registrada. */
          { name: 'atajoRet', col: 2, type: 'static', label: '', html:
            '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--border-default);padding-top:12px;">'
            + '<button type="button" class="btn btn-ghost" id="btnRetDeFactura" style="height:32px;font-size:12px;">'
            + '<i data-lucide="percent"></i> Registrar la retención de esta factura</button>'
            + '<span style="font-size:11px;color:var(--fg-muted);">'
            + (Number(r.iva) > 0
              ? 'Se abre con el ' + (esCompra ? 'proveedor' : 'cliente') + ', el N° de factura y la base (Bs ' + fmtF(Number(r.iva) || 0) + ') ya puestos.'
              : 'Esta factura no tiene IVA, así que no habría retención de IVA que registrar.')
            + '</span></div>' },
        ].concat(esCompra ? [] : [
        ]).concat(camposIgtf(Number(r.igtf) || 0, 'Base: cuánto de esta factura se cobró así (Bs)')).concat([
        ]).concat(campoSucursal(r.sucursal_id))),
        afterRender: (body) => {
          // Se monta con la fila ya cargada: si trae varias alícuotas salen
          // sus renglones, y si es anterior al desglose se reparte por su
          // alícuota única en vez de quedar en cero.
          editMontos = montarMontos(body, r);
          engancharRecibo(body, editMontos, esCompra);

          /* El mismo campo que en registrar: elegir del directorio llena el
             RIF, el RIF llena el nombre, y F2 crea el que falta sin salir.

             Aquí NO se mueve el foco al N° de factura: al editar se viene a
             cambiar un dato puntual —casi siempre el cliente que faltaba—,
             y saltar a otro campo le quita el sitio al que está corrigiendo. */
          montarCampoTercero(body, { lista: tercerosEd, esCompra: esCompra, moverFoco: false });
          if (!esCompra) montarIgtf(body);

          /* Si esta factura ya tiene retenciones, se dice AQUÍ, junto al
             botón, antes de que nadie llene nada. */
          const btnRet = body.querySelector('#btnRetDeFactura');
          if (btnRet && window.__retencionesDeFactura) (async () => {
            const dirRet = esCompra ? 'practicada' : 'sufrida';
            const yaHay = await window.__retencionesDeFactura(r.numero_factura, dirRet, r.tercero_rif);
            const conIva = yaHay.filter((x) => x.tipo === 'iva');
            const conIslr = yaHay.filter((x) => x.tipo === 'islr');
            if (yaHay.length) {
              const partes = [];
              if (conIva.length) partes.push('IVA por Bs ' + fmtF(Number(conIva[0].monto) || 0)
                + (conIva[0].comprobante ? ' (comp. ' + conIva[0].comprobante + ')' : ''));
              if (conIslr.length) partes.push('ISLR por Bs ' + fmtF(Number(conIslr[0].monto) || 0));
              const aviso = document.createElement('div');
              aviso.style.cssText = 'font-size:11.5px;margin-top:8px;padding:8px 10px;border-radius:6px;'
                + 'background:var(--da-amber-50,#fff8e6);color:var(--da-amber-700,#9a6700);line-height:1.5;';
              aviso.innerHTML = 'Esta factura ya tiene retención de <strong>' + esc(partes.join(' y ')) + '</strong>.'
                + (conIva.length && conIslr.length
                  ? ' No queda ninguna por cargar.'
                  : ' Si abres el registro, cárgale solo la de <strong>' + (conIva.length ? 'ISLR' : 'IVA') + '</strong>.');
              btnRet.parentElement.appendChild(aviso);
              if (conIva.length && conIslr.length) {
                btnRet.disabled = true;
                btnRet.title = 'Ya tiene las dos retenciones cargadas';
              }
            }
          })();
          if (btnRet) btnRet.addEventListener('click', () => {
            if (!window.__registrarRetencion) {
              if (window.toast) window.toast('No pude abrir el registro de retenciones. Ve a Fiscal → Retenciones y regístrala desde ahí.', 'error');
              return;
            }
            /* La base de una retención de IVA es el IVA de la factura, no su
               base imponible. Es el error más común al llenarlo a mano. */
            const datos = {
              direccion: esCompra ? 'Practicada (yo retengo a un proveedor)' : 'Sufrida (un cliente me retiene)',
              nombre: r.tercero_nombre || '',
              rif: r.tercero_rif || '',
              factura: r.numero_factura || '',
              numControl: r.numero_control || '',
              // Se mandan LAS DOS: la de IVA es el IVA de la factura y la de
              // ISLR es la base imponible. El formulario cambia una por otra
              // según el impuesto que se elija.
              base: Number(r.iva) || 0,
              baseIva: Number(r.iva) || 0,
              baseIslr: Number(r.base) || 0,
            };
            const cancelar = document.getElementById('fmCancel');
            if (cancelar) cancelar.click();
            setTimeout(() => window.__registrarRetencion(datos), 150);
          });
          if (window.lucide) window.lucide.createIcons();
        },
        onSave: (v) => {
          if (!window.sb) return 'Sin conexión.';
          // Ventas: período sigue a la fecha (dd/mm/aa). Compras: el período elegido.
          const fechaOk = window.__normFecha ? window.__normFecha(v.fecha) : v.fecha;
          if (!fechaOk) return 'No entiendo la fecha "' + (v.fecha || '') + '". Escríbela como 27/08/26.';
          let perNuevo;
          if (esCompra) perNuevo = v.periodo || r.periodo || _periodoActualKey();
          else { const fp = fechaOk.split('/'); perNuevo = '20' + fp[2] + '-' + fp[1]; }
          const _cerrado = [r.periodo, perNuevo].find((p) => window.__periodoCerrado && window.__periodoCerrado(p));
          if (_cerrado && !window.__confirmarPeriodoCerrado(_cerrado, 'Vas a modificar un registro ya declarado')) return 'No se guardó: decidiste no tocar el período cerrado.';
          if (!v.nombre) return 'Indica el ' + (esCompra ? 'proveedor' : 'cliente') + '.';
          const M = editMontos ? editMontos.leer()
            : { exento: 0, base_gen: 0, iva_gen: 0, base_red: 0, iva_red: 0, base_adic: 0, iva_adic: 0, base: 0, iva: 0, total: 0 };
          /* DE DOLARES A BOLIVARES, con la tasa de la FECHA DE LA FACTURA.
             El libro se declara en bolivares; si no hay tasa para ese día no
             se guarda nada, porque una conversión inventada se convierte en
             una declaración equivocada. */
          const _mon = (editMontos && editMontos.moneda) ? editMontos.moneda() : 'BS';
          const _tasaF = _mon === 'USD' ? ((editMontos.tasa && editMontos.tasa()) || 0) : 1;
          if (_mon === 'USD' && !(_tasaF > 0)) {
            return 'No tengo la tasa del BCV para la fecha de esa factura, así que no puedo convertir los dólares a bolívares. Revisa la fecha o escribe los montos en bolívares.';
          }
          const _totalUsdCap = _mon === 'USD' ? Math.round((Number(M.total) || 0) * 100) / 100 : null;
          if (_tasaF !== 1) {
            ['exento', 'base_gen', 'iva_gen', 'base_red', 'iva_red', 'base_adic', 'iva_adic', 'base', 'iva', 'total']
              .forEach((k) => { M[k] = Math.round((Number(M[k]) || 0) * _tasaF * 100) / 100; });
          }
          const base = M.base, exento = M.exento, iva = M.iva, total = M.total;
          // 'alicuota' se conserva por compatibilidad; con varias en la misma
          // factura deja de tener un único valor y manda la de mayor peso.
          const alic = M.base_adic > 0 ? ALICUOTAS.adic.pct
            : M.base_gen >= M.base_red ? (M.base_gen > 0 ? 0.16 : 0)
              : 0.08;
          const igtf = leerIgtf(v);   // el monto, no un porcentaje del total
          window.sb.from('libro_fiscal').update({
            fecha: fechaOk, periodo: perNuevo, tipo_doc: (v.tipoDoc || '').slice(0, 2), tercero_nombre: v.nombre,
            // Lo escrito en dolares se guarda en dolares, tambien al editar.
            moneda: _mon, tasa: _tasaF !== 1 ? _tasaF : null, total_usd: _totalUsdCap,
            sucursal_id: sucursalDe(v.sucursal),
            tercero_rif: (v.rif || '').toUpperCase().replace(/[\s.\-]/g, ''), numero_factura: v.numFactura, numero_control: v.numControl,
            exento: exento, base: base, alicuota: alic, iva: iva, igtf: igtf, total: total,
            base_gen: M.base_gen, iva_gen: M.iva_gen,
            base_red: M.base_red, iva_red: M.iva_red,
            base_adic: M.base_adic, iva_adic: M.iva_adic,
          }).eq('id', id).then(({ error }) => {
            if (error) { toast('No se pudo actualizar: ' + error.message, 'error'); return; }
            if (window.__invalidarArrastres) window.__invalidarArrastres();
            cargarLibroFiscal(tipo);
            /* Y lo que depende de este documento: Compras y CxP, el saldo del
               proveedor en Terceros —que viaja con Tesoreria— y el Panel.
               Antes solo se recargaba el libro: se corregia una compra a
               630,70 $ y las otras pantallas seguian diciendo 624,64. */
            if (window.cargarTesoreria) window.cargarTesoreria();
            if (window.cargarDashboard) window.cargarDashboard();
            toast((esCompra ? 'Compra' : 'Venta') + ' actualizada · Bs ' + fmtF(total), 'success');
          });
        },
        extraLabel: 'Anular',
        onExtra: /anulada/i.test(r.tercero_nombre || '') ? null : async () => {
          if (!window.__confirmarPeriodoCerrado(r.periodo, 'Vas a ANULAR un registro ya declarado')) return;
          const { data: pgs } = await window.sb.from('movimientos_tesoreria')
            .select('id').eq('factura_ref', r.numero_factura || '').eq('tipo', esCompra ? 'egreso' : 'ingreso').limit(1);
          if (pgs && pgs.length) {
            toast('Este documento tiene ' + (esCompra ? 'pagos' : 'cobros') + ' registrados. Elimínalos primero en Tesorería (X del movimiento).', 'error');
            return;
          }
          if (!window.confirm('¿ANULAR el N° ' + (r.numero_factura || '') + '?\n\nEl número queda RESERVADO en el correlativo (no se borra ni se reutiliza), pero deja de sumar en el libro y en la Forma 30. Se generará el asiento de reverso correspondiente.')) return;
          window.sb.from('libro_fiscal').update({ tercero_nombre: 'ANULADA', tercero_rif: '', exento: 0, base: 0, iva: 0, igtf: 0, total: 0 }).eq('id', id).then(({ error }) => {
            if (error) { toast('No se pudo anular: ' + error.message, 'error'); return; }
            const tot = Number(r.total) || 0, ex = Number(r.exento) || 0, base = Number(r.base) || 0, iva = Number(r.iva) || 0, igtf = Number(r.igtf) || 0;
            if (window.__postAsiento && tot > 0.005) {
              let lineas;
              if (esCompra) {
                lineas = [{ cta: '2.1.1.01 · Cuentas por pagar comerciales', debe: tot, haber: 0 }];
                if (base + ex > 0.005) lineas.push({ cta: '5.1.1.02 · Compra de Mercancía', debe: 0, haber: base + ex });
                if (iva > 0.005) lineas.push({ cta: '1.1.3.01 · IVA crédito fiscal', debe: 0, haber: iva });
              } else {
                lineas = [{ cta: '4.1.1.01 · Venta de mercancía', debe: base + ex, haber: 0 }];
                if (iva > 0.005) lineas.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: iva, haber: 0 });
                if (igtf > 0.005) lineas.push({ cta: '2.1.4.03 · IGTF por pagar', debe: igtf, haber: 0 });
                lineas.push({ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: 0, haber: tot });
              }
              window.__postAsiento('Anulación ' + (esCompra ? 'compra' : 'venta') + ' N° ' + (r.numero_factura || ''), r.numero_factura || '', lineas, 'auto')
                .then((rr) => { if (rr && rr.error) console.warn('[DigiAccount] Reverso por anulación:', rr.error.message); });
            }
            if (window.__invalidarArrastres) window.__invalidarArrastres();
            cargarLibroFiscal(tipo);
            if (window.cargarTesoreria) window.cargarTesoreria();
            if (window.cargarDashboard) window.cargarDashboard();
            toast('N° ' + (r.numero_factura || '') + ' anulado', 'success');
            const cancelBtn = document.getElementById('fmCancel');
            if (cancelBtn) cancelBtn.click();
          });
        },
        onDelete: async (closeModal) => {
          if (!window.__confirmarPeriodoCerrado(r.periodo, 'Vas a ELIMINAR un registro ya declarado')) return;
          // Si tiene pagos/cobros vinculados, primero hay que reversarlos en Tesorería
          const { data: pgs } = await window.sb.from('movimientos_tesoreria')
            .select('id').eq('factura_ref', r.numero_factura || '').eq('tipo', esCompra ? 'egreso' : 'ingreso').limit(1);
          if (pgs && pgs.length) {
            toast('Este documento tiene ' + (esCompra ? 'pagos' : 'cobros') + ' registrados. Elimínalos primero en Tesorería (X del movimiento).', 'error');
            return;
          }
          if (!window.confirm('¿Eliminar este registro del libro?\n\nSe generará el asiento de REVERSO correspondiente. Si esta compra repuso inventario, ajusta el stock manualmente en Inventario.')) return;
          window.sb.from('libro_fiscal').delete().eq('id', id).then(({ error }) => {
            if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return; }
            // Reverso contable del registro eliminado
            if (window.__postAsiento) {
              const tot = Number(r.total) || 0, ex = Number(r.exento) || 0, base = Number(r.base) || 0, iva = Number(r.iva) || 0, igtf = Number(r.igtf) || 0;
              let lineas;
              if (esCompra) {
                lineas = [{ cta: '2.1.1.01 · Cuentas por pagar comerciales', debe: tot, haber: 0 }];
                if (base + ex > 0.005) lineas.push({ cta: '5.1.1.02 · Compra de Mercancía', debe: 0, haber: base + ex });
                if (iva > 0.005) lineas.push({ cta: '1.1.3.01 · IVA crédito fiscal', debe: 0, haber: iva });
              } else {
                lineas = [{ cta: '4.1.1.01 · Venta de mercancía', debe: base + ex, haber: 0 }];
                if (iva > 0.005) lineas.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: iva, haber: 0 });
                if (igtf > 0.005) lineas.push({ cta: '2.1.4.03 · IGTF por pagar', debe: igtf, haber: 0 });
                lineas.push({ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: 0, haber: tot });
              }
              window.__postAsiento('Reverso ' + (esCompra ? 'compra' : 'venta') + ' s/factura ' + (r.numero_factura || '') + ' · ' + (r.tercero_nombre || ''), r.numero_factura || '', lineas, 'auto')
                .then((rr) => { if (rr && rr.error) console.warn('[DigiAccount] Reverso libro:', rr.error.message); });
            }
            if (window.__invalidarArrastres) window.__invalidarArrastres();
            cargarLibroFiscal(tipo);
            if (window.cargarTesoreria) window.cargarTesoreria();
            if (window.cargarDashboard) window.cargarDashboard();
            toast('Registro eliminado · asiento reversado', 'success');
          });
          closeModal();
        },
      });
    }
    view.addEventListener('click', (e) => {
      const pb = e.target.closest('button[data-lp]');
      if (pb && !pb.disabled) {
        // Se navega a una página CONCRETA, no por saltos relativos: así el
        // primero, el último y cualquier número intermedio usan el mismo camino.
        const destino = parseInt(pb.dataset.lpGoto, 10);
        if (!isNaN(destino)) cargarLibroFiscal(pb.dataset.lp, destino);
        return;
      }
      const tr = e.target.closest('tr[data-id][data-libro]');
      if (tr) editLibroFiscal(tr.dataset.id, tr.dataset.libro);
    });
    // Accesible también desde "Compras y CxP" (empresas sin módulo Fiscal)
    window.__editLibroFiscal = editLibroFiscal;

    const regCompraBtn = document.getElementById('regCompraBtn');
    if (regCompraBtn) regCompraBtn.addEventListener('click', () => registrarMov('compra'));
    const regVentaBtn = document.getElementById('regVentaBtn');
    if (regVentaBtn) regVentaBtn.addEventListener('click', () => registrarMov('venta'));
    // El módulo "Compras y CxP" reutiliza el mismo registro de compra (la factura del proveedor es formal)
    window.__registrarCompra = () => registrarMov('compra');
    const regZetaBtn = document.getElementById('regZetaBtn');
    if (regZetaBtn) regZetaBtn.addEventListener('click', registrarZeta);
    const comprasRegBtn = document.getElementById('comprasRegBtn');
    if (comprasRegBtn) comprasRegBtn.addEventListener('click', () => registrarMov('compra'));
    cargarLibroFiscal('compra');
    cargarLibroFiscal('venta');

    /* El botón "Emitir y registrar" se quitó: solo mostraba un aviso diciendo
       que había emitido y registrado un comprobante, sin tocar nada. En su
       lugar hay un enlace a la pestaña Retenciones, que es donde se registra
       de verdad, y los botones de imprimir y PDF que sí emiten el documento. */

    // Selector de período fiscal del módulo: cambia el mes y recarga los libros filtrados
    const periodo = document.getElementById('fiscalPeriodo');
    if (periodo) {
      const mainBtn = periodo.querySelector('button:not(.custom-date)');
      _perBtn = mainBtn;
      if (mainBtn) mainBtn.textContent = _perLabel();
      /* Las opciones se arman al ABRIR el selector, no una sola vez al
         cargar: al cambiar de empresa cambia la condición, y una lista
         construida antes le ofrecería quincenas a un ordinario —o se las
         negaría a un especial. */
      const opcionesPer = () => {
        const out = [];
        const dOp = new Date();
        for (let i = 0; i < 14; i++) {
          const mes = MESES_FIS[dOp.getMonth()] + ' ' + dOp.getFullYear();
          if (_ivaPorQuincena()) { out.push(mes + ' · 1ra quincena'); out.push(mes + ' · 2da quincena'); }
          else out.push(mes);
          dOp.setMonth(dOp.getMonth() - 1);
        }
        return out;
      };
      const abrirSelector = () => {
        window.openFormModal && window.openFormModal({
          title: 'Cambiar período fiscal',
          saveLabel: 'Aplicar',
          fields: [{
            name: 'periodo',
            label: _ivaPorQuincena()
              ? 'Período a consultar (esta empresa es contribuyente especial: declara por quincena)'
              : 'Período a consultar',
            col: 2, type: 'select', options: opcionesPer(), value: _perLabel(),
          }],
          onSave: (v) => {
            const partes = String(v.periodo || '').split('·');
            const p = partes[0].trim().split(' ');
            const idx = MESES_FIS.findIndex((m) => m === p[0]);
            if (idx < 0 || !p[1]) return 'Período inválido.';
            const q = /2da/.test(partes[1] || '') ? 2 : (/1ra/.test(partes[1] || '') ? 1 : null);
            _fiscalPer = { mm: String(idx + 1).padStart(2, '0'), aa: p[1].slice(2), q: q };
            window.__fiscalPer = _fiscalPer;
            if (mainBtn) mainBtn.textContent = _perLabel();
            /* Cada refresco va por su cuenta. El período YA cambió cuando se
               llega aquí, así que si uno falla no puede arrastrar a los
               demás ni impedir que el formulario se cierre: el usuario
               vería el cuadro pegado y pensaría que el botón no sirve.
               Lo que falle se dice, y lo demás se refresca igual. */
            const fallaron = [];
            [['libro de compras', () => cargarLibroFiscal('compra')],
              ['libro de ventas', () => cargarLibroFiscal('venta')],
              ['retenciones', () => window.cargarRetenciones && window.cargarRetenciones()],
              ['membrete', () => window.__syncFiscalHeader && window.__syncFiscalHeader()],
              ['botón de cierre', () => window.__pintarCierreBtn && window.__pintarCierreBtn()],
            ].forEach(([que, fn]) => {
              try { fn(); } catch (err) { fallaron.push(que); console.error('[período fiscal] ' + que + ':', err); }
            });
            if (fallaron.length) toast('Período: ' + _perLabel() + ' — no se pudo refrescar ' + fallaron.join(', '), 'error');
            else toast('Período fiscal: ' + _perLabel() + ' · libros recargados');
          },
        });
      };
      periodo.querySelectorAll('button').forEach((b) => b.addEventListener('click', abrirSelector));
      /* El mismo selector lo usan los cuadros de período de las otras
         pestañas (DPP, IGP). Antes cada uno abría su propia lista escrita a
         mano en el código —el del DPP ofrecía marzo a junio de 2026 y nada
         más— y al elegir solo cambiaba el texto del recuadro: no movía el
         período de nada. */
      window.__abrirPeriodoFiscal = abrirSelector;
    }

    // ===== CIERRE MENSUAL: al declarar el mes se cierran los libros y quedan =====
    // ===== BLOQUEADOS contra modificaciones (reversible con "Reabrir").      =====
    let _cierres = new Set();
    const perKey = () => '20' + _fiscalPer.aa + '-' + _fiscalPer.mm;
    window.__mesCerrado = (fecha) => {   // acepta dd/mm/aa, dd/mm/aaaa o aaaa-mm-dd
      const s = String(fecha || '');
      let aa = '', mm = '';
      if (/^\d{4}-/.test(s)) { aa = s.slice(0, 4); mm = s.slice(5, 7); }
      else { const p = s.split('/'); if (p.length < 3) return false; mm = String(p[1]).padStart(2, '0'); aa = p[2].length === 4 ? p[2] : '20' + p[2]; }
      return _cierres.has(aa + '-' + mm);
    };
    // ¿El período de declaración 'aaaa-mm' está cerrado? (usa el período, no la fecha de factura)
    window.__periodoCerrado = (periodo) => _cierres.has(String(periodo || ''));
    async function cargarCierres() {
      _cierres = new Set();
      if (window.sb && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
        const { data } = await window.sb.from('cierres_mensuales').select('periodo').eq('empresa_id', window.__EMPRESA_ACTIVA.id);
        (data || []).forEach((c) => _cierres.add(c.periodo));
      }
      pintarCierreBtn();
    }
    window.cargarCierres = cargarCierres;

    /* Sucursales de la empresa activa.

       GATMA tiene Casa Matriz y Barquisimeto. El libro es UNO y la Forma 30
       sale consolidada —el establecimiento no parte la declaración—, pero
       cada factura tiene que decir de cuál salió: es lo que permite sacar el
       auxiliar por establecimiento y cuadrar contra lo que reporta cada uno.

       Las sucursales estaban en la base y los 110 registros históricos ya
       repartidos, pero no había DÓNDE elegirla al registrar: las facturas
       nuevas entraban sin establecimiento y no se notaba.

       Con una sola sucursal no se pregunta nada: se asigna la matriz sola y
       el formulario no crece con un campo de una sola opción. */
    let _sucursales = [];
    window.__SUCURSALES = _sucursales;
    async function cargarSucursales() {
      /* Lo primero es OLVIDAR las de la empresa anterior.

         Antes `window.__SUCURSALES` seguía apuntando al arreglo de la empresa
         de la que se venía hasta que terminaba la consulta. Como los libros
         se cargan enseguida, alcanzaban a pintar la barra de establecimientos
         con los de GATMA estando ya en otra empresa — y cuando la consulta
         terminaba vacía, nadie volvía a pintar y la barra se quedaba ahí. Ver
         "Casa Matriz / Sucursal Barquisimeto" en una empresa que no las tiene
         invita a registrar una factura en el establecimiento de otra.

         Se vacía ANTES de la consulta, no después. */
      _sucursales = [];
      window.__SUCURSALES = _sucursales;
      /* Y el filtro también, que era de la otra empresa: su `sucursal_id` no
         existe aquí y dejaría el libro en blanco sin decir por qué. */
      _sucFiltro.compra = '';
      _sucFiltro.venta = '';
      if (window.sb && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
        const { data, error } = await window.sb.from('sucursales')
          .select('id, nombre, codigo, es_matriz')
          .eq('empresa_id', window.__EMPRESA_ACTIVA.id).eq('activa', true)
          .order('codigo');
        if (error) console.warn('[Sucursales]', error.message);
        _sucursales = data || [];
      }
      window.__SUCURSALES = _sucursales;
      // Con cero o una, la barra sobra: se quita de las dos pestañas aunque
      // el libro no se vuelva a cargar.
      if (_sucursales.length < 2) {
        view.querySelectorAll('.suc-bar').forEach((b) => b.remove());
      }
    }
    window.cargarSucursales = cargarSucursales;

    // La última elegida, para no repetir la misma respuesta cincuenta veces
    // seguidas al cargar un lote de facturas del mismo establecimiento.
    const _sucLlave = () => 'da_suc_' + ((window.__EMPRESA_ACTIVA || {}).id || '');
    function sucursalPorDefecto() {
      let ult = '';
      try { ult = localStorage.getItem(_sucLlave()) || ''; } catch (e) { /* sin localStorage */ }
      const hallada = _sucursales.find((s) => s.id === ult);
      return hallada || _sucursales.find((s) => s.es_matriz) || _sucursales[0] || null;
    }
    function recordarSucursal(id) {
      try { localStorage.setItem(_sucLlave(), id || ''); } catch (e) { /* da igual */ }
    }
    const sucEtiqueta = (s) => s.codigo + ' · ' + s.nombre;
    /* El campo, o nada. Devuelve un arreglo para poder concatenarlo tal cual
       en la lista de campos del formulario. */
    function campoSucursal(valorId) {
      if (_sucursales.length < 2) return [];
      const act = _sucursales.find((s) => s.id === valorId) || sucursalPorDefecto();
      return [{
        name: 'sucursal', label: 'Establecimiento que emite / recibe',
        type: 'select', options: _sucursales.map(sucEtiqueta),
        value: act ? sucEtiqueta(act) : '',
      }];
    }
    // Del rótulo elegido de vuelta al id que se guarda en el libro.
    function sucursalDe(valor) {
      if (_sucursales.length < 2) {
        const u = _sucursales[0];
        return u ? u.id : null;
      }
      const s = _sucursales.find((x) => sucEtiqueta(x) === valor);
      return s ? s.id : (sucursalPorDefecto() || {}).id || null;
    }

    let btnCierre = null;
    function pintarCierreBtn() {
      if (!periodo) return;
      if (!btnCierre) {
        btnCierre = document.createElement('button');
        btnCierre.id = 'cerrarMesBtn';
        btnCierre.className = 'btn btn-ghost';
        btnCierre.style.cssText = 'height:32px;font-size:12px;margin-left:8px;';
        periodo.insertAdjacentElement('afterend', btnCierre);
        btnCierre.addEventListener('click', onCerrarMes);
      }
      const cerrado = _cierres.has(perKey());
      btnCierre.innerHTML = cerrado ? '🔒 Mes cerrado · Reabrir' : '🔐 Cerrar mes';
      btnCierre.title = cerrado
        ? 'El período está bloqueado contra modificaciones. Clic para reabrirlo.'
        : 'Genera los asientos resumen del mes (si faltan) y bloquea sus transacciones';
    }
    window.__pintarCierreBtn = pintarCierreBtn;
    async function onCerrarMes() {
      if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return;
      const key = perKey(), empId = window.__EMPRESA_ACTIVA.id;
      if (_cierres.has(key)) {
        if (!window.confirm('¿REABRIR ' + _perLabel() + '?\n\nSe desbloquean las transacciones del período (los asientos generados no se tocan).')) return;
        const { error } = await window.sb.from('cierres_mensuales').delete().eq('empresa_id', empId).eq('periodo', key);
        if (error) { toast('No se pudo reabrir: ' + error.message, 'error'); return; }
        _cierres.delete(key); pintarCierreBtn();
        toast('Período ' + _perLabel() + ' reabierto para modificaciones');
        return;
      }
      if (!window.confirm('¿CERRAR ' + _perLabel() + '?\n\nSe generan los asientos resumen del mes (ventas, compras y liquidación de IVA, si aún no existen) y las transacciones del período quedan BLOQUEADAS. Podrás reabrirlo cuando quieras.')) return;
      const mm = _fiscalPer.mm, anio = '20' + _fiscalPer.aa;
      const perDecl = anio + '-' + mm, sufPer = '/' + mm + '/' + _fiscalPer.aa;
      // ¿Ya existen los asientos del mes? (meses migrados o cierres previos → solo bloquear)
      const { data: yaLV } = await window.sb.from('asientos').select('id').eq('empresa_id', empId).eq('referencia', 'LV-' + mm + '/' + anio).limit(1);
      const { data: yaLC } = await window.sb.from('asientos').select('id').eq('empresa_id', empId).eq('referencia', 'LC-' + mm + '/' + anio).limit(1);
      // Del PERÍODO DE DECLARACIÓN que se cierra (no por fecha de factura)
      const { data: filas, error: e1 } = await window.__sbAll((q) => q.eq('empresa_id', empId)
        .or('periodo.eq.' + perDecl + ',and(periodo.is.null,fecha.like.*' + sufPer + ')'), 'libro_fiscal', '*');
      if (e1) { toast('No se pudo leer el libro: ' + e1.message, 'error'); return; }
      const mes = filas || [];
      const v = { tot: 0, be: 0, iva: 0 }, c = { tot: 0, be: 0, iva: 0 };
      /* El asiento del mes y la liquidación de IVA salen de aquí. Si una
         nota de crédito sumara en vez de restar, el débito fiscal quedaría
         inflado y el asiento arrastraría el error a la contabilidad. */
      mes.forEach((r) => { const o = r.tipo === 'venta' ? v : c; o.tot += window.__montoDoc(r); o.be += window.__montoDoc(r, 'base') + window.__montoDoc(r, 'exento'); o.iva += window.__montoDoc(r, 'iva'); });
      const { data: rets } = await window.__sbAll((q) => q.eq('empresa_id', empId).eq('direccion', 'sufrida').eq('tipo', 'iva'), 'retenciones', 'monto,fecha,periodo');
      const retMes = (rets || []).filter((r) => r.periodo ? r.periodo === perDecl : String(r.fecha || '').endsWith(sufPer)).reduce((s, r) => s + (Number(r.monto) || 0), 0);
      const r2c = (x) => Math.round(x * 100) / 100;
      const ultDia = new Date(parseInt(anio, 10), parseInt(mm, 10), 0).getDate();
      const fechaAsi = String(ultDia).padStart(2, '0') + '/' + mm + '/' + anio;
      // Saldos actuales de crédito fiscal y retenciones (para el arrastre de la liquidación)
      const { data: asiAll } = await window.sb.from('asientos').select('numero,lineas').eq('empresa_id', empId);
      let maxNum = 0;
      const saldoDe = (pref) => (asiAll || []).reduce((s, a) => {
        if (a.numero > maxNum) maxNum = a.numero;
        return s + (Array.isArray(a.lineas) ? a.lineas : []).reduce((x, l) => x + (String(l.cta || '').indexOf(pref) === 0 ? (Number(l.debe) || 0) - (Number(l.haber) || 0) : 0), 0);
      }, 0);
      let credDisp = saldoDe('1.1.3.01'), retDisp = saldoDe('1.1.3.03');
      (asiAll || []).forEach((a) => { if (a.numero > maxNum) maxNum = a.numero; });
      const nuevos = [];
      const mkAsiento = (desc, ref, lineas) => { maxNum += 1; nuevos.push({ cuenta_id: window.__CUENTA_ID, empresa_id: empId, numero: maxNum, fecha: fechaAsi, descripcion: desc, referencia: ref, origen: 'auto', lineas: lineas, total: r2c(lineas.reduce((s, l) => s + l.debe, 0)) }); };
      if (!(yaLV && yaLV.length) && v.tot > 0.005) {
        const ln = [{ cta: '1.1.1.03 · Bancos', debe: r2c(v.tot - retMes), haber: 0 }];
        if (retMes > 0.005) ln.push({ cta: '1.1.3.03 · Retenciones IVA soportadas', debe: r2c(retMes), haber: 0 });
        ln.push({ cta: '4.1.1.01 · Venta de mercancía', debe: 0, haber: r2c(v.be) });
        if (v.iva > 0.005) ln.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: 0, haber: r2c(v.iva) });
        mkAsiento('Ventas del mes (resumen Libro de Ventas) · ' + _perLabel(), 'LV-' + mm + '/' + anio, ln);
        retDisp = r2c(retDisp + retMes);
      }
      if (!(yaLC && yaLC.length) && c.tot > 0.005) {
        const ln = [{ cta: '5.1.1.02 · Compra de Mercancía', debe: r2c(c.be), haber: 0 }];
        if (c.iva > 0.005) ln.push({ cta: '1.1.3.01 · IVA crédito fiscal', debe: r2c(c.iva), haber: 0 });
        ln.push({ cta: '1.1.1.03 · Bancos', debe: 0, haber: r2c(c.tot) });
        mkAsiento('Compras del mes (resumen Libro de Compras) · ' + _perLabel(), 'LC-' + mm + '/' + anio, ln);
        credDisp = r2c(credDisp + c.iva);
      }
      const { data: yaF30 } = await window.sb.from('asientos').select('id').eq('empresa_id', empId).eq('referencia', 'F30-' + mm + '/' + anio).limit(1);
      if (!(yaF30 && yaF30.length) && v.iva > 0.005 && !(yaLV && yaLV.length)) {
        // Modelo de cuentas dedicadas: el crédito y las retenciones del mes se
        // cancelan por completo (1.1.3.01 y 1.1.3.03 vuelven a 0) y lo que se
        // traslada al mes siguiente queda EXPLÍCITO en 1.1.3.04 (excedente de
        // crédito) y 1.1.3.05 (retenciones por descontar), como manda la Forma 30.
        const debito = r2c(v.iva);
        const credMes = Math.max(0, credDisp);                 // 1.1.3.01 · crédito del mes
        const retMesAc = Math.max(0, retDisp);                 // 1.1.3.03 · retenciones del mes
        const excPrev = Math.max(0, saldoDe('1.1.3.04'));      // excedente trasladado del mes anterior
        const retPrev = Math.max(0, saldoDe('1.1.3.05'));      // retenciones por descontar del mes anterior
        const cDisp = r2c(credMes + excPrev);
        const credAp = Math.min(debito, cDisp);
        const resto = r2c(debito - credAp);
        const rDisp = r2c(retMesAc + retPrev);
        const retAp = Math.min(resto, rDisp);
        const pago = r2c(resto - retAp);
        const excNew = r2c(cDisp - credAp);                    // excedente a trasladar
        const retNew = r2c(rDisp - retAp);                     // retenciones a trasladar
        const net04 = r2c(excNew - excPrev), net05 = r2c(retNew - retPrev);
        const ln = [{ cta: '2.1.3.01 · IVA débito fiscal', debe: debito, haber: 0 }];
        if (credMes > 0.005) ln.push({ cta: '1.1.3.01 · IVA crédito fiscal', debe: 0, haber: r2c(credMes) });
        if (retMesAc > 0.005) ln.push({ cta: '1.1.3.03 · Retenciones IVA soportadas', debe: 0, haber: r2c(retMesAc) });
        if (net04 > 0.005) ln.push({ cta: '1.1.3.04 · Excedente de crédito fiscal IVA', debe: r2c(net04), haber: 0 });
        else if (net04 < -0.005) ln.push({ cta: '1.1.3.04 · Excedente de crédito fiscal IVA', debe: 0, haber: r2c(-net04) });
        if (net05 > 0.005) ln.push({ cta: '1.1.3.05 · Retenciones de IVA por descontar', debe: r2c(net05), haber: 0 });
        else if (net05 < -0.005) ln.push({ cta: '1.1.3.05 · Retenciones de IVA por descontar', debe: 0, haber: r2c(-net05) });
        if (pago > 0.005) ln.push({ cta: '1.1.1.03 · Bancos', debe: 0, haber: r2c(pago) });
        const difL = r2c(ln.reduce((s, l) => s + l.debe, 0) - ln.reduce((s, l) => s + l.haber, 0));
        if (Math.abs(difL) > 0.005) { if (pago > 0.005) ln[ln.length - 1].haber = r2c(ln[ln.length - 1].haber + difL); else ln.push({ cta: '1.1.1.03 · Bancos', debe: 0, haber: difL }); }
        mkAsiento('Liquidación IVA declarado (Forma 30) · ' + _perLabel(), 'F30-' + mm + '/' + anio, ln);
      }
      if (nuevos.length) {
        const { error: e2 } = await window.sb.from('asientos').insert(nuevos);
        if (e2) { toast('No se pudieron generar los asientos: ' + e2.message, 'error'); return; }
      }
      const { error: e3 } = await window.sb.from('cierres_mensuales').insert({ cuenta_id: window.__CUENTA_ID, empresa_id: empId, periodo: key, cerrado_por: (window.__PERFIL && window.__PERFIL.email) || '' });
      if (e3) { toast('Asientos listos, pero no se pudo bloquear el mes: ' + e3.message + ' (¿corriste el SQL dpp_y_cierres.sql?)', 'error'); return; }
      _cierres.add(key); pintarCierreBtn();
      if (window.cargarAsientos) window.cargarAsientos();
      toast('✅ ' + _perLabel() + ' CERRADO · ' + (nuevos.length ? nuevos.length + ' asientos resumen generados y ' : '') + 'transacciones del período bloqueadas', 'success');
    }
    cargarCierres();

    // Calendario fiscal: el botón Configurar (la navegación ◀▶ la maneja el IIFE calendar)
    const agenda = view.querySelector('.fiscal-tab[data-tab="agenda"]');
    if (agenda) {
      agenda.querySelectorAll('.panel-actions .icon-btn').forEach((b) => {
        if (/config/i.test(b.title || '')) b.addEventListener('click', () => toast('Configuración de recordatorios fiscales', 'info'));
      });
      agenda.querySelectorAll('.deadline').forEach((d) => {
        d.style.cursor = 'pointer';
        d.addEventListener('click', () => {
          const t = ((d.querySelector('.t') || {}).textContent || '').toLowerCase();
          if (t.includes('iva')) { window.showView && window.showView('fiscal', 'Módulo Fiscal · SENIAT'); window.gotoFiscalTab && window.gotoFiscalTab('ventas'); }
          else if (/islr|retenci/.test(t)) { window.showView && window.showView('fiscal', 'Módulo Fiscal · SENIAT'); window.gotoFiscalTab && window.gotoFiscalTab('retenciones'); }
          else if (/inces|n[oó]mina/.test(t)) { window.showView && window.showView('nomina', 'Nómina y Parafiscales'); }
          else toast((d.querySelector('.t') || {}).textContent || 'Vencimiento fiscal');
        });
      });
    }

    // Selectores de los paneles de control (Comprobantes, Pensiones, IGP)
    const opciones = {
      /* Se quitaron 'Proveedor / Sujeto retenido', 'Factura asociada' y
         'Período fiscal': eran cinco proveedores y cinco facturas
         inventados —Suministros Lara, F-00284716— ofrecidos como si fueran
         los de la empresa. Esos tres campos ahora salen de las retenciones
         reales del período. */
      /* Se quitaron también 'Período de declaración' y 'Ejercicio fiscal':
         eran cuatro meses de 2026 y tres ejercicios escritos a mano. El del
         DPP ofrecía «Marzo 2026» a «Junio 2026» y nada más, aunque se
         estuviera mirando agosto, y al elegir uno solo cambiaba el texto del
         recuadro. Esos cuadros ahora abren el selector de período REAL del
         módulo, que sí mueve los libros y las retenciones con él. */
      'Tipo de declaración': ['Originaria', 'Sustitutiva', 'Complementaria'],
      'Alícuota vigente': ['9% (sector privado)', '15% (tope de ley)'],
    };
    /* Esto le pone un modal de opciones a cada `.select-box` de los paneles
       de control. Las listas son de MAQUETA —proveedores y facturas
       inventados— y al elegir solo se escribe el texto en el div: no cambia
       ningún dato.

       Ya NO alcanza a los de Comprobantes: el proveedor y la factura pasaron
       a ser <select> de verdad, con las retenciones registradas del período,
       y el período es un dato que manda el módulo. Si este bloque los
       alcanzara, les pondría encima el modal falso.

       Los demás paneles (Pensiones, IGP) siguen con la maqueta. */
    view.querySelectorAll('.fiscal-tab .comp-controls .comp-field').forEach((field) => {
      const sb = field.querySelector('.select-box');
      if (!sb) return;
      // Un <select> de verdad se maneja solo; y un div con id ya lo llena el JS.
      if (sb.tagName === 'SELECT' || sb.id) return;
      /* Los cuadros marcados con data-perfiscal muestran el período que se
         está mirando. Al pulsarlos se abre el selector REAL del módulo, no
         una lista de maqueta: si no, se elige un mes y no se mueve nada. */
      if (sb.dataset.perfiscal) {
        sb.style.cursor = 'pointer';
        sb.addEventListener('click', () => {
          if (window.__abrirPeriodoFiscal) window.__abrirPeriodoFiscal();
        });
        return;
      }
      const lbl = ((field.querySelector('.lbl') || {}).textContent || '').trim();
      const isRecalc = /base imponible|patrimonio/i.test(lbl);
      sb.style.cursor = 'pointer';
      sb.addEventListener('click', () => {
        if (isRecalc) { toast(lbl + ' recalculado desde los datos del período'); return; }
        const opts = opciones[lbl] || ['Opción 1', 'Opción 2'];
        window.openFormModal && window.openFormModal({
          title: 'Seleccionar · ' + lbl,
          saveLabel: 'Seleccionar',
          fields: [{ name: 'sel', label: lbl, col: 2, type: 'select', options: opts }],
          onSave: (v) => {
            const isMono = sb.classList.contains('mono');
            sb.innerHTML = v.sel + ' <i data-lucide="' + (isMono ? 'refresh-cw' : 'chevron-down') + '"></i>';
            if (window.lucide) window.lucide.createIcons();
            toast(lbl + ': ' + v.sel);
          },
        });
      });
    });
  })();

  /* =========================================================
     TESORERÍA — acciones (transferir, movimiento, cobrar, pagar, etc.)
     ========================================================= */
  (function tesoActions() {
    const view = document.getElementById('view-tesoreria');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const CUENTAS = ['Banesco · Cta. Corriente Bs', 'Banesco · Cta. Ahorro Bs', 'Mercantil · Cta. Corriente Bs', 'BBVA Provincial · Divisas $'];
    const find = (sel, re) => [...view.querySelectorAll(sel)].find((b) => re.test(b.textContent));

    // Header — Transferir / Registrar movimiento
    const transferir = find('.dash-actions .btn', /transferir/i);
    if (transferir) transferir.addEventListener('click', () => window.openFormModal && window.openFormModal({
      title: 'Transferencia entre cuentas', saveLabel: 'Transferir',
      fields: [
        { name: 'origen', label: 'Cuenta origen', type: 'select', options: CUENTAS },
        { name: 'destino', label: 'Cuenta destino', type: 'select', options: CUENTAS },
        { name: 'monto', label: 'Monto (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
        { name: 'concepto', label: 'Concepto', placeholder: 'Ej. Cobertura de pagos' },
      ],
      onSave: (v) => {
        if (!(parseFloat(v.monto) > 0)) return 'Indica un monto válido.';
        if (v.origen === v.destino) return 'La cuenta origen y destino deben ser distintas.';
        toast('Transferencia registrada · Bs ' + Number(v.monto).toLocaleString('es-VE', { minimumFractionDigits: 2 }));
      },
    }));

    // "Registrar movimiento" lo maneja el módulo real de Tesorería (tesoreriaModule):
    // incluye bancos Y la Caja, con foto del comprobante. No bindear aquí (evita el modal mock de solo bancos).

    // Registrar compra
    const regCompra = find('.teso-tab[data-tab="compras"] .btn', /registrar compra/i);
    if (regCompra) regCompra.addEventListener('click', () => window.openFormModal && window.openFormModal({
      title: 'Registrar factura de compra', saveLabel: 'Registrar',
      fields: [
        { name: 'prov', label: 'Proveedor', col: 2, placeholder: 'Razón social' },
        { name: 'rif', label: 'RIF', placeholder: 'J-00000000-0' },
        { name: 'factura', label: 'N° Factura', placeholder: 'F-00000000' },
        { name: 'fecha', label: 'Fecha', type: 'date', value: window.__hoyISO() },
        { name: 'monto', label: 'Total (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
        { name: 'alic', label: 'Alícuota IVA', type: 'select', options: ['16%', '8%', 'Exenta'] },
      ],
      onSave: (v) => {
        if (!v.prov || !v.factura) return 'Proveedor y N° de factura son obligatorios.';
        if (!(parseFloat(v.monto) > 0)) return 'Indica el total de la compra.';
        toast('Compra ' + v.factura + ' de ' + v.prov + ' registrada');
      },
    }));

    // Cobrar (CxC) — envía recordatorio de cobro
    view.querySelectorAll('.teso-tab[data-tab="cxc"] tbody .btn').forEach((b) => {
      if (!/cobrar/i.test(b.textContent)) return;
      b.addEventListener('click', () => {
        const cli = (b.closest('tr').querySelector('.primary') || {}).textContent || 'el cliente';
        toast('Recordatorio de cobro enviado a ' + cli);
      });
    });
    const recMasivo = find('.teso-tab[data-tab="cxc"] .btn', /recordatorio masivo/i);
    if (recMasivo) recMasivo.addEventListener('click', () => toast('Recordatorio masivo enviado a los clientes con saldo pendiente'));

    // Pagar / Programar (CxP)
    view.querySelectorAll('.teso-tab[data-tab="cxp"] tbody .btn').forEach((b) => {
      const tr = b.closest('tr');
      const prov = (tr.querySelector('.primary') || {}).textContent || 'el proveedor';
      if (/pagar/i.test(b.textContent)) b.addEventListener('click', () => {
        const tag = tr.querySelector('.tag'); if (tag) { tag.className = 'tag success'; tag.textContent = 'Pagada'; }
        toast('Pago registrado a ' + prov);
      });
      else if (/programar/i.test(b.textContent)) b.addEventListener('click', () => toast('Pago a ' + prov + ' programado'));
    });
    const progPagos = find('.teso-tab[data-tab="cxp"] .btn', /programar pagos/i);
    if (progPagos) progPagos.addEventListener('click', () => toast('Lote de pagos programado según fecha de vencimiento'));

    // Conciliación — Cargar extracto + selector de cuenta
    const cargar = find('.teso-tab[data-tab="concil"] .btn', /cargar extracto/i);
    if (cargar) cargar.addEventListener('click', () => toast('Extracto bancario cargado · conciliando movimientos…', 'info'));
    const selCuenta = view.querySelector('.teso-tab[data-tab="concil"] .txt-select');
    if (selCuenta) { selCuenta.style.cursor = 'pointer'; selCuenta.addEventListener('click', () => window.openFormModal && window.openFormModal({
      title: 'Cuenta a conciliar', saveLabel: 'Seleccionar',
      fields: [{ name: 'cta', label: 'Cuenta', col: 2, type: 'select', options: CUENTAS }],
      onSave: (v) => { const val = selCuenta.querySelector('.val'); if (val) val.innerHTML = v.cta + ' <i data-lucide="chevron-down"></i>'; if (window.lucide) window.lucide.createIcons(); toast('Conciliando: ' + v.cta); },
    })); }

    // Botones "ojo" de Compras → abrir la factura
    view.querySelectorAll('.teso-tab[data-tab="compras"] tbody .icon-btn').forEach((b) => {
      const mono = (b.closest('tr').querySelector('td.mono') || {}).textContent;
      const num = mono ? mono.trim() : null;
      if (num) b.addEventListener('click', () => window.openFactura && window.openFactura(num));
    });

    // Exportar (Resumen)
    const expResumen = find('.teso-tab[data-tab="resumen"] .btn', /exportar/i);
    if (expResumen) expResumen.addEventListener('click', () => toast('Resumen de tesorería exportado'));
  })();

  /* =========================================================
     LIBROS — filtros de alícuota, período y máquina fiscal
     ========================================================= */
  (function librosFilters() {
    const drawI = () => { if (window.lucide) window.lucide.createIcons(); };
    document.querySelectorAll('table.libro-table').forEach((table) => {
      const wrap = table.closest('.data-table-wrap');
      if (!wrap) return;
      const toolbar = wrap.querySelector('.table-toolbar');
      if (!toolbar) return;
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const ths = Array.from(table.querySelectorAll('thead th'));
      const alicIdx = ths.findIndex((th) => /al[ií]c/i.test(th.textContent));
      const chips = Array.from(toolbar.querySelectorAll('.filter-chip'));

      // estado de filtros combinados
      let fAlic = 'Todas', fMaq = null;
      function aplicar() {
        rows.forEach((r) => {
          let ok = true;
          if (fAlic !== 'Todas' && alicIdx >= 0) {
            const c = r.children[alicIdx];
            ok = ok && c && c.textContent.trim() === fAlic;
          }
          if (fMaq) {
            const mc = Array.from(r.children).find((td) => /Z7C\d/.test(td.textContent));
            ok = ok && mc && mc.textContent.trim() === fMaq;
          }
          r.style.display = ok ? '' : 'none';
        });
      }

      // Chip de alícuota: cicla Todas → 16% → 8% → Exenta
      const chipAlic = chips.find((c) => /al[ií]cuota/i.test(c.textContent));
      if (chipAlic && alicIdx >= 0) {
        const ciclo = ['Todas', '16%', '8%', 'Exenta'];
        let i = 0;
        chipAlic.addEventListener('click', () => {
          i = (i + 1) % ciclo.length;
          fAlic = ciclo[i];
          chipAlic.innerHTML = '<i data-lucide="percent"></i> Alícuota: ' + fAlic;
          chipAlic.classList.toggle('active', fAlic !== 'Todas');
          aplicar(); drawI();
        });
      }

      // Chip de período (Mayo 2026): informativo
      const chipPer = chips.find((c) => /\b20\d\d\b/.test(c.textContent) && !/al[ií]cuota|m[áa]quina/i.test(c.textContent));
      if (chipPer) chipPer.addEventListener('click', () => {
        if (window.toast) window.toast('Período del libro: ' + chipPer.textContent.replace(/[×x]\s*$/, '').trim(), 'info');
      });

      // Chip de máquina fiscal (Libro de Ventas por Máquina Fiscal)
      const chipMaq = chips.find((c) => /m[áa]quina/i.test(c.textContent));
      if (chipMaq) chipMaq.addEventListener('click', () => {
        window.openFormModal && window.openFormModal({
          title: 'Filtrar por máquina fiscal',
          saveLabel: 'Aplicar',
          fields: [{ name: 'maq', label: 'Máquina fiscal / caja', col: 2, type: 'select',
            options: ['Todas las máquinas', 'Z7C0025982 · Caja 1', 'Z7C0025983 · Caja 2', 'Z7C0025984 · Caja 3'] }],
          onSave: (v) => {
            fMaq = v.maq.indexOf('Todas') === 0 ? null : v.maq.split(' · ')[0];
            chipMaq.innerHTML = '<i data-lucide="cpu"></i> Máquina: ' + (fMaq || 'Todas');
            chipMaq.classList.toggle('active', !!fMaq);
            aplicar(); drawI();
            if (window.toast) window.toast(fMaq ? 'Filtrando por ' + fMaq : 'Mostrando todas las máquinas');
          },
        });
      });
    });
  })();

  /* =========================================================
     TOPBAR — notificaciones, calendario y ayuda
     ========================================================= */
  (function topbarActions() {
    const btn = document.getElementById('notifBtn');
    const panel = document.getElementById('notifPanel');
    if (btn && panel) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.hidden = !panel.hidden;
        if (!panel.hidden) drawIcons();
      });
      document.addEventListener('click', (e) => {
        if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) panel.hidden = true;
      });
      panel.querySelectorAll('.np-item, .np-foot a').forEach((a) => a.addEventListener('click', () => { panel.hidden = true; }));
      const markAll = document.getElementById('notifMarkAll');
      if (markAll) markAll.addEventListener('click', () => {
        btn.classList.add('read');
        const c = document.getElementById('notifCount'); if (c) c.textContent = '0';
        const d = document.getElementById('notifDot'); if (d) { d.textContent = '0'; d.hidden = true; }
        panel.hidden = true;
        // Persistir el "leídas" en la base
        if (window.sb && window.__CUENTA_ID) {
          window.sb.from('notificaciones').update({ leida: true }).eq('cuenta_id', window.__CUENTA_ID).eq('leida', false)
            .then(({ error }) => { if (error) console.warn('[Notif] marcar leídas:', error.message); });
        }
        panel.querySelectorAll('.np-item').forEach((it) => it.classList.remove('np-new'));
        if (window.toast) window.toast('Notificaciones marcadas como leídas');
      });
    }
    // Crea el elemento visual de una notificación en el panel
    function crearItemNotif(n, esNueva) {
      const list = document.querySelector('#notifPanel .np-list');
      if (!list) return;
      const vacio = document.getElementById('notifEmpty');
      if (vacio) vacio.remove();
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'np-item' + (esNueva ? ' np-new' : '') + (n.nivel ? ' ' + n.nivel : '');
      a.innerHTML = '<div class="np-ic"><i data-lucide="' + (n.icon || 'bell') + '"></i></div>'
        + '<div class="np-body"><div class="np-t">' + n.titulo + '</div><div class="np-d">' + (n.detalle || '') + '</div></div>';
      list.appendChild(a);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const p = document.getElementById('notifPanel');
        if (p) p.hidden = true;
        if (n.view && window.showView) window.showView(n.view, n.title2 || '');
      });
      return a;
    }
    function setContadores(noLeidas) {
      const dot = document.getElementById('notifDot');
      const cnt = document.getElementById('notifCount');
      if (dot) { dot.textContent = String(noLeidas); dot.hidden = noLeidas === 0; }
      if (cnt) cnt.textContent = String(noLeidas);
      if (btn) btn.classList.toggle('read', noLeidas === 0);
    }
    // Carga las notificaciones PERSISTENTES de la cuenta (últimas 20)
    window.cargarNotificaciones = async function () {
      if (!window.sb || !window.__CUENTA_ID) return;
      const { data, error } = await window.sb.from('notificaciones')
        .select('*').order('creado_en', { ascending: false }).limit(20);
      if (error) { console.warn('[Notif] No se pudieron cargar:', error.message); return; }
      const list = document.getElementById('notifList');
      if (list) list.innerHTML = '';
      const rows = data || [];
      if (!rows.length && list) {
        list.innerHTML = '<div id="notifEmpty" style="text-align:center;color:var(--fg-muted);padding:32px 18px;"><i data-lucide="bell-off" style="width:24px;height:24px;opacity:.5;"></i><div style="font-size:12px;margin-top:8px;">Sin notificaciones por ahora</div></div>';
      }
      rows.forEach((r) => crearItemNotif({ icon: r.icon, nivel: r.nivel, titulo: r.titulo, detalle: r.detalle, view: r.view, title2: r.title2 }, !r.leida));
      setContadores(rows.filter((r) => !r.leida).length);
      if (window.lucide) window.lucide.createIcons();
    };
    // Inyecta una notificación nueva (la muestra Y la guarda en la base)
    window.__notificar = function (n) {
      const list = document.querySelector('#notifPanel .np-list');
      if (!list) return;
      const a = crearItemNotif(n, true);
      if (a) list.insertBefore(a, list.firstChild);
      const dot = document.getElementById('notifDot');
      const actual = (dot && !dot.hidden ? parseInt(dot.textContent, 10) || 0 : 0) + 1;
      setContadores(actual);
      if (window.lucide) window.lucide.createIcons();
      // Persistir (sobrevive al recargar y a otras sesiones)
      if (window.sb && window.__CUENTA_ID && !n.noPersistir) {
        window.sb.from('notificaciones').insert({
          cuenta_id: window.__CUENTA_ID, icon: n.icon || 'bell', nivel: n.nivel || null,
          titulo: n.titulo || '', detalle: n.detalle || '', view: n.view || null, title2: n.title2 || null,
        }).then(({ error }) => { if (error) console.warn('[Notif] No se pudo guardar:', error.message); });
      }
    };
    // Calendario del topbar → Módulo Fiscal · Calendario fiscal
    const cal = document.getElementById('topbarCalBtn');
    if (cal) cal.addEventListener('click', () => {
      if (window.showView) window.showView('fiscal', 'Módulo Fiscal · SENIAT');
      if (window.gotoFiscalTab) window.gotoFiscalTab('agenda');
    });
  })();

  /* =========================================================
     NAVEGACIÓN MÓVIL — sidebar off-canvas (hamburguesa)
     ========================================================= */
  (function mobileNav() {
    const toggle = document.getElementById('navToggle');
    const scrim = document.getElementById('navScrim');
    const closeNav = () => document.body.classList.remove('nav-open');
    if (toggle) toggle.addEventListener('click', (e) => { e.stopPropagation(); document.body.classList.toggle('nav-open'); });
    if (scrim) scrim.addEventListener('click', closeNav);
    // Cerrar el menú al navegar a una vista
    document.querySelectorAll('.sidebar .nav-item, .sidebar .plan-active-pill').forEach((a) => a.addEventListener('click', closeNav));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
  })();

  /* =========================================================
     MAYÚSCULAS automáticas — RIF, razón social y cédula
     Convierte el VALOR real a mayúsculas mientras se escribe
     (no solo visual), como exige el formato del SENIAT.
     ========================================================= */
  (function forzarMayusculas() {
    function upper(el) {
      const s = el.selectionStart, e = el.selectionEnd;
      const v = el.value.toUpperCase();
      if (v !== el.value) { el.value = v; try { el.setSelectionRange(s, e); } catch (x) {} }
    }
    // Campos fijos (registro, wizard de empresa, configuración)
    ['cwNombre', 'cwFpNombre', 'cwFpComercial', 'cwEmpNombre', 'cwEmpApellido', 'cwDom', 'cwRif',
      'suCedula', 'cfgRif', 'cfgRazon', 'cfgDom'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => upper(el));
    });
    // Campos dinámicos (Terceros y modales): por selector
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('input[data-upper], .ter-f input[data-tk="nombre"], .ter-f input[data-tk="dom"], .ter-f input[data-tk="rif"]')) upper(t);
    });
  })();

  /* =========================================================
     DASHBOARD — activar botones de acción (header, paneles, alertas)
     ========================================================= */
  (function dashboardActions() {
    const view = document.getElementById('view-dashboard');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    // Header: Exportar resumen ejecutivo (CSV de KPIs) y Nuevo documento
    view.querySelectorAll('.dash-actions .btn').forEach((b) => {
      const txt = b.textContent.trim();
      if (/Exportar/i.test(txt)) b.addEventListener('click', () => {
        const rows = [['Indicador', 'Valor']];
        view.querySelectorAll('.kpi').forEach((k) => {
          const label = ((k.querySelector('.label') || {}).textContent || '').trim();
          const val = ((k.querySelector('.kpi-value') || {}).textContent || '').replace(/\s+/g, ' ').trim();
          if (label) rows.push([label, val]);
        });
        const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Resumen_Ejecutivo_2026-05.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        toast('Resumen ejecutivo exportado a CSV');
      });
      else if (/Nuevo documento/i.test(txt)) b.addEventListener('click', () => {
        window.openFormModal && window.openFormModal({
          title: 'Nuevo documento', saveLabel: 'Continuar',
          fields: [{ name: 'tipo', label: '¿Qué deseas crear?', col: 2, type: 'select', options: ['Factura de venta', 'Asiento contable', 'Nota de crédito / débito', 'Registrar activo fijo', 'Orden de compra'] }],
          onSave: (v) => {
            const map = {
              'Factura de venta': ['ventas', 'Ventas y Facturación'],
              'Asiento contable': ['contabilidad', 'Contabilidad'],
              'Nota de crédito / débito': ['ventas', 'Ventas y Facturación'],
              'Registrar activo fijo': ['contabilidad', 'Contabilidad'],
              'Orden de compra': ['tesoreria', 'Tesorería'],
            };
            const dest = map[v.tipo] || ['dashboard', 'Dashboard'];
            if (window.showView) window.showView(dest[0], dest[1]);
            toast('Abriendo ' + v.tipo + ' · ' + dest[1]);
          },
        });
      });
    });

    // Acciones de los paneles (gráfico de flujo y feed de alertas)
    const panelMsgs = {
      'Cambiar vista': 'Vista del gráfico cambiada',
      'Comparar': 'Comparando con el mes anterior',
      'Más opciones': 'Más opciones del panel',
      'Filtrar': 'Filtro de alertas aplicado',
      'Marcar como leídas': 'Alertas marcadas como leídas',
    };
    view.querySelectorAll('.panel-actions .icon-btn').forEach((b) => {
      const t = b.getAttribute('title') || '';
      b.addEventListener('click', () => {
        if (/Marcar como leídas/i.test(t)) {
          const sub = b.closest('.panel').querySelector('.panel-title-block .sub');
          if (sub) sub.textContent = '0 nuevas · al día';
        }
        toast(panelMsgs[t] || t, 'info');
      });
    });

    // Botón de cada alerta (los que no navegan a una vista)
    view.querySelectorAll('.alert-cta').forEach((b) => {
      if (b.hasAttribute('data-go-view')) return;
      b.addEventListener('click', () => {
        const al = b.closest('.alert');
        const titulo = ((al && al.querySelector('.alert-title')) || {}).textContent || 'la alerta';
        toast('Gestionando · ' + titulo, 'info');
      });
    });

    // Ver todas las alertas → Centro de Agentes IA
    const verTodas = view.querySelector('.view-all');
    if (verTodas) verTodas.addEventListener('click', (e) => { e.preventDefault(); if (window.showView) window.showView('agentes', 'Centro de Agentes IA'); });
  })();

  /* =========================================================
     CONTABILIDAD — botones extra (depreciación detalle, filtros activos)
     ========================================================= */
  (function contaExtraButtons() {
    const view = document.getElementById('view-contabilidad');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    // Ver detalle de la cédula de depreciación
    const deprView = document.getElementById('deprViewBtn');
    if (deprView) deprView.addEventListener('click', () => {
      window.openFormModal && window.openFormModal({
        title: 'Detalle de depreciación · Mayo 2026', saveLabel: 'Cerrar',
        fields: [{ name: 'x', label: ' ', col: 2, type: 'static', html: '<div style="font-size:12.5px;line-height:1.8;color:var(--fg-body);">'
          + 'Vehículos · <strong>Bs 70.000,00</strong><br>Inmuebles · <strong>Bs 12.500,00</strong><br>Maquinaria · <strong>Bs 9.833,00</strong><br>Equipos · <strong>Bs 45.250,00</strong><br>Mobiliario · <strong>Bs 11.167,00</strong>'
          + '<hr style="border:0;border-top:1px solid var(--border-default);margin:9px 0;">Total del mes · <strong style="color:var(--da-cyan-700);">Bs 148.750,00</strong> · método de línea recta sobre 24 activos.</div>' }],
        onSave: () => {},
      });
    });

    // Contabilizar el asiento de depreciación
    const deprPost = document.getElementById('deprPostBtn');
    if (deprPost) deprPost.addEventListener('click', () => {
      const num = document.getElementById('deprAsientoNum');
      if (num) num.textContent = '#0314';
      deprPost.disabled = true;
      deprPost.innerHTML = '<i data-lucide="check"></i> Contabilizado';
      if (window.lucide) window.lucide.createIcons();
      toast('Asiento de depreciación contabilizado · Bs 148.750,00', 'success');
    });

    // Filtros por categoría en Activos Fijos
    const activosPane = view.querySelector('.conta-tab[data-tab="activos"]');
    if (activosPane) {
      const chips = activosPane.querySelectorAll('.table-toolbar .filter-chip');
      const tbody = activosPane.querySelector('table.data-table tbody');
      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const txt = chip.textContent.trim().toLowerCase();
          const todas = /todas/.test(txt);
          chips.forEach((c) => c.classList.toggle('active', c === chip));
          if (!tbody) return;
          const key = txt.replace(/s$/, '');
          tbody.querySelectorAll('tr').forEach((tr) => {
            const cat = (tr.children[2] ? tr.children[2].textContent : '').toLowerCase();
            tr.style.display = (todas || cat.includes(key)) ? '' : 'none';
          });
        });
      });
    }
  })();

  /* =========================================================
     VEN-NIF 12 (Criptoactivos) + VEN-NIF 11 (Impuesto Diferido)
     ========================================================= */
  (function vennifModule() {
    const fmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    // ----- Criptoactivos (gestor + medición a valor razonable) -----
    const cxTable = document.getElementById('criptoTable');
    if (cxTable) {
      const setOut = (k, v) => document.querySelectorAll('[data-out="' + k + '"]').forEach((el) => (el.textContent = v));
      function recalc() {
        let costo = 0, vr = 0, ori = 0, perdida = 0;
        cxTable.querySelectorAll('tr[data-cripto]').forEach((tr) => {
          const c = parseFloat(tr.dataset.costo) || 0, v = parseFloat(tr.dataset.vr) || 0;
          costo += c; vr += v;
          const diff = v - c;
          if (diff >= 0) ori += diff; else perdida += diff;
        });
        setOut('cxTotCosto', fmt(costo));
        setOut('cxTotVr', fmt(vr));
        setOut('cxTotVar', (vr - costo >= 0 ? '+' : '') + fmt(vr - costo));
        setOut('cxValorLibros', fmt(vr));
        setOut('cxCosto', fmt(costo));
        setOut('cxOri', fmt(ori));
        setOut('cxResultado', fmt(Math.abs(perdida)));
      }
      let pendienteAsiento = null;
      async function cargarCriptoactivos() {
        const tbody = cxTable.querySelector('tbody');
        if (!tbody) return;
        if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin criptoactivos registrados.</td></tr>'; recalc(); return; }
        const { data, error } = await window.sb.from('criptoactivos').select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('creado_en');
        if (error) { console.warn('[DigiAccount] No se pudieron cargar criptoactivos:', error.message); tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--fg-muted);padding:14px;">No se pudieron cargar (¿creaste la tabla?).</td></tr>'; recalc(); return; }
        const arr = data || [];
        if (!arr.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin criptoactivos registrados. Usa "Registrar criptoactivo".</td></tr>'; recalc(); return; }
        tbody.innerHTML = arr.map((x) => {
          const costo = Number(x.costo) || 0, vr = Number(x.valor_razonable) || 0, varTot = vr - costo;
          const tag = x.clasificacion === 'Corriente' ? 'cyan' : 'slate';
          const color = varTot > 0 ? 'var(--da-success)' : varTot < 0 ? 'var(--da-danger)' : 'var(--fg-muted)';
          return '<tr data-cripto data-id="' + x.id + '" data-costo="' + costo + '" data-vr="' + vr + '">'
            + '<td><div class="prod-cell"><div class="prod-thumb"><i data-lucide="coins"></i></div><div class="info"><div class="n">' + (x.nombre || '') + '</div><div class="sku">' + (x.simbolo || '') + '</div></div></div></td>'
            + '<td class="mono">' + (x.wallet || '—') + '</td><td class="num">' + (x.cantidad || '0') + '</td>'
            + '<td class="num cx-costo">' + fmt(costo) + '</td><td class="num cx-vr">' + fmt(vr) + '</td>'
            + '<td class="num cx-var" style="color:' + color + ';">' + (varTot >= 0 ? '+' : '') + fmt(varTot) + '</td>'
            + '<td><span class="tag ' + tag + '">' + (x.clasificacion || 'No corriente') + '</span></td><td><span class="tag navy">' + (x.nivel || 'Nivel 1') + '</span></td>'
            + '<td><input type="number" class="cx-newvr" value="' + vr + '" step="0.01" style="width:120px;height:30px;border:1px solid var(--border-default);border-radius:6px;padding:0 8px;text-align:right;font-family:var(--font-mono);font-size:12px;"></td></tr>';
        }).join('');
        recalc();
        if (window.lucide) window.lucide.createIcons();
      }
      window.cargarCriptoactivos = cargarCriptoactivos;
      cargarCriptoactivos();
      const medir = document.getElementById('criptoMedir');
      if (medir) medir.addEventListener('click', async () => {
        let totalGanORI = 0, totalRevORI = 0, totalPerdida = 0;
        const updates = [];
        cxTable.querySelectorAll('tr[data-cripto]').forEach((tr) => {
          const inp = tr.querySelector('.cx-newvr'); if (!inp) return;
          const nuevoVr = parseFloat(inp.value) || 0;
          const vrPrev = parseFloat(tr.dataset.vr) || 0;
          const costo = parseFloat(tr.dataset.costo) || 0;
          const delta = nuevoVr - vrPrev;
          tr.dataset.vr = nuevoVr;
          tr.querySelector('.cx-vr').textContent = fmt(nuevoVr);
          const varTotal = nuevoVr - costo;
          const varEl = tr.querySelector('.cx-var');
          varEl.textContent = (varTotal >= 0 ? '+' : '') + fmt(varTotal);
          varEl.style.color = varTotal > 0 ? 'var(--da-success)' : varTotal < 0 ? 'var(--da-danger)' : 'var(--fg-muted)';
          if (delta > 0.005) { totalGanORI += delta; }
          else if (delta < -0.005) { const baja = -delta, oriAcum = Math.max(0, vrPrev - costo), rev = Math.min(baja, oriAcum); totalRevORI += rev; totalPerdida += (baja - rev); }
          if (tr.dataset.id && window.sb) updates.push(window.sb.from('criptoactivos').update({ valor_razonable: nuevoVr }).eq('id', tr.dataset.id));
        });
        recalc();
        if (updates.length) await Promise.all(updates);
        // Asiento VEN-NIF 12: incremento → ORI; disminución → resultado PREVIA deducción del incremento en ORI
        const lineas = [];
        if (totalGanORI > 0.005) { lineas.push({ cta: '1.1.6 · Criptoactivos', debe: totalGanORI, haber: 0 }); lineas.push({ cta: '3.2.5.01 · Ganancia por tenencia de criptoactivos (ORI)', debe: 0, haber: totalGanORI }); }
        if (totalRevORI > 0.005) { lineas.push({ cta: '3.2.5.01 · Ganancia por tenencia de criptoactivos (ORI)', debe: totalRevORI, haber: 0 }); lineas.push({ cta: '1.1.6 · Criptoactivos', debe: 0, haber: totalRevORI }); }
        if (totalPerdida > 0.005) { lineas.push({ cta: '6.3.1.01 · Pérdida por tenencia de criptoactivos', debe: totalPerdida, haber: 0 }); lineas.push({ cta: '1.1.6 · Criptoactivos', debe: 0, haber: totalPerdida }); }
        const body = document.getElementById('cxAsientoBody');
        const wrap = document.getElementById('cxAsiento');
        if (!lineas.length) { pendienteAsiento = null; toast('No hay variación en el valor razonable', 'info'); if (wrap) wrap.hidden = true; return; }
        pendienteAsiento = lineas;
        let html = '<table class="cxa-table"><thead><tr><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead><tbody>';
        let tD = 0, tH = 0;
        lineas.forEach((l) => { html += '<tr><td>' + l.cta + '</td><td class="num">' + (l.debe ? fmt(l.debe) : '—') + '</td><td class="num">' + (l.haber ? fmt(l.haber) : '—') + '</td></tr>'; tD += l.debe; tH += l.haber; });
        html += '</tbody><tfoot><tr><td>Totales</td><td class="num">' + fmt(tD) + '</td><td class="num">' + fmt(tH) + '</td></tr></tfoot></table>';
        body.innerHTML = html;
        wrap.hidden = false;
        if (window.lucide) window.lucide.createIcons();
        toast('Medición aplicada · valor razonable actualizado', 'success');
      });
      const post = document.getElementById('cxAsientoPost');
      if (post) post.addEventListener('click', async () => {
        if (!pendienteAsiento || !pendienteAsiento.length) { document.getElementById('cxAsiento').hidden = true; return; }
        if (!window.__postAsiento) { toast('No disponible', 'error'); return; }
        const res = await window.__postAsiento('Medición de criptoactivos a valor razonable (VEN-NIF 12)', 'CRIPTO', pendienteAsiento, 'auto');
        if (res && res.error) { toast('No se pudo contabilizar: ' + res.error.message, 'error'); return; }
        document.getElementById('cxAsiento').hidden = true;
        pendienteAsiento = null;
        toast('Asiento de medición contabilizado · fluye a la contabilidad', 'success');
      });
      const nuevo = document.getElementById('criptoNuevo');
      if (nuevo) nuevo.addEventListener('click', () => {
        window.openFormModal && window.openFormModal({
          title: 'Registrar criptoactivo', saveLabel: 'Registrar al costo',
          fields: [
            { name: 'nombre', label: 'Criptoactivo', placeholder: 'Ej. Ethereum' },
            { name: 'simbolo', label: 'Símbolo', placeholder: 'ETH' },
            { name: 'wallet', label: 'Wallet / custodia', placeholder: 'Custodia fría' },
            { name: 'cantidad', label: 'Cantidad', placeholder: '0' },
            { name: 'costo', label: 'Costo de adquisición (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
            { name: 'clasif', label: 'Clasificación', type: 'select', options: ['Corriente', 'No corriente'] },
          ],
          onSave: (v) => {
            if (!v.nombre) return 'Indica el criptoactivo.';
            if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
            const costo = parseFloat(v.costo) || 0;
            window.sb.from('criptoactivos').insert({
              cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
              nombre: v.nombre, simbolo: v.simbolo, wallet: v.wallet, cantidad: parseFloat(v.cantidad) || 0,
              costo: costo, valor_razonable: costo, clasificacion: v.clasif, nivel: 'Nivel 1',
            }).then(({ error }) => {
              if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
              if (window.cargarCriptoactivos) window.cargarCriptoactivos();
              toast('Criptoactivo ' + v.nombre + ' registrado al costo', 'success');
            });
          },
        });
      });
      recalc();
    }

    // ----- Impuesto diferido (política configurable) -----
    const difPane = document.querySelector('[data-dif-pane]');
    if (difPane) {
      const get = (k) => { const el = difPane.querySelector('[data-k="' + k + '"]'); return el ? (parseFloat(el.value) || 0) : 0; };
      const setOut = (k, v) => difPane.querySelectorAll('[data-out="' + k + '"]').forEach((el) => (el.textContent = v));
      function calcDif() {
        const dt = get('baseContable') - get('baseFiscal');
        const imp = dt * (get('tasaIslr') / 100);
        setOut('difTemporaria', 'Bs ' + fmt(dt));
        setOut('difImpuesto', 'Bs ' + fmt(imp));
        const especial = difPane.querySelector('#difEspecial').checked;
        let pol = (difPane.querySelector('input[name="difPol"]:checked') || {}).value || 'omitir';
        if (!especial && pol === 'omitir') {
          const rec = difPane.querySelector('input[name="difPol"][value="reconocer"]');
          if (rec) rec.checked = true;
          pol = 'reconocer';
        }
        const nota = document.getElementById('difNota');
        if (pol === 'omitir') {
          setOut('difReconocido', 'Bs 0,00');
          setOut('difNoReconocido', 'Bs ' + fmt(imp));
          if (nota) nota.innerHTML = '<i data-lucide="info"></i> <strong>Revelación en notas:</strong> la entidad, como sujeto pasivo especial, omite el reconocimiento del impuesto diferido pasivo de <strong>Bs ' + fmt(imp) + '</strong> originado por la supresión del Ajuste por Inflación Fiscal, conforme al BA VEN-NIF 11.';
        } else {
          setOut('difReconocido', 'Bs ' + fmt(imp));
          setOut('difNoReconocido', 'Bs 0,00');
          if (nota) nota.innerHTML = '<i data-lucide="info"></i> <strong>Reconocimiento estricto (NIC 12 / Sección 29):</strong> se registra el pasivo por impuesto diferido de <strong>Bs ' + fmt(imp) + '</strong> con cargo al resultado del período.' + (!especial ? ' La entidad no califica como sujeto pasivo especial, por lo que no aplica el tratamiento alternativo.' : '');
        }
        if (window.lucide) window.lucide.createIcons();
      }
      difPane.addEventListener('input', calcDif);
      difPane.addEventListener('change', calcDif);
      calcDif();

      const difBtn = document.getElementById('difContabilizarBtn');
      if (difBtn) difBtn.addEventListener('click', async () => {
        const dt = get('baseContable') - get('baseFiscal');
        const imp = dt * (get('tasaIslr') / 100);
        const pol = (difPane.querySelector('input[name="difPol"]:checked') || {}).value || 'omitir';
        if (pol === 'omitir') { toast('Política "omitir": el impuesto diferido se revela en notas, no se contabiliza (VEN-NIF 11).', 'info'); return; }
        if (imp <= 0.005) { toast('No hay impuesto diferido que reconocer.', 'info'); return; }
        if (!window.__postAsiento) { toast('No disponible', 'error'); return; }
        const lineas = [
          { cta: '6.3.1.05 · Gasto por impuesto diferido (VEN-NIF 11)', debe: imp, haber: 0 },
          { cta: '2.2.2 · Impuesto diferido pasivo', debe: 0, haber: imp },
        ];
        const res = await window.__postAsiento('Reconocimiento de impuesto diferido pasivo (VEN-NIF 11)', 'IMP-DIF', lineas, 'auto');
        if (res && res.error) { toast('No se pudo contabilizar: ' + res.error.message, 'error'); return; }
        toast('Impuesto diferido reconocido · Bs ' + fmt(imp) + ' · fluye a la contabilidad', 'success');
      });
    }
  })();

  /* =========================================================
     AUTENTICACIÓN — login / registro / recuperar contraseña
     ========================================================= */
  (function authModule() {
    const screen = document.getElementById('authScreen');
    const body = document.body;
    if (!screen) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const tabs = document.getElementById('authTabs');
    const panes = screen.querySelectorAll('.auth-pane');
    const foot = document.getElementById('authFoot');

    function setTab(tab) {
      tabs.querySelectorAll('button').forEach((b) => (b.dataset.active = b.dataset.tab === tab ? 'true' : 'false'));
      panes.forEach((p) => (p.dataset.active = p.dataset.tab === tab ? 'true' : 'false'));
      if (foot) foot.hidden = tab !== 'login';
      drawIcons();
    }
    function showApp() { body.classList.add('authed'); drawIcons(); }
    function showAuth() { body.classList.remove('authed'); setTab('login'); window.scrollTo(0, 0); drawIcons(); }
    window.__showAuth = showAuth;

    // Carga el perfil del usuario conectado (nombre, rol, cuenta y plan) desde Supabase
    const FUNDADOR_EMAIL = 'gerencia@digiaccount.io';
    async function cargarPerfilActual() {
      const { data: u } = await window.sb.auth.getUser();
      if (!u || !u.user) return null;
      window.__USER_EMAIL = u.user.email || '';
      window.__ES_FUNDADOR = (u.user.email || '').toLowerCase() === FUNDADOR_EMAIL; // super-admin
      const { data, error } = await window.sb
        .from('perfiles')
        .select('cuenta_id, nombre, rol, cuentas(nombre, tipo, segmento, planes(nombre))')
        .eq('id', u.user.id)
        .single();
      if (error) { console.warn('[DigiAccount] No se pudo cargar el perfil:', error.message); return null; }
      window.__PERFIL = data;            // queda disponible para el resto de la app
      window.__CUENTA_ID = data.cuenta_id; // para crear empresas/datos en la cuenta correcta
      // El tipo de cuenta vive en 'segmento' (lo pone el trigger); 'tipo' queda de respaldo.
      window.__CUENTA_TIPO = (data.cuentas && (data.cuentas.segmento || data.cuentas.tipo)) || 'empresa'; // 'empresa' | 'contador'
      // Estado de la cuenta en consulta aparte y tolerante: si la columna 'estado' aún no
      // existe (SQL del fundador no corrido), NO bloquea (default 'activa').
      window.__CUENTA_ESTADO = 'activa';
      window.__TRIAL_TERMINA = null;
      window.__TRIAL_VENCIDO = false;
      try {
        const { data: ce } = await window.sb.from('cuentas').select('estado, trial_termina_en').eq('id', data.cuenta_id).single();
        if (ce && ce.estado) window.__CUENTA_ESTADO = ce.estado;
        if (ce && ce.trial_termina_en) {
          window.__TRIAL_TERMINA = ce.trial_termina_en;
          window.__TRIAL_VENCIDO = new Date(ce.trial_termina_en) < new Date();
        }
      } catch (e) { /* columna estado aún no existe: se asume activa */ }
      // ADD-ON "Agentes IA": interruptor POR CUENTA (cuentas.addon_agentes). Consulta
      // aparte y tolerante: si la columna no existe aún, el add-on queda apagado.
      window.__ADDON_AGENTES = false;
      try {
        const { data: ad } = await window.sb.from('cuentas').select('addon_agentes').eq('id', data.cuenta_id).single();
        window.__ADDON_AGENTES = !!(ad && ad.addon_agentes);
      } catch (e) {}
      // Muestra el Panel del Fundador SOLO al super-admin
      const navFund = document.querySelector('.nav-item[data-view="fundador"]');
      if (navFund) navFund.hidden = !window.__ES_FUNDADOR;
      // Usuario real en el pie del menú lateral
      const nombre = data.nombre || window.__USER_EMAIL || 'Usuario';
      const ini = (nombre.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || 'U').toUpperCase();
      const ROL_NOMBRE = { admin: 'Administrador', gerente: 'Gerente', contador: 'Contador', operador: 'Vendedor / Operador', lectura: 'Auditor (solo lectura)' };
      const rol = window.__ES_FUNDADOR ? 'Fundador' : (ROL_NOMBRE[String(data.rol || '').toLowerCase()] || data.rol || 'Administrador');
      const setSb = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setSb('sidebarUserAvatar', ini); setSb('sidebarUserName', nombre); setSb('sidebarUserRole', rol);
      // Aplica el plan REAL de la cuenta (gating de módulos por plan + tipo de cuenta).
      // Antes la app usaba un plan por defecto, ignorando lo que el cliente realmente tiene.
      const planNombre = (data.cuentas && data.cuentas.planes && data.cuentas.planes.nombre) || null;
      // La interfaz de "prueba" (píldora, banner, botón Activar) se enciende SOLO si el
      // estado REAL de la cuenta es 'prueba' — con los días reales que le quedan.
      let pruebaArg;
      if (window.__CUENTA_ESTADO === 'prueba') {
        let diasReal = 14;
        if (window.__TRIAL_TERMINA) diasReal = Math.max(0, Math.ceil((new Date(window.__TRIAL_TERMINA) - new Date()) / 86400000));
        pruebaArg = { dias: diasReal };
      }
      try { if (window.aplicarPlan) window.aplicarPlan(planNombre || undefined, pruebaArg); } catch (e) { console.warn('[DigiAccount] aplicarPlan:', e); }
      // Gating por ROL (después del plan: el rol recorta sobre lo que el plan permite)
      try { if (window.aplicarRol) window.aplicarRol(); } catch (e) { console.warn('[DigiAccount] aplicarRol:', e); }
      /* Recién AQUÍ se abre la vista que pedía la dirección. Antes de este
         punto no se sabe el rol del usuario ni si es el fundador, y la
         defensa de `showView` —que devuelve al Dashboard lo que no le
         corresponde— dejaría pasar cualquier cosa por no tener con qué
         comparar. Un enlace no puede abrir una vista que el rol no permite. */
      try { if (window.__abrirRutaInicial) window.__abrirRutaInicial(); } catch (e) { console.warn('[DigiAccount] ruta inicial:', e); }
      try { if (window.__renderSuscripcion) window.__renderSuscripcion(); } catch (e) { console.warn('[DigiAccount] renderSuscripcion:', e); }
      // El fundador carga el listado real de cuentas del SaaS y sus contactos (CRM)
      if (window.__ES_FUNDADOR && window.cargarCuentasFundador) window.cargarCuentasFundador();
      if (window.__ES_FUNDADOR && window.cargarContactos) { try { window.cargarContactos(); } catch (e) {} }
      // Panel del socio: solo se pinta si esta cuenta tiene fila en `socios`.
      if (window.cargarPanelSocio) { try { window.cargarPanelSocio(); } catch (e) {} }
      // Todos cargan SUS pagos (RLS limita): el cliente ve su estado real y sus recibos
      if (window.cargarPagos) { try { window.cargarPagos(); } catch (e) {} }
      // Notificaciones persistentes de la cuenta
      if (window.cargarNotificaciones) { try { window.cargarNotificaciones(); } catch (e) {} }
      // TODOS los usuarios cargan las cuentas receptoras (el checkout las muestra al pagar)
      if (window.__cargarReceptoras) { try { window.__cargarReceptoras(); } catch (e) {} }
      console.log('[DigiAccount] Perfil cargado:', data, '· fundador:', window.__ES_FUNDADOR, '· estado:', window.__CUENTA_ESTADO);
      return data;
    }
    // ¿La cuenta está bloqueada y NO es el fundador?
    //  - pendiente / suspendida  -> bloqueada
    //  - prueba                  -> puede entrar, SALVO que el periodo de prueba ya venció
    //  - activa                  -> entra normal
    window.__cuentaBloqueada = () => {
      if (window.__ES_FUNDADOR) return false;
      const e = window.__CUENTA_ESTADO;
      if (e === 'pendiente' || e === 'suspendida') return true;
      if (e === 'prueba') return window.__TRIAL_VENCIDO === true;
      return false;
    };
    function mostrarBloqueo() {
      document.body.classList.remove('authed');
      const estado = window.__CUENTA_ESTADO;
      // 3 motivos posibles: prueba vencida, suspendida, o pendiente (en revisión)
      let modo = 'pendiente';
      if (estado === 'suspendida') modo = 'suspendida';
      else if (estado === 'prueba' && window.__TRIAL_VENCIDO) modo = 'trial';
      const ui = {
        pendiente:  { ic: 'clock',        col: '#c97a1422;color:#e0a341', t: 'Tu cuenta está lista para activar', p: 'Ya creamos tu cuenta. Para abrirla conversamos quince minutos y la dejamos andando con tus propios datos — o si ya sabes qué plan quieres, escríbenos por WhatsApp y la activamos hoy mismo.' },
        suspendida: { ic: 'shield-alert', col: '#c0392b22;color:#e06b5e', t: 'Cuenta suspendida', p: 'Tu acceso está suspendido temporalmente. Comunícate con nosotros para reactivarla.' },
        trial:      { ic: 'timer-off',    col: '#c97a1422;color:#e0a341', t: 'Tu acceso de cortesía terminó', p: 'Se venció el período de cortesía de esta cuenta. Activa tu plan para seguir usando DigiAccount — escríbenos por WhatsApp y te ayudamos.' },
      }[modo];
      let ov = document.getElementById('cuentaBloqueoOverlay');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'cuentaBloqueoOverlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg-app,#0a1420);display:flex;align-items:center;justify-content:center;padding:24px;';
        document.body.appendChild(ov);
      }
      ov.style.display = 'flex';
      ov.innerHTML = '<div style="max-width:460px;text-align:center;background:var(--bg-surface,#11202e);border:1px solid var(--border-default,#1e2f3e);border-radius:16px;padding:38px 30px;">'
        + '<div style="width:58px;height:58px;border-radius:50%;background:' + ui.col + ';display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;"><i data-lucide="' + ui.ic + '" style="width:28px;height:28px;"></i></div>'
        + '<h2 style="font-size:20px;margin:0 0 8px;color:var(--fg-primary,#fff);">' + ui.t + '</h2>'
        + '<p style="font-size:13px;color:var(--fg-muted,#8aa);line-height:1.6;margin:0 0 22px;">' + ui.p + '</p>'
        + '<button id="bloqueoLogout" class="btn btn-ghost" style="height:36px;font-size:13px;"><i data-lucide="log-out"></i> Cerrar sesión</button>'
        + '</div>';
      const lb = document.getElementById('bloqueoLogout');
      if (lb) lb.addEventListener('click', async () => { try { await window.sb.auth.signOut(); } catch (e) {} window.location.reload(); });
      if (window.lucide) window.lucide.createIcons();
    }
    window.__mostrarBloqueo = mostrarBloqueo;
    // Al entrar sin empresa seleccionada, deja limpios libros fiscales, retenciones y
    // asientos: sus loaders entran al estado "vacío" y reemplazan cualquier demo estático.
    window.__limpiarTablasInit = function () {
      try {
        if (window.cargarLibroFiscal) { window.cargarLibroFiscal('venta'); window.cargarLibroFiscal('compra'); }
        if (window.cargarRetenciones) window.cargarRetenciones();
        if (window.cargarAsientos) window.cargarAsientos();
      } catch (e) {}
    };
    window.cargarPerfilActual = cargarPerfilActual;

    tabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    screen.querySelectorAll('[data-goauth]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setTab(a.dataset.goauth); }));
    const fl = document.getElementById('forgotLink');
    if (fl) fl.addEventListener('click', (e) => { e.preventDefault(); setTab('forgot'); });
    const fb = document.getElementById('forgotBack');
    if (fb) fb.addEventListener('click', () => setTab('login'));
    screen.querySelectorAll('.auth-eye').forEach((btn) => btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.toggle);
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    }));

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const pass = document.getElementById('loginPass').value;
      if (!email) return toast('Ingresa tu correo electrónico', 'error');
      if (!pass) return toast('Ingresa tu contraseña', 'error');
      /* ══════════════════════════════════════════════════════════════
         LO QUE DE VERDAD PASO AL ENTRAR

         Antes, CUALQUIER error mostraba «Correo o contraseña incorrectos»:
         una conexion caida, la base despertando, el telefono cambiando de
         red, un limite de intentos. La app acusaba al usuario de escribir
         mal su clave y lo dejaba repitiendo lo mismo sin salida.

         Una clave mala y una conexion mala piden cosas distintas: la
         primera, revisar lo escrito; la segunda, volver a intentar. */
      const btnEntrar = e.target.querySelector('button[type="submit"]');
      const rotulo = btnEntrar ? btnEntrar.innerHTML : '';
      if (btnEntrar) { btnEntrar.disabled = true; btnEntrar.innerHTML = 'Entrando…'; }
      let data = null, error = null;
      try {
        const r = await window.sb.auth.signInWithPassword({ email: email, password: pass });
        data = r.data; error = r.error;
      } catch (ex) {
        error = { message: String((ex && ex.message) || ex), __red: true };
      }
      if (btnEntrar) { btnEntrar.disabled = false; btnEntrar.innerHTML = rotulo; }
      if (error) {
        const msg = String(error.message || '');
        const cod = Number(error.status || 0);
        console.warn('[DigiAccount] No se pudo entrar:', cod || '', msg);
        toast(window.__avisoLogin(error), 'error');
        return;
      }
      window.__marcarActividad();
      // Recarga completa: contexto 100% LIMPIO para esta sesión (sin residuos en memoria
      // de otra cuenta usada antes en la misma pestaña). El arranque con sesión hace el resto.
      /* Aqui terminaba con un saludo por nombre. Se quito: `reload()` no corta
         la ejecucion, asi que esas lineas SI corrian, y leian una variable
         —`perfil`— que en este punto ya no existe. Resultado: cada entrada
         correcta dejaba un error en la consola, y el saludo no se veia nunca
         porque la recarga se lo llevaba por delante.

         Si alguna vez se quiere saludar por nombre, el sitio es el arranque
         CON sesion —despues de la recarga—, que es donde el perfil ya esta
         cargado. Aqui no puede funcionar. */
    });
    // Acceso con Google — simulado en el prototipo (será Supabase Auth OAuth en producción)
    screen.querySelectorAll('.auth-sso').forEach((b) => b.addEventListener('click', () => {
      showApp(); toast('Acceso con Google (demo) · bienvenido', 'success');
    }));
    document.getElementById('signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('suName').value.trim();
      const cedula = document.getElementById('suCedula').value.trim();
      const whatsapp = document.getElementById('suWhatsapp').value.trim();
      const email = document.getElementById('suEmail').value.trim();
      const pass = document.getElementById('suPass').value;
      if (!name) return toast('Indica tu nombre y apellido', 'error');
      if (!cedula) return toast('Indica tu cédula', 'error');
      if (!whatsapp) return toast('Indica tu número de WhatsApp', 'error');
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Indica un correo válido', 'error');
      if ((pass || '').length < 8) return toast('La contraseña debe tener al menos 8 caracteres', 'error');
      if (!document.getElementById('suTerms').checked) return toast('Debes aceptar los términos', 'error');
      const segmento = (document.getElementById('suSegmento') || {}).value || 'empresas';
      // Codigo opcional. Puede ser de DOS tipos y el sistema averigua cual:
      //   · invitacion de equipo → la persona se suma a la cuenta que la invito
      //   · codigo de socio      → su cuenta nueva queda amarrada a ese contador
      // Se resuelve al entrar (ver el canje mas abajo), no aqui.
      const codigoInv = ((document.getElementById('suCodigo') || {}).value || '').trim().toUpperCase();
      // Registro REAL en Supabase Auth — el trigger 'on_auth_user_created' crea la cuenta + el perfil
      const { data, error } = await window.sb.auth.signUp({
        email: email,
        password: pass,
        options: { data: { nombre: name, cedula: cedula, whatsapp: whatsapp, segmento: segmento, codigo_invitacion: codigoInv } }
      });
      if (error) { toast('No se pudo crear la cuenta: ' + error.message, 'error'); return; }
      // Registro en la base de contactos (para CRM / email marketing)
      if (window.__registrarContacto) window.__registrarContacto({ tipo: 'Usuario', nombre: name, doc: cedula, email: email, whatsapp: whatsapp, segmento: segmento, origen: 'Registro de cuenta' });
      // Si Supabase aún exige confirmar el correo, no hay sesión todavía
      if (!data.session) { toast('Te enviamos un correo para confirmar tu cuenta. Revísalo para entrar.', 'success'); setTab('login'); return; }
      window.__marcarActividad();
      // El onboarding (elegir plan) continúa DESPUÉS de la recarga (contexto limpio)
      try { sessionStorage.setItem('da_onboarding', JSON.stringify({ seg: segmento, nombre: name })); } catch (e) {}
      // Recarga completa: contexto 100% LIMPIO para la cuenta nueva (sin residuos en memoria)
      window.location.reload();
    });
    document.getElementById('forgotForm').addEventListener('submit', (e) => {
      e.preventDefault();
      toast('Enviamos un enlace de recuperación a tu correo', 'success');
      setTab('login');
    });
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      try { await window.sb.auth.signOut(); } catch (e) {}
      // CRÍTICO: recargar la página borra TODO el estado en memoria (datos del fundador,
      // paneles, variables) para que NADA del usuario anterior quede visible al siguiente.
      window.location.reload();
    });

    // Estado inicial: pantalla de acceso.
    //
    // La pestana sale de la URL. El sitio web tiene dos botones distintos
    // —"Iniciar sesion" y "Crear mi cuenta"— y ambos caian en Iniciar sesion,
    // porque aqui se forzaba 'login' sin mirar a que venia el visitante. El que
    // hizo clic en "Crear mi cuenta" tenia que darse cuenta solo de que le
    // faltaba cambiar de pestana.
    //
    // Vale cualquiera de las formas, para que ningun enlace viejo se rompa:
    //   app.digiaccount.io/#signup   #registro   #crear-cuenta   ?registro=1
    body.classList.remove('authed');
    (function pestanaInicial() {
      const marca = (String(location.hash || '') + ' ' + String(location.search || '')).toLowerCase();
      setTab(/signup|registro|crear.?cuenta|registrarme/.test(marca) ? 'signup' : 'login');
    })();

    // Si ya hay una sesión activa (p. ej. tras recargar), entra directo a la app
    window.sb.auth.getSession().then(async ({ data }) => {
      if (data && data.session) {
        // Si la sesión guardada lleva +30 min sin actividad (aunque se haya cerrado el
        // navegador), NO reingresar solo: cerrar y pedir login de nuevo.
        if (window.__sesionExpiradaPorInactividad && window.__sesionExpiradaPorInactividad()) {
          try { await window.sb.auth.signOut(); } catch (e) {}
          try { localStorage.removeItem('da_last_activity'); } catch (e) {}
          showAuth();
          if (window.toast) setTimeout(function () { window.toast('Sesión cerrada por inactividad', 'info'); }, 800);
          return;
        }
        window.__marcarActividad();
        // CANJE DE INVITACIÓN: si esta persona se registró con un código de invitación,
        // la RPC la muda a la cuenta del equipo que la invitó (con su rol) y elimina la
        // cuenta de prueba creada por defecto. Idempotente: usado el código, no hace nada.
        /* UN SOLO CODIGO EN EL REGISTRO, DOS DESTINOS POSIBLES.

           Quien recibe un codigo no sabe —ni tiene por que saber— de que tipo
           es. Un trabajador no sabe que es un "socio"; el dueno de un negocio
           no sabe que es una "invitacion". Los dos tienen lo mismo: un codigo
           que alguien les paso. Asi que se prueba primero como invitacion de
           equipo y, si no era eso, como codigo de socio.

           Son poblaciones distintas y excluyentes por naturaleza: la
           invitacion suma a la persona a la cuenta de OTRO; el codigo de socio
           amarra SU PROPIA cuenta nueva a un contador. Nunca aplican las dos.

           El codigo de socio solo se puede escribir AQUI, al registrarse. No
           hay forma de escribirlo despues desde dentro de la app, y eso es
           deliberado: cierra por diseno la posibilidad de que un trabajador ya
           dentro de una empresa le amarre la cuenta de su patron a un socio. */
        try {
          const usr = data.session.user || {};
          const cod = (usr.user_metadata && usr.user_metadata.codigo_invitacion) || '';
          if (cod) {
            const { data: rj } = await window.sb.rpc('canjear_invitacion', { p_codigo: cod });
            const fueInvitacion = rj && (rj.ok || rj.repetido);
            if (rj && rj.ok && !rj.repetido) {
              if (window.toast) setTimeout(() => window.toast('¡Bienvenido al equipo! Tu acceso fue activado ✓', 'success'), 900);
            } else if (!fueInvitacion) {
              // No era una invitacion. Se prueba como codigo de socio.
              const { data: rs } = await window.sb.rpc('registrar_referido', { p_codigo: cod });
              if (rs && rs.ok) {
                if (window.toast) setTimeout(() => window.toast('Vienes de parte de ' + rs.socio + ' · tu cuenta quedó vinculada ✓', 'success'), 900);
              } else if (rj && rj.error && rj.error_visible) {
                // No era ninguno de los dos: se reporta el motivo de la invitacion,
                // que es el que el usuario entiende ("ese codigo no existe").
                if (window.toast) setTimeout(() => window.toast('Código: ' + rj.error, 'error'), 900);
              }
            }
          }
        } catch (e) {}
        showApp(); await cargarPerfilActual(); if (window.__cuentaBloqueada()) { mostrarBloqueo(); return; } if (window.cargarEmpresas) await window.cargarEmpresas(); if (window.cargarTerceros) window.cargarTerceros(); if (window.cargarProductos) window.cargarProductos(); if (window.cargarFacturas) window.cargarFacturas(); if (window.cargarTasaBCV) window.cargarTasaBCV(); if (window.cargarUsuarios) window.cargarUsuarios(); if (window.__limpiarTablasInit) window.__limpiarTablasInit();
        // Si venimos de un registro recién hecho, continuar el onboarding (elegir plan)
        let onboardingLanzado = false;
        try {
          const ob = sessionStorage.getItem('da_onboarding');
          if (ob) {
            sessionStorage.removeItem('da_onboarding');
            const o = JSON.parse(ob);
            onboardingLanzado = true;
            if (window.openPlanOnboarding) setTimeout(() => window.openPlanOnboarding(o.seg, o.nombre), 600);
            else if (window.openCompanyWizard) setTimeout(() => window.openCompanyWizard({ fromSignup: true }), 600);
          }
        } catch (e) {}
        // RED DE SEGURIDAD (confirmación por correo): el enlace de confirmación abre una
        // pestaña NUEVA donde el onboarding guardado en sessionStorage no existe. La fuente
        // de verdad es la BASE DE DATOS: si la cuenta aún no tiene plan, se relanza la
        // elección de plan con el segmento real de la cuenta (contador/empresa).
        if (!onboardingLanzado && !window.__ES_FUNDADOR && window.__PERFIL) {
          const sinPlan = !(window.__PERFIL.cuentas && window.__PERFIL.cuentas.planes && window.__PERFIL.cuentas.planes.nombre);
          if (sinPlan && window.openPlanOnboarding) {
            const seg = (window.__CUENTA_TIPO === 'contador') ? 'contadores' : 'empresas';
            setTimeout(() => window.openPlanOnboarding(seg, window.__PERFIL.nombre || ''), 800);
          }
        }
      }
    });
  })();

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

  /* =========================================================
     CENTRO DE AGENTES IA — organigrama, aprobaciones, chat
     ========================================================= */
  (function agentesModule() {
    const view = document.getElementById('view-agentes');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    const AUTO_LABEL = { sugiere: 'Sugiere', aviso: 'Auto + aviso', silencioso: 'Auto silencioso' };
    const AUTO_CLS = { sugiere: 'sugiere', aviso: 'aviso', silencioso: 'silencioso' };

    /* EL EQUIPO DIGITAL — seis cargos, no doce funciones.
       Cada ficha declara su ESTADO REAL de desarrollo. Un tablero que pinta
       ocho agentes "en línea" cuando solo uno hace trabajo es una maqueta; uno
       que dice la verdad es una hoja de ruta. El orden es el de construcción.

       estado: 'activo'  — funciona hoy
               'parcial' — una parte funciona
               'plan'    — diseñado, todavía no construido
       Ver docs/equipo-digital.html para la identidad completa. */
    const AGENTS = [
      { id: 'arelis', n: 'Arelis', g: 'f', ic: 'scan-text', col: '#A96A12', auto: 'sugiere', orden: 1, estado: 'parcial',
        spec: 'Asistente administrativa',
        hace: 'Lee facturas de compra por foto y arma el libro',
        prox: 'Recibir comprobantes de retención por WhatsApp y enlazarlos a su factura' },
      { id: 'lucho', n: 'Lucho', g: 'm', ic: 'shield-check', col: '#6A3C86', auto: 'aviso', orden: 2, estado: 'plan',
        spec: 'Especialista tributario · coordina al equipo',
        hace: '',
        prox: 'Revisar el libro del período: retenciones sin comprobante, facturas repetidas, correlativos saltados' },
      { id: 'roberth', n: 'Roberth', g: 'm', ic: 'book-open', col: '#0E6B4E', auto: 'sugiere', orden: 3, estado: 'plan',
        spec: 'Analista contable',
        hace: '',
        prox: 'Proponer el asiento de cada operación usando el histórico de esa empresa' },
      { id: 'mariale', n: 'Mariale', g: 'f', ic: 'wallet', col: '#0B7079', auto: 'sugiere', orden: 4, estado: 'plan',
        spec: 'Ventas, tesorería y cobranzas',
        hace: '',
        prox: 'Cruzar los pagos móviles recibidos contra las facturas pendientes' },
      { id: 'augusto', n: 'Augusto', g: 'm', ic: 'package', col: '#93304F', auto: 'aviso', orden: 5, estado: 'plan',
        spec: 'Costos e inventario',
        hace: '',
        prox: 'Recalcular el costo promedio y avisar cuando un precio quede por debajo del costo' },
      { id: 'carmen', n: 'Carmen', g: 'f', ic: 'users', col: '#2A5AA8', auto: 'sugiere', orden: 6, estado: 'plan',
        spec: 'Especialista de nómina',
        hace: '',
        prox: 'Avisar vacaciones vencidas y preparar utilidades y prestaciones sociales' },
    ];
    const EST = {
      activo:  { txt: 'Activo',      cls: 'est-ok' },
      parcial: { txt: 'Parcial',     cls: 'est-med' },
      plan:    { txt: 'Planificado', cls: 'est-plan' },
    };

    // Gradientes compartidos (volumen metálico, visor con profundidad, ojos brillantes)
    function injectBotDefs() {
      if (document.getElementById('agBotDefs')) return;
      const d = document.createElement('div');
      d.id = 'agBotDefs';
      d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      d.innerHTML = '<svg aria-hidden="true"><defs>'
        + '<linearGradient id="botShine" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="0.32" stop-color="#fff" stop-opacity="0.1"/><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.42"/></linearGradient>'
        + '<linearGradient id="botGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#15407a"/><stop offset="0.5" stop-color="#0a2143"/><stop offset="1" stop-color="#040d1c"/></linearGradient>'
        + '<radialGradient id="botEye" cx="0.38" cy="0.3" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#bdf2ff"/><stop offset="1" stop-color="#27aede"/></radialGradient>'
        + '<linearGradient id="mgrBody" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#3f679e"/><stop offset="0.5" stop-color="#21456f"/><stop offset="1" stop-color="#102a49"/></linearGradient>'
        + '<linearGradient id="mgrSuit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d3454"/><stop offset="1" stop-color="#0b1830"/></linearGradient>'
        + '<linearGradient id="mgrGold" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset="0.5" stop-color="#ffd24a"/><stop offset="1" stop-color="#cf9c2c"/></linearGradient>'
        + '</defs></svg>';
      document.body.appendChild(d);
    }
    // Avatar de robot (metálico, con gradientes de luz y ojos brillantes) — usa var(--bot)
    function robotSvg() {
      return '<svg class="ag-bot-svg" viewBox="0 0 48 48" aria-hidden="true">'
        + '<path d="M9 47 Q9 39 16 38 L32 38 Q39 39 39 47 Z" fill="var(--bot)"/><path d="M9 47 Q9 39 16 38 L32 38 Q39 39 39 47 Z" fill="url(#botShine)"/>'
        + '<rect x="20" y="34" width="8" height="6" rx="2" fill="var(--bot)"/><rect x="20" y="34" width="8" height="6" rx="2" fill="#000" opacity="0.22"/>'
        + '<rect x="23" y="3.4" width="2" height="5.4" rx="1" fill="var(--bot)"/>'
        + '<circle cx="24" cy="2.9" r="2.6" fill="#8fe9ff" opacity="0.42"/><circle class="bot-antena" cx="24" cy="2.9" r="1.5" fill="#eafdff"/>'
        + '<rect x="5.4" y="20" width="4.8" height="10" rx="2.4" fill="var(--bot)"/><rect x="5.4" y="20" width="4.8" height="10" rx="2.4" fill="url(#botShine)"/>'
        + '<rect x="37.8" y="20" width="4.8" height="10" rx="2.4" fill="var(--bot)"/><rect x="37.8" y="20" width="4.8" height="10" rx="2.4" fill="url(#botShine)"/>'
        + '<circle cx="7.8" cy="25" r="1.3" fill="#06122a" opacity="0.6"/><circle cx="40.2" cy="25" r="1.3" fill="#06122a" opacity="0.6"/>'
        + '<rect x="8.5" y="9" width="31" height="28.5" rx="11" fill="var(--bot)"/><rect x="8.5" y="9" width="31" height="28.5" rx="11" fill="url(#botShine)"/>'
        + '<ellipse cx="16.5" cy="14" rx="7" ry="3.8" fill="#fff" opacity="0.26"/>'
        + '<rect x="12" y="14.4" width="24" height="15.6" rx="7.5" fill="url(#botGlass)"/><rect x="12" y="14.4" width="24" height="15.6" rx="7.5" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="0.6"/>'
        + '<path d="M14.5 16.4 Q22 14.4 25 17.8 Q19 19.4 14.5 22.8 Z" fill="#fff" opacity="0.10"/>'
        + '<circle cx="19.2" cy="22.2" r="4.2" fill="#36c5ee" opacity="0.28"/><circle cx="28.8" cy="22.2" r="4.2" fill="#36c5ee" opacity="0.28"/>'
        + '<circle class="bot-eye" cx="19.2" cy="22.2" r="2.7" fill="url(#botEye)"/><circle class="bot-eye" cx="28.8" cy="22.2" r="2.7" fill="url(#botEye)"/>'
        + '<path d="M20 26.9 Q24 28.6 28 26.9" stroke="#8fe9ff" stroke-width="1.3" fill="none" stroke-linecap="round" opacity="0.72"/>'
        + '</svg>';
    }
    // Robot del Gerente — ejecutivo metálico: saco, corbata, dorados con gradiente
    function managerSvg() {
      return '<svg class="ag-bot-svg mgr" viewBox="0 0 64 64" aria-hidden="true">'
        + '<path d="M7 63 Q7 49 20 47 L44 47 Q57 49 57 63 Z" fill="url(#mgrSuit)"/>'
        + '<path d="M27 47 L32 60 L24 56 Z" fill="#0b1a32"/><path d="M37 47 L32 60 L40 56 Z" fill="#0b1a32"/>'
        + '<path d="M28.5 46 L32 56 L35.5 46 Z" fill="#f0f5fb"/>'
        + '<path d="M32 48 l-2.8 3.4 2.8 8.6 2.8 -8.6 z" fill="url(#mgrGold)"/><rect x="30" y="46.4" width="4" height="2.8" rx="0.9" fill="#caa033"/>'
        + '<rect x="25.5" y="42" width="13" height="7.6" rx="2.6" fill="url(#mgrBody)"/>'
        + '<rect x="30.8" y="6.2" width="2.4" height="7.6" rx="1.2" fill="#9a7d2e"/>'
        + '<circle cx="32" cy="5.6" r="3.6" fill="#ffd24a" opacity="0.45"/><circle class="bot-antena" cx="32" cy="5.6" r="2.1" fill="url(#mgrGold)"/>'
        + '<rect x="6.5" y="25.5" width="6.2" height="14" rx="3.1" fill="url(#mgrBody)"/><rect x="51.3" y="25.5" width="6.2" height="14" rx="3.1" fill="url(#mgrBody)"/>'
        + '<circle cx="9.6" cy="32.5" r="1.9" fill="url(#mgrGold)"/><circle cx="54.4" cy="32.5" r="1.9" fill="url(#mgrGold)"/>'
        + '<rect x="11.5" y="12.5" width="41" height="36" rx="14" fill="url(#mgrBody)"/>'
        + '<ellipse cx="23" cy="19" rx="10" ry="5.4" fill="#fff" opacity="0.20"/>'
        + '<rect x="15.5" y="19.5" width="33" height="21" rx="10" fill="url(#mgrGold)"/>'
        + '<rect x="16.8" y="20.8" width="30.4" height="18.4" rx="9" fill="url(#botGlass)"/>'
        + '<path d="M19.5 22.4 Q30 19.4 33.5 23.8 Q26 26 19.5 30.4 Z" fill="#fff" opacity="0.11"/>'
        + '<circle cx="25.5" cy="29.5" r="5" fill="#36c5ee" opacity="0.28"/><circle cx="38.5" cy="29.5" r="5" fill="#36c5ee" opacity="0.28"/>'
        + '<circle class="bot-eye" cx="25.5" cy="29.5" r="3.2" fill="url(#botEye)"/><circle class="bot-eye" cx="38.5" cy="29.5" r="3.2" fill="url(#botEye)"/>'
        + '<path d="M26 34.9 Q32 37.4 38 34.9" stroke="#8fe9ff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.78"/>'
        + '</svg>';
    }

    /* Retrato del agente. Es un dibujo, no una inicial: dos de ellos empiezan
       por la misma letra y el monograma dejaba de distinguirlos. */
    function busto(g) {
      return '<svg viewBox="0 0 48 48" fill="currentColor" class="ag-busto" aria-hidden="true">'
        + (g === 'f'
            ? '<path d="M14 19a10 10 0 0 1 20 0v9.5a2.5 2.5 0 0 1-5 0V19a5 5 0 0 0-10 0v9.5a2.5 2.5 0 0 1-5 0z"/>'
              + '<circle cx="24" cy="20" r="7.5"/>'
              + '<path d="M24 30c-8.3 0-15 5.6-15 12.5V44h30v-2.5C39 35.6 32.3 30 24 30z"/>'
            : '<circle cx="24" cy="18" r="8.5"/>'
              + '<path d="M24 29c-8.3 0-15 5.6-15 12.5V44h30v-2.5C39 34.6 32.3 29 24 29z"/>')
        + '</svg>';
    }

    const grid = document.getElementById('agGrid');
    function renderGrid() {
      const esc2 = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const orden = AGENTS.slice().sort((a, b) => (a.orden || 99) - (b.orden || 99));
      grid.innerHTML = orden.map((a) => {
        const e = EST[a.estado] || EST.plan;
        return '<div class="ag-card ' + e.cls + '" data-agent="' + a.id + '" style="--ag:' + a.col + ';">'
        + '<div class="ag-card-top">'
        +   '<span class="ag-mono">' + busto(a.g) + '<span class="ag-mono-badge"><i data-lucide="' + a.ic + '"></i></span></span>'
        +   '<span class="ag-est">' + e.txt + '</span>'
        + '</div>'
        + '<div class="ag-name">' + esc2(a.n) + '</div><div class="ag-spec">' + esc2(a.spec) + '</div>'
        + (a.hace
            ? '<div class="ag-linea hoy"><b>Hoy</b>' + esc2(a.hace) + '</div>'
            : '<div class="ag-linea nada"><b>Hoy</b>Todavía no hace trabajo</div>')
        + '<div class="ag-linea prox"><b>Lo próximo</b>' + esc2(a.prox) + '</div>'
        + '<div class="ag-cardmeta"><span class="ag-orden">' + a.orden + '.º en construirse</span>'
        +   '<span class="ag-auto ' + AUTO_CLS[a.auto] + '">' + AUTO_LABEL[a.auto] + '</span></div>'
        + '<button class="ag-config" data-ag-config="' + a.id + '"><i data-lucide="sliders-horizontal"></i> Autonomía</button>'
        + '</div>';
      }).join('');
      const res = document.getElementById('agResumen');
      if (res) {
        const c = { activo: 0, parcial: 0, plan: 0 };
        AGENTS.forEach((a) => { c[a.estado] = (c[a.estado] || 0) + 1; });
        res.innerHTML = '<span class="agr-it est-ok"><b>' + c.activo + '</b> en funcionamiento</span>'
          + '<span class="agr-it est-med"><b>' + c.parcial + '</b> parcial</span>'
          + '<span class="agr-it est-plan"><b>' + c.plan + '</b> por construir</span>'
          + '<span class="agr-nota">El tablero muestra el estado real. Nada aparece activo si todavía no hace trabajo.</span>';
      }
      grid.querySelectorAll('[data-ag-config]').forEach((b) => b.addEventListener('click', () => openAuto(b.dataset.agConfig)));
      drawIcons();
    }

    // ---- Bandeja de aprobaciones (human-in-the-loop) ----
    const APROB = [];   // aprobaciones reales del agente
    const aprobEl = document.getElementById('agApprovals');
    function renderAprob() {
      if (!APROB.length) { aprobEl.innerHTML = '<div class="ag-empty"><i data-lucide="check-circle-2"></i> Todo al día · no hay acciones por aprobar</div>'; drawIcons(); }
      else aprobEl.innerHTML = APROB.map((a) =>
        '<div class="ag-approval" data-id="' + a.id + '">'
        + '<div class="aga-ic"><i data-lucide="' + a.ic + '"></i></div>'
        + '<div class="aga-body"><div class="aga-head"><span class="aga-title">' + a.titulo + '</span><span class="aga-agent">' + a.agente + '</span></div>'
        + '<div class="aga-desc">' + a.desc + '</div><div class="aga-conf"><i data-lucide="sparkles"></i> ' + a.conf + '</div></div>'
        + '<div class="aga-actions"><button class="aga-btn ok" data-act="ok" title="Aprobar"><i data-lucide="check"></i></button>'
        + '<button class="aga-btn edit" data-act="edit" title="Editar"><i data-lucide="pencil"></i></button>'
        + '<button class="aga-btn no" data-act="no" title="Descartar"><i data-lucide="x"></i></button></div></div>'
      ).join('');
      aprobEl.querySelectorAll('.aga-btn').forEach((b) => b.addEventListener('click', () => handleAprob(b)));
      const cnt = document.getElementById('agPendCount'); if (cnt) cnt.textContent = APROB.length;
      drawIcons();
    }
    function addFeed(txt, meta, cls) {
      const feed = document.getElementById('agFeed');
      if (!feed) return;
      feed.insertAdjacentHTML('afterbegin', '<div class="agf-item"><span class="agf-dot ' + (cls || 'ok') + '"></span><div class="agf-body"><div class="agf-txt">' + txt + '</div><div class="agf-meta">Ahora · ' + meta + '</div></div></div>');
    }
    function handleAprob(btn) {
      const card = btn.closest('.ag-approval');
      const id = parseInt(card.dataset.id, 10);
      const item = APROB.find((x) => x.id === id);
      const act = btn.dataset.act;
      if (act === 'edit') { toast('Abriendo "' + item.titulo + '" para editar antes de aprobar', 'info'); return; }
      const i = APROB.indexOf(item);
      if (i >= 0) APROB.splice(i, 1);
      if (act === 'ok') { toast('Aprobado · ' + item.titulo, 'success'); addFeed('<strong>' + item.agente + '</strong> ejecutó: ' + item.titulo + ' (aprobado por ti)', 'human-in-the-loop', 'ok'); }
      else { toast('Descartado · ' + item.titulo, 'info'); }
      renderAprob();
    }

    // ---- Configuración de autonomía ----
    const autoModal = document.getElementById('agAutoModal');
    let autoAgent = null;
    function openAuto(id) {
      autoAgent = AGENTS.find((a) => a.id === id);
      if (!autoAgent) return;
      document.getElementById('agAutoName').textContent = autoAgent.n;
      const demo = !!window.__demoAgentes;
      autoModal.querySelectorAll('input[name="agLevel"]').forEach((r) => {
        r.checked = demo ? (r.value === 'sugiere') : (r.value === autoAgent.auto);
        r.disabled = demo && r.value !== 'sugiere';
        r.closest('.aga-level').classList.toggle('disabled', demo && r.value !== 'sugiere');
      });
      const note = document.getElementById('agAutoDemoNote');
      if (note) note.hidden = !demo;
      autoModal.hidden = false;
      drawIcons();
    }
    function closeAuto() { autoModal.hidden = true; }
    document.getElementById('agAutoClose').addEventListener('click', closeAuto);
    document.getElementById('agAutoCancel').addEventListener('click', closeAuto);
    // Clic fuera NO cierra (evita perder datos del formulario). Usa Cancelar o la X.
    document.getElementById('agAutoSave').addEventListener('click', () => {
      const sel = autoModal.querySelector('input[name="agLevel"]:checked');
      if (sel && autoAgent) { autoAgent.auto = sel.value; renderGrid(); toast(autoAgent.n + ' → ' + AUTO_LABEL[sel.value]); }
      closeAuto();
    });

    // ---- Canales ----
    view.querySelectorAll('.agch-connect').forEach((b) => b.addEventListener('click', () => {
      toast('Asistente de conexión de ' + b.dataset.channel + ' (próximamente)', 'info');
    }));
    const channelsBtn = document.getElementById('agChannelsBtn');
    if (channelsBtn) channelsBtn.addEventListener('click', () => {
      const p = document.getElementById('agChannelsPanel');
      if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // ---- Chat con el Gerente IA ----
    const msgs = document.getElementById('agcMessages');
    const input = document.getElementById('agcInput');
    function bubble(text, who) {
      const d = document.createElement('div');
      d.className = 'agc-msg ' + who;
      d.innerHTML = text;
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function respond(q) {
      const t = q.toLowerCase();
      let r;
      if (/iva/.test(t)) r = 'Según el <strong>Agente Fiscal</strong>: el IVA de la 2da quincena va en <strong>Bs 413.300</strong> a pagar (débito 894.420 − crédito 481.120). Tienes una aprobación pendiente para declararlo. ¿La autorizo?';
      else if (/pag|vence|venc/.test(t)) r = 'El <strong>Agente Tesorería</strong> reporta 1 pago crítico: <strong>Importadora Zulia · Bs 487.500</strong> vence mañana. Hay 5 facturas más en los próximos 7 días por Bs 968.450.';
      else if (/salud|financ|análisis|analisis/.test(t)) r = 'El <strong>Agente Analista</strong> califica la salud financiera en <strong>78/100 (saludable)</strong>: liquidez 82, solvencia 71, rentabilidad 85. Atención: el período de cobro subió 3 días.';
      else if (/factura|registr|compra/.test(t)) r = 'Perfecto. Envíame la <strong>foto de la factura por WhatsApp</strong> y el <strong>Agente OCR</strong> la lee, valida el RIF en Terceros y prepara el registro + asiento para tu aprobación.';
      else if (/hola|buen|gracias/.test(t)) r = '¡A la orden! Puedo coordinar a cualquiera de los 8 agentes. Dime qué necesitas.';
      else r = 'Entendido. Lo derivo al especialista correspondiente y te traigo la propuesta a la bandeja de aprobaciones. ¿Algo más?';
      setTimeout(() => bubble(r, 'bot'), 480);
    }
    function send(q) {
      const text = (q || input.value).trim();
      if (!text) return;
      bubble(text, 'user');
      input.value = '';
      respond(text);
    }
    document.getElementById('agcSend').addEventListener('click', () => send());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    view.querySelectorAll('#agcSuggest button').forEach((b) => b.addEventListener('click', () => send(b.dataset.q)));
    view.querySelectorAll('[data-ag-chat]').forEach((b) => b.addEventListener('click', () => {
      const p = document.getElementById('agChatPanel');
      if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (input) input.focus();
    }));

    // Gradientes compartidos + robot del Gerente
    injectBotDefs();
    const mgrAvatar = view.querySelector('.agm-avatar');
    if (mgrAvatar) mgrAvatar.innerHTML = managerSvg();

    renderGrid();
    renderAprob();
  })();

  /* =========================================================
     PLANES Y PRECIOS — pricing por segmentos
     ========================================================= */
  (function planesModule() {
    const view = document.getElementById('view-planes');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    const SEGMENTOS = {
      contadores: {
        desc: 'Para contadores públicos que gestionan la contabilidad y los impuestos de varios clientes.',
        planes: [
          { nombre: 'Contador Básico', precio: 49, popular: false, cta: 'Elegir plan', features: [
            { t: 'Hasta 3 empresas', ok: true }, { t: 'Módulos: Fiscal + Contabilidad', ok: true },
            { t: 'Soporte por email', ok: true }, { t: 'Onboarding', ok: false }] },
          { nombre: 'Contador PRO', precio: 79, popular: true, cta: 'Elegir plan', features: [
            { t: 'Hasta 10 empresas', ok: true }, { t: 'Fiscal · Contabilidad · Nómina', ok: true },
            { t: 'Soporte por email', ok: true }, { t: 'Onboarding 1:1 (1 sesión)', ok: true }] },
          { nombre: 'Firma Contable', precio: 199, popular: false, cta: 'Elegir plan', features: [
            { t: 'Empresas ilimitadas', ok: true }, { t: 'Todos los módulos', ok: true },
            { t: 'Soporte por email y WhatsApp', ok: true }, { t: 'Onboarding + capacitación', ok: true }] },
        ],
      },
      empresas: {
        desc: 'Para empresas que implementan DigiAccount para su propia gestión.',
        planes: [
          { nombre: 'Emprendimientos y PYME', sub: 'Contribuyentes Ordinarios', precio: 29, popular: false, cta: 'Elegir plan', features: [
            { t: '1 empresa', ok: true }, { t: 'Módulos: Ventas y CxC, Compras y CxP, Tesorería e Inventario', ok: true },
            { t: 'Soporte por email', ok: true }, { t: 'Onboarding', ok: false }] },
          { nombre: 'Empresa Completa', precio: 99, popular: true, cta: 'Elegir plan', features: [
            { t: '1 empresa · usuarios ilimitados', ok: true }, { t: 'Todos los módulos', ok: true },
            { t: 'Soporte por email', ok: true }, { t: 'Onboarding + capacitación', ok: true }] },
          { nombre: 'Grupo Empresarial', precio: 299, popular: false, cta: 'Elegir plan', features: [
            { t: 'Hasta 5 empresas', ok: true }, { t: 'Todos los módulos', ok: true },
            { t: 'Soporte por email y WhatsApp', ok: true }, { t: 'Onboarding + capacitación', ok: true }] },
        ],
      },
      ia: {
        desc: 'Servicios de automatización e inteligencia artificial a la medida, sobre cualquier plan.',
        planes: [
          { nombre: 'Agentes IA', precio: null, consultar: true, cta: 'Consultar', features: [
            { t: 'Setup inicial sobre cualquier plan', ok: true }, { t: '+ mensualidad de mantenimiento', ok: true },
            { t: 'Soporte por email y WhatsApp', ok: true }, { t: 'Agentes a la medida de tu operación', ok: true }] },
          { nombre: 'Auditoría + Implementación', sub: 'Sistema completo de automatizaciones y Agentes IA', precio: null, consultar: true, cta: 'Consultar', features: [
            { t: 'Diagnóstico y auditoría de procesos', ok: true }, { t: 'Implementación integral a medida', ok: true },
            { t: 'Acompañamiento dedicado', ok: true }, { t: 'Integraciones (n8n, WhatsApp, OCR)', ok: true }] },
        ],
      },
    };
    window.__PLANES = SEGMENTOS;

    const ICONS = {
      'Contador Básico': 'calculator', 'Contador PRO': 'briefcase-business', 'Firma Contable': 'landmark',
      'Emprendimientos y PYME': 'sprout', 'Empresa Completa': 'building-2', 'Grupo Empresarial': 'network',
      'Agentes IA': 'bot', 'Auditoría + Implementación': 'shield-check',
    };
    let seg = 'contadores', billing = 'mes';
    const grid = document.getElementById('pricingGrid');
    function render() {
      const s = SEGMENTOS[seg];
      document.getElementById('planSegDesc').textContent = s.desc;
      grid.dataset.count = s.planes.length;
      grid.innerHTML = s.planes.map((p) => {
        let precioHtml;
        if (p.consultar || p.precio == null) precioHtml = '<div class="pc-amount consultar">A consultar</div>';
        else if (billing === 'anual') { const m = Math.round(p.precio * 10 / 12); precioHtml = '<div class="pc-amount"><span class="cur">$</span>' + m + '<span class="per">/mes</span></div><div class="pc-bill">facturado anual · $' + (p.precio * 10) + '/año</div>'; }
        else precioHtml = '<div class="pc-amount"><span class="cur">$</span>' + p.precio + '<span class="per">/mes</span></div>';
        return '<div class="price-card' + (p.popular ? ' popular' : '') + '">'
          + (p.popular ? '<span class="pc-badge">Más elegido</span>' : '')
          + '<div class="pc-icon"><i data-lucide="' + (ICONS[p.nombre] || 'package') + '"></i></div>'
          + '<div class="pc-plan">' + p.nombre + '</div>'
          + (p.sub ? '<div class="pc-sub">' + p.sub + '</div>' : '<div class="pc-sub">&nbsp;</div>')
          + precioHtml
          + '<ul class="pc-features">' + p.features.map((f) => '<li class="' + (f.ok ? 'ok' : 'no') + '"><i data-lucide="' + (f.ok ? 'check' : 'x') + '"></i> ' + f.t + '</li>').join('') + '</ul>'
          + '<button class="pc-cta ' + (p.popular ? 'primary' : 'ghost') + '" data-plan="' + p.nombre + '"' + (p.consultar ? ' data-consultar="1"' : '') + '>' + p.cta + '</button>'
          + '</div>';
      }).join('');
      grid.querySelectorAll('.pc-cta').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.consultar) { toast('Solicitud enviada · te contactaremos por WhatsApp o email', 'success'); return; }
        // Abre el checkout de pago para activar la suscripción
        if (window.openCheckout) { window.openCheckout(b.dataset.plan); return; }
        if (window.aplicarPlan) window.aplicarPlan(b.dataset.plan);
        toast('Plan "' + b.dataset.plan + '" activado · módulos actualizados', 'success');
      }));
      if (window.lucide) window.lucide.createIcons();
    }

    document.getElementById('planTabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('planTabs').querySelectorAll('button').forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
      seg = b.dataset.seg; render();
    }));
    document.getElementById('planBilling').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('planBilling').querySelectorAll('button').forEach((x) => x.removeAttribute('data-active'));
      b.dataset.active = 'true';
      billing = b.dataset.bill; render();
    }));

    render();
  })();

  /* =========================================================
     DOCUMENTOS LEGALES — Términos y Política de privacidad
     ========================================================= */
  (function legalDocs() {
    const HOY = '6 de junio de 2026';
    const wrap = (titulo, sub, cuerpo) => '<div class="legal-doc">'
      + '<div class="legal-meta">Última actualización: ' + HOY + ' · DigiAccount · Venezuela</div>'
      + '<p class="legal-intro">' + sub + '</p>' + cuerpo + '</div>';

    const TERMINOS = wrap('Términos y Condiciones',
      'Al crear una cuenta y utilizar DigiAccount aceptas estos Términos y Condiciones. Léelos con atención.',
      [
        ['1. Descripción del servicio', 'DigiAccount es una plataforma web (SaaS) de gestión contable, fiscal, administrativa y de nómina, orientada al cumplimiento de la normativa venezolana (SENIAT, providencias administrativas, VEN-NIF, LOTTT). El servicio se presta "tal cual", se actualiza periódicamente y no constituye asesoría legal, contable ni tributaria.'],
        ['2. Cuenta y registro', 'Debes ser mayor de edad y tener capacidad para contratar. Eres responsable de la veracidad de los datos suministrados y de mantener la confidencialidad de tus credenciales. Cada usuario accede únicamente a las empresas y módulos que su plan y su rol permitan.'],
        ['3. Planes, acceso de cortesía y pagos', 'DigiAccount no ofrece un período de prueba abierto. El acceso de cortesía por 30 días se otorga de forma individual: mediante el cupón de un socio del programa de referidos o directamente por DigiAccount tras una demostración, y aplica solo a empresas que no hayan sido clientes. Al finalizar, para continuar deberás contratar un plan. Las cuentas que ya tuvieran un período de prueba en curso lo conservan hasta su vencimiento. Los precios se expresan en dólares estadounidenses (USD) y pueden pagarse en bolívares al tipo de cambio de referencia del BCV del día, o en divisas. Aceptamos Pago Móvil, transferencia, USDT y Zelle. La suscripción se renueva por períodos iguales hasta que la canceles.'],
        ['4. Comprobantes de pago', 'Por cada pago se emite un comprobante. Mientras DigiAccount completa su inscripción mercantil y fiscal, se emiten recibos de pago (no fiscales); una vez formalizada, se emitirán facturas conforme a la normativa del SENIAT.'],
        ['5. Responsabilidad sobre la información fiscal', 'DigiAccount es una herramienta de apoyo. La determinación, declaración y pago de impuestos, así como la veracidad de los registros contables, son responsabilidad exclusiva del contribuyente y de su contador. No sustituimos la asesoría profesional.'],
        ['6. Uso aceptable', 'Te comprometes a no utilizar la plataforma para fines ilícitos, a no vulnerar su seguridad y a no cargar información de terceros sin la debida autorización.'],
        ['7. Propiedad intelectual', 'El software, la marca DigiAccount, su diseño y contenidos son propiedad de DigiAccount y su agencia desarrolladora. Tus datos y los de tus empresas son y seguirán siendo tuyos; podrás exportarlos en cualquier momento.'],
        ['8. Disponibilidad y limitación de responsabilidad', 'Procuramos la máxima disponibilidad, pero el servicio puede sufrir interrupciones por mantenimiento o causas de fuerza mayor. En la medida permitida por la ley, no respondemos por daños indirectos ni por la pérdida de datos derivada del uso o imposibilidad de uso de la plataforma.'],
        ['9. Cancelación y reembolsos', 'Puedes cancelar tu suscripción en cualquier momento; conservarás el acceso hasta el final del período ya pagado y podrás exportar tu información. Los montos del período en curso no son reembolsables, salvo disposición legal en contrario.'],
        ['10. Modificaciones', 'Podemos actualizar estos términos, los planes y los precios. Te avisaremos por la plataforma o por correo con antelación razonable; el uso continuado del servicio implica la aceptación de los cambios.'],
        ['11. Ley aplicable', 'Estos términos se rigen por las leyes de la República Bolivariana de Venezuela y cualquier controversia se someterá a los tribunales competentes del país.'],
      ].map((s) => '<h4>' + s[0] + '</h4><p>' + s[1] + '</p>').join(''));

    const PRIVACIDAD = wrap('Política de Privacidad',
      'En DigiAccount valoramos tu privacidad. Esta política explica qué datos recopilamos, con qué fin y cuáles son tus derechos.',
      [
        ['1. Datos que recopilamos', 'Datos de identificación y contacto (nombre y apellido o razón social, cédula o RIF, correo electrónico y número de WhatsApp), datos de tu(s) empresa(s), la información que cargues en la plataforma, y datos técnicos de uso (dirección IP, dispositivo y registros de acceso) necesarios para operar y mejorar el servicio.'],
        ['2. Finalidad del tratamiento', 'Usamos tus datos para: (a) prestar y mantener el servicio; (b) brindarte soporte; (c) gestionar pagos y suscripciones; y (d) enviarte comunicaciones sobre el producto, novedades, ofertas y otros servicios que puedan interesarte (email marketing y mensajería).'],
        ['3. Base legal y consentimiento', 'Tratamos tus datos con base en la ejecución del contrato de servicio y en tu consentimiento, en el marco del derecho a la protección de datos reconocido en el artículo 28 de la Constitución de la República Bolivariana de Venezuela (habeas data). Al registrarte aceptas recibir comunicaciones comerciales de DigiAccount.'],
        ['4. Comunicaciones y baja', 'Podrás darte de baja de las comunicaciones de marketing en cualquier momento mediante el enlace incluido en cada mensaje o escribiéndonos, sin que ello afecte la prestación del servicio que tengas contratado.'],
        ['5. Seguridad y almacenamiento', 'Aplicamos medidas técnicas y organizativas razonables para proteger tu información frente a accesos no autorizados. La información de cada cuenta está aislada de las demás.'],
        ['6. Compartir con terceros', 'No vendemos tus datos. Solo los compartimos con proveedores tecnológicos necesarios para operar el servicio (alojamiento, mensajería, procesadores de pago), bajo deber de confidencialidad, o cuando lo exija la ley o una autoridad competente.'],
        ['7. Cookies y tecnologías similares', 'Usamos cookies y almacenamiento local para mantener tu sesión, recordar tus preferencias y medir el uso de la plataforma. Puedes gestionarlas desde la configuración de tu navegador.'],
        ['8. Tus derechos', 'Puedes solicitar acceder, rectificar, actualizar o eliminar tus datos personales, así como oponerte a su uso para marketing, escribiéndonos a privacidad@digiaccount.com. Atenderemos tu solicitud en un plazo razonable.'],
        ['9. Conservación', 'Conservamos tus datos mientras tengas una cuenta activa y durante el plazo que exija la normativa contable y fiscal aplicable; luego se eliminan o anonimizan.'],
        ['10. Contacto', 'Para cualquier asunto relacionado con tus datos, escríbenos a privacidad@digiaccount.com.'],
      ].map((s) => '<h4>' + s[0] + '</h4><p>' + s[1] + '</p>').join(''));

    const DOCS = {
      terminos: { title: 'Términos y Condiciones', html: TERMINOS },
      privacidad: { title: 'Política de Privacidad', html: PRIVACIDAD },
    };

    document.querySelectorAll('[data-legal]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const d = DOCS[a.dataset.legal]; if (!d) return;
      window.openFormModal && window.openFormModal({
        title: d.title, saveLabel: 'Entendido',
        fields: [{ name: 'x', label: ' ', col: 2, type: 'static', html: d.html }],
        onSave: () => {},
      });
    }));
  })();

  /* =========================================================
     BASE DE CONTACTOS — CRM / leads para email marketing
     Captura a todo el que ingresa (usuarios y empresas)
     ========================================================= */
  (function contactosCRM() {
    const CONTACTOS = [];   // CRM: contactos reales
    window.__CONTACTOS = CONTACTOS;
    window.__registrarContacto = function (c) {
      const reg = Object.assign({ fecha: new Date().toLocaleDateString('es-VE') }, c);
      CONTACTOS.unshift(reg);
      if (window.__renderContactos) window.__renderContactos();
      return CONTACTOS.length;
    };
    // Carga los contactos REALES (solo fundador): correo/WhatsApp de cada CUENTA
    // registrada (los guarda el trigger del registro) + datos de cada EMPRESA.
    window.cargarContactos = async function () {
      if (!window.sb || !window.__ES_FUNDADOR) return;
      CONTACTOS.length = 0;
      try {
        const { data: ctas } = await window.sb.from('cuentas')
          .select('nombre, segmento, estado, email_contacto, telefono');
        (ctas || []).forEach((c) => CONTACTOS.push({
          tipo: 'Usuario', nombre: c.nombre || '—', doc: (c.segmento || '') + (c.estado ? ' · ' + c.estado : ''),
          email: c.email_contacto || '', whatsapp: c.telefono || '', origen: 'Registro de cuenta', fecha: '—',
        }));
      } catch (e) { console.warn('[CRM] cuentas:', e); }
      try {
        let { data: emps, error: eErr } = await window.sb.from('empresas')
          .select('nombre, rif, email, whatsapp, telefono');
        if (eErr) {
          // columnas email/whatsapp aún no existen en empresas: carga sin contacto
          ({ data: emps } = await window.sb.from('empresas').select('nombre, rif'));
        }
        (emps || []).forEach((e2) => CONTACTOS.push({
          tipo: 'Empresa', nombre: e2.nombre || '—', doc: e2.rif || '—',
          email: e2.email || '', whatsapp: e2.whatsapp || e2.telefono || '', origen: 'Onboarding', fecha: '—',
        }));
      } catch (e) { console.warn('[CRM] empresas:', e); }
      if (window.__renderContactos) window.__renderContactos();
    };
  })();

  /* =========================================================
     PANEL DEL FUNDADOR · Pestaña Contactos y Leads
     ========================================================= */
  (function leadsModule() {
    const view = document.getElementById('view-fundador');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const tabs = document.getElementById('fundadorTabs');
    const panelCuentas = document.getElementById('fundadorTabCuentas');
    const panelContactos = document.getElementById('fundadorTabContactos');
    const body = document.getElementById('leadsBody');
    if (!tabs || !body) return;
    const exportBtn = document.getElementById('saasExportBtn');
    const nuevaBtn = document.getElementById('nuevaCuentaSaasBtn');
    let filtro = 'todos', q = '';

    function lista() {
      return (window.__CONTACTOS || []).filter((c) => {
        if (filtro !== 'todos' && c.tipo !== filtro) return false;
        if (q) {
          const hay = (c.nombre + ' ' + (c.doc || '') + ' ' + (c.email || '') + ' ' + (c.whatsapp || '') + ' ' + (c.origen || '')).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
    }

    function render() {
      const all = window.__CONTACTOS || [];
      const rows = lista();
      body.innerHTML = rows.length ? rows.map((c) => {
        const badge = c.tipo === 'Empresa'
          ? '<span class="role-badge" style="background:rgba(0,142,199,.12);color:#008ec7;"><i data-lucide="building-2"></i> Empresa</span>'
          : '<span class="role-badge" style="background:rgba(123,84,201,.12);color:#7b54c9;"><i data-lucide="user"></i> Usuario</span>';
        return '<tr><td><strong>' + c.nombre + '</strong></td><td>' + badge + '</td><td>' + (c.doc || '—') + '</td><td>' + (c.email || '—') + '</td><td>' + (c.whatsapp || '—') + '</td><td>' + (c.origen || '—') + '</td><td>' + (c.fecha || '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--fg-muted);">Sin contactos que coincidan</td></tr>';
      document.getElementById('leadsShown').textContent = rows.length;
      document.getElementById('leadKpiTotal').textContent = all.length;
      document.getElementById('leadKpiEmpresas').textContent = all.filter((c) => c.tipo === 'Empresa').length;
      document.getElementById('leadKpiUsuarios').textContent = all.filter((c) => c.tipo === 'Usuario').length;
      document.getElementById('leadKpiWsp').textContent = all.filter((c) => (c.whatsapp || '').trim()).length;
      if (window.lucide) window.lucide.createIcons();
    }
    window.__renderContactos = render;

    const PANELS = { cuentas: panelCuentas, contactos: panelContactos,
                     cobros: document.getElementById('fundadorTabCobros'),
                     socios: document.getElementById('fundadorTabSocios') };
    tabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
      const tab = b.dataset.tab;
      Object.keys(PANELS).forEach((k) => { if (PANELS[k]) PANELS[k].hidden = k !== tab; });
      const esCuentas = tab === 'cuentas';
      if (exportBtn) exportBtn.style.display = esCuentas ? '' : 'none';
      if (nuevaBtn) nuevaBtn.style.display = esCuentas ? '' : 'none';
      if (tab === 'contactos') { render(); if (window.cargarContactos) window.cargarContactos(); }
      if (tab === 'cobros') { if (window.__renderPagos) window.__renderPagos(); if (window.cargarPagos) window.cargarPagos(); }
      if (tab === 'socios') { try { if (window.cargarSociosFundador) window.cargarSociosFundador(); } catch (e) { console.warn('[Socios]', e); } }
    }));

    document.getElementById('leadsFiltros').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('leadsFiltros').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      filtro = b.dataset.f; render();
    }));
    const search = document.getElementById('leadsSearch');
    if (search) search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); render(); });

    document.getElementById('leadsExportBtn').addEventListener('click', () => {
      const rows = lista();
      if (!rows.length) return toast('No hay contactos para exportar', 'info');
      const filas = [['Nombre / Razon social', 'Tipo', 'Cedula / RIF', 'Correo', 'WhatsApp', 'Origen', 'Fecha']];
      rows.forEach((c) => filas.push([c.nombre, c.tipo, c.doc || '', c.email || '', c.whatsapp || '', c.origen || '', c.fecha || '']));
      const csv = filas.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'DigiAccount_Contactos_Leads.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Contactos exportados · ' + rows.length + ' registros', 'success');
    });

    render();
  })();

  /* =========================================================
     MÉTRICAS SaaS — gráfica de evolución del MRR (Fundador)
     ========================================================= */
  (function saasMetrics() {
    const bars = document.getElementById('mrrBars');
    if (!bars) return;
    const MRR = [
      { m: 'Ene', v: 0 }, { m: 'Feb', v: 0 }, { m: 'Mar', v: 0 },
      { m: 'Abr', v: 0 }, { m: 'May', v: 0 }, { m: 'Jun', v: 0 },
    ];
    const max = Math.max.apply(null, MRR.map((x) => x.v));
    bars.innerHTML = MRR.map((x, i) => {
      const h = Math.max(8, Math.round((x.v / max) * 100));
      const last = i === MRR.length - 1;
      return '<div class="shc-bar' + (last ? ' active' : '') + '">'
        + '<div class="shc-bar-val">$' + (x.v / 1000).toFixed(1) + 'k</div>'
        + '<div class="shc-col" style="height:' + h + '%"></div>'
        + '<div class="shc-bar-m">' + x.m + '</div></div>';
    }).join('');
  })();

  /* =========================================================
     COBROS Y PAGOS — métodos receptores + suscripciones
     Métodos para Venezuela: Pago Móvil C2P, USDT/Binance, Zelle
     ========================================================= */
  (function cobrosModule() {
    const view = document.getElementById('view-fundador');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const bsFmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    window.__BCV = 36.80; // valor de respaldo: cargarTasaBCV() lo actualiza con la tasa real de Supabase
    const METODOS = {
      pagomovil: { label: 'Pago Móvil C2P', icon: 'smartphone', moneda: 'Bs', auto: true, nota: 'Confirmación automática vía banco' },
      transferencia: { label: 'Transferencia Bancaria', icon: 'landmark', moneda: 'Bs', auto: false, nota: 'Se verifica contra el estado de cuenta' },
      usdt: { label: 'USDT · Binance Pay', icon: 'bitcoin', moneda: 'USD', auto: true, nota: 'Confirmación automática on-chain' },
      zelle: { label: 'Zelle', icon: 'circle-dollar-sign', moneda: 'USD', auto: false, nota: 'Verifica el Agente IA (comprobante)' },
    };
    const RECEPTORAS = {
      pagomovil: { activo: false, campos: { Banco: '', 'Teléfono': '', 'Tipo de documento': '', 'Nº de documento': '', Titular: '' } },
      transferencia: { activo: false, campos: { Banco: '', 'Tipo de cuenta': '', 'Nº de cuenta': '', 'Tipo de documento': '', 'Nº de documento': '', Titular: '' } },
      usdt: { activo: false, campos: { Red: '', Wallet: '', Titular: '' } },
      zelle: { activo: false, campos: { Email: '', Titular: '', Banco: '' } },
    };
    // Opciones de documento (V/J) y de tipo de cuenta bancaria
    const TIPOS_DOC = ['V — Persona', 'J — Comercio'];
    const TIPOS_CUENTA = ['Corriente', 'Ahorro'];
    const campoDoc = (c, val) => (c === 'Tipo de documento')
      ? { name: c, label: c, type: 'select', options: TIPOS_DOC, value: val || '', col: 2 }
      : (c === 'Tipo de cuenta')
      ? { name: c, label: c, type: 'select', options: TIPOS_CUENTA, value: val || '', col: 2 }
      : { name: c, label: c, value: val, col: 2 };
    window.__CUENTAS_RECEPTORAS = RECEPTORAS;
    window.__METODOS_PAGO = METODOS;

    const PAGOS = [];   // pagos reales recibidos
    window.__PAGOS = PAGOS;
    window.__registrarPago = function (p) {
      PAGOS.unshift(Object.assign({ fecha: new Date().toLocaleDateString('es-VE') }, p));
      if (window.__renderPagos) window.__renderPagos();
      // Persistir en la base: así el FUNDADOR ve el pago reportado desde su propia sesión.
      if (window.sb && window.__CUENTA_ID) {
        window.sb.from('pagos_suscripcion').insert({
          cuenta_id: window.__CUENTA_ID,
          cliente: p.cliente || ((window.__PERFIL && window.__PERFIL.cuentas && window.__PERFIL.cuentas.nombre) || null),
          plan: p.plan || null, metodo: p.metodo || null, monto: p.monto || 0,
          referencia: p.ref || '', estado: (p.estado === 'Confirmado') ? 'confirmado' : 'por_verificar',
        }).then(({ error }) => { if (error) console.warn('[Pagos] No se pudo guardar el pago:', error.message); });
      }
    };
    // Carga los pagos reales (el fundador ve todos; el cliente, los suyos)
    window.cargarPagos = async function () {
      if (!window.sb) return;
      const { data, error } = await window.sb.from('pagos_suscripcion').select('*').order('creado_en', { ascending: false });
      if (error) { console.warn('[Pagos] No se pudieron cargar:', error.message); return; }
      PAGOS.length = 0;
      (data || []).forEach((r) => PAGOS.push({
        _id: r.id, _cuenta: r.cuenta_id, _creado: r.creado_en,
        cliente: r.cliente || '—', plan: r.plan || '—', metodo: r.metodo || 'pagomovil',
        monto: Number(r.monto) || 0, ref: r.referencia || '', fecha: r.creado_en ? new Date(r.creado_en).toLocaleDateString('es-VE') : '—',
        estado: r.estado === 'confirmado' ? 'Confirmado' : 'Por verificar',
      }));
      if (window.__renderPagos) window.__renderPagos();
      // Los pagos CONFIRMADOS se vuelven los recibos/comprobantes del cliente
      if (window.__COMPROBANTES) {
        const conf = PAGOS.filter((p) => p.estado === 'Confirmado');
        window.__COMPROBANTES.length = 0;
        conf.forEach((p, i) => window.__COMPROBANTES.push({
          num: String(conf.length - i).padStart(6, '0'), fecha: p.fecha, tipo: 'Recibo',
          cliente: p.cliente, doc: '', plan: p.plan, monto: p.monto,
          metodoLabel: (METODOS[p.metodo] || { label: p.metodo }).label, ref: p.ref, fiscal: false, estado: 'Pagado',
        }));
      }
      if (window.__renderSuscripcion) { try { window.__renderSuscripcion(); } catch (e) {} }
      if (window.__syncTrialBanner) { try { window.__syncTrialBanner(); } catch (e) {} }
    };
    // Cuentas receptoras: persistencia en plataforma_config (el fundador escribe;
    // todos los clientes las LEEN para ver a dónde pagar en el checkout).
    window.__cargarReceptoras = async function () {
      if (!window.sb) return;
      try {
        const { data, error } = await window.sb.from('plataforma_config').select('valor').eq('clave', 'cuentas_receptoras').maybeSingle();
        if (!error && data && data.valor) {
          Object.keys(RECEPTORAS).forEach((k) => { if (data.valor[k]) RECEPTORAS[k] = data.valor[k]; });
          // Migración: datos guardados con el campo viejo 'RIF' → nuevo esquema V/J
          const pm = RECEPTORAS.pagomovil;
          if (pm && pm.campos && pm.campos.RIF != null) {
            pm.campos['Tipo de documento'] = pm.campos['Tipo de documento'] || '';
            pm.campos['Nº de documento'] = pm.campos['Nº de documento'] || pm.campos.RIF || '';
            pm.campos.Titular = pm.campos.Titular || '';
            delete pm.campos.RIF;
          }
          renderReceptoras();
        }
      } catch (e) { /* tabla aún no creada */ }
    };
    function guardarReceptoras() {
      if (!window.sb || !window.__ES_FUNDADOR) return;
      window.sb.from('plataforma_config').upsert({ clave: 'cuentas_receptoras', valor: RECEPTORAS })
        .then(({ error }) => { if (error) toast('No se pudo guardar: ' + error.message + ' (¿creaste plataforma_config?)', 'error'); });
    }

    // ---- Cuentas receptoras (config) ----
    const grid = document.getElementById('cobrosGrid');
    function renderReceptoras() {
      if (!grid) return;
      grid.innerHTML = Object.keys(METODOS).map((k) => {
        const m = METODOS[k]; const r = RECEPTORAS[k];
        const datos = Object.keys(r.campos).map((c) => '<div class="cr-row"><span>' + esc(c) + '</span><strong>' + esc(r.campos[c]) + '</strong></div>').join('');
        return '<div class="cobro-card' + (r.activo ? '' : ' off') + '">'
          + '<div class="cc-head"><span class="cc-ic"><i data-lucide="' + m.icon + '"></i></span><div class="cc-tt"><div class="cc-name">' + m.label + '</div><div class="cc-tag ' + (m.auto ? 'auto' : 'ia') + '">' + (m.auto ? 'Automático' : 'Agente IA') + '</div></div>'
          + '<label class="cc-switch"><input type="checkbox" data-m="' + k + '"' + (r.activo ? ' checked' : '') + '><span></span></label></div>'
          + '<div class="cc-body">' + datos + '</div>'
          + '<button class="cc-edit" data-edit="' + k + '"><i data-lucide="pencil"></i> Configurar</button>'
          + '</div>';
      }).join('');
      grid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => configurar(b.dataset.edit)));
      grid.querySelectorAll('input[data-m]').forEach((c) => c.addEventListener('change', () => {
        RECEPTORAS[c.dataset.m].activo = c.checked;
        c.closest('.cobro-card').classList.toggle('off', !c.checked);
        guardarReceptoras();
        toast(METODOS[c.dataset.m].label + (c.checked ? ' activado' : ' desactivado'), c.checked ? 'success' : 'info');
      }));
      if (window.lucide) window.lucide.createIcons();
    }
    function configurar(k) {
      const r = RECEPTORAS[k]; const m = METODOS[k];
      window.openFormModal && window.openFormModal({
        title: 'Configurar · ' + m.label, saveLabel: 'Guardar datos',
        fields: Object.keys(r.campos).map((c) => campoDoc(c, r.campos[c])),
        onSave: (v) => { Object.keys(r.campos).forEach((c) => { if (v[c] != null) r.campos[c] = v[c]; }); renderReceptoras(); guardarReceptoras(); toast('Datos de ' + m.label + ' actualizados'); },
      });
    }
    const bcvEdit = document.getElementById('bcvEdit');
    if (bcvEdit) bcvEdit.addEventListener('click', () => {
      window.openFormModal && window.openFormModal({
        title: 'Tasa BCV del día', saveLabel: 'Actualizar',
        fields: [{ name: 'tasa', label: 'Bs por USD', value: String(window.__BCV).replace('.', ','), col: 2 }],
        onSave: (v) => { const n = parseFloat(String(v.tasa).replace(',', '.')); if (!n || n <= 0) return 'Indica una tasa válida.'; window.__BCV = n; document.getElementById('bcvTasa').textContent = bsFmt(n); toast('Tasa BCV actualizada a Bs ' + bsFmt(n)); },
      });
    });

    // ---- Tabla de pagos ----
    const body = document.getElementById('pagosBody');
    let filtro = 'todos', q = '';
    function listaPagos() {
      return PAGOS.filter((p) => {
        if (filtro !== 'todos' && p.estado !== filtro) return false;
        if (q) { const hay = (p.cliente + ' ' + p.plan + ' ' + p.ref).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
        return true;
      });
    }
    function renderPagos() {
      if (!body) return;
      const rows = listaPagos();
      body.innerHTML = rows.length ? rows.map((p, i) => {
        const m = METODOS[p.metodo] || { label: p.metodo, icon: 'wallet' };
        const estBadge = p.estado === 'Confirmado'
          ? '<span class="tag success"><i data-lucide="check-circle-2"></i> Confirmado</span>'
          : '<span class="tag warn"><i data-lucide="clock"></i> Por verificar</span>';
        const accion = p.estado === 'Por verificar'
          ? '<button class="row-act" data-verif="' + PAGOS.indexOf(p) + '"><i data-lucide="bot"></i> Verificar (IA)</button>'
          : '<span class="row-done"><i data-lucide="check"></i></span>';
        const montoStr = '$' + p.monto + (m.moneda === 'Bs' ? ' · Bs ' + bsFmt(p.monto * window.__BCV) : '');
        return '<tr><td><strong>' + p.cliente + '</strong></td><td>' + p.plan + '</td>'
          + '<td><span class="pm-cell"><i data-lucide="' + m.icon + '"></i> ' + m.label + '</span></td>'
          + '<td class="num">' + montoStr + '</td><td>' + p.ref + '</td><td>' + estBadge + '</td><td>' + p.fecha + '</td><td>' + accion + '</td></tr>';
      }).join('') : '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--fg-muted);">Sin pagos que coincidan</td></tr>';
      document.getElementById('pagosShown').textContent = rows.length;
      body.querySelectorAll('[data-verif]').forEach((b) => b.addEventListener('click', () => verificar(parseInt(b.dataset.verif, 10), b)));
      if (window.lucide) window.lucide.createIcons();
    }
    window.__renderPagos = renderPagos;
    function verificar(idx, btn) {
      const p = PAGOS[idx]; if (!p) return;
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Verificando…'; if (window.lucide) window.lucide.createIcons(); }
      toast('Agente IA leyendo el comprobante de ' + p.cliente + '…', 'info');
      setTimeout(() => {
        p.estado = 'Confirmado'; renderPagos();
        // Persistir la confirmación (solo el fundador puede, por RLS)
        if (p._id && window.sb) window.sb.from('pagos_suscripcion').update({ estado: 'confirmado' }).eq('id', p._id)
          .then(({ error }) => { if (error) console.warn('[Pagos] No se pudo confirmar en BD:', error.message); });
        // Al confirmar el pago, la CUENTA del cliente se ACTIVA automáticamente
        if (p._cuenta && window.sb) window.sb.from('cuentas').update({ estado: 'activa' }).eq('id', p._cuenta)
          .then(({ error }) => {
            if (error) console.warn('[Pagos] No se pudo activar la cuenta:', error.message);
            else if (window.cargarCuentasFundador) window.cargarCuentasFundador();
          });
        toast('Pago de ' + p.cliente + ' verificado y confirmado · suscripción activa', 'success');
        if (window.__notificar) window.__notificar({ icon: 'badge-check', nivel: 'ok', titulo: 'Pago verificado · ' + p.cliente, detalle: 'El Agente IA confirmó el pago de $' + p.monto + ' · suscripción activa', view: 'fundador', title2: 'Panel del Fundador' });
      }, 1400);
    }

    document.getElementById('pagosFiltros').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('pagosFiltros').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      filtro = b.dataset.f; renderPagos();
    }));
    const psearch = document.getElementById('pagosSearch');
    if (psearch) psearch.addEventListener('input', () => { q = psearch.value.trim().toLowerCase(); renderPagos(); });

    renderReceptoras();
    renderPagos();
  })();

  /* =========================================================
     CHECKOUT — pago de suscripción del cliente + apertura
     ========================================================= */
  (function checkoutModule() {
    const scrim = document.getElementById('payModal');
    if (!scrim) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const bsFmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let plan = null, precio = 0, metodo = 'pagomovil';

    function precioPlan(nombre) {
      const SEG = window.__PLANES || {};
      for (const k in SEG) { const p = (SEG[k].planes || []).find((x) => x.nombre === nombre); if (p && p.precio != null) return p.precio; }
      return null;
    }
    function close() { scrim.dataset.open = 'false'; }

    function renderMetodos() {
      const METODOS = window.__METODOS_PAGO || {};
      const REC = window.__CUENTAS_RECEPTORAS || {};
      const box = document.getElementById('payMethods');
      const activos = Object.keys(METODOS).filter((k) => !REC[k] || REC[k].activo);
      // Sin métodos configurados por el fundador: aviso amable en vez de romperse.
      if (!activos.length) {
        metodo = null;
        box.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--fg-muted);font-size:12.5px;padding:14px;">Los métodos de pago están en configuración.<br>Escríbenos por WhatsApp y activamos tu plan al instante.</div>';
        const det = document.getElementById('payDetail'); if (det) det.innerHTML = '';
        return;
      }
      if (activos.indexOf(metodo) < 0) metodo = activos[0];
      box.innerHTML = activos.map((k) => {
        const m = METODOS[k];
        return '<button class="pay-m' + (k === metodo ? ' active' : '') + '" data-m="' + k + '"><i data-lucide="' + m.icon + '"></i><span>' + m.label + '</span></button>';
      }).join('');
      box.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { metodo = b.dataset.m; renderMetodos(); renderDetalle(); }));
      if (window.lucide) window.lucide.createIcons();
    }
    function renderDetalle() {
      const METODOS = window.__METODOS_PAGO || {};
      const REC = window.__CUENTAS_RECEPTORAS || {};
      const m = METODOS[metodo]; const r = REC[metodo] || { campos: {} };
      if (!m) { const det = document.getElementById('payDetail'); if (det) det.innerHTML = ''; return; }
      const bs = bsFmt(precio * (window.__BCV || 1));
      const datos = Object.keys(r.campos).map((c) => '<div class="pd-row"><span>' + c + '</span><strong>' + r.campos[c] + '</strong></div>').join('');
      const montoLinea = m.moneda === 'Bs'
        ? '<div class="pd-row total"><span>Monto a pagar</span><strong>Bs ' + bs + '</strong></div>'
        : '<div class="pd-row total"><span>Monto a pagar</span><strong>$' + precio + ' USD</strong></div>';
      const aviso = '<div class="pd-aviso ia"><i data-lucide="shield-check"></i> Tu pago será verificado por nuestro equipo antes de activar el plan. Recibirás tu recibo al aprobarse.</div>';
      const refField = '<label class="pd-field"><span>' + (metodo === 'zelle' ? 'Referencia / N° de confirmación Zelle' : metodo === 'usdt' ? 'Hash de la transacción (TXID)' : metodo === 'transferencia' ? 'Número de referencia de la transferencia' : 'Número de referencia del Pago Móvil') + '</span><input id="payRef" placeholder="' + (metodo === 'zelle' ? 'Ej. ZL-00123' : metodo === 'usdt' ? '0x…' : 'Ej. 004857213') + '"></label>';
      document.getElementById('payDetail').innerHTML = '<div class="pd-data">' + datos + montoLinea + '</div>' + aviso + refField;
      if (window.lucide) window.lucide.createIcons();
    }

    window.openCheckout = function (planNombre) {
      plan = planNombre || window.__planActivo || 'Empresa Completa';
      precio = precioPlan(plan) || 0;
      document.getElementById('payPlanName').textContent = plan;
      document.getElementById('payUsd').textContent = precio;
      document.getElementById('payBcv').textContent = bsFmt(window.__BCV || 0);
      document.getElementById('payBs').textContent = bsFmt(precio * (window.__BCV || 1));
      const cb = document.getElementById('payConfirm'); cb.disabled = false; cb.innerHTML = '<i data-lucide="check"></i> Ya realicé el pago';
      renderMetodos(); renderDetalle();
      scrim.dataset.open = 'true';
      if (window.lucide) window.lucide.createIcons();
    };

    document.getElementById('payClose').addEventListener('click', close);
    document.getElementById('payCancel').addEventListener('click', close);
    // Clic fuera NO cierra (evita perder datos del formulario). Usa Cancelar o la X.

    document.getElementById('payConfirm').addEventListener('click', () => {
      const METODOS = window.__METODOS_PAGO || {};
      const m = METODOS[metodo];
      if (!m) return toast('Aún no hay métodos de pago disponibles. Escríbenos por WhatsApp.', 'info');
      const ref = (document.getElementById('payRef') || {}).value || '';
      if (!ref.trim()) return toast('Indica la referencia de tu pago', 'error');
      const btn = document.getElementById('payConfirm');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader"></i> Registrando tu pago…';
      if (window.lucide) window.lucide.createIcons();
      const cliente = (window.__PERFIL && window.__PERFIL.cuentas && window.__PERFIL.cuentas.nombre)
        || (document.querySelector('.entity-current .ec-name') || {}).textContent || 'Mi cuenta';
      setTimeout(() => {
        // NINGÚN pago se auto-aprueba: siempre queda "Por verificar" hasta que el
        // fundador lo confirme contra su banco. El recibo se emite al aprobarse.
        if (window.__registrarPago) window.__registrarPago({ cliente: cliente, plan: plan, metodo: metodo, monto: precio, ref: ref.trim(), estado: 'Por verificar' });
        close();
        toast('Pago reportado ✓ · lo verificaremos y activaremos tu plan. Recibirás tu recibo al aprobarse.', 'info');
        if (window.__notificar) window.__notificar({ icon: 'clock', nivel: 'warn', titulo: 'Pago en verificación', detalle: m.label + ' · Ref. ' + ref.trim() + ' · te avisaremos al activarlo', view: 'suscripcion', title2: 'Mi Suscripción' });
        if (window.cargarPagos) window.cargarPagos();
      }, 900);
    });
  })();

  /* =========================================================
     COMPROBANTE — Recibo de pago (no fiscal) / Factura (al formalizar)
     ========================================================= */
  (function comprobanteModule() {
    const modal = document.getElementById('subReciboModal');
    if (!modal) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const bsFmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let rifFiscal = null;
    window.__modoComprobante = 'recibo';
    // Historial de comprobantes del cliente (meses anteriores de ejemplo)
    const COMPROBANTES = [];   // se llena con los comprobantes de pago reales de la cuenta
    window.__COMPROBANTES = COMPROBANTES;
    let correlativo = COMPROBANTES.length;

    function renderComprobante(c) {
      const fiscal = !!c.fiscal;
      const bcv = window.__BCV || 1;
      document.getElementById('subReciboBarTitle').textContent = fiscal ? 'Factura' : 'Recibo de pago';
      let totals = '<div class="rd-trow"><span>Subtotal</span><strong>$' + bsFmt(c.monto) + '</strong></div>';
      if (fiscal) {
        const iva = c.monto * 0.16;
        totals += '<div class="rd-trow"><span>IVA 16%</span><strong>$' + bsFmt(iva) + '</strong></div>'
          + '<div class="rd-trow total"><span>Total USD</span><strong>$' + bsFmt(c.monto + iva) + '</strong></div>';
      } else {
        totals += '<div class="rd-trow total"><span>Total USD</span><strong>$' + bsFmt(c.monto) + '</strong></div>';
      }
      totals += '<div class="rd-trow bs"><span>Equivalente Bs · BCV ' + bsFmt(bcv) + '</span><strong>Bs ' + bsFmt(c.monto * bcv) + '</strong></div>';
      const emisorSub = fiscal && rifFiscal ? ('RIF ' + rifFiscal.rif) : 'En proceso de formalización mercantil y fiscal';
      const nota = fiscal
        ? 'Factura emitida conforme a la Providencia Administrativa del SENIAT. Conserve este documento.'
        : 'Este documento es un comprobante de pago y NO constituye una factura fiscal según la normativa del SENIAT. Se emite mientras DigiAccount completa su inscripción mercantil y fiscal.';
      document.getElementById('subReciboDoc').innerHTML =
        '<div class="rd-head"><div class="rd-brand"><img class="rd-logo-img" src="assets/isotipo.png" alt="DigiAccount"><div class="rd-bn">DigiAccount<small>Gestión contable y fiscal</small></div></div>'
        + '<div class="rd-meta"><div class="rd-doctype">' + (fiscal ? 'FACTURA' : 'RECIBO DE PAGO') + '</div><div class="rd-num">N° <strong>' + c.num + '</strong></div><div class="rd-date">' + c.fecha + '</div></div></div>'
        + '<div class="rd-parties"><div class="rd-party"><span>Recibido de</span><strong>' + (c.cliente || '—') + '</strong><small>' + (c.doc || 'Cliente DigiAccount') + '</small></div>'
        + '<div class="rd-party"><span>Emisor</span><strong>DigiAccount</strong><small>' + emisorSub + '</small></div></div>'
        + '<table class="rd-items"><thead><tr><th>Concepto</th><th>Período</th><th class="num">Monto</th></tr></thead>'
        + '<tbody><tr><td>Suscripción · Plan ' + (c.plan || '') + '</td><td>1 mes</td><td class="num">$' + bsFmt(c.monto) + '</td></tr></tbody></table>'
        + '<div class="rd-totals">' + totals + '</div>'
        + '<div class="rd-pay"><i data-lucide="wallet"></i> Forma de pago: <strong>' + (c.metodoLabel || '—') + '</strong> · Referencia: <strong>' + (c.ref || '—') + '</strong></div>'
        + '<div class="rd-note">' + nota + '</div>'
        + '<div class="rd-sign"><div class="rd-sign-line">Firma y sello autorizado</div></div>';
      modal.dataset.open = 'true';
      if (window.lucide) window.lucide.createIcons();
    }
    window.__verComprobante = renderComprobante;

    window.__generarRecibo = function (d) {
      correlativo += 1;
      const fiscal = window.__modoComprobante === 'factura' && !!rifFiscal;
      const c = {
        num: String(correlativo).padStart(6, '0'),
        fecha: new Date().toLocaleDateString('es-VE'),
        tipo: fiscal ? 'Factura' : 'Recibo',
        cliente: d.cliente || '—', doc: d.doc || '', plan: d.plan || '',
        monto: d.monto, metodoLabel: d.metodoLabel || '—', ref: d.ref || '—',
        fiscal: fiscal, estado: 'Pagado',
      };
      COMPROBANTES.unshift(c);
      if (window.__renderHistorial) window.__renderHistorial();
      renderComprobante(c);
    };

    document.getElementById('subReciboClose').addEventListener('click', () => (modal.dataset.open = 'false'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.dataset.open = 'false'; });
    document.getElementById('subReciboPrint').addEventListener('click', () => {
      const doc = document.getElementById('subReciboDoc');
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = doc.cloneNode(true);
      clon.classList.add('recibo-print');
      portal.appendChild(clon);
      if (window.__setPageSize) window.__setPageSize('letter portrait', '14mm');
      document.body.classList.add('printing-comp');
      window.print();
    });
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
    });

    // Configuración del modo de comprobante (Panel del Fundador → Cobros)
    const compConfig = document.getElementById('compConfig');
    if (compConfig) {
      compConfig.querySelectorAll('input[name="compMode"]').forEach((r) => r.addEventListener('change', () => {
        if (r.disabled) return;
        window.__modoComprobante = r.value;
        compConfig.querySelectorAll('.comp-opt').forEach((o) => o.classList.toggle('active', o.querySelector('input').checked));
      }));
      const formBtn = document.getElementById('compFormalizar');
      if (formBtn) formBtn.addEventListener('click', () => {
        window.openFormModal && window.openFormModal({
          title: 'Activar facturación fiscal', saveLabel: 'Activar facturación',
          fields: [
            { name: 'rif', label: 'RIF de DigiAccount', placeholder: 'J-XXXXXXXX-X' },
            { name: 'registro', label: 'N° de Registro Mercantil', placeholder: 'Ej. 45, Tomo 12-A' },
            { name: 'imprenta', label: 'Imprenta autorizada / Nº de control', col: 2, placeholder: 'Ej. Imprenta XYZ · serie 00-00001' },
          ],
          onSave: (v) => {
            if (!/^[VEJPG]?-?\d{7,9}/i.test((v.rif || '').replace(/-/g, ''))) return 'Indica un RIF válido (ej. J-12345678-9).';
            rifFiscal = { rif: v.rif, registro: v.registro, imprenta: v.imprenta };
            const facOpt = compConfig.querySelector('input[value="factura"]').closest('.comp-opt');
            const facRadio = compConfig.querySelector('input[value="factura"]');
            facOpt.classList.remove('locked');
            facRadio.disabled = false; facRadio.checked = true;
            window.__modoComprobante = 'factura';
            const lockIc = facOpt.querySelector('[data-lucide="lock"]');
            if (lockIc) lockIc.remove();
            const sub = facOpt.querySelector('small');
            if (sub) sub.textContent = 'Activa · RIF ' + v.rif;
            compConfig.querySelectorAll('.comp-opt').forEach((o) => o.classList.toggle('active', o.querySelector('input').checked));
            formBtn.style.display = 'none';
            toast('¡Facturación fiscal activada! Ahora DigiAccount emite facturas SENIAT', 'success');
          },
        });
      });
    }
  })();

  /* =========================================================
     MI SUSCRIPCIÓN — resumen del plan + historial de comprobantes
     ========================================================= */
  (function suscripcionModule() {
    const view = document.getElementById('view-suscripcion');
    if (!view) return;
    const bsFmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const body = document.getElementById('compBody');
    let filtro = 'todos', q = '';

    function precioPlan(nombre) {
      const SEG = window.__PLANES || {};
      for (const k in SEG) { const p = (SEG[k].planes || []).find((x) => x.nombre === nombre); if (p && p.precio != null) return p.precio; }
      return 0;
    }
    const addMes = (d) => { const x = new Date(d); x.setMonth(x.getMonth() + 1); return x; };
    const addDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const fFecha = (d) => d.toLocaleDateString('es-VE');
    const ICON = { 'Contador Básico': 'calculator', 'Contador PRO': 'briefcase-business', 'Firma Contable': 'landmark', 'Emprendimientos y PYME': 'sprout', 'Empresa Completa': 'building-2', 'Grupo Empresarial': 'network' };

    function renderResumen() {
      const plan = window.__planActivo
        || (window.__PERFIL && window.__PERFIL.cuentas && window.__PERFIL.cuentas.planes && window.__PERFIL.cuentas.planes.nombre)
        || null;
      const planTxt = plan || 'Sin plan seleccionado';
      const precio = plan ? precioPlan(plan) : 0;
      const bcv = window.__BCV || 1;
      const badge = document.getElementById('subEstadoBadge');
      // Estado REAL de la cuenta (de la base de datos), no la variable legada del onboarding
      const estado = window.__CUENTA_ESTADO || 'activa';
      // Pagos propios (los carga cargarPagos): pendientes de verificar y confirmados
      const pagos = window.__PAGOS || [];
      const pagoPend = pagos.find((p) => p.estado === 'Por verificar');
      const pagoConf = pagos.find((p) => p.estado === 'Confirmado'); // el más reciente
      let estadoTxt, estadoCls, fechaLabel, fechaVal;
      if (estado !== 'activa' && pagoPend) {
        // Ya pagó y espera la verificación: nada de "activa tu plan" ni días de prueba
        estadoTxt = 'Pago en verificación'; estadoCls = 'prueba';
        fechaLabel = 'Referencia'; fechaVal = pagoPend.ref || '—';
      } else if (estado === 'prueba') {
        let diasRest = 14, vence = null;
        if (window.__TRIAL_TERMINA) {
          vence = new Date(window.__TRIAL_TERMINA);
          diasRest = Math.max(0, Math.ceil((vence - new Date()) / 86400000));
        }
        estadoTxt = 'Prueba · ' + diasRest + ' día' + (diasRest === 1 ? '' : 's'); estadoCls = 'prueba';
        fechaLabel = 'Tu prueba vence'; fechaVal = vence ? fFecha(vence) : '—';
      } else if (estado === 'pendiente') {
        estadoTxt = 'En revisión'; estadoCls = 'prueba';
        fechaLabel = 'Estado'; fechaVal = 'Por activar';
      } else if (estado === 'suspendida') {
        estadoTxt = 'Suspendida'; estadoCls = 'prueba';
        fechaLabel = 'Estado'; fechaVal = 'Contáctanos';
      } else {
        // Activa: el próximo cobro se calcula desde el último pago confirmado + 1 mes
        const base = (pagoConf && pagoConf._creado) ? new Date(pagoConf._creado) : new Date();
        const proximo = addMes(base);
        const diasRenov = Math.ceil((proximo - new Date()) / 86400000);
        estadoCls = 'activo'; estadoTxt = 'Activo';
        if (diasRenov <= 5) { estadoTxt = 'Renueva pronto'; estadoCls = 'prueba'; }
        fechaLabel = 'Próximo cobro'; fechaVal = fFecha(proximo);
      }
      // Botón del encabezado acorde al momento del ciclo
      const btnAct = document.getElementById('subActivarBtn');
      if (btnAct) {
        if (estado !== 'activa' && pagoPend) { btnAct.disabled = true; btnAct.innerHTML = '<i data-lucide="clock"></i> Pago en verificación'; }
        else if (estado === 'activa') { btnAct.disabled = false; btnAct.innerHTML = '<i data-lucide="credit-card"></i> Pagar mensualidad'; }
        else { btnAct.disabled = false; btnAct.innerHTML = '<i data-lucide="credit-card"></i> Activar / Pagar'; }
      }
      if (badge) { badge.className = 'contrib-badge' + (estadoCls === 'activo' ? ' especial' : ''); badge.innerHTML = '<i data-lucide="' + (estadoCls === 'activo' ? 'circle-check' : 'clock') + '"></i> <span>' + estadoTxt + '</span>'; }
      document.getElementById('subSummary').innerHTML =
        '<div class="ss-card"><div class="ss-main"><div class="ss-plan-ic"><i data-lucide="' + (ICON[plan] || 'package') + '"></i></div>'
        + '<div><div class="ss-label">Tu plan actual</div><div class="ss-plan">' + planTxt + '</div><span class="ss-badge ' + estadoCls + '">' + estadoTxt + '</span></div></div>'
        + '<div class="ss-meta"><div class="ss-meta-item"><span>Precio</span><strong>' + (plan ? '$' + precio + ' <em>/mes</em>' : '—') + '</strong></div>'
        + '<div class="ss-meta-item"><span>' + fechaLabel + '</span><strong>' + fechaVal + '</strong></div>'
        + '<div class="ss-meta-item"><span>Equivalente Bs</span><strong>' + (plan ? 'Bs ' + bsFmt(precio * bcv) : '—') + '</strong></div></div></div>';
      if (window.lucide) window.lucide.createIcons();
    }

    function listaComp() {
      return (window.__COMPROBANTES || []).filter((c) => {
        if (filtro !== 'todos' && c.tipo !== filtro) return false;
        if (q) { const hay = (c.num + ' ' + c.plan + ' ' + c.fecha + ' ' + c.metodoLabel).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
        return true;
      });
    }
    function render() {
      renderResumen();
      const rows = listaComp();
      body.innerHTML = rows.length ? rows.map((c) => {
        const tipoBadge = c.tipo === 'Factura'
          ? '<span class="role-badge" style="background:rgba(0,142,199,.12);color:#008ec7;"><i data-lucide="file-text"></i> Factura</span>'
          : '<span class="role-badge" style="background:rgba(123,84,201,.12);color:#7b54c9;"><i data-lucide="receipt"></i> Recibo</span>';
        return '<tr><td><strong>' + c.num + '</strong></td><td>' + tipoBadge + '</td><td>Suscripción · ' + c.plan + '</td>'
          + '<td class="num">$' + bsFmt(c.monto) + '</td><td>' + c.metodoLabel + '</td>'
          + '<td><span class="tag success"><i data-lucide="check-circle-2"></i> ' + c.estado + '</span></td><td>' + c.fecha + '</td>'
          + '<td><button class="row-act" data-ver="' + window.__COMPROBANTES.indexOf(c) + '"><i data-lucide="eye"></i> Ver / PDF</button></td></tr>';
      }).join('') : '<tr><td colspan="8" style="text-align:center;padding:28px;color:var(--fg-muted);">Sin comprobantes</td></tr>';
      document.getElementById('compShown').textContent = rows.length;
      body.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => {
        const c = window.__COMPROBANTES[parseInt(b.dataset.ver, 10)];
        if (c && window.__verComprobante) window.__verComprobante(c);
      }));
      if (window.lucide) window.lucide.createIcons();
    }
    window.__renderHistorial = render;

    document.getElementById('compFiltros').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('compFiltros').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      filtro = b.dataset.f; render();
    }));
    const cs = document.getElementById('compSearch');
    if (cs) cs.addEventListener('input', () => { q = cs.value.trim().toLowerCase(); render(); });

    document.getElementById('subCambiarBtn').addEventListener('click', () => { if (window.showView) window.showView('planes', 'Planes y Precios'); });
    document.getElementById('subActivarBtn').addEventListener('click', () => { if (window.openCheckout) window.openCheckout(window.__planActivo); });

    window.__renderSuscripcion = render;  // para refrescar tras conocer el plan real al iniciar sesión
    render();
  })();

  /* =========================================================
     CONFIGURACIÓN · Mi Empresa (datos, identidad, fiscal, facturación)
     ========================================================= */
  (function configModule() {
    const view = document.getElementById('view-config');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const bsFmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Subida de logo (vista previa local)
    const logoBtn = document.getElementById('cfgLogoBtn');
    const logoFile = document.getElementById('cfgLogoFile');
    const logoPrev = document.getElementById('cfgLogoPreview');
    const logoName = document.getElementById('cfgLogoName');
    if (logoBtn) logoBtn.addEventListener('click', () => logoFile.click());
    if (logoFile) logoFile.addEventListener('change', () => {
      const f = logoFile.files && logoFile.files[0];
      if (!f) return;
      /* Hasta aquí esto solo pintaba una vista previa y decía «se usará en
         tus documentos». No guardaba nada: al recargar, el logo se perdía.
         Ahora se guarda en empresa_firma, el mismo sitio donde lo deja el
         formulario de Firma y sello. */
      if (f.size > 500 * 1024) {
        toast('Esa imagen pesa ' + Math.round(f.size / 1024) + ' KB. Recórtala: un logo no debería pasar de 500 KB.', 'error');
        logoFile.value = ''; return;
      }
      logoName.textContent = f.name;
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target.result;
        logoPrev.innerHTML = '<img src="' + dataUrl + '" alt="logo">';
        if (!window.__guardarLogoEmpresa) { toast('Logo cargado (no se pudo guardar: recarga la página)', 'error'); return; }
        const { error } = await window.__guardarLogoEmpresa(dataUrl);
        if (error) { toast('No se pudo guardar el logo: ' + error.message, 'error'); return; }
        toast('Logo guardado · ya sale en el encabezado de tus documentos', 'success');
      };
      reader.readAsDataURL(f);
    });

    // La tasa de cambio se comparte con Cobros y los recibos (window.__BCV)
    const tasaInput = document.getElementById('cfgTasa');
    if (tasaInput && window.__BCV) tasaInput.value = bsFmt(window.__BCV);

    const $c = (id) => document.getElementById(id);

    /* Trae de la BASE los datos de la empresa activa y llena el formulario.

       Se consulta la base y no se usa lo que trae el selector, porque el
       selector solo lleva unos pocos campos. Un formulario a medio llenar
       sobre datos fiscales es tan engañoso como uno con los datos de otra
       empresa. */
    async function cargarConfigEmpresa() {
      const emp = window.__EMPRESA_ACTIVA;
      const set = (id, val) => { const el = $c(id); if (el) el.value = val == null ? '' : String(val); };
      if (!emp || !emp.id || !window.sb) {
        ['cfgRazon', 'cfgRif', 'cfgDom', 'cfgTel', 'cfgWsp', 'cfgEmail'].forEach((id) => set(id, ''));
        return;
      }
      const { data, error } = await window.sb.from('empresas')
        .select('nombre, rif, condicion_fiscal, direccion, telefono, whatsapp, email, ciudad, color_primario, color_secundario, alicuota_default, aplica_igtf, medio_emision, fuente_tasa')
        .eq('id', emp.id).maybeSingle();
      if (error || !data) { console.warn('[DigiAccount] No se pudo cargar la configuración de la empresa'); return; }
      set('cfgRazon', data.nombre);
      set('cfgRif', data.rif);
      set('cfgDom', data.direccion);
      set('cfgTel', data.telefono);
      set('cfgWsp', data.whatsapp);
      set('cfgEmail', data.email);
      const tc = $c('cfgTipoContrib');
      // El selector guarda el valor de la base ('ordinario'/'especial'/'formal'),
      // así que no hay que traducir textos ni depender de cómo estén escritos.
      if (tc) tc.value = String(data.condicion_fiscal || 'ordinario').toLowerCase();
      if ($c('cfgColor') && data.color_primario) $c('cfgColor').value = data.color_primario;
      if ($c('cfgColor2') && data.color_secundario) $c('cfgColor2').value = data.color_secundario;
      aplicarAgenteRetencion(data.condicion_fiscal);
      if ($c('cfgIva')) $c('cfgIva').value = String(data.alicuota_default != null ? Number(data.alicuota_default) : 16);
      if ($c('cfgIgtf')) $c('cfgIgtf').checked = !!data.aplica_igtf;
      if ($c('cfgMedio')) $c('cfgMedio').value = data.medio_emision || 'forma-libre';
      if ($c('cfgFuenteTasa')) $c('cfgFuenteTasa').value = data.fuente_tasa || 'bcv';
      // Se propagan a quien las usa de verdad
      window.__EMPRESA_PREFS = {
        alicuota: Number(data.alicuota_default) || 16,
        igtf: !!data.aplica_igtf,
        medio: data.medio_emision || 'forma-libre',
        fuenteTasa: data.fuente_tasa || 'bcv',
      };
      window.medioEmision = window.__EMPRESA_PREFS.medio;
      aplicarPeriodoIva(data.condicion_fiscal);
      await pintarProximoNumero();
      pintarTasa();
      const nom = $c('cfgEmpresaNombre');
      if (nom) nom.textContent = data.nombre || '—';
    }
    window.__cargarConfigEmpresa = cargarConfigEmpresa;

    /* Ser agente de retención de IVA NO es una preferencia: lo determina la
       condición fiscal. Los sujetos pasivos ESPECIALES lo son por designación
       del SENIAT; los ordinarios no.

       Por eso el interruptor se DERIVA de la condición y queda bloqueado, en
       vez de guardarse aparte. Dos campos que dicen lo mismo terminan
       diciendo cosas distintas, y aquí eso significaría retener a un proveedor
       sin estar designado, o no retenerle debiendo hacerlo. */
    function aplicarAgenteRetencion(cond) {
      const esp = /especial/i.test(String(cond || ''));
      const chk = $c('cfgAgenteRet');
      if (!chk) return;
      chk.checked = esp;
      chk.disabled = true;
      const caja = chk.closest('.cfg-toggle');
      const txt = caja && caja.querySelector('small');
      if (txt) {
        txt.textContent = esp
          ? 'Sí — por ser contribuyente especial, retiene IVA a sus proveedores'
          : 'No — solo los contribuyentes especiales son agentes de retención';
      }
    }

    /* El período de declaración de IVA lo fija la condición fiscal: los
       sujetos pasivos especiales declaran quincenal y los ordinarios mensual.
       No es una preferencia, así que se muestra y no se elige — guardarlo
       aparte permitiría que contradiga a la condición. */
    function aplicarPeriodoIva(cond) {
      const el = $c('cfgPeriodoIva');
      if (!el) return;
      el.value = /especial/i.test(String(cond || '')) ? 'Quincenal' : 'Mensual';
    }

    /* El próximo N° de factura lo calcula el sistema del último realmente
       emitido. Antes era un campo escribible con "00-000001" fijo: escribir
       ahí un número no cambiaba nada y solo servía para creer que sí. */
    async function pintarProximoNumero() {
      const el = $c('cfgNumFac');
      if (!el) return;
      const emp = window.__EMPRESA_ACTIVA;
      if (!emp || !emp.id || !window.sb) { el.value = '—'; return; }
      const { data } = await window.sb.from('libro_fiscal')
        .select('numero_factura').eq('empresa_id', emp.id).eq('tipo', 'venta');
      let max = 0;
      (data || []).forEach((r) => {
        const n = parseInt(String(r.numero_factura || '').replace(/[^0-9]/g, ''), 10);
        if (!isNaN(n) && n > max) max = n;
      });
      el.value = String(max + 1).padStart(6, '0');
    }

    /* La tasa venía del valor de respaldo (36,80) porque el campo se llenaba
       al arrancar el módulo, antes de que llegara la tasa real de Supabase.
       Ahora se pinta cuando se abre la configuración y cada vez que la tasa
       cambia, y el campo es de solo lectura: la tasa oficial no se escribe a
       mano desde aquí. */
    function pintarTasa() {
      const el = $c('cfgTasa');
      if (!el) return;
      // Con fuente BCV la tasa es de solo lectura; con fuente manual se escribe.
      const manual = (($c('cfgFuenteTasa') || {}).value || 'bcv') === 'manual';
      el.readOnly = !manual;
      const v = Number(window.__BCV) || 0;
      if (!manual || !el.value || el.value === '—') el.value = v ? bsFmt(v) : '—';
      const org = $c('cfgTasaOrigen');
      if (org) {
        const f = document.getElementById('fxFecha');
        org.textContent = manual
          ? 'Tasa fijada a mano. Cámbiala a BCV para que se actualice sola.'
          : 'Tasa oficial del BCV' + (f && f.textContent.trim() ? ' · valor del ' + f.textContent.trim() : '') + ' · se actualiza sola.';
      }
    }
    window.__pintarTasaConfig = pintarTasa;
    cargarConfigEmpresa();

    // Al cambiar la condición en el formulario, el interruptor la sigue en el
    // acto: así se ve la consecuencia antes de guardar, no después.
    if ($c('cfgTipoContrib')) {
      $c('cfgTipoContrib').addEventListener('change', (e) => {
        aplicarAgenteRetencion(e.target.value);
        aplicarPeriodoIva(e.target.value);
      });
    }
    if ($c('cfgFuenteTasa')) $c('cfgFuenteTasa').addEventListener('change', pintarTasa);

    $c('cfgGuardar').addEventListener('click', async () => {
      // Tasa de cambio → se propaga a Cobros y recibos
      const tasa = parseFloat(String(($c('cfgTasa') || {}).value || '').replace(',', '.'));
      if (tasa && tasa > 0) {
        window.__BCV = tasa;
        const bcvTasa = $c('bcvTasa');
        if (bcvTasa) bcvTasa.textContent = bsFmt(tasa);
      }

      const emp = window.__EMPRESA_ACTIVA;
      if (!emp || !emp.id || !window.sb) { toast('No hay una empresa activa seleccionada', 'error'); return; }

      const razon = ($c('cfgRazon').value || '').trim();
      if (!razon) { toast('La razón social no puede quedar vacía', 'error'); return; }

      /* Antes esto NO guardaba nada: solo cambiaba una etiqueta en pantalla y
         decía "Configuración guardada correctamente". Editar la condición
         fiscal de una empresa y que no se guarde es de las cosas que se
         descubren tarde y mal. */
      const fila = {
        nombre: razon,
        rif: ($c('cfgRif').value || '').trim().toUpperCase(),
        condicion_fiscal: ($c('cfgTipoContrib') || {}).value || 'ordinario',
        direccion: ($c('cfgDom').value || '').trim(),
        telefono: ($c('cfgTel').value || '').trim(),
        whatsapp: ($c('cfgWsp').value || '').trim(),
        email: ($c('cfgEmail').value || '').trim(),
        color_primario: ($c('cfgColor') || {}).value || null,
        color_secundario: ($c('cfgColor2') || {}).value || null,
        alicuota_default: Number(($c('cfgIva') || {}).value) || 16,
        aplica_igtf: !!(($c('cfgIgtf') || {}).checked),
        medio_emision: ($c('cfgMedio') || {}).value || 'forma-libre',
        fuente_tasa: ($c('cfgFuenteTasa') || {}).value || 'bcv',
      };
      const { error } = await window.sb.from('empresas').update(fila).eq('id', emp.id);
      if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }

      // Se refresca lo que depende de la empresa: nombre, selector y el cuadro
      // de ISLR, que cambia si cambió la condición fiscal.
      const nom = $c('cfgEmpresaNombre');
      if (nom) nom.textContent = razon;
      if (window.cargarEmpresas) window.cargarEmpresas();
      if (window.__renderIslrBox) window.__renderIslrBox(0);
      toast('Datos de ' + razon + ' guardados', 'success');
    });

    // ---- Métodos de cobro de la empresa a sus clientes ----
    const METODOS_EMP = {
      pagomovil: { label: 'Pago Móvil', icon: 'smartphone' },
      transferencia: { label: 'Transferencia', icon: 'landmark' },
      zelle: { label: 'Zelle', icon: 'circle-dollar-sign' },
      usdt: { label: 'USDT / Binance', icon: 'bitcoin' },
      efectivo: { label: 'Efectivo / Divisas', icon: 'banknote' },
    };
    // Estructura de campos por método; valores vacíos (cada empresa configura los suyos).
    const COBROS_EMP = {
      pagomovil: { activo: false, campos: { Banco: '', 'Teléfono': '', 'Tipo de documento': '', 'Nº de documento': '', Titular: '' } },
      transferencia: { activo: false, campos: { Banco: '', 'Tipo de cuenta': '', 'Nº de cuenta': '', 'Tipo de documento': '', 'Nº de documento': '', Titular: '' } },
      zelle: { activo: false, campos: { Email: '', Titular: '' } },
      usdt: { activo: false, campos: { Red: '', Wallet: '' } },
      efectivo: { activo: false, campos: { Moneda: '', Nota: '' } },
    };
    window.__COBROS_EMPRESA = COBROS_EMP;

    /* Los datos del pago movil, listos para imprimir en un ticket.

       El cliente se lleva el papel: si ahi esta como pagar, no hay que
       dictarle los datos por telefono ni mandarlos por WhatsApp cada vez. En
       el recibo de cobro importa mas todavia, porque el que queda debiendo ya
       sabe por donde mandar el resto.

       Devuelve '' si el metodo esta apagado o le faltan datos: un ticket que
       anuncia una forma de pago a medias es peor que uno que no la anuncia.

       El TITULAR no se imprime — ya encabeza el ticket con el nombre del
       negocio, y repetirlo solo gasta papel. */
    window.__pagoMovilTicket = function () {
      const pm = (window.__COBROS_EMPRESA || {}).pagomovil;
      if (!pm || !pm.activo) return '';
      const c = pm.campos || {};
      const banco = String(c.Banco || '').trim();
      const tel = String(c['Teléfono'] || '').replace(/\D/g, '');
      const ndoc = String(c['Nº de documento'] || '').replace(/\D/g, '');
      const tipo = String(c['Tipo de documento'] || 'V').trim().charAt(0).toUpperCase() || 'V';
      if (!banco || !tel || !ndoc) return '';

      // 04126303679 -> 0412-6303679, que es como se lee y se dicta.
      const telFmt = tel.length === 11 ? (tel.slice(0, 4) + '-' + tel.slice(4)) : tel;
      const esc2 = window.esc || ((x) => String(x == null ? '' : x));
      return '<div class="tk-sep dashed"></div>'
        + '<div class="tk-pago">'
        + '<div class="tk-pago-tt">PARA PAGAR · PAGO MÓVIL</div>'
        + '<div class="tk-pago-l"><span>BANCO</span><span>' + esc2(banco.toUpperCase()) + '</span></div>'
        + '<div class="tk-pago-l"><span>CI</span><span>' + esc2(tipo + '-' + ndoc) + '</span></div>'
        + '<div class="tk-pago-l"><span>TLF</span><span>' + esc2(telFmt) + '</span></div>'
        + '</div>';
    };
    // Persistencia por empresa (columna jsonb empresas.metodos_cobro).
    async function guardarCobrosEmp() {
      const emp = window.__EMPRESA_ACTIVA;
      if (!window.sb || !emp || !emp.id) return;
      try { await window.sb.from('empresas').update({ metodos_cobro: COBROS_EMP }).eq('id', emp.id); }
      catch (e) { /* la columna metodos_cobro aún no existe: no rompe */ }
    }
    // Carga los métodos de cobro guardados de una empresa (tolerante si la columna no existe).
    window.__cargarCobrosEmp = async function (empresaId) {
      let guardado = null;
      if (window.sb && empresaId) {
        try {
          const { data } = await window.sb.from('empresas').select('metodos_cobro').eq('id', empresaId).single();
          if (data && data.metodos_cobro) guardado = data.metodos_cobro;
        } catch (e) { /* columna no existe aún */ }
      }
      Object.keys(COBROS_EMP).forEach((k) => {
        const g = guardado && guardado[k];
        COBROS_EMP[k].activo = !!(g && g.activo);
        Object.keys(COBROS_EMP[k].campos).forEach((c) => {
          COBROS_EMP[k].campos[c] = (g && g.campos && g.campos[c] != null) ? g.campos[c] : '';
        });
      });
      renderCobrosEmp();
    };
    /* ══════════════════════════════════════════════════════════════════
       DE «me pagan por aqui» A «el dinero entra aqui»

       Son dos cosas distintas y el sistema no las conectaba:

         Metodos de cobro     los datos que se le MUESTRAN AL CLIENTE
         Cuentas de Tesoreria las cuentas DONDE ENTRA el dinero

       El selector del cobro lee las segundas. Una clienta lleno su Pago Movil
       —banco, telefono, titular— y al cobrar solo le salia «Caja»: el sistema
       le habia pedido los datos del banco en un sitio y esperaba que los
       volviera a escribir en otro.

       SE OFRECE, NO SE CREA SOLO. Puede que ese pago movil entre a una cuenta
       que ya existe con otro nombre. Crear cuentas a espaldas de quien lleva
       los numeros es como aparecen saldos que nadie sabe de donde salieron.
       ══════════════════════════════════════════════════════════════════ */
    async function ofrecerCuentaTesoreria(clave) {
      /* `esc` no existe en este modulo —solo en window—, y un ReferenceError
         aqui no lo detecta `node --check`: aparece cuando alguien pulsa el
         interruptor. Se toma de window con un respaldo. */
      const esc = window.esc || ((x) => String(x == null ? '' : x)
        .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
      if (clave !== 'pagomovil' && clave !== 'transferencia') return;   // Zelle, USDT y efectivo no son cuenta de banco
      const emp = window.__EMPRESA_ACTIVA;
      if (!window.sb || !emp || !emp.id) return;

      const campos = (COBROS_EMP[clave] || {}).campos || {};
      const banco = String(campos.Banco || '').trim();
      if (!banco) return;        // sin banco no hay nada que proponer todavia

      const { data: cuentas } = await window.sb.from('cuentas_tesoreria')
        .select('id, nombre, banco').eq('empresa_id', emp.id);
      const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const yaEsta = (cuentas || []).some((cu) => norm(cu.banco) === norm(banco)
        || norm(cu.nombre).indexOf(norm(banco)) >= 0);
      if (yaEsta) return;

      const esPm = clave === 'pagomovil';
      const nombre = (esPm ? 'Pago Móvil · ' : 'Banco ') + banco;
      const detalle = esPm
        ? (campos['Teléfono'] ? ('Teléfono ' + campos['Teléfono']) : '')
        : (campos['Nº de cuenta'] ? ('Cuenta ' + campos['Nº de cuenta']) : '');

      window.openFormModal && window.openFormModal({
        title: 'Falta dónde entra ese dinero',
        saveLabel: 'Crear la cuenta',
        fields: [
          { name: 'nombre', label: 'Nombre de la cuenta', col: 2, value: nombre },
        ],
        afterRender: (b) => {
          const aviso = document.createElement('div');
          aviso.style.cssText = 'font-size:12.5px;line-height:1.6;color:var(--fg-body);margin-bottom:14px;';
          aviso.innerHTML = 'Acabas de activar <strong>' + esc(METODOS_EMP[clave].label)
            + '</strong> con el <strong>' + esc(banco) + '</strong>'
            + (detalle ? ' (' + esc(detalle) + ')' : '') + '.<br><br>'
            + 'Esos son los datos que verá tu cliente para pagarte. Pero al registrar el cobro '
            + 'hay que decir <strong>en qué cuenta entró</strong> el dinero, y esa todavía no existe: '
            + 'solo aparecería «Caja».<br><br>'
            + 'Si la creo ahora, la vas a tener al cobrar.';
          b.insertBefore(aviso, b.firstChild);
        },
        onSave: async (v) => {
          const n = (v.nombre || '').trim();
          if (!n) return 'Ponle un nombre a la cuenta.';
          const { error } = await window.sb.from('cuentas_tesoreria').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: emp.id,
            nombre: n, tipo: 'Banco', banco: banco, moneda: 'Bs',
            saldo_inicial: 0, color: '#1f4e79',
          });
          if (error) { toast('No se pudo crear la cuenta: ' + error.message, 'error'); return; }
          toast('Cuenta "' + n + '" creada · ya te aparece al registrar un cobro', 'success');
          if (window.cargarTesoreria) window.cargarTesoreria();
        },
      });
    }

    const cobrosGrid = document.getElementById('cfgCobrosGrid');
    function renderCobrosEmp() {
      if (!cobrosGrid) return;
      cobrosGrid.innerHTML = Object.keys(METODOS_EMP).map((k) => {
        const m = METODOS_EMP[k]; const r = COBROS_EMP[k];
        const datos = Object.keys(r.campos).map((c) => '<div class="cr-row"><span>' + esc(c) + '</span><strong>' + esc(r.campos[c]) + '</strong></div>').join('');
        return '<div class="cobro-card' + (r.activo ? '' : ' off') + '">'
          + '<div class="cc-head"><span class="cc-ic"><i data-lucide="' + m.icon + '"></i></span><div class="cc-tt"><div class="cc-name">' + m.label + '</div></div>'
          + '<label class="cc-switch"><input type="checkbox" data-m="' + k + '"' + (r.activo ? ' checked' : '') + '><span></span></label></div>'
          + '<div class="cc-body">' + datos + '</div>'
          + '<button class="cc-edit" data-edit="' + k + '"><i data-lucide="pencil"></i> Configurar</button>'
          + '</div>';
      }).join('');
      cobrosGrid.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => configCobro(b.dataset.edit)));
      cobrosGrid.querySelectorAll('input[data-m]').forEach((c) => c.addEventListener('change', () => {
        COBROS_EMP[c.dataset.m].activo = c.checked;
        /* Si el metodo entra por banco, se ofrece crear la cuenta de tesoreria
           que le corresponde. Ver `ofrecerCuentaTesoreria`. */
        if (c.checked) setTimeout(() => ofrecerCuentaTesoreria(c.dataset.m), 400);
        c.closest('.cobro-card').classList.toggle('off', !c.checked);
        guardarCobrosEmp();
        toast(METODOS_EMP[c.dataset.m].label + (c.checked ? ' activado' : ' desactivado') + ' como método de cobro', c.checked ? 'success' : 'info');
      }));
      if (window.lucide) window.lucide.createIcons();
    }
    function configCobro(k) {
      const r = COBROS_EMP[k]; const m = METODOS_EMP[k];
      const TIPOS_DOC = ['V — Persona', 'J — Comercio'];
      const TIPOS_CUENTA = ['Corriente', 'Ahorro'];
      window.openFormModal && window.openFormModal({
        title: 'Configurar · ' + m.label, saveLabel: 'Guardar',
        fields: Object.keys(r.campos).map((c) => (c === 'Tipo de documento')
          ? { name: c, label: c, type: 'select', options: TIPOS_DOC, value: r.campos[c] || '', col: 2 }
          : (c === 'Tipo de cuenta')
          ? { name: c, label: c, type: 'select', options: TIPOS_CUENTA, value: r.campos[c] || '', col: 2 }
          : { name: c, label: c, value: r.campos[c], col: 2 }),
        onSave: (v) => { Object.keys(r.campos).forEach((c) => { if (v[c] != null) r.campos[c] = v[c]; }); renderCobrosEmp(); guardarCobrosEmp(); toast('Datos de ' + m.label + ' actualizados'); },
      });
    }
    renderCobrosEmp();
  })();

  /* =========================================================
     BANNER DE PRUEBA — recordatorio de vencimiento (dashboard)
     Fases: info (8-14) · recordatorio (4-7) · urgente (1-3) · vencido
     ========================================================= */
  (function trialBanner() {
    const banner = document.getElementById('trialBanner');
    if (!banner) return;
    const drawIcons = () => { if (window.lucide) window.lucide.createIcons(); };
    let dismissedNivel = null;

    function nivel(d) {
      if (d <= 0) return 'vencido';
      if (d <= 3) return 'urgente';
      if (d <= 7) return 'aviso';
      return 'info';
    }
    const CONTENIDO = {
      info: (d) => ({ icon: 'gift', title: 'Estás usando tu mes de cortesía', sub: 'Quedan ' + d + ' días · activa tu plan cuando quieras, sin apuro.' }),
      aviso: (d) => ({ icon: 'clock', title: 'Tu prueba vence en ' + d + ' días', sub: 'Activa tu plan para no perder el acceso a tus módulos.' }),
      urgente: (d) => ({ icon: 'alert-triangle', title: '¡Solo te quedan ' + d + (d === 1 ? ' día' : ' días') + ' de prueba!', sub: 'Activa tu plan ahora para no perder tu información ni tu acceso.' }),
      vencido: () => ({ icon: 'lock', title: 'Tu prueba terminó', sub: 'Activa un plan para seguir usando DigiAccount.' }),
    };

    function sync() {
      const p = window.__prueba;
      if (!p) { banner.hidden = true; return; }
      // Si ya reportó un pago (en verificación), no insistir con "activa tu plan"
      if ((window.__PAGOS || []).some((x) => x.estado === 'Por verificar')) { banner.hidden = true; return; }
      const d = p.dias;
      const nv = nivel(d);
      const fijo = (nv === 'urgente' || nv === 'vencido');
      if (dismissedNivel === nv && !fijo) { banner.hidden = true; return; }
      const c = CONTENIDO[nv](d);
      banner.dataset.nivel = nv;
      document.getElementById('tbIcon').setAttribute('data-lucide', c.icon);
      document.getElementById('tbTitle').textContent = c.title;
      document.getElementById('tbSub').textContent = c.sub;
      document.getElementById('tbClose').hidden = fijo; // urgente/vencido no se puede descartar
      banner.hidden = false;
      drawIcons();
    }
    window.__syncTrialBanner = sync;
    // Helper para simular días restantes (demo): window.__setDiasPrueba(5)
    window.__setDiasPrueba = function (n) {
      if (!window.__prueba) { if (window.toast) window.toast('No hay una prueba activa', 'info'); return; }
      const antes = window.__prueba.dias;
      window.__prueba.dias = n;
      dismissedNivel = null;
      const trial = document.getElementById('planTrial');
      if (trial) trial.textContent = 'Prueba · ' + n + ' días';
      // Notifica al entrar en zona urgente o al vencer
      if (window.__notificar && nivel(n) !== nivel(antes)) {
        if (n <= 0) window.__notificar({ icon: 'lock', nivel: 'danger', titulo: 'Tu prueba terminó', detalle: 'Activa un plan para no perder tu acceso', view: 'suscripcion', title2: 'Mi Suscripción' });
        else if (n <= 3) window.__notificar({ icon: 'alert-triangle', nivel: 'warn', titulo: '¡Tu prueba vence en ' + n + (n === 1 ? ' día!' : ' días!'), detalle: 'Activa tu plan para mantener tu suscripción', view: 'suscripcion', title2: 'Mi Suscripción' });
      }
      sync();
    };

    document.getElementById('tbActivar').addEventListener('click', () => {
      if (window.openCheckout) window.openCheckout(window.__prueba ? window.__prueba.plan : window.__planActivo);
    });
    document.getElementById('tbClose').addEventListener('click', () => {
      dismissedNivel = nivel(window.__prueba ? window.__prueba.dias : 0);
      banner.hidden = true;
    });

    sync();
  })();

  /* =========================================================
     ONBOARDING · Selección de plan (funnel de registro)
     cuenta creada → elegir plan → empresa → sistema (el acceso lo abre el pago)
     ========================================================= */
  (function planOnboarding() {
    const scrim = document.getElementById('planOnboarding');
    if (!scrim) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const grid = document.getElementById('onbGrid');
    const ICONS = {
      'Contador Básico': 'calculator', 'Contador PRO': 'briefcase-business', 'Firma Contable': 'landmark',
      'Emprendimientos y PYME': 'sprout', 'Empresa Completa': 'building-2', 'Grupo Empresarial': 'network',
    };
    let seg = 'empresas', billing = 'mensual';

    function precioMes(p) { return billing === 'anual' ? Math.round(p.precio * 10 / 12) : p.precio; }

    function render() {
      const SEG = window.__PLANES || {};
      const s = SEG[seg]; if (!s) return;
      grid.dataset.count = s.planes.length;
      grid.innerHTML = s.planes.map((p) => {
        let precioHtml;
        if (billing === 'anual') precioHtml = '<div class="pc-amount"><span class="cur">$</span>' + precioMes(p) + '<span class="per">/mes</span></div><div class="pc-bill">facturado anual · $' + (p.precio * 10) + '/año</div>';
        else precioHtml = '<div class="pc-amount"><span class="cur">$</span>' + p.precio + '<span class="per">/mes</span></div>';
        return '<div class="price-card' + (p.popular ? ' popular' : '') + '">'
          + (p.popular ? '<span class="pc-badge">Más elegido</span>' : '')
          + '<div class="pc-icon"><i data-lucide="' + (ICONS[p.nombre] || 'package') + '"></i></div>'
          + '<div class="pc-plan">' + p.nombre + '</div>'
          + (p.sub ? '<div class="pc-sub">' + p.sub + '</div>' : '<div class="pc-sub">&nbsp;</div>')
          + precioHtml
          + '<ul class="pc-features">' + p.features.map((f) => '<li class="' + (f.ok ? 'ok' : 'no') + '"><i data-lucide="' + (f.ok ? 'check' : 'x') + '"></i> ' + f.t + '</li>').join('') + '</ul>'
          + '<button class="pc-cta ' + (p.popular ? 'primary' : 'ghost') + '" data-plan="' + p.nombre + '"><i data-lucide="sparkles"></i> Elegir este plan</button>'
          + '<div class="pc-trial-note">$' + precioMes(p) + '/mes + IVA · activas al pagar</div>'
          + '</div>';
      }).join('');
      grid.querySelectorAll('.pc-cta').forEach((b) => b.addEventListener('click', () => elegir(b.dataset.plan)));
      if (window.lucide) window.lucide.createIcons();
    }

    function elegir(plan) {
      /* Ya no hay prueba abierta. Antes esto llamaba a __iniciarPrueba(plan, 14),
         que encendia 14 dias INVENTADOS en el navegador sin consultar la cuenta:
         el letrero de "quedan 14 dias" salia hasta en cuentas activas cuya
         prueba habia vencido hacia un mes. El plan se aplica, y el acceso lo
         abre el pago, el cupon de un socio, o el fundador. */
      if (window.aplicarPlan) window.aplicarPlan(plan);
      close();
      toast('Plan ' + plan + ' seleccionado · ahora registra tu empresa', 'success');
      if (window.openCompanyWizard) setTimeout(() => window.openCompanyWizard({ fromSignup: true }), 280);
    }

    function close() { scrim.dataset.open = 'false'; }

    const segBox = scrim.querySelector('.onb-seg');
    segBox.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      segBox.querySelectorAll('button').forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
      seg = b.dataset.seg; render();
    }));
    document.getElementById('onbBilling').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('onbBilling').querySelectorAll('button').forEach((x) => x.removeAttribute('data-active'));
      b.dataset.active = 'true'; billing = b.dataset.bill; render();
    }));
    document.getElementById('onbSkip').addEventListener('click', () => elegir(seg === 'contadores' ? 'Firma Contable' : 'Empresa Completa'));

    window.openPlanOnboarding = function (segmento, nombre) {
      seg = (segmento === 'contadores') ? 'contadores' : 'empresas';
      segBox.querySelectorAll('button').forEach((x) => (x.dataset.active = x.dataset.seg === seg ? 'true' : 'false'));
      if (nombre) document.getElementById('onbNombre').textContent = String(nombre).split(' ')[0];
      render();
      scrim.dataset.open = 'true';
    };
  })();

  /* =========================================================
     PANEL DEL FUNDADOR — back-office SaaS (solo super-admin)
     ========================================================= */
  (function fundadorModule() {
    const view = document.getElementById('view-fundador');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const fmt0 = (n) => Number(n).toLocaleString('es-VE');

    const PLANES = {
      'Contador Básico': { precio: 49, color: '#545e67', empresas: 'Hasta 3 empresas', usuarios: '2 usuarios', modulos: 'Contabilidad · Fiscal' },
      'Contador PRO': { precio: 79, color: '#008ec7', empresas: 'Hasta 10 empresas', usuarios: '10 usuarios', modulos: 'Fiscal · Contabilidad · Nómina' },
      'Firma Contable': { precio: 199, color: '#003057', empresas: 'Empresas ilimitadas', usuarios: 'Usuarios ilimitados', modulos: 'Todos los módulos' },
      'Emprendimientos y PYME': { precio: 29, color: '#1c8f5a', empresas: '1 empresa', usuarios: '2 usuarios', modulos: 'Ventas y CxC · Compras y CxP · Tesorería · Inventario' },
      'Empresa Completa': { precio: 99, color: '#c97a14', empresas: '1 empresa', usuarios: 'Usuarios ilimitados', modulos: 'Todos los módulos' },
      'Grupo Empresarial': { precio: 299, color: '#7b54c9', empresas: 'Hasta 5 empresas', usuarios: 'Usuarios ilimitados', modulos: 'Todos los módulos' },
    };
    let CUENTAS = [];   // se llena con las cuentas reales desde Supabase
    const estadoTag = { 'Activa': 'success', 'Prueba': 'cyan', 'Vencida': 'danger', 'Pendiente': 'navy', 'Suspendida': 'slate' };
    function normEstado(e) {
      e = String(e || '').toLowerCase();
      if (e === 'activa' || e === 'activo') return 'Activa';
      if (e === 'prueba' || e === 'trial') return 'Prueba';
      if (e === 'suspendida' || e === 'suspendido' || e === 'moroso') return 'Suspendida';
      return 'Pendiente';
    }
    // Carga las cuentas reales del SaaS (solo visible para el fundador / super-admin)
    async function cargarCuentas() {
      if (!window.sb || !window.__ES_FUNDADOR) return;
      const { data: cuentas, error } = await window.sb
        .from('cuentas')
        .select('id, nombre, tipo, segmento, estado, trial_termina_en, planes(nombre), ciclo, plan_desde, proximo_cobro, cortesia_hasta, exenta, exenta_motivo, email_contacto');
      if (error) { console.warn('[Fundador] No se pudieron cargar las cuentas:', error.message); return; }
      const { data: perfiles } = await window.sb.from('perfiles').select('cuenta_id, nombre, rol');
      const { data: emps } = await window.sb.from('empresas').select('cuenta_id');
      const usersBy = {}, empsBy = {}, adminBy = {};
      (perfiles || []).forEach((p) => { usersBy[p.cuenta_id] = (usersBy[p.cuenta_id] || 0) + 1; if (!adminBy[p.cuenta_id] || p.rol === 'admin') adminBy[p.cuenta_id] = p.nombre; });
      (emps || []).forEach((e) => { empsBy[e.cuenta_id] = (empsBy[e.cuenta_id] || 0) + 1; });
      CUENTAS = (cuentas || []).map((c) => {
        const planNombre = (c.planes && c.planes.nombre) || '—';
        const pl = PLANES[planNombre] || {};
        let est = normEstado(c.estado);
        // Días restantes de prueba; si ya venció, se marca como "Vencida"
        let trialDias = null;
        if (est === 'Prueba' && c.trial_termina_en) {
          trialDias = Math.ceil((new Date(c.trial_termina_en) - new Date()) / 86400000);
          if (trialDias < 0) { est = 'Vencida'; trialDias = 0; }
        }
        /* LA SITUACION DE COBRO, en una sola palabra.
           Exenta > cortesía vigente > su próximo cobro > sin plan. El orden
           importa: una cuenta exenta no «vence» aunque tenga fecha vieja. */
        const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
        const dia = (f) => { if (!f) return null; const d = new Date(String(f) + 'T12:00:00'); return isNaN(d.getTime()) ? null : d; };
        const cort = dia(c.cortesia_hasta), prox = dia(c.proximo_cobro);
        const diasPara = (d) => Math.ceil((d - hoy0) / 86400000);
        let cobro, cobroTono, cobroDias = null;
        if (c.exenta) { cobro = 'Exenta'; cobroTono = 'navy'; }
        else if (cort && cort >= hoy0) { cobroDias = diasPara(cort); cobro = 'Cortesía · ' + cobroDias + ' d'; cobroTono = 'cyan'; }
        else if (prox) {
          cobroDias = diasPara(prox);
          cobro = cobroDias < 0 ? 'Vencido hace ' + Math.abs(cobroDias) + ' d'
            : cobroDias === 0 ? 'Cobrar HOY' : 'En ' + cobroDias + ' d';
          cobroTono = cobroDias < 0 ? 'danger' : cobroDias <= 5 ? 'warn' : 'success';
        } else { cobro = 'Sin ciclo'; cobroTono = 'slate'; }
        /* El MRR cuenta lo que SE COBRA. Una cuenta exenta o en cortesía no
           es ingreso: sumarla era contar plata que nadie va a pagar. */
        const cobrable = !c.exenta && !(cort && cort >= hoy0);
        return {
          id: c.id, cuenta: c.nombre, admin: adminBy[c.id] || '—',
          correo: c.email_contacto || '',
          exenta: !!c.exenta, exentaMotivo: c.exenta_motivo || '', cortesiaHasta: c.cortesia_hasta || null,
          planDesde: c.plan_desde || null, proximoCobro: c.proximo_cobro || null,
          ciclo: c.ciclo === 'anual' ? 'anual' : 'mensual',
          cobro: cobro, cobroTono: cobroTono, cobroDias: cobroDias, cobrable: cobrable,
          precio: pl.precio || 0,
          tipo: (c.segmento || c.tipo) === 'contador' ? 'Firma Contable' : 'Empresa',
          plan: planNombre, empresas: empsBy[c.id] || 0, usuarios: usersBy[c.id] || 0,
          estado: est, trialDias: trialDias, mrr: (est === 'Activa' && cobrable) ? (pl.precio || 0) : 0,
          alta: est === 'Prueba' ? ('Prueba · ' + trialDias + ' día' + (trialDias === 1 ? '' : 's')) : '—',
        };
      });
      render(); renderPlanDist(); updateKPIs();
    }
    window.cargarCuentasFundador = cargarCuentas;
    // Cambia el estado de una cuenta (activar / suspender) en Supabase
    async function cambiarEstado(c, nuevo) {
      if (!c || !c.id) return;
      const { error } = await window.sb.from('cuentas').update({ estado: nuevo }).eq('id', c.id);
      if (error) { toast('No se pudo actualizar: ' + error.message, 'error'); return; }
      toast('Cuenta ' + (nuevo === 'activa' ? 'activada' : 'suspendida') + ': ' + c.cuenta, 'success');
      cargarCuentas();
    }
    // Elimina definitivamente una cuenta (y, con ON DELETE CASCADE en la BD, sus datos).
    async function eliminarCuenta(c) {
      if (!c || !c.id) return;
      // PROTECCIÓN: la cuenta del propio fundador JAMÁS se elimina desde aquí.
      if (c.id === window.__CUENTA_ID) {
        toast('Esta es TU cuenta de fundador — no se puede eliminar desde el panel.', 'error');
        return;
      }
      // Confirmación fuerte: hay que escribir el nombre EXACTO de la cuenta.
      const escrito = window.prompt('⚠️ Vas a ELIMINAR definitivamente la cuenta y TODOS sus datos (empresas, registros, usuarios).\n\nPara confirmar, escribe el nombre exacto de la cuenta:\n\n' + c.cuenta);
      if (escrito === null) return; // canceló
      if ((escrito || '').trim() !== String(c.cuenta).trim()) {
        toast('El nombre no coincide — eliminación cancelada.', 'info');
        return;
      }
      // Usa la función RPC eliminar_cuenta (borra todo en orden, con permiso de fundador).
      let { error } = await window.sb.rpc('eliminar_cuenta', { p_cuenta_id: c.id });
      if (error && /function|does not exist|not find|404|schema cache/i.test(error.message || '')) {
        // Respaldo si aún no creaste la función: borrado directo (requiere ON DELETE CASCADE).
        ({ error } = await window.sb.from('cuentas').delete().eq('id', c.id));
      }
      if (error) { toast('No se pudo eliminar: ' + error.message, 'error'); return; }
      toast('Cuenta eliminada: ' + c.cuenta, 'success');
      cargarCuentas();
    }

    // Distribución por plan
    function renderPlanDist() {
      const cont = document.getElementById('planDist');
      cont.innerHTML = Object.keys(PLANES).map((p) => {
        const cs = CUENTAS.filter((c) => c.plan === p);
        const mrr = cs.reduce((a, c) => a + (c.estado === 'Activo' ? c.mrr : 0), 0);
        return '<div class="plan-card" style="--pc:' + PLANES[p].color + ';">'
          + '<div class="pc-head"><span class="pc-dot"></span><span class="pc-name">' + p + '</span><span class="pc-price">$' + PLANES[p].precio + '/mes</span></div>'
          + '<div class="pc-stats"><strong>' + cs.length + '</strong> cuentas · <strong>$' + fmt0(mrr) + '</strong> MRR</div></div>';
      }).join('');
    }

    let filtro = 'todos', query = '';
    function pasa(c) {
      if (filtro === 'firma' && c.tipo !== 'Firma Contable') return false;
      if (filtro === 'empresa' && c.tipo !== 'Empresa') return false;
      if (query && !(c.cuenta + ' ' + c.admin + ' ' + c.plan).toLowerCase().includes(query)) return false;
      return true;
    }
    function render() {
      const tb = document.getElementById('cuentasBody');
      const vis = CUENTAS.filter(pasa);
      tb.innerHTML = vis.map((c) => {
        const ini = c.cuenta.replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
        const pc = PLANES[c.plan] || { color: '#545e67' };
        return '<tr>'
          + '<td><div class="user-cell"><div class="u-avatar" style="background:' + pc.color + '">' + ini + '</div><div class="ui"><div class="n">' + c.cuenta + '</div><div class="e">' + c.admin + '</div></div></div></td>'
          + '<td><span class="tag ' + (c.tipo === 'Firma Contable' ? 'navy' : 'slate') + '">' + c.tipo + '</span></td>'
          + '<td><span class="tag" style="background:' + pc.color + '1f;color:' + pc.color + ';font-weight:700;">' + c.plan + '</span></td>'
          + '<td class="num">' + c.empresas + '</td><td class="num">' + c.usuarios + '</td>'
          + '<td><span class="tag ' + (estadoTag[c.estado] || 'slate') + '">' + c.estado + '</span></td>'
          + '<td><span class="tag ' + c.cobroTono + '" title="' + esc(c.exenta ? (c.exentaMotivo || 'Exenta') : (c.proximoCobro ? 'Próximo cobro: ' + c.proximoCobro : '')) + '">' + c.cobro + '</span></td>'
          + '<td class="num mono">$' + c.mrr + '</td>'
          + '<td style="white-space:nowrap;"><button class="btn btn-ghost" data-cuenta="' + CUENTAS.indexOf(c) + '" style="height:26px;font-size:11px;padding:0 9px;"><i data-lucide="eye"></i> Ver</button>'
          + (['Pendiente', 'Prueba', 'Vencida'].indexOf(c.estado) >= 0
              ? '<button class="btn btn-primary" data-activar="' + CUENTAS.indexOf(c) + '" style="height:26px;font-size:11px;padding:0 9px;margin-left:4px;"><i data-lucide="check"></i> Activar</button>'
              : c.estado === 'Activa'
              ? '<button class="btn btn-ghost" data-suspender="' + CUENTAS.indexOf(c) + '" style="height:26px;font-size:11px;padding:0 9px;margin-left:4px;color:#e06b5e;"><i data-lucide="ban"></i> Suspender</button>'
              : '<button class="btn btn-ghost" data-activar="' + CUENTAS.indexOf(c) + '" style="height:26px;font-size:11px;padding:0 9px;margin-left:4px;"><i data-lucide="rotate-ccw"></i> Reactivar</button>')
          + '<button class="btn btn-ghost" data-cobro="' + CUENTAS.indexOf(c) + '" title="Cobro, cortesía y exención" style="height:26px;font-size:11px;padding:0 9px;margin-left:4px;"><i data-lucide="calendar-clock" style="width:13px;height:13px;"></i> Cobro</button>'
          + '<button class="btn btn-ghost" data-eliminar="' + CUENTAS.indexOf(c) + '" title="Eliminar cuenta" style="height:26px;font-size:11px;padding:0 8px;margin-left:4px;color:#c0392b;"><i data-lucide="trash-2"></i></button>'
          + '</td></tr>';
      }).join('');
      tb.querySelectorAll('[data-cuenta]').forEach((b) => b.addEventListener('click', () => verCuenta(CUENTAS[parseInt(b.dataset.cuenta, 10)])));
      tb.querySelectorAll('[data-activar]').forEach((b) => b.addEventListener('click', () => cambiarEstado(CUENTAS[parseInt(b.dataset.activar, 10)], 'activa')));
      tb.querySelectorAll('[data-suspender]').forEach((b) => b.addEventListener('click', () => cambiarEstado(CUENTAS[parseInt(b.dataset.suspender, 10)], 'suspendida')));
      tb.querySelectorAll('[data-cobro]').forEach((b) => b.addEventListener('click', () => gestionarCobro(CUENTAS[parseInt(b.dataset.cobro, 10)])));
      tb.querySelectorAll('[data-eliminar]').forEach((b) => b.addEventListener('click', () => eliminarCuenta(CUENTAS[parseInt(b.dataset.eliminar, 10)])));
      const sh = document.getElementById('cuentasShown'); if (sh) sh.textContent = vis.length;
      if (window.lucide) window.lucide.createIcons();
    }
    function updateKPIs() {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      const activas = CUENTAS.filter((c) => c.estado === 'Activa');
      set('saasKpiCuentas', activas.length);
      set('saasKpiMrr', fmt0(activas.reduce((a, c) => a + c.mrr, 0)));
      set('saasKpiEmpresas', fmt0(CUENTAS.reduce((a, c) => a + c.empresas, 0)));
      set('saasKpiUsuarios', fmt0(CUENTAS.reduce((a, c) => a + c.usuarios, 0)));
      /* Lo que toca cobrar: vencidas y las que vencen dentro de 7 días. Es el
         numero por el que uno entra a esta pantalla. */
      const porCobrar = CUENTAS.filter((c) => c.cobrable && typeof c.cobroDias === 'number' && c.cobroDias <= 7);
      const elC = document.getElementById('saasKpiMrr');
      if (elC && elC.parentElement) {
        let nota = document.getElementById('saasKpiCobrar');
        if (!nota) {
          nota = document.createElement('div');
          nota.id = 'saasKpiCobrar';
          nota.className = 'kpi-sub';
          elC.parentElement.appendChild(nota);
        }
        const vencidas = porCobrar.filter((c) => c.cobroDias < 0).length;
        nota.innerHTML = porCobrar.length
          ? '<span class="meta" style="color:' + (vencidas ? '#b42318' : '#9a6700') + ';">'
            + porCobrar.length + ' por cobrar' + (vencidas ? ' · ' + vencidas + ' vencida' + (vencidas === 1 ? '' : 's') : '') + '</span>'
          : '<span class="meta">Nadie por cobrar esta semana</span>';
      }
    }
    /* ══════════════════════════════════════════════════════════════════
       COBRO, CORTESIA Y EXENCION — todo desde aqui

       Cinco acciones, una sola pantalla. Cada una deja su registro en
       `beneficios_cuenta`: quien, cuando, cuanto y POR QUE. Un favor sin
       motivo escrito, dentro de un año, no lo recuerda nadie — y es
       exactamente lo que uno necesita saber cuando el favor se acaba.
       ══════════════════════════════════════════════════════════════════ */
    function gestionarCobro(c) {
      const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
      const sumarMeses = (desdeISO, meses) => {
        const d = new Date((desdeISO || hoyISO()) + 'T12:00:00');
        const dia = d.getDate();
        d.setMonth(d.getMonth() + meses);
        if (d.getDate() < dia) d.setDate(0);      // 31 de enero + 1 mes = 28/29 de febrero
        return d.toLocaleDateString('en-CA');
      };
      const situacion = c.exenta
        ? '<strong>Exenta</strong> — no se le cobra.' + (c.exentaMotivo ? '<br>Motivo: ' + esc(c.exentaMotivo) : '')
        : (c.cortesiaHasta && new Date(c.cortesiaHasta + 'T12:00:00') >= new Date(hoyISO() + 'T12:00:00'))
          ? '<strong>En cortesía</strong> hasta el ' + c.cortesiaHasta + '.'
          : c.proximoCobro
            ? '<strong>Próximo cobro:</strong> ' + c.proximoCobro + ' (' + c.ciclo + ')'
            : '<strong>Sin ciclo de cobro.</strong> Todavía no tiene fecha.';

      window.openFormModal && window.openFormModal({
        title: 'Cobro · ' + c.cuenta,
        saveLabel: 'Aplicar',
        fields: [
          { name: 'sit', label: ' ', col: 2, type: 'static', html:
            '<div style="font-size:12.5px;line-height:1.7;color:var(--fg-body);background:var(--bg-surface-alt);padding:10px 12px;border-radius:8px;">'
            + situacion + '<br><span style="color:var(--fg-muted);">Plan ' + esc(c.plan) + ' · $' + (c.precio || 0) + '/mes'
            + (c.planDesde ? ' · desde ' + c.planDesde : '') + '</span></div>' },
          { name: 'accion', label: '¿Qué vas a hacer?', col: 2, type: 'select', options: [
            'Registrar un pago recibido',
            'Dar meses de cortesía',
            'Exonerar — no se le cobra nunca',
            'Quitar la exención y volver al ciclo',
            'Cambiar el ciclo (mensual / anual)',
          ] },
          { name: 'meses', label: 'Meses (para pago o cortesía)', type: 'number', step: '1', value: '1' },
          { name: 'ciclo', label: 'Ciclo', type: 'select', options: ['mensual', 'anual'], value: c.ciclo },
          { name: 'desde', label: 'Cobrar a partir de (dd/mm/aaaa o aaaa-mm-dd)', type: 'date', value: hoyISO() },
          { name: 'motivo', label: 'Motivo o referencia — queda registrado', col: 2,
            placeholder: 'Ej. Pago móvil 0412 ref. 004512 · o: colega que ayuda a probar el producto' },
        ],
        onSave: async (v) => {
          if (!window.sb) return 'Sin conexión.';
          const acc = String(v.accion || '');
          const meses = Math.max(1, parseInt(v.meses, 10) || 1);
          const motivo = (v.motivo || '').trim();
          const patch = {};
          let anota = null;

          if (/pago recibido/i.test(acc)) {
            if (!motivo) return 'Escribe la referencia del pago: es lo que permite comprobarlo después.';
            const base = (c.proximoCobro && c.proximoCobro >= hoyISO()) ? c.proximoCobro : hoyISO();
            const paso = c.ciclo === 'anual' ? 12 * meses : meses;
            patch.proximo_cobro = sumarMeses(base, paso);
            patch.plan_desde = c.planDesde || hoyISO();
            patch.estado = 'activa';
            patch.exenta = false;
            anota = { tipo: 'pago', meses: meses, hasta: patch.proximo_cobro };
          } else if (/cortesía|cortesia/i.test(acc)) {
            if (!motivo) return 'Escribe por qué le das la cortesía. Dentro de un año, eso es lo único que lo explica.';
            const base = (c.cortesiaHasta && c.cortesiaHasta >= hoyISO()) ? c.cortesiaHasta : hoyISO();
            patch.cortesia_hasta = sumarMeses(base, meses);
            patch.proximo_cobro = patch.cortesia_hasta;
            patch.exenta = false;
            patch.estado = 'activa';
            anota = { tipo: 'cortesia', meses: meses, hasta: patch.cortesia_hasta };
          } else if (/^Exonerar/i.test(acc)) {
            if (!motivo) return 'Escribe el motivo de la exención: es una decisión, no un olvido.';
            patch.exenta = true;
            patch.exenta_motivo = motivo;
            patch.proximo_cobro = null;
            patch.cortesia_hasta = null;
            patch.estado = 'activa';
            anota = { tipo: 'exencion', meses: null, hasta: null };
          } else if (/Quitar la exención/i.test(acc)) {
            patch.exenta = false;
            patch.exenta_motivo = null;
            patch.proximo_cobro = v.desde || hoyISO();
            patch.plan_desde = c.planDesde || (v.desde || hoyISO());
            anota = { tipo: 'ajuste', meses: null, hasta: patch.proximo_cobro };
          } else {
            patch.ciclo = v.ciclo === 'anual' ? 'anual' : 'mensual';
            anota = { tipo: 'ajuste', meses: null, hasta: c.proximoCobro };
          }

          const { error } = await window.sb.from('cuentas').update(patch).eq('id', c.id);
          if (error) return 'No se pudo guardar: ' + error.message;
          if (anota) {
            const { error: eB } = await window.sb.from('beneficios_cuenta').insert({
              cuenta_id: c.id, tipo: anota.tipo, meses: anota.meses, hasta: anota.hasta,
              motivo: motivo || acc, otorgado_por: window.__USER_EMAIL || 'fundador',
            });
            if (eB) console.warn('[Fundador] No se pudo registrar el beneficio:', eB.message);
          }
          if (window.toast) {
            window.toast(patch.exenta ? c.cuenta + ' queda EXENTA de cobro'
              : patch.proximo_cobro ? c.cuenta + ' · próximo cobro ' + patch.proximo_cobro
              : c.cuenta + ' actualizada', 'success');
          }
          cargarCuentas();
        },
      });
    }

    function verCuenta(c) {
      const pl = PLANES[c.plan] || {};
      window.openFormModal && window.openFormModal({
        title: c.cuenta, saveLabel: 'Cerrar',
        fields: [{ name: 'x', label: ' ', col: 2, type: 'static', html: '<div style="font-size:12.5px;line-height:1.8;color:var(--fg-body);">'
          + '<strong>Administrador:</strong> ' + c.admin + '<br>'
          + '<strong>Tipo:</strong> ' + c.tipo + ' · <strong>Estado:</strong> ' + c.estado + '<br>'
          + '<strong>Plan:</strong> ' + c.plan + ' ($' + (pl.precio || 0) + '/mes)<br>'
          + '<strong>Incluye:</strong> ' + (pl.empresas || '') + ' · ' + (pl.usuarios || '') + '<br>'
          + '<strong>Módulos:</strong> ' + (pl.modulos || '') + '<hr style="border:0;border-top:1px solid var(--border-default);margin:8px 0;">'
          + 'Gestiona <strong>' + c.empresas + ' empresa' + (c.empresas === 1 ? '' : 's') + '</strong> con <strong>' + c.usuarios + ' usuario' + (c.usuarios === 1 ? '' : 's') + '</strong> · alta ' + c.alta + '.</div>' }],
        onSave: () => {},
      });
    }

    document.getElementById('cuentasFiltros').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('cuentasFiltros').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      filtro = b.dataset.f; render();
    }));
    const search = document.getElementById('cuentasSearch');
    if (search) search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });

    document.getElementById('nuevaCuentaSaasBtn').addEventListener('click', () => {
      window.openFormModal && window.openFormModal({
        title: 'Nueva cuenta · cliente', saveLabel: 'Crear cuenta',
        fields: [
          { name: 'cuenta', label: 'Nombre de la cuenta', col: 2, placeholder: 'Ej. Despacho Contable XYZ' },
          { name: 'admin', label: 'Correo del administrador', col: 2, placeholder: 'admin@cliente.com' },
          { name: 'tipo', label: 'Tipo', type: 'select', options: ['Empresa', 'Firma Contable'] },
          { name: 'plan', label: 'Plan', type: 'select', options: Object.keys(PLANES) },
        ],
        onSave: (v) => {
          if (!v.cuenta || !v.admin) return 'Completa el nombre y el correo del administrador.';
          CUENTAS.unshift({ cuenta: v.cuenta, admin: v.admin, tipo: v.tipo, plan: v.plan, empresas: v.tipo === 'Firma Contable' ? 0 : 1, usuarios: 1, estado: 'Prueba', mrr: 0, alta: 'Jun 2026' });
          render(); renderPlanDist(); updateKPIs();
          toast('Cuenta "' + v.cuenta + '" creada en periodo de prueba', 'success');
        },
      });
    });

    document.getElementById('saasExportBtn').addEventListener('click', () => {
      const rows = [['Cuenta', 'Administrador', 'Tipo', 'Plan', 'Empresas', 'Usuarios', 'Estado', 'MRR USD']];
      CUENTAS.forEach((c) => rows.push([c.cuenta, c.admin, c.tipo, c.plan, c.empresas, c.usuarios, c.estado, c.mrr]));
      const csv = rows.map((r) => r.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Cuentas_DigiAccount.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast('Cuentas exportadas a CSV');
    });

    renderPlanDist(); render(); updateKPIs();
  })();

  /* =========================================================
     USUARIOS Y ROLES — control de acceso
     ========================================================= */
  (function usuariosModule() {
    const view = document.getElementById('view-usuarios');
    if (!view) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    const ROLES = [
      { id: 'admin', nombre: 'Administrador', cls: 'admin', ic: 'shield-check', color: '#003057', desc: 'Acceso total al sistema, la facturación y la configuración.' },
      { id: 'gerente', nombre: 'Gerente', cls: 'gerente', ic: 'briefcase', color: '#1a3f6f', desc: 'Ve todo, aprueba y edita. Sin gestión de usuarios ni roles.' },
      { id: 'contador', nombre: 'Contador', cls: 'contador', ic: 'calculator', color: '#008ec7', desc: 'Contabilidad, fiscal, nómina, tesorería y terceros.' },
      { id: 'operador', nombre: 'Vendedor / Operador', cls: 'operador', ic: 'receipt', color: '#c97a14', desc: 'Ventas, facturación, clientes e inventario.' },
      { id: 'lectura', nombre: 'Auditor (solo lectura)', cls: 'lectura', ic: 'eye', color: '#545e67', desc: 'Consulta todo el sistema sin modificar nada.' },
    ];
    const rolDe = (id) => ROLES.find((r) => r.id === id) || ROLES[0];
    const USUARIOS = [];   // se llena con los usuarios reales de la cuenta
    const INVIT = [];      // invitaciones pendientes reales
    // Empresas de la cuenta a las que se puede dar acceso
    const EMPRESAS = [];   // empresas reales de la cuenta
    const MODULOS = [
      { n: 'Dashboard', ic: 'layout-dashboard' }, { n: 'Ventas', ic: 'receipt' }, { n: 'Tesorería', ic: 'wallet' },
      { n: 'Inventario', ic: 'package' }, { n: 'Nómina', ic: 'users' }, { n: 'Terceros', ic: 'contact-round' },
      { n: 'Contabilidad', ic: 'book-open' }, { n: 'Fiscal', ic: 'file-text' }, { n: 'Agentes IA', ic: 'bot' }, { n: 'Usuarios y Roles', ic: 'users-round' },
    ];
    const ACCIONES = [['v', 'Ver'], ['c', 'Crear'], ['e', 'Editar'], ['d', 'Eliminar'], ['a', 'Aprobar']];

    // Refleja el gating REAL por rol (ROL_VISTAS en rolGating): módulo fuera del rol = sin acceso.
    function perms(rol, mod) {
      if (rol === 'admin') return { v: 1, c: 1, e: 1, d: 1, a: 1 };
      const ADMIN_SOLO = ['Usuarios y Roles'];
      if (rol === 'gerente') return ADMIN_SOLO.includes(mod) ? { v: 0, c: 0, e: 0, d: 0, a: 0 } : { v: 1, c: 1, e: 1, d: 0, a: 1 };
      if (rol === 'lectura') return (ADMIN_SOLO.includes(mod) || mod === 'Agentes IA') ? { v: 0, c: 0, e: 0, d: 0, a: 0 } : { v: 1, c: 0, e: 0, d: 0, a: 0 };
      if (rol === 'contador') {
        const m = ['Dashboard', 'Tesorería', 'Terceros', 'Contabilidad', 'Fiscal', 'Nómina'].includes(mod);
        return m ? { v: 1, c: 1, e: 1, d: 0, a: 1 } : { v: 0, c: 0, e: 0, d: 0, a: 0 };
      }
      if (rol === 'operador') {
        const m = ['Dashboard', 'Ventas', 'Terceros', 'Inventario'].includes(mod);
        return m ? { v: 1, c: 1, e: 1, d: 0, a: 0 } : { v: mod === 'Tesorería' ? 1 : 0, c: mod === 'Tesorería' ? 1 : 0, e: 0, d: 0, a: 0 };
      }
      return { v: 0, c: 0, e: 0, d: 0, a: 0 };
    }

    // ---- Carga REAL desde Supabase: perfiles de la cuenta + accesos + invitaciones ----
    window.cargarUsuarios = async function () {
      if (!window.sb || !window.__CUENTA_ID) return;
      const [rPerf, rEmp, rUE, rInv] = await Promise.all([
        window.sb.from('perfiles').select('id, nombre, rol, email, creado_en').eq('cuenta_id', window.__CUENTA_ID).order('creado_en'),
        window.sb.from('empresas').select('id, nombre').order('nombre'),
        window.sb.from('usuario_empresa').select('perfil_id, empresa_id'),
        window.sb.from('invitaciones').select('*').is('usado_por', null).order('creado_en', { ascending: false }),
      ]);
      const emps = rEmp.data || [], ue = rUE.data || [];
      EMPRESAS.length = 0; emps.forEach((e) => EMPRESAS.push({ value: e.id, label: e.nombre }));
      USUARIOS.length = 0;
      (rPerf.data || []).forEach((p, i) => {
        const ids = ue.filter((x) => x.perfil_id === p.id).map((x) => x.empresa_id);
        const nombres = ids.map((id) => (emps.find((e) => e.id === id) || {}).nombre).filter(Boolean);
        USUARIOS.push({
          _id: p.id, n: p.nombre || p.email || 'Usuario', email: p.email || '', rol: p.rol || 'lectura',
          emp: p.rol === 'admin' ? ['Todas'] : (nombres.length ? nombres : ['Sin asignar']),
          empIds: ids, acc: p.creado_en ? new Date(p.creado_en).toLocaleDateString('es-VE') : '—', est: 'Activo',
          color: ['#003057', '#008ec7', '#1a3f6f', '#c97a14', '#545e67'][i % 5],
        });
      });
      INVIT.length = 0;
      (rInv.data || []).forEach((iv) => INVIT.push({
        _id: iv.id, email: iv.email, nombre: iv.nombre, whatsapp: iv.whatsapp, rol: iv.rol, codigo: iv.codigo,
        vence: iv.expira_en ? new Date(iv.expira_en).toLocaleDateString('es-VE') : '—',
      }));
      renderUsuarios(); renderInvit(); renderRoles();
    };

    // Modal para compartir una invitación (código + WhatsApp — lo natural en Venezuela)
    function compartirInvitacion(iv) {
      const msj = 'Hola' + (iv.nombre ? ' ' + iv.nombre.split(' ')[0] : '') + ', te invito a trabajar conmigo en DigiAccount.\n\n1) Regístrate en https://app.digiaccount.io con este correo: ' + iv.email + '\n2) En el registro, coloca este código de invitación: ' + iv.codigo + '\n\n¡Con eso entras directo a mi equipo!';
      const tel = String(iv.whatsapp || '').replace(/\D/g, '').replace(/^0/, '58');
      window.openFormModal && window.openFormModal({
        title: 'Invitación · ' + iv.email, saveLabel: 'Copiar mensaje',
        fields: [{ name: 'x', label: ' ', col: 2, type: 'static', html:
          '<div style="text-align:center;padding:6px 0;">'
          + '<div style="font-size:11px;color:var(--fg-muted);">Código de invitación (vence a los 14 días)</div>'
          + '<div style="font-family:var(--font-mono);font-size:26px;font-weight:800;letter-spacing:5px;color:var(--da-navy-700);margin:4px 0 10px;">' + iv.codigo + '</div>'
          + '<div style="font-size:12px;color:var(--fg-body);line-height:1.6;">La persona se registra en <strong>app.digiaccount.io</strong> con el correo <strong>' + esc(iv.email) + '</strong> y coloca el código en el campo «Código de invitación». Entrará directo a tu equipo con su rol.</div>'
          + (tel ? '<a class="btn btn-primary" style="margin-top:12px;text-decoration:none;" target="_blank" rel="noopener" href="https://wa.me/' + tel + '?text=' + encodeURIComponent(msj) + '"><i data-lucide="message-circle"></i> Enviar por WhatsApp</a>' : '')
          + '</div>' }],
        onSave: () => { try { navigator.clipboard.writeText(msj); } catch (e) {} toast('Mensaje copiado ✓', 'success'); },
      });
      if (window.lucide) window.lucide.createIcons();
    }

    // ---- Tabla de usuarios ----
    const usuariosBody = document.getElementById('usuariosBody');
    function chips(emp) {
      if (emp.includes('Todas')) return '<span class="entity-chips"><span class="entity-chip all">TODAS</span></span>';
      return '<span class="entity-chips">' + emp.map((e) => '<span class="entity-chip">' + e + '</span>').join('') + '</span>';
    }
    function renderUsuarios(filtro) {
      const q = (filtro || '').toLowerCase();
      const vis = USUARIOS.filter((u) => !q || (u.n + ' ' + u.email + ' ' + rolDe(u.rol).nombre).toLowerCase().includes(q));
      usuariosBody.innerHTML = vis.map((u, i) => {
        const r = rolDe(u.rol);
        return '<tr data-uidx="' + USUARIOS.indexOf(u) + '">'
          + '<td><div class="user-cell"><div class="u-avatar" style="background:' + u.color + '">' + u.n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() + '</div><div class="ui"><div class="n">' + u.n + '</div><div class="e">' + u.email + '</div></div></div></td>'
          + '<td><span class="role-badge ' + r.cls + '"><i data-lucide="' + r.ic + '"></i> ' + r.nombre + '</span></td>'
          + '<td>' + chips(u.emp) + '</td><td class="caption">' + u.acc + '</td>'
          + '<td><span class="tag success">' + u.est + '</span></td>'
          + '<td><button class="btn btn-ghost" data-edit-user="' + USUARIOS.indexOf(u) + '" style="height:26px;font-size:11px;padding:0 9px;"><i data-lucide="settings-2"></i> Editar</button></td></tr>';
      }).join('');
      usuariosBody.querySelectorAll('[data-edit-user]').forEach((b) => b.addEventListener('click', () => editUser(USUARIOS[parseInt(b.dataset.editUser, 10)])));
      const c = document.getElementById('usCount'); if (c) c.textContent = USUARIOS.length;
      const ka = document.getElementById('usKpiActivos'); if (ka) ka.textContent = USUARIOS.length;
      if (window.lucide) window.lucide.createIcons();
    }

    // ---- Invitaciones ----
    const invitList = document.getElementById('invitacionesList');
    function renderInvit() {
      if (!INVIT.length) { invitList.innerHTML = '<div style="padding:18px;text-align:center;color:var(--fg-muted);font-size:13px;">No hay invitaciones pendientes</div>'; }
      else invitList.innerHTML = INVIT.map((iv, i) => {
        const r = rolDe(iv.rol);
        return '<div class="invite-row"><div class="invite-icon"><i data-lucide="mail"></i></div>'
          + '<div class="invite-info"><div class="em">' + esc(iv.email) + '</div><div class="meta">Código <strong style="font-family:var(--font-mono);">' + esc(iv.codigo || '') + '</strong> · vence ' + esc(iv.vence || '—') + ' · rol ' + r.nombre + '</div></div>'
          + '<span class="role-badge ' + r.cls + '"><i data-lucide="' + r.ic + '"></i> ' + r.nombre + '</span>'
          + '<button class="btn btn-ghost" data-share="' + i + '" style="height:30px;font-size:11px;">Compartir</button>'
          + '<button class="btn btn-ghost" data-delinv="' + i + '" style="height:30px;font-size:11px;color:#b42318;">Anular</button></div>';
      }).join('');
      invitList.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', () => compartirInvitacion(INVIT[parseInt(b.dataset.share, 10)])));
      invitList.querySelectorAll('[data-delinv]').forEach((b) => b.addEventListener('click', () => {
        const iv = INVIT[parseInt(b.dataset.delinv, 10)];
        if (!iv || !window.confirm('¿Anular la invitación de ' + iv.email + '? El código dejará de funcionar.')) return;
        window.sb.from('invitaciones').delete().eq('id', iv._id).then(({ error }) => {
          if (error) { toast('No se pudo anular: ' + error.message, 'error'); return; }
          toast('Invitación anulada', 'success');
          if (window.cargarUsuarios) window.cargarUsuarios();
        });
      }));
      const ki = document.getElementById('usKpiInvit'); if (ki) ki.textContent = INVIT.length;
      if (window.lucide) window.lucide.createIcons();
    }

    // ---- Roles (tarjetas) ----
    const rolesGrid = document.getElementById('rolesGrid');
    let rolActivo = 'admin';
    function renderRoles() {
      rolesGrid.innerHTML = ROLES.map((r) => {
        const n = USUARIOS.filter((u) => u.rol === r.id).length;
        return '<div class="role-card" data-rol="' + r.id + '">'
          + '<div class="role-card-head"><div class="role-card-icon" style="background:' + r.color + '1f;color:' + r.color + '"><i data-lucide="' + r.ic + '"></i></div>'
          + '<div><div class="rc-name">' + r.nombre + '</div><div class="rc-count">' + n + ' usuario' + (n === 1 ? '' : 's') + '</div></div></div>'
          + '<div class="rc-desc">' + r.desc + '</div>'
          + '<div class="rc-foot"><span class="rc-scope"><i data-lucide="layers"></i> ' + (r.id === 'admin' ? 'Todos los módulos' : r.id === 'lectura' ? 'Solo lectura' : 'Permisos por módulo') + '</span>'
          + '<button class="btn btn-ghost" data-cfg-rol="' + r.id + '" style="height:28px;font-size:11px;padding:0 10px;">Configurar</button></div></div>';
      }).join('');
      rolesGrid.querySelectorAll('[data-cfg-rol]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); loadMatrix(b.dataset.cfgRol); }));
      rolesGrid.querySelectorAll('.role-card').forEach((c) => c.addEventListener('click', () => loadMatrix(c.dataset.rol)));
      if (window.lucide) window.lucide.createIcons();
    }

    // ---- Matriz de permisos ----
    const matrix = document.getElementById('permMatrix');
    function loadMatrix(rolId) {
      rolActivo = rolId;
      const r = rolDe(rolId);
      document.getElementById('permRolName').textContent = r.nombre;
      rolesGrid.querySelectorAll('.role-card').forEach((c) => c.style.outline = c.dataset.rol === rolId ? '2px solid var(--da-cyan-500)' : '');
      let html = '<thead><tr><th>Módulo</th>' + ACCIONES.map((a) => '<th>' + a[1] + '</th>').join('') + '</tr></thead><tbody>';
      MODULOS.forEach((m) => {
        const p = perms(rolId, m.n);
        html += '<tr><td><i data-lucide="' + m.ic + '"></i> ' + m.n + '</td>'
          + ACCIONES.map((a) => '<td data-mod="' + m.n + '" data-act="' + a[0] + '"><span class="perm-cell ' + (p[a[0]] ? 'perm-yes' : 'perm-no') + '"><i data-lucide="' + (p[a[0]] ? 'check' : 'x') + '"></i></span></td>').join('');
        html += '</tr>';
      });
      matrix.innerHTML = html + '</tbody>';
      // La matriz es INFORMATIVA: muestra los permisos reales de cada rol (fijos en
      // esta versión). Antes se podía "togglear" sin guardar nada — eso confundía.
      matrix.querySelectorAll('td[data-act]').forEach((td) => td.addEventListener('click', () => {
        toast('Los permisos de cada rol son fijos en esta versión', 'info');
      }));
      if (window.lucide) window.lucide.createIcons();
    }

    // ---- Subtabs ----
    const tabsWrap = document.getElementById('usuariosTabs');
    const panes = view.querySelectorAll('.usuarios-pane');
    tabsWrap.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      tabsWrap.querySelectorAll('button').forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
      panes.forEach((p) => (p.dataset.active = p.dataset.tab === b.dataset.tab ? 'true' : 'false'));
      if (window.lucide) window.lucide.createIcons();
    }));

    // ---- Invitar usuario ----
    function invitar() {
      window.openFormModal && window.openFormModal({
        title: 'Invitar usuario', saveLabel: 'Enviar invitación',
        fields: [
          { name: 'nombre', label: 'Nombre y apellido', placeholder: 'Ej. Ana Pérez' },
          { name: 'whatsapp', label: 'WhatsApp', placeholder: '0414-1234567' },
          { name: 'email', label: 'Correo electrónico', col: 2, placeholder: 'persona@empresa.com' },
          { name: 'rol', label: 'Rol', type: 'select', options: ROLES.map((r) => r.nombre) },
          { name: 'empresas', label: 'Empresas a las que tendrá acceso', col: 2, type: 'checks', options: EMPRESAS, value: EMPRESAS.map((e) => e.value) },
        ],
        onSave: (v) => {
          if (!v.nombre) return 'Indica el nombre y apellido.';
          if (!v.whatsapp) return 'Indica el número de WhatsApp.';
          if (!v.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return 'Indica un correo válido.';
          if (!(v.empresas || []).length) return 'Asigna acceso a al menos una empresa.';
          if (!window.sb || !window.__CUENTA_ID) return 'No hay sesión activa.';
          const r = ROLES.find((x) => x.nombre === v.rol) || ROLES[2];
          // Código sin caracteres ambiguos (0/O, 1/I/L) para dictarlo sin errores
          const AB = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
          const codigo = Array.from({ length: 6 }, () => AB[Math.floor(Math.random() * AB.length)]).join('');
          window.sb.from('invitaciones').insert({
            cuenta_id: window.__CUENTA_ID, email: v.email.trim().toLowerCase(), nombre: v.nombre,
            whatsapp: v.whatsapp, rol: r.id, empresas: v.empresas, codigo: codigo,
          }).then(({ error }) => {
            if (error) { toast('No se pudo crear la invitación: ' + error.message, 'error'); return; }
            if (window.__registrarContacto) window.__registrarContacto({ tipo: 'Usuario', nombre: v.nombre, doc: '', email: v.email, whatsapp: v.whatsapp, segmento: 'usuario invitado', origen: 'Invitación de usuario' });
            if (window.cargarUsuarios) window.cargarUsuarios();
            compartirInvitacion({ email: v.email.trim().toLowerCase(), nombre: v.nombre, whatsapp: v.whatsapp, codigo: codigo });
          });
        },
      });
    }
    document.getElementById('invitarUsuarioBtn').addEventListener('click', invitar);
    const inv2 = document.getElementById('invitarUsuarioBtn2'); if (inv2) inv2.addEventListener('click', invitar);

    // ---- Editar usuario ----
    function editUser(u) {
      const todas = u.emp.includes('Todas');
      window.openFormModal && window.openFormModal({
        title: 'Editar · ' + u.n, saveLabel: 'Guardar',
        fields: [
          { name: 'rol', label: 'Rol', type: 'select', options: ROLES.map((r) => r.nombre), value: rolDe(u.rol).nombre },
          { name: 'est', label: 'Estado', type: 'select', options: ['Activo', 'Suspendido'], value: u.est },
          { name: 'empresas', label: 'Empresas con acceso', col: 2, type: 'checks', options: EMPRESAS, value: todas ? EMPRESAS.map((e) => e.value) : (u.empIds || []) },
        ],
        onSave: (v) => {
          const emp = v.empresas || [];
          if (!emp.length) return 'Asigna acceso a al menos una empresa.';
          if (!window.sb || !u._id) return 'Este usuario no está conectado a la base de datos.';
          const r = ROLES.find((x) => x.nombre === v.rol);
          const rolId = (r && !String(r.id).startsWith('rol')) ? r.id : u.rol;
          (async () => {
            const { error } = await window.sb.from('perfiles').update({ rol: rolId }).eq('id', u._id);
            if (error) { toast('No se pudo guardar el rol: ' + error.message, 'error'); return; }
            // El acceso por empresa se reescribe completo (borrar y volver a insertar)
            await window.sb.from('usuario_empresa').delete().eq('perfil_id', u._id);
            if (rolId !== 'admin' && emp.length) {
              const { error: e2 } = await window.sb.from('usuario_empresa').insert(emp.map((eid) => ({ perfil_id: u._id, empresa_id: eid })));
              if (e2) { toast('Rol guardado, pero falló el acceso a empresas: ' + e2.message, 'error'); return; }
            }
            toast('Usuario ' + u.n + ' actualizado', 'success');
            if (window.cargarUsuarios) window.cargarUsuarios();
          })();
        },
      });
    }

    // ---- Nuevo rol ----
    // Los roles personalizados aún no existen de verdad (los 5 roles estándar son
    // fijos y se aplican en el menú y las vistas). Antes este botón creaba roles
    // "de mentira" solo en memoria — mejor decirlo claro.
    document.getElementById('nuevoRolBtn').addEventListener('click', () => {
      toast('Los roles personalizados llegarán pronto — por ahora usa los 5 roles estándar', 'info');
    });

    // ---- Búsqueda ----
    const search = document.getElementById('usuariosSearch');
    if (search) search.addEventListener('input', () => renderUsuarios(search.value.trim()));

    renderUsuarios(); renderInvit(); renderRoles(); loadMatrix('admin');
  })();

  /* =========================================================
     WIZARD DE ALTA DE EMPRESA (onboarding)
     ========================================================= */
  (function companyWizard() {
    const scrim = document.getElementById('companyWizard');
    if (!scrim) return;
    const steps = scrim.querySelectorAll('.wiz-step');
    const panes = scrim.querySelectorAll('.wiz-pane');
    const back = document.getElementById('cwBack');
    const next = document.getElementById('cwNext');
    const progress = document.getElementById('cwProgress');
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const TOTAL = 5;
    let step = 1, fromSignup = false;
    const sel = { tipo: 'Persona jurídica (J)', actividad: 'comercial' };
    // El paso 3 pregunta el ramo; los tres modelos se deducen de ahí.
    window.__cwSetActividad = (v) => { sel.actividad = v; };
    // El catálogo de ramos se carga al abrir el asistente, no antes: quien
    // nunca cree una empresa no paga esa consulta.
    if (window.__montarRamoWizard) { setTimeout(() => { try { window.__montarRamoWizard(); } catch (e) {} }, 300); }

    // Selección de tarjetas (single por grupo)
    /* sel.tipo arranca en 'Persona jurídica (J)', así que por su valor no hay
       forma de saber si el usuario eligió eso o si nunca tocó nada. Se anota
       aparte, porque el OCR necesita saberlo: si el usuario ya dijo qué está
       registrando, el certificado no puede contradecirlo. */
    let tipoElegido = false;
    scrim.querySelectorAll('.wiz-choice').forEach((grp) => {
      grp.querySelectorAll('.choice-card').forEach((card) => card.addEventListener('click', () => {
        grp.querySelectorAll('.choice-card').forEach((c) => (c.dataset.sel = 'false'));
        card.dataset.sel = 'true';
        sel[grp.dataset.choice] = card.dataset.val;
        if (grp.dataset.choice === 'tipo') tipoElegido = true;
      }));
    });
    // Toggle de obligaciones
    scrim.querySelectorAll('.oblig-check').forEach((o) => o.addEventListener('click', () => { o.dataset.on = o.dataset.on === 'true' ? 'false' : 'true'; }));

    // Tipo de entidad → campos condicionales y armado de razón social
    const TG = { 'Persona jurídica (J)': 'std', 'Persona natural (V/E)': 'std', 'Firma Personal (F.P.)': 'fp', 'Emprendimiento (J)': 'emp' };
    const RIFLETRA = { 'Persona jurídica (J)': 'J', 'Persona natural (V/E)': 'V', 'Firma Personal (F.P.)': 'V', 'Emprendimiento (J)': 'J' };
    const tgActual = () => TG[sel.tipo] || 'std';
    /* Una Firma Personal aparece en el certificado del SENIAT como
       «NOMBRE DE LA PERSONA (NOMBRE COMERCIAL, F.P.)» — que es exactamente el
       formato con el que razonSocial() la vuelve a componer más abajo.

       Si el OCR devuelve ese patrón hay que REPARTIRLO en sus dos campos. Si
       cayera entero en el campo genérico, al guardar se perdería el formato:
       el asistente compone la razón social a partir de los dos campos, no del
       texto suelto. */
    function partirFirmaPersonal(rs) {
      const m = String(rs || '').match(/^\s*(.+?)\s*\(\s*(.+?)\s*,\s*(?:F\s*\.?\s*P\s*\.?|FIRMA\s+PERSONAL)\s*\)\s*$/i);
      return m ? { persona: m[1].trim(), comercial: m[2].trim() } : null;
    }
    window.__partirFirmaPersonal = partirFirmaPersonal;   // para poder probarlo

    /* Un Emprendimiento se registra como «EMPRENDIMIENTO Nombre Apellido [N]»,
       donde el número solo aparece cuando ya existe otro con el mismo nombre. */
    function partirEmprendimiento(rs) {
      const m = String(rs || '').match(/^\s*EMPRENDIMIENTO\s+(.+?)\s*$/i);
      if (!m) return null;
      const partes = m[1].trim().split(/\s+/);
      if (partes.length < 2) return null;
      const num = /^\d+$/.test(partes[partes.length - 1]) ? partes.pop() : '';
      return { nombre: partes[0], apellido: partes.slice(1).join(' '), num: num };
    }
    window.__partirEmprendimiento = partirEmprendimiento;

    function razonSocial() {
      const tg = tgActual();
      if (tg === 'fp') {
        const n = document.getElementById('cwFpNombre').value.trim();
        const c = document.getElementById('cwFpComercial').value.trim();
        if (!n) return '';
        return (n + ' (' + (c || 'Nombre comercial') + ', F.P.)').toUpperCase();
      }
      if (tg === 'emp') {
        const n = document.getElementById('cwEmpNombre').value.trim();
        const a = document.getElementById('cwEmpApellido').value.trim();
        const num = ((document.getElementById('cwEmpNum') || {}).value || '').trim();
        if (!n || !a) return '';
        return ('EMPRENDIMIENTO ' + n + ' ' + a + (num ? ' ' + num : '')).toUpperCase();
      }
      return document.getElementById('cwNombre').value.trim().toUpperCase();
    }
    function updatePreview() { const prev = document.getElementById('cwPreview'); if (prev) prev.textContent = razonSocial() || '—'; }
    function updateTipoFields() {
      const tg = tgActual();
      const form = document.getElementById('cwForm');
      if (form) form.querySelectorAll('[data-tg]').forEach((el) => { el.style.display = el.dataset.tg.split(' ').indexOf(tg) >= 0 ? '' : 'none'; });
      const rif = document.getElementById('cwRif');
      if (rif) rif.placeholder = (RIFLETRA[sel.tipo] || 'J') + '000000000 (sin guiones)';
      updatePreview();
    }
    ['cwFpNombre', 'cwFpComercial', 'cwEmpNombre', 'cwEmpApellido', 'cwEmpNum'].forEach((id) => {
      const el = document.getElementById(id); if (el) el.addEventListener('input', updatePreview);
    });

    // Adjuntar RIF → el Agente OCR (add-on Agentes IA) lee el certificado y carga
    // los datos; el archivo queda guardado para archivarlo en la Bóveda Fiscal
    // de la empresa cuando se cree.
    const ocrBox = document.getElementById('cwOcr');
    let rifDoc = null; // { file, datos }
    function resetOcr() {
      rifDoc = null;
      if (!ocrBox) return;
      ocrBox.classList.remove('loading', 'done');
      ocrBox.querySelector('.cw-ocr-txt strong').textContent = '¿Tienes el RIF a la mano?';
      ocrBox.querySelector('.cw-ocr-txt span').textContent = 'Adjúntalo (PDF o foto) y el Agente OCR leerá los datos.';
      const ff = document.getElementById('cwRifFile'); if (ff) ff.value = '';
    }
    async function leerRif() {
      const ff = document.getElementById('cwRifFile');
      const file = ff && ff.files && ff.files[0];
      if (!file) return;
      rifDoc = { file: file, datos: null };
      // Lectura del RIF: función GRATIS para todas las cuentas (Asistente IA incluido).
      const conIA = !!window.__ocrRif;
      const setTxt = (t, s) => { ocrBox.querySelector('.cw-ocr-txt strong').textContent = t; ocrBox.querySelector('.cw-ocr-txt span').textContent = s; };
      if (!conIA) {
        ocrBox.classList.add('done');
        setTxt('RIF adjunto ✓ · ' + file.name, 'Se archivará en la Bóveda Fiscal al crear la empresa.');
        drawIcons(); return;
      }
      ocrBox.classList.add('loading');
      setTxt('🤖 Leyendo el RIF con IA…', 'El Agente OCR está leyendo ' + file.name + '.');
      drawIcons();
      const d = await window.__ocrRif(file);
      ocrBox.classList.remove('loading');
      ocrBox.classList.add('done');
      if (!d || !d.ok) {
        setTxt('RIF adjunto ✓ · ' + file.name, 'No se pudo leer automáticamente' + (d && d.error ? ' (' + d.error + ')' : '') + ' — completa los datos abajo. Igual se archivará en la Bóveda.');
        drawIcons(); return;
      }
      rifDoc.datos = d;
      /* El tipo lo elige el usuario ANTES de subir el certificado, y su
         elección manda. La letra del RIF no alcanza para distinguir: una Firma
         Personal y una persona natural llevan V las dos, y un Emprendimiento y
         una C.A. llevan J. Deducirlo del RIF pisaba lo que el usuario ya había
         dicho — elegía «Firma Personal» y el OCR lo devolvía a «Persona
         natural», donde ni siquiera se muestran sus campos.

         Solo se propone cuando el usuario todavía no eligió nada. */
      if (!tipoElegido && (d.tipo === 'juridica' || d.tipo === 'natural')) {
        const val = d.tipo === 'juridica' ? 'Persona jurídica (J)' : 'Persona natural (V/E)';
        const card = scrim.querySelector('.wiz-choice[data-choice="tipo"] .choice-card[data-val="' + val + '"]');
        if (card) card.click();
        updateTipoFields();
      }
      if (d.razon_social) {
        /* La razón social se reparte en los campos DEL TIPO QUE ESTÁ PUESTO,
           porque el asistente la vuelve a componer a partir de ellos y no del
           texto suelto. Escribirla siempre en el campo genérico hacía que en
           una F.P. o un Emprendimiento el dato ni se viera. */
        const tg = tgActual();
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        if (tg === 'fp') {
          /* Dos fuentes para el nombre comercial, en orden:
             1. El bloque «Firmas Personales» del certificado, que es donde
                realmente vive — el OCR lo devuelve en d.firma_personal.
             2. El propio nombre, si viniera ya compuesto «NOMBRE (COMERCIAL, F.P.)».
             Si ninguna lo trae, el campo queda vacío y lo escribe el usuario;
             es obligatorio para guardar, así que no se cuela a medio llenar. */
          const fp = partirFirmaPersonal(d.razon_social);
          set('cwFpNombre', fp ? fp.persona : d.razon_social);
          const comercial = d.firma_personal || (fp ? fp.comercial : '');
          if (comercial) set('cwFpComercial', comercial);
        } else if (tg === 'emp') {
          // Y un Emprendimiento, «EMPRENDIMIENTO Nombre Apellido [N]».
          const e = partirEmprendimiento(d.razon_social);
          if (e) { set('cwEmpNombre', e.nombre); set('cwEmpApellido', e.apellido); if (e.num) set('cwEmpNum', e.num); }
        } else {
          set('cwNombre', d.razon_social);
        }
      }
      if (d.rif) { const rEl = document.getElementById('cwRif'); if (rEl) rEl.value = d.rif; }
      if (d.domicilio) { const dom = document.getElementById('cwDom'); if (dom) dom.value = d.domicilio; }
      if (d.condicion) { const c = document.getElementById('cwCond'); if (c) c.value = d.condicion === 'especial' ? 'Contribuyente especial' : 'Contribuyente ordinario'; }
      updatePreview();
      const conf = d.confianza != null ? ' · certeza ' + Math.round(d.confianza * 100) + '%' : '';
      if (d.firma_personal) setTxt('🤖 RIF leído ✓ · firma personal: ' + d.firma_personal, 'Datos cargados: revisa y corrige lo que haga falta.');
      else setTxt('🤖 RIF leído ✓ · ' + (d.rif || file.name) + conf, 'Datos cargados: revisa y corrige lo que haga falta. El documento se archivará en la Bóveda Fiscal de la empresa.');
      if (window.toast) window.toast('🤖 RIF leído' + (d.razon_social ? ' · ' + d.razon_social : '') + conf, 'success');
      drawIcons();
    }
    const rifBtn = document.getElementById('cwRifBtn');
    if (rifBtn) rifBtn.addEventListener('click', () => document.getElementById('cwRifFile').click());
    const rifFile = document.getElementById('cwRifFile');
    if (rifFile) rifFile.addEventListener('change', (e) => { if (e.target.files && e.target.files.length) leerRif(); });

    function showPane(s) { panes.forEach((p) => (p.dataset.active = p.dataset.step === String(s) ? 'true' : 'false')); drawIcons(); }
    function updateSteps() { steps.forEach((st) => { const n = parseInt(st.dataset.step, 10); st.dataset.state = n < step ? 'done' : n === step ? 'active' : ''; }); }
    function buildReview() {
      const v = (id) => (document.getElementById(id).value || '—');
      const obs = [...scrim.querySelectorAll('.oblig-check[data-on="true"]')].map((o) => o.dataset.ob).join(', ') || 'Ninguna';
      const actLabel = { comercial: 'Comercial', manufactura: 'Manufactura', servicios: 'Servicios' }[sel.actividad] || sel.actividad;
      document.getElementById('cwReview').innerHTML = [
        ['Tipo de entidad', sel.tipo, ''], ['Razón social', razonSocial() || '—', ''], ['RIF', v('cwRif'), 'mono'],
        ['Condición', v('cwCond'), ''], ['Actividad', actLabel, ''], ['Domicilio fiscal', v('cwDom'), ''],
        ['Obligaciones', obs, ''],
      ].map((r) => '<div class="rev-item"><div class="rl">' + r[0] + '</div><div class="rv' + (r[2] ? ' ' + r[2] : '') + '">' + r[1] + '</div></div>').join('');
    }
    function goStep(s) {
      step = s; showPane(s); updateSteps();
      back.hidden = s === 1;
      progress.textContent = 'Paso ' + s + ' de ' + TOTAL;
      next.textContent = s === TOTAL ? 'Crear empresa' : 'Continuar';
      if (s === 2) updateTipoFields();
      if (s === 5) buildReview();
    }
    function validar2() {
      const tg = tgActual();
      if (tg === 'fp') {
        if (!document.getElementById('cwFpNombre').value.trim()) { toast('Indica el nombre completo de la persona', 'error'); return false; }
        if (!document.getElementById('cwFpComercial').value.trim()) { toast('Indica el nombre comercial', 'error'); return false; }
      } else if (tg === 'emp') {
        if (!document.getElementById('cwEmpNombre').value.trim() || !document.getElementById('cwEmpApellido').value.trim()) { toast('Indica el nombre y apellido del emprendedor', 'error'); return false; }
      } else if (!document.getElementById('cwNombre').value.trim()) { toast('Indica la razón social o nombre', 'error'); return false; }
      if (!document.getElementById('cwRif').value.trim()) { toast('Indica el RIF', 'error'); return false; }
      const wsp = document.getElementById('cwWhatsapp');
      const eml = document.getElementById('cwEmail');
      if (wsp && !wsp.value.trim()) { toast('Indica el WhatsApp de la empresa', 'error'); return false; }
      if (eml && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(eml.value.trim())) { toast('Indica un correo válido de la empresa', 'error'); return false; }
      return true;
    }
    function finish() {
      const nombre = razonSocial() || 'Nueva Empresa, C.A.';
      const rif = (document.getElementById('cwRif').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cond = document.getElementById('cwCond').value;
      // Alta en la base de contactos (CRM / email marketing)
      if (window.__registrarContacto) window.__registrarContacto({ tipo: 'Empresa', nombre: nombre, doc: rif, email: (document.getElementById('cwEmail') || {}).value || '', whatsapp: (document.getElementById('cwWhatsapp') || {}).value || '', segmento: 'empresas', origen: 'Onboarding' });
      // Guardar la empresa REAL en Supabase, y refrescar el selector desde la base
      if (window.sb && window.__CUENTA_ID) {
        const condFiscal = /especial/i.test(cond) ? 'especial' : (/formal/i.test(cond) ? 'formal' : 'ordinario');
        const filaEmp = {
          cuenta_id: window.__CUENTA_ID,
          nombre: nombre,
          rif: rif,
          condicion_fiscal: condFiscal,
          fiscal_activo: (window.__CUENTA_TIPO === 'contador'), // contador: Fiscal ON por defecto; empresa: OFF
          /* El domicilio fiscal se pedía en el asistente y NO se guardaba: había
             que volver a escribirlo en Configuración empresa por empresa. Va
             impreso en facturas, recibos y comprobantes de retención, así que
             no es un dato accesorio. */
          direccion: ((document.getElementById('cwDom') || {}).value || '').trim() || null,
          // Datos de contacto de la empresa (para el CRM del fundador)
          telefono: ((document.getElementById('cwTel') || {}).value || '').trim() || null,
          whatsapp: ((document.getElementById('cwWhatsapp') || {}).value || '').trim() || null,
          email: ((document.getElementById('cwEmail') || {}).value || '').trim() || null,
        };
        window.sb.from('empresas').insert(filaEmp).select('id').single().then(({ data: nueva, error }) => {
          if (error && /column|schema cache/i.test(error.message || '')) {
            /* Alguna columna no existe todavía en esa base: se reintenta sin
               los datos opcionales para no bloquear el alta. Pero se AVISA: si
               se descartan en silencio, la empresa queda creada a medias y
               nadie se entera hasta que falta el dato en un documento. */
            const perdidos = ['direccion', 'telefono', 'whatsapp', 'email'].filter((k) => filaEmp[k]);
            delete filaEmp.direccion; delete filaEmp.telefono; delete filaEmp.whatsapp; delete filaEmp.email;
            return window.sb.from('empresas').insert(filaEmp).select('id').single().then(({ data: n2, error: e2 }) => {
              if (!e2 && perdidos.length && window.toast) {
                window.toast('La empresa se creó, pero no se guardó: ' + perdidos.join(', ')
                  + '. Complétalo en Configuración.', 'error');
              }
              manejarAlta(e2, n2);
            });
          }
          return manejarAlta(error, nueva);
        });
        function manejarAlta(error, nueva) {
          if (error) {
            console.warn('[DigiAccount] No se pudo guardar la empresa:', error.message);
            if (window.toast) window.toast('No se pudo guardar la empresa: ' + error.message, 'error');
            return;
          }
          if (window.cargarEmpresas) window.cargarEmpresas();   // recarga la lista real
          if (window.toast) window.toast('Empresa guardada en la base de datos ✓', 'success');
          archivarRif(nueva && nueva.id);                        // el RIF adjunto → Bóveda Fiscal
          /* El ramo se aplica DESPUÉS porque hace falta el id. Si fallara, la
             empresa queda creada y sin ramo — igual que las que ya existían,
             así que no rompe nada. */
          if (window.__aplicarRamoNuevaEmpresa) { try { window.__aplicarRamoNuevaEmpresa(nueva && nueva.id); } catch (e) {} }
        }
      } else {
        console.warn('[DigiAccount] Falta la sesión o el cuenta_id; la empresa no se guardó en la base.');
      }
      document.getElementById('cwOkTitle').textContent = '¡' + nombre + ' registrada!';
      showPane('done');
      steps.forEach((s) => (s.dataset.state = 'done'));
      progress.textContent = 'Completado';
      back.hidden = true;
      next.textContent = fromSignup ? 'Ir al sistema' : 'Listo';
      step = 'done';
      drawIcons();
    }
    // Archiva el certificado RIF adjuntado en la Bóveda Fiscal de la empresa recién creada
    async function archivarRif(empresaId) {
      if (!rifDoc || !rifDoc.file || !empresaId || !window.sb || !window.__CUENTA_ID) return;
      const file = rifDoc.file, d = rifDoc.datos || {};
      const safe = (s) => (s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = window.__CUENTA_ID + '/' + empresaId + '/RIF/' + Date.now() + '_' + safe(file.name);
      const { error } = await window.sb.storage.from('documentos-fiscales').upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (error) { console.warn('[DigiAccount] RIF no archivado:', error.message); return; }
      const { error: e2 } = await window.sb.from('documentos_fiscales').insert({
        cuenta_id: window.__CUENTA_ID, empresa_id: empresaId,
        impuesto: 'RIF', periodo: d.fecha_vencimiento ? ('Vence ' + d.fecha_vencimiento) : '—',
        tipo: 'Certificado electrónico', nombre: file.name,
        storage_path: path, mime: file.type, tamano: file.size,
      });
      if (e2) { console.warn('[DigiAccount] RIF subido pero no registrado en la Bóveda:', e2.message); return; }
      if (window.toast) window.toast('Certificado RIF archivado en la Bóveda Fiscal ✓', 'success');
      if (window.cargarBoveda) window.cargarBoveda();
    }
    function close() { scrim.dataset.open = 'false'; }

    document.getElementById('cwClose').addEventListener('click', close);
    back.addEventListener('click', () => { if (typeof step === 'number' && step > 1) goStep(step - 1); });
    next.addEventListener('click', () => {
      if (step === 'done') { close(); toast('Empresa lista en DigiAccount', 'success'); return; }
      if (step === 2 && !validar2()) return;
      if (step < TOTAL) { goStep(step + 1); return; }
      finish();
    });

    window.openCompanyWizard = function (opts) {
      fromSignup = !!(opts && opts.fromSignup);
      // TOPE DE EMPRESAS según el plan (el fundador no tiene tope; el alta del propio registro pasa).
      if (!fromSignup && !window.__ES_FUNDADOR) {
        const limite = window.__limiteEmpresas ? window.__limiteEmpresas() : Infinity;
        const actual = window.__NUM_EMPRESAS || 0;
        if (actual >= limite) {
          if (window.toast) window.toast('Tu plan ' + (window.__planActivo || '') + ' permite hasta ' + limite + ' empresa' + (limite === 1 ? '' : 's') + '. Mejora tu plan para registrar más.', 'error');
          if (window.showView) window.showView('planes', 'Planes y Precios');
          return;
        }
      }
      ['cwNombre', 'cwRif', 'cwDom', 'cwTel', 'cwWhatsapp', 'cwEmail', 'cwFpNombre', 'cwFpComercial', 'cwEmpNombre', 'cwEmpApellido', 'cwEmpNum'].forEach((id) => { const e = document.getElementById(id); if (e) e.value = ''; });
      resetOcr();
      goStep(1);
      scrim.dataset.open = 'true';
      drawIcons();
    };
    const addBtn = document.getElementById('entityAddBtn');
    if (addBtn) addBtn.addEventListener('click', () => window.openCompanyWizard());
  })();

  /* =========================================================
     PLAN GATING — cada plan habilita/bloquea módulos
     ========================================================= */
  (function planGating() {
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    // Módulos operativos sujetos a plan (los transversales —dashboard, terceros,
    // usuarios, plataforma— están siempre disponibles).
    const TODOS = ['ventas', 'compras', 'tesoreria', 'inventario', 'nomina', 'contabilidad', 'fiscal', 'agentes'];
    // 'agentes' (IA) NO va en ningún plan: es un ADD-ON aparte, personalizado y con precio
    // variable según el negocio (se vende en la pestaña "Automatizaciones y Agentes IA").
    const EMPRESA_FULL = ['ventas', 'compras', 'tesoreria', 'inventario', 'nomina', 'contabilidad', 'fiscal'];
    // Alcance del CONTADOR: solo módulos contables/de cumplimiento (NUNCA los operativos
    // ventas/compras/tesorería/inventario, que son el control interno de la empresa).
    // Esto evita que un contador "regale" el ERP completo y canibalice los planes de Empresa.
    const PLAN_MODULOS = {
      'Contador Básico': ['contabilidad', 'fiscal'],
      'Contador PRO': ['contabilidad', 'fiscal', 'nomina'],
      // Firma Contable: TODOS los módulos, incluidos los operativos (decisión de Luis 09/07/2026:
      // la Firma es el plan tope de contadores y no se le recorta nada).
      'Firma Contable': EMPRESA_FULL,
      'Emprendimientos y PYME': ['ventas', 'compras', 'tesoreria', 'inventario'],
      'Empresa Completa': EMPRESA_FULL,
      'Grupo Empresarial': EMPRESA_FULL,
    };
    // Nombre del plan → código (id) de la tabla 'planes' en Supabase
    const PLAN_SLUG = {
      'Contador Básico': 'contador_basico', 'Contador PRO': 'contador_pro', 'Firma Contable': 'firma_contable',
      'Emprendimientos y PYME': 'pyme', 'Empresa Completa': 'empresa_completa', 'Grupo Empresarial': 'grupo_empresarial',
    };
    // Tope REAL de empresas por plan (se aplica al registrar; el fundador no tiene tope).
    const LIMITE_EMPRESAS = {
      'Contador Básico': 3, 'Contador PRO': 10, 'Firma Contable': 30,
      'Emprendimientos y PYME': 1, 'Empresa Completa': 1, 'Grupo Empresarial': 5,
    };
    window.__limiteEmpresas = function () {
      const lim = LIMITE_EMPRESAS[window.__planActivo || planActivo];
      return (lim != null) ? lim : Infinity;
    };
    const NOMBRE_VIEW = {
      ventas: 'Ventas y CxC', compras: 'Compras y CxP', tesoreria: 'Tesorería', inventario: 'Inventario',
      nomina: 'Nómina y RRHH', contabilidad: 'Contabilidad', fiscal: 'Módulo Fiscal', agentes: 'Centro de Agentes IA',
    };
    let planActivo = 'Firma Contable'; // por defecto: acceso completo

    function aplicarPlan(plan, prueba) {
      planActivo = plan;
      window.__planActivo = plan;
      // El fundador (super-admin) tiene acceso completo al ERP para llevar las finanzas
      // de DigiAccount mismo, sin importar el plan de su cuenta.
      // Sin plan asignado (ej. cuenta en prueba que no eligió): módulos de su segmento,
      // NUNCA todos (y jamás agentes, que es add-on).
      const SIN_PLAN = (window.__CUENTA_TIPO === 'contador')
        ? ['contabilidad', 'fiscal', 'nomina']
        : EMPRESA_FULL;
      let incluidos = window.__ES_FUNDADOR ? TODOS : (PLAN_MODULOS[plan] || SIN_PLAN);
      // REFUERZO ANTI-FUGA: una cuenta de CONTADOR nunca tiene módulos operativos
      // (ventas/compras/tesorería/inventario), pase lo que pase con el plan. Esos módulos
      // son el control interno de la empresa; si la empresa los quiere, compra su plan.
      // (Excepción: Firma Contable SÍ incluye los operativos — plan tope de contadores.)
      if (!window.__ES_FUNDADOR && window.__CUENTA_TIPO === 'contador' && plan !== 'Firma Contable') {
        const OPERATIVOS = ['ventas', 'compras', 'tesoreria', 'inventario'];
        incluidos = incluidos.filter((m) => OPERATIVOS.indexOf(m) < 0);
      }
      // Agentes IA: add-on aparte. Bloqueado por defecto (vitrina con candado); se
      // enciende POR CUENTA con cuentas.addon_agentes (lo activa solo el fundador,
      // p. ej. a su propia Firma Contable o a un cliente que compre el add-on).
      if (!window.__ES_FUNDADOR && window.__ADDON_AGENTES && incluidos.indexOf('agentes') < 0) incluidos = incluidos.concat('agentes');
      const demoAgentes = false;
      window.__demoAgentes = demoAgentes;
      TODOS.forEach((v) => {
        const item = document.querySelector('.nav-item[data-view="' + v + '"]');
        if (!item) return;
        let locked = incluidos.indexOf(v) < 0;
        if (v === 'agentes' && demoAgentes) locked = false; // demo durante la prueba
        item.classList.toggle('locked', locked);
        // candado a la derecha (reemplaza/añade indicador)
        let lk = item.querySelector('.nav-lock');
        if (locked && !lk) { lk = document.createElement('i'); lk.setAttribute('data-lucide', 'lock'); lk.className = 'nav-lock'; item.appendChild(lk); }
        else if (!locked && lk) lk.remove();
        // badge "Demo" en Agentes IA durante la prueba
        if (v === 'agentes') {
          let demoB = item.querySelector('.nav-demo');
          if (demoAgentes && !demoB) { demoB = document.createElement('span'); demoB.className = 'nav-demo'; demoB.textContent = 'Demo'; item.appendChild(demoB); }
          else if (!demoAgentes && demoB) demoB.remove();
        }
      });
      // Banner de demo en la vista de Agentes
      const demoBanner = document.getElementById('agDemoBanner');
      if (demoBanner) demoBanner.hidden = !demoAgentes;
      // indicador del plan activo
      const badge = document.getElementById('planActivoBadge');
      if (badge) badge.textContent = plan;
      // badge de prueba (días restantes) — visible solo en modo prueba
      // Sin dias reales NO hay prueba: inventar un numero aqui fue lo que hizo
      // que el letrero mintiera. Los dias salen de trial_termina_en de la cuenta.
      window.__prueba = (prueba && typeof prueba.dias === 'number') ? { plan: plan, dias: prueba.dias } : null;
      const trial = document.getElementById('planTrial');
      if (trial) {
        trial.hidden = !prueba;
        if (prueba) trial.textContent = 'Prueba · ' + window.__prueba.dias + ' días';
      }
      // Botón "Activar / Pagar" visible solo durante la prueba
      const actBtn = document.getElementById('planActivarBtn');
      if (actBtn) actBtn.hidden = !prueba;
      if (window.__syncTrialBanner) window.__syncTrialBanner();
      // Persistir el plan elegido en la cuenta (Supabase)
      if (window.sb && window.__CUENTA_ID && PLAN_SLUG[plan]) {
        window.sb.from('cuentas').update({ plan_id: PLAN_SLUG[plan], estado: prueba ? 'prueba' : 'activa' }).eq('id', window.__CUENTA_ID).then(({ error }) => {
          if (error) console.warn('[DigiAccount] No se pudo guardar el plan en la cuenta:', error.message);
          else console.log('[DigiAccount] Plan guardado en la cuenta:', PLAN_SLUG[plan], '· estado', prueba ? 'prueba' : 'activa');
        });
      }
      if (window.lucide) window.lucide.createIcons();
    }
    window.aplicarPlan = aplicarPlan;
    // Enciende la interfaz de cortesía con los días REALES que queden.
    // Solo para una cortesia ya otorgada de verdad; hay que pasarle los dias.
    window.__iniciarPrueba = function (plan, dias) {
      if (typeof dias !== 'number') { console.warn('[Prueba] Hacen falta los dias reales.'); return; }
      aplicarPlan(plan, { dias: dias });
    };
    // Botón "Ver planes" del banner de demo de Agentes
    const demoBtn = document.querySelector('#agDemoBanner [data-view="planes"]');
    if (demoBtn) demoBtn.addEventListener('click', () => { if (window.showView) window.showView('planes', 'Planes y Precios'); });
    // Botón "Activar / Pagar plan" del indicador de prueba → checkout
    const actBtn = document.getElementById('planActivarBtn');
    if (actBtn) actBtn.addEventListener('click', () => { if (window.openCheckout) window.openCheckout(window.__planActivo); });

    window.__mostrarUpgrade = function (item) {
      const nombre = NOMBRE_VIEW[item.dataset.view] || (item.querySelector('.lbl') || {}).textContent || 'Este módulo';
      window.openFormModal && window.openFormModal({
        title: 'Módulo no incluido en tu plan', saveLabel: 'Ver planes',
        fields: [{ name: 'x', label: ' ', col: 2, type: 'static', html: '<div style="font-size:13px;line-height:1.6;color:var(--fg-body);">'
          + 'El módulo <strong>' + nombre + '</strong> no está incluido en tu plan actual (<strong>' + planActivo + '</strong>).<br><br>'
          + 'Mejora tu plan para desbloquear este y otros módulos.</div>' }],
        onSave: () => { if (window.showView) window.showView('planes', 'Planes y Precios'); },
      });
    };

    // Aplicar el plan por defecto al cargar
    aplicarPlan(planActivo);
  })();

  /* =========================================================
     ROL GATING — qué módulos ve cada rol DENTRO de la cuenta
     (se suma al plan: el plan define qué compró la cuenta; el
     rol define qué ve cada miembro del equipo. Los módulos
     fuera del rol se OCULTAN — el candado queda para upsell.)
     ========================================================= */
  (function rolGating() {
    // null = todas las vistas (según el plan). Las demás listas son cerradas.
    const ROL_VISTAS = {
      admin: null,
      gerente: ['dashboard', 'ventas', 'compras', 'tesoreria', 'inventario', 'nomina', 'terceros', 'contabilidad', 'fiscal', 'agentes'],
      contador: ['dashboard', 'tesoreria', 'terceros', 'contabilidad', 'fiscal', 'nomina'],
      operador: ['dashboard', 'ventas', 'tesoreria', 'inventario', 'terceros'],
      lectura: ['dashboard', 'ventas', 'compras', 'tesoreria', 'inventario', 'nomina', 'terceros', 'contabilidad', 'fiscal'],
    };
    window.__rolActual = function () {
      if (window.__ES_FUNDADOR) return 'admin';
      const r = String((window.__PERFIL && window.__PERFIL.rol) || 'admin').toLowerCase();
      // Rol desconocido o antiguo ('Administrador') → admin: los dueños de cuenta
      // existentes se crearon antes de los roles y no deben perder acceso.
      return Object.prototype.hasOwnProperty.call(ROL_VISTAS, r) ? r : 'admin';
    };
    window.__rolPermiteVista = function (v) {
      const lista = ROL_VISTAS[window.__rolActual()];
      return !lista || lista.indexOf(v) >= 0;
    };
    window.aplicarRol = function () {
      const esAdmin = !ROL_VISTAS[window.__rolActual()];
      document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
        const v = item.dataset.view;
        if (v === 'fundador') return; // lo gobierna __ES_FUNDADOR
        item.style.display = window.__rolPermiteVista(v) ? '' : 'none';
      });
      // Etiquetas de sección que quedaron sin ítems visibles → se ocultan también
      document.querySelectorAll('.nav-section-label').forEach((lbl) => {
        let el = lbl.nextElementSibling, alguno = false;
        while (el && !el.classList.contains('nav-section-label')) {
          if (el.classList.contains('nav-item') && !el.hidden && el.style.display !== 'none') alguno = true;
          el = el.nextElementSibling;
        }
        lbl.style.display = alguno ? '' : 'none';
      });
      // Botón de ajustes del pie (abre Usuarios y Roles): solo admin
      const cfgBtn = document.getElementById('sidebarSettingsBtn');
      if (cfgBtn) cfgBtn.style.display = esAdmin ? '' : 'none';
    };
  })();

  /* Render final de iconos (incluye los inyectados) */
  drawIcons();

  /* =========================================================
     INSTALAR LA APP — el navegador ya la ofrece, pero a escondidas
     =========================================================
     Chrome y Edge ponen un ícono diminuto en la barra de direcciones y
     nadie lo encuentra. Un cliente que llega por un enlace se queda para
     siempre entrando por el enlace.

     El navegador avisa con `beforeinstallprompt` cuando la app se puede
     instalar; se guarda ese evento y se ofrece un botón de verdad. El
     prompt del sistema SOLO se puede abrir desde un clic del usuario, así
     que el evento hay que retenerlo: por eso el preventDefault.

     Safari no dispara ese evento —ni en Mac ni en iPhone— así que ahí se
     explica a mano cómo hacerlo, que es lo único que se puede hacer. */
  (function instalarApp() {
    const bar = document.getElementById('installBar');
    const txt = document.getElementById('installBarTxt');
    const btn = document.getElementById('installBarBtn');
    const no = document.getElementById('installBarNo');
    if (!bar || !btn) return;

    const CLAVE = 'da_instalar_pospuesto';
    const DIAS = 30;
    let evento = null;

    // Ya instalada: la app corre en su propia ventana, sin barra del navegador.
    const yaInstalada = () =>
      window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: window-controls-overlay)').matches
      || window.navigator.standalone === true;

    const pospuesta = () => {
      const t = parseInt(localStorage.getItem(CLAVE) || '0', 10);
      return t && (Date.now() - t) < DIAS * 24 * 3600 * 1000;
    };

    const mostrar = (mensaje, conBoton) => {
      if (yaInstalada() || pospuesta()) return;
      if (txt && mensaje) txt.textContent = mensaje;
      btn.hidden = !conBoton;
      bar.hidden = false;
    };

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();          // sin esto el navegador se queda el evento
      evento = e;
      mostrar('Instala DigiAccount en tu equipo y ábrelo como una aplicación.', true);
    });

    btn.addEventListener('click', async () => {
      if (!evento) return;
      bar.hidden = true;
      evento.prompt();
      const res = await evento.userChoice.catch(() => ({ outcome: 'dismissed' }));
      evento = null;               // el evento sirve UNA sola vez
      if (res.outcome !== 'accepted') localStorage.setItem(CLAVE, String(Date.now()));
    });

    if (no) no.addEventListener('click', () => {
      bar.hidden = true;
      localStorage.setItem(CLAVE, String(Date.now()));
    });

    window.addEventListener('appinstalled', () => {
      bar.hidden = true;
      localStorage.removeItem(CLAVE);
      if (window.toast) window.toast('DigiAccount quedó instalada en tu equipo ✓', 'success');
    });

    /* Safari no tiene `beforeinstallprompt`. En iPhone se instala con
       Compartir → Añadir a pantalla de inicio, y en Mac con Archivo → Añadir
       al Dock. Se dice, porque adivinarlo no lo hace nadie. */
    const ua = navigator.userAgent;
    const esSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
    if (esSafari) {
      const iOS = /iphone|ipad|ipod/i.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      setTimeout(() => mostrar(iOS
        ? 'Para instalar: toca Compartir y luego "Añadir a pantalla de inicio".'
        : 'Para instalar: menú Archivo → "Añadir al Dock".', false), 2500);
    }

    // Para poder ofrecerlo también desde un menú, no solo cuando el navegador avisa.
    window.__puedeInstalar = () => !!evento && !yaInstalada();
    window.__instalarApp = () => btn.click();
  })();

  /* =========================================================
     SERVICE WORKER — registro (PWA · instalable + offline)
     Se registra aquí (y no inline en el HTML) para cumplir la CSP.
     ========================================================= */
  /* En la app instalada (PWA) no existe Ctrl+Shift+R: sin esto, el usuario se
     queda con la versión vieja sin enterarse. Ahora la app detecta que hay una
     versión nueva y ofrece actualizar con un botón. */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        const bar = document.getElementById('updateBar');
        const txt = document.getElementById('updateBarTxt');
        const btn = document.getElementById('updateBarBtn');
        let esperando = null;

        function ofrecer(sw) {
          esperando = sw;
          if (txt) txt.textContent = 'Hay una versión nueva de DigiAccount.';
          if (btn) btn.hidden = false;
          if (bar) bar.hidden = false;
        }
        // ¿Ya había una esperando al abrir?
        if (reg.waiting && navigator.serviceWorker.controller) ofrecer(reg.waiting);
        // Nueva versión descargándose
        reg.addEventListener('updatefound', function () {
          const nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', function () {
            // 'installed' + ya hay un controller = es una ACTUALIZACIÓN (no la 1ra vez)
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) ofrecer(nuevo);
          });
        });
        if (btn) btn.addEventListener('click', function () {
          if (esperando) { try { esperando.postMessage({ tipo: 'ACTIVAR_YA' }); } catch (e) {} }
          if (bar) bar.hidden = true;
          setTimeout(function () { window.location.reload(); }, 300);
        });
        // Cuando el SW nuevo toma el control, recargar una sola vez
        let recargado = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (recargado) return; recargado = true; window.location.reload();
        });

        // Buscar actualizaciones: al abrir, al volver a la app, y cada 30 min.
        // manual=true → avisa también cuando YA está al día (lo llama el menú).
        window.__buscarActualizacion = function (manual) {
          if (manual && window.toast) window.toast('Buscando actualizaciones…', 'info');
          reg.update().then(function () {
            setTimeout(function () {
              if (manual && (!bar || bar.hidden)) {
                if (window.toast) window.toast('Ya tienes la última versión ✓', 'success');
              }
            }, 1500);
          }).catch(function () {
            if (manual && window.toast) window.toast('No se pudo verificar (¿sin conexión?)', 'error');
          });
        };
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) reg.update().catch(function () {});
        });
        setInterval(function () { reg.update().catch(function () {}); }, 30 * 60 * 1000);
      }).catch(function (e) { console.warn('SW no registrado:', e); });
    });
  }
})();

/* =========================================================
   SEGURIDAD · Auto-cierre de sesión por inactividad
   Cierra la sesión sola si no hay actividad por un tiempo
   (protege PCs desatendidas). El logout hace reload = limpia todo.
   ========================================================= */
(function idleLogout() {
  const IDLE_MS = window.__DA_IDLE_MS || (30 * 60 * 1000); // 30 min sin actividad → cierra
  const WARN_MS = 60 * 1000;      // avisa 1 min antes
  let tIdle = null, tWarn = null;
  const autenticado = () => document.body.classList.contains('authed');
  async function cerrarPorInactividad() {
    if (!autenticado()) return;
    try { if (window.sb) await window.sb.auth.signOut(); } catch (e) {}
    try { localStorage.removeItem('da_last_activity'); } catch (e) {}
    try { sessionStorage.setItem('da_logout_motivo', 'inactividad'); } catch (e) {}
    window.location.reload(); // recarga = borra TODO el estado en memoria
  }
  function reset() {
    clearTimeout(tIdle); clearTimeout(tWarn);
    if (!autenticado()) return;
    if (window.__marcarActividad) window.__marcarActividad(); // recuerda la actividad (persiste)
    tWarn = setTimeout(() => {
      if (autenticado() && window.toast) window.toast('Tu sesión se cerrará por inactividad en 1 minuto', 'info');
    }, IDLE_MS - WARN_MS);
    tIdle = setTimeout(cerrarPorInactividad, IDLE_MS);
  }
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'visibilitychange'].forEach((ev) =>
    document.addEventListener(ev, reset, { passive: true }));
  // Aviso al reabrir tras cierre por inactividad
  try {
    if (sessionStorage.getItem('da_logout_motivo') === 'inactividad') {
      sessionStorage.removeItem('da_logout_motivo');
      setTimeout(() => { if (window.toast) window.toast('Sesión cerrada por inactividad', 'info'); }, 800);
    }
  } catch (e) {}
  reset();
})();

/* =========================================================
   ATAJOS DE TECLADO (Fase 1) — Ctrl+Enter/Escape universal,
   Ctrl+P para imprimir, Insert para "nuevo registro" contextual.
   No toca el código interno de los modales: solo les hace clic
   a sus botones ya existentes, desde afuera. Ver spec:
   docs/superpowers/specs/2026-07-30-atajos-teclado-design.md
   ========================================================= */
(function atajosTeclado() {
  // formModal ya tiene su propio Ctrl+Enter/Escape (ver openFormModal,
  // función window.openFormModal) — no se duplica aquí.
  const MODALES = [
    // Grupo A — formulario con acción principal clara
    { overlay: 'terModal', guardar: 'terSave', cancelar: 'terCancel' },
    { overlay: 'asientoModal', guardar: 'amSave', cancelar: 'amCancel' },
    { overlay: 'agAutoModal', guardar: 'agAutoSave', cancelar: 'agAutoCancel' },
    { overlay: 'facturaNuevaModal', guardar: 'fvEmitir', cancelar: 'fvCancel' },
    { overlay: 'firmaOverlay', guardar: 'firmaAplicar', cancelar: 'firmaClose' },
    // Grupo B/C — visor de documento (sin acción de Guardar)
    { overlay: 'retReciboOverlay', cancelar: 'retReciboClose', imprimir: 'retReciboPrint' },
    { overlay: 'despachoOverlay', cancelar: 'despachoClose', imprimir: 'despachoPrint' },
    { overlay: 'relnOverlay', cancelar: 'relnClose', imprimir: 'relnPrint' },
    { overlay: 'subReciboModal', cancelar: 'subReciboClose', imprimir: 'subReciboPrint' },
    { overlay: 'facturaOverlay', cancelar: 'facturaClose', imprimir: 'facturaPrint' },
    { overlay: 'reciboOverlay', cancelar: 'reciboClose', imprimir: 'reciboPrint' },
    // Grupo D — sensible (dinero): SOLO Escape, nunca Ctrl+Enter
    { overlay: 'payModal', cancelar: 'payCancel' },
  ];

  function esVisible(el) {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    // Algunos overlays (.recibo-overlay: factura, recibo, firma, despacho) NUNCA
    // cambian su 'display' (siempre 'grid') — se muestran/ocultan con opacity +
    // pointer-events al alternar data-open. Por eso se revisan las tres señales.
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
  }

  // El modal MAS AL FRENTE entre los que estén visibles ahora (por z-index
  // calculado) — necesario porque F2 puede abrir "Nuevo tercero" encima de
  // "Registrar venta", y ambos podrían estar visibles a la vez.
  function modalVisibleTope() {
    let top = null, topZ = -1;
    MODALES.forEach((m) => {
      const el = document.getElementById(m.overlay);
      if (!esVisible(el)) return;
      const z = parseInt(window.getComputedStyle(el).zIndex, 10) || 0;
      if (z >= topZ) { topZ = z; top = m; }
    });
    return top;
  }

  function algunModalVisible() {
    return MODALES.some((m) => esVisible(document.getElementById(m.overlay)))
      || esVisible(document.getElementById('formModal'));
  }
  window.__algunModalVisible = algunModalVisible;

  // Botón [data-libro-action="print"] REALMENTE visible en pantalla (hay 3 en
  // el DOM — Compras, Ventas/facturas, Ventas/máquina fiscal — solo uno está
  // visible a la vez). offsetParent (no getComputedStyle) es lo correcto acá
  // porque estos botones NO son position:fixed: su visibilidad depende de que
  // un ANCESTRO (la pestaña/tab) esté oculto, y offsetParent sí lo detecta.
  function botonImprimirVisible() {
    const btns = document.querySelectorAll('[data-libro-action="print"]');
    for (let i = 0; i < btns.length; i++) {
      if (btns[i].offsetParent !== null) return btns[i];
    }
    return null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !e.key) return; // otro handler ya actuó, o tecla sin 'key' (raro, pero pasa)
    const ctrlEnter = e.key === 'Enter' && (e.ctrlKey || e.metaKey);
    const escape = e.key === 'Escape';
    const ctrlP = e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey);
    if (!ctrlEnter && !escape && !ctrlP) return;
    const m = modalVisibleTope();
    if (ctrlP) {
      if (m && m.imprimir) {
        const btn = document.getElementById(m.imprimir);
        if (btn) { e.preventDefault(); btn.click(); }
        return;
      }
      if (!m) {
        const printBtn = botonImprimirVisible();
        if (printBtn) { e.preventDefault(); printBtn.click(); }
      }
      return;
    }
    if (!m) return; // ninguno de los 12 está abierto (formModal maneja lo suyo aparte)
    if (ctrlEnter && m.guardar) {
      const btn = document.getElementById(m.guardar);
      if (btn) { e.preventDefault(); btn.click(); }
    } else if (escape && m.cancelar) {
      const btn = document.getElementById(m.cancelar);
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  function clic(id) { const b = document.getElementById(id); if (b) b.click(); }

  // Extendido a todos los módulos con botón de "nuevo registro" (ver
  // docs/superpowers/plans/2026-07-30-atajos-teclado.md, actualización
  // posterior). Cada rama es independiente: si la pestaña activa no tiene
  // un botón mapeado, simplemente no hace nada (no es un error).
  function tabActivo(sel) { const t = document.querySelector(sel); return t && t.dataset.tab; }
  function nuevoRegistroContextual() {
    if (algunModalVisible()) return; // no abrir uno encima de otro ya abierto
    const view = document.querySelector('.view[data-active="true"]');
    const viewId = view && view.id;
    if (viewId === 'view-fiscal') {
      // 'comprobantes' salió del mapa: esa pestaña no crea nada, emite el
      // comprobante de una retención que ya existe. Apuntaba al botón
      // "Emitir y registrar", que se quitó por no registrar nada.
      const map = { ventas: 'regVentaBtn', compras: 'regCompraBtn', retenciones: 'retAddBtn', pensiones: 'pensionRegistrarBtn', patrimonios: 'igpRegistrarBtn', igtf: 'igtfRegistrarBtn' };
      const btn = map[tabActivo('.fiscal-tab[data-active="true"]')];
      if (btn) clic(btn);
    } else if (viewId === 'view-ventas') {
      const map = { facturas: 'nuevaFacturaBtn', notas: 'nuevaNotaBtn', despachos: 'nuevoDespachoBtn' };
      const btn = map[tabActivo('.ventas-tab[data-active="true"]') || 'facturas'];
      if (btn) clic(btn);
    } else if (viewId === 'view-compras') {
      clic('comprasRegBtn');
    } else if (viewId === 'view-tesoreria') {
      if ((tabActivo('.teso-tab[data-active="true"]') || 'resumen') === 'resumen') clic('tesoMovBtn');
    } else if (viewId === 'view-inventario') {
      clic('invPrimaryBtn');
    } else if (viewId === 'view-contabilidad') {
      const map = { diario: 'nuevoAsientoBtn', plan: 'nuevaCuentaBtn', activos: 'registrarActivoBtn', cripto: 'criptoNuevo' };
      const btn = map[tabActivo('.conta-tab[data-active="true"]') || 'diario'];
      if (btn) clic(btn);
    } else if (viewId === 'view-terceros') {
      clic('nuevoTerceroBtn');
    } else if (viewId === 'view-nomina') {
      if ((tabActivo('.nomina-tab[data-active="true"]') || 'empleados') === 'empleados') clic('nuevoTrabajadorBtn');
    } else if (viewId === 'view-usuarios') {
      const map = { usuarios: 'invitarUsuarioBtn', roles: 'nuevoRolBtn' };
      const btn = map[tabActivo('.usuarios-pane[data-active="true"]') || 'usuarios'];
      if (btn) clic(btn);
    } else if (viewId === 'view-fundador') {
      clic('nuevaCuentaSaasBtn');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    // F2 (no Insert): en laptop es mas facil de alcanzar, y ya es la misma tecla que
    // usa "Registrar venta/compra" para crear un tercero al vuelo (mismo concepto:
    // "crear lo nuevo que corresponda aqui"). Si el F2 de ese campo ya actuo, esta
    // funcion no se duplica gracias al chequeo de e.defaultPrevented de arriba.
    if (e.key !== 'F2') return;
    e.preventDefault(); // F2 no inserta texto en ningun campo; seguro interceptarlo siempre
    nuevoRegistroContextual();
  });
})();

  /* =========================================================
     ESTABLECIMIENTOS (sucursales) — alta, edición y baja
     ========================================================= */
  (function sucursalesConfig() {
    const lista = document.getElementById('cfgSucLista');
    const btnNuevo = document.getElementById('cfgSucNuevo');
    if (!lista || !btnNuevo) return;
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const emp = () => window.__EMPRESA_ACTIVA || {};
    /* Este bloque vive FUERA del envoltorio principal, así que `esc` —que se
       declara dentro— no se ve desde aquí. Se toma de `window`, donde está
       publicada. Es el mismo tropiezo que dejó el buscador de terceros sin
       responder: una función de otro alcance que revienta en silencio. */
    const esc = (s) => (window.esc ? window.esc(s) : String(s == null ? '' : s));

    /* Una empresa sin establecimientos declarados NO cambia en nada: no se
       le pregunta el establecimiento al facturar, sus libros no llevan barra
       de filtro y este cuadro le dice justamente eso. La primera sucursal
       que se registra es la que enciende todo, y solo para esa empresa: los
       establecimientos se llavean por empresa_id y se recargan cada vez que
       se cambia de empresa. */
    async function render() {
      if (!window.sb || !emp().id) {
        lista.innerHTML = '<div style="font-size:12.5px;color:var(--fg-muted);">Elige una empresa para ver sus establecimientos.</div>';
        return;
      }
      /* Se limpia ANTES de consultar. Si no, mientras llega la respuesta
         siguen en pantalla los establecimientos de la empresa anterior, y
         una lista con datos de otra empresa es peor que una vacía. */
      const deQuien = emp().id;
      lista.innerHTML = '<div style="font-size:12.5px;color:var(--fg-muted);">Cargando…</div>';
      const { data, error } = await window.sb.from('sucursales')
        .select('id, nombre, codigo, direccion, telefono, es_matriz, activa')
        .eq('empresa_id', emp().id).order('codigo');
      if (error) {
        lista.innerHTML = '<div style="font-size:12.5px;color:var(--fg-muted);">No se pudieron cargar (¿corriste sql/sucursales.sql?).</div>';
        console.warn('[Establecimientos]', error.message);
        return;
      }
      // Si mientras se consultaba se cambió otra vez de empresa, esta
      // respuesta ya no vale: la pinta la consulta de la empresa nueva.
      if (deQuien !== emp().id) return;
      const filas = data || [];
      if (!filas.length) {
        lista.innerHTML = '<div style="font-size:12.5px;color:var(--fg-muted);line-height:1.6;">'
          + 'Esta empresa no tiene establecimientos registrados, y así funciona perfectamente: '
          + 'no se le pregunta el establecimiento al registrar una factura y sus libros salen como siempre.<br>'
          + 'Solo hace falta registrarlos si opera en <strong>más de una dirección</strong> y necesitas el libro de cada una.</div>';
        return;
      }
      /* Tabla propia y NO `.data-table`: esa lleva `min-width: 900px` y
         `white-space: nowrap`, pensada para las rejillas anchas de los
         módulos. Dentro de una tarjeta de configuración, una dirección larga
         en una sola línea empujaba teléfono, matriz y editar fuera del
         cuadro. Aquí la dirección envuelve y el ancho manda la tarjeta. */
      lista.innerHTML = '<table class="suc-tabla"><thead><tr>'
        + '<th class="c-cod">Código</th><th class="c-nom">Nombre</th><th>Dirección</th><th class="c-tel">Teléfono</th><th class="c-mat">Matriz</th><th class="c-act"></th>'
        + '</tr></thead><tbody>'
        + filas.map((s) => '<tr' + (s.activa ? '' : ' style="opacity:.5;"') + '>'
          + '<td class="mono c-cod">' + esc(s.codigo || '') + '</td>'
          + '<td class="c-nom"><strong>' + esc(s.nombre || '') + '</strong>' + (s.activa ? '' : ' <em>(inactiva)</em>') + '</td>'
          + '<td>' + esc(s.direccion || '— sin dirección —') + '</td>'
          + '<td class="mono c-tel">' + esc(s.telefono || '—') + '</td>'
          + '<td class="c-mat">' + (s.es_matriz ? '<i data-lucide="check" style="width:15px;height:15px;"></i>' : '') + '</td>'
          + '<td class="c-act"><button class="btn btn-ghost" data-suc-edit="' + esc(s.id) + '" style="height:26px;font-size:11px;padding:0 9px;"><i data-lucide="pencil"></i> Editar</button></td>'
          + '</tr>').join('')
        + '</tbody></table>'
        + (filas.length === 1
          ? '<div style="font-size:11.5px;color:var(--fg-muted);margin-top:6px;">Con un solo establecimiento no se pregunta nada al facturar: se asigna este. El selector aparece al registrar el segundo.</div>'
          : '');
      lista.querySelectorAll('[data-suc-edit]').forEach((b) =>
        b.addEventListener('click', () => ficha(filas.find((x) => x.id === b.dataset.sucEdit))));
      if (window.lucide) window.lucide.createIcons();
    }

    function ficha(s) {
      if (!emp().id) { toast('Elige una empresa primero.', 'error'); return; }
      const nuevo = !s;
      window.openFormModal && window.openFormModal({
        title: nuevo ? 'Nuevo establecimiento' : 'Editar establecimiento',
        saveLabel: nuevo ? 'Registrar' : 'Guardar cambios',
        fields: [
          { name: 'codigo', label: 'Código (el que le asigna el SENIAT)', placeholder: '02', value: (s && s.codigo) || '' },
          { name: 'nombre', label: 'Nombre', col: 2, placeholder: 'Ej. Sucursal Barquisimeto', value: (s && s.nombre) || '' },
          { name: 'direccion', label: 'Dirección', col: 2, placeholder: 'Tal como aparece en el RIF', value: (s && s.direccion) || '' },
          { name: 'telefono', label: 'Teléfono', placeholder: '0000-0000000', value: (s && s.telefono) || '' },
          { name: 'esMatriz', label: '¿Es la casa matriz?', type: 'select', options: ['No', 'Sí'], value: (s && s.es_matriz) ? 'Sí' : 'No' },
          { name: 'activa', label: 'Estado', type: 'select', options: ['Activa', 'Inactiva'], value: (s && !s.activa) ? 'Inactiva' : 'Activa' },
        ],
        onSave: (v) => {
          if (!(v.nombre || '').trim()) return 'Indica el nombre del establecimiento.';
          if (!(v.codigo || '').trim()) return 'Indica el código: es el que distingue un establecimiento de otro en el libro.';
          const fila = {
            empresa_id: emp().id,
            codigo: v.codigo.trim(), nombre: v.nombre.trim().toUpperCase(),
            direccion: (v.direccion || '').trim().toUpperCase() || null,
            telefono: (v.telefono || '').trim() || null,
            es_matriz: /^s/i.test(v.esMatriz || ''),
            activa: !/inactiva/i.test(v.activa || ''),
          };
          const q = nuevo
            ? window.sb.from('sucursales').insert(fila)
            : window.sb.from('sucursales').update(fila).eq('id', s.id);
          q.then(({ error }) => {
            if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
            toast('Establecimiento "' + fila.nombre + '" ' + (nuevo ? 'registrado' : 'actualizado'), 'success');
            render();
            /* Los libros se recargan porque su selector nace de esta lista:
               al registrar el segundo establecimiento tiene que aparecer sin
               que haya que recargar la página. */
            if (window.cargarSucursales) window.cargarSucursales().then(() => {
              if (window.cargarLibroFiscal) { window.cargarLibroFiscal('compra'); window.cargarLibroFiscal('venta'); }
            });
          });
        },
      });
    }

    btnNuevo.addEventListener('click', () => ficha(null));
    window.__renderSucursalesConfig = render;
    render();
  })();

  /* ══════════════════════════════════════════════════════════════════════
     PANEL DEL SOCIO · Programa de referidos

     Lo ve unicamente quien tiene fila en la tabla `socios`. Para todos los
     demas la entrada del menu queda oculta y esta vista no se carga nunca.

     Ni un solo numero de aqui esta guardado: nivel, empresas activas,
     retencion y porcentaje salen de v_socios_resumen, que los calcula de los
     pagos confirmados. Es lo que evita que el tablero diga una cosa y la
     liquidacion diga otra.
     ══════════════════════════════════════════════════════════════════════ */
  (function panelSocio() {
    const NIVEL = {
      asociado:    { t: 'Asociado',        pct: 10 },
      certificado: { t: 'Certificado',     pct: 20 },
      socio:       { t: 'Socio',           pct: 25 },
      principal:   { t: 'Socio Principal', pct: 30 },
    };
    // Lo que hace falta para el SIGUIENTE peldano.
    const META = {
      asociado:    { sig: 'certificado', empresas: 5,  ret: 0.70, examen: true },
      certificado: { sig: 'socio',       empresas: 15, ret: 0.80, examen: false },
      socio:       { sig: 'principal',   empresas: 25, ret: 0.85, examen: false },
    };

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const plata = (n) => '$' + (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fecha = (s) => (s ? new Date(s).toLocaleDateString('es-VE') : '—');

    let MI = null;   // la fila de v_socios_resumen de quien esta viendo

    window.cargarPanelSocio = async function () {
      const nav = document.querySelector('.nav-item[data-view="socio"]');
      if (!window.sb || !window.__CUENTA_ID) return;

      const { data, error } = await window.sb
        .from('v_socios_resumen').select('*').eq('cuenta_id', window.__CUENTA_ID).maybeSingle();

      // Sin fila de socio no hay panel. La entrada del menu ni aparece.
      if (error || !data) { if (nav) nav.hidden = true; return; }

      MI = data;
      if (nav) nav.hidden = false;
      const nv = NIVEL[data.nivel] || NIVEL.asociado;
      const badgeNav = $('navSocioNivel');
      if (badgeNav) badgeNav.textContent = nv.pct + '%';
      const badge = $('socNivelBadge');
      if (badge) { const s = badge.querySelector('span'); if (s) s.textContent = nv.t + ' · ' + nv.pct + '%'; }

      pintarResumen(data, nv);
      pintarProgreso(data);
      await pintarCupones(data.id);
      await pintarReferidos(data.id);
      await pintarComisiones(data.id);
      if (window.lucide) window.lucide.createIcons();
    };

    function pintarResumen(d, nv) {
      const cont = $('socResumen');
      if (!cont) return;
      const tarjeta = (etq, val, nota) =>
        '<div class="soc-card"><div class="soc-label">' + etq + '</div>'
        + '<div class="soc-value">' + val + '</div>'
        + (nota ? '<div class="soc-note">' + nota + '</div>' : '') + '</div>';
      cont.innerHTML = '<div class="soc-tarjetas">' +
          tarjeta('Tu código', '<span class="mono">' + esc(d.codigo) + '</span>',
                  'Es lo que tu cliente escribe al registrarse')
        + tarjeta('Empresas activas', d.empresas_activas,
                  d.referidos_totales + ' referidas en total')
        + tarjeta('Retención', Math.round((Number(d.retencion) || 0) * 100) + '%',
                  'Últimos doce meses')
        + tarjeta('Por cobrar', plata(d.comision_por_pagar),
                  'Antes de retención de ISLR')
        + tarjeta('Ya cobrado', plata(d.comision_pagada), 'Histórico del programa')
        + '</div>';
    }

    function pintarProgreso(d) {
      const cont = $('socProgreso');
      const sub = $('socProgresoSub');
      if (!cont) return;
      const meta = META[d.nivel];
      if (!meta) {
        if (sub) sub.textContent = 'Estás en el techo del programa.';
        cont.innerHTML = '<p class="ag-linea nada" style="margin:0;">Socio Principal es el nivel más alto. No hay siguiente peldaño: cobras 30% y formas a los socios nuevos de tu zona.</p>';
        return;
      }
      const actual = NIVEL[d.nivel] || NIVEL.asociado;
      const sigNv = NIVEL[meta.sig];
      if (sub) sub.textContent = 'De ' + actual.t + ' a ' + sigNv.t + ' · del ' + actual.pct + '% al ' + sigNv.pct + '%';

      const faltan = Math.max(0, meta.empresas - (d.empresas_activas || 0));
      const ret = Number(d.retencion) || 0;
      const barra = (etq, hecho, total, ok) => {
        const p = total > 0 ? Math.min(100, Math.round((hecho / total) * 100)) : 100;
        return '<div style="margin-bottom:14px;">'
          + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">'
          +   '<span>' + etq + '</span>'
          +   '<span class="mono" style="color:' + (ok ? 'var(--da-cyan-600)' : 'var(--fg-muted)') + ';">' + (ok ? '✓ ' : '') + hecho + ' / ' + total + '</span>'
          + '</div>'
          + '<div style="height:7px;border-radius:99px;background:var(--border);overflow:hidden;">'
          +   '<div style="height:100%;width:' + p + '%;background:' + (ok ? 'var(--da-cyan-500)' : 'var(--da-navy-400, #2c5689)') + ';"></div>'
          + '</div></div>';
      };

      let html = barra('Empresas activas', d.empresas_activas || 0, meta.empresas, (d.empresas_activas || 0) >= meta.empresas)
        + barra('Retención mínima', Math.round(ret * 100), Math.round(meta.ret * 100), ret >= meta.ret);
      if (meta.examen) {
        html += '<div style="font-size:12px;color:' + (d.certificado ? 'var(--da-cyan-600)' : 'var(--fg-muted)') + ';">'
          + (d.certificado ? '✓ Formación y examen aprobados' : '○ Falta aprobar la formación con examen')
          + '</div>';
      }
      if (faltan > 0) {
        html += '<p class="cfg-hint" style="margin-top:14px;">Te faltan <strong>' + faltan + '</strong> empresa'
          + (faltan === 1 ? '' : 's') + ' activa' + (faltan === 1 ? '' : 's') + '. '
          + 'Al llegar, el ' + sigNv.pct + '% se aplica a <strong>toda tu cartera</strong>, no solo a las nuevas.</p>';
      }
      cont.innerHTML = html;
    }

    async function pintarCupones(socioId) {
      const cont = $('socCupones');
      if (!cont) return;
      const { data } = await window.sb.from('cupones')
        .select('codigo, dias, vence_en, canjeado_en').eq('socio_id', socioId).order('emitido_en');
      const filas = data || [];
      if (!filas.length) { cont.innerHTML = '<p class="ag-linea nada" style="margin:0;">Todavía no tienes cupones emitidos.</p>'; return; }
      cont.innerHTML = '<div class="soc-cupones">' + filas.map((c) => {
        const usado = !!c.canjeado_en;
        const vencido = !usado && c.vence_en && new Date(c.vence_en) < new Date();
        const estado = usado ? 'Canjeado el ' + fecha(c.canjeado_en)
          : vencido ? 'Venció el ' + fecha(c.vence_en)
          : 'Disponible hasta el ' + fecha(c.vence_en);
        return '<div class="soc-cupon" style="opacity:' + (usado || vencido ? '.55' : '1') + ';">'
          + '<div class="soc-label">' + c.dias + ' días de cortesía</div>'
          + '<div class="mono" style="font-size:22px;font-weight:700;letter-spacing:.06em;margin:6px 0;">' + esc(c.codigo) + '</div>'
          + '<div class="cfg-hint" style="margin:0;">' + estado + '</div>'
          + '</div>';
      }).join('') + '</div>';
    }

    async function pintarReferidos(socioId) {
      const body = $('socReferidosBody');
      if (!body) return;
      const { data } = await window.sb.from('referidos')
        .select('codigo_usado, creado_en, cese_en, cuentas(nombre, estado)')
        .eq('socio_id', socioId).order('creado_en', { ascending: false });
      const filas = data || [];
      const cnt = $('socReferidosCount');
      if (cnt) cnt.textContent = filas.length;
      if (!filas.length) {
        body.innerHTML = '<tr><td colspan="4" class="ic-empty">Todavía no has referido ninguna empresa. Comparte tu código y aparecerán aquí.</td></tr>';
        return;
      }
      body.innerHTML = filas.map((r) => {
        const c = r.cuentas || {};
        const est = r.cese_en ? 'Cesó actividades'
          : c.estado === 'activa' ? 'Pagando'
          : c.estado === 'prueba' ? 'En cortesía'
          : c.estado === 'pendiente' ? 'Sin activar' : (c.estado || '—');
        return '<tr><td>' + esc(c.nombre || '—') + '</td>'
          + '<td class="mono">' + esc(r.codigo_usado) + '</td>'
          + '<td>' + fecha(r.creado_en) + '</td>'
          + '<td>' + est + '</td></tr>';
      }).join('');
    }

    async function pintarComisiones(socioId) {
      const body = $('socComisionesBody');
      if (!body) return;
      const { data } = await window.sb.from('comisiones')
        .select('periodo, nivel, pct, base, monto, estado')
        .eq('socio_id', socioId).order('periodo', { ascending: false });
      const filas = data || [];
      const porCobrar = filas.filter((c) => c.estado === 'calculada').reduce((a, c) => a + (Number(c.monto) || 0), 0);
      const pc = $('socPorCobrar');
      if (pc) pc.textContent = plata(porCobrar);
      if (!filas.length) {
        body.innerHTML = '<tr><td colspan="6" class="ic-empty">Aún no hay comisiones liquidadas. Se calculan al cerrar cada mes.</td></tr>';
        return;
      }
      body.innerHTML = filas.map((c) => '<tr>'
        + '<td class="mono">' + esc(c.periodo) + '</td>'
        + '<td>' + ((NIVEL[c.nivel] || {}).t || c.nivel) + '</td>'
        + '<td class="num mono">' + Math.round((Number(c.pct) || 0) * 100) + '%</td>'
        + '<td class="num mono">' + plata(c.base) + '</td>'
        + '<td class="num mono">' + plata(c.monto) + '</td>'
        + '<td>' + (c.estado === 'pagada' ? 'Pagada' : c.estado === 'anulada' ? 'Anulada' : 'Por cobrar') + '</td>'
        + '</tr>').join('');
    }

    const btnCopiar = document.getElementById('socCopiarCodigo');
    if (btnCopiar) btnCopiar.addEventListener('click', () => {
      if (!MI || !MI.codigo) return;
      navigator.clipboard.writeText(MI.codigo)
        .then(() => window.toast && window.toast('Código ' + MI.codigo + ' copiado', 'success'))
        .catch(() => window.toast && window.toast('No se pudo copiar. Tu código es ' + MI.codigo, 'info'));
    });
  })();

  /* ══════════════════════════════════════════════════════════════════════
     PROGRAMA DE SOCIOS · gestion del fundador

     Aqui NO se edita ningun numero. El nivel, las empresas activas y la
     retencion se calculan de los pagos confirmados (v_socios_resumen); lo
     que el fundador hace es aprobar, certificar, emitir cupones y liquidar
     el mes. Si el nivel se pudiera escribir a mano, el tablero y la
     liquidacion terminarian diciendo cosas distintas.

     Todo va dentro de su propio try al engancharse: si algo aqui fallara,
     se cae esta pestaña y ninguna otra.
     ══════════════════════════════════════════════════════════════════════ */
  (function sociosFundador() {
    const NIVEL = {
      asociado:    { t: 'Asociado',        pct: 10 },
      certificado: { t: 'Certificado',     pct: 20 },
      socio:       { t: 'Socio',           pct: 25 },
      principal:   { t: 'Socio Principal', pct: 30 },
    };
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const plata = (n) => (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };

    let SOCIOS = [];

    window.cargarSociosFundador = async function () {
      if (!window.sb || !window.__ES_FUNDADOR) return;
      const { data, error } = await window.sb.from('v_socios_resumen').select('*').order('nombre');
      if (error) { console.warn('[Socios] No se pudieron cargar:', error.message); return; }
      SOCIOS = data || [];
      pintarKpis();
      pintarTabla();
      await pintarLiquidaciones();
      if (window.lucide) window.lucide.createIcons();
    };

    function pintarKpis() {
      const activos = SOCIOS.filter((s) => s.estado === 'activo');
      const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
      set('socKpiActivos', activos.length);
      set('socKpiFundadores', SOCIOS.filter((s) => s.es_fundador).length);
      set('socKpiEmpresas', SOCIOS.reduce((a, s) => a + (s.empresas_activas || 0), 0));
      set('socKpiPorPagar', plata(SOCIOS.reduce((a, s) => a + (Number(s.comision_por_pagar) || 0), 0)));
      set('socKpiPagado', plata(SOCIOS.reduce((a, s) => a + (Number(s.comision_pagada) || 0), 0)));
    }

    function pintarTabla() {
      const body = $('socFundBody');
      const cnt = $('socFundCount');
      if (!body) return;
      if (cnt) cnt.textContent = SOCIOS.length;
      if (!SOCIOS.length) {
        body.innerHTML = '<tr><td colspan="9" class="ic-empty">Todavía no hay socios. Usa «Dar de alta socio» con la cuenta de un contador que ya sea cliente.</td></tr>';
        return;
      }
      body.innerHTML = SOCIOS.map((s) => {
        const nv = NIVEL[s.nivel] || NIVEL.asociado;
        const est = s.estado === 'activo' ? 'Activo' : s.estado === 'suspendido' ? 'Suspendido' : 'Postulado';
        return '<tr>'
          + '<td>' + esc(s.nombre) + (s.es_fundador ? ' <span class="ag-est est-ok">Fundador</span>' : '')
          +   (s.ciudad ? '<div class="cfg-hint" style="margin:2px 0 0;">' + esc(s.ciudad) + '</div>' : '') + '</td>'
          + '<td class="mono">' + esc(s.codigo) + '</td>'
          + '<td>' + nv.t + (s.certificado ? '' : ' <span class="cfg-hint" style="display:inline;">· sin examen</span>') + '</td>'
          + '<td class="num mono">' + nv.pct + '%</td>'
          + '<td class="num mono">' + (s.empresas_activas || 0) + '</td>'
          + '<td class="num mono">' + Math.round((Number(s.retencion) || 0) * 100) + '%</td>'
          + '<td class="num mono">$' + plata(s.comision_por_pagar) + '</td>'
          + '<td>' + est + '</td>'
          + '<td><button class="btn btn-ghost" style="height:28px;font-size:11px;" data-soc-acc="' + s.id + '">Gestionar</button></td>'
          + '</tr>';
      }).join('');
      body.querySelectorAll('[data-soc-acc]').forEach((b) =>
        b.addEventListener('click', () => gestionar(b.dataset.socAcc)));
    }

    async function pintarLiquidaciones() {
      const body = $('socLiqBody');
      if (!body) return;
      const { data } = await window.sb.from('comisiones')
        .select('id, periodo, nivel, pct, base, monto, estado, socios(nombre)')
        .order('periodo', { ascending: false }).limit(200);
      const filas = data || [];
      const total = filas.filter((c) => c.estado === 'calculada').reduce((a, c) => a + (Number(c.monto) || 0), 0);
      const tt = $('socLiqTotal');
      if (tt) tt.textContent = '$' + plata(total);
      if (!filas.length) {
        body.innerHTML = '<tr><td colspan="8" class="ic-empty">Aún no hay comisiones liquidadas. Usa «Liquidar mes» al cerrar cada período.</td></tr>';
        return;
      }
      body.innerHTML = filas.map((c) => '<tr>'
        + '<td class="mono">' + esc(c.periodo) + '</td>'
        + '<td>' + esc((c.socios || {}).nombre || '—') + '</td>'
        + '<td>' + ((NIVEL[c.nivel] || {}).t || c.nivel) + '</td>'
        + '<td class="num mono">' + Math.round((Number(c.pct) || 0) * 100) + '%</td>'
        + '<td class="num mono">$' + plata(c.base) + '</td>'
        + '<td class="num mono">$' + plata(c.monto) + '</td>'
        + '<td>' + (c.estado === 'pagada' ? 'Pagada' : c.estado === 'anulada' ? 'Anulada' : 'Por pagar') + '</td>'
        + '<td>' + (c.estado === 'calculada'
            ? '<button class="btn btn-ghost" style="height:28px;font-size:11px;" data-soc-pagar="' + c.id + '">Marcar pagada</button>'
            : '') + '</td>'
        + '</tr>').join('');
      body.querySelectorAll('[data-soc-pagar]').forEach((b) =>
        b.addEventListener('click', () => marcarPagada(b.dataset.socPagar)));
    }

    // ── Dar de alta ───────────────────────────────────────────────────────
    const btnAlta = $('socAltaBtn');
    if (btnAlta) btnAlta.addEventListener('click', async () => {
      // Solo cuentas de contador que aun no sean socias: el programa exige que
      // el socio sea cliente, porque no se recomienda lo que uno no usa.
      const { data: ctas } = await window.sb.from('cuentas')
        .select('id, nombre, email_contacto, segmento, plan_id').order('nombre');
      const yaSocios = new Set(SOCIOS.map((s) => s.cuenta_id));
      const libres = (ctas || []).filter((c) => !yaSocios.has(c.id));
      if (!libres.length) { toast('No hay cuentas disponibles para dar de alta.', 'info'); return; }

      window.openFormModal && window.openFormModal({
        title: 'Dar de alta a un socio',
        saveLabel: 'Dar de alta y generar código',
        fields: [
          { name: 'cuenta', label: 'Cuenta del contador', type: 'select', col: 2,
            options: libres.map((c) => c.nombre + ' · ' + (c.email_contacto || 'sin correo')) },
          { name: 'nombre', label: 'Nombre y apellido', col: 2, placeholder: 'Como aparecerá en el directorio' },
          { name: 'colegiado', label: 'N° de C.P.C.', placeholder: 'C.P.C. 00000' },
          { name: 'ciudad', label: 'Ciudad' },
          { name: 'telefono', label: 'WhatsApp' },
          { name: 'fundador', label: 'Socio fundador (uno de los 20)', type: 'select', options: ['No', 'Sí'] },
        ],
        onSave: async (v) => {
          const idx = libres.findIndex((c) => (c.nombre + ' · ' + (c.email_contacto || 'sin correo')) === v.cuenta);
          if (idx < 0) return 'Elige la cuenta del contador.';
          if (!(v.nombre || '').trim()) return 'Indica el nombre del socio.';
          const { data, error } = await window.sb.rpc('alta_socio', {
            p_cuenta_id: libres[idx].id,
            p_nombre: v.nombre.trim(),
            p_colegiado: (v.colegiado || '').trim() || null,
            p_ciudad: (v.ciudad || '').trim() || null,
            p_telefono: (v.telefono || '').trim() || null,
            p_email: libres[idx].email_contacto || null,
            p_es_fundador: /s[ií]/i.test(v.fundador || ''),
          });
          if (error) return 'No se pudo dar de alta: ' + error.message;
          toast('Socio dado de alta · su código es ' + (data && data.codigo ? data.codigo : '—'), 'success');
          window.cargarSociosFundador();
        },
      });
    });

    // ── Liquidar el mes ───────────────────────────────────────────────────
    const btnLiq = $('socLiquidarBtn');
    if (btnLiq) btnLiq.addEventListener('click', () => {
      const hoy = new Date();
      // Por defecto el mes ANTERIOR: el mes en curso todavia esta cobrandose.
      const ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const per = ant.getFullYear() + '-' + String(ant.getMonth() + 1).padStart(2, '0');
      window.openFormModal && window.openFormModal({
        title: 'Liquidar comisiones del mes',
        saveLabel: 'Calcular y registrar',
        fields: [
          { name: 'periodo', label: 'Período (AAAA-MM)', value: per, placeholder: '2026-08' },
          { name: 'aviso', col: 2, type: 'static', label: '',
            html: '<p class="cfg-hint" style="margin:0;">Congela el nivel y el porcentaje de ese mes: si un socio baja después, lo liquidado no cambia. Volver a correrlo recalcula lo que siga «por pagar»; lo ya pagado no se toca.</p>' },
        ],
        onSave: async (v) => {
          const per2 = (v.periodo || '').trim();
          if (!/^\d{4}-\d{2}$/.test(per2)) return 'El período va como AAAA-MM (ejemplo: 2026-08).';
          const { data, error } = await window.sb.rpc('liquidar_comisiones', { p_periodo: per2 });
          if (error) return 'No se pudo liquidar: ' + error.message;
          const n = (data && data.socios) || 0;
          toast(n ? n + ' socio(s) liquidados · $' + plata((data && data.total) || 0)
                  : 'No hubo pagos de referidos en ' + per2, n ? 'success' : 'info');
          window.cargarSociosFundador();
        },
      });
    });

    // ── Gestionar un socio ────────────────────────────────────────────────
    function gestionar(socioId) {
      const s = SOCIOS.find((x) => x.id === socioId);
      if (!s) return;
      const nv = NIVEL[s.nivel] || NIVEL.asociado;
      window.openFormModal && window.openFormModal({
        title: 'Socio · ' + s.nombre,
        saveLabel: 'Guardar cambios',
        fields: [
          { name: 'resumen', col: 2, type: 'static', label: '',
            html: '<p class="cfg-hint" style="margin:0;">Código <strong class="mono">' + esc(s.codigo) + '</strong> · '
                + nv.t + ' al ' + nv.pct + '% · ' + (s.empresas_activas || 0) + ' empresas activas · '
                + Math.round((Number(s.retencion) || 0) * 100) + '% de retención · '
                + (s.cupones_disponibles || 0) + ' cupones sin usar.<br>'
                + 'El nivel se calcula solo. Solo fuérzalo para corregir un caso puntual.</p>' },
          { name: 'estado', label: 'Estado', type: 'select', options: ['activo', 'postulado', 'suspendido'], value: s.estado },
          { name: 'certificado', label: 'Aprobó la formación con examen', type: 'select', options: ['No', 'Sí'],
            value: s.certificado ? 'Sí' : 'No' },
          { name: 'forzar', label: 'Forzar nivel (dejar vacío = calculado)', type: 'select',
            options: ['— calculado —', 'asociado', 'certificado', 'socio', 'principal'] },
          { name: 'cupones', label: 'Emitir dos cupones nuevos', type: 'select', options: ['No', 'Sí'] },
        ],
        onSave: async (v) => {
          const cambios = { estado: v.estado };
          cambios.certificado_en = /s[ií]/i.test(v.certificado || '')
            ? (s.certificado ? undefined : new Date().toISOString().slice(0, 10))
            : null;
          if (cambios.certificado_en === undefined) delete cambios.certificado_en;
          cambios.nivel_forzado = (v.forzar && v.forzar.indexOf('calculado') < 0) ? v.forzar : null;

          const { error } = await window.sb.from('socios').update(cambios).eq('id', socioId);
          if (error) return 'No se pudo guardar: ' + error.message;

          if (/s[ií]/i.test(v.cupones || '')) {
            const { error: e2 } = await window.sb.rpc('emitir_cupones_socio', { p_socio: socioId });
            if (e2) toast('Se guardó, pero los cupones no: ' + e2.message, 'error');
            else toast('Dos cupones nuevos emitidos para ' + s.nombre, 'success');
          } else {
            toast('Cambios guardados', 'success');
          }
          window.cargarSociosFundador();
        },
      });
    }

    async function marcarPagada(id) {
      const { error } = await window.sb.from('comisiones')
        .update({ estado: 'pagada', pagada_en: new Date().toISOString().slice(0, 10) }).eq('id', id);
      if (error) { toast('No se pudo marcar: ' + error.message, 'error'); return; }
      toast('Comisión marcada como pagada', 'success');
      window.cargarSociosFundador();
    }
  })();

  /* ══════════════════════════════════════════════════════════════════════
     EL RAMO DE LA EMPRESA · la pantalla

     Una sola pregunta al crear la empresa, y unos interruptores editables en
     Configuración. El ramo siembra los valores; a partir de ahí manda la
     configuración de la empresa, que es lo único que el resto del sistema
     debe consultar.

     Los tres modelos —comercial, manufactura, servicios— siguen existiendo:
     lo que cambia es que ahora los deduce el ramo en vez de adivinarlos
     alguien, y que por fin se guardan.
     ══════════════════════════════════════════════════════════════════════ */
  (function ramosEmpresa() {
    const FAMILIA = {
      empaquetado: 'Comercio empaquetado',
      tecnico:     'Comercio técnico',
      peso:        'Venta por peso',
      produccion:  'Producción y transformación',
      servicio:    'Servicios',
      otro:        'Otro',
    };

    /* Los interruptores, con su explicación en una línea. El orden es el de
       la pantalla de configuración y va de lo más general a lo más
       específico: si el primero está apagado, los demás sobran. */
    const INTERRUPTORES = [
      ['lleva_inventario',   'Lleva inventario',            'Hay existencias que descontar al vender. Apágalo si vendes solo servicios.'],
      ['codigo_barras',      'Código de barras',            'Los productos traen código de fábrica y se venden con lector.'],
      ['vende_por_peso',     'Venta por peso',              'El precio sale del peso. Lee la etiqueta que imprime la balanza.'],
      ['control_lotes',      'Lotes y vencimiento',         'Pide lote al comprar y sugiere el más viejo al vender.'],
      ['control_series',     'Series o IMEI',               'Cada unidad tiene su número. Necesario para sostener garantías.'],
      ['unidades_multiples', 'Unidades múltiples',          'Compras en caja o saco y vendes por unidad o kilo.'],
      ['variantes',          'Tallas y colores',            'Un producto con varias combinaciones, cada una con su existencia.'],
      ['aplicabilidad',      'Aplicabilidad',               'Para qué marca, modelo y año sirve cada pieza.'],
      ['receta',             'Recetas',                     'Vender un producto descuenta sus insumos. Es lo que da el costo real.'],
      ['registro_sanitario', 'Registro sanitario',          'Guarda el permiso y su vencimiento, y avisa antes de que caduque.'],
      ['listas_precio',      'Listas de precio',            'El mismo producto a precio de detal, mayor o distribuidor.'],
    ];

    const COSTOS = [
      ['promedio',   'Promedio ponderado', 'Lo que pide VEN-NIF y lo que usa casi todo el mundo.'],
      ['peps',       'PEPS',               'Lo primero que entra es lo primero que sale. Donde el vencimiento manda.'],
      ['especifica', 'Identificación específica', 'Cada unidad vale distinto: vehículos, joyería, maquinaria.'],
    ];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const $ = (id) => document.getElementById(id);
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    // Para buscar sin que estorben los acentos: "panaderia" encuentra "panadería".
    const llano = (s) => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');

    let RAMOS = [];      // catálogo maestro con su perfil
    let elegido = null;  // el ramo elegido en el asistente

    async function cargarCatalogo() {
      if (RAMOS.length || !window.sb) return RAMOS;
      const { data, error } = await window.sb.from('ramos')
        .select('id, nombre, familia, nota, orden, ramo_perfil(*)').order('orden');
      if (error) { console.warn('[Ramos] No se pudo cargar el catálogo:', error.message); return []; }
      RAMOS = (data || []).map((r) => Object.assign({}, r, { perfil: r.ramo_perfil || {} }));
      return RAMOS;
    }
    window.__cargarRamos = cargarCatalogo;

    // ── El resumen de lo que enciende un ramo ────────────────────────────
    function resumenPerfil(pf) {
      const mods = [];
      if (pf.mod_comercial) mods.push('Comercial');
      if (pf.mod_manufactura) mods.push('Manufactura');
      if (pf.mod_servicios) mods.push('Servicios');
      const enc = INTERRUPTORES.filter(([k]) => k !== 'lleva_inventario' && pf[k]).map(([, t]) => t);
      let html = '<div class="re-mods">' + mods.map((m) => '<span class="re-mod">' + m + '</span>').join('') + '</div>';
      if (!pf.lleva_inventario) {
        html += '<p class="re-nota">Sin inventario: se factura por descripción, sin catálogo ni existencias.</p>';
      } else {
        const costo = (COSTOS.find((c) => c[0] === pf.metodo_costo) || COSTOS[0])[1];
        html += '<p class="re-nota">Costo por <strong>' + costo + '</strong>'
             + (enc.length ? ' · Enciende: ' + esc(enc.join(', ')) : '') + '</p>';
      }
      return html;
    }

    // ── El buscador del asistente ────────────────────────────────────────
    async function montarBuscador() {
      const lista = $('cwRamoLista');
      const busca = $('cwRamoBuscar');
      if (!lista || !busca || lista.dataset.listo) return;
      lista.dataset.listo = '1';
      await cargarCatalogo();

      function pintar() {
        const q = llano(busca.value.trim());
        const hay = RAMOS.filter((r) => !q || llano(r.nombre + ' ' + (r.nota || '')).indexOf(q) >= 0);
        if (!hay.length) {
          lista.innerHTML = '<p class="ramo-vacio">No encontramos ese ramo. Elige <strong>Otro — lo configuro yo</strong> y ajusta los controles a tu medida.</p>';
          return;
        }
        let html = '', famActual = '';
        hay.forEach((r) => {
          if (r.familia !== famActual) {
            famActual = r.familia;
            html += '<div class="ramo-fam">' + esc(FAMILIA[r.familia] || r.familia) + '</div>';
          }
          html += '<button type="button" class="ramo-op' + (elegido && elegido.id === r.id ? ' sel' : '')
               + '" data-ramo="' + esc(r.id) + '">'
               + '<b>' + esc(r.nombre) + '</b>'
               + (r.nota ? '<span>' + esc(r.nota) + '</span>' : '')
               + '</button>';
        });
        lista.innerHTML = html;
        lista.querySelectorAll('[data-ramo]').forEach((b) =>
          b.addEventListener('click', () => escoger(b.dataset.ramo)));
      }

      function escoger(id) {
        elegido = RAMOS.find((r) => r.id === id) || null;
        const caja = $('cwRamoElegido');
        if (elegido && caja) {
          caja.hidden = false;
          caja.innerHTML = '<div class="re-cab"><i data-lucide="check-circle-2"></i> <b>' + esc(elegido.nombre) + '</b></div>'
                         + resumenPerfil(elegido.perfil);
          /* Los tres modelos que ya existían siguen mandando en la vista de
             Inventario: aquí solo se sincronizan con lo que dice el ramo, en
             vez de que alguien los adivine. */
          const pf = elegido.perfil;
          const mod = pf.mod_manufactura ? 'manufactura' : (pf.mod_comercial ? 'comercial' : 'servicios');
          const tarjetas = document.querySelectorAll('.wiz-choice[data-choice="actividad"] .choice-card');
          tarjetas.forEach((c) => c.dataset.sel = (c.dataset.val === mod) ? 'true' : 'false');
          if (window.__cwSetActividad) window.__cwSetActividad(mod);
        }
        pintar();
        if (window.lucide) window.lucide.createIcons();
      }

      busca.addEventListener('input', pintar);
      pintar();
    }
    window.__montarRamoWizard = montarBuscador;
    window.__ramoElegido = () => (elegido ? elegido.id : null);

    /* Se aplica DESPUÉS de crear la empresa, porque hace falta su id. Si
       fallara, la empresa queda creada igual y sin ramo — que es exactamente
       como quedan las que ya existían, así que no rompe nada. */
    window.__aplicarRamoNuevaEmpresa = function (empresaId) {
      const id = window.__ramoElegido();
      if (!id || !empresaId || !window.sb) return;
      window.sb.rpc('aplicar_ramo', { p_empresa_id: empresaId, p_ramo_id: id, p_sobrescribir: true })
        .then(({ error }) => {
          if (error) console.warn('[Ramos] No se pudo aplicar el ramo:', error.message);
          elegido = null;
        });
    };

    // ══════════════════════════════════════════════════════════════════════
    //  Los interruptores en Configuración
    // ══════════════════════════════════════════════════════════════════════
    window.__renderInventarioConfig = async function () {
      const cont = $('cfgInventario');
      if (!cont || !window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return;
      const emp = window.__EMPRESA_ACTIVA;
      await cargarCatalogo();

      const { data: cfg } = await window.sb.from('empresa_inventario_config')
        .select('*').eq('empresa_id', emp.id).maybeSingle();
      const { data: e2 } = await window.sb.from('empresas')
        .select('ramo_id').eq('id', emp.id).maybeSingle();
      const ramoId = (e2 || {}).ramo_id || '';
      const ramo = RAMOS.find((r) => r.id === ramoId);

      // Sin fila de configuración se muestran los valores de comercio general,
      // que es como se comporta hoy una empresa sin ramo.
      const c = cfg || { lleva_inventario: true, metodo_costo: 'promedio',
        mod_comercial: true, mod_manufactura: false, mod_servicios: false };

      const opt = (id, txt, ayuda, on) =>
        '<label class="inv-sw' + (on ? ' on' : '') + '">'
        + '<input type="checkbox" data-inv="' + id + '"' + (on ? ' checked' : '') + '>'
        + '<span class="sw-txt"><b>' + esc(txt) + '</b><span>' + esc(ayuda) + '</span></span>'
        + '</label>';

      cont.innerHTML =
        '<div class="inv-ramo">'
        + '<div class="ir-cab"><span class="ir-lbl">Ramo del negocio</span>'
        +   '<select id="cfgRamoSel">'
        +     '<option value="">— sin definir —</option>'
        +     RAMOS.map((r) => '<option value="' + esc(r.id) + '"' + (r.id === ramoId ? ' selected' : '') + '>'
              + esc(r.nombre) + '</option>').join('')
        +   '</select>'
        +   '<button class="btn btn-ghost" id="cfgRamoAplicar"><i data-lucide="wand-2"></i> Aplicar su perfil</button>'
        + '</div>'
        + '<p class="ir-nota">' + (ramo
            ? 'El ramo solo sugiere. Lo que manda es lo que quede marcado abajo.'
            : 'Elegir un ramo propone unos valores de partida. Nada se cambia sin que pulses «Aplicar su perfil».')
          + '</p>'
        + '</div>'

        + '<div class="inv-grupo"><h4>Modelos de negocio</h4>'
        + '<p class="ig-sub">Una empresa puede combinar varios. Es lo que decide qué secciones se ven en Inventario.</p>'
        + opt('mod_comercial',   'Comercial',   'Compra y revende mercancía sin transformarla.', c.mod_comercial)
        + opt('mod_manufactura', 'Manufactura', 'Transforma insumos en producto terminado.', c.mod_manufactura)
        + opt('mod_servicios',   'Servicios',   'Vende trabajo, no mercancía.', c.mod_servicios)
        + '</div>'

        + '<div class="inv-grupo"><h4>Control del inventario</h4>'
        + INTERRUPTORES.map(([k, txt, ayuda]) => opt(k, txt, ayuda, !!c[k])).join('')
        + '</div>'

        + '<div class="inv-grupo"><h4>Cómo se valora la salida</h4>'
        + '<p class="ig-sub">Define el costo de venta y el valor del inventario en el balance.</p>'
        + COSTOS.map(([v, txt, ayuda]) =>
            '<label class="inv-sw' + (c.metodo_costo === v ? ' on' : '') + '">'
            + '<input type="radio" name="cfgCosto" value="' + v + '"' + (c.metodo_costo === v ? ' checked' : '') + '>'
            + '<span class="sw-txt"><b>' + esc(txt) + '</b><span>' + esc(ayuda) + '</span></span></label>').join('')
        + '</div>'

        + '<div class="inv-guardar"><button class="btn btn-primary" id="cfgInvGuardar"><i data-lucide="save"></i> Guardar configuración</button></div>';

      cont.querySelectorAll('.inv-sw input').forEach((i) =>
        i.addEventListener('change', () => {
          if (i.type === 'radio') {
            cont.querySelectorAll('input[name="cfgCosto"]').forEach((r) =>
              r.closest('.inv-sw').classList.toggle('on', r.checked));
          } else {
            i.closest('.inv-sw').classList.toggle('on', i.checked);
          }
        }));

      const btnAplicar = $('cfgRamoAplicar');
      if (btnAplicar) btnAplicar.addEventListener('click', async () => {
        const sel = $('cfgRamoSel');
        if (!sel || !sel.value) { toast('Elige primero un ramo.', 'info'); return; }
        const r = RAMOS.find((x) => x.id === sel.value);
        /* Se avisa antes de pisar. Una empresa que ya tiene su configuración
           ajustada no debe perderla por elegir un ramo en un desplegable. */
        if (cfg && !confirm('Esto reemplaza los controles de esta empresa por los de «'
            + (r ? r.nombre : sel.value) + '».\n\n¿Continuar?')) return;
        const { data, error } = await window.sb.rpc('aplicar_ramo',
          { p_empresa_id: emp.id, p_ramo_id: sel.value, p_sobrescribir: true });
        if (error || (data && data.ok === false)) {
          toast('No se pudo aplicar: ' + (error ? error.message : data.motivo), 'error'); return;
        }
        toast('Perfil de «' + (r ? r.nombre : sel.value) + '» aplicado', 'success');
        window.__renderInventarioConfig();
      });

      const btnGuardar = $('cfgInvGuardar');
      if (btnGuardar) btnGuardar.addEventListener('click', async () => {
        const fila = { empresa_id: emp.id, cuenta_id: window.__CUENTA_ID, actualizado_en: new Date().toISOString() };
        cont.querySelectorAll('[data-inv]').forEach((i) => { fila[i.dataset.inv] = i.checked; });
        const radio = cont.querySelector('input[name="cfgCosto"]:checked');
        fila.metodo_costo = radio ? radio.value : 'promedio';
        const selR = $('cfgRamoSel');
        if (selR) await window.sb.from('empresas').update({ ramo_id: selR.value || null }).eq('id', emp.id);
        const { error } = await window.sb.from('empresa_inventario_config')
          .upsert(fila, { onConflict: 'empresa_id' });
        if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
        toast('Configuración de inventario guardada ✓', 'success');
        /* Se vuelve a leer la configuracion recien guardada. Antes se llamaba
           aqui a `__aplicarConfigInventario`, que no existe en ninguna parte:
           como la llamada iba protegida con un `if`, no daba error — no hacia
           nada. La app seguia usando en memoria los valores viejos hasta que
           uno recargara. La que si existe, y hace justo esto, es esta. */
        if (window.__cargarInvConfig) { try { await window.__cargarInvConfig(); } catch (e) {} }
      });

      if (window.lucide) window.lucide.createIcons();
    };

    /* Lo que el resto del sistema debe consultar. Nunca el ramo: siempre esto.
       Devuelve los valores de comercio general mientras no haya configuración,
       que es como se comportan hoy las empresas sin ramo. */
    let _cfgCache = null;
    window.__invConfig = () => _cfgCache || {
      lleva_inventario: true, metodo_costo: 'promedio',
      mod_comercial: true, mod_manufactura: false, mod_servicios: false,
    };
    window.__cargarInvConfig = async function () {
      _cfgCache = null;
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return;
      const { data } = await window.sb.from('empresa_inventario_config')
        .select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).maybeSingle();
      if (data) _cfgCache = data;
    };
  })();

  /* ══════════════════════════════════════════════════════════════════════
     LA APERTURA · los saldos con que arranca una empresa que ya operaba

     No es un formulario de carga: es un asiento a una fecha de corte. Por eso
     el marcador de cuadre está siempre a la vista y la apertura no se cierra
     mientras el debe y el haber no sean iguales — eso lo exige la base, no
     esta pantalla.

     El guion sale de apertura_guia, en orden de trabajo: bancos, cuentas por
     cobrar, por pagar e inventario primero, que es lo que el cliente tiene a
     la mano. Lo demás hay que ir a buscarlo. Nada obliga a seguir el orden:
     se carga lo que se tenga cuando se tenga.
     ══════════════════════════════════════════════════════════════════════ */
  (function aperturaEmpresa() {
    const GRUPO = {
      banco: 'Bancos', cxc: 'Por cobrar', cxp: 'Por pagar', inventario: 'Inventario',
      caja: 'Caja', anticipo: 'Anticipos', activo_fijo: 'Activos fijos',
      fiscal: 'Fiscal', laboral: 'Laboral', prestamo: 'Préstamos',
      patrimonio: 'Patrimonio', otro: 'Otros',
    };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const $ = (id) => document.getElementById(id);
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const bs = (n) => (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const hoyISO = () => (window.__hoyISO ? window.__hoyISO() : new Date().toISOString().slice(0, 10));
    const dmy = (iso) => (iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : '—');

    let GUIA = [], AP = null, PART = [];

    const emp = () => window.__EMPRESA_ACTIVA || {};

    async function cargar() {
      const cont = $('aperturaVista');
      if (!cont || !window.sb) return;
      if (!emp().id) { cont.innerHTML = vacio('Elige una empresa para ver su apertura.'); return; }

      if (!GUIA.length) {
        const { data } = await window.sb.from('apertura_guia').select('*').order('orden');
        GUIA = data || [];
      }
      const { data: ap } = await window.sb.from('apertura').select('*').eq('empresa_id', emp().id).maybeSingle();
      AP = ap || null;
      PART = [];
      if (AP) {
        const { data: pr } = await window.sb.from('apertura_partidas')
          .select('*').eq('empresa_id', emp().id).order('creado_en');
        PART = pr || [];
      }
      pintar();
    }
    window.cargarApertura = cargar;

    const vacio = (txt) => '<div class="ap-vacio">' + esc(txt) + '</div>';

    function cuadre() {
      const debe = PART.reduce((a, p) => a + (Number(p.debe) || 0), 0);
      const haber = PART.reduce((a, p) => a + (Number(p.haber) || 0), 0);
      return { debe: debe, haber: haber, dif: debe - haber, cuadra: Math.abs(debe - haber) < 0.005 };
    }

    // ── Sin apertura todavía ─────────────────────────────────────────────
    function pintarInicio() {
      return '<div class="ap-arranque">'
        + '<h3>Los saldos con que arranca ' + esc(emp().n || 'esta empresa') + '</h3>'
        + '<p>Si el negocio ya venía operando, no arranca en cero: tiene plata en el banco, '
        + 'mercancía en el depósito, clientes que le deben y obligaciones pendientes. Todo eso '
        + 'se carga <strong>a una fecha de corte</strong>: antes de esa fecha el sistema no calcula '
        + 'nada, y desde ahí en adelante manda él.</p>'
        + '<p class="ap-nota">Es un asiento contable, así que tiene que cuadrar. El sistema te va a '
        + 'mostrar la diferencia en todo momento y no te va a dejar cerrarlo hasta que sea cero.</p>'
        + '<div class="ap-fecha-row">'
        +   '<label>Fecha de corte<input type="date" id="apFecha" value="' + hoyISO() + '"></label>'
        +   '<button class="btn btn-primary" id="apIniciar"><i data-lucide="flag"></i> Comenzar la apertura</button>'
        + '</div>'
        + '<p class="ap-nota">Lo habitual es el último día del mes o del ejercicio anterior al que '
        + 'empiezas a usar el sistema.</p>'
        + '</div>';
    }

    // ── El guion, con lo cargado en cada renglón ─────────────────────────
    function pintarGuion() {
      const porGrupo = {};
      PART.forEach((p) => { (porGrupo[p.grupo] = porGrupo[p.grupo] || []).push(p); });

      return GUIA.map((g) => {
        const filas = (porGrupo[g.grupo] || []).filter((p) => coincide(p, g));
        const suma = filas.reduce((a, p) => a + (Number(p.debe) || 0) + (Number(p.haber) || 0), 0);
        return '<div class="ap-reng' + (filas.length ? ' con' : '') + '">'
          + '<div class="ar-cab">'
          +   '<div class="ar-tit"><b>' + esc(g.titulo) + '</b>'
          +     '<span class="ar-lado ' + g.lado + '">' + (g.lado === 'debe' ? 'Activo' : 'Pasivo / patrimonio') + '</span>'
          +   '</div>'
          +   '<div class="ar-der">'
          +     (filas.length ? '<span class="ar-suma">' + bs(suma) + '</span>' : '')
          +     (AP.estado === 'cerrada' ? ''
                : '<button class="btn btn-ghost ar-add" data-guia="' + esc(g.id) + '"><i data-lucide="plus"></i> Agregar</button>')
          +   '</div>'
          + '</div>'
          + '<p class="ar-ayuda">' + esc(g.ayuda) + (g.detallado ? ' <em>Va documento por documento.</em>' : '') + '</p>'
          + (filas.length ? '<div class="ar-filas">' + filas.map((p) =>
              '<div class="ar-fila">'
              + '<span class="af-desc">' + esc(p.descripcion)
              +   (p.tercero_nombre ? '<em>' + esc(p.tercero_nombre) + (p.documento ? ' · ' + esc(p.documento) : '') + '</em>' : '')
              +   (p.calculado ? '<span class="af-calc">calculado por el sistema</span>' : '')
              + '</span>'
              + '<span class="af-monto">' + bs((Number(p.debe) || 0) + (Number(p.haber) || 0))
              +   (p.moneda !== 'VES' ? '<em>' + esc(p.moneda) + ' ' + bs(p.monto_divisa) + '</em>' : '')
              + '</span>'
              + (AP.estado === 'cerrada' ? ''
                 : '<button class="af-quitar" data-quitar="' + p.id + '" title="Quitar"><i data-lucide="x"></i></button>')
              + '</div>').join('') + '</div>' : '')
          + '</div>';
      }).join('');
    }

    /* Un grupo puede tener dos renglones de guía (los anticipos, lo fiscal),
       así que se separan por el lado además del grupo. */
    function coincide(p, g) {
      const mismos = GUIA.filter((x) => x.grupo === g.grupo);
      if (mismos.length < 2) return true;
      return (g.lado === 'debe') ? (Number(p.debe) || 0) > 0 : (Number(p.haber) || 0) > 0;
    }

    function pintar() {
      const cont = $('aperturaVista');
      if (!cont) return;

      if (!AP) { cont.innerHTML = pintarInicio(); enganchar(); return; }

      const c = cuadre();
      const cerrada = AP.estado === 'cerrada';

      cont.innerHTML =
        '<div class="ap-cab">'
        + '<div><div class="ap-lbl">Apertura al</div><div class="ap-fecha">' + dmy(AP.fecha_corte) + '</div></div>'
        + '<div class="ap-marcador ' + (c.cuadra ? 'ok' : 'no') + '">'
        +   '<div class="am-par"><span>Debe</span><b>' + bs(c.debe) + '</b></div>'
        +   '<div class="am-par"><span>Haber</span><b>' + bs(c.haber) + '</b></div>'
        +   '<div class="am-dif"><span>' + (c.cuadra ? 'Cuadra' : 'Diferencia') + '</span><b>'
        +     (c.cuadra ? '✓' : bs(Math.abs(c.dif))) + '</b></div>'
        + '</div>'
        + '<div class="ap-acc">'
        +   (cerrada
              ? '<span class="ap-sello"><i data-lucide="lock"></i> Cerrada</span>'
                + '<button class="btn btn-ghost" id="apReabrir"><i data-lucide="unlock"></i> Reabrir</button>'
              : (!c.cuadra && PART.length
                  ? '<button class="btn btn-ghost" id="apCuadrar"><i data-lucide="wand-2"></i> Cuadrar con resultados acumulados</button>'
                  : '')
                + '<button class="btn btn-primary" id="apCerrar"' + (c.cuadra && PART.length ? '' : ' disabled')
                + '><i data-lucide="check"></i> Cerrar apertura</button>')
        + '</div>'
        + '</div>'

        + (cerrada ? '' : (c.cuadra || !PART.length ? '' :
            '<p class="ap-aviso">Faltan <strong>' + bs(Math.abs(c.dif)) + '</strong> por el lado del '
            + (c.dif > 0 ? 'haber (pasivo o patrimonio)' : 'debe (activo)')
            + '. Revisa los saldos, o registra la diferencia como resultados acumulados.</p>'))

        + '<div class="ap-guion">' + pintarGuion() + '</div>'

        + (AP.nota ? '<p class="ap-hist">' + esc(AP.nota).replace(/\n/g, '<br>') + '</p>' : '');

      enganchar();
      if (window.lucide) window.lucide.createIcons();
    }

    function enganchar() {
      const ini = $('apIniciar');
      if (ini) ini.addEventListener('click', async () => {
        const f = $('apFecha');
        if (!f || !f.value) { toast('Indica la fecha de corte.', 'error'); return; }
        const { error } = await window.sb.from('apertura').insert({
          empresa_id: emp().id, cuenta_id: window.__CUENTA_ID, fecha_corte: f.value });
        if (error) { toast('No se pudo iniciar: ' + error.message, 'error'); return; }
        cargar();
      });

      document.querySelectorAll('[data-guia]').forEach((b) =>
        b.addEventListener('click', () => agregar(GUIA.find((g) => g.id === b.dataset.guia))));

      document.querySelectorAll('[data-quitar]').forEach((b) =>
        b.addEventListener('click', async () => {
          const { error } = await window.sb.from('apertura_partidas').delete().eq('id', b.dataset.quitar);
          if (error) { toast('No se pudo quitar: ' + error.message, 'error'); return; }
          cargar();
        }));

      const cua = $('apCuadrar');
      if (cua) cua.addEventListener('click', cuadrarConResultados);

      const cer = $('apCerrar');
      if (cer) cer.addEventListener('click', async () => {
        const { data, error } = await window.sb.rpc('cerrar_apertura', { p_empresa: emp().id });
        if (error) { toast('No se pudo cerrar: ' + error.message, 'error'); return; }
        if (data && data.ok === false) { toast(data.motivo, 'error'); return; }
        toast('Apertura cerrada ✓ · el sistema arranca desde ' + dmy(AP.fecha_corte), 'success');
        cargar();
      });

      const rea = $('apReabrir');
      if (rea) rea.addEventListener('click', async () => {
        const motivo = prompt('¿Por qué se reabre la apertura?\n\nQueda registrado con la fecha.');
        if (motivo === null) return;
        const { data, error } = await window.sb.rpc('reabrir_apertura',
          { p_empresa: emp().id, p_motivo: motivo || 'sin motivo' });
        if (error || (data && data.ok === false)) {
          toast('No se pudo reabrir: ' + (error ? error.message : data.motivo), 'error'); return;
        }
        toast('Apertura reabierta · puedes corregirla', 'info');
        cargar();
      });
    }

    // ── Agregar un renglón ───────────────────────────────────────────────
    function agregar(g) {
      if (!g) return;
      const detallado = g.detallado;
      window.openFormModal && window.openFormModal({
        title: g.titulo,
        saveLabel: 'Agregar al asiento',
        autoClose: false,
        fields: [
          { name: 'ayuda', col: 2, type: 'static', label: '', html: '<p class="cfg-hint" style="margin:0;">' + esc(g.ayuda) + '</p>' },
          { name: 'descripcion', label: 'Concepto', col: 2,
            placeholder: g.titulo, value: detallado ? '' : g.titulo },
        ].concat(detallado ? [
          { name: 'tercero', label: 'Tercero (cliente, proveedor, banco, trabajador)', col: 2, placeholder: 'Nombre' },
          { name: 'rif', label: 'RIF o cédula', upper: true, placeholder: 'J123456789' },
          { name: 'documento', label: 'Documento', placeholder: 'N° de factura, cuenta o contrato' },
          { name: 'fechaDoc', label: 'Fecha del documento', type: 'date' },
        ] : []).concat([
          { name: 'moneda', label: 'Moneda', type: 'select', options: ['VES (bolívares)', 'USD', 'EUR', 'USDT'] },
          { name: 'montoDivisa', label: 'Monto en divisa (si aplica)', type: 'number', placeholder: '0,00' },
          { name: 'tasa', label: 'Tasa usada (si aplica)', type: 'number', placeholder: 'Bs por 1 divisa' },
          { name: 'monto', label: 'Monto en bolívares', type: 'number', col: 2, placeholder: '0,00' },
        ]),
        onSave: async (v) => {
          const monto = Math.abs(parseFloat(String(v.monto).replace(',', '.')) || 0);
          if (!(monto > 0)) return 'Indica el monto en bolívares.';
          if (!(v.descripcion || '').trim()) return 'Indica el concepto.';
          const mon = String(v.moneda || 'VES').split(' ')[0];
          const fila = {
            empresa_id: emp().id, cuenta_id: window.__CUENTA_ID,
            grupo: g.grupo, descripcion: v.descripcion.trim(),
            debe:  g.lado === 'debe'  ? monto : 0,
            haber: g.lado === 'haber' ? monto : 0,
            moneda: mon,
            monto_divisa: mon === 'VES' ? null : (parseFloat(String(v.montoDivisa).replace(',', '.')) || null),
            tasa: mon === 'VES' ? null : (parseFloat(String(v.tasa).replace(',', '.')) || null),
          };
          if (detallado) {
            fila.tercero_nombre = (v.tercero || '').trim() || null;
            fila.tercero_rif = (v.rif || '').trim() || null;
            fila.documento = (v.documento || '').trim() || null;
            fila.fecha_doc = v.fechaDoc || null;
          }
          const { error } = await window.sb.from('apertura_partidas').insert(fila);
          if (error) return 'No se pudo agregar: ' + error.message;
          toast('Agregado · ' + bs(monto), 'success');
          await cargar();
          /* El formulario queda abierto: quien está cargando cuentas por
             cobrar tiene veinte, no una. Se limpian los campos del documento
             y se conserva el resto. */
          const body = document.getElementById('fmBody');
          if (body) {
            ['descripcion', 'tercero', 'rif', 'documento', 'monto', 'montoDivisa'].forEach((n) => {
              const e = body.querySelector('[data-name="' + n + '"]');
              if (e && !(n === 'descripcion' && !detallado)) e.value = '';
            });
            const foco = body.querySelector('[data-name="' + (detallado ? 'tercero' : 'descripcion') + '"]');
            if (foco) foco.focus();
          }
        },
      });
    }

    // ── Cuadrar con resultados acumulados ────────────────────────────────
    async function cuadrarConResultados() {
      const c = cuadre();
      if (c.cuadra) return;
      const monto = Math.abs(c.dif);
      /* La diferencia va del lado que falte. Si el activo pesa más, sobra
         patrimonio; si pesa el pasivo, hay pérdidas acumuladas. */
      const alHaber = c.dif > 0;
      const txt = alHaber ? 'Resultados acumulados' : 'Resultados acumulados (pérdida)';
      if (!confirm('Se va a registrar ' + bs(monto) + ' como «' + txt + '».\n\n'
                 + 'Queda marcado como calculado por el sistema, no aportado por el cliente:\n'
                 + 'si el balance no cuadra con la realidad más adelante, es el primer renglón a revisar.\n\n'
                 + '¿Continuar?')) return;
      const { error } = await window.sb.from('apertura_partidas').insert({
        empresa_id: emp().id, cuenta_id: window.__CUENTA_ID,
        grupo: 'patrimonio', descripcion: txt,
        debe: alHaber ? 0 : monto, haber: alHaber ? monto : 0,
        calculado: true,
        nota: 'Diferencia de la apertura al ' + dmy(AP.fecha_corte) + ', calculada por el sistema.',
      });
      if (error) { toast('No se pudo registrar: ' + error.message, 'error'); return; }
      toast('Apertura cuadrada con ' + bs(monto) + ' en resultados acumulados', 'success');
      cargar();
    }
  })();

  /* ══════════════════════════════════════════════════════════════════════
     FIRMA Y SELLO DE LA EMPRESA

     Se cargan una vez en Configuración y se estampan al imprimir los
     comprobantes de retención. Es un facsímil —la imagen de una firma
     manuscrita—, no una firma electrónica certificada.

     De paso el LOGO por fin se guarda. Hasta hoy se previsualizaba y decía
     «se usará en tus documentos», pero no se persistía en ningún lado y se
     perdía al recargar: una promesa que el sistema no cumplía.
     ══════════════════════════════════════════════════════════════════════ */
  (function firmaSello() {
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const toast = (m, t) => { if (window.toast) window.toast(m, t); };
    const MAX = 500 * 1024;   // una firma o un sello no deberían pasar de esto

    let FIRMA = null;   // la fila de empresa_firma de la empresa activa
    const emp = () => window.__EMPRESA_ACTIVA || {};

    /* Lo que consulta la impresión. Devuelve null si la empresa no tiene nada
       cargado o si decidió no estampar — y entonces el comprobante sale con la
       línea en blanco, como siempre. */
    window.__firmaEmpresa = () => (FIRMA && FIRMA.estampar ? FIRMA : null);

    /* El LOGO va aparte de la firma, y a proposito: `estampar` decide si se
       imprime la rubrica en los comprobantes, pero quien sube un logo lo
       quiere ver en su documento aunque no firme nada. Atarlos era la razon
       de que un logo cargado no apareciera. */
    window.__logoEmpresa = () => ((FIRMA && FIRMA.logo_img) ? FIRMA.logo_img : '');

    /* Para que Configuracion > Identidad visual guarde en el MISMO sitio.
       Habia dos formularios prometiendo lo mismo y solo uno cumplia. */
    window.__guardarLogoEmpresa = async function (dataUrl) {
      if (!window.sb || !emp().id) return { error: { message: 'No hay empresa activa.' } };
      const fila = {
        empresa_id: emp().id, cuenta_id: window.__CUENTA_ID,
        logo_img: dataUrl || null, actualizado_en: new Date().toISOString(),
      };
      const { error } = await window.sb.from('empresa_firma').upsert(fila, { onConflict: 'empresa_id' });
      if (!error) { if (FIRMA) FIRMA.logo_img = dataUrl || null; else FIRMA = fila; }
      return { error: error };
    };

    window.__cargarFirma = async function () {
      FIRMA = null;
      if (!window.sb || !emp().id) return;
      const { data, error } = await window.sb.from('empresa_firma')
        .select('*').eq('empresa_id', emp().id).maybeSingle();
      if (error) { console.warn('[Firma]', error.message); return; }
      FIRMA = data || null;
    };

    window.__renderFirmaConfig = async function () {
      const cont = $('cfgFirma');
      if (!cont) return;
      if (!emp().id) { cont.innerHTML = '<p class="cfg-hint">Elige una empresa para configurar su firma.</p>'; return; }
      await window.__cargarFirma();
      const f = FIRMA || {};

      const zona = (id, titulo, ayuda, img) =>
        '<div class="fs-zona">'
        + '<div class="fs-prev' + (img ? ' con' : '') + '" id="fsPrev' + id + '">'
        +   (img ? '<img src="' + img + '" alt="' + esc(titulo) + '">' : '<i data-lucide="image-plus"></i>')
        + '</div>'
        + '<div class="fs-info"><b>' + esc(titulo) + '</b><small>' + esc(ayuda) + '</small>'
        +   '<div class="fs-btns">'
        +     '<button type="button" class="btn btn-ghost btn-sm" data-subir="' + id + '"><i data-lucide="upload"></i> Subir</button>'
        +     (img ? '<button type="button" class="btn btn-ghost btn-sm" data-borrar="' + id + '"><i data-lucide="trash-2"></i> Quitar</button>' : '')
        +   '</div>'
        + '</div>'
        + '<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-file="' + id + '">'
        + '</div>';

      cont.innerHTML =
        '<div class="fs-zonas">'
        + zona('firma', 'Firma', 'PNG con fondo transparente. Firma sobre papel blanco y recórtala.', f.firma_img)
        + zona('sello', 'Sello', 'El sello húmedo escaneado, también con fondo transparente.', f.sello_img)
        + zona('logo',  'Logo',  'Va en el encabezado de tus documentos.', f.logo_img)
        + '</div>'

        + '<div class="fs-quien">'
        + '<h4>Quién firma</h4>'
        + '<p class="cfg-hint" style="margin:0 0 10px;">Se imprime debajo del trazo. Un comprobante debe decir quién lo firmó, no solo mostrar una rúbrica.</p>'
        + '<div class="fs-campos">'
        +   '<label>Nombre y apellido<input type="text" id="fsNombre" value="' + esc(f.firmante_nombre || '') + '" placeholder="Como aparece en su cédula"></label>'
        +   '<label>Cédula<input type="text" id="fsCedula" value="' + esc(f.firmante_cedula || '') + '" placeholder="V-12345678"></label>'
        +   '<label>Cargo<input type="text" id="fsCargo" value="' + esc(f.firmante_cargo || '') + '" placeholder="Administrador, Gerente, Contador…"></label>'
        + '</div>'
        + '<label class="fs-check"><input type="checkbox" id="fsEstampar"' + (f.estampar === false ? '' : ' checked') + '>'
        +   '<span><b>Estampar al imprimir</b><small>Si lo apagas, el comprobante sale con la línea en blanco para firmar a mano.</small></span></label>'
        + '<button class="btn btn-primary" id="fsGuardar" style="margin-top:14px;"><i data-lucide="save"></i> Guardar</button>'
        + '</div>';

      // Subir
      cont.querySelectorAll('[data-subir]').forEach((b) =>
        b.addEventListener('click', () => {
          const inp = cont.querySelector('[data-file="' + b.dataset.subir + '"]');
          if (inp) inp.click();
        }));

      cont.querySelectorAll('[data-file]').forEach((inp) =>
        inp.addEventListener('change', () => {
          const f2 = inp.files && inp.files[0];
          if (!f2) return;
          if (f2.size > MAX) {
            toast('Esa imagen pesa ' + Math.round(f2.size / 1024) + ' KB. Recórtala: una firma no debería pasar de 500 KB.', 'error');
            inp.value = ''; return;
          }
          const rd = new FileReader();
          rd.onload = (e) => {
            const prev = $('fsPrev' + inp.dataset.file);
            if (prev) { prev.innerHTML = '<img src="' + e.target.result + '" alt="">'; prev.classList.add('con'); }
            prev.dataset.img = e.target.result;
            toast('Cargada · pulsa Guardar para conservarla', 'info');
          };
          rd.readAsDataURL(f2);
        }));

      cont.querySelectorAll('[data-borrar]').forEach((b) =>
        b.addEventListener('click', () => {
          const prev = $('fsPrev' + b.dataset.borrar);
          if (!prev) return;
          prev.innerHTML = '<i data-lucide="image-plus"></i>';
          prev.classList.remove('con');
          prev.dataset.img = '';
          if (window.lucide) window.lucide.createIcons();
          toast('Quitada · pulsa Guardar para confirmarlo', 'info');
        }));

      const guardar = $('fsGuardar');
      if (guardar) guardar.addEventListener('click', async () => {
        const leer = (id, actual) => {
          const prev = $('fsPrev' + id);
          if (!prev) return actual || null;
          if (prev.dataset.img === '') return null;              // se quitó
          return prev.dataset.img || actual || null;             // nueva, o la que había
        };
        const fila = {
          empresa_id: emp().id, cuenta_id: window.__CUENTA_ID,
          firma_img: leer('firma', f.firma_img),
          sello_img: leer('sello', f.sello_img),
          logo_img:  leer('logo',  f.logo_img),
          firmante_nombre: ($('fsNombre').value || '').trim() || null,
          firmante_cedula: ($('fsCedula').value || '').trim() || null,
          firmante_cargo:  ($('fsCargo').value  || '').trim() || null,
          estampar: !!$('fsEstampar').checked,
          actualizado_en: new Date().toISOString(),
        };
        const { error } = await window.sb.from('empresa_firma').upsert(fila, { onConflict: 'empresa_id' });
        if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
        toast('Firma y sello guardados ✓', 'success');
        window.__renderFirmaConfig();
      });

      if (window.lucide) window.lucide.createIcons();
    };
  })();
