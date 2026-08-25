-- ============================================================================
--  PROGRAMA DE SOCIOS · Capa 2 · las operaciones
--  24/08/2026
--
--  Cuatro cosas que hacen falta para que el programa funcione de verdad:
--    1. Dar de alta a un socio (genera su codigo y sus cupones del ano)
--    2. Registrar el referido cuando una cuenta entra con un codigo
--    3. Canjear el cupon del mes de cortesia
--    4. Liquidar las comisiones del mes
--
--  SIGUE SIENDO ADITIVO
--    Solo crea funciones nuevas. No modifica ninguna tabla, funcion ni
--    trigger existente. El unico ajuste sobre algo que ya existe —el guardian
--    de cuentas— va aparte, en sql/socios_guardian.sql.
-- ============================================================================


-- ============================================================================
--  0 · LO QUE FALTA ANTES DE QUE EL CUPON FUNCIONE
--
--  proteger_campos_cuenta es un BEFORE UPDATE sobre cuentas que revierte
--  trial_termina_en cuando quien escribe no es el fundador. Esta bien puesto
--  —evita que una cuenta se regale meses a si misma— pero el canje del cupon
--  lo dispara el CLIENTE, asi que el guardian lo desharia.
--
--  Ese guardian se modifica en sql/socios_guardian.sql, APARTE y solo despues
--  de leer su codigo completo: reescribirlo a medias borraria protecciones
--  sin que nadie se entere.
--
--  Mientras tanto canjear_cupon() NO falla en silencio: comprueba que la
--  fecha quedo escrita de verdad y, si el guardian la revirtio, lo dice.
-- ============================================================================

-- ============================================================================
--  1 · ALTA DE UN SOCIO
--
--  La ejecuta el fundador cuando aprueba una postulacion. Genera el codigo a
--  partir del nombre, lo hace unico, y emite los dos cupones del ano.
-- ============================================================================

-- Codigo legible y corto: las primeras letras del nombre + 3 digitos.
create or replace function public.generar_codigo_socio(p_nombre text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raiz  text;
  v_cod   text;
  v_i     int := 0;
begin
  -- Solo letras A-Z, sin acentos, primeras cuatro.
  v_raiz := upper(left(regexp_replace(
              translate(coalesce(p_nombre, 'SOCIO'),
                        'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'),
              '[^A-Za-z]', '', 'g'), 4));
  if length(v_raiz) < 3 then v_raiz := 'SOC'; end if;

  loop
    v_cod := v_raiz || lpad((100 + floor(random() * 900))::int::text, 3, '0');
    exit when not exists (
      select 1 from public.socios where upper(btrim(codigo)) = v_cod
    );
    v_i := v_i + 1;
    if v_i > 50 then
      raise exception 'No se pudo generar un codigo unico para %', p_nombre;
    end if;
  end loop;
  return v_cod;
end;
$$;

create or replace function public.alta_socio(
  p_cuenta_id   uuid,
  p_nombre      text,
  p_colegiado   text default null,
  p_ciudad      text default null,
  p_telefono    text default null,
  p_email       text default null,
  p_es_fundador boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_cod  text;
  v_n    int;
begin
  if not public.soy_superadmin() then
    raise exception 'Solo el fundador puede dar de alta a un socio.';
  end if;
  if not exists (select 1 from public.cuentas where id = p_cuenta_id) then
    raise exception 'Esa cuenta no existe.';
  end if;
  if exists (select 1 from public.socios where cuenta_id = p_cuenta_id) then
    raise exception 'Esa cuenta ya es socio.';
  end if;

  -- Los fundadores son 20 y no mas. El limite se aplica aqui, no en la pantalla.
  if p_es_fundador then
    select count(*) into v_n from public.socios where es_fundador;
    if v_n >= 20 then
      raise exception 'Ya estan los 20 socios fundadores. Este entra como socio normal.';
    end if;
  end if;

  v_cod := public.generar_codigo_socio(p_nombre);

  insert into public.socios (cuenta_id, codigo, nombre, colegiado, ciudad,
                             telefono, email, estado, es_fundador, aprobado_en)
  values (p_cuenta_id, v_cod, p_nombre, p_colegiado, p_ciudad,
          p_telefono, p_email, 'activo', p_es_fundador, now())
  returning id into v_id;

  perform public.emitir_cupones_socio(v_id);

  return jsonb_build_object('socio_id', v_id, 'codigo', v_cod,
                            'nivel', public.socio_nivel(v_id));
end;
$$;

-- Dos cupones al ano, que vencen al cerrar el ano. Lo que no se usa no se
-- acumula: es lo que los mantiene en movimiento.
create or replace function public.emitir_cupones_socio(p_socio uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cod   text;
  v_hecho int := 0;
  v_i     int;
  v_fin   date := (date_trunc('year', now()) + interval '1 year - 1 day')::date;
begin
  for v_i in 1..2 loop
    loop
      v_cod := 'MES' || lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
      exit when not exists (
        select 1 from public.cupones where upper(btrim(codigo)) = v_cod
      );
    end loop;
    insert into public.cupones (socio_id, codigo, dias, vence_en)
    values (p_socio, v_cod, 30, v_fin);
    v_hecho := v_hecho + 1;
  end loop;
  return v_hecho;
end;
$$;


-- ============================================================================
--  2 · REGISTRAR EL REFERIDO
--
--  La llama la propia cuenta del cliente despues de entrar por primera vez,
--  igual que canjear_invitacion. Una cuenta pertenece a un solo socio y el
--  primer codigo manda: si ya tiene socio, no se puede cambiar.
-- ============================================================================
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

  select * into v_socio from public.socios
   where upper(btrim(codigo)) = upper(btrim(p_codigo)) and estado = 'activo';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Ese codigo de socio no existe o no esta activo.');
  end if;

  -- Un socio no puede referirse a si mismo.
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


-- ============================================================================
--  3 · CANJEAR EL CUPON DEL MES DE CORTESIA
--
--  Es la funcion que necesita la excepcion del guardian. Hace dos cosas:
--  amarra la cuenta al socio (si no lo estaba) y le abre los 30 dias.
-- ============================================================================
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

  -- Solo empresas nuevas: no se regala un mes a quien ya pago alguna vez.
  if exists (select 1 from public.pagos_suscripcion
              where cuenta_id = v_cuenta and estado = 'confirmado') then
    return jsonb_build_object('ok', false, 'motivo', 'El mes de cortesia es solo para empresas que aun no han sido clientes.');
  end if;

  select * into v_socio from public.socios where id = v_cup.socio_id;
  if v_socio.cuenta_id = v_cuenta then
    return jsonb_build_object('ok', false, 'motivo', 'No puedes canjear tu propio cupon.');
  end if;

  -- El cupon implica el referido: quien regala el mes se lleva la comision.
  insert into public.referidos (socio_id, cuenta_id, codigo_usado)
  values (v_socio.id, v_cuenta, v_socio.codigo)
  on conflict (cuenta_id) do nothing;

  v_hasta := now() + (v_cup.dias || ' days')::interval;

  -- Bandera de transaccion: sin esto el guardian revierte la fecha en silencio.
  perform set_config('app.socios_operacion', '1', true);
  update public.cuentas
     set estado = 'prueba', trial_termina_en = v_hasta
   where id = v_cuenta;
  perform set_config('app.socios_operacion', '', true);

  -- El guardian puede haber revertido la fecha sin devolver error. Se
  -- comprueba: mas vale un mensaje claro que un cupon que se dio por usado
  -- sin haber dado nada. El cupon NO se marca si el mes no quedo abierto.
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
--  4 · LIQUIDAR LAS COMISIONES DEL MES
--
--  Congela el nivel y el porcentaje que regian ese mes. Volver a correrla
--  sobre el mismo periodo RECALCULA la fila mientras siga en 'calculada';
--  si ya se pago, no la toca.
-- ============================================================================
create or replace function public.liquidar_comisiones(p_periodo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ini   timestamptz;
  v_fin   timestamptz;
  s       record;
  v_base  numeric;
  v_n     int;
  v_filas int := 0;
  v_total numeric := 0;
begin
  if not public.soy_superadmin() then
    raise exception 'Solo el fundador puede liquidar comisiones.';
  end if;
  if p_periodo !~ '^\d{4}-\d{2}$' then
    raise exception 'El periodo va como AAAA-MM (ejemplo: 2026-08).';
  end if;

  v_ini := (p_periodo || '-01')::timestamptz;
  v_fin := v_ini + interval '1 month';

  for s in select id from public.socios where estado = 'activo' loop
    select coalesce(sum(p.monto), 0), count(distinct p.cuenta_id)
      into v_base, v_n
      from public.pagos_suscripcion p
      join public.referidos r on r.cuenta_id = p.cuenta_id
     where r.socio_id = s.id
       and p.estado = 'confirmado'
       and p.creado_en >= v_ini
       and p.creado_en <  v_fin;

    if v_base > 0 then
      insert into public.comisiones (socio_id, periodo, nivel, pct, base, monto, cuentas_base)
      values (s.id, p_periodo, public.socio_nivel(s.id), public.socio_pct(s.id),
              v_base, round(v_base * public.socio_pct(s.id), 2), v_n)
      on conflict (socio_id, periodo) do update
        set nivel = excluded.nivel, pct = excluded.pct, base = excluded.base,
            monto = excluded.monto, cuentas_base = excluded.cuentas_base
        where public.comisiones.estado = 'calculada';
      v_filas := v_filas + 1;
      v_total := v_total + round(v_base * public.socio_pct(s.id), 2);
    end if;
  end loop;

  return jsonb_build_object('periodo', p_periodo, 'socios', v_filas,
                            'total', v_total);
end;
$$;


-- ============================================================================
--  VERIFICACION
-- ============================================================================
select 'funciones de operacion' as revision,
       count(*)::text || ' de 6' as hallazgo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('generar_codigo_socio','alta_socio','emitir_cupones_socio',
                     'registrar_referido','canjear_cupon','liquidar_comisiones');
