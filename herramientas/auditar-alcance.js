/* ═══════════════════════════════════════════════════════════════════
   AUDITOR DE ALCANCE ENTRE MÓDULOS

   app.js está partido en IIFEs —(function facturas() { … })()— y cada una
   es un alcance cerrado. Llamar desde una a una función declarada en otra
   compila perfecto y revienta al ejecutar:

       ReferenceError: notasZTxt is not defined

   `node --check` NO lo ve: la sintaxis es correcta. El fallo solo aparece
   cuando alguien recorre ese camino, que puede ser semanas después y
   delante de un cliente. Pasó dos veces en un mismo día.

   ─────────────────────────────────────────────────────────────────────
   POR QUÉ SE MIRA LA INDENTACIÓN Y NO SE ANALIZA EL CÓDIGO

   Las dos primeras versiones intentaban enmascarar comentarios y cadenas
   para después buscar con expresiones regulares. Las dos fallaron:

     1ª  `global` se calculaba sobre el archivo entero, módulos incluidos,
         así que todo lo declarado en cualquier sitio parecía global y la
         comprobación dejaba pasar siempre.
     2ª  El enmascarado se rompía con las expresiones regulares que llevan
         comillas dentro —`replace(/"/g, '""')`— porque veía esa comilla
         como el principio de una cadena y se tragaba el resto del
         archivo. De 96 módulos detectados pasó a 27, y con ellos las
         fronteras se volvieron mentira.

   Distinguir una barra de división de una expresión regular requiere un
   analizador de verdad. No hace falta: este archivo sigue una convención
   estricta que sí es fiable leer por líneas —los módulos abren con dos
   espacios y cierran igual—, y sobre eso no hay ambigüedad posible.

   CÓMO SE PRUEBA QUE FUNCIONA
   Contra el fallo real, sembrado a propósito en una copia. Un detector
   que nunca ha detectado nada es peor que no tenerlo: da confianza falsa.
   Si se toca este archivo, se vuelve a sembrar el fallo y se comprueba.

   Uso:  node herramientas/auditar-alcance.js [ruta/app.js]
   Sale con código 1 si encuentra algo.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

const ARCHIVO = process.argv[2] || path.join(__dirname, '..', 'assets', 'app.js');
const src = fs.readFileSync(ARCHIVO, 'utf8');
const L = src.split('\n');

/* ── 1. Fronteras por indentación ───────────────────────────────────
   Un módulo abre con «  (function nombre() {» a dos espacios y cierra
   con «  })();» a dos espacios. Es una convención del archivo, no una
   ley del lenguaje, así que se comprueba: si aparecen aperturas sin
   cierre el auditor lo dice en vez de callarse. */
const modulos = [];
const abiertos = [];
L.forEach((linea, i) => {
  const abre = linea.match(/^ {2}\(function\s*([A-Za-z_$][\w$]*)?\s*\(/);
  if (abre) { abiertos.push({ nombre: abre[1] || '(anónima)', desde: i + 1 }); return; }
  if (/^ {2}\}\)\(\);?\s*$/.test(linea) && abiertos.length) {
    const m = abiertos.pop();
    m.hasta = i + 1;
    modulos.push(m);
  }
});

if (abiertos.length) {
  console.log('⚠ ' + abiertos.length + ' módulo(s) abiertos sin cierre reconocible:');
  abiertos.forEach((a) => console.log('    «' + a.nombre + '» desde la línea ' + a.desde));
  console.log('  La convención de indentación cambió. Revisa este auditor antes de creerle.');
  console.log('');
}

/* ── 2. Qué declara cada módulo, a su nivel ─────────────────────────
   Cuatro espacios: las declaraciones directas del módulo. Las de más
   adentro son locales de otra función y no interesan aquí. */
const dondeSeDeclara = new Map();   // nombre -> [módulos que lo declaran]
modulos.forEach((mod) => {
  for (let i = mod.desde; i < mod.hasta; i++) {
    const d = (L[i] || '').match(/^ {4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
      || (L[i] || '').match(/^ {4}(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/);
    if (!d) continue;
    const lista = dondeSeDeclara.get(d[1]) || [];
    if (lista.indexOf(mod) < 0) lista.push(mod);
    dondeSeDeclara.set(d[1], lista);
  }
});

/* Solo interesan las declaradas en UN módulo.

   `fmt`, `esc`, `cerrar` y compañía los declara cada módulo por su
   cuenta. Quedarse con uno y marcar los demás usos como si cruzaran la
   frontera fue la tercera tanda de falsos positivos de esta herramienta.
   Si el nombre vive en dos o más módulos, cada uno tiene el suyo. */
const declaraciones = new Map();
dondeSeDeclara.forEach((lista, nombre) => {
  if (lista.length === 1) declaraciones.set(nombre, lista[0]);
});

/* Y el módulo que la llama puede declararla más adentro, dentro de otra
   función, con más de cuatro espacios. Se mira a cualquier profundidad
   antes de acusar. */
function declaraDentro(mod, nombre) {
  const re = new RegExp('(?:function\\s+|(?:const|let|var)\\s+)' + nombre.replace(/\$/g, '\\$') + '\\b');
  for (let i = mod.desde; i < mod.hasta; i++) if (re.test(L[i] || '')) return true;
  return false;
}

/* Lo que se expone en window queda fuera de sospecha: es justamente la
   forma correcta de cruzar de un módulo a otro. */
const enWindow = new Set();
let w;
const reWin = /window\.([A-Za-z_$][\w$]*)\s*=/g;
while ((w = reWin.exec(src)) !== null) enWindow.add(w[1]);

/* Y lo declarado a nivel de archivo (dos espacios, fuera de módulos)
   lo ve todo el mundo. */
const nivelArchivo = new Set();
L.forEach((linea, i) => {
  const dentro = modulos.some((m) => i + 1 > m.desde && i + 1 < m.hasta);
  if (dentro) return;
  /* A CUALQUIER profundidad, no solo a dos espacios.

     `elegir` se declara con cuatro, dentro de una función que vive a
     nivel de archivo, y `bs` dentro del propio helper que la usa. Mirar
     solo el margen las daba por ajenas. */
  const d = linea.match(/(?:^|[^\w$.])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
    || linea.match(/(?:^|[^\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (d) nivelArchivo.add(d[1]);
});

/* Deja solo el código de una línea: vacía las cadenas y corta el
   comentario final. Ahí vivían todos los falsos positivos —«Monto total
   (Bs)», «Forzar nivel (dejar vacío…», «prestar y (a)…»—: palabras en
   español seguidas de un paréntesis.

   Se limpia LÍNEA A LÍNEA y no el archivo entero. Es lo que evita el
   error de la segunda versión de esta herramienta, donde una expresión
   regular con comillas dentro abría una cadena falsa que se tragaba
   todo lo que venía después. Aquí el daño máximo de una línea rara es
   esa línea. */
function limpiar(linea) {
  let t = String(linea == null ? '' : linea);
  t = t.replace(/'(?:\\.|[^'\\])*'/g, "''");
  t = t.replace(/"(?:\\.|[^"\\])*"/g, '""');
  t = t.replace(/`(?:\\.|[^`\\])*`/g, '``');
  const c = t.indexOf('//');
  if (c >= 0) t = t.slice(0, c);
  return t;
}

/* ── 3. ¿Alguien la llama desde fuera de su módulo? ─────────────────
   Se salta la línea que es un comentario entero: ahí es donde se
   escondían los treinta y cuatro falsos de la versión anterior. */
const hallazgos = [];
declaraciones.forEach((mod, nombre) => {
  if (enWindow.has(nombre) || nivelArchivo.has(nombre)) return;
  const re = new RegExp('(^|[^\\w$.])' + nombre.replace(/\$/g, '\\$') + '\\s*\\(');
  for (let i = 0; i < L.length; i++) {
    const n = i + 1;
    if (n > mod.desde && n < mod.hasta) continue;       // en su casa: bien
    const cruda = L[i] || '';
    // Comentario de bloque: la línea empieza con /* o continúa con *
    if (/^\s*(\*|\/\*)/.test(cruda)) continue;
    const linea = limpiar(cruda);
    if (!linea.trim()) continue;
    if (!re.test(linea)) continue;
    /* Llamada protegida: `elegir && elegir(t)` es el modismo de un
       parámetro opcional. Si no viene, no se llama — no puede reventar. */
    if (new RegExp(nombre.replace(/\$/g, '\\$') + '\\s*&&\\s*' + nombre.replace(/\$/g, '\\$') + '\\s*\\(').test(linea)) continue;
    if (new RegExp('function\\s+' + nombre.replace(/\$/g, '\\$') + '\\s*\\(').test(linea)) continue;
    const suyo = modulos.filter((x) => n > x.desde && n < x.hasta).pop();
    if (suyo && declaraDentro(suyo, nombre)) continue;   // tiene el suyo propio
    hallazgos.push({ nombre, linea: n, donde: suyo ? suyo.nombre : '(nivel de archivo)', definida: mod.nombre });
  }
});

/* ── 4. Informe ─────────────────────────────────────────────────────── */
console.log('Auditoría de alcance · ' + path.basename(ARCHIVO));
console.log('  ' + L.length + ' líneas · ' + modulos.length + ' módulos · '
  + declaraciones.size + ' funciones de módulo · ' + enWindow.size + ' en window');
console.log('');

if (!hallazgos.length) {
  console.log('  ✓ Ninguna función de módulo se llama desde fuera de su módulo.');
  process.exit(0);
}

const porNombre = {};
hallazgos.forEach((h) => { (porNombre[h.nombre] = porNombre[h.nombre] || []).push(h); });
console.log('  ✗ ' + Object.keys(porNombre).length + ' función(es) llamadas fuera de su módulo:');
console.log('');
Object.keys(porNombre).forEach((n) => {
  const hs = porNombre[n];
  console.log('    ' + n + '()  — declarada en «' + hs[0].definida + '»');
  hs.forEach((h) => console.log('        línea ' + h.linea + ', dentro de «' + h.donde + '»  ·  '
    + (L[h.linea - 1] || '').trim().slice(0, 78)));
  console.log('');
});
console.log('  Cada una revienta con ReferenceError al recorrer ese camino.');
console.log('  Se arregla subiéndola a window.* o moviéndola al módulo que la usa.');
process.exit(1);
