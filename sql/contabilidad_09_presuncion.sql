-- ============================================================
-- DigiAccount · Contabilidad 09: resumen de la conciliación y «Dar por
-- cobrado y pagado»
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _08. Re-ejecutable.
-- OJO: contabilidad_10 a _12 redefinen funciones de este archivo. Si vuelves a
-- correr este, corre después de nuevo del 10 al 12.
--
-- POR QUÉ:
--   · El informe de conciliación (spec §6): por banco y mes, el saldo según el
--     banco, el saldo según libros (más el saldo inicial de su primer estado de
--     cuenta, hasta que exista el asiento de apertura), lo que el banco trae y
--     aún no se concilia y lo que hay en libros sin línea del banco (en
--     tránsito), acumulados hasta el fin del mes. La diferencia tiene que dar
--     cero.
--   · «Dar por cobrado y pagado» (spec §3.7): para los clientes que no mandan
--     estado de cuenta, la presunción de contado. No recorre facturas: lleva a
--     cero el saldo de 1.1.2.01 CxC y el de 2.1.1.01 CxP al último día del
--     período, contra la cuenta de efectivo elegida, en UN asiento PRES-mm/aaaa
--     que se rehace igual si se corre de nuevo (no se cuenta a sí mismo). Lo ya
--     cobrado o pagado por conciliación HASTA ESE DÍA no se vuelve a cancelar.
--     Si después llega el estado de cuenta, el cobro de una factura ya
--     presumida se concilia como «registrado» contra la cuenta de la
--     presunción (la pantalla lo propone): pasa de esa cuenta al banco.
-- Pruebas: sql/pruebas/contabilidad_09_pruebas.sql.
-- ============================================================

-- El saldo (Debe − Haber) de una cuenta de la empresa en los asientos con
-- fecha hasta p_hasta, sin contar los asientos de origen p_sin_tabla/p_sin_ref.
create or replace function public.contab_saldo_cuenta(p_empresa uuid, p_codigo text, p_hasta date,
                                                      p_sin_tabla text default null, p_sin_ref text default null)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select round(coalesce(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 0), 2)
    from asientos a
    cross join lateral jsonb_array_elements(a.lineas) e
   where a.empresa_id = p_empresa
     and split_part(e->>'cta', ' · ', 1) = p_codigo
     and public.contab_fecha_factura(a.fecha) <= p_hasta
     and not (p_sin_tabla is not null and a.origen_tabla is not distinct from p_sin_tabla and a.referencia is not distinct from p_sin_ref)
$$;

create or replace function public.contab_dar_por_cobrado(p_empresa uuid, p_periodo text, p_cuenta text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  fin date;
  ref text;
  cxc numeric;
  cxp numeric;
  lin jsonb := '[]'::jsonb;
  dueña uuid;
  cta text := trim(coalesce(p_cuenta, ''));
begin
  if coalesce(p_periodo, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Período inválido: %', p_periodo; end if;
  if cta not like '1.1.1.%' then raise exception 'La cuenta debe ser de efectivo o bancos (1.1.1.x): %', p_cuenta; end if;
  select cuenta_id into dueña from empresas where id = p_empresa;
  if not found then raise exception 'La empresa no existe o no tienes acceso a ella'; end if;
  perform pg_advisory_xact_lock(hashtext('presuncion:' || p_empresa::text));
  fin := (to_date(p_periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;
  ref := 'PRES-' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4);
  cxc := greatest(0, contab_saldo_cuenta(p_empresa, '1.1.2.01', fin, 'presuncion', ref));
  cxp := greatest(0, -contab_saldo_cuenta(p_empresa, '2.1.1.01', fin, 'presuncion', ref));
  if cxc > 0 then
    lin := lin || jsonb_build_object('cta', contab_cta(cta, p_empresa), 'debe', cxc, 'haber', 0)
               || jsonb_build_object('cta', contab_cta('1.1.2.01', p_empresa), 'debe', 0, 'haber', cxc);
  end if;
  if cxp > 0 then
    lin := lin || jsonb_build_object('cta', contab_cta('2.1.1.01', p_empresa), 'debe', cxp, 'haber', 0)
               || jsonb_build_object('cta', contab_cta(cta, p_empresa), 'debe', 0, 'haber', cxp);
  end if;
  if jsonb_array_length(lin) = 0 then
    delete from asientos where empresa_id = p_empresa and origen_tabla = 'presuncion' and referencia = ref;
  else
    update asientos set fecha = to_char(fin, 'DD/MM/YYYY'), periodo = p_periodo, lineas = lin, total = cxc + cxp,
                        descripcion = 'Dar por cobrado y pagado · ' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4)
     where empresa_id = p_empresa and origen_tabla = 'presuncion' and referencia = ref;
    if not found then
      insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, lineas, total)
      values (dueña, p_empresa, to_char(fin, 'DD/MM/YYYY'), p_periodo,
              'Dar por cobrado y pagado · ' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4),
              ref, 'motor', 'presuncion', lin, cxc + cxp);
    end if;
  end if;
  return jsonb_build_object('cxc', cxc, 'cxp', cxp);
end $$;
grant execute on function public.contab_dar_por_cobrado(uuid, text, text) to authenticated;

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
