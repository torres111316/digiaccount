-- ============================================================
-- DigiAccount · Contabilidad 11: Tesorería en la base
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _10. Re-ejecutable.
--
-- POR QUÉ (plan 4b, para empresas, PYME y emprendimientos): cada cobro, pago,
-- IGTF y transferencia de Tesorería lo contabilizaba el navegador, siempre
-- contra «Bancos» o «Caja» en general, y un movimiento sin factura quedaba sin
-- asiento. Ahora lo hace la base, en la SUBCUENTA del banco (SQL 08):
--   · Con documento (factura_ref): un ingreso cobra un recibo (facturas) o una
--     venta del libro; un egreso paga una compra del libro.
--       - Documento en bolívares: se aplica hasta lo que le falta; el exceso va
--         a anticipos (2.1.6.01 de clientes / 1.1.2.04 a proveedores).
--       - Documento en dólares: se aplica en DÓLARES hasta lo que le falta; la
--         CxC o CxP se cancela a la tasa del documento y la diferencia con la
--         tasa del día va a 4.2.2.01 ganancia / 6.3.1.03 pérdida en cambio.
--       «Lo que le falta» descuenta los cobros o pagos anteriores (por fecha y
--       hora de registro), también los que se registraron antes del motor.
--   · Sin documento: contra cuenta_contra (la pide la pantalla). Sin cuenta no
--     hay asiento y cuenta en contab_filas_sin_asiento («Cerrar mes» lo dice).
--   · Transferencia (referencia TRF-… con su par de tipo contrario): el asiento
--     lo hace el egreso; el ingreso no repite.
--   · Una cuenta en dólares: el monto está en dólares; el asiento va en
--     bolívares a la tasa BCV del día (contab_tasa_bcv, SQL 10) y la línea del
--     banco guarda además `usd`. Sin tasa, no hay asiento (no se inventa).
--   · Los movimientos que ya existían quedan con contab_motor = false: ya los
--     contabilizó el navegador y el motor no los toca.
--   · Conciliación (SQL 08): una línea «registrado» enlazada a un movimiento
--     del motor (movimiento_id) no hace asiento: ya está en la subcuenta.
-- Pruebas: sql/pruebas/contabilidad_11_pruebas.sql (y las de dólares, en la 12).
-- ============================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'movimientos_tesoreria' and column_name = 'contab_motor') then
    alter table public.movimientos_tesoreria add column contab_motor boolean not null default false;
    alter table public.movimientos_tesoreria alter column contab_motor set default true;
  end if;
end $$;
alter table public.movimientos_tesoreria add column if not exists cuenta_contra text;
comment on column public.movimientos_tesoreria.cuenta_contra is
  'Cuenta del plan de la contrapartida de un movimiento sin documento (luz, alquiler, IGTF 6.3.1.04…)';
alter table public.extracto_bancario add column if not exists movimiento_id uuid references public.movimientos_tesoreria(id) on delete set null;

-- ¿Es la cuenta en dólares?
create or replace function public.contab_es_divisa(p_moneda text)
returns boolean language sql immutable as $$
  select coalesce(nullif(trim(p_moneda), ''), 'Bs') !~* '^\s*(bs|ves|bol)'
$$;

-- El documento de un movimiento (recibo, venta o compra del libro).
create or replace function public.contab_doc_de_movimiento(m public.movimientos_tesoreria,
  out tabla text, out id uuid, out total_bs numeric, out total_usd numeric, out tasa numeric)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  ref text := upper(trim(coalesce(m.factura_ref, '')));
  f facturas;
  l libro_fiscal;
begin
  if ref = '' then return; end if;
  if m.tipo = 'ingreso' then
    select * into f from facturas x
     where x.empresa_id = m.empresa_id and coalesce(x.tipo, 'venta') = 'venta' and upper(coalesce(x.tipo_doc, 'FV')) <> 'NC'
       and upper(trim(coalesce(x.numero, ''))) = ref and coalesce(x.estado, '') !~* 'anulad'
     order by (coalesce(trim(m.tercero_nombre), '') <> '' and upper(trim(x.cliente_nombre)) = upper(trim(m.tercero_nombre))) desc
     limit 1;
    if found then
      tabla := 'facturas'; id := f.id;
      total_bs := round(coalesce(f.subtotal, 0) + coalesce(f.iva, 0) + coalesce(f.igtf_monto, 0), 2);
      if upper(coalesce(f.moneda, 'BS')) = 'USD' and coalesce(f.total_usd, 0) > 0 and coalesce(f.tasa, 0) > 0 then
        total_usd := f.total_usd; tasa := f.tasa;
      end if;
      return;
    end if;
  end if;
  select * into l from libro_fiscal x
   where x.empresa_id = m.empresa_id and x.tipo = case when m.tipo = 'ingreso' then 'venta' else 'compra' end
     and upper(trim(coalesce(x.numero_factura, ''))) = ref and coalesce(x.tercero_nombre, '') !~* 'anulad'
   order by (coalesce(trim(m.tercero_rif), '') <> '' and upper(regexp_replace(coalesce(x.tercero_rif, ''), '[\s.\-]', '', 'g')) = upper(regexp_replace(m.tercero_rif, '[\s.\-]', '', 'g'))) desc,
            (coalesce(trim(m.tercero_nombre), '') <> '' and upper(trim(x.tercero_nombre)) = upper(trim(m.tercero_nombre))) desc
   limit 1;
  if found then
    tabla := 'libro_fiscal'; id := l.id;
    total_bs := round(coalesce(l.base, 0) + coalesce(l.exento, 0) + greatest(coalesce(l.iva, 0), 0)
                      + case when l.tipo = 'venta' then greatest(coalesce(l.igtf, 0), 0) else 0 end, 2);
    if upper(coalesce(l.moneda, 'BS')) = 'USD' and coalesce(l.total_usd, 0) > 0 and coalesce(l.tasa, 0) > 0 then
      total_usd := l.total_usd; tasa := l.tasa;
    end if;
  end if;
end $$;

-- Bolívares y dólares de un movimiento (null si hace falta la tasa y no hay).
create or replace function public.contab_montos_movimiento(m public.movimientos_tesoreria, out bs numeric, out usd numeric, out tasa_dia numeric)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  divisa boolean;
begin
  select contab_es_divisa(moneda) into divisa from cuentas_tesoreria where id = m.cuenta_teso_id;
  tasa_dia := contab_tasa_bcv(contab_fecha_factura(m.fecha));
  if coalesce(divisa, false) then
    usd := round(coalesce(m.monto, 0), 2);
    bs := case when tasa_dia > 0 then round(coalesce(m.monto, 0) * tasa_dia, 2) end;
  else
    bs := round(coalesce(m.monto, 0), 2);
    usd := case when tasa_dia > 0 then coalesce(m.monto, 0) / tasa_dia end;
  end if;
end $$;

-- Cuánto de un cobro o pago se aplica al documento, cuánto sobra (anticipo) y
-- el diferencial cambiario. Acumulativo: con lo aplicado antes, nunca se
-- cancela más que el documento, y el último cobro cuadra con su total en Bs.
create or replace function public.contab_aplicar(p_total_bs numeric, p_total_usd numeric, p_tasa_doc numeric,
  p_previo_bs numeric, p_previo_usd numeric, p_bs numeric, p_usd numeric,
  out aplicado_bs numeric, out exceso_bs numeric, out dif_bs numeric)
language plpgsql immutable as $$
declare
  ap_usd numeric;
  cum0 numeric; cum1 numeric;
  bs_ap numeric;
begin
  if coalesce(p_total_usd, 0) > 0 and coalesce(p_tasa_doc, 0) > 0 then
    ap_usd := least(coalesce(p_usd, 0), greatest(0, p_total_usd - coalesce(p_previo_usd, 0)));
    cum0 := case when coalesce(p_previo_usd, 0) >= p_total_usd then p_total_bs else round(least(coalesce(p_previo_usd, 0), p_total_usd) * p_tasa_doc, 2) end;
    cum1 := case when coalesce(p_previo_usd, 0) + ap_usd >= p_total_usd - 0.000001 then p_total_bs else round((coalesce(p_previo_usd, 0) + ap_usd) * p_tasa_doc, 2) end;
    aplicado_bs := round(cum1 - cum0, 2);
    bs_ap := case when coalesce(p_usd, 0) > 0 then round(p_bs * ap_usd / p_usd, 2) else 0 end;
    exceso_bs := round(p_bs - bs_ap, 2);
    dif_bs := round(bs_ap - aplicado_bs, 2);
  else
    aplicado_bs := least(round(coalesce(p_bs, 0), 2), greatest(0, round(coalesce(p_total_bs, 0) - coalesce(p_previo_bs, 0), 2)));
    exceso_bs := round(coalesce(p_bs, 0) - aplicado_bs, 2);
    dif_bs := 0;
  end if;
end $$;

-- ¿Es la punta de ingreso de una transferencia? (esa no hace asiento)
create or replace function public.contab_mov_par(m public.movimientos_tesoreria)
returns public.movimientos_tesoreria language sql stable set search_path = public, pg_temp as $$
  select p from movimientos_tesoreria p
   where coalesce(m.referencia, '') ~ '^TRF-' and p.empresa_id = m.empresa_id and p.id <> m.id
     and p.referencia = m.referencia and p.tipo <> m.tipo
   order by p.creado_en limit 1
$$;

create or replace function public.contab_lineas_movimiento(m public.movimientos_tesoreria)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  banco text;
  mm record;
  doc record;
  prev_bs numeric := 0;
  prev_usd numeric := 0;
  a record;
  par movimientos_tesoreria;
  contra text;
  lin jsonb := '[]'::jsonb;
  linea_banco jsonb;
  divisa boolean;
  divisa_par boolean;
  ing boolean := m.tipo = 'ingreso';
begin
  if not m.contab_motor or coalesce(m.monto, 0) <= 0 then return null; end if;
  select cuenta_contable, contab_es_divisa(moneda) into banco, divisa from cuentas_tesoreria where id = m.cuenta_teso_id and empresa_id = m.empresa_id;
  if coalesce(banco, '') = '' or contab_fecha_factura(m.fecha) is null then return null; end if;
  select * into mm from contab_montos_movimiento(m);
  if mm.bs is null then return null; end if;   -- cuenta en dólares sin tasa: no se inventa
  linea_banco := jsonb_build_object('cta', contab_cta(banco, m.empresa_id), 'debe', case when ing then mm.bs else 0 end, 'haber', case when ing then 0 else mm.bs end)
                 || case when divisa then jsonb_build_object('usd', round(coalesce(m.monto, 0), 2)) else '{}'::jsonb end;

  -- Transferencia entre cuentas propias.
  par := contab_mov_par(m);
  if par.id is not null then
    if ing then return null; end if;   -- el asiento lo hace el egreso
    select cuenta_contable, contab_es_divisa(moneda) into contra, divisa_par from cuentas_tesoreria where id = par.cuenta_teso_id and empresa_id = m.empresa_id;
    if coalesce(contra, '') = '' or contra = banco then return null; end if;
    -- El destino en dólares guarda SUS dólares (los del ingreso): sin ellos, la
    -- revaluación no sabría cuántos dólares entraron.
    return jsonb_build_array(jsonb_build_object('cta', contab_cta(contra, m.empresa_id), 'debe', mm.bs, 'haber', 0)
                               || case when divisa_par then jsonb_build_object('usd', round(coalesce(par.monto, 0), 2)) else '{}'::jsonb end,
                             linea_banco);
  end if;
  if coalesce(m.referencia, '') ~ '^TRF-' and coalesce(trim(m.cuenta_contra), '') = '' then return null; end if;   -- media transferencia

  select * into doc from contab_doc_de_movimiento(m);
  if doc.id is null then
    contra := nullif(trim(coalesce(m.cuenta_contra, '')), '');
    if contra is null then return null; end if;
    if ing then return jsonb_build_array(linea_banco, jsonb_build_object('cta', contab_cta(contra, m.empresa_id), 'debe', 0, 'haber', mm.bs)); end if;
    return jsonb_build_array(jsonb_build_object('cta', contab_cta(contra, m.empresa_id), 'debe', mm.bs, 'haber', 0), linea_banco);
  end if;
  if doc.total_usd is not null and mm.usd is null then return null; end if;   -- documento en dólares sin tasa del día

  -- Lo aplicado antes al mismo documento (también los movimientos anteriores al motor).
  select coalesce(sum(x.bs), 0), coalesce(sum(x.usd), 0) into prev_bs, prev_usd
    from movimientos_tesoreria p
    cross join lateral contab_montos_movimiento(p) x
   where p.empresa_id = m.empresa_id and p.id <> m.id and p.tipo = m.tipo
     and upper(trim(coalesce(p.factura_ref, ''))) = upper(trim(m.factura_ref))
     and (contab_doc_de_movimiento(p)).id = doc.id   -- dos compras con el mismo número no se mezclan
     and (contab_fecha_factura(p.fecha), p.creado_en, p.id) < (contab_fecha_factura(m.fecha), m.creado_en, m.id);
  select * into a from contab_aplicar(doc.total_bs, doc.total_usd, doc.tasa, prev_bs, prev_usd, mm.bs, mm.usd);

  if ing then
    lin := lin || linea_banco;
    if a.aplicado_bs > 0.005 then lin := lin || jsonb_build_object('cta', contab_cta('1.1.2.01', m.empresa_id), 'debe', 0, 'haber', a.aplicado_bs); end if;
    if a.exceso_bs > 0.005 then lin := lin || jsonb_build_object('cta', contab_cta('2.1.6.01', m.empresa_id), 'debe', 0, 'haber', a.exceso_bs); end if;
    if a.dif_bs > 0.005 then lin := lin || jsonb_build_object('cta', contab_cta('4.2.2.01', m.empresa_id), 'debe', 0, 'haber', a.dif_bs); end if;
    if a.dif_bs < -0.005 then lin := lin || jsonb_build_object('cta', contab_cta('6.3.1.03', m.empresa_id), 'debe', -a.dif_bs, 'haber', 0); end if;
  else
    if a.aplicado_bs > 0.005 then lin := lin || jsonb_build_object('cta', contab_cta('2.1.1.01', m.empresa_id), 'debe', a.aplicado_bs, 'haber', 0); end if;
    if a.exceso_bs > 0.005 then lin := lin || jsonb_build_object('cta', contab_cta('1.1.2.04', m.empresa_id), 'debe', a.exceso_bs, 'haber', 0); end if;
    -- Pagar más bolívares que los registrados es pérdida; menos, ganancia.
    if a.dif_bs > 0.005 then lin := lin || jsonb_build_object('cta', contab_cta('6.3.1.03', m.empresa_id), 'debe', a.dif_bs, 'haber', 0); end if;
    if a.dif_bs < -0.005 then lin := lin || jsonb_build_object('cta', contab_cta('4.2.2.01', m.empresa_id), 'debe', 0, 'haber', -a.dif_bs); end if;
    lin := lin || linea_banco;
  end if;
  return lin;
end $$;

-- Hace (o rehace, o borra) el asiento de UN movimiento.
create or replace function public.contab_asentar_movimiento(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m movimientos_tesoreria;
  lin jsonb;
  tot numeric;
  dueña uuid;
  nb text;
begin
  select * into m from movimientos_tesoreria where id = p_id;
  if not found then
    delete from asientos where origen_tabla = 'movimientos_tesoreria' and origen_id = p_id;
    return;
  end if;
  lin := contab_lineas_movimiento(m);
  if lin is null then
    delete from asientos where origen_tabla = 'movimientos_tesoreria' and origen_id = m.id;
    return;
  end if;
  select cuenta_id into dueña from empresas where id = m.empresa_id;
  select nombre into nb from cuentas_tesoreria where id = m.cuenta_teso_id;
  select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into tot from jsonb_array_elements(lin) e;
  update asientos set empresa_id = m.empresa_id, fecha = to_char(contab_fecha_factura(m.fecha), 'DD/MM/YYYY'),
                      periodo = to_char(contab_fecha_factura(m.fecha), 'YYYY-MM'),
                      descripcion = coalesce(nullif(trim(m.concepto), ''), case when m.tipo = 'ingreso' then 'Ingreso' else 'Egreso' end) || ' · ' || coalesce(nb, ''),
                      referencia = coalesce(nullif(trim(m.factura_ref), ''), m.referencia, ''), lineas = lin, total = tot, origen = 'motor'
   where origen_tabla = 'movimientos_tesoreria' and origen_id = m.id;
  if not found then
    insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
    values (coalesce(dueña, m.cuenta_id), m.empresa_id, to_char(contab_fecha_factura(m.fecha), 'DD/MM/YYYY'),
            to_char(contab_fecha_factura(m.fecha), 'YYYY-MM'),
            coalesce(nullif(trim(m.concepto), ''), case when m.tipo = 'ingreso' then 'Ingreso' else 'Egreso' end) || ' · ' || coalesce(nb, ''),
            coalesce(nullif(trim(m.factura_ref), ''), m.referencia, ''), 'motor', 'movimientos_tesoreria', m.id, lin, tot);
  end if;
end $$;

create or replace function public.contab_sync_movimiento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m movimientos_tesoreria := case when tg_op = 'DELETE' then old else new end;
  v record;
begin
  perform pg_advisory_xact_lock(hashtext('tesoreria:' || m.empresa_id::text));
  perform contab_asentar_movimiento(m.id);
  -- Los vecinos: los demás cobros o pagos del mismo documento (lo que les falta
  -- cambió) y la otra punta de una transferencia, con los datos de AHORA y los
  -- de ANTES (corregir la fecha, el documento o la referencia mueve a otros).
  for v in
    select p.id from movimientos_tesoreria p
     where p.empresa_id = m.empresa_id and p.id <> m.id and p.contab_motor
       and ((tg_op <> 'DELETE' and coalesce(new.referencia, '') ~ '^TRF-' and p.referencia = new.referencia)
         or (tg_op <> 'INSERT' and coalesce(old.referencia, '') ~ '^TRF-' and p.referencia = old.referencia)
         or (tg_op <> 'DELETE' and coalesce(trim(new.factura_ref), '') <> '' and p.tipo = new.tipo
             and upper(trim(coalesce(p.factura_ref, ''))) = upper(trim(new.factura_ref)))
         or (tg_op <> 'INSERT' and coalesce(trim(old.factura_ref), '') <> '' and p.tipo = old.tipo
             and upper(trim(coalesce(p.factura_ref, ''))) = upper(trim(old.factura_ref))))
  loop
    perform contab_asentar_movimiento(v.id);
  end loop;
  return m;
end $$;

-- Antes de borrar un movimiento: la línea del banco que estaba conciliada como
-- «ya registrado» con él vuelve a pendiente (si no, quedaría reclasificando
-- contra «Bancos» un dinero que ya no está en ningún asiento).
create or replace function public.contab_mov_antes_borrar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update extracto_bancario set estado = 'pendiente'
   where movimiento_id = old.id and empresa_id = old.empresa_id and estado = 'conciliada';
  return old;
end $$;
drop trigger if exists trg_contab_movimiento_borrar on public.movimientos_tesoreria;
create trigger trg_contab_movimiento_borrar before delete on public.movimientos_tesoreria
  for each row execute function public.contab_mov_antes_borrar();

drop trigger if exists trg_contab_movimiento on public.movimientos_tesoreria;
create trigger trg_contab_movimiento after insert or delete on public.movimientos_tesoreria
  for each row execute function public.contab_sync_movimiento();
drop trigger if exists trg_contab_movimiento_upd on public.movimientos_tesoreria;
create trigger trg_contab_movimiento_upd after update of monto, tipo, fecha, cuenta_teso_id, factura_ref, referencia, cuenta_contra, contab_motor, concepto, tercero_nombre, tercero_rif
  on public.movimientos_tesoreria for each row execute function public.contab_sync_movimiento();

-- «Cerrar mes» también cuenta los movimientos de Tesorería sin asiento (sin
-- cuenta, o en dólares sin tasa del BCV). Reemplaza la de contabilidad_05.
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
  ) + (
    select count(*)::int
      from movimientos_tesoreria m
     where m.empresa_id = p_empresa and m.contab_motor and coalesce(m.monto, 0) > 0
       and to_char(public.contab_fecha_factura(m.fecha), 'YYYY-MM') = p_periodo
       and not (m.tipo = 'ingreso' and (public.contab_mov_par(m)).id is not null)
       and not exists (select 1 from asientos a where a.origen_tabla = 'movimientos_tesoreria' and a.origen_id = m.id)
  )
$$;
grant execute on function public.contab_filas_sin_asiento(uuid, text) to authenticated;

-- ---- Conciliación (SQL 08 y 09), con el enlace a los movimientos del motor ----
-- contab_lineas_extracto: igual que en contabilidad_08, más el caso «registrado» con movimiento_id.
create or replace function public.contab_lineas_extracto(x public.extracto_bancario)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  banco text;
  contra text;
  m numeric := round(abs(coalesce(x.monto, 0)), 2);
  d declaraciones;
begin
  if x.estado <> 'conciliada' or x.clase is null or m < 0.005 then return null; end if;
  -- «Registrado» con un movimiento de Tesorería que ya contabilizó el motor (SQL 11):
  -- ese asiento ya está en la subcuenta del banco; no se repite.
  if x.clase = 'registrado' and x.movimiento_id is not null and exists (
       select 1 from asientos a join movimientos_tesoreria t on t.id = a.origen_id
        where a.origen_tabla = 'movimientos_tesoreria' and a.origen_id = x.movimiento_id and t.empresa_id = x.empresa_id) then
    return null;
  end if;
  select cuenta_contable into banco from cuentas_tesoreria where id = x.cuenta_teso_id and empresa_id = x.empresa_id;
  if coalesce(banco, '') = '' then return null; end if;
  contra := case x.clase
    when 'cobro' then '1.1.2.01'
    when 'pago' then '2.1.1.01'
    when 'comision' then '6.3.1.02'
    when 'igtf' then '6.3.1.04'
    when 'otra' then nullif(trim(x.cuenta_contra), '')
    when 'registrado' then coalesce(nullif(trim(x.cuenta_contra), ''), case when banco like '1.1.1.01.%' then '1.1.1.01' else '1.1.1.03' end)
    when 'transferencia' then nullif(trim(x.cuenta_contra), '')
    else null end;
  if x.clase = 'transferencia' and contab_par_con_asiento(x) then
    return null;   -- la otra punta ya la contabilizó
  end if;
  if x.clase = 'impuesto' then
    if x.pago_puesto or x.declaracion_id is null then return null; end if;   -- el asiento es el del pago de la declaración
    select * into d from declaraciones where id = x.declaracion_id and empresa_id = x.empresa_id;
    contra := case when coalesce(d.cuenta_pago, '') like '1.1.1.%' then d.cuenta_pago else '1.1.1.03' end;
  end if;
  if contra is null or contra = banco then return null; end if;
  if x.monto > 0 then
    return jsonb_build_array(
      jsonb_build_object('cta', contab_cta(banco, x.empresa_id), 'debe', m, 'haber', 0),
      jsonb_build_object('cta', contab_cta(contra, x.empresa_id), 'debe', 0, 'haber', m));
  end if;
  return jsonb_build_array(
    jsonb_build_object('cta', contab_cta(contra, x.empresa_id), 'debe', m, 'haber', 0),
    jsonb_build_object('cta', contab_cta(banco, x.empresa_id), 'debe', 0, 'haber', m));
end $$;

drop trigger if exists trg_contab_extracto_upd on public.extracto_bancario;
create trigger trg_contab_extracto_upd after update of clase, cuenta_contra, estado, monto, fecha, descripcion, referencia,
    extracto_par_id, declaracion_id, cuenta_teso_id, pago_puesto, movimiento_id
  on public.extracto_bancario for each row execute function public.contab_sync_extracto();

-- contab_conciliacion_resumen: igual que en contabilidad_09; lo enlazado a un movimiento no está en tránsito.
create or replace function public.contab_conciliacion_resumen(p_cuenta_teso uuid, p_periodo text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  b cuentas_tesoreria;
  ini date;
  fin date;
  sb numeric;
  sl numeric;
  ap numeric;
  pc int; ps numeric;
  tc int; ts numeric;
begin
  if coalesce(p_periodo, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Período inválido: %', p_periodo; end if;
  select * into b from cuentas_tesoreria where id = p_cuenta_teso;
  if not found then raise exception 'El banco no existe o no tienes acceso a él'; end if;
  ini := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  fin := (ini + interval '1 month - 1 day')::date;
  select saldo_final into sb from estados_cuenta where cuenta_teso_id = b.id and periodo = p_periodo;
  sl := contab_saldo_cuenta(b.empresa_id, b.cuenta_contable, fin);
  -- El saldo con que arrancó el banco: el inicial de su PRIMER estado de cuenta.
  -- Mientras no haya asiento de apertura (plan 5), se suma aparte a los libros.
  select coalesce(saldo_inicial, 0) into ap from estados_cuenta where cuenta_teso_id = b.id order by periodo limit 1;
  ap := coalesce(ap, 0);
  -- Lo que trae el banco hasta el fin del mes y todavía no está conciliado
  -- (también lo de meses anteriores: una conciliación arrastra lo abierto).
  select count(*), round(coalesce(sum(monto), 0), 2) into pc, ps
    from extracto_bancario x
   where x.cuenta_teso_id = b.id and x.estado <> 'conciliada'
     and contab_fecha_factura(x.fecha) <= fin;
  -- Lo que hay en libros hasta el fin del mes y no vino de una línea del banco
  -- (ni del pago de una declaración que una línea enlazó).
  select count(*), round(coalesce(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 0), 2) into tc, ts
    from asientos a
    cross join lateral jsonb_array_elements(a.lineas) e
   where a.empresa_id = b.empresa_id
     and split_part(e->>'cta', ' · ', 1) = b.cuenta_contable
     and contab_fecha_factura(a.fecha) <= fin
     and a.origen_tabla is distinct from 'extracto_bancario'
     and not (a.origen_tabla = 'movimientos_tesoreria' and a.origen_id in
              (select x.movimiento_id from extracto_bancario x where x.cuenta_teso_id = b.id and x.estado = 'conciliada' and x.movimiento_id is not null))
     and not (a.origen_tabla = 'declaraciones_pago' and a.origen_id in
              (select x.declaracion_id from extracto_bancario x where x.cuenta_teso_id = b.id and x.pago_puesto));
  return jsonb_build_object(
    'saldo_banco', sb,
    'saldo_libros', sl,
    'saldo_apertura', round(ap, 2),
    'pendientes', jsonb_build_object('cantidad', pc, 'suma', ps),
    'transito', jsonb_build_object('cantidad', tc, 'suma', ts),
    'diferencia', case when sb is null then null else round(sb - (sl + ap) - ps + ts, 2) end);
end $$;
grant execute on function public.contab_conciliacion_resumen(uuid, text) to authenticated;

-- Comprobación
select (select count(*) from movimientos_tesoreria where contab_motor) as movimientos_en_el_motor,
       (select count(*) from movimientos_tesoreria where not contab_motor) as movimientos_anteriores;
