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
--   · DPP, IGP, MUNICIPAL, ISLR_ANTICIPO, ISLR_ANUAL: al declarar, gasto (o
--     anticipo) contra «… por pagar». El ISLR anual rebaja primero los
--     anticipos y el resto, lo retenido por terceros.
--   · Al pagar (fecha de pago y a_pagar > 0): Debe «… por pagar» / Haber el
--     banco elegido (cuenta_pago; por defecto 1.1.1.03 Bancos).
--   · Una SUSTITUTIVA contabiliza solo la diferencia, cuenta por cuenta, con
--     la declaración anterior del mismo impuesto y período.
--   · Solo los cambios que alteran un asiento disparan el motor: que un
--     script reescriba el estado no contabiliza las declaraciones viejas (las
--     19 de DPP entran en la reconstrucción).
-- ============================================================

alter table public.declaraciones add column if not exists fecha_pago date;
alter table public.declaraciones add column if not exists numero_pago text;
alter table public.declaraciones add column if not exists cuenta_pago text;

comment on column public.declaraciones.cuenta_pago is
  'Cuenta de efectivo del plan desde la que se pagó (código); null = 1.1.1.03 Bancos';

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

-- Las líneas «completas» de una declaración, sin mirar si es sustitutiva.
create or replace function public.contab_lineas_decl_completa(d public.declaraciones)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  imp text := upper(coalesce(d.impuesto, ''));
  ap numeric := round(coalesce(d.a_pagar, 0), 2);
  mo numeric := round(coalesce(d.monto, 0), 2);
  deb text;
  ant numeric; resto numeric; uso_ant numeric;
  lin jsonb;
begin
  deb := case imp when 'DPP' then '6.1.1.07' when 'IGP' then '6.1.1.13' when 'MUNICIPAL' then '6.1.1.12'
                  when 'ISLR_ANTICIPO' then '1.1.3.06' end;
  if deb is not null then
    if ap < 0.005 then return null; end if;
    return jsonb_build_array(
      jsonb_build_object('cta', contab_cta(deb, d.empresa_id), 'debe', ap, 'haber', 0),
      jsonb_build_object('cta', contab_cta(contab_decl_pasivo(imp), d.empresa_id), 'debe', 0, 'haber', ap));
  end if;
  if imp = 'ISLR_ANUAL' then
    if mo < 0.005 then return null; end if;
    -- Saldo de anticipos de ISLR hasta el período (sin contar el asiento de esta misma declaración).
    select coalesce(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 0) into ant
      from asientos a, jsonb_array_elements(a.lineas) e
     where a.empresa_id = d.empresa_id and coalesce(a.periodo, '') <= d.periodo
       and e->>'cta' like '1.1.3.06%'
       and not (a.origen_tabla = 'declaraciones' and a.origen_id = d.id);
    resto := round(mo - ap, 2);
    uso_ant := round(least(greatest(ant, 0), greatest(resto, 0)), 2);
    lin := jsonb_build_array(
      jsonb_build_object('cta', contab_cta('6.4.1.01', d.empresa_id), 'debe', mo, 'haber', 0));
    if ap > 0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta('2.1.4.01', d.empresa_id), 'debe', 0, 'haber', ap);
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

-- El asiento de la declaración. Si es sustitutiva, la diferencia neta cuenta
-- por cuenta con la anterior del mismo impuesto, período y quincena.
create or replace function public.contab_lineas_declaracion(d public.declaraciones)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  actual jsonb := contab_lineas_decl_completa(d);
  prev declaraciones;
  previa jsonb;
  neto jsonb;
begin
  if upper(coalesce(d.tipo, '')) <> 'SUSTITUTIVA' then return actual; end if;
  select * into prev from declaraciones x
   where x.empresa_id = d.empresa_id and x.impuesto = d.impuesto and x.periodo = d.periodo
     and x.quincena is not distinct from d.quincena and x.id <> d.id
     and (coalesce(x.fecha, '1900-01-01') < coalesce(d.fecha, '1900-01-01')
          or (coalesce(x.fecha, '1900-01-01') = coalesce(d.fecha, '1900-01-01') and x.creado_en < d.creado_en))
   order by x.fecha desc nulls last, x.creado_en desc limit 1;
  if not found then return actual; end if;
  previa := contab_lineas_decl_completa(prev);
  with l as (
    select e->>'cta' as cta, coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0) as v, n
      from jsonb_array_elements(coalesce(actual, '[]'::jsonb)) with ordinality t(e, n)
    union all
    select e->>'cta', -(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 1000 + n
      from jsonb_array_elements(coalesce(previa, '[]'::jsonb)) with ordinality t(e, n)
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
declare ap numeric := round(coalesce(d.a_pagar, 0), 2);
begin
  if d.fecha_pago is null or ap < 0.005 or contab_decl_pasivo(d.impuesto) is null then return null; end if;
  return jsonb_build_array(
    jsonb_build_object('cta', contab_cta(contab_decl_pasivo(d.impuesto), d.empresa_id), 'debe', ap, 'haber', 0),
    jsonb_build_object('cta', contab_cta(coalesce(nullif(trim(d.cuenta_pago), ''), '1.1.1.03'), d.empresa_id), 'debe', 0, 'haber', ap));
end $$;

create or replace function public.contab_sync_declaracion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d declaraciones;
  dueña uuid;
  q text;
  lin jsonb;
  fec text;
  descr text;
  tot numeric;
  t text;
begin
  if tg_op = 'DELETE' then
    delete from asientos where origen_tabla in ('declaraciones', 'declaraciones_pago') and origen_id = old.id;
    return old;
  end if;
  d := new;
  select cuenta_id into dueña from empresas where id = d.empresa_id;
  q := case when d.quincena is not null then ' · quincena ' || d.quincena else '' end;

  foreach t in array array['declaraciones', 'declaraciones_pago'] loop
    if t = 'declaraciones' then
      lin := contab_lineas_declaracion(d);
      fec := coalesce(to_char(d.fecha, 'DD/MM/YYYY'),
                      to_char((to_date(d.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, 'DD/MM/YYYY'));
      descr := 'Declaración ' || upper(d.impuesto) || ' ' || d.periodo || q || ' · planilla ' || coalesce(d.numero, '');
    else
      lin := contab_lineas_pago(d);
      fec := to_char(d.fecha_pago, 'DD/MM/YYYY');
      descr := 'Pago ' || upper(d.impuesto) || ' ' || d.periodo || q || ' · recibo ' || coalesce(nullif(trim(d.numero_pago), ''), '(sin número)');
    end if;
    if lin is null then
      delete from asientos where origen_tabla = t and origen_id = d.id;
      continue;
    end if;
    select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into tot from jsonb_array_elements(lin) e;
    update asientos set fecha = fec, periodo = d.periodo, descripcion = descr, referencia = coalesce(d.numero, ''),
                        lineas = lin, total = tot, origen = 'motor'
     where origen_tabla = t and origen_id = d.id;
    if not found then
      insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
      values (coalesce(dueña, d.cuenta_id), d.empresa_id, fec, d.periodo, descr, coalesce(d.numero, ''), 'motor', t, d.id, lin, tot);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_contab_declaracion on public.declaraciones;
create trigger trg_contab_declaracion
  after insert or delete
     or update of impuesto, periodo, quincena, tipo, monto, a_pagar, fecha, numero, fecha_pago, numero_pago, cuenta_pago, empresa_id
  on public.declaraciones
  for each row execute function public.contab_sync_declaracion();

-- Lo que la contabilidad dice que se debe de un impuesto en un período, para
-- avisar si lo declarado no coincide. null = ese impuesto no se compara.
create or replace function public.contab_declarado_vs_contable(p_empresa uuid, p_impuesto text, p_periodo text, p_quincena int)
returns numeric language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  imp text := upper(coalesce(p_impuesto, ''));
  mm text := substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4);
  r numeric;
begin
  if imp = 'IVA' then
    select round(coalesce(sum(coalesce((e->>'haber')::numeric, 0)), 0), 2) into r
      from asientos a, jsonb_array_elements(a.lineas) e
     where a.empresa_id = p_empresa and a.referencia = 'F30-' || mm and e->>'cta' like '2.1.4.04%';
    return r;
  elsif imp in ('RET_IVA', 'RET_ISLR') then
    select round(coalesce(sum(t.monto), 0), 2) into r from retenciones t
     where t.empresa_id = p_empresa and lower(coalesce(t.direccion, '')) like 'practicada%'
       and lower(coalesce(t.tipo, '')) = (case when imp = 'RET_IVA' then 'iva' else 'islr' end)
       and coalesce(t.estado, '') !~* 'anulad'
       and contab_periodo_de(t.fecha, t.periodo) = p_periodo
       and (p_quincena is null or t.quincena = p_quincena);
    return r;
  elsif imp = 'IGTF' then
    select round(coalesce(sum(l.igtf), 0), 2) into r from libro_fiscal l
     where l.empresa_id = p_empresa and l.tipo = 'venta'
       and contab_periodo_de(l.fecha, l.periodo) = p_periodo
       and (p_quincena is null
            or (case when extract(day from contab_fecha_factura(l.fecha)) <= 15 then 1 else 2 end) = p_quincena);
    return r;
  end if;
  return null;
end $$;
grant execute on function public.contab_declarado_vs_contable(uuid, text, text, int) to authenticated;

-- Comprobación: 1 (el disparador).
select count(*) as disparadores from pg_trigger where tgname = 'trg_contab_declaracion' and not tgisinternal;
