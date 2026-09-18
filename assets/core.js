/* =========================================================
   DigiAccount ERP — NUCLEO
   Lo que usan TODOS los modulos: fechas, tasas, el dolar de un documento,
   el estado de la sesion y los avisos que deciden si alguien entra o no.

   Vive aparte, y se carga ANTES que app.js, por dos razones:

     · Es lo que mas se consulta y lo que menos cambia. Tenerlo al principio
       de un archivo de veinte mil lineas lo escondia.
     · Es el primer paso para partir app.js: nada se puede separar mientras
       estas funciones vivan dentro del bloque grande.

   Todo se expone en `window.__*` porque asi lo llaman los modulos. Lo demas
   queda privado dentro de este bloque.
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

  /* EL SIGNO DE UN DOCUMENTO EN EL LIBRO FISCAL.

     Una nota de CRÉDITO disminuye lo facturado; una de DÉBITO lo aumenta,
     igual que una factura. Ningún documento se imprime en negativo, así que
     el signo no vive en el monto guardado: vive en el TIPO de documento.

     `montoDoc` devuelve el monto ya con su signo, tomando el valor absoluto
     de lo guardado. Así quien carga transcribe la nota tal como la ve —en
     positivo— y las filas viejas que alguien haya compensado a mano con un
     menos quedan bien igual.

     Vive aquí arriba, suelto y global, porque lo usan los SIETE sitios que
     suman el libro y están repartidos en módulos distintos. Que un octavo
     aparezca mañana y vuelva a decidirlo por su cuenta es justo lo que
     produjo este defecto. */
  window.__signoDoc = function (fila) {
    return String((fila && fila.tipo_doc) || '').trim().toUpperCase() === 'NC' ? -1 : 1;
  };
  window.__montoDoc = function (fila, campo) {
    return Math.abs(Number(fila && fila[campo || 'total']) || 0) * window.__signoDoc(fila);
  };

  /* Los números de nota de un reporte Z, para las columnas «N° N.C.» y
     «N° N.D.» de la tabla de máquina fiscal — que existían en el encabezado
     desde el principio y se pintaban vacías.

     Global, y no dentro del módulo del libro, porque la llaman DOS módulos
     distintos: el que pinta la tabla y el que arma la exportación. La
     primera versión vivía en uno solo y desde el otro habría reventado con
     un ReferenceError al exportar — un error que la sintaxis no delata y
     que solo aparece al recorrer ese camino.

     Trae su propio formateo de número: `fmtF` también es local de cada
     módulo y no se puede tomar prestado. */
  window.__notasZTxt = function (fila, tipo) {
    const bs = (n) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const arr = Array.isArray(fila && fila.notas_z) ? fila.notas_z : [];
    const suyas = arr.filter((x) => ((x && x.t) || 'NC').toUpperCase() === String(tipo || 'NC').toUpperCase());
    if (!suyas.length) return { txt: '', det: '' };
    return {
      txt: suyas.map((x) => x.n).join(', '),
      det: suyas.map((x) => x.n + (x.f ? ' s/factura ' + x.f : '') + ' · Bs ' + bs(Math.abs(Number(x.m) || 0))
        + (Number(x.i) > 0 ? ' (IVA ' + bs(Math.abs(Number(x.i))) + ')' : '')).join('  |  '),
    };
  };

  // Fecha de HOY en formato YYYY-MM-DD (hora LOCAL, para inputs type=date)
  /* Deja cualquier fecha razonable en dd/mm/aa, que es como se guarda.

     Existe por una razon concreta: la macro Excel del SENIAT toma la fecha
     del formato regional de Windows, y en un equipo que no pone el cero a
     la izquierda escribe "9/7/2026" — que el portal rechaza. Aqui NUNCA se
     lee la fecha del sistema operativo: se arma a mano, digito por digito.

     Entiende dd/mm/aa, dd/mm/aaaa y aaaa-mm-dd, con /, - o . de separador.
     Si no la entiende devuelve null, y quien llama decide que hacer — que
     es mejor que devolver algo a medias y que aparezca vacio en un archivo
     que ya se subio. */
  window.__normFecha = function (txt) {
    const p = String(txt || '').trim().split(/[/\-.]/);
    if (p.length !== 3) return null;
    let dd, mm, aa;
    if (p[0].length === 4) { aa = p[0]; mm = p[1]; dd = p[2]; }   // aaaa-mm-dd
    else { dd = p[0]; mm = p[1]; aa = p[2]; }                      // dd/mm/aa(aa)
    if (!/^[0-9]{1,2}$/.test(dd) || !/^[0-9]{1,2}$/.test(mm)) return null;
    if (!/^[0-9]{2}$/.test(aa) && !/^[0-9]{4}$/.test(aa)) return null;
    const d = parseInt(dd, 10), m = parseInt(mm, 10);
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    return String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + aa.slice(-2);
  };

  /* ════════════════════════════════════════════════════════════════════
     LA TASA BCV DE UN MOMENTO

     Un recibo se cotizo con la tasa vigente CUANDO SE EMITIO. Para
     reconstruir su dolar exacto —hoy o dentro de un año— hace falta esa
     tasa, no la de hoy. Se carga el historial una vez (son pocas filas) y
     se busca la ultima fecha valor <= el dia de ese momento en Venezuela.
     Es la misma regla con que la app fija la tasa vigente del dia.

     __tasaUSDEn(momento)  momento = ISO/timestamp, o 'ahora'.
                           Devuelve 0 si no hay con que responder: quien
                           la usa NO inventa una conversion.
     ════════════════════════════════════════════════════════════════════ */
  window.__TASAS_USD = null;
  let _cargaTasasUSD = null;
  window.__cargarTasasUSD = function () {
    if (window.__TASAS_USD) return Promise.resolve(window.__TASAS_USD);
    if (_cargaTasasUSD) return _cargaTasasUSD;
    if (!window.sb || !window.__sbAll) return Promise.resolve(null);
    _cargaTasasUSD = window.__sbAll((q) => q.eq('moneda', 'USD').order('fecha', { ascending: true }), 'tasas_cambio', 'fecha, tasa')
      .then(({ data, error }) => {
        _cargaTasasUSD = null;
        if (error || !data || !data.length) return null;
        window.__TASAS_USD = data.map((r) => ({ f: String(r.fecha).slice(0, 10), t: parseFloat(r.tasa) }))
          .filter((r) => r.t > 0).sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
        return window.__TASAS_USD;
      })
      .catch(() => { _cargaTasasUSD = null; return null; });
    return _cargaTasasUSD;
  };
  window.__tasaUSDEn = function (momento) {
    const lista = window.__TASAS_USD;
    if (!lista || !lista.length || !momento) return 0;
    const d = momento === 'ahora' ? new Date() : new Date(momento);
    if (isNaN(d.getTime())) return 0;
    const dia = d.toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
    let lo = 0, hi = lista.length - 1, r = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (lista[m].f <= dia) { r = lista[m].t; lo = m + 1; } else hi = m - 1;
    }
    return r;
  };

  /* ════════════════════════════════════════════════════════════════════
     EL DOLAR DE UN DOCUMENTO — un solo calculo para toda la app

     Primero lo GUARDADO: si el documento se escribio en dolares, ese numero
     es el bueno y no se recalcula nunca. 10 $ son 10 $ el año que viene.

     Solo si no lo tiene —los documentos anteriores a esta columna— se
     reconstruye con la tasa de SU fecha, que es lo unico honesto que se
     puede hacer con ellos.

     La fecha que manda depende del documento:
       venta   · el momento en que se EMITIO (ahi se cotizo el precio)
       compra  · la FECHA DE SU FACTURA, que puede ser de hace meses

     Escrito dos veces, esto ya discrepo: una pantalla mostraba 74,50 $ y
     otra 65,27 $ del mismo documento.
     ════════════════════════════════════════════════════════════════════ */
  window.__tasaDocFecha = function (doc) {
    if (!doc) return 0;
    const en = (x) => ((window.__tasaUSDEn && window.__tasaUSDEn(x)) || 0);
    if (doc.tipo === 'venta' && (doc.emitida || doc.emitida_en)) return en(doc.emitida || doc.emitida_en);
    const iso = window.__fechaISO12 ? window.__fechaISO12(doc.fecha) : '';
    if (!iso) return doc.emitida ? en(doc.emitida) : 0;
    return en(iso);
  };
  /* LA FECHA DE UN FORMULARIO, EN UN FORMATO QUE ENTIENDA LA TASA.

     Registrar usa un campo de fecha (aaaa-mm-dd) y EDITAR uno de texto
     (dd/mm/aa). Solo se contemplaba el primero: al editar, la fecha no se
     entendia, no habia tasa, y el guardado se negaba con «no tengo la tasa
     del BCV para la fecha de esa factura» sin que hubiera nada que corregir.

     El mediodia evita el otro clasico: 'aaaa-mm-dd' a secas se lee como
     medianoche UTC, que en Venezuela es el dia anterior. */
  window.__fechaISO12 = function (txt) {
    const t = String(txt || '').trim();
    if (!t) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t + 'T12:00:00';
    const p = t.split('/');
    if (p.length === 3) {
      const aa = p[2].length === 2 ? '20' + p[2] : p[2];
      return aa + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0') + 'T12:00:00';
    }
    return '';
  };

  window.__usdDoc = function (doc) {
    if (!doc) return 0;
    const guardado = Number(doc.total_usd != null ? doc.total_usd : doc.usd) || 0;
    if (guardado > 0) return guardado;                      // se escribio en dolares
    const bs = Number(doc.total) || 0;
    const tasa = Number(doc.tasa) || window.__tasaDocFecha(doc);
    return tasa > 0 ? Math.round((bs / tasa) * 100) / 100 : 0;
  };

  /* ════════════════════════════════════════════════════════════════════
     PERIODO CERRADO: SE AVISA, NO SE IMPIDE

     Antes esto era un muro: un registro de un periodo declarado no se podia
     editar, ni anular, ni eliminar. Y los errores aparecen justo ahi —una
     fecha mal puesta se descubre al revisar lo declarado—, asi que el
     sistema terminaba impidiendo lo unico que quedaba por hacer.

     Ahora se dice lo que esta en juego y decide quien lleva la
     contabilidad. Devuelve true si se puede seguir.
     ════════════════════════════════════════════════════════════════════ */
  window.__confirmarPeriodoCerrado = function (periodo, accion) {
    if (!window.__periodoCerrado || !window.__periodoCerrado(periodo)) return true;
    return window.confirm([
      'El período ' + periodo + ' está CERRADO: ya fue declarado.',
      '',
      (accion || 'Vas a modificar un registro de ese período') + '.',
      '',
      'Si sigues, lo declarado y lo registrado dejan de coincidir. Tendrás que',
      'sustituir la declaración, o reabrir el período y volver a cerrarlo.',
      '',
      '¿Continuar?',
    ].join('\n'));
  };

  /* EL AVISO DE POR QUE NO SE PUDO ENTRAR.

     Vive aqui, suelto, para poder probarlo sin pantalla: es el mensaje que
     decide si alguien vuelve a escribir su clave o llama por telefono. */
  window.__avisoLogin = function (error) {
    const msg = String((error && error.message) || '');
    const cod = Number((error && error.status) || 0);
    if (/invalid login credentials/i.test(msg)) {
      return 'Correo o contraseña incorrectos. Revisa el correo y vuelve a escribir la clave.';
    }
    if (/email not confirmed/i.test(msg)) {
      return 'Tu correo aún no está confirmado. Busca el mensaje de confirmación en tu bandeja (revisa también el correo no deseado).';
    }
    if (cod === 429 || /rate limit|too many/i.test(msg)) {
      return 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentar: tu clave puede estar bien.';
    }
    if ((error && error.__red) || cod === 0 || /fetch|network|timeout|failed|load/i.test(msg)) {
      return 'No pude conectar con el servidor. Revisa tu conexión y vuelve a intentar — no es tu contraseña.';
    }
    return 'No se pudo entrar (' + (cod || 'error') + '): ' + msg;
  };

  window.__hoyISO = function () {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
})();
