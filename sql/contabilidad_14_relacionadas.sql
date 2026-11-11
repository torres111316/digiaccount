-- ============================================================
-- DigiAccount · Contabilidad 14: cuentas de empresas relacionadas y de accionistas
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01. Re-ejecutable.
--
-- POR QUÉ (pedido de Luis, 11/11/2026): GATMA y Radian son del mismo dueño y
-- a veces una le presta a la otra para cubrir sus pagos. Son personas
-- jurídicas distintas: el préstamo no es ingreso ni gasto, es una cuenta por
-- cobrar en la que presta y una por pagar en la que recibe.
--   · Quien presta:  Debe 1.1.2.06 CxC empresas relacionadas / Haber su banco.
--   · Quien recibe:  Debe su banco / Haber 2.1.5.02 CxP empresas relacionadas.
--   · Al devolverlo, lo inverso en cada una. Los saldos de las dos deben
--     coincidir siempre (es la misma deuda vista de los dos lados).
-- Lo mismo con el dueño o los socios (1.1.2.07 / 2.1.5.04): lo que la
-- empresa le presta o le adelanta, o lo que él pone para cubrir pagos sin
-- que sea aporte de capital.
-- En Tesorería se registran como movimiento sin factura, eligiendo la cuenta.
-- Las cuentas propias de cada empresa no se tocan.
-- ============================================================

insert into public.plan_cuentas_base (codigo, nombre, tipo, naturaleza, uso) values
  ('1.1.2.06', 'Cuentas por cobrar a empresas relacionadas', 'Cuenta', 'Deudora', null),
  ('1.1.2.07', 'Cuentas por cobrar a accionistas y socios', 'Cuenta', 'Deudora', null),
  ('2.1.5.02', 'Cuentas por pagar a empresas relacionadas', 'Cuenta', 'Acreedora', null),
  ('2.1.5.04', 'Cuentas por pagar a accionistas y socios', 'Cuenta', 'Acreedora', null)
on conflict (codigo) do update
  set nombre = excluded.nombre, tipo = excluded.tipo,
      naturaleza = excluded.naturaleza, uso = excluded.uso;

-- Comprobación: 136 cuentas, y ninguna empresa con una cuenta propia en esos códigos
-- (si apareciera alguna, manda la del plan base y la propia queda oculta en plan_de_empresa).
select (select count(*) from public.plan_cuentas_base) as cuentas_en_el_plan,
       (select count(*) from public.cuentas_contables
         where codigo in ('1.1.2.06', '1.1.2.07', '2.1.5.02', '2.1.5.04')) as cuentas_propias_con_esos_codigos;
