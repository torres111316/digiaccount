-- ============================================================================
--  Que un codigo de socio no pueda apropiarse de un cliente que ya era tuyo
--  25/08/2026
--
--  EL HUECO
--    registrar_referido() y canjear_cupon() usaban mi_cuenta_id() sin preguntar
--    QUIEN estaba pidiendo ni COMO habia llegado esa cuenta.
--
--    Y las cuentas cambian de dueno: canjear_invitacion() muda el perfil de un
--    invitado a la cuenta del equipo que lo invito. Desde ese momento,
--    mi_cuenta_id() de ese invitado devuelve la cuenta de SU PATRON.
--
--    Resultado: un empleado recien invitado a ACME —cliente organico desde
--    hace un ano— podia escribir el codigo de cualquier socio y amarrarle
--    ACME. El socio empezaba a cobrar su porcentaje de una empresa que jamas
--    refirio, y no quedaba rastro de nada raro.
--
--  LOS DOS CANDADOS
--    1. Solo el ADMIN de la cuenta puede amarrarla a un socio. Un invitado con
--       rol de contador, asistente o vendedor no decide sobre la suscripcion
--       de la empresa que lo contrato.
--    2. La cuenta no puede tener PAGOS CONFIRMADOS. Un referido es un cliente
--       NUEVO; quien ya estaba pagando no se refiere, ya llego. Es la misma
--       regla que canjear_cupon ya aplicaba al mes de cortesia, ahora tambien
--       para la comision.
--
--  LO QUE NO SE TOCA
--    El caso inverso —codigo de socio y despues invitacion— se resuelve solo y
--    ademas acierta: al borrarse la cuenta vieja, la fila de referidos se va en
--    cascada. Correcto, porque esa persona no es cliente nueva: se sumo al
--    equipo de otro y no hay comision que pagar.
-- ============================================================================

-- Ayudante: quien pregunta, es el admin de su propia cuenta?
create or replace function public.soy_admin_de_mi_cuenta()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
     where id = auth.uid() and lower(coalesce(rol, '')) = 'admin'
  );
$$;


create or replace function public.registrar_referido(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta uuid := public.mi_cuenta_id();
  v_socio  public.socios%rowtype;
begin
  if v_cuenta is null then
    return jsonb_build_object('ok', false, 'motivo', 'No hay sesion activa.');
  end if;

  -- CANDADO 1 · solo el admin decide sobre la suscripcion de su cuenta.
  if not public.soy_admin_de_mi_cuenta() then
    return jsonb_build_object('ok', false,
      'motivo', 'Solo el administrador de la cuenta puede registrar un codigo de socio.');
  end if;

  -- CANDADO 2 · un referido es un cliente NUEVO.
  if exists (select 1 from public.pagos_suscripcion
              where cuenta_id = v_cuenta and estado = 'confirmado') then
    return jsonb_build_object('ok', false,
      'motivo', 'Esta cuenta ya es cliente de DigiAccount. El codigo de socio es para empresas nuevas.');
  end if;

  select * into v_socio from public.socios
   where upper(btrim(codigo)) = upper(btrim(p_codigo)) and estado = 'activo';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Ese codigo de socio no existe o no esta activo.');
  end if;

  if v_socio.cuenta_id = v_cuenta then
    return jsonb_build_object('ok', false, 'motivo', 'No puedes usar tu propio codigo.');
  end if;

  if exists (select 1 from public.referidos where cuenta_id = v_cuenta) then
    return jsonb_build_object('ok', false, 'motivo', 'Esta cuenta ya esta asociada a un socio.');
  end if;

  insert into public.referidos (socio_id, cuenta_id, codigo_usado)
  values (v_socio.id, v_cuenta, upper(btrim(p_codigo)));

  return jsonb_build_object('ok', true, 'socio', v_socio.nombre);
end;
$$;


-- El cupon abre un mes de cortesia Y amarra el referido, asi que necesita el
-- mismo candado del admin. El de "cliente nuevo" ya lo tenia.
create or replace function public.canjear_cupon(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta uuid := public.mi_cuenta_id();
  v_cup    public.cupones%rowtype;
  v_socio  public.socios%rowtype;
  v_hasta  timestamptz;
begin
  if v_cuenta is null then
    return jsonb_build_object('ok', false, 'motivo', 'No hay sesion activa.');
  end if;

  if not public.soy_admin_de_mi_cuenta() then
    return jsonb_build_object('ok', false,
      'motivo', 'Solo el administrador de la cuenta puede canjear un cupon.');
  end if;

  select * into v_cup from public.cupones
   where upper(btrim(codigo)) = upper(btrim(p_codigo));
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Ese cupon no existe.');
  end if;
  if v_cup.canjeado_en is not null then
    return jsonb_build_object('ok', false, 'motivo', 'Ese cupon ya fue usado.');
  end if;
  if v_cup.vence_en < current_date then
    return jsonb_build_object('ok', false, 'motivo', 'Ese cupon vencio el ' || to_char(v_cup.vence_en, 'DD/MM/YYYY') || '.');
  end if;

  if exists (select 1 from public.pagos_suscripcion
              where cuenta_id = v_cuenta and estado = 'confirmado') then
    return jsonb_build_object('ok', false, 'motivo', 'El mes de cortesia es solo para empresas que aun no han sido clientes.');
  end if;

  select * into v_socio from public.socios where id = v_cup.socio_id;
  if v_socio.cuenta_id = v_cuenta then
    return jsonb_build_object('ok', false, 'motivo', 'No puedes canjear tu propio cupon.');
  end if;

  insert into public.referidos (socio_id, cuenta_id, codigo_usado)
  values (v_socio.id, v_cuenta, v_socio.codigo)
  on conflict (cuenta_id) do nothing;

  v_hasta := now() + (v_cup.dias || ' days')::interval;

  perform set_config('app.socios_operacion', '1', true);
  update public.cuentas
     set estado = 'prueba', trial_termina_en = v_hasta
   where id = v_cuenta;
  perform set_config('app.socios_operacion', '', true);

  -- El guardian puede revertir la fecha sin devolver error. Se comprueba: mas
  -- vale un mensaje claro que un cupon dado por usado sin haber dado nada.
  if not exists (select 1 from public.cuentas
                  where id = v_cuenta and trial_termina_en is not null
                    and trial_termina_en > now() + interval '1 day') then
    return jsonb_build_object('ok', false,
      'motivo', 'El sistema no pudo abrir el mes de cortesia: el guardian de '
             || 'cuentas revirtio el cambio. Falta correr sql/socios_guardian.sql. '
             || 'El cupon NO se consumio.');
  end if;

  update public.cupones
     set canjeado_por = v_cuenta, canjeado_en = now()
   where id = v_cup.id;

  return jsonb_build_object('ok', true, 'dias', v_cup.dias,
                            'hasta', to_char(v_hasta, 'DD/MM/YYYY'),
                            'socio', v_socio.nombre);
end;
$$;


-- ============================================================================
--  VERIFICACION · las cuatro deben decir 'si'
-- ============================================================================
select 'existe el ayudante de admin' as revision,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'soy_admin_de_mi_cuenta')
            then 'si' else 'NO' end as hallazgo
union all
select 'referir exige ser admin',
       case when position('soy_admin_de_mi_cuenta' in prosrc) > 0 then 'si' else 'NO' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'registrar_referido'
union all
select 'referir exige cliente nuevo',
       case when position('ya es cliente de DigiAccount' in prosrc) > 0 then 'si' else 'NO' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'registrar_referido'
union all
select 'el cupon exige ser admin',
       case when position('soy_admin_de_mi_cuenta' in prosrc) > 0 then 'si' else 'NO' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'canjear_cupon';
