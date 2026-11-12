-- ============================================================
-- DigiAccount · Contabilidad 16: todo lo que proponen los módulos pasa por aprobación
-- Ejecutar en: Supabase SQL Editor, DESPUÉS de volver a correr contabilidad_15
-- (que ya suma estas propuestas al bloqueo de «Cerrar mes»). Re-ejecutable.
--
-- POR QUÉ (Luis, 12/11/2026): «todos los movimientos que se necesiten
-- contabilizar desde cada módulo» (Forma 30, declaraciones y pagos, nómina,
-- activos fijos y su depreciación, revaluación, criptoactivos, impuesto
-- diferido…) deben llegar a Contabilidad como un asiento PROPUESTO, con los
-- montos puestos y la opción de modificarlo antes de aprobar.
--
-- CÓMO: en vez de tocar cada módulo, un guardián en la tabla asientos. En las
-- empresas en modo revisión (empresas.contab_resumen, SQL 15), cuando un
-- módulo intenta crear, cambiar o borrar uno de sus asientos, el guardián lo
-- detiene y deja el cambio como BORRADOR en contab_borradores. Al aprobarlo
-- (contab_aprobar_borrador) se escribe el asiento de verdad, con la misma
-- referencia y el mismo origen de siempre: todo lo que lee asientos (la F30 de
-- «Cerrar mes», el aviso de declarado contra contable, la nómina) sigue igual.
--   · Pasan por el guardián: los asientos de declaraciones y sus pagos,
--     depreciación, baja de activos, revaluación, y los que hace el navegador
--     con origen 'auto' (nómina, liquidación de la F30, criptoactivos,
--     impuesto diferido).
--   · NO pasan: el asiento manual, la apertura, los resúmenes del SQL 15, la
--     conciliación, «Dar por cobrado y pagado» y Tesorería (ya son decisión
--     explícita de quien los registra).
--   · La CLAVE de un borrador dice qué asiento reemplaza:
--       - documento de origen (declaración, pago, baja): tabla:id;
--       - lo que el módulo rehace entero cada vez (nómina NOM-, liquidación F30-,
--         depreciación DEPR-, revaluación REV-): la referencia del período;
--       - lo demás (criptoactivos, impuesto diferido, asientos viejos de la app):
--         uno por asiento. Dos mediciones del mismo mes son dos asientos.
--   · Un borrador vacío ('[]') es un pedido de BORRAR el asiento.
--   · Reemplazo explícito: el navegador inserta la nómina nueva y después
--     borra la vieja; ese borrado se reconoce por «reemplazo_de» y no se toma
--     como pedido de borrar.
--   · Lo que ya se resolvió (aprobado o descartado) no vuelve a quedar
--     pendiente si el módulo propone lo mismo: «Cerrar mes» recalcula la
--     depreciación y no debe reabrir lo que Luis ya corrigió.
--   · Lo propuesto y lo aprobado quedan guardados (corregido = difieren).
-- Pruebas: sql/pruebas/contabilidad_16_pruebas.sql.
-- ============================================================

create table if not exists public.contab_borradores (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  clave         text not null,
  cuenta_id     uuid,
  fecha         text,
  periodo       text,
  descripcion   text,
  referencia    text,
  origen        text,
  origen_tabla  text,
  origen_id     uuid,
  propuesta     jsonb not null default '[]'::jsonb,   -- '[]' = borrar el asiento
  asiento_id    uuid,                   -- el asiento aprobado vigente de esta clave
  reemplazo_de  uuid,                   -- el asiento que el navegador va a borrar porque lo reemplaza
  resuelta      jsonb,                  -- la última propuesta ya resuelta (aprobada o descartada)
  pendiente     boolean not null default true,
  version       int not null default 1,
  aprobado      jsonb,
  corregido     boolean not null default false,
  aprobado_por  text,
  aprobado_en   timestamptz,
  actualizado_en timestamptz not null default clock_timestamp(),
  unique (empresa_id, clave)
);
alter table public.contab_borradores add column if not exists reemplazo_de uuid;
alter table public.contab_borradores add column if not exists resuelta jsonb;
comment on table public.contab_borradores is
  'Asientos propuestos por los módulos en las empresas en modo revisión (sql/contabilidad_16). propuesta = lo que pidió el módulo ([] = borrar); aprobado = lo que aprobó Luis.';

alter table public.contab_borradores enable row level security;
drop policy if exists contab_borradores_ver on public.contab_borradores;
create policy contab_borradores_ver on public.contab_borradores for select
  using (public.soy_superadmin() or empresa_id in (select public.mis_empresas()));

-- ¿Este asiento lo hace un módulo que debe pasar por aprobación?
create or replace function public.contab_va_a_revision(p_origen text, p_origen_tabla text)
returns boolean language sql immutable as $$
  select coalesce(p_origen_tabla, '') in ('declaraciones', 'declaraciones_pago', 'depreciacion', 'activos_fijos', 'revaluacion')
      or (coalesce(p_origen, '') = 'auto' and p_origen_tabla is null)
$$;

drop function if exists public.contab_clave_borrador(text, uuid, text);
drop function if exists public.contab_clave_borrador(text, uuid, text, text);
create or replace function public.contab_clave_borrador(p_origen_tabla text, p_origen_id uuid, p_referencia text, p_periodo text, p_asiento uuid)
returns text language sql immutable as $$
  select case
    when p_origen_id is not null then p_origen_tabla || ':' || p_origen_id::text
    when coalesce(p_origen_tabla, '') in ('depreciacion', 'revaluacion')
      or coalesce(p_referencia, '') ~ '^(NOM-|F30-)' then coalesce(p_origen_tabla, 'modulo') || ':ref:' || coalesce(p_referencia, '') || '@' || coalesce(p_periodo, '')
    else 'asiento:' || p_asiento::text
  end
$$;

-- Las líneas como las guarda la base (código · nombre del plan): para comparar
-- lo que manda un módulo con lo aprobado sin que un nombre distinto cuente como cambio.
create or replace function public.contab_validar_lineas_o_vacio(p_empresa uuid, p_lineas jsonb)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then return '[]'::jsonb; end if;
  return contab_validar_lineas(p_empresa, p_lineas);
exception when others then
  return p_lineas;
end $$;

-- ── El guardián ───────────────────────────────────────────────────────────
create or replace function public.contab_asiento_revision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r asientos;
  k text;
  b contab_borradores;
  rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
  vigente uuid;
  norm jsonb;
begin
  if coalesce(current_setting('contab.aprobando', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  r := case when tg_op = 'DELETE' then old else new end;
  if not contab_va_a_revision(r.origen, r.origen_tabla) or not contab_es_resumen(r.empresa_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Devolver NULL salta la regla RLS de asientos: se revisa aquí que la empresa
  -- (la de antes y la de ahora) sea de quien escribe.
  if rol in ('authenticated', 'anon') and not public.soy_superadmin()
     and (r.empresa_id not in (select public.mis_empresas())
          or (tg_op = 'UPDATE' and old.empresa_id not in (select public.mis_empresas()))) then
    raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501';
  end if;
  -- Un cambio que no toca ni las líneas ni la fecha (la descripción, por ejemplo) pasa.
  if tg_op = 'UPDATE' and new.lineas is not distinct from old.lineas and new.fecha is not distinct from old.fecha
     and new.periodo is not distinct from old.periodo and new.empresa_id = old.empresa_id then
    return new;
  end if;
  k := contab_clave_borrador(r.origen_tabla, r.origen_id, r.referencia, r.periodo, r.id);   -- el período ya lo puso trg_asiento_numero
  select * into b from contab_borradores where empresa_id = r.empresa_id and clave = k;

  if tg_op = 'DELETE' then
    -- El navegador reemplaza (nómina, F30): insertó la nueva y ahora borra esta.
    if b.id is not null and b.reemplazo_de = old.id then
      update contab_borradores set reemplazo_de = null where id = b.id;
      return null;
    end if;
    insert into contab_borradores (empresa_id, clave, cuenta_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id,
                                   propuesta, asiento_id, pendiente)
    values (old.empresa_id, k, old.cuenta_id, old.fecha, old.periodo, old.descripcion, old.referencia, old.origen, old.origen_tabla, old.origen_id,
            '[]'::jsonb, old.id, true)
    on conflict (empresa_id, clave) do update
      set propuesta = '[]'::jsonb, asiento_id = old.id, reemplazo_de = null,
          pendiente = contab_borradores.resuelta is distinct from '[]'::jsonb,
          version = contab_borradores.version + 1, actualizado_en = clock_timestamp();
    return null;
  end if;

  -- Crear o cambiar: queda la propuesta.
  vigente := case when tg_op = 'UPDATE' then old.id else b.asiento_id end;
  if tg_op = 'INSERT' and b.id is null and k like '%:ref:%' then
    -- Un asiento de antes del SQL 16 con la misma referencia en el período: es el que se reemplaza.
    select min(a.id::text)::uuid into vigente from asientos a
     where a.empresa_id = new.empresa_id and a.referencia = new.referencia and a.periodo = new.periodo
       and coalesce(a.origen_tabla, '') = coalesce(new.origen_tabla, '') and contab_va_a_revision(a.origen, a.origen_tabla)
     having count(*) = 1;
  end if;
  insert into contab_borradores (empresa_id, clave, cuenta_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id,
                                 propuesta, asiento_id, pendiente)
  values (new.empresa_id, k, new.cuenta_id, new.fecha, new.periodo, new.descripcion, new.referencia, new.origen, new.origen_tabla, new.origen_id,
          coalesce(new.lineas, '[]'::jsonb), vigente, true)
  on conflict (empresa_id, clave) do update
    set cuenta_id = excluded.cuenta_id, fecha = excluded.fecha, periodo = excluded.periodo, descripcion = excluded.descripcion,
        referencia = excluded.referencia, origen = excluded.origen, origen_tabla = excluded.origen_tabla, origen_id = excluded.origen_id,
        propuesta = excluded.propuesta, asiento_id = excluded.asiento_id,
        version = contab_borradores.version + 1, actualizado_en = clock_timestamp();
  select * into b from contab_borradores where empresa_id = new.empresa_id and clave = k;
  -- El navegador que reemplaza (nómina, F30) va a borrar el vigente: se anota.
  if tg_op = 'INSERT' and new.origen = 'auto' and new.origen_tabla is null and b.asiento_id is not null then
    update contab_borradores set reemplazo_de = b.asiento_id where id = b.id;
  end if;
  norm := contab_validar_lineas_o_vacio(new.empresa_id, b.propuesta);
  update contab_borradores
     set pendiente = not (
           norm is not distinct from b.resuelta
           or (b.asiento_id is not null
               and norm = coalesce((select lineas from asientos where id = b.asiento_id), '[]'::jsonb)
               and b.fecha is not distinct from (select fecha from asientos where id = b.asiento_id)))
   where id = b.id;
  return null;
end $$;

-- (El numerador va por orden de nombre: «trg_asiento_numero» corre antes que
-- «trg_asiento_revision». Lo detenido no se inserta: no gasta número.)
drop trigger if exists trg_asiento_revision on public.asientos;
create trigger trg_asiento_revision before insert or update or delete on public.asientos
  for each row execute function public.contab_asiento_revision();

-- ── Aprobar, descartar ────────────────────────────────────────────────────
create or replace function public.contab_aprobar_borrador(p_borrador uuid, p_lineas jsonb default null, p_version int default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b contab_borradores;
  lin jsonb;
  tot numeric;
  aid uuid;
  num int;
  per_asi text;
begin
  select * into b from contab_borradores where id = p_borrador;
  if b.id is null then return jsonb_build_object('ok', false, 'motivo', 'No existe esa propuesta.'); end if;
  if not (public.soy_superadmin() or b.empresa_id in (select public.mis_empresas())) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;
  perform pg_advisory_xact_lock(hashtext('borrador:' || b.id::text));
  select * into b from contab_borradores where id = p_borrador;
  if p_version is not null and p_version <> b.version then
    return jsonb_build_object('ok', false, 'motivo', 'El módulo cambió esta propuesta mientras la revisabas: vuelve a abrirla.');
  end if;
  select periodo into per_asi from asientos where id = b.asiento_id;
  if exists (select 1 from cierres_mensuales where empresa_id = b.empresa_id and periodo in (b.periodo, per_asi)) then
    return jsonb_build_object('ok', false, 'motivo', 'El mes está cerrado: reábrelo para cambiar su contabilidad.');
  end if;
  if jsonb_array_length(b.propuesta) > 0 or (p_lineas is not null and jsonb_array_length(p_lineas) > 0) then
    begin
      lin := contab_validar_lineas(b.empresa_id, coalesce(p_lineas, b.propuesta));
    exception when others then
      return jsonb_build_object('ok', false, 'motivo', sqlerrm);
    end;
  end if;

  perform set_config('contab.aprobando', 'on', true);
  if b.asiento_id is not null then delete from asientos where id = b.asiento_id; end if;
  aid := null;
  if lin is not null then
    select round(sum((e->>'debe')::numeric), 2) into tot from jsonb_array_elements(lin) e;
    insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
    values ((select cuenta_id from empresas where id = b.empresa_id), b.empresa_id, b.fecha, b.periodo, b.descripcion, b.referencia,
            b.origen, b.origen_tabla, b.origen_id, lin, tot)
    returning id, numero into aid, num;
  end if;
  perform set_config('contab.aprobando', 'off', true);

  update contab_borradores
     set asiento_id = aid, pendiente = false, aprobado = coalesce(lin, '[]'::jsonb),
         resuelta = contab_validar_lineas_o_vacio(b.empresa_id, b.propuesta),
         corregido = coalesce(lin, '[]'::jsonb) is distinct from contab_validar_lineas_o_vacio(b.empresa_id, b.propuesta),
         reemplazo_de = null,
         aprobado_por = coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', current_user),
         aprobado_en = now()
   where id = b.id;

  -- La revaluación encadena: al aprobar un mes se recalculan los siguientes
  -- (quedan como propuesta si cambian). Solo si existe el SQL 12.
  if b.origen_tabla = 'revaluacion' and to_regprocedure('public.contab_revaluar(uuid, text)') is not null then
    execute 'select public.contab_revaluar($1, $2)' using b.empresa_id, to_char(to_date(b.periodo || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
  end if;
  return jsonb_build_object('ok', true, 'asiento', num, 'borrado', lin is null);
end $$;
grant execute on function public.contab_aprobar_borrador(uuid, jsonb, int) to authenticated;

-- Descartar: se ignora lo que pidió el módulo; el asiento aprobado (si hay)
-- queda como está, y esa misma propuesta no vuelve a quedar pendiente. La
-- depreciación y la revaluación no se descartan: el módulo las recalcula
-- igual cada vez (y la depreciación ya grabó sus cuotas); se corrigen y se aprueban.
create or replace function public.contab_descartar_borrador(p_borrador uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b contab_borradores;
begin
  select * into b from contab_borradores where id = p_borrador;
  if b.id is null then return jsonb_build_object('ok', false, 'motivo', 'No existe esa propuesta.'); end if;
  if not (public.soy_superadmin() or b.empresa_id in (select public.mis_empresas())) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;
  if b.origen_tabla in ('depreciacion', 'revaluacion') then
    return jsonb_build_object('ok', false, 'motivo', 'La depreciación y la revaluación no se descartan: corrígelas si hace falta y apruébalas.');
  end if;
  if b.asiento_id is null then
    delete from contab_borradores where id = b.id;
  else
    update contab_borradores
       set resuelta = contab_validar_lineas_o_vacio(b.empresa_id, b.propuesta),
           propuesta = coalesce((select lineas from asientos where id = b.asiento_id), '[]'::jsonb), pendiente = false,
           reemplazo_de = null, version = version + 1, actualizado_en = clock_timestamp()
     where id = b.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.contab_descartar_borrador(uuid) to authenticated;

-- Si el asiento aprobado se borra por otro camino, el borrador no apunta a un asiento que ya no existe.
create or replace function public.contab_borrador_sin_asiento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update contab_borradores set asiento_id = null where asiento_id = old.id;
  update contab_borradores set reemplazo_de = null where reemplazo_de = old.id;
  return old;
end $$;
drop trigger if exists trg_contab_borrador_sin_asiento on public.asientos;
create trigger trg_contab_borrador_sin_asiento after delete on public.asientos
  for each row execute function public.contab_borrador_sin_asiento();

-- Restos de la primera versión de este SQL (ya no hacen falta).
drop trigger if exists trg_borrador_huerfano_decl on public.declaraciones;
drop trigger if exists trg_borrador_huerfano_af on public.activos_fijos;
drop trigger if exists trg_borrador_huerfano_af_baja on public.activos_fijos;
drop function if exists public.contab_borrador_huerfano();
do $$
begin
  if to_regprocedure('public.contab_filas_sin_asiento_15(uuid, text)') is not null then
    drop function public.contab_filas_sin_asiento_15(uuid, text);
  end if;
end $$;

-- ── Propuestas que el módulo retiró antes de aprobarse ────────────────────
-- Cuando el módulo «borra» un asiento que nunca existió (el pago perdió su
-- fecha, la depreciación del mes dio cero, se borró la declaración…) el
-- guardián no se entera. Esto quita esas propuestas: lo llaman la pantalla
-- y «Cerrar mes» antes de mirar lo pendiente.
create or replace function public.contab_limpiar_borradores(p_empresa uuid)
returns int language plpgsql security invoker set search_path = public, pg_temp as $$
declare n int;
begin
  delete from contab_borradores b
   where b.empresa_id = p_empresa and b.pendiente and b.asiento_id is null and (
         (b.origen_tabla = 'declaraciones'
          and coalesce((select contab_lineas_declaracion(d) is not null from declaraciones d where d.id = b.origen_id), false) = false)
      or (b.origen_tabla = 'declaraciones_pago'
          and coalesce((select contab_lineas_pago(d) is not null from declaraciones d where d.id = b.origen_id), false) = false)
      or (b.origen_tabla = 'activos_fijos'
          and not exists (select 1 from activos_fijos f where f.id = b.origen_id and f.fecha_baja is not null))
      or (b.origen_tabla = 'depreciacion'
          and not exists (select 1 from activos_depreciacion x join activos_fijos f on f.id = x.activo_id
                           where f.empresa_id = p_empresa and x.periodo = b.periodo and x.monto > 0)));
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.contab_limpiar_borradores(uuid) to authenticated;

-- ── Eliminar una cuenta (sql/blindaje_db.sql) no deja propuestas ──────────
-- Es la misma función, con el guardián apagado durante el borrado.
create or replace function public.eliminar_cuenta(p_cuenta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.soy_superadmin() then
    raise exception 'Solo el fundador puede eliminar cuentas.';
  end if;
  -- El guardián de propuestas (sql/contabilidad_16) no se mete en un borrado completo.
  perform set_config('contab.aprobando', 'on', true);

  -- datos por empresa
  delete from public.libro_fiscal          where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);
  delete from public.movimientos_tesoreria where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);
  delete from public.retenciones           where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);
  delete from public.asientos              where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);
  delete from public.documentos_fiscales   where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);
  delete from public.criptoactivos         where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);
  delete from public.activos_fijos         where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);
  delete from public.novedades_nomina      where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);
  delete from public.cuentas_contables     where empresa_id in (select id from public.empresas where cuenta_id = p_cuenta_id);

  -- datos por cuenta
  delete from public.recibos_nomina        where cuenta_id = p_cuenta_id;
  delete from public.empleados             where cuenta_id = p_cuenta_id;
  delete from public.parametros_nomina     where cuenta_id = p_cuenta_id;
  delete from public.cuentas_tesoreria     where cuenta_id = p_cuenta_id;
  delete from public.facturas              where cuenta_id = p_cuenta_id;
  delete from public.productos             where cuenta_id = p_cuenta_id;
  delete from public.terceros              where cuenta_id = p_cuenta_id;
  delete from public.empresas              where cuenta_id = p_cuenta_id;
  delete from public.perfiles              where cuenta_id = p_cuenta_id;
  delete from public.cuentas               where id = p_cuenta_id;
end;
$$;

-- Comprobación
select (select count(*) from pg_trigger where tgname = 'trg_asiento_revision' and not tgisinternal) as guardian,
       (select count(*) from empresas where contab_resumen) as empresas_en_revision;
