-- ============================================================
-- Pruebas de sql/contabilidad_14_relacionadas.sql (cuentas de empresas relacionadas y accionistas)
-- Todo va entre begin y rollback. Si todo pasa: «TODO OK · contabilidad 14».
-- ============================================================
begin;

create function pg_temp.igual(caso text, obtenido text, esperado text) returns void language plpgsql as $$
begin
  if obtenido is distinct from esperado then
    raise exception 'FALLA: % → %   (esperado %)', caso, coalesce(obtenido, '(null)'), esperado;
  end if;
end $$;

select pg_temp.igual('las cuatro cuentas existen',
  (select string_agg(codigo || ' ' || naturaleza, ' | ' order by codigo) from plan_cuentas_base
    where codigo in ('1.1.2.06', '1.1.2.07', '2.1.5.02', '2.1.5.04')),
  '1.1.2.06 Deudora | 1.1.2.07 Deudora | 2.1.5.02 Acreedora | 2.1.5.04 Acreedora');
select pg_temp.igual('los motores las pueden usar', contab_cta('2.1.5.02'), '2.1.5.02 · Cuentas por pagar a empresas relacionadas');
select pg_temp.igual('no son grupos (reciben movimientos)',
  (select count(*)::text from plan_cuentas_base where codigo in ('1.1.2.06', '1.1.2.07', '2.1.5.02', '2.1.5.04') and tipo ilike 'grupo'), '0');

select 'TODO OK · contabilidad 14' as resultado;
rollback;
