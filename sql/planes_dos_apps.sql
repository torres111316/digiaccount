-- =============================================================
-- DOS APPS Y PLANES NUEVOS (17/10/2026)
-- Diseño: docs/superpowers/specs/2026-10-17-dos-apps-design.md
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
-- =============================================================

-- 1) Los dos planes de arriba pasan a ser sistemas A MEDIDA.
--    Se conservan los id (firma_contable, grupo_empresarial) para no romper
--    las cuentas que ya los tienen. El precio a medida no es de lista: queda en 0
--    y se cobra por contrato.
update public.planes set nombre = 'Firma a medida', precio_mensual = 0, precio_anual = 0
 where id = 'firma_contable';
update public.planes set nombre = 'Grupo a medida', precio_mensual = 0, precio_anual = 0
 where id = 'grupo_empresarial';
-- Contador PRO: 10 de base, ampliable a 20 con paquetes de 5.
update public.planes set max_empresas = 10 where id = 'contador_pro';

-- 2) Columnas por cuenta:
--    empresas_extra        → paquetes de PRO (0, 5 o 10).
--    max_empresas_contrato → tope de un plan a medida, el que diga el contrato.
alter table public.cuentas add column if not exists empresas_extra int not null default 0;
alter table public.cuentas add column if not exists max_empresas_contrato int;
do $$ begin
  alter table public.cuentas add constraint cuentas_empresas_extra_chk check (empresas_extra in (0, 5, 10));
exception when duplicate_object then null; end $$;

-- 3) BLINDAJE: el cliente no puede subirse el tope por la API.
--    Igual que addon_agentes: solo el fundador o procesos de servidor.
create or replace function public.proteger_tope_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.soy_superadmin() then
    new.empresas_extra := old.empresas_extra;
    new.max_empresas_contrato := old.max_empresas_contrato;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_tope on public.cuentas;
create trigger trg_proteger_tope before update on public.cuentas
for each row execute function public.proteger_tope_cuenta();

-- 4) Tope REAL de empresas (reemplaza el de sql/blindaje_db.sql).
create or replace function public.validar_limite_empresas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug     text;
  v_extra    int;
  v_contrato int;
  v_limite   int;
  v_count    int;
begin
  if public.soy_superadmin() then
    return new;
  end if;

  select plan_id, coalesce(empresas_extra, 0), max_empresas_contrato
    into v_slug, v_extra, v_contrato
    from public.cuentas where id = new.cuenta_id;

  v_limite := case v_slug
    when 'contador_basico'   then 3
    when 'contador_pro'      then 10 + least(v_extra, 10)   -- tope 20
    when 'firma_contable'    then coalesce(v_contrato, 30)  -- a medida: lo que diga el contrato
    when 'pyme'              then 1
    when 'empresa_completa'  then 1
    when 'grupo_empresarial' then coalesce(v_contrato, 5)   -- a medida: lo que diga el contrato
    else 1                                                  -- sin plan: 1 empresa
  end;

  select count(*) into v_count from public.empresas where cuenta_id = new.cuenta_id;

  if v_count >= v_limite then
    raise exception 'Tu plan permite hasta % empresa(s). Mejora tu plan para registrar más.', v_limite
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_limite_empresas on public.empresas;
create trigger trg_limite_empresas
  before insert on public.empresas
  for each row execute function public.validar_limite_empresas();

-- 5) Verificación
select id, nombre, precio_mensual, max_empresas from public.planes order by segmento, precio_mensual;
select nombre, plan_id, empresas_extra, max_empresas_contrato, addon_agentes from public.cuentas order by nombre;
