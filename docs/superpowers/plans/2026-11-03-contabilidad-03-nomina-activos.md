# Contabilidad · Plan 3: nómina con aportes patronales y activos fijos con su depreciación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al contabilizar la nómina entren también los aportes patronales,
con la fecha de su período y sin duplicar si se contabiliza dos veces. Y que
los activos fijos nazcan de la factura del proveedor, se deprecien solos una
vez por mes y se puedan vender o desincorporar con su asiento.

**Architecture:** La nómina sigue calculándose en el navegador (`calcPago`,
`assets/nomina.js`). Su asiento pasa por una función pura
`lineasAsientoNomina` que se prueba sola, lleva la fecha del último día del
período y reemplaza el anterior del mismo período. Los activos fijos
usan la tabla `activos_fijos` y una tabla nueva, `activos_depreciacion`
(una fila por activo y mes). La depreciación y la baja son funciones de la
base (`contab_depreciar`, `contab_baja_activo`), con `security invoker`
para que manden las reglas RLS. La compra de un activo ya genera su asiento
con el motor del plan 1 (la cuenta 1.2.1.x es la `cuenta_contable` de la
factura); aquí solo se crea su ficha.

**Spec:** `docs/superpowers/specs/2026-11-02-contabilidad-design.md` §4.1
(nómina) y la sección «Activos fijos y depreciación».

## Decisiones de quien construye (avisadas a Luis)

- **Bases de los aportes patronales:** las mismas que usa hoy la nómina para
  las retenciones del trabajador. IVSS sobre `baseIvss` (con tope de 5
  salarios mínimos), RPE sobre `baseRpe` (tope de 10), FAOV e INCES sobre el
  salario normal (`asigSalarial`). Los porcentajes salen de
  `parametros_nomina` (`ivss_pat`, `rpe_pat`, `faov_pat`, `inces_pat`): los
  define el Lic. Romero y este plan no los cambia. La DPP **no** va en la
  nómina: se causa al declararla (plan 2b).
- **Categorías y cuentas:**

| Categoría | Activo | Depreciación acumulada | Gasto de depreciación |
|---|---|---|---|
| Inmuebles | 1.2.1.02 | 1.2.1.07 | 6.1.1.17 |
| Maquinaria | 1.2.1.03 | 1.2.1.08 | 6.1.1.18 |
| Equipos | 1.2.1.04 | 1.2.1.09 | 6.1.1.19 |
| Mobiliario | 1.2.1.04 | 1.2.1.09 | 6.1.1.19 |
| Vehículos | 1.2.1.05 | 1.2.1.10 | 6.1.1.20 |
| Terrenos | 1.2.1.01 | — (no se deprecian) | — |

- **Métodos:**
  - Línea recta: (costo − valor residual) / (vida útil en meses).
  - Saldos decrecientes (doble saldo decreciente): (costo − acumulada) × 2 / vida útil / 12.
  - Con cualquiera de los dos, nunca se pasa de costo − valor residual. Arranca el mes siguiente al de la adquisición.

## Global Constraints

- Las mismas de los planes anteriores: RLS en tablas nuevas, SQL
  re-ejecutable, 2 decimales y Debe = Haber, pruebas SQL filtrando por la
  empresa de prueba, y `correr.js` y `correr-sql.js` en verde. Subir `sw.js`.
- Fechas `dd/mm/aaaa` armadas a mano; períodos `aaaa-mm`.
- Las funciones nuevas de la base que escriben asientos son `security
  invoker`: un usuario solo puede depreciar o dar de baja activos de las
  empresas que su RLS le deja ver.
- Fuera los dos botones con cifras de ejemplo de `assets/app.js`
  (~7655-7676, `deprViewBtn` y `deprPostBtn`).

## Review Focus

1. **Contabilizar dos veces la misma nómina** (mismo período y frecuencia): queda un solo asiento (Task 1).
2. **Depreciar dos veces el mismo mes**: una sola cuota por activo, y el asiento no se duplica (Task 2).
3. **Activo que llega a su valor residual**: la última cuota es lo que falta, y después ninguna (Task 2).
4. **Vender un activo a medio depreciar**: el asiento cuadra con ganancia o pérdida, y deja de depreciarse (Task 2).
5. **Compra marcada como activo y después editada o borrada**: la ficha sigue a su factura (Task 3).

---

### Task 1: Nómina con aportes patronales

**Files:**
- Modify: `assets/nomina.js` (`contabilizarNomina`, ~100-128; nueva `lineasAsientoNomina`)
- Test: `herramientas/pruebas/correr.js`

**Interfaces:**
- Produces: `lineasAsientoNomina(pagos, tasas)`, donde `pagos` es la lista de lo que devuelve `calcPago` y `tasas` es `{ivssP, rpeP, faovP, incesP}`. Devuelve las líneas del asiento, con Debe = Haber.

- [ ] **Step 1: Pruebas que fallan** (con `eval(tramo(...))`, como `aniosServicio`):
  - Dos pagos de prueba con `asigSalarial` 1000 y 2000, `baseIvss` 1000 y 2000, `baseRpe` 1000 y 2000, beneficios 500, retenciones 40/5/10 y 80/10/20, y tasas 11/2/2/2 %. Las líneas deben traer:
    - Sueldos 6.1.1.01 D3000; Beneficios 6.1.1.02 D500.
    - Aportes 6.1.1.08 D330, 6.1.1.09 D60, 6.1.1.10 D60, 6.1.1.11 D60.
    - Pasivos del trabajador: 2.1.3.04 H120, 2.1.3.05 H15, 2.1.3.06 H30.
    - Pasivos patronales: 2.1.3.08 H330, 2.1.3.09 H60, 2.1.3.10 H60, 2.1.3.11 H60.
    - Bancos H3335 (el neto: 3000 + 500 − 165).
    - Debe = Haber.
  - `contabilizarNomina` pasa la fecha del último día del período a `__postAsiento`, reemplaza el asiento anterior con la misma referencia `NOM-<frec>-<aaaa-mm[-dd]>` y ya no usa la cuenta de grupo `2.1.5`.
- [ ] **Step 2: Ver que fallan.**
- [ ] **Step 3: Implementar.** Las otras deducciones del trabajador (caja de ahorro, préstamos, anticipos) van a 2.1.5.01 *Otras cuentas por pagar*. Esa cuenta se agrega al plan en el SQL 07. Antes de reemplazar, se pide confirmación.
- [ ] **Step 4: Pruebas en verde.**
- [ ] **Step 5: Commit** — `Nómina: el asiento lleva los aportes patronales, su fecha y no se duplica`.

---

### Task 2: Depreciación y baja de activos en la base

**Files:**
- Create: `sql/contabilidad_07_activos.sql`
- Create: `sql/pruebas/contabilidad_07_pruebas.sql`
- Modify: `herramientas/pruebas/sql/espejo.sql` (`activos_fijos`)

**Interfaces:**
- Produces: columnas nuevas en `activos_fijos`: `valor_residual numeric default 0`, `libro_fiscal_id uuid`, `estado text default 'en uso'`, `fecha_baja date`, `depreciacion_inicial numeric default 0` (la que traen los activos migrados).
- Produces: la tabla `activos_depreciacion (activo_id, empresa_id, cuenta_id, periodo, monto)`, única por (activo_id, periodo), con RLS por la empresa del activo.
- Produces: `contab_cuentas_activo(categoria text)` → `(activo text, acumulada text, gasto text)`.
- Produces: `contab_depreciar(p_empresa uuid, p_periodo text) returns numeric`. Rehace las cuotas de ese mes y el asiento `DEPR-mm/aaaa` (una línea de gasto y una de acumulada por categoría). Devuelve el total.
- Produces: `contab_baja_activo(p_activo uuid, p_fecha date, p_precio numeric, p_cuenta_cobro text) returns void`.
- Produces: la cuenta 2.1.5.01 *Otras cuentas por pagar* en `plan_cuentas_base`.

- [ ] **Step 1: Pruebas que fallan:**
  - Línea recta: costo 1200, vida 1 año, residual 0, adquirido el 15/01/2026. En enero no hay cuota; en febrero, 100.
  - Depreciar febrero dos veces da una sola cuota y un solo asiento `DEPR-02/2026`, con 6.1.1.19 D100 / 1.2.1.09 H100 para un equipo.
  - Residual: costo 1000, residual 400, vida 1 año. Cuota de 50; al llegar a 600 de acumulada, la siguiente es 0.
  - Saldos decrecientes: costo 1000, vida 5. Primer mes: 33,33.
  - Un terreno no se deprecia.
  - Venta a medio depreciar: costo 1200, acumulada 300, precio 1000. Asiento: 1.2.1.09 D300 / 1.1.1.03 D1000 / 1.2.1.04 H1200 / 4.2.3.01 H100. Después de la baja, ya no hay cuotas.
  - Desincorporación (precio 0) con acumulada 300: la pérdida de 900 va a 6.3.1.05.
  - Un activo con `depreciacion_inicial` 500 solo deprecia lo que le falta.
- [ ] **Step 2: Ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pruebas en verde** (con las 03 a 06).
- [ ] **Step 5: Commit** — `Contabilidad: depreciación mensual y baja de activos fijos desde la base`.

---

### Task 3: Activos fijos en la pantalla

**Files:**
- Modify: `assets/app.js` (registrar y editar compra; «Cerrar mes»; fuera `deprViewBtn` y `deprPostBtn`)
- Modify: `assets/contabilidad.js` (registrar activo, depreciación del mes, baja)
- Modify: `index.html` (los botones de la pestaña de activos)
- Modify: `sw.js`
- Test: `herramientas/pruebas/correr.js`

- [ ] **Step 1: Pruebas que fallan:**
  - Una compra con cuenta de `uso = 'activo_fijo'` pide el nombre del activo, la categoría, la vida útil, el valor residual y el método, y crea su ficha en `activos_fijos` con `libro_fiscal_id`.
  - El botón de depreciación llama `rpc('contab_depreciar'`.
  - «Cerrar mes» deprecia el mes antes de liquidar.
  - Existe la acción de baja, que llama `rpc('contab_baja_activo'`.
  - No quedan «Bs 148.750», «Mayo 2026» ni «#0314».
- [ ] **Step 2: Ver que fallan.**
- [ ] **Step 3: Implementar.** Al borrar la factura, su ficha se borra (si no tiene cuotas) o se avisa que hay que darla de baja. El registro manual de un activo (para migraciones) pide además la «Depreciación acumulada a la fecha»; su asiento de apertura viene con el plan 5. Subir `sw.js`.
- [ ] **Step 4: Pruebas en verde.**
- [ ] **Step 5: Commit** — `Activos fijos: nacen de la compra, se deprecian al cerrar el mes y se dan de baja con su asiento`.

---

### Task 4: Verificación en vivo y despliegue

- [ ] Agregar al script de verificación un activo de prueba en la empresa DigiAccount: compra, depreciación de un mes y baja, sin dejar nada al final.
- [ ] Correrlo antes del SQL 07 (falla limpio). Luis corre el SQL 07 y su prueba. Correrlo de nuevo (`TODO OK`).
- [ ] Revisión final independiente, push a `main` e Implementar.
