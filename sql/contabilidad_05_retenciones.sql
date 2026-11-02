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
--   · Las sufridas de IVA de un mes que ya está en un resumen LV (Agüero
--     oct-25 a jun-26) o en un RIVA provisional no se vuelven a contar: ya
--     están adentro. Las de ISLR sí, porque esos asientos no las traían.
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
  mmaaaa text;
begin
  if tg_op = 'DELETE' then
    delete from asientos where origen_tabla = 'retenciones' and origen_id = old.id;
    return old;
  end if;

  r := new;
  lin := contab_lineas_retencion(r);
  per := contab_periodo_de(r.fecha, r.periodo);

  -- Sufridas de IVA de un mes que ya las trae en un resumen viejo.
  if lin is not null and lower(coalesce(r.tipo, '')) = 'iva' and lower(coalesce(r.direccion, '')) like 'sufrida%' and per is not null then
    mmaaaa := substr(per, 6, 2) || '/' || substr(per, 1, 4);
    if exists (select 1 from asientos where empresa_id = r.empresa_id
                 and referencia in ('LV-' || mmaaaa, 'RIVA-' || mmaaaa)) then
      lin := null;
    end if;
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

drop trigger if exists trg_contab_retencion on public.retenciones;
create trigger trg_contab_retencion after insert or update or delete on public.retenciones
  for each row execute function public.contab_sync_retencion();

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
       and not (lower(coalesce(t.tipo, '')) = 'iva' and lower(coalesce(t.direccion, '')) like 'sufrida%'
                and exists (select 1 from asientos a where a.empresa_id = t.empresa_id
                               and a.referencia in ('LV-' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4),
                                                    'RIVA-' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4))))
  )
$$;
grant execute on function public.contab_filas_sin_asiento(uuid, text) to authenticated;

-- Comprobación: 1 (el disparador).
select count(*) as disparadores from pg_trigger where tgname = 'trg_contab_retencion' and not tgisinternal;
