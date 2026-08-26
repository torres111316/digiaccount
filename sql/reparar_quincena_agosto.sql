-- ============================================================================
--  Reparar SOLO las dos retenciones que quedaron en la quincena errada
--  26/08/2026
--
--  QUE PASO
--    La primera version de sql/quincena_desde_la_fecha.sql dedujo la quincena
--    de la FECHA DEL COMPROBANTE, que por defecto es hoy. Las dos retenciones
--    de GATMA de agosto —de facturas de la PRIMERA quincena, cargadas un dia
--    26— quedaron marcadas como segunda.
--
--  POR QUE ESTE ARCHIVO ES TAN ESTRECHO
--    La primera idea fue re-sincronizar toda retencion con la quincena de su
--    factura. Para GATMA habria funcionado. Para RADIAN NO: ahi el IVA es
--    mensual y las retenciones quincenales, asi que una compra recibida tarde
--    puede tener su factura en una quincena y enterarse en la otra, y eso es
--    correcto. Forzar que coincidan habria danado datos buenos.
--
--    La quincena de una retencion es la del periodo en que se ENTERA, no la
--    del dia de la factura. La factura sirve como punto de partida al
--    registrar —de ahi el cambio en la aplicacion— pero no manda sobre lo ya
--    decidido.
--
--    Por eso este archivo toca UNA empresa, UN periodo y UN tipo, y nada mas.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
--  ANTES · exactamente que filas se van a mover. Deben ser dos.
-- ─────────────────────────────────────────────────────────────────────────
select e.nombre     as empresa,
       r.periodo,
       r.fecha      as fecha_comprobante,
       r.comprobante,
       r.factura,
       r.tercero_nombre,
       r.monto,
       r.quincena   as tiene_ahora
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where e.nombre ilike 'GATMA%'
   and r.periodo = '2026-08'
   and r.tipo = 'iva'
   and r.direccion = 'practicada'
   and r.quincena = 2
 order by r.fecha;


-- ─────────────────────────────────────────────────────────────────────────
--  EL CAMBIO · van a la PRIMERA quincena
--
--  Confirmado por Luis: esas dos retenciones son de la primera quincena de
--  agosto. Sus facturas son de la primera mitad del mes, y la segunda
--  quincena ni siquiera ha terminado todavia.
-- ─────────────────────────────────────────────────────────────────────────
update public.retenciones r
   set quincena = 1
  from public.empresas e
 where e.id = r.empresa_id
   and e.nombre ilike 'GATMA%'
   and r.periodo = '2026-08'
   and r.tipo = 'iva'
   and r.direccion = 'practicada'
   and r.quincena = 2;


-- ─────────────────────────────────────────────────────────────────────────
--  DESPUES · GATMA en agosto debe quedar toda en la primera quincena
-- ─────────────────────────────────────────────────────────────────────────
select e.nombre as empresa,
       r.periodo,
       coalesce(r.quincena::text, '⚠ SIN QUINCENA') as quincena,
       count(*)     as cuantas,
       sum(r.monto) as total
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where r.tipo = 'iva' and r.direccion = 'practicada'
   and e.nombre ilike 'GATMA%'
 group by 1, 2, 3
 order by r.periodo desc, 3;


-- ============================================================================
--  A MANO, si hiciera falta corregir alguna suelta:
--    update public.retenciones set quincena = 1
--     where comprobante = '20260800000123';
-- ============================================================================
