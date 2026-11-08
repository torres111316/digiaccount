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
const app = ['core.js', 'app.js', 'retenciones.js', 'tesoreria.js', 'facturas.js', 'contabilidad.js', 'inventario.js', 'terceros.js', 'nomina.js', 'importador.js', 'conciliacion.js'].map(leer).join(String.fromCharCode(10));

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
  + tramo('    const hoyCaracas = () => new Date().toLocaleDateString', '    /* El pago que el cliente REPORT')
  + ' return masMeses; })()');
ok('un mes normal', sumarMeses('2026-09-15', 1), '2026-10-15');
ok('un año (ciclo anual)', sumarMeses('2026-09-15', 12), '2027-09-15');
ok('31 de enero + 1 mes = fin de febrero', sumarMeses('2026-01-31', 1), '2026-02-28');
ok('31 de mayo + 1 mes = 30 de junio', sumarMeses('2026-05-31', 1), '2026-06-30');
ok('29 de febrero bisiesto + 12 meses', sumarMeses('2028-02-29', 12), '2029-02-28');


/* ── QUE LA APP NO DEPENDA DE INTERNET PARA ABRIR ────────────────────────────

   Esta no prueba un calculo: prueba que no se nos cuele otra vez lo que dejo
   a Luis sin poder abrir la app desde el telefono.

   La libreria de Supabase se cargaba de jsDelivr. Un <script> de otro dominio
   es BLOQUEANTE: si no llega, ninguno de los de abajo se ejecuta y la pagina
   se queda en blanco. Y el service worker no lo puede guardar, porque solo
   cachea respuestas de este mismo dominio — asi que se pedia por internet en
   CADA apertura, para siempre.

   En el escritorio fallaba «a veces». En el telefono, nunca abria. */
bloque('La app abre sin depender de internet');
const _index = (() => { try { return fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'); } catch (e) { return ''; } })();

ok('el index se pudo leer', _index.length > 0, true);
ok('ningun <script> viene de otro dominio',
  /<script[^>]+src\s*=\s*["']https?:/i.test(_index), false);
ok('ninguna hoja de estilos viene de otro dominio',
  /<link[^>]+rel=["']stylesheet["'][^>]+href\s*=\s*["']https?:/i.test(_index), false);

/* Y que la libreria este de verdad ahi, y se valga sola. */
const _lib = (() => { try { return fs.readFileSync(path.join(RAIZ, 'assets', 'vendor', 'supabase.js'), 'utf8'); } catch (e) { return ''; } })();
ok('la libreria de Supabase esta en el proyecto', _lib.length > 1000, true);
ok('y no se trae nada de internet', /from\s*["']https?:|import\(\s*["']https?:/.test(_lib), false);

/* Y que el service worker la guarde: si no esta en su lista, la primera
   apertura sin red se queda igual de colgada que antes. */
const _sw = (() => { try { return fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8'); } catch (e) { return ''; } })();
ok('el service worker la guarda', _sw.indexOf('assets/vendor/supabase.js') >= 0, true);

/* Y que espere a la red con LIMITE. Sin esto, una peticion que no falla pero
   tampoco contesta deja la app esperando para siempre. */
ok('la espera a la red tiene limite', /ESPERA_RED/.test(_sw), true);

/* Todos los archivos que el index carga tienen que estar en la lista del
   service worker. Uno que falte arranca la app a medias sin red — y eso no se
   descubre hasta el peor momento. */
const _pedidos = [];
_index.replace(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi, (m, u) => { _pedidos.push(u); return m; });
_index.replace(/<link[^>]+rel=["']stylesheet["'][^>]+href\s*=\s*["']([^"']+)["']/gi, (m, u) => { _pedidos.push(u); return m; });
_pedidos.filter((u) => !/^https?:/i.test(u)).forEach((u) => {
  const limpio = u.split('?')[0].replace(/^\.?\//, '');
  ok('el sw guarda ' + limpio, _sw.indexOf(limpio) >= 0, true);
});



/* ── ENTRAR TIENE QUE LLEVAR A ALGUNA PARTE ──────────────────────────────────

   Esta tampoco prueba un calculo. Prueba que el login haga algo DESPUES de
   entrar bien.

   Paso: al quitar un saludo por nombre que leia una variable muerta, se fue
   con el el `window.location.reload()` que estaba entre esas lineas. El login
   seguia funcionando —la sesion quedaba puesta— pero la pantalla se quedaba
   en la de entrar. Luis lo vivio asi: «entro, no me deja; cierro la app,
   vuelvo a abrir y ya estoy dentro».

   Y el comentario que explicaba la recarga se quedo ahi, hablando de algo que
   ya no ocurria. Un comentario que describe lo que el codigo NO hace es peor
   que no tener ninguno: se lee, se cree, y nadie vuelve a mirar. Por eso esta
   prueba mira el CODIGO y tira los comentarios antes de mirar. */
bloque('Entrar lleva a alguna parte');
var _iLogin = app.indexOf('signInWithPassword');
var _jLogin = _iLogin < 0 ? -1 : app.indexOf('auth-sso', _iLogin);
var _login = _iLogin < 0 ? '' : app.slice(_iLogin, _jLogin > 0 ? _jLogin : _iLogin + 3000);

var _sinComent = _login
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

ok('se encontro el login', _login.length > 0, true);
ok('despues de entrar, la app va a alguna parte',
  /location\.reload\(|location\.replace\(/.test(_sinComent), true);



/* ── CERRAR SESION TIENE QUE CERRARLA DE VERDAD ──────────────────────────────

   Luis: «cierro sesion y vuelve a ingresar sin pedirme el correo y la clave».
   En un equipo compartido eso significa que el siguiente entra en la cuenta
   del anterior.

   LA CAUSA, comprobada leyendo la libreria: `signOut()` NO LANZA el error, lo
   DEVUELVE. Resuelve con { error } en casi todos sus caminos de fallo — y uno
   de ellos sale sin borrar la sesion local. El codigo viejo hacia

       try { await window.sb.auth.signOut(); } catch (e) {}

   en cinco sitios. El catch no atrapaba nada porque no habia nada que
   atrapar, y el resultado se tiraba a la basura. Fallaba en silencio.

   Estas pruebas cuidan las tres cosas que lo arreglan: que haya UN solo sitio
   que cierre sesion, que ese sitio MIRE lo que devuelve, y que COMPRUEBE que
   de verdad quedo cerrada en vez de suponerlo. */
bloque('Cerrar sesion cierra de verdad');

var _core = (function () { try { return fs.readFileSync(path.join(RAIZ, 'assets', 'core.js'), 'utf8'); } catch (e) { return ''; } })();
var _modulos = ['app.js', 'retenciones.js', 'tesoreria.js', 'facturas.js',
                'contabilidad.js', 'inventario.js', 'terceros.js', 'nomina.js', 'importador.js'];

ok('core.js se pudo leer', _core.length > 0, true);
ok('hay UNA funcion que cierra sesion', /__cerrarSesionSegura\s*=/.test(_core), true);

/* Nadie mas llama a signOut: si vuelve a haber copias, vuelve el catch vacio.
   Se tiran los comentarios antes de mirar. */
var _sueltos = _modulos.filter(function (f) {
  var t = (function () { try { return fs.readFileSync(path.join(RAIZ, 'assets', f), 'utf8'); } catch (e) { return ''; } })();
  t = t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  return /auth\.signOut\s*\(/.test(t);
});
ok('ningun modulo llama a signOut por su cuenta', _sueltos.join(', ') || 'ninguno', 'ninguno');

var _fn = (function () {
  var i = _core.indexOf('__cerrarSesionSegura');
  if (i < 0) return '';
  var j = _core.indexOf('window.__drawIcons', i);
  return _core.slice(i, j > 0 ? j : i + 3000);
})().replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

/* Lo que estaba mal: el error se DEVUELVE, no se lanza. Hay que leerlo. */
ok('mira el error que DEVUELVE signOut', /\.error/.test(_fn), true);
/* Y no confia: vuelve a preguntar si quedo sesion. */
ok('comprueba que de verdad quedo cerrada', /getSession\s*\(/.test(_fn), true);
/* Y si quedo, cierra en local — que no necesita red y es lo que protege el
   aparato que uno tiene delante. */
ok('tiene el respaldo local', /scope:\s*['"]local['"]/.test(_fn), true);
/* Y el ultimo recurso: borrar la llave del token a mano. */
ok('borra la llave del token si hace falta', /auth-token/.test(_fn), true);



/* ── SOLO SE ENTRA CON SESION ────────────────────────────────────────────────

   Habia un boton «Continuar con Google» que era un maniqui del prototipo:
   hacia `showApp()` y nada mas. Es decir, pintaba la app SIN autenticar a
   nadie, desde la pantalla de entrar.

   En un prototipo es una maqueta. En produccion es una puerta abierta.

   Lo encontro Luis: tocaba el campo del correo para elegirlo de los guardados
   por Chrome y la app entraba antes de que el pulsara «Entrar» — la hoja del
   selector se cierra y el toque cae en el boton que estaba justo debajo.

   `showApp()` solo pinta la app. Quien decide que alguien puede entrar es la
   comprobacion de sesion, y por eso tiene que haber UNA sola llamada: la que
   esta dentro de esa comprobacion. */
bloque('Solo se entra con sesion');

var _indexH = (function () { try { return fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'); } catch (e) { return ''; } })();
ok('no hay boton de acceso sin clave en el HTML', /auth-sso/.test(_indexH), false);

/* Se cuentan las LLAMADAS, no la definicion ni los comentarios. */
var _appSinComent = app
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
var _llamadas = (_appSinComent.match(/(^|[^\w.])showApp\s*\(\s*\)/g) || []).length;
var _defs = (_appSinComent.match(/function\s+showApp\s*\(/g) || []).length;

ok('showApp esta definida una vez', _defs, 1);
/* La definicion tambien calza el patron —lleva `function` delante pero el
   espacio cuenta— asi que se resta. */
ok('y solo se llama desde UN sitio', _llamadas - _defs, 1);

/* Y ese sitio tiene que estar despues de comprobar la sesion. */
var _iSesion = _appSinComent.indexOf('auth.getSession()');
var _iShow = _appSinComent.search(/(^|[^\w.])showApp\s*\(\s*\)/m);
ok('y ese sitio va despues de comprobar la sesion',
  _iSesion > 0 && _iShow > _iSesion, true);



/* ── NO SE ENTRA SIN QUE LO PIDA LA PERSONA ──────────────────────────────────

   Chrome en Android, al elegir una credencial guardada, rellena los campos y
   ENVIA el formulario. Y no lo envia por detras: PULSA EL BOTON de enviar.

   Se intento primero mirar quien provocaba el envio (`e.submitter`) y no
   sirvio — desde el codigo ese clic es indistinguible del de la persona. Luis
   lo comprobo: con la guardia puesta y desplegada, las dos cuentas seguian
   entrando solas.

   Lo que si funciona es estructural: SIN <form> no hay envio que interceptar
   ni boton de enviar que el navegador pueda pulsar. Rellenar sigue
   funcionando; entrar lo decide quien pulsa «Entrar».

   En una app con la contabilidad de los clientes, entrar sin que nadie lo
   pida significa que el telefono desbloqueado sobre una mesa la abre. */
bloque('No se entra sin que lo pida la persona');

var _indexLogin = (function () {
  var h = (function () { try { return fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'); } catch (e) { return ''; } })();
  var i = h.indexOf('id="loginForm"');
  if (i < 0) return '';
  return h.slice(Math.max(0, i - 400), i + 1200);
})();

ok('se encontro la pantalla de entrar', _indexLogin.length > 0, true);
/* Lo que importa: que el contenedor NO sea un formulario. */
ok('la pantalla de entrar no es un <form>',
  /<form[^>]*id="loginForm"/.test(_indexLogin), false);
/* Y que el boton no sea de envio, que es lo que el navegador pulsa. */
ok('el boton de Entrar no es de envio',
  /<button[^>]*type="submit"[^>]*class="auth-submit"/.test(_indexLogin), false);

var _appSC = app.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
/* Nadie escucha `submit` en el login: si vuelve a haber uno, vuelve el
   problema. */
ok('nadie escucha el envio del login',
  /loginForm'\s*\)\s*\.addEventListener\s*\(\s*'submit'/.test(_appSC), false);
/* Y entrar NO cuelga de un `click`: un clic lo fabrica el navegador. Cuelga
   del PUNTERO, que solo lo produce un dedo o un raton. */
ok('entrar no cuelga de un clic',
  /_btnEntrarLogin\.addEventListener\(\s*.click./.test(_appSC), false);
ok('entrar cuelga del puntero',
  /pointerup/.test(_appSC), true);
ok('y el teclado tambien puede entrar',
  /key === .Enter./.test(_appSC), true);
/* Y el toque que se cuela al cerrarse la hoja del navegador no entra: llega
   en el mismo instante del relleno, y eso SI se puede distinguir. */
ok('un toque inmediato tras rellenar no entra',
  /_vieneDeUnRelleno\(\)/.test(_appSC), true);

/* La regla de que es relleno y que es escritura, con numeros.
   Escribir mete un caracter por vez; rellenar mete el valor de un golpe. */
var esRelleno = function (antes, ahora) {
  return Math.abs((ahora || '').length - (antes || '').length) > 2;
};
ok('escribir una letra no es relleno', esRelleno('micorre', 'micorreo'), false);
ok('borrar una letra tampoco', esRelleno('micorreo', 'micorre'), false);
ok('el correo entero de golpe SI', esRelleno('', 'torres111316@gmail.com'), true);
ok('la clave entera de golpe SI', esRelleno('', 'ClaveLarga123'), true);
ok('dos letras de golpe no', esRelleno('ab', 'abcd'), false);


/* -- EL PRODUCTO NUEVO DENTRO DE UNA COMPRA ---------------------------------

   Registrando una compra, Luis llego a un producto que no estaba en la lista
   del inventario. El campo parece un selector de lo que ya hay, asi que dio
   por hecho que no se lo iba a aceptar y CANCELO la compra -- con varias
   lineas ya cargadas. Perdio el trabajo.

   Lo amargo es que el sistema SIEMPRE dio de alta el producto que no existia.
   Solo que no lo decia en ninguna parte. Una funcion que no se ve no existe.

   Se prueba que la fila avisa en que situacion esta, y --lo que de verdad
   puede romperse en silencio-- que la clase con la que se crea cada fila sea
   la MISMA que el bucle de guardado busca. Si dejan de calzar, la compra se
   guarda y el inventario no se mueve, sin un solo error en pantalla. */
bloque('Un producto que no existe se puede registrar desde la compra');

var _appCompra = (function () {
  var i = app.indexOf('invBox.innerHTML');
  var j = app.indexOf('if (window.cargarProductos) window.cargarProductos();', i);
  return (i < 0 || j < 0) ? '' : app.slice(i, j);
})();

ok('se encontro el cuadro de inventario de la compra', _appCompra.length > 0, true);

/* La fila dice si el producto ya esta o si es nuevo. */
ok('la fila avisa cuando el producto ya existe',
  /Ya est.\s*en inventario/.test(_appCompra), true);
ok('la fila avisa cuando el producto es nuevo',
  /Producto nuevo/.test(_appCompra), true);

/* Y deja completarlo ahi mismo, para que no nazca con precio CERO. */
ok('deja ponerle precio de venta al producto nuevo',
  /ic-precio/.test(_appCompra), true);
ok('el precio escrito llega al alta del producto',
  /precio:\s*li\.precio/.test(_appCompra), true);
ok('la categoria escrita llega al alta del producto',
  /categoria:\s*li\.categoria/.test(_appCompra), true);

/* LA COMPROBACION QUE IMPORTA: que lo que se crea y lo que se lee sean lo
   mismo. Se saca la clase de la fila y el selector del bucle, del codigo. */
var _claseFila = (_appCompra.match(/it\.className\s*=\s*'([\w-]+)'/) || [])[1] || '';
var _selBucle = (_appCompra.match(/invBox\.querySelectorAll\('\.([\w-]+)'\)/) || [])[1] || '';
ok('se leyo la clase con la que nace cada fila', _claseFila.length > 0, true);
ok('el guardado busca exactamente esa clase', _selBucle, _claseFila);


/* -- F2: CREAR LO QUE FALTA SIN SALIR DE DONDE ESTAS ------------------------

   En los libros, F2 abre la ficha del tercero que falta sin cerrar el
   formulario. Exigia escribir el nombre primero: quien llega con la factura
   en la mano y sabe que el tercero no existe tenia que teclear el nombre en
   un campo donde no iba a encontrar nada, solo para que lo dejaran seguir.

   Y en la linea de inventario de una compra, F2 no existia. Faltaba un
   producto y tocaba cancelar la compra entera.

   Lo que aqui se cuida, y no se ve en pantalla: la ficha de producto NO
   puede vivir en el modal generico, porque el formulario de compra ES ese
   modal — abrirla ahi borraria la compra a medio cargar, que es exactamente
   el problema que viene a resolver. */
bloque('F2 crea lo que falta sin perder el trabajo');

var _idx = (function () { try { return fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8'); } catch (e) { return ''; } })();

/* El F2 de los libros ya no pide escribir nada primero. */
ok('F2 no exige escribir el nombre antes',
  /Escribe el nombre antes de crearlo con F2/.test(app), false);

/* La ficha de producto tiene contenedor PROPIO, no el modal generico. */
ok('la ficha de producto tiene su propio contenedor',
  /id="prodRapidoModal"/.test(_idx), true);
ok('y no reusa el modal del formulario de compra',
  /prodRapidoModal[\s\S]{0,400}id="fmBody"/.test(_idx), false);

var _css = (function () { try { return fs.readFileSync(path.join(RAIZ, 'assets', 'app.css'), 'utf8'); } catch (e) { return ''; } })();
/* Y se abre POR ENCIMA: mismo overlay, un escalon mas de z-index. */
var _zBase = Number((_css.match(/\.form-modal-overlay\s*\{[^}]*z-index:\s*(\d+)/) || [])[1] || 0);
var _zProd = Number((_css.match(/\.prod-rapido-overlay\s*\{[^}]*z-index:\s*(\d+)/) || [])[1] || 0);
ok('la ficha de producto se pinta encima del formulario', _zProd > _zBase, true);

/* El Escape del formulario de fondo no se adelanta al de la ficha. */
ok('el formulario de fondo cede las teclas a la ficha',
  /prodRapidoModal'\);\s*[\r\n]+\s*if \(prodOverlay && !prodOverlay\.hidden\) return;/.test(app), true);

/* F2 en la linea de inventario, y con el campo vacio tambien. */
ok('la linea de inventario escucha F2',
  /ev\.key !== 'F2'/.test(_appCompra), true);
ok('y abre la ficha de producto', /__nuevoProductoRapido/.test(_appCompra), true);

/* EL SILENCIO QUE SE EVITA: el producto vuelve con `id` o no vuelve.
   Al guardar la compra el stock se suma con .eq('id', pr.id); sin id esa
   llamada no encuentra nada, NO da error, y el inventario no se mueve. */
ok('la ficha no devuelve un producto sin id',
  /if \(!creado \|\| !creado\.id\)/.test(app), true);

/* Y no nace con la existencia contada dos veces: la pone la compra. */
ok('la ficha no toca el stock (lo pone la compra)',
  /stock: 0, stock_min: 0, costo: 0,/.test(app), true);


/* -- DOS RECIBOS DE NOMINA EN UNA HOJA CARTA --------------------------------

   El trabajador se lleva el original y la empresa se queda con la copia
   firmada como recibido. Antes salia una hoja por copia: dos hojas por
   trabajador, todas las semanas.

   Y aparte: con Ctrl+P el recibo salia repartido en varias hojas, mientras
   que el boton «Imprimir» lo sacaba bien. La preparacion vivia dentro del
   clic, asi que el atajo no pasaba por ella. */
bloque('Dos recibos de nomina en una hoja');

var _nom = (function () { try { return fs.readFileSync(path.join(RAIZ, 'assets', 'nomina.js'), 'utf8'); } catch (e) { return ''; } })();
var _css = (function () { try { return fs.readFileSync(path.join(RAIZ, 'assets', 'app.css'), 'utf8'); } catch (e) { return ''; } })();

/* Ctrl+P y el boton hacen lo mismo porque pasan por el mismo sitio. */
ok('la preparacion cuelga de beforeprint',
  /addEventListener\('beforeprint',\s*prepararImpresion\)/.test(_nom), true);
ok('y el boton llama a esa misma preparacion',
  /prepararImpresion\(\);\s*[\r\n]+\s*window\.print\(\)/.test(_nom), true);

/* LO QUE SE VE ES LO QUE SE IMPRIME.

   Antes la vista previa enseñaba un recibo suelto y la pareja se armaba
   aparte, al imprimir. Funcionaba, pero eran dos sitios distintos haciendo lo
   mismo: el dia que uno cambie y el otro no, lo que sale por la impresora
   deja de parecerse a lo que se vio — y nadie lo nota hasta tener el papel en
   la mano.

   Ahora la pareja se monta en pantalla y al imprimir se clona ESE contenedor.
   No pueden diferenciarse porque no hay dos. */
ok('se imprime clonando la hoja que se ve',
  /const hoja = document\.getElementById\('reciboHoja'\);\s*[\r\n]+\s*const clon = hoja\.cloneNode\(true\)/.test(_nom), true);
ok('y el clon no se lleva los id (quedarian repetidos)',
  /clon\.querySelectorAll\('\[id\]'\)\.forEach/.test(_nom), true);

/* EN PANTALLA, UN RECIBO; LA PAREJA SOLO EN EL PAPEL.

   Se probo montar las dos copias tambien en pantalla y se veia mal. Ahora la
   pantalla no se toca y la pareja se arma sobre el CLON que va al lienzo de
   impresion — a partir del mismo recibo que se ve, asi que siguen sin poder
   decir cosas distintas. */
ok('la pareja se arma sobre el clon de impresion',
  /if \(chkDos && chkDos\.checked\) armarParaImprimir\(clon\);/.test(_nom), true);
ok('y ya nada monta la pareja en pantalla', /pintarHoja/.test(_nom), false);

/* LAS DOS MITADES, IDENTICAS.

   El texto legal completo no cabe en media hoja. La primera version lo
   acortaba en la COPIA… dejando al original con el parrafo entero, o sea la
   mitad de arriba mas alta que la de abajo y perdiendo las firmas por el
   recorte. Se vio en el navegador, no razonandolo.

   Ahora los dos textos van escritos en el recibo y manda el CSS. Nadie tiene
   que acordarse de acortar nada, y desmarcar la casilla lo devuelve solo. */
ok('el recibo trae tambien su texto legal de una linea',
  /class="recibo-legal-corto"/.test(_nom), true);
ok('y nadie reescribe el texto legal a mano',
  /legal\.textContent\s*=/.test(_nom), false);
ok('el CSS enseña el corto y esconde el largo',
  /\.recibo-par \.recibo-legal \{ display: none; \}/.test(_css) || /recibo-par \.recibo-legal \{[^}]*display:\s*none/.test(_css), true);


/* LA CUENTA DE LA HOJA, CON LOS MILIMETROS DEL CSS.

   Carta son 279,4mm. Menos los margenes del @page, eso es lo imprimible. Si
   las dos mitades mas la raya de corte no caben ahi, la segunda copia se va a
   una segunda hoja y se acabo la idea. */
var _mm = function (re) { var m = _css.match(re); return m ? parseFloat(m[1]) : NaN; };
var _margen = _mm(/@page reciboPar \{[^}]*margin:\s*([\d.]+)mm/);
var _mitad = _mm(/\.recibo-par \.recibo-mitad \{[^}]*height:\s*([\d.]+)mm/);
var _corte = _mm(/\.recibo-par \.recibo-corte \{[^}]*height:\s*([\d.]+)mm/);
ok('se leyeron los milimetros del CSS',
  !isNaN(_margen) && !isNaN(_mitad) && !isNaN(_corte), true);
var _imprimible = 279.4 - (_margen * 2);
var _ocupado = (_mitad * 2) + _corte;
ok('las dos mitades y el corte caben en la carta', _ocupado <= _imprimible, true);
/* Y que no sobre tanto que las mitades dejen de parecer mitades. */
ok('sin desperdiciar media hoja', (_imprimible - _ocupado) < 12, true);

/* LA FIRMA NO PUEDE CORTARSE.

   Cada mitad lleva `overflow: hidden` —es lo que fija la raya siempre en el
   mismo sitio, para poder cortar un taco de una vez— y ese recorte es MUDO.
   Lo ultimo del recibo es «Recibi conforme» con su raya: una copia sin esa
   linea no sirve para lo que existe la copia.

   Clavada al fondo, esta siempre. Si un recibo se pasa de largo, la tabla le
   llega encima y se ve; desaparecer, no desaparece. */
var _pie = (_css.match(/#printPortal \.recibo-par \.recibo-foot \{([^}]*)\}/) || [])[1] || '';
ok('el pie de firma esta clavado al fondo de la mitad',
  /position:\s*absolute/.test(_pie) && /bottom:\s*0/.test(_pie), true);

/* La base legal de cada renglon se va en este modo: son 18 lineas que ocupan
   tanto como la tabla entera, y con ellas puestas la primera prueba corto el
   «Son:», las dos firmas y el pie. */
ok('la base legal por renglon no va en este modo',
  /\.recibo-par \.recibo-table td \.sub \{[^}]*display:\s*none/.test(_css), true);

/* Marcada sola en el recibo de pago; a mano en los demas, que son mas largos
   y podrian no caber en media hoja. */
ok('viene marcada en el recibo de pago', /marcarDosPorHoja\(true\)/.test(_nom), true);
ok('y desmarcada en los de prestaciones', /marcarDosPorHoja\(false\)/.test(_nom), true);


/* -- CTRL+P, EN TODA LA APP ------------------------------------------------

   Todo lo que se imprime aqui se clona antes a un lienzo aparte, fuera de la
   aplicacion; por eso sale en una hoja limpia. Esa preparacion vivia DENTRO
   del clic de cada boton, y son quince botones. Con Ctrl+P no se pasaba por
   ninguno: el navegador imprimia la pagina entera, repartida en varias hojas.

   Luis lo encontro en el recibo de utilidades. Estaba en los quince.

   En vez de tocar quince sitios se arreglo el atajo: Ctrl+P busca el boton
   que se este viendo y lo PULSA. No imita lo que hace — pulsa el boton. Por
   construccion no pueden dar resultados distintos, y el que se añada mañana
   queda cubierto sin que nadie se acuerde de venir aqui. */
bloque('Ctrl+P hace lo mismo que el boton de imprimir');

var _core = (function () { try { return fs.readFileSync(path.join(RAIZ, 'assets', 'core.js'), 'utf8'); } catch (e) { return ''; } })();

ok('Ctrl+P esta atendido', /!e\.ctrlKey && !e\.metaKey/.test(_core), true);
ok('y pulsa el boton de verdad', /\.click\(\)/.test(_core), true);

/* LO QUE COSTO ACERTAR: que significa «estar a la vista».

   Las ventanas de esta app no se esconden con display:none; se quedan
   puestas con opacity 0 y pointer-events none. Miradas por su TAMAÑO todas
   parecen visibles, y con eso Ctrl+P sin nada abierto pulsaba el boton de un
   recibo cerrado — lo vi pasar en Chrome.

   `elementFromPoint` pregunta lo unico que importa: si alguien pinchara ahi,
   ¿le daria a este boton? Y de paso descarta gratis lo que quedo tapado por
   una ventana de encima. */
ok('mira si el boton es PINCHABLE, no si mide',
  /elementFromPoint/.test(_core), true);

/* Sin nada abierto no se toca el atajo: el navegador imprime como siempre. */
ok('sin nada abierto, no interfiere',
  /if \(!vistos\.length\) return;/.test(_core), true);

/* -- EL PIE DE TABLA QUE NO ES DEL MOTOR -----------------------------------

   Catorce pies de tabla llevan dentro elementos con `id` que el modulo dueño
   rellena: `tercerosShown`, `leadsShown`, `invShown`/`invTotal`,
   `despachosShown`... El motor de tablas escribia el pie con innerHTML, o
   sea que los BORRABA.

   Mientras solo actuaba sobre tablas que ya traian filas casi no se notaba.
   Al empezar a atender tambien las que nacen vacias se llevo por delante 13
   de 24 —medido en Chrome— y el modulo de Contactos reventaba al escribir
   sobre algo que ya no existia. */
bloque('El motor de tablas no pisa el pie del modulo');

ok('se comprueba de quien es el pie',
  /pieEsDelModulo/.test(app), true);
ok('y se comprueba ANTES del primer pintado',
  app.indexOf('const pieEsDelModulo') < app.indexOf('if (countEl && !pieEsDelModulo)'), true);
ok('el motor solo escribe el pie si es suyo',
  /if \(countEl && !pieEsDelModulo\) \{/.test(app), true);


/* -- EL ALTO DE PANTALLA, MEDIDO COMO LO VE UN TELEFONO --------------------

   `100vh` en un movil NO es lo que se ve: es lo que se veria con la barra del
   navegador escondida. Mientras la barra esta puesta —que es casi siempre— el
   ultimo trozo de la app queda DEBAJO de ella. Y como el `body` lleva
   `overflow: hidden`, la pagina no se desplaza para compensarlo.

   Justo ahi vive el pie de las listas, con el paginador. Luis no podia pasar
   a la pagina 2 de sus recibos desde el telefono: los botones estaban
   puestos, con su tamaño, respondiendo — solo que debajo de la barra.

   POR QUE ESTA PRUEBA ES DE TEXTO Y NO DE NAVEGADOR
   La sonda de navegador no puede verlo: Chrome sin ventana no TIENE barra,
   asi que ahi `100vh` y lo que se ve valen lo mismo y el fallo no aparece.
   Lo unico que se puede comprobar sin un telefono de verdad es que la regla
   siga escrita. */
bloque('El alto de pantalla se mide como lo ve un telefono');

var _cssApp = (function () { try { return fs.readFileSync(path.join(RAIZ, 'assets', 'app.css'), 'utf8'); } catch (e) { return ''; } })();

/* El armazon. `100vh` se queda DELANTE como respaldo para un navegador que no
   entienda `dvh`; el que la entienda se queda con la segunda. */
var _bloqueApp = (_cssApp.match(/\n  \.app \{([\s\S]*?)\n  \}/) || [])[1] || '';
ok('el armazon usa dvh', /height:\s*100dvh/.test(_bloqueApp), true);
ok('y deja 100vh de respaldo antes', _bloqueApp.indexOf('100vh') < _bloqueApp.indexOf('100dvh'), true);

/* Las ventanas altas tienen el mismo problema: un modal de `100vh - N` se
   sale por debajo de la barra igual que la app. */
var _vhSueltos = (_cssApp.match(/max-height:\s*calc\(100vh[^)]*\)/g) || []);
var _dvhPuestos = (_cssApp.match(/max-height:\s*calc\(100dvh[^)]*\)/g) || []);
ok('cada ventana alta tiene su version en dvh', _dvhPuestos.length >= _vhSueltos.length, true);

/* Y el paginador, pulsable con el dedo. 28px es un boton de raton: en un
   telefono se falla y se pulsa el numero de al lado.

   Se toma la ULTIMA regla `.pager button` que fija un ancho —la que gana en
   la cascada— y se comprueba que viva dentro del traje de telefono. */
var _reglas = [];
var _re = /\.pager button \{[^}]*width:\s*(\d+)px/g, _m;
while ((_m = _re.exec(_cssApp)) !== null) _reglas.push({ px: Number(_m[1]), en: _m.index });
ok('hay una regla de tamaño para el paginador', _reglas.length > 0, true);
var _ultima = _reglas[_reglas.length - 1] || { px: 0, en: 0 };
ok('la ultima esta en el traje de telefono',
  _cssApp.slice(0, _ultima.en).lastIndexOf('@media (max-width: 560px)') > -1, true);
ok('y el boton mide 40px o mas', _ultima.px >= 40, true);


/* -- EL AVISO DE «HAY UNA VERSION NUEVA» QUE NO SE IBA --------------------

   Se pulsaba «Actualizar», la pantalla recargaba, y el aviso estaba otra vez
   ahi. Luis lo pulso unas diez veces seguidas desde el telefono.

   La culpa era de un `setTimeout(reload, 300)`. `skipWaiting()` no es
   inmediato: le pide al navegador que la version nueva tome el control, y eso
   tarda lo que tarde. Recargar a los 300 milisegundos es apostar a que ya
   paso — en un telefono no pasa. La pagina volvia con el service worker VIEJO
   todavia al mando y el nuevo esperando, veia `reg.waiting` y sacaba el aviso
   de nuevo. Pulsar otra vez repetia la apuesta.

   Ahora se espera a `controllerchange`, que es el navegador diciendo «ya
   esta». Esa señal no puede llegar antes de tiempo. */
bloque('El aviso de version nueva no se repite');

var _appSW = app.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* Nadie recarga a los pocos cientos de milisegundos de pedir el cambio. */
var _relojes = (_appSW.match(/setTimeout\([\s\S]{0,140}?location\.reload[\s\S]{0,80}?,\s*(\d+)\)/g) || []);
var _cortos = _relojes.filter(function (r) {
  var ms = Number((r.match(/,\s*(\d+)\)/) || [])[1] || 0);
  return ms > 0 && ms < 5000;
});
ok('no se recarga por reloj corto tras Actualizar', _cortos.length, 0);
ok('se espera a que el navegador avise', /addEventListener\('controllerchange'/.test(_appSW), true);

/* -- Y EL TELEFONO DEJA DE PREGUNTAR A CADA RATO --------------------------

   `visibilitychange` en un movil salta todo el tiempo: al cambiar de app, al
   bloquear y desbloquear, al bajar las notificaciones. Cada salto pedia el
   service worker al servidor. */
ok('las consultas van con freno', /ultimaBusqueda/.test(_appSW), true);
ok('y el freno es de media hora o mas',
  Number((_appSW.match(/UN_RATO\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/) || [])[1] || 0) >= 30, true);

/* -- LOS ARCHIVOS SALEN DE LA COPIA, NO DE LA RED --------------------------

   Iban «primero la red». En un telefono eso es volver a bajar el CSS, el JS y
   los 218 KB de Supabase cada vez que se abre la app. Medido: 25 peticiones
   por apertura; ahora, 1.

   No hace falta pedirlos: el nombre del cache lleva el numero de version, asi
   que dentro de una version la copia ES la version. */
/* Los comentarios de sw.js NOMBRAN `caches.match(` para explicar por que no
   se usa. Hay que mirar el codigo, no lo que se cuenta de el. */
function _sinComentarios(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ' '); }

bloque('Los archivos de la app salen de la copia');

var _swTxt = (function () { try { return fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8'); } catch (e) { return ''; } })();

ok('lo que no es navegacion sale de la copia',
  /if \(req\.mode !== 'navigate'\)/.test(_swTxt), true);
ok('la navegacion si va a la red (asi llega un despliegue)',
  /ESPERA_RED/.test(_swTxt), true);
/* Y se busca SOLO en el cache de esta version: mientras la nueva espera, los
   dos caches conviven, y mezclarlos serviria el JS de una version dentro del
   HTML de otra. */
ok('se busca solo en el cache de esta version',
  /caches\.match\(/.test(_sinComentarios(_swTxt)), false);
ok('mediante delCache()', /function delCache/.test(_swTxt), true);


/* -- NINGUN NOMBRE SIN DECLARAR, EN NINGUN MODULO ---------------------------

   Un parche que rehacia pintarHoja() cortaba el texto hasta la primera linea
   en blanco. Esa linea venia justo DESPUES de `let lastReciboText = '';`, y
   se la llevo. El codigo seguia haciendo `lastReciboText = ...`.

   Sintaxis valida: `node --check` feliz. Y en el navegador, al pulsar
   «Recibo»: ReferenceError. No se podia abrir el recibo de ningun trabajador
   de ninguna empresa. Luis lo encontro en AGUERO.

   Lo peor: la herramienta que existe para esto —variables_libres.py— tambien
   decia «ninguno». Solo miraba nombres seguidos de ( . o [; una asignacion a
   secas no la veia. Se le enseño, y ahora se corre AQUI, en cada pasada, en
   vez de depender de que alguien se acuerde de correrla. */
bloque('Ningun nombre sin declarar en los modulos');

var _py = (function () {
  var cp = require('child_process');
  var candidatos = ['python', 'python3', 'py'];
  for (var i = 0; i < candidatos.length; i++) {
    try { cp.execFileSync(candidatos[i], ['--version'], { stdio: 'ignore' }); return candidatos[i]; } catch (e) {}
  }
  return null;
})();

if (!_py) {
  console.log('  (sin Python: esta comprobacion se salta, no bloquea)');
} else {
  var _cp = require('child_process');
  var _herr = path.join(RAIZ, 'herramientas', 'variables_libres.py');
  ['core', 'app', 'retenciones', 'tesoreria', 'facturas', 'contabilidad',
    'inventario', 'terceros', 'nomina', 'rescate', 'supabase-init'].forEach(function (m) {
    var ruta = path.join(RAIZ, 'assets', m + '.js');
    var lineas = fs.readFileSync(ruta, 'utf8').split('\n').length;
    var salida = '';
    try {
      salida = _cp.execFileSync(_py, [_herr, '1', String(lineas), ruta], { encoding: 'utf8' });
    } catch (e) { salida = 'ERROR: ' + (e.message || e); }
    var m2 = salida.match(/\((\d+)\):\s*(.*)$/m);
    var cuantos = m2 ? Number(m2[1]) : -1;
    ok(m + '.js sin nombres sin declarar', cuantos === 0 ? 0 : (m2 ? m2[2].trim() : salida.trim()), 0);
  });
}

/* Y la que se perdio, por su nombre. */
ok('lastReciboText esta declarada en nomina.js',
  /let lastReciboText\s*=/.test(_nom), true);


/* -- EL LIBRO DE UNA QUINCENA NO MUESTRA EL FUTURO --------------------------

   GATMA, septiembre de 2026. Una sola compra en la primera quincena, con su
   retencion de IVA de 378.772,49. Al imprimir el libro de ESA quincena salia
   debajo, ademas, la retencion de 415.229,62 del 28 de septiembre. El dia 15
   esa retencion no existia.

   El cuadro seguia al selector de quincena de la pestaña Retenciones y no a
   la quincena del libro que se estaba mirando.

   Se prueba con el codigo de verdad y con las tres retenciones de GATMA tal
   como estan en la base. */
bloque('El libro de una quincena no muestra el futuro');

eval(tramo('    function _quincenaDelLibro() {',
           '    // Mini-cuadro de retenciones dentro de una Forma 30'));

var _retGatma = [
  { fecha: '10/09/26', quincena: 1, tipo: 'islr', direccion: 'practicada', monto: 47346.56 },
  { fecha: '10/09/26', quincena: 1, tipo: 'iva', direccion: 'practicada', monto: 378772.49 },
  { fecha: '28/09/26', quincena: 2, tipo: 'iva', direccion: 'practicada', monto: 415229.62 },
];
var _ivaDe = function (lista) {
  return lista.filter(function (r) { return r.tipo === 'iva'; })
    .reduce(function (s, r) { return s + r.monto; }, 0).toFixed(2);
};

/* Libro de la 1ra quincena, empresa que declara el IVA por quincena. */
window.__ivaPorQuincena = function () { return true; };
window.__fiscalPer = { mm: '09', aa: '26', q: 1 };
ok('1ra quincena: solo el IVA retenido hasta el 15', _ivaDe(_hastaLaQuincenaDelLibro(_retGatma)), '378772.49');
ok('1ra quincena: la del 28 no aparece', _hastaLaQuincenaDelLibro(_retGatma).length, 2);

/* Libro de la 2da: la primera ya paso y la segunda se declara. Salen las dos. */
window.__fiscalPer = { mm: '09', aa: '26', q: 2 };
ok('2da quincena: salen las dos', _ivaDe(_hastaLaQuincenaDelLibro(_retGatma)), '794002.11');

/* Quien NO declara el IVA por quincena ve el mes entero, como siempre. */
window.__ivaPorQuincena = function () { return false; };
window.__fiscalPer = { mm: '09', aa: '26', q: 1 };
ok('libro mensual: no se corta nada', _hastaLaQuincenaDelLibro(_retGatma).length, 3);

/* Una retencion SIN quincena registrada se ubica por el dia de su fecha; y
   si tampoco hay fecha, no se esconde: lo que no se sabe, se muestra. */
window.__ivaPorQuincena = function () { return true; };
ok('sin quincena, fechada el 20: es del futuro',
  _hastaLaQuincenaDelLibro([{ fecha: '20/09/26', quincena: null }]).length, 0);
ok('sin quincena, fechada el 08: se ve',
  _hastaLaQuincenaDelLibro([{ fecha: '08/09/26', quincena: null }]).length, 1);
ok('sin quincena ni fecha: no se esconde',
  _hastaLaQuincenaDelLibro([{ fecha: '', quincena: null }]).length, 1);

/* Y que el cuadro del libro use de verdad ese corte. */
var _ret = (function () { try { return fs.readFileSync(path.join(RAIZ, 'assets', 'retenciones.js'), 'utf8'); } catch (e) { return ''; } })();
ok('el cuadro del libro de compras aplica el corte',
  /_quincenaDelLibro\(\)\s*[\r\n]+\s*\? _hastaLaQuincenaDelLibro\(delMes\)/.test(_ret), true);
ok('y el desglose no pinta la 2da quincena en el libro de la 1ra',
  /_quincenaDelLibro\(\) === 1 \? '' : fila\('2da quincena'/.test(_ret), true);


/* -- LA RETENCION HEREDA EL ESTABLECIMIENTO DE SU FACTURA -------------------

   En el libro de compras de GATMA, al elegir «Casa Matriz», el cuadro de
   retenciones salia en cero — con la factura de Casa Matriz y su retencion
   de 378.772,49 a la vista.

   Al guardar una retencion se leia `v.sucursal_id`, y `v` son los campos del
   formulario, que no tiene ninguno de establecimiento: se guardaba vacio
   SIEMPRE. Y el filtro por establecimiento es estricto: lo que no tiene
   establecimiento no entra en ninguno. Siete retenciones estaban asi. */
bloque('La retencion hereda el establecimiento de su factura');

if (typeof normRif === 'undefined') {
  var normRif = function (s) { return (s || '').toUpperCase().replace(/[\s.\-]/g, ''); };
}
eval(tramo('    function _sucursalDeLaFactura(facturas, numero, direccion, rif, respaldo) {',
           '    async function registrarRetencion(pre) {'));

var _libroGatma = [
  { numero_factura: '0001894', tipo: 'compra', tercero_rif: 'J301436806', sucursal_id: 'MATRIZ' },
  { numero_factura: '0001905', tipo: 'compra', tercero_rif: 'J301436806', sucursal_id: 'MATRIZ' },
  { numero_factura: '0001894', tipo: 'compra', tercero_rif: 'J999999990', sucursal_id: 'BARQUISIMETO' },
  { numero_factura: 'A000023', tipo: 'venta', tercero_rif: 'J111111111', sucursal_id: 'BARQUISIMETO' },
];
ok('toma el establecimiento de su factura',
  _sucursalDeLaFactura(_libroGatma, '0001894', 'practicada', 'J301436806', null), 'MATRIZ');
/* El mismo numero de factura en otro proveedor es OTRA factura. */
ok('distingue por el RIF del proveedor',
  _sucursalDeLaFactura(_libroGatma, '0001894', 'practicada', 'J-99999999-0', null), 'BARQUISIMETO');
/* Practicada busca en compras; sufrida, en ventas. */
ok('una sufrida busca en las ventas',
  _sucursalDeLaFactura(_libroGatma, 'A000023', 'sufrida', 'J111111111', null), 'BARQUISIMETO');
ok('y no confunde una venta con una compra',
  _sucursalDeLaFactura(_libroGatma, 'A000023', 'practicada', 'J111111111', null), null);
/* Si la factura no esta en los libros, vale lo que traiga quien abrio el
   formulario; y si no trae nada, queda vacio. */
ok('sin factura en el libro, usa el respaldo',
  _sucursalDeLaFactura(_libroGatma, '9999999', 'practicada', 'J301436806', 'MATRIZ'), 'MATRIZ');
ok('sin factura ni respaldo, queda vacio',
  _sucursalDeLaFactura(_libroGatma, '', 'practicada', '', null), null);

/* Y que al guardar se use de verdad, y no los campos del formulario. */
ok('al guardar ya no se lee v.sucursal_id', /sucursal_id:\s*v\.sucursal_id/.test(_ret), false);
ok('se guarda el de la factura',
  /sucursal_id:\s*_sucursalDeLaFactura\(facturas, v\.factura, dir, v\.rif, pre\.sucursal_id\)/.test(_ret), true);
ok('las facturas se traen con su establecimiento',
  /tipo, fecha, periodo, sucursal_id'\)/.test(_ret), true);


/* -- EL RIF DE LA RETENCION ES EL DE SU FACTURA ------------------------------

   GATMA, 10/09/2026: la retencion de ISLR de la factura 0001894 de MADERAS Y
   MADERAS se guardo con el RIF J301436809. El proveedor es J301436806 — un 9
   por un 6. Ese RIF es el que va en el XML de ISLR para el SENIAT, y en
   pantalla no se nota porque el nombre de al lado es el correcto.

   Revisadas las 334 retenciones de la cuenta, era la unica. Ahora no se
   puede guardar otra asi. */
bloque('El RIF de la retencion es el de su factura');

eval(tramo('    function _rifDistintoAlDeLaFactura(facturas, numero, direccion, rif) {',
           '    async function registrarRetencion(pre) {'));

ok('el caso real: un 9 por un 6 se detecta',
  _rifDistintoAlDeLaFactura(_libroGatma, '0001905', 'practicada', 'J301436809'), 'J301436806');
ok('el RIF correcto pasa',
  _rifDistintoAlDeLaFactura(_libroGatma, '0001905', 'practicada', 'J301436806'), '');
ok('con guiones tambien pasa',
  _rifDistintoAlDeLaFactura(_libroGatma, '0001905', 'practicada', 'J-30143680-6'), '');
/* El mismo numero de factura en dos proveedores: basta con que uno coincida. */
ok('factura repetida en dos proveedores: vale cualquiera de los dos',
  _rifDistintoAlDeLaFactura(_libroGatma, '0001894', 'practicada', 'J999999990'), '');
/* Sin con que comparar, no estorba. */
ok('factura que no esta en el libro: no frena',
  _rifDistintoAlDeLaFactura(_libroGatma, '7777777', 'practicada', 'J301436809'), '');
ok('sin numero de factura: no frena',
  _rifDistintoAlDeLaFactura(_libroGatma, '', 'practicada', 'J301436809'), '');
ok('al guardar se comprueba',
  /const rifDeLaFactura = _rifDistintoAlDeLaFactura\(facturas, nfac, dir, v\.rif\);\s*[\r\n]+\s*if \(rifDeLaFactura\) \{\s*[\r\n]+\s*return /.test(_ret), true);


/* -- LA LIQUIDACION SE CALCULA HASTA EL DIA EN QUE SE FUE -------------------

   Abrahan Reyes (JOSE AGUERO 4) ingreso el 04/01/2025 y salio el 13/09/2026.
   Se le liquido el 4 de octubre. La pestaña no tenia donde poner la fecha de
   egreso: todo se calculaba «al dia de hoy», asi que le contaba 1 año y 9
   meses (era 1 año y 8) y 10 meses de utilidades (eran 8). Pagaba tiempo que
   no trabajo.

   Se prueba con el codigo de verdad y sus fechas. */
bloque('La liquidacion se calcula hasta la fecha de egreso');

var HOY = new Date(2026, 9, 4);          // el dia en que se hizo la liquidacion
eval(tramo('    function aniosServicio(ing, ref) {', '    /* El día de hoy en la hora de AQUÍ.'));

var _ingAbrahan = new Date(2025, 0, 4), _egrAbrahan = new Date(2026, 8, 13);
ok('al egreso: 1 año', aniosServicio(_ingAbrahan, _egrAbrahan), 1);
ok('al egreso: y 8 meses', mesesFraccion(_ingAbrahan, _egrAbrahan), 8);
ok('utilidades: 8 meses completos (enero a agosto)', mesesCompletosDelEjercicio(_ingAbrahan, _egrAbrahan), 8);
/* Lo que salia antes, calculando contra «hoy»: un mes de mas en cada cosa. */
ok('sin fecha de egreso se mide contra hoy: 9 meses', mesesFraccion(_ingAbrahan), 9);

/* Los bordes del «mes completo». */
ok('salir el ultimo dia del mes SI cuenta ese mes',
  mesesCompletosDelEjercicio(_ingAbrahan, new Date(2026, 8, 30)), 9);
ok('salir el dia 1 no cuenta ese mes',
  mesesCompletosDelEjercicio(_ingAbrahan, new Date(2026, 8, 1)), 8);
ok('febrero: el 28 es su ultimo dia en 2026',
  mesesCompletosDelEjercicio(_ingAbrahan, new Date(2026, 1, 28)), 2);
/* Quien entro ese mismo año no cobra los meses de antes de entrar. */
ok('ingreso el 15 de marzo, egreso el 13 de septiembre: abril a agosto',
  mesesCompletosDelEjercicio(new Date(2026, 2, 15), _egrAbrahan), 5);
ok('ingreso el 1 de marzo: marzo tambien cuenta',
  mesesCompletosDelEjercicio(new Date(2026, 2, 1), _egrAbrahan), 6);
/* El aniversario exacto. */
ok('egreso el dia del aniversario: 1 año y 0 meses',
  aniosServicio(_ingAbrahan, new Date(2026, 0, 4)) + '-' + mesesFraccion(_ingAbrahan, new Date(2026, 0, 4)), '1-0');
ok('un dia antes del aniversario: 0 años y 11 meses',
  aniosServicio(_ingAbrahan, new Date(2026, 0, 3)) + '-' + mesesFraccion(_ingAbrahan, new Date(2026, 0, 3)), '0-11');

/* Y que la pestaña lo use: el campo existe y el calculo recibe el corte. */
ok('la pestaña tiene el campo de fecha de egreso', /id="egresoInput"/.test(_nom), true);
ok('el calculo de la liquidacion recibe esa fecha',
  /const c = calc\(emp, baseMes, egresoISO \? new Date\(egresoISO \+ 'T00:00:00'\) : undefined\);/.test(_nom), true);
ok('el recibo de liquidacion dice la fecha de egreso', /Fecha de egreso<\/div><div class="v">' \+ _fmtFecha\(c\.corte\)/.test(_nom), true);

/* El dia de hoy no se saca de toISOString(): eso es UTC y, pasadas las 8 de
   la noche en Venezuela, ya da mañana. */
ok('nomina no usa la fecha UTC como «hoy» fuera de su unica ayuda',
  (_nom.match(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/g) || []).length <= 2, true);


/* -- LA LIQUIDACION, CONCEPTO POR CONCEPTO, COMO DICE LA LOTTT --------------

   Se corre calc() de verdad con Abrahan Reyes (ingreso 04/01/2025, egreso
   13/09/2026: 1 año y 8 meses) y un salario de Bs 3.000 al mes (100 diarios),
   para que los dias se lean directo en el resultado. */
bloque('Liquidacion segun la LOTTT');

var DIAS_VAC = 15, DIAS_BONO_VAC = 15, DIAS_UTILIDADES = 30, TASA_INTERES = 0.15;
var baseCalcMes = function () { return 3000; };
eval(tramo('    function calc(emp, baseOverrideMes, corte) {', '    // ---------- Número a letras'));
var _cA = calc({ ingreso: _ingAbrahan }, 3000, _egrAbrahan);

ok('vacaciones fraccionadas: sobre los 16 dias del año en curso (Art. 190 y 196)', _cA.diasVacCurso, 16);
ok('bono vacacional fraccionado: sobre 16 dias (Art. 192)', _cA.diasBonoCurso, 16);
ok('vacaciones fraccionadas: 8/12 de 16 dias', Math.round(_cA.vacFrac * 100) / 100, Math.round(16 * 8 / 12 * 100 * 100) / 100);
ok('las vacaciones del año ya cumplido siguen siendo 15 (pestaña Vacaciones)', _cA.diasVac, 15);
ok('utilidades fraccionadas: 8/12 de 30 dias', Math.round(_cA.utilFrac), 2000);
ok('INCES 0,5% sobre las utilidades fraccionadas', Math.round(_cA.incesUtilFrac * 100) / 100, 10);
ok('el INCES se descuenta del total', Math.round((_cA.liqAsig - _cA.liqTotal) * 100) / 100, 10);
ok('garantia: 7 trimestres iniciados', _cA.trimestres, 7);
ok('garantia: 105 dias', _cA.diasGarantia, 105);
ok('con un solo año cumplido no hay dias adicionales', _cA.diasAdic, 0);
ok('retroactivo: 2 años (1 y fraccion mayor de 6 meses)', _cA.aniosRetro, 2);
ok('se paga la garantia, que es mayor', _cA.usoRetro, false);

/* Los topes y los acumulativos, con antiguedades largas. */
var _c5 = calc({ ingreso: new Date(2021, 8, 13) }, 3000, _egrAbrahan);      // 5 años justos
ok('5 años: 2+4+6+8 = 20 dias adicionales acumulados (Art. 142 b)', _c5.diasAdic, 20);
ok('5 años justos: 21 trimestres iniciados (el dia del aniversario inicia otro)', _c5.trimestres, 21);
ok('5 años: fraccionadas sobre 20 dias', _c5.diasVacCurso, 20);
var _c20 = calc({ ingreso: new Date(2006, 8, 13) }, 3000, _egrAbrahan);     // 20 años
ok('20 años: vacaciones topadas en 30 dias', _c20.diasVacCurso, 30);
ok('20 años: adicionales con tope de 30 por año', _c20.diasAdic, 2 + 4 + 6 + 8 + 10 + 12 + 14 + 16 + 18 + 20 + 22 + 24 + 26 + 28 + 30 * 5);
var _c0 = calc({ ingreso: new Date(2026, 5, 1) }, 3000, _egrAbrahan);       // 3 meses
ok('primer año: fraccionadas sobre 15 dias', _c0.diasVacCurso, 15);
ok('3 meses y dias: 2 trimestres iniciados', _c0.trimestres, 2);

/* Los egresados: se guardan con su fecha y siguen a la vista en Liquidacion. */
ok('la baja desde Liquidacion guarda la fecha de egreso',
  /update\(\{ activo: false, fecha_egreso: egresoISO \}\)/.test(_nom), true);
ok('los egresados se cargan aparte y solo con fecha',
  /\.eq\('activo', false\)\.not\('fecha_egreso', 'is', null\)/.test(_nom), true);
ok('solo Liquidacion ofrece a los egresados',
  /const lista = tab === 'liquidacion' \? empleados\.concat\(egresados\) : empleados;/.test(_nom), true);
ok('un egresado se encuentra por su id', /empleados\.find\(\(e\) => e\.id === id\) \|\| egresados\.find/.test(_nom), true);

// ── Dos apps: qué ve cada plan ──────────────────────────────────────────────
/* Diseño 2026-10-17-dos-apps. El negocio ve su control interno; el contador,
   lo que se declara. Lo que no es de su app no aparece, y los agentes solo
   existen con el add-on de un plan a medida. */
bloque('Dos apps: qué ve cada plan');
eval(tramo("    const APP_NEGOCIO = ['ventas',", '    window.__limiteEmpresas = function () {'));
const _ve = (plan, tipo, fund, addon) => window.__modulosDelPlan(plan, tipo, fund, addon).slice().sort().join(',');
ok('PYME: solo la app del negocio', _ve('Emprendimientos y PYME', 'empresa'), 'compras,inventario,tesoreria,ventas');
ok('PYME: sin libros ni fiscal', _ve('Emprendimientos y PYME', 'empresa').indexOf('fiscal') < 0, true);
ok('Contador Básico: contabilidad, fiscal y nómina', _ve('Contador Básico', 'contador'), 'contabilidad,fiscal,nomina');
ok('Contador PRO: lo mismo que el Básico', _ve('Contador PRO', 'contador'), 'contabilidad,fiscal,nomina');
ok('Empresa Completa: las dos apps', _ve('Empresa Completa', 'empresa'), 'compras,contabilidad,fiscal,inventario,nomina,tesoreria,ventas');
ok('Firma a medida: las dos apps', _ve('Firma a medida', 'contador'), 'compras,contabilidad,fiscal,inventario,nomina,tesoreria,ventas');
ok('el nombre viejo «Firma Contable» se lee como Firma a medida', _ve('Firma Contable', 'contador'), _ve('Firma a medida', 'contador'));
ok('el nombre viejo «Grupo Empresarial» se lee como Grupo a medida', _ve('Grupo Empresarial', 'empresa'), _ve('Grupo a medida', 'empresa'));
ok('agentes: solo con el add-on', _ve('Firma a medida', 'contador', false, true).indexOf('agentes') >= 0, true);
ok('agentes: sin add-on no aparecen', _ve('Empresa Completa', 'empresa').indexOf('agentes') < 0, true);
ok('el fundador lo ve todo', _ve('Emprendimientos y PYME', 'empresa', true), 'agentes,compras,contabilidad,fiscal,inventario,nomina,tesoreria,ventas');
ok('cuenta de contador sin plan: su app', _ve(undefined, 'contador'), 'contabilidad,fiscal,nomina');
ok('cuenta de empresa sin plan: la app del negocio', _ve(undefined, 'empresa'), 'compras,inventario,tesoreria,ventas');
ok('nombre de la app del negocio', window.__nombreApp(window.__modulosDelPlan('Emprendimientos y PYME', 'empresa')), 'Gestión de Ventas e Inventario');
ok('nombre de la app del contador', window.__nombreApp(window.__modulosDelPlan('Contador PRO', 'contador')), 'Gestión Contable y Fiscal');
ok('con las dos apps no hay nombre único', window.__nombreApp(window.__modulosDelPlan('Empresa Completa', 'empresa')), '');

bloque('Dos apps: tope de empresas');
ok('Básico: 3', window.__topeEmpresas('Contador Básico', 0), 3);
ok('PRO sin paquetes: 10', window.__topeEmpresas('Contador PRO', 0), 10);
ok('PRO con un paquete: 15', window.__topeEmpresas('Contador PRO', 5), 15);
ok('PRO con dos paquetes: 20', window.__topeEmpresas('Contador PRO', 10), 20);
ok('PRO no pasa de 20', window.__topeEmpresas('Contador PRO', 30), 20);
ok('Firma a medida: lo del contrato', window.__topeEmpresas('Firma a medida', 0, 40), 40);
ok('Firma a medida sin contrato cargado: 30', window.__topeEmpresas('Firma Contable', 0, null), 30);
ok('Grupo a medida: lo del contrato', window.__topeEmpresas('Grupo Empresarial', 0, 8), 8);
ok('PYME: 1', window.__topeEmpresas('Emprendimientos y PYME'), 1);
ok('Empresa Completa: 1', window.__topeEmpresas('Empresa Completa'), 1);
const _sqlTope = fs.readFileSync(path.join(RAIZ, 'sql', 'planes_dos_apps.sql'), 'utf8');
ok('la base aplica el mismo tope de PRO', /when 'contador_pro'\s+then 10 \+ least\(v_extra, 10\)/.test(_sqlTope), true);
ok('la base blinda el tope contra el cliente', /new\.empresas_extra := old\.empresas_extra/.test(_sqlTope), true);


// ── Los cobros dicen la verdad ──────────────────────────────────────────────
/* El botón «Verificar» de Cobros decía «Agente IA leyendo el comprobante» y no
   leía nada; los métodos decían «Confirmación automática» y no había nada
   automático; y los formularios con guardado asíncrono se cerraban sin mostrar
   sus avisos. */
bloque('Los cobros dicen la verdad');
ok('nadie dice que un agente lee el comprobante', /Agente IA leyendo/.test(app), false);
ok('ningún método de cobro se anuncia automático', /Confirmación automática/.test(app), false);
ok('confirmar un pago reportado corre la fecha del próximo cobro',
  /__confirmarPagoReportado[\s\S]{0,900}proximo_cobro: masMeses\(base, paso\)/.test(app), true);
ok('activar una cuenta pregunta cómo se le cobra',
  /nuevo === 'activa' && !c\.exenta && !c\.proximoCobro && !c\.cortesiaHasta\)[\s\S]{0,160}gestionarCobro\(c\)/.test(app), true);
ok('el formulario espera un guardado asíncrono',
  /res && typeof res\.then === 'function'/.test(app), true);

// ── El importador de libros lee como el revisor ─────────────────────────────
/* Un libro de ventas de prueba con lo que traen los reales: encabezado del
   período, una anulada sin fecha, la línea de una sucursal y la fila TOTAL en
   singular (la que se contaba como una venta más y duplicaba el mes). */
bloque('Importador de libros');
{
  const _ctx = { window: {}, document: { querySelectorAll: () => [], getElementById: () => null }, console };
  const _vm = require('vm'); _vm.createContext(_ctx);
  _vm.runInContext(fs.readFileSync(path.join(RAIZ, 'assets', 'importador.js'), 'utf8'), _ctx);
  const imp = _ctx.window.__importador;
  const H = ['Nº de Operación', 'Fecha de la Factura', 'Nº R.I.F.', 'Nombre o Razón Social', 'Comprobante de Retención', 'N° de Factura', 'N° Control de Factura',
    'Total Ventas Incluyendo el IVA', 'Ventas Internas No Gravadas', 'Base Imponible', '% Alícuota', 'Impuesto IVA', 'IVA Retenido por el Comprador'];
  const hoja = [
    ['EMPRESA DE PRUEBA'], ['LIBRO DE VENTAS'], ['Mes Junio: 01/06/2026 al 30/06/2026'], H,
    [1, '02/06/2026', 'J-12345678-9', 'CLIENTE UNO, C.A.', '', '000101', '00-000101', 1160, 0, 1000, 0.16, 160, 0],
    [2, '', '', '', '', '000102', '00-000102', 0, 0, 0, 0.16, 0, 0],
    [3, '05/06/2026', 'J-87654321-0', 'CLIENTE ESPECIAL, S.A.', '20260600000001', '000103', '00-000103', 2320, 0, 2000, 0.16, 320, 240],
    ['', '', 'SUCURSAL 02', 'Ventas de la sucursal', '', '', '', 500, 0, 431.03, 0.16, 68.97, 0],
    ['TOTAL', '', '', '', '', '', '', 3980, 0, 3431.03, '', 548.97, 240],   // incluye la sucursal
    ['TOTALES', '', '', '', '', '', '', 0, 0, 0, '', 0, 0],
  ];
  const h = imp.leerHoja('JUNIO 2026', hoja, 'venta');
  ok('reconoce el libro de ventas', h.tipo, 'venta');
  ok('el período sale del encabezado', h.periodo, '2026-06');
  ok('mes completo no es quincena', h.quincena, null);
  ok('la fila TOTAL en singular no se cuenta como venta', h.cuenta.operaciones, 2);
  ok('la anulada se conserva', h.cuenta.anuladas, 1);
  ok('la anulada toma la fecha de la anterior', h.ops[1].fecha && h.ops[1].fecha.d, 2);
  ok('la línea de la sucursal no se carga', h.ops.length, 3);
  ok('suma la base de las operaciones', h.suma.base, 3000);
  ok('cuadra contra la fila TOTAL (y no contra la TOTALES vacía)', h.cuadra, true);
  ok('cuenta la retención del cliente', h.cuenta.retenciones, 1);
  ok('rechaza un libro de compras en el libro de ventas', !!imp.leerHoja('JUNIO 2026', hoja, 'compra').errorGrave, true);
  ok('período desde el nombre de la hoja', imp.periodoDeHoja('MARZO 2026', [['sin rango']]).periodo, '2026-03');
  ok('quincena desde el rango', imp.periodoDeHoja('X', [['Mes Junio: 16/06/2026 al 30/06/2026']]).quincena, 2);
  ok('número con miles en formato venezolano', imp.num('1.234.567,89'), 1234567.89);
  ok('fecha corta dd/mm/aa', JSON.stringify(imp.leerFecha('05/03/26')), JSON.stringify({ a: 2026, m: 3, d: 5 }));
  const HN = H.slice(0, 7).concat(['N° Nota de Crédito'], H.slice(7));
  const notas = imp.leerHoja('JUNIO 2026', [['Mes Junio: 01/06/2026 al 30/06/2026'], HN,
    [1, '10/06/2026', 'J-12345678-9', 'CLIENTE UNO, C.A.', '', '', '', 'NC-0007', -116, 0, -100, 0.16, -16, 0]], 'venta');
  ok('una nota de crédito se reconoce como NC', notas.ops[0].doc, 'NC');
  ok('la NC toma su propio número', notas.ops[0].factura, 'NC-0007');
}

/* -- CONTABILIDAD · PLAN 1 ---------------------------------------------------
   El plan de cuentas base vivía como filas fijas dentro de index.html. La base
   no lo conocía, así que no podía generar asientos con nombres de cuenta. Ahora
   vive en la tabla plan_cuentas_base y la pantalla lo pide con plan_de_empresa. */
bloque('Plan de cuentas desde la base');
var _leer = function (p) { try { return fs.readFileSync(path.join(RAIZ, p), 'utf8'); } catch (e) { return ''; } };
var _html = _leer('index.html');
var _conta = _leer('assets/contabilidad.js');
var _sqlPlan = _leer('sql/contabilidad_01_plan_base.sql');
var _tbodyPlan = (_html.match(/<div class="conta-tab" data-tab="plan">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/) || [])[1];
ok('index.html ya no trae filas fijas en el plan de cuentas',
  typeof _tbodyPlan === 'string' && !/<tr/.test(_tbodyPlan), true);
ok('el plan se carga con plan_de_empresa', /rpc\('plan_de_empresa'/.test(_conta), true);
ok('nadie usa 1.1.4.01 para anticipos a proveedores',
  /1\.1\.4\.01 · Anticipos a proveedores/.test(app), false);
ok('el SQL siembra las 101 cuentas de siempre y las 30 nuevas', (_sqlPlan.match(/^\s*\('/gm) || []).length, 131);

/* Costo o gasto lo da el proveedor (regla de Luis): cada proveedor tiene su
   cuenta por defecto y cada factura de compra puede cambiarla. La ficha traía
   un selector «Categoría de gasto» que nunca se guardaba. */
bloque('Clasificación de compras');
var _terceros = _leer('assets/terceros.js');
var _appjs = _leer('assets/app.js');
ok('la ficha del proveedor tiene su cuenta contable por defecto', /data-tk="cuentaGasto"/.test(_html), true);
ok('la ficha ya no trae la «Categoría de gasto» que no se guardaba', /data-tk="provCat"/.test(_html), false);
ok('el tercero guarda cuenta_gasto', /cuenta_gasto:/.test(_terceros), true);
ok('la compra guarda cuenta_contable', /cuenta_contable:/.test(_appjs), true);
ok('la compra propone la cuenta del proveedor', /selCta\.value = cuentaDeProveedor\(/.test(_appjs), true);
ok('editar una compra muestra su cuenta o la del proveedor',
  /__campoCuentaCompra\(r\.cuenta_contable \|\| window\.__cuentaDeProveedor\(/.test(_appjs), true);
ok('hay una lista de cuentas clasificables', /window\.__cuentasClasificables\s*=/.test(_conta), true);

/* El asiento de cada fila del libro lo crea, actualiza y borra la base
   (sql/contabilidad_04_motor.sql), entre por donde entre la factura. Si el
   navegador siguiera creándolo, cada factura cargada en pantalla tendría dos. */
bloque('El libro contabiliza desde la base');
ok('registrar una compra ya no llama a __postAsiento', /__postAsiento\('Compra s\/factura/.test(_appjs), false);
ok('registrar una venta del libro ya no llama a __postAsiento', /__postAsiento\('Venta s\/libro/.test(_appjs), false);
ok('anular una fila del libro ya no llama a __postAsiento', /__postAsiento\('Anulación ' \+ \(esCompra/.test(_appjs), false);
ok('editar o borrar una fila del libro ya no reversa en el navegador', /__postAsiento\('Reverso ' \+ \(esCompra/.test(_appjs), false);
ok('__postAsiento no manda numero', /numero:\s*\(asientoNum/.test(_conta), false);
/* «Cerrar mes» creaba los asientos resumen LV/LC del mes. Con el motor, cada
   factura ya tiene el suyo: cerrar un mes lo habría contado dos veces. Queda
   la liquidación (F30) y, mientras el plan 2 no registre cada retención, un
   asiento con las retenciones de IVA sufridas del mes contra CxC (§5). */
ok('cerrar mes ya no genera el resumen de ventas', /Ventas del mes \(resumen Libro de Ventas\)/.test(_appjs), false);
ok('cerrar mes ya no genera el resumen de compras', /Compras del mes \(resumen Libro de Compras\)/.test(_appjs), false);
/* Plan 2: cada retención tiene su asiento (sql/contabilidad_05_retenciones.sql),
   así que cerrar mes ya no arma el provisional RIVA, y lo que queda por pagar
   de IVA va a «IVA por pagar» (al declarar va al pasivo; al pagar se cruza). */
ok('cerrar mes ya no crea el asiento provisional RIVA', /'RIVA-' \+ mm/.test(_appjs), false);
ok('la liquidación no suma las retenciones del mes al saldo', /retDisp = r2c\(retDisp \+ retMes\)/.test(_appjs), false);
ok('lo que queda por pagar va a IVA por pagar, no a Bancos', /'2\.1\.4\.04 · IVA por pagar'/.test(_appjs), true);
var _bloqueF30 = (_appjs.match(/const \{ data: yaF30 \}[\s\S]*?mkAsiento\('Liquidación IVA/) || [''])[0];
ok('la liquidación ya no abona Bancos', _bloqueF30.length > 0 && /1\.1\.1\.03 · Bancos/.test(_bloqueF30), false);
ok('cerrar mes no numera en el navegador', /numero: maxNum/.test(_appjs), false);
ok('el asiento manual no numera en el navegador', /const numero = \(asientoNum/.test(_conta), false);
/* Revisión final del plan 1. */
ok('cerrar mes no cierra si hay facturas del período sin asiento',
  /rpc\('contab_filas_sin_asiento'/.test(_appjs), true);
ok('la liquidación toma los saldos hasta el período que se cierra, no solo el mes',
  /periodo <= perDecl|String\(a\.periodo \|\| ''\) <= perDecl/.test(_appjs), true);
ok('elegir «Compra de Mercancía» a propósito se respeta aunque el proveedor tenga cuenta',
  /__cuentaContableAGuardar = [\s\S]{0,300}return delProveedor \? '5\.1\.1\.02' : null/.test(_appjs), true);
ok('registrar y editar compra guardan la cuenta con la misma regla',
  (_appjs.match(/cuenta_contable: esCompra \? window\.__cuentaContableAGuardar\(/g) || []).length, 2);
ok('la cuenta del proveedor se busca solo entre los terceros de la cuenta activa',
  /x\.cuenta === window\.__CUENTA_ID/.test(_appjs), true);
ok('anular ya no promete un asiento de reverso', /Se generará el asiento de reverso/i.test(_appjs), false);
ok('__postAsiento acepta la fecha como quinto parámetro',
  /__postAsiento = async function \(descripcion, referencia, lineas, origen, fecha\)/.test(_conta), true);

/* -- CONTABILIDAD · PLAN 2b ----------------------------------------------------
   Luis registra cada declaración y su pago copiando la planilla; los asientos
   los hace la base (sql/contabilidad_06_declaraciones.sql). */
bloque('Declaraciones y pagos');
ok('Fiscal tiene la pestaña de declaraciones', /data-tab="declaraciones"/.test(_html), true);
ok('se registra una declaración en la tabla declaraciones', /from\('declaraciones'\)\.insert/.test(_appjs), true);
ok('el pago guarda fecha, recibo y banco', /fecha_pago:[\s\S]{0,200}numero_pago:[\s\S]{0,200}cuenta_pago:/.test(_appjs), true);
ok('se avisa la diferencia con la contabilidad', /rpc\('contab_declarado_vs_contable'/.test(_appjs), true);
ok('una planilla repetida da un mensaje claro', /23505/.test(_appjs) && /ya está registrada/.test(_appjs), true);
ok('hay lista de cuentas de efectivo para el banco del pago', /window\.__cuentasEfectivo\s*=/.test(_conta), true);
/* Revisión final del plan 2b. */
ok('el a pagar es el de la planilla (en una sustitutiva, la diferencia), no siempre el monto',
  /v\.impuesto === 'ISLR_ANUAL' \? \(parseFloat\(v\.a_pagar\)/.test(_appjs), false);
ok('a pagar mayor que el impuesto da un mensaje claro', /23514/.test(_appjs) && /no puede ser mayor que el impuesto/.test(_appjs), true);
ok('las declaraciones de antes del motor se marcan como históricas y no se pagan aquí', /Histórica · sin asiento/.test(_appjs), true);
ok('editar una declaración no cambia su empresa ni su cuenta', /from\('declaraciones'\)\.update\(cambios\)/.test(_appjs), true);
ok('al cambiar de empresa se descartan las respuestas viejas', /_cargaDecl/.test(_appjs), true);
ok('el período de la fila siempre está en la lista al editarla', /periodos\(d \? d\.periodo/.test(_appjs), true);
ok('pagar un impuesto que la contabilidad no tiene por pagar pide confirmación', /quedará en negativo/.test(_appjs), true);

/* -- CONTABILIDAD · PLAN 3 -----------------------------------------------------
   El asiento de la nómina lleva también lo que pone el patrono (IVSS, RPE,
   FAOV, INCES) y su pasivo. La DPP no: se causa al declararla. */
bloque('Nómina: el asiento con los aportes patronales');
eval(tramo('    function lineasAsientoNomina(pagos, tasas) {', '    // ---- Contabilizar la nómina del período'));
var _pagosNom = [
  { asigSalarial: 1000, salarioNormal: 1000, baseIvss: 1000, baseRpe: 1000, bonoContingencia: 200, cestaticket: 100, transporteBs: 0, ivss: 40, spf: 5, faov: 10, dedOtras: 0 },
  { asigSalarial: 2000, salarioNormal: 2000, baseIvss: 2000, baseRpe: 2000, bonoContingencia: 100, cestaticket: 100, transporteBs: 0, ivss: 80, spf: 10, faov: 20, dedOtras: 0 },
];
var _tasasNom = { ivssP: 0.11, rpeP: 0.02, faovP: 0.02, incesP: 0.02 };
var _lnNom = lineasAsientoNomina(_pagosNom, _tasasNom);
var _ln = function (lineas, pref, lado) { var l = lineas.find(function (x) { return x.cta.indexOf(pref + ' ') === 0; }); return l ? l[lado] : null; };
ok('sueldos al debe', _ln(_lnNom, '6.1.1.01', 'debe'), 3000);
ok('beneficios al debe', _ln(_lnNom, '6.1.1.02', 'debe'), 500);
ok('aporte patronal IVSS al gasto', _ln(_lnNom, '6.1.1.08', 'debe'), 330);
ok('aporte patronal RPE al gasto', _ln(_lnNom, '6.1.1.09', 'debe'), 60);
ok('aporte patronal FAOV al gasto', _ln(_lnNom, '6.1.1.10', 'debe'), 60);
ok('aporte patronal INCES al gasto', _ln(_lnNom, '6.1.1.11', 'debe'), 60);
ok('IVSS del trabajador por pagar', _ln(_lnNom, '2.1.3.04', 'haber'), 120);
ok('RPE del trabajador por pagar', _ln(_lnNom, '2.1.3.05', 'haber'), 15);
ok('FAOV del trabajador por pagar', _ln(_lnNom, '2.1.3.06', 'haber'), 30);
ok('IVSS patronal por pagar', _ln(_lnNom, '2.1.3.08', 'haber'), 330);
ok('RPE patronal por pagar', _ln(_lnNom, '2.1.3.09', 'haber'), 60);
ok('FAOV patronal por pagar', _ln(_lnNom, '2.1.3.10', 'haber'), 60);
ok('INCES patronal por pagar', _ln(_lnNom, '2.1.3.11', 'haber'), 60);
ok('el banco paga el neto', _ln(_lnNom, '1.1.1.03', 'haber'), 3335);
ok('Debe = Haber', Math.round(_lnNom.reduce(function (s, l) { return s + l.debe - l.haber; }, 0) * 100), 0);
var _lnOtras = lineasAsientoNomina([Object.assign({}, _pagosNom[0], { dedOtras: 50 })], _tasasNom);
ok('caja de ahorro y préstamos a 2.1.5.01 (no a la cuenta de grupo)', _ln(_lnOtras, '2.1.5.01', 'haber'), 50);
ok('sin una línea a la cuenta de grupo 2.1.5', /'2\.1\.5 · /.test(_nom), false);
var _contabNom = (_nom.match(/async function contabilizarNomina[\s\S]*?\n    window\.__contabilizarNomina/) || [''])[0];
ok('el asiento va con la fecha del fin del período', /__postAsiento\([^;]*fechaAsiento\)/.test(_contabNom), true);
ok('la referencia es estable por frecuencia y período', /'NOM-' \+ freq \+ '-' \+ isoDe\(rango\.ini\)/.test(_contabNom), true);
ok('contabilizar de nuevo busca el asiento anterior por su referencia', /from\('asientos'\)\.select\('id, numero'\)[\s\S]{0,80}eq\('referencia', ref\)/.test(_contabNom), true);
ok('el anterior se borra DESPUÉS de guardar el nuevo (si el nuevo falla, el viejo queda)',
  /__postAsiento\([\s\S]{0,400}from\('asientos'\)\.delete\(\)\.in\('id', previo\.map/.test(_contabNom), true);
ok('una nota de crédito a cuenta de activo no abre una ficha nueva', /slice\(0, 2\) !== 'NC' && window\.__esCuentaActivoFijo/.test(_appjs), true);
ok('anular la compra de un activo depreciado se niega', /en vez de anular la factura/.test(_appjs), true);
ok('calcPago devuelve el salario normal', /salarioNormal, asigSalarial, asig, neto/.test(_nom), true);
/* Los activos fijos nacen de su compra; la depreciación y la baja las hace la
   base (sql/contabilidad_07_activos.sql). */
bloque('Activos fijos');
ok('una compra a una cuenta de activo fijo abre su ficha', /__esCuentaActivoFijo\(_ctaAF\)[\s\S]{0,400}__activoDeCompra\(/.test(_appjs), true);
ok('la ficha se guarda enlazada a su factura', /libro_fiscal_id: pref\.libro_fiscal_id/.test(_conta), true);
ok('la ficha pide valor residual, vida útil y método', /name: 'residual'[\s\S]{0,200}name: 'vida'[\s\S]{0,200}name: 'metodo'/.test(_conta), true);
ok('el registro manual pide lo ya depreciado', /Depreciación acumulada a la fecha/.test(_conta), true);
ok('el botón de depreciación lo hace la base', /rpc\('contab_depreciar'/.test(_conta), true);
ok('el navegador ya no escribe el asiento de depreciación', /referencia: 'DEPR'/.test(_conta), false);
ok('«Cerrar mes» deprecia antes de liquidar',
  _appjs.indexOf("rpc('contab_depreciar'") > _appjs.indexOf("rpc('contab_filas_sin_asiento'")
  && _appjs.indexOf("rpc('contab_depreciar'") < _appjs.indexOf("'F30-'", _appjs.indexOf("rpc('contab_filas_sin_asiento'")), true);
ok('hay venta y desincorporación con su asiento', /rpc\('contab_baja_activo'/.test(_conta), true);
ok('una baja por error se puede anular', /rpc\('contab_anular_baja'/.test(_conta), true);
ok('editar la compra actualiza su ficha', /actualizada · Bs[\s\S]{0,300}__activoDeCompra\(/.test(_appjs), true);
ok('no se borra la compra de un activo ya depreciado', /ya se depreció o se dio de baja/.test(_appjs), true);
ok('sin las cifras de ejemplo de la depreciación', /148\.750|#0314|Detalle de depreciación · Mayo/.test(_appjs + _conta), false);
ok('la tabla de activos tiene la columna de acciones', /colspan="11"[^>]*>Sin activos registrados/.test(_html), true);

/* RADIAN, 07/11/2026: la retención SUFRIDA de un Z del 25/09 que Luis
   registraba en octubre se guardó en septiembre. Abierto desde la factura,
   el cuadro arrancaba con la fecha de la factura (y esa fecha movía el
   período), y además la factura volvía a poner su mes aunque se hubiera
   elegido otro a mano. Solo en las sufridas: las practicadas siguen como
   estaban (Luis: «con las practicadas es otra cosa y ahí está bien»). */
bloque('Retenciones sufridas: el período lo decide quien registra');
ok('sufrida: la fecha del comprobante arranca en hoy, se abra desde donde se abra',
  /value: \(_dirInicial === 'sufrida' \? null : pre\.fechaFactura\) \|\| window\.__hoyISO\(\) \}/.test(_ret), true);
ok('sufrida: la quincena tampoco sale de la fecha de la factura',
  /_quincenaDeISO\(\(_dirInicial === 'sufrida' \? null : pre\.fechaFactura\)/.test(_ret), true);
ok('la fecha de la factura sigue a un clic', /Fecha de la factura · /.test(_ret), true);
ok('sufrida: la factura no cambia el período (solo informa y sale)',
  /if \(esSufrida\) \{[\s\S]{0,400}return;\s*\}\s*\/\/ PRACTICADA: como siempre[\s\S]{0,200}perEl\.value = perFac/.test(_ret), true);
ok('el comprobante no pisa un período elegido a mano', /if \(_perAMano \|\| !_selPer\)/.test(_ret), true);
ok('sufrida: al editar se elige el período', /r\.direccion !== 'practicada' \? \[\{ name: 'periodo'/.test(_ret), true);
ok('al editar, el período elegido cuenta solo en una sufrida',
  /const periodoOk = dir === 'sufrida' && \/\^\\d\{4\}-\\d\{2\}\$\/\.test\(v\.periodo/.test(_ret), true);

/* RADIAN, 07/11/2026: la Forma 21 sumaba el mes entero y en la 2da quincena
   de octubre volvía a salir a pagar el IGTF ya pagado en la 1ra. */
bloque('IGTF: la Forma 21 es de una quincena');
ok('la pestaña IGTF tiene su selector de quincena', /id="igtfQuinSel"[\s\S]{0,300}data-igtf-q="1"[\s\S]{0,200}data-igtf-q="2"/.test(_html), true);
ok('el documento toma la quincena elegida, no el mes', /const v = \(q === 1 \? mes\.q1 : mes\.q2\)/.test(_appjs), true);
ok('el total a pagar ya no suma el mes entero', /const total = \(Number\(v\.monto\) \|\| 0\) \+ monto2;/.test(_appjs), false);
ok('el 2% manual va aparte por quincena', /_igtf2\[q\] = \{ base:/.test(_appjs), true);
ok('al cambiar de mes se reinician la quincena y el 2%', /claveMes !== _igtfMes/.test(_appjs), true);
ok('«Registrar y declarar» ya no dice que registró sin guardar nada', /Forma 21\) registrada · lista para transmitir/.test(_appjs), false);
ok('«Registrar y declarar» abre la declaración con la quincena puesta',
  /__registrarDeclaracion\(\{ impuesto: 'IGTF', periodo: '20' \+ p\.aa \+ '-' \+ p\.mm, quincena: iq\.q/.test(_appjs), true);
ok('una declaración sin id se registra, no se edita', /const editando = !!\(d && d\.id\);[\s\S]{0,3000}const \{ error \} = editando/.test(_appjs), true);

/* GATMA, 2da quincena de octubre 2026: el ítem 66 sumaba la retención
   sufrida de la 1ra quincena (factura 166, 51.556,18), que ya venía
   arrastrada en el 54. Se prueba con el código de verdad. */
bloque('Forma 30: el ítem 66 es de la quincena de IVA');
eval(tramo('    function _quincenaIvaDe(r) {', '    function aplicarAForma30(arr) {'));
eval(tramo('    function aplicarAForma30(arr) {', '      if (window.__recalcAutoliq) window.__recalcAutoliq();') + '}');
var _retOct = [
  { direccion: 'sufrida', tipo: 'iva', quincena: 1, fecha: '13/10/26', monto: 51556.18 },
  { direccion: 'sufrida', tipo: 'iva', quincena: null, fecha: '20/10/26', monto: 1000 },
  { direccion: 'practicada', tipo: 'iva', quincena: 2, fecha: '20/10/26', monto: 777 },
];
var _ivaQ = true;
window.__ivaPorQuincena = function () { return _ivaQ; };
window.__recalcAutoliq = null;
window.__fiscalPer = { mm: '10', aa: '26', q: 2 };
aplicarAForma30(_retOct);
ok('IVA por quincena, 2da: no vuelve a sumar la de la 1ra', window.__RET_IVA_SUFRIDA, 1000);
window.__fiscalPer = { mm: '10', aa: '26', q: 1 };
aplicarAForma30(_retOct);
ok('IVA por quincena, 1ra: solo la suya', window.__RET_IVA_SUFRIDA, 51556.18);
_ivaQ = false;
window.__fiscalPer = { mm: '10', aa: '26' };
aplicarAForma30(_retOct);
ok('IVA mensual (firma personal): el mes entero', window.__RET_IVA_SUFRIDA, 52556.18);
ok('el 66 y el 54 deducen la quincena igual (guardada o, si falta, el día)',
  /if \(q === 1 \|\| q === 2\) return m \+ '-' \+ q;[\s\S]{0,300}d > 15 \? 2 : 1/.test(_appjs) && /return d && d > 15 \? 2 : 1;/.test(_ret), true);

/* GATMA y RADIAN dejan de ser especiales en noviembre 2026. La condición
   tiene fecha (sql/condicion_fiscal_historial.sql): octubre se sigue viendo
   como especial y noviembre como ordinario. Se prueba con el código de verdad. */
bloque('Condición fiscal con fecha');
eval(tramo('  window.__COND_HIST = window.__COND_HIST || {};', '  /* Cuando la condición fiscal de una empresa cambia'));
window.__COND_HIST = { G: [{ desde: '2000-01', condicion: 'especial' }, { desde: '2026-11', condicion: 'ordinario' }] };
ok('GATMA en octubre 2026: especial', window.__condicionEn('G', '2026-10', 'ordinario'), 'especial');
ok('GATMA en noviembre 2026: ordinario', window.__condicionEn('G', '2026-11', 'ordinario'), 'ordinario');
ok('GATMA en 2027: sigue ordinario', window.__condicionEn('G', '2027-03', 'ordinario'), 'ordinario');
ok('sin historial manda la ficha, como siempre', window.__condicionEn('X', '2026-10', 'Contribuyente especial'), 'especial');
ok('el rótulo de una C.A. ordinaria', window.__rotuloCondicion('ordinario', 'J502826114'), 'Contribuyente Ordinario');
ok('el rótulo de una firma personal ordinaria', window.__rotuloCondicion('ordinario', 'V123'), 'Persona Natural');
ok('el rótulo de una especial', window.__rotuloCondicion('especial', 'V123'), 'Contribuyente Especial');
window.__EMPRESA_ACTIVA = { id: 'G', rif: 'J502826114', condBase: 'ordinario', cond: '' };
window.__fiscalPer = { mm: '10', aa: '26', q: 2 };
window.__aplicarCondicionDelPeriodo();
ok('mirando octubre, la empresa activa es especial', window.__EMPRESA_ACTIVA.cond, 'Contribuyente Especial');
window.__fiscalPer = { mm: '11', aa: '26' };
window.__aplicarCondicionDelPeriodo();
ok('mirando noviembre, la empresa activa es ordinaria', window.__EMPRESA_ACTIVA.cond, 'Contribuyente Ordinario');

var emp = { id: 'G', condBase: 'ordinario' };
eval(tramo("      const MES_MIN = ['enero'", '      const condDeEvento = (e) =>').replace(/^(\s*)const /gm, '$1var '));
ok('calendario: la 2da quincena de octubre que vence en noviembre es de octubre',
  periodoDeEvento({ fecha: '2026-11-09', descripcion: 'Enterar retenciones de IVA practicadas del 16 al último de octubre (+ declaración de IVA y anticipo de ISLR 2da' }), '2026-10');
ok('calendario: la 1ra quincena de noviembre es de noviembre',
  periodoDeEvento({ fecha: '2026-11-23', descripcion: 'Enterar retenciones de IVA practicadas del 01 al 15 de noviembre' }), '2026-11');
ok('calendario: diciembre que se entera en enero es del año anterior',
  periodoDeEvento({ fecha: '2027-01-12', descripcion: 'Enterar retenciones de ISLR practicadas en diciembre' }), '2026-12');
ok('calendario: sin mes en el texto, el mes anterior al vencimiento',
  periodoDeEvento({ fecha: '2026-11-09', descripcion: 'Impuesto a los Grandes Patrimonios — declaración y pago (2do lapso)' }), '2026-10');
ok('calendario: lo «especial» se filtra con la condición de SU período', /\(e\.ambito !== 'especial' \|\| condDeEvento\(e\) === 'especial'\)/.test(_appjs), true);
ok('calendario: el IVA mensual sale solo en los meses de ordinario', /if \(window\.__condicionEn\(emp\.id, perIva, emp\.condBase\) !== 'ordinario'\) continue;/.test(_appjs), true);
ok('arrastres: cada mes con su periodicidad', /if \(!m \|\| !porQuincenaEn\(m\)\) return m;/.test(_appjs), true);
ok('el selector de período ofrece quincenas solo en los meses especiales', /if \(_ivaPorQuincenaEn\(dOp\.getFullYear\(\)/.test(_appjs), true);
ok('al cambiar de período se toma la condición de ese período', /window\.__fiscalPer = _fiscalPer;\s*\n[^\n]*\n\s*if \(window\.__aplicarCondicionDelPeriodo/.test(_appjs), true);
ok('cambiar la condición pregunta desde cuándo (ficha y configuración)', (_appjs.match(/__registrarCambioCondicion\(emp\.id, /g) || []).length, 2);
ok('retención practicada de IVA en un período no especial: se pregunta', /no es agente de retención de IVA\.\\n\\n¿Registrar esta retención practicada de IVA igual\?/.test(_ret), true);
ok('la Forma 21 avisa cuando la empresa no es especial en ese período', /no es agente de percepción del IGTF y no presenta la Forma 21/.test(_appjs), true);
/* Luis: «no quiero que me cambies directamente, dame una opción en el
   sistema». El SQL solo crea la estructura; el cambio lo hace él. */
var _sqlCond = _leer('sql/condicion_fiscal_historial.sql');
ok('el SQL no cambia ninguna empresa (ni nombra a GATMA o Radian)', /2ebc4c53|6b523033|insert into public\.empresa_condicion_historial|update public\.empresas/i.test(_sqlCond), false);
ok('la tabla se escribe solo por la función (el invitado lee, no edita)', /revoke insert, update, delete on public\.empresa_condicion_historial from authenticated;/.test(_sqlCond)
  && /Solo el dueño de la empresa puede cambiar su condición fiscal/.test(_sqlCond), true);
ok('un cambio posterior a la nueva fecha se borra (sin contradicciones)', /delete from empresa_condicion_historial where empresa_id = p_empresa and desde > p_desde;/.test(_sqlCond), true);
ok('SQL y app reconocen la condición igual', /like '%especial%' then 'especial'/.test(_sqlCond) && /\/especial\/\.test\(s\) \? 'especial' : \/formal\/\.test\(s\) \? 'formal'/.test(_appjs), true);
ok('al cambiar de período también se ajusta la quincena de Retenciones', /if \(window\.__syncRetQuincena\) window\.__syncRetQuincena\(\);/.test(_appjs), true);
ok('lo que se guarda usa la periodicidad del período de la fila', (_appjs.match(/__ivaPorQuincenaEn\(periodo\)/g) || []).length === 3 && /__ivaPorQuincenaEn\(perNuevo\)/.test(_appjs) && /__ivaPorQuincenaEn\(key\)/.test(_appjs), true);
ok('una retención de un período especial guarda su quincena aunque se mire uno ordinario', /__retencionesPorQuincenaEn\(v\.periodo \|\| _periodoVigente\(\)\)/.test(_ret), true);
ok('el calendario se recarga si cambia el historial', /'\|' \+ y \+ '\|' \+ JSON\.stringify\(\(window\.__COND_HIST/.test(_appjs), true);
ok('la factura impresa lleva la condición de hoy', /__rotuloCondicion\(window\.__condicionActual\(e\.id/.test(_leer('assets/facturas.js')), true);
ok('la ficha no escribe la condición nueva antes de elegir desde cuándo', /condicion_fiscal: condCambia \? emp\.condicion_fiscal : v\.cond/.test(_appjs), true);
ok('la configuración tampoco', /if \(condCambia\) fila\.condicion_fiscal = condAntes;/.test(_appjs), true);
ok('la condición se escribe al guardar desde cuándo rige, historial y ficha juntos', /window\.sb\.rpc\('cambiar_condicion_fiscal', \{ p_empresa: empId, p_desde: siempre \? null : v\.desde, p_condicion: nueva \}\)/.test(_appjs), true);
ok('la ficha muestra el historial de la condición', /name: 'condHist'[^\n]*_historialCondicionHtml\(emp\.id\)/.test(_appjs), true);

/* -- CONTABILIDAD · PLAN 4a ----------------------------------------------------
   Sugerencias de la conciliación. Regla de Luis: para asignar una línea a una
   factura o una declaración hace falta el monto Y otra coincidencia; con una
   sola, solo se sugiere (no se aprueba en bloque). Con el código de verdad. */
bloque('Conciliación: sugerencias con doble coincidencia');
eval(tramo('  // Palabras de nombres de empresa que no identifican a nadie', '  window.__sugerirLinea = sugerirLinea;').replace(/^  const GENERICAS/m, '  var GENERICAS'));
var _ctxC = {
  documentos: [{ id: 'v166', tipo: 'venta', numero: '000166', rif: 'J406912345', tercero: 'LIGNUM, C.A.', saldo: 446820.19 }],
  declaraciones: [{ id: 'dpp1', impuesto: 'DPP', numero: '2611000123', a_pagar: 9000, pagada: false }],
  terceros: [{ nombre: 'LIGNUM, C.A.', rif: 'J406912345', telefono: '0414-5551234' }],
  otrasLineas: [],
};
var _l = function (desc, monto, ref, fecha) { return { id: 'x', fecha: fecha || '05/11/2026', descripcion: desc, referencia: ref || '', monto: monto }; };
var _s = sugerirLinea(_l('COMISION MANTENIMIENTO', -12.5), _ctxC);
ok('comisión del banco: por la descripción, segura', _s && (_s.clase + '/' + _s.seguro), 'comision/true');
_s = sugerirLinea(_l('COBRO IGTF 3%', -30), _ctxC);
ok('IGTF del banco: segura', _s && (_s.clase + '/' + _s.seguro), 'igtf/true');
_s = sugerirLinea(_l('PAGO FACT 166 LIGNUM', 446820.19), _ctxC);
ok('cobro con monto y número de factura: seguro, con su documento', _s && (_s.clase + '/' + _s.seguro + '/' + _s.libro_fiscal_id), 'cobro/true/v166');
_s = sugerirLinea(_l('PAGO MOVIL 04121112233', 446820.19), _ctxC);
ok('solo coincide el monto: se sugiere, no es seguro', _s && (_s.clase + '/' + _s.seguro), 'cobro/false');
ok('y dice por qué', _s && /solo coincide el monto/i.test(_s.motivo), true);
_s = sugerirLinea(_l('PAGO MOVIL 04145551234', 446820.19), _ctxC);
ok('monto y teléfono del cliente: seguro', _s && (_s.clase + '/' + _s.seguro), 'cobro/true');
_s = sugerirLinea(_l('TRANSF J-40691234-5', 446820.19), _ctxC);
ok('monto y RIF: seguro', _s && _s.seguro, true);
var _ctx2 = Object.assign({}, _ctxC, { documentos: [
  { id: 'a', tipo: 'venta', numero: '000201', rif: 'J1', tercero: 'UNO', saldo: 500 },
  { id: 'b', tipo: 'venta', numero: '000202', rif: 'J2', tercero: 'DOS', saldo: 500 }] });
_s = sugerirLinea(_l('DEPOSITO', 500), _ctx2);
ok('dos facturas con el mismo saldo y nada más: no es seguro', _s && _s.seguro, false);
ok('y no elige ninguna sola', _s && (_s.libro_fiscal_id || null), null);
_s = sugerirLinea(_l('PAGO SENIAT', -9000), _ctxC);
ok('impuesto: monto y SENIAT, seguro, con su declaración', _s && (_s.clase + '/' + _s.seguro + '/' + _s.declaracion_id), 'impuesto/true/dpp1');
_s = sugerirLinea(_l('PAGO VARIOS', -9000), _ctxC);
ok('impuesto solo por monto: no es seguro', _s && (_s.clase + '/' + _s.seguro), 'impuesto/false');
var _ctx3 = Object.assign({}, _ctxC, { otrasLineas: [{ id: 'p', cuenta_contable: '1.1.1.03.02', fecha: '06/11/2026', monto: 300 }] });
_s = sugerirLinea(_l('TRF A BDV', -300), _ctx3);
ok('transferencia a otro banco propio: no es segura, con su par', _s && (_s.clase + '/' + _s.seguro + '/' + _s.extracto_par_id + '/' + _s.cuenta_contra), 'transferencia/false/p/1.1.1.03.02');
ok('una línea sin nada que reconocer: nada', sugerirLinea(_l('OPERACION MASTER DEBIT', -8063), _ctxC), null);
ok('un cobro no se sugiere contra una compra', sugerirLinea(_l('PAGO FACT 166 LIGNUM', -446820.19), _ctxC), null);
/* Revisión final del plan 4a. */
var _ctxT = Object.assign({}, _ctxC, { movimientos: [{ id: 'm1', monto: 446820.19, referencia: '50949046569', fecha: '05/11/2026' }] });
_s = sugerirLinea(_l('PAGO FACT 166 LIGNUM', 446820.19, '0050949046569'), _ctxT);
ok('C2: un cobro ya registrado en Tesorería (monto y referencia) es «ya registrado», no otro cobro', _s && (_s.clase + '/' + _s.seguro), 'registrado/true');
_s = sugerirLinea(_l('DEPOSITO', 446820.19, '9999'), _ctxT);
ok('C2: Tesorería con el mismo monto pero otra referencia: se sugiere «ya registrado» sin seguridad', _s && (_s.clase + '/' + _s.seguro), 'registrado/false');
_s = sugerirLinea(Object.assign(_l('COMISION MANTENIMIENTO', -12.5), { estado: 'historica' }), _ctxC);
ok('C2: una línea histórica nunca es segura (pudo registrarse con la conciliación vieja)', _s && _s.seguro, false);
var _ctxP = Object.assign({}, _ctxC, { documentos: [Object.assign({}, _ctxC.documentos[0], { presumido: '1.1.1.03' })] });
_s = sugerirLinea(_l('PAGO FACT 166 LIGNUM', 446820.19), _ctxP);
ok('I1: el cobro de una factura ya dada por cobrada va como «ya registrado» contra la cuenta de la presunción',
  _s && (_s.clase + '/' + _s.cuenta_contra + '/' + _s.libro_fiscal_id), 'registrado/1.1.1.03/v166');
var _ctxG = Object.assign({}, _ctxC, { documentos: [{ id: 'g', tipo: 'venta', numero: '000999', rif: 'J1', tercero: 'INVERSIONES GATMA', saldo: 777 }] });
_s = sugerirLinea(_l('TRF INVERSIONES LARA', 777), _ctxG);
ok('I7: una palabra genérica del nombre («INVERSIONES») no cuenta como segunda coincidencia', _s && _s.seguro, false);
ok('I7: un abono que dice COMISION no es un gasto de comisión', (sugerirLinea(_l('COMISION GANADA', 10), _ctxC) || {}).clase === 'comision', false);

bloque('Conciliación: la pantalla (Contabilidad y Tesorería)');
var _concil = _leer('assets/conciliacion.js');
var _teso = _leer('assets/tesoreria.js');
ok('Contabilidad tiene la pestaña Conciliación', /<button data-tab="conciliacion">/.test(_html) && /class="conta-tab" data-tab="conciliacion"[\s\S]{0,80}data-concil-puerta="contabilidad"/.test(_html), true);
ok('Tesorería usa la misma pantalla', /class="teso-tab" data-tab="concil"[\s\S]{0,80}data-concil-puerta="tesoreria"/.test(_html), true);
ok('el módulo se carga en la página', /<script src="assets\/conciliacion\.js"><\/script>/.test(_html), true);
ok('la cabecera del estado de cuenta: una por banco y mes', /from\('estados_cuenta'\)\.upsert\(filaCab, \{ onConflict: 'cuenta_teso_id,periodo' \}\)/.test(_concil), true);
ok('las líneas con su huella: cargar dos veces no duplica', /onConflict: 'cuenta_teso_id,huella', ignoreDuplicates: true/.test(_concil), true);
ok('«Aprobar las seguras» solo toma las seguras', /filter\(\(l\) => l\.estado !== 'conciliada' && l\._sug && l\._sug\.seguro\)/.test(_concil), true);
ok('el resumen lo calcula la base', /rpc\('contab_conciliacion_resumen'/.test(_concil), true);
ok('«Dar por cobrado y pagado» lo hace la base', /rpc\('contab_dar_por_cobrado'/.test(_concil), true);
ok('el navegador no hace asientos en la conciliación (solo los lee)', /__postAsiento|from\('asientos'\)\.(insert|update|delete|upsert)/.test(_concil), false);
ok('C2: el saldo de cada factura descuenta lo cobrado o pagado en Tesorería', /cobradoTeso\[d\.tipo \+ '\|' \+ normNum/.test(_concil), true);
ok('C2: las sugerencias ven los movimientos de Tesorería del banco', /movimientos: \(movs\.data \|\| \[\]\)\.filter\(\(m\) => m\.cuenta_teso_id === st\.banco\)/.test(_concil), true);
ok('I1: cada factura sabe si ya se dio por cobrada', /presumido: presumidoEn\(d\.periodo\)/.test(_concil), true);
ok('I4: las fechas pasan por __normFecha y las ilegibles no entran', /window\.__normFecha && window\.__normFecha\(t\)/.test(_concil) && /\.filter\(\(m\) => m\.fecha\)/.test(_concil), true);
// Desde el plan 4b (sql/contabilidad_12) una cuenta en dólares sí se concilia, en Bs a la tasa del día.
ok('4b: una cuenta en divisas se concilia (ya no se bloquea)', /accion = st\.divisas \? ''/.test(_concil), false);

/* -- CONTABILIDAD · PLAN 4b ----------------------------------------------------
   Tesorería y los recibos los contabiliza la base (sql/contabilidad_10 y 11);
   el diferencial cambiario y la revaluación, también (sql/contabilidad_12). */
bloque('Plan 4b: Tesorería y Ventas sin asientos del navegador');
var _tesoSC = _teso.replace(/\/\*[\s\S]*?\*\//g, ' ');
var _factSC = _leer('assets/facturas.js').replace(/\/\*[\s\S]*?\*\//g, ' ');
ok('Ventas: el recibo y la nota ya no hacen asiento en el navegador', /__postAsiento/.test(_factSC), false);
ok('Tesorería: solo queda el reverso de los movimientos de antes del motor', (_tesoSC.match(/__postAsiento\(/g) || []).length, 1);
ok('y ese reverso es solo para contab_motor = false', /if \(vinculado && mov\.contab_motor === false && window\.__postAsiento\)/.test(_teso), true);
ok('un movimiento sin factura pide su cuenta contable', /Sin factura asociada, elige la cuenta contable del movimiento/.test(_teso)
  && /cuenta_contra: String\(v\.factura \|\| ''\)\.trim\(\) \? null : \(ctaC \|\| null\)/.test(_teso), true);
ok('el IGTF de un pago en divisas va con su cuenta 6.3.1.04', /monto: igtf, cuenta_contra: '6\.3\.1\.04'/.test(_teso), true);
ok('la conciliación enlaza el movimiento de Tesorería («ya registrado»)', /movimiento_id: conRef\.id/.test(_concil) && /movimiento_id: l\._sug\.movimiento_id \|\| null/.test(_concil), true);
ok('«Cerrar mes» revalúa los saldos en dólares', /rpc\('contab_revaluar', \{ p_empresa: empId, p_periodo: perDecl \}\)/.test(_appjs), true);
var _sMov = sugerirLinea(_l('PAGO FACT 166 LIGNUM', 446820.19, '0050949046569'), _ctxT);
ok('la sugerencia «ya registrado» trae su movimiento', _sMov && _sMov.movimiento_id, 'm1');
ok('C1: la otra punta de una transferencia ya conciliada sigue disponible como pareja', /o\.clase === 'transferencia' && !o\.extracto_par_id/.test(_concil), true);
ok('I1: elegir a mano una factura ya dada por cobrada la guarda como «ya registrado»', _concil.indexOf("if (d && d.presumido) { fila.clase = 'registrado'; fila.cuenta_contra = d.presumido; }") >= 0, true);
ok('C1: una transferencia elegida a mano busca sola su otra punta', _concil.indexOf('if (par) fila.extracto_par_id = par.id;') >= 0, true);
ok('Tesorería ya no cruza solo por monto', /Pase 2: solo monto|lineasBanco/.test(_teso), false);
ok('ni hace asientos al conciliar', /'Conciliación · '/.test(_teso), false);
ok('sin los botones simulados de la conciliación', /Extracto bancario cargado · conciliando movimientos/.test(_appjs), false);
ok('«Cerrar mes» ofrece la presunción si el mes no tiene estados de cuenta', /from\('estados_cuenta'\)\.select\('id'\)\.eq\('empresa_id', empId\)\.eq\('periodo', perDecl\)[\s\S]{0,700}__darPorCobrado\(perDecl\)/.test(_appjs), true);
ok('al cambiar de empresa se recarga la conciliación', /\['conciliación', \(\) => window\.__recargarConciliacion/.test(_appjs), true);
eval(tramo('  function numCsv(s) {', '  const instancias = [];'));
var _csv = leerCSV('Fecha;Descripción;Referencia;Débito;Crédito\n05/11/2026;PAGO MOVIL;0001;;1.234,56\n06/11/2026;COMISION;0002;12,50;\n');
ok('Excel/CSV: abonos y cargos con su signo', _csv.map(function (x) { return x.monto; }).join(' '), '1234.56 -12.5');
ok('Excel/CSV: la descripción y la referencia', _csv[0].descripcion + '/' + _csv[0].referencia, 'PAGO MOVIL/0001');

console.log('\n' + (fallas ? 'HAY ' + fallas + ' FALLA(S) de ' + total : 'TODO OK · ' + total + ' comprobaciones'));
process.exit(fallas ? 1 : 0);
