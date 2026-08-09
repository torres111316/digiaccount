-- =============================================================
-- NOTAS DE CRÉDITO Y DÉBITO
--   Providencia SNAT/2024/000121, Art. 3 literal d:
--     "corrección o anulación de factura ÚNICAMENTE mediante notas de débito
--      o crédito — los datos originales se conservan inalterables"
--   Providencia SNAT/2024/000102, Art. 8:
--     las notas cumplen los requisitos de la PA SNAT/2011/0071 MÁS los
--     numerales 4, 5 y 6 del Art. 7 (N° de control, rango asignado, y fecha
--     DDMMAAAA con hora HH.MM.SS indicando a.m./p.m.)
--
-- PRINCIPIO DE DISEÑO: la factura original NO SE TOCA.
-- Ni siquiera para marcarla como anulada. Un campo "anulada" en la factura
-- sería una modificación del documento original, que es justo lo que la
-- providencia prohíbe. La relación vive en la NOTA, que apunta a la factura
-- que corrige. Que una factura esté anulada se AVERIGUA buscando sus notas,
-- no se lee de un campo que alguien tuvo que cambiar.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- No borra ni modifica ningún dato existente.
-- =============================================================

alter table public.facturas
  -- FV = factura de venta · NC = nota de crédito · ND = nota de débito
  add column if not exists tipo_doc         text not null default 'FV',
  -- A qué factura corrige esta nota. Nulo en las facturas.
  add column if not exists factura_afectada uuid references public.facturas(id),
  -- Por qué se emitió. Va impreso en la nota: la 0071 lo exige.
  add column if not exists motivo           text,
  /* Fecha Y HORA de emisión (Art. 7 numeral 6). Se guarda como marca de
     tiempo y se le da formato al imprimir; guardar el texto ya formateado
     impediría ordenar y comparar. Aplica a TODAS las facturas, no solo a
     las notas: el numeral 6 rige para todos los documentos. */
  add column if not exists emitida_en       timestamptz not null default now();

create index if not exists facturas_afectada on public.facturas (factura_afectada)
  where factura_afectada is not null;
create index if not exists facturas_tipo_doc on public.facturas (empresa_id, tipo_doc);

-- -------------------------------------------------------------
-- Reglas de integridad. Se ponen en la BASE y no en la pantalla porque una
-- validación de pantalla se salta entrando por la API — el mismo argumento
-- del registro de eventos.
-- -------------------------------------------------------------
alter table public.facturas drop constraint if exists facturas_tipo_doc_chk;
alter table public.facturas
  add constraint facturas_tipo_doc_chk check (tipo_doc in ('FV', 'NC', 'ND'));

/* Una nota SIN la factura que corrige no puede existir.
   Es el requisito de la 000121 convertido en estructura: no depende de que
   la pantalla lo valide ni de que alguien se acuerde. */
alter table public.facturas drop constraint if exists facturas_nota_afecta_chk;
alter table public.facturas
  add constraint facturas_nota_afecta_chk
  check (tipo_doc = 'FV' or factura_afectada is not null);

/* Y una nota tiene que decir por qué se emitió. La 0071 lo exige y, en la
   práctica, una nota sin motivo es la que nadie sabe explicar en una
   fiscalización tres años después. */
alter table public.facturas drop constraint if exists facturas_nota_motivo_chk;
alter table public.facturas
  add constraint facturas_nota_motivo_chk
  check (tipo_doc = 'FV' or (motivo is not null and btrim(motivo) <> ''));

-- -------------------------------------------------------------
-- Vista de apoyo: qué facturas están anuladas o ajustadas, y por cuál nota.
--
-- Se calcula, no se guarda. Así la factura original permanece intacta y la
-- respuesta siempre refleja las notas que existen de verdad.
-- -------------------------------------------------------------
create or replace view public.facturas_con_notas as
select f.id,
       f.empresa_id,
       f.numero,
       f.total,
       count(n.id)                                as notas,
       coalesce(sum(case when n.tipo_doc = 'NC' then n.total else 0 end), 0) as total_notas_credito,
       coalesce(sum(case when n.tipo_doc = 'ND' then n.total else 0 end), 0) as total_notas_debito,
       -- El neto después de las notas: lo que realmente quedó de esa factura.
       f.total
         - coalesce(sum(case when n.tipo_doc = 'NC' then n.total else 0 end), 0)
         + coalesce(sum(case when n.tipo_doc = 'ND' then n.total else 0 end), 0) as total_neto,
       string_agg(n.tipo_doc || '-' || n.numero, ', ' order by n.emitida_en) as documentos
  from public.facturas f
  left join public.facturas n
         on n.factura_afectada = f.id
        and n.tipo_doc in ('NC', 'ND')
 where f.tipo_doc = 'FV'
 group by f.id, f.empresa_id, f.numero, f.total;

-- La vista hereda la seguridad de la tabla: se ejecuta con los permisos de
-- quien consulta, así que RLS de 'facturas' sigue mandando.
alter view public.facturas_con_notas set (security_invoker = on);
grant select on public.facturas_con_notas to authenticated;

-- -------------------------------------------------------------
-- COMPROBACIÓN (descomentar y correr)
--
-- 1) ¿Quedaron las columnas y las reglas?
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'facturas'
--    and column_name in ('tipo_doc','factura_afectada','motivo','emitida_en')
--  order by column_name;
--
-- 2) ¿La base rechaza una nota huérfana? (DEBE dar error)
-- insert into public.facturas (cuenta_id, empresa_id, numero, tipo_doc)
-- values (null, null, 'PRUEBA', 'NC');
--   → esperado: viola facturas_nota_afecta_chk
--
-- 3) Facturas con sus notas (al principio saldrán todas con 0 notas):
-- select numero, total, notas, total_neto, documentos
--   from public.facturas_con_notas order by numero desc limit 10;
-- -------------------------------------------------------------
