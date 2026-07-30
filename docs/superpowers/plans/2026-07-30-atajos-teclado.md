# Motor de Atajos de Teclado (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que `Ctrl+Enter` (guardar), `Escape` (cancelar/cerrar), `Ctrl+P`
(imprimir) e `Insert` (nuevo registro contextual) funcionen en toda la app
DigiAccount, sin tocar el código interno de los 13 modales existentes.

**Architecture:** Un único IIFE nuevo (`atajosTeclado`) al final de
`assets/app.js`. Mantiene una tabla `MODALES` con los ids reales de cada
overlay y sus botones de guardar/cancelar/imprimir, detecta cuál está visible
(y cuál está "al frente" si hay más de uno abierto a la vez) usando el estilo
calculado, y le hace clic al botón correspondiente. `Insert` usa un dispatcher
separado que mira la vista/pestaña activa.

**Tech Stack:** JavaScript vanilla (sin framework, sin bundler). No hay suite
de pruebas automatizada en el proyecto para UI — la verificación es manual en
el navegador (Chrome/Edge), más `node --check` para sintaxis.

## Global Constraints

- No modificar el código interno de los 13 modales (`terModal`, `asientoModal`,
  `agAutoModal`, `facturaNuevaModal`, `firmaOverlay`, `retReciboOverlay`,
  `despachoOverlay`, `relnOverlay`, `subReciboModal`, `facturaOverlay`,
  `reciboOverlay`, `payModal`, `formModal`) — el motor solo les hace clic a
  sus botones desde afuera.
- `formModal` ya tiene su propio manejador de `Ctrl+Enter`/`Escape` (código
  existente, no tocar) — el motor nuevo NO debe duplicarlo ni interferir.
- `payModal` NUNCA recibe `Ctrl+Enter` (su acción es confirmar un pago —
  riesgo de disparo accidental).
- Ninguna tecla de esta fase (`Ctrl+Enter`, `Escape`, `Insert`, `Ctrl+P`)
  debe insertar texto ni romper lo que el usuario esté escribiendo en un
  campo — todas son seguras de interceptar globalmente.
- `Ctrl+N` y `Ctrl++`/`Ctrl+-` quedan fuera de alcance (reservados por el
  navegador, no interceptables).
- Verificar sintaxis con `node --check assets/app.js` después de cada tarea,
  antes de comitear.
- Spec completo: `docs/superpowers/specs/2026-07-30-atajos-teclado-design.md`.

---

### Task 1: Motor de Guardar/Cancelar (`Ctrl+Enter` / `Escape`) para los 12 modales restantes

**Files:**
- Modify: `assets/app.js` (agregar un IIFE nuevo al final del archivo, después
  de la línea 12218 actual, que cierra con `})();`)

**Interfaces:**
- Produce: `window.__algunModalVisible()` → `boolean`. Devuelve `true` si
  cualquiera de los 13 modales (los 12 de `MODALES` + `formModal`) está
  visible ahora mismo. La usará la Task 3 (`Insert`) para no abrir un
  "nuevo registro" encima de un modal ya abierto.

- [ ] **Paso 1: Confirmar los ids reales de guardar/cancelar de los 12 modales**

Estos ids ya se verificaron leyendo el HTML real durante el diseño (ver
`docs/superpowers/specs/2026-07-30-atajos-teclado-design.md`, sección
"Inventario"). Antes de escribir el código, confirmar que siguen existiendo
tal cual (por si cambiaron desde entonces):

```bash
grep -oE 'id="(terSave|terCancel|amSave|amCancel|agAutoSave|agAutoCancel|fvEmitir|fvCancel|firmaAplicar|firmaClose|retReciboClose|despachoClose|relnClose|subReciboClose|facturaClose|reciboClose|payCancel)"' index.html | sort -u
```

Expected: las 17 ids aparecen (una vez cada una). Si falta alguna, buscarla
de nuevo en `index.html` antes de continuar (pudo cambiar de nombre).

- [ ] **Paso 2: Agregar el IIFE del motor al final de `assets/app.js`**

Al final del archivo (después de la última línea, que hoy es `})();`),
agregar:

```js

/* =========================================================
   ATAJOS DE TECLADO (Fase 1) — Ctrl+Enter/Escape universal,
   Ctrl+P para imprimir, Insert para "nuevo registro" contextual.
   No toca el código interno de los modales: solo les hace clic
   a sus botones ya existentes, desde afuera. Ver spec:
   docs/superpowers/specs/2026-07-30-atajos-teclado-design.md
   ========================================================= */
(function atajosTeclado() {
  // formModal ya tiene su propio Ctrl+Enter/Escape (ver openFormModal,
  // función window.openFormModal) — no se duplica aquí.
  const MODALES = [
    // Grupo A — formulario con acción principal clara
    { overlay: 'terModal', guardar: 'terSave', cancelar: 'terCancel' },
    { overlay: 'asientoModal', guardar: 'amSave', cancelar: 'amCancel' },
    { overlay: 'agAutoModal', guardar: 'agAutoSave', cancelar: 'agAutoCancel' },
    { overlay: 'facturaNuevaModal', guardar: 'fvEmitir', cancelar: 'fvCancel' },
    { overlay: 'firmaOverlay', guardar: 'firmaAplicar', cancelar: 'firmaClose' },
    // Grupo B/C — visor de documento (sin acción de Guardar)
    { overlay: 'retReciboOverlay', cancelar: 'retReciboClose', imprimir: 'retReciboPrint' },
    { overlay: 'despachoOverlay', cancelar: 'despachoClose', imprimir: 'despachoPrint' },
    { overlay: 'relnOverlay', cancelar: 'relnClose', imprimir: 'relnPrint' },
    { overlay: 'subReciboModal', cancelar: 'subReciboClose', imprimir: 'subReciboPrint' },
    { overlay: 'facturaOverlay', cancelar: 'facturaClose', imprimir: 'facturaPrint' },
    { overlay: 'reciboOverlay', cancelar: 'reciboClose', imprimir: 'reciboPrint' },
    // Grupo D — sensible (dinero): SOLO Escape, nunca Ctrl+Enter
    { overlay: 'payModal', cancelar: 'payCancel' },
  ];

  function esVisible(el) {
    return !!el && window.getComputedStyle(el).display !== 'none';
  }

  // El modal MAS AL FRENTE entre los que estén visibles ahora (por z-index
  // calculado) — necesario porque F2 puede abrir "Nuevo tercero" encima de
  // "Registrar venta", y ambos podrían estar visibles a la vez.
  function modalVisibleTope() {
    let top = null, topZ = -1;
    MODALES.forEach((m) => {
      const el = document.getElementById(m.overlay);
      if (!esVisible(el)) return;
      const z = parseInt(window.getComputedStyle(el).zIndex, 10) || 0;
      if (z >= topZ) { topZ = z; top = m; }
    });
    return top;
  }

  function algunModalVisible() {
    return MODALES.some((m) => esVisible(document.getElementById(m.overlay)))
      || esVisible(document.getElementById('formModal'));
  }
  window.__algunModalVisible = algunModalVisible;

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return; // otro handler (p. ej. formModal) ya actuó
    const ctrlEnter = e.key === 'Enter' && (e.ctrlKey || e.metaKey);
    const escape = e.key === 'Escape';
    if (!ctrlEnter && !escape) return;
    const m = modalVisibleTope();
    if (!m) return; // ninguno de los 12 está abierto (formModal maneja lo suyo aparte)
    if (ctrlEnter && m.guardar) {
      const btn = document.getElementById(m.guardar);
      if (btn) { e.preventDefault(); btn.click(); }
    } else if (escape && m.cancelar) {
      const btn = document.getElementById(m.cancelar);
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });
})();
```

- [ ] **Paso 3: Verificar sintaxis**

Run: `node --check assets/app.js`
Expected: sin salida (sintaxis correcta). Si marca error, revisar que el
bloque pegado no haya quedado con llaves/paréntesis desbalanceados.

- [ ] **Paso 4: Verificación manual en el navegador — Grupo A (Ctrl+Enter guarda)**

1. Abrir `app.digiaccount.io`, ir a **Terceros**, clic en "+ Nuevo tercero".
2. Llenar Nombre y RIF (campos obligatorios).
3. Presionar **Ctrl+Enter**.
   Expected: el tercero se guarda y el modal se cierra (mismo resultado que
   si se hiciera clic en "Guardar").
4. Repetir en **Contabilidad → Nuevo asiento**: llenar los campos mínimos,
   Ctrl+Enter debe guardarlo.

- [ ] **Paso 5: Verificación manual — Grupo B/C y D (Escape cierra, sin Guardar)**

1. Abrir cualquier recibo o factura ya emitida (para ver `reciboOverlay` o
   `facturaOverlay`) → presionar **Escape** → el modal debe cerrarse.
2. Ir a **Suscripción** → abrir "Activar suscripción" (`payModal`) →
   presionar **Ctrl+Enter**.
   Expected: NO pasa nada (no se confirma el pago) — es el comportamiento
   correcto a propósito. Presionar **Escape** → el modal SÍ se cierra.

- [ ] **Paso 6: Verificación manual — F2 sobre "Registrar venta" (modal encima de modal)**

1. Ir a **Fiscal → Libro de Ventas → Registrar venta**.
2. Escribir un nombre de cliente que NO exista, presionar **F2** (abre
   "Nuevo tercero" encima).
3. Presionar **Ctrl+Enter** con el tercero incompleto (sin RIF) →
   Expected: NO guarda el tercero (falta el RIF) y el modal de tercero
   sigue abierto — es decir, el atajo actuó sobre el modal de TERCERO (el
   de más al frente), no sobre "Registrar venta" que está detrás.
4. Completar el RIF, Ctrl+Enter de nuevo → el tercero se guarda y vuelve al
   formulario de "Registrar venta".

- [ ] **Paso 7: Commit**

```bash
git add assets/app.js
git commit -m "Atajos de teclado: Ctrl+Enter/Escape universal en los 12 modales restantes

Fase 1 del motor de atajos (ver spec 2026-07-30-atajos-teclado-design.md).
No toca el codigo interno de los modales, solo les hace clic a sus botones
de guardar/cancelar desde afuera. payModal excluido de Ctrl+Enter a
proposito (confirmar un pago no debe dispararse por atajo de teclado)."
```

---

### Task 2: Imprimir con `Ctrl+P`

**Files:**
- Modify: `assets/app.js` (el mismo IIFE `atajosTeclado` creado en la Task 1)

**Interfaces:**
- Consume: `MODALES`, `esVisible()`, `modalVisibleTope()` (definidos en Task 1,
  mismo archivo/closure — no requieren cambios).

- [ ] **Paso 1: Extender el `keydown` del Task 1 con la rama de `Ctrl+P`**

Dentro del mismo `document.addEventListener('keydown', (e) => { ... })` de la
Task 1, reemplazar el cuerpo completo por esta versión extendida (agrega la
detección de `Ctrl+P` y la función `botonImprimirVisible`, que debe declararse
ANTES del listener, junto a `esVisible`/`modalVisibleTope`):

```js
  // Botón [data-libro-action="print"] REALMENTE visible en pantalla (hay 3 en
  // el DOM — Compras, Ventas/facturas, Ventas/máquina fiscal — solo uno está
  // visible a la vez). offsetParent (no getComputedStyle) es lo correcto acá
  // porque estos botones NO son position:fixed: su visibilidad depende de que
  // un ANCESTRO (la pestaña/tab) esté oculto, y offsetParent sí lo detecta.
  function botonImprimirVisible() {
    const btns = document.querySelectorAll('[data-libro-action="print"]');
    for (let i = 0; i < btns.length; i++) {
      if (btns[i].offsetParent !== null) return btns[i];
    }
    return null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const ctrlEnter = e.key === 'Enter' && (e.ctrlKey || e.metaKey);
    const escape = e.key === 'Escape';
    const ctrlP = e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey);
    if (!ctrlEnter && !escape && !ctrlP) return;
    const m = modalVisibleTope();
    if (ctrlP) {
      if (m && m.imprimir) {
        const btn = document.getElementById(m.imprimir);
        if (btn) { e.preventDefault(); btn.click(); }
        return;
      }
      if (!m) {
        const printBtn = botonImprimirVisible();
        if (printBtn) { e.preventDefault(); printBtn.click(); }
      }
      return;
    }
    if (!m) return;
    if (ctrlEnter && m.guardar) {
      const btn = document.getElementById(m.guardar);
      if (btn) { e.preventDefault(); btn.click(); }
    } else if (escape && m.cancelar) {
      const btn = document.getElementById(m.cancelar);
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });
```

(Esto REEMPLAZA el `document.addEventListener('keydown', ...)` completo de la
Task 1 — no se agrega un segundo listener duplicado.)

- [ ] **Paso 2: Verificar sintaxis**

Run: `node --check assets/app.js`
Expected: sin salida.

- [ ] **Paso 3: Verificación manual — Ctrl+P con un modal de documento abierto**

1. Abrir un recibo o guía de despacho ya emitido.
2. Presionar **Ctrl+P**.
   Expected: se abre el diálogo de impresión del navegador con SOLO el
   documento (igual que si se hiciera clic en su botón "Imprimir"), no la
   pantalla completa de la app.

- [ ] **Paso 4: Verificación manual — Ctrl+P sin modal abierto, en Libro de Ventas**

1. Ir a **Fiscal → Libro de Ventas** (sin abrir ningún modal), elegir un
   período con movimientos (p. ej. Junio).
2. Presionar **Ctrl+P**.
   Expected: se abre el diálogo de impresión con el libro (mismo resultado
   que el botón "Imprimir" de esa pantalla).
3. Cambiar a la pestaña **Compras** y repetir → debe imprimir el Libro de
   Compras (confirma que detecta el botón correcto entre los 3 candidatos).

- [ ] **Paso 5: Commit**

```bash
git add assets/app.js
git commit -m "Atajos de teclado: Ctrl+P imprime el modal o libro fiscal visible

Extiende el motor de la Fase 1. Prioridad: modal de documento abierto
primero, si no hay ninguno, el boton de imprimir del Libro de Ventas/Compras.
Si ninguno aplica, se deja el Ctrl+P nativo del navegador sin interferir."
```

---

### Task 3: Nuevo registro contextual con `Insert`

**Files:**
- Modify: `assets/app.js` (el mismo IIFE `atajosTeclado`)

**Interfaces:**
- Consume: la función local `algunModalVisible()` definida en la Task 1 (este
  código se agrega DENTRO del mismo IIFE `atajosTeclado`, mismo cierre — no
  hace falta pasar por `window.__algunModalVisible`, que queda expuesta solo
  por si algún otro módulo la necesitara en el futuro).

- [ ] **Paso 1: Agregar el dispatcher y su listener, al final del IIFE `atajosTeclado`**

Justo antes del `})();` que cierra el IIFE `atajosTeclado`, agregar:

```js

  function clic(id) { const b = document.getElementById(id); if (b) b.click(); }

  // Fase 1: solo Ventas, Compras (dentro de Fiscal) y Terceros. Vistas nuevas
  // se agregan aquí después, una línea cada una (ver spec, "Fuera de alcance").
  function nuevoRegistroContextual() {
    if (algunModalVisible()) return; // no abrir uno encima de otro ya abierto
    const view = document.querySelector('.view[data-active="true"]');
    const viewId = view && view.id;
    if (viewId === 'view-fiscal') {
      const tab = document.querySelector('.fiscal-tab[data-active="true"]');
      const nombre = tab && tab.dataset.tab;
      if (nombre === 'ventas') clic('regVentaBtn');
      else if (nombre === 'compras') clic('regCompraBtn');
    } else if (viewId === 'view-terceros') {
      clic('nuevoTerceroBtn');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key !== 'Insert') return;
    e.preventDefault(); // Insert no inserta texto en ningun campo; seguro interceptarlo siempre
    nuevoRegistroContextual();
  });
```

- [ ] **Paso 2: Verificar sintaxis**

Run: `node --check assets/app.js`
Expected: sin salida.

- [ ] **Paso 3: Verificación manual — Insert en las 3 vistas de la Fase 1**

1. Ir a **Fiscal → Libro de Ventas** (pestaña Ventas activa, sin modal
   abierto). Presionar **Insert**.
   Expected: se abre "Registrar venta" (mismo resultado que clic en el
   botón).
2. Cerrar ese modal (Escape). Cambiar a la pestaña **Compras**. Presionar
   **Insert**.
   Expected: se abre "Registrar compra".
3. Cerrar. Ir a **Terceros**. Presionar **Insert**.
   Expected: se abre "Nuevo tercero".
4. Ir a **Dashboard** (o cualquier otra vista fuera de la Fase 1). Presionar
   **Insert**.
   Expected: no pasa nada (comportamiento correcto — esas vistas se agregan
   después).

- [ ] **Paso 4: Verificación manual — Insert no abre uno encima de otro**

1. Abrir "Registrar venta" (Fiscal → Ventas).
2. Con ese modal abierto, presionar **Insert** de nuevo.
   Expected: no pasa nada (no se abre un segundo modal encima) — confirma
   que `algunModalVisible()` bloquea correctamente.

- [ ] **Paso 5: Commit**

```bash
git add assets/app.js
git commit -m "Atajos de teclado: Insert abre 'nuevo registro' segun la vista activa

Fase 1: cubre Ventas y Compras (Libro Fiscal) y Terceros. No abre un modal
si ya hay uno visible. El resto de las vistas (Nomina, Contabilidad,
Inventario, Roles, Guias) se agregan despues reutilizando el mismo patron."
```

---

### Task 4: Deploy

**Files:** ninguno (solo push + recordatorio de Deploy)

- [ ] **Paso 1: Push a GitHub**

```bash
git push origin main
```

- [ ] **Paso 2: Avisar a Luis que falta el Deploy manual en EasyPanel**

El código queda en GitHub pero NO se refleja en `app.digiaccount.io` hasta
que se le dé "Deploy" al servicio `app` en EasyPanel (patrón ya conocido de
hoy). Confirmar con Luis cuando lo haga, y repetir la verificación manual de
las Tasks 1-3 ya en producción (con Ctrl+Shift+R para descartar caché vieja).
