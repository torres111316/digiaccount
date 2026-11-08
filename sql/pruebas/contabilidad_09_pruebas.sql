-- ============================================================
-- Pruebas de sql/contabilidad_09_presuncion.sql (resumen de la conciliación
-- y «Dar por cobrado y pagado»)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 09».
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
create function pg_temp.pres(per text) returns text language sql as $$
  select coalesce((select pg_temp.lin(lineas) || ' @' || fecha from asientos
                    where empresa_id = 'e0000000-0000-0000-0000-000000000091' and origen_tabla = 'presuncion'
                      and referencia = 'PRES-' || substr(per, 6, 2) || '/' || substr(per, 1, 4)), '(sin asiento)')
$$;

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000091', 'Firma de prueba', 'contador', 'contador_basico');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000091', 'a0000000-0000-0000-0000-000000000091', 'Empresa presunción', true);

-- Una venta y una compra de marzo, sin cobrar ni pagar.
insert into libro_fiscal (cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, alicuota, iva, total) values
  ('a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'venta', '10/03/26', '2026-03', 'CLIENTE', 'J000000091', 'V-1', 'FV', 0, 1000, 0.16, 160, 1160),
  ('a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'compra', '11/03/26', '2026-03', 'PROVEEDOR', 'J000000092', 'C-1', 'FC', 0, 500, 0.16, 80, 580);

select pg_temp.igual('dar por cobrado y pagado: lo que cierra',
  (select contab_dar_por_cobrado('e0000000-0000-0000-0000-000000000091', '2026-03', '1.1.1.03'))::text, '{"cxc": 1160.00, "cxp": 580.00}');
select pg_temp.igual('el asiento de la presunción, al último día del mes', pg_temp.pres('2026-03'),
  '1.1.1.03 D1160.00 H0.00 | 1.1.2.01 D0.00 H1160.00 | 2.1.1.01 D580.00 H0.00 | 1.1.1.03 D0.00 H580.00 @31/03/2026');
select contab_dar_por_cobrado('e0000000-0000-0000-0000-000000000091', '2026-03', '1.1.1.03');
select pg_temp.igual('correrlo otra vez no lo duplica',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000091' and origen_tabla = 'presuncion'), '1');

-- Se concilia un cobro de 160 del banco: la presunción baja a 1000.
insert into cuentas_tesoreria (id, cuenta_id, empresa_id, nombre, banco, tipo, moneda) values
  ('b0000000-0000-0000-0000-000000000091', 'a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'Banco uno', 'Uno', 'Corriente', 'Bs');
insert into extracto_bancario (id, cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, referencia, monto, periodo, huella, clase, estado) values
  ('c0000000-0000-0000-0000-000000000091', 'a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000091',
   '20/03/2026', 'COBRO V-1', 'R1', 160, '2026-03', 'p1', 'cobro', 'conciliada');
select pg_temp.igual('después de conciliar un cobro, la presunción toma el saldo nuevo',
  (select contab_dar_por_cobrado('e0000000-0000-0000-0000-000000000091', '2026-03', '1.1.1.03') ->> 'cxc'), '1000.00');
select pg_temp.igual('sigue siendo un solo asiento',
  (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000091' and origen_tabla = 'presuncion'), '1');

do $$
begin
  perform contab_dar_por_cobrado('e0000000-0000-0000-0000-000000000091', '2026-03', '6.1.1.01');
  raise exception 'FALLA: aceptó una cuenta que no es de efectivo';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
  if sqlerrm not like '%La cuenta debe ser de efectivo o bancos%' then raise exception 'FALLA: mensaje equivocado: %', sqlerrm; end if;
end $$;

-- Resumen de la conciliación: banco 5000; en libros 4800 + 100 de un asiento a mano
-- (en tránsito); una línea pendiente de +200. Diferencia 0.
insert into cuentas_tesoreria (id, cuenta_id, empresa_id, nombre, banco, tipo, moneda) values
  ('b0000000-0000-0000-0000-000000000092', 'a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'Banco dos', 'Dos', 'Corriente', 'Bs');
insert into estados_cuenta (cuenta_id, empresa_id, cuenta_teso_id, periodo, banco, saldo_inicial, saldo_final) values
  ('a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000092', '2026-03', 'Dos', 0, 5000);
insert into extracto_bancario (cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, referencia, monto, periodo, huella, clase, cuenta_contra, estado) values
  ('a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000092', '02/03/2026', 'APORTE', 'A1', 4800, '2026-03', 'r1', 'otra', '3.1.1.01', 'conciliada'),
  ('a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000092', '28/03/2026', 'ABONO', 'A2', 200, '2026-03', 'r2', null, null, 'pendiente');
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total)
select 'a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', '25/03/2026', 'Depósito a mano', 'MAN', 'manual',
       jsonb_build_array(jsonb_build_object('cta', cuenta_contable || ' · Banco dos', 'debe', 100, 'haber', 0),
                         jsonb_build_object('cta', '3.1.1.01 · Capital social', 'debe', 0, 'haber', 100)), 100
  from cuentas_tesoreria where id = 'b0000000-0000-0000-0000-000000000092';

select pg_temp.igual('resumen: saldos, pendientes, tránsito y diferencia',
  (select r->>'saldo_banco' || ' | ' || (r->>'saldo_libros') || ' | ' || (r->'pendientes'->>'cantidad') || '/' || (r->'pendientes'->>'suma')
          || ' | ' || (r->'transito'->>'cantidad') || '/' || (r->'transito'->>'suma') || ' | ' || (r->>'diferencia')
     from (select contab_conciliacion_resumen('b0000000-0000-0000-0000-000000000092', '2026-03') r) q),
  '5000.00 | 4900.00 | 1/200.00 | 1/100.00 | 0.00');
select pg_temp.igual('resumen sin estado de cuenta cargado: sin diferencia que calcular',
  (select coalesce(contab_conciliacion_resumen('b0000000-0000-0000-0000-000000000091', '2026-03') ->> 'diferencia', 'null')), 'null');

-- REVISIÓN FINAL · I5: con saldo inicial y una línea pendiente del mes anterior, la diferencia da 0.
insert into cuentas_tesoreria (id, cuenta_id, empresa_id, nombre, banco, tipo, moneda) values
  ('b0000000-0000-0000-0000-000000000093', 'a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'Banco tres', 'Tres', 'Corriente', 'Bs');
insert into estados_cuenta (cuenta_id, empresa_id, cuenta_teso_id, periodo, banco, saldo_inicial, saldo_final) values
  ('a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000093', '2026-02', 'Tres', 1000, 1300),
  ('a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000093', '2026-03', 'Tres', 1300, 1300);
insert into extracto_bancario (cuenta_id, empresa_id, cuenta_teso_id, fecha, descripcion, referencia, monto, periodo, huella) values
  ('a0000000-0000-0000-0000-000000000091', 'e0000000-0000-0000-0000-000000000091', 'b0000000-0000-0000-0000-000000000093', '15/02/2026', 'ABONO FEB', 'F1', 300, '2026-02', 't1');
select pg_temp.igual('resumen con saldo de arranque y pendiente de febrero',
  (select (r->>'saldo_apertura') || ' | ' || (r->'pendientes'->>'suma') || ' | ' || (r->>'diferencia')
     from (select contab_conciliacion_resumen('b0000000-0000-0000-0000-000000000093', '2026-03') r) q),
  '1000.00 | 300.00 | 0.00');

select 'TODO OK · contabilidad 09';
rollback;
