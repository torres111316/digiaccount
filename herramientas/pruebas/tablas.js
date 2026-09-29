/* EL MOTOR DE TABLAS, CON UN DOM DE VERDAD
 *
 *   node herramientas/pruebas/tablas.js
 *
 * Las demás pruebas (correr.js) leen el código como texto: sirven para los
 * cálculos, donde el error es un número equivocado. Esto no se puede probar
 * así — es comportamiento de pantalla: filas que se esconden, botones que se
 * pulsan, un observador que se entera de que llegaron datos.
 *
 * POR QUÉ EXISTE
 * En Recibos de venta el pie decía «Mostrando 6 de 218 facturas» y ofrecía
 * «1 2 3 … 22». Eran números escritos a mano en el HTML, de cuando la
 * pantalla era un boceto. Se pulsaba el 2, el 2 se encendía, y la lista no se
 * movía. Parecía que faltaban recibos.
 *
 * Necesita jsdom:  npm install --no-save jsdom
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try { JSDOM = require('jsdom').JSDOM; } catch (e) {
  console.log('Falta jsdom. Instálalo con:  npm install --no-save jsdom');
  process.exit(0);
}

const RAIZ = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(RAIZ, 'assets', 'app.js'), 'utf8');

/* Se toma el motor TAL COMO ESTÁ en app.js: si alguien lo cambia, esto prueba
   el motor nuevo, no una copia que envejece. */
const i = app.indexOf('  (function liveTables() {');
const j = app.indexOf('  // Re-renderiza todas las tablas vivas', i);
if (i < 0 || j < 0) {
  console.error('No encuentro el motor de tablas en app.js. Si lo moviste, actualiza esta prueba.');
  process.exit(2);
}
const MOTOR = app.slice(i, j);

function tabla(filasHtml, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body>'
    + '<div class="data-table-wrap">'
    + '<div class="table-toolbar"><label class="quick-search"><input type="text"></label></div>'
    + '<table class="data-table"><tbody>' + (filasHtml || '') + '</tbody></table>'
    + '<div class="table-footer"><div class="count">' + (opts.count || 'Cargando…') + '</div>'
    + (opts.sinPager ? '' : '<div class="pager"></div>') + '</div>'
    + '</div></body></html>', { pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  w.eval('var drawIcons = function () {};\n' + MOTOR);
  return w;
}

let fallas = 0, total = 0;
function bloque(t) { console.log('\n' + t); }
function ok(q, real, esperado) {
  total++;
  const bien = String(real) === String(esperado);
  if (!bien) fallas++;
  console.log((bien ? '  OK  ' : '  MAL ') + q + ' → ' + real + (bien ? '' : '   (esperado ' + esperado + ')'));
}
function repintar(w) { (w.__liveTables || []).forEach((fn) => fn()); }

const fila = (n) => '<tr><td>fila ' + n + '</td></tr>';
const muchas = (n) => Array.from({ length: n }, (_, k) => fila(k + 1)).join('');
const visibles = (tb) => [...tb.children].filter((r) => r.style.display !== 'none');

/* ── UNA TABLA QUE NACE VACÍA Y SE LLENA DESPUÉS ───────────────────────────

   Éste era el fallo. El motor se daba por vencido si el tbody no tenía filas
   al arrancar. Pero las tablas con datos de verdad —recibos, facturas,
   cuentas— nacen vacías: se llenan segundos después, cuando responde la base.

   Así que justo las tablas con más filas eran las únicas sin paginador. */
bloque('Una tabla que nace vacia y se llena despues');
{
  const w = tabla('');
  const tb = w.document.querySelector('tbody');
  ok('al abrir no muestra nada', visibles(tb).length, 0);

  tb.innerHTML = muchas(50);   // llegan los datos de la base
  repintar(w);

  ok('muestra 20 de las 50', visibles(tb).length, 20);
  ok('el pie dice cuantas hay de verdad',
    /de <strong>50<\/strong>/.test(w.document.querySelector('.count').innerHTML), true);

  const pag = w.document.querySelector('.pager');
  const b2 = [...pag.querySelectorAll('button[data-pg]')].find((b) => b.textContent.trim() === '2');
  ok('hay un boton para la pagina 2', !!b2, true);
  /* Si no lo hay, la prueba ya falló arriba; se sigue igual para que las
     demás comprobaciones se vean, en vez de reventar aquí y esconderlas. */
  if (b2) b2.dispatchEvent(new w.Event('click'));
  ok('la pagina 2 muestra otras 20', visibles(tb).length, 20);
  ok('y empieza donde termino la 1', (visibles(tb)[0] || {}).textContent, 'fila 21');
}

/* ── EL AVISO DE «SIN DATOS» NO ES UNA FILA ───────────────────────────────
   Es una sola celda a todo lo ancho. Contándolo, una tabla sin nada decía
   «Mostrando 1 de 1». */
bloque('El aviso de «sin datos» no es una fila');
{
  const w = tabla('<tr><td colspan="8">Sin datos.</td></tr>');
  repintar(w);
  ok('el pie no dice que hay una', w.document.querySelector('.count').textContent, 'Sin resultados');
  ok('y el aviso sigue a la vista', w.document.querySelector('tbody tr').style.display, '');
}

/* ── UN MÓDULO QUE YA SE PAGINA SOLO ──────────────────────────────────────

   Terceros, el Mayor y Retenciones traen su propio «« Anterior / Siguiente »»
   dentro de la tabla. Si además actuara este motor, la misma lista quedaría
   partida por dos paginadores y ninguno diría la verdad.

   Lo delicado es el ORDEN: el módulo pinta sus filas primero y su paginador
   después. Entre uno y otro la tabla parece normal, y si un repintado cae
   justo ahí se esconden filas que luego nadie vuelve a mostrar. */
bloque('Un modulo que ya se pagina solo');
{
  const w = tabla('');
  const tb = w.document.querySelector('tbody');
  /* MÁS de una página: con 20 justas no se esconde ninguna y esta prueba no
     probaría nada. */
  tb.innerHTML = muchas(50);
  repintar(w);
  ok('el repintado de en medio escondio filas',
    [...tb.children].filter((r) => r.style.display === 'none').length, 30);                                    // el repintado que cae en medio
  /* Se AÑADE la fila del paginador, sin rehacer las demás: así las filas que
     el repintado de arriba escondió siguen escondidas, y se ve si de verdad
     se les devuelve la visibilidad. Rehaciendo el tbody entero no se probaría
     nada — nacerían limpias. */
  const filaPag = w.document.createElement('tr');
  filaPag.innerHTML = '<td colspan="8"><button data-terpag="1">Siguiente »</button></td>';
  tb.appendChild(filaPag);
  repintar(w);
  ok('devuelve las filas que habia escondido',
    [...tb.children].filter((r) => r.style.display === 'none').length, 0);
  ok('y retira su propio paginador', w.document.querySelector('.pager').innerHTML, '');
}

/* ── UN «PAGAR» NO ES UN PAGINADOR ────────────────────────────────────────
   Reconocer el paginador del módulo por el nombre del atributo no sirve:
   `data-soc-pagar` es el botón «Pagar» de una factura y lleva «pagar»
   dentro. Se reconoce por la FORMA — una fila a todo lo ancho con botones. */
bloque('Un boton «Pagar» de una factura no es un paginador');
{
  const w = tabla('');
  const tb = w.document.querySelector('tbody');
  tb.innerHTML = muchas(30).replace('<td>fila 1</td>',
    '<td>fila 1 <button data-soc-pagar="x">Pagar</button></td>');
  repintar(w);
  ok('sigue paginando con normalidad', visibles(tb).length, 20);
}

/* ── CUANDO EL MÓDULO CUELGA SU PAGINADOR DEL CONTADOR ────────────────────
   Cuentas por Cobrar y por Pagar lo meten dentro del pie, que es justo el
   elemento que este motor reescribe. Sin apartarse, cada vez que Tesorería
   repinta sus cuentas le borraría el paginador al instante. */
bloque('Cuando el modulo cuelga su paginador del contador');
{
  const w = tabla('');
  const tb = w.document.querySelector('tbody');
  const cnt = w.document.querySelector('.count');
  tb.innerHTML = muchas(20);
  cnt.innerHTML = '3 con saldo pendiente <button data-cxp-lp="compra">Siguiente »</button>';
  repintar(w);
  ok('no le borra el paginador al modulo', /data-cxp-lp/.test(cnt.innerHTML), true);
  ok('ni le esconde las filas',
    [...tb.children].filter((r) => r.style.display === 'none').length, 0);
}

/* ── LA BÚSQUEDA EN VIVO SIGUE FUNCIONANDO ────────────────────────────── */
bloque('La busqueda en vivo');
{
  const w = tabla('');
  const tb = w.document.querySelector('tbody');
  tb.innerHTML = muchas(50);
  repintar(w);
  const inp = w.document.querySelector('.quick-search input');
  inp.value = 'fila 33';
  inp.dispatchEvent(new w.Event('input'));
  ok('deja solo lo buscado', visibles(tb).length, 1);
  ok('y es lo correcto', (visibles(tb)[0] || {}).textContent, 'fila 33');
}

/* ── SE ENTERA SOLO, SIN QUE NADIE LE AVISE ───────────────────────────────

   Existe `window.refreshTables()` para avisar a mano, pero de los nueve
   módulos solo Contabilidad lo llama — y no se le puede pedir a cada uno que
   se acuerde. Por eso el motor mira el tbody por su cuenta.

   Aquí NO se le da el empujón: se comprueba que se entera solo. */
bloque('Se entera solo de las filas que llegan');
{
  const w = tabla('');
  const tb = w.document.querySelector('tbody');
  tb.innerHTML = muchas(50);   // como hace Ventas al responder la base
  setTimeout(() => {
    ok('se pagino sin que nadie lo llamara', visibles(tb).length, 20);
    ok('y el pie cuenta las 50',
      /de <strong>50<\/strong>/.test(w.document.querySelector('.count').innerHTML), true);
    cerrar();
  }, 80);
}

function cerrar() {
  console.log('\n' + (fallas ? 'HAY ' + fallas + ' FALLA(S) de ' + total : 'TODO OK · ' + total + ' comprobaciones'));
  process.exit(fallas ? 1 : 0);
}
