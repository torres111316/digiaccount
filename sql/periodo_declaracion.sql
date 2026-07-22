-- ============================================================
-- DigiAccount · Período de declaración en libro fiscal y retenciones
-- ------------------------------------------------------------
-- La FECHA de la factura y el PERÍODO en que se declara pueden
-- diferir: en compras es común recibir facturas de meses
-- anteriores y declarar el crédito (y su retención) cuando la
-- factura llega. Este campo guarda el período REAL de declaración.
-- Ejecutar en: Supabase SQL Editor (una vez). Re-ejecutable.
-- ============================================================

alter table public.libro_fiscal
  add column if not exists periodo text;   -- 'aaaa-mm' (ej. 2025-12)

alter table public.retenciones
  add column if not exists periodo text;   -- 'aaaa-mm'

comment on column public.libro_fiscal.periodo is
  'Período de declaración (aaaa-mm). Puede diferir de la fecha de la factura (compras recibidas tarde).';
comment on column public.retenciones.periodo is
  'Período de declaración de la retención (aaaa-mm). Sigue al de la factura que la origina.';

-- Respaldo: para filas antiguas sin período, derivarlo de la fecha (dd/mm/aa)
-- como valor por defecto. La migración fina (por hoja de origen) la hace el script.
update public.libro_fiscal
   set periodo = '20' || split_part(fecha, '/', 3) || '-' || split_part(fecha, '/', 2)
 where periodo is null and fecha ~ '^\d{1,2}/\d{1,2}/\d{2}$';

update public.retenciones
   set periodo = '20' || split_part(fecha, '/', 3) || '-' || split_part(fecha, '/', 2)
 where periodo is null and fecha ~ '^\d{1,2}/\d{1,2}/\d{2}$';

create index if not exists idx_libro_fiscal_periodo on public.libro_fiscal (empresa_id, tipo, periodo);
create index if not exists idx_retenciones_periodo on public.retenciones (empresa_id, periodo);

-- ------------------------------------------------------------
-- Corrección de las facturas de AGUERO que se DECLARARON en un
-- período distinto al de su fecha (recibidas tarde / hoja distinta).
-- ------------------------------------------------------------
-- Compras declaradas después de la fecha de la factura
update public.libro_fiscal set periodo = '2026-01'
 where empresa_id = '129f28e9-22fe-4f43-80ff-e3d3fa959925' and tipo = 'compra'
   and numero_factura in ('10833774','10833895');
update public.libro_fiscal set periodo = '2026-02'
 where empresa_id = '129f28e9-22fe-4f43-80ff-e3d3fa959925' and tipo = 'compra'
   and numero_factura in ('00046462','00151962','00065645','22984');
update public.libro_fiscal set periodo = '2026-04'
 where empresa_id = '129f28e9-22fe-4f43-80ff-e3d3fa959925' and tipo = 'compra'
   and numero_factura = 'C011273';
-- Las VENTAS quedan SIEMPRE en el período de su fecha (las emite la empresa):
-- el default derivado de la fecha ya es el correcto, no se sobrescriben.
