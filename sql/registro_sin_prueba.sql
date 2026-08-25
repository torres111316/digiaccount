-- ============================================================================
--  El registro deja de regalar 14 dias
--  24/08/2026
--
--  DE DONDE SALIAN
--    De handle_new_user(), la funcion que dispara on_auth_user_created cada
--    vez que alguien se registra. Creaba la cuenta con estado 'prueba' y
--    trial_termina_en = now() + 14 dias. Quitar el default de la columna no
--    servia de nada porque esta funcion escribe la fecha explicitamente.
--
--  EL HUECO QUE HAY QUE EVITAR
--    No basta con borrar la fecha. La app decide asi (window.__cuentaBloqueada):
--        pendiente / suspendida  -> bloqueada
--        prueba                  -> bloqueada SOLO si la fecha ya vencio
--        activa                  -> entra normal
--    Una cuenta en 'prueba' SIN fecha nunca vence: __TRIAL_VENCIDO queda
--    indefinido y la comparacion === true da falso. Es decir, acceso completo
--    y gratuito para siempre. Por eso el estado inicial pasa a 'pendiente'.
--
--  QUE PASA AHORA AL REGISTRARSE
--    La cuenta se crea igual que siempre —con su perfil admin y todo—, pero
--    nace 'pendiente': el usuario entra y ve la pantalla "Tu cuenta esta en
--    revision", que ya existe y ya funciona. Se activa cuando paga, o cuando
--    canjea el cupon de un socio, o cuando la activamos nosotros tras una
--    demostracion. Ni una linea nueva en la aplicacion.
--
--  QUE NO CAMBIA
--    El resto de la funcion queda identico: el nombre, la normalizacion del
--    segmento, el correo, el telefono y la creacion del perfil admin. Solo se
--    tocan dos cosas del INSERT: el estado y la fecha de prueba.
--
--    Las cuentas que YA existen no se tocan. Las 2 que hoy tienen prueba en
--    curso la conservan hasta su vencimiento.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  nueva_cuenta uuid;
  v_nombre text;
  v_segmento text;
begin
  v_nombre := coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'), ''), split_part(new.email, '@', 1));
  -- normalizamos el segmento a 'contador' o 'empresa'
  if coalesce(new.raw_user_meta_data->>'segmento', '') ilike 'contador%' then
    v_segmento := 'contador';
  else
    v_segmento := 'empresa';
  end if;

  -- 'pendiente' y sin fecha de prueba: ya no hay periodo gratuito automatico.
  -- El acceso lo abre un pago, el cupon de un socio, o el fundador.
  insert into public.cuentas (nombre, segmento, estado, email_contacto, telefono)
  values (v_nombre, v_segmento, 'pendiente', new.email, new.raw_user_meta_data->>'whatsapp')
  returning id into nueva_cuenta;

  insert into public.perfiles (id, cuenta_id, nombre, rol)
  values (new.id, nueva_cuenta, v_nombre, 'admin');

  return new;
end;
$function$;


-- ─────────────────────────────────────────────────────────────────────────
--  VERIFICACION · tiene que decir 'pendiente' y NO mencionar trial_termina_en
-- ─────────────────────────────────────────────────────────────────────────
select position('''pendiente''' in prosrc) > 0        as crea_en_pendiente,
       position('trial_termina_en' in prosrc) = 0     as ya_no_pone_prueba,
       position('14 days' in prosrc) = 0              as sin_los_14_dias
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'handle_new_user';
-- Las tres columnas deben salir en true.


-- ============================================================================
--  VUELTA ATRAS · si algo sale mal, esto restaura la funcion tal como estaba.
--  Esta comentado a proposito: descomentar el bloque entero y correrlo.
-- ============================================================================
-- create or replace function public.handle_new_user()
-- returns trigger language plpgsql security definer set search_path to 'public'
-- as $function$
-- declare nueva_cuenta uuid; v_nombre text; v_segmento text;
-- begin
--   v_nombre := coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'), ''), split_part(new.email, '@', 1));
--   if coalesce(new.raw_user_meta_data->>'segmento', '') ilike 'contador%' then
--     v_segmento := 'contador'; else v_segmento := 'empresa'; end if;
--   insert into public.cuentas (nombre, segmento, estado, email_contacto, telefono, trial_termina_en)
--   values (v_nombre, v_segmento, 'prueba', new.email, new.raw_user_meta_data->>'whatsapp', now() + interval '14 days')
--   returning id into nueva_cuenta;
--   insert into public.perfiles (id, cuenta_id, nombre, rol)
--   values (new.id, nueva_cuenta, v_nombre, 'admin');
--   return new;
-- end; $function$;
