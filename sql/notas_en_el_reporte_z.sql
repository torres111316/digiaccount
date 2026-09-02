-- =============================================================
-- LAS NOTAS DE CRÉDITO QUE VIENEN DENTRO DE UN REPORTE Z
--
-- EL PROBLEMA QUE RESUELVE
-- Cuando la máquina fiscal emite una nota de crédito, el reporte Z del día
-- ya la trae DESCONTADA: el total impreso viene neto. Eso es correcto para
-- declarar y por eso el renglón del libro guarda ese neto.
--
-- Pero el libro queda sin rastro de la devolución. En una fiscalización se
-- compara el libro contra la cinta, y ahí las «ventas del día» del Z no van
-- a cuadrar con el renglón: la diferencia son las notas. Hoy esa explicación
-- solo existe en la memoria de quien cargó.
--
-- Radian, 17/08/2026: dos notas de crédito de dos facturas distintas.
--
-- QUÉ SE GUARDA
-- El detalle, NO el monto para restar. El neto ya está en `total` y no se
-- toca: si esto restara otra vez, la devolución se descontaría dos veces.
-- Es información para reconciliar, y así está declarado en el comentario de
-- la columna para que nadie lo confunda dentro de un año.
--
-- POR QUÉ jsonb Y NO UNA TABLA APARTE
-- Un Z trae cero, una o dos notas, y nunca se consultan sin su Z. Una tabla
-- nueva significa políticas de RLS nuevas y otra superficie que asegurar,
-- a cambio de nada. El sistema ya guarda así los renglones de una factura y
-- las líneas de un asiento.
--
-- Idempotente. No borra ni modifica ningún dato.
-- =============================================================

alter table public.libro_fiscal
  add column if not exists notas_z jsonb;

comment on column public.libro_fiscal.notas_z is
  'Notas de crédito/débito que la máquina fiscal emitió dentro de este reporte Z. '
  'Arreglo de objetos {n: n° de la nota, f: factura afectada, m: monto, t: NC|ND}. '
  'ES INFORMATIVO: el monto YA está descontado del campo `total`, que viene neto '
  'de la máquina. No restar de nuevo — se descontaría dos veces.';

/* La forma se valida en la base. Un jsonb sin regla acepta cualquier cosa, y
   lo que aquí se guarda mal no da un error visible: da un libro que no se
   puede reconciliar el día que hace falta.

   Se exige que sea un arreglo y que cada elemento traiga su número de nota y
   su monto. La factura afectada se pide en la pantalla pero no se exige aquí:
   una nota de la máquina puede referirse a un comprobante que ya no se
   ubique, y es peor perder el registro que guardarlo incompleto. */
alter table public.libro_fiscal drop constraint if exists libro_notas_z_chk;
alter table public.libro_fiscal
  add constraint libro_notas_z_chk check (
    notas_z is null
    or (
      jsonb_typeof(notas_z) = 'array'
      and not exists (
        select 1
          from jsonb_array_elements(notas_z) as e
         where jsonb_typeof(e) <> 'object'
            or coalesce(btrim(e ->> 'n'), '') = ''
            or (e ->> 'm') is null
            or (e ->> 'm') !~ '^-?[0-9]+(\.[0-9]+)?$'
      )
    )
  );

/* Solo un reporte Z puede traer notas dentro. Una factura suelta que se
   corrige lleva su propia nota como documento aparte, con su renglón y su
   tipo_doc = NC — que es lo que el resto del sistema ya sabe sumar. */
alter table public.libro_fiscal drop constraint if exists libro_notas_z_solo_zeta_chk;
alter table public.libro_fiscal
  add constraint libro_notas_z_solo_zeta_chk check (
    notas_z is null
    or jsonb_array_length(notas_z) = 0
    or coalesce(btrim(numero_zeta), '') <> ''
  );

-- Para buscar «en qué Z quedó la nota tal».
create index if not exists libro_notas_z_idx
  on public.libro_fiscal using gin (notas_z)
  where notas_z is not null;


-- -------------------------------------------------------------
-- COMPROBACIÓN (descomentar y correr)
--
-- 1) ¿Quedó la columna con su regla?
-- select column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'libro_fiscal'
--    and column_name = 'notas_z';
--
-- 2) ¿La base rechaza una nota sin número? (DEBE dar error)
-- update public.libro_fiscal set notas_z = '[{"f":"1234","m":100}]'::jsonb
--  where numero_zeta is not null limit 1;
--   → esperado: viola libro_notas_z_chk
--
-- 3) Los reportes Z que traen notas, con su detalle desplegado:
-- select lf.fecha, lf.numero_zeta, lf.total as neto_del_dia,
--        e ->> 'n' as nota, e ->> 'f' as factura_afectada, e ->> 'm' as monto
--   from public.libro_fiscal lf,
--        lateral jsonb_array_elements(coalesce(lf.notas_z, '[]'::jsonb)) as e
--  order by lf.periodo, lf.fecha;
--
-- 4) Cuánto se devolvió en un período (informativo, NO se resta del libro):
-- select lf.periodo,
--        count(*)                                        as notas,
--        round(sum((e ->> 'm')::numeric), 2)             as devuelto
--   from public.libro_fiscal lf,
--        lateral jsonb_array_elements(coalesce(lf.notas_z, '[]'::jsonb)) as e
--  where lf.empresa_id = 'PON-AQUI-EL-ID'
--  group by lf.periodo order by lf.periodo;
-- -------------------------------------------------------------
