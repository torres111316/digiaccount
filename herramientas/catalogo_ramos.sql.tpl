-- ============================================================================
--  LISTA DE PRODUCTOS SUGERIDA POR RAMO
--  GENERADO por herramientas/catalogo_ramos.py — no editar a mano: se cambia
--  la lista en el .py y se vuelve a correr. Idempotente.
--  Ejecutar en el SQL Editor de Supabase.
--
--  QUE HACE
--    Al crear una empresa y elegir su ramo, se le cargan los productos más
--    comunes de ese ramo: nombre, categoría, unidad, si va por peso y la
--    alícuota. NACEN SIN PRECIO, SIN COSTO Y SIN EXISTENCIA: eso lo pone cada
--    negocio. Nada se carga sin que la persona lo pida (casilla en el
--    asistente o botón en Configuración → Inventario).
--
--  LA ALICUOTA
--    Sugerida según el art. 18 de la Ley del IVA. Las marcadas revisar = true
--    son dudosas y debe confirmarlas el contador antes de facturar.
-- ============================================================================

-- 1) Ramos nuevos y nombres ajustados
insert into public.ramos (id, nombre, familia, nota, orden) values
  ('bodega',    'Bodega y abasto de barrio',          'empaquetado', 'Víveres, cesta básica exenta, venta al detal', 9),
  ('quincalla', 'Quincalla y variedades',             'empaquetado', 'Surtido amplio, muchos artículos de bajo precio', 19),
  ('cauchera',  'Cauchera',                           'tecnico',     'Cauchos nuevos y usados, montaje y balanceo', 28)
on conflict (id) do update set nombre = excluded.nombre, familia = excluded.familia,
  nota = excluded.nota, orden = excluded.orden;
update public.ramos set nombre = 'Ropa, calzado y accesorios', nota = 'Tallas, colores y bisutería' where id = 'ropa';
update public.ramos set nombre = 'Telefonía, celulares y accesorios' where id = 'telefonia';

insert into public.ramo_perfil (ramo_id,
  mod_comercial, mod_manufactura, mod_servicios,
  lleva_inventario, metodo_costo, vende_por_peso, codigo_barras,
  control_lotes, control_series, unidades_multiples, variantes,
  aplicabilidad, receta, registro_sanitario, listas_precio) values
  ('bodega',    true,false,false, true,'promedio',true, true, false,false,true, false, false,false,false,false),
  ('quincalla', true,false,false, true,'promedio',false,true, false,false,false,false, false,false,false,false),
  ('cauchera',  true,false,true,  true,'promedio',false,false,false,false,false,false, true, false,false,false)
on conflict (ramo_id) do nothing;

-- 2) La lista por ramo (global, igual para todas las cuentas)
create table if not exists public.ramo_productos (
  ramo_id    text not null references public.ramos(id) on delete cascade,
  nombre     text not null,
  categoria  text not null default 'Otros',
  unidad     text not null default 'und',
  por_peso   boolean not null default false,
  alicuota   text not null default '16%' check (alicuota in ('16%', '8%', 'Exento')),
  revisar    boolean not null default false,
  orden      int not null default 100,
  primary key (ramo_id, nombre)
);
comment on table public.ramo_productos is
  'Productos sugeridos por ramo. Se copian a productos cuando la empresa lo pide; nacen sin precio.';

alter table public.ramo_productos enable row level security;
drop policy if exists ramo_productos_lectura on public.ramo_productos;
create policy ramo_productos_lectura on public.ramo_productos for select using (true);
drop policy if exists ramo_productos_escritura on public.ramo_productos;
create policy ramo_productos_escritura on public.ramo_productos for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());

-- Se reemplaza la lista completa de los ramos que trae este archivo
delete from public.ramo_productos
 where ramo_id in (select distinct ramo_id from (values {{RAMOS}}) as r(ramo_id));
insert into public.ramo_productos (ramo_id, nombre, categoria, unidad, por_peso, alicuota, revisar, orden) values
{{VALORES}};

-- 3) Cargar la lista a una empresa. Solo agrega lo que no tenga ya (por nombre),
--    así que se puede pulsar dos veces sin duplicar nada.
create or replace function public.sembrar_catalogo(p_empresa_id uuid, p_ramo_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta uuid;
  v_n      int;
begin
  select cuenta_id into v_cuenta from public.empresas where id = p_empresa_id;
  if v_cuenta is null then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no existe.');
  end if;
  if not (public.soy_superadmin() or v_cuenta = public.mi_cuenta_id()) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;

  insert into public.productos (cuenta_id, empresa_id, nombre, sku, categoria, alicuota,
                                unidad, por_peso, stock, stock_min, existencia, costo, precio, activo)
  select v_cuenta, p_empresa_id, rp.nombre,
         'SKU-' || upper(substr(md5(random()::text || rp.nombre), 1, 6)),
         rp.categoria, rp.alicuota, rp.unidad, rp.por_peso, 0, 0, 0, 0, 0, true
    from public.ramo_productos rp
   where rp.ramo_id = p_ramo_id
     and not exists (select 1 from public.productos p
                      where p.empresa_id = p_empresa_id
                        and lower(p.nombre) = lower(rp.nombre))
   order by rp.orden;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'agregados', v_n);
end;
$$;
grant execute on function public.sembrar_catalogo(uuid, text) to authenticated;

-- 4) Verificación: productos por ramo ({{TOTAL}} en total)
select r.nombre as ramo, count(*) as productos, count(*) filter (where rp.revisar) as por_revisar
  from public.ramo_productos rp join public.ramos r on r.id = rp.ramo_id
 group by r.nombre order by r.nombre;
