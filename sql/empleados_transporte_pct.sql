-- ============================================================
-- DigiAccount · Bono de transporte por porcentaje
-- Agrega transporte_pct a la tabla empleados: permite que el Bono
-- de Transporte sea un % del complemento no salarial (contingencia)
-- en vez de (o además de) un monto fijo en USD. Si transporte_pct > 0,
-- manda sobre transporte_usd en el cálculo de nómina.
-- Ejecutar en: Supabase SQL Editor (una sola vez).
-- Seguro de re-ejecutar (IF NOT EXISTS).
-- ============================================================

alter table public.empleados
  add column if not exists transporte_pct numeric default 0;

comment on column public.empleados.transporte_pct is 'Bono de transporte como % del complemento no salarial (contingencia). Si es > 0, manda sobre transporte_usd. Se descuenta de la contingencia, no se suma aparte.';
