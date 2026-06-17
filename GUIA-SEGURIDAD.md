# 🔒 Guía de Seguridad de DigiAccount

> Plan de ciberseguridad para proteger los **datos financieros** de tus clientes,
> adaptado a tu stack: PWA + VPS Hostinger + EasyPanel + Supabase + N8N + Claude API.
> Para Luis. Última actualización: junio 2026.

---

## La idea central (léela dos veces)

> **La seguridad no es un módulo que se añade al final; es una decisión en cada capa.**
> En un sistema contable, una sola fuga equivale a perder la confianza de TODOS tus clientes.

Analogía: tu sistema es un **banco**. No basta con una puerta fuerte (login);
necesitas bóveda (base de datos aislada), cámaras (auditoría), normas para los
empleados (roles), y un plan si algo sale mal (respaldos e incidentes).

**Regla de oro:** el navegador (frontend) SIEMPRE puede ser manipulado por un
atacante. Toda validación, permiso y cálculo importante debe verificarse
**en el servidor**, aunque el frontend ya lo valide.

---

## ✅ Lo que ya se aplicó al frontend (junio 2026)

| # | Mejora | Por qué importa |
|---|---|---|
| 1 | **Lucide auto-hospedado** (`assets/lucide.min.js`, versión fija 0.525.0) en lugar de `unpkg.com/@latest` | Antes cargabas un script de un CDN externo *en su última versión, sea cual sea*. Si ese paquete fuera comprometido (ataque de cadena de suministro), el código malicioso entraría directo a tu app financiera. Además ahora los íconos funcionan offline (PWA). |
| 2 | **CSP** (Content-Security-Policy) en `index.html` | Le dice al navegador: "solo ejecuta scripts propios, no cargues nada de dominios desconocidos". Es una red de seguridad que mitiga XSS e inyecciones. |
| 3 | **Función `esc()` global** + aplicada a toast, modal genérico de formularios, terceros y métodos de cobro | Sin escape, un nombre de cliente como `<img src=x onerror=robarDatos()>` se ejecutaría como código al mostrarse. Hoy los datos son locales; con backend sería **XSS almacenado** (un usuario inyecta, TODOS los demás lo ejecutan). |
| 4 | **Contraseña demo eliminada** del HTML (`value="demo1234"`) | Credenciales escritas en el código fuente son lo primero que busca un atacante. |
| 5 | **Registro del Service Worker movido a app.js** (sin scripts inline) | Permite una CSP estricta (`script-src 'self'`) sin excepciones para código inline. |
| 6 | **sw.js**: caché v2 + `digiaccount.css` y `lucide.min.js` precacheados | La PWA ahora es completa offline y sin dependencias externas de JS. |

### ⚠️ Regla pendiente para la Fase 3 (conexión con Supabase)
El archivo `app.js` tiene ~140 usos de `innerHTML`. Hoy renderizan datos de
ejemplo (seguros). **Cuando un dato venga de la base de datos o de un input del
usuario, debe pasar por `esc()`**. Ya existe la función global (`window.esc`).
Convención: *"dato del usuario o de la BD → siempre `esc()` al construir HTML"*.

---

## 1 · Seguridad de la base de datos (Supabase) — LA MÁS IMPORTANTE

Aquí viven los datos financieros. Si esto está bien, el 80% del riesgo está cubierto.

### RLS (Row Level Security) — tu bóveda
- **Activar RLS en TODAS las tablas desde el día uno.** Sin excepción. Una tabla sin RLS en Supabase es pública para cualquiera con la clave `anon`.
- Patrón multi-tenant: cada tabla lleva una columna `empresa_id`, y la política dice *"solo puedes ver/editar filas cuya empresa esté entre las tuyas"*.
- **Probar el RLS como atacante:** crea dos usuarios de prueba (Empresa A y Empresa B) e intenta leer datos de B logueado como A. Hazlo ANTES de invitar clientes reales.
- Las políticas de escritura (`INSERT/UPDATE/DELETE`) son tan importantes como las de lectura. Que nadie pueda *escribir* facturas en una empresa ajena.

### Las dos llaves de Supabase (no las confundas)
| Llave | Dónde puede vivir | Qué hace |
|---|---|---|
| `anon` (pública) | Frontend ✅ | Solo funciona "a través" del RLS. Es segura de exponer **solo si el RLS está bien hecho**. |
| `service_role` (secreta) | Backend/N8N ❌ NUNCA en el frontend | **Ignora el RLS por completo.** Quien la tenga, lo ve TODO. Trátala como la llave maestra del banco. |

### Reglas de datos contables
- **Nunca borrar, anular.** Los asientos y facturas no se eliminan: se marcan como anulados con motivo, fecha y usuario (igual que en contabilidad real).
- **Tabla de auditoría:** quién hizo qué, cuándo y desde dónde (creó factura, modificó asiento, exportó libro, inició sesión). Inmutable: nadie la edita, ni el admin.
- **Montos como `numeric`** en PostgreSQL (nunca `float`) — evita errores de redondeo.

---

## 2 · Autenticación y usuarios (Supabase Auth)

- **Contraseñas:** mínimo 8+ caracteres (ya validas esto en el frontend; repítelo en el servidor). Supabase las guarda hasheadas — nunca guardes contraseñas en tus propias tablas.
- **Activar "Leaked password protection"** en Supabase Auth (rechaza contraseñas que aparecen en filtraciones conocidas).
- **2FA (MFA):** ofrécelo a todos; **oblígalo** para roles administrativos y para tu cuenta de fundador.
- **Verificación de email** obligatoria antes de usar el sistema.
- **Sesiones:** expiración razonable (ej. 7 días) y botón real de "cerrar sesión en todos los dispositivos".
- **Login con Google (OAuth):** hoy es demo; en producción configúralo vía Supabase Auth (nunca lo implementes a mano).
- **Roles con mínimo privilegio:** el asistente contable no ve nómina; el vendedor no exporta libros. Cada rol = lo mínimo necesario. Y el rol se verifica **en el RLS**, no solo ocultando botones.

---

## 3 · Backend / API (Node.js en EasyPanel)

- **Valida TODO en el servidor:** tipos, rangos, formatos (RIF, fechas, montos). El frontend valida por cortesía; el backend valida por seguridad.
- **Secretos en variables de entorno** (EasyPanel → Environment): claves de Supabase, Anthropic, pasarela de pagos. Jamás en el código ni en GitHub.
- **Rate limiting:** máximo N intentos de login por minuto por IP (frena ataques de fuerza bruta). Aplica también a endpoints costosos (reportes, IA).
- **CORS estricto:** la API solo acepta peticiones desde `app.digiaccount.ai`, no desde `*`.
- **Cabeceras de seguridad** (con `helmet` en Node o desde el proxy de EasyPanel): `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, y la misma CSP que ya tiene el HTML (en cabecera es más fuerte que en `<meta>`).
- **Claude API solo desde el backend** (ya lo tienes claro). Además: límites de gasto en la consola de Anthropic, y nunca incluir datos de un cliente en el prompt de otro.
- **Logs sin datos sensibles:** no escribas contraseñas, tokens ni montos completos en los logs.

---

## 4 · El VPS (Hostinger + EasyPanel)

Checklist al montarlo (Fase A de tu guía de infraestructura):

1. **SSH con clave, no con contraseña.** Genera una clave en tu PC (`ssh-keygen`), súbela al VPS y desactiva el login por contraseña (`PasswordAuthentication no`). Es la mejora #1 — los bots prueban contraseñas de root las 24 h.
2. **Desactivar login directo de `root`** una vez creado tu usuario administrador.
3. **Firewall (UFW):** abre SOLO 22 (SSH), 80 y 443 (web). La base de datos y los servicios internos NUNCA expuestos a internet — Docker/EasyPanel los comunica por red interna.
4. **fail2ban:** bloquea IPs que fallan login repetidamente. Instalación de 2 minutos.
5. **Actualizaciones automáticas de seguridad:** `unattended-upgrades` en Ubuntu.
6. **EasyPanel:** accesible solo por HTTPS con su subdominio (`panel.digiaccount.ai`), contraseña fuerte + 2FA si lo ofrece, y mantenerlo actualizado.
7. **Respaldos del VPS** activados en Hostinger (snapshots) — además de los de la base de datos.

---

## 5 · N8N (automatizaciones)

- Protegido con usuario/contraseña propios (no dejarlo abierto al crearlo).
- **Webhooks con secreto:** cualquier webhook que reciba datos debe validar un token; si no, cualquiera en internet puede dispararlo.
- Las credenciales que guardes en N8N (WhatsApp, Gmail, Supabase) viven cifradas — respalda la clave de cifrado (`N8N_ENCRYPTION_KEY`).
- Si un flujo usa la llave `service_role` de Supabase, ese flujo es "llave maestra": revisa bien qué hace y quién puede editarlo.

---

## 6 · Respaldos y plan de incidentes

- **Respaldos automáticos diarios** de la base de datos (Supabase Cloud los incluye; verifica la retención de tu plan).
- **Regla 3-2-1:** 3 copias, 2 medios distintos, 1 fuera del proveedor (ej. exportación semanal cifrada a otro almacenamiento).
- **Probar la restauración** al menos una vez antes de tener clientes reales. Un respaldo no probado no es un respaldo, es una esperanza.
- **Plan de incidentes (escríbelo, 1 página):** si sospechas una fuga → 1) rotar todas las claves, 2) revisar logs de auditoría, 3) cerrar sesiones activas, 4) avisar a los clientes afectados con honestidad, 5) corregir y documentar.

---

## 7 · Seguridad operativa (tu lado humano)

El eslabón más débil suele ser una cuenta personal:

- **2FA en TODO:** Hostinger, GitHub, Supabase, Anthropic, el registrador del dominio y tu correo (el correo es la llave de recuperación de todo lo demás).
- **Gestor de contraseñas** (Bitwarden, 1Password) — contraseñas únicas por servicio.
- **GitHub:** repositorio privado; activa *secret scanning* y nunca subas `.env` (añádelo a `.gitignore` desde el primer commit).
- **El dominio:** con auto-renovación y bloqueo de transferencia. Si lo pierdes, pierdes el negocio.
- **Cuando tengas equipo:** cada quien con SU cuenta (nada de compartir claves) — así la auditoría dice la verdad.

---

## 8 · Checklist por fases (alineado con tu GUIA-DESARROLLO)

### Fase 0-1 (Supabase + GitHub)
- [ ] 2FA en GitHub, Supabase, Hostinger, Anthropic y tu correo
- [ ] Repo privado + `.gitignore` con `.env` desde el primer commit
- [ ] RLS activado en TODAS las tablas al crearlas
- [ ] Test de aislamiento: Empresa A no ve datos de Empresa B

### Fase 2 (Auth)
- [ ] Verificación de email + leaked password protection
- [ ] 2FA disponible (obligatorio para admins)
- [ ] Rate limiting en login

### Fase 3 (Conectar frontend)
- [ ] Solo la llave `anon` en el frontend
- [ ] Todo dato de la BD pasa por `esc()` al renderizarse
- [ ] Validaciones repetidas en servidor

### Fase 4 (Reglas de negocio)
- [ ] Tabla de auditoría inmutable
- [ ] Anular en vez de borrar (facturas/asientos)
- [ ] Roles aplicados en RLS, no solo en la interfaz

### Fase A (VPS)
- [ ] SSH por clave + root deshabilitado + UFW + fail2ban
- [ ] Solo puertos 22/80/443 expuestos
- [ ] Snapshots de Hostinger activados

### Antes de clientes reales
- [ ] Restauración de respaldo probada
- [ ] Plan de incidentes escrito
- [ ] Revisión de seguridad completa (la hacemos juntos)

---

> **Siguiente paso práctico:** al crear las cuentas de la Fase 0, activa el 2FA
> en cada una en ese mismo momento. Es gratis, toma 2 minutos y elimina el
> vector de ataque más común del mundo real.
