/* PRUEBAS DE LO QUE TOCA DINERO E IMPUESTOS
 *
 *   node herramientas/pruebas/correr.js
 *
 * Corre en segundos, sin red y sin base de datos: las tasas del BCV que usan
 * las pruebas están congeladas en `tasas.json`. Si una prueba falla, el
 * comando termina con error — sirve para correrlo antes de cada Deploy.
 *
 * POR QUÉ ESTAS Y NO OTRAS
 * Son los cálculos donde un error no se ve: no revientan la pantalla, dan un
 * número equivocado. Un dólar que se mueve, un saldo que cobra de más, un
 * comprobante con el mes cambiado, una fecha que el portal rebota. Todos los
 * que están aquí aparecieron de verdad, en datos de clientes reales.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
/* Se busca en el nucleo y en la app: al partir el archivo, cada funcion
   puede estar en cualquiera de los dos y la prueba no tiene por que saberlo. */
const leer = (f) => { try { return fs.readFileSync(path.join(RAIZ, 'assets', f), 'utf8'); } catch (e) { return ''; } };
const app = ['core.js', 'app.js', 'retenciones.js', 'tesoreria.js', 'facturas.js', 'nomina.js'].map(leer).join(String.fromCharCode(10));

/* Se toma el código TAL COMO ESTÁ en app.js: si alguien cambia el cálculo,
   estas pruebas prueban el cálculo nuevo, no una copia que envejece. */
function tramo(desde, hasta) {
  const i = app.indexOf(desde);
  const j = app.indexOf(hasta, i);
  if (i < 0 || j < 0) {
    console.error('No encuentro en app.js el tramo que empieza con:\n  ' + desde);
    console.error('Si moviste ese código, actualiza esta prueba.');
    process.exit(2);
  }
  return app.slice(i, j);
}

global.window = {};
eval(tramo('  window.__TASAS_USD = null;', '  window.__hoyISO = function () {'));
eval(tramo('    function revisarCompIva(comp, fechaISO) {', '    /* El correlativo del comprobante de retención de ISLR.'));

window.__TASAS_USD = JSON.parse(fs.readFileSync(path.join(__dirname, 'tasas.json'), 'utf8'))
  .map((r) => ({ f: r.fecha, t: parseFloat(r.tasa) }))
  .sort((a, b) => (a.f < b.f ? -1 : 1));

let fallas = 0, total = 0, grupo = '';
const bloque = (t) => { grupo = t; console.log('\n' + t); };
function ok(nombre, real, esperado) {
  total += 1;
  const bien = String(real) === String(esperado);
  if (!bien) fallas += 1;
  console.log('  ' + (bien ? 'OK  ' : 'MAL ') + nombre + ' → ' + real + (bien ? '' : '   (esperado ' + esperado + ')'));
}

// ── El dólar de un documento ────────────────────────────────────────────────
bloque('El dólar de un documento (window.__usdDoc)');
ok('lo GUARDADO manda sobre cualquier tasa',
  window.__usdDoc({ tipo: 'compra', total: 999999, total_usd: 74.5, fecha: '15/09/26' }), 74.5);
ok('compra sin dólar guardado: tasa de la fecha de su factura',
  window.__usdDoc({ tipo: 'compra', total: 54972.18, fecha: '24/07/26' }), 74.5);
ok('compra con su tasa guardada',
  window.__usdDoc({ tipo: 'compra', total: 51517.45, tasa: 746.6297, fecha: '12/08/26' }), 69);
ok('venta: manda el momento en que se emitió',
  window.__usdDoc({ tipo: 'venta', total: 41624.38, emitida: '2026-09-12T15:36:11Z' }), 50);
ok('sin fecha ni tasa devuelve 0, no inventa',
  window.__usdDoc({ tipo: 'compra', total: 1000, fecha: 'no es fecha' }), 0);

// ── La tasa del BCV ─────────────────────────────────────────────────────────
bloque('La tasa del BCV de un momento (window.__tasaUSDEn)');
ok('un día sin publicación toma la última anterior',
  window.__tasaUSDEn('2026-09-13T12:00:00'), 832.4883);
ok('antes del primer registro no hay tasa',
  window.__tasaUSDEn('2024-05-01T12:00:00'), 0);
ok('una fecha inválida no revienta', window.__tasaUSDEn('cualquier cosa'), 0);

// ── Las dos formas de escribir una fecha ────────────────────────────────────
bloque('Las fechas de los formularios (window.__fechaISO12)');
ok('texto del formulario de editar', window.__fechaISO12('26/08/26'), '2026-08-26T12:00:00');
ok('campo de fecha del de registrar', window.__fechaISO12('2026-08-26'), '2026-08-26T12:00:00');
ok('con año de cuatro cifras', window.__fechaISO12('26/08/2026'), '2026-08-26T12:00:00');
ok('vacío no produce basura', window.__fechaISO12(''), '');

// ── El comprobante de retención de IVA ──────────────────────────────────────
bloque('El comprobante de retención de IVA (revisarCompIva)');
ok('14 dígitos y su período', revisarCompIva('20260900000121', '2026-09-07').valor, '20260900000121');
ok('el período sale del comprobante',
  revisarCompIva('20260900000121', '2026-09-07').anio + '-' + revisarCompIva('20260900000121', '2026-09-07').mes, '2026-09');
ok('13 dígitos: lo rechaza', /14 dígitos/.test(revisarCompIva('2026090000012', '2026-09-07').error || ''), 'true');
ok('mes 13: lo rechaza', /del 01 al 12/.test(revisarCompIva('20261300000121', '2026-09-07').error || ''), 'true');
ok('con letras: lo rechaza', /solo números/.test(revisarCompIva('A0260900000121', '2026-09-07').error || ''), 'true');
ok('mes distinto al de la fecha: avisa',
  /dice 08\/2026/.test(revisarCompIva('20260800000121', '2026-09-07').aviso || ''), 'true');
ok('limpia guiones y espacios', revisarCompIva('2026-09 00000121', '2026-09-07').valor, '20260900000121');

// ── El aviso al entrar ──────────────────────────────────────────────────────
bloque('Por qué no se pudo entrar (window.__avisoLogin)');
eval(tramo('  window.__avisoLogin = function (error) {', '  window.__hoyISO = function () {'));
ok('clave mala lo dice',
  /Correo o contraseña incorrectos/.test(window.__avisoLogin({ message: 'Invalid login credentials', status: 400 })), 'true');
ok('sin conexión NO culpa a la contraseña',
  /no es tu contraseña/.test(window.__avisoLogin({ message: 'Failed to fetch', status: 0 })), 'true');
ok('demasiados intentos lo dice',
  /Demasiados intentos/.test(window.__avisoLogin({ message: 'rate limit', status: 429 })), 'true');

// ── El ciclo de cobro ───────────────────────────────────────────────────────
bloque('El ciclo de cobro del Panel del Fundador');
/* `const` dentro de un eval no sale de ahí: se envuelve y se devuelve lo que
   hace falta probar. */
const sumarMeses = eval('(function () {'
  + tramo('      const hoyISO = () => new Date().toLocaleDateString', '      const situacion = c.exenta')
  + ' return sumarMeses; })()');
ok('un mes normal', sumarMeses('2026-09-15', 1), '2026-10-15');
ok('un año (ciclo anual)', sumarMeses('2026-09-15', 12), '2027-09-15');
ok('31 de enero + 1 mes = fin de febrero', sumarMeses('2026-01-31', 1), '2026-02-28');
ok('31 de mayo + 1 mes = 30 de junio', sumarMeses('2026-05-31', 1), '2026-06-30');
ok('29 de febrero bisiesto + 12 meses', sumarMeses('2028-02-29', 12), '2029-02-28');

console.log('\n' + (fallas ? 'HAY ' + fallas + ' FALLA(S) de ' + total : 'TODO OK · ' + total + ' comprobaciones'));
process.exit(fallas ? 1 : 0);
