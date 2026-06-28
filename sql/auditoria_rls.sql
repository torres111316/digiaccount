-- ============================================================================
--  DigiAccount · AUDITORÍA DE SEGURIDAD RLS (Row Level Security)
--  Objetivo: que cada cuenta/empresa vea SOLO sus datos, y el fundador todo.
--  Seguro de correr varias veces (idempotente).
--  Ejecutar en: Supabase → SQL Editor
-- ============================================================================


-- ----------------------------------------------------------------------------
--  PASO 0 · DIAGNÓSTICO (solo lectura): ¿qué tablas NO tienen RLS activo?
--  Si alguna tabla de datos aparece con rls_activo = false, está EXPUESTA.
-- ----------------------------------------------------------------------------
select c.relname as tabla,
       c.relrowsecurity as rls_activo,
       count(p.policyname) as num_politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by rls_activo asc, tabla;


-- ----------------------------------------------------------------------------
--  PASO 1 · FUNCIONES HELPER (la base de toda la seguridad)
--  SECURITY DEFINER => leen sin disparar RLS (evita recursión).
-- ----------------------------------------------------------------------------

-- cuenta_id del usuario conectado (desde su perfil)
create or replace function public.mi_cuenta_id()
returns uuid language sql stable security definer set search_path = public as $$
  select cuenta_id from public.perfiles where id = auth.uid();
$$;

-- ¿es el fundador / super-admin?
create or replace function public.soy_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    lower((select email from auth.users where id = auth.uid())) = 'gerencia@digiaccount.io',
    false
  );
$$;


-- ----------------------------------------------------------------------------
--  PASO 2 · TABLAS RAÍZ (cuentas y perfiles)
-- ----------------------------------------------------------------------------

-- cuentas: cada quien ve SU cuenta; el fundador ve todas.
alter table public.cuentas enable row level security;
drop policy if exists "tenant_cuentas" on public.cuentas;
create policy "tenant_cuentas" on public.cuentas for all
  using (id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (id = public.mi_cuenta_id() or public.soy_superadmin());

-- perfiles: ves tu propio perfil + los usuarios de tu cuenta; el fundador todos.
alter table public.perfiles enable row level security;
drop policy if exists "tenant_perfiles" on public.perfiles;
create policy "tenant_perfiles" on public.perfiles for all
  using (id = auth.uid() or cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (id = auth.uid() or cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());


-- ----------------------------------------------------------------------------
--  PASO 3 · TABLAS POR CUENTA (tienen columna cuenta_id)
-- ----------------------------------------------------------------------------

alter table public.empresas enable row level security;
drop policy if exists "tenant_empresas" on public.empresas;
create policy "tenant_empresas" on public.empresas for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

alter table public.productos enable row level security;
drop policy if exists "tenant_productos" on public.productos;
create policy "tenant_productos" on public.productos for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

alter table public.terceros enable row level security;
drop policy if exists "tenant_terceros" on public.terceros;
create policy "tenant_terceros" on public.terceros for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

alter table public.parametros_nomina enable row level security;
drop policy if exists "tenant_parametros_nomina" on public.parametros_nomina;
create policy "tenant_parametros_nomina" on public.parametros_nomina for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

alter table public.cuentas_tesoreria enable row level security;
drop policy if exists "tenant_cuentas_tesoreria" on public.cuentas_tesoreria;
create policy "tenant_cuentas_tesoreria" on public.cuentas_tesoreria for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

alter table public.empleados enable row level security;
drop policy if exists "tenant_empleados" on public.empleados;
create policy "tenant_empleados" on public.empleados for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

alter table public.recibos_nomina enable row level security;
drop policy if exists "tenant_recibos_nomina" on public.recibos_nomina;
create policy "tenant_recibos_nomina" on public.recibos_nomina for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

alter table public.facturas enable row level security;
drop policy if exists "tenant_facturas" on public.facturas;
create policy "tenant_facturas" on public.facturas for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());


-- ----------------------------------------------------------------------------
--  PASO 4 · TABLAS POR EMPRESA (tienen empresa_id; la empresa debe ser de tu cuenta)
-- ----------------------------------------------------------------------------

alter table public.libro_fiscal enable row level security;
drop policy if exists "tenant_libro_fiscal" on public.libro_fiscal;
create policy "tenant_libro_fiscal" on public.libro_fiscal for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.movimientos_tesoreria enable row level security;
drop policy if exists "tenant_movimientos_tesoreria" on public.movimientos_tesoreria;
create policy "tenant_movimientos_tesoreria" on public.movimientos_tesoreria for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.retenciones enable row level security;
drop policy if exists "tenant_retenciones" on public.retenciones;
create policy "tenant_retenciones" on public.retenciones for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.asientos enable row level security;
drop policy if exists "tenant_asientos" on public.asientos;
create policy "tenant_asientos" on public.asientos for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.documentos_fiscales enable row level security;
drop policy if exists "tenant_documentos_fiscales" on public.documentos_fiscales;
create policy "tenant_documentos_fiscales" on public.documentos_fiscales for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.criptoactivos enable row level security;
drop policy if exists "tenant_criptoactivos" on public.criptoactivos;
create policy "tenant_criptoactivos" on public.criptoactivos for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.activos_fijos enable row level security;
drop policy if exists "tenant_activos_fijos" on public.activos_fijos;
create policy "tenant_activos_fijos" on public.activos_fijos for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.novedades_nomina enable row level security;
drop policy if exists "tenant_novedades_nomina" on public.novedades_nomina;
create policy "tenant_novedades_nomina" on public.novedades_nomina for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.cuentas_contables enable row level security;
drop policy if exists "tenant_cuentas_contables" on public.cuentas_contables;
create policy "tenant_cuentas_contables" on public.cuentas_contables for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());


-- ----------------------------------------------------------------------------
--  PASO 5 · STORAGE (archivos): los buckets guardan en {cuenta_id}/{empresa_id}/...
--  Se asegura por la PRIMERA carpeta de la ruta = cuenta_id del usuario.
--  IMPORTANTE: los buckets deben ser PRIVADOS (no públicos). La app usa URLs firmadas.
-- ----------------------------------------------------------------------------

-- Bóveda de documentos fiscales
drop policy if exists "tenant_docs_fiscales" on storage.objects;
create policy "tenant_docs_fiscales" on storage.objects for all
  using (bucket_id = 'documentos-fiscales'
         and ((storage.foldername(name))[1] = public.mi_cuenta_id()::text or public.soy_superadmin()))
  with check (bucket_id = 'documentos-fiscales'
         and ((storage.foldername(name))[1] = public.mi_cuenta_id()::text or public.soy_superadmin()));

-- Comprobantes de Tesorería (fotos de pagos/cobros)
drop policy if exists "tenant_comprobantes_tesoreria" on storage.objects;
create policy "tenant_comprobantes_tesoreria" on storage.objects for all
  using (bucket_id = 'comprobantes-tesoreria'
         and ((storage.foldername(name))[1] = public.mi_cuenta_id()::text or public.soy_superadmin()))
  with check (bucket_id = 'comprobantes-tesoreria'
         and ((storage.foldername(name))[1] = public.mi_cuenta_id()::text or public.soy_superadmin()));


-- ----------------------------------------------------------------------------
--  PASO 6 · VERIFICACIÓN: todas las tablas de datos deben quedar con RLS y política
-- ----------------------------------------------------------------------------
select c.relname as tabla,
       c.relrowsecurity as rls_activo,
       count(p.policyname) as num_politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('cuentas','perfiles','empresas','productos','terceros','parametros_nomina',
    'cuentas_tesoreria','empleados','recibos_nomina','facturas','libro_fiscal','movimientos_tesoreria',
    'retenciones','asientos','documentos_fiscales','criptoactivos','activos_fijos','novedades_nomina','cuentas_contables')
group by c.relname, c.relrowsecurity
order by rls_activo asc, tabla;
