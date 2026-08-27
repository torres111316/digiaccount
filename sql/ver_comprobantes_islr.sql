-- ============================================================================
--  De donde sale el numero que se le propone al comprobante de ISLR
--  27/08/2026 · DIAGNOSTICO, no cambia nada
--
--  La funcion propone el siguiente de la serie que ENCUENTRA. Si los
--  comprobantes de ISLR ya cargados tienen formato de IVA (AAAAMM + 8), va a
--  seguir esa serie — y el numero saldra pegado al del IVA por mas que las
--  consultas esten separadas por tipo.
--
--  El codigo viejo proponia el correlativo SOLO para ISLR practicada, y lo
--  hacia en formato AAAAMM. Es muy probable que de ahi venga.
-- ============================================================================

select e.nombre           as empresa,
       r.tipo,
       r.comprobante,
       length(regexp_replace(coalesce(r.comprobante,''), '\D', '', 'g')) as digitos,
       r.fecha,
       r.periodo,
       r.factura,
       r.tercero_nombre,
       r.monto
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where r.direccion = 'practicada'
   and e.nombre ilike 'GATMA%'
 order by r.tipo, r.comprobante nulls first;

-- Resumen: que formato tiene cada serie
select e.nombre as empresa,
       r.tipo,
       count(*)                                             as cuantas,
       count(*) filter (where r.comprobante is null
                           or btrim(r.comprobante) = '')    as sin_numero,
       min(r.comprobante)                                   as menor,
       max(r.comprobante)                                   as mayor,
       min(length(regexp_replace(coalesce(r.comprobante,''), '\D', '', 'g'))) as digitos_min,
       max(length(regexp_replace(coalesce(r.comprobante,''), '\D', '', 'g'))) as digitos_max
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where r.direccion = 'practicada'
   and e.nombre ilike 'GATMA%'
 group by 1, 2
 order by 2;
