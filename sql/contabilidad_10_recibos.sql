-- ============================================================
-- DigiAccount · Contabilidad 10: los recibos de venta los contabiliza la base
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _09. Re-ejecutable.
--
-- POR QUÉ (plan 4b, para empresas, PYME y emprendimientos): el asiento de cada
-- recibo de venta lo hacía el navegador al emitirlo. Si la página se cerraba a
-- mitad, o el recibo se editaba o anulaba después, el asiento quedaba mal o no
-- quedaba. Ahora lo hace la base, como el libro (plan 1):
--   · Solo en modo RECIBOS (empresas.fiscal_activo = false). En modo libro el
--     ingreso lo da el libro de ventas: se cuenta una sola vez (spec §4.1).
--   · FV y ND: Debe 1.1.2.01 total / Haber 4.1.1.01 subtotal, 2.1.3.01 IVA y
--     2.1.4.03 IGTF percibido. NC: lo inverso. Anulado: sin asiento.
--   · Los recibos que ya existían (ya contabilizados por el navegador) quedan
--     con contab_motor = false y el motor no los toca.
-- También: contab_tasa_bcv(fecha), la tasa USD del BCV vigente a una fecha,
-- que usan Tesorería y el diferencial cambiario (SQL 11 y 12).
-- Pruebas: sql/pruebas/contabilidad_10_pruebas.sql.
-- ============================================================

-- Los existentes quedan fuera del motor; los nuevos, dentro.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'facturas' and column_name = 'contab_motor') then
    alter table public.facturas add column contab_motor boolean not null default false;
    alter table public.facturas alter column contab_motor set default true;
  end if;
end $$;
comment on column public.facturas.contab_motor is
  'true = su asiento lo hace la base (sql/contabilidad_10); false = recibo anterior, contabilizado por el navegador';

-- La tasa USD del BCV vigente a una fecha (la última publicada hasta ese día).
create or replace function public.contab_tasa_bcv(p_fecha date)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select tasa from tasas_cambio
   where moneda = 'USD' and upper(coalesce(fuente, '')) = 'BCV' and fecha <= p_fecha
   order by fecha desc limit 1
$$;
grant execute on function public.contab_tasa_bcv(date) to authenticated;

create or replace function public.contab_lineas_recibo(f public.facturas)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  modo_libro boolean;
  nc boolean := upper(coalesce(f.tipo_doc, 'FV')) = 'NC';
  sub numeric := round(coalesce(f.subtotal, 0), 2);
  iva numeric := round(coalesce(f.iva, 0), 2);
  igtf numeric := round(coalesce(f.igtf_monto, 0), 2);
  tot numeric;
  lin jsonb := '[]'::jsonb;
  d boolean;   -- true = el renglón va al Debe
begin
  if not f.contab_motor or coalesce(f.tipo, 'venta') <> 'venta' then return null; end if;
  if coalesce(f.estado, '') ~* 'anulad' then return null; end if;
  select coalesce(fiscal_activo, true) into modo_libro from empresas where id = f.empresa_id;
  if modo_libro is not false then return null; end if;
  tot := sub + iva + igtf;
  if tot < 0.005 then return null; end if;
  -- CxC por la suma de sus partes: así el asiento cuadra aunque `total` traiga céntimos de redondeo.
  lin := lin || jsonb_build_object('cta', contab_cta('1.1.2.01', f.empresa_id), 'debe', case when nc then 0 else tot end, 'haber', case when nc then tot else 0 end);
  d := nc;
  lin := lin || jsonb_build_object('cta', contab_cta('4.1.1.01', f.empresa_id), 'debe', case when d then sub else 0 end, 'haber', case when d then 0 else sub end);
  if iva > 0.005 then
    lin := lin || jsonb_build_object('cta', contab_cta('2.1.3.01', f.empresa_id), 'debe', case when d then iva else 0 end, 'haber', case when d then 0 else iva end);
  end if;
  if igtf > 0.005 then
    lin := lin || jsonb_build_object('cta', contab_cta('2.1.4.03', f.empresa_id), 'debe', case when d then igtf else 0 end, 'haber', case when d then 0 else igtf end);
  end if;
  if nc then
    -- En la NC el orden de lectura es Debe primero: ventas e impuestos, luego CxC.
    lin := (select jsonb_agg(e order by (e->>'haber')::numeric > 0, n) from jsonb_array_elements(lin) with ordinality t(e, n));
  end if;
  return lin;
end $$;

create or replace function public.contab_sync_recibo()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f facturas;
  lin jsonb;
  tot numeric;
  dueña uuid;
begin
  if tg_op = 'DELETE' then
    delete from asientos where origen_tabla = 'facturas' and origen_id = old.id;
    return old;
  end if;
  f := new;
  lin := contab_lineas_recibo(f);
  if lin is null then
    delete from asientos where origen_tabla = 'facturas' and origen_id = f.id;
    return new;
  end if;
  select cuenta_id into dueña from empresas where id = f.empresa_id;
  select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into tot from jsonb_array_elements(lin) e;
  update asientos set empresa_id = f.empresa_id, fecha = to_char(contab_fecha_factura(f.fecha), 'DD/MM/YYYY'),
                      periodo = to_char(contab_fecha_factura(f.fecha), 'YYYY-MM'),
                      descripcion = case upper(coalesce(f.tipo_doc, 'FV')) when 'NC' then 'Nota de crédito ' when 'ND' then 'Nota de débito ' else 'Venta · recibo ' end
                                    || coalesce(f.numero, '') || ' · ' || coalesce(f.cliente_nombre, ''),
                      referencia = coalesce(f.numero, ''), lineas = lin, total = tot, origen = 'motor'
   where origen_tabla = 'facturas' and origen_id = f.id;
  if not found then
    insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
    values (coalesce(dueña, f.cuenta_id), f.empresa_id, to_char(contab_fecha_factura(f.fecha), 'DD/MM/YYYY'),
            to_char(contab_fecha_factura(f.fecha), 'YYYY-MM'),
            case upper(coalesce(f.tipo_doc, 'FV')) when 'NC' then 'Nota de crédito ' when 'ND' then 'Nota de débito ' else 'Venta · recibo ' end
              || coalesce(f.numero, '') || ' · ' || coalesce(f.cliente_nombre, ''),
            coalesce(f.numero, ''), 'motor', 'facturas', f.id, lin, tot);
  end if;
  return new;
end $$;

drop trigger if exists trg_contab_recibo on public.facturas;
create trigger trg_contab_recibo after insert or delete on public.facturas
  for each row execute function public.contab_sync_recibo();
drop trigger if exists trg_contab_recibo_upd on public.facturas;
create trigger trg_contab_recibo_upd after update of subtotal, iva, igtf_monto, total, estado, fecha, tipo_doc, tipo, empresa_id, contab_motor, numero, cliente_nombre
  on public.facturas for each row execute function public.contab_sync_recibo();

-- La app vieja (si alguien la tiene en caché) ya no duplica: sus asientos de
-- recibos, notas, cobros, pagos, IGTF y transferencias los hace ahora la base
-- (SQL 10 y 11). Se agregan a lo que contab_asiento_numero descarta.
create or replace function public.contab_asiento_numero()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.origen = 'auto' and (
       coalesce(new.descripcion, '') ~ '^(Compra s/factura |Venta s/libro|Reverso (compra|venta) s/factura|Anulación (compra|venta) N°)'
       or coalesce(new.descripcion, '') ~ '^(Venta s/(recibo|factura) |N[CD]-[0-9]+ sobre factura |Cobro recibo |Pago factura |IGTF 3% s/pago en divisas|Transferencia )'
       or coalesce(new.referencia, '') ~ '^L[VC]-[0-9]{2}/[0-9]{4}$'
       or (coalesce(new.referencia, '') ~ '^F30-' and new.numero is not null)) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('asientos:' || new.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into new.numero from asientos where empresa_id = new.empresa_id;
  if new.periodo is null then
    new.periodo := to_char(contab_fecha_factura(new.fecha), 'YYYY-MM');
  end if;
  return new;
end $$;

-- Comprobación
select (select count(*) from facturas where contab_motor) as recibos_en_el_motor,
       (select count(*) from facturas where not contab_motor) as recibos_anteriores,
       contab_tasa_bcv(current_date) as tasa_bcv_hoy;
