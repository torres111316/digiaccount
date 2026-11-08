# Contabilidad · Plan 4b: Tesorería y recibos en la base, y diferencial cambiario

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que para las empresas, PYME y emprendimientos (planes con Ventas y
Tesorería) la base contabilice:
- los recibos de venta y sus notas;
- cada cobro, pago, IGTF y transferencia de Tesorería, en la subcuenta del banco;
- el diferencial cambiario: cobros y pagos de documentos en dólares, cuentas en dólares y revaluación al cierre.

**Architecture:**
- **Motores en la base:** dos más, como los de los planes 1 a 4a. Uno en `facturas` (recibos) y otro en `movimientos_tesoreria`, con `origen_tabla` propio.
- **El dólar:** sale siempre de `tasas_cambio` (USD, BCV, vigente a la fecha). Los montos de una cuenta en dólares están en dólares y su asiento, en bolívares; cada línea guarda además `usd`.
- **Revaluación:** una RPC idempotente por mes (`REV-mm/aaaa`), que corre «Cerrar mes».
- **Lo ya contabilizado por el navegador no se toca.** Las filas existentes se marcan `contab_motor = false` y el motor no las mira.

**Tech Stack:** Supabase (Postgres + PostgREST + RLS), JS plano, PGlite (`correr-sql.js`) y `correr.js`.

**Spec:** `docs/superpowers/specs/2026-11-02-contabilidad-design.md`:
- §4.1: «Recibo de venta de la app» y «Cobro o pago en Tesorería»;
- «Recibo o libro: el ingreso se cuenta una sola vez»;
- §4.1, «Moneda»: diferencial cambiario y revaluación de bancos, CxC y CxP en dólares.

Pedido de Luis, 09/11: el 4b es para los clientes del sistema (empresa, PYME, emprendimiento). Los planes de contador no tienen Tesorería.

## Global Constraints

- Las de los planes anteriores:
  - RLS en las tablas nuevas;
  - SQL re-ejecutable;
  - 2 decimales y Debe = Haber;
  - pruebas filtradas por la empresa de prueba;
  - suites en verde;
  - subir `sw.js`.
- El número del asiento lo pone siempre la base.
- **Recibo o libro:** el recibo contabiliza solo si la empresa está en modo recibos (`empresas.fiscal_activo = false`). En modo libro lo hace el libro de ventas (plan 1).
- **Tasa:** `contab_tasa_bcv(fecha)` = la última fila de `tasas_cambio` con moneda USD, fuente BCV y `fecha <= fecha`. Sin tasa, el motor no inventa: no hace el asiento de ese movimiento y lo dice (`contab_filas_sin_asiento`).
- No se tocan los asientos que ya hizo el navegador.

## Decisiones de quien construye

- **Recibo (tipo venta):**
  - FV: Debe 1.1.2.01 total / Haber 4.1.1.01 subtotal, 2.1.3.01 iva y 2.1.4.03 igtf_monto.
  - NC: lo inverso de la FV. ND: como la FV.
  - Anulado: sin asiento.
  - Fecha: la del recibo.
- **Movimiento de Tesorería:** banco = la subcuenta de su cuenta. Montos:
  - `bs` = monto en bolívares (en una cuenta en dólares, `monto × tasa del día`);
  - `usd` = monto en dólares (en una cuenta en bolívares, `monto / tasa del día`).
- **Con documento (`factura_ref`):**
  - El documento se busca así: ingreso → recibo (`facturas.numero`) o venta del libro; egreso → compra del libro.
  - Documento en bolívares:
    - aplicado = mín(bs, lo que le falta);
    - el exceso va a anticipos (2.1.6.01 de clientes / 1.1.2.04 a proveedores).
  - Documento en dólares:
    - usd aplicado = mín(usd, lo que le falta en dólares);
    - CxC/CxP se cancela a la tasa del documento;
    - lo que va de la tasa del día a la del documento va a 4.2.2.01 ganancia / 6.3.1.03 pérdida en cambio;
    - el exceso va a anticipos.
  - «Lo que le falta» se calcula con los cobros o pagos anteriores (por fecha y luego por hora de registro).
- **Sin documento:** contra `cuenta_contra`, una columna nueva que pide la pantalla. Sin cuenta, no hay asiento, y aparece en «sin asiento».
- **Transferencia** (`referencia` TRF-… con su par de tipo contrario): el asiento lo hace el egreso, Debe la subcuenta del ingreso / Haber la propia. El ingreso no lleva asiento.
- **Conciliación (4a):**
  - Una línea `registrado` enlazada con `movimiento_id` a un movimiento que ya contabilizó el motor no hace asiento: ya está en la subcuenta.
  - Con un movimiento viejo, sigue la reclasificación de 4a.
  - Las líneas de una cuenta en dólares se desbloquean: `bs = monto × tasa del día` y `usd = monto`.
- **Revaluación** (`contab_revaluar(empresa, periodo)`, asiento `REV-mm/aaaa`, contra 4.2.2.01 / 6.3.1.03):
  - **Bancos en dólares:** ajuste = saldo_usd × tasa de cierre − saldo en bolívares sin las revaluaciones − revaluaciones anteriores.
  - **CxC y CxP:** de los documentos en dólares abiertos, con la misma fórmula sobre lo pendiente.
  - Es acumulativa: lo revaluado de un documento ya cobrado se revierte solo al mes siguiente.

## Review Focus

1. **Borrar o editar un movimiento ya contabilizado:** el asiento se cambia o se borra; el estado del recibo sigue a los cobros (Task 2).
2. **Dos cobros parciales de un recibo en dólares a tasas distintas:** cada uno con su diferencial, y nunca se cancela más que el documento (Task 3).
3. **Cobro mayor que lo pendiente:** el exceso va a anticipos, también en dólares (Task 2 y 3).
4. **«Cerrar mes» dos veces, o con el mes siguiente ya revaluado:** un solo asiento REV por mes, acumulativo (Task 3).
5. **Movimientos y recibos viejos (`contab_motor = false`):** el motor no los duplica ni los borra (Task 1 y 2).

---

### Task 1: Recibos de venta en la base

**Files:** Create `sql/contabilidad_10_recibos.sql` y `sql/pruebas/contabilidad_10_pruebas.sql`. Modify `herramientas/pruebas/sql/espejo.sql` (`facturas` y `tasas_cambio`).

**Interfaces:** Produces:
- `facturas.contab_motor boolean default true` (las filas existentes quedan en false);
- `contab_lineas_recibo(f facturas) jsonb`;
- el disparador `trg_contab_recibo`, con `origen_tabla = 'facturas'`;
- `contab_tasa_bcv(p_fecha date) numeric`.

- [ ] Pruebas que fallan:
  - FV 1160 en modo recibos: `1.1.2.01 D1160 | 4.1.1.01 H1000 | 2.1.3.01 H160`.
  - En modo libro: sin asiento.
  - Anularlo borra el asiento.
  - NC 116: lo inverso.
  - Una fila con `contab_motor = false`: sin asiento.
  - La tasa vigente al 10/03 es la del 09/03 si no hay del 10.
- [ ] Ver que fallan, implementar, ver que pasan. Commit — `Recibos de venta: el asiento lo hace la base`.

### Task 2: Tesorería en la base

**Files:** Create `sql/contabilidad_11_tesoreria.sql` y `sql/pruebas/contabilidad_11_pruebas.sql`. Modify `herramientas/pruebas/sql/espejo.sql` (`movimientos_tesoreria`).

**Interfaces:** Produces:
- `movimientos_tesoreria.contab_motor boolean default true` (las existentes quedan en false) y `movimientos_tesoreria.cuenta_contra text`;
- `contab_doc_de_movimiento(m) returns record (tabla, id, total_bs, total_usd, tasa)`;
- `contab_lineas_movimiento(m) jsonb`;
- el disparador `trg_contab_movimiento` (`origen_tabla = 'movimientos_tesoreria'`);
- `extracto_bancario.movimiento_id uuid`.

- [ ] Pruebas que fallan (cuenta en bolívares):
  - Cobro de 1160 al recibo: `1.1.1.03.01 D1160 | 1.1.2.01 H1160`.
  - Cobro de 1200 de un recibo de 1160: el exceso (40) a 2.1.6.01.
  - Pago de 580 a una compra del libro: `2.1.1.01 D580 | banco H580`.
  - Egreso sin documento con cuenta 6.1.1.04: `6.1.1.04 D | banco H`.
  - Sin cuenta: sin asiento, y cuenta en `contab_filas_sin_asiento`.
  - Transferencia TRF-1 entre dos bancos: un solo asiento.
  - Borrar el movimiento borra su asiento.
  - Un movimiento viejo no se toca.
  - Una línea del extracto `registrado` con `movimiento_id` de un movimiento del motor: sin asiento.
- [ ] Ver que fallan, implementar, ver que pasan. Commit — `Tesorería: cada cobro, pago y transferencia lo contabiliza la base en la subcuenta del banco`.

### Task 3: Diferencial cambiario y revaluación

**Files:** Create `sql/contabilidad_12_diferencial.sql` y `sql/pruebas/contabilidad_12_pruebas.sql`. Modify `sql/contabilidad_08_conciliacion.sql` (quita el bloqueo de las divisas cuando exista el 12 y convierte con la tasa).

**Interfaces:** Produces:
- `contab_aplicar(total_bs, total_usd, tasa_doc, previo_usd, previo_bs, bs, usd, tasa_dia) returns record (aplicado_bs, exceso_bs, dif_bs)`;
- `contab_revaluar(p_empresa uuid, p_periodo text) returns jsonb`, con el asiento `REV-mm/aaaa`.

- [ ] Pruebas que fallan:
  - Recibo de 41 USD a 871,3689 (35.726,13). Cobro de 41 USD en Bs a 897,5383 (36.799,07): CxC H35.726,13 y ganancia 4.2.2.01 H1.072,94.
  - Dos cobros de 20,5 USD a tasas distintas: cada uno con su diferencial; nunca más de 41 USD aplicados.
  - Cuenta en USD: un cobro de 10 USD queda en Bs a la tasa del día, con `usd` en la línea.
  - Revaluación de marzo: un banco USD con 10 USD a tasa de cierre más alta da la ganancia correcta. Correrla dos veces: un solo asiento. En abril, sin movimientos y con la misma tasa, el ajuste da 0.
  - CxC en USD abierta: revaluación de marzo; en abril se cobra, y la revaluación de abril revierte lo de marzo.
  - Una línea del extracto de una cuenta USD se concilia en Bs a la tasa del día.
- [ ] Ver que fallan, implementar, ver que pasan. Commit — `Diferencial cambiario: cobros y pagos en dólares, cuentas en divisas y revaluación al cierre`.

### Task 4: La pantalla deja de contabilizar

**Files:** Modify:
- `assets/tesoreria.js`: fuera los `__postAsiento` de cobro y pago, IGTF, transferencia y reverso (el reverso queda solo para movimientos viejos); cuenta contable para un movimiento sin documento; el IGTF va con su cuenta 6.3.1.04;
- `assets/facturas.js`: fuera los `__postAsiento` del recibo y de la nota;
- `assets/conciliacion.js`: `movimiento_id` en la sugerencia «registrado»; sin bloqueo de divisas;
- `assets/app.js`: «Cerrar mes» llama `rpc('contab_revaluar'`;
- `sw.js` y `herramientas/pruebas/correr.js`.

- [ ] Pruebas que fallan:
  - Ni `tesoreria.js` ni `facturas.js` contabilizan cobros, recibos ni notas.
  - El movimiento sin documento pide su cuenta.
  - La conciliación enlaza `movimiento_id`.
  - «Cerrar mes» revalúa.
- [ ] Ver que fallan, implementar, ver que pasan. Commit — `Tesorería y Ventas: los asientos los hace la base`.

### Task 5: Verificación en vivo y despliegue

- [ ] Agregar a `verificar_motor_contable.py`, en la empresa DigiAccount y en febrero de 2020:
  - un recibo en dólares;
  - su cobro a otra tasa, con el diferencial;
  - una transferencia;
  - la revaluación.
  Al final se borra todo.
- [ ] Correrlo antes de los SQL (falla limpio). Luis corre los SQL 10, 11 y 12 con sus pruebas. Correrlo de nuevo (TODO OK).
- [ ] Revisión final independiente, merge, push e Implementar.
