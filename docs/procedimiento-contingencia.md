# Procedimiento de contingencia

> **Fundamento:** Providencia Administrativa SNAT/2024/000102, **Artículo 16**, que
> establece una escalera de tres niveles, y **Artículo 18 numeral 8**, que obliga al
> emisor a disponer de sistemas de contingencia propios o contratados.
>
> **Estado:** borrador. Contiene un requisito **no cubierto** — ver la sección 4.
> Última revisión: 09/08/2026.

---

## 1 · La escalera del Artículo 16

La Providencia no admite improvisación: define qué hacer en cada falla, en orden.

| Nivel | Qué falla | Qué manda la Providencia |
|---|---|---|
| **1** | La conexión a internet | Emitir desde la **aplicación móvil** |
| **2** | El equipo móvil | Emitir desde la **aplicación sin conexión** |
| **3** | La energía eléctrica | Emitir en **talonario físico** de imprenta autorizada, con la palabra **"contingencia"** |

**Al superarse la contingencia** hay tres obligaciones, y son del emisor:

1. Registrar en el sistema los documentos emitidos en físico.
2. Resguardar los ejemplares físicos.
3. **Notificar por escrito** a la Gerencia Regional de Tributos Internos **y a la
   imprenta digital**.

---

## 2 · Qué cubre el sistema hoy

**Nivel 1 — sin internet.** Cubierto parcialmente. DigiAccount es una aplicación web
progresiva: se instala en el teléfono y **abre sin conexión**, mostrando los datos ya
descargados. No hay una "aplicación móvil" distinta que consultar: es la misma
aplicación, y funciona en el teléfono. Para *consultar* durante un corte, sirve.

**Nivel 2 — emitir sin conexión.** **NO cubierto.** Ver la sección 4.

**Nivel 3 — talonario físico.** Corresponde al emisor, no al sistema. El sistema
aporta lo que sigue después: la carga de esos documentos al libro, con su período de
declaración, y el registro de eventos que deja constancia de cuándo se cargaron.

---

## 3 · Continuidad de la infraestructura

| Componente | Qué pasa si falla | Recuperación |
|---|---|---|
| Aplicación web | El trabajador de servicio sirve la copia local | Inmediata, en modo consulta |
| Servidor web (Nginx en contenedor) | EasyPanel reinicia el contenedor | Automática |
| Base de datos | Alta disponibilidad y respaldos del proveedor | Restauración por punto en el tiempo |
| Dominio y certificado | Cloudflare como capa intermedia | Automática |
| Automatización (n8n) | No afecta la emisión de documentos | Diferida |

Ninguna de estas fallas obliga a bajar al nivel 3 mientras haya energía e internet.

---

## 4 · El requisito que NO está cubierto

Se declara de forma expresa. **La aplicación abre sin conexión, pero no puede emitir
documentos sin conexión.** Los registros se escriben directamente contra la base de
datos; sin red, la operación falla.

Eso deja el **nivel 2 del Artículo 16 sin cumplir**: ante una falla del equipo o de la
red, hoy no hay emisión sin conexión y habría que saltar directo al talonario físico.

### El plan, y por qué es concreto

**La arquitectura que resuelve esto ya existe, construida y probada, en el otro
producto de la empresa.** Al Día —sistema de venta y cobranza en ruta— opera
íntegramente sin conexión con este esquema:

- Almacén local en el navegador (IndexedDB) como fuente de verdad durante la jornada.
- **Cola de salida** con identificadores generados en el propio dispositivo, lo que
  hace que reintentar el envío nunca duplique un registro.
- Secuencia estrictamente creciente para conservar el orden, de modo que un documento
  no llegue al servidor antes que aquel del que depende.
- Reenvío automático al recuperar la señal.

No es un diseño por hacer: está en producción y probado en campo, con equipos
trabajando en zonas de señal irregular. **Trasladarlo a DigiAccount es adaptación, no
invención.**

### Consideración adicional para el modo factura

La emisión sin conexión tiene una restricción que no aplica a un recibo: **el número
de control lo asigna la imprenta digital**, y sin conexión no se le puede pedir. La
solución habitual es que la imprenta entregue **rangos de números por adelantado**,
que el sistema consume sin conexión y concilia al reconectar.

Eso depende de la imprenta que se contrate, así que la solución completa del nivel 2
está condicionada a esa contratación. **La parte que corresponde al proveedor del
sistema —el almacén local y la cola— no lo está y puede construirse desde ya.**

---

## 5 · Qué hacer mientras tanto

Instrucciones para el emisor, hasta que el nivel 2 esté cubierto:

**Si se cae internet o el equipo:** emitir en el talonario físico de contingencia, con
la palabra "contingencia" visible, tal como manda el numeral 3 del Artículo 16.

**Al restablecerse el servicio, el mismo día si es posible:**

1. Cargar cada documento físico en el sistema, en el período que corresponda.
2. Resguardar los ejemplares físicos con el resto de la documentación fiscal.
3. Notificar por escrito a la Gerencia Regional de Tributos Internos y a la imprenta
   digital, indicando el motivo, la duración y los números utilizados.

El registro de eventos deja constancia automática de cuándo se cargó cada documento,
lo que respalda la notificación con una marca de tiempo que nadie escribió a mano.

---

## 6 · Resumen para la solicitud

| Nivel | Estado |
|---|---|
| 1 · Consulta sin internet | ✅ Cubierto — aplicación web progresiva instalable |
| 2 · **Emisión sin conexión** | ⬜ **No cubierto.** Arquitectura disponible y probada en otro producto de la empresa; su traslado depende además de los rangos de numeración que entregue la imprenta digital |
| 3 · Talonario físico | Corresponde al emisor. El sistema soporta la carga posterior y la deja registrada |
