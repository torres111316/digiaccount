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
-- Se LEE con el acceso de cada quien a la empresa (también el contador
-- invitado). Se ESCRIBE solo con public.cambiar_condicion_fiscal(), que exige
-- ser el dueño de la empresa o el fundador: el invitado lee pero no edita la
-- empresa (sql/empresa_invitada_migracion.sql).
drop policy if exists empresa_condicion_historial_todo on public.empresa_condicion_historial;
drop policy if exists empresa_condicion_historial_ver on public.empresa_condicion_historial;
create policy empresa_condicion_historial_ver on public.empresa_condicion_historial for select
  using (public.soy_superadmin() or empresa_id in (select public.mis_empresas()));
revoke insert, update, delete on public.empresa_condicion_historial from authenticated;
grant select on public.empresa_condicion_historial to authenticated;

-- Lo mismo que hace la app (window.__condicionEn en assets/app.js): «especial»
-- y «formal» se reconocen dentro del texto; lo demás es ordinario.
create or replace function public.condicion_normalizada(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when lower(coalesce(p, '')) like '%especial%' then 'especial'
              when lower(coalesce(p, '')) like '%formal%' then 'formal'
              else 'ordinario' end
$$;

-- La condición de una empresa en un período 'aaaa-mm'. Para la app, los
-- agentes y n8n: una sola regla en un solo lugar.
create or replace function public.condicion_fiscal_en(p_empresa uuid, p_periodo text)
returns text language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(
    (select h.condicion from empresa_condicion_historial h
      where h.empresa_id = p_empresa and h.desde <= p_periodo
      order by h.desde desc limit 1),
    (select public.condicion_normalizada(e.condicion_fiscal) from empresas e where e.id = p_empresa))
$$;
grant execute on function public.condicion_fiscal_en(uuid, text) to authenticated;

-- Cambia la condición de una empresa A PARTIR de un período, en una sola
-- transacción: historial y ficha juntos.
--   · p_desde 'aaaa-mm': desde ese mes rige p_condicion. Los meses anteriores
--     quedan con la que tenían. Un cambio registrado DESPUÉS de p_desde deja
--     de valer y se borra (si no, el historial se contradiría).
--   · p_desde null: «siempre fue así» (corregir un dato mal cargado): se borra
--     el historial y manda la ficha en todos los meses.
-- empresas.condicion_fiscal queda con la condición de HOY.
create or replace function public.cambiar_condicion_fiscal(p_empresa uuid, p_desde text, p_condicion text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  nueva text := public.condicion_normalizada(p_condicion);
  anterior text;
  mes_ant text;
  hoy text := to_char(now() at time zone 'America/Caracas', 'YYYY-MM');
begin
  if not (public.soy_superadmin() or exists (select 1 from empresas where id = p_empresa and cuenta_id = public.mi_cuenta_id())) then
    raise exception 'Solo el dueño de la empresa puede cambiar su condición fiscal';
  end if;
  if p_desde is null then
    delete from empresa_condicion_historial where empresa_id = p_empresa;
    update empresas set condicion_fiscal = nueva where id = p_empresa;
    return nueva;
  end if;
  if p_desde !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Período inválido: %', p_desde; end if;
  perform pg_advisory_xact_lock(hashtext('condicion:' || p_empresa::text));

  -- La que regía justo antes de p_desde (con el historial que ya hubiera).
  mes_ant := to_char((to_date(p_desde || '-01', 'YYYY-MM-DD') - interval '1 month')::date, 'YYYY-MM');
  anterior := public.condicion_fiscal_en(p_empresa, mes_ant);
  if not exists (select 1 from empresa_condicion_historial where empresa_id = p_empresa) then
    insert into empresa_condicion_historial (empresa_id, desde, condicion, nota)
    values (p_empresa, '2000-01', anterior, 'Condición antes del primer cambio');
  end if;
  delete from empresa_condicion_historial where empresa_id = p_empresa and desde > p_desde;
  insert into empresa_condicion_historial (empresa_id, desde, condicion)
  values (p_empresa, p_desde, nueva)
  on conflict (empresa_id, desde) do update set condicion = excluded.condicion, creado_en = now();

  update empresas set condicion_fiscal = public.condicion_fiscal_en(p_empresa, hoy) where id = p_empresa;
  return nueva;
end $$;
revoke execute on function public.cambiar_condicion_fiscal(uuid, text, text) from public;
grant execute on function public.cambiar_condicion_fiscal(uuid, text, text) to authenticated;

-- No se cambia ninguna empresa aquí: el cambio lo hace quien lleva la
-- empresa, desde la app (Editar empresa o Configuración → Condición fiscal),
-- y la app pregunta desde qué período rige (Luis, 07/11/2026).

-- Comprobación: la tabla y las funciones existen.
select (select count(*) from information_schema.tables
         where table_schema = 'public' and table_name = 'empresa_condicion_historial') as tabla,
       (select count(*) from pg_proc where proname in ('condicion_fiscal_en', 'cambiar_condicion_fiscal', 'condicion_normalizada')) as funciones;
