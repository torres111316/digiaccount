-- ============================================================================
--  Asignar la quincena a las retenciones que quedaron sin ella
--  26/08/2026
--
--  LA REGLA
--    La quincena de una retencion de IVA sale de la FECHA DEL COMPROBANTE:
--    del 1 al 15 es la primera, del 16 al ultimo dia es la segunda. No es la
--    fecha de la factura ni el dia en que se cargo en el sistema.
--
--  POR QUE IMPORTA
--    Una retencion sin quincena no entra en ningun TXT: no es de la primera
--    ni de la segunda, asi que se queda fuera de las dos declaraciones y no
--    se entera nunca. Es el tipo de omision que no da error y aparece en una
--    fiscalizacion.
--
--  QUE TOCA Y QUE NO
--    Solo retenciones de IVA PRACTICADAS que hoy tengan quincena nula, y solo
--    en empresas que enteren por quincena. Las SUFRIDAS no llevan quincena:
--    se descuentan con la declaracion de IVA, que puede ser mensual. Y las
--    de ISLR tampoco: se enteran mensual.
--
--    Lo que ya tenga quincena NO se toca, ni siquiera si la fecha dijera otra
--    cosa: puede haberse asignado a mano por un criterio del contador, y ese
--    criterio manda sobre la regla general.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
--  ANTES · que se va a asignar. Correr y revisar la lista.
--  La fecha viene como 'dd/mm/aa', asi que el dia son los dos primeros.
-- ─────────────────────────────────────────────────────────────────────────
select e.nombre                                as empresa,
       r.periodo,
       r.fecha,
       r.comprobante,
       r.tercero_nombre,
       r.monto,
       case when substring(r.fecha from 1 for 2)::int between 1 and 15
            then '1ra' else '2da' end          as quincena_que_le_toca
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where r.tipo = 'iva'
   and r.direccion = 'practicada'
   and r.quincena is null
   and r.fecha ~ '^[0-3][0-9]/'
 order by e.nombre, r.periodo, r.fecha;


-- ─────────────────────────────────────────────────────────────────────────
--  EL CAMBIO
-- ─────────────────────────────────────────────────────────────────────────
update public.retenciones r
   set quincena = case when substring(r.fecha from 1 for 2)::int between 1 and 15
                       then 1 else 2 end
 where r.tipo = 'iva'
   and r.direccion = 'practicada'
   and r.quincena is null
   and r.fecha ~ '^[0-3][0-9]/'
   and substring(r.fecha from 1 for 2)::int between 1 and 31;


-- ─────────────────────────────────────────────────────────────────────────
--  DESPUES · no debe quedar ninguna practicada de IVA sin quincena
-- ─────────────────────────────────────────────────────────────────────────
select e.nombre as empresa,
       r.periodo,
       coalesce(r.quincena::text, '⚠ SIN QUINCENA') as quincena,
       count(*)     as cuantas,
       sum(r.monto) as total
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
 where r.tipo = 'iva' and r.direccion = 'practicada'
 group by 1, 2, 3
 order by 1, r.periodo desc, 3;
