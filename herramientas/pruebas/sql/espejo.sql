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
create function public.mis_empresas() returns setof uuid language plpgsql as 'begin return query select id from public.empresas; end';

create table public.cuentas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  segmento text not null,  -- 'empresa' o 'contador'; obligatorio y sin valor por defecto, igual que en Supabase
  plan_id text
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

-- La regla de Supabase que limita las empresas por plan (sql/planes_dos_apps.sql),
-- resumida: sin plan, 1 empresa; contador_basico, 3.
create function public.validar_limite_empresas() returns trigger language plpgsql as $$
declare lim int; n int;
begin
  select case plan_id when 'contador_basico' then 3 when 'contador_pro' then 10 else 1 end into lim
    from public.cuentas where id = new.cuenta_id;
  select count(*) into n from public.empresas where cuenta_id = new.cuenta_id;
  if n >= coalesce(lim, 1) then raise exception 'Tu plan permite hasta % empresa(s).', coalesce(lim, 1); end if;
  return new;
end $$;
create trigger trg_limite_empresas before insert on public.empresas
  for each row execute function public.validar_limite_empresas();

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

create table public.retenciones (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid,
  empresa_id uuid,
  direccion text,          -- 'practicada' (la empresa retiene) o 'sufrida' (le retienen)
  tipo text,               -- 'iva' o 'islr'
  fecha text,              -- dd/mm/aa
  comprobante text,
  tercero_nombre text,
  tercero_rif text,
  factura text,
  base numeric,
  pct numeric,
  monto numeric,
  estado text default 'Registrado',
  concepto text,
  periodo text,
  quincena integer,
  creado_en timestamptz default now()
);

create table public.declaraciones (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null,
  empresa_id uuid not null,
  impuesto text not null,
  periodo text not null,
  quincena smallint,
  numero text not null,
  fecha date,
  tipo text not null default 'ORIGINARIA',
  monto numeric(18,2) not null default 0,
  a_pagar numeric(18,2) not null default 0,
  estado text,
  nota text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, impuesto, numero)
);

-- Como en Supabase: fecha_adq es texto dd/mm/aaaa y vida_util, años.
create table public.activos_fijos (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid,
  empresa_id uuid,
  codigo text,
  nombre text,
  categoria text,
  fecha_adq text,
  costo numeric default 0,
  vida_util integer default 5,
  metodo text default 'Línea recta',
  depreciacion_acum numeric default 0,
  creado_en timestamptz default now()
);

-- Tesorería y estados de cuenta, con las columnas reales de Supabase.
create table public.cuentas_tesoreria (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid,
  empresa_id uuid,
  nombre text,
  banco text,
  tipo text,
  moneda text,
  numero text,
  saldo_inicial numeric default 0,
  color text,
  creado_en timestamptz default now()
);
create table public.extracto_bancario (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid,
  empresa_id uuid,
  cuenta_teso_id uuid,
  fecha text,
  descripcion text,
  referencia text,
  monto numeric,
  conciliado_con uuid,
  periodo text,
  huella text,
  creado_en timestamptz default now(),
  unique (cuenta_teso_id, huella)
);

-- Recibos de venta de la app y tasas del BCV, con las columnas reales.
create table public.facturas (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid, empresa_id uuid,
  numero text, control text, tipo text, fecha text,
  cliente_nombre text, cliente_rif text, cliente_dom text,
  alicuota numeric, igtf boolean, condicion text, items jsonb,
  subtotal numeric, iva numeric, igtf_monto numeric, total numeric,
  estado text, tipo_doc text, factura_afectada text, motivo text, emitida_en timestamptz,
  moneda text, tasa numeric, total_usd numeric,
  creado_en timestamptz default now()
);
create table public.tasas_cambio (
  id uuid primary key default gen_random_uuid(),
  fecha date, moneda text, tasa numeric, fuente text,
  creado_en timestamptz default now()
);
create table public.movimientos_tesoreria (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid, empresa_id uuid, cuenta_teso_id uuid,
  fecha text, concepto text, tipo text, referencia text, monto numeric,
  comprobante_path text, tercero_nombre text, tercero_rif text, factura_ref text,
  conciliado boolean default false,
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

-- RUIDO: en la base real hay otras empresas con asientos que repiten las
-- referencias que usan las pruebas (LV-03/2026 de Agüero, 000144 de GATMA,
-- A021521 de Radian...). Una prueba que busque por referencia sin filtrar por
-- su empresa de prueba debe fallar AQUÍ y no recién en Supabase (pasó el
-- 02/11/2026: «more than one row returned by a subquery»).
insert into public.cuentas (id, nombre, segmento) values ('99999999-0000-0000-0000-000000000001', 'Cuenta ajena', 'contador');
insert into public.empresas (id, cuenta_id, nombre) values ('99999999-0000-0000-0000-0000000000e1', '99999999-0000-0000-0000-000000000001', 'Empresa ajena');
insert into public.asientos (cuenta_id, empresa_id, numero, fecha, descripcion, referencia, origen, lineas, total)
select '99999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-0000000000e1', row_number() over (), '31/03/2026',
       'Asiento ajeno ' || r, r, 'auto', '[]', 0
  from unnest(array['LV-03/2026', '000144', 'A021521', '00309501', '001379', '0812', '0000054586', '000300',
                    '777', '778', '779', '780', 'LV-11/2026', 'MAN', 'REC-0001', '1234', '01234', 'M000001']) r;
