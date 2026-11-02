-- ============================================================
-- DigiAccount · Contabilidad 04: el libro fiscal contabiliza solo, desde la base
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01, _02 y _03. Re-ejecutable.
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
--   · El número correlativo lo pone la base (antes el navegador, y podía
--     chocar). Es PROVISIONAL: al cerrar el período se renumerará en orden de
--     fecha (plan 6 del diseño).
--   · Meses viejos contabilizados en resumen (asientos LV-mm/aaaa y
--     LC-mm/aaaa, Agüero oct-25 a jun-26): no se toca nada, para no contar
--     dos veces. Los reemplaza la reconstrucción, con aprobación de Luis.
--   · Asientos sueltos que dejó el navegador (origen 'auto', sin enlace): al
--     editar su factura se ADOPTAN en vez de crear uno nuevo.
-- ============================================================

alter table public.asientos add column if not exists origen_tabla text;
alter table public.asientos add column if not exists origen_id uuid;
alter table public.asientos add column if not exists periodo text;

create unique index if not exists asientos_origen_unico
  on public.asientos (origen_tabla, origen_id) where origen_id is not null;
create index if not exists asientos_empresa_periodo on public.asientos (empresa_id, periodo);
create index if not exists asientos_empresa_referencia on public.asientos (empresa_id, referencia);

-- Número y período de cualquier asiento que llegue sin ellos. El candado
-- por empresa evita que dos inserciones a la vez tomen el mismo número
-- (una carga de 300 facturas de Telegram, o dos usuarios a la vez).
create or replace function public.contab_asiento_numero()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext('asientos:' || new.empresa_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from asientos where empresa_id = new.empresa_id;
  end if;
  if new.periodo is null then
    new.periodo := to_char(contab_fecha_factura(new.fecha), 'YYYY-MM');
  end if;
  return new;
end $$;

drop trigger if exists trg_asiento_numero on public.asientos;
create trigger trg_asiento_numero before insert on public.asientos
  for each row execute function public.contab_asiento_numero();

create or replace function public.contab_sync_libro()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r libro_fiscal;
  lin jsonb;
  per text;
  ref text;
  descr text;
  fec text;
  tot numeric;
  es_z boolean;
  heredado uuid;
begin
  if tg_op = 'DELETE' then
    delete from asientos where origen_tabla = 'libro_fiscal' and origen_id = old.id;
    return old;
  end if;

  r := new;
  lin := contab_lineas_libro(r);
  if lin is null then
    delete from asientos where origen_tabla = 'libro_fiscal' and origen_id = r.id;
    return new;
  end if;

  per := contab_periodo_de(r.fecha, r.periodo);
  if per is not null and exists (
       select 1 from asientos
        where empresa_id = r.empresa_id
          and referencia = (case when r.tipo = 'venta' then 'LV-' else 'LC-' end) || substr(per, 6, 2) || '/' || substr(per, 1, 4)) then
    return new;
  end if;

  es_z := coalesce(trim(r.numero_zeta), '') <> '';
  ref := case when es_z then r.numero_zeta else coalesce(r.numero_factura, '') end;
  descr := case
    when upper(trim(coalesce(r.tipo_doc, ''))) = 'NC' then 'Nota de crédito · ' || ref || ' · ' || coalesce(r.tercero_nombre, '')
    when es_z then 'Venta · reporte Z ' || ref || ' · máquina ' || coalesce(nullif(trim(r.maquina_fiscal), ''), 'fiscal')
    when r.tipo = 'venta' then 'Venta · factura ' || ref || ' · ' || coalesce(r.tercero_nombre, '')
    else 'Compra · factura ' || ref || ' · ' || coalesce(r.tercero_nombre, '')
  end;
  fec := contab_fecha_asiento(r.fecha, per, r.creado_en);
  select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into tot from jsonb_array_elements(lin) e;

  update asientos
     set fecha = fec, periodo = per, descripcion = descr, referencia = ref, lineas = lin, total = tot, origen = 'motor'
   where origen_tabla = 'libro_fiscal' and origen_id = r.id;
  if found then return new; end if;

  select id into heredado from asientos
   where empresa_id = r.empresa_id and origen = 'auto' and origen_id is null
     and referencia = ref
     and descripcion like (case when r.tipo = 'venta' then 'Venta s/libro%' else 'Compra s/factura%' end)
   order by creado_en limit 1;
  if heredado is not null then
    update asientos
       set origen_tabla = 'libro_fiscal', origen_id = r.id, origen = 'motor',
           fecha = fec, periodo = per, descripcion = descr, referencia = ref, lineas = lin, total = tot
     where id = heredado;
    return new;
  end if;

  insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
  values (r.cuenta_id, r.empresa_id, fec, per, descr, ref, 'motor', 'libro_fiscal', r.id, lin, tot);
  return new;
end $$;

drop trigger if exists trg_contab_libro on public.libro_fiscal;
create trigger trg_contab_libro after insert or update or delete on public.libro_fiscal
  for each row execute function public.contab_sync_libro();

-- Los asientos que ya existían no tenían período: se completa desde su fecha.
update public.asientos
   set periodo = to_char(public.contab_fecha_factura(fecha), 'YYYY-MM')
 where periodo is null and public.contab_fecha_factura(fecha) is not null;

-- Comprobación: 2 (los dos disparadores).
select count(*) as disparadores from pg_trigger
 where tgname in ('trg_contab_libro', 'trg_asiento_numero') and not tgisinternal;
