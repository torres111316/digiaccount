-- ============================================================
-- Pruebas de sql/contabilidad_12_diferencial.sql (diferencial cambiario y
-- revaluación de los saldos en dólares)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 12».
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
create function pg_temp.mov(fila uuid) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) from asientos where origen_tabla = 'movimientos_tesoreria' and origen_id = fila), '(sin asiento)')
$$;
create function pg_temp.rev(per text) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) || ' @' || fecha from asientos
                    where empresa_id = 'e0000000-0000-0000-0000-000000000121' and origen_tabla = 'revaluacion'
                      and referencia = 'REV-' || substr(per, 6, 2) || '/' || substr(per, 1, 4)), '(sin asiento)')
$$;

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000121', 'Cuenta empresa', 'empresa', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000121', 'a0000000-0000-0000-0000-000000000121', 'Empresa dólares', false);
insert into cuentas_tesoreria (id, cuenta_id, empresa_id, nombre, tipo, moneda) values
  ('b0000000-0000-0000-0000-000000000121', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'Banco Bs', 'Corriente', 'Bs'),
  ('b0000000-0000-0000-0000-000000000122', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'Cuenta USD', 'Corriente', 'USD');
insert into tasas_cambio (fecha, moneda, tasa, fuente) values
  ('2026-03-01', 'USD', 871.3689, 'BCV'), ('2026-03-15', 'USD', 897.5383, 'BCV'), ('2026-03-31', 'USD', 900, 'BCV'),
  ('2026-04-02', 'USD', 905, 'BCV'), ('2026-04-06', 'USD', 910, 'BCV');

-- El caso de MARIA GALLARDO: REC-000015, 41 USD a 871,3689 = Bs 35.726,13.
insert into facturas (id, cuenta_id, empresa_id, numero, tipo, tipo_doc, fecha, cliente_nombre, subtotal, iva, igtf_monto, total, estado, moneda, tasa, total_usd) values
  ('f0000000-0000-0000-0000-000000000121', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'REC-000015', 'venta', 'FV', '02/03/2026', 'CLIENTE', 30798.39, 4927.74, 0, 35726.13, 'Por cobrar', 'USD', 871.3689, 41),
  ('f0000000-0000-0000-0000-000000000122', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'REC-000016', 'venta', 'FV', '20/03/2026', 'CLIENTE', 17600, 0, 0, 17600, 'Por cobrar', 'USD', 880, 20);

-- Se cobra completo el 15/03 en bolívares, a 897,5383.
insert into movimientos_tesoreria (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, concepto, tipo, referencia, monto, factura_ref) values
  ('70000000-0000-0000-0000-000000000121', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'b0000000-0000-0000-0000-000000000121',
   '15/03/26', 'Cobro REC-15', 'ingreso', 'R1', 36799.07, 'REC-000015');
select pg_temp.igual('cobro en Bs de un recibo en dólares: CxC a la tasa del recibo y la ganancia en cambio', pg_temp.mov('70000000-0000-0000-0000-000000000121'),
  '1.1.1.03.01 D36799.07 H0.00 | 1.1.2.01 D0.00 H35726.13 | 4.2.2.01 D0.00 H1072.94');

-- Cuenta en dólares: un ingreso de 10 USD el 15/03 queda en Bs a la tasa del día y guarda los dólares.
insert into movimientos_tesoreria (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, concepto, tipo, referencia, monto, cuenta_contra) values
  ('70000000-0000-0000-0000-000000000122', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'b0000000-0000-0000-0000-000000000122',
   '15/03/26', 'Aporte en USD', 'ingreso', 'U1', 10, '3.1.1.01');
select pg_temp.igual('cuenta USD: el asiento en bolívares a la tasa del día', pg_temp.mov('70000000-0000-0000-0000-000000000122'), '1.1.1.03.02 D8975.38 H0.00 | 3.1.1.01 D0.00 H8975.38');
select pg_temp.igual('cuenta USD: la línea del banco guarda los dólares',
  (select (lineas -> 0 ->> 'usd') from asientos where origen_tabla = 'movimientos_tesoreria' and origen_id = '70000000-0000-0000-0000-000000000122'), '10.00');

-- Una línea del estado de cuenta de la cuenta USD (+5 USD el 20/03) se concilia en Bs.
insert into extracto_bancario (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, referencia, monto, periodo, huella, clase, cuenta_contra, estado) values
  ('c0000000-0000-0000-0000-000000000121', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'b0000000-0000-0000-0000-000000000122',
   '20/03/2026', 'INTERES', 'I1', 5, '2026-03', 'u1', 'otra', '4.2.1.01', 'conciliada');
select pg_temp.igual('línea de una cuenta USD conciliada en Bs a la tasa del día',
  (select pg_temp.lin(lineas) from asientos where origen_tabla = 'extracto_bancario' and origen_id = 'c0000000-0000-0000-0000-000000000121'), '1.1.1.03.02 D4487.69 H0.00 | 4.2.1.01 D0.00 H4487.69');

-- Revaluación de marzo (tasa de cierre 900):
--   cuenta USD: 15 USD × 900 = 13.500 − (8.975,38 + 4.487,69) = +36,93
--   REC-000016 abierto: 20 USD × (900 − 880) = +400
select pg_temp.igual('revaluación de marzo: lo que ajusta',
  (select (r->>'ganancia') || ' / ' || (r->>'perdida') from (select contab_revaluar('e0000000-0000-0000-0000-000000000121', '2026-03') r) q), '436.93 / 0.00');
select pg_temp.igual('el asiento de la revaluación, al cierre del mes', pg_temp.rev('2026-03'),
  '1.1.1.03.02 D36.93 H0.00 | 4.2.2.01 D0.00 H36.93 | 1.1.2.01 D400.00 H0.00 | 4.2.2.01 D0.00 H400.00 @31/03/2026');
select contab_revaluar('e0000000-0000-0000-0000-000000000121', '2026-03');
select pg_temp.igual('correrla dos veces: un solo asiento',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000121' and origen_tabla = 'revaluacion'), '1');

-- Abril: REC-000016 se cobra en dos partes a tasas distintas.
insert into movimientos_tesoreria (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, concepto, tipo, referencia, monto, factura_ref) values
  ('70000000-0000-0000-0000-000000000123', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'b0000000-0000-0000-0000-000000000121',
   '02/04/26', 'Abono 1', 'ingreso', 'R2', 9050, 'REC-000016'),
  ('70000000-0000-0000-0000-000000000124', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'b0000000-0000-0000-0000-000000000121',
   '06/04/26', 'Abono 2', 'ingreso', 'R3', 13650, 'REC-000016');
select pg_temp.igual('primer abono (10 USD a 905): su diferencial', pg_temp.mov('70000000-0000-0000-0000-000000000123'),
  '1.1.1.03.01 D9050.00 H0.00 | 1.1.2.01 D0.00 H8800.00 | 4.2.2.01 D0.00 H250.00');
select pg_temp.igual('segundo abono (15 USD a 910): completa los 20 USD, el resto a anticipos', pg_temp.mov('70000000-0000-0000-0000-000000000124'),
  '1.1.1.03.01 D13650.00 H0.00 | 1.1.2.01 D0.00 H8800.00 | 2.1.6.01 D0.00 H4550.00 | 4.2.2.01 D0.00 H300.00');

-- Revaluación de abril (tasa de cierre 910):
--   cuenta USD: 15 USD × 910 = 13.650 − 13.463,07 − 36,93 ya revaluado = +150
--   REC-000016 ya cobrado: se revierten los 400 de marzo
select pg_temp.igual('revaluación de abril: la cuenta USD sube y lo de la CxC cobrada se revierte', pg_temp.rev('2026-04'), '(sin asiento)');
select contab_revaluar('e0000000-0000-0000-0000-000000000121', '2026-04');
select pg_temp.igual('revaluación de abril', pg_temp.rev('2026-04'),
  '1.1.1.03.02 D150.00 H0.00 | 4.2.2.01 D0.00 H150.00 | 6.3.1.03 D400.00 H0.00 | 1.1.2.01 D0.00 H400.00 @30/04/2026');

-- Sin tasa del BCV no se inventa: una cuenta USD antes de la primera tasa no hace asiento.
insert into movimientos_tesoreria (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, concepto, tipo, referencia, monto, cuenta_contra) values
  ('70000000-0000-0000-0000-000000000125', 'a0000000-0000-0000-0000-000000000121', 'e0000000-0000-0000-0000-000000000121', 'b0000000-0000-0000-0000-000000000122',
   '15/01/26', 'Sin tasa', 'ingreso', 'U0', 1, '3.1.1.01');
select pg_temp.igual('sin tasa del BCV: sin asiento', pg_temp.mov('70000000-0000-0000-0000-000000000125'), '(sin asiento)');

select pg_temp.igual('todos los asientos cuadran',
  (select count(*)::text from asientos a where a.empresa_id = 'e0000000-0000-0000-0000-000000000121'
      and (select round(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 2) from jsonb_array_elements(a.lineas) e) <> 0), '0');

select 'TODO OK · contabilidad 12';
rollback;
