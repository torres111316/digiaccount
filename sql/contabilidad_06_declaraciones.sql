-- ============================================================
-- DigiAccount · Contabilidad 06: declaraciones y pagos de impuestos contabilizan solos
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _05. Re-ejecutable.
--
-- POR QUÉ: se declara en el portal del SENIAT, se paga en el banco y se
-- guardan la planilla, el recibo y el certificado, pero nada de eso llegaba a
-- la contabilidad. Luis registra ahora cada declaración y su pago en
-- Fiscal → «Declaraciones y pagos», copiando los datos de la planilla (a mano
-- mientras no esté la Bóveda; después la leerá un agente). De esa fila nacen
-- los asientos. Regla de Luis: al declarar el impuesto va al PASIVO; al pagar
-- se cruza contra el banco.
-- Pruebas: sql/pruebas/contabilidad_06_pruebas.sql.
--
--   · IVA, RET_IVA, RET_ISLR, IGTF: ya están en el pasivo (liquidación del
--     mes, retenciones, ventas), así que declararlos no genera asiento.
--   · DPP, IGP, MUNICIPAL, ISLR_ANTICIPO: al declarar, gasto (o anticipo)
--     contra «… por pagar» por el MONTO del impuesto.
--   · ISLR_ANUAL: gasto por el monto; «por pagar» por lo que se paga; la
--     diferencia rebaja primero los anticipos (hasta su saldo) y el resto, lo
--     retenido por terceros.
--   · Al pagar: Debe «… por pagar» / Haber el banco, por el A PAGAR de esa
--     planilla (en una sustitutiva, solo la diferencia). El banco es una
--     cuenta de efectivo (1.1.1.x); si no, 1.1.1.03.
--   · FECHAS: la declaración se causa el último día de su período; el pago
--     cae en el mes en que salió el dinero (así cuadra la conciliación).
--   · CADENA: las declaraciones de un mismo impuesto, período y quincena son
--     una cadena (originaria y sustitutivas, por fecha). La primera asienta el
--     total y cada siguiente, la diferencia neta cuenta por cuenta con la
--     anterior. Cuando una cambia o se borra, se recalcula toda la cadena; y
--     un anticipo nuevo recalcula el ISLR anual que lo usa.
--   · Solo los cambios que alteran un asiento disparan el motor: que un
--     script reescriba el estado no contabiliza las declaraciones viejas (las
--     19 de DPP entran en la reconstrucción).
-- ============================================================

alter table public.declaraciones add column if not exists fecha_pago date;
alter table public.declaraciones add column if not exists numero_pago text;
alter table public.declaraciones add column if not exists cuenta_pago text;

comment on column public.declaraciones.cuenta_pago is
  'Cuenta de efectivo del plan desde la que se pagó (código 1.1.1.x); null = 1.1.1.03 Bancos';

-- Lo que se paga nunca puede pasar del impuesto (un error al tipear dejaría
-- un asiento descuadrado). NOT VALID: no revisa las filas que ya existen.
alter table public.declaraciones drop constraint if exists declaraciones_a_pagar_hasta_monto;
alter table public.declaraciones add constraint declaraciones_a_pagar_hasta_monto
  check (a_pagar <= monto + 0.005) not valid;

-- La cuenta del pasivo de cada impuesto.
create or replace function public.contab_decl_pasivo(p_impuesto text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case upper(coalesce(p_impuesto, ''))
    when 'IVA' then '2.1.4.04'           when 'RET_IVA' then '2.1.3.02'
    when 'RET_ISLR' then '2.1.3.03'      when 'IGTF' then '2.1.4.03'
    when 'DPP' then '2.1.5.03'           when 'IGP' then '2.1.4.05'
    when 'MUNICIPAL' then '2.1.4.02'     when 'ISLR_ANTICIPO' then '2.1.4.01'
    when 'ISLR_ANUAL' then '2.1.4.01'
  end
$$;

-- ¿x va antes que d en su cadena? Por fecha de presentación; a igual fecha,
-- por orden de registro.
create or replace function public.contab_decl_antes(x public.declaraciones, d public.declaraciones)
returns boolean language sql immutable as $$
  select (coalesce(x.fecha, '1900-01-01'::date), x.creado_en, x.id::text)
       < (coalesce(d.fecha, '1900-01-01'::date), d.creado_en, d.id::text)
$$;

-- Las líneas «completas» de una declaración (lo que dejaría si fuera la única).
create or replace function public.contab_lineas_decl_completa(d public.declaraciones)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  imp text := upper(coalesce(d.impuesto, ''));
  mo numeric := round(coalesce(d.monto, 0), 2);
  deb text;
  ap_acum numeric; ant numeric; resto numeric; uso_ant numeric;
  lin jsonb;
begin
  deb := case imp when 'DPP' then '6.1.1.07' when 'IGP' then '6.1.1.13' when 'MUNICIPAL' then '6.1.1.12'
                  when 'ISLR_ANTICIPO' then '1.1.3.06' end;
  if deb is not null then
    if mo < 0.005 then return null; end if;
    return jsonb_build_array(
      jsonb_build_object('cta', contab_cta(deb, d.empresa_id), 'debe', mo, 'haber', 0),
      jsonb_build_object('cta', contab_cta(contab_decl_pasivo(imp), d.empresa_id), 'debe', 0, 'haber', mo));
  end if;
  if imp = 'ISLR_ANUAL' then
    if mo < 0.005 then return null; end if;
    -- Lo que se paga en total hasta esta declaración (una sustitutiva paga solo la diferencia).
    select round(coalesce(sum(x.a_pagar), 0), 2) into ap_acum from declaraciones x
     where x.empresa_id = d.empresa_id and x.impuesto = d.impuesto and x.periodo = d.periodo
       and x.quincena is not distinct from d.quincena
       and (x.id = d.id or contab_decl_antes(x, d));
    -- Saldo de anticipos hasta el período, SIN los asientos del ISLR anual (de
    -- ninguna declaración de la cadena: si no, los anticipos «resucitan»).
    select coalesce(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 0) into ant
      from asientos a, jsonb_array_elements(a.lineas) e
     where a.empresa_id = d.empresa_id and coalesce(a.periodo, '') <= d.periodo
       and e->>'cta' like '1.1.3.06%'
       and not (a.origen_tabla = 'declaraciones'
                and a.origen_id in (select y.id from declaraciones y where y.empresa_id = d.empresa_id and y.impuesto = 'ISLR_ANUAL'));
    resto := round(mo - ap_acum, 2);
    uso_ant := round(least(greatest(ant, 0), greatest(resto, 0)), 2);
    lin := jsonb_build_array(jsonb_build_object('cta', contab_cta('6.4.1.01', d.empresa_id), 'debe', mo, 'haber', 0));
    if ap_acum > 0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta('2.1.4.01', d.empresa_id), 'debe', 0, 'haber', ap_acum);
    end if;
    if uso_ant > 0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta('1.1.3.06', d.empresa_id), 'debe', 0, 'haber', uso_ant);
    end if;
    if resto - uso_ant > 0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta('1.1.3.02', d.empresa_id), 'debe', 0, 'haber', round(resto - uso_ant, 2));
    end if;
    return lin;
  end if;
  return null;   -- IVA, RET_IVA, RET_ISLR, IGTF: ya están en el pasivo
end $$;

-- El asiento de la declaración: el total si es la primera de su cadena; si
-- no, la diferencia neta cuenta por cuenta con la anterior.
create or replace function public.contab_lineas_declaracion(d public.declaraciones)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  actual jsonb := contab_lineas_decl_completa(d);
  prev declaraciones;
  neto jsonb;
begin
  select * into prev from declaraciones x
   where x.empresa_id = d.empresa_id and x.impuesto = d.impuesto and x.periodo = d.periodo
     and x.quincena is not distinct from d.quincena and x.id <> d.id and contab_decl_antes(x, d)
   order by coalesce(x.fecha, '1900-01-01'::date) desc, x.creado_en desc, x.id::text desc limit 1;
  if not found then return actual; end if;
  with l as (
    select e->>'cta' as cta, coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0) as v, n
      from jsonb_array_elements(coalesce(actual, '[]'::jsonb)) with ordinality t(e, n)
    union all
    select e->>'cta', -(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 1000 + n
      from jsonb_array_elements(coalesce(contab_lineas_decl_completa(prev), '[]'::jsonb)) with ordinality t(e, n)
  ), s as (
    select cta, round(sum(v), 2) as v, min(n) as n from l group by cta
  )
  select jsonb_agg(jsonb_build_object('cta', cta, 'debe', greatest(v, 0), 'haber', greatest(-v, 0))
                   order by (v < 0), n)
    into neto from s where abs(v) >= 0.005;
  return neto;   -- null si no cambió nada
end $$;

create or replace function public.contab_lineas_pago(d public.declaraciones)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  ap numeric := round(coalesce(d.a_pagar, 0), 2);
  banco text := case when coalesce(d.cuenta_pago, '') like '1.1.1.%' then d.cuenta_pago else '1.1.1.03' end;
begin
  if d.fecha_pago is null or ap < 0.005 or contab_decl_pasivo(d.impuesto) is null then return null; end if;
  return jsonb_build_array(
    jsonb_build_object('cta', contab_cta(contab_decl_pasivo(d.impuesto), d.empresa_id), 'debe', ap, 'haber', 0),
    jsonb_build_object('cta', contab_cta(banco, d.empresa_id), 'debe', 0, 'haber', ap));
end $$;

-- (Re)hace los dos asientos de una declaración; si ya no existe, los borra.
create or replace function public.contab_asentar_declaracion(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d declaraciones;
  dueña uuid;
  q text;
  lin jsonb; fec text; per text; descr text; tot numeric; t text;
begin
  select * into d from declaraciones where id = p_id;
  if not found then
    delete from asientos where origen_tabla in ('declaraciones', 'declaraciones_pago') and origen_id = p_id;
    return;
  end if;
  select cuenta_id into dueña from empresas where id = d.empresa_id;
  q := case when d.quincena is not null then ' · quincena ' || d.quincena else '' end;
  foreach t in array array['declaraciones', 'declaraciones_pago'] loop
    if t = 'declaraciones' then
      lin := contab_lineas_declaracion(d);
      per := d.periodo;
      fec := to_char((to_date(d.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, 'DD/MM/YYYY');
      descr := 'Declaración ' || upper(d.impuesto) || ' ' || d.periodo || q || ' · planilla ' || coalesce(d.numero, '(sin número)');
    else
      lin := contab_lineas_pago(d);
      per := to_char(d.fecha_pago, 'YYYY-MM');
      fec := to_char(d.fecha_pago, 'DD/MM/YYYY');
      descr := 'Pago ' || upper(d.impuesto) || ' ' || d.periodo || q || ' · recibo ' || coalesce(nullif(trim(d.numero_pago), ''), '(sin número)');
    end if;
    if lin is null then
      delete from asientos where origen_tabla = t and origen_id = d.id;
      continue;
    end if;
    select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into tot from jsonb_array_elements(lin) e;
    update asientos set empresa_id = d.empresa_id, cuenta_id = coalesce(dueña, d.cuenta_id),
                        fecha = fec, periodo = per, descripcion = descr, referencia = coalesce(d.numero, ''),
                        lineas = lin, total = tot, origen = 'motor'
     where origen_tabla = t and origen_id = d.id;
    if not found then
      insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
      values (coalesce(dueña, d.cuenta_id), d.empresa_id, fec, per, descr, coalesce(d.numero, ''), 'motor', t, d.id, lin, tot);
    end if;
  end loop;
end $$;

-- Disparador: la fila tocada, su cadena (la de antes y la de después de un
-- cambio de impuesto o período) y, si es un anticipo, los ISLR anuales que lo usan.
create or replace function public.contab_sync_declaracion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ids uuid[] := '{}';
  r record;
begin
  for r in
    select x.id from declaraciones x
     where (tg_op <> 'DELETE' and x.id = new.id)
        or (tg_op <> 'DELETE' and x.empresa_id = new.empresa_id and x.impuesto = new.impuesto
            and x.periodo = new.periodo and x.quincena is not distinct from new.quincena)
        or (tg_op <> 'INSERT' and x.empresa_id = old.empresa_id and x.impuesto = old.impuesto
            and x.periodo = old.periodo and x.quincena is not distinct from old.quincena)
        or (tg_op <> 'DELETE' and upper(new.impuesto) = 'ISLR_ANTICIPO'
            and x.empresa_id = new.empresa_id and x.impuesto = 'ISLR_ANUAL' and x.periodo >= new.periodo)
        or (tg_op <> 'INSERT' and upper(old.impuesto) = 'ISLR_ANTICIPO'
            and x.empresa_id = old.empresa_id and x.impuesto = 'ISLR_ANUAL' and x.periodo >= old.periodo)
     order by x.impuesto = 'ISLR_ANUAL', coalesce(x.fecha, '1900-01-01'::date), x.creado_en
  loop
    ids := ids || r.id;
  end loop;
  if tg_op = 'DELETE' then
    delete from asientos where origen_tabla in ('declaraciones', 'declaraciones_pago') and origen_id = old.id;
  end if;
  for r in select unnest(ids) as id loop
    perform contab_asentar_declaracion(r.id);
  end loop;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_contab_declaracion on public.declaraciones;
create trigger trg_contab_declaracion
  after insert or delete
     or update of impuesto, periodo, quincena, tipo, monto, a_pagar, fecha, numero, fecha_pago, numero_pago, cuenta_pago, empresa_id
  on public.declaraciones
  for each row execute function public.contab_sync_declaracion();

-- Lo que la CONTABILIDAD dice que se debe de un impuesto en un período (leído
-- de los asientos de los motores), para avisar si lo declarado no coincide.
-- null = no hay con qué comparar (ese impuesto, o un mes sin liquidar).
create or replace function public.contab_declarado_vs_contable(p_empresa uuid, p_impuesto text, p_periodo text, p_quincena int)
returns numeric language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  imp text := upper(coalesce(p_impuesto, ''));
  mm text := substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4);
  r numeric;
begin
  if imp = 'IVA' then
    -- La liquidación del mes (F30 de «Cerrar mes»). Las F30 históricas pagaron
    -- contra Bancos y no tienen 2.1.4.04: sin comparación, no un cero falso.
    select round(sum(coalesce((e->>'haber')::numeric, 0)), 2) into r
      from asientos a, jsonb_array_elements(a.lineas) e
     where a.empresa_id = p_empresa and a.referencia = 'F30-' || mm and e->>'cta' like '2.1.4.04%';
    return r;
  elsif imp in ('RET_IVA', 'RET_ISLR') then
    select round(coalesce(sum(coalesce((e->>'haber')::numeric, 0) - coalesce((e->>'debe')::numeric, 0)), 0), 2) into r
      from retenciones t
      join asientos a on a.origen_tabla = 'retenciones' and a.origen_id = t.id
      cross join lateral jsonb_array_elements(a.lineas) e
     where t.empresa_id = p_empresa
       and lower(coalesce(t.tipo, '')) = (case when imp = 'RET_IVA' then 'iva' else 'islr' end)
       and contab_periodo_de(t.fecha, t.periodo) = p_periodo
       and (p_quincena is null
            or coalesce(t.quincena, case when extract(day from contab_fecha_factura(t.fecha)) <= 15 then 1 else 2 end) = p_quincena)
       and e->>'cta' like contab_decl_pasivo(imp) || '%';
    return r;
  elsif imp = 'IGTF' then
    -- Con las mismas reglas del motor de facturas (anuladas fuera, NC restan, modo recibos fuera).
    select round(coalesce(sum(coalesce((e->>'haber')::numeric, 0) - coalesce((e->>'debe')::numeric, 0)), 0), 2) into r
      from libro_fiscal l
      cross join lateral jsonb_array_elements(coalesce(contab_lineas_libro(l), '[]'::jsonb)) e
     where l.empresa_id = p_empresa and l.tipo = 'venta'
       and contab_periodo_de(l.fecha, l.periodo) = p_periodo
       and (p_quincena is null
            or (case when extract(day from contab_fecha_factura(l.fecha)) <= 15 then 1 else 2 end) = p_quincena)
       and e->>'cta' like '2.1.4.03%';
    return r;
  end if;
  return null;
end $$;
grant execute on function public.contab_declarado_vs_contable(uuid, text, text, int) to authenticated;

-- Comprobación: 1 (el disparador).
select count(*) as disparadores from pg_trigger where tgname = 'trg_contab_declaracion' and not tgisinternal;
