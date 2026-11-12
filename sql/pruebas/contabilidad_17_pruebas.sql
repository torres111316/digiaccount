-- ============================================================
-- Pruebas de sql/contabilidad_17_consultas_agentes.sql (consultas de los agentes)
-- Todo va entre begin y rollback. Si todo pasa: «TODO OK · contabilidad 17».
-- ============================================================
begin;

create function pg_temp.igual(caso text, obtenido text, esperado text) returns void language plpgsql as $$
begin
  if obtenido is distinct from esperado then
    raise exception 'FALLA: % → %   (esperado %)', caso, coalesce(obtenido, '(null)'), esperado;
  end if;
end $$;

create or replace function public.soy_superadmin() returns boolean language sql as 'select true';
insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000171', 'Firma de prueba 17', 'contador', 'contador_pro');
insert into empresas (id, cuenta_id, nombre, rif, fiscal_activo, contab_resumen) values
  ('e0000000-0000-0000-0000-000000000171', 'a0000000-0000-0000-0000-000000000171', 'Saldos', 'J000000171', true, false);
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000171', 'e0000000-0000-0000-0000-000000000171', '15/09/2026', 'Aporte', 'A1', 'manual',
   '[{"cta":"1.1.1.03.01 · Banco","debe":1000,"haber":0},{"cta":"3.1.1.01 · Capital","debe":0,"haber":1000}]', 1000),
  ('a0000000-0000-0000-0000-000000000171', 'e0000000-0000-0000-0000-000000000171', '10/10/2026', 'Venta', 'A2', 'manual',
   '[{"cta":"1.1.1.01 · Caja","debe":200,"haber":0},{"cta":"4.1.1.01 · Ventas","debe":0,"haber":200}]', 200),
  ('a0000000-0000-0000-0000-000000000171', 'e0000000-0000-0000-0000-000000000171', '05/11/2026', 'Después', 'A3', 'manual',
   '[{"cta":"1.1.1.01 · Caja","debe":50,"haber":0},{"cta":"4.1.1.01 · Ventas","debe":0,"haber":50}]', 50);

select pg_temp.igual('S1 detalle de octubre (saldo anterior, debe, haber, final)',
  (select string_agg(cuenta || ' ' || saldo_anterior || '/' || debe || '/' || haber || '/' || saldo_final, ' | ' order by cuenta)
     from contab_saldos_periodo('e0000000-0000-0000-0000-000000000171', '2026-10-01', '2026-10-31', 1)),
  '1.1.1.01 0.00/200.00/0.00/200.00 | 1.1.1.03.01 1000.00/0.00/0.00/1000.00 | 3.1.1.01 -1000.00/0.00/0.00/-1000.00 | 4.1.1.01 0.00/0.00/200.00/-200.00');
select pg_temp.igual('S2 nivel Cuenta: caja y bancos juntos en 1.1.1, con el nombre del plan',
  (select cuenta || ' ' || nombre || ' ' || saldo_final from contab_saldos_periodo('e0000000-0000-0000-0000-000000000171', '2026-10-01', '2026-10-31', 2) where cuenta = '1.1.1'),
  '1.1.1 Efectivo y Equivalentes de Efectivo 1200.00');
select pg_temp.igual('S3 nivel Clase: cuadra (la suma de saldos es cero)',
  (select sum(saldo_final)::text from contab_saldos_periodo('e0000000-0000-0000-0000-000000000171', '2026-10-01', '2026-10-31', 4)), '0.00');

-- Lo corregido: en una empresa en revisión, una declaración aprobada con otra cuenta.
update empresas set contab_resumen = true where id = 'e0000000-0000-0000-0000-000000000171';
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar) values
  ('50000000-0000-0000-0000-000000000171', 'a0000000-0000-0000-0000-000000000171', 'e0000000-0000-0000-0000-000000000171', 'DPP', '2026-10', 'D-171', '2026-11-03', 'ORIGINARIA', 90, 90);
select contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000171'),
  '[{"cta":"6.1.1.16","debe":90,"haber":0},{"cta":"2.1.5.03","debe":0,"haber":90}]');
select pg_temp.igual('S4 lo corregido', (select que || ' ' || periodo || ' ' || (propuesta->0->>'cta') || ' >> ' || (aprobado->0->>'cta')
  from contab_correcciones('e0000000-0000-0000-0000-000000000171')),
  'propuesta del módulo: declaraciones 2026-10 6.1.1.07 · Aporte Protección a las Pensiones (9%) >> 6.1.1.16 · Gastos generales');

select 'TODO OK · contabilidad 17' as resultado;
rollback;
