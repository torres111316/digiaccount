-- ============================================================================
--  Limpiar la serie de comprobantes de ISLR de GATMA
--  27/08/2026
--
--  QUE PASO
--    El codigo viejo proponia el correlativo solo para ISLR practicada, y lo
--    hacia en el formato del IVA (AAAAMM + 8 digitos). Una retencion de ISLR
--    quedo guardada como 20260800000018 — el numero que le tocaba al siguiente
--    comprobante de IVA.
--
--    Arreglar la funcion no bastaba: propone el siguiente de la serie que
--    ENCUENTRA, y esa serie tenia un solo numero, el contaminado. Por eso
--    seguia saliendo pegado al IVA por mas que las consultas esten separadas
--    por tipo.
--
--    Estado hoy en GATMA: 3 retenciones de ISLR, 2 sin numero y 1 con formato
--    de IVA. La de IVA son 18, todas de 14 digitos, y esas NO se tocan.
--
--  QUE HACE
--    Numera las tres de ISLR con un correlativo normal —0001, 0002, 0003— en
--    orden de fecha. A partir de ahi el sistema propone 0004 y la serie sigue
--    limpia y separada de la del IVA.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
--  ANTES · las tres de ISLR, como estan hoy
-- ─────────────────────────────────────────────────────────────────────────
select r.fecha, r.factura, r.tercero_nombre, r.monto,
       coalesce(nullif(btrim(r.comprobante), ''), '(sin numero)') as comprobante_actual
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where e.nombre ilike 'GATMA%' and r.tipo = 'islr' and r.direccion = 'practicada'
 order by r.fecha, r.creado_en;


-- ─────────────────────────────────────────────────────────────────────────
--  EL CAMBIO · correlativo normal, en orden de fecha
-- ─────────────────────────────────────────────────────────────────────────
with orden as (
  select r.id,
         lpad(row_number() over (order by r.fecha, r.creado_en)::text, 4, '0') as nuevo
    from public.retenciones r
    join public.empresas e on e.id = r.empresa_id
   where e.nombre ilike 'GATMA%'
     and r.tipo = 'islr'
     and r.direccion = 'practicada'
)
update public.retenciones r
   set comprobante = o.nuevo
  from orden o
 where r.id = o.id;


-- ─────────────────────────────────────────────────────────────────────────
--  DESPUES · las dos series, separadas y con su propio formato
-- ─────────────────────────────────────────────────────────────────────────
select e.nombre as empresa,
       r.tipo,
       count(*)            as cuantas,
       min(r.comprobante)  as menor,
       max(r.comprobante)  as mayor,
       max(length(regexp_replace(coalesce(r.comprobante,''), '\D', '', 'g'))) as digitos
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where r.direccion = 'practicada' and e.nombre ilike 'GATMA%'
 group by 1, 2
 order by 2;


-- ============================================================================
--  SI PREFIERES DEJARLAS SIN NUMERO
--  Hay empresas que no le ponen comprobante al ISLR, y el sistema lo permite:
--  el campo es obligatorio solo en IVA. Para vaciarlas, correr esto en lugar
--  del bloque de arriba.
-- ============================================================================
-- update public.retenciones r set comprobante = null
--   from public.empresas e
--  where e.id = r.empresa_id and e.nombre ilike 'GATMA%'
--    and r.tipo = 'islr' and r.direccion = 'practicada';
