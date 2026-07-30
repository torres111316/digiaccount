# Motor de atajos de teclado (Fase 1)

## Contexto

Luis está registrando facturas a mano en el Libro Fiscal (Ventas/Compras) y en
Terceros — procesos repetitivos donde soltar el mouse cada vez cuesta tiempo.
Pide un sistema tipo Excel/videojuego: Ctrl+Enter para guardar en cualquier
cuadro, y una tecla que abra "nuevo registro" según dónde esté parado. También
pide, a futuro, un panel en Configuración para personalizar las teclas.

Se decide dividir en dos entregas:
- **Fase 1 (esta spec):** el motor funcionando con teclas fijas, bien elegidas.
- **Fase 2 (futura):** panel en Configuración para remapear las teclas.
  Fase 2 no tiene sentido sin que Fase 1 exista primero.

## Inventario relevante (ya explorado en el código)

**Modales/overlays existentes (13), verificados uno por uno en el HTML real y
agrupados por lo que de verdad ofrecen** (no todos son formularios — varios
son visores de documentos, y uno es una confirmación de pago sensible):

**A. Formulario con una acción principal clara** — `Ctrl+Enter` = esa acción,
`Escape` = cancelar:
| Modal | Guardar/acción | Cancelar |
|---|---|---|
| `formModal` (genérico) | `fmSave` | `fmCancel` *(ya hecho hoy)* |
| `terModal` (tercero) | `terSave` | `terCancel` |
| `asientoModal` | `amSave` | `amCancel` |
| `agAutoModal` | `agAutoSave` | `agAutoCancel` |
| `facturaNuevaModal` (Emitir factura) | `fvEmitir` | `fvCancel` |
| `firmaOverlay` (firma del trabajador) | `firmaAplicar` | `firmaClose` |

**B. Visor de documento** — solo `Escape` = cerrar y `Ctrl+P` = imprimir (no
tienen "Guardar"):
| Modal | Cerrar | Imprimir |
|---|---|---|
| `retReciboOverlay` | `retReciboClose` | `retReciboPrint` |
| `despachoOverlay` | `despachoClose` | `despachoPrint` |
| `relnOverlay` | `relnClose` | `relnPrint` |
| `subReciboModal` | `subReciboClose` | `subReciboPrint` |

**C. Visor con VARIAS acciones igual de importantes** (Cobrar/Anular/
Despachar/Descargar, o Firmar/Firma empresa/Descargar) — demasiado ambiguo
para adivinar cuál dispara `Ctrl+Enter`, así que **no se le asigna**; solo
`Escape` = cerrar y `Ctrl+P` = imprimir:
| Modal | Cerrar | Imprimir |
|---|---|---|
| `facturaOverlay` | `facturaClose` | `facturaPrint` |
| `reciboOverlay` | `reciboClose` | `reciboPrint` |

**D. Caso sensible (dinero) — se excluye `Ctrl+Enter` a propósito:**
`payModal` ("Activar suscripción"): solo `Escape` = `payCancel`. Confirmar un
pago (`payConfirm`) con un atajo de teclado es fácil de disparar sin querer;
esa acción se deja SOLO para clic explícito.

**Detección de "¿está visible?":** en vez de revisar si cada modal usa el
atributo `hidden` o `data-open="false"` (hay AMBAS convenciones mezcladas en
el código actual), el motor comprueba el estilo calculado del elemento
(`getComputedStyle(el).display !== 'none'`) — así funciona sin importar cómo
lo oculte cada modal (confirmado: ambas convenciones resuelven a
`display:none` cuando están cerrados), incluidos los que se agreguen en el
futuro. (Se descarta `el.offsetParent !== null` porque no es confiable con
`position: fixed`, que es como están hechos todos estos overlays.)

**Vistas (`.view`, atributo `data-active`):** `view-fiscal`, `view-ventas`,
`view-compras`, `view-terceros`, `view-nomina`, `view-contabilidad`,
`view-inventario`, `view-tesoreria`, etc. Cambian con `showView()` en
`assets/app.js` (~línea 333), que marca `data-active="true"` en el `.view`
activo.

**Sub-pestañas de Fiscal (`.fiscal-tab`, atributo `data-active`):** `compras` y
`ventas`, controladas por `gotoFiscalTab()` (~línea 538).

**Botones "Nuevo registro" (fase 1, alcance acordado):** `regVentaBtn` (Libro
de Ventas), `regCompraBtn` (Libro de Compras), `nuevoTerceroBtn` (Terceros).
Quedan fuera de esta fase (para una fase de seguimiento sencilla, una vez
exista el patrón): `nuevoAsientoBtn`, `nuevoTrabajadorBtn`,
`registrarActivoBtn`, `nuevoRolBtn`, `nuevoDespachoBtn`.

**Restricciones del navegador (no se pueden evitar):** `Ctrl+N` (ventana
nueva) y `Ctrl++`/`Ctrl+-` (zoom) están reservados por el navegador y NUNCA se
pueden interceptar de forma confiable. Por eso quedan fuera de las opciones.

## Teclas de la Fase 1

| Tecla | Acción | Alcance |
|---|---|---|
| `Ctrl+Enter` | Guardar / acción principal | Los 6 modales de tipo A (formulario) |
| `Escape` | Cancelar / cerrar | Los 13 modales (A, B, C y D) |
| `Insert` | Nuevo registro, según la vista/pestaña activa | Ventas, Compras (Fiscal), Terceros |
| `Ctrl+P` | Imprimir | El modal visible que tenga un botón de imprimir (grupos B y C), o si no hay ninguno abierto, el botón `[data-libro-action="print"]` de la vista activa (Libro de Ventas/Compras) |

## Arquitectura

Un solo IIFE nuevo al final de `assets/app.js` (`keyboardShortcuts()` o similar),
**sin tocar el código interno de los 13 modales existentes** — el motor solo
les hace clic a sus botones ya existentes desde afuera. Esto es intencional:
dejar un único punto de mantenimiento, que en la Fase 2 se pueda convertir
fácilmente en "lee la configuración guardada por el usuario" en vez de una
tabla fija. `formModal` ya tiene esta lógica desde hoy (commit anterior) y NO
se duplica; el motor nuevo cubre los 12 modales restantes.

### 1. Registro de modales (Guardar/Cancelar/Imprimir)

Una tabla en el propio motor, con los ids reales verificados (ver el
inventario arriba):

```js
const MODALES = [
  // Grupo A — formulario con accion principal clara (Ctrl+Enter + Escape)
  { overlay: 'terModal',          guardar: 'terSave',   cancelar: 'terCancel' },
  { overlay: 'asientoModal',      guardar: 'amSave',     cancelar: 'amCancel' },
  { overlay: 'agAutoModal',       guardar: 'agAutoSave', cancelar: 'agAutoCancel' },
  { overlay: 'facturaNuevaModal', guardar: 'fvEmitir',   cancelar: 'fvCancel' },
  { overlay: 'firmaOverlay',      guardar: 'firmaAplicar', cancelar: 'firmaClose' },
  // Grupo B/C — visor de documento (solo Escape + Ctrl+P, sin Ctrl+Enter)
  { overlay: 'retReciboOverlay',  cancelar: 'retReciboClose',  imprimir: 'retReciboPrint' },
  { overlay: 'despachoOverlay',   cancelar: 'despachoClose',   imprimir: 'despachoPrint' },
  { overlay: 'relnOverlay',       cancelar: 'relnClose',       imprimir: 'relnPrint' },
  { overlay: 'subReciboModal',    cancelar: 'subReciboClose',  imprimir: 'subReciboPrint' },
  { overlay: 'facturaOverlay',    cancelar: 'facturaClose',    imprimir: 'facturaPrint' },
  { overlay: 'reciboOverlay',     cancelar: 'reciboClose',     imprimir: 'reciboPrint' },
  // Grupo D — sensible: SOLO Escape, sin Ctrl+Enter ni Ctrl+P
  { overlay: 'payModal',          cancelar: 'payCancel' },
];
```

(`formModal` no está en esta tabla porque ya tiene su propio manejador desde
hoy, con la misma lógica.)

En cada `keydown` de `Ctrl+Enter`, `Escape` o `Ctrl+P`:
1. Buscar todos los overlays de `MODALES` que estén realmente visibles
   (`el.offsetParent !== null`).
2. Si hay más de uno visible a la vez (caso ya conocido: F2 abre "Nuevo
   tercero" encima de "Registrar venta"), usar el de **mayor z-index
   calculado** (`getComputedStyle(el).zIndex`) — el mismo criterio que ya
   corregimos hoy para que el modal correcto quede al frente.
3. Hacerle clic al botón que corresponda (`guardar` para Ctrl+Enter,
   `cancelar` para Escape, `imprimir` para Ctrl+P). Si esa entrada no define
   ese botón para ese modal (p. ej. `payModal` no tiene `guardar`), no hacer
   nada — se deja el comportamiento por defecto del navegador.

### 2. Nuevo registro contextual (`Insert`)

```js
function nuevoRegistroContextual() {
  // No abrir uno nuevo si YA hay un modal abierto
  if (algunModalVisible()) return;
  const view = document.querySelector('.view[data-active="true"]');
  const viewId = view && view.id;
  if (viewId === 'view-fiscal') {
    const tab = document.querySelector('.fiscal-tab[data-active="true"]');
    const nombre = tab && tab.dataset.tab;
    if (nombre === 'ventas')  clic('regVentaBtn');
    if (nombre === 'compras') clic('regCompraBtn');
  } else if (viewId === 'view-terceros') {
    clic('nuevoTerceroBtn');
  }
  // Vistas fuera de la Fase 1: no hacen nada (se agregan después, una línea
  // cada una, reutilizando este mismo patrón).
}
```

### 3. Imprimir (`Ctrl+P`)

Al presionar `Ctrl+P`:
1. Si hay un modal de `MODALES` visible con botón `imprimir` (grupos B/C:
   recibo, factura, guía de despacho, relación de nómina, etc.), se le hace
   `preventDefault()` al atajo del navegador y se le hace clic a ESE botón.
2. Si no hay ningún modal abierto, pero la vista activa tiene un botón
   `[data-libro-action="print"]` visible (Libro de Ventas/Compras), se usa ese.
3. Si ninguno de los dos casos aplica, se deja que el navegador haga su
   `Ctrl+P` normal (sin interferir) — mejor eso que no imprimir nada.

### 4. Cuidados / casos borde

- Ninguna de estas teclas (`Ctrl+Enter`, `Escape`, `Insert`) inserta texto en
  un campo — es seguro capturarlas globalmente sin importar dónde esté el
  foco, no rompen lo que el usuario esté escribiendo.
- `Escape` ya podría tener otro uso en algún modal específico (p. ej. cerrar
  un dropdown) — si ese modal tiene su propio listener de Escape, ese gana
  (el motor nuevo solo actúa si NINGÚN otro handler ya hizo `preventDefault`
  en ese evento, revisando `e.defaultPrevented`).
- El motor no debe interferir con atajos nativos del navegador que si
  queremos que sigan funcionando (Ctrl+F buscar en la página con el navegador
  no se toca en esta fase).

## Fuera de alcance (Fase 1)

- Panel de Configuración para personalizar teclas (Fase 2).
- `Insert` en las vistas de Nómina, Contabilidad, Inventario, Roles, Guías de
  despacho — se agregan como líneas sueltas en `nuevoRegistroContextual()`
  cuando se necesiten, reutilizando el patrón ya construido.
- Remapeo de teclas reservadas por el navegador (`Ctrl+N`, `Ctrl++`) — no es
  técnicamente posible.

## Pruebas

Manual, en el navegador (no hay suite automatizada para esto en el proyecto):
1. Abrir "Registrar venta" en Fiscal → Ctrl+Enter guarda, Escape cancela
   (ya funciona desde hoy; confirmar que sigue igual).
2. Probar Ctrl+Enter/Escape en 2-3 modales del grupo A (tercero, asiento) y
   Escape+Ctrl+P en 1-2 del grupo B/C (un recibo, una guía de despacho).
3. Con "Registrar venta" abierto, F2 en el nombre → abre "Nuevo tercero"
   encima → Ctrl+Enter/Escape deben actuar sobre el modal de tercero (el de
   más al frente), no sobre el de venta.
4. Parado en Fiscal → Ventas (sin modal abierto) → Insert abre "Registrar
   venta". Cambiar a la pestaña Compras → Insert abre "Registrar compra".
   Ir a Terceros → Insert abre "Nuevo tercero".
5. Con un modal ya abierto, Insert no debe abrir uno encima.
6. En Libro de Ventas, Ctrl+P imprime el libro (no la pantalla completa).
7. Abrir "Activar suscripción" (`payModal`) → confirmar que Ctrl+Enter NO
   dispara "Ya realicé el pago" (a propósito, por seguridad); Escape sí cierra.
