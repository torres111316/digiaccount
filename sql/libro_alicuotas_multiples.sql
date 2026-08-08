-- =============================================================
-- LIBRO FISCAL — varias alícuotas en una misma factura
--
-- El problema: una factura real puede traer renglones exentos, otros al 8%
-- y otros al 16%, todo en el mismo papel. El caso que lo destapó: una
-- panadería compra leche y huevos (exentos), manteca (8%) y el resto (16%)
-- en una sola factura del proveedor.
--
-- Hasta hoy libro_fiscal guardaba UNA sola alícuota por factura, así que
-- había que partir la factura en varios registros o declararla mal.
--
-- Diseño: se AGREGAN columnas por cada renglón de la Forma 30, y las
-- columnas viejas se conservan con su significado de SUMA:
--   · base  = total de la base gravada (general + reducida + adicional)
--   · iva   = total del impuesto de la factura
-- Por eso este cambio NO altera ni un solo total ya declarado: todo lo que
-- lee base/iva hoy (retenciones, asientos, cuadres) sigue leyendo lo mismo.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- =============================================================

-- Renglones de la Forma 30 (compras ítems 14/15/16 · ventas ítems 3/4/5):
--   general   → cód. 33/34   (compras) · 42/43   (ventas)   — alícuota 16%
--   adicional → cód. 332/342 (compras) · 442/452 (ventas)   — general + adicional (16%+15% = 31%)
--   reducida  → cód. 333/343 (compras) · 443/453 (ventas)   — alícuota 8%
-- El exento ya vive en la columna 'exento' (cód. 30 compras · 40 ventas).
alter table public.libro_fiscal
  add column if not exists base_gen   numeric(18,2) not null default 0,
  add column if not exists iva_gen    numeric(18,2) not null default 0,
  add column if not exists base_red   numeric(18,2) not null default 0,
  add column if not exists iva_red    numeric(18,2) not null default 0,
  add column if not exists base_adic  numeric(18,2) not null default 0,
  add column if not exists iva_adic   numeric(18,2) not null default 0;

-- -------------------------------------------------------------
-- Migración de lo ya cargado.
--
-- Las facturas viejas traen toda su base en 'base' y su alícuota en
-- 'alicuota'. Se reparten a la columna que les toca según esa alícuota.
-- Sin esto, la Forma 30 pasaría a leer las columnas nuevas —que estarían en
-- cero— y los renglones 33/34 y 333/343 saldrían vacíos: una declaración en
-- blanco sobre facturas que sí existen.
--
-- El guardado (base_gen + base_red + base_adic = 0) hace que correrla dos
-- veces no duplique nada.
-- -------------------------------------------------------------

-- Alícuota reducida (8%)
update public.libro_fiscal
   set base_red = coalesce(base, 0), iva_red = coalesce(iva, 0)
 where coalesce(base_gen, 0) + coalesce(base_red, 0) + coalesce(base_adic, 0) = 0
   and coalesce(alicuota, 0) > 0 and coalesce(alicuota, 0) < 0.12;

-- Alícuota general + adicional (31%). Casi no debería haber filas: la
-- adicional no se podía registrar antes de este cambio. Va por completitud.
update public.libro_fiscal
   set base_adic = coalesce(base, 0), iva_adic = coalesce(iva, 0)
 where coalesce(base_gen, 0) + coalesce(base_red, 0) + coalesce(base_adic, 0) = 0
   and coalesce(alicuota, 0) >= 0.25;

-- Alícuota general (16%) — todo lo demás que tenga base gravada
update public.libro_fiscal
   set base_gen = coalesce(base, 0), iva_gen = coalesce(iva, 0)
 where coalesce(base_gen, 0) + coalesce(base_red, 0) + coalesce(base_adic, 0) = 0
   and coalesce(base, 0) > 0;

-- -------------------------------------------------------------
-- Comprobación: ninguna factura puede quedar descuadrada.
-- Si esta consulta devuelve filas, hay registros cuyos renglones no suman
-- su propia base y hay que mirarlos antes de declarar.
-- -------------------------------------------------------------
-- select id, fecha, numero_factura, base, base_gen, base_red, base_adic,
--        (coalesce(base_gen,0) + coalesce(base_red,0) + coalesce(base_adic,0)) as suma_renglones
--   from public.libro_fiscal
--  where abs(coalesce(base,0)
--            - (coalesce(base_gen,0) + coalesce(base_red,0) + coalesce(base_adic,0))) > 0.01
--  order by fecha desc;
