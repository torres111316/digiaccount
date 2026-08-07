-- =============================================================
-- CRM / LEADS  —  captación de contactos desde el sitio web
-- (imanes de leads: Calendario Fiscal 2026 y futuros recursos)
--
-- Tabla GLOBAL (no multi-tenant): los leads pertenecen a DigiAccount,
-- no a una cuenta de cliente. Por eso NO lleva cuenta_id.
-- Seguridad: solo el fundador (soy_superadmin) puede verlos/gestionarlos.
-- El webhook de n8n inserta con la llave service_role, que ignora RLS.
-- Idempotente: se puede correr varias veces sin romper nada.
-- =============================================================

create table if not exists public.leads (
  id             bigserial primary key,
  nombre         text not null,
  whatsapp       text not null,
  correo         text not null unique,                       -- 1 lead por correo (n8n lo guarda en minúsculas)
  origen         text not null default 'calendario-2026',    -- qué recurso/imán lo trajo (first-touch)
  consentimiento boolean not null default false,             -- aceptó recibir información
  estado         text not null default 'nuevo'
                 check (estado in ('nuevo','contactado','cliente','descartado')),  -- pipeline del CRM
  notas          text,                                       -- notas internas del CRM
  user_agent     text,                                       -- navegador (diagnóstico/anti-spam)
  ip             text,                                        -- IP de origen (diagnóstico/anti-spam)
  utm            jsonb,                                       -- campañas: utm_source, utm_campaign, etc.
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Índices para el panel (listar por fecha y filtrar por estado)
create index if not exists idx_leads_created on public.leads (created_at desc);
create index if not exists idx_leads_estado  on public.leads (estado);

-- updated_at automático en cada UPDATE (upsert de n8n)
create or replace function public.tg_leads_updated() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_leads_updated on public.leads;
create trigger trg_leads_updated
  before update on public.leads
  for each row execute function public.tg_leads_updated();

-- RLS: tabla del fundador
alter table public.leads enable row level security;

-- Solo el fundador (superadmin) ve y gestiona los leads desde la app.
-- El webhook n8n usa service_role => ignora RLS => no requiere policy de insert.
drop policy if exists leads_admin_all on public.leads;
create policy leads_admin_all on public.leads
  for all
  using (public.soy_superadmin())
  with check (public.soy_superadmin());

-- =============================================================
-- Notas de uso:
--  * n8n hace UPSERT con on_conflict=correo (PostgREST: header
--    "Prefer: resolution=merge-duplicates"). Por eso el correo es UNIQUE
--    y n8n debe normalizarlo a minúsculas antes de insertar.
--  * Para un nuevo imán de leads, solo cambia 'origen' (ej: 'guia-iva-2026').
--  * Estados sugeridos del pipeline: nuevo -> contactado -> cliente / descartado.
-- =============================================================
