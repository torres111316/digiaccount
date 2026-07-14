# Fundación RAG del Equipo de Agentes — Plan de Implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usar superpowers:executing-plans o
> superpowers:subagent-driven-development para ejecutar tarea por tarea. Los pasos usan
> checkbox (`- [ ]`) para seguimiento.

**Goal:** Construir la base de conocimiento (RAG) del equipo de agentes: un vector store en
Supabase con el corpus del Dossier del Contador ingerido en cuatro bibliotecas por dominio,
y una herramienta de recuperación que devuelve fragmentos relevantes con su fuente.

**Architecture:** Los PDFs del Dossier se suben a un bucket privado de Supabase Storage
(una carpeta por dominio). Un workflow de n8n de INGESTA lee cada archivo, extrae texto, lo
parte en fragmentos, genera embeddings con Gemini y los guarda en una tabla `pgvector` con
metadatos de dominio y fuente. Un workflow de RECUPERACIÓN recibe una pregunta y un dominio,
embebe la pregunta, hace búsqueda por similitud filtrada por dominio y devuelve los top-k
fragmentos con su cita. Estos workflows quedan como herramientas reutilizables por los
especialistas (Plan 2).

**Tech Stack:** Supabase (Postgres + extensión `pgvector` + Storage), n8n 2.30.1 (nodos
LangChain: Google Gemini Embeddings, Supabase Vector Store o HTTP a RPC, Default Data Loader,
Recursive Character Text Splitter), Gemini API (embeddings `text-embedding-004`).

## Global Constraints

- **Idioma:** todo el contenido de cara al usuario en español (Venezuela).
- **Modelo de embeddings:** `models/text-embedding-004` de Gemini (768 dimensiones).
  Verificar disponibilidad con la key existente antes de la ingesta masiva.
- **Credencial n8n Supabase:** `6HTJ7SkRWU2wYkmo` (service_role) — ya existe.
- **Credencial n8n Gemini:** `4Z3ZFWg8rjQ4sclF` (header `x-goog-api-key`) — ya existe.
- **Dominios (metadato `dominio`):** `tributos`, `contabilidad`, `laboral`, `mercantil`.
- **SQL en el repo:** cada migración se guarda en `DigiAccount/sql/` y se commitea. Los
  workflows viven en n8n (se referencian por nombre/ID; se crean con las herramientas MCP).
- **Fuente del corpus:** `C:\Users\torre\OneDrive\Documentos\Contabilidad\Dossier del Contador`.

---

## Mapa de archivos y artefactos

- Crear: `DigiAccount/sql/rag_vector_store.sql` — extensión pgvector, tabla `conocimiento`,
  índice, función RPC `buscar_conocimiento`.
- Bucket Supabase Storage: `corpus-conocimiento` (privado), con carpetas
  `tributos/`, `contabilidad/`, `laboral/`, `mercantil/`.
- Workflow n8n: **"RAG · Ingesta de conocimiento"** (webhook manual por dominio).
- Workflow n8n: **"RAG · Recuperar conocimiento"** (webhook, usado luego como tool).
- Doc: este plan.

---

### Task 1: Esquema del vector store (pgvector + tabla + RPC)

**Files:**
- Create: `DigiAccount/sql/rag_vector_store.sql`

**Interfaces:**
- Produces: tabla `public.conocimiento(id, dominio text, fuente text, fragmento text,
  metadata jsonb, embedding vector(768))`; función
  `buscar_conocimiento(p_dominio text, p_embedding vector, p_k int) returns table(fuente text, fragmento text, similitud float)`.

- [ ] **Step 1: Escribir la migración SQL**

```sql
-- Vector store del RAG del equipo de agentes
create extension if not exists vector;

create table if not exists public.conocimiento (
  id         bigserial primary key,
  dominio    text not null,               -- tributos | contabilidad | laboral | mercantil
  fuente     text not null,               -- nombre del documento de origen
  fragmento  text not null,               -- el chunk de texto
  metadata   jsonb default '{}'::jsonb,   -- {pagina, seccion, ...}
  embedding  vector(768),                 -- text-embedding-004
  creado_en  timestamptz default now()
);

create index if not exists idx_conocimiento_dominio on public.conocimiento(dominio);
-- Índice de similitud (coseno). ivfflat requiere ANALYZE tras carga masiva.
create index if not exists idx_conocimiento_embedding
  on public.conocimiento using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.conocimiento enable row level security;
-- Solo el service_role (n8n) accede; sin políticas públicas.

-- Búsqueda por similitud filtrada por dominio
create or replace function public.buscar_conocimiento(
  p_dominio text, p_embedding vector(768), p_k int default 6)
returns table(fuente text, fragmento text, similitud float)
language sql stable as $$
  select c.fuente, c.fragmento, 1 - (c.embedding <=> p_embedding) as similitud
  from public.conocimiento c
  where c.dominio = p_dominio
  order by c.embedding <=> p_embedding
  limit p_k;
$$;
```

- [ ] **Step 2: Ejecutar en Supabase (SQL Editor) y verificar**

Correr el archivo completo. Verificar:
```sql
select extname from pg_extension where extname = 'vector';           -- 1 fila
select count(*) from public.conocimiento;                            -- 0
```
Esperado: la extensión existe y la tabla está vacía y creada.

- [ ] **Step 3: Commit**

```bash
git add DigiAccount/sql/rag_vector_store.sql
git commit -m "RAG: vector store (pgvector) + tabla conocimiento + RPC buscar_conocimiento"
```

---

### Task 2: Bucket de Storage y carga del corpus

**Files:** (ninguno de código; acción en Supabase + subida de PDFs)

**Interfaces:**
- Produces: bucket privado `corpus-conocimiento` con los PDFs del Dossier organizados en
  `tributos/`, `contabilidad/`, `laboral/`, `mercantil/`.

- [ ] **Step 1: Crear el bucket privado**

En Supabase → Storage → New bucket: nombre `corpus-conocimiento`, **Private**.

- [ ] **Step 2: Subir el corpus por dominio**

Subir los PDFs del Dossier a las carpetas del bucket según el mapeo del spec:
- `tributos/` ← `Legislación Tributaria/*` + `Ley Orgánica de Aduanas.pdf` + manuales SENIAT.
- `contabilidad/` ← `Boletines de Aplicación VEN-NIF/*` + `SECP/*` (+ NIIF completas si las hay).
- `laboral/` ← `Legislación Laboral/*` (+ salario mínimo/cestaticket cuando estén).
- `mercantil/` ← `Legislación Mercantil/*`.

- [ ] **Step 3: Verificar**

En Storage, confirmar que cada carpeta tiene sus archivos. Anotar el total por dominio
(para cotejar contra los fragmentos ingeridos en la Task 5).

---

### Task 3: Workflow de ingesta (un dominio de prueba)

**Files:** (workflow n8n creado vía MCP)

**Interfaces:**
- Consumes: bucket `corpus-conocimiento`, tabla `conocimiento`, credenciales Gemini/Supabase.
- Produces: workflow **"RAG · Ingesta de conocimiento"** con webhook
  `POST /webhook/rag-ingesta` body `{ token, dominio }` que procesa todos los archivos de
  esa carpeta del bucket.

- [ ] **Step 1: Construir el workflow (MCP)**

Nodos, en orden:
1. **Webhook** `rag-ingesta` (POST, responseNode). Valida `token` = `da-ocr-x9K2mQ7vT4wP8nR3`.
2. **Code "Validar"**: exige `dominio ∈ {tributos,contabilidad,laboral,mercantil}`; si no, responde error.
3. **HTTP "Listar archivos"**: `GET {SUPABASE_URL}/storage/v1/object/list/corpus-conocimiento`
   body `{ prefix: "<dominio>/" }`, credencial supabaseApi. Devuelve la lista de objetos.
4. **Split Out** por archivo.
5. **HTTP "Descargar PDF"**: `GET .../object/corpus-conocimiento/<name>`, responseFormat file
   (recupera binario).
6. **Extract From File** (operación `pdf`) → texto por archivo.
7. **Code "Chunk"**: parte el texto en fragmentos de ~1500 caracteres con solape de 200,
   emite un item por fragmento con `{ dominio, fuente: name, fragmento, orden }`.
8. **Embeddings (HTTP a Gemini)**: `POST .../models/text-embedding-004:embedContent` con
   `{ content: { parts: [{ text: fragmento }] } }`, header `x-goog-api-key`. Extrae
   `embedding.values` (768 dims).
9. **HTTP "Guardar"**: `POST {SUPABASE_URL}/rest/v1/conocimiento` con
   `{ dominio, fuente, fragmento, metadata:{orden}, embedding }`, credencial supabaseApi.
10. **Respond** `{ ok:true, dominio, fragmentos: <n> }`.

Notas: `executionTimeout` alto (900s) porque la ingesta de muchos PDFs es lenta; el nodo de
embeddings con `retryOnFail` (503 de Gemini) y `onError: continueRegularOutput` para no
perder toda la corrida por un fragmento.

- [ ] **Step 2: Probar con un dominio chico (mercantil, 4 docs)**

Correr `POST /webhook/rag-ingesta { token, dominio:"mercantil" }`. Verificar en Supabase:
```sql
select dominio, count(*) from public.conocimiento group by dominio;   -- mercantil > 0
select fuente, left(fragmento,80) from public.conocimiento where dominio='mercantil' limit 3;
```
Esperado: filas de `mercantil` con fragmentos legibles del Código de Comercio.

- [ ] **Step 3: Commit (doc del workflow)**

Registrar el ID del workflow en `DigiAccount/docs/superpowers/plans/` (nota al pie de este
plan) y commitear. Los workflows no son archivos del repo; se documentan por ID.

---

### Task 4: Workflow de recuperación (la herramienta de consulta)

**Files:** (workflow n8n creado vía MCP)

**Interfaces:**
- Consumes: RPC `buscar_conocimiento`, credenciales Gemini/Supabase.
- Produces: workflow **"RAG · Recuperar conocimiento"** con webhook
  `POST /webhook/rag-buscar` body `{ token, dominio, pregunta, k? }` → devuelve
  `{ ok, resultados:[{fuente, fragmento, similitud}] }`.

- [ ] **Step 1: Construir el workflow (MCP)**

Nodos:
1. **Webhook** `rag-buscar` (POST, responseNode). Valida token.
2. **Code "Validar"**: exige `dominio` válido y `pregunta` no vacía.
3. **Embeddings (HTTP a Gemini)**: embebe `pregunta` con `text-embedding-004`.
4. **HTTP "RPC buscar"**: `POST {SUPABASE_URL}/rest/v1/rpc/buscar_conocimiento` con
   `{ p_dominio, p_embedding, p_k: k||6 }`, credencial supabaseApi.
5. **Respond** `{ ok:true, resultados }`.

Manejo de error: si Gemini 503 en el embedding → responder `{ ok:false, error:"ocupado" }`
(mismo patrón fail-fast que en los OCR).

- [ ] **Step 2: Probar con una pregunta real**

`POST /webhook/rag-buscar { token, dominio:"mercantil", pregunta:"¿Qué libros debe llevar un comerciante?" }`.
Esperado: `resultados` con fragmentos del Código de Comercio sobre libros mercantiles y
`similitud` alta (> 0.6 en el top-1).

- [ ] **Step 3: Commit (doc del workflow)**

Registrar el ID del workflow en la nota al pie de este plan y commitear.

---

### Task 5: Ingesta masiva de los cuatro dominios

**Files:** (ninguno; ejecución de la Task 3 por dominio)

**Interfaces:**
- Consumes: workflow de ingesta (Task 3), corpus del bucket (Task 2).
- Produces: tabla `conocimiento` poblada en los 4 dominios.

- [ ] **Step 1: Ingerir cada dominio restante**

Correr `rag-ingesta` para `contabilidad`, `laboral` y `tributos` (este último es el más
grande — 31+ docs; puede tardar varios minutos y encadenar reintentos por 503).

- [ ] **Step 2: Verificar cobertura**

```sql
select dominio, count(*) as fragmentos, count(distinct fuente) as documentos
from public.conocimiento group by dominio order by dominio;
```
Esperado: 4 dominios; `documentos` por dominio coincide (±) con lo subido al bucket en la
Task 2. Ninguna cuenta en cero.

- [ ] **Step 3: Re-indexar y analizar**

```sql
analyze public.conocimiento;
```
(Mejora el índice ivfflat tras la carga masiva.)

- [ ] **Step 4: Prueba cruzada de aislamiento**

`rag-buscar { dominio:"laboral", pregunta:"¿Cómo se calcula el IVA?" }` → los resultados
deben ser POBRES/vacíos (baja similitud): confirma que cada dominio recupera solo lo suyo.
`rag-buscar { dominio:"tributos", pregunta:"¿Cómo se calcula el IVA?" }` → resultados buenos.

- [ ] **Step 5: Commit**

Actualizar la nota al pie con los conteos finales por dominio y commitear.

---

## Nota al pie — IDs de workflows (se llena en ejecución)

- RAG · Ingesta de conocimiento: `<ID>`
- RAG · Recuperar conocimiento: `<ID>`
- Conteos finales por dominio: `<tributos / contabilidad / laboral / mercantil>`

## Self-Review (cobertura del spec, sección RAG)

- Vector store pgvector + embeddings Gemini + partición por dominio → Tasks 1-5. ✓
- Cada especialista recupera solo de su biblioteca → filtro por `dominio` en la RPC +
  prueba de aislamiento (Task 5, Step 4). ✓
- Cita de fuente → la RPC devuelve `fuente` por fragmento. ✓
- Corpus mapeado al Dossier → Task 2. ✓
- Aduana adjunta a tributos → Task 2, Step 2. ✓
