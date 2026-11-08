# Contabilidad · Plan 4a: conciliación bancaria y «Dar por cobrado y pagado»

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada banco tenga su subcuenta y que, al cargar su estado de
cuenta (PDF o Excel/CSV), cada línea se clasifique y su asiento lo haga la
base. El saldo del banco en libros tiene que cuadrar con el estado de cuenta.
Para los clientes que no mandan estado de cuenta, «Dar por cobrado y pagado»
pasa lo pendiente de CxC y CxP al banco o a caja.

**Architecture:**
- **Base (SQL 08 y 09):** las subcuentas de banco, la cabecera del estado de cuenta, la clasificación de cada línea y el asiento de cada línea conciliada (disparador, como los motores de los planes 1 a 3). También el resumen de la conciliación y la presunción de contado (RPC).
- **Pantalla:** un solo módulo nuevo, `assets/conciliacion.js`, que se monta en una pestaña nueva de Contabilidad («Conciliación») y en el lugar de la conciliación vieja de Tesorería. Así hay una sola lógica con dos puertas.
- **Sugerencias:** una función pura de JavaScript (`sugerirLinea`) con la regla de Luis: cruce automático solo con doble coincidencia.

**Tech Stack:** Supabase (Postgres + PostgREST + RLS), JS plano sin compilación, PGlite para las pruebas SQL, `herramientas/pruebas/correr.js` para las de JS.

**Spec:** `docs/superpowers/specs/2026-11-02-contabilidad-design.md` §3.7, §4.1 (filas «Cobro o pago…» y «Dar por cobrado y pagado») y §6. Diseño confirmado por Luis el 05/11 y el 08/11: clasificar cada línea; PDF y Excel/CSV; una subcuenta por banco.

## Global Constraints

- Las de los planes anteriores:
  - RLS en las tablas nuevas, con `mis_empresas()` para leer.
  - SQL re-ejecutable, montos a 2 decimales y Debe = Haber.
  - Pruebas SQL filtradas por la empresa de prueba; `correr.js` y `correr-sql.js` en verde.
  - Subir `sw.js`.
- El número del asiento lo pone siempre la base (`trg_asiento_numero`). Fechas dd/mm/aaaa y períodos aaaa-mm.
- **Regla de Luis (memoria `feedback-no-autoasignar-por-monto`):** para asignar una línea a una factura, una declaración o un tercero hacen falta dos coincidencias: el monto **y** una de estas (referencia o número de documento, RIF, teléfono o nombre). Con una sola, el sistema solo sugiere y no la aprueba en bloque. Se quita el cruce «solo por monto» que hoy hace Tesorería (`assets/tesoreria.js` ~913).
- Sin textos que prometan lo que no pasa (memoria `feedback-sin-textos-falsos`).
- **Fuera de este plan (plan 4b):** que los cobros y pagos de Tesorería los contabilice la base (hoy los hace el navegador) y el diferencial cambiario.

## Decisiones de quien construye

**Asiento de una línea conciliada** (`origen_tabla = 'extracto_bancario'`, fecha la de la línea). Si el dinero entra: Debe el banco y Haber la contrapartida. Si sale: al revés.

| Clase | Contrapartida |
|---|---|
| `cobro` | 1.1.2.01 CxC |
| `pago` | 2.1.1.01 CxP |
| `comision` | 6.3.1.02 Gastos y comisiones bancarias |
| `igtf` | 6.3.1.04 IGTF (gasto) |
| `otra` | `cuenta_contra` (la elige quien concilia) |
| `registrado` | `cuenta_contra`, por defecto 1.1.1.03. Es algo que ya está en libros contra «Bancos» o «Caja» en general (nómina, movimientos de Tesorería): solo se pasa a la subcuenta. |
| `transferencia` | `cuenta_contra` = la subcuenta del otro banco propio. Si la línea tiene `extracto_par_id` y la otra punta ya tiene su asiento, esta no hace ninguno. |
| `impuesto` | Se enlaza `declaracion_id`. Si la declaración no tiene pago, se le pone `fecha_pago`, `numero_pago` (la referencia) y `cuenta_pago` (la subcuenta), y el asiento lo hace el motor del plan 2b. Si ya tenía pago contra otra cuenta, la línea pasa de esa cuenta a la subcuenta. |

**«Dar por cobrado y pagado»** no recorre facturas: lleva a cero el saldo de 1.1.2.01 (deudor) y el de 2.1.1.01 (acreedor) al último día del período, contra la cuenta elegida. Es un solo asiento, `PRES-mm/aaaa`, que se rehace igual si se corre de nuevo, porque al calcular excluye su propio asiento. Así no hay doble cancelación con los cobros que ya se conciliaron.

## Review Focus

1. **Desconciliar o cambiar la clase de una línea ya conciliada:** el asiento se cambia o se borra, nunca se duplica (Task 1).
2. **El mismo estado de cuenta cargado dos veces:** las líneas no se duplican (la huella ya es única) y la cabecera se actualiza (Task 1 y Task 4).
3. **Transferencia entre dos bancos propios con los dos estados de cuenta cargados:** un solo asiento (Task 1).
4. **«Dar por cobrado y pagado» corrido dos veces, o después de conciliar más cobros:** un solo asiento por período, con el saldo de ese momento (Task 2).
5. **Una línea que coincide solo en monto con dos facturas:** no se aprueba en bloque y no se elige sola ninguna (Task 3).

---

### Task 1: Bancos con subcuenta y el asiento de cada línea

**Files:**
- Create: `sql/contabilidad_08_conciliacion.sql`
- Create: `sql/pruebas/contabilidad_08_pruebas.sql`
- Modify: `herramientas/pruebas/sql/espejo.sql` (`cuentas_tesoreria`, `extracto_bancario` y `movimientos_tesoreria` con sus columnas reales)

**Interfaces:**
- Produces: `cuentas_tesoreria.cuenta_contable text`, llenada por el disparador `trg_banco_subcuenta` (before insert or update) si viene vacía.
  - Efectivo o caja va bajo 1.1.1.01; lo demás, bajo 1.1.1.03. Siguiente número de dos dígitos entre las cuentas propias de la empresa.
  - Si ya existe una cuenta propia hija con el mismo nombre, se reusa. Se crea en `cuentas_contables` con la cuenta dueña de la empresa.
  - Se rellenan las cuentas que ya existen.
- Produces: tabla `estados_cuenta (id, cuenta_id, empresa_id, cuenta_teso_id, periodo, banco, saldo_inicial, saldo_final, archivo, creado_en)`, única por (cuenta_teso_id, periodo), con RLS.
- Produces: columnas nuevas en `extracto_bancario`:
  - `clase text` (check en las 8 clases o null);
  - `cuenta_contra text`;
  - `libro_fiscal_id uuid`, `declaracion_id uuid` y `extracto_par_id uuid`;
  - `estado text not null default 'pendiente'` (check `pendiente`, `sugerida`, `conciliada`);
  - `sugerencia jsonb`;
  - `tercero_nombre text` y `tercero_rif text`.
- Produces: `contab_lineas_extracto(x extracto_bancario) returns jsonb`, que devuelve null si no hay asiento. Disparador `trg_contab_extracto`, after insert or update (solo de las columnas del asiento) or delete, que crea, cambia o borra el asiento y hace el enlace del impuesto.

- [ ] **Step 1: Pruebas que fallan:**
  - Un banco nuevo «Banesco» recibe 1.1.1.03.01; el segundo, 1.1.1.03.02; «Caja», 1.1.1.01.01. Con una cuenta propia «Banesco» ya existente, se reusa.
  - Cobro de 1000 conciliado: `1.1.1.03.01 D1000 | 1.1.2.01 H1000`, con la fecha de la línea y su período.
  - Pago de −500: `2.1.1.01 D500 | 1.1.1.03.01 H500`. Comisión de −12,50: `6.3.1.02 D12.50 | 1.1.1.03.01 H12.50`.
  - La línea pasa a `pendiente`: el asiento se borra. Se cambia la clase de cobro a otra con cuenta 4.2.1.01: el asiento se cambia, sigue siendo uno.
  - Transferencia de −300 (banco A) a B, con su par +300 en B: un solo asiento, `1.1.1.03.02 D300 | 1.1.1.03.01 H300`.
  - Impuesto enlazado a una DPP sin pago: la declaración queda con `fecha_pago`, `numero_pago` y `cuenta_pago = '1.1.1.03.01'`, y su asiento de pago va contra la subcuenta.
  - Registrado de −800 (nómina): `1.1.1.03 D800 | 1.1.1.03.01 H800`.
  - Una línea de otra empresa no se ve desde la empresa de prueba (RLS en `estados_cuenta`).
- [ ] **Step 2: Ver que fallan** (`cd herramientas/pruebas/sql && node correr-sql.js`).
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pruebas en verde** (de la 03 a la 08).
- [ ] **Step 5: Commit** — `Conciliación: subcuenta por banco y asiento de cada línea del estado de cuenta desde la base`.

---

### Task 2: Resumen de la conciliación y «Dar por cobrado y pagado»

**Files:**
- Create: `sql/contabilidad_09_presuncion.sql`
- Create: `sql/pruebas/contabilidad_09_pruebas.sql`

**Interfaces:**
- Consumes: `cuentas_tesoreria.cuenta_contable`, `estados_cuenta` y las líneas del Task 1.
- Produces: `contab_conciliacion_resumen(p_cuenta_teso uuid, p_periodo text) returns jsonb` (security invoker). Devuelve:
  - `saldo_banco`: el `saldo_final` del estado de cuenta, o null si no hay;
  - `saldo_libros`: la suma de Debe − Haber de la subcuenta en los asientos con fecha hasta el fin del período;
  - `pendientes`: cuántas líneas del período no están conciliadas y cuánto suman;
  - `transito`: lo que hay en la subcuenta en el período y no vino de una línea (ni del pago de una declaración enlazada);
  - `diferencia` = saldo_banco − saldo_libros − pendientes.suma + transito.suma.
- Produces: `contab_dar_por_cobrado(p_empresa uuid, p_periodo text, p_cuenta text) returns jsonb` (security invoker). Devuelve `{cxc, cxp}`, lo que cerró. Crea o rehace el asiento `PRES-mm/aaaa` (`origen_tabla = 'presuncion'`), fechado el último día del período. `p_cuenta` tiene que ser 1.1.1.x, del plan o propia.

- [ ] **Step 1: Pruebas que fallan:**
  - Venta de 1160 y compra de 580 en marzo, sin cobros: `{cxc:1160, cxp:580}`. Asiento `1.1.1.03 D1160 | 1.1.2.01 H1160 | 2.1.1.01 D580 | 1.1.1.03 H580`, con fecha 31/03/2026.
  - Corrido otra vez: el mismo asiento, uno solo.
  - Se concilia un cobro de 160 y se corre de nuevo: cxc 1000.
  - Resumen con saldo_final 5000, 4800 en libros y una línea pendiente de +200: diferencia 0.
  - `p_cuenta` 6.1.1.01: error «La cuenta debe ser de efectivo o bancos».
- [ ] **Step 2: Ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Pruebas en verde.**
- [ ] **Step 5: Commit** — `Conciliación: resumen por banco y mes, y «Dar por cobrado y pagado»`.

---

### Task 3: Sugerencias con la regla de la doble coincidencia

**Files:**
- Create: `assets/conciliacion.js` (por ahora solo la función pura y su exposición)
- Modify: `herramientas/pruebas/correr.js` (agregar `conciliacion.js` a la lista de módulos que lee)

**Interfaces:**
- Produces: `sugerirLinea(linea, ctx) -> { clase, seguro, libro_fiscal_id?, declaracion_id?, extracto_par_id?, cuenta_contra?, tercero_nombre?, tercero_rif?, motivo }`, o null.
  - `linea = { id, fecha 'dd/mm/aaaa', descripcion, referencia, monto }`.
  - `ctx = { documentos: [{ id, tipo:'venta'|'compra', numero, rif, tercero, saldo }], declaraciones: [{ id, impuesto, numero, a_pagar, pagada }], terceros: [{ nombre, rif, telefono }], otrasLineas: [{ id, cuenta_contable, fecha, monto }] }`.
  - El `saldo` de un documento es su total menos lo retenido y menos lo ya conciliado; lo arma el Task 4.
- Orden de las reglas:
  1. Comisión, por la descripción: `/comisi[oó]n|cargo por servicio|mantenimiento de cuenta/i` → `comision`, seguro.
  2. IGTF: `/\bigtf\b|grandes transacciones/i` → `igtf`, seguro.
  3. Impuesto. Sale dinero por el `a_pagar` de una declaración sin pago:
     - y además la descripción dice `/seniat|tesoro|impuesto/i` o trae el número de planilla → seguro;
     - si solo coincide el monto → no seguro.
  4. Documento. Si entra dinero, ventas; si sale, compras. Candidatos: |saldo − |monto|| ≤ 0,01.
     - Segunda coincidencia, en la descripción o la referencia: el número del documento (sus dígitos, al menos 3), los dígitos del RIF, una palabra de 4 o más letras del nombre del tercero, o los últimos 7 dígitos de su teléfono.
     - Un candidato con segunda coincidencia → `cobro` o `pago`, seguro, con el documento y el tercero.
     - Si hay candidatos pero ninguno así → el primero, no seguro, con el motivo «solo coincide el monto».
  5. Transferencia: una línea de otro banco propio, con el monto contrario y a 3 días o menos → `transferencia`, no seguro, con `extracto_par_id` y `cuenta_contra`.

- [ ] **Step 1: Pruebas que fallan**, con `eval(tramo(...))` como en los planes anteriores:
  - «COMISION MANTENIMIENTO» −12,50 → comisión, seguro.
  - Una sola venta 000166 con saldo 446.820,19, de LIGNUM C.A.:
    - +446.820,19 con «PAGO FACT 166 LIGNUM» → cobro, seguro, con su id;
    - el mismo monto con «PAGO MOVIL 0412…» que no es su teléfono → cobro, no seguro.
  - Dos ventas con el mismo saldo y una descripción sin datos → no seguro, sin elegir ninguna.
  - Una DPP de 9000 sin pago y −9000 «PAGO SENIAT» → impuesto, seguro.
  - −300 en A y +300 en B al día siguiente → transferencia, no seguro.
  - «OPERACION MASTER DEBIT» sin coincidencias → null.
- [ ] **Step 2: Ver que fallan** (`node herramientas/pruebas/correr.js`).
- [ ] **Step 3: Implementar** en `assets/conciliacion.js`, expuesta como `window.__sugerirLinea`.
- [ ] **Step 4: Pruebas en verde.**
- [ ] **Step 5: Commit** — `Conciliación: sugerencias con doble coincidencia`.

---

### Task 4: La pantalla de conciliación (Contabilidad y Tesorería)

**Files:**
- Modify: `assets/conciliacion.js` (`window.__montarConciliacion(contenedor)`)
- Modify: `index.html`
  - una pestaña `data-tab="conciliacion"` en `#contaTabs`, con su panel;
  - el `<script>` de `assets/conciliacion.js`;
  - el panel de conciliación de Tesorería se cambia por el contenedor del módulo.
- Modify: `assets/tesoreria.js`: fuera `setupConciliacion` (~855-1081), con su cruce solo por monto y sus `__postAsiento` de «Registrar partida».
- Modify: `assets/app.js`: «Cerrar mes» ofrece «Dar por cobrado y pagado» si quedan saldos abiertos.
- Modify: `sw.js`
- Test: `herramientas/pruebas/correr.js`

**Interfaces:**
- Consumes: Task 1 (tablas, columnas y clases), Task 2 (`contab_conciliacion_resumen` y `contab_dar_por_cobrado`), Task 3 (`window.__sugerirLinea`) y las funciones existentes `window.__extraerEstadoCuenta(file)` y `window.__esperarTrabajoIA(job)`. Estas devuelven `{ ok, banco, periodo_desde, saldo_inicial, saldo_final, cuadra, movimientos: [{ fecha, descripcion, referencia, monto }] }`.

- [ ] **Step 1: Pruebas que fallan:**
  - Existe la pestaña de Contabilidad y el módulo se monta en las dos puertas.
  - La carga guarda la cabecera en `estados_cuenta` (upsert por banco y período) y las líneas con su huella, como hoy.
  - «Aprobar las seguras» solo toma las sugerencias con `seguro: true`.
  - La pantalla llama `rpc('contab_conciliacion_resumen'` y `rpc('contab_dar_por_cobrado'`.
  - `tesoreria.js` ya no cruza solo por monto ni hace asientos desde la conciliación.
  - «Cerrar mes» ofrece la presunción de contado.
- [ ] **Step 2: Ver que fallan.**
- [ ] **Step 3: Implementar.**
  - **Bancos:** lista de `cuentas_tesoreria` de la empresa, con su subcuenta y el botón «Agregar banco».
  - **Período:** selector de banco y mes; «Cargar estado de cuenta» (PDF con el agente si la cuenta lo tiene; si no, CSV con el lector de hoy, que se muda aquí).
  - **Tabla de líneas:** fecha, descripción, referencia, monto, clase (selector), detalle (factura, declaración o cuenta, según la clase) y estado, con «Conciliar» y «Deshacer» por línea.
  - **Cabecera:** «Aprobar las seguras (N)» y la tarjeta del resumen.
  - **Documentos para las sugerencias** (`saldo` de cada uno): del libro del período y los dos anteriores, menos sus retenciones y menos las líneas ya conciliadas con ese documento.
  - Subir `sw.js`.
- [ ] **Step 4: Pruebas en verde.**
- [ ] **Step 5: Commit** — `Conciliación en Contabilidad y Tesorería: cargar, clasificar, aprobar y cuadrar`.

---

### Task 5: Verificación en vivo y despliegue

- [ ] Agregar a `herramientas/verificar_motor_contable.py` un banco de prueba en la empresa DigiAccount. Debe recibir su subcuenta, se carga un estado de cuenta de 3 líneas (cobro, comisión y transferencia), se concilian y se comprueban los asientos y el resumen. Al final se borra todo, incluida la subcuenta.
- [ ] Correrlo antes de los SQL (falla limpio). Luis corre los SQL 08 y 09 y sus pruebas. Correrlo de nuevo (`TODO OK`).
- [ ] Revisión final independiente, push a `main` e Implementar.
