-- ============================================================
-- DigiAccount · Campos para el Contrato de Trabajo
-- Agrega a EMPRESAS los datos del representante legal y registro
-- mercantil, y a EMPLEADOS los datos personales que exige el
-- contrato (nacionalidad, estado civil, dirección).
-- Ejecutar en: Supabase SQL Editor (una sola vez). Re-ejecutable.
-- ============================================================

alter table public.empresas
  add column if not exists representante        text,   -- nombre del representante legal
  add column if not exists representante_ci     text,   -- C.I. del representante (ej. V-00.000.000)
  add column if not exists representante_cargo  text,   -- cargo (ej. Gerente General)
  add column if not exists registro_mercantil   text,   -- datos de inscripción (Nº / Tomo / Folio)
  add column if not exists ciudad               text;   -- ciudad/estado (jurisdicción y encabezado del contrato)

alter table public.empleados
  add column if not exists nacionalidad text,           -- ej. Venezolana
  add column if not exists estado_civil text,           -- Soltero(a) / Casado(a) / ...
  add column if not exists direccion    text;           -- domicilio del trabajador

comment on column public.empresas.representante is 'Representante legal que suscribe contratos y documentos laborales';
comment on column public.empleados.direccion    is 'Domicilio del trabajador (para el contrato de trabajo)';
