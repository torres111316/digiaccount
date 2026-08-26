-- ============================================================================
--  Asignar la quincena a las retenciones que quedaron sin ella
--  26/08/2026  ·  CORREGIDO
--
--  LA CORRECCION
--    La primera version de este archivo deducia la quincena de la FECHA DEL
--    COMPROBANTE. Estaba mal, y se vio enseguida: el comprobante se emite el
--    dia en que uno se sienta a cargar la retencion. Una factura de la primera
--    quincena registrada un dia 26 quedaba enterada en la SEGUNDA — que
--    encima todavia no habia terminado.
--
--  DE DONDE SALE DE VERDAD
--    De la quincena de SU FACTURA, que ya se eligio al registrarla y esta
--    guardada en libro_fiscal.quincena. No hay nada que deducir: el dato ya
--    existe. Solo cuando la factura tampoco la tenga se recurre a la fecha,
--    y ahi se usa la de la FACTURA, nunca la del comprobante.
--
--  POR QUE IMPORTA
--    Una retencion sin quincena no entra en ningun TXT: no es de la primera ni
--    de la segunda, se queda fuera de las dos declaraciones y no se entera
--    nunca. No da error; aparece en una fiscalizacion.
--
--  QUE TOCA Y QUE NO
--    Solo retenciones de IVA PRACTICADAS con quincena nula. Las SUFRIDAS no
--    llevan quincena —se descuentan con la declaracion de IVA, que puede ser
--    mensual— y las de ISLR tampoco, que se enteran mensual.
--
--    Lo que ya tenga quincena NO se toca, ni aunque la factura dijera otra
--    cosa: pudo asignarse a mano por criterio del contador, y ese manda.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
--  ANTES · que se va a asignar y de donde sale cada una
-- ─────────────────────────────────────────────────────────────────────────
select e.nombre                       as empresa,
       r.periodo,
       r.fecha                        as fecha_comprobante,
       r.factura,
       r.tercero_nombre,
       r.monto,
       l.quincena                     as quincena_de_la_factura,
       l.fecha                        as fecha_de_la_factura,
       coalesce(l.quincena,
                case when substring(coalesce(l.fecha, r.fecha) from 1 for 2)::int between 1 and 15
                     then 1 else 2 end)  as se_le_pondra
  from public.retenciones r
  join public.empresas e on e.id = r.empresa_id
  left join public.libro_fiscal l
    on l.empresa_id = r.empresa_id
   and l.tipo = 'compra'
   and upper(btrim(coalesce(l.numero_factura, ''))) = upper(btrim(coalesce(r.factura, '')))
   and coalesce(l.numero_factura, '') <> ''
   and regexp_replace(upper(coalesce(l.tercero_rif, '')), '[^A-Z0-9]', '', 'g')
     = regexp_replace(upper(coalesce(r.tercero_rif, '')), '[^A-Z0-9]', '', 'g')
 where r.tipo = 'iva'
   and r.direccion = 'practicada'
   and r.quincena is null
 order by e.nombre, r.periodo, r.fecha;


-- ─────────────────────────────────────────────────────────────────────────
--  EL CAMBIO · la quincena de la factura manda
-- ─────────────────────────────────────────────────────────────────────────
update public.retenciones r
   set quincena = sub.q
  from (
    select r2.id,
           coalesce(l.quincena,
                    case when substring(coalesce(l.fecha, r2.fecha) from 1 for 2)::int between 1 and 15
                         then 1 else 2 end) as q
      from public.retenciones r2
      left join public.libro_fiscal l
        on l.empresa_id = r2.empresa_id
       and l.tipo = 'compra'
       and upper(btrim(coalesce(l.numero_factura, ''))) = upper(btrim(coalesce(r2.factura, '')))
       and coalesce(l.numero_factura, '') <> ''
       and regexp_replace(upper(coalesce(l.tercero_rif, '')), '[^A-Z0-9]', '', 'g')
         = regexp_replace(upper(coalesce(r2.tercero_rif, '')), '[^A-Z0-9]', '', 'g')
     where r2.tipo = 'iva'
       and r2.direccion = 'practicada'
       and r2.quincena is null
       and coalesce(l.fecha, r2.fecha) ~ '^[0-3][0-9]/'
  ) sub
 where r.id = sub.id
   and sub.q in (1, 2);


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


-- ============================================================================
--  SI ALGUNA QUEDO EN LA QUINCENA EQUIVOCADA
--  Corregir a mano por comprobante. Ejemplo, pasarla a la primera:
--    update public.retenciones set quincena = 1
--     where comprobante = '20260800000123';
-- ============================================================================
