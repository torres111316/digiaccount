-- ============================================================
-- Pruebas de sql/contabilidad_04_motor.sql (el libro fiscal contabiliza solo)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 04».
-- ============================================================
begin;

create function pg_temp.igual(caso text, obtenido text, esperado text) returns void language plpgsql as $$
begin
  if obtenido is distinct from esperado then
    raise exception 'FALLA: % → %   (esperado %)', caso, coalesce(obtenido, '(null)'), esperado;
  end if;
end $$;
-- Cuántos asientos enlazados tiene una fila del libro.
create function pg_temp.n(fila uuid) returns text language sql as $$
  select count(*)::text from asientos where origen_tabla = 'libro_fiscal' and origen_id = fila
$$;
create function pg_temp.cuadra(fila uuid) returns text language sql as $$
  select string_agg(case when abs(d - h) < 0.005 then 'cuadra' else 'NO cuadra ' || d || ' ≠ ' || h end, ',')
    from (select (select sum(coalesce((e->>'debe')::numeric, 0)) from jsonb_array_elements(a.lineas) e) d,
                 (select sum(coalesce((e->>'haber')::numeric, 0)) from jsonb_array_elements(a.lineas) e) h
            from asientos a where a.origen_tabla = 'libro_fiscal' and a.origen_id = fila) x
$$;
-- Convierte el asiento del motor de una fila en uno «suelto» como los que dejó
-- el navegador antes del motor (origen 'auto', sin enlace), para probar la
-- convivencia con los 789 asientos viejos sin desactivar disparadores.
create function pg_temp.heredado(fila uuid, descr text) returns void language sql as $$
  update asientos set origen_tabla = null, origen_id = null, origen = 'auto', descripcion = descr
   where origen_tabla = 'libro_fiscal' and origen_id = fila
$$;
-- Un asiento viejo cualquiera (el disparador descarta los que imitan al navegador viejo
-- al INSERTAR, así que se inserta con otro origen y luego se marca 'auto').
create function pg_temp.viejo(emp uuid, ref text, descr text) returns void language sql as $$
  insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total)
  values ('a0000000-0000-0000-0000-000000000001', emp, '31/03/2026', descr, ref, 'prueba', '[]', 0);
  update asientos set origen = 'auto' where empresa_id = emp and referencia = ref and origen = 'prueba';
$$;

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000001', 'Firma de prueba', 'contador', 'contador_basico');  -- el plan permite 3 empresas (validar_limite_empresas)
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Empresa libro', true),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Empresa recibos', false);

-- 1. Una venta nueva crea su asiento, enlazado y cuadrado.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total, creado_en)
values ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        'venta', '10/10/26', '2026-10', 'CLIENTE UNO', 'J000000999', '000100', 'FV', 0, 1000, 160, 1160, '2026-10-10 11:00-04');
select pg_temp.igual('una venta crea 1 asiento', pg_temp.n('20000000-0000-0000-0000-000000000001'), '1');
select pg_temp.igual('el asiento cuadra', pg_temp.cuadra('20000000-0000-0000-0000-000000000001'), 'cuadra');
select pg_temp.igual('origen, período, fecha y descripción',
  (select origen || ' ' || periodo || ' ' || fecha || ' ' || descripcion || ' ' || referencia || ' ' || (numero is not null)::text
     from asientos where origen_id = '20000000-0000-0000-0000-000000000001'),
  'motor 2026-10 10/10/2026 Venta · factura 000100 · CLIENTE UNO 000100 true');

-- 2. Editar el monto actualiza el mismo asiento.
update libro_fiscal set base = 2000, iva = 320, total = 2320 where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.igual('editar no duplica', pg_temp.n('20000000-0000-0000-0000-000000000001'), '1');
select pg_temp.igual('editar cambia el monto', (select total::text from asientos where origen_id = '20000000-0000-0000-0000-000000000001'), '2320.00');

-- 3. Cambiar el período de una compra mueve el asiento.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total, creado_en)
values ('20000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        'compra', '20/09/26', '2026-10', 'FEBECA, C.A.', 'J000033927', '06964772', 'FC', 0, 500, 80, 580, '2026-10-05 09:00-04');
select pg_temp.igual('compra en octubre', (select periodo || ' ' || fecha from asientos where origen_id = '20000000-0000-0000-0000-000000000002'), '2026-10 05/10/2026');
update libro_fiscal set periodo = '2026-09' where id = '20000000-0000-0000-0000-000000000002';
select pg_temp.igual('la compra pasa a septiembre, con la fecha de la factura',
  (select periodo || ' ' || fecha from asientos where origen_id = '20000000-0000-0000-0000-000000000002'), '2026-09 20/09/2026');

-- 4 y 5. Anular o borrar quita el asiento.
update libro_fiscal set tercero_nombre = 'ANULADA', base = 0, iva = 0, total = 0 where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.igual('anular quita el asiento', pg_temp.n('20000000-0000-0000-0000-000000000001'), '0');
delete from libro_fiscal where id = '20000000-0000-0000-0000-000000000002';
select pg_temp.igual('borrar quita el asiento', pg_temp.n('20000000-0000-0000-0000-000000000002'), '0');

-- 6. Una carga masiva de 300 filas: un asiento por fila, números distintos y seguidos.
insert into libro_fiscal (cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total)
select 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '15/08/26', '2026-08',
       'CLIENTE ' || g, 'J' || lpad(g::text, 9, '0'), 'M' || lpad(g::text, 6, '0'), 'FV', 0, 100, 16, 116
  from generate_series(1, 300) g;
select pg_temp.igual('300 filas, 300 asientos',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia like 'M%'), '300');
select pg_temp.igual('números distintos y seguidos',
  (select (count(distinct numero) = 300 and max(numero) - min(numero) = 299)::text
     from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia like 'M%'), 'true');

-- 7. Un mes ya contabilizado en resumen (LV/LC heredados) no se duplica.
select pg_temp.viejo('e0000000-0000-0000-0000-000000000001', 'LV-03/2026', 'Ventas del mes (resumen Libro de Ventas) · marzo 2026');
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total)
values ('20000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        'venta', '10/03/26', '2026-03', 'CLIENTE VIEJO', '000050', 'FV', 100, 16, 116);
update libro_fiscal set base = 200, iva = 32, total = 232 where id = '20000000-0000-0000-0000-000000000003';
select pg_temp.igual('mes con resumen LV: no se crea asiento por factura', pg_temp.n('20000000-0000-0000-0000-000000000003'), '0');
select pg_temp.igual('un asiento que llega sin período lo toma de su fecha',
  (select periodo from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = 'LV-03/2026'), '2026-03');

-- 8. El asiento suelto que dejó el navegador se ADOPTA al editar su factura.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total)
values ('20000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        'venta', '18/08/26', '2026-08', 'MUEBLERIA LOS PINOS, C.A.', '000144', 'FV', 398503.63, 63760.58, 462264.21);
select pg_temp.heredado('20000000-0000-0000-0000-000000000004', 'Venta s/libro · factura 000144 · MUEBLERIA LOS PINOS, C.A.');
update libro_fiscal set numero_control = '00-0144' where id = '20000000-0000-0000-0000-000000000004';
select pg_temp.igual('se adopta el asiento suelto en vez de crear otro',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = '000144'), '1');
select pg_temp.igual('el adoptado queda enlazado, en su período y con montos',
  (select periodo || ' ' || fecha || ' ' || total from asientos where origen_id = '20000000-0000-0000-0000-000000000004'),
  '2026-08 18/08/2026 462264.21');

-- 9. Una venta de una empresa en modo recibos no se contabiliza desde el libro.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total)
values ('20000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
        'venta', '14/10/26', '2026-10', 'CLIENTE DOS', '000200', 'FV', 100, 16, 116);
select pg_temp.igual('modo recibos: sin asiento desde el libro', pg_temp.n('20000000-0000-0000-0000-000000000005'), '0');

-- 10. La base numera SIEMPRE: aunque el navegador mande su número, se ignora.
insert into asientos (cuenta_id, empresa_id, numero, fecha, descripcion, referencia, origen, lineas, total)
values ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 5, '02/11/2026', 'Asiento manual', 'MAN', 'manual', '[]', 0);
select pg_temp.igual('el manual toma el número siguiente (no el 5 que mandó) y su período',
  (select (numero = (select max(numero) from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001') and numero <> 5)::text || ' ' || periodo
     from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = 'MAN'), 'true 2026-11');

-- ===== Revisión final del plan 1 =====

-- C2. Lo que manda una pestaña con la app VIEJA para el libro se descarta: ya lo hace el motor.
insert into asientos (cuenta_id, empresa_id, numero, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 7000, '02/11/2026', 'Compra s/factura 777 · PROVEEDOR', '777', 'auto', '[]', 0),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 7001, '02/11/2026', 'Venta s/libro · factura 778 · CLIENTE', '778', 'auto', '[]', 0),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 7002, '02/11/2026', 'Reverso compra s/factura 779 · PROVEEDOR', '779', 'auto', '[]', 0),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 7003, '02/11/2026', 'Anulación venta N° 780', '780', 'auto', '[]', 0),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 7004, '30/11/2026', 'Ventas del mes (resumen Libro de Ventas) · noviembre 2026', 'LV-11/2026', 'auto', '[]', 0);
select pg_temp.igual('se descartan los asientos del libro que manda la app vieja',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia in ('777', '778', '779', '780', 'LV-11/2026')), '0');
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '02/11/2026', 'Venta s/recibo REC-0001 · CLIENTE', 'REC-0001', 'auto', '[]', 0),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '02/11/2026', 'Reverso cobro REC-0001 · CLIENTE', 'REC-0001', 'auto', '[]', 0);
select pg_temp.igual('los recibos y la tesorería sí entran', (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = 'REC-0001'), '2');

-- C1. Anular o borrar una factura VIEJA quita su asiento suelto.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total) values
  ('30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '05/09/26', '2026-09', 'LOBO ALIMENTOC', '0000054586', 'FC', 100, 16, 116),
  ('30000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '06/09/26', '2026-09', 'CLIENTE TRES', '000300', 'FV', 100, 16, 116);
select pg_temp.heredado('30000000-0000-0000-0000-000000000001', 'Compra s/factura 0000054586 · LOBO ALIMENTOC');
select pg_temp.heredado('30000000-0000-0000-0000-000000000002', 'Venta s/libro · factura 000300 · CLIENTE TRES');
update libro_fiscal set tercero_nombre = 'ANULADA', base = 0, iva = 0, total = 0 where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.igual('anular una compra vieja quita su asiento suelto',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = '0000054586'), '0');
delete from libro_fiscal where id = '30000000-0000-0000-0000-000000000002';
select pg_temp.igual('borrar una venta vieja quita su asiento suelto',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = '000300'), '0');

-- I1. Casos ambiguos: si no hay UN solo asiento suelto inequívoco, el motor no toca nada.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total) values
  ('30000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '07/09/26', '2026-09', 'VENCEMENT, C.A.', 'A021521', 'FC', 100, 16, 116);
select pg_temp.heredado('30000000-0000-0000-0000-000000000003', 'Compra s/factura A021521 · VENCEMENT, C.A.');
select pg_temp.viejo('e0000000-0000-0000-0000-000000000001', 'A021521', 'Compra s/factura A021521 · VENCEMENT, C.A.');
update libro_fiscal set base = 150, iva = 24, total = 174 where id = '30000000-0000-0000-0000-000000000003';
select pg_temp.igual('dos asientos sueltos de la misma factura: no se adopta ni se crea otro',
  (select count(*)::text || ' ' || count(origen_id)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = 'A021521'), '2 0');
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total) values
  ('30000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '08/09/26', '2026-09', 'MAXCAM, C.A.', '00309501', 'FC', 100, 16, 116);
select pg_temp.heredado('30000000-0000-0000-0000-000000000004', 'Compra s/factura 00309501 · MAXCAM, C.A.');
select pg_temp.viejo('e0000000-0000-0000-0000-000000000001', '00309501', 'Reverso compra s/factura 00309501 · MAXCAM, C.A.');
delete from libro_fiscal where id = '30000000-0000-0000-0000-000000000004';
select pg_temp.igual('factura con un reverso viejo: borrarla no toca sus asientos',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = '00309501'), '2');
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total) values
  ('30000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '09/09/26', '2026-09', 'BELTRAC, C.A.', '001379', 'FV', 100, 16, 116);
select pg_temp.heredado('30000000-0000-0000-0000-000000000005', 'Venta s/libro · factura 001379 · OTRO CLIENTE');
update libro_fiscal set base = 120, iva = 19.2, total = 139.2 where id = '30000000-0000-0000-0000-000000000005';
select pg_temp.igual('un asiento suelto de OTRO tercero con el mismo número no se adopta',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = '001379'), '2');

-- I1. Corregir el N° de factura de una fila vieja adopta su asiento por el número anterior.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total) values
  ('30000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '10/09/26', '2026-09', 'FERRETERIA SOL', '1234', 'FC', 100, 16, 116);
select pg_temp.heredado('30000000-0000-0000-0000-000000000006', 'Compra s/factura 1234 · FERRETERIA SOL');
update libro_fiscal set numero_factura = '01234' where id = '30000000-0000-0000-0000-000000000006';
select pg_temp.igual('al corregir el número se adopta el asiento viejo, con la referencia nueva',
  (select count(*)::text || ' ' || string_agg(referencia, ',') from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia in ('1234', '01234')), '1 01234');

-- I1. Un reporte Z no adopta una factura con el mismo número.
select pg_temp.viejo('e0000000-0000-0000-0000-000000000001', '0812', 'Venta s/libro · factura 0812 · CLIENTE FACTURA');
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, numero_zeta, maquina_fiscal, tipo_doc, base, iva, total) values
  ('30000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '11/09/26', '2026-09', '', '', '0812', 'Z7C0025982', 'FV', 500, 80, 580);
select pg_temp.igual('el Z crea su propio asiento y el de la factura queda',
  (select count(*)::text || ' ' || count(origen_id)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = '0812'), '2 1');

-- I2. Filas de un período sin asiento (las cargadas antes del motor): «Cerrar mes» no debe cerrarlo.
-- (Sin desactivar disparadores, que bloquearía libro_fiscal en producción: se
-- crean normal y se les quita el asiento, como si se hubieran cargado antes del motor.)
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total) values
  ('30000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'compra', '12/06/26', '2026-06', 'PROVEEDOR VIEJO', 'V-1', 'FC', 100, 16, 116),
  ('30000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'venta', '13/06/26', '2026-06', 'ANULADA', 'V-2', 'FV', 0, 0, 0);
delete from asientos where origen_id = '30000000-0000-0000-0000-000000000008';
select pg_temp.igual('junio tiene 1 fila con monto y sin asiento (la anulada no cuenta)',
  contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000001', '2026-06')::text, '1');
select pg_temp.igual('marzo está en resumen LV y agosto tiene sus asientos: 0 y 0',
  contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000001', '2026-03')::text || ' ' ||
  contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000001', '2026-08')::text, '0 0');

select 'TODO OK · contabilidad 04' as resultado;
rollback;
