-- =============================================================
-- CATÁLOGO POR EMPRESA · paso 1 de la facturación de mostrador
--
-- Hoy `productos` se llavea por cuenta_id y no tiene empresa_id, así que
-- todas las empresas de un contador comparten un solo catálogo. Para llevar
-- libros eso no molestaba y por eso se dejó así. Para vender en mostrador es
-- inviable: los precios se pisan, las existencias se mezclan, y un código de
-- barras tendría que ser único entre negocios que no tienen relación.
--
-- CÓMO SE RESUELVE SIN ROMPER NADA
--   empresa_id es NULLABLE, y el nulo significa algo:
--     empresa_id IS NULL  -> producto del directorio general de la cuenta.
--                            Es como funciona hoy. El contador lo usa para
--                            describir renglones en cualquier empresa.
--     empresa_id NOT NULL -> producto propio de esa empresa. Tiene su precio,
--                            su código de barras y su existencia.
--   Así, lo que ya existe sigue funcionando igual el día que se corra esto.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

-- -------------------------------------------------------------
-- 1 · LAS COLUMNAS QUE FALTAN
-- -------------------------------------------------------------
alter table public.productos
  -- De quién es este producto. Nulo = del directorio general de la cuenta.
  add column if not exists empresa_id uuid references public.empresas(id) on delete cascade,
  -- Código interno del negocio. Es el que la balanza graba en la etiqueta.
  add column if not exists codigo text,
  -- Lo que dispara el lector. Puede ser el de fábrica o uno impreso por la tienda.
  add column if not exists codigo_barras text,
  -- Se vende por peso: el precio es por kilo y la cantidad sale de la balanza.
  add column if not exists por_peso boolean not null default false,
  -- Saldo actual. Por ahora es un contador; cuando existan los movimientos de
  -- inventario, este campo pasa a ser su resultado y no la fuente.
  add column if not exists existencia numeric(14,3) not null default 0,
  -- Para poder retirar un producto sin borrarlo y perder su histórico.
  add column if not exists activo boolean not null default true;

comment on column public.productos.empresa_id is
  'Nulo = producto del directorio general de la cuenta (comportamiento anterior). Con valor = catálogo propio de esa empresa.';
comment on column public.productos.existencia is
  'Saldo actual. Provisional: cuando existan los movimientos de inventario, será derivado.';

-- Un producto por peso se cobra por kilo: no tiene sentido sin precio.
alter table public.productos drop constraint if exists productos_peso_chk;
alter table public.productos
  add constraint productos_peso_chk
  check (not por_peso or precio is not null);

-- -------------------------------------------------------------
-- 2 · LOS CÓDIGOS NO SE PUEDEN REPETIR DONDE IMPORTA
--
-- Dos índices parciales en vez de uno: el ámbito de unicidad cambia según
-- dónde viva el producto. Dentro de una empresa, único por empresa. En el
-- directorio general, único por cuenta.
-- -------------------------------------------------------------
create unique index if not exists productos_barras_por_empresa
  on public.productos (empresa_id, codigo_barras)
  where empresa_id is not null and codigo_barras is not null and codigo_barras <> '';

create unique index if not exists productos_barras_por_cuenta
  on public.productos (cuenta_id, codigo_barras)
  where empresa_id is null and codigo_barras is not null and codigo_barras <> '';

create unique index if not exists productos_codigo_por_empresa
  on public.productos (empresa_id, codigo)
  where empresa_id is not null and codigo is not null and codigo <> '';

create index if not exists productos_por_empresa
  on public.productos (empresa_id) where empresa_id is not null;

-- -------------------------------------------------------------
-- 3 · EL FORMATO DE LA ETIQUETA DE BALANZA, POR EMPRESA
--
-- El reparto de los trece dígitos NO es igual en todas las balanzas: unas
-- graban el peso y otras el precio ya calculado, y la cantidad de dígitos
-- cambia por marca. Si esto fuera una constante del código, el cliente con
-- otra balanza registraría cada venta con el peso equivocado — y nadie lo
-- notaría hasta cuadrar el inventario.
--
-- Formato por defecto (EAN-13):  P CCCCC DDDDDD V
--   P       prefijo — 2 por convención internacional para medida variable
--   CCCCC   código del producto            -> balanza_dig_codigo
--   DDDDDD  el dato variable: peso o precio -> balanza_dig_dato
--   V       dígito verificador
-- El largo total (balanza_largo) es 13 en EAN-13 y 12 en UPC-A.
-- -------------------------------------------------------------
alter table public.empresas
  add column if not exists balanza_prefijo    text    not null default '2',
  -- 'peso'   el código trae los gramos
  -- 'precio' el código trae el importe ya calculado por la balanza
  add column if not exists balanza_dato       text    not null default 'peso',
  add column if not exists balanza_dig_codigo integer not null default 5,
  add column if not exists balanza_dig_dato   integer not null default 6,
  -- 13 en EAN-13, 12 en UPC-A. Cambia por marca de balanza.
  add column if not exists balanza_largo      integer not null default 13,
  -- Por cuánto dividir el dato para llevarlo a su unidad natural:
  -- 1000 si son gramos a kilos, 100 si son céntimos a bolívares.
  add column if not exists balanza_divisor    integer not null default 1000;

alter table public.empresas drop constraint if exists empresas_balanza_chk;
alter table public.empresas
  add constraint empresas_balanza_chk check (
    balanza_dato in ('peso', 'precio')
    and balanza_prefijo ~ '^[0-9]{1,2}$'
    and balanza_dig_codigo between 3 and 7
    and balanza_dig_dato   between 3 and 7
    and balanza_divisor in (1, 10, 100, 1000)
    and balanza_largo in (12, 13)
    -- Las partes tienen que sumar el largo, contando el verificador final.
    and length(balanza_prefijo) + balanza_dig_codigo + balanza_dig_dato + 1 = balanza_largo
  );

-- -------------------------------------------------------------
-- 4 · LEER UNA ETIQUETA DE BALANZA
--
-- Una sola implementación de referencia, en la base, para que la pantalla y
-- cualquier otro consumidor interpreten igual el mismo código. Devuelve el
-- producto y la cantidad ya convertida.
--
-- Si el código no es de medida variable devuelve nada: el que llama debe
-- entonces buscarlo como código de barras normal.
-- -------------------------------------------------------------
create or replace function public.leer_etiqueta_balanza(p_empresa uuid, p_codigo text)
returns table (producto_id uuid, nombre text, cantidad numeric, dato text, precio numeric)
-- SECURITY INVOKER a propósito: así el RLS de empresas y productos decide qué
-- puede ver quien llama. Con DEFINER habría que replicar esa comprobación aquí
-- a mano, y una empresa ajena pasada por parámetro devolvería datos de otro.
language plpgsql stable security invoker set search_path = public as $fn$
declare
  e            record;
  v_cod        text;
  v_interno    text;
  v_dato_txt   text;
  v_valor      numeric;
begin
  select balanza_prefijo, balanza_dato, balanza_dig_codigo, balanza_dig_dato,
         balanza_divisor, balanza_largo
    into e from public.empresas where id = p_empresa;
  if not found then return; end if;

  -- Solo dígitos: algunos lectores agregan espacios o saltos.
  v_cod := regexp_replace(coalesce(p_codigo, ''), '[^0-9]', '', 'g');
  if length(v_cod) <> e.balanza_largo then return; end if;
  if left(v_cod, length(e.balanza_prefijo)) <> e.balanza_prefijo then return; end if;

  v_interno  := substr(v_cod, length(e.balanza_prefijo) + 1, e.balanza_dig_codigo);
  v_dato_txt := substr(v_cod, length(e.balanza_prefijo) + e.balanza_dig_codigo + 1, e.balanza_dig_dato);
  v_valor    := v_dato_txt::numeric / e.balanza_divisor;

  return query
    select p.id, p.nombre,
           -- Si la balanza grabó el PRECIO, la cantidad se deduce del precio
           -- por kilo. Si grabó el PESO, ya es la cantidad.
           case when e.balanza_dato = 'precio' and coalesce(p.precio, 0) > 0
                then round(v_valor / p.precio, 3)
                else v_valor end,
           e.balanza_dato,
           p.precio
      from public.productos p
     where p.empresa_id = p_empresa
       and p.activo
       -- El código interno se compara sin ceros a la izquierda: la balanza
       -- rellena a ancho fijo y el catálogo casi nunca.
       and ltrim(coalesce(p.codigo, ''), '0') = ltrim(v_interno, '0')
     limit 1;
end;
$fn$;

grant execute on function public.leer_etiqueta_balanza(uuid, text) to authenticated, service_role;

-- -------------------------------------------------------------
-- 5 · MIGRAR LO QUE YA EXISTE  (opcional, se corre a mano)
--
-- Los productos actuales quedan con empresa_id nulo, o sea en el directorio
-- general — que es exactamente como funcionan hoy. NO se asignan solos a una
-- empresa: adivinar a cuál pertenecen sería inventar.
--
-- Cuando quieras pasar los de una empresa a su catálogo propio:
--
--   update public.productos
--      set empresa_id = '<uuid de la empresa>'
--    where cuenta_id  = '<uuid de la cuenta>'
--      and empresa_id is null
--      and nombre in ('...', '...');       -- los que correspondan
--
-- Y para copiar el directorio general al catálogo de una empresa sin vaciarlo:
--
--   insert into public.productos (cuenta_id, empresa_id, nombre, precio, costo, unidad, alicuota)
--   select cuenta_id, '<uuid de la empresa>', nombre, precio, costo, unidad, alicuota
--     from public.productos
--    where cuenta_id = '<uuid de la cuenta>' and empresa_id is null;
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- CÓMO DESACTIVARLO
--
-- Nada de esto corre dentro de una operación existente: son columnas nuevas
-- con valor por defecto y una función que hay que llamar a propósito. Lo que
-- ya funciona sigue igual aunque no se use ninguna.
--
-- Para quitarlo del todo:
--   drop function if exists public.leer_etiqueta_balanza(uuid, text);
--   alter table public.empresas  drop constraint if exists empresas_balanza_chk;
--   alter table public.empresas  drop column if exists balanza_prefijo,
--                                drop column if exists balanza_dato,
--                                drop column if exists balanza_dig_codigo,
--                                drop column if exists balanza_dig_dato,
--                                drop column if exists balanza_divisor;
--   alter table public.productos drop constraint if exists productos_peso_chk;
--   alter table public.productos drop column if exists empresa_id,
--                                drop column if exists codigo,
--                                drop column if exists codigo_barras,
--                                drop column if exists por_peso,
--                                drop column if exists existencia,
--                                drop column if exists activo;
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- Cómo quedó repartido el catálogo:
--   select coalesce(e.nombre, '— directorio general —') as donde, count(*)
--     from public.productos p
--     left join public.empresas e on e.id = p.empresa_id
--    group by 1 order by 1;
--
-- Probar el decodificador con el formato por defecto (prefijo 2, 5 y 5, peso
-- en gramos). Da de alta un producto de prueba y lee su etiqueta:
--   insert into public.productos (cuenta_id, empresa_id, nombre, codigo, precio, por_peso, alicuota)
--   values ('<cuenta>', '<empresa>', 'Queso blanco', '00042', 180.00, true, 16);
--
--   select * from public.leer_etiqueta_balanza('<empresa>', '2000420012346');
--   --   2 | 00042 | 001234 | 6      -> producto 42, 1,234 kg
--   --   (el 6 final es el verificador EAN-13 de 200042001234)
-- -------------------------------------------------------------
