-- =============================================================
-- LA QUINCENA DE DECLARACIÓN
--
-- Un contribuyente ESPECIAL declara el IVA dos veces al mes. Sus libros se
-- llevan por quincena y presenta dos Formas 30 por mes.
--
-- `periodo` guarda 'aaaa-mm', o sea el mes. Alcanzaba mientras las empresas
-- del sistema fueran ordinarias —declaran mensual y el mes ES el período—,
-- y por eso nadie lo notó. Para un especial, el mes no identifica la
-- declaración: la Forma 30 sale con el total de los treinta días en vez del
-- de la quincena que toca presentar.
--
-- POR QUÉ NO SE DEDUCE DE LA FECHA
--   Para las VENTAS funcionaría: la empresa emite la factura, y el día 3 es
--   primera quincena y el 20 es segunda. Para las COMPRAS no: una factura
--   recibida tarde se declara en un período posterior al de su fecha, y en
--   este mismo libro de GATMA hay tres —una del 24/04 declarada en Mayo 1ra,
--   dos de mayo en Junio 1ra—. Deducirla de la fecha las mandaría a la
--   quincena equivocada, que es el error que `periodo` vino a evitar.
--
-- NULO SIGNIFICA MENSUAL
--   Un ordinario declara el mes completo y su quincena es nula. Así las
--   empresas que ya están cargadas no cambian en nada, y el que consulta
--   distingue "declara el mes" de "declara una quincena" sin adivinar.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

alter table public.libro_fiscal
  add column if not exists quincena smallint;

alter table public.retenciones
  add column if not exists quincena smallint;

-- Solo hay dos quincenas. Un 3 sería un dato imposible que nadie detectaría
-- hasta que faltara media declaración.
alter table public.libro_fiscal  drop constraint if exists libro_quincena_chk;
alter table public.libro_fiscal
  add constraint libro_quincena_chk check (quincena is null or quincena in (1, 2));

alter table public.retenciones  drop constraint if exists ret_quincena_chk;
alter table public.retenciones
  add constraint ret_quincena_chk check (quincena is null or quincena in (1, 2));

comment on column public.libro_fiscal.quincena is
  'Quincena de declaración (1 o 2) para contribuyentes especiales. Nula = se declara el mes completo (ordinarios). No se deriva de la fecha: una compra recibida tarde se declara en una quincena posterior a la de su factura.';
comment on column public.retenciones.quincena is
  'Quincena de declaración (1 o 2). Sigue a la de la factura que la origina.';

-- El índice de período existente no sirve para filtrar por quincena: se
-- agrega la columna al final para que la consulta del libro no lea de más.
create index if not exists idx_libro_fiscal_quincena
  on public.libro_fiscal (empresa_id, tipo, periodo, quincena);

-- -------------------------------------------------------------
-- NO SE RELLENA HACIA ATRÁS
--
-- A propósito. Las empresas ya cargadas son ordinarias y declaran mensual:
-- ponerles una quincena sería afirmar algo que no es cierto de ellas. Las
-- filas nuevas de un especial la traen desde su carga.
--
-- Si en el futuro se carga un especial sin quincena y consta que las ventas
-- se declararon en el período de su fecha, se puede derivar SOLO para ventas
-- —nunca para compras, por lo dicho arriba—:
--
--   update public.libro_fiscal
--      set quincena = case when split_part(fecha, '/', 1)::int <= 15 then 1 else 2 end
--    where empresa_id = '<uuid>' and tipo = 'venta' and quincena is null
--      and fecha ~ '^\d{1,2}/\d{1,2}/\d{2}$';
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- CÓMO DESACTIVARLO
--
-- Son columnas nuevas que nada existente lee todavía: mientras la pantalla
-- no filtre por ellas, el sistema se comporta igual que antes.
--
--   alter table public.libro_fiscal drop constraint if exists libro_quincena_chk;
--   alter table public.retenciones  drop constraint if exists ret_quincena_chk;
--   alter table public.libro_fiscal drop column if exists quincena;
--   alter table public.retenciones  drop column if exists quincena;
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- Cómo quedó repartido (nulo es lo correcto en los ordinarios):
--   select e.nombre, l.tipo, l.periodo,
--          coalesce(l.quincena::text, 'mes completo') as declara,
--          count(*), sum(l.base) as base
--     from public.libro_fiscal l
--     join public.empresas e on e.id = l.empresa_id
--    group by 1, 2, 3, 4 order by 1, 3, 2, 4;
--
-- Un especial al que le falte la quincena (debería dar cero filas):
--   select e.nombre, l.tipo, l.periodo, l.fecha, l.numero_factura
--     from public.libro_fiscal l
--     join public.empresas e on e.id = l.empresa_id
--    where e.condicion_fiscal ilike '%especial%' and l.quincena is null;
-- -------------------------------------------------------------
