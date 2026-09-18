# Cómo está hecho DigiAccount (mapa del código)

Generado a partir del propio `assets/app.js`: los números son reales y
hay que regenerarlos cuando el archivo cambie mucho (el script está en
`herramientas/mapa_modulos.py`).

## Cómo está dividido hoy

| Archivo | Líneas | Qué tiene | Cuándo se carga |
|---|---:|---|---|
| `assets/core.js` | 266 | El núcleo: fechas, tasas, el dólar de un documento, la sesión, `esc` y `drawIcons`. | Primero |
| `assets/app.js` | 14359 | El bloque grande con el resto de los módulos. | Después del núcleo |
| `assets/retenciones.js` | 1875 | Retenciones de IVA e ISLR: practicadas, sufridas, comprobante y quincena. | Después de app.js |
| `assets/tesoreria.js` | 1127 | Bancos y caja, movimientos, cobros y pagos, conciliación, CxC y CxP. | Después de app.js |
| `assets/facturas.js` | 1295 | El visor de la factura fiscal: la factura, el ticket, y las notas de crédito y débito. | Después de app.js |
| `assets/nomina.js` | 1530 | Empleados, recibos, vacaciones, utilidades, liquidaciones. | Al final |

Los seis se cargan en ese orden en `index.html` y los seis están en la copia
sin conexión (`sw.js`). Si se agrega otro archivo, hay que ponerlo en los dos
sitios o la app arranca a medias — de eso se encarga
`herramientas/cablear_modulo.py`, que además sube la versión de la caché.

## Lo primero que hay que saber

`assets/app.js` tiene **14359 líneas** y todavía está escrito como **un solo bloque** 
(una función que se ejecuta sola) con **72 módulos adentro**, más ocho
bloques sueltos al final. Cada módulo es otra función que se ejecuta sola
y se comunica con las demás por `window.*`.

Eso tiene una consecuencia práctica: **no se puede partir el archivo en
pedazos sin más**. Los módulos comparten funciones privadas del bloque
grande (`fmt`, `esc`, `toast`, `openFormModal`…), y si se separan, esas
funciones dejan de verse. Partirlo es un trabajo de varios pasos, no un
corte con tijera. Al final de este documento está el plan.

## Dónde está cada cosa

### Arranque, sesión y navegación

| Módulo | Líneas | Ubicación en app.js |
|---|---:|---|
| `authModule` | 359 | 14904–15262 |
| `companyWizard` | 341 | 18095–18435 |
| `usuariosModule` | 271 | 17820–18090 |
| `configModule` | 417 | 16898–17314 |

### Ventas y cobros

| Módulo | Líneas | Ubicación en app.js |
|---|---:|---|
| `facturas` | 1261 | 9126–10386 |
| `despachos` | 192 | 10391–10582 |
| `tesoreriaModule` | 1106 | 4648–5753 |
| `cobrosModule` | 198 | 16359–16556 |
| `tercerosModule` | 506 | 15267–15772 |

### Compras, inventario y costos

| Módulo | Líneas | Ubicación en app.js |
|---|---:|---|
| `inventoryActions` | 570 | 7039–7608 |
| `compToggle` | 195 | 4033–4227 |
| `ramosEmpresa` | 268 | 19545–19812 |
| `aperturaEmpresa` | 288 | 19827–20114 |

### Fiscal (libros, retenciones, declaraciones)

| Módulo | Líneas | Ubicación en app.js |
|---|---:|---|
| `fiscalActions` | 3200 | 11078–14277 |
| `retenciones` | 1851 | 997–2847 |
| `calendar` | 199 | 5794–5992 |

### Contabilidad

| Módulo | Líneas | Ubicación en app.js |
|---|---:|---|
| `contaActions` | 1024 | 2998–4021 |

### Nómina

| Módulo | Líneas | Ubicación en app.js |
|---|---:|---|
| `payroll` | 1509 | 7613–9121 |

### Panel del fundador, planes y socios

| Módulo | Líneas | Ubicación en app.js |
|---|---:|---|
| `fundadorModule` | 354 | 17462–17815 |
| `sociosFundador` | 218 | 19314–19531 |
| `panelSocio` | 189 | 19112–19300 |
| `agentesModule` | 273 | 15777–16049 |

### Los demás (pantallas y utilidades)

| Módulo | Líneas | Ubicación |
|---|---:|---|
| `vennifModule` | 182 | 14718–14899 |
| `bovedaFiscal` | 176 | 4468–4643 |
| `fxRate` | 169 | 6335–6503 |
| `libros` | 168 | 10587–10754 |
| `firmaSello` | 147 | 20127–20273 |
| `dashboardKpis` | 146 | 6508–6653 |
| `formModalSystem` | 140 | 10812–10951 |
| `planGating` | 139 | 18440–18578 |
| `inventory` | 137 | 6898–7034 |
| `txtGenerator` | 132 | 6017–6148 |
| `xmlGenerator` | 121 | 6153–6273 |
| `sucursalesConfig` | 119 | 18981–19099 |
| `comprobanteModule` | 118 | 16655–16772 |
| `suscripcionModule` | 117 | 16777–16893 |
| `liveTables` | 110 | 10959–11068 |
| `cashFlowChart` | 100 | 863–962 |
| `topbarActions` | 96 | 14449–14544 |
| `planesModule` | 96 | 16054–16149 |
| `tesoActions` | 91 | 14282–14372 |
| `checkoutModule` | 90 | 16561–16650 |
| `leadsModule` | 81 | 16252–16332 |
| `ventasModule` | 79 | 2886–2964 |
| `bankRecon` | 78 | 6816–6893 |
| `dashboardActions` | 75 | 14587–14661 |
| `instalarApp` | 72 | 18645–18716 |
| `planOnboarding` | 69 | 17389–17457 |
| `librosFilters` | 68 | 14377–14444 |
| `igtfModule` | 64 | 4266–4329 |
| `trialBanner` | 64 | 17320–17383 |
| `atrasCierraCuadros` | 54 | 711–764 |
| `generadoresUI` | 53 | 6278–6330 |
| `dppModule` | 52 | 4369–4420 |
| `legalDocs` | 52 | 16154–16205 |
| `contaExtraButtons` | 48 | 14666–14713 |
| `currencyToggle` | 44 | 6658–6701 |
| `rolGating` | 41 | 18586–18626 |
| `islrAnualModule` | 39 | 4425–4463 |
| `tableSearch` | 39 | 6706–6744 |
| `contactosCRM` | 37 | 16211–16247 |
| `menuCuenta` | 36 | 812–847 |
| `igpModule` | 31 | 4334–4364 |
| `declaracionesFiscales` | 30 | 4232–4261 |
| `relacionNomina` | 30 | 5758–5787 |
| `healthGauge` | 28 | 10759–10786 |
| `fiscalSubtabs` | 26 | 967–992 |
| `contaSubtabs` | 25 | 2969–2993 |
| `globalSearch` | 20 | 6767–6786 |
| `forzarMayusculas` | 18 | 14565–14582 |
| `toastSystem` | 17 | 10791–10807 |
| `saasMetrics` | 17 | 16337–16353 |
| `tesoSubtabs` | 14 | 2868–2881 |
| `botonVolver` | 12 | 774–785 |
| `ventasMode` | 12 | 2852–2863 |
| `mobileNav` | 10 | 14549–14558 |

## Las reglas que sostienen el sistema

Estas no están en el código de pantalla y conviene no romperlas:

- **Las reglas viven en la base de datos**, no en la pantalla: quién ve qué
  (RLS por cuenta), qué valores admite un campo, qué no puede repetirse.
  `sql/auditoria_rls.sql` revisa lo primero.
- **El dólar de un documento se guarda, no se recalcula.** `window.__usdDoc`
  es el único cálculo: primero lo guardado (`total_usd`), y solo si no lo
  tiene se reconstruye con la tasa de su fecha.
- **Las fechas nunca salen del sistema operativo**: `window.__normFecha` y
  `window.__fechaISO12` son las puertas.
- **Nada se inventa cuando falta un dato**: sin tasa no hay conversión, y
  se dice.

## Plan para partir el archivo (en este orden)

1. ~~**Sacar las utilidades compartidas**~~ — HECHO (`core.js`).
1. **Antes decía:** sacar las utilidades compartidas (`fmt`, `esc`, `toast`,
   `openFormModal`, los ayudantes de fecha y tasa) a `assets/core.js`,
   exponiéndolas en `window`. Sin esto, cualquier corte rompe.
2. ~~**Mover un módulo grande y aislado**~~ — HECHO (`nomina.js`, 1.509 líneas).
   Solo dependía de dos funciones del bloque grande, que se movieron al núcleo.
3. ~~**El segundo módulo grande**~~ — HECHO (`retenciones.js`, 1.851 líneas).
   Dependía de las mismas dos funciones, que ya estaban en el núcleo: por eso
   salió sin tocar una sola línea de su cuerpo.
4. ~~**El primero que no arrastra nada**~~ — HECHO (`tesoreria.js`, 1.109 líneas).
   No usaba ningún nombre privado del bloque grande.
5. ~~**El visor de la factura**~~ — HECHO (`facturas.js`, 1.272 líneas).
   Aquí apareció el error de las notas de crédito: usaba una `fmtF` que en
   su alcance no existía. Se arregló antes de mover nada.
6. **Repetir módulo por módulo**, del más independiente al más entrelazado.
   `fiscalActions` (3.200 líneas) va de último: es el más grande y el que
   más toca. Los siguientes candidatos ya están medidos y salen limpios:

   | Módulo | Líneas | Qué usa del bloque grande |
   |---|---:|---|
   | `contaActions` | 1.024 | `drawIcons` (ya en el núcleo) |
   | `inventoryActions` | 570 | `esc` (ya en el núcleo) |
   | `tercerosModule` | 506 | `esc` (ya en el núcleo) |
   | `configModule` | 417 | por medir |
   | `authModule` | 361 | por medir |
7. **Cada paso se verifica** antes de seguir: que el cuerpo mudado sea
   idéntico línea por línea al que estaba, que la app arranque en un
   navegador de verdad sin errores, que las piezas compartidas respondan,
   y que las pruebas de lo que toca dinero e impuestos pasen.

## Las herramientas del corte

Para no hacerlo a mano cada vez:

| Herramienta | Qué hace |
|---|---|
| `herramientas/variables_libres.py` | Lista los nombres que un módulo usa y no define: los que haya que mudar al núcleo antes de cortarlo. |
| `herramientas/mapa_modulos.py` | Lista los módulos de `app.js` con su tamaño y su ubicación. |
| `herramientas/sacar_modulo.py` | Corta un módulo y lo envuelve en su propio archivo. |
| `herramientas/cablear_modulo.py` | Lo pone en `index.html`, en `sw.js` (subiendo la caché) y en las pruebas. |

La comprobación que decide si un módulo se puede sacar es **el barrido de
variables libres**: se listan todos los nombres que el módulo usa y no
define. Si solo quedan globales del navegador y cosas de `window`, sale
limpio. Si aparece un nombre privado del bloque grande, ese nombre hay que
mudarlo al núcleo primero, o el módulo se rompe al separarse.

Ese barrido tiene que mirar **también dentro de las plantillas de texto**
(`` `...${ aquí hay código }...` ``): una dependencia que solo se use ahí es
igual de real, y es justo la que se escapa de una revisión a ojo.

### El barrido encuentra errores, no solo dependencias

Un nombre que un módulo usa y **nadie** le da no es un obstáculo para
separarlo: es un error que ya estaba ahí. Al correrlo sobre los 79 módulos
aparecieron dos, los dos en pantallas que la gente usa:

- **Notas de crédito y débito** (`facturas`): usaba `fmtF`, que en su
  alcance no existe. El botón reventaba antes de abrir el modal.
- **Comprobante de IVA/ISLR** (`compToggle`): usaba `fmt`. Al elegir un
  proveedor, la lista de sus facturas reventaba a mitad y el desplegable
  se quedaba vacío.

Las dos por lo mismo: las `fmt` del archivo viven dentro de **otros**
módulos, y desde un cierre no se ve lo que se declaró en otro. El módulo de
Libros ya lo había sufrido y dejó su propia copia, con un comentario
explicando la razón; a estos dos se les había olvidado.

## La otra comprobación: el contrato de `window`

Los módulos se hablan por `window.__loquesea`. Eso es un contrato sin
nadie que lo vigile: si alguien escribe mal un nombre, **no falla, no hace
nada**. Conviene contrastar lo que se publica contra lo que se pide.

Hoy son 175 nombres publicados y 158 pedidos. La primera vez que se hizo
apareció uno pedido que nadie publicaba: `__aplicarConfigInventario`. Como
la llamada iba protegida con un `if`, no daba error — la configuración de
inventario se guardaba y la app seguía usando en memoria los valores
viejos hasta recargar. La función buena se llamaba `__cargarInvConfig`.

No hay prisa en terminarlo: hay prisa en no romperlo. Un módulo por sesión
es un ritmo sano.
