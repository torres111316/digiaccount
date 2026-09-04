-- =============================================================
-- MIGRACIÓN · LAS POLÍTICAS SE ATAN A LA EMPRESA, NO A LA CUENTA
--
-- Segunda parte de empresa_invitada_contador.sql. Correr AQUELLA primero:
-- esto necesita que existan `mis_empresas()` y `empresa_acceso`.
--
-- POR QUÉ ESTE ARCHIVO GENERA EN VEZ DE EJECUTAR
--
-- Reescribir la frontera de seguridad de veintiocho tablas es la clase de
-- cambio donde un error no da error: da que una cuenta vea los datos de
-- otra. Y las políticas de esta base tienen nombres propios que no están
-- en ningún archivo del repositorio.
--
-- Así que el PASO 2 no toca nada: LEE el catálogo real de Postgres y
-- ESCRIBE las instrucciones exactas, con los nombres verdaderos. Se leen,
-- se revisan, y recién entonces se ejecutan. Nadie —ni yo— reescribe a
-- ciegas una política que no ha visto.
--
-- POR QUÉ «alter policy» Y NO «drop + create»
-- ALTER POLICY cambia solo la condición: conserva el nombre, la operación
-- y los roles, y no deja ni un instante a la tabla sin política. Con drop
-- y create hay una ventana —corta, pero real— en que la tabla queda
-- abierta, y además habría que reconstruir a mano el cmd y los roles, que
-- es justo donde se cometen los errores.
-- =============================================================


-- =============================================================
-- PASO 1 · `empresas`: dejar VER las concedidas.
--
-- De las siete políticas de esta tabla solo se toca UNA, la de lectura:
--
--   empresas_delete             DELETE  cuenta_id = mi_cuenta_id()
--   empresas_insert             INSERT  cuenta_id = mi_cuenta_id()
--   empresas_mi_cuenta          SELECT  cuenta_id = mi_cuenta_id()   ← esta
--   empresas_update             UPDATE  cuenta_id = mi_cuenta_id()
--   empresas_modo_doc_fundador  UPDATE  soy_superadmin()
--   empresas_superadmin_all     ALL     soy_superadmin()
--   fundador_lee_empresas       SELECT  soy_superadmin()
--
-- DECISIÓN DELIBERADA: el invitado LEE pero no EDITA la empresa.
-- Puede trabajar sobre sus libros, sus asientos y su nómina, pero no
-- cambiarle el nombre, el RIF ni el domicilio fiscal. Esa es la identidad
-- de la empresa y le pertenece a ella. Si algún día estorba, es una sola
-- política la que hay que ampliar — y conviene que sea una decisión
-- consciente y no un descuido de hoy.
-- =============================================================

alter policy empresas_mi_cuenta on public.empresas
  using (cuenta_id = public.mi_cuenta_id()
         or id in (select public.mis_empresas()));


-- =============================================================
-- PASO 2 · GENERAR la migración de las tablas hijas.
--
-- No ejecuta nada. Devuelve las instrucciones para leerlas y correrlas.
--
-- Solo genera para las políticas cuya condición es EXACTAMENTE
-- «(cuenta_id = mi_cuenta_id())». Cualquier otra —una con condiciones
-- añadidas, una que ya mire la empresa— sale aparte en el PASO 3 para
-- mirarla a mano. Automatizar lo que no se entiende es como se rompen
-- estas cosas.
-- =============================================================

select p.tablename,
       p.policyname,
       p.cmd,
       'alter policy ' || quote_ident(p.policyname)
         || ' on public.' || quote_ident(p.tablename)
         || case when p.qual is not null
                 then E'\n  using (empresa_id in (select public.mis_empresas()))'
                 else '' end
         || case when p.with_check is not null
                 then E'\n  with check (empresa_id in (select public.mis_empresas()))'
                 else '' end
         || ';'                                            as instruccion
  from pg_policies p
 where p.schemaname = 'public'
   -- Solo tablas que TIENEN empresa_id: son las que pueden atarse a ella.
   and exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = p.tablename
        and c.column_name = 'empresa_id')
   -- Y solo el caso simple, el que se entiende sin interpretar nada.
   and (p.qual is null       or replace(replace(p.qual, ' ', ''), 'public.', '')       = '(cuenta_id=mi_cuenta_id())')
   and (p.with_check is null or replace(replace(p.with_check, ' ', ''), 'public.', '') = '(cuenta_id=mi_cuenta_id())')
   and coalesce(p.qual, p.with_check) is not null
 order by p.tablename, p.policyname;


-- =============================================================
-- PASO 3 · LO QUE NO SE GENERA, y hay que mirar con los ojos.
--
-- Políticas sobre tablas con empresa_id que NO encajan en el caso simple.
-- Pueden ser correctas tal como están —las de superadmin lo son— o pueden
-- necesitar un ajuste distinto. Ninguna se toca sin entenderla.
-- =============================================================

select p.tablename,
       p.policyname,
       p.cmd,
       p.qual       as condicion_lectura,
       p.with_check as condicion_escritura,
       case
         when coalesce(p.qual, '') like '%soy_superadmin%'
              and coalesce(p.qual, '') not like '%mi_cuenta_id%' then 'del fundador · dejar como está'
         when coalesce(p.qual, '') like '%mis_empresas%'          then 'ya migrada'
         else 'REVISAR A MANO'
       end          as veredicto
  from pg_policies p
 where p.schemaname = 'public'
   and exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = p.tablename
        and c.column_name = 'empresa_id')
   and not (
        (p.qual is null       or replace(replace(p.qual, ' ', ''), 'public.', '')       = '(cuenta_id=mi_cuenta_id())')
    and (p.with_check is null or replace(replace(p.with_check, ' ', ''), 'public.', '') = '(cuenta_id=mi_cuenta_id())')
    and coalesce(p.qual, p.with_check) is not null)
 order by veredicto, p.tablename, p.policyname;


-- =============================================================
-- PASO 4 · COMPROBAR. La 4.2 se corre DOS VECES: antes y después.
--
-- Escrita al principio como «después de ejecutar», que era un descuido:
-- sin las cifras de ANTES no hay contra qué comparar. Una prueba que solo
-- se corre después del cambio no prueba nada.
-- =============================================================

-- 4.1 · ¿Quedó alguna política de tabla con empresa_id todavía atada a la
--       cuenta? Debe devolver CERO filas (salvo las del fundador).
select p.tablename, p.policyname, p.cmd, p.qual
  from pg_policies p
 where p.schemaname = 'public'
   and exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = p.tablename
        and c.column_name = 'empresa_id')
   and coalesce(p.qual, '') like '%mi_cuenta_id%'
   and coalesce(p.qual, '') not like '%mis_empresas%'
 order by p.tablename;

-- 4.2 · LA PRUEBA QUE DE VERDAD IMPORTA · correr ANTES y DESPUÉS.
--
--       Conectado con tu usuario normal, y con la MISMA empresa activa.
--       Las cifras de después tienen que ser IDÉNTICAS a las de antes.
--
--         · Si alguna SUBE  -> estás viendo datos de otra cuenta. Revertir.
--         · Si alguna BAJA  -> perdiste acceso a lo tuyo. Revertir.
--
--       Anota las de antes antes de tocar nada. Es la red de seguridad
--       entera de esta migración: contar políticas no prueba nada, lo que
--       prueba es que sigas viendo exactamente lo mismo.
select 'empresas'    as tabla, count(*) from public.empresas
union all select 'libro_fiscal',  count(*) from public.libro_fiscal
union all select 'retenciones',   count(*) from public.retenciones
union all select 'asientos',      count(*) from public.asientos
union all select 'facturas',      count(*) from public.facturas
union all select 'productos',     count(*) from public.productos
union all select 'empleados',     count(*) from public.empleados;

-- 4.3 · CÓMO REVERTIR, si algo sale mal.
--       Es el mismo generador del PASO 2 al revés. Se guarda aquí para no
--       tener que escribirlo con prisa el día que haga falta.
--
-- select 'alter policy ' || quote_ident(policyname)
--          || ' on public.' || quote_ident(tablename)
--          || case when qual is not null
--                  then E'\n  using (cuenta_id = public.mi_cuenta_id())' else '' end
--          || case when with_check is not null
--                  then E'\n  with check (cuenta_id = public.mi_cuenta_id())' else '' end
--          || ';'
--   from pg_policies
--  where schemaname = 'public'
--    and coalesce(qual, '') like '%mis_empresas%'
--  order by tablename, policyname;
