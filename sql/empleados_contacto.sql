-- ============================================================
-- DigiAccount · Contacto de empleados
-- Agrega correo y WhatsApp a la tabla empleados.
-- Ejecutar en: Supabase SQL Editor (una sola vez).
-- Seguro de re-ejecutar (IF NOT EXISTS).
-- ============================================================

alter table public.empleados
  add column if not exists correo   text,
  add column if not exists whatsapp text;

comment on column public.empleados.correo   is 'Correo personal del trabajador (importado de listas de nómina)';
comment on column public.empleados.whatsapp is 'Teléfono WhatsApp del trabajador (formato libre, ej. 0412-1234567)';
