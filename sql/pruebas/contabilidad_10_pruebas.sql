-- ============================================================
-- Pruebas de sql/contabilidad_10_recibos.sql (recibos de venta en la base)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 10».
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
create function pg_temp.rec(fila uuid) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) from asientos where origen_tabla = 'facturas' and origen_id = fila), '(sin asiento)')
$$;

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000101', 'Cuenta empresa', 'empresa', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000101', 'a0000000-0000-0000-0000-000000000101', 'Empresa recibos', false),
  ('e0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000101', 'Empresa libro', true);

insert into facturas (id, cuenta_id, empresa_id, numero, tipo, tipo_doc, fecha, cliente_nombre, subtotal, iva, igtf_monto, total, estado, factura_afectada, motivo) values
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000101', 'REC-000001', 'venta', 'FV', '10/03/2026', 'CLIENTE', 1000, 160, 0, 1160, 'Por cobrar', null, null),
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000102', 'REC-000002', 'venta', 'FV', '10/03/2026', 'CLIENTE', 1000, 160, 0, 1160, 'Por cobrar', null, null),
  ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000101', 'NC-000001', 'venta', 'NC', '12/03/2026', 'CLIENTE', 100, 16, 0, 116, 'Emitida', 'f0000000-0000-0000-0000-000000000001', 'Devolución parcial'),
  ('f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000101', 'REC-000003', 'venta', 'FV', '11/03/2026', 'CLIENTE', 500, 80, 17.4, 597.4, 'Por cobrar', null, null);

select pg_temp.igual('recibo en modo recibos', pg_temp.rec('f0000000-0000-0000-0000-000000000001'), '1.1.2.01 D1160.00 H0.00 | 4.1.1.01 D0.00 H1000.00 | 2.1.3.01 D0.00 H160.00');
select pg_temp.igual('el asiento va con la fecha del recibo',
  (select fecha || ' ' || periodo from asientos where origen_tabla = 'facturas' and origen_id = 'f0000000-0000-0000-0000-000000000001'), '10/03/2026 2026-03');
select pg_temp.igual('en modo libro el recibo no contabiliza (lo hace el libro)', pg_temp.rec('f0000000-0000-0000-0000-000000000002'), '(sin asiento)');
select pg_temp.igual('nota de crédito: lo inverso', pg_temp.rec('f0000000-0000-0000-0000-000000000003'), '4.1.1.01 D100.00 H0.00 | 2.1.3.01 D16.00 H0.00 | 1.1.2.01 D0.00 H116.00');
select pg_temp.igual('con IGTF percibido', pg_temp.rec('f0000000-0000-0000-0000-000000000004'),
  '1.1.2.01 D597.40 H0.00 | 4.1.1.01 D0.00 H500.00 | 2.1.3.01 D0.00 H80.00 | 2.1.4.03 D0.00 H17.40');

update facturas set estado = 'Anulada' where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.igual('anular el recibo quita su asiento', pg_temp.rec('f0000000-0000-0000-0000-000000000001'), '(sin asiento)');
update facturas set estado = 'Por cobrar', total = 1276, iva = 276 where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.igual('editarlo cambia su asiento', pg_temp.rec('f0000000-0000-0000-0000-000000000001'), '1.1.2.01 D1276.00 H0.00 | 4.1.1.01 D0.00 H1000.00 | 2.1.3.01 D0.00 H276.00');
delete from facturas where id = 'f0000000-0000-0000-0000-000000000004';
select pg_temp.igual('borrarlo quita su asiento', pg_temp.rec('f0000000-0000-0000-0000-000000000004'), '(sin asiento)');

-- Un recibo viejo (contabilizado por el navegador) no se toca.
insert into facturas (id, cuenta_id, empresa_id, numero, tipo, tipo_doc, fecha, subtotal, iva, igtf_monto, total, estado, contab_motor) values
  ('f0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000101', 'REC-000009', 'venta', 'FV', '01/02/2026', 100, 16, 0, 116, 'Por cobrar', false);
select pg_temp.igual('un recibo viejo no lo contabiliza el motor', pg_temp.rec('f0000000-0000-0000-0000-000000000005'), '(sin asiento)');

-- La app vieja (en caché) ya no duplica: su asiento de «Venta s/recibo» se descarta.
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total)
values ('a0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000101', '10/03/2026', 'Venta s/recibo REC-000001 · CLIENTE', 'REC-000001', 'auto', '[]', 0);
select pg_temp.igual('el asiento de la app vieja se descarta',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000101' and descripcion like 'Venta s/recibo%'), '0');

-- La tasa del BCV vigente a una fecha.
insert into tasas_cambio (fecha, moneda, tasa, fuente) values ('2026-03-09', 'USD', 400, 'BCV'), ('2026-03-11', 'USD', 410, 'BCV'), ('2026-03-10', 'USDT', 999, 'PARALELO');
select pg_temp.igual('tasa vigente: la última del BCV hasta esa fecha', contab_tasa_bcv('2026-03-10')::text, '400');
select pg_temp.igual('tasa del día si la hay', contab_tasa_bcv('2026-03-11')::text, '410');

select 'TODO OK · contabilidad 10';
rollback;
