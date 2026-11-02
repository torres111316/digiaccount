-- ============================================================
-- DigiAccount · Contabilidad 05: cada retención contabiliza sola, desde la base
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _04. Re-ejecutable.
--
-- POR QUÉ: las 382 retenciones registradas (IVA e ISLR, practicadas y
-- sufridas) no tenían ningún asiento. El módulo de retenciones nunca
-- contabilizó, y «Cerrar mes» solo armaba un asiento provisional por mes con
-- las sufridas de IVA (RIVA-mm/aaaa). Ahora cada comprobante tiene el suyo,
-- entre por donde entre (pantalla, quincena, script).
-- Pruebas: sql/pruebas/contabilidad_05_pruebas.sql.
--
-- Asientos (docs/superpowers/specs/2026-11-02-contabilidad-design.md §5):
--   · IVA practicada  (la empresa le retiene al proveedor):
--       Debe CxP (2.1.1.01) / Haber Retenciones IVA por pagar (2.1.3.02)
--   · ISLR practicada: Debe CxP / Haber Retenciones ISLR por pagar (2.1.3.03)
--   · IVA sufrida     (el cliente le retiene a la empresa):
--       Debe Retenciones IVA soportadas (1.1.3.03) / Haber CxC (1.1.2.01)
--   · ISLR sufrida:    Debe ISLR retenido por terceros (1.1.3.02) / Haber CxC
--   · Anulada o en cero: sin asiento.
--   · Meses contabilizados en RESUMEN (LV/LC de Agüero, oct-25 a jun-26):
--     allí el cobro y el pago se presumieron por Bancos, así que sus
--     retenciones no llevan asiento aquí. O ya están dentro del LV (si trae la
--     línea 1.1.3.03) o quedan pendientes para la reconstrucción (plan 6), y
--     «Cerrar mes» las cuenta como pendientes. Ver contab_ret_en_resumen.
--   · Solo las columnas que cambian el asiento disparan el motor: los scripts
--     que reescriben la quincena o el RIF no contabilizan retenciones viejas.
--   · Además descarta la liquidación (F30) que mande una pestaña con la app
--     vieja (v184), que contaría dos veces.
--   · Fecha y período con la misma regla que las facturas (§4.3).
-- ============================================================

create or replace function public.contab_lineas_retencion(r public.retenciones)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  m numeric := round(abs(coalesce(r.monto, 0)), 2);
  dir text := lower(coalesce(r.direccion, ''));
  imp text := lower(coalesce(r.tipo, ''));
  pas text;
begin
  if coalesce(r.estado, '') ~* 'anulad' or m < 0.005 then return null; end if;
  if dir like 'practicada%' then
    pas := case when imp = 'islr' then '2.1.3.03' else '2.1.3.02' end;
    return jsonb_build_array(
      jsonb_build_object('cta', contab_cta('2.1.1.01', r.empresa_id), 'debe', m, 'haber', 0),
      jsonb_build_object('cta', contab_cta(pas, r.empresa_id), 'debe', 0, 'haber', m));
  elsif dir like 'sufrida%' then
    return jsonb_build_array(
      jsonb_build_object('cta', contab_cta(case when imp = 'islr' then '1.1.3.02' else '1.1.3.03' end, r.empresa_id), 'debe', m, 'haber', 0),
      jsonb_build_object('cta', contab_cta('1.1.2.01', r.empresa_id), 'debe', 0, 'haber', m));
  end if;
  return null;
end $$;

-- ¿Qué pasa con una retención de un mes contabilizado en RESUMEN (los LV/LC
-- de Agüero, oct-25 a jun-26, o un RIVA provisional)? En esos meses el cobro y
-- el pago se presumieron por Bancos, no por CxC/CxP, así que una retención no
-- puede rebajar una CxC/CxP que allí no existe:
--   'cubierta'   ya está dentro: sufrida de IVA en un mes RIVA, o en un mes
--                cuyo LV TRAE la línea 1.1.3.03 (en Agüero, dic-25 y ene-26
--                no la traen: las retenciones se cargaron después del resumen)
--   'pendiente'  no lleva asiento aquí; la contabiliza la reconstrucción (plan 6)
--   'normal'     mes contabilizado factura por factura: lleva su asiento
create or replace function public.contab_ret_en_resumen(r public.retenciones)
returns text language plpgsql stable set search_path = public, pg_temp as $$
declare
  per text := contab_periodo_de(r.fecha, r.periodo);
  mm text;
  suf boolean := lower(coalesce(r.direccion, '')) like 'sufrida%';
  iva boolean := lower(coalesce(r.tipo, '')) = 'iva';
begin
  if per is null then return 'normal'; end if;
  mm := substr(per, 6, 2) || '/' || substr(per, 1, 4);
  if suf then
    if iva and exists (select 1 from asientos where empresa_id = r.empresa_id and referencia = 'RIVA-' || mm) then
      return 'cubierta';
    end if;
    if exists (select 1 from asientos where empresa_id = r.empresa_id and referencia = 'LV-' || mm) then
      if iva and exists (select 1 from asientos a, jsonb_array_elements(a.lineas) e
                          where a.empresa_id = r.empresa_id and a.referencia = 'LV-' || mm
                            and e->>'cta' like '1.1.3.03%' and coalesce((e->>'debe')::numeric, 0) > 0) then
        return 'cubierta';
      end if;
      return 'pendiente';
    end if;
  elsif exists (select 1 from asientos where empresa_id = r.empresa_id and referencia = 'LC-' || mm) then
    return 'pendiente';
  end if;
  return 'normal';
end $$;

create or replace function public.contab_sync_retencion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r retenciones;
  lin jsonb;
  per text;
  descr text;
  fec text;
  tot numeric;
  dueña uuid;
begin
  if tg_op = 'DELETE' then
    delete from asientos where origen_tabla = 'retenciones' and origen_id = old.id;
    return old;
  end if;

  r := new;
  lin := contab_lineas_retencion(r);
  per := contab_periodo_de(r.fecha, r.periodo);
  if lin is not null and contab_ret_en_resumen(r) <> 'normal' then
    lin := null;   -- mes en resumen: ya está dentro, o la contabiliza la reconstrucción
  end if;

  if lin is null then
    delete from asientos where origen_tabla = 'retenciones' and origen_id = r.id;
    return new;
  end if;

  descr := 'Retención ' || upper(coalesce(r.tipo, '')) || ' ' || lower(split_part(coalesce(r.direccion, ''), ' ', 1))
        || ' · comp. ' || coalesce(r.comprobante, '') || ' · factura ' || coalesce(r.factura, '')
        || ' · ' || coalesce(r.tercero_nombre, '');
  fec := contab_fecha_asiento(r.fecha, per, r.creado_en);
  select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into tot from jsonb_array_elements(lin) e;
  select cuenta_id into dueña from empresas where id = r.empresa_id;

  update asientos
     set fecha = fec, periodo = per, descripcion = descr, referencia = coalesce(r.comprobante, ''), lineas = lin, total = tot, origen = 'motor'
   where origen_tabla = 'retenciones' and origen_id = r.id;
  if found then return new; end if;

  insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
  values (coalesce(dueña, r.cuenta_id), r.empresa_id, fec, per, descr, coalesce(r.comprobante, ''), 'motor', 'retenciones', r.id, lin, tot);
  return new;
end $$;

-- Solo las columnas que cambian el asiento: los scripts de rutina que
-- reescriben la quincena o el RIF (quincena_retenciones.py,
-- terceros_duplicados.py) no deben contabilizar de a poco las 382
-- retenciones viejas; esas las hace la reconstrucción, con aprobación.
drop trigger if exists trg_contab_retencion on public.retenciones;
create trigger trg_contab_retencion
  after insert or delete
     or update of monto, estado, direccion, tipo, fecha, periodo, comprobante, factura, tercero_nombre, empresa_id
  on public.retenciones
  for each row execute function public.contab_sync_retencion();

-- Una pestaña con la app VIEJA (v184) que cierra un mes manda su liquidación
-- (F30) con número propio y calculada con la lógica anterior, que suma otra
-- vez el crédito y las retenciones del mes. Se descarta al llegar; la app
-- nueva no manda número. Reemplaza la versión de contabilidad_04 agregando
-- solo esa condición.
create or replace function public.contab_asiento_numero()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.origen = 'auto' and (
       coalesce(new.descripcion, '') ~ '^(Compra s/factura |Venta s/libro|Reverso (compra|venta) s/factura|Anulación (compra|venta) N°)'
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

-- «Cerrar mes» no cierra un período con facturas O retenciones sin asiento
-- (las cargadas antes de los motores; se reconstruyen en el plan 6). Se
-- reemplaza la versión de contabilidad_04, que solo miraba las facturas.
create or replace function public.contab_filas_sin_asiento(p_empresa uuid, p_periodo text)
returns integer language sql stable security invoker set search_path = public, pg_temp as $$
  select (
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
  ) + (
    select count(*)::int
      from retenciones t
     where t.empresa_id = p_empresa
       and public.contab_periodo_de(t.fecha, t.periodo) = p_periodo
       and public.contab_lineas_retencion(t) is not null
       and not exists (select 1 from asientos a where a.origen_tabla = 'retenciones' and a.origen_id = t.id)
       and public.contab_ret_en_resumen(t) <> 'cubierta'
  )
$$;
grant execute on function public.contab_filas_sin_asiento(uuid, text) to authenticated;

-- Comprobación: 1 (el disparador).
select count(*) as disparadores from pg_trigger where tgname = 'trg_contab_retencion' and not tgisinternal;
