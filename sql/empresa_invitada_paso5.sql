-- =============================================================
-- PASO 5 · LA MIGRACIÓN, ESCRITA CONTRA LO QUE HAY DE VERDAD
--
-- Sale del diagnóstico del PASO 3, que devolvió 36 políticas sobre las
-- tablas con empresa_id. Doce son del fundador y no se tocan. Las otras
-- veinticuatro se reparten así:
--
--   17 se migran (abajo, una por una y con su nombre real)
--    7 se quedan — usuario_empresa y empresa_acceso, explicado al final
--
-- NO SE CORRE NADA HASTA PASAR EL PASO 5.0. Ahí está la trampa que puede
-- hacer desaparecer datos sin ruido.
-- =============================================================


-- =============================================================
-- PASO 5.0 · LA TRAMPA. Correr esto PRIMERO y leer el resultado.
--
-- Las políticas pasan de mirar `cuenta_id` a mirar `empresa_id`. Toda fila
-- que tenga empresa_id NULO deja de ser visible para todo el mundo — no da
-- error, no avisa: simplemente desaparece de la pantalla.
--
-- Ya sabemos que pasa de verdad: en `productos` había artículos sin
-- empresa (el Glifosan de la prueba). Si en alguna de estas tablas hay
-- filas huérfanas, hay que asignarlas ANTES de migrar, no después.
--
-- TODAS LAS CIFRAS DEBEN DAR CERO. La que no dé cero, se resuelve primero.
-- =============================================================

select 'apertura'                  as tabla, count(*) as sin_empresa from public.apertura                  where empresa_id is null
union all select 'apertura_partidas',         count(*) from public.apertura_partidas         where empresa_id is null
union all select 'cierres_mensuales',         count(*) from public.cierres_mensuales         where empresa_id is null
union all select 'claves_consulta',           count(*) from public.claves_consulta           where empresa_id is null
union all select 'consultas_seniat',          count(*) from public.consultas_seniat          where empresa_id is null
union all select 'declaraciones',             count(*) from public.declaraciones             where empresa_id is null
union all select 'documentos_empleado',       count(*) from public.documentos_empleado       where empresa_id is null
union all select 'empleados',                 count(*) from public.empleados                 where empresa_id is null
union all select 'empresa_firma',             count(*) from public.empresa_firma             where empresa_id is null
union all select 'empresa_inventario_config', count(*) from public.empresa_inventario_config where empresa_id is null
union all select 'eventos_sistema',           count(*) from public.eventos_sistema           where empresa_id is null
union all select 'facturas',                  count(*) from public.facturas                  where empresa_id is null
union all select 'guias_despacho',            count(*) from public.guias_despacho            where empresa_id is null
union all select 'novedades_nomina',          count(*) from public.novedades_nomina          where empresa_id is null
union all select 'recibos_nomina',            count(*) from public.recibos_nomina            where empresa_id is null
union all select 'sucursales',                count(*) from public.sucursales                where empresa_id is null
order by sin_empresa desc, tabla;


-- =============================================================
-- PASO 5.0.b · EL HUECO QUE APARECIÓ SOLO.
--
-- En el diagnóstico, `productos` y `libro_fiscal` salieron SOLO con su
-- política de fundador. No aparecieron ni en el PASO 2 ni entre las de
-- «revisar»: no tienen política de inquilino en esa lista.
--
-- Eso deja dos posibilidades y las dos hay que mirarlas:
--   · la tabla tiene RLS activo y ninguna política para el usuario normal
--     -> nadie vería nada, y la aplicación sí ve. Algo no cuadra.
--   · la tabla tiene RLS APAGADO -> está expuesta: cualquiera con la clave
--     pública la lee entera, de todas las cuentas.
--
-- La segunda sería grave y no tiene nada que ver con esta migración: sería
-- un agujero que ya existe. Por eso se comprueba ahora.
-- =============================================================

select c.relname                                    as tabla,
       c.relrowsecurity                             as rls_activa,
       count(p.policyname)                          as politicas,
       count(p.policyname) filter (
         where coalesce(p.qual, '') not like '%soy_superadmin%'
            or coalesce(p.qual, '') like '%cuenta%'
            or coalesce(p.qual, '') like '%empresa%')  as politicas_de_usuario
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
 where c.relkind = 'r'
   and c.relname in ('productos', 'libro_fiscal', 'retenciones', 'asientos',
                     'terceros', 'activos_fijos', 'criptoactivos',
                     'cuentas_contables', 'cuentas_tesoreria',
                     'documentos_fiscales', 'movimientos_tesoreria')
 group by c.relname, c.relrowsecurity
 order by rls_activa, politicas_de_usuario, tabla;


-- =============================================================
-- PASO 5.1 · LAS QUE PASAN DE `cuenta_id` A `empresa_id`.
--
-- Trece políticas cuya condición era «(cuenta_id = mi_cuenta_id()) OR
-- soy_superadmin()», en un orden o en el otro. Se conserva el escape del
-- fundador tal cual estaba.
--
-- CORRER SOLO SI EL PASO 5.0 DIO TODO CERO.
-- =============================================================

alter policy apertura_todo on public.apertura
  using       (soy_superadmin() or empresa_id in (select public.mis_empresas()))
  with check  (soy_superadmin() or empresa_id in (select public.mis_empresas()));

alter policy partidas_todo on public.apertura_partidas
  using       (soy_superadmin() or empresa_id in (select public.mis_empresas()))
  with check  (soy_superadmin() or empresa_id in (select public.mis_empresas()));

alter policy cierres_select on public.cierres_mensuales
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy docsemp_select on public.documentos_empleado
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy empleados_rw on public.empleados
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin())
  with check  (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy firma_todo on public.empresa_firma
  using       (soy_superadmin() or empresa_id in (select public.mis_empresas()))
  with check  (soy_superadmin() or empresa_id in (select public.mis_empresas()));

alter policy cfg_escritura on public.empresa_inventario_config
  using       (soy_superadmin() or empresa_id in (select public.mis_empresas()))
  with check  (soy_superadmin() or empresa_id in (select public.mis_empresas()));

alter policy cfg_lectura on public.empresa_inventario_config
  using       (soy_superadmin() or empresa_id in (select public.mis_empresas()));

alter policy eventos_ver on public.eventos_sistema
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy facturas_rw on public.facturas
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin())
  with check  (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy tenant_guias on public.guias_despacho
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin())
  with check  (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy novedades_rw on public.novedades_nomina
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin())
  with check  (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy recibos_nomina_rw on public.recibos_nomina
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin())
  with check  (empresa_id in (select public.mis_empresas()) or soy_superadmin());


-- =============================================================
-- PASO 5.2 · LAS QUE YA MIRABAN LA EMPRESA, pero por el camino viejo.
--
-- Estas cuatro ya se ataban a `empresa_id`, solo que resolvían la lista
-- preguntando «¿de qué empresas soy dueño?». Por eso seguirían dejando
-- fuera las concedidas. Pasan a usar la función, que es el único sitio
-- donde vive esa regla.
-- =============================================================

alter policy tenant_declaraciones on public.declaraciones
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin())
  with check  (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy tenant_sucursales on public.sucursales
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin())
  with check  (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy claves_ver on public.claves_consulta
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin());

alter policy consultas_ver on public.consultas_seniat
  using       (empresa_id in (select public.mis_empresas()) or soy_superadmin());


-- =============================================================
-- LO QUE NO SE MIGRA, Y POR QUÉ
--
-- usuario_empresa (6 políticas) · se queda como está.
--   Dice qué usuarios DE UNA CUENTA entran a qué empresa de esa cuenta.
--   Es distinto de conceder acceso a otra cuenta, que es lo que hace
--   empresa_acceso. Migrarla dejaría que el contador invitado asigne a SUS
--   empleados dentro de la empresa del cliente, y eso es una delegación
--   que nadie ha pedido. Si mañana hace falta —la asistente del contador
--   también trabaja ese cliente— se decide entonces, a propósito.
--
-- empresa_acceso (2 políticas) · ya nacieron bien, en el archivo anterior.
--
-- Las 12 del fundador · son solo soy_superadmin() y no tienen nada que
--   migrar.
-- =============================================================


-- =============================================================
-- PASO 5.3 · COMPROBAR. En este orden.
-- =============================================================

-- a) ¿Quedó alguna atada a la cuenta que debiera haber cambiado?
--    Solo deberían salir las de usuario_empresa, a propósito.
select p.tablename, p.policyname, p.cmd
  from pg_policies p
 where p.schemaname = 'public'
   and exists (select 1 from information_schema.columns c
                where c.table_schema = 'public' and c.table_name = p.tablename
                  and c.column_name = 'empresa_id')
   and coalesce(p.qual, '') like '%mi_cuenta_id%'
   and coalesce(p.qual, '') not like '%mis_empresas%'
 order by p.tablename;

-- b) Y la prueba de verdad: volver a correr el 4.2.b del archivo anterior
--    —el que se hace pasar por tu usuario— y comparar contra las cifras de
--    antes. IDÉNTICAS. Ni una más, ni una menos.
--
--    Si sube: se ven datos de otra cuenta.  Si baja: se perdió acceso.
--    Las dos se revierten con el 4.3.
