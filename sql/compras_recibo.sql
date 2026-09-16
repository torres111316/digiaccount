-- ============================================================================
--  EL RECIBO, COMO TIPO DE DOCUMENTO DE UNA COMPRA
--  Correr una sola vez en Supabase → SQL Editor.
-- ============================================================================
--
--  POR QUÉ
--  No todo proveedor entrega factura fiscal. Un emprendimiento le compra a
--  quien le vende, y muchas veces lo que recibe es un RECIBO. Esa compra
--  existe, hay que registrarla y hay que pagarla, pero hasta hoy la base la
--  rechazaba: `libro_tipo_doc_chk` solo admitía FV, FC, NC y ND, así que al
--  guardar un recibo la pantalla decía que no se pudo guardar.
--
--  QUÉ CAMBIA
--  Se admite 'RE', y SOLO en compras. Un recibo de VENTA no vive aquí: vive
--  en `facturas`, que es donde el sistema lleva los recibos que emite la
--  empresa. Dejarlo entrar también en ventas abriría la puerta a declarar
--  como venta fiscal un documento que no lo es.
--
--  LO QUE NO CAMBIA
--  El recibo no da crédito fiscal. Eso lo sostiene la aplicación: al elegir
--  «RE (Recibo)» los renglones pasan a exento y se bloquea la alícuota, de
--  modo que su IVA nunca llega a esta tabla. Aquí abajo queda además la
--  consulta para comprobarlo con datos reales.
--
--  ANTES DE CORRER: las 2.455 filas cargadas hoy son FV (1.677) y FC (778).
--  Ninguna queda fuera de la regla nueva.
-- ============================================================================

-- 1) La regla, ampliada
alter table public.libro_fiscal drop constraint if exists libro_tipo_doc_chk;

alter table public.libro_fiscal
  add constraint libro_tipo_doc_chk
  check (
    tipo_doc in ('FV', 'FC', 'NC', 'ND', 'RE')
    -- 'RE' solo en compras: el recibo de venta lo lleva la tabla `facturas`.
    and (tipo_doc <> 'RE' or tipo = 'compra')
  );

comment on constraint libro_tipo_doc_chk on public.libro_fiscal is
  'Tipos válidos: FV/FC/NC/ND, y RE (recibo) únicamente en compras. '
  'Un tipo raro no da un error visible: da una declaración mal hecha.';


-- ============================================================================
--  COMPROBACIÓN — correr después, debe devolver 0 filas
-- ============================================================================
-- Ningún tipo inválido:
-- select tipo, tipo_doc, count(*)
--   from public.libro_fiscal
--  where tipo_doc not in ('FV','FC','NC','ND','RE')
--     or (tipo_doc = 'RE' and tipo <> 'compra')
--  group by tipo, tipo_doc;
--
-- Ningún recibo con IVA (no da crédito fiscal):
-- select numero_factura, tercero_nombre, total, iva
--   from public.libro_fiscal
--  where tipo_doc = 'RE' and coalesce(iva, 0) > 0;
-- ============================================================================
