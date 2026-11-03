-- ============================================================
-- Pruebas de sql/contabilidad_06_declaraciones.sql (declaraciones y pagos de impuestos)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 06».
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
-- Las líneas del asiento de declaración / de pago de una declaración.
create function pg_temp.decl(fila uuid) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) from asientos where origen_tabla = 'declaraciones' and origen_id = fila), '(sin asiento)')
$$;
create function pg_temp.pago(fila uuid) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) from asientos where origen_tabla = 'declaraciones_pago' and origen_id = fila), '(sin asiento)')
$$;

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000001', 'Firma de prueba', 'contador', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Empresa libro', true);

-- DPP: al declarar, gasto contra «por pagar»; al pagar, contra el banco.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar) values
  ('50000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'DPP', '2026-10', 'D-1', '2026-11-03', 'ORIGINARIA', 9000, 9000);
select pg_temp.igual('DPP declarada', pg_temp.decl('50000000-0000-0000-0000-000000000001'), '6.1.1.07 D9000.00 H0.00 | 2.1.5.03 D0.00 H9000.00');
select pg_temp.igual('DPP sin pagar: sin asiento de pago', pg_temp.pago('50000000-0000-0000-0000-000000000001'), '(sin asiento)');
update declaraciones set fecha_pago = '2026-11-05', numero_pago = 'R-1' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.igual('DPP pagada por Bancos', pg_temp.pago('50000000-0000-0000-0000-000000000001'), '2.1.5.03 D9000.00 H0.00 | 1.1.1.03 D0.00 H9000.00');
select pg_temp.igual('fecha y período del pago: el del mes del pago',
  (select fecha || ' ' || periodo || ' ' || descripcion from asientos where origen_tabla = 'declaraciones_pago' and origen_id = '50000000-0000-0000-0000-000000000001'),
  '05/11/2026 2026-11 Pago DPP 2026-10 · recibo R-1');   -- el pago cae en el mes en que salió el dinero
select pg_temp.igual('fecha y descripción de la declaración',
  (select fecha || ' ' || descripcion from asientos where origen_tabla = 'declaraciones' and origen_id = '50000000-0000-0000-0000-000000000001'),
  '31/10/2026 Declaración DPP 2026-10 · planilla D-1');   -- la declaración se causa el último día del período
update declaraciones set cuenta_pago = '1.1.1.01' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.igual('pago desde Caja', pg_temp.pago('50000000-0000-0000-0000-000000000001'), '2.1.5.03 D9000.00 H0.00 | 1.1.1.01 D0.00 H9000.00');

-- Impuestos que ya están en el pasivo: sin asiento al declarar; al pagar, contra el banco.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, quincena, numero, fecha, monto, a_pagar, fecha_pago) values
  ('50000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'IVA',      '2026-10', null, 'I-1', '2026-11-10', 500, 500, '2026-11-11'),
  ('50000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'RET_IVA',  '2026-10', 2,    'R-2', '2026-11-04', 75, 75, '2026-11-04'),
  ('50000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'RET_ISLR', '2026-10', null, 'S-1', '2026-11-10', 30, 30, '2026-11-10'),
  ('50000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'IGTF',     '2026-10', 2,    'G-1', '2026-11-04', 40, 40, '2026-11-04');
select pg_temp.igual('IVA declarado: sin asiento (ya lo dejó la liquidación)', pg_temp.decl('50000000-0000-0000-0000-000000000002'), '(sin asiento)');
select pg_temp.igual('IVA pagado', pg_temp.pago('50000000-0000-0000-0000-000000000002'), '2.1.4.04 D500.00 H0.00 | 1.1.1.03 D0.00 H500.00');
select pg_temp.igual('retenciones de IVA pagadas', pg_temp.pago('50000000-0000-0000-0000-000000000003'), '2.1.3.02 D75.00 H0.00 | 1.1.1.03 D0.00 H75.00');
select pg_temp.igual('retenciones de ISLR pagadas', pg_temp.pago('50000000-0000-0000-0000-000000000004'), '2.1.3.03 D30.00 H0.00 | 1.1.1.03 D0.00 H30.00');
select pg_temp.igual('IGTF pagado', pg_temp.pago('50000000-0000-0000-0000-000000000005'), '2.1.4.03 D40.00 H0.00 | 1.1.1.03 D0.00 H40.00');
select pg_temp.igual('descripción con quincena',
  (select descripcion from asientos where origen_tabla = 'declaraciones_pago' and origen_id = '50000000-0000-0000-0000-000000000003'),
  'Pago RET_IVA 2026-10 · quincena 2 · recibo (sin número)');

-- Anticipo e ISLR anual.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, monto, a_pagar) values
  ('50000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'ISLR_ANTICIPO', '2026-06', 'A-1', '2026-07-15', 250, 250);
select pg_temp.igual('anticipo de ISLR', pg_temp.decl('50000000-0000-0000-0000-000000000006'), '1.1.3.06 D250.00 H0.00 | 2.1.4.01 D0.00 H250.00');
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, monto, a_pagar) values
  ('50000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'ISLR_ANUAL', '2026-12', 'N-1', '2027-03-20', 1000, 400);
select pg_temp.igual('ISLR anual: rebaja primero los anticipos (250) y el resto lo retenido',
  pg_temp.decl('50000000-0000-0000-0000-000000000007'), '6.4.1.01 D1000.00 H0.00 | 2.1.4.01 D0.00 H400.00 | 1.1.3.06 D0.00 H250.00 | 1.1.3.02 D0.00 H350.00');

-- Sustitutiva: solo la diferencia con la anterior.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar) values
  ('50000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'DPP', '2026-10', 'D-2', '2026-11-08', 'SUSTITUTIVA', 9500, 9500);
select pg_temp.igual('sustitutiva con más: la diferencia', pg_temp.decl('50000000-0000-0000-0000-000000000008'), '6.1.1.07 D500.00 H0.00 | 2.1.5.03 D0.00 H500.00');
update declaraciones set monto = 8800, a_pagar = 8800 where id = '50000000-0000-0000-0000-000000000008';
select pg_temp.igual('sustitutiva con menos: la diferencia al revés', pg_temp.decl('50000000-0000-0000-0000-000000000008'), '2.1.5.03 D200.00 H0.00 | 6.1.1.07 D0.00 H200.00');

-- Casos borde.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, monto, a_pagar, fecha_pago) values
  ('50000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'IVA', '2026-09', 'I-0', '2026-10-10', 0, 0, '2026-10-10');
select pg_temp.igual('a pagar cero: sin asiento de pago', pg_temp.pago('50000000-0000-0000-0000-000000000009'), '(sin asiento)');
update declaraciones set fecha_pago = null where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.igual('quitar la fecha de pago quita el pago y deja la declaración',
  pg_temp.pago('50000000-0000-0000-0000-000000000001') || ' / ' || (pg_temp.decl('50000000-0000-0000-0000-000000000001') <> '(sin asiento)')::text, '(sin asiento) / true');
delete from declaraciones where id = '50000000-0000-0000-0000-000000000006';
select pg_temp.igual('borrar la declaración deja 0 asientos',
  (select count(*)::text from asientos where origen_id = '50000000-0000-0000-0000-000000000006'), '0');

-- Una declaración vieja (de antes del motor) no se contabiliza porque un script le cambie el estado.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, monto, a_pagar) values
  ('50000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'DPP', '2026-07', 'D-VIEJA', '2026-08-18', 100, 100);
delete from asientos where origen_id = '50000000-0000-0000-0000-000000000010';
update declaraciones set estado = 'PAGO CONCILIADO', nota = 'revisada' where id = '50000000-0000-0000-0000-000000000010';
select pg_temp.igual('cambiar estado o nota no contabiliza una declaración vieja', pg_temp.decl('50000000-0000-0000-0000-000000000010'), '(sin asiento)');

-- Lo que dice la contabilidad, para el aviso de diferencias.
insert into retenciones (cuenta_id, empresa_id, direccion, tipo, fecha, comprobante, tercero_nombre, factura, base, pct, monto, periodo, quincena) values
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'practicada', 'iva', '20/10/26', 'C-1', 'P1', 'F1', 100, 75, 75, '2026-10', 2),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'practicada', 'iva', '21/10/26', 'C-2', 'P2', 'F2', 100, 25, 25, '2026-10', 2),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'practicada', 'iva', '05/10/26', 'C-3', 'P3', 'F3', 100, 75, 60, '2026-10', 1);
select pg_temp.igual('retenciones de IVA de la 2.ª quincena según la contabilidad',
  contab_declarado_vs_contable('e0000000-0000-0000-0000-000000000001', 'RET_IVA', '2026-10', 2)::text, '100.00');
select pg_temp.igual('DPP no tiene comparación', coalesce(contab_declarado_vs_contable('e0000000-0000-0000-0000-000000000001', 'DPP', '2026-10', null)::text, '(null)'), '(null)');

-- ===== Revisión final del plan 2b =====
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Otra empresa', true);

-- C1. El pago de una sustitutiva es lo que dice SU planilla (la diferencia), no el total.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar, fecha_pago) values
  ('60000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'DPP', '2026-09', 'S-O', '2026-10-03', 'ORIGINARIA', 9000, 9000, '2026-10-04'),
  ('60000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'DPP', '2026-09', 'S-S', '2026-10-08', 'SUSTITUTIVA', 9500, 500, '2026-10-09');
select pg_temp.igual('sustitutiva pagada: el pago es de 500, no de 9.500',
  pg_temp.pago('60000000-0000-0000-0000-000000000002'), '2.1.5.03 D500.00 H0.00 | 1.1.1.03 D0.00 H500.00');
select pg_temp.igual('y su declaración, la diferencia de 500',
  pg_temp.decl('60000000-0000-0000-0000-000000000002'), '6.1.1.07 D500.00 H0.00 | 2.1.5.03 D0.00 H500.00');
select pg_temp.igual('2.1.5.03 queda en cero',
  (select round(coalesce(sum(coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0)), 0), 2)::text
     from asientos a, jsonb_array_elements(a.lineas) e
    where a.empresa_id = 'e0000000-0000-0000-0000-000000000002' and e->>'cta' like '2.1.5.03%'), '0.00');

-- I2. Borrar la originaria recalcula la sustitutiva (pasa a ser el total).
delete from declaraciones where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.igual('sin originaria, la sustitutiva asienta el total',
  pg_temp.decl('60000000-0000-0000-0000-000000000002'), '6.1.1.07 D9500.00 H0.00 | 2.1.5.03 D0.00 H9500.00');
-- I2. Registrada al revés (primero la sustitutiva, después la originaria de fecha anterior): al final cuadra igual.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar) values
  ('60000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'DPP', '2026-09', 'S-O2', '2026-10-03', 'ORIGINARIA', 9000, 9000);
select pg_temp.igual('la sustitutiva se recalcula contra la originaria nueva',
  pg_temp.decl('60000000-0000-0000-0000-000000000002'), '6.1.1.07 D500.00 H0.00 | 2.1.5.03 D0.00 H500.00');

-- I3. ISLR anual con sustitutiva: los anticipos no «resucitan» y guardar dos veces da lo mismo.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, monto, a_pagar) values
  ('60000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'ISLR_ANTICIPO', '2026-06', 'AN-1', '2026-07-15', 250, 250),
  ('60000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'ISLR_ANUAL', '2026-12', 'AO-1', '2027-03-20', 1000, 400);
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar) values
  ('60000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'ISLR_ANUAL', '2026-12', 'AS-1', '2027-03-25', 'SUSTITUTIVA', 1100, 100);
select pg_temp.igual('sustitutiva de ISLR anual: 100 más de gasto, 100 más por pagar',
  pg_temp.decl('60000000-0000-0000-0000-000000000006'), '6.4.1.01 D100.00 H0.00 | 2.1.4.01 D0.00 H100.00');
update declaraciones set fecha = '2027-03-25' where id = '60000000-0000-0000-0000-000000000006';
select pg_temp.igual('volver a guardarla da lo mismo',
  pg_temp.decl('60000000-0000-0000-0000-000000000006'), '6.4.1.01 D100.00 H0.00 | 2.1.4.01 D0.00 H100.00');
select pg_temp.igual('la originaria sigue igual',
  pg_temp.decl('60000000-0000-0000-0000-000000000005'), '6.4.1.01 D1000.00 H0.00 | 2.1.4.01 D0.00 H400.00 | 1.1.3.06 D0.00 H250.00 | 1.1.3.02 D0.00 H350.00');
-- Un anticipo registrado DESPUÉS del anual lo recalcula.
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, monto, a_pagar) values
  ('60000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'ISLR_ANTICIPO', '2026-09', 'AN-2', '2026-10-15', 100, 100);
select pg_temp.igual('anticipo tardío: el anual rebaja 350 de anticipos y 250 de lo retenido',
  pg_temp.decl('60000000-0000-0000-0000-000000000005'), '6.4.1.01 D1000.00 H0.00 | 2.1.4.01 D0.00 H400.00 | 1.1.3.06 D0.00 H350.00 | 1.1.3.02 D0.00 H250.00');

-- I4. A pagar mayor que el impuesto: la base lo rechaza.
do $$
begin
  insert into declaraciones (cuenta_id, empresa_id, impuesto, periodo, numero, fecha, monto, a_pagar)
  values ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'ISLR_ANUAL', '2025-12', 'MAL-1', '2026-03-20', 1000, 1200);
  raise exception 'FALLA: se aceptó a_pagar mayor que monto';
exception when check_violation then null;
end $$;

-- I5. Comparación: IVA sin liquidación del mes → null (no un cero falso).
select pg_temp.igual('IVA sin F30: sin comparación',
  coalesce(contab_declarado_vs_contable('e0000000-0000-0000-0000-000000000002', 'IVA', '2026-08', null)::text, '(null)'), '(null)');
-- IGTF: con las reglas del motor (anuladas fuera, quincena por el día).
insert into libro_fiscal (cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, numero_factura, tipo_doc, base, iva, igtf, total) values
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'venta', '20/08/26', '2026-08', 'CLIENTE', 'G1', 'FV', 1000, 160, 30, 1190),
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'venta', '21/08/26', '2026-08', 'ANULADA', 'G2', 'FV', 0, 0, 50, 0);
select pg_temp.igual('IGTF de la 2.ª quincena, sin la anulada',
  contab_declarado_vs_contable('e0000000-0000-0000-0000-000000000002', 'IGTF', '2026-08', 2)::text, '30.00');
-- RET: una retención sin quincena guardada cae por el día de su fecha.
insert into retenciones (cuenta_id, empresa_id, direccion, tipo, fecha, comprobante, tercero_nombre, factura, base, pct, monto, periodo, quincena) values
  ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'practicada', 'islr', '22/08/26', 'Q-NULA', 'P', 'F', 100, 3, 3, '2026-08', null);
select pg_temp.igual('retención sin quincena guardada: por el día',
  contab_declarado_vs_contable('e0000000-0000-0000-0000-000000000002', 'RET_ISLR', '2026-08', 2)::text, '3.00');

-- I8. Cambiar la empresa de una declaración mueve sus asientos.
update declaraciones set empresa_id = 'e0000000-0000-0000-0000-000000000001' where id = '60000000-0000-0000-0000-000000000004';
select pg_temp.igual('el asiento sigue a la declaración a la otra empresa',
  (select empresa_id::text from asientos where origen_tabla = 'declaraciones' and origen_id = '60000000-0000-0000-0000-000000000004'),
  'e0000000-0000-0000-0000-000000000001');

-- Banco del pago: solo cuentas de efectivo (1.1.1.x); otra cosa cae a Bancos.
update declaraciones set fecha_pago = '2026-11-20', cuenta_pago = '4.1.1.01' where id = '50000000-0000-0000-0000-000000000008';
select pg_temp.igual('un «banco» que no es de efectivo cae a 1.1.1.03',
  split_part((select lineas->1->>'cta' from asientos where origen_tabla = 'declaraciones_pago' and origen_id = '50000000-0000-0000-0000-000000000008'), ' · ', 1), '1.1.1.03');

select 'TODO OK · contabilidad 06' as resultado;
rollback;
