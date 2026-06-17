# 📘 Guía de Desarrollo de DigiAccount

> Documento para entender **cómo está hecho el proyecto** y el **plan para construir el backend**, explicado desde cero.
> Hecho para Luis (contador aprendiendo a desarrollar). Última actualización: junio 2026.

---

## 1. ¿Qué es DigiAccount y de qué partes se compone?

DigiAccount es un **SaaS** (un sistema que se renta por suscripción, vía web) de gestión contable y fiscal para Venezuela.

Todo sistema como este tiene **3 grandes partes**. Usemos una analogía de una oficina contable:

| Parte | Qué es | Analogía |
|---|---|---|
| **Frontend** | Lo que el usuario ve y toca (pantallas, botones, formularios) | La **recepción y las oficinas** que ve el cliente |
| **Backend** | El "cerebro" que procesa, valida y aplica las reglas | La **trastienda**: el contador que calcula y decide |
| **Base de datos** | Donde se guarda TODO de forma permanente | Los **libros contables / el archivo** |

Y entre el frontend y el backend se comunican mediante una **API**:
> **API** = el **mensajero** que lleva los pedidos de la recepción a la trastienda y trae las respuestas. Ej: "guarda esta factura" → la API la lleva al backend → el backend la guarda en la base de datos → la API responde "listo".

**Hoy tenemos:** el **frontend completo** (la recepción y oficinas, hermosas y funcionales) pero con **datos de mentira** (en la memoria del navegador; al recargar se borran).
**Falta:** el **backend + base de datos**, para que los datos sean **reales, guardados y seguros**.

---

## 2. ¿Cómo está organizado el proyecto hoy?

Carpeta: `C:\Users\torre\OneDrive\Escritorio\PROYECTOS\DigiAccount\`

```
DigiAccount/
├── index.html          ← estructura de todas las pantallas
├── manifest.json       ← identidad de la app (PWA)
├── sw.js               ← service worker (hace que funcione offline / instalable)
├── GUIA-DESARROLLO.md  ← este documento
└── assets/
    ├── app.css         ← diseño (colores, tamaños, estilos)
    ├── app.js          ← lógica (botones, cálculos, datos de ejemplo)
    ├── digiaccount.css ← variables de diseño base
    ├── isotipo*.png    ← logos
    └── pwa-*.png       ← íconos de la app
```

> `da-server.js` (un nivel arriba, en `PROYECTOS/`) es un **servidor local de prueba** para ver el proyecto en `http://localhost:8090`. En producción se reemplaza por un hosting real.

---

## 3. Conceptos que vas a usar (glosario para novato)

- **Servidor:** una computadora encendida 24/7 que entrega tu app por internet. Hoy usas tu PC (local); en producción se usa un hosting.
- **Hosting:** el "alquiler" del servidor donde vive tu app (ej. Vercel, Netlify).
- **HTTPS:** la versión segura de la web (el candadito 🔒). Cifra la comunicación. Obligatorio para datos financieros y para instalar la PWA en celulares.
- **Base de datos relacional (SQL/PostgreSQL):** libros conectados entre sí (clientes, facturas, asientos). Ideal para contabilidad porque respeta relaciones y transacciones.
- **Autenticación:** verificar quién entra (usuario + contraseña, 2FA).
- **Multi-tenant:** un mismo sistema usado por muchos clientes, donde cada uno solo ve SUS datos.
- **RLS (Row Level Security):** reglas en la base de datos que garantizan que cada cliente solo acceda a su información. **La defensa más importante.**
- **Git / GitHub:** un "libro diario de cambios" + caja fuerte con respaldo de cada versión de tu código.
- **API key:** una contraseña secreta para usar servicios (Claude, pagos). Nunca se pone en el frontend.

---

## 4. Herramientas recomendadas y para qué sirve cada una

| Herramienta | Para qué | Notas |
|---|---|---|
| **Supabase** | Base de datos (PostgreSQL) + autenticación + almacenamiento | El corazón. Trae RLS y login listos. |
| **GitHub** | Guardar y versionar el código | Respaldo + historial + colaboración |
| **Claude API (Anthropic)** | Los Agentes IA y el OCR de facturas | Se llama desde el backend, nunca desde el navegador |
| **N8N (self-hosted)** | Automatizaciones: WhatsApp, Telegram, Gmail, conectar todo | Self-hosted = tus datos no pasan por terceros |
| **Vercel / Netlify** | Publicar el frontend con HTTPS gratis | Resuelve la instalación de la PWA en celular |
| **Pasarela de pago VE** | Cobros (Pago Móvil, USDT) | Platno, Mega Soft, Instapago, etc. |

---

## 5. EL PLAN — Backend por fases

### Fase 0 · Preparación (las herramientas) 🧰
- Crear cuentas: **GitHub**, **Supabase**, **Anthropic (Claude)**.
- Subir el proyecto actual a **GitHub** (respaldo + control de versiones).
- *Resultado:* todo listo para empezar, con el código respaldado.
- *Analogía:* abrir las cuentas y comprar los libros antes de registrar.

### Fase 1 · La base de datos (el "archivo" central) 🗄️
- Crear el proyecto en **Supabase**.
- Diseñar las **tablas** (cuentas, empresas, usuarios, planes, suscripciones, pagos, facturas, terceros…).
- Definir **relaciones** (una cuenta → muchas empresas → muchos usuarios).
- Activar **RLS desde el día uno**.
- *Resultado:* el esqueleto donde se guardará todo, ya seguro.
- *Analogía:* diseñar el plan de cuentas y los libros.

### Fase 2 · Autenticación real (control de acceso) 🔑
- Activar **Supabase Auth**: registro y login REALES (hoy son simulados).
- Añadir **2FA** (verificación en dos pasos).
- Opcional: **login con Google**.
- *Resultado:* usuarios reales que entran de forma segura.
- *Analogía:* las llaves y claves de la oficina.

### Fase 3 · Conectar el frontend con la base de datos 🔌
- Usar el **SDK de Supabase** dentro de tu app.
- Que los formularios **guarden y lean datos reales** (no en memoria).
- Reemplazar los datos de ejemplo por datos de la base.
- *Resultado:* lo que registras queda guardado de verdad.
- *Analogía:* conectar la recepción con el archivo.

### Fase 4 · Reglas de negocio y seguridad 🛡️
- Validaciones en el servidor (no confiar solo en el navegador).
- **Roles y permisos** aplicados en la base (RLS por rol).
- **Auditoría** (quién hizo qué y cuándo).
- **Respaldos** automáticos.
- *Resultado:* sistema robusto y confiable para finanzas.
- *Analogía:* políticas internas, segregación de funciones y respaldo de libros.

### Fase 5 · Integraciones (Claude, N8N, pagos) 🤖
- **Claude API** para los Agentes IA y el OCR de facturas (desde el backend).
- **N8N** para WhatsApp/Telegram/Gmail y flujos automáticos.
- **Pasarela de pago** para cobrar suscripciones.
- *Resultado:* los agentes y automatizaciones cobran vida.
- *Analogía:* contratar a los asistentes especializados.

### Fase 6 · Publicar (en línea, 24/7, con HTTPS) 🌐
- Subir el frontend a **Vercel/Netlify** (HTTPS gratis → PWA instalable en celular).
- **N8N** en un VPS.
- **Dominio** propio (ej. digiaccount.com).
- *Resultado:* DigiAccount disponible para clientes reales.
- *Analogía:* mudarse del home office a una oficina con dirección pública.

---

## 6. Seguridad de datos sensibles (resumen)

Por orden de importancia:
1. **RLS** — aislar a cada cliente (lo más importante).
2. **Autenticación fuerte** + 2FA.
3. **Cifrado** en tránsito (HTTPS) y en reposo.
4. **Roles/permisos** con mínimo privilegio.
5. **Auditoría** (registro de acciones).
6. **Respaldos** automáticos.
7. **Llaves de API** solo en el backend.

---

## 7. ¿Por dónde empezamos?

**Fase 0 y Fase 1.** Crear las cuentas, subir a GitHub, y montar la base de datos en Supabase con su modelo y RLS. A partir de ahí, todo lo demás se conecta.

> Cada fase la haremos **juntos y paso a paso**, explicando el porqué de cada decisión.
