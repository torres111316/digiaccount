-- ============================================================
-- Pruebas de sql/contabilidad_15_resumen_por_periodo.sql (compras, ventas y retenciones en resumen por período)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite. Todo va entre begin y rollback.
-- Si todo pasa: «TODO OK · contabilidad 15». Toda consulta filtra por las empresas de prueba.
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
create function pg_temp.n_doc(emp uuid) returns text language sql as $$
  select count(*)::text from asientos where empresa_id = emp and origen_tabla in ('libro_fiscal', 'retenciones')
$$;
create function pg_temp.estado(emp uuid, tipo text, per text, q int) returns text language sql as $$
  select e->>'estado' from jsonb_array_elements(contab_por_contabilizar(emp, per, per)) e
   where e->>'tipo' = tipo and coalesce((e->>'quincena')::int, 0) = coalesce(q, 0)
$$;

create or replace function public.soy_superadmin() returns boolean language sql as 'select true';

insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000151', 'Firma de prueba 15', 'contador', 'contador_pro');
insert into empresas (id, cuenta_id, nombre, rif, condicion_fiscal, fiscal_activo) values
  ('e0000000-0000-0000-0000-000000000151', 'a0000000-0000-0000-0000-000000000151', 'Ordinaria', 'J000000151', 'ordinario', true),
  ('e0000000-0000-0000-0000-000000000152', 'a0000000-0000-0000-0000-000000000151', 'Especial C.A.', 'J000000152', 'especial', true),
  ('e0000000-0000-0000-0000-000000000153', 'a0000000-0000-0000-0000-000000000151', 'Especial F.P.', 'V000000153', 'especial', true);

-- ── Por documento (sin marcar) el motor sigue igual ──────────────────────
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total) values
  ('d0000000-0000-0000-0000-000000000150', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000151', 'venta', '02/10/26', '2026-10', 'CLIENTE', 'J000000999', '000150', 'FV', 0, 50, 8, 58);
select pg_temp.igual('R0 sin marcar: asiento por documento', pg_temp.n_doc('e0000000-0000-0000-0000-000000000151'), '1');

-- ── En resumen: ninguna factura ni retención deja asiento propio ─────────
update empresas set contab_resumen = true where cuenta_id = 'a0000000-0000-0000-0000-000000000151';
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total, cuenta_contable) values
  ('d0000000-0000-0000-0000-000000000151', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000151', 'venta', '05/10/26', '2026-10', 'CLIENTE', 'J000000999', '000151', 'FV', 0, 1000, 160, 1160, null),
  ('d0000000-0000-0000-0000-000000000152', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000151', 'venta', '20/10/26', '2026-10', 'CLIENTE', 'J000000999', '000152', 'FV', 0, 500, 80, 580, null),
  ('d0000000-0000-0000-0000-000000000153', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000151', 'venta', '25/10/26', '2026-10', 'CLIENTE', 'J000000999', 'NC-1', 'NC', 0, 100, 16, 116, null),
  ('d0000000-0000-0000-0000-000000000154', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000151', 'venta', '26/10/26', '2026-10', 'ANULADA', '', '000154', 'FV', 0, 300, 48, 348, null),
  ('d0000000-0000-0000-0000-000000000155', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000151', 'compra', '10/10/26', '2026-10', 'PROVEEDOR A', 'J000000155', 'C-1', 'FC', 0, 500, 80, 580, null),
  ('d0000000-0000-0000-0000-000000000156', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000151', 'compra', '12/10/26', '2026-10', 'ALQUILER', 'J000000156', 'C-2', 'FC', 0, 200, 32, 232, '6.1.1.03');
insert into retenciones (id, cuenta_id, empresa_id, direccion, tipo, fecha, periodo, comprobante, tercero_nombre, factura, monto) values
  ('d1000000-0000-0000-0000-000000000151', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000151', 'practicada', 'islr', '10/10/26', '2026-10', 'ISLR-1', 'PROVEEDOR A', 'C-1', 10);
select pg_temp.igual('R1 en resumen no hay asiento por documento (queda el de antes)', pg_temp.n_doc('e0000000-0000-0000-0000-000000000151'), '1');
-- El documento de antes (con asiento propio) no se suma otra vez.
select pg_temp.igual('R1 documentos y con asiento propio',
  (select (j->>'documentos') || '/' || (j->>'con_asiento_propio') from (select contab_propuesta_resumen('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10') j) x), '3/1');

-- ── La propuesta: las líneas del motor sumadas y neteadas por cuenta ─────
select pg_temp.igual('R2 ventas (la NC resta, la anulada no entra)',
  pg_temp.lin(contab_propuesta_resumen('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10')->'lineas'),
  '1.1.2.01 D1624.00 H0.00 | 2.1.3.01 D0.00 H224.00 | 4.1.1.01 D0.00 H1400.00');
select pg_temp.igual('R2 compras con la cuenta de cada factura',
  pg_temp.lin(contab_propuesta_resumen('e0000000-0000-0000-0000-000000000151', 'compras', '2026-10')->'lineas'),
  '1.1.3.01 D112.00 H0.00 | 5.1.1.02 D500.00 H0.00 | 6.1.1.03 D200.00 H0.00 | 2.1.1.01 D0.00 H812.00');

-- ── Periodicidad: la de la declaración de cada impuesto ──────────────────
select pg_temp.igual('R3 ordinario: todo mensual',
  contab_resumen_quincenal('e0000000-0000-0000-0000-000000000151', '2026-10', 'ventas')::text
  || contab_resumen_quincenal('e0000000-0000-0000-0000-000000000151', '2026-10', 'ret_iva_practicadas')::text, 'falsefalse');
select pg_temp.igual('R3 especial C.A.: IVA y retenciones de IVA por quincena, ISLR mensual',
  contab_resumen_quincenal('e0000000-0000-0000-0000-000000000152', '2026-10', 'compras')::text || '/'
  || contab_resumen_quincenal('e0000000-0000-0000-0000-000000000152', '2026-10', 'ret_iva_practicadas')::text || '/'
  || contab_resumen_quincenal('e0000000-0000-0000-0000-000000000152', '2026-10', 'ret_islr_practicadas')::text, 'true/true/false');
select pg_temp.igual('R3 especial F.P. (Radian): IVA mensual, retenciones de IVA por quincena',
  contab_resumen_quincenal('e0000000-0000-0000-0000-000000000153', '2026-10', 'ventas')::text || '/'
  || contab_resumen_quincenal('e0000000-0000-0000-0000-000000000153', '2026-10', 'ret_iva_sufridas')::text || '/'
  || contab_resumen_quincenal('e0000000-0000-0000-0000-000000000153', '2026-10', 'ret_iva_practicadas')::text, 'false/false/true');
-- La condición es la del período: GATMA dejó de ser especial en noviembre.
insert into empresa_condicion_historial (empresa_id, desde, condicion) values ('e0000000-0000-0000-0000-000000000152', '2026-11', 'ordinario');
select pg_temp.igual('R3 la condición del período, no la de hoy',
  contab_resumen_quincenal('e0000000-0000-0000-0000-000000000152', '2026-10', 'ventas')::text || '/'
  || contab_resumen_quincenal('e0000000-0000-0000-0000-000000000152', '2026-11', 'ventas')::text, 'true/false');

-- Especial C.A.: la venta del 05/10 y la del 20/10 van a quincenas distintas.
insert into libro_fiscal (id, cuenta_id, empresa_id, tipo, fecha, periodo, tercero_nombre, tercero_rif, numero_factura, tipo_doc, exento, base, iva, total) values
  ('d0000000-0000-0000-0000-000000000157', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000152', 'venta', '05/10/26', '2026-10', 'CLIENTE', 'J000000999', '000157', 'FV', 0, 100, 16, 116),
  ('d0000000-0000-0000-0000-000000000158', 'a0000000-0000-0000-0000-000000000151', 'e0000000-0000-0000-0000-000000000152', 'venta', '20/10/26', '2026-10', 'CLIENTE', 'J000000999', '000158', 'FV', 0, 200, 32, 232);
select pg_temp.igual('R3 por quincena',
  pg_temp.lin(contab_propuesta_resumen('e0000000-0000-0000-0000-000000000152', 'ventas', '2026-10', 1)->'lineas') || ' // '
  || pg_temp.lin(contab_propuesta_resumen('e0000000-0000-0000-0000-000000000152', 'ventas', '2026-10', 2)->'lineas'),
  '1.1.2.01 D116.00 H0.00 | 2.1.3.01 D0.00 H16.00 | 4.1.1.01 D0.00 H100.00 // 1.1.2.01 D232.00 H0.00 | 2.1.3.01 D0.00 H32.00 | 4.1.1.01 D0.00 H200.00');
select pg_temp.igual('R3 sin la quincena no se aprueba', (contab_aprobar_resumen('e0000000-0000-0000-0000-000000000152', 'ventas', '2026-10')->>'ok'), 'false');
-- (cada consulta ve lo que dejó la anterior, no lo que hace ella misma: van separadas)
select pg_temp.igual('R3 la quincena 1 se aprueba', (contab_aprobar_resumen('e0000000-0000-0000-0000-000000000152', 'ventas', '2026-10', 1)->>'ok'), 'true');
select pg_temp.igual('R3 y su asiento va al 15', (select fecha || ' ' || referencia from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000152' and origen = 'resumen'), '15/10/2026 RES-VEN-10/2026-Q1');

-- ── Aprobar ──────────────────────────────────────────────────────────────
select pg_temp.igual('R4 pendiente antes de aprobar', pg_temp.estado('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10', null), 'pendiente');
select pg_temp.igual('R4 el mes no cierra con resúmenes pendientes', (contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000151', '2026-10') > 0)::text, 'true');
select pg_temp.igual('R4 aprueba tal cual', (contab_aprobar_resumen('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10')->>'corregido'), 'false');
select pg_temp.igual('R4 el asiento resumen',
  (select fecha || ' ' || periodo || ' ' || referencia || ' ' || pg_temp.lin(lineas) from asientos
    where empresa_id = 'e0000000-0000-0000-0000-000000000151' and origen = 'resumen' and referencia like 'RES-VEN%'),
  '31/10/2026 2026-10 RES-VEN-10/2026 1.1.2.01 D1624.00 H0.00 | 2.1.3.01 D0.00 H224.00 | 4.1.1.01 D0.00 H1400.00');
select pg_temp.igual('R4 aprobado', pg_temp.estado('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10', null), 'aprobado');

-- Corregido: Luis manda la compra de mercancía a gastos generales. Queda lo propuesto y lo aprobado.
select pg_temp.igual('R5 aprueba corregido', (contab_aprobar_resumen('e0000000-0000-0000-0000-000000000151', 'compras', '2026-10', null,
  '[{"cta":"1.1.3.01","debe":112,"haber":0},{"cta":"6.1.1.16","debe":500,"haber":0},{"cta":"6.1.1.03","debe":200,"haber":0},{"cta":"2.1.1.01","debe":0,"haber":812}]')->>'corregido'), 'true');
select pg_temp.igual('R5 lo propuesto y lo aprobado quedan guardados',
  (select pg_temp.lin(propuesta) || ' >> ' || pg_temp.lin(lineas) from contab_resumenes where empresa_id = 'e0000000-0000-0000-0000-000000000151' and tipo = 'compras'),
  '1.1.3.01 D112.00 H0.00 | 5.1.1.02 D500.00 H0.00 | 6.1.1.03 D200.00 H0.00 | 2.1.1.01 D0.00 H812.00 >> 1.1.3.01 D112.00 H0.00 | 6.1.1.16 D500.00 H0.00 | 6.1.1.03 D200.00 H0.00 | 2.1.1.01 D0.00 H812.00');
select pg_temp.igual('R5 el asiento lleva el nombre de la cuenta',
  (select lineas->1->>'cta' from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000151' and referencia = 'RES-COM-10/2026'), '6.1.1.16 · Gastos generales');

-- Lo que no se acepta
select pg_temp.igual('R6 no cuadra', ((contab_aprobar_resumen('e0000000-0000-0000-0000-000000000151', 'ret_islr_practicadas', '2026-10', null,
  '[{"cta":"2.1.1.01","debe":10,"haber":0},{"cta":"2.1.3.03","debe":0,"haber":9}]')->>'motivo') like 'El asiento no cuadra%')::text, 'true');
select pg_temp.igual('R6 un grupo del plan', ((contab_aprobar_resumen('e0000000-0000-0000-0000-000000000151', 'ret_islr_practicadas', '2026-10', null,
  '[{"cta":"2.1.1","debe":10,"haber":0},{"cta":"2.1.3.03","debe":0,"haber":10}]')->>'motivo') like '%grupo del plan%')::text, 'true');
select pg_temp.igual('R6 la retención de ISLR tal cual', pg_temp.lin(contab_propuesta_resumen('e0000000-0000-0000-0000-000000000151', 'ret_islr_practicadas', '2026-10')->'lineas'),
  '2.1.1.01 D10.00 H0.00 | 2.1.3.03 D0.00 H10.00');
select pg_temp.igual('R6 sin documentos no hay resumen', (contab_aprobar_resumen('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-09')->>'ok'), 'false');

-- ── Un documento cambia: el resumen queda desactualizado ─────────────────
update libro_fiscal set base = 600, iva = 96, total = 696 where id = 'd0000000-0000-0000-0000-000000000152';
select pg_temp.igual('R7 desactualizado', pg_temp.estado('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10', null), 'desactualizado');
select pg_temp.igual('R7 sigue sin asiento propio', pg_temp.n_doc('e0000000-0000-0000-0000-000000000151'), '1');
select pg_temp.igual('R7 rehacerlo', (contab_aprobar_resumen('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10')->>'ok'), 'true');
select pg_temp.igual('R7 reemplaza el asiento', (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000151' and referencia = 'RES-VEN-10/2026')
  || ' ' || pg_temp.estado('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10', null), '1 aprobado');
select contab_aprobar_resumen('e0000000-0000-0000-0000-000000000151', 'ret_islr_practicadas', '2026-10');
select pg_temp.igual('R7 con todo aprobado el mes se puede cerrar', contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000151', '2026-10')::text, '0');

-- ── Deshacer y borrar a mano ─────────────────────────────────────────────
select pg_temp.igual('R8 deshacer', (contab_deshacer_resumen((select id from contab_resumenes where empresa_id = 'e0000000-0000-0000-0000-000000000151' and tipo = 'ventas'))->>'ok'), 'true');
select pg_temp.igual('R8 vuelve a pendiente y sin asiento', pg_temp.estado('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10', null)
  || ' ' || (select count(*)::text from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000151' and referencia = 'RES-VEN-10/2026'), 'pendiente 0');
delete from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000151' and referencia = 'RES-COM-10/2026';
select pg_temp.igual('R8 borrar el asiento a mano lo deja pendiente', pg_temp.estado('e0000000-0000-0000-0000-000000000151', 'compras', '2026-10', null), 'pendiente');

-- Quien no tiene la empresa no aprueba.
create or replace function public.soy_superadmin() returns boolean language sql as 'select false';
create or replace function public.mis_empresas() returns setof uuid language sql as $q$ select 'e0000000-0000-0000-0000-000000000152'::uuid $q$;
select pg_temp.igual('R9 empresa ajena', (contab_aprobar_resumen('e0000000-0000-0000-0000-000000000151', 'ventas', '2026-10')->>'motivo'), 'Esa empresa no es de tu cuenta.');

select 'TODO OK · contabilidad 15' as resultado;
rollback;
