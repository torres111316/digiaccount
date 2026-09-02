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
-- POR QUÉ UN DISPARADOR Y NO UN CHECK PARA EL CONTENIDO
-- La primera versión validaba cada elemento dentro de un `check` con un
-- `not exists (select ...)`, y Postgres lo rechaza:
--     ERROR 0A000: cannot use subquery in check constraint
-- Un CHECK solo admite expresiones sobre la fila. Lo que se puede decir sin
-- subconsulta —que sea un arreglo, que solo un Z las traiga— se queda en
-- CHECK; el recorrido elemento por elemento pasa a un disparador, que
-- además puede decir CUÁL nota está mal y no solo que algo lo está.
--
-- Idempotente. No borra ni modifica ningún dato.
-- =============================================================

alter table public.libro_fiscal
  add column if not exists notas_z jsonb;

comment on column public.libro_fiscal.notas_z is
  'Notas de crédito/débito que la máquina fiscal emitió dentro de este reporte Z. '
  'Arreglo de objetos {n: n° de la nota, f: factura afectada, m: monto total, '
  'i: IVA de la nota (opcional), t: NC|ND (NC si falta)}. '
  'ES INFORMATIVO: el monto YA está descontado del campo `total`, que viene neto '
  'de la máquina. No restar de nuevo — se descontaría dos veces.';


-- -------------------------------------------------------------
-- 1) LO QUE SÍ CABE EN UN CHECK: la forma de afuera.
-- -------------------------------------------------------------
alter table public.libro_fiscal drop constraint if exists libro_notas_z_chk;
alter table public.libro_fiscal
  add constraint libro_notas_z_chk
  check (notas_z is null or jsonb_typeof(notas_z) = 'array');

/* Solo un reporte Z puede traer notas dentro. Una factura suelta que se
   corrige lleva su propia nota como documento aparte, con su renglón y su
   tipo_doc = NC — que es lo que el resto del sistema ya sabe restar. */
alter table public.libro_fiscal drop constraint if exists libro_notas_z_solo_zeta_chk;
alter table public.libro_fiscal
  add constraint libro_notas_z_solo_zeta_chk check (
    notas_z is null
    or jsonb_array_length(notas_z) = 0
    or coalesce(btrim(numero_zeta), '') <> ''
  );


-- -------------------------------------------------------------
-- 2) EL CONTENIDO, NOTA POR NOTA.
--
-- Se exige número y monto. La factura afectada se pide en la pantalla pero
-- no se exige aquí: una nota de la máquina puede referirse a un comprobante
-- que ya no se ubique, y es peor perder el registro que no guardarlo.
--
-- El mensaje dice CUÁL nota está mal. Un «datos inválidos» a secas obliga a
-- adivinar, y quien carga treinta reportes al mes no debería adivinar.
-- -------------------------------------------------------------
create or replace function public.validar_notas_z()
returns trigger
language plpgsql
as $$
declare
  e     jsonb;
  i     int := 0;
  monto text;
begin
  if new.notas_z is null or jsonb_array_length(new.notas_z) = 0 then
    return new;
  end if;

  for e in select * from jsonb_array_elements(new.notas_z) loop
    i := i + 1;

    if jsonb_typeof(e) <> 'object' then
      raise exception 'La nota % del reporte Z no tiene la forma esperada.', i
        using errcode = '23514';
    end if;

    if coalesce(btrim(e ->> 'n'), '') = '' then
      raise exception 'La nota % del reporte Z no tiene número. Sin número no se puede ubicar en la cinta.', i
        using errcode = '23514';
    end if;

    monto := e ->> 'm';
    if monto is null or monto !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'La nota % (%) no tiene un monto válido.', i, e ->> 'n'
        using errcode = '23514';
    end if;

    if coalesce(upper(btrim(e ->> 't')), 'NC') not in ('NC', 'ND') then
      raise exception 'La nota % (%) tiene un tipo que no es NC ni ND.', i, e ->> 'n'
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_validar_notas_z on public.libro_fiscal;
create trigger trg_validar_notas_z
  before insert or update of notas_z on public.libro_fiscal
  for each row execute function public.validar_notas_z();


-- Para buscar «en qué Z quedó la nota tal».
create index if not exists libro_notas_z_idx
  on public.libro_fiscal using gin (notas_z)
  where notas_z is not null;


-- -------------------------------------------------------------
-- COMPROBACIÓN (descomentar y correr)
--
-- 1) ¿Quedó la columna?
-- select column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'libro_fiscal'
--    and column_name = 'notas_z';
--
-- 2) ¿Quedaron las dos reglas y el disparador?
-- select conname from pg_constraint
--  where conrelid = 'public.libro_fiscal'::regclass
--    and conname like 'libro_notas_z%';
-- select tgname from pg_trigger
--  where tgrelid = 'public.libro_fiscal'::regclass and not tgisinternal;
--
-- 3) ¿La base rechaza una nota SIN NÚMERO? (DEBE dar error y decir cuál)
-- update public.libro_fiscal set notas_z = '[{"f":"1234","m":100}]'::jsonb
--  where id = (select id from public.libro_fiscal
--               where numero_zeta is not null limit 1);
--   → esperado: «La nota 1 del reporte Z no tiene número.»
--
-- 4) ¿Y una válida pasa?
-- update public.libro_fiscal set notas_z = '[{"n":"NC-1","f":"1234","m":100}]'::jsonb
--  where id = (select id from public.libro_fiscal
--               where numero_zeta is not null limit 1);
--   → esperado: Success. Despues devolverla a null:
-- update public.libro_fiscal set notas_z = null
--  where id = (select id from public.libro_fiscal
--               where numero_zeta is not null limit 1);
--
-- 5) Los reportes Z que traen notas, con su detalle desplegado:
-- select lf.fecha, lf.numero_zeta, lf.total as neto_del_dia,
--        e ->> 'n' as nota, e ->> 'f' as factura_afectada, e ->> 'm' as monto
--   from public.libro_fiscal lf,
--        lateral jsonb_array_elements(coalesce(lf.notas_z, '[]'::jsonb)) as e
--  order by lf.periodo, lf.fecha;
--
-- 6) Cuánto se devolvió en un período (informativo, NO se resta del libro):
-- select lf.periodo,
--        count(*)                            as notas,
--        round(sum((e ->> 'm')::numeric), 2) as devuelto
--   from public.libro_fiscal lf,
--        lateral jsonb_array_elements(coalesce(lf.notas_z, '[]'::jsonb)) as e
--  where lf.empresa_id = 'PON-AQUI-EL-ID'
--  group by lf.periodo order by lf.periodo;
-- -------------------------------------------------------------
