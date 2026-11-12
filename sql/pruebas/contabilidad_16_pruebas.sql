-- ============================================================
-- Pruebas de sql/contabilidad_16_propuestas.sql (lo que proponen los módulos pasa por aprobación)
-- Se pueden correr en Supabase (SQL Editor) o en PGlite. Todo va entre begin y rollback.
-- Si todo pasa: «TODO OK · contabilidad 16». Toda consulta filtra por las empresas de prueba.
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
           || ' H' || round(coalesce((e->>'haber')::numeric, 0), 2), ' | ' order by n), '(vacío)')
    from jsonb_array_elements(j) with ordinality as t(e, n)
$$;
-- El asiento de verdad de una clave, y su borrador.
create function pg_temp.asi(emp uuid, tabla text, oid uuid, ref text) returns text language sql as $$
  select coalesce((select string_agg(pg_temp.lin(lineas), ' // ') from asientos
                    where empresa_id = emp and coalesce(origen_tabla, '') = coalesce(tabla, '')
                      and (oid is null or origen_id = oid) and (ref is null or referencia = ref)), '(sin asiento)')
$$;
create function pg_temp.bor(emp uuid, k text) returns text language sql as $$
  select coalesce((select case when pendiente then 'pendiente ' else 'aprobado ' end || pg_temp.lin(propuesta)
                     from contab_borradores where empresa_id = emp and clave = k), '(sin borrador)')
$$;

create or replace function public.soy_superadmin() returns boolean language sql as 'select true';
insert into cuentas (id, nombre, segmento, plan_id) values ('a0000000-0000-0000-0000-000000000161', 'Firma de prueba 16', 'contador', 'contador_pro');
insert into empresas (id, cuenta_id, nombre, rif, fiscal_activo, contab_resumen) values
  ('e0000000-0000-0000-0000-000000000161', 'a0000000-0000-0000-0000-000000000161', 'En revisión', 'J000000161', true, true),
  ('e0000000-0000-0000-0000-000000000162', 'a0000000-0000-0000-0000-000000000161', 'Por documento', 'J000000162', true, false);

-- ── Una declaración: queda propuesta, no asentada ────────────────────────
insert into declaraciones (id, cuenta_id, empresa_id, impuesto, periodo, numero, fecha, tipo, monto, a_pagar) values
  ('50000000-0000-0000-0000-000000000161', 'a0000000-0000-0000-0000-000000000161', 'e0000000-0000-0000-0000-000000000161', 'DPP', '2026-10', 'D-161', '2026-11-03', 'ORIGINARIA', 9000, 9000);
select pg_temp.igual('B1 sin asiento todavía', pg_temp.asi('e0000000-0000-0000-0000-000000000161', 'declaraciones', '50000000-0000-0000-0000-000000000161', null), '(sin asiento)');
select pg_temp.igual('B1 la propuesta', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'declaraciones:50000000-0000-0000-0000-000000000161'),
  'pendiente 6.1.1.07 D9000.00 H0.00 | 2.1.5.03 D0.00 H9000.00');
select pg_temp.igual('B1 «Cerrar mes» la cuenta como pendiente', (contab_filas_sin_asiento('e0000000-0000-0000-0000-000000000161', '2026-10') >= 1)::text, 'true');

-- Aprobada: el asiento de siempre (mismo origen), y ya no está pendiente.
select pg_temp.igual('B2 aprobar', (contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161'
  and clave = 'declaraciones:50000000-0000-0000-0000-000000000161'))->>'ok'), 'true');
select pg_temp.igual('B2 el asiento', pg_temp.asi('e0000000-0000-0000-0000-000000000161', 'declaraciones', '50000000-0000-0000-0000-000000000161', null),
  '6.1.1.07 D9000.00 H0.00 | 2.1.5.03 D0.00 H9000.00');
select pg_temp.igual('B2 aprobado', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'declaraciones:50000000-0000-0000-0000-000000000161'),
  'aprobado 6.1.1.07 D9000.00 H0.00 | 2.1.5.03 D0.00 H9000.00');
select pg_temp.igual('B2 el aviso de declarado contra contable sigue leyendo el asiento', (select count(*)::text from asientos
  where origen_tabla = 'declaraciones' and origen_id = '50000000-0000-0000-0000-000000000161' and numero is not null), '1');

-- ── Corregir la declaración: el asiento aprobado no se toca hasta aprobar ─
update declaraciones set monto = 9500, a_pagar = 9500 where id = '50000000-0000-0000-0000-000000000161';
select pg_temp.igual('B3 el aprobado sigue igual', pg_temp.asi('e0000000-0000-0000-0000-000000000161', 'declaraciones', '50000000-0000-0000-0000-000000000161', null),
  '6.1.1.07 D9000.00 H0.00 | 2.1.5.03 D0.00 H9000.00');
select pg_temp.igual('B3 la propuesta nueva', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'declaraciones:50000000-0000-0000-0000-000000000161'),
  'pendiente 6.1.1.07 D9500.00 H0.00 | 2.1.5.03 D0.00 H9500.00');
-- Versión vieja: no se aprueba sobre lo que ya cambió.
select pg_temp.igual('B3 versión vieja', ((contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161'
  and clave = 'declaraciones:50000000-0000-0000-0000-000000000161'), null, 1)->>'motivo') like 'El módulo cambió%')::text, 'true');
-- Aprobada corregida (Luis manda el gasto a otra cuenta).
select pg_temp.igual('B3 aprobar corregido', (contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161'
  and clave = 'declaraciones:50000000-0000-0000-0000-000000000161'),
  '[{"cta":"6.1.1.16","debe":9500,"haber":0},{"cta":"2.1.5.03","debe":0,"haber":9500}]')->>'ok'), 'true');
select pg_temp.igual('B3 un solo asiento, el corregido', pg_temp.asi('e0000000-0000-0000-0000-000000000161', 'declaraciones', '50000000-0000-0000-0000-000000000161', null),
  '6.1.1.16 D9500.00 H0.00 | 2.1.5.03 D0.00 H9500.00');
select pg_temp.igual('B3 queda lo propuesto y lo aprobado', (select corregido::text || ' ' || pg_temp.lin(propuesta) || ' >> ' || pg_temp.lin(aprobado)
  from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161' and clave = 'declaraciones:50000000-0000-0000-0000-000000000161'),
  'true 6.1.1.07 D9500.00 H0.00 | 2.1.5.03 D0.00 H9500.00 >> 6.1.1.16 D9500.00 H0.00 | 2.1.5.03 D0.00 H9500.00');

-- ── Borrar la declaración: se pide borrar el asiento, y se aprueba ───────
delete from declaraciones where id = '50000000-0000-0000-0000-000000000161';
select pg_temp.igual('B4 el asiento sigue hasta aprobar', (pg_temp.asi('e0000000-0000-0000-0000-000000000161', 'declaraciones', '50000000-0000-0000-0000-000000000161', null) <> '(sin asiento)')::text, 'true');
select pg_temp.igual('B4 pedido de borrar', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'declaraciones:50000000-0000-0000-0000-000000000161'), 'pendiente (vacío)');
select pg_temp.igual('B4 aprobar el borrado', (contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161'
  and clave = 'declaraciones:50000000-0000-0000-0000-000000000161'))->>'borrado'), 'true');
select pg_temp.igual('B4 sin asiento', pg_temp.asi('e0000000-0000-0000-0000-000000000161', 'declaraciones', '50000000-0000-0000-0000-000000000161', null), '(sin asiento)');

-- ── Lo que hace el navegador (nómina): reemplazar no deja el período vacío ─
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000161', 'e0000000-0000-0000-0000-000000000161', '31/10/2026', 'Nómina', 'NOM-q-2026-10-16', 'auto',
   '[{"cta":"6.1.1.01 · Sueldos","debe":1000,"haber":0},{"cta":"1.1.1.03 · Bancos","debe":0,"haber":1000}]', 1000);
select pg_temp.igual('B5 la nómina queda propuesta', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'modulo:ref:NOM-q-2026-10-16'),
  'pendiente 6.1.1.01 D1000.00 H0.00 | 1.1.1.03 D0.00 H1000.00');
select contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161' and clave = 'modulo:ref:NOM-q-2026-10-16'));
-- Recontabilizar: el navegador inserta la nueva y después borra la vieja.
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000161', 'e0000000-0000-0000-0000-000000000161', '31/10/2026', 'Nómina', 'NOM-q-2026-10-16', 'auto',
   '[{"cta":"6.1.1.01 · Sueldos","debe":1200,"haber":0},{"cta":"1.1.1.03 · Bancos","debe":0,"haber":1200}]', 1200);
delete from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000161' and referencia = 'NOM-q-2026-10-16';
select pg_temp.igual('B5 el aprobado sigue', pg_temp.asi('e0000000-0000-0000-0000-000000000161', null, null, 'NOM-q-2026-10-16'), '6.1.1.01 D1000.00 H0.00 | 1.1.1.03 D0.00 H1000.00');
select pg_temp.igual('B5 y la nueva espera', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'modulo:ref:NOM-q-2026-10-16'),
  'pendiente 6.1.1.01 D1200.00 H0.00 | 1.1.1.03 D0.00 H1200.00');
select contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161' and clave = 'modulo:ref:NOM-q-2026-10-16'));
select pg_temp.igual('B5 aprobada: una sola, la nueva', pg_temp.asi('e0000000-0000-0000-0000-000000000161', null, null, 'NOM-q-2026-10-16'), '6.1.1.01 D1200.00 H0.00 | 1.1.1.03 D0.00 H1200.00');
-- Recontabilizar con los mismos montos no deja nada pendiente ni borra nada.
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000161', 'e0000000-0000-0000-0000-000000000161', '31/10/2026', 'Nómina', 'NOM-q-2026-10-16', 'auto',
   (select lineas from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000161' and referencia = 'NOM-q-2026-10-16'), 1200);
delete from asientos where empresa_id = 'e0000000-0000-0000-0000-000000000161' and referencia = 'NOM-q-2026-10-16';
select pg_temp.igual('B5 igual que lo aprobado: nada que aprobar', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'modulo:ref:NOM-q-2026-10-16')
  || ' / ' || pg_temp.asi('e0000000-0000-0000-0000-000000000161', null, null, 'NOM-q-2026-10-16'),
  'aprobado 6.1.1.01 D1200.00 H0.00 | 1.1.1.03 D0.00 H1200.00 / 6.1.1.01 D1200.00 H0.00 | 1.1.1.03 D0.00 H1200.00');

-- ── Lo que no pasa por el guardián ───────────────────────────────────────
insert into asientos (cuenta_id, empresa_id, fecha, descripcion, referencia, origen, lineas, total) values
  ('a0000000-0000-0000-0000-000000000161', 'e0000000-0000-0000-0000-000000000161', '20/10/2026', 'A mano', 'MAN-1', 'manual',
   '[{"cta":"6.1.1.16 · Gastos","debe":5,"haber":0},{"cta":"1.1.1.01 · Caja","debe":0,"haber":5}]', 5),
  ('a0000000-0000-0000-0000-000000000161', 'e0000000-0000-0000-0000-000000000162', '20/10/2026', 'Nómina', 'NOM-x', 'auto',
   '[{"cta":"6.1.1.01 · Sueldos","debe":5,"haber":0},{"cta":"1.1.1.01 · Caja","debe":0,"haber":5}]', 5);
select pg_temp.igual('B6 el asiento a mano entra directo', pg_temp.asi('e0000000-0000-0000-0000-000000000161', null, null, 'MAN-1'), '6.1.1.16 D5.00 H0.00 | 1.1.1.01 D0.00 H5.00');
select pg_temp.igual('B6 la empresa por documento sigue como siempre', pg_temp.asi('e0000000-0000-0000-0000-000000000162', null, null, 'NOM-x'), '6.1.1.01 D5.00 H0.00 | 1.1.1.01 D0.00 H5.00');

-- ── Depreciación (SQL 07) ────────────────────────────────────────────────
insert into activos_fijos (id, cuenta_id, empresa_id, codigo, nombre, categoria, fecha_adq, costo, vida_util) values
  ('c0000000-0000-0000-0000-000000000161', 'a0000000-0000-0000-0000-000000000161', 'e0000000-0000-0000-0000-000000000161', 'AF-1', 'Computador', 'Equipos', '15/01/2026', 1200, 1);
select contab_depreciar('e0000000-0000-0000-0000-000000000161', '2026-02');
select pg_temp.igual('B7 la depreciación queda propuesta', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'depreciacion:ref:DEPR-02/2026'),
  'pendiente 6.1.1.19 D100.00 H0.00 | 1.2.1.09 D0.00 H100.00');
select pg_temp.igual('B7 sin asiento', pg_temp.asi('e0000000-0000-0000-0000-000000000161', 'depreciacion', null, 'DEPR-02/2026'), '(sin asiento)');

-- ── Mes cerrado, descartar, empresa ajena ────────────────────────────────
insert into cierres_mensuales (cuenta_id, empresa_id, periodo) values ('a0000000-0000-0000-0000-000000000161', 'e0000000-0000-0000-0000-000000000161', '2026-02');
select pg_temp.igual('B8 mes cerrado', (contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161'
  and clave = 'depreciacion:ref:DEPR-02/2026'))->>'motivo'), 'El mes está cerrado: reábrelo para cambiar su contabilidad.');
select pg_temp.igual('B9 descartar lo que nunca se aprobó', (contab_descartar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161'
  and clave = 'depreciacion:ref:DEPR-02/2026'))->>'ok'), 'true');
select pg_temp.igual('B9 ya no está', pg_temp.bor('e0000000-0000-0000-0000-000000000161', 'depreciacion:ref:DEPR-02/2026'), '(sin borrador)');
create or replace function public.soy_superadmin() returns boolean language sql as 'select false';
create or replace function public.mis_empresas() returns setof uuid language sql as $q$ select 'e0000000-0000-0000-0000-000000000162'::uuid $q$;
select pg_temp.igual('B10 empresa ajena', (contab_aprobar_borrador((select id from contab_borradores where empresa_id = 'e0000000-0000-0000-0000-000000000161'
  and clave = 'modulo:ref:NOM-q-2026-10-16'))->>'motivo'), 'Esa empresa no es de tu cuenta.');

select 'TODO OK · contabilidad 16' as resultado;
rollback;
