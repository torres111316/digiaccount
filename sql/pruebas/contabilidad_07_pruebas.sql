-- ============================================================
-- Pruebas de sql/contabilidad_07_activos.sql (depreciación y baja de activos fijos)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 07».
-- Toda consulta filtra por la empresa de prueba.
-- ============================================================
begin;

create function pg_temp.igual(caso text, obtenido text, esperado text) returns void language plpgsql as $$
begin
  if obtenido is distinct from esperado then
    raise exception 'FALLA: % → %   (esperado %)', caso, coalesce(obtenido, '(null)'), esperado;
  end if;
end $$;
create function pg_temp.lin(j jsonb) returns text language sql as $$
  select coalesce(string_agg(split_part(e->>'cta', ' · ', 1)
           || ' D' || round(coalesce((e->>'debe')::numeric, 0), 2)
           || ' H' || round(coalesce((e->>'haber')::numeric, 0), 2), ' | ' order by n), '(null)')
    from jsonb_array_elements(j) with ordinality as t(e, n)
$$;
-- La cuota de un activo en un mes ('0' si no tiene).
create function pg_temp.cuota(activo uuid, per text) returns text language sql as $$
  select coalesce((select round(monto, 2)::text from activos_depreciacion where activo_id = activo and periodo = per), '0')
$$;
create function pg_temp.depr(per text) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) from asientos
                    where empresa_id = 'e0000000-0000-0000-0000-000000000071' and origen_tabla = 'depreciacion'
                      and referencia = 'DEPR-' || substr(per, 6, 2) || '/' || substr(per, 1, 4)), '(sin asiento)')
$$;
create function pg_temp.baja(activo uuid) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) from asientos where origen_tabla = 'activos_fijos' and origen_id = activo), '(sin asiento)')
$$;

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000071', 'Firma de prueba', 'contador', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000071', 'a0000000-0000-0000-0000-000000000071', 'Empresa activos', true);

insert into activos_fijos (id, cuenta_id, empresa_id, codigo, nombre, categoria, fecha_adq, costo, vida_util, metodo, valor_residual, depreciacion_inicial) values
  -- línea recta, sin residual: 1200 / 12 meses
  ('af000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000071', 'e0000000-0000-0000-0000-000000000071', 'AF-1', 'Computador', 'Equipos', '15/01/2026', 1200, 1, 'Línea recta', 0, 0),
  -- con valor residual: (1000 − 400) / 12
  ('af000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000071', 'e0000000-0000-0000-0000-000000000071', 'AF-2', 'Torno', 'Maquinaria', '10/06/2026', 1000, 1, 'Línea recta', 400, 0),
  -- saldos decrecientes: 1000 × 2 / 5 / 12
  ('af000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000071', 'e0000000-0000-0000-0000-000000000071', 'AF-3', 'Escritorios', 'Mobiliario', '20/03/2026', 1000, 5, 'Saldos decrecientes', 0, 0),
  -- un terreno no se deprecia
  ('af000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000071', 'e0000000-0000-0000-0000-000000000071', 'AF-4', 'Terreno', 'Terrenos', '01/01/2026', 5000, 20, 'Línea recta', 0, 0),
  -- migrado con 990 ya depreciados: solo le faltan 10
  ('af000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000071', 'e0000000-0000-0000-0000-000000000071', 'AF-5', 'Impresora', 'Equipos', '01/01/2025', 1000, 5, 'Línea recta', 0, 990),
  -- se vende y se desincorpora a medio depreciar
  ('af000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000071', 'e0000000-0000-0000-0000-000000000071', 'AF-6', 'Laptop vendida', 'Equipos', '15/08/2026', 1200, 1, 'Línea recta', 0, 0),
  ('af000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000071', 'e0000000-0000-0000-0000-000000000071', 'AF-7', 'Laptop dañada', 'Equipos', '15/08/2026', 1200, 1, 'Línea recta', 0, 0);

-- Enero: el mes de la compra no se deprecia.
select contab_depreciar('e0000000-0000-0000-0000-000000000071', '2026-01');
select pg_temp.igual('el mes de la compra no lleva cuota', pg_temp.cuota('af000000-0000-0000-0000-000000000001', '2026-01'), '0');
select pg_temp.igual('al migrado solo le falta lo que le falta', pg_temp.cuota('af000000-0000-0000-0000-000000000005', '2026-01'), '10.00');

-- Febrero, dos veces: una sola cuota y un solo asiento.
select pg_temp.igual('febrero: la cuota en línea recta',
  (select contab_depreciar('e0000000-0000-0000-0000-000000000071', '2026-02'))::text, '100.00');
select contab_depreciar('e0000000-0000-0000-0000-000000000071', '2026-02');
select pg_temp.igual('depreciar dos veces el mismo mes: una sola cuota',
  (select count(*)::text from activos_depreciacion where activo_id = 'af000000-0000-0000-0000-000000000001' and periodo = '2026-02'), '1');
select pg_temp.igual('depreciar dos veces el mismo mes: un solo asiento',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000071' and referencia = 'DEPR-02/2026'), '1');
select pg_temp.igual('el asiento de febrero', pg_temp.depr('2026-02'), '6.1.1.19 D100.00 H0.00 | 1.2.1.09 D0.00 H100.00');
select pg_temp.igual('el asiento se fecha el último día del mes',
  (select fecha || ' ' || periodo from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000071' and referencia = 'DEPR-02/2026'), '28/02/2026 2026-02');
select pg_temp.igual('el migrado ya no deprecia más', pg_temp.cuota('af000000-0000-0000-0000-000000000005', '2026-02'), '0');

-- Marzo de 2026 a agosto de 2027, mes por mes.
do $$
declare d date;
begin
  for d in select generate_series('2026-03-01'::date, '2027-08-01'::date, interval '1 month')::date loop
    perform contab_depreciar('e0000000-0000-0000-0000-000000000071', to_char(d, 'YYYY-MM'));
  end loop;
end $$;

select pg_temp.igual('con residual: la cuota', pg_temp.cuota('af000000-0000-0000-0000-000000000002', '2026-07'), '50.00');
select pg_temp.igual('con residual: nunca pasa de costo menos residual',
  (select sum(monto)::text from activos_depreciacion where activo_id = 'af000000-0000-0000-0000-000000000002'), '600.00');
select pg_temp.igual('con residual: después del último mes, nada', pg_temp.cuota('af000000-0000-0000-0000-000000000002', '2027-07'), '0');
select pg_temp.igual('la depreciación acumulada de la ficha queda al día',
  (select round(depreciacion_acum, 2)::text from activos_fijos where id = 'af000000-0000-0000-0000-000000000002'), '600.00');
select pg_temp.igual('línea recta: termina justo en el costo',
  (select sum(monto)::text from activos_depreciacion where activo_id = 'af000000-0000-0000-0000-000000000001'), '1200.00');
select pg_temp.igual('saldos decrecientes: el primer mes', pg_temp.cuota('af000000-0000-0000-0000-000000000003', '2026-04'), '33.33');
select pg_temp.igual('saldos decrecientes: el segundo, sobre lo que queda', pg_temp.cuota('af000000-0000-0000-0000-000000000003', '2026-05'), '32.22');
select pg_temp.igual('un terreno no se deprecia',
  (select count(*)::text from activos_depreciacion where activo_id = 'af000000-0000-0000-0000-000000000004'), '0');
select pg_temp.igual('el migrado deprecia en total solo lo que le faltaba',
  (select sum(monto)::text from activos_depreciacion where activo_id = 'af000000-0000-0000-0000-000000000005'), '10.00');
select pg_temp.igual('las categorías van a su cuenta (maquinaria)', pg_temp.depr('2027-01'),
  '6.1.1.18 D50.00 H0.00 | 6.1.1.19 D' || (select round(sum(d.monto), 2) from activos_depreciacion d join activos_fijos f on f.id = d.activo_id
                                              where d.empresa_id = 'e0000000-0000-0000-0000-000000000071' and d.periodo = '2027-01' and f.categoria <> 'Maquinaria')
  || ' H0.00 | 1.2.1.08 D0.00 H50.00 | 1.2.1.09 D0.00 H' || (select round(sum(d.monto), 2) from activos_depreciacion d join activos_fijos f on f.id = d.activo_id
                                              where d.empresa_id = 'e0000000-0000-0000-0000-000000000071' and d.periodo = '2027-01' and f.categoria <> 'Maquinaria'));

-- Venta el 10/12/2026 de un activo con 3 cuotas (septiembre a noviembre).
select contab_baja_activo('af000000-0000-0000-0000-000000000006', '2026-12-10', 1000, null);
select pg_temp.igual('venta: el asiento con la ganancia', pg_temp.baja('af000000-0000-0000-0000-000000000006'),
  '1.2.1.09 D300.00 H0.00 | 1.1.1.03 D1000.00 H0.00 | 1.2.1.04 D0.00 H1200.00 | 4.2.3.01 D0.00 H100.00');
select pg_temp.igual('venta: no se deprecia desde el mes de la baja',
  (select count(*)::text from activos_depreciacion where activo_id = 'af000000-0000-0000-0000-000000000006' and periodo >= '2026-12'), '0');
select pg_temp.igual('venta: la ficha queda vendida',
  (select estado || ' ' || fecha_baja from activos_fijos where id = 'af000000-0000-0000-0000-000000000006'), 'vendido 2026-12-10');
select pg_temp.igual('venta: el asiento va en la fecha de la baja',
  (select fecha || ' ' || periodo from asientos where origen_tabla = 'activos_fijos' and origen_id = 'af000000-0000-0000-0000-000000000006'), '10/12/2026 2026-12');

-- Desincorporación (sin precio): la pérdida.
select contab_baja_activo('af000000-0000-0000-0000-000000000007', '2026-12-10', 0, null);
select pg_temp.igual('desincorporación: el asiento con la pérdida', pg_temp.baja('af000000-0000-0000-0000-000000000007'),
  '1.2.1.09 D300.00 H0.00 | 6.3.1.05 D900.00 H0.00 | 1.2.1.04 D0.00 H1200.00');

-- Dar de baja dos veces se niega.
do $$
begin
  perform contab_baja_activo('af000000-0000-0000-0000-000000000007', '2026-12-11', 0, null);
  raise exception 'FALLA: se dio de baja dos veces el mismo activo';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
end $$;

-- Deshacer la baja: el activo vuelve a estar en uso y sin el asiento.
select contab_anular_baja('af000000-0000-0000-0000-000000000007');
select pg_temp.igual('anular la baja borra su asiento', pg_temp.baja('af000000-0000-0000-0000-000000000007'), '(sin asiento)');
select pg_temp.igual('anular la baja deja el activo en uso',
  (select estado || coalesce(fecha_baja::text, '') from activos_fijos where id = 'af000000-0000-0000-0000-000000000007'), 'en uso');

-- Cada mes, el asiento suma lo mismo que sus cuotas (también los rehechos por las bajas).
select pg_temp.igual('cada asiento de depreciación suma sus cuotas',
  (select count(*)::text from (
     select d.periodo, round(sum(d.monto), 2) s from activos_depreciacion d
      where d.empresa_id = 'e0000000-0000-0000-0000-000000000071' group by d.periodo) c
    left join asientos a on a.empresa_id = 'e0000000-0000-0000-0000-000000000071' and a.origen_tabla = 'depreciacion'
                        and a.periodo = c.periodo
   where a.total is distinct from c.s), '0');
select pg_temp.igual('todos los asientos cuadran',
  (select count(*)::text from asientos a where a.empresa_id = 'e0000000-0000-0000-0000-000000000071'
      and (select round(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 2) from jsonb_array_elements(a.lineas) e) <> 0), '0');

select 'TODO OK · contabilidad 07';
rollback;
