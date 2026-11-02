-- ============================================================
-- Pruebas de sql/contabilidad_05_retenciones.sql (cada retención contabiliza sola)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 05».
-- Toda consulta filtra por la empresa de prueba: la base real repite
-- comprobantes y facturas en otras empresas.
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
create function pg_temp.n(fila uuid) returns text language sql as $$
  select count(*)::text from asientos where origen_tabla = 'retenciones' and origen_id = fila
$$;
-- Un asiento viejo de la empresa de prueba (se inserta con otro origen: el
-- disparador descarta los que imitan a la app vieja).
create function pg_temp.viejo(ref text, descr text) returns void language sql as $$
  insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total)
  values ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '31/03/2026', descr, ref, 'prueba', '[]', 0);
  update asientos set origen = 'auto'
   where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = ref and origen = 'prueba';
$$;

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000001', 'Firma de prueba', 'contador', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Empresa libro', true);

insert into retenciones (id, cuenta_id, empresa_id, direccion, tipo, fecha, comprobante, tercero_nombre, tercero_rif, factura, base, pct, monto, periodo, quincena, creado_en) values
  ('40000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'practicada', 'iva',  '15/10/26', '20261000000001', 'PROVEEDOR UNO', 'J000000001', 'F-1', 625, 75, 75, '2026-10', 1, '2026-11-03 10:00-04'),
  ('40000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'sufrida',    'iva',  '16/10/26', '20261000000777', 'CLIENTE ESPECIAL', 'J000000002', 'V-1', 1000, 75, 120, '2026-10', 2, '2026-10-16 10:00-04'),
  ('40000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'practicada', 'islr', '17/10/26', 'ISLR-001',       'FLETES LARA', 'J000000003', 'F-2', 1000, 3, 30, '2026-10', null, '2026-10-17 10:00-04'),
  ('40000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'sufrida',    'islr', '18/10/26', 'ISLR-778',       'CLIENTE ESPECIAL', 'J000000002', 'V-2', 2275, 2, 45.5, '2026-10', null, '2026-10-18 10:00-04');

select pg_temp.igual('IVA practicada: baja lo que se le debe al proveedor y queda por enterar',
  pg_temp.lin(contab_lineas_retencion(r)), '2.1.1.01 D75.00 H0.00 | 2.1.3.02 D0.00 H75.00')
  from retenciones r where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.igual('IVA sufrida: el cliente pagó menos y queda como crédito a descontar',
  pg_temp.lin(contab_lineas_retencion(r)), '1.1.3.03 D120.00 H0.00 | 1.1.2.01 D0.00 H120.00')
  from retenciones r where id = '40000000-0000-0000-0000-000000000002';
select pg_temp.igual('ISLR practicada: queda por enterar',
  pg_temp.lin(contab_lineas_retencion(r)), '2.1.1.01 D30.00 H0.00 | 2.1.3.03 D0.00 H30.00')
  from retenciones r where id = '40000000-0000-0000-0000-000000000003';
select pg_temp.igual('ISLR sufrida: anticipo del impuesto',
  pg_temp.lin(contab_lineas_retencion(r)), '1.1.3.02 D45.50 H0.00 | 1.1.2.01 D0.00 H45.50')
  from retenciones r where id = '40000000-0000-0000-0000-000000000004';

select pg_temp.igual('cada retención crea su asiento enlazado',
  pg_temp.n('40000000-0000-0000-0000-000000000001') || pg_temp.n('40000000-0000-0000-0000-000000000002')
  || pg_temp.n('40000000-0000-0000-0000-000000000003') || pg_temp.n('40000000-0000-0000-0000-000000000004'), '1111');
select pg_temp.igual('fecha: registrada después de su período, con la fecha del comprobante (cae en el período)',
  (select fecha || ' ' || periodo || ' ' || origen || ' ' || referencia from asientos where origen_id = '40000000-0000-0000-0000-000000000001'),
  '15/10/2026 2026-10 motor 20261000000001');
select pg_temp.igual('descripción',
  (select descripcion from asientos where origen_id = '40000000-0000-0000-0000-000000000002'),
  'Retención IVA sufrida · comp. 20261000000777 · factura V-1 · CLIENTE ESPECIAL');

update retenciones set monto = 90 where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.igual('editar el monto rehace el mismo asiento',
  (select count(*)::text || ' ' || max(total)::text from asientos where origen_id = '40000000-0000-0000-0000-000000000001'), '1 90.00');
update retenciones set estado = 'Anulada' where id = '40000000-0000-0000-0000-000000000003';
select pg_temp.igual('anular quita el asiento', pg_temp.n('40000000-0000-0000-0000-000000000003'), '0');
delete from retenciones where id = '40000000-0000-0000-0000-000000000004';
select pg_temp.igual('borrar quita el asiento', pg_temp.n('40000000-0000-0000-0000-000000000004'), '0');
update retenciones set monto = 0 where id = '40000000-0000-0000-0000-000000000002';
select pg_temp.igual('monto cero: sin asiento', pg_temp.n('40000000-0000-0000-0000-000000000002'), '0');

-- Meses viejos: las sufridas de IVA ya están en el resumen LV (Agüero) o en el
-- asiento provisional RIVA de un mes cerrado con la v186.
-- Marzo: su LV TRAE la línea 1.1.3.03 (las retenciones ya están adentro).
-- Diciembre: su LV NO la trae (pasó en Agüero: las retenciones se cargaron
-- después del resumen). En los meses en resumen la contrapartida fue Bancos,
-- no CxC/CxP, así que ninguna retención de esos meses se contabiliza aquí:
-- o ya está adentro, o queda pendiente para la reconstrucción (plan 6).
select pg_temp.viejo('LV-03/2026', 'Ventas del mes (resumen Libro de Ventas) · marzo 2026');
update asientos set lineas = '[{"cta": "1.1.1.03 · Bancos", "debe": 88, "haber": 0}, {"cta": "1.1.3.03 · Retenciones IVA soportadas", "debe": 12, "haber": 0}, {"cta": "4.1.1.01 · Venta de mercancía", "debe": 0, "haber": 100}]'
 where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = 'LV-03/2026';
select pg_temp.viejo('LV-12/2025', 'Ventas del mes (resumen Libro de Ventas) · diciembre 2025');
select pg_temp.viejo('LC-01/2026', 'Compras del mes (resumen Libro de Compras) · enero 2026');
select pg_temp.viejo('RIVA-09/2026', 'Retenciones de IVA sufridas del mes · septiembre 2026');
insert into retenciones (id, cuenta_id, empresa_id, direccion, tipo, fecha, comprobante, tercero_nombre, factura, base, pct, monto, periodo) values
  ('40000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'sufrida', 'iva',  '10/03/26', 'C-MAR', 'CLIENTE', 'V-9', 100, 75, 12, '2026-03'),
  ('40000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'sufrida', 'islr', '11/03/26', 'I-MAR', 'CLIENTE', 'V-9', 100, 2, 2, '2026-03'),
  ('40000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'sufrida', 'iva',  '12/09/26', 'C-SEP', 'CLIENTE', 'V-8', 100, 75, 12, '2026-09'),
  ('40000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'sufrida', 'iva',  '10/12/25', 'C-DIC', 'CLIENTE', 'V-7', 100, 75, 649.88, '2025-12'),
  ('40000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'practicada', 'islr', '10/01/26', 'I-ENE', 'PROVEEDOR', 'F-9', 100, 2, 2, '2026-01');
select pg_temp.igual('IVA sufrida en mes cuyo LV ya la trae: sin asiento', pg_temp.n('40000000-0000-0000-0000-000000000011'), '0');
select pg_temp.igual('ISLR sufrida en mes con LV: sin asiento (allí se cobró por Bancos)', pg_temp.n('40000000-0000-0000-0000-000000000012'), '0');
select pg_temp.igual('IVA sufrida en mes con RIVA provisional: sin asiento', pg_temp.n('40000000-0000-0000-0000-000000000013'), '0');
select pg_temp.igual('IVA sufrida en mes cuyo LV NO la trae: sin asiento', pg_temp.n('40000000-0000-0000-0000-000000000014'), '0');
select pg_temp.igual('practicada en mes con LC: sin asiento (allí se pagó por Bancos)', pg_temp.n('40000000-0000-0000-0000-000000000015'), '0');
select pg_temp.igual('pendientes para la reconstrucción: marzo 1 (la ISLR), diciembre 1, enero 1, septiembre 0',
  contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000001', '2026-03')::text || ' ' ||
  contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000001', '2025-12')::text || ' ' ||
  contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000001', '2026-01')::text || ' ' ||
  contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000001', '2026-09')::text, '1 1 1 0');

-- Carga masiva (quincena de retenciones).
insert into retenciones (cuenta_id, empresa_id, direccion, tipo, fecha, comprobante, tercero_nombre, factura, base, pct, monto, periodo)
select 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'practicada', 'iva', '20/10/26',
       'Q' || lpad(g::text, 6, '0'), 'PROVEEDOR ' || g, 'F' || g, 100, 75, 12, '2026-10'
  from generate_series(1, 50) g;
select pg_temp.igual('50 retenciones, 50 asientos con números distintos',
  (select count(*)::text || ' ' || count(distinct numero)::text from asientos
    where empresa_id = 'e0000000-0000-0000-0000-000000000001' and origen_tabla = 'retenciones' and referencia like 'Q%'), '50 50');

-- «Cerrar mes» tampoco cierra un mes con retenciones sin asiento (las 382
-- cargadas antes de este motor): se crean normal y se les quita el asiento.
insert into retenciones (id, cuenta_id, empresa_id, direccion, tipo, fecha, comprobante, tercero_nombre, factura, base, pct, monto, periodo) values
  ('40000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'practicada', 'iva', '05/07/26', 'C-JUL', 'PROVEEDOR', 'F-7', 100, 75, 12, '2026-07');
delete from asientos where origen_id = '40000000-0000-0000-0000-000000000021';
select pg_temp.igual('julio tiene 1 retención sin asiento: no se puede cerrar',
  contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000001', '2026-07')::text, '1');

-- Un script de rutina que toca una columna que no cambia el asiento (la
-- quincena, el RIF) no le crea asiento a una retención vieja.
update retenciones set quincena = 2, tercero_rif = 'J999999999' where id = '40000000-0000-0000-0000-000000000021';
select pg_temp.igual('cambiar quincena o RIF no contabiliza una retención vieja', pg_temp.n('40000000-0000-0000-0000-000000000021'), '0');
update retenciones set monto = 13 where id = '40000000-0000-0000-0000-000000000021';
select pg_temp.igual('cambiar el monto sí la contabiliza', pg_temp.n('40000000-0000-0000-0000-000000000021'), '1');

-- Una pestaña con la app VIEJA (v184) que cierra un mes manda su F30 con
-- número propio y con la lógica anterior (contaría dos veces): se descarta.
-- La app nueva no manda número.
insert into asientos (cuenta_id, empresa_id, numero, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 9100, '31/10/2026', 'Liquidación IVA declarado (Forma 30) · octubre 2026', 'F30-10/2026', 'auto', '[]', 0);
select pg_temp.igual('la F30 de la app vieja se descarta',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = 'F30-10/2026'), '0');
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '31/10/2026', 'Liquidación IVA declarado (Forma 30) · octubre 2026', 'F30-10/2026', 'auto', '[]', 0);
select pg_temp.igual('la F30 de la app nueva entra',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = 'F30-10/2026'), '1');

select 'TODO OK · contabilidad 05' as resultado;
rollback;
