-- ============================================================
-- DigiAccount · Contabilidad 02: costo o gasto lo da el proveedor
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01. Re-ejecutable.
--
-- POR QUÉ: toda compra iba a «5.1.1.02 · Compra de Mercancía», aunque fuera
-- un alquiler, honorarios o un equipo, y el Estado de Resultados no separaba
-- costos de gastos. Regla de Luis (02/11/2026): «desde un comienzo hay que
-- clasificar los costos y los gastos y eso lo da el proveedor».
--
--   terceros.cuenta_gasto       la cuenta por defecto del proveedor (código
--                               del plan, p. ej. '6.1.1.03'); null = sin asignar.
--   libro_fiscal.cuenta_contable la de ESA factura, si se cambió; null = usar
--                               la del proveedor. Un mismo proveedor puede
--                               vender mercancía y también un equipo.
--
-- Las políticas que ya tienen las dos tablas cubren las columnas nuevas.
-- ============================================================

alter table public.terceros     add column if not exists cuenta_gasto text;
alter table public.libro_fiscal add column if not exists cuenta_contable text;

comment on column public.terceros.cuenta_gasto is
  'Cuenta contable por defecto de las compras a este proveedor (código de plan_cuentas_base o propia)';
comment on column public.libro_fiscal.cuenta_contable is
  'Cuenta contable de esta compra si difiere de la del proveedor; null = la del proveedor';

-- Comprobación: 0 (nadie tiene cuenta asignada todavía).
select count(*) filter (where cuenta_gasto is not null) as proveedores_con_cuenta from public.terceros;
