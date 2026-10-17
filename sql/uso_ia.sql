-- =============================================================
-- USO DE LOS AGENTES IA — cuánto consume cada conversación
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
--
-- El «Motor · Agente con herramientas» de n8n escribe una fila por cada
-- respuesta, con los tokens que Gemini reporta en usageMetadata. Con un mes
-- de datos se sabe cuánto cuesta de verdad el equipo de la firma, y con eso
-- se fija el precio de los agentes en los planes a medida.
-- =============================================================

create table if not exists public.uso_ia (
  id              bigint generated always as identity primary key,
  creado_en       timestamptz not null default now(),
  cuenta_id       uuid references public.cuentas(id) on delete set null,
  agente          text not null,          -- lucho, carmen, roberth, mariale, maria, arelis, augusto
  modelo          text,                   -- p. ej. gemini-3.5-flash
  rondas          int  not null default 1, -- llamadas a Gemini en esa respuesta (máx. 8)
  tokens_entrada  int  not null default 0,
  tokens_salida   int  not null default 0,
  ejecucion_n8n   text                    -- id de la ejecución, para revisarla si algo sale raro
);
create index if not exists uso_ia_cuenta_fecha on public.uso_ia (cuenta_id, creado_en);

-- Solo el fundador lo lee. Escribe n8n con la llave de servidor (no pasa por RLS).
alter table public.uso_ia enable row level security;
drop policy if exists "uso_ia_fundador" on public.uso_ia;
create policy "uso_ia_fundador" on public.uso_ia for select using (public.soy_superadmin());

-- Resumen por mes y agente. El costo se calcula aparte con el precio vigente
-- del modelo, porque el precio cambia y los tokens no.
create or replace view public.uso_ia_mensual with (security_invoker = true) as
select date_trunc('month', creado_en)::date as mes,
       cuenta_id, agente,
       count(*)            as respuestas,
       sum(rondas)         as llamadas_gemini,
       sum(tokens_entrada) as tokens_entrada,
       sum(tokens_salida)  as tokens_salida
  from public.uso_ia
 group by 1, 2, 3;

select 'uso_ia lista' as estado, count(*) as filas from public.uso_ia;
