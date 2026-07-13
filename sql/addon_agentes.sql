-- =============================================================
-- ADD-ON "AGENTES IA" — interruptor por cuenta
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
-- =============================================================

-- 1) La columna del add-on (apagado por defecto para todos)
alter table public.cuentas add column if not exists addon_agentes boolean not null default false;

-- 2) BLINDAJE: un cliente NO puede encenderse el add-on por la API.
--    Solo el fundador (gerencia@) o procesos de servidor (SQL editor / service_role,
--    donde auth.uid() es null — así el cobro automático por n8n también podrá activarlo).
create or replace function public.proteger_addon_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.addon_agentes is distinct from old.addon_agentes
     and auth.uid() is not null
     and not public.soy_superadmin() then
    new.addon_agentes := old.addon_agentes;
  end if;
  return new;
end $$;
drop trigger if exists trg_proteger_addon on public.cuentas;
create trigger trg_proteger_addon before update on public.cuentas
for each row execute function public.proteger_addon_cuenta();

-- 3) Encender el add-on a la Firma Contable de Luis (cuenta registrada con el
--    correo personal). Si usaste otro correo para la Firma, cámbialo aquí.
update public.cuentas set addon_agentes = true
where id in (
  select p.cuenta_id
  from public.perfiles p
  join auth.users u on u.id = p.id
  where lower(u.email) = 'torres111316@gmail.com'
);

-- 4) Verificación: debe mostrar tu Firma con addon_agentes = true
select nombre, segmento, addon_agentes from public.cuentas;
