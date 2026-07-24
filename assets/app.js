/* =========================================================
   DigiAccount ERP — App (Dashboard Central + Módulo Fiscal)
   HTML/CSS/JS puro · sin dependencias de framework
   ========================================================= */
(function () {
  'use strict';

  // --- Inactividad: recuerda la última actividad para expirar la sesión aunque se cierre el navegador ---
  window.__DA_IDLE_MS = 30 * 60 * 1000; // 30 min
  window.__marcarActividad = function () { try { localStorage.setItem('da_last_activity', String(Date.now())); } catch (e) {} };
  window.__sesionExpiradaPorInactividad = function () {
    try {
      const last = parseInt(localStorage.getItem('da_last_activity') || '0', 10);
      return last > 0 && (Date.now() - last) > window.__DA_IDLE_MS;
    } catch (e) { return false; }
  };

  // Fecha de HOY en formato YYYY-MM-DD (hora LOCAL, para inputs type=date)
  window.__hoyISO = function () {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
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
  function drawIcons() { if (window.lucide) lucide.createIcons(); }
  drawIcons();

  /* ---------- Seguridad: escape de HTML ----------
     Convierte texto en texto plano seguro antes de insertarlo con innerHTML.
     REGLA: todo dato que escriba el usuario (nombres, RIF, emails, montos
     escritos a mano…) debe pasar por esc() al construir HTML. Cuando se
     conecte el backend (Supabase), esto evita XSS almacenado entre usuarios. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
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
          declaraDpp: opt.dataset.dpp !== 'false', // emprendimientos NO declaran Protección a las Pensiones
          firmaEmpresa: opt.dataset.firma || '',
        };
        aplicarFiscal(fiscalActivo);
        setText('entityName', name);
        setText('entityAvatar', avatar);
        setText('companyTitle', name);
        setText('companyRif', rif);
        // Coherencia con Configuración: refleja la empresa activa
        const cfgN = document.getElementById('cfgEmpresaNombre'); if (cfgN) cfgN.textContent = name;
        const cfgR = document.getElementById('cfgRazon'); if (cfgR && !cfgR.value) cfgR.value = name;
        const cfgF = document.getElementById('cfgRif'); if (cfgF && !cfgF.value) cfgF.value = rif;

        const badge = document.getElementById('contribBadge');
        const lbl = document.getElementById('contribLabel');
        if (badge && lbl) {
          if (type === 'natural') { badge.className = 'contrib-badge'; lbl.textContent = 'Persona Natural'; }
          else if (type === 'especial') { badge.className = 'contrib-badge especial'; lbl.textContent = 'Contribuyente Especial'; }
          else { badge.className = 'contrib-badge'; lbl.textContent = 'Contribuyente Ordinario'; }
        }
        dd.dataset.open = 'false';
        if (window.cargarAsientos) window.cargarAsientos();   // recarga los asientos de la empresa elegida
        if (window.cargarCuentasContables) window.cargarCuentasContables();
        if (window.cargarActivosFijos) window.cargarActivosFijos();
        if (window.cargarCriptoactivos) window.cargarCriptoactivos();
        if (window.__syncFiscalHeader) window.__syncFiscalHeader(); // RIF y condición del módulo Fiscal
        if (window.cargarLibroFiscal) { window.cargarLibroFiscal('compra'); window.cargarLibroFiscal('venta'); }
        if (window.cargarCierres) window.cargarCierres(); // meses cerrados (bloqueados) de esta empresa
        if (window.cargarCalendarioFiscal) window.cargarCalendarioFiscal(); // vencimientos reales de esta empresa
        if (window.__cargarCobrosEmp) window.__cargarCobrosEmp(opt.dataset.empresaId); // métodos de cobro guardados
        if (window.__renderDPP) window.__renderDPP();
        if (window.__renderIGP) window.__renderIGP();
        if (window.cargarBoveda) window.cargarBoveda();
        if (window.cargarTesoreria) window.cargarTesoreria();
        if (window.cargarRetenciones) window.cargarRetenciones();
        if (window.cargarGuias) window.cargarGuias();           // guías de despacho de la empresa
        if (window.__aplicarModoDoc) window.__aplicarModoDoc(); // letrero de modo (recibos/homologado) + RIF en Ventas
        if (window.cargarParametros) window.cargarParametros();
        if (window.cargarEmpleados) window.cargarEmpleados();
        if (window.cargarDashboard) window.cargarDashboard();
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
    let q = window.sb.from('empresas').select('id, nombre, rif, condicion_fiscal, fiscal_activo, firma_empresa, direccion, telefono');
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
      if ((data || []).length > 1 && !window.__EMP_YA_ELEGIDA) {
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
      ],
      onSave: (v) => {
        if (!v.nombre) return 'Indica el nombre de la empresa.';
        if (!v.rif) return 'Indica el RIF.';
        window.sb.from('empresas').update({ nombre: v.nombre.trim(), rif: v.rif.trim(), condicion_fiscal: v.cond, direccion: (v.direccion || '').trim() || null, telefono: (v.telefono || '').trim() || null })
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
  }
  window.showView = showView;

  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      if (item.classList.contains('locked')) { if (window.__mostrarUpgrade) window.__mostrarUpgrade(item); return; }
      showView(item.dataset.view, item.dataset.title);
    });
  });

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

  /* =========================================================
     PESTAÑA RETENCIONES — Practicadas / Sufridas + recibo
     ========================================================= */
  (function retenciones() {
    const nav = document.getElementById('retDirNav');
    if (!nav) return;
    const dirBtns = nav.querySelectorAll('button');
    const views = document.querySelectorAll('.ret-view');
    const fchips = document.querySelectorAll('.ret-fchip');
    const summary = document.getElementById('retSummary');
    const countEl = document.getElementById('retCount');

    let curDir = 'practicadas';
    let curFilter = 'todos';

    const fmt = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const parseNum = (s) => {
      const t = (s || '').trim();
      if (!t || t === '—') return 0;
      return parseFloat(t.replace(/\./g, '').replace(',', '.')) || 0;
    };

    function activeView() {
      return document.querySelector('.ret-view[data-retview="' + curDir + '"]');
    }
    function rows() {
      return Array.from(activeView().querySelectorAll('tbody tr'));
    }

    // Aplica el filtro IVA/ISLR a las filas de la vista activa
    function applyFilter() {
      let shown = 0, total = 0;
      rows().forEach((tr) => {
        const t = tr.dataset.rettype;
        if (!t) { tr.hidden = false; return; } // fila de estado vacío
        const visible = curFilter === 'todos' || curFilter === t;
        tr.hidden = !visible;
        total++;
        if (visible) shown++;
      });
      const noun = curDir === 'practicadas' ? 'practicados' : 'sufridos';
      if (countEl) countEl.innerHTML = 'Mostrando <strong>1–' + shown + '</strong> de <strong>' + shown + '</strong> comprobantes ' + noun;
    }

    // Recalcula las tarjetas de resumen leyendo la vista activa
    function refreshSummary() {
      let ivaT = 0, ivaC = 0, islrT = 0, islrC = 0, ivaPct = '75%', islrPct = '3%';
      rows().forEach((tr) => {
        if (!tr.dataset.rettype) return; // fila de estado vacío
        const tds = tr.querySelectorAll('td');
        const monto = parseNum(tds[8].textContent);
        const pct = tds[7].textContent.trim();
        if (tr.dataset.rettype === 'iva') { ivaT += monto; ivaC++; ivaPct = pct; }
        else { islrT += monto; islrC++; islrPct = pct; }
      });
      const totT = ivaT + islrT, totC = ivaC + islrC;
      const q = (sel) => summary.querySelector('[data-sum="' + sel + '"]');
      q('iva').textContent = 'Bs ' + fmt(ivaT);
      q('iva-c').textContent = ivaC + ' comprobante' + (ivaC === 1 ? '' : 's') + ' · ' + ivaPct;
      q('islr').textContent = 'Bs ' + fmt(islrT);
      q('islr-c').textContent = islrC + ' comprobante' + (islrC === 1 ? '' : 's') + (islrC ? ' · ' + islrPct : '');
      q('total').textContent = 'Bs ' + fmt(totT);
      const noun = curDir === 'practicadas' ? '2da quincena May 2026' : 'sufridas en ventas';
      q('total-c').textContent = totC + ' comprobante' + (totC === 1 ? '' : 's') + ' · ' + noun;
    }

    dirBtns.forEach((b) => b.addEventListener('click', () => {
      curDir = b.dataset.retdir;
      dirBtns.forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
      views.forEach((v) => (v.hidden = v.dataset.retview !== curDir));
      refreshSummary();
      applyFilter();
      drawIcons();
    }));

    fchips.forEach((c) => c.addEventListener('click', () => {
      curFilter = c.dataset.retfilter;
      fchips.forEach((x) => x.classList.toggle('active', x === c));
      applyFilter();
    }));

    /* ---- Recibo / reporte del período ---- */
    const overlay = document.getElementById('retReciboOverlay');
    const openBtn = document.getElementById('retReciboBtn');
    const closeBtn = document.getElementById('retReciboClose');
    const printBtn = document.getElementById('retReciboPrint');

    function buildRecibo() {
      const visible = rows().filter((tr) => !tr.hidden);
      const body = document.getElementById('rrTableBody');
      let ivaT = 0, ivaC = 0, islrT = 0, islrC = 0, gran = 0;
      body.innerHTML = '';
      visible.forEach((tr) => {
        const tds = tr.querySelectorAll('td');
        const monto = parseNum(tds[8].textContent);
        gran += monto;
        if (tr.dataset.rettype === 'iva') { ivaT += monto; ivaC++; } else { islrT += monto; islrC++; }
        const tipoTag = tr.dataset.rettype === 'iva' ? '<span class="tag cyan">IVA</span>' : '<span class="tag navy">ISLR</span>';
        body.insertAdjacentHTML('beforeend',
          '<tr><td>' + tds[0].textContent + '</td><td class="mono">' + tds[1].textContent + '</td><td>' + tipoTag +
          '</td><td class="mono">' + tds[3].textContent + '</td><td>' + tds[4].textContent + '</td><td class="mono">' + tds[5].textContent +
          '</td><td class="num">' + tds[6].textContent + '</td><td class="num">' + tds[7].textContent + '</td><td class="num">' + tds[8].textContent + '</td></tr>');
      });
      document.getElementById('rrTableTotal').textContent = fmt(gran);

      // Cabecera y totales según dirección
      const eyebrow = document.getElementById('rrEyebrow');
      const kind = document.getElementById('rrKind');
      if (curDir === 'practicadas') {
        eyebrow.textContent = 'Agente de Retención';
        kind.innerHTML = 'Recibo de Retenciones<br><span>Practicadas a proveedores</span>';
      } else {
        eyebrow.textContent = 'Sujeto Retenido';
        kind.innerHTML = 'Recibo de Retenciones<br><span>Sufridas — retenidas por clientes</span>';
      }
      const tg = document.getElementById('rrTotGrid');
      tg.querySelector('.iva .v').textContent = 'Bs ' + fmt(ivaT);
      tg.querySelector('.iva .c').textContent = ivaC + ' comprobante' + (ivaC === 1 ? '' : 's');
      tg.querySelector('.islr .v').textContent = 'Bs ' + fmt(islrT);
      tg.querySelector('.islr .c').textContent = islrC + ' comprobante' + (islrC === 1 ? '' : 's');
      tg.querySelector('.total .v').textContent = 'Bs ' + fmt(gran);
      tg.querySelector('.total .c').textContent = (ivaC + islrC) + ' comprobante' + ((ivaC + islrC) === 1 ? '' : 's');
    }

    if (openBtn) openBtn.addEventListener('click', () => {
      buildRecibo();
      overlay.hidden = false;
      drawIcons();
    });
    if (closeBtn) closeBtn.addEventListener('click', () => (overlay.hidden = true));
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
    if (printBtn) printBtn.addEventListener('click', () => {
      const doc = document.getElementById('retReciboDoc');
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

    /* ---- Datos reales: registrar y cargar comprobantes de retención ---- */
    const normRif = (s) => (s || '').toUpperCase().replace(/[\s.\-]/g, '');
    function rowHtml(r) {
      const esIva = r.tipo === 'iva';
      const tag = esIva ? '<span class="tag cyan">IVA</span>' : '<span class="tag navy">ISLR</span>';
      const pct = Number(r.pct) || 0;
      const pctTxt = (Number.isInteger(pct) ? pct : pct.toFixed(2)) + '%';
      return '<tr data-rettype="' + (esIva ? 'iva' : 'islr') + '" data-id="' + esc(String(r.id)) + '" style="cursor:pointer;" title="Clic para editar o eliminar">'
        + '<td>' + esc(r.fecha || '') + '</td><td class="mono">' + esc(r.comprobante || '') + '</td><td>' + tag + '</td>'
        + '<td class="mono">' + esc(r.tercero_rif || '') + '</td><td class="primary">' + esc(r.tercero_nombre || '') + '</td>'
        + '<td class="mono">' + esc(r.factura || '') + '</td><td class="num">' + fmt(Number(r.base) || 0) + '</td>'
        + '<td class="num">' + pctTxt + '</td><td class="num">' + fmt(Number(r.monto) || 0) + '</td>'
        + '<td><span class="tag success">' + esc(r.estado || 'Registrado') + '</span></td></tr>';
    }
    const _retPage = { practicadas: 1, sufridas: 1 };   // página actual por dirección (20 por página)
    const _retPageArr = { practicadas: [], sufridas: [] }; // datos vigentes para re-pintar al paginar
    function pintar(dir, arr, page) {
      const v = document.querySelector('.ret-view[data-retview="' + dir + '"]');
      const tb = v && v.querySelector('tbody');
      if (!tb) return;
      _retPageArr[dir] = arr;
      if (!arr.length) {
        tb.innerHTML = '<tr class="ret-empty"><td colspan="10" style="text-align:center;color:var(--fg-muted);padding:16px;">Sin retenciones registradas. Usa “Registrar retención”.</td></tr>';
        return;
      }
      const PAG = 20;
      const totalPag = Math.max(1, Math.ceil(arr.length / PAG));
      const pag = Math.min(Math.max(1, page || 1), totalPag);
      _retPage[dir] = pag;
      const ini = (pag - 1) * PAG;
      let html = arr.slice(ini, ini + PAG).map(rowHtml).join('');
      if (totalPag > 1) {
        html += '<tr><td colspan="10" style="padding:6px 10px;"><div style="display:flex;justify-content:center;align-items:center;gap:14px;font-size:12px;color:var(--fg-muted);">'
          + '<button class="btn btn-ghost" data-rp="' + dir + '" data-rp-dir="-1"' + (pag <= 1 ? ' disabled' : '') + ' style="height:26px;font-size:11px;">« Anterior</button>'
          + '<span>Página ' + pag + ' de ' + totalPag + ' · ' + arr.length + ' retenciones</span>'
          + '<button class="btn btn-ghost" data-rp="' + dir + '" data-rp-dir="1"' + (pag >= totalPag ? ' disabled' : '') + ' style="height:26px;font-size:11px;">Siguiente »</button>'
          + '</div></td></tr>';
      }
      tb.innerHTML = html;
    }
    document.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-rp]');
      if (b && !b.disabled) pintar(b.dataset.rp, _retPageArr[b.dataset.rp] || [], (_retPage[b.dataset.rp] || 1) + parseInt(b.dataset.rpDir, 10));
    });
    let _retData = []; // últimas retenciones cargadas (para editar/eliminar por id)

    // Mini-cuadro de retenciones dentro de una Forma 30 (compras=practicadas, ventas=sufridas)
    function renderMini(tableEl, arr) {
      if (!tableEl) return;
      const tb = tableEl.querySelector('tbody');
      if (tb) tb.innerHTML = arr.length ? arr.map((r) => {
        const esIva = r.tipo === 'iva';
        const pct = Number(r.pct) || 0;
        return '<tr><td class="mono">' + esc(r.comprobante || '') + '</td><td class="mono">' + esc(r.factura || '') + '</td>'
          + '<td><span class="op-tag ' + (esIva ? 'cyan' : 'navy') + '">' + (esIva ? 'IVA' : 'ISLR') + '</span></td>'
          + '<td class="num">' + fmt(Number(r.base) || 0) + '</td><td class="num">' + (Number.isInteger(pct) ? pct : pct.toFixed(2)) + '%</td>'
          + '<td class="num">' + fmt(Number(r.monto) || 0) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin retenciones registradas en el período</td></tr>';
      const ivaT = arr.filter((r) => r.tipo === 'iva').reduce((s, r) => s + (Number(r.monto) || 0), 0);
      const islrT = arr.filter((r) => r.tipo === 'islr').reduce((s, r) => s + (Number(r.monto) || 0), 0);
      const setFoot = (cls, val) => { const c = tableEl.querySelector('tfoot .' + cls + ' td:last-child'); if (c) c.textContent = fmt(val); };
      setFoot('t-iva', ivaT); setFoot('t-islr', islrT); setFoot('t-tot', ivaT + islrT);
    }

    // Traslada las retenciones de IVA SUFRIDAS (las que nos retienen los clientes) a la
    // autoliquidación de la Forma 30 Ventas (ítem 66/38 → reduce el Total a Pagar) y
    // refleja el detalle en los mini-cuadros de cada Forma 30.
    function aplicarAForma30(arr) {
      arr = arr || [];
      const ivaSuf = arr.filter((r) => r.direccion === 'sufrida' && r.tipo === 'iva').reduce((s, r) => s + (Number(r.monto) || 0), 0);
      window.__RET_IVA_SUFRIDA = ivaSuf;
      if (window.__recalcAutoliq) window.__recalcAutoliq();
      renderMini(document.querySelector('.fiscal-tab[data-tab="compras"] table.ret-mini'), arr.filter((r) => r.direccion === 'practicada'));
      renderMini(document.querySelector('.ventas-view[data-ventasmode="facturas"] table.ret-mini'), arr.filter((r) => r.direccion === 'sufrida'));
      // Resumen de retenciones ISLR practicadas (panel del generador XML)
      const islrBody = document.getElementById('islrResumenBody');
      if (islrBody) {
        const islrP = arr.filter((r) => r.tipo === 'islr' && r.direccion === 'practicada');
        let tOp = 0, tRet = 0;
        islrBody.innerHTML = islrP.length ? islrP.map((r, i) => {
          const op = Number(r.base) || 0, ret = Number(r.monto) || 0; tOp += op; tRet += ret;
          const pctT = Number.isInteger(Number(r.pct)) ? Number(r.pct) : Number(r.pct).toFixed(2);
          return '<tr><td class="ctr">' + (i + 1) + '</td><td class="mono">' + esc(r.tercero_rif || '') + '</td><td class="primary">' + esc(r.tercero_nombre || '') + '</td><td class="mono">' + esc(r.factura || '') + '</td><td class="mono">' + esc(r.numero_control || '') + '</td><td>' + esc(r.fecha || '') + '</td><td class="ctr">' + esc(r.concepto_codigo || '') + '</td><td class="num">' + fmt(op) + '</td><td class="ctr">' + pctT + '%</td><td class="num">' + fmt(ret) + '</td></tr>';
        }).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--fg-muted);padding:14px;">Sin retenciones de ISLR practicadas. Regístralas en la pestaña Retenciones.</td></tr>';
        const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = fmt(v); };
        setT('islrResumenOp', tOp); setT('islrResumenRet', tRet);
        const c = document.getElementById('islrResumenCount'); if (c) c.textContent = String(islrP.length);
      }
      // Resumen de retenciones IVA practicadas (panel del generador TXT)
      const ivaP = arr.filter((r) => r.tipo === 'iva' && r.direccion === 'practicada');
      const setT2 = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      const ivaBase = ivaP.reduce((s, r) => s + (Number(r.base) || 0), 0);
      const ivaRet = ivaP.reduce((s, r) => s + (Number(r.monto) || 0), 0);
      setT2('ivaResumenCount', String(ivaP.length));
      setT2('ivaResumenNota', String(ivaP.length));
      setT2('ivaResumenBase', fmt(ivaBase));
      setT2('ivaResumenRet', fmt(ivaRet));
    }
    async function cargarRetenciones() {
      const vacio = () => { _retData = []; pintar('practicadas', []); pintar('sufridas', []); refreshSummary(); applyFilter(); aplicarAForma30([]); };
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return vacio();
      const { data, error } = await window.__sbAll((q) => q.eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('fecha', { ascending: false }), 'retenciones', '*');
      if (error) { console.warn('[DigiAccount] No se pudieron cargar retenciones:', error.message); return vacio(); }
      // Solo las retenciones del PERÍODO DE DECLARACIÓN seleccionado (sigue al de la factura)
      const per = window.__fiscalPer;
      let arr = data || [];
      if (per && per.mm && per.aa) {
        const perDecl = '20' + per.aa + '-' + per.mm, suf = '/' + per.mm + '/' + per.aa;
        arr = arr.filter((r) => r.periodo ? r.periodo === perDecl : String(r.fecha || '').endsWith(suf));
      }
      _retData = arr;
      pintar('practicadas', arr.filter((r) => r.direccion === 'practicada'));
      pintar('sufridas', arr.filter((r) => r.direccion === 'sufrida'));
      refreshSummary(); applyFilter();
      aplicarAForma30(arr);
    }
    window.cargarRetenciones = cargarRetenciones;
    window.__getRetenciones = () => _retData.slice(); // para el generador XML de ISLR

    // El % de retención depende del impuesto: IVA = dropdown estricto 0/75/100;
    // ISLR = entrada libre con sugerencias comunes (varía por concepto del Decreto 1.808).
    function setupPctField(body) {
      const tipoSel = body.querySelector('[data-name="tipo"]');
      const pctEl = body.querySelector('[data-name="pct"]');
      const wrap = pctEl ? pctEl.closest('.fm-field') : null;
      if (!tipoSel || !wrap) return;
      const render = () => {
        const esIva = /iva/i.test(tipoSel.value);
        const curEl = wrap.querySelector('[data-name="pct"]');
        const cur = curEl ? String(curEl.value).replace('%', '').trim() : '';
        const lbl = wrap.querySelector('.fm-lbl');
        const lblHtml = lbl ? lbl.outerHTML : '<span class="fm-lbl">% de retención</span>';
        if (esIva) {
          wrap.innerHTML = lblHtml + '<select data-name="pct">' + ['0', '75', '100'].map((o) =>
            '<option value="' + o + '%"' + ((cur === o || (cur === '' && o === '75')) ? ' selected' : '') + '>' + o + '%</option>').join('') + '</select>';
        } else {
          wrap.innerHTML = lblHtml + '<input data-name="pct" type="number" step="0.01" list="fm-dl-pctislr" placeholder="3" value="' + esc(cur) + '">'
            + '<datalist id="fm-dl-pctislr"><option value="1"></option><option value="2"></option><option value="3"></option><option value="5"></option></datalist>';
        }
      };
      tipoSel.addEventListener('change', render);
      render();
    }

    // ===== ISLR: Anexo 6.1 (Decreto 1.808) — set curado con códigos y % oficiales =====
    // v: por tipo de sujeto → [códigoConcepto, %] (% null = escalonado 15/22/34, se coloca a mano)
    const UT_BS = 43; // Unidad Tributaria vigente 2026 (confirmado por Luis)
    const SUSTRAENDO_CODS = ['002', '006', '010', '012', '014', '018', '025', '049', '053', '057', '061', '071', '073', '075', '077', '079', '083'];
    const CONCEPTOS_ISLR = [
      { act: 'Honorarios profesionales no mercantiles', v: { PNR: ['002', 3], PNNR: ['003', 34], PJD: ['004', 5], PJND: ['005', null] } },
      { act: 'Comisiones por venta de inmuebles', v: { PNR: ['014', 3], PNNR: ['015', 34], PJD: ['016', 5], PJND: ['017', 5] } },
      { act: 'Otras comisiones', v: { PNR: ['018', 3], PNNR: ['019', 34], PJD: ['020', 5], PJND: ['021', 5] } },
      { act: 'Intereses pagados por PJ a cualquier persona', v: { PNR: ['025', 3], PNNR: ['026', 34], PJD: ['027', 5], PJND: ['028', null] } },
      { act: 'Contratistas / subcontratistas (obras o servicios)', v: { PNR: ['053', 1], PNNR: ['054', 34], PJD: ['055', 2], PJND: ['056', null] } },
      { act: 'Arrendamiento de inmuebles', v: { PNR: ['057', 3], PNNR: ['058', 34], PJD: ['059', 5], PJND: ['060', null] } },
      { act: 'Arrendamiento de bienes muebles', v: { PNR: ['061', 3], PNNR: ['062', 34], PJD: ['063', 5], PJND: ['064', 5] } },
      { act: 'Tarjetas de crédito (venta de bienes/servicios)', v: { PNR: ['065', 3], PNNR: ['066', 34], PJD: ['067', 5], PJND: ['068', 5] } },
      { act: 'Fletes / transporte de carga', v: { PNR: ['071', 1], PJD: ['072', 3] } },
      { act: 'Seguros / corretaje / reaseguros (servicios)', v: { PNR: ['073', 3], PJD: ['074', 5] } },
      { act: 'Adquisición de fondos de comercio', v: { PNR: ['079', 3], PNNR: ['080', 34], PJD: ['081', 5], PJND: ['082', 5] } },
      { act: 'Publicidad y propaganda', v: { PNR: ['083', 3], PJD: ['084', 5], PJND: ['085', 5] } },
    ];
    // Variante (código y %) según el concepto + tipo de sujeto seleccionados
    function variantIslr(actividad, sujeto) {
      const c = CONCEPTOS_ISLR.find((x) => x.act === actividad);
      return c && c.v[sujeto] ? c.v[sujeto] : null;
    }
    function calcSustraendo(cod, sujeto, pct) {
      if (sujeto !== 'PNR' || SUSTRAENDO_CODS.indexOf(cod) < 0 || pct == null) return 0;
      return (pct / 100) * 83.3334 * UT_BS;
    }
    // En ISLR muestra concepto/sujeto/sustraendo y autollena código, % y sustraendo.
    // En IVA los oculta (no aplican).
    function setupIslrFields(body) {
      const tipoSel = body.querySelector('[data-name="tipo"]');
      const concSel = body.querySelector('[data-name="concepto"]');
      const sujSel = body.querySelector('[data-name="sujeto"]');
      if (!tipoSel || !concSel || !sujSel) return;
      const hide = (name, on) => { const el = body.querySelector('[data-name="' + name + '"]'); const w = el && el.closest('.fm-field'); if (w) w.style.display = on ? 'none' : ''; };
      const aplicar = () => {
        const esIslr = /islr/i.test(tipoSel.value);
        hide('concepto', !esIslr); hide('sujeto', !esIslr); hide('sustraendo', !esIslr);
        if (!esIslr) return;
        const variant = variantIslr(concSel.value, sujSel.value);
        const pctEl = body.querySelector('[data-name="pct"]');
        const sustEl = body.querySelector('[data-name="sustraendo"]');
        if (variant) {
          const cod = variant[0], pct = variant[1];
          if (pctEl && pct != null) pctEl.value = pct;
          if (sustEl) { const s = calcSustraendo(cod, sujSel.value, pct); sustEl.value = s ? s.toFixed(2) : '0'; }
        }
      };
      tipoSel.addEventListener('change', aplicar);
      concSel.addEventListener('change', aplicar);
      sujSel.addEventListener('change', aplicar);
      aplicar();
    }

    async function registrarRetencion() {
      const terceros = (window.__getTerceros ? window.__getTerceros() : []);
      // Facturas reales registradas en los libros (compras + ventas) de la empresa activa,
      // para ofrecerlas a elegir según la dirección y el tercero de la retención.
      let facturas = [];
      if (window.sb && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
        const { data } = await window.sb.from('libro_fiscal')
          .select('numero_factura, numero_control, tercero_nombre, tercero_rif, base, iva, tipo')
          .eq('empresa_id', window.__EMPRESA_ACTIVA.id).order('fecha', { ascending: false });
        facturas = data || [];
      }
      window.openFormModal && window.openFormModal({
        title: curDir === 'sufridas' ? 'Registrar retención sufrida (un cliente me retuvo)' : 'Registrar retención practicada (yo retengo)',
        saveLabel: 'Registrar',
        fields: [
          { name: 'direccion', label: 'Dirección', type: 'select', options: ['Practicada (yo retengo a un proveedor)', 'Sufrida (un cliente me retiene)'], value: curDir === 'sufridas' ? 'Sufrida (un cliente me retiene)' : 'Practicada (yo retengo a un proveedor)' },
          { name: 'tipo', label: 'Impuesto', type: 'select', options: ['IVA', 'ISLR'] },
          { name: 'concepto', label: 'Concepto de retención (ISLR)', col: 2, type: 'select', options: CONCEPTOS_ISLR.map((c) => c.act) },
          { name: 'sujeto', label: 'Tipo de sujeto (ISLR)', type: 'select', options: [{ value: 'PNR', label: 'PN Residente' }, { value: 'PNNR', label: 'PN No Residente' }, { value: 'PJD', label: 'PJ Domiciliada' }, { value: 'PJND', label: 'PJ No Domiciliada' }] },
          { name: 'fecha', label: 'Fecha', type: 'date', value: window.__hoyISO() },
          { name: 'nombre', label: 'Tercero (escribe iniciales y elige)', col: 2, type: 'datalist', options: terceros.map((t) => t.nombre), placeholder: 'Proveedor o cliente…' },
          { name: 'rif', label: 'RIF (mayúscula, sin guiones)', upper: true, placeholder: 'J123456789' },
          { name: 'factura', label: 'Factura afectada (elige una registrada)', type: 'datalist', options: [], placeholder: 'Primero elige el tercero…' },
          { name: 'numControl', label: 'N° de Control (se llena de la factura)', placeholder: '00-00000000' },
          { name: 'comprobante', label: 'N° Comprobante (vacío = nuevo · o elige uno para agrupar)', type: 'datalist', options: [], placeholder: 'Se genera automáticamente' },
          { name: 'base', label: 'Base imponible / monto del pago (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
          { name: 'pct', label: '% de retención', type: 'number', step: '0.01', placeholder: '75' },
          { name: 'sustraendo', label: 'Sustraendo (ISLR, automático)', type: 'number', step: '0.01', placeholder: '0.00' },
        ],
        afterRender: (body) => {
          const dirSel = body.querySelector('[data-name="direccion"]');
          const tipoSel = body.querySelector('[data-name="tipo"]');
          const prov = body.querySelector('[data-name="nombre"]');
          const rif = body.querySelector('[data-name="rif"]');
          const factInput = body.querySelector('[data-name="factura"]');
          const baseInput = body.querySelector('[data-name="base"]');
          const dl = document.getElementById('fm-dl-factura');
          if (!prov) return;
          // Limitar terceros por dirección: practicada → solo proveedores; sufrida → solo clientes
          const tercDl = document.getElementById('fm-dl-nombre');
          const refrescarTerceros = () => {
            if (!tercDl) return;
            const esPract = dirSel && /^practicada/i.test(dirSel.value);
            const lista = terceros.filter((t) => (esPract ? t.prov : t.cli) && t.nombre);
            tercDl.innerHTML = lista.map((t) => '<option value="' + esc(t.nombre) + '"></option>').join('');
            prov.placeholder = esPract ? 'Proveedor… (escribe iniciales)' : 'Cliente… (escribe iniciales)';
            const lbl = prov.closest('.fm-field') && prov.closest('.fm-field').querySelector('.fm-lbl');
            if (lbl) lbl.textContent = (esPract ? 'Proveedor' : 'Cliente') + ' (escribe iniciales y elige)';
          };
          const autollenarRif = () => { const t = terceros.find((x) => x.nombre.toLowerCase() === prov.value.trim().toLowerCase()); if (t && rif) rif.value = normRif(t.rif); };
          const facturasFiltradas = () => {
            const esPract = dirSel && /^practicada/i.test(dirSel.value);
            const tipoLibro = esPract ? 'compra' : 'venta';
            const nom = (prov.value || '').trim().toLowerCase();
            const rifN = normRif(rif && rif.value);
            return facturas.filter((f) => f.tipo === tipoLibro
              && ((nom && (f.tercero_nombre || '').toLowerCase() === nom) || (rifN && normRif(f.tercero_rif) === rifN)));
          };
          const refrescarFacturas = () => {
            if (!dl) return;
            const fs = facturasFiltradas();
            dl.innerHTML = fs.map((f) => '<option value="' + esc(f.numero_factura || '') + '">' + esc((f.numero_factura || '(sin N°)') + ' · base ' + fmt(Number(f.base) || 0)) + '</option>').join('');
            if (factInput) factInput.placeholder = fs.length ? 'Elige entre ' + fs.length + ' factura(s)…' : 'Sin facturas registradas de este tercero';
          };
          const ctrlInput = body.querySelector('[data-name="numControl"]');
          const autollenarBase = () => {
            if (!factInput) return;
            const f = facturasFiltradas().find((x) => (x.numero_factura || '') === factInput.value.trim());
            if (!f) return;
            const esIva = !tipoSel || /iva/i.test(tipoSel.value);
            if (baseInput) baseInput.value = (esIva ? (Number(f.iva) || 0) : (Number(f.base) || 0)).toFixed(2);
            if (ctrlInput && f.numero_control) ctrlInput.value = f.numero_control;
          };
          prov.addEventListener('change', () => { autollenarRif(); refrescarFacturas(); });
          prov.addEventListener('input', () => { autollenarRif(); refrescarFacturas(); });
          if (dirSel) dirSel.addEventListener('change', () => { refrescarTerceros(); prov.value = ''; if (rif) rif.value = ''; refrescarFacturas(); });
          if (tipoSel) tipoSel.addEventListener('change', autollenarBase);
          if (factInput) { factInput.addEventListener('change', autollenarBase); factInput.addEventListener('input', autollenarBase); }
          // Sugerir comprobantes EXISTENTES del mismo proveedor (mismo tipo/dirección) para agrupar
          const compDl = document.getElementById('fm-dl-comprobante');
          const compInput = body.querySelector('[data-name="comprobante"]');
          const refrescarComprobantes = () => {
            if (!compDl) return;
            const rifN = normRif(rif && rif.value);
            const nom = (prov.value || '').trim().toLowerCase();
            const dir = (dirSel && /^practicada/i.test(dirSel.value)) ? 'practicada' : 'sufrida';
            const tip = (tipoSel && /islr/i.test(tipoSel.value)) ? 'islr' : 'iva';
            const seen = {};
            const list = _retData.filter((x) => x.tipo === tip && x.direccion === dir && (x.comprobante || '')
              && ((rifN && normRif(x.tercero_rif) === rifN) || (nom && (x.tercero_nombre || '').toLowerCase() === nom)))
              .filter((x) => { if (seen[x.comprobante]) return false; seen[x.comprobante] = true; return true; });
            compDl.innerHTML = list.map((x) => '<option value="' + esc(x.comprobante) + '">' + esc(x.comprobante + ' · ' + (x.fecha || '')) + '</option>').join('');
            if (compInput) compInput.placeholder = list.length ? 'Vacío = nuevo N° · o elige uno existente para agrupar' : 'Se genera automáticamente';
          };
          prov.addEventListener('change', refrescarComprobantes); prov.addEventListener('input', refrescarComprobantes);
          if (dirSel) dirSel.addEventListener('change', refrescarComprobantes);
          if (tipoSel) tipoSel.addEventListener('change', refrescarComprobantes);
          refrescarTerceros();
          refrescarFacturas();
          refrescarComprobantes();
          setupPctField(body);
          setupIslrFields(body);
        },
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa seleccionada.';
          if (!v.nombre) return 'Indica el tercero.';
          const esIslr = /islr/i.test(v.tipo);
          const base = parseFloat(v.base) || 0, pct = parseFloat(v.pct) || 0;
          let cod = '', suj = '', sust = 0, monto;
          if (esIslr) {
            suj = v.sujeto || '';
            const variant = variantIslr(v.concepto, suj);
            cod = variant ? variant[0] : '';
            sust = parseFloat(v.sustraendo) || 0;
            monto = Math.max(0, base * pct / 100 - sust);
          } else {
            monto = base * pct / 100;
          }
          const p = (v.fecha || '').split('-');
          const fecha = p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0].slice(2)) : '';
          const dir = /^practicada/i.test(v.direccion) ? 'practicada' : 'sufrida';
          // N° de comprobante: ISLR = correlativo simple; IVA = formato AAAAMM+correlativo
          let comp = v.comprobante;
          if (!comp) {
            if (esIslr) { const n = _retData.filter((x) => x.tipo === 'islr').length + 1; comp = String(n).padStart(8, '0'); }
            else { const seq = _retData.filter((x) => x.tipo === 'iva').length + 1; comp = (p.length === 3 ? (p[0] + p[1] + String(seq).padStart(8, '0')) : String(seq).padStart(14, '0')); }
          }
          window.sb.from('retenciones').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
            direccion: dir, tipo: (v.tipo || 'IVA').toLowerCase(), fecha: fecha, comprobante: comp,
            tercero_nombre: v.nombre, tercero_rif: normRif(v.rif), factura: v.factura, numero_control: v.numControl || null,
            base: base, pct: pct, monto: monto, estado: 'Registrado',
            concepto: esIslr ? v.concepto : null, concepto_codigo: esIslr ? cod : null, sujeto: esIslr ? suj : null, sustraendo: sust,
          }).then(({ error }) => {
            if (error) { if (window.toast) window.toast('No se pudo guardar: ' + error.message, 'error'); return; }
            if (window.cargarRetenciones) window.cargarRetenciones();
            if (window.toast) window.toast('Retención registrada · Bs ' + fmt(monto), 'success');
          });
        },
      });
    }
    const addBtn = document.getElementById('retAddBtn');
    if (addBtn) addBtn.addEventListener('click', registrarRetencion);

    // Comprobante de retención: clona el template OFICIAL completo (#compIva/#compIslr)
    // y lo llena con datos reales (firmas, partes, base legal SNAT/2025/000054 o Decreto 1.808).
    async function imprimirComprobante(r) {
      const emp = window.__EMPRESA_ACTIVA || {};
      const esIslr = r.tipo === 'islr';
      const esPract = r.direccion === 'practicada';
      // El agente retiene; el sujeto retenido recibe. Se invierten según la dirección.
      const agente = esPract ? { n: emp.n, rif: emp.rif } : { n: r.tercero_nombre, rif: r.tercero_rif };
      const sujeto = esPract ? { n: r.tercero_nombre, rif: r.tercero_rif } : { n: emp.n, rif: emp.rif };
      // Cada comprobante tiene su propio N° correlativo (control MANUAL del contador). Se agrupan
      // SOLO las retenciones que comparten el mismo N° de comprobante (varias facturas en uno);
      // por defecto cada retención = su propio comprobante con su propio número.
      const ncomp = (r.comprobante || '').trim();
      let grupo = (ncomp ? _retData.filter((x) => x.tipo === r.tipo && x.direccion === r.direccion && (x.comprobante || '').trim() === ncomp) : []);
      if (!grupo.length) grupo = [r];
      grupo.sort((a, b) => ((a.fecha || '').split('/').reverse().join('')).localeCompare((b.fecha || '').split('/').reverse().join('')));
      // Lookup de las facturas del período (montos exactos)
      const facMap = {};
      if (window.sb && emp.id) {
        const { data } = await window.sb.from('libro_fiscal')
          .select('numero_factura, total, base, exento, alicuota, iva')
          .eq('empresa_id', emp.id).eq('tipo', esPract ? 'compra' : 'venta');
        (data || []).forEach((f) => { facMap[(f.numero_factura || '').trim()] = f; });
      }
      const tmpl = document.getElementById(esIslr ? 'compIslr' : 'compIva');
      if (!tmpl) return;
      const node = tmpl.cloneNode(true);
      node.removeAttribute('id'); node.style.display = '';
      const set = (sel, val) => { const el = node.querySelector(sel); if (el != null) el.textContent = val; };
      const setN = (sel, i, val) => { const els = node.querySelectorAll(sel); if (els[i]) els[i].textContent = val; };
      const pctTxt = Number.isInteger(Number(r.pct)) ? String(Number(r.pct)) : Number(r.pct).toFixed(2);
      const p = (r.fecha || '').split('/');
      const anio = p.length === 3 ? (p[2].length === 2 ? '20' + p[2] : p[2]) : '';
      const mes = p.length === 3 ? p[1] : '';
      set('.comp-agent .agent-name', agente.n || '');
      const meta = node.querySelector('.comp-agent .agent-meta');
      if (meta) meta.innerHTML = '<span class="mono">RIF ' + esc(agente.rif || '') + '</span><br>'
        + esc(emp.cond || 'Contribuyente') + ' · ' + (esIslr ? 'Decreto 1.808 (Reglamento ISLR)' : 'Providencia SNAT/2025/000054');
      set('.comp-doc-title .num-box .v', r.comprobante || '');
      setN('.comp-meta-strip .cell .v', 0, r.fecha || '');
      setN('.comp-meta-strip .cell .v', 1, esIslr ? ('Ejercicio ' + anio) : ('Año ' + anio + ' · Mes ' + mes));
      setN('.comp-meta-strip .cell .v', 2, pctTxt + '%');
      setN('.comp-party-grid .pf .v', 0, sujeto.n || '');
      setN('.comp-party-grid .pf .v', 1, sujeto.rif || '');
      setN('.comp-party-grid .pf .v', 2, emp.dom && !esPract ? emp.dom : '—');
      const sujMap = { PNR: 'Natural Residente', PNNR: 'Natural No Residente', PJD: 'Jurídica Domiciliada', PJND: 'Jurídica No Domiciliada' };
      setN('.comp-party-grid .pf .v', 3, esIslr ? (sujMap[r.sujeto] || '—') : 'Contribuyente');
      const tb = node.querySelector('.comp-detail tbody');
      const tf = node.querySelector('.comp-detail tfoot');
      const words = node.querySelector('.comp-amount-words');
      let rowsHtml = '', tMonto = 0, tBase = 0, tTotal = 0, tIva = 0;
      grupo.forEach((rr) => {
        const pctT = Number.isInteger(Number(rr.pct)) ? String(Number(rr.pct)) : Number(rr.pct).toFixed(2);
        const monto = Number(rr.monto) || 0;
        if (esIslr) {
          const base = Number(rr.base) || 0;
          tBase += base; tMonto += monto;
          rowsHtml += '<tr><td class="ctr">' + esc(rr.fecha || '') + '</td><td class="ctr mono">—</td><td class="ctr">FACT</td>'
            + '<td class="ctr mono">' + esc(rr.factura || '—') + '</td><td class="ctr mono">' + esc(rr.numero_control || '—') + '</td>'
            + '<td class="num">' + fmt(base) + '</td><td class="num">' + fmt(base) + '</td><td class="num">' + fmt(base) + '</td>'
            + '<td class="ctr">' + pctT.replace('.', ',') + '</td>'
            + '<td class="concepto">' + esc(rr.concepto || '') + (rr.concepto_codigo ? ' (Cód. ' + esc(rr.concepto_codigo) + ')' : '') + '</td>'
            + '<td class="num">' + fmt(monto) + '</td></tr>';
        } else {
          const fac = facMap[(rr.factura || '').trim()] || null;
          const alic = fac && Number(fac.alicuota) ? Number(fac.alicuota) * 100 : 16;
          const ivaFact = fac ? (Number(fac.iva) || (Number(rr.base) || 0)) : (Number(rr.base) || 0);
          const baseImp = fac ? (Number(fac.base) || 0) : (alic ? ivaFact / (alic / 100) : 0);
          const exento = fac ? (Number(fac.exento) || 0) : 0;
          const total = fac ? (Number(fac.total) || (baseImp + ivaFact + exento)) : (baseImp + ivaFact + exento);
          tTotal += total; tBase += baseImp; tIva += ivaFact; tMonto += monto;
          rowsHtml += '<tr><td>' + esc(rr.fecha || '') + '</td><td class="mono">' + esc(rr.factura || '—') + '</td>'
            + '<td class="mono">' + esc(rr.numero_control || '—') + '</td><td></td><td></td>'
            + '<td class="num">' + fmt(total) + '</td><td class="num"></td><td class="num">' + fmt(baseImp) + '</td>'
            + '<td class="ctr">' + alic + '%</td><td class="num">' + fmt(ivaFact) + '</td><td class="ctr">' + pctT + '%</td>'
            + '<td class="num">' + fmt(monto) + '</td></tr>';
        }
      });
      if (tb) tb.innerHTML = rowsHtml;
      if (esIslr) {
        if (tf) tf.innerHTML = '<tr><td colspan="7" style="text-align:right;">Totales</td><td class="num">' + fmt(tBase) + '</td><td></td><td></td><td class="num highlight">' + fmt(tMonto) + '</td></tr>';
        if (words) words.innerHTML = 'Total ISLR retenido: <strong>Bs ' + fmt(tMonto) + '</strong> · ' + grupo.length + ' operación(es) en este comprobante.';
      } else {
        if (tf) tf.innerHTML = '<tr><td colspan="5" style="text-align:right;">Totales</td><td class="num">' + fmt(tTotal) + '</td><td class="num">0,00</td><td class="num">' + fmt(tBase) + '</td><td></td><td class="num">' + fmt(tIva) + '</td><td></td><td class="num highlight">' + fmt(tMonto) + '</td></tr>';
        if (words) words.innerHTML = 'Total IVA retenido: <strong>Bs ' + fmt(tMonto) + '</strong> · ' + grupo.length + ' factura(s) en este comprobante. Monto neto a cancelar: <strong>Bs ' + fmt(Math.max(0, tTotal - tMonto)) + '</strong>.';
      }
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      portal.appendChild(node);
      document.body.classList.add('printing-comp');
      if (window.lucide) window.lucide.createIcons();
      window.print();
    }

    // Editar / eliminar: clic en cualquier fila de retención
    function editRetencion(id) {
      const r = _retData.find((x) => String(x.id) === String(id));
      if (!r) return;
      window.openFormModal && window.openFormModal({
        title: 'Editar retención',
        saveLabel: 'Guardar cambios',
        fields: [
          { name: 'direccion', label: 'Dirección', type: 'select', options: ['Practicada (yo retengo a un proveedor)', 'Sufrida (un cliente me retiene)'], value: r.direccion === 'practicada' ? 'Practicada (yo retengo a un proveedor)' : 'Sufrida (un cliente me retiene)' },
          { name: 'tipo', label: 'Impuesto', type: 'select', options: ['IVA', 'ISLR'], value: r.tipo === 'islr' ? 'ISLR' : 'IVA' },
          { name: 'concepto', label: 'Concepto de retención (ISLR)', col: 2, type: 'select', options: CONCEPTOS_ISLR.map((c) => c.act), value: r.concepto || CONCEPTOS_ISLR[0].act },
          { name: 'sujeto', label: 'Tipo de sujeto (ISLR)', type: 'select', options: [{ value: 'PNR', label: 'PN Residente' }, { value: 'PNNR', label: 'PN No Residente' }, { value: 'PJD', label: 'PJ Domiciliada' }, { value: 'PJND', label: 'PJ No Domiciliada' }], value: r.sujeto || 'PNR' },
          { name: 'fecha', label: 'Fecha (dd/mm/aa)', value: r.fecha || '' },
          { name: 'nombre', label: 'Tercero', col: 2, value: r.tercero_nombre || '' },
          { name: 'rif', label: 'RIF', upper: true, value: r.tercero_rif || '' },
          { name: 'factura', label: 'Factura afectada', value: r.factura || '' },
          { name: 'numControl', label: 'N° de Control', value: r.numero_control || '' },
          { name: 'comprobante', label: 'N° Comprobante', value: r.comprobante || '' },
          { name: 'base', label: 'Base imponible / monto del pago (Bs)', type: 'number', step: '0.01', value: r.base != null ? String(r.base) : '' },
          { name: 'pct', label: '% de retención', type: 'number', step: '0.01', value: r.pct != null ? String(r.pct) : '' },
          { name: 'sustraendo', label: 'Sustraendo (ISLR)', type: 'number', step: '0.01', value: r.sustraendo != null ? String(r.sustraendo) : '0' },
        ],
        afterRender: (body) => { setupPctField(body); setupIslrFields(body); },
        extraLabel: 'Comprobante',
        onExtra: () => imprimirComprobante(r),
        onSave: (v) => {
          if (!window.sb) return 'Sin conexión.';
          if (!v.nombre) return 'Indica el tercero.';
          const esIslr = /islr/i.test(v.tipo);
          const base = parseFloat(v.base) || 0, pct = parseFloat(v.pct) || 0;
          let cod = '', suj = '', sust = 0, monto;
          if (esIslr) {
            suj = v.sujeto || '';
            const variant = variantIslr(v.concepto, suj);
            cod = variant ? variant[0] : '';
            sust = parseFloat(v.sustraendo) || 0;
            monto = Math.max(0, base * pct / 100 - sust);
          } else {
            monto = base * pct / 100;
          }
          const dir = /^practicada/i.test(v.direccion) ? 'practicada' : 'sufrida';
          window.sb.from('retenciones').update({
            direccion: dir, tipo: (v.tipo || 'IVA').toLowerCase(), fecha: v.fecha,
            comprobante: v.comprobante, tercero_nombre: v.nombre, tercero_rif: normRif(v.rif),
            factura: v.factura, numero_control: v.numControl || null, base: base, pct: pct, monto: monto,
            concepto: esIslr ? v.concepto : null, concepto_codigo: esIslr ? cod : null, sujeto: esIslr ? suj : null, sustraendo: sust,
          }).eq('id', id).then(({ error }) => {
            if (error) { if (window.toast) window.toast('No se pudo actualizar: ' + error.message, 'error'); return; }
            if (window.cargarRetenciones) window.cargarRetenciones();
            if (window.toast) window.toast('Retención actualizada · Bs ' + fmt(monto), 'success');
          });
        },
        onDelete: (closeModal) => {
          if (!window.confirm('¿Eliminar esta retención? Esta acción no se puede deshacer.')) return;
          window.sb.from('retenciones').delete().eq('id', id).then(({ error }) => {
            if (error) { if (window.toast) window.toast('No se pudo eliminar: ' + error.message, 'error'); return; }
            if (window.cargarRetenciones) window.cargarRetenciones();
            if (window.toast) window.toast('Retención eliminada', 'success');
          });
          closeModal();
        },
      });
    }
    views.forEach((v) => v.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) editRetencion(tr.dataset.id);
    }));

    // Estado inicial
    cargarRetenciones();
  })();

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
        const c = [...tr.querySelectorAll('td')].slice(0, 7).map((td) => td.textContent.replace(/\s+/g, ' ').trim());
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
      view.querySelectorAll('.conta-tab[data-tab="diario"] .asiento').forEach((a) => {
        const num = (a.querySelector('.asiento-num') || {}).textContent || '';
        const fecha = (a.querySelector('.asiento-date') || {}).textContent.trim() || '';
        const desc = (a.querySelector('.asiento-desc') || {}).textContent || '';
        const ref = (a.querySelector('.asiento-ref') || {}).textContent.replace('Ref:', '').trim() || '';
        a.querySelectorAll('tbody tr').forEach((tr) => {
          const c = tr.querySelectorAll('td');
          rows.push([num, fecha, desc, ref, c[1] ? c[1].textContent : '', c[2] ? c[2].textContent : '', c[3] ? c[3].textContent : '']);
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
      // Asientos del Diario en orden cronológico ascendente (el DOM va descendente)
      const asientos = Array.from(view.querySelectorAll('.conta-tab[data-tab="diario"] .asiento')).reverse();
      const movs = [];
      asientos.forEach((a) => {
        const fecha = ((a.querySelector('.asiento-date') || {}).textContent || '').trim();
        const anum = ((a.querySelector('.asiento-num') || {}).textContent || '').trim();
        const desc = ((a.querySelector('.asiento-desc') || {}).textContent || '').trim();
        const ref = ((a.querySelector('.asiento-ref') || {}).textContent || '').replace('Ref:', '').trim();
        a.querySelectorAll('tbody tr').forEach((tr) => {
          const td = tr.querySelectorAll('td');
          if (td.length < 4) return;
          if (td[0].textContent.trim() !== code) return;
          movs.push({ fecha, anum, desc, ref, deb: num2(td[2].textContent), haber: num2(td[3].textContent) });
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
      const exenta = eAct.declaraDpp === false;
      const doc = $('pensionDoc');
      let banner = $('dppExentoBanner');
      if (!banner && doc && doc.parentElement) {
        banner = document.createElement('div');
        banner.id = 'dppExentoBanner';
        banner.style.cssText = 'display:none;margin:10px 0;padding:12px 14px;border:1px solid var(--border-strong);border-radius:10px;font-size:13px;color:var(--fg-muted);';
        banner.innerHTML = '✅ <strong>Esta empresa no declara Protección a las Pensiones</strong> — emprendimiento exento. Cálculo, planilla y avisos de DPP desactivados para ella.';
        doc.parentElement.insertBefore(banner, doc);
      }
      if (banner) banner.style.display = exenta ? 'block' : 'none';
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

    function saldoDe(cid) {
      const c = _cuentas.find((x) => x.id === cid);
      let s = c ? Number(c.saldo_inicial) || 0 : 0;
      _movs.filter((m) => m.cuenta_teso_id === cid).forEach((m) => { s += (m.tipo === 'ingreso' ? 1 : -1) * (Number(m.monto) || 0); });
      return s;
    }

    async function cargarTesoreria() {
      const emp = window.__EMPRESA_ACTIVA;
      const rifEl = document.getElementById('tesoRif'); if (rifEl) rifEl.textContent = (emp && emp.rif) || '—';
      if (!window.sb || !emp || !emp.id) { _cuentas = []; _movs = []; _facturas = []; render(); return; }
      const [r1, r2, r3, r4] = await Promise.all([
        window.sb.from('cuentas_tesoreria').select('*').eq('empresa_id', emp.id).order('creado_en'),
        // Movimientos y compras pueden superar 1000 filas → paginado (evita el tope de PostgREST)
        window.__sbAll((q) => q.eq('empresa_id', emp.id), 'movimientos_tesoreria', '*'),
        // Ventas = RECIBOS emitidos (control de cobros), por empresa. NO el libro de ventas (ese es solo para declarar).
        window.__sbAll((q) => q.eq('tipo', 'venta').eq('empresa_id', emp.id), 'facturas', 'numero, cliente_nombre, cliente_rif, total, fecha, estado, condicion'),
        // Compras = facturas registradas en el Libro de Compras (lo que le debes al proveedor).
        window.__sbAll((q) => q.eq('empresa_id', emp.id).eq('tipo', 'compra'), 'libro_fiscal', 'id, numero_factura, tercero_nombre, tercero_rif, total, fecha'),
      ]);
      if (r1.error) { console.warn('[DigiAccount] Tesorería:', r1.error.message); }
      _cuentas = r1.data || []; _movs = r2.data || [];
      const ventas = (r3.data || []).filter((f) => !/anulada/i.test(f.estado || '')).map((f) => ({ ref: f.numero, tercero_nombre: f.cliente_nombre, tercero_rif: f.cliente_rif, total: f.total, fecha: f.fecha, tipo: 'venta', condicion: f.condicion, estado: f.estado }));
      // Modelo del contador externo: en modo LIBRO (fiscal) las compras se presumen PAGADAS
      // al momento (por banco) — el asiento ya acreditó Bancos. Si el cliente da el detalle
      // real de cobranza, se registran pagos y el saldo se ajusta.
      const presunto = (emp.modo === 'libro');
      const compras = (r4.data || []).map((f) => ({ _id: f.id, ref: f.numero_factura, tercero_nombre: f.tercero_nombre, tercero_rif: f.tercero_rif, total: f.total, fecha: f.fecha, tipo: 'compra', presuntoPagado: presunto }));
      _facturas = ventas.concat(compras);
      render();
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
            + '<td class="num">' + fmt(m.__saldo) + ' ' + clip + '<button class="btn btn-ghost" data-teso-delmov="' + esc(m.id) + '" title="Eliminar" style="height:22px;font-size:10px;padding:0 6px;color:#c0392b;"><i data-lucide="x" style="width:11px;height:11px;"></i></button></td></tr>';
        }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--fg-muted);padding:16px;">Sin movimientos. Usa "Registrar movimiento".</td></tr>';
      }
      const cf = view.querySelector('.teso-tab[data-tab="resumen"] .table-footer .count');
      if (cf) cf.innerHTML = 'Mostrando <strong>' + _movs.length + '</strong> movimiento' + (_movs.length === 1 ? '' : 's');
      renderCxCxP();
      if (window.__poblarConcilCuentas) window.__poblarConcilCuentas();
      if (window.lucide) window.lucide.createIcons();
    }

    // Cuánto se ha cobrado/pagado de una factura: suma de movimientos vinculados por factura_ref
    function pagadoDe(fac) {
      const ref = (fac.ref || '').trim(); if (!ref) return 0;
      const wantTipo = fac.tipo === 'venta' ? 'ingreso' : 'egreso';
      return _movs.filter((m) => m.tipo === wantTipo && (m.factura_ref || '').trim() === ref).reduce((s, m) => s + (Number(m.monto) || 0), 0);
    }
    function badge(txt, color, bg) { return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;color:' + color + ';background:' + bg + ';">' + txt + '</span>'; }
    function renderCxList(tipo, bodyId, totalId, countId, tabCountId) {
      const body = document.getElementById(bodyId); if (!body) return;
      const rows = _facturas.filter((f) => f.tipo === tipo).map((f) => {
        const total = Number(f.total) || 0; const pagReal = pagadoDe(f);
        // Presunción de pago (modo libro): si no hay pagos reales registrados, se toma como pagada.
        const pag = (f.presuntoPagado && pagReal <= 0.01) ? total : pagReal;
        const pend = Math.max(0, total - pag);
        return { f: f, total: total, pag: pag, pend: pend, presunto: f.presuntoPagado && pagReal <= 0.01 };
      }).sort((a, b) => b.pend - a.pend);
      let totalPend = 0, pendientes = 0;
      const esVenta = tipo === 'venta';
      const html = rows.map((r) => {
        if (r.pend > 0.01) { pendientes++; totalPend += r.pend; }
        const estado = r.presunto ? badge('Pagada', '#0a7a44', '#d5f0e0') : (r.pend <= 0.01 ? badge('Pagada', '#0a7a44', '#d5f0e0') : (r.pag > 0.01 ? badge('Parcial', '#9a6700', '#fdf0d0') : badge('Pendiente', '#b42318', '#fde0dd')));
        let accion = '';
        if (r.pend > 0.01) {
          accion = ' <button class="btn btn-ghost" data-cx-accion="' + (esVenta ? 'cobrar' : 'pagar') + '" data-ref="' + esc(r.f.ref || '') + '" data-terc="' + esc(r.f.tercero_nombre || '') + '" data-pend="' + r.pend.toFixed(2) + '" style="height:22px;font-size:10px;padding:0 9px;margin-left:6px;">' + (esVenta ? 'Cobrar' : 'Pagar') + '</button>';
        }
        // Compras: editar/eliminar la factura registrada (sin necesidad del módulo Fiscal)
        if (!esVenta && r.f._id) {
          accion += ' <button class="btn btn-ghost" data-cx-edit="' + esc(r.f._id) + '" title="Editar o eliminar esta compra" style="height:22px;font-size:10px;padding:0 7px;margin-left:4px;"><i data-lucide="pencil" style="width:11px;height:11px;"></i></button>';
        }
        return '<tr><td class="primary">' + esc(r.f.tercero_nombre || '—') + '</td><td class="mono">' + esc(r.f.tercero_rif || '') + '</td><td>' + esc(r.f.ref || '') + '</td><td>' + esc(r.f.fecha || '') + '</td>'
          + '<td class="num">' + fmt(r.total) + '</td><td class="num" style="color:#0a7a44;">' + fmt(r.pag) + '</td>'
          + '<td class="num" style="font-weight:700;' + (r.pend > 0.01 ? 'color:#b42318;' : 'color:var(--fg-muted);') + '">' + fmt(r.pend) + '</td><td style="white-space:nowrap;">' + estado + accion + '</td></tr>';
      });
      body.innerHTML = html.length ? html.join('') : '<tr><td colspan="8" style="text-align:center;color:var(--fg-muted);padding:24px;">' + (esVenta ? 'Sin recibos de venta emitidos.' : 'Sin facturas de compra registradas.') + '</td></tr>';
      const tEl = document.getElementById(totalId); if (tEl) tEl.textContent = 'Bs ' + fmt(totalPend);
      const cEl = document.getElementById(countId); if (cEl) cEl.innerHTML = '<strong>' + pendientes + '</strong> con saldo pendiente · ' + rows.length + ' factura' + (rows.length === 1 ? '' : 's') + ' en total';
      const tc = document.getElementById(tabCountId); if (tc) { tc.textContent = String(pendientes); tc.style.display = pendientes > 0 ? '' : 'none'; }
      // KPI de la vista Compras y CxP
      if (!esVenta) {
        const k = document.getElementById('cxpKpiTotal'); if (k) k.textContent = fmt(totalPend);
        const km = document.getElementById('cxpKpiMeta'); if (km) km.textContent = pendientes + ' factura' + (pendientes === 1 ? '' : 's') + ' pendiente' + (pendientes === 1 ? '' : 's');
      }
    }
    function renderCxCxP() {
      renderCxList('venta', 'cxcBody', 'cxcTotalSum', 'cxcCount', 'cxcTabCount');
      renderCxList('compra', 'cxpBody', 'cxpTotalSum', 'cxpCount', 'cxpTabCount');
    }

    view.addEventListener('click', async (e) => {
      const dc = e.target.closest('[data-teso-delcuenta]');
      const dm = e.target.closest('[data-teso-delmov]');
      const vc = e.target.closest('[data-teso-vercomp]');
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
            if (exceso > 0.005) lineas.push({ cta: '1.1.4.01 · Anticipos a proveedores', debe: 0, haber: exceso });
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
    // Tras un cobro, actualiza el ESTADO del recibo: Cobrada (total) o Abonada (parcial)
    async function actualizarEstadoRecibo(ref) {
      try {
        const { data: f } = await window.sb.from('facturas').select('id, total').eq('numero', ref).eq('tipo', 'venta').maybeSingle();
        if (!f) return;
        const { data: movs } = await window.sb.from('movimientos_tesoreria').select('monto').eq('factura_ref', ref).eq('tipo', 'ingreso');
        const pagado = (movs || []).reduce((s, m) => s + (Number(m.monto) || 0), 0);
        const estado = pagado >= (Number(f.total) || 0) - 0.01 ? 'Cobrada' : (pagado > 0.01 ? 'Abonada' : 'Por cobrar');
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
        title: pre.factura ? 'Registrar cobro · ' + pre.factura : 'Registrar movimiento',
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
          tipoSel.addEventListener('change', () => { refrescarTerceros(); refrescarFacturas(); });
          terc.addEventListener('change', refrescarFacturas); terc.addEventListener('input', refrescarFacturas);
          fact.addEventListener('change', autollenar); fact.addEventListener('input', autollenar);
          refrescarTerceros(); refrescarFacturas(); autollenar();
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
                  if (exceso > 0.005) lineas.push({ cta: '1.1.4.01 · Anticipos a proveedores', debe: exceso, haber: 0 });
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

    // ===== Conciliación bancaria: cruza el extracto (CSV) contra los movimientos registrados =====
    (function setupConciliacion() {
      const cuentaSel = document.getElementById('concilCuenta');
      const fileEl = document.getElementById('concilFile');
      const fileName = document.getElementById('concilFileName');
      const cargarBtn = document.getElementById('concilCargarBtn');
      const confirmBtn = document.getElementById('concilConfirmBtn');
      const msgEl = document.getElementById('concilMsg');
      if (!cargarBtn || !cuentaSel) return;
      let lineasBanco = [], ultimoMatch = [];
      const setMsg = (t) => { if (msgEl) msgEl.innerHTML = t; };

      window.__poblarConcilCuentas = () => {
        const prev = cuentaSel.value;
        cuentaSel.innerHTML = _cuentas.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.nombre) + '</option>').join('');
        if (prev && _cuentas.some((c) => c.id === prev)) cuentaSel.value = prev;
      };

      function num(s) {
        s = String(s == null ? '' : s).trim().replace(/[^\d.,-]/g, '');
        if (!s) return 0;
        if (s.indexOf(',') > -1 && s.indexOf('.') > -1) s = s.replace(/\./g, '').replace(',', '.');
        else if (s.indexOf(',') > -1) s = s.replace(',', '.');
        return parseFloat(s) || 0;
      }
      function parseCSV(text) {
        const firstLine = (text.split(/\r?\n/).find((r) => r.trim()) || '');
        const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
        const rows = text.split(/\r?\n/).filter((r) => r.trim()).map((r) => r.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));
        if (!rows.length) return [];
        const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const head = rows[0].map(norm);
        const findCol = (...kw) => head.findIndex((h) => kw.some((k) => h.indexOf(k) > -1));
        let ciFecha = findCol('fecha', 'date');
        let ciDesc = findCol('descrip', 'concepto', 'detalle');
        let ciRef = findCol('referencia', 'comprobante', 'documento', 'nro', 'numero', 'ref');
        let ciMonto = findCol('monto', 'importe', 'valor');
        const ciDeb = findCol('debito', 'debe', 'cargo', 'retiro');
        const ciCred = findCol('credito', 'haber', 'abono', 'deposito');
        const hasHeader = ciFecha > -1 || ciMonto > -1 || (ciDeb > -1 && ciCred > -1);
        const body = hasHeader ? rows.slice(1) : rows;
        if (!hasHeader) { ciFecha = 0; ciDesc = 1; ciRef = 2; ciMonto = 3; }
        return body.map((r) => {
          let monto;
          if (ciMonto > -1) monto = num(r[ciMonto]);
          else { const d = ciDeb > -1 ? num(r[ciDeb]) : 0; const c = ciCred > -1 ? num(r[ciCred]) : 0; monto = c - d; }
          return { fecha: (ciFecha > -1 && r[ciFecha]) || '', desc: (ciDesc > -1 && r[ciDesc]) || '', ref: (ciRef > -1 && r[ciRef]) || '', monto: monto };
        }).filter((l) => Math.abs(l.monto) > 0.005);
      }
      const montoMov = (m) => (m.tipo === 'ingreso' ? 1 : -1) * (Number(m.monto) || 0);

      function conciliar() {
        const cid = cuentaSel.value;
        if (!cid) { setMsg('Elige una cuenta.'); return; }
        if (!lineasBanco.length) { setMsg('Sube primero el extracto del banco (PDF o CSV).'); return; }
        const movs = _movs.map((m, i) => ({ m: m, i: i })).filter((x) => x.m.cuenta_teso_id === cid);
        const usados = new Set();
        const matched = [], soloBanco = [];
        // Referencias: solo dígitos y sin ceros a la izquierda (el banco suele anteponer ceros)
        const normRef = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
        lineasBanco.forEach((lb) => {
          const rb = normRef(lb.ref);
          // Pase 1: referencia + monto (máxima certeza) · Pase 2: solo monto
          let cand = null;
          if (rb.length >= 4) {
            cand = movs.find((x) => {
              if (usados.has(x.i) || Math.abs(montoMov(x.m) - lb.monto) >= 0.01) return false;
              const rm = normRef(x.m.referencia);
              return rm.length >= 4 && (rm === rb || rb.endsWith(rm) || rm.endsWith(rb));
            });
          }
          if (!cand) cand = movs.find((x) => !usados.has(x.i) && Math.abs(montoMov(x.m) - lb.monto) < 0.01);
          if (cand) { usados.add(cand.i); matched.push({ banco: lb, mov: cand.m }); } else soloBanco.push(lb);
        });
        const soloLibros = movs.filter((x) => !usados.has(x.i)).map((x) => x.m);
        ultimoMatch = matched;
        render(cid, matched, soloBanco, soloLibros);
      }

      // Respaldo del extracto importado en la base (auditoría; ignora duplicados por huella)
      async function persistirExtracto(res) {
        const cid = cuentaSel.value;
        if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id || !cid) return;
        const p = String(res.periodo_desde || '').split('/');
        const periodo = p.length === 3 ? (p[2] + '-' + p[1]) : new Date().toISOString().slice(0, 7);
        const vistos = {};
        const filas = (res.movimientos || []).map((m) => {
          const base = [m.fecha, m.referencia, m.monto, m.descripcion].join('|');
          const k = (vistos[base] = (vistos[base] || 0) + 1);
          return {
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, cuenta_teso_id: cid,
            fecha: m.fecha || '', descripcion: m.descripcion || '', referencia: m.referencia || '',
            monto: m.monto, periodo: periodo, huella: base + '|' + k,
          };
        });
        for (let i = 0; i < filas.length; i += 200) {
          await window.sb.from('extracto_bancario').upsert(filas.slice(i, i + 200), { onConflict: 'cuenta_teso_id,huella', ignoreDuplicates: true });
        }
      }

      function render(cid, matched, soloBanco, soloLibros) {
        const cuadre = document.getElementById('concilCuadre'); if (cuadre) cuadre.hidden = false;
        const res = document.getElementById('concilResultados'); if (res) res.hidden = false;
        const saldoLibros = saldoDe(cid);
        const sumBanco = soloBanco.reduce((s, l) => s + l.monto, 0);
        const sumLibros = soloLibros.reduce((s, m) => s + montoMov(m), 0);
        const dif = sumBanco - sumLibros;
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        set('concilSaldoLibros', fmt(saldoLibros));
        set('concilSinConciliar', String(soloBanco.length + soloLibros.length));
        set('concilSinConciliarMeta', soloBanco.length + ' en banco · ' + soloLibros.length + ' en libros');
        set('concilDiferencia', fmt(dif));
        const difMeta = document.getElementById('concilDifMeta');
        if (difMeta) difMeta.textContent = (Math.abs(dif) < 0.01 && !soloBanco.length) ? '✓ Conciliado' : 'Registra las partidas del banco para cuadrar';
        const sb = document.getElementById('concilSoloBanco');
        if (sb) { sb.__data = soloBanco; sb.innerHTML = soloBanco.length ? soloBanco.map((lb, k) => {
          const neg = lb.monto < 0;
          return '<tr><td>' + esc(lb.fecha) + '</td><td class="primary">' + esc(lb.desc || '—') + '</td><td class="mono">' + esc(lb.ref || '') + '</td>'
            + '<td class="num" style="color:' + (neg ? '#b42318' : '#0a7a44') + ';">' + (neg ? '− ' : '+ ') + fmt(Math.abs(lb.monto)) + '</td>'
            + '<td><button class="btn btn-primary" data-concil-reg="' + k + '" style="height:24px;font-size:10px;padding:0 9px;">Registrar</button></td></tr>';
        }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--fg-muted);padding:14px;">Nada pendiente del banco ✓</td></tr>'; }
        const sl = document.getElementById('concilSoloLibros');
        if (sl) sl.innerHTML = soloLibros.length ? soloLibros.map((m) => {
          const v = montoMov(m), neg = v < 0;
          return '<tr><td>' + esc(m.fecha || '') + '</td><td class="primary">' + esc(m.concepto || '') + '</td><td class="mono">' + esc(m.referencia || '') + '</td>'
            + '<td class="num" style="color:' + (neg ? '#b42318' : '#0a7a44') + ';">' + (neg ? '− ' : '+ ') + fmt(Math.abs(v)) + '</td></tr>';
        }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--fg-muted);padding:14px;">Nada en tránsito ✓</td></tr>';
        const mt = document.getElementById('concilMatched');
        if (mt) mt.innerHTML = matched.length ? matched.map((pr) =>
          '<tr><td>' + esc(pr.mov.fecha || '') + '</td><td class="primary">' + esc(pr.mov.concepto || '') + '</td>'
          + '<td class="num">' + fmt(montoMov(pr.mov)) + '</td><td class="num">' + fmt(pr.banco.monto) + '</td>'
          + '<td>' + badge('Conciliado', '#0a7a44', '#d5f0e0') + '</td></tr>').join('')
          : '<tr><td colspan="5" style="text-align:center;color:var(--fg-muted);padding:14px;">Aún no hay coincidencias.</td></tr>';
        set('concilSoloBancoCount', soloBanco.length);
        set('concilSoloLibrosCount', soloLibros.length);
        set('concilMatchedCount', matched.length);
        if (confirmBtn) confirmBtn.disabled = !matched.length;
        setMsg('Cruzadas <strong>' + lineasBanco.length + '</strong> líneas del banco. <strong>' + matched.length + '</strong> conciliadas, ' + soloBanco.length + ' por registrar.');
        if (window.lucide) window.lucide.createIcons();
      }

      function registrarDiferencia(lb, cid) {
        const cta = _cuentas.find((c) => c.id === cid);
        const esCaja = cta && /efectivo|caja/i.test((cta.tipo || '') + ' ' + (cta.nombre || ''));
        const ctaCash = esCaja ? '1.1.1.01 · Caja' : '1.1.1.03 · Bancos';
        const ingreso = lb.monto > 0;
        const CONTRA = ingreso
          ? ['4.2.1.01 · Ingresos financieros', '4.2.2.01 · Ganancia en cambio', '1.1.2.01 · Cuentas por cobrar comerciales']
          : ['6.3.1.02 · Gastos y comisiones bancarias', '6.3.1.04 · IGTF (gasto)', '6.3.1.03 · Pérdida en cambio', '2.1.1.01 · Cuentas por pagar comerciales'];
        window.openFormModal && window.openFormModal({
          title: 'Registrar partida del banco', saveLabel: 'Registrar',
          fields: [
            { name: 'concepto', label: 'Concepto', col: 2, value: lb.desc || (ingreso ? 'Abono bancario' : 'Cargo bancario') },
            { name: 'monto', label: 'Monto (Bs)', type: 'number', step: '0.01', value: Math.abs(lb.monto).toFixed(2) },
            { name: 'tipo', label: 'Tipo', type: 'select', value: ingreso ? 'ingreso' : 'egreso', options: [{ value: 'ingreso', label: 'Ingreso (abono)' }, { value: 'egreso', label: 'Egreso (cargo)' }] },
            { name: 'contra', label: 'Contrapartida contable (cuenta del otro lado)', col: 2, type: 'datalist', value: CONTRA[0], options: CONTRA },
            { name: 'ref', label: 'Referencia', value: lb.ref || '' },
            { name: 'fecha', label: 'Fecha', type: 'date' },
          ],
          onSave: (v) => {
            if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay empresa activa.';
            const monto = parseFloat(v.monto) || 0; if (monto <= 0) return 'Indica un monto válido.';
            const p = (v.fecha || '').split('-'); const fecha = p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0].slice(2)) : (lb.fecha || '');
            window.sb.from('movimientos_tesoreria').insert({
              cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, cuenta_teso_id: cid,
              fecha: fecha, concepto: v.concepto, tipo: v.tipo, referencia: v.ref || null, monto: monto, conciliado: true,
            }).then(({ error }) => {
              if (error) { toast('No se pudo registrar: ' + error.message, 'error'); return; }
              if (window.__postAsiento && v.contra) {
                const ln = v.tipo === 'ingreso'
                  ? [{ cta: ctaCash, debe: monto, haber: 0 }, { cta: v.contra, debe: 0, haber: monto }]
                  : [{ cta: v.contra, debe: monto, haber: 0 }, { cta: ctaCash, debe: 0, haber: monto }];
                window.__postAsiento('Conciliación · ' + (v.concepto || '') + ' (' + (cta ? cta.nombre : '') + ')', v.ref || 'CONC', ln, 'auto');
              }
              toast('Partida registrada y conciliada', 'success');
              cargarTesoreria().then(() => conciliar());
            });
          },
        });
      }

      const sbBody = document.getElementById('concilSoloBanco');
      if (sbBody) sbBody.addEventListener('click', (e) => {
        const b = e.target.closest('[data-concil-reg]'); if (!b) return;
        const lb = (sbBody.__data || [])[parseInt(b.dataset.concilReg, 10)];
        if (lb) registrarDiferencia(lb, cuentaSel.value);
      });
      if (fileEl) fileEl.addEventListener('change', () => { const f = fileEl.files && fileEl.files[0]; if (fileName) fileName.textContent = f ? f.name : ''; });
      cargarBtn.addEventListener('click', async () => {
        const f = fileEl && fileEl.files && fileEl.files[0];
        if (!f) { setMsg('Primero elige el archivo del extracto (PDF del banco o CSV).'); return; }
        if (!cuentaSel.value) { setMsg('Elige primero la cuenta bancaria a conciliar.'); return; }
        const esPdf = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name || '');
        if (esPdf) {
          // 🤖 PDF → Agente IA (asíncrono: se envía y se espera el resultado en trabajos_ia)
          if (!(window.__ES_FUNDADOR || window.__ADDON_AGENTES)) { setMsg('La lectura de PDF con IA es parte del add-on <strong>Agentes IA</strong>. Mientras tanto puedes cargar el extracto en formato CSV.'); return; }
          if (!window.__extraerEstadoCuenta || !window.__esperarTrabajoIA) { setMsg('El lector de PDF no está disponible.'); return; }
          cargarBtn.disabled = true;
          setMsg('🤖 Enviando el estado de cuenta al <strong>Agente IA</strong>…');
          const envio = await window.__extraerEstadoCuenta(f);
          if (!envio.ok) { setMsg('⚠️ ' + esc(envio.error || 'No se pudo enviar')); cargarBtn.disabled = false; return; }
          setMsg('🤖 El Agente está leyendo el estado de cuenta… los extractos largos tardan <strong>hasta 7 minutos</strong>. Puedes usar otros módulos mientras — pero no recargues la página.');
          const res = await window.__esperarTrabajoIA(envio.job, (n, seg) => {
            setMsg('🤖 Leyendo el estado de cuenta… ' + (seg < 60 ? seg + ' s' : Math.round(seg / 6) / 10 + ' min') + ' transcurridos (hasta ~7 min en extractos largos)');
          });
          cargarBtn.disabled = false;
          if (!res || !res.ok) { setMsg('⚠️ No se pudo leer el PDF: ' + esc((res && res.error) || 'error desconocido')); return; }
          lineasBanco = (res.movimientos || []).map((m) => ({ fecha: m.fecha || '', desc: m.descripcion || '', ref: m.referencia || '', monto: m.monto }));
          persistirExtracto(res).catch(() => {});
          const infoCuadre = (res.cuadra === false)
            ? ' · <span style="color:#b42318;font-weight:700;">⚠️ OJO: la lectura NO cuadra con los saldos del extracto (dif. Bs ' + fmt(Math.abs(res.diferencia || 0)) + ') — verifica contra el PDF</span>'
            : (res.cuadra === true ? ' · ✓ verificado: cuadra con los saldos del banco (' + fmt(res.saldo_inicial) + ' → ' + fmt(res.saldo_final) + ')' : '');
          setMsg('Extracto de <strong>' + esc(res.banco || 'tu banco') + '</strong> leído: <strong>' + lineasBanco.length + '</strong> movimientos' + infoCuadre);
          if (lineasBanco.length) conciliar();
        } else {
          const reader = new FileReader();
          reader.onload = () => { lineasBanco = parseCSV(String(reader.result || '')); if (!lineasBanco.length) { setMsg('No pude leer líneas. Revisa que el CSV tenga columnas fecha/monto (o débito/crédito).'); return; } conciliar(); };
          reader.readAsText(f);
        }
      });
      if (confirmBtn) confirmBtn.addEventListener('click', async () => {
        const ids = ultimoMatch.map((pr) => pr.mov.id).filter(Boolean);
        if (!ids.length || !window.sb) return;
        const { error } = await window.sb.from('movimientos_tesoreria').update({ conciliado: true }).in('id', ids);
        if (error) { toast('No se pudo confirmar: ' + error.message, 'error'); return; }
        toast(ids.length + ' movimiento(s) marcados como conciliados', 'success');
        cargarTesoreria();
      });
    })();
    // Botones "Cobrar" (CxC en Ventas) y "Pagar" (CxP en Compras): abren el movimiento prefilleado
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cx-accion]');
      if (b) { registrarMovimiento({ tipo: b.dataset.cxAccion === 'cobrar' ? 'ingreso' : 'egreso', tercero: b.dataset.terc, factura: b.dataset.ref, monto: b.dataset.pend }); return; }
      const ed = e.target.closest('[data-cx-edit]');
      if (ed && window.__editLibroFiscal) window.__editLibroFiscal(ed.dataset.cxEdit, 'compra');
    });
    cargarTesoreria();
  })();

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

    async function cargarEventos() {
      const emp = window.__EMPRESA_ACTIVA;
      if (!window.sb || !emp || !emp.id) { EVENTOS = []; return; }
      const digitos = String(emp.rif || '').replace(/\D/g, '');
      const terminal = digitos.slice(-1);
      if (!terminal) { EVENTOS = []; return; }
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
      if (error) { console.warn('[Calendario] ', error.message); EVENTOS = []; return; }
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

    async function refrescar() {
      const emp = window.__EMPRESA_ACTIVA;
      const clave = (emp && emp.id ? emp.id : 'sin') + '|' + y;
      if (clave !== cargadoPara) { cargadoPara = clave; await cargarEventos(); }
      render();
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
      // Por período: exporta el más reciente
      const grupos = {};
      iva.forEach((r) => { const per = periodoDe(r.fecha); (grupos[per] = grupos[per] || []).push(r); });
      const periodos = Object.keys(grupos).filter(Boolean).sort();
      const periodo = periodos[periodos.length - 1] || '';
      const rows = grupos[periodo] || [];
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
      const fname = (esPract ? 'RET_IVA_' : 'INF_IVA_PROV_') + rifEmp + '_' + periodo + '.txt';
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
      if (window.toast) window.toast('TXT IVA ' + (esPract ? '(agente, practicadas)' : '(informativa proveedor, sufridas)') + ' · período ' + periodo + ' · ' + rows.length + ' registro(s)' + (periodos.length > 1 ? ' (hay otros períodos sin exportar)' : ''), 'success');
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
    const numControl = (c) => { const s = (c || '').replace(/[^a-zA-Z0-9]/g, ''); return s ? s.slice(-8) : 'NA'; };
    btn.addEventListener('click', () => {
      const emp = window.__EMPRESA_ACTIVA || {};
      const rifAgente = norm(emp.rif);
      const todas = (window.__getRetenciones ? window.__getRetenciones() : []);
      const islr = todas.filter((r) => r.tipo === 'islr' && r.direccion === 'practicada');
      if (!islr.length) { if (window.toast) window.toast('No hay retenciones de ISLR practicadas para exportar.', 'error'); return; }
      // La Relación Informativa es mensual: agrupa por período y exporta el más reciente
      const grupos = {};
      islr.forEach((r) => { const per = periodoDe(r.fecha); (grupos[per] = grupos[per] || []).push(r); });
      const periodos = Object.keys(grupos).filter(Boolean).sort();
      const periodo = periodos[periodos.length - 1] || '';
      const rows = grupos[periodo] || [];
      // Esquema OFICIAL (Manual Técnico TRI.GR.03.0013): RifAgente/Periodo como atributos
      let xml = '<?xml version="1.0" encoding="utf-8" ?>\r\n';
      xml += '<RelacionRetencionesISLR RifAgente="' + rifAgente + '" Periodo="' + periodo + '">\r\n';
      rows.forEach((r) => {
        xml += '  <DetalleRetencion>\r\n'
          + '    <RifRetenido>' + norm(r.tercero_rif) + '</RifRetenido>\r\n'
          + '    <NumeroFactura>' + numFactura(r.factura) + '</NumeroFactura>\r\n'
          + '    <NumeroControl>' + numControl(r.numero_control) + '</NumeroControl>\r\n'
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
      if (window.toast) window.toast('XML Relación Informativa ISLR · período ' + periodo + ' · ' + rows.length + ' registro(s)' + (periodos.length > 1 ? ' (hay otros períodos sin exportar)' : ''), 'success');
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
    const setKpi = (id, bs) => { const el = document.getElementById(id); if (el) { el.dataset.bs = bs; el.innerHTML = '<span class="currency">Bs</span> ' + fmtBs(bs); } };
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
        window.__sbAll((q) => q.eq('empresa_id', emp.id), 'movimientos_tesoreria', 'cuenta_teso_id, tipo, monto, factura_ref'),
        window.__sbAll((q) => q.eq('tipo', 'venta').eq('empresa_id', emp.id), 'facturas', 'numero, total, estado'),
        window.__sbAll((q) => q.eq('tipo', 'compra').eq('empresa_id', emp.id), 'libro_fiscal', 'numero_factura, total, periodo, fecha'),
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
      if (!modoLibro) {
        // Modo recibos: CxC/CxP reales según cobros/pagos registrados
        recibos.forEach((f) => { const p = Math.max(0, (Number(f.total) || 0) - (cobros[(f.numero || '').trim()] || 0)); if (p > 0.01) cxcN++; cxc += p; });
        compras.forEach((f) => { const p = Math.max(0, (Number(f.total) || 0) - (pagos[(f.numero_factura || '').trim()] || 0)); if (p > 0.01) cxpN++; cxp += p; });
      }
      // Ventas: libro fiscal en modo libro; recibos en modo recibos
      const ventas = modoLibro
        ? ventasLibro.reduce((s, f) => s + (Number(f.total) || 0), 0)
        : recibos.reduce((s, f) => s + (Number(f.total) || 0), 0);
      const ventasCount = modoLibro ? ventasLibro.length : recibos.length;
      const ingresos = movs.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
      const egresos = movs.filter((m) => m.tipo === 'egreso').reduce((s, m) => s + (Number(m.monto) || 0), 0);
      setKpi('dashBanco', disp); setKpi('dashCxc', cxc); setKpi('dashCxp', cxp); setKpi('dashVentas', ventas);
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
        filas.forEach((r) => { const k = mesKey(r); if (k) m[k] = (m[k] || 0) + (Number(r.total) || 0); });
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
    // Carga los artículos reales (modo comercial) desde Supabase y los pinta
    async function cargarProductos() {
      if (!window.sb) return;
      const tb = tbodyOf('invpane-com', 'articulos'); if (!tb) return;
      const { data, error } = await window.sb.from('productos').select('*').order('nombre');
      if (error) { console.warn('[DigiAccount] No se pudieron cargar productos:', error.message); return; }
      const arr = data || [];
      window.__PRODUCTOS = arr;   // disponible para el recibo (selector de productos)
      tb.innerHTML = arr.map((p) => '<tr>' + filaArticulo(p) + '</tr>').join('');
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
          { name: 'costo', label: 'Costo (Bs) por unidad', type: 'number', step: '0.01', value: String(Number(p.costo) || 0) },
          { name: 'precio', label: 'Precio venta (Bs) por unidad', type: 'number', step: '0.01', value: String(Number(p.precio) || 0) },
        ],
        onSave: (v) => {
          if (!v.nombre) return 'Indica el nombre del artículo.';
          const patch = {
            nombre: v.nombre, categoria: (v.cat || 'Otros').trim(), alicuota: v.alic, unidad: UNIDADES[v.unidad] || 'und',
            stock: Number(v.stock) || 0, stock_min: Number(v.min) || 0, costo: Number(v.costo) || 0, precio: Number(v.precio) || 0,
          };
          window.sb.from('productos').update(patch).eq('id', p.id).then(({ error }) => {
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
          { name: 'costo', label: 'Costo prom. (Bs) por esa unidad', type: 'number', step: '0.01', placeholder: '0.00' },
          { name: 'precio', label: 'Precio venta (Bs) por esa unidad', type: 'number', step: '0.01', placeholder: '0.00' },
        ],
        onSave: (v) => {
          if (!v.nombre) return 'Indica el nombre del artículo.';
          if (!window.sb || !window.__CUENTA_ID) return 'No hay sesión activa. Inicia sesión de nuevo.';
          const sku = 'SKU-' + String(Date.now()).slice(-5);
          const UNI = { 'Unidad / pieza': 'und', 'Kg': 'kg', 'Gramo': 'g', 'Litro': 'L', 'Ml': 'ml', 'Metro': 'm', 'Caja': 'caja', 'Bulto': 'bulto', 'Docena': 'doc' };
          const fila = {
            cuenta_id: window.__CUENTA_ID,
            nombre: v.nombre, sku: sku, categoria: (v.cat || 'Otros').trim(), alicuota: v.alic,
            unidad: UNI[v.unidad] || 'und',
            stock: Number(v.stock) || 0, stock_min: Number(v.min) || 0,
            costo: Number(v.costo) || 0, precio: Number(v.precio) || 0,
          };
          window.sb.from('productos').insert(fila).then(({ error }) => {
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
  (function payroll() {
    const view = document.getElementById('view-nomina');
    if (!view) return;

    const HOY = new Date(2026, 4, 30); // 30 may 2026

    /* Parámetros legales — EDITABLES desde "Parámetros de Nómina" (tabla parametros_nomina,
       por cuenta). Aquí quedan los valores por defecto/vigentes; applyParams() los actualiza. */
    let DIAS_UTILIDADES = 60;          // política (mín. legal 30, máx. 120)
    let DIAS_VAC = 15, DIAS_BONO_VAC = 15; // base de vacaciones y bono vacacional (mín. legal 15)
    let TASA_INTERES = 0.12;           // tasa anual referencial sobre prestaciones
    let SALARIO_MINIMO = 130;          // Bs/mes — salario mínimo nacional vigente
    let TOPE_IVSS = 5 * SALARIO_MINIMO;  // base máx. cotización IVSS (5 sal. mín.)
    let TOPE_RPE  = 10 * SALARIO_MINIMO; // base máx. cotización RPE (10 sal. mín.)
    // Tasas (fracción): trabajador y patrono
    let R_IVSS_T = 0.04, R_RPE_T = 0.005, R_FAOV_T = 0.01;
    let R_IVSS_P = 0.11, R_RPE_P = 0.02, R_FAOV_P = 0.02, R_INCES_P = 0.02, R_DPP = 0.09;
    const nz = (v, d) => (v != null && v !== '' && !isNaN(v)) ? Number(v) : d;
    function applyParams() {
      const p = window.__PARAMS || {};
      SALARIO_MINIMO = nz(p.salario_minimo, 130);
      CESTATICKET_USD = nz(p.cestaticket_usd, 40);
      DIAS_UTILIDADES = nz(p.dias_utilidades, 60);
      DIAS_VAC = nz(p.dias_vacaciones, 15);
      DIAS_BONO_VAC = nz(p.dias_bono_vac, 15);
      TASA_INTERES = nz(p.tasa_interes_prest, 12) / 100;
      TOPE_IVSS = 5 * SALARIO_MINIMO; TOPE_RPE = 10 * SALARIO_MINIMO;
      R_IVSS_T = nz(p.ivss_trab, 4) / 100; R_RPE_T = nz(p.rpe_trab, 0.5) / 100; R_FAOV_T = nz(p.faov_trab, 1) / 100;
      R_IVSS_P = nz(p.ivss_pat, 11) / 100; R_RPE_P = nz(p.rpe_pat, 2) / 100; R_FAOV_P = nz(p.faov_pat, 2) / 100; R_INCES_P = nz(p.inces_pat, 2) / 100; R_DPP = nz(p.dpp, 9) / 100;
    }
    async function cargarParametros() {
      if (window.sb && window.__CUENTA_ID) {
        const { data } = await window.sb.from('parametros_nomina').select('*').eq('cuenta_id', window.__CUENTA_ID).maybeSingle();
        window.__PARAMS = data || {};
      }
      applyParams();
      if (typeof renderAll === 'function') renderAll();
    }
    window.cargarParametros = cargarParametros;

    function formParametros() {
      const p = window.__PARAMS || {};
      const g = (k, d) => (p[k] != null ? String(p[k]) : String(d));
      const CAMPOS = [
        ['salario_minimo', 'Salario mínimo (Bs/mes)', 130],
        ['cestaticket_usd', 'Cestaticket (USD/mes)', 40],
        ['ivss_trab', 'IVSS trabajador (%)', 4],
        ['rpe_trab', 'RPE / Paro Forzoso trabajador (%)', 0.5],
        ['faov_trab', 'FAOV trabajador (%)', 1],
        ['ivss_pat', 'IVSS patrono (%)', 11],
        ['rpe_pat', 'RPE patrono (%)', 2],
        ['faov_pat', 'FAOV patrono (%)', 2],
        ['inces_pat', 'INCES patrono (%)', 2],
        ['dpp', 'Protección Pensiones · DPP (%)', 9],
        ['dias_utilidades', 'Días de utilidades (al año)', 60],
        ['dias_vacaciones', 'Días de vacaciones · disfrute (base)', 15],
        ['dias_bono_vac', 'Días de bono vacacional (base)', 15],
        ['tasa_interes_prest', 'Tasa interés prestaciones (% anual)', 12],
      ];
      window.openFormModal && window.openFormModal({
        title: 'Parámetros de Nómina (por cuenta)', saveLabel: 'Guardar parámetros',
        fields: CAMPOS.map((c) => ({ name: c[0], label: c[1], type: 'number', step: '0.01', value: g(c[0], c[2]) })),
        onSave: (v) => {
          if (!window.sb || !window.__CUENTA_ID) return 'No hay sesión activa.';
          const row = { cuenta_id: window.__CUENTA_ID, actualizado_en: new Date().toISOString() };
          CAMPOS.forEach((c) => { row[c[0]] = parseFloat(v[c[0]]) || 0; });
          window.sb.from('parametros_nomina').upsert(row, { onConflict: 'cuenta_id' }).then(({ error }) => {
            if (error) { if (window.toast) window.toast('No se pudo guardar: ' + error.message, 'error'); return; }
            if (window.toast) window.toast('Parámetros guardados · aplicados a la nómina', 'success');
            if (window.cargarParametros) window.cargarParametros();
          });
        },
      });
    }
    const paramBtn = document.getElementById('parametrosNominaBtn');
    if (paramBtn) paramBtn.addEventListener('click', formParametros);

    // ---- Contabilizar la nómina del período: UN asiento resumen (modelo del contador) ----
    // Gastos (sueldos + beneficios) / retenciones parafiscales por enterar + pago neto por banco.
    async function contabilizarNomina(freq) {
      const lista = empleados.filter((e) => (e.frecHabitual || 'quincenal') === freq);
      if (!lista.length) { if (window.toast) window.toast('No hay trabajadores con pago ' + freq + '.', 'info'); return false; }
      let salarial = 0, beneficios = 0, ivssT = 0, spfT = 0, faovT = 0, otrasDed = 0;
      lista.forEach((e) => {
        const p = calcPago(e, freq);
        salarial += p.asigSalarial;
        beneficios += p.bonoContingencia + p.cestaticket + p.transporteBs;
        ivssT += p.ivss; spfT += p.spf; faovT += p.faov;
        otrasDed += p.dedOtras;
      });
      const per = periodoNomina(freq);
      const r2n = (x) => Math.round(x * 100) / 100;
      const lineas = [
        { cta: '6.1.1.01 · Sueldos y salarios', debe: r2n(salarial), haber: 0 },
        { cta: '6.1.1.02 · Beneficios laborales', debe: r2n(beneficios), haber: 0 },
      ];
      if (ivssT > 0.005) lineas.push({ cta: '2.1.3.04 · S.S.O. por pagar', debe: 0, haber: r2n(ivssT) });
      if (spfT > 0.005) lineas.push({ cta: '2.1.3.05 · Régimen Prestacional de Empleo (RPE) por pagar', debe: 0, haber: r2n(spfT) });
      if (faovT > 0.005) lineas.push({ cta: '2.1.3.06 · FAOV por pagar', debe: 0, haber: r2n(faovT) });
      if (otrasDed > 0.005) lineas.push({ cta: '2.1.5 · Otras Cuentas por Pagar', debe: 0, haber: r2n(otrasDed) });
      const debeT = lineas.reduce((s, l) => s + l.debe, 0), habT = lineas.reduce((s, l) => s + l.haber, 0);
      lineas.push({ cta: '1.1.1.03 · Bancos', debe: 0, haber: r2n(debeT - habT) }); // neto pagado
      if (!window.confirm('¿Contabilizar la nómina ' + freq + '?\n' + per + '\n\n' + lista.length + ' trabajadores · Neto pagado por banco: Bs ' + fmt(r2n(debeT - habT)))) return false;
      const r = await window.__postAsiento('Nómina ' + freq + ' · ' + per + ' · ' + lista.length + ' trabajadores (pagada por banco)', 'NOM-' + per.replace(/[^0-9]/g, '').slice(0, 8), lineas, 'auto');
      if (r && r.error) { if (window.toast) window.toast('No se pudo contabilizar: ' + r.error.message, 'error'); return false; }
      if (window.toast) window.toast('Nómina ' + freq + ' contabilizada · revisa el asiento en el Libro Diario', 'success');
      return true;
    }
    window.__contabilizarNomina = contabilizarNomina;
    const relnContab = document.getElementById('relnContabilizar');
    if (relnContab) relnContab.addEventListener('click', () => {
      const d = window.__RELN_ACTUAL;
      if (!d) { if (window.toast) window.toast('Genera primero la relación del período.', 'error'); return; }
      contabilizarNomina(d.freq);
    });

    let empleados = [];   // se carga desde Supabase (cargarEmpleados)
    // (datos de ejemplo eliminados: la nómina trabaja con empleados reales de Supabase)

    const fmt = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmt0 = (n) => Math.round(n).toLocaleString('es-VE');

    /* Relación de nómina del período: se genera recorriendo TODA la lista de
       empleados activos, de modo que incluye a todos los que existan (no una
       cantidad fija). Asignación = salario quincenal; deducciones de ley ~6%. */
    function buildRelacionNomina(freq) {
      const tbody = document.getElementById('relnTableBody');
      if (!tbody) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      const relnFreqEl = document.getElementById('relnFreq');
      freq = freq || (relnFreqEl ? relnFreqEl.value : 'quincenal');
      const periodoLbl = freq === 'semanal' ? 'Semanal' : freq === 'mensual' ? 'Mensual' : 'Quincenal';
      // Solo los trabajadores con ESTA frecuencia de pago. Cada fila usa calcPago (el
      // MISMO cálculo del recibo): sueldo + bono de contingencia + cestaticket + otras.
      const lista = empleados.filter((e) => (e.frecHabitual || 'quincenal') === freq);
      let tS = 0, tC = 0, tCe = 0, tO = 0, totA = 0, totD = 0, totN = 0;
      tbody.innerHTML = lista.length ? lista.map((e, i) => {
        const p = calcPago(e, freq);
        const otras = p.montoExtra + p.montoNoct + p.montoFeriado + p.comision + p.bonoProd + p.transporteBs;
        tS += p.sueldo; tC += p.bonoContingencia; tCe += p.cestaticket; tO += otras;
        totA += p.asig; totD += p.ded; totN += p.neto;
        return '<tr><td class="ctr">' + (i + 1) + '</td><td>' + esc(e.nombre)
          + '</td><td class="mono">' + esc(e.cedula) + '</td><td>' + esc(e.cargo)
          + '</td><td class="num">' + fmt(p.sueldo) + '</td><td class="num">' + fmt(p.bonoContingencia)
          + '</td><td class="num">' + fmt(p.cestaticket) + '</td><td class="num">' + fmt(otras)
          + '</td><td class="num">' + fmt(p.asig) + '</td><td class="num">' + fmt(p.ded)
          + '</td><td class="num">' + fmt(p.neto) + '</td></tr>';
      }).join('') : '<tr><td colspan="11" style="text-align:center;color:var(--fg-muted);padding:18px;">Sin trabajadores con pago ' + periodoLbl.toLowerCase() + '.</td></tr>';
      set('relnTotSue', fmt(tS));
      set('relnTotCon', fmt(tC));
      set('relnTotCes', fmt(tCe));
      set('relnTotOtr', fmt(tO));
      set('relnTotA', fmt(totA));
      set('relnTotD', fmt(totD));
      set('relnTotN', fmt(totN));
      // Datos del período para el asiento resumen de nómina ("Contabilizar")
      window.__RELN_ACTUAL = { freq: freq, lista: lista };
      set('relnSubLabel', 'TOTALES · ' + periodoLbl.toUpperCase() + ' · ' + lista.length + ' trabajador' + (lista.length === 1 ? '' : 'es'));
      // Cabecera real del documento
      const emp = window.__EMPRESA_ACTIVA || {};
      set('relnEmpresa', emp.n || '—');
      set('relnRif', emp.rif ? ('RIF ' + emp.rif) : '—');
      set('relnPeriodo', 'Pago ' + periodoLbl.toLowerCase());
      set('relnCount', String(lista.length));

      // Aportes patronales sobre la base mensual del grupo de esta frecuencia
      const exentaDppReln = (window.__EMPRESA_ACTIVA || {}).declaraDpp === false;
      const baseMes = lista.reduce((s, e) => s + (Number(e.salarioMes) || 0), 0);
      const ivss = baseMes * R_IVSS_P, spf = baseMes * R_RPE_P, faov = baseMes * R_FAOV_P, inces = baseMes * R_INCES_P;
      // DPP: cero para empresas exentas (emprendimientos) y para trabajadores no sujetos
      const baseDpp = exentaDppReln ? 0 : lista.filter((e) => e.sujetoDpp).reduce((s, e) => s + (Number(e.salarioMes) || 0), 0);
      const pp = baseDpp * R_DPP;
      set('raIvss', fmt(ivss));
      set('raSpf', fmt(spf));
      set('raFaov', fmt(faov));
      set('raInces', fmt(inces));
      set('raPp', fmt(pp));
      const raPpRow = document.getElementById('raPpRow'); // oculta la fila DPP si la empresa es exenta
      if (raPpRow) raPpRow.style.display = exentaDppReln ? 'none' : '';
      const raPpMeta = document.getElementById('raPpMeta');
      if (raPpMeta) raPpMeta.textContent = exentaDppReln ? 'exento' : (lista.filter((e) => e.sujetoDpp).length + ' sujeto(s)');
      set('raTotal', fmt(ivss + spf + faov + inces + pp));

      // KPIs de la cabecera de Nómina: sobre TODOS los trabajadores (no solo el grupo)
      const baseTodos = empleados.reduce((s, e) => s + (Number(e.salarioMes) || 0), 0);
      const dppTodos = exentaDppReln ? 0 : empleados.filter((e) => e.sujetoDpp).reduce((s, e) => s + (Number(e.salarioMes) || 0), 0);
      set('nomKpiCosto', fmt(baseTodos));
      set('nomKpiAportes', fmt(baseTodos * (R_IVSS_P + R_RPE_P + R_FAOV_P + R_INCES_P) + dppTodos * R_DPP));
      const kc = document.getElementById('nomKpiCount'); if (kc) kc.textContent = String(empleados.length);
    }
    window.__buildRelacion = buildRelacionNomina;

    function aniosServicio(ing) {
      let y = HOY.getFullYear() - ing.getFullYear();
      const m = HOY.getMonth() - ing.getMonth();
      if (m < 0 || (m === 0 && HOY.getDate() < ing.getDate())) y--;
      return y;
    }
    function mesesFraccion(ing) {
      const y = aniosServicio(ing);
      const lastAniv = new Date(ing.getFullYear() + y, ing.getMonth(), ing.getDate());
      let m = (HOY.getFullYear() - lastAniv.getFullYear()) * 12 + (HOY.getMonth() - lastAniv.getMonth());
      if (HOY.getDate() < lastAniv.getDate()) m--;
      return Math.max(0, m);
    }

    // Base mensual manual por trabajador para prestaciones (Vac./Util./Liq.).
    // En Venezuela el mínimo legal es irrisorio: el contador ajusta la base a lo que
    // realmente se paga (en $ o un aproximado). Se guarda por empleado en memoria.
    const _basePrest = {};
    function baseCalcMes(emp) {
      if (_basePrest[emp.id] != null) return _basePrest[emp.id];
      return SALARIO_MINIMO; // por defecto el mínimo cotizable; editable en cada cálculo
    }
    function calc(emp, baseOverrideMes) {
      // Base para prestaciones: el mínimo cotizable por defecto, o el monto que fije el
      // contador (salario real en Bs/$). El Bono de Contingencia sigue siendo no salarial.
      const salBaseMes = (baseOverrideMes != null && baseOverrideMes > 0) ? baseOverrideMes : baseCalcMes(emp);
      const salDia = salBaseMes / 30;
      const y = aniosServicio(emp.ingreso);
      const fracMeses = mesesFraccion(emp.ingreso);
      const mesesAnio = HOY.getMonth() + 1; // utilidades del ejercicio en curso (ene..may = 5)

      const diasVac = Math.min(DIAS_VAC + Math.max(0, y - 1), DIAS_VAC + 15);
      const diasBonoVac = Math.min(DIAS_BONO_VAC + Math.max(0, y - 1), DIAS_BONO_VAC + 15);
      const diasUtil = DIAS_UTILIDADES;

      const alicBV = (salDia * diasBonoVac) / 360;
      const alicUt = (salDia * diasUtil) / 360;
      const salIntDia = salDia + alicBV + alicUt;

      // Vacaciones
      const vacDisfrute = diasVac * salDia;
      const vacBono = diasBonoVac * salDia;
      const vacTotal = vacDisfrute + vacBono;

      // Utilidades (el INCES del trabajador, 0,5%, se retiene sobre las utilidades)
      const utilAnual = diasUtil * salDia;
      const incesUtil = utilAnual * 0.005;
      const utilNeto = utilAnual - incesUtil;
      const utilFrac = (utilAnual * mesesAnio) / 12;

      // Prestaciones sociales (Art. 142 LOTTT)
      const diasGarantia = 60 * y;                       // 15 días/trimestre
      const diasAdic = Math.min(2 * Math.max(0, y - 1), 30);
      const garantia = (diasGarantia + diasAdic) * salIntDia;
      // Cálculo retroactivo (Art. 142.c): 30 días por año o fracción superior a 6 meses
      const aniosRetro = y + (fracMeses > 6 ? 1 : 0);
      const retroactiva = 30 * aniosRetro * salIntDia;
      const prestacion = Math.max(garantia, retroactiva);
      const usoRetro = retroactiva >= garantia;
      const intereses = garantia * TASA_INTERES;

      // Fracciones para liquidación
      const vacFrac = diasVac * (fracMeses / 12) * salDia;
      const bonoVacFrac = diasBonoVac * (fracMeses / 12) * salDia;

      const liqAsig = prestacion + intereses + vacFrac + bonoVacFrac + utilFrac;
      const deducciones = 0;
      const liqTotal = liqAsig - deducciones;

      return {
        salDia, y, fracMeses, mesesAnio, diasVac, diasBonoVac, diasUtil,
        salIntDia, vacDisfrute, vacBono, vacTotal, utilAnual, incesUtil, utilNeto, utilFrac,
        diasGarantia, diasAdic, garantia, retroactiva, prestacion, usoRetro,
        intereses, vacFrac, bonoVacFrac, liqAsig, deducciones, liqTotal,
      };
    }

    // ---------- Número a letras (parte entera, es-VE) ----------
    function enLetras(num) {
      num = Math.floor(num);
      if (num === 0) return 'cero';
      const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];
      const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
      const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
      function hasta99(n) {
        if (n <= 20) return U[n];
        if (n < 30) return 'veexx'.replace('veexx', 'veinti' + U[n - 20]);
        const d = Math.floor(n / 10), u = n % 10;
        return D[d] + (u ? ' y ' + U[u] : '');
      }
      function hasta999(n) {
        if (n === 100) return 'cien';
        const c = Math.floor(n / 100), r = n % 100;
        return (C[c] + (r ? ' ' + hasta99(r) : '')).trim();
      }
      function seccion(n, singular, plural) {
        if (n === 0) return '';
        if (n === 1) return singular;
        return hasta999(n) + ' ' + plural;
      }
      const millones = Math.floor(num / 1000000);
      const miles = Math.floor((num % 1000000) / 1000);
      const resto = num % 1000;
      let out = '';
      if (millones) out += seccion(millones, 'un millón', 'millones') + ' ';
      if (miles) out += (miles === 1 ? 'mil' : hasta999(miles) + ' mil') + ' ';
      if (resto) out += hasta999(resto);
      return out.trim().replace(/\s+/g, ' ');
    }
    function montoEnLetras(n) {
      const ent = Math.floor(n);
      const cent = Math.round((n - ent) * 100);
      return enLetras(ent) + ' bolívares con ' + String(cent).padStart(2, '0') + '/100';
    }
    window.__montoEnLetras = montoEnLetras; // reutilizable por el visor de facturas

    // ---------- Render del selector de empleados ----------
    const state = { vacaciones: null, utilidades: null, liquidacion: null };

    function renderPicker(tab) {
      const host = view.querySelector('.emp-picker[data-picker="' + tab + '"]');
      if (!host) return;
      if (!empleados.length) { host.innerHTML = '<div class="emp-picker-head">Sin empleados</div><div class="emp-picker-body" style="padding:18px;color:var(--fg-muted);font-size:12px;">Registra trabajadores en la pestaña Empleados.</div>'; return; }
      const rows = empleados.map((e) => {
        const c = calc(e);
        const active = state[tab] === e.id ? 'true' : 'false';
        return '<div class="emp-pick" data-emp="' + e.id + '" data-active="' + active + '">'
          + '<span class="epa" style="background:' + e.color + '">' + e.ini + '</span>'
          + '<span class="epi"><span class="epn">' + e.nombre + '</span><span class="epr">' + e.cargo + '</span></span>'
          + '<span class="epy">' + c.y + ' año' + (c.y === 1 ? '' : 's') + '</span>'
          + '</div>';
      }).join('');
      host.innerHTML = '<div class="emp-picker-head">Selecciona un empleado · ' + empleados.length + '</div><div class="emp-picker-body">' + rows + '</div>';
      host.querySelectorAll('.emp-pick').forEach((el) => {
        el.addEventListener('click', () => { state[tab] = el.dataset.emp; renderPicker(tab); renderCalc(tab); });
      });
    }

    // ---------- Render del cálculo ----------
    function empById(id) { return empleados.find((e) => e.id === id); }

    function calcHead(emp, c, conceptLabel, conceptVal) {
      return '<div class="calc-card-head">'
        + '<div class="cc-emp"><div class="cc-av" style="background:' + emp.color + '">' + emp.ini + '</div>'
        + '<div><div class="cc-name">' + emp.nombre + '</div><div class="cc-meta"><span class="mono">' + emp.cedula + '</span> · ' + emp.cargo + ' · ' + emp.depto + '</div></div></div>'
        + '<div class="cc-concept"><div class="ccl">' + conceptLabel + '</div><div class="ccv">' + conceptVal + '</div></div>'
        + '</div>';
    }

    function renderCalc(tab) {
      const host = view.querySelector('.calc-detail[data-calc="' + tab + '"]');
      if (!host) return;
      const emp = empById(state[tab]);
      if (!emp) { host.innerHTML = '<div class="calc-card" style="padding:28px;text-align:center;color:var(--fg-muted);font-size:13px;">Registra empleados para calcular prestaciones.</div>'; return; }
      const baseMes = baseCalcMes(emp);
      const c = calc(emp, baseMes);
      const ajustada = Math.abs(baseMes - SALARIO_MINIMO) > 0.01;
      let html = '<div class="calc-card">';
      // Base de cálculo EDITABLE: el contador ajusta el salario a la realidad (Bs/$)
      html += '<div class="calc-basebar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-bottom:10px;border:1px solid var(--border-strong);border-radius:10px;background:var(--bg-subtle);">'
        + '<span style="font-size:12px;font-weight:600;">Salario base mensual del cálculo:</span>'
        + '<div style="display:flex;align-items:center;gap:4px;"><span style="font-size:12px;color:var(--fg-muted);">Bs</span>'
        + '<input type="number" step="0.01" id="basePrestInput" value="' + baseMes.toFixed(2) + '" style="width:150px;height:32px;border:1px solid var(--border-strong);border-radius:8px;padding:0 10px;font:inherit;text-align:right;background:var(--bg-surface);color:inherit;"></div>'
        + '<button class="btn btn-ghost" id="basePrestMin" style="height:30px;font-size:11px;" title="Usar el salario mínimo cotizable">Mínimo legal</button>'
        + '<button class="btn btn-ghost" id="basePrestUsd" style="height:30px;font-size:11px;" title="Convertir un monto en USD a Bs a la tasa BCV">Desde $…</button>'
        + '<span style="font-size:11px;color:' + (ajustada ? '#0a7a44' : 'var(--fg-muted)') + ';">' + (ajustada ? '✓ base ajustada' : 'base = mínimo legal') + '</span>'
        + '</div>';

      if (tab === 'vacaciones') {
        html += calcHead(emp, c, 'Período', String(HOY.getFullYear()));
        html += '<div class="calc-params">'
          + param('Antigüedad', c.y + ' <small>años</small>')
          + param('Salario diario', 'Bs ' + fmt(c.salDia))
          + param('Días de disfrute', c.diasVac + ' <small>días háb.</small>')
          + param('Días de bono', c.diasBonoVac + ' <small>días</small>')
          + '</div>';
        html += '<div class="calc-lines">'
          + line('Salario por días de disfrute', c.diasVac + ' días × Bs ' + fmt(c.salDia), 'Bs ' + fmt(c.vacDisfrute), '')
          + line('Bono vacacional', c.diasBonoVac + ' días × Bs ' + fmt(c.salDia) + ' (Art. 192 LOTTT)', 'Bs ' + fmt(c.vacBono), 'add')
          + '</div>';
        html += total('Total vacaciones a pagar', 'Bs ' + fmt(c.vacTotal));
        html += foot('Vacaciones según Art. 190-192 LOTTT: 15 días + 1 por año de servicio (tope 30).', 'vacaciones');
      } else if (tab === 'utilidades') {
        html += calcHead(emp, c, 'Ejercicio', String(HOY.getFullYear()));
        html += '<div class="calc-params">'
          + param('Antigüedad', c.y + ' <small>años</small>')
          + param('Salario diario', 'Bs ' + fmt(c.salDia))
          + param('Días (política)', c.diasUtil + ' <small>días</small>')
          + param('Meses del ejercicio', c.mesesAnio + ' <small>/ 12</small>')
          + '</div>';
        html += '<div class="calc-lines">'
          + line('Utilidades anuales (ejercicio completo)', c.diasUtil + ' días × Bs ' + fmt(c.salDia), 'Bs ' + fmt(c.utilAnual), '')
          + line('Provisión acumulada al cierre de ' + mesNombre(HOY.getMonth()), c.mesesAnio + '/12 del ejercicio', 'Bs ' + fmt(c.utilFrac), 'add')
          + '</div>';
        html += total('Aguinaldo / utilidades a pagar', 'Bs ' + fmt(c.utilAnual));
        html += foot('Utilidades según Art. 131-132 LOTTT: mínimo 30 días, esta empresa otorga ' + c.diasUtil + ' días. Pago antes del 15 de diciembre.', 'utilidades');
      } else if (tab === 'liquidacion') {
        html += calcHead(emp, c, 'Motivo', 'Retiro / cese');
        html += '<div class="calc-params">'
          + param('Antigüedad', c.y + ' <small>años</small> ' + c.fracMeses + ' <small>m</small>')
          + param('Salario integral diario', 'Bs ' + fmt(c.salIntDia))
          + param('Garantía (Art. 142a)', c.diasGarantia + c.diasAdic + ' <small>días</small>')
          + param('Método aplicado', c.usoRetro ? 'Retroactivo' : 'Garantía')
          + '</div>';
        html += '<div class="calc-lines">'
          + sectionLine('Prestaciones sociales (Art. 142 LOTTT)')
          + line('Garantía de prestaciones', c.diasGarantia + ' días (15/trim.) + ' + c.diasAdic + ' adic. × Bs ' + fmt(c.salIntDia), 'Bs ' + fmt(c.garantia), '')
          + line('Cálculo retroactivo', '30 días × ' + c.y + ' años × Bs ' + fmt(c.salIntDia), 'Bs ' + fmt(c.retroactiva), '')
          + line('<strong>Prestación a pagar</strong> (el monto mayor, Art. 142d)', c.usoRetro ? 'Aplica retroactivo' : 'Aplica garantía', 'Bs ' + fmt(c.prestacion), 'subtotal')
          + line('Intereses sobre prestaciones', '≈ ' + (TASA_INTERES * 100).toFixed(0) + '% anual referencial', 'Bs ' + fmt(c.intereses), 'add')
          + sectionLine('Conceptos fraccionados')
          + line('Vacaciones fraccionadas', c.fracMeses + '/12 × ' + c.diasVac + ' días', 'Bs ' + fmt(c.vacFrac), 'add')
          + line('Bono vacacional fraccionado', c.fracMeses + '/12 × ' + c.diasBonoVac + ' días', 'Bs ' + fmt(c.bonoVacFrac), 'add')
          + line('Utilidades fraccionadas', c.mesesAnio + '/12 × ' + c.diasUtil + ' días', 'Bs ' + fmt(c.utilFrac), 'add')
          + '</div>';
        html += total('Total liquidación a pagar', 'Bs ' + fmt(c.liqTotal));
        html += foot('Prestaciones según Art. 142 LOTTT: se paga el mayor entre la garantía trimestral y 30 días por año sobre el último salario integral.', 'liquidacion');
      }

      html += '</div>';
      host.innerHTML = html;
      drawIcons();
      // Base editable: aplica y re-renderiza en vivo
      const baseInput = host.querySelector('#basePrestInput');
      const aplicarBase = (v) => { const n = parseFloat(v); if (n > 0) { _basePrest[emp.id] = n; renderCalc(tab); renderPicker(tab); } };
      if (baseInput) baseInput.addEventListener('change', () => aplicarBase(baseInput.value));
      const btnMin = host.querySelector('#basePrestMin');
      if (btnMin) btnMin.addEventListener('click', () => { delete _basePrest[emp.id]; renderCalc(tab); renderPicker(tab); });
      const btnUsd = host.querySelector('#basePrestUsd');
      if (btnUsd) btnUsd.addEventListener('click', () => {
        const tasa = window.__bcvRate || 0;
        const usd = parseFloat(window.prompt('Salario mensual en USD (se convierte a Bs a la tasa BCV ' + (tasa ? 'Bs ' + fmt(tasa) : 'del día') + '):', '100'));
        if (usd > 0 && tasa > 0) aplicarBase(usd * tasa);
        else if (!tasa) { if (window.toast) window.toast('Aún no cargó la tasa BCV; escribe el monto en Bs directamente.', 'info'); }
      });
      const btn = host.querySelector('[data-recibo]');
      if (btn) btn.addEventListener('click', () => openRecibo(tab, emp, c));
    }

    function param(l, v) { return '<div class="calc-param"><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'; }
    function line(desc, sub, amt, cls) {
      return '<div class="calc-line ' + (cls || '') + '"><div class="cl-desc">' + desc + (sub ? '<small>' + sub + '</small>' : '') + '</div><div class="cl-amt">' + amt + '</div></div>';
    }
    function sectionLine(t) { return '<div class="calc-line section"><div class="cl-desc">' + t + '</div><div class="cl-amt"></div></div>'; }
    function total(l, v) { return '<div class="calc-total"><span class="ct-l">' + l + '</span><span class="ct-v">' + v + '</span></div>'; }
    function foot(legal, tab) {
      return '<div class="calc-foot"><span class="legal"><i data-lucide="scale"></i> ' + legal + '</span>'
        + '<button class="btn btn-primary" style="height:34px;font-size:12px;" data-recibo="' + tab + '"><i data-lucide="file-text"></i> Generar recibo</button></div>';
    }
    function mesNombre(m) {
      return ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m];
    }

    // ---------- Recibo (modal) ----------
    const overlay = document.getElementById('reciboOverlay');
    const doc = document.getElementById('reciboDoc');
    const modalTitle = document.getElementById('reciboModalTitle');
    let lastReciboText = '';

    function reciboRows(tab, c) {
      if (tab === 'vacaciones') {
        return [
          ['asig', 'Salario por días de disfrute', c.diasVac + ' días', c.vacDisfrute],
          ['asig', 'Bono vacacional', c.diasBonoVac + ' días', c.vacBono],
        ];
      }
      if (tab === 'utilidades') {
        return [
          ['asig', 'Utilidades / aguinaldo', c.diasUtil + ' días', c.utilAnual],
          ['ded', 'INCES · aporte del trabajador', '0,5% sobre utilidades (Ley INCES, Art. 14)', c.incesUtil],
        ];
      }
      // liquidación
      return [
        ['sec', 'Prestaciones sociales (Art. 142 LOTTT)', '', null],
        ['asig', 'Prestación a pagar', (c.usoRetro ? 'Retroactivo' : 'Garantía') + ' · ' + c.y + ' años', c.prestacion],
        ['asig', 'Intereses sobre prestaciones', (TASA_INTERES * 100).toFixed(0) + '% ref.', c.intereses],
        ['sec', 'Conceptos fraccionados', '', null],
        ['asig', 'Vacaciones fraccionadas', c.fracMeses + '/12', c.vacFrac],
        ['asig', 'Bono vacacional fraccionado', c.fracMeses + '/12', c.bonoVacFrac],
        ['asig', 'Utilidades fraccionadas', c.mesesAnio + '/12', c.utilFrac],
      ];
    }

    function openRecibo(tab, emp, c) {
      const kinds = {
        vacaciones: { title: 'Recibo de Vacaciones', total: c.vacTotal, num: 'VAC' },
        utilidades: { title: 'Recibo de Utilidades', total: c.utilNeto, num: 'UTI' },
        liquidacion: { title: 'Liquidación de Prestaciones', total: c.liqTotal, num: 'LIQ' },
      };
      const k = kinds[tab];
      modalTitle.textContent = k.title;
      const hoyK = new Date();
      const fecha = ('0' + hoyK.getDate()).slice(-2) + '/' + ('0' + (hoyK.getMonth() + 1)).slice(-2) + '/' + hoyK.getFullYear();
      const numDoc = k.num + '-' + hoyK.getFullYear() + '-' + emp.id.toUpperCase() + '04';

      const rows = reciboRows(tab, c).map((r) => {
        if (r[0] === 'sec') return '<tr class="sec"><td colspan="3">' + r[1] + '</td></tr>';
        return '<tr class="' + r[0] + '"><td>' + r[1] + (r[2] ? '<span class="sub">' + r[2] + '</span>' : '') + '</td><td class="num">Bs</td><td class="num">' + fmt(r[3]) + '</td></tr>';
      }).join('');

      const EMPK = window.__EMPRESA_ACTIVA || {};
      doc.innerHTML =
        '<div class="recibo-head">'
        + '<div><div class="rh-co">' + (EMPK.n || '—') + '</div><div class="rh-meta"><span class="mono">RIF ' + (EMPK.rif || '—') + '</span>'
        + (EMPK.dom ? '<br>' + EMPK.dom : '') + (EMPK.tel ? '<br>Telf. ' + EMPK.tel : '') + '</div></div>'
        + '<div class="rh-kind"><div class="k">' + k.title + '</div><div class="num">N° ' + numDoc + '</div></div>'
        + '</div>'
        + '<div class="recibo-party">'
        + '<div class="rp"><div class="l">Trabajador</div><div class="v">' + emp.nombre + '</div></div>'
        + '<div class="rp"><div class="l">Cédula</div><div class="v mono">' + emp.cedula + '</div></div>'
        + '<div class="rp"><div class="l">Cargo</div><div class="v">' + emp.cargo + ' · ' + emp.depto + '</div></div>'
        + '<div class="rp"><div class="l">Fecha de emisión</div><div class="v">' + fecha + '</div></div>'
        + '<div class="rp"><div class="l">Fecha de ingreso</div><div class="v">' + ('0' + emp.ingreso.getDate()).slice(-2) + '/' + ('0' + (emp.ingreso.getMonth() + 1)).slice(-2) + '/' + emp.ingreso.getFullYear() + '</div></div>'
        + '<div class="rp"><div class="l">Antigüedad</div><div class="v">' + c.y + ' años ' + c.fracMeses + ' meses</div></div>'
        + '</div>'
        + '<table class="recibo-table"><thead><tr><th>Concepto</th><th class="num"></th><th class="num">Monto</th></tr></thead>'
        + '<tbody>' + rows + '</tbody>'
        + '<tfoot><tr><td>Total a pagar</td><td class="num">Bs</td><td class="num">' + fmt(k.total) + '</td></tr></tfoot></table>'
        + '<div class="recibo-words">Son: <strong>' + capitalizar(montoEnLetras(k.total)) + '</strong>.</div>'
        + '<div class="recibo-foot">'
        + '<div class="recibo-sign">' + ((window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.firmaEmpresa) ? '<img src="' + window.__EMPRESA_ACTIVA.firmaEmpresa + '" alt="firma empresa" style="max-height:54px;display:block;margin:0 auto 2px;">' : '') + '<div class="line">Por la empresa</div></div>'
        + '<div class="recibo-sign"><div class="line">Recibí conforme · ' + emp.nombre + '</div></div>'
        + '<div class="recibo-legal">Documento generado electrónicamente por DigiAccount conforme a la Ley Orgánica del Trabajo, los Trabajadores y las Trabajadoras (LOTTT). Válido sin firma autógrafa según el Decreto-Ley sobre Mensajes de Datos y Firmas Electrónicas. Este recibo refleja el cálculo automático de los conceptos laborales; cualquier diferencia debe notificarse a Recursos Humanos.</div>'
        + '</div>';

      // texto para descarga
      lastReciboText = k.title + ' - ' + emp.nombre + ' (' + emp.cedula + ')\r\n'
        + 'Documento: ' + numDoc + '  Fecha: ' + fecha + '\r\n'
        + 'Antiguedad: ' + c.y + ' anios ' + c.fracMeses + ' meses\r\n'
        + '----------------------------------------\r\n'
        + reciboRows(tab, c).filter((r) => r[0] !== 'sec').map((r) => '  ' + r[1] + ': Bs ' + fmt(r[3])).join('\r\n')
        + '\r\n----------------------------------------\r\n'
        + 'TOTAL A PAGAR: Bs ' + fmt(k.total) + '\r\n'
        + 'Son: ' + capitalizar(montoEnLetras(k.total)) + '\r\n';
      lastReciboName = (k.title + ' ' + emp.nombre).replace(/[\\/:*?"<>|]/g, '-') + '.txt';
      currentReciboPago = null; // este es el recibo de prestaciones: el PDF toma SU nombre, no el del último recibo de pago

      overlay.dataset.open = 'true';
      drawIcons();
    }
    let lastReciboName = 'recibo.txt';
    function capitalizar(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    function closeRecibo() { overlay.dataset.open = 'false'; }
    const rc = document.getElementById('reciboClose');
    if (rc) rc.addEventListener('click', closeRecibo);
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeRecibo(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay && overlay.dataset.open === 'true') closeRecibo(); });
    const rp = document.getElementById('reciboPrint');
    let tituloOriginal = null; // para restaurar el título tras imprimir/guardar PDF
    if (rp) rp.addEventListener('click', () => {
      // Clonar el recibo a un portal fuera de .app → una sola hoja, sin páginas en blanco
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = doc.cloneNode(true);
      clon.classList.add('recibo-print');
      portal.appendChild(clon);
      document.body.classList.add('printing-comp');
      // "Guardar como PDF" usa el título del documento como nombre de archivo:
      // → "Recibo ABRAHAN JOSE REYES MAJANO - Semana 13-07-2026 al 19-07-2026.pdf"
      tituloOriginal = document.title;
      let nombrePdf = '';
      if (currentReciboPago && currentReciboPago.emp) {
        nombrePdf = 'Recibo ' + currentReciboPago.emp.nombre + ' - ' + String(currentReciboPago.periodo || '');
      } else if (lastReciboName && lastReciboName !== 'recibo.txt') {
        nombrePdf = lastReciboName.replace(/\.txt$/i, '');
      }
      if (nombrePdf) document.title = nombrePdf.replace(/[\\/:*?"<>|]/g, '-');
      window.print();
    });
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
      if (tituloOriginal != null) { document.title = tituloOriginal; tituloOriginal = null; }
    });
    const rd = document.getElementById('reciboDownload');
    if (rd) rd.addEventListener('click', () => {
      const blob = new Blob([lastReciboText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = lastReciboName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // ---------- Firma digital del recibo de pago + respaldo ----------
    let currentReciboPago = null;
    const firmarBtn = document.getElementById('reciboFirmar');
    if (firmarBtn) firmarBtn.addEventListener('click', () => {
      if (!currentReciboPago) { if (window.toast) window.toast('Abre un recibo de pago primero.', 'error'); return; }
      if (window.__abrirFirma) window.__abrirFirma();
    });
    window.__aplicarFirmaRecibo = async (firmaUrl) => {
      if (!currentReciboPago) return;
      const c = currentReciboPago;
      const signs = doc.querySelectorAll('.recibo-sign');
      if (signs && signs.length) {
        const worker = signs[signs.length - 1];
        worker.innerHTML = '<img src="' + firmaUrl + '" alt="firma" style="max-height:54px;display:block;margin:0 auto 2px;"><div class="line">Recibí conforme · ' + c.emp.nombre + '</div>';
      }
      if (window.sb && window.__CUENTA_ID && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
        const detalle = (c.rows || []).filter((r) => r[0] !== 'sec').map((r) => ({ concepto: r[1], monto: r[3], tipo: r[0] }));
        const { error } = await window.sb.from('recibos_nomina').insert({
          cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, empleado_id: c.emp.id || null,
          empleado_nombre: c.emp.nombre, empleado_cedula: c.emp.cedula, periodo: c.periodo, frecuencia: c.frecuencia,
          neto: c.p.neto, detalle: detalle, tasa_bcv: c.p.tasa, firma: firmaUrl, firmado_en: new Date().toISOString(),
        });
        if (error) { if (window.toast) window.toast('Firmó, pero no se respaldó: ' + error.message, 'error'); return; }
      }
      if (window.toast) window.toast('Recibo firmado y respaldado en la empresa ✓', 'success');
    };
    // Pad de firma (canvas con eventos de puntero: mouse y táctil)
    (function firmaPad() {
      const fo = document.getElementById('firmaOverlay');
      const canvas = document.getElementById('firmaCanvas');
      if (!fo || !canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0a2540';
      let drawing = false, has = false;
      const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; };
      canvas.addEventListener('pointerdown', (e) => { drawing = true; has = true; const pt = pos(e); ctx.beginPath(); ctx.moveTo(pt.x, pt.y); try { canvas.setPointerCapture(e.pointerId); } catch (er) {} });
      canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const pt = pos(e); ctx.lineTo(pt.x, pt.y); ctx.stroke(); });
      const stop = () => { drawing = false; };
      canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointerleave', stop);
      const limpiar = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); has = false; };
      const li = document.getElementById('firmaLimpiar'); if (li) li.addEventListener('click', limpiar);
      const fcl = document.getElementById('firmaClose'); if (fcl) fcl.addEventListener('click', () => { fo.dataset.open = 'false'; });
      fo.addEventListener('click', (e) => { if (e.target === fo) fo.dataset.open = 'false'; });
      let onApply = null;
      window.__abrirFirma = (cb) => { onApply = (typeof cb === 'function') ? cb : null; limpiar(); fo.dataset.open = 'true'; };
      const ap = document.getElementById('firmaAplicar');
      if (ap) ap.addEventListener('click', () => {
        if (!has) { if (window.toast) window.toast('Falta la firma.', 'error'); return; }
        const dataUrl = canvas.toDataURL('image/png');
        fo.dataset.open = 'false';
        if (onApply) onApply(dataUrl);
        else if (window.__aplicarFirmaRecibo) window.__aplicarFirmaRecibo(dataUrl);
      });
    })();

    // Configurar la firma autorizada de la empresa (se estampa sola en los recibos)
    async function guardarFirmaEmpresa(url) {
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { if (window.toast) window.toast('No hay empresa activa.', 'error'); return; }
      const { error } = await window.sb.from('empresas').update({ firma_empresa: url }).eq('id', window.__EMPRESA_ACTIVA.id);
      if (error) { if (window.toast) window.toast('No se pudo guardar: ' + error.message, 'error'); return; }
      window.__EMPRESA_ACTIVA.firmaEmpresa = url;
      const opt = document.querySelector('.entity-option[data-empresa-id="' + window.__EMPRESA_ACTIVA.id + '"]');
      if (opt) opt.dataset.firma = url;
      if (window.toast) window.toast('Firma de la empresa guardada · se estampará en los recibos', 'success');
    }
    const firmaEmpBtn = document.getElementById('reciboFirmaEmpresa');
    if (firmaEmpBtn) firmaEmpBtn.addEventListener('click', () => { if (window.__abrirFirma) window.__abrirFirma(guardarFirmaEmpresa); });

    // ---------- Recibo de pago (semanal / quincenal / mensual) ----------
    let payFreq = 'quincenal';
    let CESTATICKET_USD = 40; // cestaticket mensual: $ pagado en Bs a la tasa BCV (Ley de Alimentación) — no salarial · editable en Parámetros
    const freqInfo = {
      semanal:   { div: 52 / 12, periodo: '', etiqueta: 'Sueldo semanal',   doc: 'SEM' },
      quincenal: { div: 2,       periodo: '', etiqueta: 'Sueldo quincenal', doc: 'NOM' },
      mensual:   { div: 1,       periodo: '', etiqueta: 'Sueldo mensual',   doc: 'MEN' },
    };
    // Período de pago REAL según la frecuencia (semana = lunes a domingo, pago típico el sábado)
    const MESES_NOM = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    function periodoNomina(freq) {
      const hoy = new Date();
      const dd = (n) => String(n).padStart(2, '0');
      const fmt = (d) => dd(d.getDate()) + '/' + dd(d.getMonth() + 1) + '/' + d.getFullYear();
      if (freq === 'semanal') {
        const lun = new Date(hoy); lun.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7)); // lunes de esta semana
        const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
        return 'Semana ' + fmt(lun) + ' al ' + fmt(dom);
      }
      if (freq === 'quincenal') {
        const ult = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
        return hoy.getDate() <= 15
          ? ('Quincena 01/' + dd(hoy.getMonth() + 1) + ' al 15/' + dd(hoy.getMonth() + 1) + '/' + hoy.getFullYear())
          : ('Quincena 16/' + dd(hoy.getMonth() + 1) + ' al ' + ult + '/' + dd(hoy.getMonth() + 1) + '/' + hoy.getFullYear());
      }
      return 'Mes de ' + MESES_NOM[hoy.getMonth()] + ' ' + hoy.getFullYear();
    }

    function calcPago(emp, freqOver) {
      const fq = freqOver || payFreq;
      const f = freqInfo[fq];
      f.periodo = periodoNomina(fq);
      const factor = 2 / f.div; // proporción respecto a la quincena (quincenal=1, mensual=2, semanal≈0,46)
      // Nómina se liquida con la tasa de FECHA VALOR más reciente publicada por el BCV:
      // el sábado de pago usa la del lunes siguiente (publicada el viernes en la tarde).
      const tasa = window.__bcvRateNomina || window.__bcvRate || 145.82;

      // Salario base COTIZABLE = el que se declara para el trabajador.
      // El Bono de Contingencia es un complemento NO salarial (no cotizable), explícito.
      const sueldo = (emp.salarioMes || 0) / f.div;
      const transporteBs = (emp.transporteUSD || 0) * tasa / f.div; // bono de transporte mensual en divisa, pagado en Bs a tasa BCV (no salarial)

      const salDia = SALARIO_MINIMO / 30;            // recargos legales sobre el salario base
      const valHora = salDia / 8;                    // jornada de 8 h

      // Horas extras (Art. 118 LOTTT: recargo 50% sobre la hora normal)
      const valHoraExtra = valHora * 1.5;
      const horas = Math.round(emp.horasExtra || 0);       // novedad: horas reales del período
      const montoExtra = horas * valHoraExtra;

      // Bono nocturno (Art. 117 LOTTT: recargo 30% sobre la hora normal)
      const valBonoNoct = valHora * 0.30;
      const horasNoct = Math.round(emp.horasNoct || 0);    // novedad del período
      const montoNoct = horasNoct * valBonoNoct;

      // Días feriados / domingos trabajados (Art. 120 LOTTT: recargo 50%)
      const diasFeriado = Math.round(emp.diasFeriado || 0); // novedad del período
      const montoFeriado = diasFeriado * salDia * 1.5;

      // Comisiones y bono de producción (novedades del período, salariales)
      const comision = (emp.comisionBs || 0);
      const bonoProd = (emp.bonoProdBs || 0);

      // Cestaticket / bono de alimentación: $40/mes pagado en Bs a tasa BCV (no salarial, sin deducciones).
      // Semanal se calcula (40/30)×7 = 9,33 $/semana (convención de la firma, redondeado a 2
      // decimales en USD para casar con las planillas); quincenal /2, mensual completo.
      const cestaUsdPeriodo = Math.round(CESTATICKET_USD * (fq === 'semanal' ? 7 / 30 : 1 / f.div) * 100) / 100;
      const cestaticket = cestaUsdPeriodo * tasa;

      // Bono de Contingencia (modelo de la firma): emp.contingenciaUSD es el PAQUETE TOTAL
      // en USD del PERÍODO DE PAGO del trabajador (ej. 70 $ semanales). El bono completa el
      // paquete después del salario neto de ley y el cestaticket, de modo que el trabajador
      // reciba EXACTAMENTE su paquete en Bs a la tasa BCV, muevan lo que muevan las deducciones.
      const dedSueldo = Math.min(sueldo, TOPE_IVSS / f.div) * R_IVSS_T
        + Math.min(sueldo, TOPE_RPE / f.div) * R_RPE_T + sueldo * R_FAOV_T;
      const paqueteBs = (emp.contingenciaUSD || 0) * tasa;
      const bonoContingencia = Math.max(0, paqueteBs - cestaticket - (sueldo - dedSueldo));

      // Base salarial total (asignaciones salariales que devenga el trabajador)
      const baseSalarial = sueldo + montoExtra + montoNoct + montoFeriado + comision + bonoProd;

      // Salario normal cotizable (Art. 104 LOTTT): regular y permanente =
      // salario base + comisiones + bono de producción.
      const salarioNormal = sueldo + comision + bonoProd;

      // Deducciones de ley con topes de cotización (prorrateados al período).
      // El INCES del trabajador (0,5%) NO se deduce aquí: va sobre las utilidades.
      const baseIvss = Math.min(salarioNormal, TOPE_IVSS / f.div);
      const baseRpe  = Math.min(salarioNormal, TOPE_RPE / f.div);
      const ivss = baseIvss * R_IVSS_T;
      const spf = baseRpe * R_RPE_T;
      const faov = salarioNormal * R_FAOV_T; // FAOV sin tope legal
      const dedLey = ivss + spf + faov;

      // Otras deducciones
      const cajaAhorro = salarioNormal * (emp.cajaAhorroPct || 0);
      const prestamo = (emp.prestamoCuota || 0) / f.div;     // recurrente mensual, prorrateado
      const anticipo = (emp.anticipoSueldo || 0);            // novedad del período
      const dedOtras = cajaAhorro + prestamo + anticipo;

      const ded = dedLey + dedOtras;
      const asigSalarial = baseSalarial;
      // El Bono de Contingencia, el cestaticket y el bono de transporte son asignaciones NO salariales
      const asig = asigSalarial + bonoContingencia + cestaticket + transporteBs;
      const neto = asig - ded;
      return {
        f, tasa, salDia, sueldo, bonoContingencia, transporteBs, valHora, baseIvss, baseRpe,
        valHoraExtra, horas, montoExtra,
        valBonoNoct, horasNoct, montoNoct,
        diasFeriado, montoFeriado, comision, bonoProd,
        cestaticket, cestaUsdPeriodo, ivss, spf, faov, dedLey,
        cajaAhorro, prestamo, anticipo, dedOtras, ded,
        asigSalarial, asig, neto,
      };
    }

    function openReciboPago(emp) {
      // El recibo SIEMPRE usa la frecuencia propia del trabajador (semanal/quincenal/mensual):
      // el selector de arriba queda para la relación de nómina, no puede dañar un recibo.
      if (emp.frecHabitual && emp.frecHabitual !== payFreq) {
        payFreq = emp.frecHabitual;
        const selFreq = document.getElementById('payFreq');
        if (selFreq) selFreq.querySelectorAll('button').forEach((x) => {
          if (x.dataset.freq === payFreq) { x.dataset.active = 'true'; } else { x.removeAttribute('data-active'); }
        });
        renderEmpTable();
      }
      const p = calcPago(emp);
      modalTitle.textContent = 'Recibo de Pago de Nómina';
      const hoyR = new Date();
      const fecha = ('0' + hoyR.getDate()).slice(-2) + '/' + ('0' + (hoyR.getMonth() + 1)).slice(-2) + '/' + hoyR.getFullYear();
      const numDoc = p.f.doc + '-' + hoyR.getFullYear() + '-10-' + emp.id.toUpperCase();

      const rows = [['sec', 'Asignaciones salariales', '', null]];
      rows.push(['asig', p.f.etiqueta + ' (salario base)', 'Salario base cotizable · Bs ' + fmt(emp.salarioMes) + '/mes', p.sueldo]);
      if (p.horas > 0) rows.push(['asig', 'Horas extras (' + p.horas + ' h)', 'Bs ' + fmt(p.valHoraExtra) + '/h · recargo 50% (Art. 118)', p.montoExtra]);
      if (p.horasNoct > 0) rows.push(['asig', 'Bono nocturno (' + p.horasNoct + ' h)', 'Bs ' + fmt(p.valBonoNoct) + '/h · recargo 30% (Art. 117)', p.montoNoct]);
      if (p.diasFeriado > 0) rows.push(['asig', 'Días feriados / domingos (' + p.diasFeriado + ')', 'Recargo 50% sobre el día (Art. 120)', p.montoFeriado]);
      if (p.comision > 0) rows.push(['asig', 'Comisiones por ventas', '2% sobre ventas del período', p.comision]);
      if (p.bonoProd > 0) rows.push(['asig', 'Bono de producción', 'Meta de planta alcanzada', p.bonoProd]);
      rows.push(['sec', 'Beneficios no salariales (no cotizables)', '', null]);
      if (p.bonoContingencia > 0) rows.push(['asig', 'Bono de contingencia', 'completa el paquete de $' + (emp.contingenciaUSD || 0) + ' del período (Bs ' + fmt(p.tasa) + '/$) · no salarial', p.bonoContingencia]);
      rows.push(['asig', 'Cestaticket · Bono de alimentación', '$' + (p.cestaUsdPeriodo || 0) + ' del período ($40/mes) a tasa BCV (Bs ' + fmt(p.tasa) + '/$) · exento de deducciones', p.cestaticket]);
      if (p.transporteBs > 0) rows.push(['asig', 'Bono de transporte', '$' + (emp.transporteUSD || 0) + ' a tasa BCV (Bs ' + fmt(p.tasa) + '/$) · pagado en Bs', p.transporteBs]);
      rows.push(['sec', 'Deducciones de ley', '', null]);
      rows.push(['ded', 'IVSS · Seguro Social', fmt(R_IVSS_T * 100) + '% · base tope 5 sal. mín.', p.ivss]);
      rows.push(['ded', 'SPF · Paro Forzoso', fmt(R_RPE_T * 100) + '% · base tope 10 sal. mín.', p.spf]);
      rows.push(['ded', 'FAOV · Política Habitacional', fmt(R_FAOV_T * 100) + '% s/ salario normal', p.faov]);
      if (p.dedOtras > 0) {
        rows.push(['sec', 'Otras deducciones', '', null]);
        if (p.cajaAhorro > 0) rows.push(['ded', 'Caja de ahorro', (emp.cajaAhorroPct * 100).toFixed(0) + '% del sueldo', p.cajaAhorro]);
        if (p.prestamo > 0) rows.push(['ded', 'Cuota de préstamo', 'Anticipo de prestaciones', p.prestamo]);
        if (p.anticipo > 0) rows.push(['ded', 'Anticipo de sueldo', 'Descuento acordado', p.anticipo]);
      }

      const rowsHtml = rows.map((r) => {
        if (r[0] === 'sec') return '<tr class="sec"><td colspan="3">' + r[1] + '</td></tr>';
        const signo = r[0] === 'ded' ? '− ' : '';
        return '<tr class="' + r[0] + '"><td>' + r[1] + (r[2] ? '<span class="sub">' + r[2] + '</span>' : '') + '</td><td class="num">Bs</td><td class="num">' + signo + fmt(r[3]) + '</td></tr>';
      }).join('');

      const EMPR = window.__EMPRESA_ACTIVA || {};
      const ingresoTxt = (emp.ingreso && emp.ingreso.getDate) ? (('0' + emp.ingreso.getDate()).slice(-2) + '/' + ('0' + (emp.ingreso.getMonth() + 1)).slice(-2) + '/' + emp.ingreso.getFullYear()) : '—';
      doc.innerHTML =
        '<div class="recibo-head">'
        + '<div><div class="rh-co">' + (EMPR.n || '—') + '</div><div class="rh-meta"><span class="mono">RIF ' + (EMPR.rif || '—') + '</span>'
        + (EMPR.dom ? '<br>' + EMPR.dom : '') + (EMPR.tel ? '<br>Telf. ' + EMPR.tel : '') + '</div></div>'
        + '<div class="rh-kind"><div class="k">Recibo de Pago</div><div class="num">N° ' + numDoc + '</div></div>'
        + '</div>'
        + '<div class="recibo-party">'
        + '<div class="rp"><div class="l">Trabajador</div><div class="v">' + emp.nombre + '</div></div>'
        + '<div class="rp"><div class="l">Cédula</div><div class="v mono">' + emp.cedula + '</div></div>'
        + '<div class="rp"><div class="l">Cargo</div><div class="v">' + emp.cargo + ' · ' + emp.depto + '</div></div>'
        + '<div class="rp"><div class="l">Fecha de ingreso</div><div class="v">' + ingresoTxt + '</div></div>'
        + '<div class="rp"><div class="l">Tipo de trabajador</div><div class="v">' + emp.tipo + (emp.tipo === 'Planta' ? ' · producción' : '') + '</div></div>'
        + '<div class="rp"><div class="l">Período de pago</div><div class="v">' + p.f.periodo + '</div></div>'
        + '<div class="rp"><div class="l">Forma de pago</div><div class="v">' + emp.formaPago + '</div></div>'
        + '<div class="rp"><div class="l">Fecha de emisión</div><div class="v">' + fecha + '</div></div>'
        + '</div>'
        + '<table class="recibo-table"><thead><tr><th>Concepto</th><th class="num"></th><th class="num">Monto</th></tr></thead>'
        + '<tbody>' + rowsHtml + '</tbody>'
        + '<tfoot><tr><td>Neto a pagar</td><td class="num">Bs</td><td class="num">' + fmt(p.neto) + '</td></tr></tfoot></table>'
        + '<div class="recibo-words">Son: <strong>' + capitalizar(montoEnLetras(p.neto)) + '</strong>.</div>'
        + '<div class="recibo-foot">'
        + '<div class="recibo-sign">' + ((window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.firmaEmpresa) ? '<img src="' + window.__EMPRESA_ACTIVA.firmaEmpresa + '" alt="firma empresa" style="max-height:54px;display:block;margin:0 auto 2px;">' : '') + '<div class="line">Por la empresa</div></div>'
        + '<div class="recibo-sign"><div class="line">Recibí conforme · ' + emp.nombre + '</div></div>'
        + '<div class="recibo-legal">Recibo de pago emitido conforme al Art. 106 de la LOTTT. Las deducciones de ley (IVSS y RPE, con tope de cotización, y FAOV) se aplican sobre el salario normal cotizable; el INCES del trabajador (0,5%) se retiene sobre las utilidades. El Bono de Contingencia es una asignación no salarial que no es cotizable ni incide en prestaciones, vacaciones ni utilidades. El aporte patronal corre por cuenta de la empresa y no se refleja en este recibo. Documento generado electrónicamente por DigiAccount, válido sin firma autógrafa.</div>'
        + '</div>';

      lastReciboText = 'Recibo de Pago de Nomina - ' + emp.nombre + ' (' + emp.cedula + ')\r\n'
        + 'Documento: ' + numDoc + '  Periodo: ' + p.f.periodo + '\r\n'
        + '----------------------------------------\r\n'
        + '  ' + p.f.etiqueta + ': Bs ' + fmt(p.sueldo) + '\r\n'
        + (p.horas > 0 ? '  Horas extras (' + p.horas + ' h): Bs ' + fmt(p.montoExtra) + '\r\n' : '')
        + (p.horasNoct > 0 ? '  Bono nocturno (' + p.horasNoct + ' h): Bs ' + fmt(p.montoNoct) + '\r\n' : '')
        + (p.diasFeriado > 0 ? '  Dias feriados (' + p.diasFeriado + '): Bs ' + fmt(p.montoFeriado) + '\r\n' : '')
        + (p.comision > 0 ? '  Comisiones: Bs ' + fmt(p.comision) + '\r\n' : '')
        + (p.bonoProd > 0 ? '  Bono de produccion: Bs ' + fmt(p.bonoProd) + '\r\n' : '')
        + (p.bonoContingencia > 0 ? '  Bono de contingencia (no salarial): Bs ' + fmt(p.bonoContingencia) + '\r\n' : '')
        + '  Cestaticket (no salarial): Bs ' + fmt(p.cestaticket) + '\r\n'
        + (p.transporteBs > 0 ? '  Bono de transporte (no salarial): Bs ' + fmt(p.transporteBs) + '\r\n' : '')
        + '  (-) IVSS: Bs ' + fmt(p.ivss) + '\r\n'
        + '  (-) SPF: Bs ' + fmt(p.spf) + '\r\n'
        + '  (-) FAOV: Bs ' + fmt(p.faov) + '\r\n'
        + (p.cajaAhorro > 0 ? '  (-) Caja de ahorro: Bs ' + fmt(p.cajaAhorro) + '\r\n' : '')
        + (p.prestamo > 0 ? '  (-) Cuota prestamo: Bs ' + fmt(p.prestamo) + '\r\n' : '')
        + (p.anticipo > 0 ? '  (-) Anticipo sueldo: Bs ' + fmt(p.anticipo) + '\r\n' : '')
        + '----------------------------------------\r\n'
        + 'NETO A PAGAR: Bs ' + fmt(p.neto) + '\r\n'
        + 'Son: ' + capitalizar(montoEnLetras(p.neto)) + '\r\n';
      lastReciboName = ('Recibo ' + emp.nombre + ' - ' + p.f.periodo).replace(/[\\/:*?"<>|]/g, '-') + '.txt';
      currentReciboPago = { emp: emp, p: p, rows: rows, periodo: p.f.periodo, frecuencia: payFreq };

      overlay.dataset.open = 'true';
      drawIcons();
    }

    // Tabla de empleados generada desde el array completo (todos los activos),
    // con columna de acción "Recibo" por trabajador.
    function renderEmpTable() {
      const empPane = view.querySelector('.nomina-tab[data-tab="empleados"]');
      const table = empPane && empPane.querySelector('table.data-table');
      if (!table) return;
      const headRow = table.querySelector('thead tr');
      if (headRow && !headRow.dataset.wired) {
        const th = document.createElement('th');
        headRow.appendChild(th);
        headRow.dataset.wired = '1';
      }
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      // Columna de período: sigue la frecuencia seleccionada (Semana / Quincena / Mes)
      const perTh = document.getElementById('empPeriodoTh');
      if (perTh) perTh.textContent = payFreq === 'semanal' ? 'Semana' : payFreq === 'mensual' ? 'Mes' : 'Quincena';
      // Overline del módulo: período real según la frecuencia del cuadro (ya no fijo "16-31 may")
      const ovl = document.getElementById('nominaOverline');
      if (ovl) ovl.textContent = 'Recursos Humanos · ' + periodoNomina(payFreq);
      // Tarjeta patronal de Protección a las Pensiones: real, y OCULTA si la empresa es exenta
      const ppCard = document.getElementById('ppPatronalCard');
      const exentaDpp = (window.__EMPRESA_ACTIVA || {}).declaraDpp === false;
      if (ppCard) {
        ppCard.style.display = exentaDpp ? 'none' : '';
        if (!exentaDpp) {
          const baseDpp = empleados.reduce((s, e) => s + (Number(e.salarioMes) || 0), 0); // salario cotizable mensual
          const setPP = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = 'Bs ' + fmt(v); };
          setPP('ppPatronalBase', baseDpp);
          setPP('ppPatronalMonto', baseDpp * 0.09);
        }
      }
      const divPer = payFreq === 'semanal' ? (52 / 12) : payFreq === 'mensual' ? 1 : 2;
      const FREC_TAG = { semanal: '<span class="tag success">Semanal</span>', quincenal: '<span class="tag">Quincenal</span>', mensual: '<span class="tag warn">Mensual</span>' };
      tbody.innerHTML = empleados.map((emp, i) => {
        return '<tr>'
          + '<td><div class="emp-cell"><div class="emp-avatar" style="background:' + emp.color + ';">' + emp.ini + '</div>'
          + '<div class="info"><div class="n">' + emp.nombre + '</div><div class="r">' + (emp.depto !== '—' ? emp.depto : ('$' + (emp.contingenciaUSD || 0) + ' / período')) + '</div></div></div></td>'
          + '<td class="mono">' + emp.cedula + '</td>'
          + '<td>' + (emp.cargo || '—') + '</td>'
          + '<td class="num">' + fmt(emp.salarioMes) + '</td>'
          + '<td class="num">' + (emp.contingenciaUSD ? '$' + emp.contingenciaUSD : '—') + '</td>'
          + '<td>' + emp.formaPago + '</td>'
          + '<td class="num">' + fmt(emp.salarioMes / divPer) + '</td>'
          + '<td>' + (FREC_TAG[emp.frecHabitual] || FREC_TAG.quincenal) + '</td>'
          + '<td style="white-space:nowrap;"><button class="btn btn-ghost" data-emp-edit="' + i + '" title="Editar trabajador" style="height:28px;font-size:11px;padding:0 9px;"><i data-lucide="pencil"></i></button> <button class="btn btn-ghost" data-emp-exp="' + i + '" title="Expediente (cédula, RIF, contrato)" style="height:28px;font-size:11px;padding:0 9px;"><i data-lucide="folder"></i></button> <button class="btn btn-ghost" data-emp-idx="' + i + '" style="height:28px;font-size:11px;padding:0 10px;"><i data-lucide="file-text"></i> Recibo</button></td>'
          + '</tr>';
      }).join('');
      tbody.querySelectorAll('button[data-emp-idx]').forEach((b) => {
        b.addEventListener('click', () => openReciboPago(empleados[parseInt(b.dataset.empIdx, 10)]));
      });
      tbody.querySelectorAll('button[data-emp-edit]').forEach((b) => {
        b.addEventListener('click', () => formEmpleado(empleados[parseInt(b.dataset.empEdit, 10)]));
      });
      tbody.querySelectorAll('button[data-emp-exp]').forEach((b) => {
        b.addEventListener('click', () => expedienteEmpleado(empleados[parseInt(b.dataset.empExp, 10)]));
      });
      // Mantener el contador de empleados sincronizado
      const badge = view.querySelector('.contrib-badge');
      if (badge) badge.innerHTML = '<i data-lucide="users"></i> ' + empleados.length + ' empleados activos';
      const tabCount = document.querySelector('#nominaTabs button[data-tab="empleados"] .count');
      if (tabCount) tabCount.textContent = empleados.length;
      const footer = document.getElementById('empCountFooter');
      if (footer) footer.innerHTML = empleados.length ? ('Mostrando <strong>' + empleados.length + '</strong> empleado' + (empleados.length === 1 ? '' : 's')) : 'Sin empleados';
      drawIcons();
    }
    function renderAll() {
      ['vacaciones', 'utilidades', 'liquidacion'].forEach((tab) => { if (!state[tab] || !empById(state[tab])) state[tab] = empleados[0] ? empleados[0].id : null; });
      renderEmpTable();
      buildRelacionNomina();
      ['vacaciones', 'utilidades', 'liquidacion'].forEach((tab) => { renderPicker(tab); renderCalc(tab); });
    }
    async function cargarEmpleados() {
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { empleados = []; renderAll(); return; }
      const { data, error } = await window.sb.from('empleados').select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).eq('activo', true).order('nombre');
      if (error) { console.warn('[DigiAccount] empleados:', error.message); empleados = []; renderAll(); return; }
      const PAL = ['#003057', '#00aeef', '#1c8f5a', '#c97a14', '#c0392b', '#6f8aab', '#3a7bb8', '#9a5ba8', '#2e7d6b', '#b8568f'];
      empleados = (data || []).map((r, i) => ({
        id: r.id, nombre: r.nombre, cedula: r.cedula || '', cargo: r.cargo || '', depto: r.depto || '—', tipo: r.tipo || 'Administrativo',
        ingreso: r.ingreso ? new Date(r.ingreso + 'T00:00:00') : new Date(2026, 0, 1), salarioMes: Number(r.salario_mes) || 0,
        transporteUSD: Number(r.transporte_usd) || 0,
        bonoLabel: Number(r.transporte_usd) > 0 ? '$' + Number(r.transporte_usd) + ' transp.' : '—',
        sujetoDpp: !!r.sujeto_dpp,
        formaPago: r.forma_pago || 'Transferencia', frecHabitual: r.frecuencia || 'quincenal',
        prestamoCuota: Number(r.prestamo_cuota) || 0, cajaAhorroPct: (Number(r.caja_ahorro_pct) || 0) / 100,
        contingenciaUSD: Number(r.contingencia_usd) || 0,
        correo: r.correo || '', whatsapp: r.whatsapp || '',
        horasExtra: 0, horasNoct: 0, diasFeriado: 0, comisionBs: 0, bonoProdBs: 0, anticipoSueldo: 0,
        color: r.color || PAL[i % PAL.length], ini: r.ini || (r.nombre || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
      }));
      renderAll();
    }
    window.cargarEmpleados = cargarEmpleados;
    cargarEmpleados();

    // Formulario de trabajador (crear y editar) reutilizable
    const PALETA = ['#003057', '#00aeef', '#1c8f5a', '#c97a14', '#c0392b', '#6f8aab', '#3a7bb8', '#9a5ba8', '#2e7d6b', '#b8568f'];
    const _isoFecha = (d) => { try { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); } catch (e) { return ''; } };
    function formEmpleado(emp) {
      const esEdit = !!emp;
      const t = (m, tp) => { if (window.toast) window.toast(m, tp); };
      window.openFormModal({
        title: esEdit ? 'Editar trabajador' : 'Registrar nuevo trabajador',
        saveLabel: esEdit ? 'Guardar cambios' : 'Registrar trabajador',
        onDelete: esEdit ? (close) => {
          if (!window.confirm('¿Dar de baja a "' + emp.nombre + '"? Dejará de aparecer en la nómina.')) return;
          window.sb.from('empleados').update({ activo: false }).eq('id', emp.id).then(({ error }) => {
            if (error) { t('No se pudo dar de baja: ' + error.message, 'error'); return; }
            close(); if (window.cargarEmpleados) window.cargarEmpleados(); t('Trabajador dado de baja');
          });
        } : undefined,
        fields: [
          { name: 'nombre', label: 'Nombre y apellido', col: 2, placeholder: 'Ej. Juan Pérez', value: emp ? emp.nombre : '' },
          { name: 'cedula', label: 'Cédula', placeholder: 'V-00.000.000', value: emp ? emp.cedula : '' },
          { name: 'cargo', label: 'Cargo', placeholder: 'Ej. Asistente', value: emp ? emp.cargo : '' },
          { name: 'depto', label: 'Departamento', placeholder: 'Ej. Administración', value: emp && emp.depto !== '—' ? emp.depto : '' },
          { name: 'tipo', label: 'Tipo de trabajador', type: 'select', value: emp ? emp.tipo : 'Administrativo', options: ['Administrativo', 'Planta', 'Producción', 'Gerencia'] },
          { name: 'ingreso', label: 'Fecha de ingreso', type: 'date', value: emp && emp.ingreso ? _isoFecha(emp.ingreso) : new Date().toISOString().slice(0, 10) },
          { name: 'salarioMes', label: 'Salario base mensual cotizable (Bs)', type: 'number', step: '0.01', placeholder: '0.00', value: emp ? String(emp.salarioMes) : '' },
          { name: 'contingenciaUSD', label: 'Paquete del período en USD (ej. 70 semanales — el Bono de Contingencia completa: paquete − cesta − salario)', type: 'number', step: '0.01', moneda: 'USD', placeholder: '0', value: emp ? String(emp.contingenciaUSD || '') : '' },
          { name: 'transporteUSD', label: 'Bono de transporte en USD (se paga en Bs a tasa BCV)', type: 'number', step: '0.01', moneda: 'USD', placeholder: '0', value: emp ? String(emp.transporteUSD || '') : '' },
          { name: 'formaPago', label: 'Forma de pago', type: 'select', value: emp ? emp.formaPago : 'Transferencia', options: ['Transferencia', 'Efectivo', 'Pago móvil'] },
          { name: 'frec', label: 'Frecuencia (automática según el tipo)', type: 'select', value: emp ? emp.frecHabitual : 'quincenal', options: [{ value: 'quincenal', label: 'Quincenal' }, { value: 'semanal', label: 'Semanal' }, { value: 'mensual', label: 'Mensual' }] },
          { name: 'dpp', label: '¿Sujeto a DPP? (Protección Pensiones 9%)', type: 'select', value: emp ? (emp.sujetoDpp ? 'Sí' : 'No') : 'No', options: ['No', 'Sí'] },
          { name: 'cajaAhorroPct', label: 'Caja de ahorro (% del sueldo, opcional)', type: 'number', step: '0.1', placeholder: '0', value: emp && emp.cajaAhorroPct ? String(emp.cajaAhorroPct * 100) : '' },
          { name: 'correo', label: 'Correo (opcional)', placeholder: 'trabajador@correo.com', value: emp ? (emp.correo || '') : '' },
          { name: 'whatsapp', label: 'WhatsApp (opcional)', placeholder: '0412-1234567', value: emp ? (emp.whatsapp || '') : '' },
        ],
        afterRender: (bodyEl) => {
          ['nombre', 'cedula', 'cargo', 'depto'].forEach((n) => {
            const el = bodyEl.querySelector('[data-name="' + n + '"]');
            if (el) el.addEventListener('input', () => { const s = el.selectionStart; el.value = el.value.toUpperCase(); try { el.setSelectionRange(s, s); } catch (e) {} });
          });
          const tipoEl = bodyEl.querySelector('[data-name="tipo"]');
          const frecEl = bodyEl.querySelector('[data-name="frec"]');
          const autoFrec = () => { if (!tipoEl || !frecEl) return; const tp = tipoEl.value; frecEl.value = tp === 'Gerencia' ? 'mensual' : (tp === 'Administrativo' ? 'quincenal' : 'semanal'); };
          if (tipoEl) tipoEl.addEventListener('change', autoFrec);
          if (!esEdit) autoFrec();
        },
        onSave: (v) => {
          const sal = parseFloat(v.salarioMes);
          if (!v.nombre || !v.cedula || !v.cargo) return 'Nombre, cédula y cargo son obligatorios.';
          if (!(sal > 0)) return 'El salario base mensual debe ser mayor a cero.';
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa.';
          const ini = v.nombre.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
          const datos = {
            nombre: v.nombre.trim(), cedula: v.cedula.trim(), cargo: v.cargo.trim(), depto: (v.depto || '').trim() || null,
            tipo: v.tipo, ingreso: v.ingreso || null, salario_mes: sal, contingencia_usd: parseFloat(v.contingenciaUSD) || 0, transporte_usd: parseFloat(v.transporteUSD) || 0,
            forma_pago: v.formaPago, frecuencia: v.frec, sujeto_dpp: (v.dpp === 'Sí'), caja_ahorro_pct: parseFloat(v.cajaAhorroPct) || 0, ini: ini,
            correo: (v.correo || '').trim() || null, whatsapp: (v.whatsapp || '').trim() || null,
          };
          const accion = esEdit
            ? window.sb.from('empleados').update(datos).eq('id', emp.id)
            : window.sb.from('empleados').insert(Object.assign({}, datos, { cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, color: PALETA[Math.floor(Math.random() * PALETA.length)], activo: true }));
          accion.then(({ error }) => {
            if (error) { t('No se pudo guardar: ' + error.message, 'error'); return; }
            if (window.cargarEmpleados) window.cargarEmpleados();
            t(esEdit ? 'Trabajador actualizado' : 'Trabajador "' + v.nombre.trim() + '" registrado');
          });
        },
      });
    }

    // Expediente digital del trabajador (Bóveda de Nómina): cédula, RIF, contrato…
    const _DOC_BUCKET = 'documentos-fiscales';
    const _safeKey = (s) => (s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    function expedienteEmpleado(emp) {
      const t = (m, tp) => { if (window.toast) window.toast(m, tp); };
      if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { t('No hay una empresa activa.', 'error'); return; }
      let fileEl = null;
      const escH = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const fmtKb = (n) => { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
      async function pintarLista(cont) {
        const { data, error } = await window.sb.from('documentos_empleado').select('*').eq('empleado_id', emp.id).order('creado_en', { ascending: false });
        if (error) { cont.innerHTML = '<div style="font-size:12px;color:var(--fg-muted);">No se pudo cargar (¿creaste la tabla documentos_empleado?).</div>'; return; }
        if (!data || !data.length) { cont.innerHTML = '<div style="font-size:12px;color:var(--fg-muted);padding:6px 0;">Aún no hay documentos cargados para este trabajador.</div>'; return; }
        const tag = (t) => { const c = /dula/i.test(t) ? 'cyan' : /rif/i.test(t) ? 'slate' : /contrato/i.test(t) ? 'success' : 'amber'; return '<span class="tag ' + c + '">' + escH(t) + '</span>'; };
        cont.innerHTML = data.map((d) => {
          const fecha = d.creado_en ? new Date(d.creado_en).toLocaleDateString('es-VE') : '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">'
            + '<div style="flex:0 0 150px;">' + tag(d.tipo) + '</div>'
            + '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" class="mono" title="' + escH(d.nombre) + '">' + escH(d.nombre || '') + '</div>'
            + '<div style="flex:0 0 auto;color:var(--fg-muted);">' + escH(fecha) + ' · ' + fmtKb(d.tamano) + '</div>'
            + '<button class="btn btn-ghost" data-doc-ver="' + escH(d.storage_path) + '" title="Ver / descargar" style="height:26px;padding:0 8px;"><i data-lucide="eye"></i></button>'
            + '<button class="btn btn-ghost" data-doc-del="' + escH(d.id) + '" data-doc-path="' + escH(d.storage_path) + '" title="Eliminar" style="height:26px;padding:0 8px;color:#c0392b;"><i data-lucide="trash-2"></i></button>'
            + '</div>';
        }).join('');
        if (window.lucide) window.lucide.createIcons();
        cont.querySelectorAll('[data-doc-ver]').forEach((b) => b.addEventListener('click', async (e) => {
          e.preventDefault();
          const { data: sig, error: er } = await window.sb.storage.from(_DOC_BUCKET).createSignedUrl(b.dataset.docVer, 120);
          if (er || !sig) { t('No se pudo abrir: ' + (er && er.message), 'error'); return; }
          window.open(sig.signedUrl, '_blank');
        }));
        cont.querySelectorAll('[data-doc-del]').forEach((b) => b.addEventListener('click', async (e) => {
          e.preventDefault();
          if (!window.confirm('¿Eliminar este documento del expediente? No se puede deshacer.')) return;
          await window.sb.storage.from(_DOC_BUCKET).remove([b.dataset.docPath]);
          const { error: er } = await window.sb.from('documentos_empleado').delete().eq('id', b.dataset.docDel);
          if (er) { t('No se pudo eliminar: ' + er.message, 'error'); return; }
          t('Documento eliminado', 'success'); pintarLista(cont);
        }));
      }
      window.openFormModal({
        title: 'Expediente de ' + emp.nombre,
        saveLabel: 'Subir documento',
        fields: [
          { name: 'lista', label: 'Documentos cargados', col: 2, type: 'static', html: '<div id="expLista" style="max-height:220px;overflow:auto;">Cargando…</div>' },
          { name: 'tipo', label: 'Tipo de documento', type: 'select', options: ['Cédula de identidad', 'RIF', 'Contrato de trabajo', 'Otro'] },
          { name: 'archivo', label: 'Archivo (PDF, imagen…)', type: 'file' },
        ],
        afterRender: (body) => {
          fileEl = body.querySelector('[data-name="archivo"]');
          const cont = body.querySelector('#expLista');
          if (cont) pintarLista(cont);
        },
        onSave: (v) => {
          const file = fileEl && fileEl.files && fileEl.files[0];
          if (!file) return 'Selecciona un archivo.';
          const path = window.__CUENTA_ID + '/' + window.__EMPRESA_ACTIVA.id + '/empleado/' + emp.id + '/' + _safeKey(v.tipo) + '/' + Date.now() + '_' + _safeKey(file.name);
          window.sb.storage.from(_DOC_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined }).then(({ error }) => {
            if (error) { t('No se pudo subir: ' + error.message, 'error'); return; }
            window.sb.from('documentos_empleado').insert({
              cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, empleado_id: emp.id,
              tipo: v.tipo, nombre: file.name, storage_path: path, mime: file.type, tamano: file.size,
            }).then(({ error: e2 }) => {
              if (e2) { t('Archivo subido pero no se registró: ' + e2.message, 'error'); return; }
              t('Documento guardado en el expediente', 'success');
              expedienteEmpleado(emp); // reabre para refrescar la lista
            });
          });
        },
      });
    }

    // Acciones del módulo: Nuevo trabajador / Procesar / Recalcular / Exportar
    (function wireNominaActions() {
      const empPane = view.querySelector('.nomina-tab[data-tab="empleados"]');
      const table = empPane && empPane.querySelector('table.data-table');
      const t = (m, tipo) => { if (window.toast) window.toast(m, tipo); };
      const PALETA = ['#003057', '#00aeef', '#1c8f5a', '#c97a14', '#c0392b', '#6f8aab', '#3a7bb8', '#9a5ba8', '#2e7d6b', '#b8568f'];

      const nuevoTrab = document.getElementById('nuevoTrabajadorBtn');
      if (nuevoTrab) nuevoTrab.addEventListener('click', () => formEmpleado(null));

      // Procesar nómina = generar el ASIENTO CONTABLE del período (gasto de nómina + parafiscales
      // por enterar + pago neto por banco), según la frecuencia elegida en el cuadro.
      const procesar = document.getElementById('procesarNominaBtn');
      if (procesar) procesar.addEventListener('click', () => {
        if (!empleados.length) { t('Registra trabajadores primero.', 'error'); return; }
        if (window.__contabilizarNomina) window.__contabilizarNomina(payFreq);
      });

      // Recalcular = recarga parámetros y empleados vigentes y vuelve a calcular todo el cuadro.
      const recalc = document.getElementById('recalcularNominaBtn');
      if (recalc) recalc.addEventListener('click', () => {
        if (window.cargarParametros) window.cargarParametros(); // recarga parámetros vigentes + re-render
        if (window.cargarEmpleados) window.cargarEmpleados();   // recarga empleados y recalcula todo
        t('Nómina recalculada con datos y parámetros vigentes', 'success');
      });

      const exportar = document.getElementById('exportNominaBtn');
      if (exportar) exportar.addEventListener('click', () => {
        const filas = [['N°', 'Empleado', 'Cédula', 'Cargo', 'Departamento', 'Salario base (Bs/mes)', 'Bono', 'Forma de pago', 'Quincena (Bs)']];
        empleados.forEach((e, i) => filas.push([
          i + 1, e.nombre, e.cedula, e.cargo, e.depto, fmt(e.salarioMes),
          (e.bonoLabel || '—'), e.formaPago, fmt(e.salarioMes / 2),
        ]));
        const csv = filas.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'Nomina_Empleados_2026-05.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        t('Nómina exportada a CSV · ' + empleados.length + ' empleados');
      });
    })();

    // ---------- Selector de frecuencia de pago ----------
    (function wireFreq() {
      const sel = document.getElementById('payFreq');
      const hint = document.getElementById('payFreqHint');
      if (!sel) return;
      const hints = {
        semanal: 'El pago semanal aplica típicamente a personal de planta y producción.',
        quincenal: 'Frecuencia habitual del personal administrativo.',
        mensual: 'Frecuencia habitual de cargos gerenciales.',
      };
      sel.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          sel.querySelectorAll('button').forEach((x) => x.removeAttribute('data-active'));
          b.dataset.active = 'true';
          payFreq = b.dataset.freq;
          if (hint) hint.innerHTML = '<i data-lucide="info" style="width:13px;height:13px;"></i> ' + (hints[payFreq] || '');
          renderEmpTable(); // la columna de período del cuadro sigue a la frecuencia elegida
          drawIcons();
        });
      });
    })();

    // ---------- Sub-tabs de nómina ----------
    const tabsWrap = document.getElementById('nominaTabs');
    if (tabsWrap) {
      const tabs = tabsWrap.querySelectorAll('button');
      const panes = view.querySelectorAll('.nomina-tab');
      tabs.forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          tabs.forEach((b) => (b.dataset.active = b === btn ? 'true' : 'false'));
          panes.forEach((p) => (p.dataset.active = p.dataset.tab === tab ? 'true' : 'false'));
          drawIcons();
        });
      });
    }

    // ===== Novedades del período: horas extra, nocturnas, feriados, comisiones, anticipos =====
    (function setupNovedades() {
      const freqSel = document.getElementById('novFreq');
      const perInput = document.getElementById('novPeriodo');
      const cargarBtn = document.getElementById('novCargarBtn');
      const guardarBtn = document.getElementById('novGuardarBtn');
      const body = document.getElementById('novBody');
      const msg = document.getElementById('novMsg');
      if (!cargarBtn || !body) return;
      const setMsg = (t) => { if (msg) msg.textContent = t; };

      function render(novMap) {
        if (!empleados.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--fg-muted);padding:20px;">Registra trabajadores primero.</td></tr>'; return; }
        const inp = (k, v) => '<input data-nov="' + k + '" type="number" step="0.01" value="' + (v || v === 0 ? (v || '') : '') + '" style="width:100%;min-width:0;height:30px;border:1px solid var(--border-strong);border-radius:6px;padding:0 8px;font-size:12px;text-align:right;background:var(--bg-surface);color:inherit;">';
        body.innerHTML = empleados.map((e) => {
          const n = novMap[e.id] || {};
          return '<tr data-emp="' + esc(e.id) + '"><td class="primary"><div style="display:flex;align-items:center;gap:8px;"><span style="width:24px;height:24px;border-radius:50%;background:' + e.color + ';color:#fff;font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none;">' + esc(e.ini) + '</span>' + esc(e.nombre) + '</div></td>'
            + '<td>' + inp('horasExtra', n.horas_extra) + '</td><td>' + inp('horasNoct', n.horas_noct) + '</td><td>' + inp('diasFeriado', n.dias_feriado) + '</td>'
            + '<td>' + inp('comisionBs', n.comision_bs) + '</td><td>' + inp('bonoProdBs', n.bono_prod_bs) + '</td><td>' + inp('anticipoSueldo', n.anticipo_bs) + '</td></tr>';
        }).join('');
      }
      function aplicarAEmpleados() {
        body.querySelectorAll('tr[data-emp]').forEach((tr) => {
          const e = empleados.find((x) => x.id === tr.dataset.emp); if (!e) return;
          tr.querySelectorAll('[data-nov]').forEach((el) => { e[el.dataset.nov] = parseFloat(el.value) || 0; });
        });
      }
      async function cargar() {
        const per = (perInput.value || '').trim();
        if (!per) { setMsg('Escribe un identificador de período (ej. 2026-Q11).'); return; }
        payFreq = freqSel.value; // la frecuencia del recibo sigue al período
        const novMap = {};
        if (window.sb && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
          const { data } = await window.sb.from('novedades_nomina').select('*').eq('empresa_id', window.__EMPRESA_ACTIVA.id).eq('periodo', per);
          (data || []).forEach((n) => { novMap[n.empleado_id] = n; });
        }
        render(novMap);
        empleados.forEach((e) => {
          const n = novMap[e.id] || {};
          e.horasExtra = Number(n.horas_extra) || 0; e.horasNoct = Number(n.horas_noct) || 0; e.diasFeriado = Number(n.dias_feriado) || 0;
          e.comisionBs = Number(n.comision_bs) || 0; e.bonoProdBs = Number(n.bono_prod_bs) || 0; e.anticipoSueldo = Number(n.anticipo_bs) || 0;
        });
        renderEmpTable(); buildRelacionNomina();
        setMsg('Período "' + per + '" cargado · ' + empleados.length + ' trabajadores. Edita y guarda.');
      }
      async function guardar() {
        const per = (perInput.value || '').trim();
        if (!per) { setMsg('Escribe el período antes de guardar.'); return; }
        if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { setMsg('No hay empresa activa.'); return; }
        if (!empleados.length) { setMsg('No hay trabajadores que guardar.'); return; }
        aplicarAEmpleados();
        const rows = empleados.map((e) => ({
          cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, empleado_id: e.id, periodo: per,
          horas_extra: e.horasExtra || 0, horas_noct: e.horasNoct || 0, dias_feriado: e.diasFeriado || 0,
          comision_bs: e.comisionBs || 0, bono_prod_bs: e.bonoProdBs || 0, anticipo_bs: e.anticipoSueldo || 0,
        }));
        const { error } = await window.sb.from('novedades_nomina').upsert(rows, { onConflict: 'empleado_id,periodo' });
        if (error) { setMsg('No se pudo guardar: ' + error.message); return; }
        renderEmpTable(); buildRelacionNomina();
        ['vacaciones', 'utilidades', 'liquidacion'].forEach((t) => { renderPicker(t); renderCalc(t); });
        setMsg('Novedades guardadas para "' + per + '" ✓ · los recibos del período ya las reflejan.');
      }
      cargarBtn.addEventListener('click', cargar);
      guardarBtn.addEventListener('click', guardar);
    })();

    // Init
    ['vacaciones', 'utilidades', 'liquidacion'].forEach((tab) => { renderPicker(tab); renderCalc(tab); });
  })();

  /* =========================================================
     VISOR DE FACTURA FISCAL (venezolana)
     ========================================================= */
  (function facturas() {
    const overlay = document.getElementById('facturaOverlay');
    const doc = document.getElementById('facturaDoc');
    const modalTitle = document.getElementById('facturaModalTitle');
    if (!overlay || !doc) return;

    // Datos del emisor/receptor propios: SIEMPRE la empresa activa real (nunca quemados)
    const EMPRESA = {
      get n() { return (window.__EMPRESA_ACTIVA || {}).n || '—'; },
      get rif() { return (window.__EMPRESA_ACTIVA || {}).rif || '—'; },
      get dom() { return (window.__EMPRESA_ACTIVA || {}).dom || ''; },
      get cond() { return (window.__EMPRESA_ACTIVA || {}).cond || ''; },
    };
    const IMPRENTA = { n: 'Gráficas El Sol, C.A.', rif: 'J-31002030-4', prov: 'SNAT/INTI/GRTI/RCO/2024/0185', desde: '00012001', hasta: '00015000' };
    const MAQ = { n: 'Z7C0025982', serial: 'VE-FISCAL-0044712', modelo: 'The Factory HKA PP-80 (homologado SENIAT)' };
    const ELEC = { prov: 'DigiFactura Electrónica, C.A.', rif: 'J-40551203-7', prov_aut: 'SNAT/2024/00102-DE-0087' };

    // Generador de un código QR ilustrativo (placeholder determinista) para la factura electrónica
    function qrSvg(seed) {
      const n = 21; let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      let rects = '';
      const inFinder = (x, y, fx, fy) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let on;
        if (inFinder(x, y, 0, 0) || inFinder(x, y, n - 7, 0) || inFinder(x, y, 0, n - 7)) {
          const fx = x < 7 ? 0 : (n - 7), fy = y < 7 ? 0 : (n - 7), lx = x - fx, ly = y - fy;
          on = (lx === 0 || lx === 6 || ly === 0 || ly === 6) || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
        } else on = rnd() > 0.5;
        if (on) rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
      return '<svg viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/><g fill="#0b1e3a">' + rects + '</g></svg>';
    }
    const fmt = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // Catálogo de facturas (ventas y compras) con sus renglones
    const DB = {};   // las facturas/recibos reales vienen de Supabase

    function calcFactura(f) {
      const subtotal = f.items.reduce((a, it) => a + it.c * it.p, 0);
      const iva = subtotal * f.alic;
      const igtf = f.igtf ? subtotal * 0.03 : 0;
      const total = subtotal + iva + igtf;
      return { subtotal, iva, igtf, total };
    }

    let lastText = '', lastName = 'factura.txt', currentFac = null;

    function openFactura(num) {
      const f = DB[num];
      if (!f) return;
      const t = calcFactura(f);
      const emisor = f.tipo === 'venta' ? (window.__EMPRESA_ACTIVA || EMPRESA) : f.parte;
      const receptor = f.tipo === 'venta' ? f.parte : EMPRESA;
      currentFac = { num: num, f: f, emisor: emisor, receptor: receptor };
      const alicLabel = (f.alic * 100).toLocaleString('es-VE') + '%';
      const _rec = window.__esRecibo ? window.__esRecibo() : true;
      modalTitle.textContent = (f.tipo === 'venta' ? ((_rec ? 'Recibo' : 'Factura') + ' de venta · ') : 'Factura de compra · ') + num;

      const itemRows = f.items.map((it, i) =>
        '<tr><td class="mono">ART-' + String(i + 1).padStart(3, '0') + '</td><td>' + it.d + '</td><td class="num">' + it.c + '</td><td class="num">' + fmt(it.p) + '</td>' + (_rec ? '' : '<td class="ctr">' + alicLabel + '</td>') + '<td class="num">' + fmt(it.c * it.p) + '</td></tr>'
      ).join('');

      const letras = window.__montoEnLetras ? cap(window.__montoEnLetras(t.total)) : ('Bs ' + fmt(t.total));

      // Medio de emisión: adapta el título y el pie legal de la factura
      const medio = _rec ? 'forma-libre' : (window.medioEmision || 'forma-libre');
      const tituloDoc = _rec ? 'RECIBO DE VENTA'
        : medio === 'electronica' ? 'FACTURA ELECTRÓNICA'
        : medio === 'maquina-fiscal' ? 'FACTURA · MÁQ. FISCAL' : 'FACTURA';
      const ctrlDigital = num.replace(/\D/g, '') + '-' + f.fecha.replace(/\D/g, '');
      let pieMedio;
      if (medio === 'maquina-fiscal') {
        pieMedio = '<div class="fac-legal"><strong>Máquina Fiscal:</strong> N° de registro ' + MAQ.n + ' · Serial ' + MAQ.serial + ' · Modelo ' + MAQ.modelo + '. Número de documento asignado por la máquina fiscal; reporte Z diario obligatorio. Documento emitido conforme a la Providencia Administrativa SNAT/2024/00102. El IGTF (3%) aplica a pagos en moneda extranjera o criptoactivos (Decreto Constituyente). Generado por DigiAccount.</div>';
      } else if (medio === 'electronica') {
        pieMedio = '<div class="fac-legal-e"><div class="fle-qr">' + qrSvg(num + ctrlDigital) + '</div>'
          + '<div class="fle-txt"><strong>Factura Electrónica</strong> · Certificada por ' + ELEC.prov + ' (RIF ' + ELEC.rif + ') · Autorización ' + ELEC.prov_aut + '.<br>N° de control digital: <span class="mono">' + ctrlDigital + '</span>. Verifique la validez de este documento escaneando el código QR en el portal del SENIAT. Emitido conforme a la Providencia Administrativa SNAT/2024/00102. El IGTF (3%) aplica a pagos en moneda extranjera o criptoactivos.</div></div>';
      } else if (_rec) {
        pieMedio = '<div class="fac-legal"><strong>RECIBO DE VENTA — Documento no fiscal.</strong> Este comprobante no constituye una factura ni genera crédito fiscal. Emitido por DigiAccount. El IGTF (3%) aplica a pagos en moneda extranjera o criptoactivos (Decreto Constituyente).</div>';
      } else {
        pieMedio = '<div class="fac-legal">Imprenta autorizada: <strong>' + IMPRENTA.n + '</strong> · RIF ' + IMPRENTA.rif + ' · Providencia N° ' + IMPRENTA.prov + ' · Facturas autorizadas del N° ' + IMPRENTA.desde + ' al ' + IMPRENTA.hasta + '. Documento emitido conforme a la Providencia Administrativa SNAT/2024/00102 sobre las normas generales de emisión de facturas y otros documentos. El IGTF (3%) aplica a pagos en moneda extranjera o criptoactivos (Decreto Constituyente). Generado por DigiAccount.</div>';
      }

      if (_rec) {
        // ===== RECIBO DE CAJA (rollo angosto, NO fiscal) =====
        const tkItems = f.items.map((it) =>
          '<div class="tk-item"><div class="tk-item-d">' + it.d.toUpperCase() + '</div>'
          + '<div class="tk-item-l"><span>' + it.c + ' x ' + fmt(it.p) + '</span><span>' + fmt(it.c * it.p) + '</span></div></div>'
        ).join('');
        doc.innerHTML =
          '<div class="fac-ticket">'
          + '<div class="tk-head"><div class="tk-co">' + emisor.n.toUpperCase() + '</div>'
          + '<div class="tk-line">RIF: ' + emisor.rif + '</div>'
          + (emisor.dom ? '<div class="tk-line">' + emisor.dom + '</div>' : '') + '</div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-doc">RECIBO DE VENTA</div>'
          + '<div class="tk-row"><span>N°</span><span>' + num + '</span></div>'
          + '<div class="tk-row"><span>FECHA</span><span>' + f.fecha + '</span></div>'
          + '<div class="tk-line">CLIENTE: ' + receptor.n + '</div>'
          + '<div class="tk-line">RIF/CI: ' + receptor.rif + '</div>'
          + '<div class="tk-sep dashed"></div>'
          + tkItems
          + '<div class="tk-sep dashed"></div>'
          + (f.igtf ? '<div class="tk-row"><span>SUBTOTAL Bs</span><span>' + fmt(t.subtotal) + '</span></div>' : '')
          + (f.igtf ? '<div class="tk-row"><span>IGTF 3% Bs</span><span>' + fmt(t.igtf) + '</span></div>' : '')
          + '<div class="tk-total"><span>TOTAL Bs</span><span>' + fmt(t.total) + '</span></div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-words">SON: ' + letras + '</div>'
          + '<div class="tk-sep dashed"></div>'
          + '<div class="tk-line tk-center">Documento no fiscal · no constituye una factura</div>'
          + '<div class="tk-thanks">¡GRACIAS POR SU COMPRA!</div>'
          + '<div class="tk-line tk-center">Generado por DigiAccount</div>'
          + '</div>';
      } else if (medio === 'maquina-fiscal') {
        // ===== Formato TICKET de impresora fiscal (rollo angosto) =====
        const hora = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        const tasaLetra = f.alic === 0.16 ? 'T' : f.alic === 0.08 ? 'R' : 'E';
        const tasaDesc = f.alic === 0.16 ? 'TASA GENERAL 16%' : f.alic === 0.08 ? 'TASA REDUCIDA 8%' : 'EXENTO';
        const tkItems = f.items.map((it) =>
          '<div class="tk-item"><div class="tk-item-d">' + it.d.toUpperCase() + '</div>'
          + '<div class="tk-item-l"><span>' + it.c + ' x ' + fmt(it.p) + '</span><span>' + fmt(it.c * it.p) + ' ' + tasaLetra + '</span></div></div>'
        ).join('');
        doc.innerHTML =
          '<div class="fac-ticket">'
          + '<div class="tk-head"><div class="tk-co">' + emisor.n.toUpperCase() + '</div>'
          + '<div class="tk-line">RIF: ' + emisor.rif + '</div>'
          + (emisor.dom ? '<div class="tk-line">' + emisor.dom + '</div>' : '') + '</div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-row"><span>MÁQUINA FISCAL</span><span>' + MAQ.n + '</span></div>'
          + '<div class="tk-row"><span>FECHA</span><span>' + f.fecha + '</span></div>'
          + '<div class="tk-row"><span>HORA</span><span>' + hora + '</span></div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-doc">FACTURA   N° ' + num.replace(/\D/g, '') + '</div>'
          + '<div class="tk-line">CLIENTE: ' + receptor.n + '</div>'
          + '<div class="tk-line">RIF/CI: ' + receptor.rif + '</div>'
          + '<div class="tk-sep dashed"></div>'
          + tkItems
          + '<div class="tk-sep dashed"></div>'
          + '<div class="tk-row"><span>SUBTOTAL Bs</span><span>' + fmt(t.subtotal) + '</span></div>'
          + '<div class="tk-row"><span>IVA (' + alicLabel + ') ' + tasaLetra + '</span><span>' + fmt(t.iva) + '</span></div>'
          + (f.igtf ? '<div class="tk-row"><span>IGTF 3%</span><span>' + fmt(t.igtf) + '</span></div>' : '')
          + '<div class="tk-sep"></div>'
          + '<div class="tk-total"><span>TOTAL Bs</span><span>' + fmt(t.total) + '</span></div>'
          + '<div class="tk-sep"></div>'
          + '<div class="tk-line tk-center">' + tasaLetra + ' = ' + tasaDesc + '</div>'
          + '<div class="tk-words">SON: ' + letras + '</div>'
          + '<div class="tk-sep dashed"></div>'
          + '<div class="tk-fiscal"><div class="tk-logo">▮ tt ▮</div>'
          + '<div class="tk-line tk-center">SERIAL: ' + MAQ.serial + '</div>'
          + '<div class="tk-line tk-center">' + MAQ.modelo + '</div></div>'
          + '<div class="tk-thanks">¡GRACIAS POR SU COMPRA!</div>'
          + '<div class="tk-line tk-center">Generado por DigiAccount</div>'
          + '</div>';
      } else {
        // ===== Formato documento (Forma libre / Electrónica) — media carta =====
        doc.innerHTML =
          '<div class="fac' + (medio === 'electronica' ? ' fac-e' : '') + '">'
          + (medio === 'electronica' ? '<div class="fac-e-band"><i data-lucide="shield-check"></i> DOCUMENTO ELECTRÓNICO CERTIFICADO · SENIAT</div>' : '')
          + '<div class="fac-head">'
          + '<div class="fac-emisor">'
          + (medio === 'electronica' ? '<div class="fac-logo">' + (emisor.n.replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase() || 'AV') + '</div>' : '')
          + '<div class="fac-emisor-txt"><div class="fac-co">' + emisor.n + '</div>'
          + '<div class="fac-meta"><span class="mono">RIF ' + emisor.rif + '</span>' + (emisor.cond ? ' · ' + emisor.cond : '') + '<br>' + emisor.dom + '</div></div></div>'
          + '<div class="fac-num"><div class="t">' + tituloDoc + '</div>'
          + '<div class="r"><span>N°</span><strong>' + num + '</strong></div>'
          + (_rec ? '' : '<div class="c"><span>N° de Control</span><strong>' + f.control + '</strong></div>') + '</div>'
          + '</div>'
          + '<div class="fac-cliente"><div class="fc-grid">'
          + '<div class="fc-f"><span class="l">Nombre o Razón Social</span><span class="v">' + receptor.n + '</span></div>'
          + '<div class="fc-f"><span class="l">RIF / C.I.</span><span class="v mono">' + receptor.rif + '</span></div>'
          + '<div class="fc-f"><span class="l">Fecha de Emisión</span><span class="v">' + f.fecha + '</span></div>'
          + '<div class="fc-f"><span class="l">Condición de Pago</span><span class="v">' + f.cond + '</span></div>'
          + '<div class="fc-f wide"><span class="l">Domicilio Fiscal</span><span class="v">' + receptor.dom + '</span></div>'
          + '</div></div>'
          + '<table class="fac-table"><thead><tr><th>Cód.</th><th>Descripción</th><th class="num">Cant.</th><th class="num">P. Unitario</th>' + (_rec ? '' : '<th class="ctr">Alíc.</th>') + '<th class="num">Monto</th></tr></thead>'
          + '<tbody>' + itemRows + '</tbody></table>'
          + '<div class="fac-bottom">'
          + '<div class="fac-words">Son: <strong>' + letras + '</strong></div>'
          + '<div class="fac-tot">'
          + (_rec ? '' : '<div class="ft-row"><span>Base imponible (' + alicLabel + ')</span><span class="mono">' + fmt(t.subtotal) + '</span></div>')
          + (_rec ? '' : '<div class="ft-row"><span>IVA (' + alicLabel + ')</span><span class="mono">' + fmt(t.iva) + '</span></div>')
          + (f.igtf ? '<div class="ft-row"><span>IGTF (3%)</span><span class="mono">' + fmt(t.igtf) + '</span></div>' : '')
          + '<div class="ft-row total"><span>TOTAL A PAGAR</span><span class="mono">Bs ' + fmt(t.total) + '</span></div>'
          + '</div></div>'
          + '<div class="fac-firmas"><div class="ff"><div class="line"></div>Por el emisor</div><div class="ff"><div class="line"></div>Recibido conforme · RIF/C.I.</div></div>'
          + pieMedio
          + '</div>';
      }

      lastText = _rec
        ? ('RECIBO DE VENTA N° ' + num + '\r\n'
          + 'Emisor: ' + emisor.n + ' - RIF ' + emisor.rif + '\r\n'
          + 'Cliente: ' + receptor.n + ' - RIF ' + receptor.rif + '\r\n'
          + 'Fecha: ' + f.fecha + '\r\n----------------------------------------\r\n'
          + f.items.map((it) => '  ' + it.d + '  ' + it.c + ' x ' + fmt(it.p) + ' = ' + fmt(it.c * it.p)).join('\r\n')
          + '\r\n----------------------------------------\r\n'
          + (f.igtf ? ('Subtotal: Bs ' + fmt(t.subtotal) + '\r\n' + 'IGTF 3%: Bs ' + fmt(t.igtf) + '\r\n') : '')
          + 'TOTAL: Bs ' + fmt(t.total) + '\r\n'
          + 'Documento no fiscal - no constituye una factura\r\n')
        : ((f.tipo === 'venta' ? 'FACTURA DE VENTA' : 'FACTURA DE COMPRA') + ' N° ' + num + ' (Control ' + f.control + ')\r\n'
          + 'Emisor: ' + emisor.n + ' - RIF ' + emisor.rif + '\r\n'
          + (f.tipo === 'venta' ? 'Cliente: ' : 'Proveedor: ') + receptor.n + ' - RIF ' + receptor.rif + '\r\n'
          + 'Fecha: ' + f.fecha + '\r\n----------------------------------------\r\n'
          + f.items.map((it) => '  ' + it.d + '  ' + it.c + ' x ' + fmt(it.p) + ' = ' + fmt(it.c * it.p)).join('\r\n')
          + '\r\n----------------------------------------\r\n'
          + 'Base imponible: Bs ' + fmt(t.subtotal) + '\r\n'
          + 'IVA (' + alicLabel + '): Bs ' + fmt(t.iva) + '\r\n'
          + (f.igtf ? 'IGTF (3%): Bs ' + fmt(t.igtf) + '\r\n' : '')
          + 'TOTAL: Bs ' + fmt(t.total) + '\r\n');
      lastName = 'Factura_' + num + '.txt';

      // Botón "Cobrar": solo en recibos de venta con saldo pendiente (y no anulados)
      const anulada = /anulada/i.test(f.estado || '');
      const cobrarBtn = document.getElementById('facturaCobrar');
      if (cobrarBtn) {
        const cobrado = window.__cobradoDe ? window.__cobradoDe(num) : 0;
        const pend = Math.max(0, t.total - cobrado);
        if (f.tipo === 'venta' && pend > 0.01 && !anulada) { cobrarBtn.hidden = false; cobrarBtn.dataset.pend = pend.toFixed(2); }
        else cobrarBtn.hidden = true;
      }
      // Botón "Anular": solo recibos de venta SIN cobros registrados y no anulados ya
      const anularBtn = document.getElementById('facturaAnular');
      if (anularBtn) {
        const cobrado2 = window.__cobradoDe ? window.__cobradoDe(num) : 0;
        anularBtn.hidden = !(f.tipo === 'venta' && !anulada && cobrado2 < 0.01 && f._id);
      }

      overlay.dataset.open = 'true';
      drawIcons();
    }

    function close() { overlay.dataset.open = 'false'; }
    // Cobrar: abre el registro de cobro prefilleado con el cliente, el recibo y el saldo pendiente
    const cobrarBtnEl = document.getElementById('facturaCobrar');
    if (cobrarBtnEl) cobrarBtnEl.addEventListener('click', () => {
      if (!currentFac) return;
      const pre = { tipo: 'ingreso', tercero: currentFac.receptor.n, factura: currentFac.num, monto: cobrarBtnEl.dataset.pend };
      close();
      if (window.__registrarCobro) window.__registrarCobro(pre);
      else if (window.toast) window.toast('Abre el módulo de Tesorería para registrar el cobro.', 'error');
    });
    // Anular: deja el recibo sin efecto (estado Anulada) con reverso contable y
    // reposición del stock. Solo si NO tiene cobros (si los tiene, primero se reversan).
    const anularBtnEl = document.getElementById('facturaAnular');
    if (anularBtnEl) anularBtnEl.addEventListener('click', async () => {
      if (!currentFac || !currentFac.f || !currentFac.f._id) return;
      const num = currentFac.num, f = currentFac.f;
      const cobrado = window.__cobradoDe ? window.__cobradoDe(num) : 0;
      if (cobrado > 0.01) { if (window.toast) window.toast('Este recibo tiene cobros registrados — no se puede anular directo.', 'error'); return; }
      const ok = window.confirm('¿ANULAR el recibo ' + num + '?\n\nQuedará sin efecto: se reversa el asiento de la venta y se repone el stock de los productos. Esta acción no se puede deshacer.');
      if (!ok) return;
      const { error } = await window.sb.from('facturas').update({ estado: 'Anulada' }).eq('id', f._id);
      if (error) { if (window.toast) window.toast('No se pudo anular: ' + error.message, 'error'); return; }
      // Reverso contable (solo en modo recibos; en modo libro contabiliza el Libro de Ventas)
      const t = calcFactura(f);
      const _modo = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.modo) || 'recibos';
      if (window.__postAsiento && _modo !== 'libro') {
        const ln = [{ cta: '4.1.1.01 · Venta de mercancía', debe: t.subtotal, haber: 0 }];
        if (t.iva > 0.005) ln.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: t.iva, haber: 0 });
        if (t.igtf > 0.005) ln.push({ cta: '2.1.4.03 · IGTF por pagar', debe: t.igtf, haber: 0 });
        ln.push({ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: 0, haber: t.total });
        window.__postAsiento('Anulación recibo ' + num + ' · ' + (f.parte ? f.parte.n : ''), num, ln, 'auto')
          .then((r) => { if (r && r.error) console.warn('[DigiAccount] Reverso de anulación:', r.error.message); });
      }
      // Reponer el stock de los productos del recibo
      const ups = (f.items || []).filter((it) => it.pid).map((it) => {
        const prod = (window.__getProductos ? window.__getProductos() : []).find((x) => x.id === it.pid);
        const nuevo = (Number(prod ? prod.stock : 0) || 0) + (Number(it.c) || 0);
        return window.sb.from('productos').update({ stock: nuevo }).eq('id', it.pid);
      });
      if (ups.length) Promise.all(ups).then(() => { if (window.cargarProductos) window.cargarProductos(); });
      close();
      if (window.toast) window.toast('Recibo ' + num + ' ANULADO · asiento reversado y stock repuesto', 'success');
      if (window.cargarFacturas) window.cargarFacturas();
      if (window.cargarTesoreria) window.cargarTesoreria();
      if (window.cargarDashboard) window.cargarDashboard();
    });
    const cb = document.getElementById('facturaClose');
    if (cb) cb.addEventListener('click', close);
    // Despachar: genera la Guía de Despacho a partir de la factura abierta
    const despBtn = document.getElementById('facturaDespachar');
    if (despBtn) despBtn.addEventListener('click', () => {
      if (currentFac && window.crearDespacho) { close(); window.crearDespacho(currentFac); }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.dataset.open === 'true') close(); });
    const pr = document.getElementById('facturaPrint');
    if (pr) pr.addEventListener('click', () => {
      const isTicket = !!doc.querySelector('.fac-ticket');
      const isElec = !!doc.querySelector('.fac-e');
      const facEl = doc.querySelector('.fac-ticket, .fac') || doc;
      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = '';
      const clon = facEl.cloneNode(true);
      clon.classList.add(isTicket ? 'ticket-print' : 'fac-print');
      if (isElec) clon.classList.add('fac-e-print');
      portal.appendChild(clon);
      // Tamaño de papel según el formato: ticket (rollo 72mm), electrónica (carta) o
      // forma libre (media carta). Chrome ignora un @page nuevo cuando ya existe otro
      // @page en conflicto, así que se cambia el size de TODAS las reglas @page vía CSSOM.
      let size = '5.5in 8.5in', margin = '9mm';
      if (isTicket) { size = '72mm 200mm'; margin = '4mm'; }
      else if (isElec) { size = '8.5in 11in'; margin = '12mm'; }
      setFacturaPageSize(size, margin);
      document.body.classList.add('printing-comp');
      window.print();
    });
    // Cambia/restaura el size de todas las reglas @page (CSSOM) para la impresión de factura/ticket
    function setFacturaPageSize(sizeVal, marginVal) {
      const sheets = document.styleSheets;
      for (let i = 0; i < sheets.length; i++) {
        let rules;
        try { rules = sheets[i].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (let j = 0; j < rules.length; j++) {
          const r = rules[j];
          if (r.type === CSSRule.MEDIA_RULE && /print/.test(r.media && r.media.mediaText || '')) {
            for (let k = 0; k < r.cssRules.length; k++) {
              const pr = r.cssRules[k];
              if (pr.type === CSSRule.PAGE_RULE) {
                if (sizeVal) {
                  if (pr.__origSize === undefined) { pr.__origSize = pr.style.size || ''; pr.__origMargin = pr.style.margin || ''; }
                  pr.style.size = sizeVal;
                  pr.style.margin = marginVal;
                } else if (pr.__origSize !== undefined) {
                  pr.style.size = pr.__origSize;
                  pr.style.margin = pr.__origMargin || '';
                  pr.__origSize = undefined;
                }
              }
            }
          }
        }
      }
    }
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-comp');
      const portal = document.getElementById('printPortal');
      if (portal) portal.innerHTML = '';
      setFacturaPageSize(false);
    });
    const dl = document.getElementById('facturaDownload');
    if (dl) dl.addEventListener('click', () => {
      const blob = new Blob([lastText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = lastName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    // Agregar botón "Ver" a las filas de las tablas de Ventas y Compras del Módulo Fiscal
    // (se excluye el Libro legal, que muestra el N° de comprobante en su última columna)
    ['ventas', 'compras'].forEach((tab) => {
      const pane = document.querySelector('.fiscal-tab[data-tab="' + tab + '"]');
      const table = pane && pane.querySelector('table.data-table:not(.libro-table)');
      if (!table) return;
      const headRow = table.querySelector('thead tr');
      if (headRow) headRow.appendChild(document.createElement('th'));
      table.querySelectorAll('tbody tr').forEach((tr) => {
        // localizar el número de factura en la fila
        let num = null;
        tr.querySelectorAll('td.mono').forEach((td) => {
          const txt = td.textContent.trim();
          if (/^[AF]-\d+/.test(txt) && DB[txt]) num = txt;
        });
        const td = document.createElement('td');
        if (num) {
          td.innerHTML = '<button class="btn btn-ghost" style="height:26px;font-size:11px;padding:0 9px;"><i data-lucide="eye"></i> Ver</button>';
          td.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); openFactura(num); });
        }
        tr.appendChild(td);
      });
    });
    // Conectar los botones "Ver" del módulo de Ventas (data-ver-factura)
    document.querySelectorAll('[data-ver-factura]').forEach((b) => {
      b.addEventListener('click', () => openFactura(b.dataset.verFactura));
    });
    // ---- Emisión de factura de venta (formulario) ----
    (function nuevaFacturaForm() {
      const overlay = document.getElementById('facturaNuevaModal');
      if (!overlay) return;
      const linesEl = document.getElementById('fvLines');
      const selCli = document.getElementById('fvCliente');
      const rifEl = document.getElementById('fvRif');
      const idEl = document.getElementById('fvIdSis');
      const igtfChk = document.getElementById('fvIgtf');
      const msgEl = document.getElementById('fvMsg');
      const idSis = (rif) => String(rif || '').replace(/^[A-Za-z]/, '');
      let clientes = [];
      function fillCliente(c) { rifEl.value = c ? c.rif : ''; idEl.value = c ? (c.id || idSis(c.rif)) : ''; }

      function addLine() {
        const prods = (window.__getProductos ? window.__getProductos() : []);
        const opts = '<option value="">Elegir producto…</option>' + prods.map((p) =>
          '<option value="' + p.id + '" data-precio="' + (Number(p.precio) || 0) + '" data-stock="' + (Number(p.stock) || 0) + '" data-nombre="' + String(p.nombre || '').replace(/"/g, '&quot;') + '">' + (p.nombre || '') + ' (stock ' + (Number(p.stock) || 0) + ')</option>').join('');
        const row = document.createElement('div');
        row.className = 'fv-line';
        row.innerHTML = '<select class="fv-desc">' + opts + '</select>'
          + '<input type="number" class="fv-cant" placeholder="0" step="any">'
          + '<input type="number" class="fv-precio" placeholder="0.00" step="0.01">'
          + '<span class="fv-monto">Bs 0,00</span>'
          + '<button class="fv-del" title="Eliminar"><i data-lucide="trash-2"></i></button>';
        const sel = row.querySelector('.fv-desc');
        sel.addEventListener('change', () => {
          const o = sel.options[sel.selectedIndex];
          row.dataset.pid = sel.value || '';
          row.dataset.pname = o ? (o.getAttribute('data-nombre') || '') : '';
          row.dataset.stock = o ? (o.getAttribute('data-stock') || '') : '';
          const precio = o ? parseFloat(o.getAttribute('data-precio')) : 0;
          row.querySelector('.fv-precio').value = precio ? precio : '';   // precio normal autocompletado (editable por recibo)
          recalc();
        });
        row.querySelector('.fv-del').addEventListener('click', () => { row.remove(); recalc(); });
        row.querySelectorAll('input').forEach((i) => i.addEventListener('input', recalc));
        linesEl.appendChild(row);
        drawIcons();
      }
      function recalc() {
        const rec = window.__esRecibo ? window.__esRecibo() : true;
        const alic = rec ? 0 : (parseFloat(document.getElementById('fvAlic').value) || 0);
        let base = 0;
        linesEl.querySelectorAll('.fv-line').forEach((r) => {
          const c = parseFloat(r.querySelector('.fv-cant').value) || 0;
          const p = parseFloat(r.querySelector('.fv-precio').value) || 0;
          const m = c * p;
          r.querySelector('.fv-monto').textContent = 'Bs ' + fmt(m);
          base += m;
        });
        const iva = base * alic, igtf = igtfChk.checked ? base * 0.03 : 0;
        document.getElementById('fvBase').textContent = 'Bs ' + fmt(base);
        document.getElementById('fvIva').textContent = 'Bs ' + fmt(iva);
        document.getElementById('fvIgtfRow').hidden = !igtfChk.checked;
        document.getElementById('fvIgtfVal').textContent = 'Bs ' + fmt(igtf);
        document.getElementById('fvTotal').textContent = 'Bs ' + fmt(base + iva + igtf);
      }
      function open() {
        clientes = (window.__clientes ? window.__clientes() : []);
        if (!clientes.length) clientes = [{ n: '(Aún no hay clientes con recibos)', rif: '—', dom: '' }];
        selCli.innerHTML = clientes.map((c, i) => '<option value="' + i + '">' + c.n + '</option>').join('');
        fillCliente(clientes[0]);
        linesEl.innerHTML = ''; addLine();
        igtfChk.checked = false; msgEl.textContent = '';
        recalc(); overlay.hidden = false; drawIcons();
      }
      function close() { overlay.hidden = true; }
      selCli.addEventListener('change', () => fillCliente(clientes[parseInt(selCli.value, 10)]));
      // Registrar cliente nuevo → lleva a la ficha de Terceros (premarcado como cliente)
      const nuevoCliBtn = document.getElementById('fvNuevoCliente');
      if (nuevoCliBtn) nuevoCliBtn.addEventListener('click', () => {
        close();
        if (window.showView) window.showView('terceros', 'Terceros · Clientes y Proveedores');
        if (window.openNuevoTercero) window.openNuevoTercero({ cliente: true });
      });
      document.getElementById('fvAlic').addEventListener('change', recalc);
      igtfChk.addEventListener('change', recalc);
      document.getElementById('fvAddLine').addEventListener('click', addLine);
      document.getElementById('fvClose').addEventListener('click', close);
      document.getElementById('fvCancel').addEventListener('click', close);
      // Clic fuera NO cierra (evita perder datos del formulario). Usa Cancelar o la X.

      document.getElementById('fvEmitir').addEventListener('click', async () => {
        const setMsg = (m) => { msgEl.textContent = m; msgEl.classList.add('error'); };
        msgEl.classList.remove('error'); msgEl.textContent = '';
        const cli = clientes[parseInt(selCli.value, 10)];
        if (!cli) return setMsg('Selecciona un cliente.');
        const items = [];
        let stockError = '';
        linesEl.querySelectorAll('.fv-line').forEach((r) => {
          const pid = r.dataset.pid || '';
          const d = (r.dataset.pname || '').trim();
          const c = parseFloat(r.querySelector('.fv-cant').value) || 0;
          const p = parseFloat(r.querySelector('.fv-precio').value) || 0;
          if (d && c > 0 && p > 0) {
            if (pid && r.dataset.stock !== '' && r.dataset.stock != null && c > parseFloat(r.dataset.stock)) {
              stockError = 'No hay stock suficiente de "' + d + '" (disponible: ' + parseFloat(r.dataset.stock) + ').';
            }
            items.push({ d: d, c: c, p: p, pid: pid });
          }
        });
        if (!items.length) return setMsg('Agrega al menos un renglón: elige un producto, una cantidad y un precio.');
        if (stockError) return setMsg(stockError);
        const esRec = window.__esRecibo ? window.__esRecibo() : true;
        // Correlativo REAL: se consulta a la BASE DE DATOS y es POR EMPRESA.
        // (Nunca más desde la memoria: evita heredar números de otra sesión/cuenta.)
        let numsBD = [];
        if (window.sb && window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) {
          const { data: fs } = await window.sb.from('facturas').select('numero, control')
            .eq('tipo', 'venta').eq('empresa_id', window.__EMPRESA_ACTIVA.id);
          numsBD = fs || [];
        }
        let num, ctrl;
        if (esRec) {
          const recs = numsBD.map((f) => /^REC-/.test(f.numero || '') ? parseInt(f.numero.slice(4), 10) : NaN).filter((n) => !isNaN(n));
          num = 'REC-' + String((recs.length ? Math.max(...recs) : 0) + 1).padStart(6, '0');
          ctrl = '';
        } else {
          const nums = numsBD.map((f) => /^A-/.test(f.numero || '') ? parseInt(f.numero.slice(2), 10) : NaN).filter((n) => !isNaN(n));
          num = 'A-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(8, '0');
          const ctrls = numsBD.map((f) => parseInt((f.control || '').replace(/\D/g, ''), 10)).filter((n) => !isNaN(n));
          ctrl = '00-' + String((ctrls.length ? Math.max(...ctrls) : 0) + 1).padStart(6, '0');
        }
        const fechaRaw = document.getElementById('fvFecha').value;
        const fecha = fechaRaw ? fechaRaw.split('-').reverse().join('/') : (function () { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })();
        const alic = esRec ? 0 : (parseFloat(document.getElementById('fvAlic').value) || 0);
        DB[num] = { tipo: 'venta', control: ctrl, fecha: fecha, parte: { n: cli.n, rif: cli.rif, dom: cli.dom || '' }, alic: alic, igtf: igtfChk.checked, cond: document.getElementById('fvCond').value, items: items };
        const t = calcFactura(DB[num]);
        // Guardar la factura REAL en Supabase
        if (window.sb && window.__CUENTA_ID) {
          window.sb.from('facturas').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.id) || null, numero: num, control: ctrl, tipo: 'venta', fecha: fecha,
            cliente_nombre: cli.n, cliente_rif: cli.rif, cliente_dom: cli.dom || '',
            alicuota: alic, igtf: igtfChk.checked, condicion: document.getElementById('fvCond').value,
            items: items, subtotal: t.subtotal, iva: t.iva, igtf_monto: t.igtf, total: t.total, estado: 'Por cobrar',
          }).then(({ error }) => {
            if (error) { console.warn('[DigiAccount] No se pudo guardar la factura:', error.message); if (window.toast) window.toast('No se pudo guardar en la base: ' + error.message, 'error'); return; }
            // Asiento contable de la venta: Debe CxC / Haber Ingresos (+ IVA débito / IGTF por pagar).
            // Solo en modo "recibos" (empresa). En modo "libro" (contador) la venta la contabiliza el Libro de Ventas.
            const _modo = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.modo) || 'recibos';
            if (window.__postAsiento && _modo !== 'libro') {
              const ln = [{ cta: '1.1.2.01 · Cuentas por cobrar comerciales', debe: t.total, haber: 0 },
                { cta: '4.1.1.01 · Venta de mercancía', debe: 0, haber: t.subtotal }];
              if (t.iva > 0.005) ln.push({ cta: '2.1.3.01 · IVA débito fiscal', debe: 0, haber: t.iva });
              if (t.igtf > 0.005) ln.push({ cta: '2.1.4.03 · IGTF por pagar', debe: 0, haber: t.igtf });
              window.__postAsiento('Venta s/' + (esRec ? 'recibo ' : 'factura ') + num + ' · ' + cli.n, num, ln, 'auto').then((r) => { if (r && r.error) console.warn('[DigiAccount] No se pudo contabilizar la venta:', r.error.message); });
            }
            if (window.cargarTesoreria) window.cargarTesoreria(); // refresca CxC con el nuevo recibo
            if (window.cargarFacturas) window.cargarFacturas();   // refresca la lista y los KPIs de Ventas
            if (window.cargarDashboard) window.cargarDashboard(); // refresca los KPIs del Dashboard
          });
          // Descontar el stock del inventario por cada producto vendido
          const ups = items.filter((it) => it.pid).map((it) => {
            const prod = (window.__getProductos ? window.__getProductos() : []).find((x) => x.id === it.pid);
            const nuevo = (Number(prod ? prod.stock : 0) || 0) - it.c;
            return window.sb.from('productos').update({ stock: nuevo }).eq('id', it.pid);
          });
          if (ups.length) Promise.all(ups).then(() => { if (window.cargarProductos) window.cargarProductos(); });
        }
        const tb = document.querySelector('.ventas-tab[data-tab="facturas"] table.data-table tbody');
        if (tb) {
          const fc = fecha.slice(0, 6) + fecha.slice(8); // dd/mm/yy
          const tr = document.createElement('tr');
          tr.innerHTML = '<td>' + fc + '</td><td class="mono">' + num + '</td><td class="mono">' + ctrl + '</td>'
            + '<td class="primary">' + cli.n + '</td><td class="mono">' + cli.rif + '</td>'
            + '<td class="num">' + fmt(t.total) + '</td><td><span class="tag cyan">Por cobrar</span></td>'
            + '<td><button class="btn btn-ghost" data-ver-factura="' + num + '" style="height:26px;font-size:11px;padding:0 9px;white-space:nowrap;"><i data-lucide="eye"></i> Ver</button></td>';
          tb.insertBefore(tr, tb.firstChild);
          tr.querySelector('[data-ver-factura]').addEventListener('click', () => openFactura(num));
          drawIcons();
        }
        if (window.toast) window.toast((esRec ? 'Recibo ' : 'Factura ') + num + (esRec ? ' emitido · Bs ' : ' emitida · Bs ') + fmt(t.total), 'success');
        close();
        openFactura(num);
        // Venta de CONTADO: abre el cobro prefilleado para registrar a qué cuenta/Caja entró el dinero
        if (/contado/i.test(DB[num].cond || '') && window.__registrarCobro) {
          setTimeout(() => window.__registrarCobro({ tipo: 'ingreso', tercero: cli.n, factura: num, monto: t.total }), 150);
        }
      });

      window.openNuevaFactura = open;
    })();

    window.openFactura = openFactura; // reutilizable
    window.__setPageSize = setFacturaPageSize; // reutilizable por el visor de despacho
    // Acceso a las facturas de venta para el módulo de Despachos
    window.__getFactura = function (num) {
      const f = DB[num]; if (!f) return null;
      const em = f.tipo === 'venta' ? EMPRESA : f.parte;
      const re = f.tipo === 'venta' ? f.parte : EMPRESA;
      return { num: num, f: f, emisor: em, receptor: re };
    };
    window.__listaFacturasVenta = Object.keys(DB).filter((k) => DB[k].tipo === 'venta').map((k) => ({ num: k, cliente: DB[k].parte.n }));

    // Carga las facturas de venta reales desde Supabase y las pinta en la tabla de Ventas
    async function cargarFacturas() {
      if (!window.sb) return;
      const { data, error } = await window.sb.from('facturas').select('*').eq('tipo', 'venta').order('creado_en', { ascending: false });
      if (error) { console.warn('[DigiAccount] No se pudieron cargar facturas:', error.message); return; }
      // Limpiar la memoria antes de rellenar: sin residuos de otra cuenta/sesión
      Object.keys(DB).forEach((k) => delete DB[k]);
      const tb = document.querySelector('.ventas-tab[data-tab="facturas"] table.data-table tbody');
      if (tb) tb.innerHTML = '';
      (data || []).forEach((f) => {
        DB[f.numero] = { tipo: 'venta', control: f.control, fecha: f.fecha, parte: { n: f.cliente_nombre, rif: f.cliente_rif, dom: f.cliente_dom || '' }, alic: Number(f.alicuota) || 0, igtf: !!f.igtf, cond: f.condicion, items: Array.isArray(f.items) ? f.items : [], _id: f.id, estado: f.estado || 'Por cobrar' };
        if (tb) {
          const fc = (f.fecha || '').slice(0, 6) + (f.fecha || '').slice(8);
          const tr = document.createElement('tr');
          tr.innerHTML = '<td>' + fc + '</td><td class="mono">' + f.numero + '</td><td class="mono">' + (f.control || '') + '</td>'
            + '<td class="primary">' + (f.cliente_nombre || '') + '</td><td class="mono">' + (f.cliente_rif || '') + '</td>'
            + '<td class="num">' + fmt(Number(f.total) || 0) + '</td><td><span class="tag ' + (/anulada/i.test(f.estado || '') ? 'danger' : /cobrada|pagada/i.test(f.estado || '') ? 'success' : /abonada/i.test(f.estado || '') ? 'warn' : 'cyan') + '">' + (f.estado || 'Por cobrar') + '</span></td>'
            + '<td><button class="btn btn-ghost" data-ver-factura="' + f.numero + '" style="height:26px;font-size:11px;padding:0 9px;white-space:nowrap;"><i data-lucide="eye"></i> Ver</button></td>';
          tb.appendChild(tr);
          tr.querySelector('[data-ver-factura]').addEventListener('click', () => openFactura(f.numero));
        }
      });
      // Los recibos ANULADOS no cuentan en los KPIs
      const arr = (data || []).filter((f) => !/anulada/i.test(f.estado || ''));
      const tot = arr.reduce((s, f) => s + (Number(f.total) || 0), 0);
      const setK = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setK('ventKpiFacturado', fmt(tot));
      setK('ventKpiCount', String(arr.length));
      setK('ventTabCount', String(arr.length));
      setK('ventKpiTicket', fmt(arr.length ? tot / arr.length : 0));
      setK('ventTotalToolbar', 'Bs ' + fmt(tot));
      // Cobrado y Por cobrar REALES: suma de los cobros (movimientos) vinculados a cada recibo
      try {
        let cobrado = 0;
        const refs = arr.map((f) => f.numero).filter(Boolean);
        if (refs.length) {
          const { data: movs } = await window.sb.from('movimientos_tesoreria')
            .select('monto, factura_ref').eq('tipo', 'ingreso').in('factura_ref', refs);
          const porRef = {};
          (movs || []).forEach((m) => { porRef[m.factura_ref] = (porRef[m.factura_ref] || 0) + (Number(m.monto) || 0); });
          arr.forEach((f) => { cobrado += Math.min(porRef[f.numero] || 0, Number(f.total) || 0); });
        }
        setK('ventKpiCobrado', fmt(cobrado));
        setK('ventKpiCobrar', fmt(Math.max(0, tot - cobrado)));
      } catch (e) { console.warn('[Ventas] KPIs de cobro:', e); }
      console.log('[DigiAccount] Facturas cargadas:', arr.length);
      drawIcons();
    }
    window.cargarFacturas = cargarFacturas;

    // Aplica el modo de documento. En 'recibo' (por defecto) cambia los textos visibles
    // a "Recibo" y oculta lo fiscal. En 'factura' (al homologar) deja los textos originales.
    function aplicarModoDoc() {
      const esRec = window.__esRecibo ? window.__esRecibo() : true;
      // Letrero del modo REAL: recibos (sin homologar) o facturación homologada
      const modoBadge = document.getElementById('ventasModoBadge');
      if (modoBadge) modoBadge.innerHTML = esRec
        ? '<i data-lucide="receipt"></i> Recibos de venta'
        : '<i data-lucide="shield-check"></i> Facturación homologada';
      // RIF de la empresa activa (nada de RIF quemado)
      const ventasRif = document.getElementById('ventasRif');
      if (ventasRif) ventasRif.textContent = (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.rif) || '—';
      if (!esRec) return; // modo factura = textos fiscales originales
      const nb = document.getElementById('nuevaFacturaBtn'); if (nb) nb.innerHTML = '<i data-lucide="plus"></i> Nuevo recibo';
      const mb = document.getElementById('medioEmisionBtn'); if (mb) mb.style.display = 'none';
      document.querySelectorAll('#view-ventas .overline').forEach((ov) => { if (/Facturaci/i.test(ov.textContent)) ov.textContent = 'Recibos de venta'; });
      const ft = document.querySelector('.fv-title'); if (ft) ft.textContent = 'Emitir recibo de venta';
      const fs = document.querySelector('.fv-subtitle'); if (fs) fs.textContent = 'Genera el N° de recibo automáticamente';
      const fe = document.getElementById('fvEmitir'); if (fe) fe.innerHTML = '<i data-lucide="check"></i> Emitir recibo';
      const tabla = document.querySelector('.ventas-tab[data-tab="facturas"] table.data-table');
      if (tabla) tabla.querySelectorAll('thead th').forEach((th) => { const t = th.textContent.trim(); if (t === 'N° Factura') th.textContent = 'N° Recibo'; else if (t === 'N° Control') th.textContent = ''; });
      // Un recibo no desglosa impuestos: ocultar Alícuota IVA, IGTF y las filas de Base/IVA
      const al = document.getElementById('fvAlic'); if (al && al.closest('.fv-f')) al.closest('.fv-f').style.display = 'none';
      const baseEl = document.getElementById('fvBase'); if (baseEl && baseEl.closest('.fv-tot-row')) baseEl.closest('.fv-tot-row').style.display = 'none';
      const ivaEl = document.getElementById('fvIva'); if (ivaEl && ivaEl.closest('.fv-tot-row')) ivaEl.closest('.fv-tot-row').style.display = 'none';
      if (window.lucide) window.lucide.createIcons();
    }
    aplicarModoDoc();
    window.__aplicarModoDoc = aplicarModoDoc;
    cargarFacturas();
    drawIcons();
  })();

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
    function celda(td) { return td.textContent.replace(/\s+/g, ' ').trim(); }

    function exportLibro(scope) {
      const tab = scope.closest('.fiscal-tab') || scope;
      const tipo = (tab.dataset.tab === 'compras') ? 'compra' : 'venta';
      const esCompra = tipo === 'compra';
      const titulo = (tab.querySelector('.lh-title') || {}).textContent ? tab.querySelector('.lh-title').textContent.trim() : 'Libro';
      const co = (tab.querySelector('.lh-co') || {}).textContent || '';
      const data = (tab.querySelector('.lh-data') || {}).textContent || '';
      const arr = (window.__libroData && window.__libroData[tipo]) || [];   // TODAS las filas del período
      const rows = [[titulo], [co.trim()], [data.replace(/\s+/g, ' ').trim()], []];
      rows.push(['N°', 'Fecha', 'RIF', esCompra ? 'Proveedor' : 'Cliente', 'Factura', 'Control', 'Doc', 'Total', 'Exento', 'Base', 'Alíc.', 'IVA'].concat(esCompra ? [] : ['IGTF']));
      let tTot = 0, tEx = 0, tBase = 0, tIva = 0, tIgtf = 0;
      arr.forEach((r, i) => {
        const tot = Number(r.total) || 0, ex = Number(r.exento) || 0, base = Number(r.base) || 0, iva = Number(r.iva) || 0, igtf = Number(r.igtf) || 0, alic = Number(r.alicuota) || 0;
        tTot += tot; tEx += ex; tBase += base; tIva += iva; tIgtf += igtf;
        const fila = [i + 1, r.fecha || '', r.tercero_rif || '', r.tercero_nombre || '', r.numero_factura || '', r.numero_control || '', r.tipo_doc || (esCompra ? 'FC' : 'FV'), fmtF(tot), fmtF(ex), fmtF(base), (alic > 0 ? Math.round(alic * 100) + '%' : 'Ex.'), fmtF(iva)];
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
      // Tabla LIMPIA con TODAS las filas del período (sin paginación ni botones), compacta
      const arr = (window.__libroData && window.__libroData[tipo]) || [];
      let tTot = 0, tEx = 0, tBase = 0, tIva = 0, tIgtf = 0;
      const filas = arr.map((r, i) => {
        const tot = Number(r.total) || 0, ex = Number(r.exento) || 0, base = Number(r.base) || 0, iva = Number(r.iva) || 0, igtf = Number(r.igtf) || 0, alic = Number(r.alicuota) || 0;
        tTot += tot; tEx += ex; tBase += base; tIva += iva; tIgtf += igtf;
        const alicTxt = alic > 0 ? (Math.round(alic * 100) + '%') : 'Ex.';
        return '<tr><td>' + (i + 1) + '</td><td>' + (r.fecha || '') + '</td><td>' + (r.tercero_rif || '') + '</td><td>' + (r.tercero_nombre || '') + '</td>'
          + '<td>' + (r.numero_factura || '') + '</td><td>' + (r.numero_control || '') + '</td><td>' + (r.tipo_doc || (esCompra ? 'FC' : 'FV')) + '</td>'
          + '<td class="num">' + fmtF(tot) + '</td><td class="num">' + fmtF(ex) + '</td><td class="num">' + fmtF(base) + '</td><td>' + alicTxt + '</td><td class="num">' + fmtF(iva) + '</td>'
          + (esCompra ? '' : '<td class="num">' + fmtF(igtf) + '</td>') + '</tr>';
      }).join('');
      const th = '<tr><th>N°</th><th>Fecha</th><th>RIF</th><th>' + (esCompra ? 'Proveedor' : 'Cliente') + '</th><th>Factura</th><th>Control</th><th>Doc</th><th>Total</th><th>Exento</th><th>Base</th><th>Alíc.</th><th>IVA</th>' + (esCompra ? '' : '<th>IGTF</th>') + '</tr>';
      const foot = '<tr class="libro-tot"><td colspan="7" style="text-align:right;">TOTALES DEL PERÍODO (' + arr.length + ' operaciones)</td><td class="num">' + fmtF(tTot) + '</td><td class="num">' + fmtF(tEx) + '</td><td class="num">' + fmtF(tBase) + '</td><td></td><td class="num">' + fmtF(tIva) + '</td>' + (esCompra ? '' : '<td class="num">' + fmtF(tIgtf) + '</td>') + '</tr>';
      cont.insertAdjacentHTML('beforeend', '<table class="libro-table libro-print-table" style="width:100%;border-collapse:collapse;font-size:9px;"><thead>' + th + '</thead><tbody>' + (filas || '<tr><td colspan="13">Sin operaciones en el período.</td></tr>') + '</tbody><tfoot>' + foot + '</tfoot></table>');
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

    function close() { overlay.hidden = true; bodyEl.innerHTML = ''; msgEl.textContent = ''; onSaveCb = null; }

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
      const res = onSaveCb(collect());
      if (typeof res === 'string') { msgEl.textContent = res; msgEl.classList.add('error'); return; }
      close();
    });
    cancelBtn.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    // Clic fuera NO cierra (evita perder datos del formulario). Usa Cancelar o la X.
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
      if (!box) return;
      const emp = window.__EMPRESA_ACTIVA || {};
      const cond = emp.cond || 'Contribuyente Ordinario';
      if (/especial/i.test(cond)) {
        const ini = (emp.rif || '').toUpperCase().replace(/[^A-Z]/g, '').charAt(0);
        const esNatural = ini === 'V' || ini === 'E';
        const periodo = esNatural ? 'mensual' : 'quincenal';
        const tipoTxt = esNatural ? 'firma personal (persona natural)' : 'persona jurídica (C.A.)';
        box.innerHTML = '<div class="op-head"><span class="op-tag teal">Anticipo ISLR</span> Sobre ingresos brutos</div>'
          + '<div class="op-row"><span>Ingresos brutos del período</span><span class="mono">' + fmtF(brutos) + '</span></div>'
          + '<div class="op-row"><span>Porcentaje aplicable</span><span class="mono">1%</span></div>'
          + '<div class="op-row"><span>Periodicidad</span><span class="mono">' + periodo + '</span></div>'
          + '<div class="op-row total"><span>Anticipo a enterar</span><span class="mono">' + fmtF(brutos * 0.01) + '</span></div>'
          + '<div class="op-foot">Decreto Constituyente 3.719 · se genera automáticamente con la declaración de IVA (' + periodo + ', por ser ' + tipoTxt + ').</div>';
      } else {
        box.innerHTML = '<div class="op-head"><span class="op-tag teal">Estimada ISLR</span> Declaración estimada (anual)</div>'
          + '<div class="op-row"><span>Base de cálculo</span><span class="mono">Renta neta estimada</span></div>'
          + '<div class="op-row"><span>Modalidad de pago</span><span class="mono">En porciones</span></div>'
          + '<div class="op-row total"><span>Sobre ventas del mes</span><span class="mono">No aplica</span></div>'
          + '<div class="op-foot">LISLR Art. 82 · obligatoria si la renta neta del año anterior supera 1.500 U.T. · se estima sobre la renta neta (≥80% del año anterior) y se paga en porciones, no sobre las ventas brutas.</div>';
      }
    }
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
      const perActual = '20' + _fiscalPer.aa + '-' + _fiscalPer.mm;
      const clave = emp.id + '|' + perActual;
      if (_arrClave === clave) return; // ya calculado para este empresa+período
      const r2 = (x) => Math.round((x + 1e-9) * 100) / 100;
      const perDe = (row) => row.periodo || (String(row.fecha || '').split('/').length === 3 ? ('20' + row.fecha.split('/')[2] + '-' + String(row.fecha.split('/')[1]).padStart(2, '0')) : '');
      const [libRes, retRes] = await Promise.all([
        window.__sbAll((q) => q.eq('empresa_id', emp.id), 'libro_fiscal', 'tipo,periodo,fecha,base,exento,alicuota'),
        window.__sbAll((q) => q.eq('empresa_id', emp.id).eq('direccion', 'sufrida').eq('tipo', 'iva'), 'retenciones', 'periodo,fecha,monto'),
      ]);
      const M = {}; // período → {vb16,vb8,cb16,cb8,ret}
      const g = (k) => { if (!M[k]) M[k] = { vb16: 0, vb8: 0, cb16: 0, cb8: 0, ret: 0 }; return M[k]; };
      (libRes.data || []).forEach((row) => {
        const k = perDe(row); if (!k || k >= perActual) return; // solo períodos ANTERIORES
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
      const perTxt = (typeof _perLabel === 'function') ? _perLabel() : '';
      document.querySelectorAll('.fiscal-tab[data-tab="compras"] .libro-head, .fiscal-tab[data-tab="ventas"] .libro-head').forEach((h) => {
        const coEl = h.querySelector('.lh-co'); if (coEl) coEl.textContent = emp.n || '—';
        const dataEl = h.querySelector('.lh-data');
        if (dataEl) dataEl.innerHTML = '<span class="mono">RIF ' + (emp.rif || '—') + '</span> · ' + cond + ' · Período de imposición: <strong>' + perTxt + '</strong>';
      });
    };
    // Período de declaración: clave 'aaaa-mm' y etiqueta 'Mes aaaa'
    const _MESES_PER = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    function _periodoActualKey() {
      const p = window.__fiscalPer;
      if (p && p.mm && p.aa) return '20' + p.aa + '-' + p.mm;
      const h = new Date();
      return h.getFullYear() + '-' + String(h.getMonth() + 1).padStart(2, '0');
    }
    function _opcionesPeriodo() {
      // Del período actual hacia atrás 24 meses (para declarar facturas rezagadas)
      const out = [];
      const base = _periodoActualKey();
      let y = parseInt(base.slice(0, 4), 10), m = parseInt(base.slice(5, 7), 10);
      for (let i = 0; i < 24; i++) {
        const key = y + '-' + String(m).padStart(2, '0');
        out.push({ value: key, label: _MESES_PER[m - 1] + ' ' + y });
        m--; if (m < 1) { m = 12; y--; }
      }
      return out;
    }
    function registrarMov(tipo) {
      const esCompra = tipo === 'compra';
      let invBox = null; // contenedor de líneas para reponer inventario (solo compras)
      const prodsCompra = esCompra && window.__getProductos ? window.__getProductos() : [];
      // Terceros del rol correspondiente (proveedores para compras, clientes para ventas) → autocompletado
      const terceros = (window.__getTerceros ? window.__getTerceros() : []).filter((t) => (esCompra ? t.prov : t.cli) && t.nombre);
      const normRif = (s) => (s || '').toUpperCase().replace(/[\s.\-]/g, '');
      window.openFormModal && window.openFormModal({
        title: esCompra ? 'Registrar compra (Libro de Compras)' : 'Registrar venta (Libro de Ventas)',
        saveLabel: 'Registrar en el libro',
        fields: (esCompra && (window.__ES_FUNDADOR || window.__ADDON_AGENTES) && window.__ocrFactura ? [
          { name: 'facturaFile', label: '🤖 Factura del proveedor (PDF o foto) — el Agente IA la lee y llena el formulario', col: 2, type: 'file' },
        ] : []).concat([
          { name: 'fecha', label: 'Fecha de la factura', type: 'date', value: window.__hoyISO() },
        ]).concat(esCompra ? [
          // Solo COMPRAS: el crédito se declara en el período en que llega la factura (puede diferir de su fecha).
          { name: 'periodo', label: 'Período de declaración (si la factura es de un mes anterior, elige el mes en que la declaras)', type: 'select', options: _opcionesPeriodo(), value: _periodoActualKey() },
        ] : []).concat([
          { name: 'tipoDoc', label: 'Tipo de documento', type: 'select', options: esCompra ? ['FC (Factura)', 'NC (Nota de crédito)', 'ND (Nota de débito)'] : ['FV (Factura de venta)', 'NC (Nota de crédito)', 'ND (Nota de débito)'] },
          { name: 'nombre', label: (esCompra ? 'Proveedor' : 'Cliente') + ' (escribe las iniciales y elige)', col: 2, type: 'datalist', options: terceros.map((t) => t.nombre), placeholder: 'Ej. Sum… → Suministros Lara, C.A.' },
          { name: 'rif', label: 'RIF / C.I. (mayúscula, sin guiones)', upper: true, placeholder: 'J123456789' },
          { name: 'numFactura', label: 'N° de Factura', placeholder: 'F-00000000' },
          { name: 'numControl', label: 'N° de Control', placeholder: '00-00000000' },
          { name: 'base', label: 'Base imponible (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
          { name: 'alic', label: 'Alícuota IVA', type: 'select', options: ['16%', '8%', 'Exento'] },
          { name: 'exento', label: 'Monto exento / sin ' + (esCompra ? 'crédito' : 'débito') + ' (Bs)', type: 'number', step: '0.01', placeholder: '0.00' },
        ].concat(esCompra ? [
          { name: 'cond', label: 'Condición de pago', type: 'select', options: ['Contado', 'Crédito 15 días', 'Crédito 30 días', 'Crédito 60 días'] },
        ] : [
          { name: 'igtfAplica', label: '¿Aplica IGTF? (cobro en divisas/cripto)', type: 'select', options: ['No', 'Sí (3%)'] },
          { name: 'igtfShow', label: 'IGTF 3% (calculado del total con IVA)', type: 'static', html: '<span class="mono" id="igtfShowVal">Bs 0,00</span>' },
        ]).concat([
          { name: 'retPct', label: (esCompra ? 'IVA que le retienes al proveedor' : 'IVA que te retuvo el cliente') + ' (opcional)', type: 'select', options: ['Sin retención', '75%', '100%'] },
          { name: 'retComp', label: 'N° comprobante de retención' + (esCompra ? ' (vacío = se genera)' : ' (el que te dio el cliente)'), placeholder: esCompra ? 'Se genera solo' : 'Ej. 20260600000123' },
        ])),
        afterRender: (body) => {
          const prov = body.querySelector('[data-name="nombre"]');
          const rif = body.querySelector('[data-name="rif"]');
          if (!prov) return;
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
            const bg = Number(d.base_general) || 0, br = Number(d.base_reducida) || 0, ex = Number(d.exento) || 0;
            if (bg > 0) { setV('base', bg.toFixed(2)); setV('alic', '16%'); }
            else if (br > 0) { setV('base', br.toFixed(2)); setV('alic', '8%'); }
            else if (ex > 0) { setV('alic', 'Exento'); }
            if (ex > 0) setV('exento', ex.toFixed(2));
            const avisos = [];
            if (bg > 0 && br > 0) avisos.push('trae TAMBIÉN base reducida 8% (Bs ' + fmtF(br) + ' + IVA ' + fmtF(Number(d.iva_reducida) || 0) + ') — regístrala en una línea aparte');
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
          const autollenar = () => {
            const t = terceros.find((x) => x.nombre.toLowerCase() === prov.value.trim().toLowerCase());
            if (t) {
              if (rif) rif.value = normRif(t.rif);
              // foco al siguiente dato faltante: N° de factura
              const nf = body.querySelector('[data-name="numFactura"]');
              if (nf) nf.focus();
            }
          };
          prov.addEventListener('change', autollenar);
          prov.addEventListener('input', autollenar);
          // IGTF (solo ventas): si aplica, calcula el 3% del TOTAL de la factura (base + IVA + exento) en vivo
          const baseEl = body.querySelector('[data-name="base"]');
          const alicEl = body.querySelector('[data-name="alic"]');
          const exEl = body.querySelector('[data-name="exento"]');
          const igtfSel = body.querySelector('[data-name="igtfAplica"]');
          const igtfShow = document.getElementById('igtfShowVal');
          const calcIgtf = () => {
            if (!igtfSel || !igtfShow) return;
            const b = parseFloat(baseEl && baseEl.value) || 0;
            const al = alicEl && alicEl.value === '8%' ? 0.08 : alicEl && alicEl.value === 'Exento' ? 0 : 0.16;
            const ex = parseFloat(exEl && exEl.value) || 0;
            const total = b + b * al + ex;
            igtfShow.textContent = 'Bs ' + fmtF(/s[ií]/i.test(igtfSel.value) ? total * 0.03 : 0);
          };
          if (baseEl) baseEl.addEventListener('input', calcIgtf);
          if (alicEl) alicEl.addEventListener('change', calcIgtf);
          if (exEl) exEl.addEventListener('input', calcIgtf);
          if (igtfSel) igtfSel.addEventListener('change', calcIgtf);
          calcIgtf();
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
          const periodo = esCompra ? (v.periodo || _periodoActualKey()) : (fP.length === 3 ? fP[0] + '-' + fP[1] : _periodoActualKey());
          if (window.__periodoCerrado && window.__periodoCerrado(periodo)) return '🔒 El período de declaración elegido está CERRADO. Reábrelo con el botón del período en Fiscal si necesitas registrar.';
          if (!v.nombre) return 'Indica el ' + (esCompra ? 'proveedor' : 'cliente') + '.';
          const base = parseFloat(v.base) || 0, exento = parseFloat(v.exento) || 0;
          const alic = v.alic === '8%' ? 0.08 : v.alic === 'Exento' ? 0 : 0.16;
          const iva = base * alic, total = base + iva + exento;
          const igtf = /s[ií]/i.test(v.igtfAplica || '') ? total * 0.03 : 0; // IGTF sobre el total de la factura
          const p = (v.fecha || '').split('-');
          const fecha = p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0].slice(2)) : '';
          window.sb.from('libro_fiscal').insert({
            cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id, tipo: tipo, fecha: fecha, periodo: periodo,
            tercero_nombre: v.nombre, tercero_rif: normRif(v.rif), numero_factura: v.numFactura, numero_control: v.numControl,
            tipo_doc: (v.tipoDoc || (esCompra ? 'FC' : 'FV')).slice(0, 2), exento: exento, base: base, alicuota: alic, iva: iva, igtf: igtf, total: total,
          }).then(({ error }) => {
            if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return; }
            if (window.__invalidarArrastres) window.__invalidarArrastres(); // el nuevo registro puede cambiar los arrastres
            if (window.cargarLibroFiscal) window.cargarLibroFiscal(tipo);
            if (window.cargarTesoreria) window.cargarTesoreria();   // refresca CxP/CxC (panel de Compras/Ventas)
            if (window.cargarDashboard) window.cargarDashboard();   // y los KPIs del Dashboard
            toast((esCompra ? 'Compra' : 'Venta') + ' registrada en el libro · Bs ' + fmtF(total), 'success');
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
            // Reponer inventario: suma las cantidades compradas al stock de cada producto
            if (esCompra && invBox && window.sb) {
              const lineasInv = [];
              invBox.querySelectorAll('#invCompraRows > div').forEach((r) => {
                const nombre = (r.querySelector('.ic-prod').value || '').trim();
                const cant = parseFloat(r.querySelector('.ic-cant').value) || 0;
                const costo = parseFloat(r.querySelector('.ic-costo').value) || 0;
                if (nombre && cant > 0) lineasInv.push({ nombre: nombre, cant: cant, costo: costo });
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
                      nombre: li.nombre, sku: 'SKU-' + String(Date.now()).slice(-5) + '-' + Math.floor(Math.random() * 90 + 10),
                      categoria: 'Otros', alicuota: '16%',
                      stock: li.cant, stock_min: 0, costo: li.costo || 0, precio: 0,
                    });
                  }
                  const patch = { stock: (Number(pr.stock) || 0) + li.cant };
                  if (li.costo > 0) patch.costo = li.costo;
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
            // Compra de CONTADO: abre el pago prefilleado para registrar de qué cuenta/Caja salió el dinero
            if (esCompra && /contado/i.test(v.cond || '') && window.__registrarCobro) {
              setTimeout(() => window.__registrarCobro({ tipo: 'egreso', tercero: v.nombre, factura: v.numFactura, monto: total }), 200);
            }
            // Si se indicó retención de IVA, registra el comprobante de retención asociado a esta factura
            const retPctNum = v.retPct === '100%' ? 100 : v.retPct === '75%' ? 75 : 0;
            if (retPctNum && iva > 0) {
              const retMonto = iva * retPctNum / 100;
              let comp = (v.retComp || '').trim();
              if (!comp && esCompra && p.length === 3) comp = p[0] + p[1] + String(Date.now()).slice(-8);
              window.sb.from('retenciones').insert({
                cuenta_id: window.__CUENTA_ID, empresa_id: window.__EMPRESA_ACTIVA.id,
                direccion: esCompra ? 'practicada' : 'sufrida', tipo: 'iva', fecha: fecha, periodo: periodo, comprobante: comp,
                tercero_nombre: v.nombre, tercero_rif: normRif(v.rif), factura: v.numFactura, numero_control: v.numControl,
                base: iva, pct: retPctNum, monto: retMonto, estado: 'Registrado',
              }).then(({ error: e2 }) => {
                if (e2) { toast('Factura ok, pero la retención no se guardó: ' + e2.message, 'error'); return; }
                if (window.cargarRetenciones) window.cargarRetenciones();
                toast('Retención de IVA ' + (esCompra ? 'practicada' : 'sufrida') + ' registrada · Bs ' + fmtF(retMonto), 'success');
              });
            }
          });
        },
      });
    }
    // Período fiscal REAL del módulo: los libros se filtran por mes (fecha dd/mm/aa termina en /mm/aa).
    // Necesario desde la migración de libros históricos: sin filtro, los totales mezclarían todos los meses.
    const MESES_FIS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const _hoyFis = new Date();
    let _fiscalPer = { mm: String(_hoyFis.getMonth() + 1).padStart(2, '0'), aa: String(_hoyFis.getFullYear()).slice(2) };
    window.__fiscalPer = _fiscalPer; // expuesto para que las retenciones filtren por el mismo período
    const _perLabel = () => MESES_FIS[parseInt(_fiscalPer.mm, 10) - 1] + ' 20' + _fiscalPer.aa;
    const _libroData = { compra: [], venta: [] }; // últimas filas cargadas por tipo (para editar/eliminar)
    const _libroPage = { compra: 1, venta: 1 }; // página actual de cada libro (20 filas por página)
    async function cargarLibroFiscal(tipo, page) {
      const tabName = tipo === 'compra' ? 'compras' : 'ventas';
      const sel = tipo === 'compra' ? 'table.libro-compras' : 'table.libro-ventas:not(.libro-maquina)';
      const table = view.querySelector('.fiscal-tab[data-tab="' + tabName + '"] ' + sel);
      if (!table) return;
      const esCompra = tipo === 'compra';
      const tbody = table.querySelector('tbody'), tfoot = table.querySelector('tfoot');
      const totRow = (tot, ex, base, iva, igtf) => '<tr class="libro-tot"><td colspan="7" style="text-align:right;">TOTALES DEL PERÍODO</td><td class="num">' + fmtF(tot) + '</td><td class="num">' + fmtF(ex) + '</td><td class="num">' + fmtF(base) + '</td><td></td><td class="num">' + fmtF(iva) + '</td>' + (esCompra ? '' : '<td class="num">' + fmtF(igtf) + '</td>') + '</tr>';
      const setN = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmtF(v); };
      const resetF30c = () => { ['f30c-ex', 'f30c-base16', 'f30c-iva16', 'f30c-base8', 'f30c-iva8', 'f30c-baseTot', 'f30c-ivaTot', 'f30c-ded', 'f30c-dedTot', 'f30c-credTot'].forEach((id) => setN(id, 0)); };
      const resetF30v = () => { ['f30v-base16', 'f30v-iva16', 'f30v-base8', 'f30v-iva8', 'f30v-baseTot', 'f30v-ivaTot', 'f30v-debTot', 'f30v-igtf', 'f30v-igtfBase'].forEach((id) => setN(id, 0)); renderIslrBox(0); window.__IGTF_VENTAS = { base: 0, ops: 0, monto: 0 }; if (window.__renderIGTF) window.__renderIGTF(); };
      const vacio = (txt) => {
        if (tbody) tbody.innerHTML = '<tr><td colspan="' + (esCompra ? 12 : 13) + '" style="text-align:center;color:var(--fg-muted);padding:14px;">' + (txt || ('Sin registros. Usa "Registrar ' + tipo + '".')) + '</td></tr>';
        if (tfoot) tfoot.innerHTML = totRow(0, 0, 0, 0, 0);
        if (esCompra) { _credF = 0; resetF30c(); } else { _debF = 0; resetF30v(); }
        _libroData[tipo] = [];
        actualizarAutoliquidacion();
      };
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { vacio(); return; }
      // Se consulta por el PERÍODO DE DECLARACIÓN seleccionado (no por la fecha de la factura):
      // una compra recibida tarde se declara en el período en que llega la factura.
      // Filtrar en la BD evita el tope de 1000 filas de PostgREST.
      const perDecl = '20' + _fiscalPer.aa + '-' + _fiscalPer.mm; // 'aaaa-mm'
      const sufPer = '/' + _fiscalPer.mm + '/' + _fiscalPer.aa;   // respaldo por fecha (filas sin período)
      const { data, error } = await window.__sbAll((q) => q
        .eq('empresa_id', window.__EMPRESA_ACTIVA.id).eq('tipo', tipo)
        .or('periodo.eq.' + perDecl + ',and(periodo.is.null,fecha.like.*' + sufPer + ')')
        .order('fecha'), 'libro_fiscal', '*');
      if (error) { console.warn('[DigiAccount] No se pudo cargar el libro fiscal:', error.message); vacio('No se pudieron cargar (¿creaste la tabla libro_fiscal?).'); return; }
      const arr = data || [];
      _libroData[tipo] = arr;
      window.__libroData = _libroData; // expuesto para la impresión (printLibro está en otro IIFE)
      if (!arr.length) { vacio('Sin registros en ' + _perLabel() + '. Cambia el período arriba o usa "Registrar ' + tipo + '".'); return; }
      // Totales y Forma 30: SIEMPRE sobre el mes completo (la paginación es solo visual)
      let tTot = 0, tEx = 0, tBase = 0, tIva = 0, tIgtf = 0;
      let base16 = 0, iva16 = 0, base8 = 0, iva8 = 0;
      arr.forEach((r) => {
        const tot = Number(r.total) || 0, ex = Number(r.exento) || 0, base = Number(r.base) || 0, iva = Number(r.iva) || 0, igtf = Number(r.igtf) || 0, alic = Number(r.alicuota) || 0;
        tTot += tot; tEx += ex; tBase += base; tIva += iva; tIgtf += igtf;
        if (alic >= 0.15) { base16 += base; iva16 += iva; } else if (alic > 0) { base8 += base; iva8 += iva; }
      });
      // Paginación: lotes de 20 operaciones por página
      const PAG_FILAS = 20;
      const totalPag = Math.max(1, Math.ceil(arr.length / PAG_FILAS));
      const pag = Math.min(Math.max(1, page || 1), totalPag);
      _libroPage[tipo] = pag;
      const inicio = (pag - 1) * PAG_FILAS;
      tbody.innerHTML = arr.slice(inicio, inicio + PAG_FILAS).map((r, i) => {
        const tot = Number(r.total) || 0, ex = Number(r.exento) || 0, base = Number(r.base) || 0, iva = Number(r.iva) || 0, igtf = Number(r.igtf) || 0, alic = Number(r.alicuota) || 0;
        const alicTxt = alic > 0 ? (Math.round(alic * 100) + '%') : 'Ex.';
        return '<tr data-id="' + (r.id || '') + '" data-libro="' + tipo + '" style="cursor:pointer;" title="Clic para editar o eliminar"><td class="ctr">' + (inicio + i + 1) + '</td><td>' + (r.fecha || '') + '</td><td class="mono">' + (r.tercero_rif || '') + '</td><td class="primary">' + (r.tercero_nombre || '') + '</td>'
          + '<td class="mono">' + (r.numero_factura || '') + '</td><td class="mono">' + (r.numero_control || '') + '</td><td class="ctr">' + (r.tipo_doc || (esCompra ? 'FC' : 'FV')) + '</td>'
          + '<td class="num">' + fmtF(tot) + '</td><td class="num">' + fmtF(ex) + '</td><td class="num">' + fmtF(base) + '</td><td class="ctr">' + alicTxt + '</td><td class="num">' + fmtF(iva) + '</td>'
          + (esCompra ? '' : '<td class="num">' + fmtF(igtf) + '</td>') + '</tr>';
      }).join('');
      const pagerRow = totalPag > 1
        ? '<tr><td colspan="' + (esCompra ? 12 : 13) + '" style="padding:6px 10px;"><div style="display:flex;justify-content:center;align-items:center;gap:14px;font-size:12px;color:var(--fg-muted);">'
          + '<button class="btn btn-ghost" data-lp="' + tipo + '" data-lp-dir="-1"' + (pag <= 1 ? ' disabled' : '') + ' style="height:26px;font-size:11px;">« Anterior</button>'
          + '<span>Página ' + pag + ' de ' + totalPag + ' · ' + arr.length + ' operaciones del período</span>'
          + '<button class="btn btn-ghost" data-lp="' + tipo + '" data-lp-dir="1"' + (pag >= totalPag ? ' disabled' : '') + ' style="height:26px;font-size:11px;">Siguiente »</button>'
          + '</div></td></tr>'
        : '';
      if (tfoot) tfoot.innerHTML = totRow(tTot, tEx, tBase, tIva, tIgtf) + pagerRow;
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
        setN('f30c-base8', base8); setN('f30c-iva8', iva8D);
        setN('f30c-baseTot', base16 + base8 + tEx); setN('f30c-ivaTot', ivaTotD);
        setN('f30c-ded', ivaTotD); setN('f30c-dedTot', ivaTotD); setN('f30c-credTot', ivaTotD);
      } else {
        _debF = ivaTotD;
        setN('f30v-base16', base16); setN('f30v-iva16', iva16D);
        setN('f30v-base8', base8); setN('f30v-iva8', iva8D);
        setN('f30v-baseTot', base16 + base8 + tEx); setN('f30v-ivaTot', ivaTotD);
        setN('f30v-debTot', ivaTotD);
        setN('f30v-igtf', tIgtf); setN('f30v-igtfBase', tIgtf > 0 ? tIgtf / 0.03 : 0);
        window.__IGTF_VENTAS = { base: tIgtf > 0 ? tIgtf / 0.03 : 0, ops: arr.filter((r) => Number(r.igtf) > 0).length, monto: tIgtf };
        if (window.__renderIGTF) window.__renderIGTF();
        renderIslrBox(tBase + tEx);
      }
      actualizarAutoliquidacion();
      calcularArrastres(); // trae excedente de crédito y retenciones acumuladas del período anterior
    }
    window.cargarLibroFiscal = cargarLibroFiscal;

    // Editar / eliminar un registro del libro (clic en la fila)
    function editLibroFiscal(id, tipo) {
      const r = (_libroData[tipo] || []).find((x) => String(x.id) === String(id));
      if (!r) return;
      const esCompra = tipo === 'compra';
      const alicNum = Number(r.alicuota) || 0;
      const alicVal = alicNum >= 0.15 ? '16%' : alicNum > 0 ? '8%' : 'Exento';
      const tdMap = { FC: 'FC (Factura)', FV: 'FV (Factura de venta)', NC: 'NC (Nota de crédito)', ND: 'ND (Nota de débito)' };
      window.openFormModal && window.openFormModal({
        title: esCompra ? 'Editar compra (Libro de Compras)' : 'Editar venta (Libro de Ventas)',
        saveLabel: 'Guardar cambios',
        fields: [
          { name: 'fecha', label: 'Fecha (dd/mm/aa)', value: r.fecha || '' },
        ].concat(esCompra ? [
          { name: 'periodo', label: 'Período de declaración', type: 'select', options: _opcionesPeriodo(), value: r.periodo || _periodoActualKey() },
        ] : []).concat([
          { name: 'tipoDoc', label: 'Tipo de documento', type: 'select', options: esCompra ? ['FC (Factura)', 'NC (Nota de crédito)', 'ND (Nota de débito)'] : ['FV (Factura de venta)', 'NC (Nota de crédito)', 'ND (Nota de débito)'], value: tdMap[r.tipo_doc] || (esCompra ? 'FC (Factura)' : 'FV (Factura de venta)') },
          { name: 'nombre', label: esCompra ? 'Proveedor' : 'Cliente', col: 2, value: r.tercero_nombre || '' },
          { name: 'rif', label: 'RIF', upper: true, value: r.tercero_rif || '' },
          { name: 'numFactura', label: 'N° de Factura', value: r.numero_factura || '' },
          { name: 'numControl', label: 'N° de Control', value: r.numero_control || '' },
          { name: 'base', label: 'Base imponible (Bs)', type: 'number', step: '0.01', value: r.base != null ? String(r.base) : '' },
          { name: 'alic', label: 'Alícuota IVA', type: 'select', options: ['16%', '8%', 'Exento'], value: alicVal },
          { name: 'exento', label: 'Monto exento / sin ' + (esCompra ? 'crédito' : 'débito') + ' (Bs)', type: 'number', step: '0.01', value: r.exento != null ? String(r.exento) : '' },
        ].concat(esCompra ? [] : [
          { name: 'igtfAplica', label: '¿Aplica IGTF? (3%)', type: 'select', options: ['No', 'Sí (3%)'], value: (Number(r.igtf) > 0 ? 'Sí (3%)' : 'No') },
          { name: 'igtfShow', label: 'IGTF 3% (calculado del total con IVA)', type: 'static', html: '<span class="mono" id="igtfShowVal">Bs ' + fmtF(Number(r.igtf) || 0) + '</span>' },
        ])),
        afterRender: (body) => {
          const baseEl = body.querySelector('[data-name="base"]');
          const alicEl = body.querySelector('[data-name="alic"]');
          const exEl = body.querySelector('[data-name="exento"]');
          const igtfSel = body.querySelector('[data-name="igtfAplica"]');
          const igtfShow = document.getElementById('igtfShowVal');
          const calcIgtf = () => {
            if (!igtfSel || !igtfShow) return;
            const b = parseFloat(baseEl && baseEl.value) || 0;
            const al = alicEl && alicEl.value === '8%' ? 0.08 : alicEl && alicEl.value === 'Exento' ? 0 : 0.16;
            const ex = parseFloat(exEl && exEl.value) || 0;
            const total = b + b * al + ex;
            igtfShow.textContent = 'Bs ' + fmtF(/s[ií]/i.test(igtfSel.value) ? total * 0.03 : 0);
          };
          if (baseEl) baseEl.addEventListener('input', calcIgtf);
          if (alicEl) alicEl.addEventListener('change', calcIgtf);
          if (exEl) exEl.addEventListener('input', calcIgtf);
          if (igtfSel) igtfSel.addEventListener('change', calcIgtf);
        },
        onSave: (v) => {
          if (!window.sb) return 'Sin conexión.';
          // Ventas: período sigue a la fecha (dd/mm/aa). Compras: el período elegido.
          let perNuevo;
          if (esCompra) perNuevo = v.periodo || r.periodo || _periodoActualKey();
          else { const fp = (v.fecha || '').split('/'); perNuevo = fp.length === 3 ? '20' + fp[2] + '-' + String(fp[1]).padStart(2, '0') : (r.periodo || _periodoActualKey()); }
          if (window.__periodoCerrado && (window.__periodoCerrado(r.periodo) || window.__periodoCerrado(perNuevo))) return '🔒 Este registro pertenece a un período CERRADO (declarado). Reábrelo en Fiscal para modificarlo.';
          if (!v.nombre) return 'Indica el ' + (esCompra ? 'proveedor' : 'cliente') + '.';
          const base = parseFloat(v.base) || 0, exento = parseFloat(v.exento) || 0;
          const alic = v.alic === '8%' ? 0.08 : v.alic === 'Exento' ? 0 : 0.16;
          const iva = base * alic, total = base + iva + exento;
          const igtf = /s[ií]/i.test(v.igtfAplica || '') ? total * 0.03 : 0; // IGTF sobre el total de la factura
          window.sb.from('libro_fiscal').update({
            fecha: v.fecha, periodo: perNuevo, tipo_doc: (v.tipoDoc || '').slice(0, 2), tercero_nombre: v.nombre,
            tercero_rif: (v.rif || '').toUpperCase().replace(/[\s.\-]/g, ''), numero_factura: v.numFactura, numero_control: v.numControl,
            exento: exento, base: base, alicuota: alic, iva: iva, igtf: igtf, total: total,
          }).eq('id', id).then(({ error }) => {
            if (error) { toast('No se pudo actualizar: ' + error.message, 'error'); return; }
            if (window.__invalidarArrastres) window.__invalidarArrastres();
            cargarLibroFiscal(tipo);
            toast((esCompra ? 'Compra' : 'Venta') + ' actualizada · Bs ' + fmtF(total), 'success');
          });
        },
        onDelete: async (closeModal) => {
          if (window.__periodoCerrado && window.__periodoCerrado(r.periodo)) {
            toast('🔒 Este registro pertenece a un período CERRADO (declarado). Reábrelo en Fiscal para eliminarlo.', 'error');
            return;
          }
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
        cargarLibroFiscal(pb.dataset.lp, (_libroPage[pb.dataset.lp] || 1) + parseInt(pb.dataset.lpDir, 10));
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
    const comprasRegBtn = document.getElementById('comprasRegBtn');
    if (comprasRegBtn) comprasRegBtn.addEventListener('click', () => registrarMov('compra'));
    cargarLibroFiscal('compra');
    cargarLibroFiscal('venta');

    // Comprobante de retención: emitir y registrar
    const emitir = document.getElementById('compEmitirBtn');
    if (emitir) emitir.addEventListener('click', () =>
      toast('Comprobante de retención emitido y registrado · incluido en el TXT del período'));

    // Selector de período fiscal del módulo: cambia el mes y recarga los libros filtrados
    const periodo = document.getElementById('fiscalPeriodo');
    if (periodo) {
      const mainBtn = periodo.querySelector('button:not(.custom-date)');
      if (mainBtn) mainBtn.textContent = _perLabel();
      const opciones = [];
      const dOp = new Date();
      for (let i = 0; i < 14; i++) { opciones.push(MESES_FIS[dOp.getMonth()] + ' ' + dOp.getFullYear()); dOp.setMonth(dOp.getMonth() - 1); }
      const abrirSelector = () => {
        window.openFormModal && window.openFormModal({
          title: 'Cambiar período fiscal',
          saveLabel: 'Aplicar',
          fields: [{ name: 'periodo', label: 'Período a consultar', col: 2, type: 'select', options: opciones, value: _perLabel() }],
          onSave: (v) => {
            const p = String(v.periodo || '').split(' ');
            const idx = MESES_FIS.findIndex((m) => m === p[0]);
            if (idx < 0 || !p[1]) return 'Período inválido.';
            _fiscalPer = { mm: String(idx + 1).padStart(2, '0'), aa: p[1].slice(2) };
            window.__fiscalPer = _fiscalPer;
            if (mainBtn) mainBtn.textContent = _perLabel();
            cargarLibroFiscal('compra');
            cargarLibroFiscal('venta');
            if (window.cargarRetenciones) window.cargarRetenciones(); // retenciones del mismo período
            if (window.__syncFiscalHeader) window.__syncFiscalHeader(); // membrete con el nuevo período
            if (window.__pintarCierreBtn) window.__pintarCierreBtn();
            toast('Período fiscal: ' + _perLabel() + ' · libros recargados');
          },
        });
      };
      periodo.querySelectorAll('button').forEach((b) => b.addEventListener('click', abrirSelector));
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
      mes.forEach((r) => { const o = r.tipo === 'venta' ? v : c; o.tot += Number(r.total) || 0; o.be += (Number(r.base) || 0) + (Number(r.exento) || 0); o.iva += Number(r.iva) || 0; });
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
      'Proveedor / Sujeto retenido': ['Suministros Lara, C.A.', 'Tecnología Andes, S.A.', 'Importadora Zulia', 'Papelería Central', 'Insumos Agrícolas Aragua'],
      'Factura asociada': ['F-00284716', 'F-00045128', 'F-00731122', 'F-00018744', 'F-00045621'],
      'Período fiscal': ['1ra quincena · May 2026', '2da quincena · May 2026', 'Junio 2026'],
      'Período de declaración': ['Marzo 2026 (01–31)', 'Abril 2026 (01–30)', 'Mayo 2026 (01–31)', 'Junio 2026 (01–30)'],
      'Tipo de declaración': ['Originaria', 'Sustitutiva', 'Complementaria'],
      'Alícuota vigente': ['9% (sector privado)', '15% (tope de ley)'],
      'Ejercicio fiscal': ['Al 30/09/2025', 'Al 30/09/2026', 'Al 30/09/2027'],
      'Condición del sujeto': ['Contribuyente Especial', 'Contribuyente Ordinario', 'Persona Natural'],
    };
    view.querySelectorAll('.fiscal-tab .comp-controls .comp-field').forEach((field) => {
      const sb = field.querySelector('.select-box');
      if (!sb) return;
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
      try { if (window.__renderSuscripcion) window.__renderSuscripcion(); } catch (e) { console.warn('[DigiAccount] renderSuscripcion:', e); }
      // El fundador carga el listado real de cuentas del SaaS y sus contactos (CRM)
      if (window.__ES_FUNDADOR && window.cargarCuentasFundador) window.cargarCuentasFundador();
      if (window.__ES_FUNDADOR && window.cargarContactos) { try { window.cargarContactos(); } catch (e) {} }
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
        pendiente:  { ic: 'clock',        col: '#c97a1422;color:#e0a341', t: 'Tu cuenta está en revisión', p: 'Gracias por registrarte en DigiAccount. Estamos verificando tu cuenta para activarla; será muy pronto. Si tienes dudas, escríbenos por WhatsApp.' },
        suspendida: { ic: 'shield-alert', col: '#c0392b22;color:#e06b5e', t: 'Cuenta suspendida', p: 'Tu acceso está suspendido temporalmente. Comunícate con nosotros para reactivarla.' },
        trial:      { ic: 'timer-off',    col: '#c97a1422;color:#e0a341', t: 'Tu prueba terminó', p: 'Tu periodo de prueba de 14 días finalizó. Activa tu plan para seguir usando DigiAccount — escríbenos por WhatsApp y te ayudamos.' },
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
      // Autenticación REAL contra Supabase Auth
      const { data, error } = await window.sb.auth.signInWithPassword({ email: email, password: pass });
      if (error) { toast('Correo o contraseña incorrectos', 'error'); return; }
      window.__marcarActividad();
      // Recarga completa: contexto 100% LIMPIO para esta sesión (sin residuos en memoria
      // de otra cuenta usada antes en la misma pestaña). El arranque con sesión hace el resto.
      window.location.reload();
      if (perfil) {
        const plan = perfil.cuentas && perfil.cuentas.planes ? perfil.cuentas.planes.nombre : '';
        toast('Bienvenido, ' + String(perfil.nombre || '').split(' ')[0] + (plan ? ' · ' + plan : ''), 'success');
      } else {
        toast('Bienvenido a DigiAccount', 'success');
      }
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
      // Código de invitación (opcional): si es válido, el trigger une a la persona a la
      // cuenta que la invitó (como auxiliar) en vez de crearle una cuenta nueva de prueba.
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

    // Estado inicial: pantalla de acceso
    body.classList.remove('authed');
    setTab('login');

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
        try {
          const usr = data.session.user || {};
          const cod = (usr.user_metadata && usr.user_metadata.codigo_invitacion) || '';
          if (cod) {
            const { data: rj } = await window.sb.rpc('canjear_invitacion', { p_codigo: cod });
            if (rj && rj.ok && !rj.repetido) {
              if (window.toast) setTimeout(() => window.toast('¡Bienvenido al equipo! Tu acceso fue activado ✓', 'success'), 900);
            } else if (rj && rj.error && rj.error_visible) {
              if (window.toast) setTimeout(() => window.toast('Invitación: ' + rj.error, 'error'), 900);
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
    function saldoCell(t) {
      const parts = [];
      if (t.cxc > 0) parts.push('<span style="color:var(--da-success);">+' + fmt(t.cxc) + '</span>');
      if (t.cxp > 0) parts.push('<span style="color:#8a5410;">−' + fmt(t.cxp) + '</span>');
      return parts.length ? parts.join('<br>') : '<span style="color:var(--fg-muted);">—</span>';
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
    function render() {
      const vis = DB.filter(pasa);
      tbody.innerHTML = vis.map((t, i) => {
        const idx = DB.indexOf(t);
        return '<tr data-idx="' + idx + '">'
          + '<td><div class="prod-cell"><div class="prod-thumb" style="background:var(--da-navy-50);color:var(--da-navy-700);"><i data-lucide="' + iconTipo(t.tipo) + '"></i></div><div class="info"><div class="n">' + esc(t.nombre) + '</div><div class="sku">ID ' + esc(idSistema(t.rif)) + (t.email ? ' · ' + esc(t.email) : '') + '</div></div></div></td>'
          + '<td class="mono">' + esc(t.rif) + '</td><td>' + tipoCell(t.tipo) + '</td>'
          + '<td>' + rolBadges(t) + '</td><td>' + esc(t.fiscal) + '</td><td class="mono">' + esc(t.tel || '—') + '</td>'
          + '<td class="num">' + saldoCell(t) + '</td>'
          + '<td><button class="btn btn-ghost" data-ver-tercero="' + idx + '" style="height:26px;font-size:11px;padding:0 9px;white-space:nowrap;"><i data-lucide="eye"></i> Ficha</button></td></tr>';
      }).join('');
      const shown = document.getElementById('tercerosShown'); if (shown) shown.textContent = vis.length;
      const totalEl = document.getElementById('tercerosTotal'); if (totalEl) totalEl.textContent = DB.length;
      tbody.querySelectorAll('[data-ver-tercero]').forEach((b) => b.addEventListener('click', () => openFicha(DB[parseInt(b.dataset.verTercero, 10)])));
      if (window.lucide) window.lucide.createIcons();
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
    }
    window.cargarTerceros = cargarTerceros;
    // Getter para que otros módulos (Fiscal) ofrezcan los terceros como autocompletado
    window.__getTerceros = () => DB.map((t) => ({ id: t._id, nombre: t.nombre, rif: t.rif, cli: t.cli, prov: t.prov, fiscal: t.fiscal, tel: t.tel }));

    // ---- Filtros y búsqueda ----
    document.getElementById('tercerosFilters').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        document.getElementById('tercerosFilters').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        filtroRol = b.dataset.rol; render();
      });
    });
    const search = document.getElementById('tercerosSearch');
    if (search) search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });

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
    function close() { overlay.hidden = true; }
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
      const accion = (editIdx != null && DB[editIdx] && DB[editIdx]._id)
        ? window.sb.from('terceros').update(fila).eq('id', DB[editIdx]._id)
        : window.sb.from('terceros').insert(fila);
      accion.then(({ error }) => {
        if (error) { setMsg('No se pudo guardar: ' + error.message); return; }
        toast('Tercero "' + nombre + '" ' + (editIdx != null ? 'actualizado' : 'registrado'));
        if (window.cargarTerceros) window.cargarTerceros();
        close();
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
    // Abrir la ficha de un nuevo tercero (opcionalmente premarcado como cliente)
    window.openNuevoTercero = function (preset) {
      openFicha(null);
      if (preset && preset.cliente) { get('esCliente').checked = true; syncRolesTabs(); }
      setTab('general');
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

    // Especialistas subordinados del Gerente IA
    const AGENTS = [
      { id: 'contable', n: 'Agente Contable', ic: 'book-open', col: '#2f6df0', spec: 'Asientos · conciliación · cierre', tareas: 0, auto: 'sugiere' },
      { id: 'fiscal', n: 'Agente Fiscal', ic: 'file-text', col: '#c0392b', spec: 'SENIAT · IVA · ISLR · retenciones', tareas: 0, auto: 'aviso' },
      { id: 'tesoreria', n: 'Agente Tesorería', ic: 'wallet', col: '#1c8f5a', spec: 'Cobros · pagos · conciliación', tareas: 0, auto: 'aviso' },
      { id: 'ventas', n: 'Agente Ventas', ic: 'receipt', col: '#0e9bbf', spec: 'Facturación · despachos', tareas: 0, auto: 'sugiere' },
      { id: 'inventario', n: 'Agente Inventario', ic: 'package', col: '#c97a14', spec: 'Stock · reposición · órdenes', tareas: 0, auto: 'aviso' },
      { id: 'nomina', n: 'Agente Nómina', ic: 'users', col: '#7b54c9', spec: 'Recibos · LOTTT · parafiscales', tareas: 0, auto: 'sugiere' },
      { id: 'ocr', n: 'Agente OCR / Documentos', ic: 'scan-text', col: '#3a8dde', spec: 'Lee facturas por foto', tareas: 0, auto: 'aviso' },
      { id: 'analista', n: 'Agente Analista', ic: 'line-chart', col: '#0f8a8a', spec: 'Salud financiera · reportes', tareas: 0, auto: 'silencioso' },
    ];

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

    const grid = document.getElementById('agGrid');
    function renderGrid() {
      grid.innerHTML = AGENTS.map((a) =>
        '<div class="ag-card" data-agent="' + a.id + '">'
        + '<div class="ag-card-top"><span class="ag-bot" style="--bot:' + a.col + ';">' + robotSvg() + '<span class="ag-bot-badge"><i data-lucide="' + a.ic + '"></i></span></span><span class="ag-status online"><span class="dot"></span> Activo</span></div>'
        + '<div class="ag-name">' + a.n + '</div><div class="ag-spec">' + a.spec + '</div>'
        + '<div class="ag-cardmeta"><span><strong>' + a.tareas + '</strong> hoy</span><span class="ag-auto ' + AUTO_CLS[a.auto] + '">' + AUTO_LABEL[a.auto] + '</span></div>'
        + '<button class="ag-config" data-ag-config="' + a.id + '"><i data-lucide="sliders-horizontal"></i> Autonomía</button>'
        + '</div>'
      ).join('');
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
        ['3. Planes, prueba gratuita y pagos', 'Ofrecemos un período de prueba gratuito de 14 días sin necesidad de tarjeta. Al finalizar, para continuar deberás contratar un plan. Los precios se expresan en dólares estadounidenses (USD) y pueden pagarse en bolívares al tipo de cambio de referencia del BCV del día, o en divisas. Aceptamos Pago Móvil, transferencia, USDT y Zelle. La suscripción se renueva por períodos iguales hasta que la canceles.'],
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

    const PANELS = { cuentas: panelCuentas, contactos: panelContactos, cobros: document.getElementById('fundadorTabCobros') };
    tabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach((x) => (x.dataset.active = x === b ? 'true' : 'false'));
      const tab = b.dataset.tab;
      Object.keys(PANELS).forEach((k) => { if (PANELS[k]) PANELS[k].hidden = k !== tab; });
      const esCuentas = tab === 'cuentas';
      if (exportBtn) exportBtn.style.display = esCuentas ? '' : 'none';
      if (nuevaBtn) nuevaBtn.style.display = esCuentas ? '' : 'none';
      if (tab === 'contactos') { render(); if (window.cargarContactos) window.cargarContactos(); }
      if (tab === 'cobros') { if (window.__renderPagos) window.__renderPagos(); if (window.cargarPagos) window.cargarPagos(); }
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
      logoName.textContent = f.name;
      const reader = new FileReader();
      reader.onload = (e) => { logoPrev.innerHTML = '<img src="' + e.target.result + '" alt="logo">'; };
      reader.readAsDataURL(f);
      toast('Logo cargado · se usará en tus documentos', 'success');
    });

    // La tasa de cambio se comparte con Cobros y los recibos (window.__BCV)
    const tasaInput = document.getElementById('cfgTasa');
    if (tasaInput && window.__BCV) tasaInput.value = bsFmt(window.__BCV);

    document.getElementById('cfgGuardar').addEventListener('click', () => {
      const razon = (document.getElementById('cfgRazon').value || '').trim();
      if (razon) document.getElementById('cfgEmpresaNombre').textContent = razon;
      // Tasa de cambio → se propaga a Cobros y recibos
      const tasa = parseFloat(String((document.getElementById('cfgTasa') || {}).value || '').replace(',', '.'));
      if (tasa && tasa > 0) {
        window.__BCV = tasa;
        const bcvTasa = document.getElementById('bcvTasa');
        if (bcvTasa) bcvTasa.textContent = bsFmt(tasa);
      }
      toast('Configuración guardada correctamente', 'success');
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
      info: (d) => ({ icon: 'gift', title: 'Estás disfrutando tu prueba gratis', sub: 'Quedan ' + d + ' días · activa tu plan cuando quieras, sin apuro.' }),
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
     cuenta creada → elegir plan (prueba 14 días) → empresa → sistema
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
          + '<button class="pc-cta ' + (p.popular ? 'primary' : 'ghost') + '" data-plan="' + p.nombre + '"><i data-lucide="sparkles"></i> Iniciar prueba</button>'
          + '<div class="pc-trial-note">14 días gratis · luego $' + precioMes(p) + '/mes</div>'
          + '</div>';
      }).join('');
      grid.querySelectorAll('.pc-cta').forEach((b) => b.addEventListener('click', () => elegir(b.dataset.plan)));
      if (window.lucide) window.lucide.createIcons();
    }

    function elegir(plan) {
      if (window.__iniciarPrueba) window.__iniciarPrueba(plan, 14);
      else if (window.aplicarPlan) window.aplicarPlan(plan);
      close();
      toast('Prueba de 14 días iniciada · Plan ' + plan + ' · ahora registra tu empresa', 'success');
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
        .select('id, nombre, tipo, segmento, estado, trial_termina_en, planes(nombre)');
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
        return {
          id: c.id, cuenta: c.nombre, admin: adminBy[c.id] || '—',
          tipo: (c.segmento || c.tipo) === 'contador' ? 'Firma Contable' : 'Empresa',
          plan: planNombre, empresas: empsBy[c.id] || 0, usuarios: usersBy[c.id] || 0,
          estado: est, trialDias: trialDias, mrr: est === 'Activa' ? (pl.precio || 0) : 0,
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
          + '<td class="num mono">$' + c.mrr + '</td>'
          + '<td style="white-space:nowrap;"><button class="btn btn-ghost" data-cuenta="' + CUENTAS.indexOf(c) + '" style="height:26px;font-size:11px;padding:0 9px;"><i data-lucide="eye"></i> Ver</button>'
          + (['Pendiente', 'Prueba', 'Vencida'].indexOf(c.estado) >= 0
              ? '<button class="btn btn-primary" data-activar="' + CUENTAS.indexOf(c) + '" style="height:26px;font-size:11px;padding:0 9px;margin-left:4px;"><i data-lucide="check"></i> Activar</button>'
              : c.estado === 'Activa'
              ? '<button class="btn btn-ghost" data-suspender="' + CUENTAS.indexOf(c) + '" style="height:26px;font-size:11px;padding:0 9px;margin-left:4px;color:#e06b5e;"><i data-lucide="ban"></i> Suspender</button>'
              : '<button class="btn btn-ghost" data-activar="' + CUENTAS.indexOf(c) + '" style="height:26px;font-size:11px;padding:0 9px;margin-left:4px;"><i data-lucide="rotate-ccw"></i> Reactivar</button>')
          + '<button class="btn btn-ghost" data-eliminar="' + CUENTAS.indexOf(c) + '" title="Eliminar cuenta" style="height:26px;font-size:11px;padding:0 8px;margin-left:4px;color:#c0392b;"><i data-lucide="trash-2"></i></button>'
          + '</td></tr>';
      }).join('');
      tb.querySelectorAll('[data-cuenta]').forEach((b) => b.addEventListener('click', () => verCuenta(CUENTAS[parseInt(b.dataset.cuenta, 10)])));
      tb.querySelectorAll('[data-activar]').forEach((b) => b.addEventListener('click', () => cambiarEstado(CUENTAS[parseInt(b.dataset.activar, 10)], 'activa')));
      tb.querySelectorAll('[data-suspender]').forEach((b) => b.addEventListener('click', () => cambiarEstado(CUENTAS[parseInt(b.dataset.suspender, 10)], 'suspendida')));
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

    // Selección de tarjetas (single por grupo)
    scrim.querySelectorAll('.wiz-choice').forEach((grp) => {
      grp.querySelectorAll('.choice-card').forEach((card) => card.addEventListener('click', () => {
        grp.querySelectorAll('.choice-card').forEach((c) => (c.dataset.sel = 'false'));
        card.dataset.sel = 'true';
        sel[grp.dataset.choice] = card.dataset.val;
      }));
    });
    // Toggle de obligaciones
    scrim.querySelectorAll('.oblig-check').forEach((o) => o.addEventListener('click', () => { o.dataset.on = o.dataset.on === 'true' ? 'false' : 'true'; }));

    // Tipo de entidad → campos condicionales y armado de razón social
    const TG = { 'Persona jurídica (J)': 'std', 'Persona natural (V/E)': 'std', 'Firma Personal (F.P.)': 'fp', 'Emprendimiento (J)': 'emp' };
    const RIFLETRA = { 'Persona jurídica (J)': 'J', 'Persona natural (V/E)': 'V', 'Firma Personal (F.P.)': 'V', 'Emprendimiento (J)': 'J' };
    const tgActual = () => TG[sel.tipo] || 'std';
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
      // Tipo de entidad según la letra del RIF (J/G → jurídica; V/E → natural)
      if (d.tipo === 'juridica' || d.tipo === 'natural') {
        const val = d.tipo === 'juridica' ? 'Persona jurídica (J)' : 'Persona natural (V/E)';
        const card = scrim.querySelector('.wiz-choice[data-choice="tipo"] .choice-card[data-val="' + val + '"]');
        if (card) card.click();
        updateTipoFields();
      }
      if (d.razon_social) { const n = document.getElementById('cwNombre'); if (n) n.value = d.razon_social; }
      if (d.rif) { const rEl = document.getElementById('cwRif'); if (rEl) rEl.value = d.rif; }
      if (d.domicilio) { const dom = document.getElementById('cwDom'); if (dom) dom.value = d.domicilio; }
      if (d.condicion) { const c = document.getElementById('cwCond'); if (c) c.value = d.condicion === 'especial' ? 'Contribuyente especial' : 'Contribuyente ordinario'; }
      updatePreview();
      const conf = d.confianza != null ? ' · certeza ' + Math.round(d.confianza * 100) + '%' : '';
      setTxt('🤖 RIF leído ✓ · ' + (d.rif || file.name) + conf, 'Datos cargados: revisa y corrige lo que haga falta. El documento se archivará en la Bóveda Fiscal de la empresa.');
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
          // Datos de contacto de la empresa (para el CRM del fundador)
          telefono: ((document.getElementById('cwTel') || {}).value || '').trim() || null,
          whatsapp: ((document.getElementById('cwWhatsapp') || {}).value || '').trim() || null,
          email: ((document.getElementById('cwEmail') || {}).value || '').trim() || null,
        };
        window.sb.from('empresas').insert(filaEmp).select('id').single().then(({ data: nueva, error }) => {
          if (error && /column|schema cache/i.test(error.message || '')) {
            // columnas de contacto aún no existen: guarda sin ellas (no bloquear el alta)
            delete filaEmp.telefono; delete filaEmp.whatsapp; delete filaEmp.email;
            return window.sb.from('empresas').insert(filaEmp).select('id').single().then(({ data: n2, error: e2 }) => manejarAlta(e2, n2));
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
      'Contador Básico': 3, 'Contador PRO': 10, 'Firma Contable': Infinity,
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
      window.__prueba = prueba ? { plan: plan, dias: prueba.dias || 14 } : null;
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
    // Inicia el plan en modo prueba (14 días) — usado por el onboarding
    window.__iniciarPrueba = function (plan, dias) { aplicarPlan(plan, { dias: dias || 14 }); };
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

