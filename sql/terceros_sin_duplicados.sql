-- =============================================================
-- UN SOLO TERCERO POR RIF EN CADA CUENTA
--
-- "INVERSIONES MADERERA ALIBETZ, C.A." quedó dos veces, con el mismo RIF y
-- creadas en el MISMO SEGUNDO: el botón Guardar se disparó dos veces. La
-- pantalla ya no deja pulsarlo dos veces, pero eso solo tapa una de las
-- formas de llegar aquí — quedan la importación masiva, el agente de
-- Telegram y cualquier script. La regla tiene que vivir donde no se pueda
-- esquivar, que es la base.
--
-- POR QUÉ EL RIF NORMALIZADO
--   'J-40297936-3' y 'J402979363' son el mismo RIF escrito distinto. Sin
--   normalizar, el índice los ve como dos y no impide nada.
--
-- POR QUÉ PARCIAL
--   Un tercero sin RIF es legítimo mientras se consigue el dato —hay
--   facturas cargadas así, esperando la cédula del cliente— y varios de esos
--   pueden convivir. El índice solo alcanza a los que tienen un RIF de
--   verdad: al menos siete dígitos. Un 'V' pelado no cuenta.
--
-- ANTES DE CORRERLO
--   No puede haber duplicados vivos o el índice no se crea. Se comprueban
--   con la consulta de abajo; a hoy la base está limpia (596 terceros, 0
--   repetidos), y `herramientas/terceros_duplicados.py` los une si vuelven.
--
-- Idempotente. No borra ni modifica ningún dato.
-- =============================================================

-- Comprobación previa: esto debe devolver CERO filas.
--   select cuenta_id, regexp_replace(upper(rif), '[^A-Z0-9]', '', 'g') as r, count(*)
--     from public.terceros
--    where rif is not null and length(regexp_replace(rif, '\D', '', 'g')) >= 7
--    group by 1, 2 having count(*) > 1;

create unique index if not exists terceros_rif_unico_por_cuenta
  on public.terceros (cuenta_id, regexp_replace(upper(rif), '[^A-Z0-9]', '', 'g'))
  where rif is not null and length(regexp_replace(rif, '\D', '', 'g')) >= 7;

comment on index public.terceros_rif_unico_por_cuenta is
  'Un RIF no se repite dentro de una cuenta. Los terceros sin RIF quedan fuera: son legítimos mientras se consigue el dato.';
