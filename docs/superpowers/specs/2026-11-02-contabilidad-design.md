# Módulo de Contabilidad: todo registrado, visto por niveles

Diseño acordado con Luis Torres (contador, fundador de DigiAccount) el 02/11/2026.

## 1. Por qué

La contabilidad de DigiAccount está incompleta y armada con criterios
mezclados. Medido en la base el 02/11/2026 (874 asientos, 16 empresas,
ninguno descuadrado):

- **Las cargas masivas de libros no contabilizan.** Las cargas por Excel,
  Telegram o script guardan las filas en `libro_fiscal` pero no crean
  asientos. GATMA y Radian no tienen **ningún** asiento de oct-2025 a
  jul-2026. Otras cinco empresas tienen meses sueltos sin asientos.
- **Hay dos modelos a la vez.** José Agüero tiene de oct-2025 a jun-2026 tres
  asientos resumen por mes, cargados por script. Desde julio, cada factura
  cargada a mano en la app crea un asiento propio contra CxC o CxP, y esas
  cuentas nunca se cancelan.
- **La fecha del asiento es el día en que se carga.** `__postAsiento`
  (`assets/contabilidad.js`) usa `new Date()`. En Agüero, 380 de 620 asientos
  automáticos caen en un mes que no es el de su operación.
- **Faltan operaciones enteras:** las ventas por reporte Z de máquina fiscal,
  la nómina, las retenciones (el módulo no crea ningún asiento) y la
  liquidación de impuestos desde julio («Cerrar mes» nunca se usó).

El módulo tiene que servir a los clientes de la firma de Luis (contabilidad
externa a partir de sus libros) y a cualquier cuenta nueva que se abra en el
sistema, incluidas empresas que usan la app a diario (ventas, cobros,
tesorería). Además, los libros Diario y Mayor se imprimen sobre hojas
foliadas por el Registro Mercantil.

## 2. Metas, no-metas y anti-metas

**Metas**
- Toda operación que tenga efecto contable genera su asiento, sin importar
  por dónde entró al sistema: pantalla, importador de Excel, carga por
  Telegram, script o agente.
- Un solo modelo para todas las empresas y todas las cuentas.
- Los reportes se consultan por nivel de cuenta y por período, con la misma
  barra en todos.
- Cada mes, o cada quincena en los especiales, la contabilidad cuadra con la
  Forma 30 del módulo Fiscal.
- Una empresa nueva puede migrar su historia y seguir sin cortes.
- Lo que hoy falta en las empresas de la firma queda reconstruido y cuadrado.

**No-metas**
- Contabilidad de costos e inventario perpetuo. El inventario físico se
  ajusta al cierre, como hasta ahora; el historial de entradas y salidas es
  otro proyecto.
- Consolidar varias empresas en un solo estado financiero.
- Que los agentes de Telegram generen estos reportes. Va después y consume lo
  que aquí se construya.

**Anti-metas**: aunque funcione técnicamente, esto sería un fracaso si:
- una cifra de un estado financiero no sale de los asientos guardados, es
  decir, si se calcula aparte y puede diferir del Diario;
- el saldo del banco en la contabilidad no puede cuadrar con el estado de
  cuenta real;
- un reporte impreso no entra exacto en la hoja foliada o se salta folios;
- se borran o reemplazan asientos de una empresa sin que Luis haya visto
  antes la diferencia y la haya aprobado.

## 3. Lo que decidió Luis

Estas decisiones son suyas y no se reabren:

1. **Se registra todo, operación por operación.** El resumen mensual deja de
   ser un asiento aparte y pasa a ser una forma de ver la información. Esto
   reemplaza el modelo de «3 asientos resumen por mes» del 19/07/2026.
2. **Cuatro niveles, numerados del más detallado al más general:**
   1 Detalle (cada asiento de una cuenta concreta), 2 Cuenta, 3 Grupo,
   4 Clase (Activo, Pasivo, Patrimonio, Ingresos, Costos, Gastos). Desde
   cualquier nivel se baja con un clic al siguiente. Hoy la app numera al
   revés y solo en Resultados y Balance; hay que cambiarlo.
3. **Barra de período:** día, semana, mes y año, con flechas para moverse.
   Es la misma barra para Diario, Mayor, Balance General, Estado de
   Resultados y **Estado de Flujo de Efectivo** (nuevo).
4. **Fecha del asiento = el día en que se registra la operación.** Una compra
   cuya factura llega meses después (caso VENCEMENT en Radian) entra cuando
   se registra. Coincide con el período de declaración de las compras.
5. **Meses viejos y migraciones:** el asiento toma el período del libro de
   compras o ventas de donde viene. La fecha del asiento se puede editar a
   mano para que coincida con su mes.
6. **Asiento de apertura** con los saldos con que llega una empresa (bancos,
   inventario, capital, deudas), para que el balance arranque cuadrado desde
   el primer mes cargado.
7. **Ventas y compras van contra Cuentas por Cobrar y Cuentas por Pagar, a
   nombre del tercero**, hayan sido de contado o a crédito.
   - Al cargar el estado de cuenta del banco, cada movimiento se cruza con su
     factura y se registra el cobro o el pago: sale de CxC/CxP y entra al
     banco correcto. El saldo de cada banco cuadra con su estado de cuenta.
   - Al cerrar el mes, para clientes que no mandan estado de cuenta, un botón
     **«Dar por cobrado y pagado»** aplica la presunción de contado: pasa los
     saldos abiertos de CxC y CxP del período al banco general o a caja.
8. **Impuestos: al declarar pasan al pasivo; al pagar se cruzan contra el
   banco.** El detalle está en la sección 5.
9. **Se agregan al plan todas las cuentas que faltan**, incluidos los aportes
   patronales de nómina y el impuesto municipal.
10. **Impresión** en hoja carta, sobria, con los datos de la empresa y todo el
    detalle, márgenes exactos, eligiendo **desde qué folio** se imprime y con
    totales que pasan de una hoja a otra («van» y «vienen»). Va al final,
    cuando todo funcione.

## 4. El registro

### 4.1 Qué genera asiento

| Operación | Asiento | Fecha |
|---|---|---|
| Venta con factura (`libro_fiscal`, tipo venta) | Debe CxC (tercero) / Haber Ventas (base + exento), Haber IVA débito fiscal. Si hay retención de IVA o ISLR sufrida, ver sección 5. | La de registro (en carga histórica, ver 4.3) |
| Venta por reporte Z (`numero_zeta` lleno) | Igual que una venta, con tercero «Ventas de contado · máquina {serial}» | Ídem |
| Compra (`libro_fiscal`, tipo compra, incluidas las RE exentas) | Debe Compra de mercancía o la cuenta de gasto / Debe IVA crédito fiscal / Haber CxP (tercero). Si hay retención practicada, ver sección 5. | Ídem |
| Nota de crédito | Asiento inverso de su factura (la app ya resta las NC) | Ídem |
| Factura ANULADA | No genera asiento; si ya lo tenía, se reversa | — |
| Recibo de venta de la app (`facturas`) | Igual que una venta | Ídem |
| Cobro o pago en Tesorería, o conciliado desde el estado de cuenta | Debe Banco / Haber CxC, o Debe CxP / Haber Banco | La del movimiento bancario |
| «Dar por cobrado y pagado» al cierre | Cancela CxC/CxP abiertos del período contra el banco general o caja | Último día del período |
| Nómina contabilizada | Como hoy (sueldos, beneficios, retenciones al trabajador, neto a banco) **más los aportes patronales** (Debe gasto / Haber por pagar) | Último día del período de pago |
| Declaración de un impuesto | Sección 5 | La de la declaración |
| Pago de un impuesto | Debe «… por pagar» / Haber Banco | La del pago |
| Asiento de apertura | Saldos iniciales, cuadrados contra Capital | Día anterior al primer período cargado |
| Asiento manual | Como hoy | La que se escriba |

**Recibo o libro: el ingreso se cuenta una sola vez** (decisión mía,
siguiendo la regla de Luis «ventas = recibos; el libro fiscal solo sirve
para declarar»). Se conserva el interruptor actual `empresas.modo`
(`recibos` / `libro`, en `assets/facturas.js` ~1156 y `assets/app.js`
~5880):
- **Empresa que emite recibos en la app:** el ingreso y la CxC nacen del
  recibo (`facturas`). Los cobros de Tesorería ya se enlazan a ese número
  (`factura_ref`). La fila del libro de ventas no genera asiento de ingreso;
  solo aporta lo fiscal (débito, retenciones) cuando no viene del recibo.
- **Cliente de la firma, sin recibos (modo libro):** el ingreso y la CxC
  nacen de la fila del libro de ventas.
- Las compras nacen siempre del libro de compras.

**Clasificación de compras: costo o gasto, desde el proveedor** (Luis:
«desde un comienzo hay que clasificar los costos y los gastos y eso lo da
el proveedor»).
- Cada proveedor (tercero) tiene una **cuenta contable por defecto**: por
  ejemplo, FEBECA a Compra de mercancía y el arrendador a Alquileres.
- Al registrar una compra se propone esa cuenta, y se puede cambiar
  factura por factura.
- Si el proveedor no tiene cuenta asignada, el sistema sugiere una a partir
  del concepto de la retención de ISLR (honorarios, servicios, fletes,
  alquileres, publicidad); si tampoco hay retención, usa Compra de
  mercancía y lo marca «sin clasificar».
- En la reconstrucción, Luis asigna la cuenta de cada proveedor y las
  compras históricas se reclasifican solas. Hay que mostrarle la lista de
  proveedores sin cuenta, ordenada por monto.
- Las cuentas de costo y de gasto que hagan falta se agregan al plan.

**Moneda** (Luis: «todo debe reflejarse en bolívares según ley, pero para
tema informativo podemos tener la información en multimoneda»).
- La contabilidad oficial va en **bolívares**.
- Las operaciones en divisas guardan su monto original, la moneda y la
  tasa BCV.
- **Diferencial cambiario:** al cobrar o pagar a una tasa distinta de la
  de la factura, la diferencia va a una cuenta de *Diferencial cambiario*
  (ganancia o pérdida). Al cierre de mes, los saldos en divisas (bancos en
  USD, CxC y CxP en dólares) se revalúan con la tasa BCV del cierre.
- **Vista informativa en dólares:** los reportes pueden mostrarse también
  en USD a la tasa BCV de cada operación, o a la del cierre en los saldos.
  Es solo de consulta; lo impreso para el Registro va en bolívares.

### 4.2 Trazabilidad e idempotencia

Cada asiento automático debe saber **de qué operación salió** (tabla y id de
origen). Se necesita para tres cosas:
- que la misma operación nunca genere dos asientos (hoy hay 3 repetidos);
- que editar o anular una operación reverse o rehaga su asiento;
- que la reconstrucción del punto 7 pueda regenerar una empresa entera sin
  dejar huérfanos.

### 4.3 Fecha y período

- **En el día a día**, el asiento toma la fecha en que se registra la
  operación. Luis lo confirmó el 02/11 con un ejemplo: una factura del 28/10
  que llega y se registra el 03/11 va con fecha 03/11. Es una compra: el
  selector de período la pone en noviembre por defecto, así que libro y
  asiento coinciden.
- Decisión mía para el caso raro: si el `periodo` del libro no es el mes del
  registro (el usuario eligió otro mes en el selector de compras, o una
  venta atrasada que por ley se declara en el mes de su fecha), el asiento
  cae en el período del libro, con el último día de ese período. Así la
  contabilidad de cada mes sigue cuadrando con su Forma 30.
- **En cargas de meses anteriores** (importador, Telegram, scripts,
  migración): el asiento cae en el `periodo` de la fila del libro. Si la
  fecha de la factura está dentro de ese período, se usa esa fecha; si no,
  el último día del período.
- **Las ventas se declaran siempre en el período de su fecha** y las compras
  en el período en que llegan (regla de Luis del 20/07/2026, ya implementada
  en `libro_fiscal.periodo`). El asiento sigue el mismo `periodo`.
- La fecha se puede editar a mano. Si se mueve a otro período, el asiento
  cambia de período; si el período está cerrado, se bloquea igual que en el
  libro (`window.__periodoCerrado`).
- Las fechas se arman dígito por dígito, nunca con formato regional
  (`window.__normFecha`; ver la memoria «Fechas nunca del sistema
  operativo»).

### 4.4 Numeración

El número correlativo del asiento lo asigna la base, por empresa, no el
navegador: hoy se calcula en el cliente y puede chocar. La impresión de los
libros foliados depende de que no haya saltos ni repetidos.

Decisión mía, por la práctica habitual del Diario foliado:
- Mientras el período está abierto, el número es **provisional**.
- **Al cerrar el período**, los asientos se numeran en orden cronológico,
  siguiendo el último número del período anterior, y el número queda fijo.
- La numeración **reinicia cada ejercicio**.
- **Un período impreso en folios queda bloqueado.** Sus correcciones entran
  como asiento de reverso en el período abierto, nunca reescribiendo lo
  impreso.

## 5. Impuestos

Regla general: **la operación genera el débito o el crédito; la declaración
lo pasa a «… por pagar»; el pago lo cruza contra el banco.** La periodicidad
de cada obligación (mensual o quincenal) sale de la condición del
contribuyente y del calendario fiscal, no de la empresa en bloque. Un
especial persona natural declara IVA mensual pero entera retenciones por
quincena (ver la memoria «Periodicidad de los especiales»).

| Impuesto | En la operación | Al declarar | Al pagar |
|---|---|---|---|
| **IVA** | Venta: Haber IVA débito. Compra: Debe IVA crédito | Debe débito / Haber crédito, Haber retenciones sufridas aplicadas, Haber **IVA por pagar**. El excedente pasa a *1.1.3.04 Excedente de crédito fiscal* y las retenciones no aplicadas a *1.1.3.05 Retenciones por descontar*, con su arrastre (la lógica de la Forma 30 ya existe) | Debe IVA por pagar / Haber Banco |
| **Retención IVA practicada** (compras de un especial) | Debe gasto + crédito / Haber CxP (neto) + Haber **Retenciones de IVA por enterar** | Ya está en pasivo (declaración quincenal por TXT) | Debe por enterar / Haber Banco |
| **Retención IVA sufrida** (ventas a un especial) | Debe *1.1.3.03 Retenciones IVA soportadas* / Haber CxC | Se aplica en la Forma 30 | — |
| **Retención ISLR practicada** | Debe gasto / Haber CxP (neto) + Haber **ISLR retenido por enterar** | Ya está en pasivo (XML mensual) | Debe por enterar / Haber Banco |
| **Retención ISLR sufrida** | Debe **ISLR retenido por terceros** (activo) / Haber CxC | Se rebaja en la declaración anual | — |
| **Anticipo de ISLR** (estimada) | — | Debe **Anticipos de ISLR** / Haber **ISLR por pagar** | Debe por pagar / Haber Banco |
| **ISLR anual** | — | Debe **Gasto de ISLR** / Haber ISLR por pagar; se rebajan anticipos y retenciones sufridas | Debe por pagar / Haber Banco |
| **IGTF percibido** (el especial lo cobra) | Haber **IGTF por pagar** (*2.1.4.03*, ya existe) | Quincenal | Debe por pagar / Haber Banco |
| **IGTF pagado por la empresa** | Debe gasto *6.3.1.04* (como hoy) | — | — |
| **DPP** (solo personas jurídicas; no los emprendimientos con `declara_dpp = false`) | — | Debe gasto / Haber **DPP por pagar** | Debe por pagar / Haber Banco |
| **IGP** (grandes patrimonios) | — | Debe gasto / Haber **IGP por pagar** | Debe por pagar / Haber Banco |
| **Aportes patronales** (IVSS, RPE, FAOV, INCES) | En el asiento de nómina | Debe gasto / Haber **… patronal por pagar** | Debe por pagar / Haber Banco |
| **Impuesto municipal** (actividades económicas) | — | Debe gasto / Haber **Impuesto municipal por pagar** | Debe por pagar / Haber Banco |

**Cuentas nuevas** (los códigos los asigna quien construye, respetando el
plan actual): IVA por pagar; Retenciones de IVA por enterar; ISLR retenido
por enterar; ISLR retenido por terceros; Anticipos de ISLR; ISLR por pagar;
Gasto de ISLR; DPP por pagar y su gasto; IGP por pagar y su gasto; aportes
patronales por pagar (IVSS, RPE, FAOV, INCES) y su gasto; Impuesto municipal
por pagar y su gasto; Ventas de contado por máquina fiscal si hace falta
separarlas. Ya existen las de retenciones del trabajador (SSO 2.1.3.04,
RPE 2.1.3.05, FAOV 2.1.3.06). El plan vive por empresa en
`cuentas_contables`: las cuentas nuevas se agregan a todas las empresas y a
la plantilla de las que se creen.

**Qué dispara la «declaración».** Hoy el módulo Fiscal ya calcula cada
obligación (Forma 30, TXT de retenciones de IVA, XML de ISLR, IGTF) y tiene
«Cerrar mes». La declaración contable se genera al cerrar el período de esa
obligación. El pago se registra cuando se marca pagada o cuando aparece en
el estado de cuenta.

**De dónde sale el monto** (decisión mía):
- Si existe la declaración presentada en la tabla `declaraciones`
  (`sql/declaraciones.sql`, con número del SENIAT), **manda el monto
  declarado**. Si no existe, se usa el cálculo del sistema y se marca como
  «calculado, sin declaración cargada».
- Una **sustitutiva** genera un asiento de ajuste por la diferencia contra
  la originaria.
- El impuesto municipal, el IGP y el ISLR anual **no se calculan** en este
  proyecto. El asiento se genera al cargar la declaración presentada (monto
  manual o leído de la planilla).

## 6. Conciliación bancaria

**La conciliación también vive en Contabilidad** (Luis, 02/11: «eso casi
siempre lo hace el contador»). Las cuentas de contador, cuyos planes no
incluyen Tesorería (`PLAN_MODULOS`), tienen la conciliación dentro del
módulo de Contabilidad, con sus propias cuentas bancarias por empresa. Las
empresas con Tesorería la siguen viendo allí. Es una sola lógica y una sola
tabla (`extracto_bancario`), con dos puertas.

Ya existe la carga del estado de cuenta en PDF (agente extractor) hacia
`extracto_bancario`, con su cruce contra los movimientos de tesorería. Lo que
cambia es que cada movimiento conciliado contra una factura **genera el
asiento de cobro o pago** (sección 4.1). El informe de conciliación muestra:
el saldo según libros, el saldo según banco y las partidas en tránsito. La
regla de Luis para el cruce automático sigue en pie: hace falta doble
coincidencia (monto más referencia, teléfono o nombre); con una sola, el
sistema solo sugiere.

## 7. Reportes

- **Diario, Mayor, Balance General, Estado de Resultados y Estado de Flujo
  de Efectivo** con la barra común: nivel (1 Detalle, 2 Cuenta, 3 Grupo,
  4 Clase) y período (día, semana, mes, año, con flechas).
- Todos salen **solo de los asientos guardados**: ninguna cifra se calcula
  por otro camino. El Flujo de Efectivo se arma desde los movimientos de las
  cuentas de efectivo y bancos (el método queda a quien construye; el
  directo es el más natural con estos datos).
- **Cuadre con la Forma 30:** por cada período de IVA, una marca visible de
  «cuadra / no cuadra» entre IVA débito y crédito de la contabilidad y lo
  que calcula el módulo Fiscal, con la diferencia si existe.
- El enrollado por niveles (`rollUp` en `assets/contabilidad.js`) ya existe;
  se reutiliza y se invierte la numeración.

## 8. Migraciones de empresas nuevas

1. Se cargan los libros de compras y ventas de los meses anteriores (los
   caminos actuales: importador de Excel gratis en la app o servicio pagado).
2. Los asientos se generan solos en el período de cada libro (4.3).
3. Se registra el asiento de apertura con los saldos al inicio del primer
   mes cargado.
4. Desde el mes siguiente se trabaja normal.

## 9. Reconstrucción de las empresas existentes

Para las 16 empresas actuales, en este orden por empresa:

1. Generar con el modelo nuevo **todos** los asientos que correspondan a sus
   operaciones guardadas: libros, retenciones, recibos, tesorería, nómina,
   declaraciones con las fechas de la Bóveda o del calendario, y pagos.
2. Comparar contra lo que hay hoy y mostrarle a Luis, empresa por empresa,
   un resumen: asientos que se crean, se cambian y se reemplazan, y el
   cuadre mes a mes contra la Forma 30.
3. **Solo con su aprobación** se reemplazan los asientos automáticos viejos,
   incluidos los resumen LV/LC/F30 de Agüero. Los asientos manuales no se
   tocan.
4. Para los clientes que no mandaron estados de cuenta, Luis decide período
   por período si se aplica «Dar por cobrado y pagado».

Validación conocida: el saldo de retenciones de IVA por descontar de Agüero
a junio de 2026 debe dar 20.228,88, igual que su Forma 30 real.

## 10. Impresión de libros foliados (última fase)

- Hoja carta, sin adornos. Encabezado: razón social, RIF, nombre del libro,
  ejercicio y período.
- Márgenes fijos y probados en papel, sin cortes ni desbordes.
- «Imprimir desde el folio N»: la numeración continúa donde quedó el libro.
- Totales «van» al pie y «vienen» al inicio de cada hoja.
- **Referencia cruzada entre el Mayor y el Diario:** cada movimiento del
  Mayor lleva el **N° de asiento** y, cuando ese período del Diario ya se
  imprimió, el **folio del Diario** donde quedó. Al imprimir el Diario se
  guarda en qué folio salió cada asiento. En pantalla, tocar la referencia
  abre el asiento. Luis quiere confirmar si la ley exige folio, número o
  ambos; se ponen los dos.
- Diario y Mayor como mínimo. El de Inventarios queda a criterio, según lo
  que pida el Registro.

## 11. Restricciones

- **Multi-empresa y multi-cuenta con RLS.** Toda tabla nueva lleva
  `cuenta_id` y `empresa_id` y sus políticas (`mi_cuenta_id()`,
  `soy_superadmin()`). El proyecto tiene activado «Enable automatic RLS»:
  una tabla nueva nace sin reglas y nadie puede leerla. Hay
  `sql/auditoria_rls.sql`.
- **Las operaciones entran por varios caminos:** la app, el importador, el
  flujo de n8n «Telegram · Importar libros» que escribe directo en
  `libro_fiscal`, y los scripts de `herramientas/`. Por eso la generación de
  asientos **no puede vivir solo en el navegador**. Mi decisión: que viva en
  la base (funciones o disparadores de Postgres), para que cualquier camino
  contabilice igual. La forma exacta queda a quien construye.
- **App sin compilación:** JavaScript plano y módulos por archivo
  (`assets/*.js`). El SQL va en archivos de `sql/`, cada uno explicando
  arriba por qué existe; Luis los corre a mano en el SQL Editor de Supabase.
- **Pruebas:** `node herramientas/pruebas/correr.js` debe seguir en verde y
  sumar pruebas de las reglas nuevas (asiento por tipo de operación, fecha y
  período, niveles, cuadre con la Forma 30).
- **Supabase devuelve como máximo 1.000 filas por consulta.** Hay que
  paginar (`window.__sbAll`).
- **Montos redondeados a céntimos** en cada línea (hoy hay IVA con 12
  decimales). Debe = Haber exacto por asiento.
- Despliegue: GitHub `torres111316/digiaccount` y luego Implementar en
  EasyPanel a mano. Subir la versión en `sw.js`.
- Los parámetros legales de nómina los decide el Lic. Romero; este proyecto
  no los cambia, solo contabiliza lo que la nómina ya calcula.

## 12. Orden sugerido

1. Plan de cuentas completo y número correlativo desde la base.
2. Generación en la base para ventas (incluidos los Z), compras, NC y
   anulaciones, con trazabilidad, fecha y período.
3. Retenciones (practicadas y sufridas) e impuestos: declaración y pago.
4. Nómina con aportes patronales.
5. Conciliación que genera cobros y pagos, más «Dar por cobrado y pagado».
6. Reportes con la barra común, Flujo de Efectivo y cuadre con la Forma 30.
7. Asiento de apertura y flujo de migración.
8. Reconstrucción de las 16 empresas, con la aprobación de Luis por empresa.
9. Impresión para libros foliados.

## 13. Queda a criterio de quien construye

- Los códigos exactos de las cuentas nuevas, dentro de la estructura actual.
- Disparador o función llamada desde cada camino de entrada, y el esquema
  exacto de trazabilidad.
- Cómo se ve el «cuadra / no cuadra» y el detalle de diferencias.
- El método del Flujo de Efectivo.
- La paginación y el diseño de la barra, siguiendo la maqueta aprobada
  (`.superpowers/brainstorm/…/niveles-contables.html`).
