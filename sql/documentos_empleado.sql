-- ============================================================
-- DigiAccount · Expediente digital del trabajador (Bóveda de Nómina)
-- Guarda los documentos de cada empleado (cédula, RIF, contrato…)
-- en Supabase Storage; esta tabla es el índice con RLS por cuenta.
-- Ejecutar en: Supabase SQL Editor (una sola vez). Re-ejecutable.
-- Reutiliza el bucket 'documentos-fiscales' (mismo que la Bóveda Fiscal).
-- ============================================================

create table if not exists public.documentos_empleado (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null,
  empresa_id   uuid not null,
  empleado_id  uuid not null references public.empleados(id) on delete cascade,
  tipo         text not null,              -- 'Cédula de identidad', 'RIF', 'Contrato de trabajo', 'Otro'
  nombre       text,                       -- nombre original del archivo (conserva acentos)
  storage_path text not null,              -- clave en el bucket (SOLO ASCII)
  mime         text,
  tamano       bigint,
  creado_en    timestamptz not null default now()
);

create index if not exists idx_docs_empleado on public.documentos_empleado (empleado_id, tipo);
create index if not exists idx_docs_empleado_empresa on public.documentos_empleado (empresa_id);

alter table public.documentos_empleado enable row level security;

drop policy if exists docsemp_select on public.documentos_empleado;
create policy docsemp_select on public.documentos_empleado
  for select using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

drop policy if exists docsemp_insert on public.documentos_empleado;
create policy docsemp_insert on public.documentos_empleado
  for insert with check (cuenta_id = public.mi_cuenta_id());

drop policy if exists docsemp_delete on public.documentos_empleado;
create policy docsemp_delete on public.documentos_empleado
  for delete using (cuenta_id = public.mi_cuenta_id());
