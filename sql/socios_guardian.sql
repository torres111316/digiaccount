-- ============================================================================
--  El guardian de cuentas aprende UNA excepcion
--  24/08/2026
--
--  EL PROBLEMA
--    proteger_campos_cuenta es un BEFORE UPDATE sobre cuentas que revierte
--    estado, plan_id, trial_termina_en y segmento cuando quien escribe no es
--    el fundador. Esta bien puesto: sin el, cualquier cuenta podria regalarse
--    meses de prueba o subirse de plan sola.
--
--    Pero el canje del cupon de un socio lo dispara EL CLIENTE. El guardian
--    revertiria el mes de cortesia sin devolver ningun error: el cupon se
--    daria por usado y el cliente no recibiria nada. Una falla muda.
--
--  LA EXCEPCION
--    Una bandera de transaccion. Solo la enciende canjear_cupon(), justo
--    antes de escribir, y la apaga enseguida. El tercer parametro de
--    set_config en true la hace local a la transaccion, asi que no sobrevive
--    a la peticion ni se filtra a otra.
--
--    Un cliente no puede encenderla por su cuenta: a traves de PostgREST solo
--    se pueden llamar las funciones expuestas, no ejecutar set_config suelto.
--    Y canjear_cupon valida el cupon antes de encenderla.
--
--  QUE CAMBIA, EXACTAMENTE
--    Una condicion en el if. Nada mas. Las cuatro lineas de proteccion
--    —estado, plan_id, trial_termina_en, segmento— quedan intactas, con su
--    comentario original incluido. Se comprobo contra pg_get_functiondef
--    antes de escribir esto: no se reconstruyo de memoria.
-- ============================================================================

create or replace function public.proteger_campos_cuenta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- La bandera app.socios_operacion solo la enciende canjear_cupon(), y solo
  -- durante esa transaccion. Es lo que permite abrir el mes de cortesia de un
  -- socio sin abrirle la puerta a nadie mas.
  if not public.soy_superadmin()
     and coalesce(current_setting('app.socios_operacion', true), '') <> '1' then
    new.estado           := old.estado;
    -- El plan solo puede fijarse la PRIMERA vez (elección del registro/onboarding);
    -- una vez asignado, solo el fundador puede cambiarlo (anti auto-upgrade).
    if old.plan_id is not null then
      new.plan_id := old.plan_id;
    end if;
    new.trial_termina_en := old.trial_termina_en;
    new.segmento         := old.segmento;
  end if;
  return new;
end;
$function$;


-- ============================================================================
--  VERIFICACION · las cuatro protecciones siguen ahi, y la excepcion tambien
-- ============================================================================
select 'protege el estado'            as revision,
       case when position('new.estado           := old.estado' in prosrc) > 0 then 'si' else 'NO' end as hallazgo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'proteger_campos_cuenta'
union all
select 'protege el plan',
       case when position('new.plan_id := old.plan_id' in prosrc) > 0 then 'si' else 'NO' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'proteger_campos_cuenta'
union all
select 'protege la fecha de prueba',
       case when position('new.trial_termina_en := old.trial_termina_en' in prosrc) > 0 then 'si' else 'NO' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'proteger_campos_cuenta'
union all
select 'protege el segmento',
       case when position('new.segmento         := old.segmento' in prosrc) > 0 then 'si' else 'NO' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'proteger_campos_cuenta'
union all
select 'aprendio la excepcion del cupon',
       case when position('app.socios_operacion' in prosrc) > 0 then 'si' else 'NO' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'proteger_campos_cuenta'
union all
select 'el trigger sigue enganchado',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.cuentas'::regclass
                            and tgname = 'trg_proteger_cuenta'
                            and not tgisinternal)
            then 'si' else 'NO' end;
-- Las seis deben decir 'si'.


-- ============================================================================
--  VUELTA ATRAS · el guardian tal como estaba, sin la excepcion.
--  Copiado literal de pg_get_functiondef antes del cambio.
--  Descomentar el bloque entero y correrlo.
-- ============================================================================
-- CREATE OR REPLACE FUNCTION public.proteger_campos_cuenta()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- begin
--   if not public.soy_superadmin() then
--     new.estado           := old.estado;
--     -- El plan solo puede fijarse la PRIMERA vez (elección del registro/onboarding);
--     -- una vez asignado, solo el fundador puede cambiarlo (anti auto-upgrade).
--     if old.plan_id is not null then
--       new.plan_id := old.plan_id;
--     end if;
--     new.trial_termina_en := old.trial_termina_en;
--     new.segmento         := old.segmento;
--   end if;
--   return new;
-- end;
-- $function$;
