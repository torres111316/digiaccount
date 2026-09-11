-- ============================================================================
--  EL PRECIO ANCLADO EN DÓLARES
--  11/09/2026
--
--  QUÉ RESUELVE
--    Un comercio venezolano fija buena parte de su catálogo en dólares y lo
--    cobra en bolívares a la tasa del día. Hasta ahora `productos` guardaba
--    un solo precio en bolívares: al moverse la tasa quedaba viejo, y había
--    que reescribir el catálogo entero a mano.
--
--  LA DECISIÓN
--    El ancla es POR PRODUCTO, no por empresa. Un abasto tiene la harina en
--    bolívares y el whisky en dólares, y obligarlo a elegir uno solo para
--    todo el catálogo lo haría trabajar al revés.
--
--      moneda_precio = 'BS'   -> mandan `costo` y `precio` (como hasta hoy)
--      moneda_precio = 'USD'  -> mandan `costo_usd` y `precio_usd`, y los
--                               bolívares se derivan de la tasa
--
--    Por omisión TODO queda en 'BS': los catálogos que ya existen siguen
--    funcionando exactamente igual. Nada cambia hasta que alguien marque un
--    producto en dólares.
--
--  POR QUÉ LOS BOLÍVARES SE SIGUEN GUARDANDO
--    Podrían calcularse siempre al vuelo y no guardarse. Pero `costo` y
--    `precio` los leen hoy el inventario, las ventas, la valoración de
--    existencias y los informes: dejarlos vacíos rompería todo eso de golpe.
--    Así que se guardan, y un disparador los mantiene al día cada vez que el
--    producto se escribe.
--
--    OJO CON LO QUE ESTO NO HACE: el disparador actualiza al GUARDAR, no
--    cuando la tasa cambia al día siguiente. El bolívar guardado es el de la
--    última vez que se tocó el producto. Para mostrar y para facturar, la
--    aplicación recalcula desde el dólar con la tasa vigente — que es lo que
--    de verdad pidió el usuario: «que al reflejar en bolívares coincida con
--    la tasa de ese momento».
--
--  LA TASA ES LA DEL BCV
--    Se toma la más reciente de `tasas_cambio`. Es la que exige el SENIAT en
--    la factura, y la que ya alimenta el resto del sistema.
--
--  Idempotente. No modifica ningún dato existente.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · LAS COLUMNAS
-- ────────────────────────────────────────────────────────────────────────────
alter table public.productos
  add column if not exists moneda_precio text not null default 'BS',
  add column if not exists costo_usd     numeric(14, 4),
  add column if not exists precio_usd    numeric(14, 4);

-- El CHECK va aparte para que re-ejecutar el archivo no falle.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'productos_moneda_precio_ck'
       and conrelid = 'public.productos'::regclass) then
    alter table public.productos
      add constraint productos_moneda_precio_ck
      check (moneda_precio in ('BS', 'USD'));
  end if;
end $$;

comment on column public.productos.moneda_precio is
  'En qué moneda está fijado el precio: BS (manda costo/precio) o USD (manda costo_usd/precio_usd)';
comment on column public.productos.costo_usd is
  'Costo unitario en dólares. Solo manda cuando moneda_precio = USD';
comment on column public.productos.precio_usd is
  'Precio de venta en dólares. Solo manda cuando moneda_precio = USD';


-- ────────────────────────────────────────────────────────────────────────────
--  2 · LA TASA VIGENTE, en un solo lugar
--
--  Devuelve la del BCV más reciente. Si no hay ninguna cargada devuelve NULL,
--  y quien la use decide — es preferible a inventar un 1 que convertiría un
--  precio en dólares en un precio en bolívares idéntico, sin avisar.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.tasa_bcv_vigente()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select tasa
    from public.tasas_cambio
   where moneda = 'USD'
   order by fecha desc
   limit 1;
$$;


-- ────────────────────────────────────────────────────────────────────────────
--  3 · EL DISPARADOR que mantiene los bolívares al día
--
--  POR QUÉ EN LA BASE Y NO EN LA PANTALLA
--  Los productos no entran solo por el formulario: entran por carga masiva,
--  por la API y mañana por el lector de barras. Una regla que solo viva en el
--  navegador se salta por cualquiera de esas puertas, y el producto quedaría
--  con precio en dólares y cero bolívares — invisible en la lista de precios
--  y gratis en una venta.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.sincronizar_precio_bs()
returns trigger
language plpgsql
as $$
declare
  t numeric;
begin
  if new.moneda_precio is distinct from 'USD' then
    return new;                      -- anclado en bolívares: no se toca nada
  end if;

  t := public.tasa_bcv_vigente();
  if t is null or t <= 0 then
    -- Sin tasa cargada no se inventa la conversión: se deja el bolívar como
    -- venía y la aplicación avisará. Guardar un cero aquí sería peor.
    return new;
  end if;

  new.costo  := round(coalesce(new.costo_usd,  0) * t, 2);
  new.precio := round(coalesce(new.precio_usd, 0) * t, 2);
  return new;
end $$;

drop trigger if exists trg_sincronizar_precio_bs on public.productos;
create trigger trg_sincronizar_precio_bs
  before insert or update of moneda_precio, costo_usd, precio_usd
  on public.productos
  for each row
  execute function public.sincronizar_precio_bs();


-- ────────────────────────────────────────────────────────────────────────────
--  4 · COMPROBAR
-- ────────────────────────────────────────────────────────────────────────────

-- 4.1 · La tasa que va a usar el sistema
select public.tasa_bcv_vigente() as tasa_bcv_vigente;

-- 4.2 · Cómo quedó el catálogo. Todo debe salir en 'BS' salvo lo que se
--       marque a mano después.
select moneda_precio, count(*) as articulos
  from public.productos
 group by moneda_precio
 order by moneda_precio;

-- 4.3 · Ningún producto en dólares puede quedar sin su precio en dólares.
--       Debe devolver CERO filas.
select id, nombre, costo_usd, precio_usd
  from public.productos
 where moneda_precio = 'USD'
   and (precio_usd is null or precio_usd <= 0);
