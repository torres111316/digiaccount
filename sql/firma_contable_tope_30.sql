-- ============================================================================
--  Firma Contable deja de ser ilimitada: tope de 30 empresas
--  24/08/2026
--
--  POR QUÉ
--    "Empresas ilimitadas" es una puerta abierta: una sola suscripción de 199 $
--    puede terminar cargando la contabilidad de cincuenta clientes, y el costo
--    de los agentes y del almacenamiento crece con cada una. El modelo de
--    precios ya suponía unas 30 reales; esto solo lo hace explícito y, sobre
--    todo, EXIGIBLE.
--
--  DÓNDE SE APLICA DE VERDAD
--    En este trigger. La pantalla también lo dice (LIMITE_EMPRESAS en app.js),
--    pero la pantalla se puede saltar: el INSERT no.
--
--  A QUIÉN NO TOCA
--    Al fundador (soy_superadmin) y a las cuentas que ya tengan más de 30
--    empresas cargadas: el trigger es BEFORE INSERT, así que no borra nada;
--    simplemente no deja registrar la 31.
-- ============================================================================
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
    when 'firma_contable'    then 30           -- antes: ilimitado
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

-- Si la tabla de planes lleva el tope publicado, que diga lo mismo. Va dentro
-- de un DO porque no todas las instalaciones tienen esa columna, y este archivo
-- tiene que poder correrse completo sin reventar a la mitad.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'planes'
                and column_name = 'max_empresas') then
    update public.planes set max_empresas = 30 where id = 'firma_contable';
  end if;
end $$;

-- ----------------------------------------------------------------------------
--  COMPROBACIÓN 1 · ¿quedó aplicado?
--  Lee el codigo del trigger tal como esta viviendo en la base ahora mismo.
--  Devuelve 30 si corrio; 2147483647 si no.
-- ----------------------------------------------------------------------------
select substring(prosrc from 'firma_contable''\s*then\s*(\d+)') as tope_firma_contable
  from pg_proc where proname = 'validar_limite_empresas';

-- ----------------------------------------------------------------------------
--  COMPROBACIÓN 2 · ninguna cuenta debería estar ya por encima del nuevo tope.
--  Si devuelve filas, esas cuentas conservan las empresas que ya tienen (el
--  trigger es BEFORE INSERT y no borra nada), pero no podran registrar mas.
-- ----------------------------------------------------------------------------
select c.id, c.plan_id, count(e.id) as empresas
  from public.cuentas c
  join public.empresas e on e.cuenta_id = c.id
 where c.plan_id = 'firma_contable'
 group by c.id, c.plan_id
having count(e.id) > 30;
