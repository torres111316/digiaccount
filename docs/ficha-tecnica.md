# Ficha técnica del sistema — DigiAccount ERP

> ## ⚠️ La norma que exigía este recaudo fue derogada
>
> La **Providencia Administrativa SNAT/2026/00084**, publicada en la Gaceta
> Oficial N° 43.435 del 12 de agosto de 2026, **deroga la SNAT/2024/000121** —la
> que regulaba las condiciones y requisitos para los proveedores de sistemas
> informáticos de facturación— y **no la sustituye por ningún otro régimen**.
>
> Este documento **se mantiene a propósito**, por tres razones:
>
> 1. Una derogatoria sin reemplazo suele preceder a una norma nueva, no a la
>    ausencia de norma. Si llega, el trabajo ya está hecho.
> 2. Lo que aquí se describe es **buena ingeniería con providencia o sin ella**:
>    un libro fiscal que se pueda alterar en silencio es un mal libro aunque
>    nadie lo prohíba.
> 3. Deja de ser un requisito y pasa a ser un **diferenciador verificable**
>    frente a competidores que no lo tienen.
>
> Las obligaciones del **emisor** no cambian: la **Providencia SNAT/2024/000102**
> sigue vigente y no fue tocada por esta Gaceta.

---

> Se redactó como recaudo de la solicitud de autorización como proveedor de
> sistemas informáticos de facturación —**Providencia SNAT/2024/000121, Artículo
> 4**, hoy derogada—, que exigía la *"ficha técnica del sistema (aplicativo,
> lenguaje, base de datos, monitoreo y auditoría, tipo de conexión con las
> plataformas)"*. Hoy cumple otra función: **describe con precisión qué es y cómo
> funciona el sistema**, que es lo que pide cualquier cliente serio, cualquier
> auditor y cualquier régimen que venga después.
>
> **Estado:** documento vivo. Se actualiza a medida que el sistema avanza.
> Última revisión: 14/08/2026.

---

## 1 · Identificación

| | |
|---|---|
| **Nombre del sistema** | DigiAccount ERP |
| **Tipo** | Sistema de gestión administrativa, contable, fiscal y de facturación |
| **Modalidad** | Servicio por suscripción (software como servicio), multi-inquilino |
| **Desarrollador y proveedor** | *(razón social y RIF de la C.A. — pendiente de constitución)* |
| **Acceso** | Navegador web, en `app.digiaccount.io` |
| **Instalable** | Sí, como aplicación web progresiva (PWA) en escritorio y teléfono |

---

## 2 · Aplicativo

Aplicación web de página única. El usuario entra por navegador; no se instala nada
en su equipo, aunque puede añadirla a su pantalla de inicio como aplicación.

**Módulos:** Ventas y Facturación · Compras · Fiscal (libros, Forma 30, retenciones
de IVA e ISLR, IGTF, calendario) · Contabilidad (plan de cuentas VEN-NIF, asientos,
estados financieros, criptoactivos, impuesto diferido) · Tesorería · Inventario ·
Nómina (LOTTT) · Terceros · Administración de usuarios y roles · Centro de Agentes IA.

---

## 3 · Lenguaje y arquitectura

| Capa | Tecnología |
|---|---|
| **Interfaz** | HTML5, CSS3 y JavaScript (ECMAScript 2020), sin marco de trabajo |
| **Compilación** | Ninguna. El código que se despliega es el código que se escribe |
| **Servidor web** | Nginx (contenedor Docker basado en `nginx:alpine`) |
| **Backend** | PostgreSQL 15 con PostgREST, sobre Supabase |
| **Autenticación** | Supabase Auth (GoTrue), tokens JWT |
| **Automatización** | n8n, en servidor propio (`n8n.digiaccount.io`) |

**Nota sobre la ausencia de marco de trabajo y de compilación.** Es una decisión
deliberada y relevante para esta solicitud: **el archivo que corre en producción es
legible tal cual**, sin transformaciones intermedias. Un evaluador puede leer el
código que efectivamente se ejecuta, sin depender de mapas de código fuente ni de
reconstruir un empaquetado. También simplifica la re-homologación que exige el
Artículo 9 ante cada nueva versión.

---

## 4 · Base de datos

**PostgreSQL 15**, alojada en Supabase, con réplica y respaldos automáticos diarios.

**Aislamiento entre contribuyentes.** Cada cuenta y cada empresa están separadas por
**seguridad a nivel de fila (Row Level Security)** aplicada en el motor de la base,
no en la aplicación. Ninguna consulta —venga de la interfaz, de la API o de una
herramienta externa— puede devolver datos de un contribuyente a otro. Las funciones
`mi_cuenta_id()` y `soy_superadmin()` resuelven la pertenencia en cada consulta.

**Tablas fiscales principales:** `libro_fiscal` (libros de compras y ventas),
`facturas` (documentos emitidos, incluidas notas de crédito y débito), `retenciones`
(IVA e ISLR), `asientos` (contabilidad), `documentos_fiscales` (bóveda de
declaraciones y comprobantes), `empresas`, `eventos_sistema` (registro de eventos).

**Conservación.** Los registros no se eliminan. Ver la sección 7.

---

## 5 · Monitoreo y auditoría

### 5.1 Registro de eventos (Art. 3, literales c y e)

Toda operación de alta, modificación o eliminación sobre las tablas fiscales queda
registrada en `eventos_sistema` con **fecha y hora, usuario, cuenta, empresa, tabla,
identificador del registro, y el estado completo del registro antes y después** del
cambio.

**Se implementa con disparadores dentro del motor de la base de datos, no en la
aplicación.** La distinción es sustancial: un registro escrito por el navegador se
omitiría si alguien operara directamente contra la API con credenciales válidas. El
disparador se ejecuta cualquiera sea el origen de la operación —interfaz, API,
consola de administración o automatización—, que es lo que satisface el requisito de
que el registro sea *automático*.

**El registro no es alterable.** Se revocaron los permisos de escritura, modificación
y eliminación sobre `eventos_sistema` para todos los perfiles de usuario; el único
que escribe es el disparador, que corre con privilegios propios. Ninguna sesión de
usuario puede insertar, editar ni borrar un evento.

Tablas bajo auditoría: `libro_fiscal`, `facturas`, `retenciones`, `asientos`,
`documentos_fiscales`, `empresas`, `recibos_nomina`, `movimientos_tesoreria`.

### 5.2 Inalterabilidad (Art. 3, literales a y d)

Las empresas autorizadas por el SENIAT como emisores operan en **modo factura**. En
ese modo:

- Un documento emitido **no se elimina ni se modifica**. Solo puede variar su estado
  de cobro, y nunca a "anulada".
- La corrección o anulación se hace **exclusivamente mediante notas de crédito o
  débito**, que son documentos nuevos vinculados al original. **La factura original
  no se altera en ningún caso, ni siquiera para marcarla como anulada**: que un
  documento esté anulado se determina consultando sus notas.
- Una nota sin la factura que corrige, o sin motivo declarado, **no puede existir**:
  ambas condiciones son restricciones de la base de datos.
- Los registros del libro de ventas no se modifican. Los del **libro de compras sí
  admiten corrección**, por una razón de fondo: el documento pertenece al proveedor y
  el libro es el registro de un documento ajeno; un error de transcripción del RIF no
  se corrige con una nota que tendría que emitir un tercero. Toda corrección queda en
  el registro de eventos con su estado anterior.
- Ningún registro del libro fiscal se elimina, en ningún caso.

**Estas reglas viven en el motor de la base de datos, no en la interfaz.** La
disposición final quinta de la Providencia 000121 —hoy derogada— establecía la responsabilidad del
proveedor como coautor si el sistema *permite* la alteración de registros —no
únicamente si la alteración ocurre—. Una validación de pantalla puede eludirse
operando contra la API; una restricción del motor no.

### 5.3 Modo de operación por empresa

El campo `empresas.modo_doc` determina si una empresa opera en modo recibo (por
defecto) o en modo factura. **Solo el administrador del proveedor puede modificarlo**,
mediante permiso otorgado a nivel de columna: ningún usuario de una cuenta cliente
puede activarlo, ni siquiera operando directamente contra la API.

El fundamento es el Artículo 18 de la Providencia 000102: cada emisor requiere su
**propia autorización del SENIAT**. La activación del modo factura constituye, en la
práctica, la constancia de que esa empresa la obtuvo.

---

## 6 · Inteligencia artificial y automatización

El sistema incorpora asistencia por inteligencia artificial. Se declara expresamente
por su relación con los registros fiscales.

**Lo que hace hoy.** El único componente de IA que interviene sobre datos fiscales es
el **lector de documentos (OCR)**: al adjuntar la fotografía o el PDF de una factura
de compra, extrae los datos y **precarga el formulario**. El usuario revisa, corrige
si hace falta, y registra. Cuando lo leído no cuadra con los totales, o la alícuota
no coincide, el sistema lo advierte en lugar de corregirlo por su cuenta.

**Política declarada del sistema:**

> **Ningún agente de inteligencia artificial escribe un registro fiscal sin
> aprobación humana.** Los agentes proponen; una persona aprueba. En consecuencia,
> todo registro fiscal tiene un autor humano identificado, y el registro de eventos
> lo acredita con su identificador de usuario y la hora.

Los demás agentes operan sobre tareas de apoyo —conciliación, alertas, análisis— y
sus acciones sobre registros fiscales pasan por una bandeja de aprobación.

**Automatización con n8n.** Se emplea para procesos que no crean documentos fiscales:
carga de tasas de cambio del BCV, avisos del calendario fiscal, captación de contactos
del sitio web. Las operaciones que n8n realiza sobre tablas auditadas quedan igualmente
registradas en `eventos_sistema`, porque los disparadores no distinguen el origen.

---

## 7 · Conservación y contingencia

**Conservación (10 años).** Los registros fiscales no se eliminan, y no por política
sino por estructura: los disparadores de inalterabilidad rechazan toda eliminación. La
conservación se apoya en tres niveles —base en producción, respaldos del proveedor de
infraestructura y archivo independiente en formato abierto—, detallados en
[`politica-conservacion.md`](politica-conservacion.md).

**Contingencia.** La aplicación es una aplicación web progresiva instalable: abre y
permite **consultar** sin conexión con los datos ya descargados. **No permite emitir
documentos sin conexión**, lo que deja sin cubrir el nivel 2 de la escalera del
Artículo 16 de la 000102. Se declara con su plan en
[`procedimiento-contingencia.md`](procedimiento-contingencia.md).

---

## 8 · Tipo de conexión con las plataformas

| Conexión | Protocolo | Estado |
|---|---|---|
| Usuario ↔ aplicación | HTTPS (TLS 1.3), a través de Cloudflare | Operativo |
| Aplicación ↔ base de datos | HTTPS sobre PostgREST, con token JWT por sesión | Operativo |
| Aplicación ↔ automatización (n8n) | HTTPS, en dominio propio | Operativo |
| **Sistema ↔ SENIAT (consulta)** | API de solo lectura sobre HTTPS, con clave por empresa | Operativo |
| **Sistema ↔ SENIAT (remisión)** | Según formato que publique el SENIAT | **Pendiente — sección 9** |
| Sistema ↔ imprenta digital | Según la imprenta que se contrate | **Pendiente — sección 9** |

**Política de contenido.** La aplicación declara una política estricta de seguridad de
contenido (`Content-Security-Policy`) que limita las conexiones salientes al dominio
de la base de datos y al de automatización. No se admiten orígenes distintos.

---

## 9 · Lo que falta, declarado

Se enumera de forma expresa. Un documento que omite lo pendiente es más frágil que
uno que lo declara con su plan.

**La derogatoria del 12/08/2026 partió esta lista en dos.** Lo que exigía la 000121
al *proveedor del software* dejó de ser obligatorio; lo que exige la 000102 y la Ley
de IVA al *emisor* sigue igual. Se separan para que se vea cuál es cuál.

### Sigue siendo obligatorio — recae sobre el emisor

| Requisito | Situación | De quién depende |
|---|---|---|
| **Autorización del emisor** (000102, Arts. 17-20) | Cada empresa que emita necesita la suya. El sistema lo modela: el modo de emisión se activa por empresa, con su fecha y número de autorización | Del cliente |
| **Integración con imprenta digital** (000102, Art. 7.4) | Por definir. El número de control se deja deliberadamente vacío mientras no exista imprenta contratada | De contratar una imprenta autorizada |
| **Formato de la factura** (000102, Art. 7) | Modelo completo redactado en `docs/formato-factura.html`, con productos y servicios. Faltan los numerales que asigna la imprenta (4, 5, 14 y 15) | De lo anterior |
| **Conservación por diez años** (LIVA) | Política redactada. Falta automatizar la exportación mensual al archivo independiente | Del proveedor |
| **Emisión sin conexión** (000102, Art. 16 nivel 2) | No cubierto. La arquitectura existe y está probada en el otro producto de la empresa; su traslado depende además de los rangos que entregue la imprenta | Del proveedor y de la imprenta |
| **Constitución de la compañía** | En trámite | Del registro mercantil |

### Ya no es obligatorio — se conserva como estándar propio

Lo exigía la 000121 al proveedor del software. **Nadie lo pide hoy.** Se mantiene
porque describe capacidades reales del sistema que un cliente puede verificar, y
porque una derogatoria sin reemplazo bien puede preceder a una norma nueva.

| Capacidad | Situación |
|---|---|
| **Clave de consulta y API de fiscalización** (era Art. 3.h) | **Construida y probada desde fuera.** Seis consultas de solo lectura, clave por empresa, cada consulta registrada |
| **Registro de eventos inalterable** (era Art. 3) | **Construido.** Disparadores en ocho tablas; verificado que ninguna sesión de usuario puede escribirlo, alterarlo ni borrarlo |
| **Inalterabilidad de documentos fiscales** (era Art. 3) | **Construida.** Solo en modo emisión; la corrección va por nota de crédito o débito, y el documento original nunca se toca |
| **Remisión automática al SENIAT** (era Art. 3.b) | Diseñada; la infraestructura de automatización está operativa. Nunca se publicaron los formatos técnicos |
| **Re-autorización por versión** (eran Arts. 9-11) | El trámite desapareció. La capacidad de identificar y comparar versiones se conserva — ver sección 10 |

---

## 10 · Sobre el control de versiones

Los Artículos 9 al 11 de la 000121 —derogada— exigían nueva autorización ante cada
versión nueva del sistema. **Ese trámite ya no existe**, pero la capacidad de
identificar y comparar versiones sigue siendo necesaria: la pide cualquier auditoría
y la pediría un régimen nuevo. Dos características lo facilitan:

- **El código fuente desplegado es el código legible**, sin compilación intermedia.
- **Todo cambio en la base de datos está versionado** en archivos de migración,
  numerados y reversibles, bajo control de versiones.

Cada versión puede identificarse y compararse con la anterior de forma verificable.
