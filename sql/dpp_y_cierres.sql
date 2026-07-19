-- ============================================================
-- DigiAccount · (1) Exención de DPP para emprendimientos
--               (2) Cierres mensuales (bloqueo de períodos)
-- Ejecutar en: Supabase SQL Editor (una sola vez). Re-ejecutable.
-- ============================================================

-- (1) Empresas que NO declaran Protección a las Pensiones (emprendimientos):
alter table public.empresas
  add column if not exists declara_dpp boolean not null default true;

comment on column public.empresas.declara_dpp is
  'false = emprendimiento exento de DPP: sin cálculos, planilla ni avisos de vencimiento';

-- Los dos emprendimientos actuales de la firma quedan exentos:
update public.empresas set declara_dpp = false
 where id in ('129f28e9-22fe-4f43-80ff-e3d3fa959925',   -- EMPRENDIMIENTO JOSE AGUERO 4
              '833e03ef-bde7-45c1-85cc-415172c0375f');  -- EMPRENDIMIENTO GILBERTO PARRA 2

-- (2) Cierres mensuales: al cerrar un mes (verificado, autorizado y declarado)
--     las transacciones de ese período quedan BLOQUEADAS contra modificaciones.
--     Se puede reabrir (delete de la fila) sin perder nada.
create table if not exists public.cierres_mensuales (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null,
  empresa_id  uuid not null,
  periodo     text not null,              -- 'aaaa-mm' (ej. 2026-06)
  cerrado_por text,
  cerrado_en  timestamptz not null default now(),
  unique (empresa_id, periodo)
);

alter table public.cierres_mensuales enable row level security;

drop policy if exists cierres_select on public.cierres_mensuales;
create policy cierres_select on public.cierres_mensuales
  for select using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

drop policy if exists cierres_insert on public.cierres_mensuales;
create policy cierres_insert on public.cierres_mensuales
  for insert with check (cuenta_id = public.mi_cuenta_id());

drop policy if exists cierres_delete on public.cierres_mensuales;
create policy cierres_delete on public.cierres_mensuales
  for delete using (cuenta_id = public.mi_cuenta_id());
