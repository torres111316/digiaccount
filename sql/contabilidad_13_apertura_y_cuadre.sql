-- ============================================================
-- DigiAccount · Contabilidad 13: el asiento de apertura y el cuadre con la Forma 30
-- Ejecutar en: Supabase SQL Editor, después de apertura_empresa.sql y de
-- contabilidad_01 a _11 (el _12 es opcional). Re-ejecutable.
--
-- POR QUÉ (plan 5, spec §7 y §8):
--   1. La apertura cuadraba y se cerraba, pero sus renglones no tenían cuenta
--      contable y cerrarla no generaba asiento: el Balance nunca la veía.
--      Ahora cada renglón lleva su cuenta (la guía sugiere una) y cerrar la
--      apertura genera el asiento APERTURA a la fecha de corte. Reabrirla lo
--      borra; volver a cerrarla lo rehace.
--   2. Para los activos migrados: apertura_traer_activos() trae de la ficha
--      de Activos fijos el costo y la depreciación que el activo ya traía
--      (depreciacion_inicial, sql/contabilidad_07_activos.sql).
--   3. contab_cuadre_iva(): el IVA débito y crédito de la contabilidad contra
--      el del libro (lo que declara el módulo Fiscal), por mes o quincena.
-- Pruebas: sql/pruebas/contabilidad_13_pruebas.sql.
-- ============================================================

-- ── 1 · La cuenta de cada renglón ─────────────────────────────────────────
alter table public.apertura_guia add column if not exists cuenta text;
comment on column public.apertura_guia.cuenta is 'Cuenta contable sugerida para los renglones de esta guía; se puede cambiar en cada renglón.';

insert into public.apertura_guia (id, grupo, titulo, ayuda, lado, detallado, orden) values
  ('depr_acum', 'activo_fijo', 'Depreciación acumulada de los activos',
   'Lo que cada activo ya traía depreciado al corte. Sin esto el balance sobrevalúa el activo.', 'haber', true, 72)
on conflict (id) do nothing;

update public.apertura_guia g set cuenta = v.cuenta
  from (values
    ('caja', '1.1.1.01'), ('banco', '1.1.1.03'), ('inventario', '1.1.4.01'), ('cxc', '1.1.2.01'),
    ('anticipo_c', '1.1.2.04'), ('activo_fijo', '1.2.1.04'), ('depr_acum', '1.2.1.09'),
    ('iva_credito', '1.1.3.04'), ('islr_antic', '1.1.3.06'), ('cxp', '2.1.1.01'),
    ('anticipo_p', '2.1.6.01'), ('iva_debito', '2.1.4.04'), ('ret_enterar', '2.1.3.02'),
    ('prestaciones', '2.1.2.02'), ('intereses_p', '2.1.2.02'), ('vacaciones', '2.1.2.03'),
    ('prestamo', '2.2.1'), ('capital', '3.1.1.01'), ('resultados', '3.2.2.01')
  ) v(id, cuenta)
 where g.id = v.id and g.cuenta is null;

alter table public.apertura_partidas add column if not exists cuenta_contable text;
comment on column public.apertura_partidas.cuenta_contable is
  'La cuenta del plan a la que va este renglón en el asiento de apertura (sql/contabilidad_13).';

-- Si el renglón llega sin cuenta, la de su guía (por grupo y lado). La
-- diferencia que calcula el sistema va a resultados acumulados, no a capital.
create or replace function public.apertura_partida_cuenta()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(trim(new.cuenta_contable), '') = '' then
    if new.calculado then
      new.cuenta_contable := '3.2.2.01';
    else
      select cuenta into new.cuenta_contable from apertura_guia
       where grupo = new.grupo and lado = (case when coalesce(new.debe, 0) > 0 then 'debe' else 'haber' end)
         and cuenta is not null
       order by orden limit 1;
    end if;
  else
    new.cuenta_contable := trim(new.cuenta_contable);
  end if;
  return new;
end $$;
drop trigger if exists trg_apertura_partida_cuenta on public.apertura_partidas;
create trigger trg_apertura_partida_cuenta before insert or update on public.apertura_partidas
  for each row execute function public.apertura_partida_cuenta();

-- ── 2 · El asiento ────────────────────────────────────────────────────────
-- Una línea por cuenta y lado: primero el Debe, después el Haber.
create or replace function public.contab_lineas_apertura(p_empresa uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('cta', contab_cta(cuenta_contable, p_empresa),
                                               'debe', d, 'haber', h) order by lado, cuenta_contable), '[]'::jsonb)
    from (select cuenta_contable, 1 as lado, round(sum(debe), 2) as d, 0::numeric as h
            from apertura_partidas where empresa_id = p_empresa and debe > 0 group by cuenta_contable
          union all
          select cuenta_contable, 2, 0, round(sum(haber), 2)
            from apertura_partidas where empresa_id = p_empresa and haber > 0 group by cuenta_contable) x
$$;

create or replace function public.cerrar_apertura(p_empresa uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cuenta uuid;
  v_dueña  uuid;
  v_corte  date;
  v_c      jsonb;
  v_sin    text;
  v_lin    jsonb;
  v_tot    numeric;
  v_num    int;
begin
  select a.cuenta_id, a.fecha_corte, e.cuenta_id into v_cuenta, v_corte, v_dueña
    from public.apertura a join public.empresas e on e.id = a.empresa_id
   where a.empresa_id = p_empresa;
  if v_cuenta is null then
    return jsonb_build_object('ok', false, 'motivo', 'Esta empresa no tiene apertura iniciada.');
  end if;
  if not (public.soy_superadmin() or v_cuenta = public.mi_cuenta_id()) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;

  v_c := public.apertura_cuadre(p_empresa);

  if (v_c->>'renglones')::int = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'La apertura no tiene ningun renglon.');
  end if;

  if not (v_c->>'cuadra')::boolean then
    return jsonb_build_object('ok', false, 'cuadre', v_c,
      'motivo', 'La apertura no cuadra: hay una diferencia de '
             || to_char(abs((v_c->>'diferencia')::numeric), 'FM999G999G999D00')
             || '. Revisa los saldos o registra la diferencia como patrimonio.');
  end if;

  select string_agg(descripcion, ', ') into v_sin
    from public.apertura_partidas
   where empresa_id = p_empresa and coalesce(trim(cuenta_contable), '') = '';
  if v_sin is not null then
    return jsonb_build_object('ok', false, 'motivo', 'Estos renglones no tienen cuenta contable: ' || v_sin || '.');
  end if;

  begin
    v_lin := public.contab_lineas_apertura(p_empresa);
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', sqlerrm || '. Corrige la cuenta de ese renglón.');
  end;
  select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into v_tot from jsonb_array_elements(v_lin) e;

  delete from public.asientos where origen_tabla = 'apertura' and origen_id = p_empresa;
  insert into public.asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
  values (coalesce(v_dueña, v_cuenta), p_empresa, to_char(v_corte, 'DD/MM/YYYY'), to_char(v_corte, 'YYYY-MM'),
          'Asiento de apertura al ' || to_char(v_corte, 'DD/MM/YYYY'), 'APERTURA', 'motor', 'apertura', p_empresa, v_lin, v_tot)
  returning numero into v_num;

  update public.apertura
     set estado = 'cerrada', cerrada_en = now()
   where empresa_id = p_empresa;

  return jsonb_build_object('ok', true, 'cuadre', v_c, 'asiento', v_num);
end;
$$;

create or replace function public.reabrir_apertura(p_empresa uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_cuenta uuid;
begin
  select cuenta_id into v_cuenta from public.apertura where empresa_id = p_empresa;
  if v_cuenta is null then
    return jsonb_build_object('ok', false, 'motivo', 'Esta empresa no tiene apertura.');
  end if;
  if not (public.soy_superadmin() or v_cuenta = public.mi_cuenta_id()) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;

  -- Mientras está abierta no hay asiento: el Balance no muestra un borrador.
  delete from public.asientos where origen_tabla = 'apertura' and origen_id = p_empresa;

  update public.apertura
     set estado = 'borrador',
         nota = coalesce(nota || E'\n', '')
              || to_char(now(), 'DD/MM/YYYY') || ' · reabierta: ' || coalesce(p_motivo, 'sin motivo')
   where empresa_id = p_empresa;

  return jsonb_build_object('ok', true);
end;
$$;

-- Si se borra la apertura, se va su asiento.
create or replace function public.apertura_borrar_asiento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from asientos where origen_tabla = 'apertura' and origen_id = old.empresa_id;
  return old;
end $$;
drop trigger if exists trg_apertura_borrar_asiento on public.apertura;
create trigger trg_apertura_borrar_asiento after delete on public.apertura
  for each row execute function public.apertura_borrar_asiento();

-- ── 3 · Traer los activos migrados ────────────────────────────────────────
-- Los activos en uso adquiridos hasta el corte y registrados a mano (los que
-- nacen de una factura ya tienen el asiento de su compra). Por cada uno, su
-- costo al Debe y lo que traía depreciado al Haber. No repite: se enlaza por
-- ref_tabla / ref_id. security invoker: la RLS decide qué ve quién.
create or replace function public.apertura_traer_activos(p_empresa uuid)
returns int language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_ap  apertura;
  a     activos_fijos;
  c     record;
  n     int := 0;
begin
  select * into v_ap from apertura where empresa_id = p_empresa;
  if v_ap.empresa_id is null then raise exception 'Esta empresa no tiene apertura iniciada.'; end if;
  for a in
    select * from activos_fijos f
     where f.empresa_id = p_empresa and f.libro_fiscal_id is null
       and coalesce(f.estado, 'en uso') = 'en uso'
       and contab_fecha_factura(f.fecha_adq) <= v_ap.fecha_corte and coalesce(f.costo, 0) > 0
       and not exists (select 1 from apertura_partidas p
                        where p.empresa_id = p_empresa and p.ref_tabla = 'activos_fijos' and p.ref_id = f.id)
     order by f.codigo
  loop
    select * into c from contab_cuentas_activo(a.categoria);
    insert into apertura_partidas (empresa_id, cuenta_id, grupo, descripcion, documento, fecha_doc, debe, haber,
                                   cuenta_contable, ref_tabla, ref_id)
    values (p_empresa, v_ap.cuenta_id, 'activo_fijo', coalesce(a.codigo || ' · ', '') || coalesce(a.nombre, 'Activo'),
            a.codigo, contab_fecha_factura(a.fecha_adq), round(a.costo, 2), 0, c.activo, 'activos_fijos', a.id);
    n := n + 1;
    if c.acumulada is not null and coalesce(a.depreciacion_inicial, 0) > 0.005 then
      insert into apertura_partidas (empresa_id, cuenta_id, grupo, descripcion, documento, fecha_doc, debe, haber,
                                     cuenta_contable, ref_tabla, ref_id)
      values (p_empresa, v_ap.cuenta_id, 'activo_fijo',
              'Depreciación acumulada · ' || coalesce(a.codigo || ' · ', '') || coalesce(a.nombre, 'Activo'),
              a.codigo, contab_fecha_factura(a.fecha_adq), 0, round(a.depreciacion_inicial, 2), c.acumulada, 'activos_fijos', a.id);
    end if;
  end loop;
  return n;
end $$;
grant execute on function public.apertura_traer_activos(uuid) to authenticated;

-- ── 4 · Cuadre con la Forma 30 ────────────────────────────────────────────
-- Contabilidad: lo que movieron 2.1.3.01 (débito) y 1.1.3.01 (crédito) los
-- asientos del período, sin la liquidación (F30-, que los cancela) ni la
-- apertura. Fiscal: el IVA del libro con las reglas del motor (anuladas fuera,
-- la NC resta) y, en modo recibos, el de los recibos de venta.
-- Quincena (contribuyente especial): la de la fila del libro, o por el día.
create or replace function public.contab_cuadre_iva(p_empresa uuid, p_periodo text, p_quincena int default null)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  modo_libro boolean;
  deb_c numeric; cred_c numeric; deb_f numeric; cred_f numeric; deb_r numeric;
begin
  select coalesce(fiscal_activo, true) into modo_libro from empresas where id = p_empresa;

  select round(coalesce(sum(case when e->>'cta' like '2.1.3.01%' then coalesce((e->>'haber')::numeric, 0) - coalesce((e->>'debe')::numeric, 0) end), 0), 2),
         round(coalesce(sum(case when e->>'cta' like '1.1.3.01%' then coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0) end), 0), 2)
    into deb_c, cred_c
    from asientos a
    left join libro_fiscal l on a.origen_tabla = 'libro_fiscal' and l.id = a.origen_id
    cross join lateral jsonb_array_elements(a.lineas) e
   where a.empresa_id = p_empresa and a.periodo = p_periodo
     and coalesce(a.referencia, '') !~ '^F30-' and coalesce(a.origen_tabla, '') <> 'apertura'
     and (p_quincena is null or p_quincena =
          case when l.id is not null
               then coalesce(l.quincena, case when extract(day from contab_fecha_factura(l.fecha)) <= 15 then 1 else 2 end)
               else case when extract(day from contab_fecha_factura(a.fecha)) <= 15 then 1 else 2 end end);

  select round(coalesce(sum(case when tipo = 'venta' then s end), 0), 2),
         round(coalesce(sum(case when tipo <> 'venta' then s end), 0), 2)
    into deb_f, cred_f
    from (select l.tipo, case when upper(trim(coalesce(l.tipo_doc, ''))) = 'NC' then -1 else 1 end * round(coalesce(l.iva, 0), 2) as s
            from libro_fiscal l
           where l.empresa_id = p_empresa
             and contab_periodo_de(l.fecha, l.periodo) = p_periodo
             and coalesce(l.tercero_nombre, '') !~* 'ANULAD'
             and round(coalesce(l.iva, 0), 2) > 0.005
             and (l.tipo <> 'venta' or modo_libro)
             and (p_quincena is null or p_quincena =
                  coalesce(l.quincena, case when extract(day from contab_fecha_factura(l.fecha)) <= 15 then 1 else 2 end))) x;

  if modo_libro is false then
    select round(coalesce(sum(case when upper(coalesce(f.tipo_doc, 'FV')) = 'NC' then -1 else 1 end * round(coalesce(f.iva, 0), 2)), 0), 2)
      into deb_r
      from facturas f
     where f.empresa_id = p_empresa and coalesce(f.tipo, 'venta') = 'venta'
       and coalesce(f.estado, '') !~* 'anulad'
       and to_char(contab_fecha_factura(f.fecha), 'YYYY-MM') = p_periodo
       and (p_quincena is null or p_quincena =
            case when extract(day from contab_fecha_factura(f.fecha)) <= 15 then 1 else 2 end);
    deb_f := deb_f + coalesce(deb_r, 0);
  end if;

  return jsonb_build_object(
    'periodo', p_periodo, 'quincena', p_quincena,
    'debito_contable', deb_c, 'debito_fiscal', deb_f, 'dif_debito', round(deb_c - deb_f, 2),
    'credito_contable', cred_c, 'credito_fiscal', cred_f, 'dif_credito', round(cred_c - cred_f, 2),
    'cuadra', abs(deb_c - deb_f) < 0.01 and abs(cred_c - cred_f) < 0.01);
end $$;
grant execute on function public.contab_cuadre_iva(uuid, text, int) to authenticated;

-- Comprobación
select (select count(*) from apertura_guia where cuenta is not null) as guias_con_cuenta,
       (select count(*) from apertura_partidas where cuenta_contable is null) as renglones_sin_cuenta,
       (select count(*) from apertura where estado = 'cerrada') as aperturas_cerradas_a_recerrar;
