-- =============================================================
-- BASE DE CONOCIMIENTO VECTORIAL (RAG) del equipo de agentes
-- Ejecutar COMPLETO en el SQL Editor de Supabase. Es idempotente.
-- Crea: extensión pgvector + tabla conocimiento + índices + función de búsqueda.
-- =============================================================

-- 1) Extensión de vectores (búsqueda por significado)
create extension if not exists vector;

-- 2) Tabla donde vive el conocimiento (un registro por fragmento de documento)
create table if not exists public.conocimiento (
  id         bigserial primary key,
  dominio    text not null,               -- tributos | contabilidad | laboral | mercantil
  fuente     text not null,               -- nombre del documento de origen
  fragmento  text not null,               -- el pedacito de texto
  metadata   jsonb default '{}'::jsonb,   -- datos extra (orden, sección, etc.)
  embedding  vector(768),                 -- vector del significado (text-embedding-004)
  creado_en  timestamptz default now()
);

-- 3) Índice por dominio (para filtrar)
create index if not exists idx_conocimiento_dominio on public.conocimiento(dominio);

-- OJO — SIN índice vectorial a propósito (lección aprendida 15/07/2026):
-- Un índice ivfflat creado sobre la tabla VACÍA nace sin clusters entrenados y las
-- búsquedas devuelven CERO filas aunque haya datos. Con ~3.300 fragmentos, la búsqueda
-- exacta (scan secuencial) tarda milisegundos y tiene precisión perfecta.
-- Si el corpus crece a decenas de miles, crear un índice HNSW (tolera inserciones):
--   create index on public.conocimiento using hnsw (embedding vector_cosine_ops);
drop index if exists idx_conocimiento_embedding;

-- 4) Seguridad: solo el service_role (n8n) accede; sin políticas públicas
alter table public.conocimiento enable row level security;

-- 5) Función de búsqueda: dado un dominio y el vector de una pregunta,
--    devuelve los k fragmentos más parecidos, con su fuente y qué tan parecidos son.
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

-- 6) Verificación (deben salir estas filas)
select extname from pg_extension where extname = 'vector';   -- debe listar 'vector'
select count(*) as fragmentos from public.conocimiento;      -- debe dar 0 (aún vacía)
