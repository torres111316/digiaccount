-- ============================================================
-- DigiAccount · Contabilidad 12: diferencial cambiario y revaluación
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _11. Re-ejecutable.
--
-- POR QUÉ (plan 4b; spec §4.1 «Moneda»): la contabilidad oficial va en
-- bolívares, pero hay recibos, facturas y cuentas en dólares.
--   · Cobros y pagos de documentos en dólares: ya los resuelve el motor de
--     Tesorería (SQL 11, contab_aplicar): la CxC o CxP se cancela a la tasa del
--     documento y la diferencia con la del día va a ganancia o pérdida en cambio.
--   · Cuentas bancarias en dólares: se desbloquea su conciliación (SQL 08). Cada
--     línea se asienta en bolívares a la tasa BCV del día y guarda los dólares.
--   · Revaluación al cierre (contab_revaluar, asiento REV-mm/aaaa al último día
--     del mes, contra 4.2.2.01 ganancia / 6.3.1.03 pérdida en cambio):
--       - cada cuenta en dólares: saldo en USD × tasa de cierre − su saldo en Bs;
--       - CxC y CxP de los documentos en dólares abiertos: lo pendiente en USD
--         × (tasa de cierre − tasa del documento).
--     Es ACUMULATIVA: cada mes ajusta solo lo que falta respecto de las
--     revaluaciones anteriores, así lo revaluado de un documento que ya se
--     cobró se revierte solo al mes siguiente. Correrla de nuevo la rehace igual.
-- Pruebas: sql/pruebas/contabilidad_12_pruebas.sql.
-- ============================================================

-- Los dólares de una cuenta: suma de `usd` de sus líneas (Debe suma, Haber resta).
create or replace function public.contab_saldo_usd(p_empresa uuid, p_codigo text, p_hasta date)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select round(coalesce(sum(case when coalesce((e->>'debe')::numeric, 0) > 0 then 1 else -1 end * coalesce((e->>'usd')::numeric, 0)), 0), 2)
    from asientos a
    cross join lateral jsonb_array_elements(a.lineas) e
   where a.empresa_id = p_empresa
     and split_part(e->>'cta', ' · ', 1) = p_codigo
     and e ? 'usd'
     and public.contab_fecha_factura(a.fecha) <= p_hasta
$$;

-- Lo revaluado antes del período (Debe − Haber de la cuenta en los REV anteriores).
create or replace function public.contab_revaluado_antes(p_empresa uuid, p_codigo text, p_periodo text)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select round(coalesce(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 0), 2)
    from asientos a
    cross join lateral jsonb_array_elements(a.lineas) e
   where a.empresa_id = p_empresa and a.origen_tabla = 'revaluacion' and a.periodo < p_periodo
     and split_part(e->>'cta', ' · ', 1) = p_codigo
$$;

-- Los bolívares de las líneas de una cuenta que SÍ traen sus dólares. La
-- revaluación compara solo esas: una línea sin dólares (un asiento a mano, una
-- presunción contra la cuenta) no se borra como si fuera una pérdida.
create or replace function public.contab_saldo_bs_usd(p_empresa uuid, p_codigo text, p_hasta date)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select round(coalesce(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 0), 2)
    from asientos a
    cross join lateral jsonb_array_elements(a.lineas) e
   where a.empresa_id = p_empresa
     and split_part(e->>'cta', ' · ', 1) = p_codigo
     and e ? 'usd'
     and public.contab_fecha_factura(a.fecha) <= p_hasta
$$;

-- Lo pendiente en dólares de un documento al cierre: su total en USD menos lo
-- cobrado o pagado en Tesorería (solo los movimientos de ESE documento), menos
-- las retenciones, las líneas del banco conciliadas con él y sus notas de
-- crédito (en dólares a la tasa del documento). Si una presunción de contado
-- («Dar por cobrado y pagado») del mes del documento o posterior ya lo cerró,
-- no queda nada pendiente.
create or replace function public.contab_usd_pendiente(p_empresa uuid, p_tabla text, p_id uuid, p_hasta date)
returns numeric language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  tot_usd numeric; tasa_doc numeric; num text; rif text; per text; tipo_mov text; dir_ret text;
  pagado numeric := 0;
begin
  if p_tabla = 'facturas' then
    select f.total_usd, f.tasa, f.numero, f.cliente_rif, to_char(contab_fecha_factura(f.fecha), 'YYYY-MM'), 'ingreso', 'sufrida'
      into tot_usd, tasa_doc, num, rif, per, tipo_mov, dir_ret from facturas f where f.id = p_id;
  else
    select l.total_usd, l.tasa, l.numero_factura, l.tercero_rif, coalesce(l.periodo, to_char(contab_fecha_factura(l.fecha), 'YYYY-MM')),
           case when l.tipo = 'venta' then 'ingreso' else 'egreso' end, case when l.tipo = 'venta' then 'sufrida' else 'practicada' end
      into tot_usd, tasa_doc, num, rif, per, tipo_mov, dir_ret from libro_fiscal l where l.id = p_id;
  end if;
  if coalesce(tot_usd, 0) <= 0 or coalesce(tasa_doc, 0) <= 0 then return 0; end if;
  if exists (select 1 from asientos a where a.empresa_id = p_empresa and a.origen_tabla = 'presuncion'
              and a.periodo >= per and contab_fecha_factura(a.fecha) <= p_hasta) then
    return 0;
  end if;
  -- Tesorería: solo los movimientos que llevan a ESTE documento.
  pagado := pagado + coalesce((select sum(x.usd) from movimientos_tesoreria m cross join lateral contab_montos_movimiento(m) x
     where m.empresa_id = p_empresa and m.tipo = tipo_mov and upper(trim(coalesce(m.factura_ref, ''))) = upper(trim(coalesce(num, '')))
       and contab_fecha_factura(m.fecha) <= p_hasta and (contab_doc_de_movimiento(m)).id = p_id), 0);
  -- Retenciones (sufridas en una venta, practicadas en una compra).
  pagado := pagado + coalesce((select sum(t.monto) / tasa_doc from retenciones t
     where t.empresa_id = p_empresa and t.direccion = dir_ret and coalesce(t.estado, '') !~* 'anulad'
       and upper(trim(coalesce(t.factura, ''))) = upper(trim(coalesce(num, '')))
       and (coalesce(trim(rif), '') = '' or coalesce(trim(t.tercero_rif), '') = '' or upper(t.tercero_rif) = upper(rif))
       and contab_fecha_factura(t.fecha) <= p_hasta), 0);
  -- Líneas del estado de cuenta conciliadas con el documento (solo del libro).
  if p_tabla = 'libro_fiscal' then
    pagado := pagado + coalesce((select sum(abs(x.monto) / coalesce(nullif(contab_tasa_bcv(contab_fecha_factura(x.fecha)), 0), tasa_doc)) from extracto_bancario x
       where x.empresa_id = p_empresa and x.libro_fiscal_id = p_id and x.estado = 'conciliada' and x.clase in ('cobro', 'pago')
         and contab_fecha_factura(x.fecha) <= p_hasta), 0);
  end if;
  -- Notas de crédito de un recibo.
  if p_tabla = 'facturas' then
    pagado := pagado + coalesce((select sum(case when upper(coalesce(n.moneda, 'BS')) = 'USD' and coalesce(n.total_usd, 0) > 0 then n.total_usd else coalesce(n.total, 0) / tasa_doc end)
       from facturas n where n.empresa_id = p_empresa and upper(coalesce(n.tipo_doc, '')) = 'NC' and coalesce(n.estado, '') !~* 'anulad'
         and n.factura_afectada = p_id and contab_fecha_factura(n.fecha) <= p_hasta), 0);   -- factura_afectada es el id de la factura (uuid)
  end if;
  return greatest(0, tot_usd - pagado);
end $$;

-- La revaluación de UN mes (sin rehacer los siguientes).
create or replace function public.contab_revaluar_mes(p_empresa uuid, p_periodo text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  fin date;
  tasa_cierre numeric;
  ref text;
  dueña uuid;
  lin jsonb := '[]'::jsonb;
  b record;
  ajuste numeric;
  gan numeric := 0;
  per numeric := 0;
  pend_cxc numeric := 0;
  pend_cxp numeric := 0;
begin
  select cuenta_id into dueña from empresas where id = p_empresa;
  if not found then raise exception 'La empresa no existe o no tienes acceso a ella'; end if;
  fin := (to_date(p_periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;
  ref := 'REV-' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4);
  tasa_cierre := contab_tasa_bcv(fin);
  if tasa_cierre is null then raise exception 'No hay tasa BCV al %: no se puede revaluar', to_char(fin, 'DD/MM/YYYY'); end if;

  -- Cada cuenta en dólares: sus dólares a la tasa del cierre, contra los
  -- bolívares de esas mismas líneas y lo ya revaluado en meses anteriores.
  for b in select cuenta_contable from cuentas_tesoreria
            where empresa_id = p_empresa and contab_es_divisa(moneda) and coalesce(cuenta_contable, '') <> '' order by cuenta_contable loop
    ajuste := round(round(contab_saldo_usd(p_empresa, b.cuenta_contable, fin) * tasa_cierre, 2)
                    - contab_saldo_bs_usd(p_empresa, b.cuenta_contable, fin)
                    - contab_revaluado_antes(p_empresa, b.cuenta_contable, p_periodo), 2);
    if ajuste > 0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta(b.cuenta_contable, p_empresa), 'debe', ajuste, 'haber', 0)
                 || jsonb_build_object('cta', contab_cta('4.2.2.01', p_empresa), 'debe', 0, 'haber', ajuste);
      gan := gan + ajuste;
    elsif ajuste < -0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta('6.3.1.03', p_empresa), 'debe', -ajuste, 'haber', 0)
                 || jsonb_build_object('cta', contab_cta(b.cuenta_contable, p_empresa), 'debe', 0, 'haber', -ajuste);
      per := per - ajuste;
    end if;
  end loop;

  -- CxC y CxP de los documentos en dólares abiertos: lo pendiente en USD ×
  -- (tasa de cierre − tasa del documento).
  select coalesce(sum(round(d.pend * (tasa_cierre - d.tasa), 2)) filter (where d.lado = 'cxc'), 0),
         coalesce(sum(round(d.pend * (tasa_cierre - d.tasa), 2)) filter (where d.lado = 'cxp'), 0)
    into pend_cxc, pend_cxp
    from (
      select 'cxc'::text lado, f.tasa, contab_usd_pendiente(p_empresa, 'facturas', f.id, fin) pend
        from facturas f join empresas e on e.id = f.empresa_id and e.fiscal_activo is false
       where f.empresa_id = p_empresa and upper(coalesce(f.moneda, 'BS')) = 'USD' and coalesce(f.total_usd, 0) > 0 and coalesce(f.tasa, 0) > 0
         and coalesce(f.tipo, 'venta') = 'venta' and upper(coalesce(f.tipo_doc, 'FV')) <> 'NC' and coalesce(f.estado, '') !~* 'anulad'
         and contab_fecha_factura(f.fecha) <= fin
      union all
      select case when l.tipo = 'venta' then 'cxc' else 'cxp' end, l.tasa, contab_usd_pendiente(p_empresa, 'libro_fiscal', l.id, fin)
        from libro_fiscal l
       where l.empresa_id = p_empresa and upper(coalesce(l.moneda, 'BS')) = 'USD' and coalesce(l.total_usd, 0) > 0 and coalesce(l.tasa, 0) > 0
         and coalesce(l.tercero_nombre, '') !~* 'anulad' and contab_lineas_libro(l) is not null
         and contab_fecha_factura(l.fecha) <= fin
    ) d;

  ajuste := round(pend_cxc - contab_revaluado_antes(p_empresa, '1.1.2.01', p_periodo), 2);
  if ajuste > 0.005 then
    lin := lin || jsonb_build_object('cta', contab_cta('1.1.2.01', p_empresa), 'debe', ajuste, 'haber', 0)
               || jsonb_build_object('cta', contab_cta('4.2.2.01', p_empresa), 'debe', 0, 'haber', ajuste);
    gan := gan + ajuste;
  elsif ajuste < -0.005 then
    lin := lin || jsonb_build_object('cta', contab_cta('6.3.1.03', p_empresa), 'debe', -ajuste, 'haber', 0)
               || jsonb_build_object('cta', contab_cta('1.1.2.01', p_empresa), 'debe', 0, 'haber', -ajuste);
    per := per - ajuste;
  end if;
  -- CxP: una deuda en dólares que sube es pérdida (el saldo acreedor crece).
  ajuste := round(pend_cxp + contab_revaluado_antes(p_empresa, '2.1.1.01', p_periodo), 2);
  if ajuste > 0.005 then
    lin := lin || jsonb_build_object('cta', contab_cta('6.3.1.03', p_empresa), 'debe', ajuste, 'haber', 0)
               || jsonb_build_object('cta', contab_cta('2.1.1.01', p_empresa), 'debe', 0, 'haber', ajuste);
    per := per + ajuste;
  elsif ajuste < -0.005 then
    lin := lin || jsonb_build_object('cta', contab_cta('2.1.1.01', p_empresa), 'debe', -ajuste, 'haber', 0)
               || jsonb_build_object('cta', contab_cta('4.2.2.01', p_empresa), 'debe', 0, 'haber', -ajuste);
    gan := gan - ajuste;
  end if;

  if jsonb_array_length(lin) = 0 then
    delete from asientos where empresa_id = p_empresa and origen_tabla = 'revaluacion' and referencia = ref;
  else
    update asientos set fecha = to_char(fin, 'DD/MM/YYYY'), periodo = p_periodo, lineas = lin, total = round(gan + per, 2),
                        descripcion = 'Revaluación de saldos en dólares · tasa BCV ' || tasa_cierre || ' al ' || to_char(fin, 'DD/MM/YYYY')
     where empresa_id = p_empresa and origen_tabla = 'revaluacion' and referencia = ref;
    if not found then
      insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, lineas, total)
      values (dueña, p_empresa, to_char(fin, 'DD/MM/YYYY'), p_periodo,
              'Revaluación de saldos en dólares · tasa BCV ' || tasa_cierre || ' al ' || to_char(fin, 'DD/MM/YYYY'),
              ref, 'motor', 'revaluacion', lin, round(gan + per, 2));
    end if;
  end if;
  return jsonb_build_object('ganancia', round(gan, 2), 'perdida', round(per, 2));
end $$;

-- Revalúa un mes y REHACE en orden los meses siguientes ya revaluados: la
-- revaluación es acumulativa, y cambiar un mes cambia lo que les toca a los
-- que vienen después (reabrir marzo y volver a cerrarlo con abril ya cerrado).
create or replace function public.contab_revaluar(p_empresa uuid, p_periodo text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  r jsonb;
  q text;
begin
  if coalesce(p_periodo, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Período inválido: %', p_periodo; end if;
  perform pg_advisory_xact_lock(hashtext('revaluacion:' || p_empresa::text));
  r := contab_revaluar_mes(p_empresa, p_periodo);
  for q in select distinct periodo from asientos
            where empresa_id = p_empresa and origen_tabla = 'revaluacion' and periodo > p_periodo order by periodo loop
    perform contab_revaluar_mes(p_empresa, q);
  end loop;
  return r;
end $$;
grant execute on function public.contab_revaluar(uuid, text) to authenticated;

-- ---- Conciliación de cuentas en dólares (SQL 08 y 11) ----
-- contab_extracto_antes: igual que en contabilidad_08, sin el bloqueo de las divisas (ahora exige la tasa).
create or replace function public.contab_extracto_antes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b cuentas_tesoreria;
  sigue boolean;
begin
  -- ¿Deja de valer el pago que esta línea le había puesto a su declaración?
  if tg_op in ('UPDATE', 'DELETE') and old.pago_puesto then
    sigue := tg_op = 'UPDATE' and new.estado = 'conciliada' and new.clase = 'impuesto'
             and new.declaracion_id is not distinct from old.declaracion_id
             and new.cuenta_teso_id = old.cuenta_teso_id and new.fecha is not distinct from old.fecha;
    if not sigue then
      update declaraciones set fecha_pago = null, numero_pago = null, cuenta_pago = null
       where id = old.declaracion_id and empresa_id = old.empresa_id;
      if tg_op = 'UPDATE' then new.pago_puesto := false; end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;

  select * into b from cuentas_tesoreria where id = new.cuenta_teso_id;
  if not found or b.empresa_id is distinct from new.empresa_id then
    raise exception 'Ese banco no es de esta empresa';
  end if;
  if new.declaracion_id is not null
     and not exists (select 1 from declaraciones where id = new.declaracion_id and empresa_id = new.empresa_id) then
    raise exception 'Esa declaración no es de esta empresa';
  end if;
  if new.libro_fiscal_id is not null
     and not exists (select 1 from libro_fiscal where id = new.libro_fiscal_id and empresa_id = new.empresa_id) then
    raise exception 'Esa factura no es de esta empresa';
  end if;
  if new.movimiento_id is not null
     and not exists (select 1 from movimientos_tesoreria where id = new.movimiento_id and empresa_id = new.empresa_id) then
    raise exception 'Ese movimiento de Tesorería no es de esta empresa';
  end if;
  if new.extracto_par_id is not null
     and not exists (select 1 from extracto_bancario where id = new.extracto_par_id and empresa_id = new.empresa_id) then
    raise exception 'La otra punta de la transferencia no es de esta empresa';
  end if;

  if new.estado = 'conciliada' then
    if contab_fecha_factura(new.fecha) is null then
      raise exception 'La fecha de la línea («%») no se entiende: corrígela como dd/mm/aaaa antes de conciliar', new.fecha;
    end if;
    -- Una cuenta en dólares se asienta en bolívares a la tasa BCV del día (SQL 12).
    if contab_es_divisa(b.moneda) and contab_tasa_bcv(contab_fecha_factura(new.fecha)) is null then
      raise exception 'No hay tasa BCV al % para convertir la cuenta % (%) a bolívares', new.fecha, b.nombre, b.moneda;
    end if;
  end if;

  -- ¿Pone esta línea el pago de una declaración que todavía no lo tenía?
  if new.estado = 'conciliada' and new.clase = 'impuesto' and new.declaracion_id is not null and not new.pago_puesto then
    update declaraciones
       set fecha_pago = contab_fecha_factura(new.fecha), numero_pago = nullif(trim(coalesce(new.referencia, '')), ''), cuenta_pago = b.cuenta_contable
     where id = new.declaracion_id and empresa_id = new.empresa_id and fecha_pago is null;
    if found then new.pago_puesto := true; end if;
  end if;
  return new;
end $$;

-- contab_lineas_extracto: igual que en contabilidad_11, con los montos de una cuenta en dólares.
create or replace function public.contab_lineas_extracto(x public.extracto_bancario)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  banco text;
  contra text;
  m numeric := round(abs(coalesce(x.monto, 0)), 2);
  d declaraciones;
  divisa boolean;
  usdv numeric;
begin
  if x.estado <> 'conciliada' or x.clase is null or m < 0.005 then return null; end if;
  -- «Registrado» con un movimiento de Tesorería que ya contabilizó el motor (SQL 11):
  -- ese asiento ya está en la subcuenta del banco; no se repite.
  if x.clase = 'registrado' and x.movimiento_id is not null and exists (
       select 1 from asientos a join movimientos_tesoreria t on t.id = a.origen_id
        where a.origen_tabla = 'movimientos_tesoreria' and a.origen_id = x.movimiento_id and t.empresa_id = x.empresa_id) then
    return null;
  end if;
  select cuenta_contable, contab_es_divisa(moneda) into banco, divisa from cuentas_tesoreria where id = x.cuenta_teso_id and empresa_id = x.empresa_id;
  if coalesce(banco, '') = '' then return null; end if;
  -- Cuenta en dólares: el monto está en USD; el asiento, en Bs a la tasa del día.
  if divisa then
    usdv := m;
    m := round(m * contab_tasa_bcv(contab_fecha_factura(x.fecha)), 2);
    if m is null then return null; end if;
  end if;
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
      (jsonb_build_object('cta', contab_cta(banco, x.empresa_id), 'debe', m, 'haber', 0) || case when divisa then jsonb_build_object('usd', usdv) else '{}'::jsonb end),
      jsonb_build_object('cta', contab_cta(contra, x.empresa_id), 'debe', 0, 'haber', m));
  end if;
  return jsonb_build_array(
    jsonb_build_object('cta', contab_cta(contra, x.empresa_id), 'debe', m, 'haber', 0),
    (jsonb_build_object('cta', contab_cta(banco, x.empresa_id), 'debe', 0, 'haber', m) || case when divisa then jsonb_build_object('usd', usdv) else '{}'::jsonb end));
end $$;

-- contab_conciliacion_resumen: igual que en contabilidad_11; una cuenta en dólares se compara en dólares.
create or replace function public.contab_conciliacion_resumen(p_cuenta_teso uuid, p_periodo text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  b cuentas_tesoreria;
  ini date;
  fin date;
  sb numeric;
  sl numeric;
  ap numeric;
  divisa boolean;
  pc int; ps numeric;
  tc int; ts numeric;
begin
  if coalesce(p_periodo, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Período inválido: %', p_periodo; end if;
  select * into b from cuentas_tesoreria where id = p_cuenta_teso;
  if not found then raise exception 'El banco no existe o no tienes acceso a él'; end if;
  -- Una cuenta en dólares: su estado de cuenta está en dólares, así que se compara en dólares.
  divisa := contab_es_divisa(b.moneda);
  ini := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  fin := (ini + interval '1 month - 1 day')::date;
  select saldo_final into sb from estados_cuenta where cuenta_teso_id = b.id and periodo = p_periodo;
  sl := case when divisa then contab_saldo_usd(b.empresa_id, b.cuenta_contable, fin) else contab_saldo_cuenta(b.empresa_id, b.cuenta_contable, fin) end;
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
  select count(*), round(coalesce(sum(case when divisa
                                       then case when coalesce((e->>'debe')::numeric, 0) > 0 then 1 else -1 end * coalesce((e->>'usd')::numeric, 0)
                                       else coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0) end), 0), 2) into tc, ts
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
    'moneda', case when divisa then 'USD' else 'Bs' end,
    'saldo_banco', sb,
    'saldo_libros', sl,
    'saldo_apertura', round(ap, 2),
    'pendientes', jsonb_build_object('cantidad', pc, 'suma', ps),
    'transito', jsonb_build_object('cantidad', tc, 'suma', ts),
    'diferencia', case when sb is null then null else round(sb - (sl + ap) - ps + ts, 2) end);
end $$;
grant execute on function public.contab_conciliacion_resumen(uuid, text) to authenticated;

-- Comprobación
select contab_tasa_bcv(current_date) as tasa_bcv_hoy,
       (select count(*) from cuentas_tesoreria where contab_es_divisa(moneda)) as cuentas_en_divisas;
