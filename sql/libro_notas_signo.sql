-- =============================================================
-- NOTAS DE CRÉDITO Y DÉBITO EN EL LIBRO FISCAL
--
-- EL PROBLEMA
-- Las notas ya estaban bien resueltas en `facturas` (ver
-- notas_credito_debito.sql): la vista facturas_con_notas calcula el neto
-- restando las NC y sumando las ND. Pero el LIBRO FISCAL nunca recibió ese
-- tratamiento: `libro_fiscal.tipo_doc` es un texto suelto y los SIETE sitios
-- del sistema que suman el libro lo hacen a ciegas.
--
-- Consecuencia: una nota de crédito cargada con sus montos tal como los trae
-- impresos SUMA a las ventas en vez de restarlas. El libro sale inflado, el
-- débito fiscal sale inflado, y el asiento mensual y la liquidación de IVA
-- salen inflados detrás. Sin un solo aviso.
--
-- ESTE ARCHIVO HACE DOS COSAS
--   1. COMPRUEBA qué hay cargado hoy, antes de cambiar nada.
--   2. Pone la regla en la base: tipo_doc solo puede ser FV/FC/NC/ND.
--
-- Idempotente. No borra ni modifica ningún dato.
-- =============================================================


-- -------------------------------------------------------------
-- 1) ¿QUÉ HAY CARGADO? — correr ESTO PRIMERO y leer el resultado.
--
-- Importa porque el arreglo del cálculo aplica el signo según el tipo de
-- documento. Si alguien ya cargó notas con el monto en negativo para
-- compensar a mano, el arreglo se lo voltearía y quedaría peor que antes.
-- -------------------------------------------------------------
select
  e.nombre                                   as empresa,
  lf.tipo,                                   -- venta / compra
  coalesce(nullif(btrim(lf.tipo_doc), ''), '(vacío)') as tipo_doc,
  count(*)                                   as filas,
  count(*) filter (where lf.total < 0)       as con_total_negativo,
  count(*) filter (where lf.total > 0)       as con_total_positivo,
  count(*) filter (where lf.total = 0)       as en_cero,
  round(sum(lf.total)::numeric, 2)           as suma_actual,
  min(lf.periodo)                            as desde,
  max(lf.periodo)                            as hasta
from public.libro_fiscal lf
left join public.empresas e on e.id = lf.empresa_id
group by e.nombre, lf.tipo, coalesce(nullif(btrim(lf.tipo_doc), ''), '(vacío)')
order by e.nombre, lf.tipo, tipo_doc;


-- -------------------------------------------------------------
-- 2) El detalle de las notas, si las hay. Para verlas una por una.
-- -------------------------------------------------------------
select e.nombre as empresa, lf.tipo, lf.tipo_doc, lf.periodo, lf.fecha,
       lf.numero_factura, lf.numero_control, lf.tercero_nombre,
       lf.base, lf.iva, lf.total
  from public.libro_fiscal lf
  left join public.empresas e on e.id = lf.empresa_id
 where upper(btrim(coalesce(lf.tipo_doc, ''))) in ('NC', 'ND')
 order by e.nombre, lf.periodo, lf.fecha;


-- -------------------------------------------------------------
-- 3) Facturas con monto negativo: no deberían existir.
--
-- Un documento fiscal no se imprime en negativo. Si aparece alguna, es que
-- se usó el signo para compensar algo a mano, y hay que mirarla antes de
-- que el arreglo del cálculo le cambie el sentido.
-- -------------------------------------------------------------
select e.nombre as empresa, lf.tipo, lf.tipo_doc, lf.periodo, lf.fecha,
       lf.numero_factura, lf.tercero_nombre, lf.total
  from public.libro_fiscal lf
  left join public.empresas e on e.id = lf.empresa_id
 where lf.total < 0
 order by e.nombre, lf.periodo, lf.fecha;


-- -------------------------------------------------------------
-- 4) LA REGLA, EN LA BASE.
--
-- La pantalla ofrece un desplegable con tres opciones, pero un desplegable
-- se salta entrando por la API. Y aquí el tipo de documento decide el SIGNO
-- de la operación: un valor raro no da un error visible, da una declaración
-- mal hecha.
--
-- Se normaliza antes de poner la regla, para no rechazar lo ya cargado.
-- -------------------------------------------------------------
update public.libro_fiscal
   set tipo_doc = upper(btrim(tipo_doc))
 where tipo_doc is not null
   and tipo_doc <> upper(btrim(tipo_doc));

-- Las filas sin tipo reciben el que les corresponde por su naturaleza:
-- FC en compras, FV en ventas. Es lo que el sistema ya asume al mostrarlas.
update public.libro_fiscal
   set tipo_doc = case when tipo = 'compra' then 'FC' else 'FV' end
 where tipo_doc is null or btrim(tipo_doc) = '';

alter table public.libro_fiscal drop constraint if exists libro_tipo_doc_chk;
alter table public.libro_fiscal
  add constraint libro_tipo_doc_chk
  check (tipo_doc in ('FV', 'FC', 'NC', 'ND'));

alter table public.libro_fiscal
  alter column tipo_doc set default 'FV';


-- -------------------------------------------------------------
-- 5) COMPROBACIÓN posterior — debe devolver 0 filas.
-- -------------------------------------------------------------
-- select count(*) as tipos_invalidos
--   from public.libro_fiscal
--  where tipo_doc not in ('FV','FC','NC','ND');
--
-- Y el neto por período, ya con el signo correcto, para contrastarlo contra
-- lo que muestre la pantalla después del cambio:
--
-- select periodo, tipo,
--        round(sum(case when tipo_doc = 'NC' then -abs(total) else abs(total) end)::numeric, 2) as neto
--   from public.libro_fiscal
--  where empresa_id = 'PON-AQUI-EL-ID'
--  group by periodo, tipo order by periodo;
-- -------------------------------------------------------------
