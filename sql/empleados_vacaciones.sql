-- ============================================================
-- DigiAccount · Seguimiento de vacaciones por trabajador
-- Agrega vacaciones_desde / vacaciones_hasta a empleados: mientras
-- la fecha de hoy caiga en ese rango, la nómina del período le paga
-- SOLO el Cestaticket (no salario, no contingencia, no transporte,
-- sin deducciones de ley) y queda marcado en el listado.
-- Ejecutar en: Supabase SQL Editor (una sola vez).
-- Seguro de re-ejecutar (IF NOT EXISTS).
-- ============================================================

alter table public.empleados
  add column if not exists vacaciones_desde date,
  add column if not exists vacaciones_hasta date;

comment on column public.empleados.vacaciones_desde is 'Inicio del período de vacaciones actual/próximo (NULL = no está de vacaciones)';
comment on column public.empleados.vacaciones_hasta is 'Fecha de reincorporación (fin de las vacaciones)';
