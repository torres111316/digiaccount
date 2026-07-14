# Equipo de Agentes de la Firma (multi-agente) por Telegram — Diseño

**Fecha:** 2026-07-14
**Cuenta:** Firma Contable de Luis (add-on "Agentes IA")
**Estado:** Diseño en revisión — arquitectura multi-agente (gerente + 4 especialistas)

## Objetivo

Un equipo de agentes conversacionales por Telegram que le permita a Luis, desde su
teléfono y sin entrar a la app, consultar el estado de sus clientes y razonar sobre
normativa venezolana con profundidad por dominio. Replica la estructura de una firma real:
un **gerente** que coordina y **cuatro especialistas** (tributos, contabilidad/finanzas,
laboral, legal-mercantil).

**Regla de oro:** solo leen e informan. NO ejecutan acciones que escriban datos en esta
versión. Al razonar sobre normativa, citan la fuente y recuerdan que el contador valida.

## Alcance

Entrega **completa** (los 5 agentes juntos — decisión de Luis 14/07). Orden interno de
construcción sugerido: primero el esqueleto de orquestación + herramientas de datos, luego
las cuatro bibliotecas de conocimiento (RAG) a medida que el corpus esté cargado.

## Arquitectura: orquestador + especialistas

- **Canal:** bot de Telegram. n8n recibe el mensaje, procesa el tiempo que necesite y
  responde con `sendMessage`. No aplica el límite de 100s de Cloudflare (ventaja para un
  sistema multi-agente que encadena varios pasos).
- **Patrón:** el agente **Gerente** (nodo AI Agent de n8n) tiene a cada **especialista como
  una herramienta** (sub-workflow / sub-agente). El gerente lee la pregunta, decide a qué
  especialista(s) consultar, y sintetiza la respuesta final.
- **Cerebro:** **Gemini** en todos los agentes (único proveedor en Venezuela). Se asume el
  **nivel de pago** de Gemini — NECESARIO: cada pregunta encadena 3-4 llamadas.
- **Memoria:** el Gerente mantiene la ventana de conversación por `sessionId` = chat de
  Telegram, para repreguntas sin repetir contexto.
- **Datos:** acceso a Supabase con la credencial de servicio existente (service_role, id
  `6HTJ7SkRWU2wYkmo`) mediante herramientas acotadas de solo lectura.

## Seguridad

- **Lista blanca:** el bot solo atiende el/los Telegram ID autorizados (inicialmente solo
  Luis). Un primer nodo compara `message.from.id`; si no coincide, termina sin responder.
- **Alcance de datos por cuenta:** cada Telegram ID autorizado está asociado en la config a
  un `cuenta_id` (la Firma de Luis). TODAS las herramientas filtran por
  `empresas.cuenta_id = <cuenta de la Firma>`. Los "clientes" son las empresas registradas
  bajo esa cuenta. El sistema nunca ve datos de otras cuentas de la plataforma.
- **Solo lectura:** ninguna herramienta escribe. Sin superficie de daño.

## Los agentes

### Gerente (orquestador)
- No tiene conocimiento propio; enruta y sintetiza.
- Herramienta compartida **buscar_cliente(nombre)** — resuelve un nombre parcial a la
  empresa real dentro de la cuenta de la Firma (id, nombre, RIF, condición). Si hay varias,
  desambigua. Pasa el `empresa_id` a los especialistas.
- Decide uno o varios especialistas por pregunta y combina sus respuestas.

### Especialista Tributos
- **Datos:** `vencimientos_cliente` (calendario_fiscal × terminal de RIF), `estado_fiscal`
  (libro_fiscal compras/ventas, IVA, período), `retenciones`, `estado_boveda`
  (documentos_fiscales por impuesto/período y qué falta).
- **Conocimiento:** carpeta `Legislación Tributaria` del Dossier (Constitución, COT, ISLR +
  reglamentos, IVA + reglamentos + parciales, IGTF, IGP, sucesiones, azar, alcohol,
  cigarrillos, providencias RIF/facturación/imprentas/sujetos especiales/102/121/ret.IVA).
  MÁS los manuales/guías SENIAT de la carpeta SENIAT ya existente.

### Especialista Contabilidad y Finanzas
- **Datos:** `libro_contable` (asientos, cuentas_contables), `tesoreria` (cuentas_tesoreria,
  movimientos_tesoreria, saldos), `cxc_cxp` (por cobrar / por pagar), indicadores básicos.
- **Conocimiento:** carpeta `Boletines de Aplicación VEN-NIF` (BA VEN-NIF 0,2,4,5,8,9,10,11,12)
  + carpeta `SECP` (normas del ejercicio profesional del contador). `NIIF Completas` está
  vacía por ahora; se sumarán las NIIF completas en una iteración posterior (opcional).

### Especialista Laboral
- **Datos:** `nomina` (empleados, recibos_nomina, parametros_nomina, novedades_nomina).
- **Conocimiento:** carpeta `Legislación Laboral` (LOTTT, Reglamento LOT, Reglamento Parcial
  LOTTT, LOPCYMAT, Ley Orgánica Procesal del Trabajo). Los decretos de salario mínimo y
  cestaticket se añaden como documentos sueltos cuando Luis los aporte.

### Especialista Legal-Mercantil
- **Datos:** `datos_empresa` (tipo societario, RIF, condición) y `terceros`.
- **Conocimiento:** carpeta `Legislación Mercantil` (Código de Comercio, Ley de Registros y
  Notarías, providencias SAREN).

## Conocimiento (RAG) — cuatro bibliotecas separadas

- **Fuente:** `C:\Users\torre\OneDrive\Documentos\Contabilidad\Dossier del Contador`, ya
  organizada por área (una carpeta por dominio). Corpus prácticamente completo.
- **Vector store:** Supabase con `pgvector`; **embeddings de Gemini**; ingesta por
  fragmentos con metadatos (fuente, dominio, artículo/sección).
- **Partición por dominio:** cada especialista recupera SOLO de su biblioteca (una consulta
  tributaria no trae normas laborales). Esto es el principal motivo para separar agentes.
- Cada especialista **cita la fuente** de sus afirmaciones normativas.
- **Aduana:** NO se crea especialista de Aduana por ahora (poco frecuente). El único
  documento (`Ley Orgánica de Aduanas`) se adjunta a la biblioteca de Tributos como apoyo,
  para preguntas puntuales de importación de proveedores. Si Aduana se vuelve frecuente, se
  promueve a especialista propio.

## Reglas de comportamiento (system prompt, todos los agentes)

- Solo informan; no ejecutan acciones de escritura.
- Citan la fuente en temas normativos; recuerdan que el contador valida.
- Si no tienen el dato o la norma, lo dicen; no inventan.
- Fechas en formato venezolano; montos en Bs con separadores locales.
- Respuestas concretas y accionables (para leerse en el teléfono).

## Manejo de errores

- **Gemini 503 (congestión):** reintento + mensaje claro. El nivel de pago lo minimiza;
  con multi-agente es crítico por el mayor número de llamadas.
- **Cliente no encontrado / ambiguo:** el gerente pide precisión en vez de adivinar.
- **Especialista sin datos/norma:** lo indica explícitamente al gerente.
- **Latencia:** una pregunta puede tardar varios segundos por los saltos entre agentes;
  aceptable en Telegram (sin límite de Cloudflare).

## Prerrequisitos (a cargo de Luis)

- Crear el bot con **@BotFather** y entregar el token.
- Activar el **nivel de pago de Gemini** (necesario para multi-agente).
- Corpus: **ya reunido** en el Dossier del Contador (tributaria, laboral, mercantil,
  VEN-NIF, SECP). Opcionales a futuro: NIIF completas y decretos de salario mínimo/
  cestaticket. El build ya NO está bloqueado por falta de material.

## Fuera de alcance (por ahora)

- Acciones que escriban (generar retenciones, asientos, declaraciones) — futura, con
  aprobación humana explícita.
- Multiusuario / acceso del equipo de la Firma — futura (ampliar la lista blanca).
- Canal WhatsApp — reservado para lo externo/comercial.

## Criterios de éxito

- Desde Telegram, una pregunta se enruta al especialista correcto y devuelve datos reales.
- Una pregunta que cruza dominios (ej. "¿este pago a un proveedor de servicios lleva
  retención y cómo lo asiento?") activa a Tributos y a Contabilidad y el gerente combina.
- Cada especialista razona solo con su biblioteca; cita fuentes.
- El bot ignora a cualquier usuario no autorizado; ninguna herramienta modifica datos.
