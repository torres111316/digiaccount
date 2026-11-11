/* Corre los SQL de la contabilidad y sus pruebas en PGlite (un Postgres
   dentro de Node), sin tocar Supabase.

   Sirve para el ciclo rojo-verde de los SQL: quien construye no puede crear
   tablas en Supabase (eso lo corre Luis a mano en el SQL Editor), así que
   sin esto la primera vez que un SQL se ejecutaría de verdad sería en
   producción.

   Orden: espejo.sql (el esquema mínimo) → sql/contabilidad_*.sql en orden
   de nombre → cada sql/pruebas/contabilidad_*_pruebas.sql. Una prueba falla
   con `raise exception 'FALLA: ...'` y termina con un select de «TODO OK».

   Uso:  cd herramientas/pruebas/sql && npm install && node correr-sql.js
   Con un número, corre los SQL hasta ese y solo su prueba:  node correr-sql.js 03 */
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const RAIZ = path.join(__dirname, '..', '..', '..');
/* SQL previos a la contabilidad, TAL COMO ESTÁN EN SUPABASE. De apertura_empresa.sql
   solo se corrió allá hasta antes de los «AJUSTES · 26/08/2026» (la prueba 13 falló el
   11/11/2026 por la columna `calculado`, que viene en esa parte): se corta ahí. */
const PREVIOS = [['apertura_empresa.sql', '--  AJUSTES · 26/08/2026'], ['condicion_fiscal_historial.sql', null], ['dpp_y_cierres.sql', null]];
const hasta = process.argv[2] || '99';
const sqls = fs.readdirSync(path.join(RAIZ, 'sql'))
  .filter((f) => /^contabilidad_\d\d_.+\.sql$/.test(f) && f.slice(13, 15) <= hasta).sort();
const pruebas = fs.existsSync(path.join(RAIZ, 'sql', 'pruebas'))
  ? fs.readdirSync(path.join(RAIZ, 'sql', 'pruebas'))
    .filter((f) => /^contabilidad_\d\d_pruebas\.sql$/.test(f) && (process.argv[2] ? f.slice(13, 15) === hasta : true)).sort()
  : [];

(async () => {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, 'espejo.sql'), 'utf8'));
  // SQL previos a la contabilidad que esta redefine o usa tal cual (no se copian al espejo).
  for (const [f, corte] of PREVIOS) {
    let txt = fs.readFileSync(path.join(RAIZ, 'sql', f), 'utf8');
    if (corte && txt.indexOf(corte) >= 0) txt = txt.slice(0, txt.lastIndexOf('-- =====', txt.indexOf(corte)));
    try { await db.exec(txt); console.log('  previo    ' + f + (corte ? ' (hasta los ajustes)' : '')); }
    catch (e) { console.log('  ERROR en  ' + f + ': ' + e.message); process.exitCode = 1; return; }
  }
  for (const f of sqls) {
    try { await db.exec(fs.readFileSync(path.join(RAIZ, 'sql', f), 'utf8')); console.log('  aplicado  ' + f); }
    catch (e) { console.log('  ERROR en  ' + f + ': ' + e.message); process.exitCode = 1; return; }
  }
  let fallas = 0;
  for (const f of pruebas) {
    try {
      const r = await db.exec(fs.readFileSync(path.join(RAIZ, 'sql', 'pruebas', f), 'utf8'));
      const ultima = r.filter((x) => x.rows && x.rows.length).pop();
      console.log('  OK  ' + f + (ultima ? ' · ' + Object.values(ultima.rows[0]).join(' ') : ''));
    } catch (e) {
      fallas++;
      console.log('  MAL ' + f + ': ' + e.message);
      try { await db.exec('rollback'); } catch (_) { /* no había transacción abierta */ }
    }
  }
  console.log(fallas ? '\nHAY ' + fallas + ' PRUEBA(S) SQL CON FALLA' : '\nTODO OK · ' + pruebas.length + ' archivo(s) de pruebas SQL');
  if (fallas) process.exitCode = 1;
})();
