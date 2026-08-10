-- =============================================================
-- UNA SOLA RETENCIÓN POR FACTURA Y POR IMPUESTO
--
-- El caso real: la retención llega días después de la factura, así que uno
-- abre la factura, la carga, y semanas más tarde vuelve a abrirla sin
-- recordar si ya lo hizo. Cargarla dos veces duplica el monto retenido en la
-- declaración, y ese descuadre aparece cuando ya se presentó.
--
-- QUÉ SE PERMITE Y QUÉ NO
--   ✔ Una misma factura con retención de IVA Y de ISLR — son impuestos
--     distintos y ambas son legítimas.
--   ✔ Un mismo comprobante agrupando VARIAS facturas — eso es lo normal.
--   ✘ Dos retenciones del MISMO impuesto sobre la MISMA factura.
--
-- La llave incluye el RIF del tercero porque dos proveedores distintos
-- pueden tener facturas con el mismo número: sin el RIF, la del segundo
-- quedaría bloqueada por la del primero.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

-- -------------------------------------------------------------
-- PASO 1 · ¿Hay duplicados de antes?
-- Se avisa ANTES de intentar crear la llave, porque si los hay la creación
-- falla con un error de Postgres que no dice cuáles son.
-- -------------------------------------------------------------
do $$
declare
  v_dup integer;
begin
  select count(*) into v_dup from (
    select empresa_id, direccion, tipo, tercero_rif, factura
      from public.retenciones
     where coalesce(btrim(factura), '') <> ''
     group by empresa_id, direccion, tipo, tercero_rif, factura
    having count(*) > 1
  ) d;

  if v_dup > 0 then
    raise exception
      'Hay % combinación(es) de factura + impuesto con MÁS DE UNA retención. Revísalas y elimina las repetidas antes de correr este archivo. La consulta para verlas está comentada al final.', v_dup;
  end if;

  raise notice 'Sin duplicados previos. Se puede crear la llave.';
end $$;

-- -------------------------------------------------------------
-- PASO 2 · La llave.
--
-- Es un índice ÚNICO PARCIAL: solo aplica cuando hay número de factura.
-- Las retenciones sin factura asociada —que las hay— no se ven afectadas.
-- -------------------------------------------------------------
create unique index if not exists retenciones_una_por_factura
  on public.retenciones (empresa_id, direccion, tipo, tercero_rif, factura)
  where coalesce(btrim(factura), '') <> '';

comment on index public.retenciones_una_por_factura is
  'Impide cargar dos veces la retención del mismo impuesto sobre la misma factura del mismo tercero. IVA e ISLR sobre una misma factura sí conviven.';

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- 1) Ver duplicados (si el paso 1 se quejó, esta consulta los muestra):
-- select empresa_id, direccion, tipo, tercero_rif, factura, count(*) as veces,
--        string_agg(comprobante, ' · ') as comprobantes,
--        string_agg(id::text, ' · ') as ids
--   from public.retenciones
--  where coalesce(btrim(factura), '') <> ''
--  group by empresa_id, direccion, tipo, tercero_rif, factura
-- having count(*) > 1
--  order by veces desc;
--
-- 2) Probar que la llave funciona: intentar registrar dos veces la retención
--    de IVA de una misma factura desde la app. La segunda debe rechazarse.
-- -------------------------------------------------------------
