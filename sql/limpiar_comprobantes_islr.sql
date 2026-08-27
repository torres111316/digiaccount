-- ============================================================================
--  El comprobante de ISLR se queda sin numero
--  27/08/2026 · decision de Luis
--
--  POR QUE
--    En GATMA el ISLR nunca llevo numero de comprobante: de las tres
--    retenciones cargadas, dos estaban vacias y la tercera quedo con
--    20260800000018 porque el codigo viejo le propuso el formato del IVA.
--    Se deja como siempre estuvo.
--
--    El sistema lo permite: el comprobante es obligatorio SOLO en IVA. La
--    Providencia SNAT/2015/0049 impone el formato AAAAMM + ocho digitos para
--    el comprobante de retencion de IVA; el de ISLR no tiene formato impuesto
--    y hay empresas que no lo numeran.
--
--  QUE NO SE TOCA
--    Las 18 retenciones de IVA, con su serie de 14 digitos intacta.
-- ============================================================================


-- ANTES · las tres de ISLR
select r.fecha, r.factura, r.tercero_nombre, r.monto,
       coalesce(nullif(btrim(r.comprobante), ''), '(sin numero)') as comprobante_actual
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where e.nombre ilike 'GATMA%' and r.tipo = 'islr' and r.direccion = 'practicada'
 order by r.fecha, r.creado_en;


-- EL CAMBIO · el ISLR se queda sin comprobante
update public.retenciones r
   set comprobante = null
  from public.empresas e
 where e.id = r.empresa_id
   and e.nombre ilike 'GATMA%'
   and r.tipo = 'islr'
   and r.direccion = 'practicada';


-- DESPUES · la serie de IVA intacta, la de ISLR vacia
select e.nombre as empresa,
       r.tipo,
       count(*)                                          as cuantas,
       count(*) filter (where r.comprobante is null
                           or btrim(r.comprobante) = '') as sin_numero,
       min(r.comprobante)                                as menor,
       max(r.comprobante)                                as mayor
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where r.direccion = 'practicada' and e.nombre ilike 'GATMA%'
 group by 1, 2
 order by 2;
