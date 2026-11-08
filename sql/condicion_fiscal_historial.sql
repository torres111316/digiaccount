-- ============================================================
-- DigiAccount · La condición fiscal de una empresa tiene FECHA
-- Ejecutar en: Supabase SQL Editor. Re-ejecutable.
--
-- POR QUÉ: GATMA y RADIAN dejan de ser contribuyentes especiales desde
-- noviembre 2026 y pasan a ordinarios. La condición era un solo campo
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

-- GATMA y RADIAN: especiales hasta octubre 2026, ordinarios desde noviembre
-- 2026 (Luis, 07/11/2026). Desde noviembre dejan de ser agentes de retención
-- de IVA y de percepción del IGTF.
insert into public.empresa_condicion_historial (empresa_id, desde, condicion, nota)
select e.id, x.desde, x.condicion, x.nota
  from public.empresas e
  cross join (values
    ('2000-01', 'especial',  'Contribuyente especial (antes del cambio)'),
    ('2026-11', 'ordinario', 'Pasa a ordinario desde noviembre 2026; deja de ser agente de retención de IVA y de percepción del IGTF')
  ) as x(desde, condicion, nota)
 where e.id in ('2ebc4c53-7bbe-4aa1-b410-b8fd3d676085',   -- GATMA DISTRIBUIDORA Y COMERCIALIZADORA, C.A
                '6b523033-8c5a-4eae-a4a3-3c3c5886af64')   -- RAFAEL JOSE GORDILLO (COMERCIALIZADORA RADIAN GORDILLO, F.P.)
on conflict (empresa_id, desde) do update set condicion = excluded.condicion, nota = excluded.nota;

update public.empresas set condicion_fiscal = 'ordinario'
 where id in ('2ebc4c53-7bbe-4aa1-b410-b8fd3d676085', '6b523033-8c5a-4eae-a4a3-3c3c5886af64');

-- Comprobación: octubre especial, noviembre ordinario.
select e.nombre,
       public.condicion_fiscal_en(e.id, '2026-10') as octubre,
       public.condicion_fiscal_en(e.id, '2026-11') as noviembre
  from public.empresas e
 where e.id in ('2ebc4c53-7bbe-4aa1-b410-b8fd3d676085', '6b523033-8c5a-4eae-a4a3-3c3c5886af64');
