-- ============================================================
-- DigiAccount · Contabilidad 16: todo lo que proponen los módulos pasa por aprobación
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _15. Re-ejecutable.
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
--   · Qué pasa por el guardián: los asientos de declaraciones y sus pagos,
--     depreciación, baja de activos, revaluación, y los que hace el navegador
--     con origen 'auto' (nómina, liquidación de la F30, criptoactivos,
--     impuesto diferido).
--   · Qué NO: el asiento manual, la apertura, los resúmenes del SQL 15, la
--     conciliación, «Dar por cobrado y pagado» y Tesorería. Esos ya son una
--     decisión explícita de quien los registra.
--   · Un borrador vacío ('[]') es un pedido de BORRAR el asiento (el módulo
--     anuló o borró su documento): se aprueba igual.
--   · Lo propuesto y lo aprobado quedan guardados (corregido = difieren):
--     de ahí aprenden los agentes, igual que con los resúmenes.
-- Pruebas: sql/pruebas/contabilidad_16_pruebas.sql.
-- ============================================================

create table if not exists public.contab_borradores (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  clave         text not null,          -- origen_tabla:origen_id, o origen_tabla:ref:<referencia>
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
  pendiente     boolean not null default true,
  version       int not null default 1,
  aprobado      jsonb,
  corregido     boolean not null default false,
  aprobado_por  text,
  aprobado_en   timestamptz,
  actualizado_en timestamptz not null default clock_timestamp(),
  unique (empresa_id, clave)
);
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

-- Sin documento de origen, la clave es la referencia DEL PERÍODO: CRIPTO o
-- IMP-DIF se repiten mes a mes y cada mes es un asiento distinto.
drop function if exists public.contab_clave_borrador(text, uuid, text);
create or replace function public.contab_clave_borrador(p_origen_tabla text, p_origen_id uuid, p_referencia text, p_periodo text)
returns text language sql immutable as $$
  select coalesce(p_origen_tabla, 'modulo') || ':'
         || coalesce(p_origen_id::text, 'ref:' || coalesce(p_referencia, '') || '@' || coalesce(p_periodo, ''))
$$;

-- ── El guardián ───────────────────────────────────────────────────────────
create or replace function public.contab_asiento_revision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r asientos;
  k text;
  b contab_borradores;
begin
  if coalesce(current_setting('contab.aprobando', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  r := case when tg_op = 'DELETE' then old else new end;
  if not contab_va_a_revision(r.origen, r.origen_tabla) or not contab_es_resumen(r.empresa_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Un cambio que no toca ni las líneas ni la fecha (la descripción, por ejemplo) pasa.
  if tg_op = 'UPDATE' and new.lineas is not distinct from old.lineas and new.fecha is not distinct from old.fecha
     and new.periodo is not distinct from old.periodo and new.empresa_id = old.empresa_id then
    return new;
  end if;
  k := contab_clave_borrador(r.origen_tabla, r.origen_id, r.referencia, r.periodo);   -- el período ya lo puso trg_asiento_numero
  select * into b from contab_borradores where empresa_id = r.empresa_id and clave = k;

  if tg_op = 'DELETE' then
    -- El módulo reemplaza el asiento: ya dejó la propuesta nueva (después de
    -- que naciera este asiento). Se conserva el aprobado hasta aprobar la nueva.
    if b.id is not null and jsonb_array_length(b.propuesta) > 0 and b.actualizado_en > old.creado_en then
      return null;
    end if;
    insert into contab_borradores (empresa_id, clave, cuenta_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id,
                                   propuesta, asiento_id, pendiente)
    values (old.empresa_id, k, old.cuenta_id, old.fecha, old.periodo, old.descripcion, old.referencia, old.origen, old.origen_tabla, old.origen_id,
            '[]'::jsonb, old.id, true)
    on conflict (empresa_id, clave) do update
      set propuesta = '[]'::jsonb, asiento_id = old.id, pendiente = true,
          version = contab_borradores.version + 1, actualizado_en = clock_timestamp();
    return null;
  end if;

  -- Crear o cambiar: queda la propuesta. Si es igual a lo ya aprobado, no hay nada que aprobar.
  insert into contab_borradores (empresa_id, clave, cuenta_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id,
                                 propuesta, asiento_id, pendiente)
  values (new.empresa_id, k, new.cuenta_id, new.fecha, new.periodo, new.descripcion, new.referencia, new.origen, new.origen_tabla, new.origen_id,
          coalesce(new.lineas, '[]'::jsonb), case when tg_op = 'UPDATE' then old.id end, true)
  on conflict (empresa_id, clave) do update
    set cuenta_id = excluded.cuenta_id, fecha = excluded.fecha, periodo = excluded.periodo, descripcion = excluded.descripcion,
        referencia = excluded.referencia, origen = excluded.origen, origen_tabla = excluded.origen_tabla, origen_id = excluded.origen_id,
        propuesta = excluded.propuesta,
        asiento_id = coalesce(case when tg_op = 'UPDATE' then old.id end, contab_borradores.asiento_id),
        version = contab_borradores.version + 1, actualizado_en = clock_timestamp();
  select * into b from contab_borradores where empresa_id = new.empresa_id and clave = k;
  update contab_borradores
     set pendiente = not (b.asiento_id is not null
                          and b.propuesta = coalesce((select lineas from asientos where id = b.asiento_id), '[]'::jsonb)
                          and b.fecha is not distinct from (select fecha from asientos where id = b.asiento_id))
   where id = b.id;
  return null;
end $$;

-- Antes de numerar: lo detenido no gasta número. (El numerador va por orden de
-- nombre: «trg_asiento_numero» corre antes que «trg_asiento_revision»; da igual,
-- el número se calcula con max+1 y lo detenido no se inserta.)
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
  if b.periodo is not null and exists (select 1 from cierres_mensuales where empresa_id = b.empresa_id and periodo = b.periodo) then
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
    -- creado_en con la hora real (no la del inicio de la transacción): el guardián la
    -- compara con la de la última propuesta para saber si un borrado es un reemplazo.
    insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total, creado_en)
    values ((select cuenta_id from empresas where id = b.empresa_id), b.empresa_id, b.fecha, b.periodo, b.descripcion, b.referencia,
            b.origen, b.origen_tabla, b.origen_id, lin, tot, clock_timestamp())
    returning id, numero into aid, num;
  end if;
  perform set_config('contab.aprobando', 'off', true);

  update contab_borradores
     set asiento_id = aid, pendiente = false, aprobado = coalesce(lin, '[]'::jsonb),
         corregido = coalesce(lin, '[]'::jsonb) is distinct from contab_validar_lineas_o_vacio(b.empresa_id, b.propuesta),
         aprobado_por = coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', current_user),
         aprobado_en = now()
   where id = b.id;
  return jsonb_build_object('ok', true, 'asiento', num, 'borrado', lin is null);
end $$;
grant execute on function public.contab_aprobar_borrador(uuid, jsonb, int) to authenticated;

-- La propuesta normalizada (con el nombre de cada cuenta) para comparar con lo aprobado.
create or replace function public.contab_validar_lineas_o_vacio(p_empresa uuid, p_lineas jsonb)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then return '[]'::jsonb; end if;
  return contab_validar_lineas(p_empresa, p_lineas);
exception when others then
  return p_lineas;
end $$;

-- Descartar: se ignora lo que pidió el módulo; el asiento aprobado (si hay) queda como está.
create or replace function public.contab_descartar_borrador(p_borrador uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b contab_borradores;
begin
  select * into b from contab_borradores where id = p_borrador;
  if b.id is null then return jsonb_build_object('ok', false, 'motivo', 'No existe esa propuesta.'); end if;
  if not (public.soy_superadmin() or b.empresa_id in (select public.mis_empresas())) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;
  if b.asiento_id is null then
    delete from contab_borradores where id = b.id;
  else
    update contab_borradores
       set propuesta = coalesce((select lineas from asientos where id = b.asiento_id), '[]'::jsonb), pendiente = false,
           version = version + 1, actualizado_en = clock_timestamp()
     where id = b.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.contab_descartar_borrador(uuid) to authenticated;

-- Si el asiento aprobado se borra por otro camino (aprobando un reemplazo, o
-- deshaciendo), el borrador no apunta a un asiento que ya no existe.
create or replace function public.contab_borrador_sin_asiento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update contab_borradores set asiento_id = null where asiento_id = old.id;
  return old;
end $$;
drop trigger if exists trg_contab_borrador_sin_asiento on public.asientos;
create trigger trg_contab_borrador_sin_asiento after delete on public.asientos
  for each row execute function public.contab_borrador_sin_asiento();

-- Si el documento de un borrador todavía no aprobado desaparece (se borra la
-- declaración, se anula la baja), su propuesta ya no tiene sentido.
create or replace function public.contab_borrador_huerfano()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from contab_borradores
   where asiento_id is null and origen_id = old.id
     and origen_tabla in ('declaraciones', 'declaraciones_pago', 'activos_fijos');
  return old;
end $$;
drop trigger if exists trg_borrador_huerfano_decl on public.declaraciones;
create trigger trg_borrador_huerfano_decl after delete on public.declaraciones
  for each row execute function public.contab_borrador_huerfano();
drop trigger if exists trg_borrador_huerfano_af on public.activos_fijos;
create trigger trg_borrador_huerfano_af after delete on public.activos_fijos
  for each row execute function public.contab_borrador_huerfano();
drop trigger if exists trg_borrador_huerfano_af_baja on public.activos_fijos;
create trigger trg_borrador_huerfano_af_baja after update of fecha_baja on public.activos_fijos
  for each row when (new.fecha_baja is null) execute function public.contab_borrador_huerfano();

-- ── «Cerrar mes» no cierra con propuestas sin aprobar ─────────────────────
-- Se suman a lo que ya cuenta la versión del SQL 15.
-- (Re-ejecutable: la versión del SQL 15 se guarda una sola vez como _15. Si se
-- vuelve a correr el SQL 15, correr este después.)
do $$
begin
  if to_regprocedure('public.contab_filas_sin_asiento_15(uuid, text)') is null then
    alter function public.contab_filas_sin_asiento(uuid, text) rename to contab_filas_sin_asiento_15;
  end if;
end $$;
create or replace function public.contab_filas_sin_asiento(p_empresa uuid, p_periodo text)
returns integer language sql stable security invoker set search_path = public, pg_temp as $$
  select public.contab_filas_sin_asiento_15(p_empresa, p_periodo)
       + (select count(*)::int from contab_borradores where empresa_id = p_empresa and periodo = p_periodo and pendiente)
$$;
grant execute on function public.contab_filas_sin_asiento(uuid, text) to authenticated;

-- Comprobación
select (select count(*) from pg_trigger where tgname = 'trg_asiento_revision' and not tgisinternal) as guardian,
       (select count(*) from empresas where contab_resumen) as empresas_en_revision;
