# Contabilidad · Plan 2 de 7: asientos de las retenciones y liquidación del IVA al pasivo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada comprobante de retención (IVA o ISLR, practicada o sufrida)
genere y mantenga su asiento en la base, igual que las facturas del plan 1.
Además, que la liquidación del IVA de «Cerrar mes» deje lo que hay que pagar
en *IVA por pagar*, en vez de sacarlo de Bancos.

**Architecture:** Una función `contab_lineas_retencion(r retenciones)` y un
disparador en `retenciones` que reutiliza el patrón de `contab_sync_libro`:
enlace por `origen_tabla = 'retenciones'` y `origen_id`, fecha y período con
`contab_fecha_asiento`, y respeto de los meses viejos. En la pantalla,
«Cerrar mes» deja de crear el asiento provisional RIVA y su liquidación
termina en 2.1.4.04.

**Tech Stack:** Postgres (Supabase) con plpgsql, PGlite para las pruebas SQL y
JavaScript plano en `assets/app.js`.

**Spec:** `docs/superpowers/specs/2026-11-02-contabilidad-design.md` §5
(impuestos) y §4.2 y §4.3.

**Después de este plan:** 2b, registro de declaraciones y pagos de impuestos
con sus asientos (IVA por pagar → Banco, retenciones por enterar → Banco,
ISLR, IGTF, DPP, IGP, municipal). Lleva pantalla nueva y se diseña con Luis.
Luego siguen los planes 3 a 6 de siempre.

## Global Constraints

- Mismas reglas del plan 1: RLS en tablas nuevas, SQL re-ejecutable con
  comprobación final, fechas `dd/mm/aaaa` en hora de Caracas, montos con 2
  decimales y Debe = Haber, el formato de línea `{"cta","debe","haber"}`, y
  las pruebas `node herramientas/pruebas/correr.js` y
  `cd herramientas/pruebas/sql && node correr-sql.js` en verde.
- Las pruebas SQL filtran SIEMPRE por la empresa de prueba: la base real
  repite comprobantes y facturas en otras empresas (el espejo ya trae ruido).
- Las funciones `security definer` usan `set search_path = public, pg_temp`.
- `retenciones.estado`: «Registrado» hoy; una anulada se reconoce por
  `estado ~* 'anulad'`.
- Cuentas (ya existen en `plan_cuentas_base`): 2.1.3.02 Retenciones IVA por
  pagar · 2.1.3.03 Retenciones ISLR por pagar · 1.1.3.03 Retenciones IVA
  soportadas · 1.1.3.02 ISLR retenido por terceros · 1.1.2.01 CxC ·
  2.1.1.01 CxP · 2.1.4.04 IVA por pagar.
- Subir `const CACHE` en `sw.js` al tocar `assets/`.

## Review Focus

1. **Retenciones sufridas de IVA en meses viejos de Agüero** (oct-25 a
   jun-26): ya están dentro de los resumen LV. No pueden contarse dos veces
   (prueba en la Task 1).
2. **Meses en los que ya se creó el asiento provisional RIVA-mm/aaaa** (si
   Luis cerró alguno con la v186): sus retenciones sufridas de IVA no se
   vuelven a contabilizar (prueba en la Task 1).
3. **Editar el monto de una retención o anularla** rehace o quita su asiento,
   sin duplicar (prueba en la Task 1).
4. **Carga masiva** de retenciones (`herramientas/cargar_retenciones.py`,
   quincenas): un asiento por comprobante (prueba en la Task 1).
5. **«Cerrar mes» después de este plan:** la liquidación usa el saldo de
   1.1.3.03 que ya trae las retenciones por comprobante, sin sumarlas otra
   vez (prueba en la Task 2).

---

### Task 1: Motor de asientos de las retenciones

**Files:**
- Create: `sql/contabilidad_05_retenciones.sql`
- Create: `sql/pruebas/contabilidad_05_pruebas.sql`
- Modify: `herramientas/pruebas/sql/espejo.sql` (tabla `retenciones`)

**Interfaces:**
- Consumes: `contab_cta`, `contab_fecha_asiento`, `contab_periodo_de` (plan 1); el disparador de numeración y descarte de `asientos`.
- Produces: `contab_lineas_retencion(r retenciones) returns jsonb` (null = sin asiento).
- Produces: `contab_sync_retencion()` y el disparador `trg_contab_retencion after insert or update or delete on retenciones`.
- Produces: asientos con `origen = 'motor'`, `origen_tabla = 'retenciones'`, `referencia = comprobante` y descripción `'Retención <IVA|ISLR> <practicada|sufrida> · comp. <n> · factura <f> · <tercero>'`.

- [ ] **Step 1: Escribir las pruebas que fallan** (entre `begin` y `rollback`, con cuenta de prueba y plan `contador_basico`):
  - IVA practicada, monto 75: `2.1.1.01 D75.00 | 2.1.3.02 H75.00`.
  - IVA sufrida, monto 120: `1.1.3.03 D120.00 | 1.1.2.01 H120.00`.
  - ISLR practicada, monto 30: `2.1.1.01 D30.00 | 2.1.3.03 H30.00`.
  - ISLR sufrida, monto 45.5: `1.1.3.02 D45.50 | 1.1.2.01 H45.50`.
  - Monto 0 o estado «Anulada»: `null`.
  - Insertar crea 1 asiento enlazado; editar el monto deja 1, con el monto nuevo; anular o borrar deja 0.
  - IVA sufrida de un período con `LV-mm/aaaa` en la empresa: sin asiento. ISLR sufrida del mismo período: sí tiene.
  - IVA sufrida de un período con `RIVA-mm/aaaa` en la empresa: sin asiento.
  - 50 retenciones en una sola sentencia: 50 asientos con números distintos.
  - Fecha: retención del `15/10/26`, período `2026-10`, registrada `2026-11-03`: el asiento lleva `31/10/2026` (misma regla de §4.3).

- [ ] **Step 2: Correr y ver que fallan.** Run: `cd herramientas/pruebas/sql && node correr-sql.js 05`. Expected: `function contab_lineas_retencion(...) does not exist`.

- [ ] **Step 3: Escribir `sql/contabilidad_05_retenciones.sql`.** Agregar al espejo la tabla `retenciones`, con las columnas de la base real que se usan (`id`, `cuenta_id`, `empresa_id`, `direccion`, `tipo`, `fecha`, `comprobante`, `tercero_nombre`, `tercero_rif`, `factura`, `base`, `pct`, `monto`, `estado`, `periodo`, `quincena`, `creado_en`). La sincronización sigue el esquema de `contab_sync_libro`: borrar si las líneas son null; saltar si el período está en LV/RIVA (solo IVA sufrida); actualizar el enlazado; si no, insertar con la cuenta dueña de la empresa. No hay adopción: ninguna retención tuvo nunca asiento propio. Comprobación final: `select count(*) from pg_trigger where tgname = 'trg_contab_retencion' and not tgisinternal;` (esperado `1`).

- [ ] **Step 4: Correr las pruebas.** Expected: `TODO OK · contabilidad 05` y las 03 y 04 siguen en OK.

- [ ] **Step 5: Commit** — `Contabilidad: cada retención contabiliza sola desde la base`.

---

### Task 2: «Cerrar mes» sin RIVA y con la liquidación al pasivo

**Files:**
- Modify: `assets/app.js` (bloque de «Cerrar mes», ~7090-7190)
- Modify: `sw.js`
- Test: `herramientas/pruebas/correr.js`

**Interfaces:**
- Consumes: los asientos de retención de la Task 1 (ya están en el saldo de 1.1.3.03).

- [ ] **Step 1: Pruebas que fallan:**
```js
ok('cerrar mes ya no crea el asiento provisional RIVA', /'RIVA-' \+ mm/.test(_appjs), false);
ok('la liquidación no suma las retenciones del mes al saldo', /retDisp = r2c\(retDisp \+ retMes\)/.test(_appjs), false);
ok('lo que queda por pagar va a IVA por pagar, no a Bancos', /'2\.1\.4\.04 · IVA por pagar'/.test(_appjs), true);
ok('la liquidación ya no abona Bancos', /Liquidación IVA[\s\S]{0,2500}1\.1\.1\.03 · Bancos/.test(_appjs), false);
```
Y cambiar la prueba del plan 1 «cerrar mes registra las retenciones de IVA sufridas contra CxC» a `false`, con su comentario actualizado.

- [ ] **Step 2: Correr y ver que fallan.** Run: `node herramientas/pruebas/correr.js`.

- [ ] **Step 3: Cambiar «Cerrar mes».** Fuera el bloque RIVA y la suma `retDisp + retMes`. En la F30, la línea del pago (`1.1.1.03 · Bancos`) y el ajuste de redondeo pasan a `2.1.4.04 · IVA por pagar`. El texto del aviso de confirmación debe decir que se genera la liquidación y que lo que hay que pagar queda en IVA por pagar. Subir `sw.js`.

- [ ] **Step 4: Correr las pruebas.** Expected: `TODO OK`.

- [ ] **Step 5: Commit** — `Contabilidad: cerrar mes deja el IVA a pagar en el pasivo; fuera el asiento RIVA`.

---

### Task 3: Verificación en vivo y despliegue

**Files:**
- Modify: `herramientas/verificar_motor_contable.py` (agregar una retención de prueba)

- [ ] **Step 1:** En el script, después de la compra de prueba, insertar una retención IVA practicada de 50 enlazada a esa compra. Comprobar que nace su asiento (`2.1.1.01 D / 2.1.3.02 H`), que anularla lo quita y que al final no queda nada.
- [ ] **Step 2:** Correrlo antes del SQL. Expected: `FALLA: la retención de prueba no generó asiento`, sin dejar filas.
- [ ] **Step 3:** Luis corre `sql/contabilidad_05_retenciones.sql` y `sql/pruebas/contabilidad_05_pruebas.sql`.
- [ ] **Step 4:** Correr el script. Expected: `TODO OK`.
- [ ] **Step 5:** Commit, push a `main` y Luis le da Implementar en EasyPanel (junto con la v186 si sigue pendiente).
