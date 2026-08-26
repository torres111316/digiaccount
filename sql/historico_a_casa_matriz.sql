-- ============================================================================
--  Lo que se registro antes de configurar sucursales es de la CASA MATRIZ
--  26/08/2026
--
--  QUE PASO
--    Las sucursales se configuraron en agosto de 2026. Todo lo registrado
--    antes quedo con sucursal_id nulo — no porque no tenga establecimiento,
--    sino porque cuando se cargo no existia el campo.
--
--    En GATMA eso son 19 retenciones de julio y 22 de junio en nulo, contra 2
--    y 4 que si quedaron marcadas. Las marcadas son las que se registraron
--    despues del cambio.
--
--  POR QUE ES CASA MATRIZ Y NO OTRA COSA
--    Porque la sucursal de Barquisimeto no ha tenido movimiento todavia: toda
--    la actividad de esas empresas ocurrio en la matriz. Un nulo aqui no
--    significa "no se sabe", significa "se registro antes del campo".
--
--  QUE NO SE TOCA
--    Las empresas SIN sucursales configuradas. Ahi el nulo es lo correcto y
--    debe quedarse: no hay establecimientos que distinguir.
--
--  POR QUE IMPORTA
--    Mientras el historico este en nulo, el auxiliar por establecimiento no
--    puede cuadrar: o se esconden esas operaciones de la matriz —y el libro
--    de la matriz sale incompleto— o se muestran en las dos, y entonces el
--    libro de la sucursal arrastra lo que no es suyo. Con el historico
--    asignado, cada libro dice lo que le toca.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
--  ANTES · que se va a mover, por empresa. Correr esto primero y leerlo.
-- ─────────────────────────────────────────────────────────────────────────
select e.nombre                                   as empresa,
       'libro_fiscal'                             as tabla,
       count(*) filter (where l.sucursal_id is null)     as en_nulo,
       count(*) filter (where l.sucursal_id is not null) as ya_asignadas
  from public.libro_fiscal l
  join public.empresas e on e.id = l.empresa_id
 where exists (select 1 from public.sucursales s where s.empresa_id = l.empresa_id)
 group by e.nombre

union all

select e.nombre, 'retenciones',
       count(*) filter (where r.sucursal_id is null),
       count(*) filter (where r.sucursal_id is not null)
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where exists (select 1 from public.sucursales s where s.empresa_id = r.empresa_id)
 group by e.nombre
 order by 1, 2;


-- ─────────────────────────────────────────────────────────────────────────
--  EL CAMBIO · solo empresas CON sucursales, y solo lo que este en nulo
-- ─────────────────────────────────────────────────────────────────────────
update public.libro_fiscal l
   set sucursal_id = m.id
  from public.sucursales m
 where l.sucursal_id is null
   and m.empresa_id = l.empresa_id
   and m.es_matriz;

update public.retenciones r
   set sucursal_id = m.id
  from public.sucursales m
 where r.sucursal_id is null
   and m.empresa_id = r.empresa_id
   and m.es_matriz;


-- ─────────────────────────────────────────────────────────────────────────
--  DESPUES · no debe quedar nada en nulo en empresas con sucursales
-- ─────────────────────────────────────────────────────────────────────────
select e.nombre as empresa,
       coalesce(s.codigo || ' · ' || s.nombre, '⚠ SIGUE EN NULO') as establecimiento,
       count(*) filter (where l.tipo = 'compra') as compras,
       count(*) filter (where l.tipo = 'venta')  as ventas
  from public.libro_fiscal l
  join public.empresas e on e.id = l.empresa_id
  left join public.sucursales s on s.id = l.sucursal_id
 where exists (select 1 from public.sucursales x where x.empresa_id = l.empresa_id)
 group by 1, 2
 order by 1, 2;

select e.nombre as empresa,
       coalesce(s.codigo || ' · ' || s.nombre, '⚠ SIGUE EN NULO') as establecimiento,
       r.periodo, r.tipo, r.direccion,
       count(*) as cuantas, sum(r.monto) as total
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
  left join public.sucursales s on s.id = r.sucursal_id
 where exists (select 1 from public.sucursales x where x.empresa_id = r.empresa_id)
 group by 1, 2, 3, 4, 5
 order by 1, r.periodo desc, 2;


-- ============================================================================
--  VUELTA ATRAS
--  Devuelve a nulo SOLO lo que este apuntando a una casa matriz. Ojo: tambien
--  desharia las asignaciones hechas a mano a la matriz, que son pocas y se
--  vuelven a poner desde la pantalla.
-- ============================================================================
-- update public.libro_fiscal l set sucursal_id = null
--   from public.sucursales m where m.id = l.sucursal_id and m.es_matriz;
-- update public.retenciones r set sucursal_id = null
--   from public.sucursales m where m.id = r.sucursal_id and m.es_matriz;
