-- ============================================================
-- DigiAccount · Contacto de empresas
-- Agrega dirección y teléfono a la tabla empresas
-- (se muestran en el encabezado de los recibos de nómina).
-- Ejecutar en: Supabase SQL Editor (una sola vez).
-- Seguro de re-ejecutar (IF NOT EXISTS).
-- ============================================================

alter table public.empresas
  add column if not exists direccion text,
  add column if not exists telefono  text;

comment on column public.empresas.direccion is 'Dirección fiscal/comercial (aparece en recibos de nómina)';
comment on column public.empresas.telefono  is 'Teléfono de la empresa (aparece en recibos de nómina)';

-- Datos iniciales de EMPRENDIMIENTO JOSE AGUERO 4 (tomados de sus recibos actuales)
update public.empresas
   set direccion = coalesce(direccion, 'Cambural - Edo. Yaracuy'),
       telefono  = coalesce(telefono,  '0414-5558456')
 where id = '129f28e9-22fe-4f43-80ff-e3d3fa959925';
