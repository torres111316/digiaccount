-- =============================================================
-- LA EMPRESA ES LA DUEÑA, EL CONTADOR ES INVITADO
--
-- EL PROBLEMA
-- `empresas` tiene UNA sola columna `cuenta_id`. Una empresa pertenece a
-- una cuenta y punto. El día que un cliente abre su propia cuenta para
-- facturar, el contador la pierde: no hay forma de que la misma empresa se
-- vea desde dos cuentas.
--
-- `usuario_empresa` no resuelve esto: limita el acceso DENTRO de una
-- cuenta, no lo cruza entre cuentas.
--
-- EL MODELO
--   · La empresa pasa a ser dueña de su información.
--   · Le CONCEDE acceso a la cuenta de su contador, y se lo puede revocar.
--   · El contador mantiene UN solo acceso y ve las empresas concedidas
--     junto a las suyas, en el mismo selector.
--
-- Esto es además lo que hace que el Programa de Socios funcione: el
-- contador trae al cliente, el cliente paga su propia cuenta, y el
-- contador sigue trabajando adentro.
--
-- ─────────────────────────────────────────────────────────────
-- ESTE ARCHIVO SOLO TRAE LO QUE SE PUEDE HACER SIN RIESGO.
--
-- La migración de las políticas de seguridad NO va aquí, y es a propósito.
-- La cabecera de auditoria_rls.sql advierte que las políticas REALES de la
-- base se llaman distinto de las de ese archivo —`<tabla>_rw`,
-- `<tabla>_select`— y que ese archivo es solo referencia.
--
-- Reescribir a ciegas la frontera de seguridad de veinte tablas, sobre
-- nombres que uno supone, es la peor idea posible: un error ahí no da
-- error, da que una cuenta vea los datos de otra. Por eso la PARTE 1 es un
-- diagnóstico que hay que correr y leer ANTES de tocar nada.
--
-- Idempotente. No borra ni modifica ningún dato.
-- =============================================================


-- =============================================================
-- PARTE 1 · DIAGNÓSTICO (solo lectura). CORRER Y GUARDAR EL RESULTADO.
-- =============================================================

-- 1.1 · Las políticas que HAY, con su condición real.
--       De aquí sale la lista exacta de lo que habrá que migrar.
select tablename            as tabla,
       policyname           as politica,
       cmd                  as operacion,
       qual                 as condicion_lectura,
       with_check           as condicion_escritura
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;

-- 1.2 · Cuáles se atan a la CUENTA y cuáles a la EMPRESA.
--       Las que se atan a la cuenta son las que se rompen al traspasar:
--       las filas hijas seguirían apuntando a la cuenta vieja.
select tablename as tabla,
       count(*) filter (where coalesce(qual, '') like '%mi_cuenta_id%'
                          and coalesce(qual, '') not like '%empresas%') as por_cuenta,
       count(*) filter (where coalesce(qual, '') like '%empresas%')     as por_empresa,
       count(*)                                                        as politicas
  from pg_policies
 where schemaname = 'public'
 group by tablename
 order by por_cuenta desc, tabla;

-- 1.3 · Qué tablas tienen columna empresa_id (las que PUEDEN migrarse a
--       llavearse por empresa) y cuáles solo tienen cuenta_id.
select c.table_name as tabla,
       bool_or(c.column_name = 'empresa_id') as tiene_empresa_id,
       bool_or(c.column_name = 'cuenta_id')  as tiene_cuenta_id
  from information_schema.columns c
  join pg_class t on t.relname = c.table_name
  join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
 where c.table_schema = 'public' and t.relkind = 'r'
 group by c.table_name
 having bool_or(c.column_name in ('empresa_id', 'cuenta_id'))
 order by tiene_empresa_id desc, tabla;


-- =============================================================
-- PARTE 2 · LA BASE. Esto SÍ se puede correr ya: solo AGREGA.
-- =============================================================

-- 2.1 · Quién tiene acceso a qué empresa, desde otra cuenta.
create table if not exists public.empresa_acceso (
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  -- La cuenta INVITADA. Normalmente la del contador.
  cuenta_id    uuid not null references public.cuentas(id)  on delete cascade,
  rol          text not null default 'contador',
  -- Quién concedió el acceso, para poder responder «¿y esto quién lo dio?».
  otorgado_por uuid,
  creado_en    timestamptz not null default now(),
  primary key (empresa_id, cuenta_id)
);

comment on table public.empresa_acceso is
  'Acceso CRUZADO entre cuentas: la empresa dueña le concede a otra cuenta '
  '(la del contador) trabajar sobre ella. La empresa manda: puede revocarlo. '
  'No confundir con usuario_empresa, que limita el acceso DENTRO de una cuenta.';

alter table public.empresa_acceso drop constraint if exists empresa_acceso_rol_chk;
alter table public.empresa_acceso
  add constraint empresa_acceso_rol_chk check (rol in ('contador', 'lectura'));

create index if not exists empresa_acceso_cuenta_idx on public.empresa_acceso (cuenta_id);


-- 2.2 · ¿Soy el dueño de esta empresa?
--       SECURITY DEFINER para que no dispare la RLS de `empresas` y se
--       muerda la cola cuando la use la política de empresa_acceso.
create or replace function public.soy_dueno_de(p_empresa uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.empresas
     where id = p_empresa and cuenta_id = public.mi_cuenta_id()
  );
$$;


-- 2.3 · LA PIEZA CENTRAL: las empresas que puedo ver.
--
--       Las mías, más las que me concedieron. Toda la seguridad por empresa
--       va a pasar por aquí, en UN solo sitio. Si mañana aparece otra forma
--       de conceder acceso, se agrega aquí y no en veinte políticas.
create or replace function public.mis_empresas()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.empresas where cuenta_id = public.mi_cuenta_id()
  union
  select empresa_id from public.empresa_acceso where cuenta_id = public.mi_cuenta_id();
$$;

comment on function public.mis_empresas() is
  'Las empresas que la cuenta conectada puede ver: las propias más las '
  'concedidas por otras cuentas. Es el único sitio donde vive esa regla.';


-- 2.4 · La seguridad de la propia tabla de accesos.
--       VER: el dueño de la empresa y la cuenta invitada.
--       CREAR o REVOCAR: SOLO el dueño. El invitado no se auto-invita.
alter table public.empresa_acceso enable row level security;

drop policy if exists empresa_acceso_ver on public.empresa_acceso;
create policy empresa_acceso_ver on public.empresa_acceso for select
  using (public.soy_dueno_de(empresa_id)
         or cuenta_id = public.mi_cuenta_id()
         or public.soy_superadmin());

drop policy if exists empresa_acceso_dueno on public.empresa_acceso;
create policy empresa_acceso_dueno on public.empresa_acceso for all
  using (public.soy_dueno_de(empresa_id) or public.soy_superadmin())
  with check (public.soy_dueno_de(empresa_id) or public.soy_superadmin());


-- =============================================================
-- PARTE 3 · LO QUE FALTA, Y QUE NO SE ESCRIBE HASTA VER LA PARTE 1
--
-- a) La política de `empresas` tiene que dejar ver también las concedidas.
--    Hoy: (cuenta_id = mi_cuenta_id() or soy_superadmin())
--    Debe pasar a: (... or id in (select public.mis_empresas()))
--    Sin esto, el contador tendría acceso a los DATOS de la empresa pero no
--    podría ver la empresa en su selector. Hay que hacerlo con el NOMBRE
--    REAL de la política, que sale del diagnóstico.
--
-- b) Las tablas hijas con empresa_id (libro_fiscal, retenciones, asientos,
--    facturas, productos, empleados…) tienen que llavearse por EMPRESA y no
--    por cuenta:
--        de:  cuenta_id = mi_cuenta_id()
--        a:   empresa_id in (select public.mis_empresas())
--
--    Es el cambio de fondo. Hoy esas filas guardan también el cuenta_id, y
--    ESE dato se vuelve mentira en el momento en que la empresa cambia de
--    dueño: sus asientos y sus libros seguirían apuntando a la cuenta vieja.
--    Atarlas a la empresa convierte el traspaso en una sola fila en vez de
--    una migración de datos con todo lo que puede salir mal.
--
-- c) El traspaso en sí (cambiar empresas.cuenta_id y crear la concesión de
--    vuelta) NO se habilita hasta que (a) y (b) estén hechos y verificados.
--    Traspasar antes dejaría al contador sin acceso a los datos hijos —el
--    daño exacto que esta función existe para evitar.
-- =============================================================


-- =============================================================
-- PARTE 4 · COMPROBACIÓN de lo que sí quedó instalado.
-- =============================================================

-- ¿Existen la tabla y las funciones?
select 'empresa_acceso' as objeto,
       to_regclass('public.empresa_acceso') is not null as existe
union all
select 'mis_empresas()', to_regprocedure('public.mis_empresas()') is not null
union all
select 'soy_dueno_de(uuid)', to_regprocedure('public.soy_dueno_de(uuid)') is not null;

-- ¿Qué devuelve mis_empresas() para el usuario conectado?
-- Debe listar exactamente tus empresas de siempre (todavía no hay concesiones).
select e.nombre, e.rif
  from public.empresas e
 where e.id in (select public.mis_empresas())
 order by e.nombre;

-- Y las concesiones que existan (al principio, ninguna):
select e.nombre as empresa, c.nombre as cuenta_invitada, a.rol, a.creado_en
  from public.empresa_acceso a
  join public.empresas e on e.id = a.empresa_id
  join public.cuentas  c on c.id = a.cuenta_id
 order by e.nombre;
