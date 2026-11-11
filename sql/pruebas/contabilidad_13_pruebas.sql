-- ============================================================
-- Pruebas de sql/contabilidad_13_apertura_y_cuadre.sql (asiento de apertura y cuadre con la Forma 30)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite
-- (herramientas/pruebas/sql/correr-sql.js). Todo va entre begin y rollback.
-- Una falla aborta con «FALLA: <caso>»; si todo pasa: «TODO OK · contabilidad 13».
-- Toda consulta filtra por las empresas de prueba.
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
-- El asiento de apertura de una empresa ('(sin asiento)' si no tiene).
create function pg_temp.ap(emp uuid) returns text language sql as $$
  select coalesce((select fecha || ' ' || periodo || ' ' || referencia || ' ' || pg_temp.lin(lineas)
                     from asientos where origen_tabla = 'apertura' and origen_id = emp), '(sin asiento)')
$$;
create function pg_temp.cuadre(emp uuid, per text, q int) returns text language sql as $$
  select (j->>'debito_contable') || '/' || (j->>'debito_fiscal') || ' ' || (j->>'credito_contable') || '/' || (j->>'credito_fiscal')
         || ' ' || (j->>'cuadra')
    from (select contab_cuadre_iva(emp, per, q) j) x
$$;

-- Quien prueba es superadmin (en el espejo, y en Supabase el SQL Editor corre como postgres).
create or replace function public.soy_superadmin() returns boolean language sql as 'select true';

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000131', 'Firma de prueba 13', 'contador', 'contador_pro');
insert into empresas (id, cuenta_id, nombre, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'Empresa apertura', true),
  ('e0000000-0000-0000-0000-000000000132', 'a0000000-0000-0000-0000-000000000131', 'Empresa IVA libro', true),
  ('e0000000-0000-0000-0000-000000000133', 'a0000000-0000-0000-0000-000000000131', 'Empresa IVA recibos', false);

-- ── La guía trae cuenta ──────────────────────────────────────────────────
select pg_temp.igual('A1 toda la guía tiene cuenta', (select count(*)::text from apertura_guia where cuenta is null), '0');
select pg_temp.igual('A1 renglón de depreciación acumulada', (select lado || ' ' || cuenta from apertura_guia where id = 'depr_acum'), 'haber 1.2.1.09');

insert into apertura (empresa_id, cuenta_id, fecha_corte) values
  ('e0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', '2026-10-31');

-- ── Sin cuenta, la de la guía ────────────────────────────────────────────
insert into apertura_partidas (id, empresa_id, cuenta_id, grupo, descripcion, debe, haber) values
  ('b0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'cxc', 'Cliente A', 600, 0),
  ('b0000000-0000-0000-0000-000000000132', 'e0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'cxc', 'Cliente B', 400, 0),
  ('b0000000-0000-0000-0000-000000000133', 'e0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'fiscal', 'Excedente IVA', 50, 0),
  ('b0000000-0000-0000-0000-000000000134', 'e0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'cxp', 'Proveedor X', 0, 300);
insert into apertura_partidas (id, empresa_id, cuenta_id, grupo, descripcion, debe, haber, cuenta_contable) values
  ('b0000000-0000-0000-0000-000000000135', 'e0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'banco', 'Banco 1', 2000, 0, ' 1.1.1.03 ');
select pg_temp.igual('A2 cxc va a 1.1.2.01', (select cuenta_contable from apertura_partidas where id = 'b0000000-0000-0000-0000-000000000131'), '1.1.2.01');
select pg_temp.igual('A2 fiscal al debe va al excedente', (select cuenta_contable from apertura_partidas where id = 'b0000000-0000-0000-0000-000000000133'), '1.1.3.04');
select pg_temp.igual('A2 cxp va a 2.1.1.01', (select cuenta_contable from apertura_partidas where id = 'b0000000-0000-0000-0000-000000000134'), '2.1.1.01');
select pg_temp.igual('A2 la elegida se respeta (sin espacios)', (select cuenta_contable from apertura_partidas where id = 'b0000000-0000-0000-0000-000000000135'), '1.1.1.03');

-- ── No cuadra: no cierra ni asienta ──────────────────────────────────────
select pg_temp.igual('A3 sin cuadrar no cierra', (cerrar_apertura('e0000000-0000-0000-0000-000000000131')->>'ok'), 'false');
select pg_temp.igual('A3 sin asiento', pg_temp.ap('e0000000-0000-0000-0000-000000000131'), '(sin asiento)');

-- La diferencia que calcula el sistema va a resultados acumulados, no a capital.
insert into apertura_partidas (id, empresa_id, cuenta_id, grupo, descripcion, debe, haber, calculado) values
  ('b0000000-0000-0000-0000-000000000136', 'e0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'patrimonio', 'Resultados acumulados', 0, 2750, true);
select pg_temp.igual('A2 calculado va a 3.2.2.01', (select cuenta_contable from apertura_partidas where id = 'b0000000-0000-0000-0000-000000000136'), '3.2.2.01');

-- ── Una cuenta que no existe: no cierra ──────────────────────────────────
update apertura_partidas set cuenta_contable = '9.9.9' where id = 'b0000000-0000-0000-0000-000000000135';
select pg_temp.igual('A4 cuenta inexistente no cierra', (cerrar_apertura('e0000000-0000-0000-0000-000000000131')->>'ok'), 'false');
select pg_temp.igual('A4 el motivo nombra la cuenta', ((cerrar_apertura('e0000000-0000-0000-0000-000000000131')->>'motivo') like '%9.9.9%')::text, 'true');
select pg_temp.igual('A4 sigue en borrador', (select estado from apertura where empresa_id = 'e0000000-0000-0000-0000-000000000131'), 'borrador');
select pg_temp.igual('A4 sin asiento', pg_temp.ap('e0000000-0000-0000-0000-000000000131'), '(sin asiento)');
update apertura_partidas set cuenta_contable = '1.1.1.03' where id = 'b0000000-0000-0000-0000-000000000135';

-- ── Cierra y asienta: una línea por cuenta, primero el Debe ──────────────
select pg_temp.igual('A5 cierra', (cerrar_apertura('e0000000-0000-0000-0000-000000000131')->>'ok'), 'true');
select pg_temp.igual('A5 el asiento',
  pg_temp.ap('e0000000-0000-0000-0000-000000000131'),
  '31/10/2026 2026-10 APERTURA 1.1.1.03 D2000.00 H0.00 | 1.1.2.01 D1000.00 H0.00 | 1.1.3.04 D50.00 H0.00 | 2.1.1.01 D0.00 H300.00 | 3.2.2.01 D0.00 H2750.00');
select pg_temp.igual('A5 total', (select total::text from asientos where origen_tabla = 'apertura' and origen_id = 'e0000000-0000-0000-0000-000000000131'), '3050.00');
select pg_temp.igual('A5 cerrada', (select estado from apertura where empresa_id = 'e0000000-0000-0000-0000-000000000131'), 'cerrada');
select pg_temp.igual('A5 con número', (select (numero is not null)::text from asientos where origen_tabla = 'apertura' and origen_id = 'e0000000-0000-0000-0000-000000000131'), 'true');
select pg_temp.igual('A6 cerrar otra vez no duplica', (cerrar_apertura('e0000000-0000-0000-0000-000000000131')->>'ok')
  || (select count(*)::text from asientos where origen_tabla = 'apertura' and origen_id = 'e0000000-0000-0000-0000-000000000131'), 'true1');

-- ── Reabrir borra el asiento ─────────────────────────────────────────────
select pg_temp.igual('A7 reabre', (reabrir_apertura('e0000000-0000-0000-0000-000000000131', 'prueba')->>'ok'), 'true');
select pg_temp.igual('A7 sin asiento', pg_temp.ap('e0000000-0000-0000-0000-000000000131'), '(sin asiento)');

-- ── Traer los activos migrados ───────────────────────────────────────────
-- La impresora nació de una factura: el asiento de su compra ya existe.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total, cuenta_contable) values
  ('d0000000-0000-0000-0000-000000000135', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000131', 'compra', '10/03/26', '2026-03', 'PROVEEDOR', 'J000000135', '000135', 'FC', 0, 200, 0, 200, '1.2.1.04');
insert into activos_fijos (id, cuenta_id, empresa_id, codigo, nombre, categoria, fecha_adq, costo, vida_util, depreciacion_inicial, libro_fiscal_id) values
  ('c0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000131', 'AF-001', 'Computador', 'Equipos', '15/01/2024', 1000, 5, 300, null),
  ('c0000000-0000-0000-0000-000000000132', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000131', 'AF-002', 'Lote', 'Terrenos', '01/06/2020', 5000, 0, 0, null),
  ('c0000000-0000-0000-0000-000000000133', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000131', 'AF-003', 'Camión', 'Vehículos', '10/11/2026', 9000, 5, 0, null),
  ('c0000000-0000-0000-0000-000000000134', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000131', 'AF-004', 'Impresora', 'Equipos', '10/03/2026', 200, 5, 0, 'd0000000-0000-0000-0000-000000000135');
select pg_temp.igual('A8 trae dos activos', apertura_traer_activos('e0000000-0000-0000-0000-000000000131')::text, '2');
select pg_temp.igual('A8 renglones del activo',
  (select string_agg(cuenta_contable || ' D' || debe || ' H' || haber, ' | ' order by cuenta_contable)
     from apertura_partidas where empresa_id = 'e0000000-0000-0000-0000-000000000131' and ref_tabla = 'activos_fijos'),
  '1.2.1.01 D5000.00 H0.00 | 1.2.1.04 D1000.00 H0.00 | 1.2.1.09 D0.00 H300.00');
select pg_temp.igual('A8 no repite', apertura_traer_activos('e0000000-0000-0000-0000-000000000131')::text, '0');

-- ── Borrar la apertura borra su asiento ──────────────────────────────────
delete from apertura_partidas where empresa_id = 'e0000000-0000-0000-0000-000000000131' and ref_tabla = 'activos_fijos';
select pg_temp.igual('A9 vuelve a cerrar', (cerrar_apertura('e0000000-0000-0000-0000-000000000131')->>'ok'), 'true');
select reabrir_apertura('e0000000-0000-0000-0000-000000000131', 'para borrarla');
select cerrar_apertura('e0000000-0000-0000-0000-000000000131');
delete from apertura where empresa_id = 'e0000000-0000-0000-0000-000000000131';
select pg_temp.igual('A9 sin asiento al borrar', pg_temp.ap('e0000000-0000-0000-0000-000000000131'), '(sin asiento)');

-- ── Cuadre con la Forma 30 · modo libro ──────────────────────────────────
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total) values
  ('d0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000132', 'venta', '05/10/26', '2026-10', 'CLIENTE', 'J000000131', '000131', 'FV', 0, 1000, 160, 1160),
  ('d0000000-0000-0000-0000-000000000132', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000132', 'compra', '20/10/26', '2026-10', 'PROVEEDOR', 'J000000132', '000132', 'FC', 0, 500, 80, 580),
  ('d0000000-0000-0000-0000-000000000133', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000132', 'venta', '06/10/26', '2026-10', 'ANULADA', '', '000133', 'FV', 0, 300, 48, 348);
select pg_temp.igual('C1 el mes cuadra', pg_temp.cuadre('e0000000-0000-0000-0000-000000000132', '2026-10', null), '160.00/160.00 80.00/80.00 true');
select pg_temp.igual('C2 1ra quincena', pg_temp.cuadre('e0000000-0000-0000-0000-000000000132', '2026-10', 1), '160.00/160.00 0.00/0.00 true');
select pg_temp.igual('C2 2da quincena', pg_temp.cuadre('e0000000-0000-0000-0000-000000000132', '2026-10', 2), '0.00/0.00 80.00/80.00 true');
-- La quincena guardada en el libro manda sobre el día (declaración tardía).
update libro_fiscal set quincena = 2 where id = 'd0000000-0000-0000-0000-000000000131';
select pg_temp.igual('C2 quincena guardada', pg_temp.cuadre('e0000000-0000-0000-0000-000000000132', '2026-10', 2), '160.00/160.00 80.00/80.00 true');

-- La liquidación del mes no cuenta (cancela el débito y el crédito).
insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000132', '31/10/2026', '2026-10', 'Liquidación', 'F30-10/2026', 'motor',
   '[{"cta":"2.1.3.01 · IVA débito fiscal","debe":160,"haber":0},{"cta":"1.1.3.01 · IVA crédito fiscal","debe":0,"haber":80},{"cta":"2.1.4.04 · IVA por pagar","debe":0,"haber":80}]', 160);
select pg_temp.igual('C4 sin la liquidación', pg_temp.cuadre('e0000000-0000-0000-0000-000000000132', '2026-10', null), '160.00/160.00 80.00/80.00 true');

-- Un asiento a mano que toca el débito: no cuadra, y dice cuánto.
insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000132', '25/10/2026', '2026-10', 'Ajuste', 'MAN', 'manual',
   '[{"cta":"1.1.2.01 · Clientes","debe":10,"haber":0},{"cta":"2.1.3.01 · IVA débito fiscal","debe":0,"haber":10}]', 10);
select pg_temp.igual('C3 no cuadra', pg_temp.cuadre('e0000000-0000-0000-0000-000000000132', '2026-10', null), '170.00/160.00 80.00/80.00 false');
select pg_temp.igual('C3 la diferencia', (contab_cuadre_iva('e0000000-0000-0000-0000-000000000132', '2026-10', null)->>'dif_debito'), '10.00');

-- La nota de crédito resta en los dos lados.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total) values
  ('d0000000-0000-0000-0000-000000000134', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000132', 'venta', '28/10/26', '2026-10', 'CLIENTE', 'J000000131', 'NC-01', 'NC', 0, 100, 16, 116);
select pg_temp.igual('C5 NC', pg_temp.cuadre('e0000000-0000-0000-0000-000000000132', '2026-10', null), '154.00/144.00 80.00/80.00 false');
select pg_temp.igual('C6 otro mes en cero', pg_temp.cuadre('e0000000-0000-0000-0000-000000000132', '2026-09', null), '0.00/0.00 0.00/0.00 true');

-- ── Modo recibos: el débito viene de los recibos ─────────────────────────
insert into facturas (id, cuenta_id, empresa_id, numero, tipo, tipo_doc, fecha, cliente_nombre, subtotal, iva, igtf_monto, total, estado) values
  ('f0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000133', 'REC-000131', 'venta', 'FV', '10/10/2026', 'CLIENTE', 100, 16, 0, 116, 'Por cobrar'),
  ('f0000000-0000-0000-0000-000000000132', 'a0000000-0000-0000-0000-000000000131', 'e0000000-0000-0000-0000-000000000133', 'REC-000132', 'venta', 'FV', '11/10/2026', 'CLIENTE', 100, 16, 0, 116, 'Anulada');
select pg_temp.igual('C7 recibos', pg_temp.cuadre('e0000000-0000-0000-0000-000000000133', '2026-10', null), '16.00/16.00 0.00/0.00 true');

select 'TODO OK · contabilidad 13' as resultado;
rollback;
