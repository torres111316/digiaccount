-- ============================================================================
--  EL RAMO DE LA EMPRESA · Fase 1 · la base
--  26/08/2026
--
--  QUE RESUELVE
--    Una ferreteria, una farmacia y un restaurante llevan inventarios que no
--    se parecen. Preguntar el ramo una vez permite que el catalogo de cada
--    empresa nazca con los controles correctos y con la alicuota correcta.
--
--  LA DECISION QUE SOSTIENE TODO
--    El ramo es un PREAJUSTE, no una camisa de fuerza. Se pregunta al crear la
--    empresa, siembra los valores por defecto, y a partir de ahi manda
--    empresa_inventario_config. El ramo NO se vuelve a consultar para decidir
--    comportamiento — nunca un "if ramo = farmacia" en el codigo.
--
--    Por eso el perfil se COPIA en vez de referenciarse: si manana se corrige
--    el perfil de "ferreteria", las ferreterias que ya funcionan con su
--    configuracion ajustada no se ven afectadas. Solo cambia con que nacen
--    las nuevas.
--
--  LOS TRES MODELOS QUE YA EXISTEN
--    comercial / manufactura / servicios no compiten con el ramo: el ramo los
--    ENCIENDE. Y de paso los persiste, que hoy viven solo en memoria (ver
--    app.js, `const enabled = { comercial: true, ... }`) y se pierden al
--    recargar.
--
--  TODO ES ADITIVO
--    Tres tablas nuevas y una columna nueva en empresas. Las empresas que ya
--    existen quedan sin ramo y siguen funcionando exactamente igual: nada
--    depende del ramo para operar.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · RAMOS · catalogo maestro, igual para todas las cuentas
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.ramos (
  id       text primary key,
  nombre   text not null,
  familia  text not null
           check (familia in ('empaquetado','tecnico','peso','produccion','servicio','otro')),
  nota     text,
  orden    int  not null default 100
);

comment on table public.ramos is
  'Catalogo de ramos. Agrupados por PERFIL DE INVENTARIO, no por rubro comercial: un abasto y una perfumeria no se parecen como negocio pero llevan el catalogo igual.';


-- ────────────────────────────────────────────────────────────────────────────
--  2 · RAMO_PERFIL · con que valores NACE una empresa de cada ramo
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.ramo_perfil (
  ramo_id            text primary key references public.ramos(id) on delete cascade,

  -- Los tres modelos que ya existen en la aplicacion
  mod_comercial      boolean not null default true,
  mod_manufactura    boolean not null default false,
  mod_servicios      boolean not null default false,

  -- Los interruptores del inventario
  lleva_inventario   boolean not null default true,
  metodo_costo       text    not null default 'promedio'
                     check (metodo_costo in ('promedio','peps','especifica')),
  vende_por_peso     boolean not null default false,
  codigo_barras      boolean not null default false,
  control_lotes      boolean not null default false,
  control_series     boolean not null default false,
  unidades_multiples boolean not null default false,
  variantes          boolean not null default false,
  aplicabilidad      boolean not null default false,
  receta             boolean not null default false,
  registro_sanitario boolean not null default false,
  listas_precio      boolean not null default false
);


-- ────────────────────────────────────────────────────────────────────────────
--  3 · EMPRESA_INVENTARIO_CONFIG · lo que esa empresa usa DE VERDAD
--
--  Se copia de ramo_perfil al elegir el ramo, y desde ese momento manda esta
--  tabla. Es la unica que el codigo debe consultar.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.empresa_inventario_config (
  empresa_id         uuid primary key references public.empresas(id) on delete cascade,
  cuenta_id          uuid not null references public.cuentas(id) on delete cascade,

  mod_comercial      boolean not null default true,
  mod_manufactura    boolean not null default false,
  mod_servicios      boolean not null default false,

  lleva_inventario   boolean not null default true,
  metodo_costo       text    not null default 'promedio'
                     check (metodo_costo in ('promedio','peps','especifica')),
  vende_por_peso     boolean not null default false,
  codigo_barras      boolean not null default false,
  control_lotes      boolean not null default false,
  control_series     boolean not null default false,
  unidades_multiples boolean not null default false,
  variantes          boolean not null default false,
  aplicabilidad      boolean not null default false,
  receta             boolean not null default false,
  registro_sanitario boolean not null default false,
  listas_precio      boolean not null default false,

  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);


-- ────────────────────────────────────────────────────────────────────────────
--  4 · La columna en empresas. Informativa: reportes, semillas, directorio.
--      NUNCA para decidir comportamiento.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.empresas
  add column if not exists ramo_id text references public.ramos(id) on delete set null;

comment on column public.empresas.ramo_id is
  'Ramo del negocio. Solo informativo y para sembrar la configuracion: el comportamiento sale de empresa_inventario_config.';


-- ============================================================================
--  EL CATALOGO DE RAMOS
--  Columnas del perfil, en orden:
--    com, manu, serv | inv, costo, peso, barras, lotes, series, unid, var,
--    aplic, receta, sanit, listas
-- ============================================================================
insert into public.ramos (id, nombre, familia, nota, orden) values
  -- Comercio empaquetado ────────────────────────────────────────────────────
  ('abasto',        'Abasto y supermercado',            'empaquetado', 'Perecederos, exentos de cesta basica, alta rotacion', 10),
  ('licoreria',     'Bodegon y licoreria',              'empaquetado', 'Alicuota adicional en licores', 11),
  ('farmacia',      'Farmacia',                         'empaquetado', 'Medicinas exentas, lote y vencimiento obligatorios', 12),
  ('perfumeria',    'Perfumeria y cosmeticos',          'empaquetado', 'Lote, vencimiento, presentaciones', 13),
  ('libreria',      'Libreria y papeleria',             'empaquetado', 'Libros exentos, utiles gravados', 14),
  ('ropa',          'Ropa y calzado',                   'empaquetado', 'Variantes de talla y color', 15),
  ('jugueteria',    'Jugueteria y regalos',             'empaquetado', 'Estacionalidad fuerte', 16),
  ('electro',       'Electrodomesticos y electronica',  'empaquetado', 'Series y garantias', 17),
  ('telefonia',     'Telefonia y computacion',          'empaquetado', 'IMEI y seriales', 18),

  -- Comercio tecnico ────────────────────────────────────────────────────────
  ('ferreteria',    'Ferreteria',                       'tecnico', 'Granel y empaquetado, metro y pieza', 20),
  ('repuestos',     'Repuestos automotrices',           'tecnico', 'Aplicabilidad por marca-modelo-ano', 21),
  ('repuestos_moto','Repuestos de motos',               'tecnico', 'Rotacion alta, ticket menor', 22),
  ('construccion',  'Materiales de construccion',       'tecnico', 'Saco, metro cubico, venta por proyecto', 23),
  ('agropecuaria',  'Agropecuaria y agroinsumos',       'tecnico', 'INSAI, lotes, saco y kilo', 24),
  ('oficina',       'Suministros de oficina',           'tecnico', 'Resma y unidad, listas corporativas', 25),
  ('electricos',    'Electricos e iluminacion',         'tecnico', 'Rollo y metro, especificacion tecnica', 26),
  ('mayorista',     'Distribucion mayorista',           'tecnico', 'Listas por canal, unidad de venta distinta', 27),

  -- Venta por peso ──────────────────────────────────────────────────────────
  ('panaderia',     'Panaderia de mostrador',           'peso', 'Pan exento, pasteleria gravada', 30),
  ('charcuteria',   'Charcuteria y delicateses',        'peso', 'Peso, lote, vencimiento corto', 31),
  ('carniceria',    'Carniceria y pescaderia',          'peso', 'Cadena de frio, merma', 32),
  ('verduleria',    'Verduleria y fruteria',            'peso', 'Exentos, merma alta', 33),
  ('lacteos',       'Quesos y lacteos',                 'peso', 'Peso, lote, exentos parciales', 34),

  -- Produccion ──────────────────────────────────────────────────────────────
  ('restaurante',   'Restaurante y cafeteria',          'produccion', 'Escandallo por plato, mermas', 40),
  ('comida_rapida', 'Comida rapida y delivery',         'produccion', 'Recetas simples, alto volumen', 41),
  ('panaderia_prod','Panaderia productora',             'produccion', 'Insumos a granel, produccion diaria', 42),
  ('manufactura',   'Manufactura ligera',               'produccion', 'Materia prima, proceso, terminado', 43),
  ('imprenta',      'Imprenta y litografia',            'produccion', 'Trabajo por especificacion', 44),
  ('festejos',      'Agencia de festejos',              'produccion', 'Paquetes que consumen insumos', 45),

  -- Servicios ───────────────────────────────────────────────────────────────
  ('contable',      'Firma contable o consultoria',     'servicio', 'Honorarios recurrentes', 50),
  ('taller',        'Taller mecanico',                  'servicio', 'Mano de obra + repuestos', 51),
  ('consultorio',   'Consultorio medico u odontologico','servicio', 'Servicios exentos, insumos gravados', 52),
  ('veterinaria',   'Clinica veterinaria',              'servicio', 'Servicio + medicinas con lote', 53),
  ('belleza',       'Salon de belleza y barberia',      'servicio', 'Servicio + productos de reventa', 54),
  ('optica',        'Optica',                           'servicio', 'Formula del lente + montura', 55),
  ('gimnasio',      'Gimnasio y academias',             'servicio', 'Membresias recurrentes', 56),
  ('hotel',         'Hoteleria y posadas',              'servicio', 'Noches, temporadas, consumos', 57),
  ('transporte',    'Transporte y fletes',              'servicio', 'Ruta, peso, volumen', 58),
  ('alquileres',    'Alquileres e inmobiliaria',        'servicio', 'Canon mensual, retencion de ISLR', 59),
  ('lavanderia',    'Lavanderia',                       'servicio', 'Servicio por pieza o por kilo', 60),
  ('estacion',      'Estacion de servicio',             'servicio', 'Litro, precio regulado, cierre por turno', 61),

  -- La salida que ningun catalogo puede faltar ──────────────────────────────
  ('otro',          'Otro — lo configuro yo',           'otro', 'Comercio general: los interruptores quedan a tu criterio', 99)
on conflict (id) do update
  set nombre = excluded.nombre, familia = excluded.familia,
      nota = excluded.nota, orden = excluded.orden;


-- ============================================================================
--  LOS PERFILES
-- ============================================================================
insert into public.ramo_perfil (ramo_id,
  mod_comercial, mod_manufactura, mod_servicios,
  lleva_inventario, metodo_costo, vende_por_peso, codigo_barras,
  control_lotes, control_series, unidades_multiples, variantes,
  aplicabilidad, receta, registro_sanitario, listas_precio) values

  -- Comercio empaquetado
  ('abasto',        true,false,false, true,'promedio',false,true,  true, false,false,false, false,false,false,false),
  ('licoreria',     true,false,false, true,'promedio',false,true,  true, false,false,false, false,false,false,false),
  ('farmacia',      true,false,false, true,'peps',    false,true,  true, false,false,false, false,false,true, false),
  ('perfumeria',    true,false,false, true,'promedio',false,true,  true, false,false,true,  false,false,true, false),
  ('libreria',      true,false,false, true,'promedio',false,true,  false,false,false,false, false,false,false,false),
  ('ropa',          true,false,false, true,'promedio',false,true,  false,false,false,true,  false,false,false,false),
  ('jugueteria',    true,false,false, true,'promedio',false,true,  false,false,false,false, false,false,false,false),
  ('electro',       true,false,false, true,'promedio',false,true,  false,true, false,false, false,false,false,false),
  ('telefonia',     true,false,false, true,'promedio',false,true,  false,true, false,false, false,false,false,false),

  -- Comercio tecnico
  ('ferreteria',    true,false,false, true,'promedio',false,false, false,false,true, false, false,false,false,true),
  ('repuestos',     true,false,false, true,'promedio',false,false, false,false,false,false, true, false,false,true),
  ('repuestos_moto',true,false,false, true,'promedio',false,false, false,false,false,false, true, false,false,true),
  ('construccion',  true,false,false, true,'promedio',false,false, false,false,true, false, false,false,false,true),
  ('agropecuaria',  true,false,false, true,'peps',    false,false, true, false,true, false, false,false,true, true),
  ('oficina',       true,false,false, true,'promedio',false,true,  false,false,true, false, false,false,false,true),
  ('electricos',    true,false,false, true,'promedio',false,false, false,false,true, false, false,false,false,true),
  ('mayorista',     true,false,false, true,'promedio',false,true,  false,false,true, false, false,false,false,true),

  -- Venta por peso
  ('panaderia',     true,false,false, true,'promedio',true, true,  true, false,true, false, false,false,false,false),
  ('charcuteria',   true,false,false, true,'peps',    true, true,  true, false,true, false, false,false,false,false),
  ('carniceria',    true,false,false, true,'peps',    true, true,  true, false,true, false, false,false,false,false),
  ('verduleria',    true,false,false, true,'peps',    true, false, false,false,true, false, false,false,false,false),
  ('lacteos',       true,false,false, true,'peps',    true, true,  true, false,true, false, false,false,false,false),

  -- Produccion
  ('restaurante',   true,true, false, true,'promedio',false,false, false,false,true, false, false,true, false,false),
  ('comida_rapida', true,true, false, true,'promedio',false,false, false,false,true, false, false,true, false,false),
  ('panaderia_prod',true,true, false, true,'promedio',true, false, false,false,true, false, false,true, false,false),
  ('manufactura',   true,true, false, true,'promedio',false,false, false,false,true, false, false,true, false,true),
  ('imprenta',      true,true, true,  true,'promedio',false,false, false,false,true, false, false,true, false,false),
  ('festejos',      true,true, true,  true,'promedio',false,false, false,false,false,false, false,true, false,false),

  -- Servicios
  ('contable',      false,false,true, false,'promedio',false,false,false,false,false,false, false,false,false,false),
  ('taller',        true, false,true, true, 'promedio',false,false,false,false,false,false, true, false,false,false),
  ('consultorio',   true, false,true, true, 'peps',    false,false,true, false,false,false, false,false,true, false),
  ('veterinaria',   true, false,true, true, 'peps',    false,false,true, false,false,false, false,false,true, false),
  ('belleza',       true, false,true, true, 'promedio',false,true, false,false,false,false, false,false,false,false),
  ('optica',        true, false,true, true, 'promedio',false,false,false,false,false,true,  false,false,false,false),
  ('gimnasio',      false,false,true, false,'promedio',false,false,false,false,false,false, false,false,false,false),
  ('hotel',         true, false,true, true, 'promedio',false,false,false,false,false,false, false,false,false,false),
  ('transporte',    false,false,true, false,'promedio',false,false,false,false,false,false, false,false,false,false),
  ('alquileres',    false,false,true, false,'promedio',false,false,false,false,false,false, false,false,false,false),
  ('lavanderia',    false,false,true, false,'promedio',false,false,false,false,false,false, false,false,false,false),
  ('estacion',      true, false,false,true, 'promedio',false,false,false,false,true, false, false,false,false,false),

  ('otro',          true, false,false,true, 'promedio',false,false,false,false,false,false, false,false,false,false)
on conflict (ramo_id) do update set
  mod_comercial = excluded.mod_comercial, mod_manufactura = excluded.mod_manufactura,
  mod_servicios = excluded.mod_servicios, lleva_inventario = excluded.lleva_inventario,
  metodo_costo = excluded.metodo_costo, vende_por_peso = excluded.vende_por_peso,
  codigo_barras = excluded.codigo_barras, control_lotes = excluded.control_lotes,
  control_series = excluded.control_series, unidades_multiples = excluded.unidades_multiples,
  variantes = excluded.variantes, aplicabilidad = excluded.aplicabilidad,
  receta = excluded.receta, registro_sanitario = excluded.registro_sanitario,
  listas_precio = excluded.listas_precio;


-- ============================================================================
--  APLICAR UN RAMO A UNA EMPRESA
--
--  Copia el perfil. Es la unica funcion que traduce ramo -> configuracion, y
--  corre solo cuando alguien lo pide: nunca sola, nunca en silencio.
--
--  p_sobrescribir = false (por defecto) NO pisa una configuracion existente.
--  Sirve para elegir el ramo de una empresa ya cargada sin perder lo ajustado.
-- ============================================================================
create or replace function public.aplicar_ramo(
  p_empresa_id    uuid,
  p_ramo_id       text,
  p_sobrescribir  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta uuid;
  v_perf   public.ramo_perfil%rowtype;
  v_habia  boolean;
begin
  select cuenta_id into v_cuenta from public.empresas where id = p_empresa_id;
  if v_cuenta is null then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no existe.');
  end if;
  if not (public.soy_superadmin() or v_cuenta = public.mi_cuenta_id()) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;

  select * into v_perf from public.ramo_perfil where ramo_id = p_ramo_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Ese ramo no existe.');
  end if;

  update public.empresas set ramo_id = p_ramo_id where id = p_empresa_id;

  select exists (select 1 from public.empresa_inventario_config where empresa_id = p_empresa_id)
    into v_habia;

  if v_habia and not p_sobrescribir then
    return jsonb_build_object('ok', true, 'ramo', p_ramo_id, 'config', 'conservada',
      'aviso', 'Esta empresa ya tenia su configuracion de inventario y se dejo como estaba.');
  end if;

  insert into public.empresa_inventario_config (
    empresa_id, cuenta_id,
    mod_comercial, mod_manufactura, mod_servicios,
    lleva_inventario, metodo_costo, vende_por_peso, codigo_barras,
    control_lotes, control_series, unidades_multiples, variantes,
    aplicabilidad, receta, registro_sanitario, listas_precio)
  values (
    p_empresa_id, v_cuenta,
    v_perf.mod_comercial, v_perf.mod_manufactura, v_perf.mod_servicios,
    v_perf.lleva_inventario, v_perf.metodo_costo, v_perf.vende_por_peso, v_perf.codigo_barras,
    v_perf.control_lotes, v_perf.control_series, v_perf.unidades_multiples, v_perf.variantes,
    v_perf.aplicabilidad, v_perf.receta, v_perf.registro_sanitario, v_perf.listas_precio)
  on conflict (empresa_id) do update set
    mod_comercial = excluded.mod_comercial, mod_manufactura = excluded.mod_manufactura,
    mod_servicios = excluded.mod_servicios, lleva_inventario = excluded.lleva_inventario,
    metodo_costo = excluded.metodo_costo, vende_por_peso = excluded.vende_por_peso,
    codigo_barras = excluded.codigo_barras, control_lotes = excluded.control_lotes,
    control_series = excluded.control_series, unidades_multiples = excluded.unidades_multiples,
    variantes = excluded.variantes, aplicabilidad = excluded.aplicabilidad,
    receta = excluded.receta, registro_sanitario = excluded.registro_sanitario,
    listas_precio = excluded.listas_precio, actualizado_en = now();

  return jsonb_build_object('ok', true, 'ramo', p_ramo_id, 'config', 'aplicada');
end;
$$;


-- ============================================================================
--  RLS
--  Los ramos y sus perfiles son catalogo publico: cualquiera los lee, solo el
--  fundador los cambia. La configuracion de cada empresa es de su cuenta.
-- ============================================================================
alter table public.ramos                     enable row level security;
alter table public.ramo_perfil               enable row level security;
alter table public.empresa_inventario_config enable row level security;

drop policy if exists ramos_lectura on public.ramos;
create policy ramos_lectura on public.ramos for select using (true);
drop policy if exists ramos_escritura on public.ramos;
create policy ramos_escritura on public.ramos for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());

drop policy if exists perfil_lectura on public.ramo_perfil;
create policy perfil_lectura on public.ramo_perfil for select using (true);
drop policy if exists perfil_escritura on public.ramo_perfil;
create policy perfil_escritura on public.ramo_perfil for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());

drop policy if exists cfg_lectura on public.empresa_inventario_config;
create policy cfg_lectura on public.empresa_inventario_config for select
  using (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id());
drop policy if exists cfg_escritura on public.empresa_inventario_config;
create policy cfg_escritura on public.empresa_inventario_config for all
  using (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id())
  with check (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id());


-- ============================================================================
--  VERIFICACION
-- ============================================================================
select 'tablas creadas' as revision,
       count(*)::text || ' de 3' as hallazgo
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('ramos','ramo_perfil','empresa_inventario_config')
union all
select 'columna ramo_id en empresas',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='empresas' and column_name='ramo_id')
            then 'si' else 'NO' end
union all
select 'ramos cargados', (select count(*)::text from public.ramos)
union all
select 'perfiles cargados', (select count(*)::text from public.ramo_perfil)
union all
select 'ramos sin perfil (debe ser 0)',
       (select count(*)::text from public.ramos r
         where not exists (select 1 from public.ramo_perfil p where p.ramo_id = r.id))
union all
select 'empresas existentes afectadas',
       'ninguna: quedan sin ramo y funcionan igual';

-- El catalogo, para revisarlo:
select r.familia, r.nombre,
       case when p.mod_comercial then 'com ' else '' end ||
       case when p.mod_manufactura then 'manu ' else '' end ||
       case when p.mod_servicios then 'serv' else '' end as modelos,
       p.lleva_inventario as inventario, p.metodo_costo as costo,
       p.vende_por_peso as peso, p.codigo_barras as barras,
       p.control_lotes as lotes, p.unidades_multiples as unidades,
       p.receta, p.listas_precio as listas
  from public.ramos r
  join public.ramo_perfil p on p.ramo_id = r.id
 order by r.orden;
