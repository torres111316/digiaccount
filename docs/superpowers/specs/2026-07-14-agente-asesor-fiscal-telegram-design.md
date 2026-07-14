# Agente Asesor Fiscal por Telegram — Diseño

**Fecha:** 2026-07-14
**Cuenta:** Firma Contable de Luis (add-on "Agentes IA")
**Estado:** Diseño aprobado — pendiente de spec-review y plan de implementación

## Objetivo

Un agente conversacional por Telegram que le permita a Luis, desde su teléfono y sin
entrar a la app, consultar el estado fiscal/operativo de sus clientes y razonar sobre
normativa venezolana. Es su asistente personal dentro de la Firma.

**Regla de oro:** solo lee e informa. NO ejecuta acciones que escriban datos (nada de
generar retenciones, asientos ni declaraciones) en esta versión. Cuando razone sobre
temas legales/fiscales, cita la fuente y recuerda que el contador valida.

## Alcance

Construcción **por etapas** (aprobado):

- **Etapa 1 (se construye ya):** agente Telegram + herramientas de DATOS (solo lectura)
  + seguridad + memoria de conversación.
- **Etapa 2 (cuando Luis reúna el corpus):** herramienta de CONOCIMIENTO (RAG) sobre el
  corpus tributario + mercantil + contable.

## Arquitectura

- **Canal:** bot de Telegram. n8n recibe el mensaje, procesa el tiempo que necesite y
  responde con `sendMessage`. No aplica el límite de 100s de Cloudflare (ventaja sobre
  los webhooks síncronos), ideal para un agente que encadena varios pasos.
- **Cerebro:** nodo **AI Agent** de n8n (LangChain) con **Gemini** como chat model
  (único proveedor disponible en Venezuela). Se asume el **nivel de pago** de Gemini para
  eliminar los 503 por congestión del free tier.
- **Memoria:** ventana de conversación por `sessionId` = chat de Telegram, para permitir
  repreguntas sin repetir contexto.
- **Datos:** el agente accede a Supabase con la credencial de servicio ya existente
  (service_role, id `6HTJ7SkRWU2wYkmo`), a través de herramientas acotadas de solo lectura.
- **Alcance de datos por cuenta:** cada Telegram ID autorizado está asociado en la config a
  un `cuenta_id` (el de la Firma de Luis). TODAS las herramientas filtran por
  `empresas.cuenta_id = <cuenta de la Firma>`. Los "clientes" de la Firma son las empresas
  registradas bajo esa cuenta (plan Firma = empresas ilimitadas). El agente nunca ve datos
  de otras cuentas de la plataforma.

## Seguridad

- **Lista blanca:** el bot solo atiende el/los Telegram ID autorizados (inicialmente solo
  Luis). Un primer nodo compara el `message.from.id` contra la lista; si no coincide, el
  flujo termina sin responder (o responde "no autorizado").
- **Solo lectura:** ninguna herramienta escribe en la base. Sin superficie de daño.
- El token del bot y la API key viven en credenciales de n8n, nunca en el frontend.

## Etapa 1 — Herramientas de datos (solo lectura)

Cada herramienta es una sub-consulta acotada que el AI Agent decide cuándo invocar. Todas
reciben parámetros vía `$fromAI` y devuelven JSON compacto.

1. **buscar_cliente(nombre)** — resuelve un nombre parcial ("Comercial XYZ") a la empresa
   real dentro de la cuenta de la Firma. Devuelve id, nombre, RIF, condición fiscal. Si hay
   varias coincidencias, las lista para desambiguar.
2. **vencimientos_cliente(empresa_id | rango)** — consulta `calendario_fiscal` cruzando el
   terminal de RIF y la condición de la empresa. Devuelve obligaciones y fechas próximas.
3. **estado_empresa(empresa_id)** — resumen de `libro_fiscal` (compras/ventas: totales,
   IVA, período), condición fiscal y datos básicos.
4. **saldos_tesoreria(empresa_id)** — saldos de `cuentas_tesoreria` y CxC/CxP derivadas de
   `movimientos_tesoreria` / documentos.
5. **estado_boveda(empresa_id, período?)** — qué planillas/certificados hay archivados en
   `documentos_fiscales` por impuesto y período, y qué falta respecto a lo que vencía.

Notas de diseño:
- Las herramientas devuelven texto/JSON breve y legible; el agente redacta la respuesta
  final en lenguaje natural.
- Todas filtran por las empresas que administra la Firma (no exponen otras cuentas).

## Etapa 2 — Herramienta de conocimiento (RAG)

- **consultar_normativa(pregunta)** — recuperación aumentada sobre el corpus:
  - **Corpus:** manuales/guías SENIAT (IVA, ISLR, IGTF, IGP, DPP, Facturación Electrónica
    — providencias 102/121) que Luis ya tiene, MÁS los textos legales que reunirá:
    tributario (COT, Ley y Reglamento de IVA, Ley y Reglamento de ISLR, Ley del IGTF, Ley
    del IGP, Ley de Protección de las Pensiones), mercantil (Código de Comercio) y contable
    (VEN-NIF / BA VEN-NIF).
  - **Vector store:** Supabase con `pgvector`; **embeddings de Gemini**; ingesta por
    fragmentos (chunking) con metadatos (fuente, impuesto, artículo/sección).
  - El agente **cita la fuente** de cada afirmación y aclara que es orientativo.

## Reglas de comportamiento (system prompt)

- Solo informa; no ejecuta acciones de escritura.
- Cita la fuente en temas normativos; recuerda que el contador valida.
- Si no tiene el dato o la norma, lo dice; no inventa.
- Fechas en formato venezolano; montos en Bs con separadores locales.
- Respuestas concretas y accionables (para leerse en el teléfono).

## Manejo de errores

- **Gemini 503 (congestión):** reintento + mensaje claro ("el asistente está ocupado,
  reintenta en un momento"). El nivel de pago lo minimiza.
- **Cliente no encontrado / ambiguo:** el agente pide precisión en vez de adivinar.
- **Sin datos para el período:** lo indica explícitamente.

## Prerrequisitos

- **Luis:** crear el bot con **@BotFather** y entregar el token.
- **Luis:** reunir el corpus legal (tributario + mercantil + contable) para la Etapa 2.
- **Luis:** activar el nivel de pago de Gemini (recomendado antes de clientes reales).

## Fuera de alcance (por ahora)

- Acciones que escriban (generar retenciones, asientos, declaraciones) — futura, con
  aprobación humana explícita.
- Multiusuario / acceso del equipo de la Firma — futura (ampliar la lista blanca).
- Canal WhatsApp — reservado para lo externo/comercial, no para este agente interno.

## Criterios de éxito (Etapa 1)

- Desde Telegram, Luis pregunta "¿qué le vence a <cliente> esta semana?" y recibe la
  respuesta correcta cruzando calendario + terminal de RIF.
- Consultas de estado de empresa, saldos y bóveda devuelven datos reales y correctos.
- El bot ignora a cualquier usuario no autorizado.
- Ninguna herramienta puede modificar datos.
