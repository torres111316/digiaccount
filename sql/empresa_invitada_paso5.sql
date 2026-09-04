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
--
-- RESULTADO (30/08/2026): quince tablas en cero y UNA no —
-- `eventos_sistema`, con 10 filas sin empresa. No eran un descuido: son
-- eventos de la CUENTA. Su política se trató aparte, más abajo. Esta
-- comprobación se escribió por si acaso y encontró algo al primer intento.
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

/* eventos_sistema · EL CASO ESPECIAL, y el que justifica el paso 5.0.

   Tiene 10 filas con empresa_id NULO, y no son un descuido: un registro de
   eventos guarda también lo que le pasa a la CUENTA —un inicio de sesión,
   un cambio de plan, un usuario invitado— que no pertenece a ninguna
   empresa en particular.

   Atarlo solo a la empresa las habría vuelto invisibles para todos,
   incluido su propio dueño. Así que la política distingue:

     · el evento CON empresa  -> lo ve quien pueda ver esa empresa
     · el evento SIN empresa  -> es de la cuenta, y lo ve solo su cuenta

   Un contador invitado ve lo que pasó en la empresa de su cliente, pero no
   los movimientos internos de la cuenta del cliente. Que es lo correcto. */
alter policy eventos_ver on public.eventos_sistema
  using (soy_superadmin()
         or (empresa_id is not null and empresa_id in (select public.mis_empresas()))
         or (empresa_id is null     and cuenta_id  = public.mi_cuenta_id()));

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


-- =============================================================
-- PASO 5.0.c · EL CABO SUELTO.
--
-- El 5.0.b confirmó que no hay agujero: las once tablas tienen RLS activa
-- y políticas de usuario. Pero destapó otra cosa.
--
-- `libro_fiscal` tiene CINCO políticas, CUATRO de usuario. En el PASO 3
-- apareció UNA, la del fundador. Y el PASO 2 devolvió cero filas. Esas
-- cuatro no salieron en NINGUNA de las dos listas, y entre ambas deberían
-- cubrirlo todo: la 3 es literalmente el complemento de la 2.
--
-- O sea: mi consulta las deja fuera por alguna razón que no veo. Y sin
-- migrarlas, el contador invitado no vería el libro del cliente — que es
-- justo para lo que existe todo esto.
--
-- Esto pregunta directo, sin filtros ni interpretación. Es lo que había
-- que hacer desde el principio para estas tablas.
-- =============================================================

select tablename, policyname, cmd, permissive, roles,
       qual       as condicion_lectura,
       with_check as condicion_escritura
  from pg_policies
 where schemaname = 'public'
   and tablename in ('libro_fiscal', 'productos', 'retenciones', 'asientos',
                     'terceros', 'activos_fijos', 'criptoactivos',
                     'cuentas_contables', 'cuentas_tesoreria',
                     'documentos_fiscales', 'movimientos_tesoreria')
 order by tablename, policyname;


-- =============================================================
-- PASO 6 · LAS DIEZ TABLAS QUE FALTABAN, del diagnóstico 5.0.c
--
-- Son las que un contador usa todos los días: el libro fiscal, las
-- retenciones, los asientos, la tesorería. Sus políticas resultaron ser el
-- caso simple —«(cuenta_id = mi_cuenta_id())»— repartido en cuatro por
-- tabla: una por operación.
--
-- Aquí está la diferencia con las del PASO 5: aquellas eran políticas ALL
-- con el escape del fundador dentro. Estas son cuatro políticas separadas,
-- y el fundador tiene la SUYA aparte (af_superadmin_all, lf_superadmin_all
-- y compañía), que no se toca. Por eso estas NO llevan soy_superadmin():
-- agregárselo sería duplicar un permiso que ya existe por otra vía.
--
-- Y cada una lleva solo la cláusula que le corresponde:
--   SELECT y DELETE -> using
--   INSERT          -> with check
--   UPDATE          -> las dos
--
-- CORRER SOLO DESPUÉS DEL PASO 6.0.
-- =============================================================


-- =============================================================
-- PASO 6.0 · LA MISMA TRAMPA, para estas diez tablas.
--
-- El 5.0 no las cubría. Y de una ya sabemos que tiene filas huérfanas:
-- `productos`, con los artículos sin empresa que aparecieron al separar el
-- catálogo. Si quedan, desaparecen al migrar.
--
-- TODAS DEBEN DAR CERO.
-- =============================================================

select 'activos_fijos'     as tabla, count(*) as sin_empresa from public.activos_fijos     where empresa_id is null
union all select 'asientos',              count(*) from public.asientos              where empresa_id is null
union all select 'criptoactivos',         count(*) from public.criptoactivos         where empresa_id is null
union all select 'cuentas_contables',     count(*) from public.cuentas_contables     where empresa_id is null
union all select 'cuentas_tesoreria',     count(*) from public.cuentas_tesoreria     where empresa_id is null
union all select 'documentos_fiscales',   count(*) from public.documentos_fiscales   where empresa_id is null
union all select 'libro_fiscal',          count(*) from public.libro_fiscal          where empresa_id is null
union all select 'movimientos_tesoreria', count(*) from public.movimientos_tesoreria where empresa_id is null
union all select 'productos',             count(*) from public.productos             where empresa_id is null
union all select 'retenciones',           count(*) from public.retenciones           where empresa_id is null
order by sin_empresa desc, tabla;


-- =============================================================
-- PASO 6.1 · LOS CUARENTA CAMBIOS.
-- =============================================================


-- activos_fijos
alter policy af_select on public.activos_fijos
  using (empresa_id in (select public.mis_empresas()));
alter policy af_insert on public.activos_fijos
  with check (empresa_id in (select public.mis_empresas()));
alter policy af_update on public.activos_fijos
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy af_delete on public.activos_fijos
  using (empresa_id in (select public.mis_empresas()));

-- asientos
alter policy asientos_select on public.asientos
  using (empresa_id in (select public.mis_empresas()));
alter policy asientos_insert on public.asientos
  with check (empresa_id in (select public.mis_empresas()));
alter policy asientos_update on public.asientos
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy asientos_delete on public.asientos
  using (empresa_id in (select public.mis_empresas()));

-- criptoactivos
alter policy cx_select on public.criptoactivos
  using (empresa_id in (select public.mis_empresas()));
alter policy cx_insert on public.criptoactivos
  with check (empresa_id in (select public.mis_empresas()));
alter policy cx_update on public.criptoactivos
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy cx_delete on public.criptoactivos
  using (empresa_id in (select public.mis_empresas()));

-- cuentas_contables
alter policy cc_select on public.cuentas_contables
  using (empresa_id in (select public.mis_empresas()));
alter policy cc_insert on public.cuentas_contables
  with check (empresa_id in (select public.mis_empresas()));
alter policy cc_update on public.cuentas_contables
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy cc_delete on public.cuentas_contables
  using (empresa_id in (select public.mis_empresas()));

-- cuentas_tesoreria
alter policy ct_sel on public.cuentas_tesoreria
  using (empresa_id in (select public.mis_empresas()));
alter policy ct_ins on public.cuentas_tesoreria
  with check (empresa_id in (select public.mis_empresas()));
alter policy ct_upd on public.cuentas_tesoreria
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy ct_del on public.cuentas_tesoreria
  using (empresa_id in (select public.mis_empresas()));

-- documentos_fiscales
alter policy df_sel on public.documentos_fiscales
  using (empresa_id in (select public.mis_empresas()));
alter policy df_ins on public.documentos_fiscales
  with check (empresa_id in (select public.mis_empresas()));
alter policy df_del on public.documentos_fiscales
  using (empresa_id in (select public.mis_empresas()));

-- libro_fiscal
alter policy lf_select on public.libro_fiscal
  using (empresa_id in (select public.mis_empresas()));
alter policy lf_insert on public.libro_fiscal
  with check (empresa_id in (select public.mis_empresas()));
alter policy lf_update on public.libro_fiscal
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy lf_delete on public.libro_fiscal
  using (empresa_id in (select public.mis_empresas()));

-- movimientos_tesoreria
alter policy mt_sel on public.movimientos_tesoreria
  using (empresa_id in (select public.mis_empresas()));
alter policy mt_ins on public.movimientos_tesoreria
  with check (empresa_id in (select public.mis_empresas()));
alter policy mt_upd on public.movimientos_tesoreria
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy mt_del on public.movimientos_tesoreria
  using (empresa_id in (select public.mis_empresas()));

-- productos
alter policy productos_select on public.productos
  using (empresa_id in (select public.mis_empresas()));
alter policy productos_insert on public.productos
  with check (empresa_id in (select public.mis_empresas()));
alter policy productos_update on public.productos
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy productos_delete on public.productos
  using (empresa_id in (select public.mis_empresas()));

-- retenciones
alter policy ret_select on public.retenciones
  using (empresa_id in (select public.mis_empresas()));
alter policy ret_insert on public.retenciones
  with check (empresa_id in (select public.mis_empresas()));
alter policy ret_update on public.retenciones
  using (empresa_id in (select public.mis_empresas()))
  with check (empresa_id in (select public.mis_empresas()));
alter policy ret_delete on public.retenciones
  using (empresa_id in (select public.mis_empresas()));


-- =============================================================
-- `terceros` NO ESTÁ AQUÍ, y es a propósito.
--
-- Sus cinco políticas tienen la misma forma, pero la tabla NO TIENE
-- empresa_id: el directorio es de la cuenta. Migrarla es imposible sin
-- agregarle antes esa columna, y eso todavía es una decisión de producto
-- pendiente —¿los terceros se copian al traspasar la empresa, o se
-- comparten como hoy?— que está anotada en empresa_invitada_contador.sql.
--
-- Mientras no se decida, el contador invitado usará SU propio directorio
-- al trabajar sobre la empresa del cliente. Funciona, pero conviene saber
-- que es así y no un olvido.
-- =============================================================


-- =============================================================
-- PASO 6.2 · COMPROBAR
-- =============================================================

-- a) Que no quede ninguna atada a la cuenta, salvo las de usuario_empresa
--    y las de terceros, que se quedan a propósito.
select p.tablename, p.policyname, p.cmd
  from pg_policies p
 where p.schemaname = 'public'
   and exists (select 1 from information_schema.columns c
                where c.table_schema = 'public' and c.table_name = p.tablename
                  and c.column_name = 'empresa_id')
   and coalesce(p.qual, p.with_check, '') like '%mi_cuenta_id%'
   and coalesce(p.qual, p.with_check, '') not like '%mis_empresas%'
 order by p.tablename, p.policyname;

-- b) Y otra vez el 4.2.b: hacerse pasar por tu usuario y comparar contra
--    las cifras de antes. IDÉNTICAS.


-- =============================================================
-- PASO 6.0.b · EL ÚNICO HUÉRFANO. Resolverlo ANTES del 6.1.
--
-- Resultado del 6.0 (30/08/2026): nueve tablas en cero y `productos` con
-- UNA fila sin empresa — el artículo de prueba que apareció al separar el
-- catálogo por empresa. libro_fiscal, con sus 2.338 renglones, limpio.
--
-- Si se migra sin resolverlo, ese artículo deja de verse para todos. No es
-- grave siendo una prueba, pero el hábito de migrar dejando filas atrás sí
-- lo es: la próxima vez pueden ser doscientas y de un cliente.
--
-- DESDE LA APLICACIÓN es más simple: Inventario ya muestra el aviso de los
-- artículos sin empresa, con el botón para traerlos o para borrarlos. Esto
-- es la alternativa por si se prefiere resolverlo aquí.
-- =============================================================

-- Ver cuál es, antes de decidir:
select id, nombre, sku, stock, costo, precio, cuenta_id
  from public.productos
 where empresa_id is null;

-- OPCIÓN A · era una prueba y se borra:
-- delete from public.productos where empresa_id is null;

-- OPCIÓN B · asignarlo a una empresa. Primero ver los ids:
-- select id, nombre from public.empresas order by nombre;
-- update public.productos set empresa_id = 'PEGA-AQUI-EL-ID-DE-LA-EMPRESA'
--  where empresa_id is null;

-- Y comprobar que quedó en cero antes de seguir:
-- select count(*) as sin_empresa from public.productos where empresa_id is null;
