-- =============================================================
-- PREFERENCIAS DE LA EMPRESA
--
-- La pantalla de Configuración tenía siete campos que se podían cambiar y no
-- hacían nada: ni se guardaban, ni los leía ninguna parte del sistema. Este
-- archivo le da dónde vivir a los que sí tienen sentido.
--
-- Los que NO están aquí, y por qué:
--   · Período de declaración de IVA → se DERIVA de la condición fiscal
--     (especial = quincenal, ordinario = mensual). Guardarlo aparte permitiría
--     que contradiga a la condición, y entonces habría que decidir cuál manda.
--   · Próximo N° de factura → lo calcula el sistema consultando el máximo
--     realmente emitido. Un número escrito a mano ahí solo puede desincronizar
--     el correlativo.
--   · Moneda de visualización → se retira de la pantalla: mostrar toda la app
--     en otra moneda es una función completa, no una casilla.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

alter table public.empresas
  -- Alícuota que se propone al facturar. 16 general, 8 reducida, 0 exento.
  add column if not exists alicuota_default numeric(5,2) not null default 16,
  -- ¿Sus cobros en divisas causan IGTF? Propone el valor al registrar la venta.
  add column if not exists aplica_igtf boolean not null default false,
  -- Cómo emite: forma libre de imprenta, electrónica, o máquina fiscal.
  add column if not exists medio_emision text not null default 'forma-libre',
  -- De dónde sale la tasa: la oficial del BCV, o una fijada a mano.
  add column if not exists fuente_tasa text not null default 'bcv';

alter table public.empresas drop constraint if exists empresas_alicuota_chk;
alter table public.empresas
  add constraint empresas_alicuota_chk check (alicuota_default in (0, 8, 16));

alter table public.empresas drop constraint if exists empresas_medio_chk;
alter table public.empresas
  add constraint empresas_medio_chk
  check (medio_emision in ('forma-libre', 'electronica', 'maquina-fiscal'));

alter table public.empresas drop constraint if exists empresas_fuente_tasa_chk;
alter table public.empresas
  add constraint empresas_fuente_tasa_chk check (fuente_tasa in ('bcv', 'manual'));

-- -------------------------------------------------------------
-- COMPROBACIÓN
-- select nombre, condicion_fiscal, alicuota_default, aplica_igtf,
--        medio_emision, fuente_tasa
--   from public.empresas order by nombre;
-- -------------------------------------------------------------
