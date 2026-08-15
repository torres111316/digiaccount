-- =============================================================
-- DAR DE ALTA LOS ESTABLECIMIENTOS DE GATMA
--
-- Se corre TAL CUAL, de una sola vez, en el SQL Editor de Supabase.
-- No hay que buscar ningún id ni reemplazar nada: la empresa se busca
-- sola por su RIF, y la casa matriz toma la dirección que ya tiene
-- cargada la empresa.
--
-- Correrlo dos veces no duplica nada ni da error.
--
-- Requiere haber corrido antes sucursales.sql (el que crea la tabla).
-- =============================================================

-- El RIF se compara sin guiones ni espacios, porque 'J-50282611-4' y
-- 'J501289670' son la misma cosa escrita distinto y no se sabe de antemano
-- en qué forma quedó guardado.
do $$
declare
  v_empresa uuid;
  v_nombre  text;
  v_dir     text;
  v_tel     text;
  v_creadas int;
begin
  select id, nombre, direccion, telefono
    into v_empresa, v_nombre, v_dir, v_tel
    from public.empresas
   where regexp_replace(upper(rif), '[^A-Z0-9]', '', 'g') = 'J502826114';

  -- Parar aquí y decirlo es mejor que insertar cero filas en silencio y
  -- que el cargador falle después sin que se entienda por qué.
  if v_empresa is null then
    raise exception 'No se encontró ninguna empresa con RIF J-50282611-4. ¿Está registrada en esta cuenta?';
  end if;

  insert into public.sucursales (empresa_id, nombre, codigo, direccion, telefono, es_matriz)
  values
    -- La matriz hereda la dirección y el teléfono de la empresa: son los suyos.
    (v_empresa, 'Casa Matriz', '01', v_dir, v_tel, true),
    -- Barquisimeto va sin dirección todavía. Va nula a propósito: escribir
    -- la de la matriz aquí sería copiar un dato falso, y esa dirección es
    -- la que se imprimiría en las facturas de esta sucursal.
    (v_empresa, 'Sucursal Barquisimeto', '02', null, null, false)
  on conflict do nothing;

  get diagnostics v_creadas = row_count;
  raise notice 'Empresa: %', v_nombre;
  raise notice 'Establecimientos creados ahora: % (0 significa que ya estaban)', v_creadas;
end $$;

-- Cómo quedó. Deben salir DOS filas: 01 Casa Matriz y 02 Barquisimeto.
select s.codigo,
       s.nombre,
       case when s.es_matriz then 'casa matriz' else 'sucursal' end as tipo,
       coalesce(s.direccion, '— falta —') as direccion
  from public.sucursales s
  join public.empresas e on e.id = s.empresa_id
 where regexp_replace(upper(e.rif), '[^A-Z0-9]', '', 'g') = 'J502826114'
 order by s.codigo;

-- -------------------------------------------------------------
-- CUANDO TENGAS LA DIRECCIÓN DE BARQUISIMETO
--
--   update public.sucursales s
--      set direccion = 'la dirección que sea',
--          telefono  = 'el teléfono'
--     from public.empresas e
--    where e.id = s.empresa_id
--      and regexp_replace(upper(e.rif), '[^A-Z0-9]', '', 'g') = 'J502826114'
--      and s.codigo = '02';
--
-- No hace falta para cargar los libros. Hace falta el día que se emita
-- una factura desde esa sucursal.
-- -------------------------------------------------------------
