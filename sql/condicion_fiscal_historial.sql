-- ============================================================
-- DigiAccount · La condición fiscal de una empresa tiene FECHA
-- Ejecutar en: Supabase SQL Editor. Re-ejecutable.
--
-- POR QUÉ: GATMA y RADIAN dejan de ser contribuyentes especiales desde
-- noviembre 2026 y pasan a ordinarios (Luis hace el cambio desde la app). La condición era un solo campo
-- (empresas.condicion_fiscal): cambiarlo hacía que septiembre y octubre se
-- vieran como ordinario (sin quincenas, sin retenciones practicadas, sin
-- anticipo de ISLR) y dejaran de coincidir con lo ya declarado.
--
-- Ahora cada empresa puede tener un historial: «desde aaaa-mm, tal
-- condición». La condición de un período es la de la última fila con
-- desde <= período. Sin historial, manda empresas.condicion_fiscal, como
-- siempre. empresas.condicion_fiscal queda como la condición ACTUAL.
--
-- La contabilidad (sql/contabilidad_*) no usa la condición: los asientos
-- no cambian con esto.
-- ============================================================

create table if not exists public.empresa_condicion_historial (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  desde      text not null check (desde ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  condicion  text not null check (condicion in ('ordinario', 'formal', 'especial')),
  nota       text,
  creado_en  timestamptz not null default now(),
  unique (empresa_id, desde)
);

alter table public.empresa_condicion_historial enable row level security;
drop policy if exists empresa_condicion_historial_todo on public.empresa_condicion_historial;
create policy empresa_condicion_historial_todo on public.empresa_condicion_historial for all
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
grant select, insert, update, delete on public.empresa_condicion_historial to authenticated;

-- La condición de una empresa en un período 'aaaa-mm'. Para la app, los
-- agentes y n8n: una sola regla en un solo lugar.
create or replace function public.condicion_fiscal_en(p_empresa uuid, p_periodo text)
returns text language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(
    (select h.condicion from empresa_condicion_historial h
      where h.empresa_id = p_empresa and h.desde <= p_periodo
      order by h.desde desc limit 1),
    (select lower(coalesce(nullif(regexp_replace(e.condicion_fiscal, '(?i)^\s*contribuyente\s+', ''), ''), 'ordinario'))
       from empresas e where e.id = p_empresa))
$$;
grant execute on function public.condicion_fiscal_en(uuid, text) to authenticated;

-- No se cambia ninguna empresa aquí: el cambio lo hace quien lleva la
-- empresa, desde la app (Editar empresa o Configuración → Condición fiscal),
-- y la app pregunta desde qué período rige (Luis, 07/11/2026).

-- Comprobación: la tabla y la función existen.
select (select count(*) from information_schema.tables
         where table_schema = 'public' and table_name = 'empresa_condicion_historial') as tabla,
       (select count(*) from pg_proc where proname = 'condicion_fiscal_en') as funcion;
