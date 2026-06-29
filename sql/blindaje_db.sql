-- ============================================================================
--  DigiAccount · BLINDAJE A NIVEL DE BASE DE DATOS (reglas de negocio)
--  Cierra fugas que el frontend no puede garantizar por sí solo.
--  Seguro de correr varias veces (idempotente). Supabase → SQL Editor.
--  Requiere que ya existan: public.soy_superadmin() y public.mi_cuenta_id().
-- ============================================================================


-- ----------------------------------------------------------------------------
--  BLINDAJE 1 · El usuario NO puede auto-escalar su cuenta.
--  Solo el FUNDADOR (super-admin) puede cambiar estado, plan, prueba o segmento.
--  Un usuario normal sí puede editar sus datos de contacto, pero esos campos
--  sensibles se conservan con su valor anterior (cambio silenciosamente ignorado).
-- ----------------------------------------------------------------------------
create or replace function public.proteger_campos_cuenta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.soy_superadmin() then
    new.estado           := old.estado;
    new.plan_id          := old.plan_id;
    new.trial_termina_en := old.trial_termina_en;
    new.segmento         := old.segmento;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_cuenta on public.cuentas;
create trigger trg_proteger_cuenta
  before update on public.cuentas
  for each row execute function public.proteger_campos_cuenta();


-- ----------------------------------------------------------------------------
--  BLINDAJE 2 · Tope REAL de empresas por plan (rechaza el INSERT si se excede).
--  El fundador no tiene tope. Sin plan asignado => máximo 1 (conservador).
--  El plan se lee del slug guardado en cuentas.plan_id.
-- ----------------------------------------------------------------------------
create or replace function public.validar_limite_empresas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug   text;
  v_limite int;
  v_count  int;
begin
  if public.soy_superadmin() then
    return new;
  end if;

  select plan_id into v_slug from public.cuentas where id = new.cuenta_id;

  v_limite := case v_slug
    when 'contador_basico'   then 3
    when 'contador_pro'      then 10
    when 'firma_contable'    then 2147483647   -- ilimitado
    when 'pyme'              then 1
    when 'empresa_completa'  then 1
    when 'grupo_empresarial' then 5
    else 1                                      -- sin plan: 1 empresa
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


-- ----------------------------------------------------------------------------
--  VERIFICACIÓN: deben aparecer los 2 triggers.
-- ----------------------------------------------------------------------------
select event_object_table as tabla, trigger_name, action_timing, event_manipulation as evento
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in ('trg_proteger_cuenta', 'trg_limite_empresas')
order by tabla, trigger_name;
