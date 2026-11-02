-- ============================================================
-- DigiAccount · Contabilidad 01: el plan de cuentas vive en la base
-- Ejecutar en: Supabase SQL Editor. Re-ejecutable.
--
-- POR QUÉ: el plan de cuentas base eran 101 filas fijas escritas dentro de
-- index.html. La base no lo conocía, así que no podía generar asientos con
-- el nombre de cada cuenta, y todo asiento nacía en el navegador: lo que
-- entraba por el importador, por Telegram o por un script quedaba sin
-- contabilizar (GATMA y Radian, oct-2025 a jul-2026). Ver
-- docs/superpowers/specs/2026-11-02-contabilidad-design.md.
--
-- plan_cuentas_base es UNA para todos: la leen todos los usuarios y solo la
-- cambia el fundador. Las cuentas propias de cada empresa siguen en
-- cuentas_contables; plan_de_empresa() junta las dos.
-- «uso» marca las cuentas en que se puede clasificar una compra.
-- ============================================================

create table if not exists public.plan_cuentas_base (
  codigo      text primary key,
  nombre      text not null,
  tipo        text not null check (tipo in ('Grupo', 'Cuenta')),
  naturaleza  text not null check (naturaleza in ('Deudora', 'Acreedora')),
  uso         text check (uso in ('costo', 'gasto', 'activo_fijo'))
);

alter table public.plan_cuentas_base enable row level security;
drop policy if exists plan_base_select on public.plan_cuentas_base;
create policy plan_base_select on public.plan_cuentas_base
  for select to authenticated using (true);
drop policy if exists plan_base_escribe on public.plan_cuentas_base;
create policy plan_base_escribe on public.plan_cuentas_base
  for all to authenticated using (public.soy_superadmin()) with check (public.soy_superadmin());

insert into public.plan_cuentas_base (codigo, nombre, tipo, naturaleza, uso) values
  ('1', 'ACTIVO', 'Grupo', 'Deudora', null),
  ('1.1', 'Activo Corriente', 'Grupo', 'Deudora', null),
  ('1.1.1', 'Efectivo y Equivalentes de Efectivo', 'Grupo', 'Deudora', null),
  ('1.1.1.01', 'Caja', 'Cuenta', 'Deudora', null),
  ('1.1.1.02', 'Caja chica', 'Cuenta', 'Deudora', null),
  ('1.1.1.03', 'Bancos', 'Cuenta', 'Deudora', null),
  ('1.1.1.04', 'Equivalentes de efectivo / Inversiones temporales', 'Cuenta', 'Deudora', null),
  ('1.1.2', 'Cuentas por Cobrar', 'Grupo', 'Deudora', null),
  ('1.1.2.01', 'Cuentas por cobrar comerciales (clientes)', 'Cuenta', 'Deudora', null),
  ('1.1.2.02', 'Efectos por cobrar', 'Cuenta', 'Deudora', null),
  ('1.1.2.03', 'Cuentas por cobrar empleados', 'Cuenta', 'Deudora', null),
  ('1.1.2.04', 'Anticipos a proveedores', 'Cuenta', 'Deudora', null),
  ('1.1.2.05', 'Provisión cuentas incobrables (−)', 'Cuenta', 'Acreedora', null),
  ('1.1.3', 'Cuentas Fiscales por Cobrar', 'Grupo', 'Deudora', null),
  ('1.1.3.01', 'IVA crédito fiscal', 'Cuenta', 'Deudora', null),
  ('1.1.3.02', 'ISLR retenido por terceros', 'Cuenta', 'Deudora', null),
  ('1.1.3.03', 'Retenciones IVA soportadas', 'Cuenta', 'Deudora', null),
  ('1.1.3.04', 'Excedente de crédito fiscal IVA', 'Cuenta', 'Deudora', null),
  ('1.1.3.05', 'Retenciones de IVA por descontar', 'Cuenta', 'Deudora', null),
  ('1.1.4', 'Inventarios', 'Grupo', 'Deudora', null),
  ('1.1.4.01', 'Inventario de mercancías', 'Cuenta', 'Deudora', null),
  ('1.1.4.02', 'Inventario de materia prima', 'Cuenta', 'Deudora', null),
  ('1.1.4.03', 'Productos en proceso', 'Cuenta', 'Deudora', null),
  ('1.1.4.04', 'Productos terminados', 'Cuenta', 'Deudora', null),
  ('1.1.5', 'Gastos pagados por anticipado', 'Cuenta', 'Deudora', null),
  ('1.1.6', 'Criptoactivos VEN-NIF 12', 'Cuenta', 'Deudora', null),
  ('1.2', 'Activo No Corriente', 'Grupo', 'Deudora', null),
  ('1.2.1', 'Propiedad, Planta y Equipo', 'Grupo', 'Deudora', null),
  ('1.2.1.01', 'Terrenos', 'Cuenta', 'Deudora', 'activo_fijo'),
  ('1.2.1.02', 'Edificios', 'Cuenta', 'Deudora', 'activo_fijo'),
  ('1.2.1.03', 'Maquinaria y equipo', 'Cuenta', 'Deudora', 'activo_fijo'),
  ('1.2.1.04', 'Mobiliario y equipo de oficina', 'Cuenta', 'Deudora', 'activo_fijo'),
  ('1.2.1.05', 'Vehículos', 'Cuenta', 'Deudora', 'activo_fijo'),
  ('1.2.1.06', 'Depreciación acumulada (−)', 'Cuenta', 'Acreedora', null),
  ('1.2.2', 'Activos Intangibles', 'Cuenta', 'Deudora', null),
  ('1.2.3', 'Inversiones Permanentes', 'Cuenta', 'Deudora', null),
  ('2', 'PASIVO', 'Grupo', 'Acreedora', null),
  ('2.1', 'Pasivo Corriente', 'Grupo', 'Acreedora', null),
  ('2.1.1', 'Cuentas por Pagar', 'Grupo', 'Acreedora', null),
  ('2.1.1.01', 'Cuentas por pagar comerciales (proveedores)', 'Cuenta', 'Acreedora', null),
  ('2.1.1.02', 'Efectos por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.2', 'Obligaciones Laborales', 'Grupo', 'Acreedora', null),
  ('2.1.2.01', 'Sueldos y salarios por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.2.02', 'Prestaciones sociales por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.2.03', 'Vacaciones por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.2.04', 'Utilidades por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3', 'Retenciones y Aportes por Pagar', 'Grupo', 'Acreedora', null),
  ('2.1.3.01', 'IVA débito fiscal', 'Cuenta', 'Acreedora', null),
  ('2.1.3.02', 'Retenciones IVA por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3.03', 'Retenciones ISLR por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3.04', 'S.S.O. por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3.05', 'Régimen Prestacional de Empleo (RPE) por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3.06', 'FAOV por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3.07', 'INCES por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.4', 'Impuestos por Pagar', 'Grupo', 'Acreedora', null),
  ('2.1.4.01', 'ISLR por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.4.02', 'Impuestos municipales por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.4.03', 'IGTF por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.5', 'Otras Cuentas por Pagar', 'Grupo', 'Acreedora', null),
  ('2.1.5.03', 'Protección a las Pensiones por pagar', 'Cuenta', 'Acreedora', null),
  ('2.2', 'Pasivo No Corriente', 'Grupo', 'Acreedora', null),
  ('2.2.1', 'Préstamos bancarios a largo plazo', 'Cuenta', 'Acreedora', null),
  ('2.2.2', 'Impuesto diferido pasivo VEN-NIF 11', 'Cuenta', 'Acreedora', null),
  ('3', 'PATRIMONIO', 'Grupo', 'Acreedora', null),
  ('3.1', 'Capital', 'Grupo', 'Acreedora', null),
  ('3.1.1.01', 'Capital social', 'Cuenta', 'Acreedora', null),
  ('3.2', 'Superávit y Resultados', 'Grupo', 'Acreedora', null),
  ('3.2.1.01', 'Reserva legal', 'Cuenta', 'Acreedora', null),
  ('3.2.2.01', 'Utilidades retenidas (no distribuidas)', 'Cuenta', 'Acreedora', null),
  ('3.2.3.01', 'Resultado del ejercicio', 'Cuenta', 'Acreedora', null),
  ('3.2.5.01', 'Ganancia por tenencia de criptoactivos (ORI) VEN-NIF 12', 'Cuenta', 'Acreedora', null),
  ('4', 'INGRESOS', 'Grupo', 'Acreedora', null),
  ('4.1', 'Ingresos Operacionales', 'Grupo', 'Acreedora', null),
  ('4.1.1.01', 'Venta de mercancía', 'Cuenta', 'Acreedora', null),
  ('4.1.2.01', 'Devoluciones y descuentos en ventas (−)', 'Cuenta', 'Deudora', null),
  ('4.2', 'Otros Ingresos', 'Grupo', 'Acreedora', null),
  ('4.2.1.01', 'Ingresos financieros', 'Cuenta', 'Acreedora', null),
  ('4.2.2.01', 'Ganancia en cambio', 'Cuenta', 'Acreedora', null),
  ('5', 'COSTOS', 'Grupo', 'Deudora', null),
  ('5.1', 'Costo de Ventas', 'Grupo', 'Deudora', null),
  ('5.1.1.01', 'Costo de mercancía vendida', 'Cuenta', 'Deudora', null),
  ('5.1.1.02', 'Compra de Mercancía', 'Cuenta', 'Deudora', 'costo'),
  ('5.1.2.01', 'Costo de producción', 'Cuenta', 'Deudora', null),
  ('6', 'GASTOS', 'Grupo', 'Deudora', null),
  ('6.1', 'Gastos de Administración', 'Grupo', 'Deudora', null),
  ('6.1.1.01', 'Sueldos y salarios', 'Cuenta', 'Deudora', null),
  ('6.1.1.02', 'Beneficios laborales', 'Cuenta', 'Deudora', null),
  ('6.1.1.03', 'Alquileres', 'Cuenta', 'Deudora', 'gasto'),
  ('6.1.1.04', 'Servicios públicos', 'Cuenta', 'Deudora', 'gasto'),
  ('6.1.1.05', 'Honorarios profesionales', 'Cuenta', 'Deudora', 'gasto'),
  ('6.1.1.06', 'Depreciación', 'Cuenta', 'Deudora', null),
  ('6.1.1.07', 'Aporte Protección a las Pensiones (9%)', 'Cuenta', 'Deudora', null),
  ('6.2', 'Gastos de Ventas', 'Grupo', 'Deudora', null),
  ('6.2.1.01', 'Publicidad y mercadeo', 'Cuenta', 'Deudora', 'gasto'),
  ('6.2.1.02', 'Comisiones', 'Cuenta', 'Deudora', 'gasto'),
  ('6.2.1.03', 'Fletes y transporte', 'Cuenta', 'Deudora', 'gasto'),
  ('6.3', 'Gastos Financieros', 'Grupo', 'Deudora', null),
  ('6.3.1.01', 'Pérdida por tenencia de criptoactivos VEN-NIF 12', 'Cuenta', 'Deudora', null),
  ('6.3.1.02', 'Gastos y comisiones bancarias', 'Cuenta', 'Deudora', 'gasto'),
  ('6.3.1.03', 'Pérdida en cambio', 'Cuenta', 'Deudora', null),
  ('6.3.1.04', 'IGTF (gasto)', 'Cuenta', 'Deudora', null),
  ('1.1.3.06', 'Anticipos de ISLR', 'Cuenta', 'Deudora', null),
  ('1.2.1.07', 'Depreciación acumulada edificios (−)', 'Cuenta', 'Acreedora', null),
  ('1.2.1.08', 'Depreciación acumulada maquinaria y equipo (−)', 'Cuenta', 'Acreedora', null),
  ('1.2.1.09', 'Depreciación acumulada mobiliario y equipo de oficina (−)', 'Cuenta', 'Acreedora', null),
  ('1.2.1.10', 'Depreciación acumulada vehículos (−)', 'Cuenta', 'Acreedora', null),
  ('2.1.3.08', 'IVSS patronal por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3.09', 'RPE patronal por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3.10', 'FAOV patronal por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.3.11', 'INCES patronal por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.4.04', 'IVA por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.4.05', 'IGP por pagar', 'Cuenta', 'Acreedora', null),
  ('2.1.6', 'Anticipos recibidos', 'Grupo', 'Acreedora', null),
  ('2.1.6.01', 'Anticipos de clientes', 'Cuenta', 'Acreedora', null),
  ('4.2.3.01', 'Ganancia en venta de activos', 'Cuenta', 'Acreedora', null),
  ('6.1.1.08', 'Aportes patronales IVSS', 'Cuenta', 'Deudora', null),
  ('6.1.1.09', 'Aportes patronales RPE', 'Cuenta', 'Deudora', null),
  ('6.1.1.10', 'Aportes patronales FAOV', 'Cuenta', 'Deudora', null),
  ('6.1.1.11', 'Aportes patronales INCES', 'Cuenta', 'Deudora', null),
  ('6.1.1.12', 'Impuestos municipales', 'Cuenta', 'Deudora', 'gasto'),
  ('6.1.1.13', 'Impuesto a los grandes patrimonios', 'Cuenta', 'Deudora', null),
  ('6.1.1.14', 'Mantenimiento y reparaciones', 'Cuenta', 'Deudora', 'gasto'),
  ('6.1.1.15', 'Papelería y útiles de oficina', 'Cuenta', 'Deudora', 'gasto'),
  ('6.1.1.16', 'Gastos generales', 'Cuenta', 'Deudora', 'gasto'),
  ('6.1.1.17', 'Depreciación edificios', 'Cuenta', 'Deudora', null),
  ('6.1.1.18', 'Depreciación maquinaria y equipo', 'Cuenta', 'Deudora', null),
  ('6.1.1.19', 'Depreciación mobiliario y equipo de oficina', 'Cuenta', 'Deudora', null),
  ('6.1.1.20', 'Depreciación vehículos', 'Cuenta', 'Deudora', null),
  ('6.3.1.05', 'Pérdida en venta de activos', 'Cuenta', 'Deudora', null),
  ('6.4', 'Impuesto sobre la Renta', 'Grupo', 'Deudora', null),
  ('6.4.1.01', 'Gasto de ISLR', 'Cuenta', 'Deudora', null)
on conflict (codigo) do update
  set nombre = excluded.nombre, tipo = excluded.tipo,
      naturaleza = excluded.naturaleza, uso = excluded.uso;

-- La base más las cuentas propias de la empresa. security invoker: las
-- políticas de cuentas_contables deciden qué empresa puede ver quién.
create or replace function public.plan_de_empresa(p_empresa uuid)
returns table (codigo text, nombre text, tipo text, naturaleza text, uso text, propia boolean)
language sql stable security invoker set search_path = public as $$
  select b.codigo, b.nombre, b.tipo, b.naturaleza, b.uso, false
    from plan_cuentas_base b
  union all
  select c.codigo, c.nombre, coalesce(c.tipo, 'Cuenta'), coalesce(c.naturaleza, 'Deudora'), null, true
    from cuentas_contables c
   where c.empresa_id = p_empresa
     and not exists (select 1 from plan_cuentas_base b2 where b2.codigo = c.codigo)
  order by 1
$$;
grant execute on function public.plan_de_empresa(uuid) to authenticated;

-- Comprobación: cuentas = 131.
select count(*) as cuentas, count(*) filter (where uso is not null) as clasificables
  from public.plan_cuentas_base;
