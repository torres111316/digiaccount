-- =============================================================
-- MOVER UNA RETENCIÓN SUFRIDA DE JULIO A AGOSTO
--
-- EL CASO
-- AGUERO. Factura 001460 de Autopartes Lara, del 29/07/2026. El cliente
-- practicó la retención el 04/08/2026 y su comprobante empieza por 202608.
-- Se registró cuando el sistema todavía hacía seguir el período a la
-- factura, y quedó en JULIO. Va en AGOSTO.
--
-- El resto de las retenciones de julio SE QUEDAN COMO ESTÁN: julio ya se
-- declaró y moverlas cambiaría una declaración presentada.
--
-- POR QUÉ EL FILTRO BUSCA UNA CONTRADICCIÓN Y NO UN ID
-- Se podría pegar aquí el id de la fila, pero habría que ir a buscarlo y
-- copiarlo bien. En vez de eso se busca lo que hace a esa fila única y
-- equivocada: el comprobante DICE agosto (202608…) y el período dice otra
-- cosa. Ninguna retención bien registrada cumple las dos.
--
-- CORRER EN ORDEN. El paso 1 no modifica nada.
-- =============================================================


-- -------------------------------------------------------------
-- 1) ¿CUÁLES SON? — correr esto primero y CONTAR LAS FILAS.
--
--    Debe devolver UNA sola, la de Autopartes Lara. Si devuelve más,
--    PARAR y revisarlas: significa que hay otras en la misma situación y
--    hay que decidir una por una, no en bloque.
-- -------------------------------------------------------------
select r.id,
       e.nombre        as empresa,
       r.direccion,
       r.tipo          as impuesto,
       r.fecha         as fecha_comprobante,
       r.comprobante,
       r.factura,
       r.tercero_nombre,
       r.base,
       r.monto,
       r.periodo       as periodo_actual,
       substring(regexp_replace(r.comprobante, '[^0-9]', '', 'g') from 1 for 6) as dice_el_comprobante
  from public.retenciones r
  left join public.empresas e on e.id = r.empresa_id
 where r.direccion = 'sufrida'
   and e.nombre ilike '%AGUERO%'
   and regexp_replace(coalesce(r.comprobante, ''), '[^0-9]', '', 'g') like '202608%'
   and coalesce(r.periodo, '') <> '2026-08'
 order by r.fecha;


-- -------------------------------------------------------------
-- 2) MOVERLA. Correr SOLO si el paso 1 devolvió la fila esperada.
--
--    El mismo filtro, para que no pueda alcanzar a ninguna otra.
-- -------------------------------------------------------------
update public.retenciones r
   set periodo = '2026-08'
  from public.empresas e
 where e.id = r.empresa_id
   and r.direccion = 'sufrida'
   and e.nombre ilike '%AGUERO%'
   and regexp_replace(coalesce(r.comprobante, ''), '[^0-9]', '', 'g') like '202608%'
   and coalesce(r.periodo, '') <> '2026-08';


-- -------------------------------------------------------------
-- 3) LA QUINCENA — solo si la empresa entera por quincena.
--
--    Si la columna trae valor, la empresa declara así y hay que ajustarla:
--    el comprobante es del 04/08, o sea PRIMERA quincena. Si viene en
--    nulo, la empresa no entera por quincena y esto no toca nada.
-- -------------------------------------------------------------
update public.retenciones r
   set quincena = 1
  from public.empresas e
 where e.id = r.empresa_id
   and r.direccion = 'sufrida'
   and e.nombre ilike '%AGUERO%'
   and r.periodo = '2026-08'
   and r.quincena is not null
   and r.quincena <> 1
   and regexp_replace(coalesce(r.comprobante, ''), '[^0-9]', '', 'g') like '202608%';


-- -------------------------------------------------------------
-- 4) COMPROBAR. Debe salir en 2026-08 y ya no quedar ninguna contradicción.
-- -------------------------------------------------------------
select e.nombre as empresa, r.fecha, r.comprobante, r.factura,
       r.tercero_nombre, r.monto, r.periodo, r.quincena
  from public.retenciones r
  left join public.empresas e on e.id = r.empresa_id
 where e.nombre ilike '%AGUERO%'
   and regexp_replace(coalesce(r.comprobante, ''), '[^0-9]', '', 'g') like '202608%'
 order by r.fecha;

-- Y que julio quedó intacto: este total NO debe haber cambiado.
select r.periodo, r.tipo, count(*) as retenciones, round(sum(r.monto)::numeric, 2) as total
  from public.retenciones r
  left join public.empresas e on e.id = r.empresa_id
 where e.nombre ilike '%AGUERO%'
   and r.direccion = 'sufrida'
   and r.periodo in ('2026-07', '2026-08')
 group by r.periodo, r.tipo
 order by r.periodo, r.tipo;
