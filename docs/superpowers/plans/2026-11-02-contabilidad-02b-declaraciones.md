# Contabilidad · Plan 2b: declaraciones y pagos de impuestos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Luis registre en el módulo Fiscal cada declaración presentada al
SENIAT y su pago, copiando los datos de la planilla, y que de ahí nazcan
solos los asientos. Al declarar, el impuesto pasa al pasivo; al pagar, se
cruza contra el banco.

**Architecture:** Usa la tabla existente `declaraciones` (`sql/declaraciones.sql`),
a la que se le agregan los datos del pago. Un disparador en esa tabla crea
dos asientos enlazados: el de la declaración (`origen_tabla = 'declaraciones'`)
y el del pago (`origen_tabla = 'declaraciones_pago'`), con el mismo patrón de
los motores anteriores. En el módulo Fiscal se agrega la pestaña
«Declaraciones y pagos», con sus dos formularios.

**Tech Stack:** Postgres (Supabase) con plpgsql, PGlite para las pruebas SQL y
JavaScript plano (`assets/app.js`, `index.html`).

**Spec:** `docs/superpowers/specs/2026-11-02-contabilidad-design.md` §5. La
descripción la aprobó Luis en el chat el 02/11/2026.

## Lo que aprobó Luis (no se reabre)

- Registro manual mientras no esté activa la Bóveda (Supabase Pro). Después,
  al mismo registro se le adjuntarán los PDF y un agente leerá la planilla.
- Una declaración: impuesto, período (mes o quincena), originaria o
  sustitutiva, N° de planilla, fecha de presentación y monto a pagar.
- Su pago: fecha, N° de recibo o certificado y banco de donde salió.

| Impuesto (código) | Al declarar | Al pagar |
|---|---|---|
| `IVA`, `RET_IVA`, `RET_ISLR`, `IGTF` | Sin asiento: ya están en el pasivo (2.1.4.04, 2.1.3.02, 2.1.3.03, 2.1.4.03). Si lo declarado no coincide con la contabilidad, aviso de la diferencia | Debe pasivo / Haber banco |
| `DPP` | Debe 6.1.1.07 / Haber 2.1.5.03 | Debe 2.1.5.03 / Haber banco |
| `IGP` | Debe 6.1.1.13 / Haber 2.1.4.05 | Debe 2.1.4.05 / Haber banco |
| `MUNICIPAL` | Debe 6.1.1.12 / Haber 2.1.4.02 | Debe 2.1.4.02 / Haber banco |
| `ISLR_ANTICIPO` | Debe 1.1.3.06 / Haber 2.1.4.01 | Debe 2.1.4.01 / Haber banco |
| `ISLR_ANUAL` | Debe 6.4.1.01 por el impuesto (`monto`) / Haber 2.1.4.01 por `a_pagar` / Haber la diferencia: primero contra Anticipos de ISLR (1.1.3.06, hasta su saldo) y el resto contra ISLR retenido por terceros (1.1.3.02) | Debe 2.1.4.01 / Haber banco |

- Una sustitutiva genera un asiento de declaración solo por la diferencia
  con la anterior del mismo impuesto y período.
- El banco del pago es una cuenta de efectivo del plan (grupo 1.1.1). Por
  defecto, 1.1.1.03 Bancos.
- Las 19 declaraciones de DPP que ya existen no generan asientos solas:
  entran en la reconstrucción (plan 6).

## Global Constraints

- Las mismas del plan 1 y del plan 2: RLS, SQL re-ejecutable con
  comprobación final, `security definer` con `search_path = public, pg_temp`,
  2 decimales y Debe = Haber, pruebas SQL filtrando por la empresa de prueba,
  y `correr.js` y `correr-sql.js` en verde.
- `declaraciones.fecha` y `fecha_pago` son `date` (no texto); la fecha del
  asiento se arma `dd/mm/aaaa` desde ellas.
- El disparador solo se activa al insertar o borrar, o al cambiar
  `impuesto, periodo, quincena, tipo, monto, a_pagar, fecha, fecha_pago,
  cuenta_pago`. Así, que `cargar_declaraciones.py` vuelva a escribir el
  estado no contabiliza de a poco las 19 viejas.
- Subir `const CACHE` en `sw.js`.

## Review Focus

1. **Borrar o cambiar el pago**, quitándole la fecha: su asiento de pago desaparece; el de la declaración queda (Task 1).
2. **Sustitutiva de DPP con más o con menos**: el asiento es solo por la diferencia, a favor o en contra (Task 1).
3. **ISLR anual con anticipos insuficientes**: el resto va a 1.1.3.02 y el asiento cuadra (Task 1).
4. **Declaración con `a_pagar` = 0**: sin asiento de pago, aunque se cargue una fecha de pago (Task 1).
5. **Registrar dos veces la misma planilla**: la llave única (empresa, impuesto, número) lo impide y la pantalla muestra el mensaje en español (Task 2).

---

### Task 1: Motor de asientos de declaraciones y pagos

**Files:**
- Create: `sql/contabilidad_06_declaraciones.sql`
- Create: `sql/pruebas/contabilidad_06_pruebas.sql`
- Modify: `herramientas/pruebas/sql/espejo.sql` (tabla `declaraciones`)

**Interfaces:**
- Produces: columnas nuevas en `declaraciones`: `fecha_pago date`, `numero_pago text`, `cuenta_pago text` (código del plan; null = 1.1.1.03).
- Produces: `contab_lineas_declaracion(d declaraciones) returns jsonb` y `contab_lineas_pago(d declaraciones) returns jsonb` (null = sin asiento).
- Produces: `contab_sync_declaracion()` y el disparador `trg_contab_declaracion`.
- Produces: `contab_declarado_vs_contable(p_empresa uuid, p_impuesto text, p_periodo text, p_quincena int) returns numeric`. Devuelve lo que la contabilidad dice que se debe por ese impuesto y período, para el aviso de diferencias:
  - `IVA`: el haber en 2.1.4.04 de la `F30-mm/aaaa`.
  - `RET_IVA` y `RET_ISLR`: la suma de las retenciones practicadas no anuladas del período, y de la quincena si viene.
  - `IGTF`: la suma de `igtf` de las ventas del período, y de la quincena por el día de la factura.
  - Para los demás impuestos, null.
- Produces: descripciones `'Declaración <IMPUESTO> <período>[ · quincena q] · planilla <n>'` y `'Pago <IMPUESTO> <período>[ · quincena q] · recibo <n>'`.

- [ ] **Step 1: Pruebas que fallan** (cuenta de prueba con plan `contador_basico`):
  - DPP a_pagar 9000: declaración `6.1.1.07 D9000 | 2.1.5.03 H9000`.
  - DPP con pago (fecha_pago `2026-11-05`, sin cuenta_pago): pago `2.1.5.03 D9000 | 1.1.1.03 H9000`, con fecha `05/11/2026`.
  - Pago con `cuenta_pago = '1.1.1.01'`: el haber va a Caja.
  - IVA a_pagar 500: sin asiento de declaración; con pago, `2.1.4.04 D500 | 1.1.1.03 H500`.
  - RET_IVA, RET_ISLR e IGTF: pago contra 2.1.3.02, 2.1.3.03 y 2.1.4.03.
  - ISLR_ANTICIPO 300: `1.1.3.06 D300 | 2.1.4.01 H300`.
  - ISLR_ANUAL monto 1000, a_pagar 400, con saldo previo de 1.1.3.06 = 250: `6.4.1.01 D1000 | 2.1.4.01 H400 | 1.1.3.06 H250 | 1.1.3.02 H350`.
  - Sustitutiva de DPP con a_pagar 9500 sobre la originaria de 9000: `6.1.1.07 D500 | 2.1.5.03 H500`. Con 8800: `2.1.5.03 D200 | 6.1.1.07 H200`.
  - a_pagar 0 con fecha de pago: sin asiento de pago.
  - Quitar la fecha de pago borra el asiento de pago y deja el de la declaración. Borrar la declaración deja 0 asientos.
  - Cambiar solo `estado` o `nota` no crea asientos para una declaración vieja.
  - `contab_declarado_vs_contable` para RET_IVA de una quincena, con dos retenciones practicadas de 75 y 25: `100.00`.

- [ ] **Step 2: Ver que fallan.** Run: `cd herramientas/pruebas/sql && node correr-sql.js 06`.

- [ ] **Step 3: Escribir el SQL.** La fecha del asiento de declaración es `fecha`; si falta, el último día del período. La del pago es `fecha_pago`. El período del asiento es el de la declaración en los dos casos. El saldo de 1.1.3.06 para ISLR_ANUAL se toma de los asientos de la empresa con `periodo <= ` el de la declaración. Comprobación final: el disparador existe (`1`).

- [ ] **Step 4: Pruebas en verde** (06, más 03, 04 y 05).

- [ ] **Step 5: Commit** — `Contabilidad: declaraciones y pagos de impuestos contabilizan solos`.

---

### Task 2: Pestaña «Declaraciones y pagos» en Fiscal

**Files:**
- Modify: `index.html` (botón en `#fiscalTabs` y `<div class="fiscal-tab" data-tab="declaraciones">`)
- Modify: `assets/app.js` (nuevo bloque `declaracionesYPagos`, junto al resto de Fiscal)
- Modify: `assets/contabilidad.js` (`window.__cuentasEfectivo()`)
- Modify: `sw.js`
- Test: `herramientas/pruebas/correr.js`

**Interfaces:**
- Consumes: la tabla y `contab_declarado_vs_contable` (Task 1).
- Produces: `window.__cuentasEfectivo()`, que devuelve `[{codigo, nombre}]` con las cuentas del plan cuyo código empieza por `1.1.1.` y no son grupo.
- Produces: `window.cargarDeclaraciones()`, que pinta la lista de la empresa activa.

- [ ] **Step 1: Pruebas que fallan:**
```js
bloque('Declaraciones y pagos');
ok('Fiscal tiene la pestaña de declaraciones', /data-tab="declaraciones"/.test(_html), true);
ok('se registra una declaración en la tabla declaraciones', /from\('declaraciones'\)\.insert/.test(_appjs), true);
ok('el pago guarda fecha, recibo y banco', /fecha_pago:[\s\S]{0,200}numero_pago:[\s\S]{0,200}cuenta_pago:/.test(_appjs), true);
ok('se avisa la diferencia con la contabilidad', /rpc\('contab_declarado_vs_contable'/.test(_appjs), true);
ok('una planilla repetida da un mensaje claro', /23505/.test(_appjs) && /ya está registrada/.test(_appjs), true);
ok('hay lista de cuentas de efectivo para el banco del pago', /window\.__cuentasEfectivo\s*=/.test(_conta), true);
```

- [ ] **Step 2: Ver que fallan.**

- [ ] **Step 3: Construir la pestaña.** Una tabla con Impuesto, Período, Tipo, N° planilla, Fecha, A pagar, Contabilidad (con la diferencia en rojo si pasa de 0,01), Estado (Pagada / Pendiente de pago / Sin pago) y acciones: «Registrar pago», editar y eliminar. El formulario de declaración usa `openFormModal` con impuesto (lista de los 9 códigos con nombre legible), período (`_opcionesPeriodo()`), quincena (solo para RET_IVA, IGTF y RET_ISLR: «Mes completo / 1 / 2»), tipo, número, fecha, monto y a pagar (para todo impuesto menos ISLR_ANUAL, a pagar se iguala a monto). El formulario del pago pide fecha, N° de recibo y banco (`__cuentasEfectivo()`, por defecto 1.1.1.03). Si el insert da el error `23505`: «Esa planilla ya está registrada para esta empresa». Al guardar, recargar la lista y el Libro Diario. Subir `sw.js`.

- [ ] **Step 4: Pruebas en verde.**

- [ ] **Step 5: Commit** — `Fiscal: pestaña Declaraciones y pagos`.

---

### Task 3: Verificación en vivo y despliegue

- [ ] **Step 1:** Agregar a `herramientas/verificar_motor_contable.py` una declaración DPP de prueba (planilla `PRUEBA-MOTOR-D`) con su pago: deben nacer 2 asientos cuadrados, quitar la fecha de pago deja 1 y al final se borra todo.
- [ ] **Step 2:** Correrlo antes del SQL 06. Expected: FALLA en la declaración, sin dejar filas.
- [ ] **Step 3:** Luis corre `contabilidad_06_declaraciones.sql` y su prueba.
- [ ] **Step 4:** Script `TODO OK`. Push a `main` y Luis le da Implementar.
