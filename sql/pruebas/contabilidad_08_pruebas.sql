-- ============================================================
-- Pruebas de sql/contabilidad_08_conciliacion.sql (subcuenta por banco y
-- asiento de cada línea del estado de cuenta)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 08».
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
create function pg_temp.asi(linea uuid) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) from asientos where origen_tabla = 'extracto_bancario' and origen_id = linea), '(sin asiento)')
$$;
create function pg_temp.sub(p_banco uuid) returns text language sql as $$
  select cuenta_contable from cuentas_tesoreria where id = p_banco
$$;

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000081', 'Firma de prueba', 'contador', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000081', 'a0000000-0000-0000-0000-000000000081', 'Empresa banco', true);
-- Una cuenta propia «Banesco» que la empresa ya tenía: el banco Banesco la reusa.
insert into cuentas_contables (cuenta_id, empresa_id, codigo, nombre, tipo, naturaleza) values
  ('a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', '1.1.1.03.01', 'Banesco', 'Cuenta', 'Deudora');

insert into cuentas_tesoreria (id, cuenta_id, empresa_id, nombre, banco, tipo, moneda) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'Banesco', 'Banesco', 'Corriente', 'Bs'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'Banco de Venezuela', 'BDV', 'Corriente', 'Bs'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'Caja (Efectivo)', null, 'Efectivo / Caja', 'Bs');

select pg_temp.igual('un banco con cuenta propia del mismo nombre la reusa', pg_temp.sub('b0000000-0000-0000-0000-000000000001'), '1.1.1.03.01');
select pg_temp.igual('el banco siguiente toma la subcuenta siguiente', pg_temp.sub('b0000000-0000-0000-0000-000000000002'), '1.1.1.03.02');
select pg_temp.igual('la caja va bajo 1.1.1.01', pg_temp.sub('b0000000-0000-0000-0000-000000000003'), '1.1.1.01.01');
select pg_temp.igual('la subcuenta nueva queda en el plan de la empresa',
  (select nombre from cuentas_contables where empresa_id = 'e0000000-0000-0000-0000-000000000081' and codigo = '1.1.1.03.02'), 'Banco de Venezuela');
select pg_temp.igual('no se duplica la cuenta propia reusada',
  (select count(*)::text from cuentas_contables where empresa_id = 'e0000000-0000-0000-0000-000000000081' and codigo = '1.1.1.03.01'), '1');

insert into extracto_bancario (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, referencia, monto, periodo, huella) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '05/03/2026', 'PAGO FACT 166', '0001', 1000, '2026-03', 'h1'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '06/03/2026', 'PAGO PROVEEDOR', '0002', -500, '2026-03', 'h2'),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '07/03/2026', 'COMISION', '0003', -12.5, '2026-03', 'h3'),
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '08/03/2026', 'TRF A BDV', '0004', -300, '2026-03', 'h4'),
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000002', '09/03/2026', 'TRF DE BANESCO', '0005', 300, '2026-03', 'h5'),
  ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '15/03/2026', 'PAGO SENIAT', 'P-77', -9000, '2026-03', 'h6'),
  ('c0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '30/03/2026', 'NOMINA', '0007', -800, '2026-03', 'h7');

select pg_temp.igual('una línea pendiente no tiene asiento', pg_temp.asi('c0000000-0000-0000-0000-000000000001'), '(sin asiento)');

update extracto_bancario set clase = 'cobro', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.igual('cobro conciliado', pg_temp.asi('c0000000-0000-0000-0000-000000000001'), '1.1.1.03.01 D1000.00 H0.00 | 1.1.2.01 D0.00 H1000.00');
select pg_temp.igual('el asiento va con la fecha y el período de la línea',
  (select fecha || ' ' || periodo from asientos where origen_tabla = 'extracto_bancario' and origen_id = 'c0000000-0000-0000-0000-000000000001'), '05/03/2026 2026-03');

update extracto_bancario set clase = 'pago', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000002';
select pg_temp.igual('pago conciliado', pg_temp.asi('c0000000-0000-0000-0000-000000000002'), '2.1.1.01 D500.00 H0.00 | 1.1.1.03.01 D0.00 H500.00');
update extracto_bancario set clase = 'comision', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000003';
select pg_temp.igual('comisión conciliada', pg_temp.asi('c0000000-0000-0000-0000-000000000003'), '6.3.1.02 D12.50 H0.00 | 1.1.1.03.01 D0.00 H12.50');

-- Desconciliar borra; cambiar la clase cambia el asiento, sin duplicarlo.
update extracto_bancario set estado = 'pendiente' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.igual('desconciliar borra el asiento', pg_temp.asi('c0000000-0000-0000-0000-000000000001'), '(sin asiento)');
update extracto_bancario set clase = 'cobro', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000001';
update extracto_bancario set clase = 'otra', cuenta_contra = '4.2.1.01' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.igual('cambiar la clase cambia el asiento', pg_temp.asi('c0000000-0000-0000-0000-000000000001'), '1.1.1.03.01 D1000.00 H0.00 | 4.2.1.01 D0.00 H1000.00');
select pg_temp.igual('y sigue siendo uno solo',
  (select count(*)::text from asientos where origen_tabla = 'extracto_bancario' and origen_id = 'c0000000-0000-0000-0000-000000000001'), '1');

-- Transferencia con los dos estados de cuenta: un solo asiento.
update extracto_bancario set clase = 'transferencia', cuenta_contra = '1.1.1.03.02', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000004';
update extracto_bancario set clase = 'transferencia', cuenta_contra = '1.1.1.03.01', extracto_par_id = 'c0000000-0000-0000-0000-000000000004', estado = 'conciliada'
 where id = 'c0000000-0000-0000-0000-000000000005';
select pg_temp.igual('transferencia: la salida hace el asiento', pg_temp.asi('c0000000-0000-0000-0000-000000000004'), '1.1.1.03.02 D300.00 H0.00 | 1.1.1.03.01 D0.00 H300.00');
select pg_temp.igual('transferencia: la otra punta no repite', pg_temp.asi('c0000000-0000-0000-0000-000000000005'), '(sin asiento)');

-- Impuesto: la DPP sin pago queda pagada desde la subcuenta, y el asiento es el del plan 2b.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar) values
  ('d0000000-0000-0000-0000-000000000081', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'DPP', '2026-02', 'D-81', '2026-03-10', 'ORIGINARIA', 9000, 9000);
update extracto_bancario set clase = 'impuesto', declaracion_id = 'd0000000-0000-0000-0000-000000000081', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000006';
select pg_temp.igual('impuesto: la línea no hace asiento propio', pg_temp.asi('c0000000-0000-0000-0000-000000000006'), '(sin asiento)');
select pg_temp.igual('impuesto: la declaración queda pagada desde la subcuenta',
  (select fecha_pago || ' ' || numero_pago || ' ' || cuenta_pago from declaraciones where id = 'd0000000-0000-0000-0000-000000000081'), '2026-03-15 P-77 1.1.1.03.01');
select pg_temp.igual('impuesto: el pago va contra la subcuenta',
  (select pg_temp.lin(lineas) from asientos where origen_tabla = 'declaraciones_pago' and origen_id = 'd0000000-0000-0000-0000-000000000081'), '2.1.5.03 D9000.00 H0.00 | 1.1.1.03.01 D0.00 H9000.00');
update extracto_bancario set estado = 'pendiente' where id = 'c0000000-0000-0000-0000-000000000006';
select pg_temp.igual('impuesto: desconciliar le quita el pago que puso',
  (select coalesce(fecha_pago::text, 'sin pago') from declaraciones where id = 'd0000000-0000-0000-0000-000000000081'), 'sin pago');

-- Registrado (nómina ya contabilizada contra Bancos): solo se pasa a la subcuenta.
update extracto_bancario set clase = 'registrado', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000007';
select pg_temp.igual('registrado: de Bancos a la subcuenta', pg_temp.asi('c0000000-0000-0000-0000-000000000007'), '1.1.1.03 D800.00 H0.00 | 1.1.1.03.01 D0.00 H800.00');

-- Borrar la línea borra su asiento.
delete from extracto_bancario where id = 'c0000000-0000-0000-0000-000000000007';
select pg_temp.igual('borrar la línea borra su asiento',
  (select count(*)::text from asientos where origen_tabla = 'extracto_bancario' and origen_id = 'c0000000-0000-0000-0000-000000000007'), '0');

-- La cabecera del estado de cuenta: una por banco y mes.
insert into estados_cuenta (cuenta_id, empresa_id, cuenta_teso_id, periodo, banco, saldo_inicial, saldo_final)
values ('a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '2026-03', 'Banesco', 0, 187.5);
do $$
begin
  insert into estados_cuenta (cuenta_id, empresa_id, cuenta_teso_id, periodo, banco, saldo_inicial, saldo_final)
  values ('a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '2026-03', 'Banesco', 0, 1);
  raise exception 'FALLA: dos cabeceras para el mismo banco y mes';
exception when unique_violation then null;
end $$;

-- REVISIÓN FINAL · C1: la transferencia en el orden inverso y deshaciendo la primera punta.
insert into extracto_bancario (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, referencia, monto, periodo, huella) values
  ('c0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '20/03/2026', 'TRF A BDV 2', '0011', -70, '2026-03', 'h11'),
  ('c0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000002', '20/03/2026', 'TRF DE BANESCO 2', '0012', 70, '2026-03', 'h12');
-- Primero la entrada (con su par puesto), después la salida SIN par: igual un solo asiento.
update extracto_bancario set clase = 'transferencia', cuenta_contra = '1.1.1.03.01', extracto_par_id = 'c0000000-0000-0000-0000-000000000011', estado = 'conciliada'
 where id = 'c0000000-0000-0000-0000-000000000012';
update extracto_bancario set clase = 'transferencia', cuenta_contra = '1.1.1.03.02', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000011';
select pg_temp.igual('transferencia en orden inverso: un solo asiento entre las dos puntas',
  (select count(*)::text from asientos where origen_tabla = 'extracto_bancario'
      and origen_id in ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012')), '1');
-- Deshacer la punta que tiene el asiento: la otra lo toma.
update extracto_bancario set estado = 'pendiente' where id = (select origen_id from asientos where origen_tabla = 'extracto_bancario'
  and origen_id in ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012'));
select pg_temp.igual('deshacer la punta con asiento: la otra punta lo hace',
  (select count(*)::text from asientos where origen_tabla = 'extracto_bancario'
      and origen_id in ('c0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012')), '1');

-- I2: una línea no puede usar el banco ni la declaración de otra empresa.
insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000082', 'Otra firma', 'contador', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values ('e0000000-0000-0000-0000-000000000082', 'a0000000-0000-0000-0000-000000000082', 'Empresa ajena', true);
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar) values
  ('d0000000-0000-0000-0000-000000000082', 'a0000000-0000-0000-0000-000000000082', 'e0000000-0000-0000-0000-000000000082', 'DPP', '2026-02', 'D-82', '2026-03-10', 'ORIGINARIA', 9000, 9000);
do $$
begin
  update extracto_bancario set clase = 'impuesto', declaracion_id = 'd0000000-0000-0000-0000-000000000082', estado = 'conciliada'
   where id = 'c0000000-0000-0000-0000-000000000006';
  raise exception 'FALLA: se enlazó la declaración de otra empresa';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
end $$;
select pg_temp.igual('la declaración ajena quedó sin pago',
  (select coalesce(fecha_pago::text, 'sin pago') from declaraciones where id = 'd0000000-0000-0000-0000-000000000082'), 'sin pago');
do $$
begin
  insert into extracto_bancario (cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, monto, periodo, huella, clase, estado)
  values ('a0000000-0000-0000-0000-000000000082', 'e0000000-0000-0000-0000-000000000082', 'b0000000-0000-0000-0000-000000000001', '05/03/2026', 'X', 10, '2026-03', 'ajena', 'cobro', 'conciliada');
  raise exception 'FALLA: una empresa usó el banco de otra';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
end $$;
do $$
begin
  insert into cuentas_tesoreria (cuenta_id, empresa_id, nombre, tipo, moneda)
  values ('a0000000-0000-0000-0000-000000000082', 'e0000000-0000-0000-0000-000000000081', 'Banco intruso', 'Corriente', 'Bs');
  raise exception 'FALLA: se dio de alta un banco en una empresa ajena';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
end $$;

-- I3: dos bancos con el mismo nombre no comparten subcuenta.
insert into cuentas_tesoreria (id, cuenta_id, empresa_id, nombre, banco, tipo, moneda) values
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'Banesco', 'Banesco', 'Ahorro', 'Bs');
select pg_temp.igual('otro «Banesco» recibe su propia subcuenta', (pg_temp.sub('b0000000-0000-0000-0000-000000000004') <> '1.1.1.03.01')::text, 'true');

-- I4: una fecha que no se entiende no se concilia.
insert into extracto_bancario (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, monto, periodo, huella) values
  ('c0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000001', '2026-03-10', 'FECHA ISO', 5, '2026-03', 'h13');
do $$
begin
  update extracto_bancario set clase = 'cobro', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000013';
  raise exception 'FALLA: se concilió una línea con una fecha que no se entiende';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
end $$;

-- I6: un banco en dólares no se concilia como si fueran bolívares. Sin el SQL 12
-- no se concilia nunca; con el 12, solo si hay tasa BCV de su fecha. La línea es
-- de 1990, donde no hay tasas: en los dos casos tiene que negarse.
insert into cuentas_tesoreria (id, cuenta_id, empresa_id, nombre, tipo, moneda) values
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'Cuenta USD', 'Corriente', 'USD');
insert into extracto_bancario (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, monto, periodo, huella) values
  ('c0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000081', 'e0000000-0000-0000-0000-000000000081', 'b0000000-0000-0000-0000-000000000005', '10/03/1990', 'USD', 100, '1990-03', 'h14');
do $$
begin
  update extracto_bancario set clase = 'cobro', estado = 'conciliada' where id = 'c0000000-0000-0000-0000-000000000014';
  raise exception 'FALLA: se concilió una cuenta en dólares como si fueran bolívares';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
end $$;

-- C2: las líneas que ya estaban cargadas antes de este SQL quedan como «histórica».
select pg_temp.igual('el estado «histórica» existe', (select count(*)::text from pg_constraint where conname = 'extracto_estado_valido'
   and pg_get_constraintdef(oid) like '%historica%'), '1');

select pg_temp.igual('todos los asientos cuadran',
  (select count(*)::text from asientos a where a.empresa_id = 'e0000000-0000-0000-0000-000000000081'
      and (select round(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 2) from jsonb_array_elements(a.lineas) e) <> 0), '0');

select 'TODO OK · contabilidad 08';
rollback;
