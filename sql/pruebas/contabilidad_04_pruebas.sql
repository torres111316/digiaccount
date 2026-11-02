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

insert into cuentas (id, nombre, segmento) values ('a0000000-0000-0000-0000-000000000001', 'Firma de prueba', 'contador');
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
insert into asientos (cuenta_id, empresa_id, numero, fecha, descripcion, referencia, origen, lineas, total)
values ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 9001, '31/03/2026',
        'Ventas del mes (resumen Libro de Ventas) · marzo 2026', 'LV-03/2026', 'auto', '[]', 0);
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total)
values ('20000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        'venta', '10/03/26', '2026-03', 'CLIENTE VIEJO', '000050', 'FV', 100, 16, 116);
update libro_fiscal set base = 200, iva = 32, total = 232 where id = '20000000-0000-0000-0000-000000000003';
select pg_temp.igual('mes con resumen LV: no se crea asiento por factura', pg_temp.n('20000000-0000-0000-0000-000000000003'), '0');
select pg_temp.igual('un asiento que llega sin período lo toma de su fecha',
  (select periodo from asientos where referencia = 'LV-03/2026'), '2026-03');

-- 8. El asiento suelto que dejó el navegador se ADOPTA al editar su factura.
insert into asientos (cuenta_id, empresa_id, numero, fecha, descripcion, referencia, origen, lineas, total)
values ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 9002, '01/11/2026',
        'Venta s/libro · factura 000144 · MUEBLERIA LOS PINOS, C.A.', '000144', 'auto', '[]', 0);
alter table libro_fiscal disable trigger trg_contab_libro;
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total)
values ('20000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        'venta', '18/08/26', '2026-08', 'MUEBLERIA LOS PINOS, C.A.', '000144', 'FV', 398503.63, 63760.58, 462264.21);
alter table libro_fiscal enable trigger trg_contab_libro;
update libro_fiscal set numero_control = '00-0144' where id = '20000000-0000-0000-0000-000000000004';
select pg_temp.igual('se adopta el asiento suelto en vez de crear otro',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001' and referencia = '000144'), '1');
select pg_temp.igual('el adoptado queda enlazado, en su período y con montos',
  (select numero || ' ' || periodo || ' ' || fecha || ' ' || total from asientos where origen_id = '20000000-0000-0000-0000-000000000004'),
  '9002 2026-08 18/08/2026 462264.21');

-- 9. Una venta de una empresa en modo recibos no se contabiliza desde el libro.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, total)
values ('20000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
        'venta', '14/10/26', '2026-10', 'CLIENTE DOS', '000200', 'FV', 100, 16, 116);
select pg_temp.igual('modo recibos: sin asiento desde el libro', pg_temp.n('20000000-0000-0000-0000-000000000005'), '0');

-- 10. Un asiento manual sin número recibe el siguiente de su empresa.
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total)
values ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '02/11/2026', 'Asiento manual', 'MAN', 'manual', '[]', 0);
select pg_temp.igual('el manual toma el número siguiente y su período',
  (select (numero = (select max(numero) from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000001'))::text || ' ' || periodo
     from asientos where referencia = 'MAN'), 'true 2026-11');

select 'TODO OK · contabilidad 04' as resultado;
rollback;
