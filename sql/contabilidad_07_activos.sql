-- ============================================================
-- DigiAccount · Contabilidad 07: depreciación mensual y baja de activos fijos
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _06. Re-ejecutable.
--
-- POR QUÉ: el botón de depreciación del navegador depreciaba de nuevo en cada
-- clic, siempre en línea recta, con una sola cuenta y la fecha del día. Ahora
-- la base guarda una cuota por activo y por mes (activos_depreciacion) y de
-- ellas sale el asiento DEPR-mm/aaaa del mes. Depreciar el mismo mes dos veces
-- lo rehace igual; no lo duplica.
-- Pruebas: sql/pruebas/contabilidad_07_pruebas.sql.
--
--   · La compra del activo ya contabiliza con el motor del libro (su cuenta
--     1.2.1.x es la cuenta_contable de la factura). Aquí solo vive su ficha.
--   · Cuota: arranca el mes siguiente al de la adquisición y nunca pasa de
--     costo − valor residual.
--       Línea recta: (costo − residual) / meses de vida útil.
--       Saldos decrecientes (doble): (costo − acumulada) × 2 / años / 12; si
--       repartir lo que falta entre los meses que quedan da más, se usa eso
--       (así termina en su vida útil). El último mes lleva lo que falte.
--   · depreciacion_inicial: lo que traía depreciado un activo migrado. Su
--     asiento de apertura va con el plan 5.
--   · Baja (venta o desincorporación): no se deprecia desde el mes de la baja.
--     Asiento: sale el activo por su costo y su acumulada; entra el cobro; la
--     diferencia es ganancia (4.2.3.01) o pérdida (6.3.1.05).
--   · security invoker: cada quien deprecia y da de baja solo los activos de
--     las empresas que su RLS le deja ver.
-- ============================================================

alter table public.activos_fijos add column if not exists valor_residual numeric not null default 0;
alter table public.activos_fijos add column if not exists depreciacion_inicial numeric not null default 0;
alter table public.activos_fijos add column if not exists libro_fiscal_id uuid references public.libro_fiscal(id) on delete set null;
alter table public.activos_fijos add column if not exists estado text not null default 'en uso';
alter table public.activos_fijos add column if not exists fecha_baja date;

alter table public.activos_fijos drop constraint if exists activos_fijos_estado_valido;
alter table public.activos_fijos add constraint activos_fijos_estado_valido
  check (estado in ('en uso', 'vendido', 'desincorporado'));

comment on column public.activos_fijos.depreciacion_inicial is
  'Depreciación que ya traía el activo al registrarlo (migraciones); la del sistema va en activos_depreciacion';
comment on column public.activos_fijos.depreciacion_acum is
  'depreciacion_inicial + las cuotas de activos_depreciacion; la mantiene contab_depreciar';

-- La cuenta de grupo 2.1.5 no recibe movimientos: las otras deducciones de la
-- nómina (caja de ahorro, préstamos, anticipos) van a su cuenta de detalle.
insert into public.plan_cuentas_base (codigo, nombre, tipo, naturaleza, uso) values
  ('2.1.5.01', 'Otras cuentas por pagar', 'Cuenta', 'Acreedora', null)
on conflict (codigo) do update
  set nombre = excluded.nombre, tipo = excluded.tipo,
      naturaleza = excluded.naturaleza, uso = excluded.uso;

create table if not exists public.activos_depreciacion (
  id         uuid primary key default gen_random_uuid(),
  activo_id  uuid not null references public.activos_fijos(id) on delete cascade,
  empresa_id uuid not null,
  cuenta_id  uuid,
  periodo    text not null check (periodo ~ '^[0-9]{4}-[0-9]{2}$'),
  monto      numeric(18,2) not null check (monto > 0),
  creado_en  timestamptz not null default now(),
  unique (activo_id, periodo)
);
create index if not exists activos_depreciacion_empresa_periodo on public.activos_depreciacion (empresa_id, periodo);

alter table public.activos_depreciacion enable row level security;
drop policy if exists activos_depreciacion_todo on public.activos_depreciacion;
create policy activos_depreciacion_todo on public.activos_depreciacion for all
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
grant select, insert, update, delete on public.activos_depreciacion to authenticated;

-- Las cuentas de cada categoría. Un terreno no tiene depreciación.
create or replace function public.contab_cuentas_activo(p_categoria text)
returns table (activo text, acumulada text, gasto text)
language sql immutable set search_path = public, pg_temp as $$
  select * from (values
    (case
       when lower(coalesce(p_categoria, '')) like '%terreno%' then '1.2.1.01'
       when lower(coalesce(p_categoria, '')) ~ '(inmueble|edificio)' then '1.2.1.02'
       when lower(coalesce(p_categoria, '')) like '%maquinaria%' then '1.2.1.03'
       when lower(coalesce(p_categoria, '')) ~ 'veh[ií]culo' then '1.2.1.05'
       else '1.2.1.04' end,
     case
       when lower(coalesce(p_categoria, '')) like '%terreno%' then null
       when lower(coalesce(p_categoria, '')) ~ '(inmueble|edificio)' then '1.2.1.07'
       when lower(coalesce(p_categoria, '')) like '%maquinaria%' then '1.2.1.08'
       when lower(coalesce(p_categoria, '')) ~ 'veh[ií]culo' then '1.2.1.10'
       else '1.2.1.09' end,
     case
       when lower(coalesce(p_categoria, '')) like '%terreno%' then null
       when lower(coalesce(p_categoria, '')) ~ '(inmueble|edificio)' then '6.1.1.17'
       when lower(coalesce(p_categoria, '')) like '%maquinaria%' then '6.1.1.18'
       when lower(coalesce(p_categoria, '')) ~ 'veh[ií]culo' then '6.1.1.20'
       else '6.1.1.19' end)
  ) v(activo, acumulada, gasto)
$$;

-- La cuota de un activo en un mes, según lo depreciado ANTES de ese mes.
create or replace function public.contab_cuota_depreciacion(a public.activos_fijos, p_periodo text)
returns numeric language plpgsql stable set search_path = public, pg_temp as $$
declare
  adq date := contab_fecha_factura(a.fecha_adq);
  vida int := coalesce(a.vida_util, 0);
  costo numeric := coalesce(a.costo, 0);
  base numeric := coalesce(a.costo, 0) - coalesce(a.valor_residual, 0);
  acum numeric;
  falta numeric;
  quedan int;
  q numeric;
begin
  if (contab_cuentas_activo(a.categoria)).gasto is null then return 0; end if;
  if adq is null or vida <= 0 or to_char(adq, 'YYYY-MM') >= p_periodo then return 0; end if;
  if a.fecha_baja is not null and to_char(a.fecha_baja, 'YYYY-MM') <= p_periodo then return 0; end if;
  select coalesce(a.depreciacion_inicial, 0) + coalesce(sum(monto), 0) into acum
    from activos_depreciacion where activo_id = a.id and periodo < p_periodo;
  falta := round(base - acum, 2);
  if falta < 0.005 then return 0; end if;
  -- Los meses de vida que quedan, contando este.
  quedan := vida * 12 - ((substr(p_periodo, 1, 4)::int * 12 + substr(p_periodo, 6, 2)::int)
                         - (extract(year from adq)::int * 12 + extract(month from adq)::int) - 1);
  if quedan <= 1 then return falta; end if;
  if lower(coalesce(a.metodo, '')) like '%decreciente%' then
    q := greatest((costo - acum) * 2 / vida / 12, falta / quedan);
  else
    q := base / (vida * 12);
  end if;
  return least(round(q, 2), falta);
end $$;

-- Rehace las cuotas de un mes y su asiento DEPR-mm/aaaa (una línea de gasto y
-- una de acumulada por cuenta). Devuelve el total del mes.
create or replace function public.contab_depreciar(p_empresa uuid, p_periodo text)
returns numeric language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  a activos_fijos;
  q numeric;
  lin jsonb;
  tot numeric;
  dueña uuid;
  ref text;
  fec text;
begin
  if coalesce(p_periodo, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Período inválido: %', p_periodo; end if;
  select cuenta_id into dueña from empresas where id = p_empresa;
  if not found then raise exception 'La empresa no existe o no tienes acceso a ella'; end if;
  perform pg_advisory_xact_lock(hashtext('depreciacion:' || p_empresa::text));

  delete from activos_depreciacion where empresa_id = p_empresa and periodo = p_periodo;
  for a in select * from activos_fijos where empresa_id = p_empresa order by codigo loop
    q := contab_cuota_depreciacion(a, p_periodo);
    if q > 0 then
      insert into activos_depreciacion (activo_id, empresa_id, cuenta_id, periodo, monto)
      values (a.id, a.empresa_id, coalesce(dueña, a.cuenta_id), p_periodo, q);
    end if;
  end loop;
  update activos_fijos f
     set depreciacion_acum = coalesce(f.depreciacion_inicial, 0)
                           + coalesce((select sum(d.monto) from activos_depreciacion d where d.activo_id = f.id), 0)
   where f.empresa_id = p_empresa;

  select round(coalesce(sum(monto), 0), 2) into tot
    from activos_depreciacion where empresa_id = p_empresa and periodo = p_periodo;
  ref := 'DEPR-' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4);
  if tot < 0.005 then
    delete from asientos where empresa_id = p_empresa and origen_tabla = 'depreciacion' and referencia = ref;
    return 0;
  end if;

  with g as (
    select c.gasto, c.acumulada, round(sum(d.monto), 2) m
      from activos_depreciacion d
      join activos_fijos f on f.id = d.activo_id
      cross join lateral contab_cuentas_activo(f.categoria) c
     where d.empresa_id = p_empresa and d.periodo = p_periodo
     group by c.gasto, c.acumulada
  )
  select jsonb_agg(e order by k) into lin from (
    select '1' || gasto k, jsonb_build_object('cta', contab_cta(gasto, p_empresa), 'debe', m, 'haber', 0) e from g
    union all
    select '2' || acumulada, jsonb_build_object('cta', contab_cta(acumulada, p_empresa), 'debe', 0, 'haber', m) from g
  ) x;

  fec := to_char((to_date(p_periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, 'DD/MM/YYYY');
  update asientos set fecha = fec, periodo = p_periodo, lineas = lin, total = tot,
                      descripcion = 'Depreciación de activos fijos · ' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4)
   where empresa_id = p_empresa and origen_tabla = 'depreciacion' and referencia = ref;
  if not found then
    insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, lineas, total)
    values (dueña, p_empresa, fec, p_periodo,
            'Depreciación de activos fijos · ' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4),
            ref, 'motor', 'depreciacion', lin, tot);
  end if;
  return tot;
end $$;

-- Venta (precio > 0) o desincorporación (precio 0) de un activo.
-- p_cuenta_cobro: dónde entra el dinero (por defecto 1.1.1.03 Bancos).
create or replace function public.contab_baja_activo(p_activo uuid, p_fecha date, p_precio numeric, p_cuenta_cobro text default null)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  a activos_fijos;
  c record;
  per text;
  p text;
  precio numeric := round(coalesce(p_precio, 0), 2);
  acum numeric;
  dif numeric;
  cobro text := coalesce(nullif(trim(p_cuenta_cobro), ''), '1.1.1.03');
  lin jsonb := '[]'::jsonb;
  dueña uuid;
  vendido boolean := round(coalesce(p_precio, 0), 2) > 0;
begin
  select * into a from activos_fijos where id = p_activo for update;
  if not found then raise exception 'El activo no existe o no tienes acceso a él'; end if;
  if a.estado <> 'en uso' then raise exception 'El activo % ya fue dado de baja (%)', a.codigo, a.estado; end if;
  if p_fecha is null then raise exception 'Falta la fecha de la baja'; end if;
  if precio < 0 then raise exception 'El precio de venta no puede ser negativo'; end if;
  if contab_fecha_factura(a.fecha_adq) > p_fecha then raise exception 'La baja no puede ser antes de la adquisición'; end if;
  per := to_char(p_fecha, 'YYYY-MM');
  select cuenta_id into dueña from empresas where id = a.empresa_id;
  perform pg_advisory_xact_lock(hashtext('depreciacion:' || a.empresa_id::text));

  update activos_fijos set estado = case when vendido then 'vendido' else 'desincorporado' end, fecha_baja = p_fecha
   where id = a.id;
  -- Los meses ya depreciados desde la baja se rehacen sin este activo.
  for p in select distinct periodo from activos_depreciacion where activo_id = a.id and periodo >= per order by periodo loop
    perform contab_depreciar(a.empresa_id, p);
  end loop;

  select round(coalesce(a.depreciacion_inicial, 0) + coalesce(sum(monto), 0), 2) into acum
    from activos_depreciacion where activo_id = a.id;
  select * into c from contab_cuentas_activo(a.categoria);
  dif := round(precio + acum - coalesce(a.costo, 0), 2);

  if acum > 0 and c.acumulada is not null then
    lin := lin || jsonb_build_object('cta', contab_cta(c.acumulada, a.empresa_id), 'debe', acum, 'haber', 0);
  end if;
  if precio > 0 then
    lin := lin || jsonb_build_object('cta', contab_cta(cobro, a.empresa_id), 'debe', precio, 'haber', 0);
  end if;
  if dif < 0 then
    lin := lin || jsonb_build_object('cta', contab_cta('6.3.1.05', a.empresa_id), 'debe', -dif, 'haber', 0);
  end if;
  lin := lin || jsonb_build_object('cta', contab_cta(c.activo, a.empresa_id), 'debe', 0, 'haber', round(coalesce(a.costo, 0), 2));
  if dif > 0 then
    lin := lin || jsonb_build_object('cta', contab_cta('4.2.3.01', a.empresa_id), 'debe', 0, 'haber', dif);
  end if;

  delete from asientos where origen_tabla = 'activos_fijos' and origen_id = a.id;
  insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
  values (coalesce(dueña, a.cuenta_id), a.empresa_id, to_char(p_fecha, 'DD/MM/YYYY'), per,
          case when vendido then 'Venta del activo ' else 'Desincorporación del activo ' end
            || coalesce(a.codigo, '') || ' · ' || coalesce(a.nombre, ''),
          'BAJA-' || coalesce(a.codigo, ''), 'motor', 'activos_fijos', a.id, lin,
          (select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) from jsonb_array_elements(lin) e));
end $$;

-- Deshace una baja hecha por error: borra su asiento y el activo vuelve a
-- estar en uso. Los meses posteriores se deprecian de nuevo al cerrarlos.
create or replace function public.contab_anular_baja(p_activo uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare a activos_fijos;
begin
  select * into a from activos_fijos where id = p_activo for update;
  if not found then raise exception 'El activo no existe o no tienes acceso a él'; end if;
  if a.estado = 'en uso' then return; end if;
  delete from asientos where origen_tabla = 'activos_fijos' and origen_id = a.id;
  update activos_fijos set estado = 'en uso', fecha_baja = null where id = a.id;
end $$;

grant execute on function public.contab_cuentas_activo(text) to authenticated;
grant execute on function public.contab_depreciar(uuid, text) to authenticated;
grant execute on function public.contab_baja_activo(uuid, date, numeric, text) to authenticated;
grant execute on function public.contab_anular_baja(uuid) to authenticated;

-- Comprobación: las columnas nuevas y las funciones.
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'activos_fijos'
           and column_name in ('valor_residual', 'depreciacion_inicial', 'libro_fiscal_id', 'estado', 'fecha_baja')) as columnas_nuevas,
       (select count(*) from pg_proc where proname in ('contab_depreciar', 'contab_baja_activo', 'contab_anular_baja', 'contab_cuota_depreciacion')) as funciones;
