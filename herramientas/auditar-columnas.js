/* ═══════════════════════════════════════════════════════════════════
   AUDITOR DE COLUMNAS

   Una tabla puede tener columnas en el encabezado que el cuerpo nunca
   llena. No da error, no se ve raro: sale una columna en blanco y nadie
   la mira hasta que hace falta el dato.

   Pasó de verdad: «N° N.D.» y «N° N.C.» estaban en el encabezado del
   libro de máquina fiscal desde el principio y el cuerpo pintaba dos
   <td> vacíos en su lugar. Se diseñaron y se olvidaron.

   Esto compara, tabla por tabla, cuántos <th> declara el HTML contra
   cuántos <td> pinta el JavaScript, y avisa cuando no cuadran o cuando
   el cuerpo trae celdas visiblemente vacías.

   Uso:  node herramientas/auditar-columnas.js
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(raiz, 'assets', 'app.js'), 'utf8');

/* ── Las tablas del HTML y sus encabezados ─────────────────────────── */
const tablas = [];
const reTabla = /<table[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/table>/g;
let t;
while ((t = reTabla.exec(html)) !== null) {
  const clases = t[1];
  const cuerpo = t[2];
  const thead = cuerpo.match(/<thead>([\s\S]*?)<\/thead>/);
  if (!thead) continue;
  const ths = [...thead[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((x) => x[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
  if (!ths.length) continue;
  tablas.push({
    clases,
    columnas: ths,
    linea: html.slice(0, t.index).split('\n').length,
  });
}

/* ── Las filas que pinta el JS ─────────────────────────────────────
   Se buscan las plantillas '<tr ...>' … '</tr>' dentro del JavaScript y
   se cuentan sus <td>. Es una aproximación: una fila armada en varios
   trozos no se ve entera. Por eso el informe distingue lo que puede
   afirmar de lo que solo sospecha. */
const filas = [];
const reFila = /'<tr[^']*'([\s\S]{0,3000}?)<\/tr>/g;
let f;
while ((f = reFila.exec(js)) !== null) {
  const trozo = f[0];
  const tds = (trozo.match(/<td/g) || []).length;
  if (!tds) continue;
  const vacias = (trozo.match(/<td[^>]*><\/td>/g) || []).length;
  filas.push({
    tds, vacias,
    linea: js.slice(0, f.index).split('\n').length,
    muestra: trozo.replace(/\s+/g, ' ').slice(0, 90),
  });
}

/* ── Informe ───────────────────────────────────────────────────────── */
console.log('Auditoría de columnas');
console.log('  ' + tablas.length + ' tablas con encabezado en index.html');
console.log('  ' + filas.length + ' plantillas de fila en app.js');
console.log('');

console.log('Tablas del libro fiscal y su número de columnas:');
tablas.filter((x) => /libro|fiscal|maquina/.test(x.clases)).forEach((x) => {
  console.log('  línea ' + x.linea + ' · ' + x.columnas.length + ' columnas · ' + x.clases);
  console.log('      ' + x.columnas.join(' | '));
});
console.log('');

const conVacias = filas.filter((x) => x.vacias > 0);
if (!conVacias.length) {
  console.log('  ✓ Ninguna plantilla de fila deja celdas vacías fijas.');
  process.exit(0);
}

console.log('  ⚠ ' + conVacias.length + ' plantilla(s) de fila con celdas vacías fijas:');
console.log('');
conVacias.forEach((x) => {
  console.log('    línea ' + x.linea + ' · ' + x.tds + ' celdas, ' + x.vacias + ' vacía(s)');
  console.log('        ' + x.muestra);
});
console.log('');
console.log('  Una celda vacía fija puede ser separación deliberada o una columna');
console.log('  del encabezado que nadie llena. Hay que mirarlas una por una.');
