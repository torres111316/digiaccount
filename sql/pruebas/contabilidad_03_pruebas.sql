-- ============================================================
-- Pruebas de sql/contabilidad_03_funciones.sql (líneas, fecha y período del asiento)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). No dejan nada: todo va entre
-- begin y rollback. Una falla aborta con «FALLA: <caso>»; si todo pasa, la
-- última línea dice «TODO OK · contabilidad 03».
-- ============================================================
begin;

-- Las líneas de un asiento como texto comparable: «código Ddebe Hhaber | …»
create function pg_temp.lin(j jsonb) returns text language sql as $$
  select coalesce(string_agg(split_part(e->>'cta', ' · ', 1)
           || ' D' || round(coalesce((e->>'debe')::numeric, 0), 2)
           || ' H' || round(coalesce((e->>'haber')::numeric, 0), 2), ' | ' order by n), '(null)')
    from jsonb_array_elements(j) with ordinality as t(e, n)
$$;

create function pg_temp.igual(caso text, obtenido text, esperado text) returns void language plpgsql as $$
begin
  if obtenido is distinct from esperado then
    raise exception 'FALLA: % → %   (esperado %)', caso, coalesce(obtenido, '(null)'), esperado;
  end if;
end $$;

insert into cuentas (id, nombre, segmento) values ('a0000000-0000-0000-0000-000000000001', 'Firma de prueba', 'contador');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Empresa libro', true),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Empresa recibos', false);
insert into terceros (cuenta_id, rif, nombre, es_proveedor, cuenta_gasto) values
  ('a0000000-0000-0000-0000-000000000001', 'J000000111', 'ESTUDIO CONTABLE, C.A.', true, '6.1.1.05'),
  ('a0000000-0000-0000-0000-000000000001', 'J000000222', 'DISTRIBUIDORA DIDAR, C.A.', true, null);

-- Fecha del asiento (spec §4.3)
select pg_temp.igual('registrado dentro de su período: manda el día del registro',
  contab_fecha_asiento('28/10/26', '2026-11', '2026-11-03 10:00-04'), '03/11/2026');
select pg_temp.igual('mes viejo con la factura dentro del período: la fecha de la factura',
  contab_fecha_asiento('15/03/26', '2026-03', '2026-08-16 09:00-04'), '15/03/2026');
select pg_temp.igual('factura fuera de su período y registro posterior: último día del período',
  contab_fecha_asiento('30/01/26', '2026-02', '2026-08-16 09:00-04'), '28/02/2026');
select pg_temp.igual('01:30 UTC del 6 todavía es el 5 en Caracas',
  contab_fecha_asiento('05/11/26', '2026-11', '2026-11-06 01:30+00'), '05/11/2026');
select pg_temp.igual('sin período, sale del mes de la factura',
  contab_periodo_de('17/09/26', null), '2026-09');

-- Líneas (spec §4.1)
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total, numero_zeta, maquina_fiscal) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '10/10/26', '2026-10', 'CLIENTE UNO', 'J000000999', '000100', 'FV', 50, 1000, 160, 1210, null, null),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '06/10/26', '2026-10', '', '', '', 'FV', 0, 500, 80, 580, '0812', 'Z7C0025982'),
  ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '28/10/26', '2026-10', 'DISTRIBUIDORA DIDAR, C.A.', 'J000000222', '0000146004', 'FC', 0, 209142.1, 33462.736000000004, 242604.836, null, null),
  ('10000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '01/10/26', '2026-10', 'DISTRIBUIDORA DIDAR, C.A.', 'J000000222', 'A-1', 'FC', 0, 1000, 160, 1160, null, null),
  ('10000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '02/10/26', '2026-10', 'ESTUDIO CONTABLE, C.A.', 'J000000111', 'H-77', 'FC', 0, 2000, 320, 2320, null, null),
  ('10000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '05/08/26', '2026-09', 'COMERCIAL SANFER, C.A.', 'J000000333', '02820', 'RE', 77554.44, 0, 0, 77554.44, null, null),
  ('10000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '12/10/26', '2026-10', 'CLIENTE UNO', 'J000000999', 'NC-0007', 'NC', 0, 100, 16, 116, null, null),
  ('10000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '13/10/26', '2026-10', 'ANULADA', '', '000101', 'FV', 0, 0, 0, 0, null, null),
  ('10000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'venta', '14/10/26', '2026-10', 'CLIENTE DOS', 'J000000888', '000200', 'FV', 0, 100, 16, 116, null, null);
update libro_fiscal set cuenta_contable = '6.1.1.03' where id = '10000000-0000-0000-0000-000000000004';

select pg_temp.igual('venta con exento: CxC por el total, ventas por base + exento, IVA débito',
  pg_temp.lin(contab_lineas_libro(l)), '1.1.2.01 D1210.00 H0.00 | 4.1.1.01 D0.00 H1050.00 | 2.1.3.01 D0.00 H160.00')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.igual('venta por reporte Z: las mismas tres cuentas',
  pg_temp.lin(contab_lineas_libro(l)), '1.1.2.01 D580.00 H0.00 | 4.1.1.01 D0.00 H500.00 | 2.1.3.01 D0.00 H80.00')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000002';
select pg_temp.igual('compra con IVA de muchos decimales: 2 decimales y Debe = Haber',
  pg_temp.lin(contab_lineas_libro(l)), '5.1.1.02 D209142.10 H0.00 | 1.1.3.01 D33462.74 H0.00 | 2.1.1.01 D0.00 H242604.84')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.igual('compra con cuenta propia de la factura',
  split_part(contab_lineas_libro(l)->0->>'cta', ' · ', 1) || ' ' || split_part(contab_lineas_libro(l)->0->>'cta', ' · ', 2), '6.1.1.03 Alquileres')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000004';
select pg_temp.igual('compra sin cuenta propia: la del proveedor',
  split_part(contab_lineas_libro(l)->0->>'cta', ' · ', 1), '6.1.1.05')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000005';
select pg_temp.igual('compra RE exenta: sin línea de IVA',
  pg_temp.lin(contab_lineas_libro(l)), '5.1.1.02 D77554.44 H0.00 | 2.1.1.01 D0.00 H77554.44')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000006';
select pg_temp.igual('nota de crédito de venta: debe y haber invertidos',
  pg_temp.lin(contab_lineas_libro(l)), '1.1.2.01 D0.00 H116.00 | 4.1.1.01 D100.00 H0.00 | 2.1.3.01 D16.00 H0.00')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000007';
select pg_temp.igual('anulada: no genera asiento',
  pg_temp.lin(contab_lineas_libro(l)), '(null)')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000008';
select pg_temp.igual('venta de una empresa en modo recibos: la contabiliza el recibo',
  pg_temp.lin(contab_lineas_libro(l)), '(null)')
  from libro_fiscal l where id = '10000000-0000-0000-0000-000000000009';
select pg_temp.igual('contab_cta nombra la cuenta desde el plan',
  contab_cta('2.1.3.01'), '2.1.3.01 · IVA débito fiscal');

select 'TODO OK · contabilidad 03' as resultado;
rollback;
