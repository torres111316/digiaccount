-- =============================================================
-- DECLARACIONES SIN NÚMERO PROPIO
--
-- El anticipo de ISLR del 1% no se declara aparte: lo genera el portal al
-- presentar el IVA. No tiene, por tanto, un número de declaración propio que
-- anotar — y exigirlo dejaba fuera del sistema justo lo que hace falta
-- guardar: el MONTO, que es lo que se rebaja en la declaración anual.
--
-- QUÉ CAMBIA
--   `numero` pasa a admitir nulo. La unicidad se parte en dos:
--     · con número  -> no se repite el número (es el del SENIAT, único);
--     · sin número  -> no se repite el período. Un anticipo por quincena y
--       tipo, que es lo que de verdad identifica a uno que no lleva número.
--
--   Sin ese segundo índice, correr dos veces el cálculo del anticipo
--   duplicaría los dieciocho períodos sin que nada lo impidiera, y al sumar
--   las rebajas del ejercicio saldría el doble.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

alter table public.declaraciones alter column numero drop not null;

-- La llave vieja abarcaba las dos situaciones; se sustituye por las dos
-- parciales de abajo.
alter table public.declaraciones
  drop constraint if exists declaraciones_empresa_id_impuesto_numero_key;

create unique index if not exists declaraciones_numero_unico
  on public.declaraciones (empresa_id, impuesto, numero)
  where numero is not null;

create unique index if not exists declaraciones_periodo_unico_sin_numero
  on public.declaraciones (empresa_id, impuesto, periodo, coalesce(quincena, 0), tipo)
  where numero is null;

comment on column public.declaraciones.numero is
  'El que asigna el SENIAT. Nulo cuando la obligación no lleva número propio: el anticipo de ISLR lo genera el portal al declarar el IVA.';
