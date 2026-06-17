# 🏗️ Guía de Infraestructura con EasyPanel — DigiAccount

> Cómo montar el servidor y los servicios para DigiAccount, paso a paso, desde cero.
> Para Luis (aprendiendo a dominar la infraestructura). Junio 2026.

---

## ¿Qué vamos a montar? (el mapa)

```
        Internet  →  Tu dominio (digiaccount.ai)
                          │
                    ┌─────▼─────┐
                    │    VPS    │  (un servidor en la nube, en Hostinger)
                    │           │
                    │ EasyPanel │  ← panel visual para administrarlo
                    │  ┌──────┐ │
                    │  │ N8N  │ │  ← automatizaciones (WhatsApp, etc.)
                    │  ├──────┤ │
                    │  │ DB   │ │  ← base de datos PostgreSQL
                    │  ├──────┤ │
                    │  │ API  │ │  ← backend de DigiAccount (más adelante)
                    │  └──────┘ │
                    └───────────┘
```

> **Nota sobre los datos financieros:** para la beta, la opción más **segura** es guardar los datos en **Supabase Cloud** (gestionado, con respaldos y seguridad profesional). En EasyPanel practicaremos con N8N y servicios; los datos sensibles pueden ir en Supabase Cloud al inicio y, cuando domines, migrarlos a self-hosted si quieres. Lo decidimos juntos en la Fase de base de datos.

---

## Conceptos nuevos (glosario)

- **VPS:** un servidor (computadora en la nube) que rentas, encendido 24/7.
- **EasyPanel:** un panel con botones para administrar el VPS sin comandos complicados.
- **SSH:** la forma de "entrar" a tu VPS desde tu PC (como un escritorio remoto, pero por texto).
- **Docker:** la tecnología que empaqueta cada app en una "cajita" aislada. EasyPanel lo usa por debajo.
- **DNS:** la "guía telefónica" de internet; conecta tu dominio (digiaccount.ai) con la dirección IP de tu VPS.
- **Subdominio:** una extensión de tu dominio (n8n.digiaccount.ai, app.digiaccount.ai).

---

## FASE A — El servidor (VPS + EasyPanel)

### Paso A1 · Contratar el VPS en Hostinger
- Entra a Hostinger → sección **VPS**.
- Plan recomendado: **KVM 2** (2 vCPU, 8 GB RAM, ~100 GB) — alcanza para EasyPanel + N8N + base de datos + backend.
- Sistema operativo: **Ubuntu 24.04** (limpio, SIN panel preinstalado — EasyPanel lo instalamos nosotros).
- Guarda: la **IP del VPS**, el **usuario** (normalmente `root`) y la **contraseña**.

### Paso A2 · Entrar al VPS (SSH)
- Desde tu PC (PowerShell o la terminal del navegador de Hostinger):
  ```
  ssh root@TU_IP_DEL_VPS
  ```
- Acepta la huella la primera vez y escribe la contraseña.

### Paso A3 · Instalar EasyPanel
- Una vez dentro del VPS, ejecuta el comando oficial de instalación de EasyPanel (te lo paso en el chat en su momento, para usar la versión vigente).
- Al terminar, EasyPanel te dará una **URL** (`http://TU_IP:3000`) para abrir el panel en el navegador y crear tu **usuario administrador**.

### Paso A4 · Apuntar el dominio (DNS)
- En donde compraste el dominio (Hostinger): zona **DNS**.
- Crea registros tipo **A** apuntando a la IP del VPS:
  - `n8n` → IP (para n8n.digiaccount.ai)
  - `app` → IP (para app.digiaccount.ai)
  - `panel` → IP (para entrar a EasyPanel con dominio y HTTPS)
- EasyPanel se encarga del **certificado HTTPS** automáticamente.

---

## FASE B — Primer servicio: N8N 🤖
- En EasyPanel: **Crear proyecto** → **Servicio** → plantilla **N8N**.
- Asignar el subdominio `n8n.digiaccount.ai`.
- EasyPanel levanta N8N con HTTPS. Entras, creas tu cuenta y ya tienes automatizaciones.
- *Aquí aprendes el flujo completo de EasyPanel con algo útil y visible.*

---

## FASE C — Base de datos
- Opción 1 (recomendada para empezar): **Supabase Cloud** (gestionado, seguro, gratis).
- Opción 2 (más control, más complejo): **PostgreSQL** o **Supabase self-hosted** dentro de EasyPanel.
- Lo decidimos según qué tan profundo quieras meterte.

---

## FASE D — Backend de DigiAccount
- Desplegar el backend (Node.js / API) en EasyPanel desde GitHub.
- Conectarlo a la base de datos y a Claude (agentes IA).

---

## FASE E — Publicar la app
- `app.digiaccount.ai` → el frontend (PWA) servido con HTTPS.
- Conectado al backend y la base de datos.

---

## 🔒 Seguridad básica del servidor (la haremos en el camino)
- Firewall (UFW): abrir solo los puertos necesarios.
- Acceso por **clave SSH** (más seguro que contraseña).
- **Respaldos** automáticos del VPS (Hostinger los ofrece).
- Contraseñas fuertes y EasyPanel siempre actualizado.

---

## ✅ Orden sugerido
```
A. VPS + EasyPanel + dominio   ← empezamos aquí
B. N8N (primer servicio)
C. Base de datos
D. Backend
E. Publicar la app
```

Cada paso lo hacemos **juntos**: yo te guío, tú ejecutas, me cuentas el resultado.
