-- ============================================================
-- Pruebas de sql/contabilidad_11_tesoreria.sql (cobros, pagos y transferencias
-- de Tesorería en la base)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 11».
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

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000111', 'Cuenta empresa', 'empresa', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000111', 'a0000000-0000-0000-0000-000000000111', 'Empresa tesorería', false);
insert into cuentas_tesoreria (id, cuenta_id, empresa_id, nombre, tipo, moneda) values
  ('b0000000-0000-0000-0000-000000000111', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'Banco A', 'Corriente', 'Bs'),
  ('b0000000-0000-0000-0000-000000000112', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'Banco B', 'Corriente', 'Bs');
insert into facturas (id, cuenta_id, empresa_id, numero, tipo, tipo_doc, fecha, cliente_nombre, subtotal, iva, igtf_monto, total, estado) values
  ('f0000000-0000-0000-0000-000000000111', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'REC-000001', 'venta', 'FV', '10/03/2026', 'CLIENTE', 1000, 160, 0, 1160, 'Por cobrar'),
  ('f0000000-0000-0000-0000-000000000112', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'REC-000002', 'venta', 'FV', '10/03/2026', 'CLIENTE', 1000, 160, 0, 1160, 'Por cobrar');
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, alicuota, iva, total) values
  ('10000000-0000-0000-0000-000000000111', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'compra', '11/03/26', '2026-03', 'PROVEEDOR', 'J000000111', 'C-1', 'FC', 0, 500, 0.16, 80, 580);

insert into movimientos_tesoreria (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, concepto, tipo, referencia, monto, tercero_nombre, factura_ref, cuenta_contra) values
  ('70000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111', '15/03/26', 'Cobro', 'ingreso', 'R1', 1160, 'CLIENTE', 'REC-000001', null),
  ('70000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111', '15/03/26', 'Cobro', 'ingreso', 'R2', 1200, 'CLIENTE', 'REC-000002', null),
  ('70000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111', '16/03/26', 'Pago', 'egreso', 'P1', 580, 'PROVEEDOR', 'C-1', null),
  ('70000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111', '17/03/26', 'Luz', 'egreso', 'L1', 300, null, null, '6.1.1.04'),
  ('70000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111', '18/03/26', 'Sin cuenta', 'egreso', 'X1', 50, null, null, null),
  ('70000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111', '19/03/26', 'Transferencia → Banco B', 'egreso', 'TRF-00000001', 400, null, null, null),
  ('70000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000112', '19/03/26', 'Transferencia ← Banco A', 'ingreso', 'TRF-00000001', 400, null, null, null);

select pg_temp.igual('cobro de un recibo, en la subcuenta del banco', pg_temp.mov('70000000-0000-0000-0000-000000000001'), '1.1.1.03.01 D1160.00 H0.00 | 1.1.2.01 D0.00 H1160.00');
select pg_temp.igual('el asiento va con la fecha del movimiento',
  (select fecha || ' ' || periodo from asientos where origen_tabla = 'movimientos_tesoreria' and origen_id = '70000000-0000-0000-0000-000000000001'), '15/03/2026 2026-03');
select pg_temp.igual('cobro mayor que el recibo: el exceso a anticipos de clientes', pg_temp.mov('70000000-0000-0000-0000-000000000002'),
  '1.1.1.03.01 D1200.00 H0.00 | 1.1.2.01 D0.00 H1160.00 | 2.1.6.01 D0.00 H40.00');
select pg_temp.igual('pago de una compra del libro', pg_temp.mov('70000000-0000-0000-0000-000000000003'), '2.1.1.01 D580.00 H0.00 | 1.1.1.03.01 D0.00 H580.00');
select pg_temp.igual('egreso sin documento, contra su cuenta', pg_temp.mov('70000000-0000-0000-0000-000000000004'), '6.1.1.04 D300.00 H0.00 | 1.1.1.03.01 D0.00 H300.00');
select pg_temp.igual('sin documento ni cuenta: sin asiento', pg_temp.mov('70000000-0000-0000-0000-000000000005'), '(sin asiento)');
select pg_temp.igual('y cuenta como fila sin asiento del mes',
  (select contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000111', '2026-03')::text), '1');
select pg_temp.igual('transferencia: el egreso hace el asiento', pg_temp.mov('70000000-0000-0000-0000-000000000006'), '1.1.1.03.02 D400.00 H0.00 | 1.1.1.03.01 D0.00 H400.00');
select pg_temp.igual('transferencia: el ingreso no repite', pg_temp.mov('70000000-0000-0000-0000-000000000007'), '(sin asiento)');

-- Un segundo cobro del mismo recibo ya cobrado: todo a anticipos.
insert into movimientos_tesoreria (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, concepto, tipo, referencia, monto, factura_ref) values
  ('70000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111', '20/03/26', 'Cobro de más', 'ingreso', 'R3', 100, 'REC-000001');
select pg_temp.igual('lo que se cobra de un recibo ya cobrado va a anticipos', pg_temp.mov('70000000-0000-0000-0000-000000000008'), '1.1.1.03.01 D100.00 H0.00 | 2.1.6.01 D0.00 H100.00');

-- Editar y borrar.
update movimientos_tesoreria set monto = 350 where id = '70000000-0000-0000-0000-000000000004';
select pg_temp.igual('editar el monto cambia el asiento', pg_temp.mov('70000000-0000-0000-0000-000000000004'), '6.1.1.04 D350.00 H0.00 | 1.1.1.03.01 D0.00 H350.00');
update movimientos_tesoreria set cuenta_contra = '6.1.1.16' where id = '70000000-0000-0000-0000-000000000005';
select pg_temp.igual('ponerle cuenta a uno que no tenía le hace su asiento', pg_temp.mov('70000000-0000-0000-0000-000000000005'), '6.1.1.16 D50.00 H0.00 | 1.1.1.03.01 D0.00 H50.00');
delete from movimientos_tesoreria where id = '70000000-0000-0000-0000-000000000004';
select pg_temp.igual('borrar el movimiento borra su asiento', pg_temp.mov('70000000-0000-0000-0000-000000000004'), '(sin asiento)');
delete from movimientos_tesoreria where id = '70000000-0000-0000-0000-000000000007';
select pg_temp.igual('sin su par, la transferencia ya no es transferencia (queda sin asiento)', pg_temp.mov('70000000-0000-0000-0000-000000000006'), '(sin asiento)');

-- Un movimiento viejo (contabilizado por el navegador) no se toca.
insert into movimientos_tesoreria (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, tipo, referencia, monto, factura_ref, contab_motor) values
  ('70000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111', '21/03/26', 'ingreso', 'V1', 99, 'REC-000002', false);
select pg_temp.igual('un movimiento viejo no lo contabiliza el motor', pg_temp.mov('70000000-0000-0000-0000-000000000009'), '(sin asiento)');

-- Conciliación: «registrado» con un movimiento del motor no repite el asiento.
insert into extracto_bancario (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, referencia, monto, periodo, huella, clase, movimiento_id, estado) values
  ('c0000000-0000-0000-0000-000000000111', 'a0000000-0000-0000-0000-000000000111', 'e0000000-0000-0000-0000-000000000111', 'b0000000-0000-0000-0000-000000000111',
   '15/03/2026', 'PAGO MOVIL', 'R1', 1160, '2026-03', 'm1', 'registrado', '70000000-0000-0000-0000-000000000001', 'conciliada');
select pg_temp.igual('registrado con un movimiento del motor: sin asiento (ya está en la subcuenta)',
  coalesce((select pg_temp.lin(lineas) from asientos where origen_tabla = 'extracto_bancario' and origen_id = 'c0000000-0000-0000-0000-000000000111'), '(sin asiento)'), '(sin asiento)');
select pg_temp.igual('y el movimiento enlazado no cuenta como en tránsito',
  (select (contab_conciliacion_resumen('b0000000-0000-0000-0000-000000000111', '2026-03') -> 'transito' ->> 'cantidad')),
  (select count(*)::text from asientos a where a.empresa_id = 'e0000000-0000-0000-0000-000000000111' and a.origen_tabla = 'movimientos_tesoreria'
      and a.origen_id <> '70000000-0000-0000-0000-000000000001'
      and exists (select 1 from jsonb_array_elements(a.lineas) e where split_part(e->>'cta', ' · ', 1) = '1.1.1.03.01')));

select pg_temp.igual('todos los asientos cuadran',
  (select count(*)::text from asientos a where a.empresa_id = 'e0000000-0000-0000-0000-000000000111'
      and (select round(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 2) from jsonb_array_elements(a.lineas) e) <> 0), '0');

select 'TODO OK · contabilidad 11';
rollback;
