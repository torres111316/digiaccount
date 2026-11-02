# Contabilidad · Plan 1 de 6: plan de cuentas y motor de asientos del libro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que toda fila del libro de compras y ventas genere y mantenga su
propio asiento dentro de la base de datos, sin importar por dónde entró
(pantalla, importador, Telegram, script). Debe hacerlo con el plan de cuentas
completo guardado en la base, numeración asignada por la base y la cuenta de
costo o gasto que da el proveedor.

**Architecture:** El plan de cuentas base pasa de filas fijas en `index.html`
a la tabla global `plan_cuentas_base`. Unas funciones de Postgres calculan el
asiento de una fila de `libro_fiscal` (líneas, fecha y período), y un
disparador en esa tabla lo crea, lo actualiza o lo borra, enlazado por
`origen_tabla` y `origen_id`. El navegador deja de contabilizar las filas del
libro y solo recarga.

**Tech Stack:** Postgres (Supabase) con plpgsql, JavaScript plano sin
compilación (`assets/*.js`) y las pruebas de Node en
`herramientas/pruebas/correr.js`.

**Spec:** `docs/superpowers/specs/2026-11-02-contabilidad-design.md`
(secciones 3, 4.1 a 4.4 y 11).

**Los planes que siguen (cada uno sale de este diseño):**
2. Retenciones e impuestos: declaración y pago.
3. Nómina con aportes patronales; activos fijos y depreciación.
4. Conciliación en Contabilidad y Tesorería; «Dar por cobrado y pagado»;
   diferencial cambiario.
5. Reportes con la barra de nivel y período; Flujo de Efectivo; cuadre con
   la Forma 30; asiento de apertura y migración.
6. Reconstrucción de las 16 empresas, con la aprobación de Luis por empresa;
   numeración definitiva al cierre; impresión para libros foliados.

## Global Constraints

- Toda tabla nueva lleva políticas RLS. El proyecto tiene «Enable automatic
  RLS» activo: una tabla nueva nace sin reglas y nadie puede leerla. Hay que
  correr `sql/auditoria_rls.sql` después.
- Ayudantes de seguridad existentes: `mi_cuenta_id()` y `soy_superadmin()`.
- Cada archivo SQL explica arriba por qué existe y termina en un `select`
  que comprueba. Luis los corre a mano en el SQL Editor de Supabase; quien
  construye no tiene acceso de escritura al esquema.
- Fechas del asiento: texto `dd/mm/aaaa`, armado dígito por dígito. Nunca con
  formato regional ni con la fecha UTC (pasadas las 8 p. m. en Venezuela, UTC
  ya es el día siguiente). Zona: `America/Caracas`.
- Período: texto `aaaa-mm`, igual que `libro_fiscal.periodo`.
- Montos redondeados a 2 decimales en cada línea; Debe = Haber exacto por
  asiento.
- Formato de línea de asiento (el que ya usa toda la app):
  `{"cta": "<codigo> · <nombre>", "debe": <num>, "haber": <num>}`.
- El modo de la empresa se deriva de `empresas.fiscal_activo`
  (`true` = libro, `false` = recibos; `assets/app.js:111`). La columna
  `empresas.modo_contabilidad` no se usa.
- Las ANULADAS se reconocen por `tercero_nombre ~* 'ANULAD'`. Las notas de
  crédito por `tipo_doc = 'NC'` (restan). Las `RE` son compras exentas y
  suman.
- Pruebas: `node herramientas/pruebas/correr.js` termina en «TODO OK». Hoy
  son 255 comprobaciones y no pueden bajar.
- Al cambiar `assets/` se sube la versión de `const CACHE` en `sw.js`.
- Commits con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Factura anulada después de tener asiento.** Si una fila se marca
   ANULADA o se borra, su asiento desaparece y no queda nada a medias
   (prueba en la Task 4).
2. **Editar el monto o el período de una factura** actualiza el mismo
   asiento: nunca crea un segundo (prueba en la Task 4).
3. **IVA con muchos decimales** (por ejemplo 33462.736000000004): las líneas
   quedan con 2 decimales y Debe = Haber exacto, ajustando la línea de CxC o
   CxP (prueba en la Task 3).
4. **Carga masiva de cientos de filas** por Telegram o el importador: un
   asiento por fila, con números que no se repiten (prueba en la Task 4).
5. **Meses viejos con asientos resumen o con asientos sueltos del
   navegador**, como Agüero oct-25 a jun-26 con LV/LC y los asientos «auto»
   sin enlace. Editar una de esas filas no puede duplicar el ingreso ni el
   costo (prueba en la Task 4).

---

### Task 1: Plan de cuentas base en la base de datos

**Files:**
- Create: `sql/contabilidad_01_plan_base.sql`
- Modify: `index.html` (tabla dentro de `<div class="conta-tab" data-tab="plan">`, hoy 102 filas fijas)
- Modify: `assets/contabilidad.js:369-388` (`filaCuentaCustom`, `cargarCuentasContables`)
- Modify: `assets/app.js` (todas las apariciones de `'1.1.4.01 · Anticipos a proveedores'`)
- Test: `herramientas/pruebas/correr.js`

**Interfaces:**
- Produces: tabla `plan_cuentas_base(codigo text primary key, nombre text not null, tipo text not null check (tipo in ('Grupo','Cuenta')), naturaleza text not null check (naturaleza in ('Deudora','Acreedora')), uso text)`, con lectura para todo usuario autenticado y escritura solo para `soy_superadmin()`. `uso` vale `'costo'`, `'gasto'`, `'activo_fijo'` o null; sirve para la lista de clasificación de compras de la Task 2.
- Produces: función `plan_de_empresa(p_empresa uuid) returns table(codigo text, nombre text, tipo text, naturaleza text, uso text, propia boolean)`: la base más `cuentas_contables` de esa empresa (las propias con `propia = true`), ordenada por código.

- [ ] **Step 1: Escribir las pruebas que fallan en `correr.js`**

Agregar un bloque `bloque('Plan de cuentas desde la base')` con:
```js
ok('index.html ya no trae filas fijas en el plan de cuentas',
  /data-tab="plan"[\s\S]*?<tbody>\s*<\/tbody>/.test(_html), true);
ok('el plan se carga con plan_de_empresa', /rpc\('plan_de_empresa'/.test(_conta), true);
ok('nadie usa 1.1.4.01 para anticipos a proveedores',
  /1\.1\.4\.01 · Anticipos a proveedores/.test(app), false);
ok('el SQL siembra las 102 cuentas de siempre', (_sqlPlan.match(/^\s*\('/gm) || []).length >= 102, true);
```
(`_html`, `_conta` y `_sqlPlan` se leen con `fs.readFileSync`, igual que `_nom` en la línea 465.)

- [ ] **Step 2: Correr y ver que fallan**

Run: `node herramientas/pruebas/correr.js`
Expected: las 4 comprobaciones nuevas en FALLA.

- [ ] **Step 3: Escribir `sql/contabilidad_01_plan_base.sql`**

Crea la tabla, sus políticas y `plan_de_empresa`, e inserta con
`on conflict (codigo) do update` las 102 filas que hoy están en `index.html`
(código, nombre, tipo, naturaleza tal cual), más estas cuentas nuevas
(spec §5 y §4.1):

| codigo | nombre | tipo | naturaleza | uso |
|---|---|---|---|---|
| 1.1.3.02 | ISLR retenido por terceros | Cuenta | Deudora | |
| 1.1.3.06 | Anticipos de ISLR | Cuenta | Deudora | |
| 1.2.1.07 | Depreciación acumulada edificios (−) | Cuenta | Acreedora | |
| 1.2.1.08 | Depreciación acumulada maquinaria y equipo (−) | Cuenta | Acreedora | |
| 1.2.1.09 | Depreciación acumulada mobiliario y equipo de oficina (−) | Cuenta | Acreedora | |
| 1.2.1.10 | Depreciación acumulada vehículos (−) | Cuenta | Acreedora | |
| 2.1.3.08 | IVSS patronal por pagar | Cuenta | Acreedora | |
| 2.1.3.09 | RPE patronal por pagar | Cuenta | Acreedora | |
| 2.1.3.10 | FAOV patronal por pagar | Cuenta | Acreedora | |
| 2.1.3.11 | INCES patronal por pagar | Cuenta | Acreedora | |
| 2.1.4.04 | IVA por pagar | Cuenta | Acreedora | |
| 2.1.4.05 | IGP por pagar | Cuenta | Acreedora | |
| 2.1.6 | Anticipos recibidos | Grupo | Acreedora | |
| 2.1.6.01 | Anticipos de clientes | Cuenta | Acreedora | |
| 4.2.3.01 | Ganancia en venta de activos | Cuenta | Acreedora | |
| 6.1.1.08 | Aportes patronales IVSS | Cuenta | Deudora | |
| 6.1.1.09 | Aportes patronales RPE | Cuenta | Deudora | |
| 6.1.1.10 | Aportes patronales FAOV | Cuenta | Deudora | |
| 6.1.1.11 | Aportes patronales INCES | Cuenta | Deudora | |
| 6.1.1.12 | Impuestos municipales | Cuenta | Deudora | gasto |
| 6.1.1.13 | Impuesto a los grandes patrimonios | Cuenta | Deudora | |
| 6.1.1.14 | Mantenimiento y reparaciones | Cuenta | Deudora | gasto |
| 6.1.1.15 | Papelería y útiles de oficina | Cuenta | Deudora | gasto |
| 6.1.1.16 | Gastos generales | Cuenta | Deudora | gasto |
| 6.1.1.17 | Depreciación edificios | Cuenta | Deudora | |
| 6.1.1.18 | Depreciación maquinaria y equipo | Cuenta | Deudora | |
| 6.1.1.19 | Depreciación mobiliario y equipo de oficina | Cuenta | Deudora | |
| 6.1.1.20 | Depreciación vehículos | Cuenta | Deudora | |
| 6.3.1.05 | Pérdida en venta de activos | Cuenta | Deudora | |
| 6.4 | Impuesto sobre la Renta | Grupo | Deudora | |
| 6.4.1.01 | Gasto de ISLR | Cuenta | Deudora | |

Y marca `uso` en las existentes: `'costo'` en 5.1.1.02; `'gasto'` en
6.1.1.03, 6.1.1.04, 6.1.1.05, 6.2.1.01, 6.2.1.02, 6.2.1.03 y 6.3.1.02;
`'activo_fijo'` en 1.2.1.01 a 1.2.1.05. El nombre de 1.1.3.02 cambia de
«ISLR retenido / anticipos» a «ISLR retenido por terceros»; ningún asiento lo
usa hoy (verificado el 02/11/2026). El archivo termina en:
`select count(*) as cuentas, count(*) filter (where uso is not null) as clasificables from plan_cuentas_base;`
y el resultado esperado es `cuentas >= 133`.

- [ ] **Step 4: Cargar el plan desde la base**

En `assets/contabilidad.js`, `cargarCuentasContables()` pasa a llamar
`window.sb.rpc('plan_de_empresa', { p_empresa: window.__EMPRESA_ACTIVA.id })`
y pinta todas las filas. Las propias conservan la etiqueta «Propia». La
sangría y las etiquetas se toman de las filas fijas de hoy. Se vacía el
`<tbody>` del plan en `index.html`. `getCuentasPlan()` sigue leyendo la tabla
pintada, así que la Task 2 la reutiliza. En `assets/app.js`, cada
`'1.1.4.01 · Anticipos a proveedores'` pasa a
`'1.1.2.04 · Anticipos a proveedores'`, que es la cuenta del plan.

- [ ] **Step 5: Correr las pruebas**

Run: `node herramientas/pruebas/correr.js`
Expected: `TODO OK`, con las 4 nuevas en OK.

- [ ] **Step 6: Commit**

```bash
git add sql/contabilidad_01_plan_base.sql index.html assets/contabilidad.js assets/app.js herramientas/pruebas/correr.js
git commit -m "Contabilidad: el plan de cuentas vive en la base (plan_cuentas_base)"
```

---

### Task 2: Cuenta contable por proveedor y por factura de compra

**Files:**
- Create: `sql/contabilidad_02_clasificacion.sql`
- Modify: `assets/terceros.js` (formulario de alta y edición de terceros)
- Modify: `assets/app.js` (formulario de registrar o editar compra, ~5640-5790)
- Test: `herramientas/pruebas/correr.js`

**Interfaces:**
- Consumes: `plan_cuentas_base.uso` (Task 1).
- Produces: columna `terceros.cuenta_gasto text` (código de cuenta, por ejemplo `'5.1.1.02'`; null = sin asignar).
- Produces: columna `libro_fiscal.cuenta_contable text` (código; null = usar la del proveedor). Solo tiene sentido en compras.
- Produces: `window.__cuentasClasificables()`, que devuelve `[{codigo, nombre, uso}]` con las cuentas del plan pintado cuyo `uso` es costo, gasto o activo_fijo. Para eso la fila del plan lleva `data-uso`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
bloque('Clasificación de compras');
ok('el tercero tiene cuenta por defecto en su formulario', /name:\s*'cuenta_gasto'/.test(_terceros), true);
ok('la compra guarda cuenta_contable', /cuenta_contable:/.test(app), true);
ok('la compra propone la cuenta del proveedor', /cuenta_gasto/.test(app), true);
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `node herramientas/pruebas/correr.js`
Expected: las 3 nuevas en FALLA.

- [ ] **Step 3: Escribir `sql/contabilidad_02_clasificacion.sql`**

`alter table terceros add column if not exists cuenta_gasto text;` y
`alter table libro_fiscal add column if not exists cuenta_contable text;`.
Las políticas existentes de ambas tablas cubren las columnas nuevas, así que
no hacen falta reglas nuevas. Comprobación final:
`select count(*) filter (where cuenta_gasto is not null) from terceros;`
(esperado: 0).

- [ ] **Step 4: Formularios**

- En el formulario de tercero: un select «Cuenta contable por defecto (si
  es proveedor)» con `window.__cuentasClasificables()`, más «Sin asignar».
- En registrar o editar compra: un select «Cuenta contable», que al elegir
  el proveedor se llena con su `cuenta_gasto` (buscado por RIF en
  `terceros`). Si no tiene, queda «Compra de Mercancía (sin clasificar)» y se
  guarda `cuenta_contable = null`.
- Si el usuario cambia la cuenta en la factura, se guarda en
  `libro_fiscal.cuenta_contable`.

- [ ] **Step 5: Correr las pruebas**

Run: `node herramientas/pruebas/correr.js`
Expected: `TODO OK`.

- [ ] **Step 6: Commit**

```bash
git add sql/contabilidad_02_clasificacion.sql assets/terceros.js assets/app.js herramientas/pruebas/correr.js
git commit -m "Contabilidad: cuenta de costo o gasto por proveedor y por factura"
```

---

### Task 3: Funciones que calculan el asiento de una fila del libro

**Files:**
- Create: `sql/contabilidad_03_funciones.sql`
- Create: `sql/pruebas/contabilidad_03_pruebas.sql`

**Interfaces:**
- Consumes: `plan_cuentas_base` (Task 1); `terceros.cuenta_gasto` y `libro_fiscal.cuenta_contable` (Task 2).
- Produces: `contab_cta(p_codigo text) returns text`, que devuelve `'<codigo> · <nombre>'` desde `plan_cuentas_base` y lanza un error si el código no existe.
- Produces: `contab_fecha_asiento(p_fecha_factura text, p_periodo text, p_registrado timestamptz) returns text` (`dd/mm/aaaa`).
- Produces: `contab_periodo_de(p_fecha_factura text, p_periodo text) returns text` (`aaaa-mm`): `p_periodo` si viene; si no, el mes de la fecha de la factura.
- Produces: `contab_lineas_libro(r libro_fiscal) returns jsonb`: el arreglo de líneas, o `null` si la fila no genera asiento.

- [ ] **Step 1: Escribir las pruebas que fallan en `sql/pruebas/contabilidad_03_pruebas.sql`**

Abre con `begin;` y cierra con `rollback;`. Cada caso es un bloque
`do $$ ... if <falla> then raise exception 'FALLA: <caso>'; end if; ... $$;`,
y al final `raise notice 'TODO OK · contabilidad 03';`. Casos, con estos
valores exactos:

- `contab_fecha_asiento('28/10/26', '2026-11', '2026-11-03 10:00-04')` = `'03/11/2026'` (registrado dentro de su período: manda el día del registro).
- `contab_fecha_asiento('15/03/26', '2026-03', '2026-08-16 09:00-04')` = `'15/03/2026'` (carga de un mes viejo, con la factura dentro del período).
- `contab_fecha_asiento('30/01/26', '2026-02', '2026-08-16 09:00-04')` = `'28/02/2026'` (factura fuera de su período y registro posterior: último día del período).
- `contab_fecha_asiento('05/11/26', '2026-11', '2026-11-06 01:30+00')` = `'05/11/2026'` (01:30 UTC del 6 es todavía el 5 en Caracas).
- Venta con base 1000, iva 160, exento 50, total 1210: líneas
  `[1.1.2.01 debe 1210, 4.1.1.01 haber 1050, 2.1.3.01 haber 160]`.
- Venta por reporte Z (`numero_zeta = '0812'`, sin tercero) con base 500,
  iva 80, total 580: las mismas tres cuentas, con 580, 500 y 80.
- Compra base 209142.1, iva 33462.736000000004, total 242604.836, sin cuenta
  y con proveedor sin `cuenta_gasto`: `5.1.1.02 debe 209142.10`,
  `1.1.3.01 debe 33462.74`, `2.1.1.01 haber 242604.84`. Debe = Haber.
- Compra con `cuenta_contable = '6.1.1.03'`: la primera línea es
  `6.1.1.03 · Alquileres`.
- Compra sin `cuenta_contable` y con proveedor (mismo `cuenta_id`, mismo
  RIF) con `cuenta_gasto = '6.1.1.05'`: la primera línea es `6.1.1.05`.
- Compra RE (base 0, exento 77554.44, total 77554.44): `5.1.1.02 debe 77554.44`
  y `2.1.1.01 haber 77554.44`, sin línea de IVA.
- NC de venta (`tipo_doc = 'NC'`) base 100, iva 16, total 116: las mismas
  cuentas que la venta con debe y haber invertidos.
- Fila con `tercero_nombre = 'ANULADA'`: `null`.
- Venta de una empresa con `fiscal_activo = false`: `null` (en modo recibos
  la venta la contabiliza el recibo).

- [ ] **Step 2: Comprobar que fallan**

Luis corre `sql/pruebas/contabilidad_03_pruebas.sql` en el SQL Editor.
Expected: `ERROR: function contab_fecha_asiento(...) does not exist`.

- [ ] **Step 3: Escribir `sql/contabilidad_03_funciones.sql`**

Regla de fecha (spec §4.3), en este orden:
1. Si el mes de `p_registrado` en `America/Caracas` es igual al período,
   se usa el día del registro.
2. Si no, y la fecha de la factura cae dentro del período, se usa la fecha
   de la factura.
3. Si no, el último día del período.

`p_fecha_factura` viene como `dd/mm/aa` o `dd/mm/aaaa`.

Líneas (spec §4.1):
- **Venta:** Debe 1.1.2.01 por el total / Haber 4.1.1.01 por base + exento /
  Haber 2.1.3.01 por el IVA si es mayor que 0,005.
- **Compra:** Debe la cuenta (`cuenta_contable` → `cuenta_gasto` del
  proveedor → 5.1.1.02) por base + exento / Debe 1.1.3.01 por el IVA si es
  mayor que 0,005 / Haber 2.1.1.01.
- Cada monto se redondea a 2 decimales y la línea de CxC o CxP se calcula
  como la suma redondeada de las otras, así Debe = Haber siempre.
- **NC:** debe y haber invertidos.
- **ANULADA**, o venta con `fiscal_activo = false`: `null`.

El archivo termina en
`select contab_fecha_asiento('28/10/26','2026-11','2026-11-03 10:00-04');`
(esperado: `03/11/2026`).

- [ ] **Step 4: Comprobar que pasan**

Luis corre primero `contabilidad_03_funciones.sql` y después las pruebas.
Expected: `NOTICE: TODO OK · contabilidad 03`, sin ningún `FALLA`.

- [ ] **Step 5: Commit**

```bash
git add sql/contabilidad_03_funciones.sql sql/pruebas/contabilidad_03_pruebas.sql
git commit -m "Contabilidad: funciones de líneas, fecha y período del asiento"
```

---

### Task 4: Disparador que mantiene el asiento de cada fila del libro

**Files:**
- Create: `sql/contabilidad_04_motor.sql`
- Create: `sql/pruebas/contabilidad_04_pruebas.sql`

**Interfaces:**
- Consumes: todo lo de la Task 3.
- Produces: columnas nuevas en `asientos`: `origen_tabla text`, `origen_id uuid` y `periodo text`. Índice único parcial `(origen_tabla, origen_id) where origen_id is not null`.
- Produces: disparador `before insert on asientos`: si `numero` viene null, asigna `max(numero) + 1` de esa empresa, bajo `pg_advisory_xact_lock(hashtext(empresa_id::text))`. Si `periodo` viene null, lo saca de `fecha`.
- Produces: función `contab_sync_libro()` y su disparador `after insert or update or delete on libro_fiscal for each row`.
- Produces: origen de los asientos automáticos = `'motor'`. Descripción: `'Venta · factura <n> · <tercero>'`, `'Venta · reporte Z <n> · máquina <serial>'`, `'Compra · factura <n> · <tercero>'` o `'Nota de crédito · <n> · <tercero>'`. Referencia: `numero_factura`, o `numero_zeta` si es un Z.

- [ ] **Step 1: Escribir las pruebas que fallan en `sql/pruebas/contabilidad_04_pruebas.sql`**

Entre `begin;` y `rollback;`, con una cuenta y una empresa de prueba
creadas dentro de la transacción:

- Insertar una venta crea exactamente 1 asiento con
  `origen_tabla = 'libro_fiscal'`, el `origen_id` de la fila,
  `origen = 'motor'`, el `periodo` de la fila y Debe = Haber.
- Actualizar el monto de esa venta deja 1 asiento, con las líneas nuevas.
- Cambiar el `periodo` de una compra mueve el asiento al período nuevo (con
  la fecha de la regla).
- Marcar la fila `tercero_nombre = 'ANULADA'` deja 0 asientos de esa fila.
- Borrar la fila deja 0 asientos de esa fila.
- Insertar 300 filas en una sola sentencia da 300 asientos con números
  distintos y consecutivos.
- Con un asiento existente de `referencia = 'LV-03/2026'` en la empresa,
  insertar o editar una venta del período `2026-03` no crea asiento (el mes
  ya está contabilizado en resumen).
- Con un asiento existente `origen = 'auto'`, `origen_id` null,
  `referencia = '000144'` y descripción que empieza por `'Venta s/libro'`,
  editar la venta `000144` de esa empresa **adopta** ese asiento (le pone
  `origen_tabla` y `origen_id` y reescribe sus líneas) en vez de crear otro.
  Queda 1 asiento con esa referencia.
- Una venta de una empresa con `fiscal_activo = false` no crea asiento.

- [ ] **Step 2: Comprobar que fallan**

Luis corre las pruebas. Expected: `FALLA` en el primer caso (no se crea
ningún asiento).

- [ ] **Step 3: Escribir `sql/contabilidad_04_motor.sql`**

Columnas, índice, disparador de numeración y `contab_sync_libro`, con esta
lógica:
1. En DELETE, o cuando `contab_lineas_libro` devuelve null, se borra el
   asiento enlazado.
2. Si el período de la fila tiene un asiento `LV-mm/aaaa` (ventas) o
   `LC-mm/aaaa` (compras) en esa empresa, no se hace nada.
3. Si ya existe el asiento enlazado, se actualiza.
4. Si no, se busca uno heredado (`origen = 'auto'`, `origen_id` null, misma
   empresa y referencia, y descripción `'Venta s/libro%'` o `'Compra s/factura%'`
   según el tipo) y se adopta.
5. Si no hay ninguno, se inserta.

La función es `security definer`, con `set search_path = public`, para
escribir en `asientos` sin importar quién insertó la fila. El `cuenta_id`
del asiento es el de la fila.

El archivo termina en:
`select count(*) from pg_trigger where tgname in ('trg_contab_libro','trg_asiento_numero');`
(esperado: `2`).

- [ ] **Step 4: Comprobar que pasan**

Luis corre `contabilidad_04_motor.sql`, después las pruebas y después
`sql/auditoria_rls.sql`.
Expected: `NOTICE: TODO OK · contabilidad 04` y la auditoría sin tablas sin
reglas.

- [ ] **Step 5: Commit**

```bash
git add sql/contabilidad_04_motor.sql sql/pruebas/contabilidad_04_pruebas.sql
git commit -m "Contabilidad: el libro fiscal contabiliza solo desde la base"
```

---

### Task 5: El navegador deja de contabilizar el libro

**Files:**
- Modify: `assets/app.js:5786-5790` (asiento de la compra), `:5880-5885` (asiento de la venta del libro), `:6813` (anulación) y `:6851` (reverso al editar o eliminar)
- Modify: `assets/contabilidad.js:289-301` (`__postAsiento`)
- Modify: `sw.js` (`const CACHE`)
- Test: `herramientas/pruebas/correr.js`

**Interfaces:**
- Consumes: el disparador de la Task 4.
- Produces: `window.__postAsiento(descripcion, referencia, lineas, origen, fecha?)`, que ya no manda `numero` (lo pone la base). El quinto parámetro, opcional, es la fecha `dd/mm/aaaa`; si falta, usa el día de hoy en Caracas. Los demás módulos (recibos, tesorería, nómina) siguen llamándola igual.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
bloque('El libro contabiliza desde la base');
ok('registrar una compra ya no llama a __postAsiento', /__postAsiento\('Compra s\/factura/.test(app), false);
ok('registrar una venta del libro ya no llama a __postAsiento', /__postAsiento\('Venta s\/libro/.test(app), false);
ok('__postAsiento no manda numero', /numero:\s*\(asientoNum/.test(_conta), false);
ok('__postAsiento acepta la fecha como quinto parámetro', /__postAsiento = async function \(descripcion, referencia, lineas, origen, fecha\)/.test(_conta), true);
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `node herramientas/pruebas/correr.js`
Expected: las 4 nuevas en FALLA.

- [ ] **Step 3: Quitar las cuatro llamadas y ajustar `__postAsiento`**

Donde estaban las llamadas, después de guardar la fila queda
`if (window.cargarAsientos) window.cargarAsientos();`. La anulación y el
reverso del libro ya los resuelve el disparador (UPDATE a ANULADA o DELETE).
Los avisos con `toast` sobre la contabilización se quitan, porque ya no hay
nada que pueda fallar en el navegador. Se sube `const CACHE` en `sw.js`.

- [ ] **Step 4: Correr las pruebas**

Run: `node herramientas/pruebas/correr.js`
Expected: `TODO OK`.

- [ ] **Step 5: Commit**

```bash
git add assets/app.js assets/contabilidad.js sw.js herramientas/pruebas/correr.js
git commit -m "Contabilidad: el navegador ya no contabiliza el libro (lo hace la base)"
```

---

### Task 6: Verificación en vivo y despliegue

**Files:**
- Create: `herramientas/verificar_motor_contable.py`

**Interfaces:**
- Consumes: todo lo anterior, ya corrido en Supabase.
- Produces: un script que, con `DA_TOKEN`, inserta en la empresa «DigiAccount» (la del fundador, sin libro fiscal) una venta, una compra y un reporte Z de prueba. Comprueba que nace un asiento por fila con Debe = Haber. Edita la compra y comprueba que el asiento cambia sin duplicarse. Anula la venta y comprueba que su asiento desaparece. Al final borra las filas de prueba y comprueba que no quedó ningún asiento huérfano. Si algo falla imprime `FALLA: ...` y sale con código 1; si no, `TODO OK`.

- [ ] **Step 1: Escribir el script**

Usa `urllib` como los demás de `herramientas/`. El token va siempre en la
variable de entorno `DA_TOKEN`, nunca en la línea de comandos. Antes de
escribir, el script imprime qué va a insertar y en qué empresa.

- [ ] **Step 2: Correrlo antes de que Luis corra los SQL**

Run: `python herramientas/verificar_motor_contable.py`
Expected: `FALLA: la venta de prueba no generó asiento`. Las filas de prueba
quedan borradas igual.

- [ ] **Step 3: Luis corre los SQL**

En orden: `contabilidad_01_plan_base.sql`, `contabilidad_02_clasificacion.sql`,
`contabilidad_03_funciones.sql`, `contabilidad_04_motor.sql`, las dos
pruebas y `auditoria_rls.sql`.

- [ ] **Step 4: Correr el script de nuevo**

Run: `python herramientas/verificar_motor_contable.py`
Expected: `TODO OK`.

- [ ] **Step 5: Commit, push y despliegue**

```bash
git add herramientas/verificar_motor_contable.py
git commit -m "Contabilidad: verificación en vivo del motor del libro"
git push origin main
```
Luis le da Implementar al servicio `app` en EasyPanel
(panel.digiaccount.io → digiaccount → app).

- [ ] **Step 6: Prueba de Luis en la app**

Luis registra una compra real en una empresa. Expected: en el Libro Diario
aparece su asiento con la fecha de hoy, la cuenta de su proveedor (o
«Compra de Mercancía» si no tiene) y el número siguiente.
