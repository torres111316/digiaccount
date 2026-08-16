-- =============================================================
-- EL CALENDARIO LE AVISABA A LOS ESPECIALES DE LA ESTIMADA DE ISLR
--
-- Un contribuyente especial NO presenta declaración estimada de ISLR.
-- Paga el ANTICIPO del Decreto Constituyente 3.719: 1% sobre los ingresos
-- brutos del período, y ese anticipo SUSTITUYE a la estimada. La estimada
-- del Art. 82 de la LISLR es de los demás contribuyentes.
--
-- El calendario tenía 60 renglones de ISLR_ESTIMADA marcados 'especial', o
-- sea que se los mostraba precisamente a quienes no la deben. Y como el
-- agente de avisos lee esta misma tabla, además salían por correo.
--
-- LAS FECHAS TAMPOCO SIRVEN PARA OTRO
--   No se les cambia el ámbito: son fechas del calendario DE ESPECIALES,
--   repartidas por terminal de RIF. Un ordinario no declara por terminal,
--   así que esas fechas no le corresponden a nadie más. Se eliminan.
--
-- Y EL ANTICIPO DE IVA NO EXISTE
--   240 renglones decían "declaración/anticipos IVA-ISLR". El anticipo es
--   únicamente de ISLR. Del IVA se declara y se paga, pero no se anticipa.
--
-- Idempotente: se puede correr dos veces.
-- =============================================================

-- -------------------------------------------------------------
-- 1 · Fuera la estimada del calendario de los especiales
-- -------------------------------------------------------------
delete from public.calendario_fiscal
 where impuesto = 'ISLR_ESTIMADA' and ambito = 'especial';

-- -------------------------------------------------------------
-- 2 · El anticipo es de ISLR, no de IVA
-- -------------------------------------------------------------
update public.calendario_fiscal
   set descripcion = replace(descripcion,
                             'declaración/anticipos IVA-ISLR',
                             'declaración de IVA y anticipo de ISLR')
 where descripcion like '%anticipos IVA-ISLR%';

-- -------------------------------------------------------------
-- 3 · El candado, para que no vuelva
--
-- Lo que se corrige a mano vuelve en la próxima carga del calendario. El
-- año que viene toca sembrar 2027 desde la Gaceta, y la fila equivocada
-- entra igual si nada la detiene. Aquí la base la rechaza.
-- -------------------------------------------------------------
alter table public.calendario_fiscal
  drop constraint if exists calendario_estimada_no_especial;
alter table public.calendario_fiscal
  add constraint calendario_estimada_no_especial
  check (not (impuesto = 'ISLR_ESTIMADA' and ambito = 'especial'));

alter table public.calendario_fiscal
  drop constraint if exists calendario_sin_anticipo_de_iva;
alter table public.calendario_fiscal
  add constraint calendario_sin_anticipo_de_iva
  check (descripcion !~* 'anticipos?\s+(de\s+)?IVA[\s\-]');

comment on constraint calendario_estimada_no_especial on public.calendario_fiscal is
  'Un contribuyente especial paga el anticipo del 1% (Decreto 3.719), que sustituye a la declaración estimada del Art. 82 de la LISLR. Avisarle de la estimada es avisarle de algo que no debe.';
comment on constraint calendario_sin_anticipo_de_iva on public.calendario_fiscal is
  'El anticipo es únicamente de ISLR. Del IVA se declara y se paga, pero no se anticipa.';

-- -------------------------------------------------------------
-- CÓMO DESACTIVARLO
--
--   alter table public.calendario_fiscal
--     drop constraint if exists calendario_estimada_no_especial,
--     drop constraint if exists calendario_sin_anticipo_de_iva;
--
-- (Los renglones borrados se recuperan volviendo a correr
--  calendario_fiscal_2026.sql, que ya viene corregido.)
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- Debe dar CERO filas:
--   select count(*) from public.calendario_fiscal
--    where (impuesto = 'ISLR_ESTIMADA' and ambito = 'especial')
--       or descripcion ilike '%anticipos IVA-ISLR%';
--
-- Y que el candado muerde (debe dar error):
--   insert into public.calendario_fiscal (fecha, impuesto, descripcion, ambito, terminales)
--   values ('2027-01-08','ISLR_ESTIMADA','prueba','especial','0');
--
-- Lo que le queda al calendario, por impuesto:
--   select impuesto, ambito, count(*)
--     from public.calendario_fiscal group by 1,2 order by 1,2;
-- -------------------------------------------------------------
