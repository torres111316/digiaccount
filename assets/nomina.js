/* =========================================================
   DigiAccount ERP — NOMINA
   Empleados, recibos, vacaciones, utilidades, liquidaciones y la relacion
   del periodo.

   Salio de app.js porque es el modulo mas grande que casi no depende de
   nadie: de las veinte mil lineas del bloque grande solo usaba dos cosas
   —`esc` y `drawIcons`—, que ahora viven en el nucleo.

   Se carga DESPUES de app.js: lo que expone (el monto en letras, la
   relacion, la firma del recibo) lo consumen otros modulos a traves de
   `window.__*`, y lo que necesita de ellos tambien.
   ========================================================= */
(function () {
  'use strict';

  // Los dos nombres cortos que usa el cuerpo, apuntando al nucleo.
  const esc = window.__esc;
  const drawIcons = window.__drawIcons;

  (function payroll() {
    const view = document.getElementById('view-nomina');
    if (!view) return;

    const HOY = new Date(); // fecha real del sistema (antigüedad, utilidades y liquidación al día)

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
    // Fecha de inicio del disfrute de vacaciones por empleado (ISO 'aaaa-mm-dd'); default hoy.
    const _vacInicio = {};
    const _fmtFecha = (d) => ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
    // Fecha de reingreso = primer día hábil (L-V) después de consumir 'dias' días hábiles desde 'inicio'.
    function fechaReingreso(inicioISO, dias) {
      const esHabil = (d) => d.getDay() !== 0 && d.getDay() !== 6;
      let d = new Date(inicioISO + 'T00:00:00'); let cont = 0;
      while (cont < dias) { if (esHabil(d)) cont++; if (cont < dias) d.setDate(d.getDate() + 1); }
      do { d.setDate(d.getDate() + 1); } while (!esHabil(d));
      return d;
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
    function montoEnLetras(n, moneda) {
      if (moneda === 'USD') {
        /* «un dólar», «veintiún dólares», «un millón de dólares». Los
           bolivares no se tocan: esos documentos ya estan emitidos asi. */
        const r = Math.round((Number(n) || 0) * 100) / 100;
        const e = Math.floor(r), c = Math.round((r - e) * 100);
        let pal = enLetras(e).replace(/veintiuno$/, 'veintiún').replace(/(^|\s)uno$/, '$1un');
        if (/(millón|millones)$/.test(pal)) pal += ' de';
        return pal + ' ' + (e === 1 ? 'dólar' : 'dólares') + ' con ' + String(c).padStart(2, '0') + '/100';
      }
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
        + '<button class="btn btn-ghost" id="basePrestReal" style="height:30px;font-size:11px;background:var(--da-cyan-50);border-color:var(--da-cyan-100);" title="Usar el sueldo REAL del trabajador: salario base + bono de contingencia (paquete a tasa BCV). Legalmente el bono no es cotizable, pero refleja lo que el trabajador realmente gana.">Sueldo real (base + bono)</button>'
        + '<span style="font-size:11px;color:' + (ajustada ? '#0a7a44' : 'var(--fg-muted)') + ';">' + (ajustada ? '✓ base ajustada' : 'base = mínimo legal') + '</span>'
        + '</div>';

      if (tab === 'vacaciones') {
        html += calcHead(emp, c, 'Período', String(HOY.getFullYear()));
        const iniISO = _vacInicio[emp.id] || new Date().toISOString().slice(0, 10);
        const reing = fechaReingreso(iniISO, c.diasVac);
        html += '<div class="calc-basebar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;margin-bottom:10px;border:1px solid var(--border-strong);border-radius:10px;background:var(--bg-subtle);">'
          + '<span style="font-size:12px;font-weight:600;">Inicio del disfrute:</span>'
          + '<input type="date" id="vacInicioInput" value="' + iniISO + '" style="height:32px;border:1px solid var(--border-strong);border-radius:8px;padding:0 10px;font:inherit;background:var(--bg-surface);color:inherit;">'
          + '<span style="font-size:12px;color:var(--fg-muted);">Reingreso:</span>'
          + '<span style="font-size:13px;font-weight:700;color:#0a7a44;">' + _fmtFecha(reing) + '</span>'
          + '<span style="font-size:11px;color:var(--fg-muted);">(' + c.diasVac + ' días hábiles de disfrute · L-V)</span>'
          + '</div>';
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
      const btnReal = host.querySelector('#basePrestReal');
      if (btnReal) btnReal.addEventListener('click', () => {
        /* Sueldo real mensual = (salario base del período + bono de
           contingencia) × períodos por mes. Se usa la frecuencia PROPIA del
           trabajador, no el selector global, que puede estar en otra.

           SE CALCULA COMO SI NO ESTUVIERA DE VACACIONES, y es la clave: en
           `calcPago`, quien está de vacaciones no devenga salario ni
           contingencia —correcto para su recibo de la semana— así que el
           «sueldo real» daba CERO y el aviso concluía «no tiene paquete/bono
           configurado». Le pasó a Mariannys el día después de empezar las
           suyas, teniendo la ficha idéntica a la de un compañero al que sí le
           funcionó porque las suyas ya habían terminado.

           Y es al revés de lo que hace falta: la base para pagar las
           vacaciones es justamente el sueldo que ganaría si NO estuviera de
           vacaciones. */
        const empBase = Object.assign({}, emp, { vacacionesDesde: null, vacacionesHasta: null });
        const p = calcPago(empBase, emp.frecHabitual || payFreq);
        const div = (p.f && p.f.div) ? p.f.div : 1;
        const baseReal = (p.sueldo + p.bonoContingencia) * div;
        if (baseReal > 0) { aplicarBase(baseReal); if (window.toast) window.toast('Base = sueldo real (base + bono de contingencia): Bs ' + fmt(baseReal), 'success'); }
        else if (window.toast) window.toast('No pude calcular el sueldo real: ' + (emp.nombre || 'este trabajador') + ' no tiene salario ni bono de contingencia cargados en su ficha.', 'error');
      });
      const vacIni = host.querySelector('#vacInicioInput');
      if (vacIni) vacIni.addEventListener('change', () => { if (vacIni.value) { _vacInicio[emp.id] = vacIni.value; renderCalc(tab); } });
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
          ['asig', 'Salario por días de disfrute', c.diasVac + ' días · Art. 190 LOTTT (15 días + 1 por año de servicio, tope 30)', c.vacDisfrute],
          ['asig', 'Bono vacacional', c.diasBonoVac + ' días · Art. 192 LOTTT (15 días + 1 por año de servicio)', c.vacBono],
        ];
      }
      if (tab === 'utilidades') {
        return [
          ['asig', 'Utilidades / aguinaldo', c.diasUtil + ' días · Art. 131 y 132 LOTTT (mínimo 30 días de salario)', c.utilAnual],
          ['ded', 'INCES · aporte del trabajador', '0,5% sobre las utilidades · Ley del INCES, Art. 14', c.incesUtil],
        ];
      }
      // liquidación
      return [
        ['sec', 'Prestaciones sociales (Art. 142 LOTTT)', '', null],
        ['asig', 'Prestación a pagar', (c.usoRetro ? 'Cálculo retroactivo · 30 días por año' : 'Garantía · 15 días por trimestre') + ' · ' + c.y + ' años · Art. 142 LOTTT (se paga el monto mayor, literal d)', c.prestacion],
        ['asig', 'Intereses sobre prestaciones', (TASA_INTERES * 100).toFixed(0) + '% anual referencial · Art. 143 LOTTT', c.intereses],
        ['sec', 'Conceptos fraccionados', '', null],
        ['asig', 'Vacaciones fraccionadas', c.fracMeses + '/12 · Art. 190 y 196 LOTTT', c.vacFrac],
        ['asig', 'Bono vacacional fraccionado', c.fracMeses + '/12 · Art. 192 LOTTT', c.bonoVacFrac],
        ['asig', 'Utilidades fraccionadas', c.mesesAnio + '/12 · Art. 131 LOTTT', c.utilFrac],
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

      // Datos de disfrute solo para el recibo de Vacaciones
      let vacExtra = '';
      if (tab === 'vacaciones') {
        const iniISO = _vacInicio[emp.id] || new Date().toISOString().slice(0, 10);
        const reing = fechaReingreso(iniISO, c.diasVac);
        vacExtra = '<div class="rp"><div class="l">Salario mensual (base del cálculo)</div><div class="v">Bs ' + fmt(c.salDia * 30) + '</div></div>'
          + '<div class="rp"><div class="l">Salario diario</div><div class="v">Bs ' + fmt(c.salDia) + '</div></div>'
          + '<div class="rp"><div class="l">Inicio del disfrute</div><div class="v">' + _fmtFecha(new Date(iniISO + 'T00:00:00')) + '</div></div>'
          + '<div class="rp"><div class="l">Fecha de reingreso</div><div class="v">' + _fmtFecha(reing) + '</div></div>';
      }

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
        + vacExtra
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
    // Borrar la firma autorizada de la empresa (los recibos vuelven a salir sin firma)
    async function borrarFirmaEmpresa() {
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { if (window.toast) window.toast('No hay empresa activa.', 'error'); return; }
      const { error } = await window.sb.from('empresas').update({ firma_empresa: null }).eq('id', window.__EMPRESA_ACTIVA.id);
      if (error) { if (window.toast) window.toast('No se pudo borrar: ' + error.message, 'error'); return; }
      window.__EMPRESA_ACTIVA.firmaEmpresa = '';
      const opt = document.querySelector('.entity-option[data-empresa-id="' + window.__EMPRESA_ACTIVA.id + '"]');
      if (opt) opt.dataset.firma = '';
      if (window.toast) window.toast('Firma de la empresa borrada · los recibos saldrán sin firma', 'success');
    }
    const firmaEmpBtn = document.getElementById('reciboFirmaEmpresa');
    if (firmaEmpBtn) firmaEmpBtn.addEventListener('click', () => {
      // Si ya hay firma, ofrecer borrarla; si cancela (o no hay), abre el pad para firmar/reemplazar.
      if (window.__EMPRESA_ACTIVA && window.__EMPRESA_ACTIVA.firmaEmpresa
        && window.confirm('Esta empresa ya tiene una firma guardada que se estampa en los recibos.\n\n¿Quieres BORRARLA? (los recibos saldrán sin la firma de la empresa)\n\nAceptar = borrar · Cancelar = firmar de nuevo (reemplazar)')) {
        borrarFirmaEmpresa();
        return;
      }
      if (window.__abrirFirma) window.__abrirFirma(guardarFirmaEmpresa);
    });

    // ---------- Recibo de pago (semanal / quincenal / mensual) ----------
    let payFreq = 'semanal'; // la mayoría del personal operativo cobra semanal (default más común)
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
    const fmtFechaISO = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d + '/' + m + '/' + y; };
    // Vacaciones: mientras hoy caiga en [desde, hasta], el trabajador NO devenga salario ni
    // contingencia/transporte en la nómina regular — solo se le sigue pagando el Cestaticket.
    function enVacaciones(emp) {
      if (!emp.vacacionesDesde || !emp.vacacionesHasta) return false;
      const hoyISO = window.__hoyISO ? window.__hoyISO() : new Date().toISOString().slice(0, 10);
      return hoyISO >= emp.vacacionesDesde && hoyISO <= emp.vacacionesHasta;
    }

    function calcPago(emp, freqOver) {
      const fq = freqOver || payFreq;
      const f = freqInfo[fq];
      f.periodo = periodoNomina(fq);
      const factor = 2 / f.div; // proporción respecto a la quincena (quincenal=1, mensual=2, semanal≈0,46)
      // Nómina se liquida con la tasa de FECHA VALOR más reciente publicada por el BCV:
      // el sábado de pago usa la del lunes siguiente (publicada el viernes en la tarde).
      const tasa = window.__bcvRateNomina || window.__bcvRate || 145.82;

      // Vacaciones: mientras esté en su rango de vacaciones, NO devenga salario ni novedades
      // ni contingencia/transporte — solo se le sigue pagando el Cestaticket (más abajo).
      const deVacaciones = enVacaciones(emp);

      // Salario base COTIZABLE = el que se declara para el trabajador.
      // El Bono de Contingencia es un complemento NO salarial (no cotizable), explícito.
      const sueldo = deVacaciones ? 0 : (emp.salarioMes || 0) / f.div;

      const salDia = SALARIO_MINIMO / 30;            // recargos legales sobre el salario base
      const valHora = salDia / 8;                    // jornada de 8 h

      // Horas extras (Art. 118 LOTTT: recargo 50% sobre la hora normal)
      const valHoraExtra = valHora * 1.5;
      const horas = deVacaciones ? 0 : Math.round(emp.horasExtra || 0);       // novedad: horas reales del período
      const montoExtra = horas * valHoraExtra;

      // Bono nocturno (Art. 117 LOTTT: recargo 30% sobre la hora normal)
      const valBonoNoct = valHora * 0.30;
      const horasNoct = deVacaciones ? 0 : Math.round(emp.horasNoct || 0);    // novedad del período
      const montoNoct = horasNoct * valBonoNoct;

      // Días feriados / domingos trabajados (Art. 120 LOTTT: recargo 50%)
      const diasFeriado = deVacaciones ? 0 : Math.round(emp.diasFeriado || 0); // novedad del período
      const montoFeriado = diasFeriado * salDia * 1.5;

      // Comisiones y bono de producción (novedades del período, salariales)
      const comision = deVacaciones ? 0 : (emp.comisionBs || 0);
      const bonoProd = deVacaciones ? 0 : (emp.bonoProdBs || 0);

      // Cestaticket / bono de alimentación: $40/mes pagado en Bs a tasa BCV (no salarial, sin deducciones).
      // Semanal se calcula (40/30)×7 = 9,33 $/semana (convención de la firma, redondeado a 2
      // decimales en USD para casar con las planillas); quincenal /2, mensual completo.
      const cestaUsdPeriodo = Math.round(CESTATICKET_USD * (fq === 'semanal' ? 7 / 30 : 1 / f.div) * 100) / 100;
      const cestaticket = cestaUsdPeriodo * tasa;

      // Bono de Contingencia (modelo de la firma): emp.contingenciaUSD es el PAQUETE TOTAL
      // en USD del PERÍODO DE PAGO del trabajador (ej. 70 $ semanales). El complemento no
      // salarial (contingencia + transporte) completa el paquete después del salario neto de
      // ley y el cestaticket, de modo que el trabajador reciba EXACTAMENTE su paquete en Bs a
      // la tasa BCV, muevan lo que muevan las deducciones o cómo se reparta el complemento.
      let transporteBs = 0, bonoContingencia = 0;
      if (!deVacaciones) {
        const dedSueldo = Math.min(sueldo, TOPE_IVSS / f.div) * R_IVSS_T
          + Math.min(sueldo, TOPE_RPE / f.div) * R_RPE_T + sueldo * R_FAOV_T;
        const paqueteBs = (emp.contingenciaUSD || 0) * tasa;
        const complementoNoSalarial = Math.max(0, paqueteBs - cestaticket - (sueldo - dedSueldo));
        // Bono de transporte: % del complemento (se mantiene proporcional aunque cambie la tasa
        // o el paquete) si el trabajador tiene un % configurado; si no, monto fijo en USD (como
        // antes). En ambos casos se DESCUENTA de la contingencia, nunca se suma aparte — así el
        // trabajador sigue recibiendo el mismo paquete total, solo repartido en dos conceptos.
        transporteBs = (emp.transportePct || 0) > 0
          ? complementoNoSalarial * emp.transportePct
          : (emp.transporteUSD || 0) * tasa / f.div;
        bonoContingencia = Math.max(0, complementoNoSalarial - transporteBs);
      }

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

      // Otras deducciones (no aplican durante vacaciones: solo se paga el Cestaticket)
      const cajaAhorro = deVacaciones ? 0 : salarioNormal * (emp.cajaAhorroPct || 0);
      const prestamo = deVacaciones ? 0 : (emp.prestamoCuota || 0) / f.div;     // recurrente mensual, prorrateado
      const anticipo = deVacaciones ? 0 : (emp.anticipoSueldo || 0);            // novedad del período
      const dedOtras = cajaAhorro + prestamo + anticipo;

      const ded = dedLey + dedOtras;
      const asigSalarial = baseSalarial;
      // El Bono de Contingencia, el cestaticket y el bono de transporte son asignaciones NO salariales
      const asig = asigSalarial + bonoContingencia + cestaticket + transporteBs;
      const neto = asig - ded;
      return {
        f, tasa, salDia, sueldo, deVacaciones, bonoContingencia, transporteBs, valHora, baseIvss, baseRpe,
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

      const rows = [];
      if (p.deVacaciones) {
        rows.push(['sec', 'De vacaciones desde ' + fmtFechaISO(emp.vacacionesDesde) + ' hasta ' + fmtFechaISO(emp.vacacionesHasta) + ' · no devenga salario ni contingencia en este período', '', null]);
        rows.push(['sec', 'Beneficios no salariales (no cotizables)', '', null]);
        rows.push(['asig', 'Cestaticket · Bono de alimentación', '$' + (p.cestaUsdPeriodo || 0) + ' del período ($40/mes) a tasa BCV (Bs ' + fmt(p.tasa) + '/$) · exento de deducciones', p.cestaticket]);
      } else {
        rows.push(['sec', 'Asignaciones salariales', '', null]);
        rows.push(['asig', p.f.etiqueta + ' (salario base)', 'Salario base cotizable · Bs ' + fmt(emp.salarioMes) + '/mes', p.sueldo]);
        if (p.horas > 0) rows.push(['asig', 'Horas extras (' + p.horas + ' h)', 'Bs ' + fmt(p.valHoraExtra) + '/h · recargo 50% (Art. 118)', p.montoExtra]);
        if (p.horasNoct > 0) rows.push(['asig', 'Bono nocturno (' + p.horasNoct + ' h)', 'Bs ' + fmt(p.valBonoNoct) + '/h · recargo 30% (Art. 117)', p.montoNoct]);
        if (p.diasFeriado > 0) rows.push(['asig', 'Días feriados / domingos (' + p.diasFeriado + ')', 'Recargo 50% sobre el día (Art. 120)', p.montoFeriado]);
        if (p.comision > 0) rows.push(['asig', 'Comisiones por ventas', '2% sobre ventas del período', p.comision]);
        if (p.bonoProd > 0) rows.push(['asig', 'Bono de producción', 'Meta de planta alcanzada', p.bonoProd]);
        rows.push(['sec', 'Beneficios no salariales (no cotizables)', '', null]);
        if (p.bonoContingencia > 0) rows.push(['asig', 'Bono de contingencia', 'completa el paquete de $' + (emp.contingenciaUSD || 0) + ' del período (Bs ' + fmt(p.tasa) + '/$) · no salarial', p.bonoContingencia]);
        rows.push(['asig', 'Cestaticket · Bono de alimentación', '$' + (p.cestaUsdPeriodo || 0) + ' del período ($40/mes) a tasa BCV (Bs ' + fmt(p.tasa) + '/$) · exento de deducciones', p.cestaticket]);
        if (p.transporteBs > 0) rows.push(['asig', 'Bono de transporte', (emp.transportePct > 0 ? (emp.transportePct * 100).toFixed(0) + '% del complemento no salarial' : '$' + (emp.transporteUSD || 0) + ' a tasa BCV (Bs ' + fmt(p.tasa) + '/$)') + ' · no salarial', p.transporteBs]);
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
        const vac = enVacaciones(emp);
        const vacBadge = vac ? '<span class="tag warn" title="No devenga salario ni contingencia hasta reincorporarse">🌴 De vacaciones hasta ' + fmtFechaISO(emp.vacacionesHasta) + '</span>' : (emp.depto !== '—' ? emp.depto : ('$' + (emp.contingenciaUSD || 0) + ' / período'));
        return '<tr>'
          + '<td><div class="emp-cell"><div class="emp-avatar" style="background:' + emp.color + ';">' + emp.ini + '</div>'
          + '<div class="info"><div class="n">' + emp.nombre + '</div><div class="r">' + vacBadge + '</div></div></div></td>'
          + '<td class="mono">' + emp.cedula + '</td>'
          + '<td>' + (emp.cargo || '—') + '</td>'
          + '<td class="num">' + fmt(emp.salarioMes) + '</td>'
          + '<td class="num">' + (emp.contingenciaUSD ? '$' + emp.contingenciaUSD : '—') + '</td>'
          + '<td>' + emp.formaPago + '</td>'
          + '<td class="num">' + fmt(emp.salarioMes / divPer) + '</td>'
          + '<td>' + (FREC_TAG[emp.frecHabitual] || FREC_TAG.quincenal) + '</td>'
          + '<td style="white-space:nowrap;"><button class="btn btn-ghost" data-emp-edit="' + i + '" title="Editar trabajador" style="height:28px;font-size:11px;padding:0 9px;"><i data-lucide="pencil"></i></button> <button class="btn btn-ghost" data-emp-vac="' + i + '" title="Marcar/quitar vacaciones" style="height:28px;font-size:11px;padding:0 9px;' + (vac ? 'color:var(--da-cyan-700);' : '') + '"><i data-lucide="palmtree"></i></button> <button class="btn btn-ghost" data-emp-exp="' + i + '" title="Expediente (cédula, RIF, contrato)" style="height:28px;font-size:11px;padding:0 9px;"><i data-lucide="folder"></i></button> <button class="btn btn-ghost" data-emp-idx="' + i + '" style="height:28px;font-size:11px;padding:0 10px;"><i data-lucide="file-text"></i> Recibo</button></td>'
          + '</tr>';
      }).join('');
      tbody.querySelectorAll('button[data-emp-idx]').forEach((b) => {
        b.addEventListener('click', () => openReciboPago(empleados[parseInt(b.dataset.empIdx, 10)]));
      });
      tbody.querySelectorAll('button[data-emp-edit]').forEach((b) => {
        b.addEventListener('click', () => formEmpleado(empleados[parseInt(b.dataset.empEdit, 10)]));
      });
      tbody.querySelectorAll('button[data-emp-vac]').forEach((b) => {
        b.addEventListener('click', () => formVacaciones(empleados[parseInt(b.dataset.empVac, 10)]));
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
        transporteUSD: Number(r.transporte_usd) || 0, transportePct: (Number(r.transporte_pct) || 0) / 100,
        vacacionesDesde: r.vacaciones_desde || '', vacacionesHasta: r.vacaciones_hasta || '',
        bonoLabel: Number(r.transporte_pct) > 0 ? Number(r.transporte_pct) + '% transp.' : (Number(r.transporte_usd) > 0 ? '$' + Number(r.transporte_usd) + ' transp.' : '—'),
        sujetoDpp: !!r.sujeto_dpp,
        formaPago: r.forma_pago || 'Transferencia', frecHabitual: r.frecuencia || 'quincenal',
        prestamoCuota: Number(r.prestamo_cuota) || 0, cajaAhorroPct: (Number(r.caja_ahorro_pct) || 0) / 100,
        contingenciaUSD: Number(r.contingencia_usd) || 0,
        nacionalidad: r.nacionalidad || '', estadoCivil: r.estado_civil || '', direccion: r.direccion || '',
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
          { name: 'nacionalidad', label: 'Nacionalidad', type: 'select', value: emp && emp.nacionalidad ? emp.nacionalidad : 'Venezolana', options: ['Venezolana', 'Extranjera'] },
          { name: 'estadoCivil', label: 'Estado civil', type: 'select', value: emp && emp.estadoCivil ? emp.estadoCivil : 'Soltero(a)', options: ['Soltero(a)', 'Casado(a)', 'Divorciado(a)', 'Viudo(a)', 'Unión estable de hecho'] },
          { name: 'direccion', label: 'Dirección de habitación', col: 2, placeholder: 'Domicilio del trabajador (para el contrato)', value: emp && emp.direccion ? emp.direccion : '' },
          { name: 'cargo', label: 'Cargo', placeholder: 'Ej. Asistente', value: emp ? emp.cargo : '' },
          { name: 'depto', label: 'Departamento', placeholder: 'Ej. Administración', value: emp && emp.depto !== '—' ? emp.depto : '' },
          { name: 'tipo', label: 'Tipo de trabajador', type: 'select', value: emp ? emp.tipo : 'Administrativo', options: ['Administrativo', 'Planta', 'Producción', 'Gerencia'] },
          { name: 'ingreso', label: 'Fecha de ingreso', type: 'date', value: emp && emp.ingreso ? _isoFecha(emp.ingreso) : new Date().toISOString().slice(0, 10) },
          { name: 'salarioMes', label: 'Salario base mensual cotizable (Bs)', type: 'number', step: '0.01', placeholder: '0.00', value: emp ? String(emp.salarioMes) : '' },
          { name: 'contingenciaUSD', label: 'Paquete del período en USD (ej. 70 semanales — el Bono de Contingencia completa: paquete − cesta − salario)', type: 'number', step: '0.01', moneda: 'USD', placeholder: '0', value: emp ? String(emp.contingenciaUSD || '') : '' },
          { name: 'transportePct', label: 'Bono de transporte (% de la contingencia, opcional — si lo llenas, manda sobre el monto fijo)', type: 'number', step: '1', placeholder: '0', value: emp && emp.transportePct ? String(emp.transportePct * 100) : '' },
          { name: 'transporteUSD', label: 'Bono de transporte en USD fijo (alternativa al %, se paga en Bs a tasa BCV)', type: 'number', step: '0.01', moneda: 'USD', placeholder: '0', value: emp ? String(emp.transporteUSD || '') : '' },
          { name: 'formaPago', label: 'Forma de pago', type: 'select', value: emp ? emp.formaPago : 'Transferencia', options: ['Transferencia', 'Efectivo', 'Pago móvil'] },
          { name: 'frec', label: 'Frecuencia (se ajusta sola al elegir el tipo)', type: 'select', value: emp ? emp.frecHabitual : 'semanal', options: [{ value: 'semanal', label: 'Semanal' }, { value: 'quincenal', label: 'Quincenal' }, { value: 'mensual', label: 'Mensual' }] },
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
          // No forzamos la frecuencia al abrir: arranca en 'semanal' (lo más común) y solo
          // se auto-ajusta si el usuario cambia el tipo de trabajador.
        },
        onSave: (v) => {
          const sal = parseFloat(v.salarioMes);
          if (!v.nombre || !v.cedula || !v.cargo) return 'Nombre, cédula y cargo son obligatorios.';
          if (!(sal > 0)) return 'El salario base mensual debe ser mayor a cero.';
          if (!window.sb || !window.__CUENTA_ID || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) return 'No hay una empresa activa.';
          const ini = v.nombre.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
          const datos = {
            nombre: v.nombre.trim(), cedula: v.cedula.trim(), cargo: v.cargo.trim(), depto: (v.depto || '').trim() || null,
            tipo: v.tipo, ingreso: v.ingreso || null, salario_mes: sal, contingencia_usd: parseFloat(v.contingenciaUSD) || 0, transporte_usd: parseFloat(v.transporteUSD) || 0, transporte_pct: parseFloat(v.transportePct) || 0,
            nacionalidad: v.nacionalidad || null, estado_civil: v.estadoCivil || null, direccion: (v.direccion || '').trim() || null,
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

    // Marcar/quitar vacaciones: mientras hoy caiga en el rango, la nómina regular solo le
    // paga el Cestaticket (ver calcPago). Dejar las fechas vacías = no está de vacaciones.
    function formVacaciones(emp) {
      const t = (m, tp) => { if (window.toast) window.toast(m, tp); };
      window.openFormModal({
        title: 'Vacaciones — ' + emp.nombre,
        saveLabel: 'Guardar',
        fields: [
          { name: 'desde', label: 'Fecha de inicio', type: 'date', value: emp.vacacionesDesde || '' },
          { name: 'hasta', label: 'Fecha de reincorporación', type: 'date', value: emp.vacacionesHasta || '' },
        ],
        onSave: (v) => {
          if ((v.desde && !v.hasta) || (!v.desde && v.hasta)) return 'Completa ambas fechas, o deja las dos vacías para quitarle las vacaciones.';
          if (v.desde && v.hasta && v.hasta < v.desde) return 'La fecha de reincorporación no puede ser anterior a la de inicio.';
          if (!window.sb) return 'No hay sesión activa.';
          window.sb.from('empleados').update({ vacaciones_desde: v.desde || null, vacaciones_hasta: v.hasta || null }).eq('id', emp.id).then(({ error }) => {
            if (error) { t('No se pudo guardar: ' + error.message, 'error'); return; }
            if (window.cargarEmpleados) window.cargarEmpleados();
            t(v.desde ? ('Vacaciones registradas: ' + fmtFechaISO(v.desde) + ' → ' + fmtFechaISO(v.hasta)) : 'Vacaciones quitadas — vuelve a la nómina regular');
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
        extraLabel: 'Generar contrato',
        onExtra: () => generarContrato(emp),
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

    // Genera el Contrato de Trabajo rellenado con la ficha de empresa + trabajador
    const _MESES_C = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    async function construirContrato(emp, tipo, extra) {
      tipo = tipo || 'indet'; extra = extra || {};
      const t = (m, tp) => { if (window.toast) window.toast(m, tp); };
      if (!window.sb || !window.__EMPRESA_ACTIVA || !window.__EMPRESA_ACTIVA.id) { t('No hay una empresa activa.', 'error'); return; }
      const { data: e, error } = await window.sb.from('empresas').select('*').eq('id', window.__EMPRESA_ACTIVA.id).single();
      if (error || !e) { t('No se pudieron leer los datos de la empresa.', 'error'); return; }
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const linea = (w) => '<span style="display:inline-block;min-width:' + (w || 130) + 'px;border-bottom:1px solid #888;">&nbsp;</span>';
      const V = (x, w) => (x && String(x).trim()) ? '<b>' + esc(x) + '</b>' : linea(w);          // dato o línea en blanco
      const fmtBs = (n) => 'Bs ' + (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fechaLarga = (d) => { try { return d.getDate() + ' de ' + _MESES_C[d.getMonth()] + ' de ' + d.getFullYear(); } catch (x) { return linea(150); } };
      const hoy = new Date();
      const paquete = Number(emp.contingenciaUSD) || 0;
      const frec = emp.frecHabitual || 'quincenal';
      const cl = (n, titulo, cuerpo) => '<div style="margin:0 0 11px;"><div style="font-weight:700;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#003057;margin-bottom:3px;">Cláusula ' + n + ' — ' + titulo + '</div><div style="text-align:justify;">' + cuerpo + '</div></div>';
      // Título y cláusula de duración según el tipo de contrato
      const tituloDoc = tipo === 'det' ? 'CONTRATO INDIVIDUAL DE TRABAJO A TIEMPO DETERMINADO'
        : tipo === 'obra' ? 'CONTRATO INDIVIDUAL DE TRABAJO PARA UNA OBRA DETERMINADA'
        : 'CONTRATO INDIVIDUAL DE TRABAJO POR TIEMPO INDETERMINADO';
      const fin = extra.fechaFin ? new Date(extra.fechaFin + 'T00:00:00') : null;
      const clDuracion = tipo === 'det'
        ? 'El presente contrato es <b>a tiempo determinado</b>, con inicio el ' + (emp.ingreso ? '<b>' + fechaLarga(emp.ingreso) + '</b>' : linea(150)) + ' y vencimiento el ' + (fin ? '<b>' + fechaLarga(fin) + '</b>' : linea(150)) + '. Se celebra conforme al artículo 64 de la LOTTT en atención a: ' + V(extra.causa, 200) + '. No excederá los límites de duración del artículo 62. Si a su vencimiento subsiste la causa que lo motivó y las partes continúan la relación, o si se celebran dos (2) o más prórrogas, el contrato se considerará por tiempo indeterminado (artículo 64).'
        : tipo === 'obra'
        ? 'El presente contrato es <b>para una obra determinada</b>, con inicio el ' + (emp.ingreso ? '<b>' + fechaLarga(emp.ingreso) + '</b>' : linea(150)) + ', y tiene por objeto la ejecución de la siguiente obra: ' + V(extra.obra, 220) + '. Durará por todo el tiempo requerido para la ejecución de la obra y terminará con la conclusión de la totalidad de los trabajos que correspondan a EL TRABAJADOR (artículo 63 de la LOTTT); la sola suspensión de los trabajos no extingue el contrato.'
        : 'El presente contrato es por <b>tiempo indeterminado</b> y comienza a regir a partir del ' + (emp.ingreso ? '<b>' + fechaLarga(emp.ingreso) + '</b>' : linea(150)) + '. La relación se rige por el principio de estabilidad e inamovilidad laboral en los términos de la LOTTT y los decretos vigentes.';

      const html = '<div class="contrato-print" style="color:#14181d;font-family:Georgia,\'Times New Roman\',serif;font-size:12px;line-height:1.5;">'
        + '<div style="text-align:center;border-bottom:2px solid #003057;padding-bottom:8px;margin-bottom:14px;">'
        + '<div style="font-weight:700;font-size:15px;">' + tituloDoc + '</div>'
        + '<div style="font-size:10px;color:#555;margin-top:2px;">Conforme a la Ley Orgánica del Trabajo, los Trabajadores y las Trabajadoras (LOTTT) — República Bolivariana de Venezuela</div></div>'
        + '<p style="text-align:justify;margin:0 0 12px;">Entre, por una parte, ' + V(e.nombre, 150) + ', inscrita en el Registro Mercantil ' + V(e.registro_mercantil, 150) + ', con Registro de Información Fiscal (RIF) ' + V(e.rif, 90) + ' y domicilio en ' + V(e.direccion, 160) + ', representada en este acto por ' + V(e.representante, 150) + ', titular de la cédula de identidad Nº ' + V(e.representante_ci, 100) + ', en su carácter de ' + V(e.representante_cargo, 120) + ', quien en lo sucesivo se denominará <b>«LA ENTIDAD DE TRABAJO»</b>; y por la otra parte, ' + V(emp.nombre, 150) + ', de nacionalidad ' + V(emp.nacionalidad, 90) + ', mayor de edad, de estado civil ' + V(emp.estadoCivil, 90) + ', titular de la cédula de identidad Nº ' + V(emp.cedula, 100) + ' y domiciliado(a) en ' + V(emp.direccion, 160) + ', quien en lo sucesivo se denominará <b>«EL TRABAJADOR / LA TRABAJADORA»</b>; hemos convenido en celebrar el presente Contrato Individual de Trabajo, que se regirá por las cláusulas siguientes:</p>'
        + cl('Primera', 'Objeto y cargo', 'EL TRABAJADOR se obliga a prestar sus servicios personales, de manera subordinada y por cuenta de LA ENTIDAD DE TRABAJO, desempeñando el cargo de ' + V(emp.cargo, 120) + (emp.depto && emp.depto !== '—' ? ', adscrito(a) al departamento de ' + V(emp.depto, 120) : '') + ', ejecutando las funciones propias e inherentes a dicho cargo y las tareas conexas que le sean razonablemente asignadas, con la diligencia e idoneidad debidas.')
        + cl('Segunda', 'Lugar de la prestación del servicio', 'EL TRABAJADOR prestará sus servicios en la sede de LA ENTIDAD DE TRABAJO ubicada en ' + V(e.direccion, 160) + ', sin perjuicio de que, por necesidades del servicio, pueda ser trasladado(a) a otra sede dentro de la misma localidad, respetando sus condiciones de trabajo conforme a la LOTTT.')
        + cl('Tercera', 'Jornada y horario', 'La jornada será de tipo ' + linea(70) + ' (diurna/nocturna/mixta), con el horario de ' + linea(60) + ' a ' + linea(60) + ', de ' + linea(110) + ', con día(s) de descanso semanal el ' + linea(90) + '. La jornada no excederá los límites del artículo 173 de la LOTTT. Las horas extraordinarias requerirán autorización previa y el recargo legal (artículo 118).')
        + cl('Cuarta', 'Salario y forma de pago', 'Como contraprestación, EL TRABAJADOR percibirá: <b>(i)</b> un salario base mensual de ' + (Number(emp.salarioMes) > 0 ? '<b>' + fmtBs(emp.salarioMes) + '</b>' : linea(120)) + ', de carácter normal y cotizable, base de cálculo de las cotizaciones de seguridad social; y <b>(ii)</b> una asignación complementaria acordada de ' + (paquete > 0 ? '<b>US$ ' + paquete + '</b>' : linea(80)) + ' por período de pago, pagadera en bolívares a la tasa oficial del BCV vigente a la fecha de pago, con carácter de bono de contingencia no salarial en los términos convenidos. El pago se efectuará por período <b>' + esc(frec) + '</b>, mediante ' + V(emp.formaPago, 100) + ', previa deducción de los aportes de ley.')
        + cl('Quinta', 'Beneficio de alimentación (Cestaticket)', 'LA ENTIDAD DE TRABAJO otorgará el beneficio de alimentación equivalente a <b>US$ ' + (CESTATICKET_USD || 40) + '</b> mensuales, pagadero en bolívares a la tasa BCV vigente conforme a la normativa aplicable. No tiene carácter salarial ni está sujeto a deducciones.')
        + cl('Sexta', 'Deducciones legales', 'Del salario normal se descontarán los aportes del trabajador conforme a la ley: Seguro Social Obligatorio (IVSS), Régimen Prestacional de Empleo, Fondo de Ahorro Obligatorio para la Vivienda (FAOV) y cualquier otra deducción legal o autorizada por escrito por EL TRABAJADOR.')
        + cl('Séptima', 'Prestaciones sociales', 'EL TRABAJADOR tendrá derecho a la garantía y pago de sus prestaciones sociales conforme al artículo 142 de la LOTTT, depositadas o acreditadas trimestralmente y liquidadas a la terminación de la relación laboral por la fórmula más favorable.')
        + cl('Octava', 'Vacaciones y bono vacacional', 'Vacaciones anuales remuneradas de quince (15) días hábiles al cumplir un año de servicio, más un (1) día adicional por año subsiguiente hasta el máximo de ley (artículo 190), y bono vacacional conforme al artículo 192 de la LOTTT.')
        + cl('Novena', 'Participación en los beneficios (utilidades)', 'EL TRABAJADOR participará en los beneficios anuales conforme a los artículos 131 y siguientes de la LOTTT, con el mínimo de treinta (30) días de salario según los resultados del ejercicio.')
        + cl('Décima', 'Duración e inicio', clDuracion)
        + cl('Décima Primera', 'Obligaciones del trabajador', 'EL TRABAJADOR se obliga a prestar el servicio con diligencia y probidad; cumplir las instrucciones y el reglamento interno; conservar y usar adecuadamente los bienes y herramientas; observar las normas de seguridad y salud laboral (LOPCYMAT); y guardar reserva sobre la información de la empresa.')
        + cl('Décima Segunda', 'Confidencialidad', 'EL TRABAJADOR mantendrá estricta confidencialidad sobre la información comercial, financiera, técnica y de clientes a la que tenga acceso, obligación que subsistirá aún después de terminada la relación de trabajo.')
        + cl('Décima Tercera', 'Seguridad y salud en el trabajo', 'LA ENTIDAD DE TRABAJO notificará los riesgos del puesto y proveerá las condiciones y dotación conforme a la LOPCYMAT y su Reglamento; EL TRABAJADOR cumplirá las políticas de prevención.')
        + cl('Décima Cuarta', 'Terminación de la relación', 'La relación podrá terminar por las causas previstas en la LOTTT: despido justificado (artículo 79), retiro justificado (artículo 80), voluntad común o causas ajenas a la voluntad de las partes (artículos 76 y siguientes), con el pago de las indemnizaciones y prestaciones que correspondan.')
        + cl('Décima Quinta', 'Régimen supletorio y jurisdicción', 'En lo no previsto se aplicará la LOTTT, su Reglamento y demás normativa vigente. Las partes se someten a la jurisdicción de los Tribunales del Trabajo de ' + V(e.ciudad, 130) + '.')
        + cl('Décima Sexta', 'Aceptación', 'Leídas las cláusulas anteriores, las partes las aceptan en todas sus partes. Se firman dos (2) ejemplares de un mismo tenor y a un solo efecto, quedando uno en poder de cada parte.')
        + '<p style="margin:14px 0 0;">En ' + V(e.ciudad, 120) + ', a los ' + hoy.getDate() + ' días del mes de ' + _MESES_C[hoy.getMonth()] + ' de ' + hoy.getFullYear() + '.</p>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:44px;">'
        + '<div style="text-align:center;"><div style="border-top:1.4px solid #14181d;margin-top:40px;padding-top:6px;font-weight:700;font-size:11px;">POR LA ENTIDAD DE TRABAJO</div><div style="font-size:10.5px;color:#555;margin-top:2px;">' + esc(e.representante || '') + (e.representante_ci ? ' · C.I. ' + esc(e.representante_ci) : '') + '</div></div>'
        + '<div style="text-align:center;"><div style="border-top:1.4px solid #14181d;margin-top:40px;padding-top:6px;font-weight:700;font-size:11px;">EL TRABAJADOR / LA TRABAJADORA</div><div style="font-size:10.5px;color:#555;margin-top:2px;">' + esc(emp.nombre || '') + (emp.cedula ? ' · C.I. ' + esc(emp.cedula) : '') + '</div></div>'
        + '</div></div>';

      let portal = document.getElementById('printPortal');
      if (!portal) { portal = document.createElement('div'); portal.id = 'printPortal'; document.body.appendChild(portal); }
      portal.innerHTML = html;
      if (window.__setPageSize) window.__setPageSize('letter portrait', '16mm');
      document.body.classList.add('printing-comp');
      const tOrig = document.title;
      const sufTipo = tipo === 'det' ? ' (tiempo determinado)' : tipo === 'obra' ? ' (obra determinada)' : '';
      document.title = ('Contrato de trabajo - ' + (emp.nombre || '') + sufTipo).replace(/[\\/:*?"<>|]/g, '-');
      const restore = () => { document.body.classList.remove('printing-comp'); const p = document.getElementById('printPortal'); if (p) p.innerHTML = ''; document.title = tOrig; window.removeEventListener('afterprint', restore); };
      window.addEventListener('afterprint', restore);
      window.print();
    }

    // Selector del tipo de contrato antes de generarlo
    function generarContrato(emp) {
      const hoyISO = new Date().toISOString().slice(0, 10);
      window.openFormModal({
        title: 'Generar contrato · ' + emp.nombre,
        saveLabel: 'Generar contrato',
        fields: [
          { name: 'tipo', label: 'Tipo de contrato', col: 2, type: 'select', value: 'Tiempo indeterminado', options: ['Tiempo indeterminado', 'Tiempo determinado', 'Por obra determinada'] },
          { name: 'fechaFin', label: 'Fecha de vencimiento (tiempo determinado)', type: 'date', value: '' },
          { name: 'causa', label: 'Causa que justifica el término (art. 64)', placeholder: 'Ej. sustitución temporal, aumento circunstancial de labores', value: '' },
          { name: 'obra', label: 'Descripción de la obra (obra determinada)', col: 2, placeholder: 'Ej. construcción del local ubicado en…', value: '' },
        ],
        afterRender: (body) => {
          const tipoEl = body.querySelector('[data-name="tipo"]');
          const wrap = (n) => { const el = body.querySelector('[data-name="' + n + '"]'); return el ? (el.closest('.fm-field') || el.parentNode) : null; };
          const wFin = wrap('fechaFin'), wCausa = wrap('causa'), wObra = wrap('obra');
          const toggle = () => {
            const v = tipoEl ? tipoEl.value : '';
            const det = /determinado$/i.test(v) && /Tiempo/i.test(v);
            const obra = /obra/i.test(v);
            if (wFin) wFin.style.display = det ? '' : 'none';
            if (wCausa) wCausa.style.display = det ? '' : 'none';
            if (wObra) wObra.style.display = obra ? '' : 'none';
          };
          if (tipoEl) tipoEl.addEventListener('change', toggle);
          toggle();
        },
        onSave: (v) => {
          const tipo = /^Tiempo determinado/i.test(v.tipo) ? 'det' : /obra/i.test(v.tipo) ? 'obra' : 'indet';
          if (tipo === 'det' && !v.fechaFin) return 'Indica la fecha de vencimiento del contrato a tiempo determinado.';
          if (tipo === 'obra' && !(v.obra || '').trim()) return 'Describe la obra objeto del contrato.';
          construirContrato(emp, tipo, { fechaFin: v.fechaFin, causa: v.causa, obra: v.obra });
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
})();
