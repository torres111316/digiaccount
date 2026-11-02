-- ============================================================
-- DigiAccount · Contabilidad 04: el libro fiscal contabiliza solo, desde la base
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01, _02 y _03. Re-ejecutable.
-- Correrlo JUSTO ANTES de desplegar la versión de la app que deja de
-- contabilizar el libro en el navegador (v186 o posterior).
--
-- POR QUÉ: las cargas por Excel, Telegram o script guardaban las facturas en
-- libro_fiscal sin crear su asiento. Por eso GATMA y Radian no tienen
-- contabilidad de oct-2025 a jul-2026. Con este disparador, toda fila del
-- libro crea, actualiza o borra su asiento sin importar por dónde entró.
-- Pruebas: sql/pruebas/contabilidad_04_pruebas.sql.
--
--   · asientos.origen_tabla / origen_id: de qué fila salió el asiento, para
--     que nunca haya dos de la misma factura y editarla rehaga el suyo.
--   · asientos.periodo (aaaa-mm): el período contable del asiento.
--   · El número correlativo lo pone SIEMPRE la base, aunque el navegador
--     mande uno (la app vieja lo calculaba y chocaba). Es PROVISIONAL: al
--     cerrar el período se renumerará en orden de fecha (plan 6 del diseño).
--   · CONVIVENCIA CON LA APP VIEJA: una pestaña abierta con la versión
--     anterior seguiría mandando su propio asiento de cada factura, su
--     reverso al anular y los resumen LV/LC al cerrar el mes. Esos se
--     DESCARTAN al llegar, porque ya los hace este motor.
--   · Meses viejos contabilizados en resumen (LV-mm/aaaa y LC-mm/aaaa, Agüero
--     oct-25 a jun-26): no se toca nada, para no contar dos veces.
--   · Los 789 asientos sueltos que dejó el navegador antes del motor (origen
--     'auto', sin enlace): si una factura tiene UNO solo inequívoco (mismo
--     número y mismo tercero, sin reversos), editarla lo ADOPTA y anularla o
--     borrarla lo quita. Si hay dudas (dos asientos, un reverso viejo), el
--     motor no toca esa factura: queda para la reconstrucción del plan 6, que
--     Luis aprueba empresa por empresa.
-- ============================================================

alter table public.asientos add column if not exists origen_tabla text;
alter table public.asientos add column if not exists origen_id uuid;
alter table public.asientos add column if not exists periodo text;

create unique index if not exists asientos_origen_unico
  on public.asientos (origen_tabla, origen_id) where origen_id is not null;
create index if not exists asientos_empresa_periodo on public.asientos (empresa_id, periodo);
create index if not exists asientos_empresa_referencia on public.asientos (empresa_id, referencia);
create index if not exists asientos_empresa_numero on public.asientos (empresa_id, numero);

-- Antes de guardar CUALQUIER asiento: descarta los del libro que manda una
-- app vieja, y pone el número y el período. El candado por empresa evita que
-- dos inserciones a la vez tomen el mismo número (una carga de 300 facturas
-- de Telegram, o dos usuarios a la vez).
create or replace function public.contab_asiento_numero()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.origen = 'auto' and (
       coalesce(new.descripcion, '') ~ '^(Compra s/factura |Venta s/libro|Reverso (compra|venta) s/factura|Anulación (compra|venta) N°)'
       or coalesce(new.referencia, '') ~ '^L[VC]-[0-9]{2}/[0-9]{4}$') then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('asientos:' || new.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into new.numero from asientos where empresa_id = new.empresa_id;
  if new.periodo is null then
    new.periodo := to_char(contab_fecha_factura(new.fecha), 'YYYY-MM');
  end if;
  return new;
end $$;

drop trigger if exists trg_asiento_numero on public.asientos;
create trigger trg_asiento_numero before insert on public.asientos
  for each row execute function public.contab_asiento_numero();

-- El asiento suelto (de antes del motor) de una factura, solo si es UNO e
-- inequívoco: mismo número, mismo tipo, el tercero dentro de la descripción
-- y sin ningún reverso o anulación vieja con ese número. Devuelve:
--   'ninguno'  no hay asiento suelto
--   'unico'    hay uno (en p_id)
--   'ambiguo'  hay más de uno, o un reverso: no se toca
create or replace function public.contab_heredado(p_empresa uuid, p_tipo text, p_ref text, p_tercero text,
                                                  p_es_z boolean, out estado text, out p_id uuid)
language plpgsql stable set search_path = public, pg_temp as $$
declare n int;
begin
  estado := 'ninguno'; p_id := null;
  if p_es_z or coalesce(trim(p_ref), '') = '' then return; end if;
  if exists (select 1 from asientos
              where empresa_id = p_empresa and origen_id is null and referencia = p_ref
                and descripcion ~ '^(Reverso|Anulación) (compra|venta)') then
    estado := 'ambiguo'; return;
  end if;
  select count(*), min(id::text)::uuid into n, p_id from asientos
   where empresa_id = p_empresa and origen = 'auto' and origen_id is null and referencia = p_ref
     and descripcion like (case when p_tipo = 'venta' then 'Venta s/libro%' else 'Compra s/factura%' end)
     and (coalesce(trim(p_tercero), '') = '' or position(upper(trim(p_tercero)) in upper(descripcion)) > 0);
  if n = 0 then p_id := null; return; end if;
  if n > 1 then estado := 'ambiguo'; p_id := null; return; end if;
  estado := 'unico';
end $$;

create or replace function public.contab_sync_libro()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r libro_fiscal;
  lin jsonb;
  per text;
  ref text;
  ref_viejo text;
  descr text;
  fec text;
  tot numeric;
  es_z boolean;
  dueña uuid;
  h record;
begin
  if tg_op = 'DELETE' then
    delete from asientos where origen_tabla = 'libro_fiscal' and origen_id = old.id;
    if not found then
      h := contab_heredado(old.empresa_id, old.tipo, old.numero_factura, old.tercero_nombre, coalesce(trim(old.numero_zeta), '') <> '');
      if h.estado = 'unico' then delete from asientos where id = h.p_id; end if;
    end if;
    return old;
  end if;

  r := new;
  es_z := coalesce(trim(r.numero_zeta), '') <> '';
  ref := case when es_z then r.numero_zeta else coalesce(r.numero_factura, '') end;
  ref_viejo := case when tg_op = 'UPDATE' and coalesce(trim(old.numero_zeta), '') = '' then old.numero_factura end;
  lin := contab_lineas_libro(r);

  if lin is null then
    delete from asientos where origen_tabla = 'libro_fiscal' and origen_id = r.id;
    if not found then
      -- Anular una factura de antes del motor: se quita su asiento suelto (el
      -- tercero que se compara es el de antes de anular: ahora dice ANULADA).
      h := contab_heredado(r.empresa_id, r.tipo, coalesce(ref_viejo, ref),
                           case when tg_op = 'UPDATE' then old.tercero_nombre else r.tercero_nombre end, es_z);
      if h.estado = 'unico' then delete from asientos where id = h.p_id; end if;
    end if;
    return new;
  end if;

  per := contab_periodo_de(r.fecha, r.periodo);
  if per is not null and exists (
       select 1 from asientos
        where empresa_id = r.empresa_id
          and referencia = (case when r.tipo = 'venta' then 'LV-' else 'LC-' end) || substr(per, 6, 2) || '/' || substr(per, 1, 4)) then
    return new;
  end if;

  descr := case
    when upper(trim(coalesce(r.tipo_doc, ''))) = 'NC' then 'Nota de crédito · ' || ref || ' · ' || coalesce(r.tercero_nombre, '')
    when es_z then 'Venta · reporte Z ' || ref || ' · máquina ' || coalesce(nullif(trim(r.maquina_fiscal), ''), 'fiscal')
    when r.tipo = 'venta' then 'Venta · factura ' || ref || ' · ' || coalesce(r.tercero_nombre, '')
    else 'Compra · factura ' || ref || ' · ' || coalesce(r.tercero_nombre, '')
  end;
  fec := contab_fecha_asiento(r.fecha, per, r.creado_en);
  select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into tot from jsonb_array_elements(lin) e;
  -- El asiento es de la cuenta DUEÑA de la empresa, no del cuenta_id que traiga la fila.
  select cuenta_id into dueña from empresas where id = r.empresa_id;

  update asientos
     set fecha = fec, periodo = per, descripcion = descr, referencia = ref, lineas = lin, total = tot, origen = 'motor'
   where origen_tabla = 'libro_fiscal' and origen_id = r.id;
  if found then return new; end if;

  -- ¿Tiene un asiento suelto de antes del motor? Primero por su número
  -- actual; si se corrigió el número, por el de antes.
  h := contab_heredado(r.empresa_id, r.tipo, ref, r.tercero_nombre, es_z);
  if h.estado = 'ninguno' and ref_viejo is not null and ref_viejo is distinct from ref then
    h := contab_heredado(r.empresa_id, r.tipo, ref_viejo,
                         case when tg_op = 'UPDATE' then old.tercero_nombre else r.tercero_nombre end, es_z);
  end if;
  if h.estado = 'ambiguo' then
    return new;   -- dudoso: lo resuelve la reconstrucción (plan 6), no el motor
  end if;
  if h.estado = 'unico' then
    update asientos
       set origen_tabla = 'libro_fiscal', origen_id = r.id, origen = 'motor',
           fecha = fec, periodo = per, descripcion = descr, referencia = ref, lineas = lin, total = tot
     where id = h.p_id and origen_id is null;
    if found then return new; end if;
  end if;

  insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
  values (coalesce(dueña, r.cuenta_id), r.empresa_id, fec, per, descr, ref, 'motor', 'libro_fiscal', r.id, lin, tot);
  return new;
end $$;

drop trigger if exists trg_contab_libro on public.libro_fiscal;
create trigger trg_contab_libro after insert or update or delete on public.libro_fiscal
  for each row execute function public.contab_sync_libro();

-- Cuántas filas del libro de un período tienen monto y NO tienen asiento (ni
-- propio, ni resumen LV/LC del mes, ni uno suelto de antes del motor). «Cerrar
-- mes» se niega a cerrar si hay alguna: son meses cargados antes del motor,
-- que primero se reconstruyen. security invoker: las reglas RLS deciden qué
-- empresa puede consultar cada quien.
create or replace function public.contab_filas_sin_asiento(p_empresa uuid, p_periodo text)
returns integer language sql stable security invoker set search_path = public, pg_temp as $$
  select count(*)::int
    from libro_fiscal l
   where l.empresa_id = p_empresa
     and public.contab_periodo_de(l.fecha, l.periodo) = p_periodo
     and public.contab_lineas_libro(l) is not null
     and not exists (select 1 from asientos a where a.origen_tabla = 'libro_fiscal' and a.origen_id = l.id)
     and not exists (select 1 from asientos a where a.empresa_id = l.empresa_id
                        and a.referencia = (case when l.tipo = 'venta' then 'LV-' else 'LC-' end)
                                           || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4))
     and (public.contab_heredado(l.empresa_id, l.tipo,
            case when coalesce(trim(l.numero_zeta), '') <> '' then l.numero_zeta else l.numero_factura end,
            l.tercero_nombre, coalesce(trim(l.numero_zeta), '') <> '')).estado = 'ninguno'
$$;
grant execute on function public.contab_filas_sin_asiento(uuid, text) to authenticated;

-- Los asientos que ya existían no tenían período: se completa desde su fecha.
update public.asientos
   set periodo = to_char(public.contab_fecha_factura(fecha), 'YYYY-MM')
 where periodo is null and public.contab_fecha_factura(fecha) is not null;

-- Comprobación: 2 (los dos disparadores).
select count(*) as disparadores from pg_trigger
 where tgname in ('trg_contab_libro', 'trg_asiento_numero') and not tgisinternal;
