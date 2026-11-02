-- ============================================================
-- Espejo MÍNIMO del esquema de Supabase para probar los SQL de sql/ en PGlite.
--
-- Solo las tablas y columnas que tocan esos SQL, con los tipos reales
-- (uuid, numeric, texto dd/mm/aa en las fechas del libro). No es una copia
-- de la base: si un SQL nuevo usa otra columna, se agrega aquí. Lo que pase
-- en este espejo no prueba las políticas RLS de verdad; eso se comprueba en
-- Supabase con sql/auditoria_rls.sql.
-- ============================================================

create role authenticated;
create function public.soy_superadmin() returns boolean language sql as 'select false';
create function public.mi_cuenta_id() returns uuid language sql as 'select null::uuid';

create table public.cuentas (
  id uuid primary key default gen_random_uuid(),
  nombre text
);

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid references public.cuentas(id),
  nombre text,
  rif text,
  condicion_fiscal text,
  fiscal_activo boolean default true,
  declara_dpp boolean not null default true,
  activa boolean default true
);

create table public.terceros (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid,
  rif text,
  nombre text,
  es_cliente boolean default false,
  es_proveedor boolean default false
);

create table public.cuentas_contables (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid,
  empresa_id uuid,
  codigo text,
  nombre text,
  tipo text,
  naturaleza text,
  creado_en timestamptz default now()
);

create table public.libro_fiscal (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid,
  empresa_id uuid,
  tipo text,
  fecha text,
  tercero_nombre text,
  tercero_rif text,
  numero_factura text,
  numero_control text,
  tipo_doc text,
  exento numeric default 0,
  base numeric default 0,
  alicuota numeric,
  iva numeric default 0,
  total numeric default 0,
  igtf numeric default 0,
  periodo text,
  quincena integer,
  maquina_fiscal text,
  numero_zeta text,
  creado_en timestamptz default now()
);

create table public.asientos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid,
  empresa_id uuid,
  numero integer,
  fecha text,
  descripcion text,
  referencia text,
  origen text,
  lineas jsonb,
  total numeric,
  creado_en timestamptz default now()
);
