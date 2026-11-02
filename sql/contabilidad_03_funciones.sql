-- ============================================================
-- DigiAccount · Contabilidad 03: el asiento de una fila del libro fiscal
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 y _02. Re-ejecutable.
--
-- POR QUÉ: hasta ahora el asiento de cada compra o venta lo armaba el
-- navegador, con la fecha del día en que se cargaba (380 de 620 asientos de
-- Agüero quedaron en el mes equivocado), y solo cuando la factura se cargaba
-- a mano en pantalla. Estas funciones calculan el asiento en la base, igual
-- para cualquier camino de entrada: pantalla, importador, Telegram o script.
-- El disparador que las usa está en contabilidad_04_motor.sql.
-- Pruebas: sql/pruebas/contabilidad_03_pruebas.sql.
--
-- Reglas (docs/superpowers/specs/2026-11-02-contabilidad-design.md §4):
--   · Venta:  Debe CxC (1.1.2.01) / Haber Venta de mercancía (base + exento)
--             / Haber IVA débito fiscal / Haber IGTF por pagar (2.1.4.03) si se
--             percibió: el cliente lo debe junto con la factura. Igual si es un Z.
--   · El proveedor (su cuenta por defecto) se busca por RIF o, si la factura
--     no lo trae, por nombre, entre los terceros de la cuenta DUEÑA de la
--     empresa: el cuenta_id de la fila lo pone quien inserta.
--   · Compra: Debe la cuenta de la factura → la del proveedor → Compra de
--             Mercancía (5.1.1.02), por base + exento / Debe IVA crédito
--             fiscal / Haber CxP (2.1.1.01).
--   · Nota de crédito: lo mismo con debe y haber invertidos.
--   · ANULADA, o venta de una empresa en modo recibos (fiscal_activo = false):
--     no genera asiento. En modo recibos la venta la contabiliza el recibo.
--   · Cada monto con 2 decimales; la línea de CxC o CxP es la suma de las
--     otras, así Debe = Haber siempre (el IVA llegaba con 12 decimales).
--   · Fecha: el día del registro si cae en el período del libro; si no, la
--     fecha de la factura si cae en él; si no, el último día del período.
--     Siempre en hora de Caracas: a las 9 p. m. del 5, UTC ya es el 6.
-- ============================================================

-- «dd/mm/aa» o «dd/mm/aaaa» → date (null si no se entiende).
create or replace function public.contab_fecha_factura(p text)
returns date language plpgsql immutable set search_path = public as $$
declare m text[];
begin
  m := regexp_match(trim(coalesce(p, '')), '^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$');
  if m is null then return null; end if;
  return make_date(case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, m[2]::int, m[1]::int);
exception when others then
  return null;
end $$;

create or replace function public.contab_periodo_de(p_fecha_factura text, p_periodo text)
returns text language sql immutable set search_path = public as $$
  select coalesce(nullif(trim(coalesce(p_periodo, '')), ''),
                  to_char(public.contab_fecha_factura(p_fecha_factura), 'YYYY-MM'))
$$;

create or replace function public.contab_fecha_asiento(p_fecha_factura text, p_periodo text, p_registrado timestamptz)
returns text language plpgsql stable set search_path = public as $$
declare
  per text := public.contab_periodo_de(p_fecha_factura, p_periodo);
  reg date := (coalesce(p_registrado, now()) at time zone 'America/Caracas')::date;
  fac date := public.contab_fecha_factura(p_fecha_factura);
begin
  if per is null then return to_char(reg, 'DD/MM/YYYY'); end if;
  if to_char(reg, 'YYYY-MM') = per then return to_char(reg, 'DD/MM/YYYY'); end if;
  if fac is not null and to_char(fac, 'YYYY-MM') = per then return to_char(fac, 'DD/MM/YYYY'); end if;
  return to_char((to_date(per || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, 'DD/MM/YYYY');
end $$;

-- '<codigo> · <nombre>': del plan base o, si no está, de las cuentas propias
-- de la empresa. Un código que no existe es un error, no una línea huérfana.
create or replace function public.contab_cta(p_codigo text, p_empresa uuid default null)
returns text language plpgsql stable set search_path = public as $$
declare n text;
begin
  select nombre into n from plan_cuentas_base where codigo = p_codigo;
  if n is null and p_empresa is not null then
    select nombre into n from cuentas_contables where codigo = p_codigo and empresa_id = p_empresa limit 1;
  end if;
  if n is null then raise exception 'La cuenta % no existe en el plan de cuentas', p_codigo; end if;
  return p_codigo || ' · ' || n;
end $$;

create or replace function public.contab_lineas_libro(r public.libro_fiscal)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  modo_libro boolean;
  dueña uuid;   -- la cuenta dueña de la empresa (no el cuenta_id que traiga la fila: ese lo pone quien inserta)
  nc boolean := upper(trim(coalesce(r.tipo_doc, ''))) = 'NC';
  b numeric := round(coalesce(r.base, 0) + coalesce(r.exento, 0), 2);
  i numeric := round(coalesce(r.iva, 0), 2);
  g numeric := round(coalesce(r.igtf, 0), 2);   -- IGTF percibido en la venta (spec §5): pasivo, y el cliente lo debe
  t numeric;
  cta text;
  lin jsonb := '[]'::jsonb;   -- en una nota de crédito, debe y haber van invertidos
begin
  if coalesce(r.tercero_nombre, '') ~* 'ANULAD' then return null; end if;
  select coalesce(fiscal_activo, true), cuenta_id into modo_libro, dueña from empresas where id = r.empresa_id;
  if r.tipo = 'venta' and modo_libro is false then return null; end if;
  if b = 0 and i = 0 then return null; end if;
  t := b + (case when i > 0.005 then i else 0 end);

  if r.tipo = 'venta' then
    if g > 0.005 then t := t + g; end if;
    lin := jsonb_build_array(
      jsonb_build_object('cta', contab_cta('1.1.2.01', r.empresa_id), 'debe', case when nc then 0 else t end, 'haber', case when nc then t else 0 end),
      jsonb_build_object('cta', contab_cta('4.1.1.01', r.empresa_id), 'debe', case when nc then b else 0 end, 'haber', case when nc then 0 else b end));
    if i > 0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta('2.1.3.01', r.empresa_id), 'debe', case when nc then i else 0 end, 'haber', case when nc then 0 else i end);
    end if;
    if g > 0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta('2.1.4.03', r.empresa_id), 'debe', case when nc then g else 0 end, 'haber', case when nc then 0 else g end);
    end if;
  else
    -- La cuenta del proveedor: por RIF y, si la factura no lo trae, por nombre
    -- (la pantalla busca igual: window.__cuentaDeProveedor en assets/app.js).
    cta := coalesce(
      nullif(trim(coalesce(r.cuenta_contable, '')), ''),
      (select nullif(trim(tr.cuenta_gasto), '') from terceros tr
        where tr.cuenta_id = dueña
          and nullif(trim(tr.cuenta_gasto), '') is not null
          and ((coalesce(trim(r.tercero_rif), '') <> ''
                and upper(regexp_replace(tr.rif, '[\s.\-]', '', 'g')) = upper(regexp_replace(r.tercero_rif, '[\s.\-]', '', 'g')))
            or (coalesce(trim(r.tercero_nombre), '') <> ''
                and upper(trim(tr.nombre)) = upper(trim(r.tercero_nombre))))
        order by (coalesce(trim(r.tercero_rif), '') <> ''
                  and upper(regexp_replace(tr.rif, '[\s.\-]', '', 'g')) = upper(regexp_replace(r.tercero_rif, '[\s.\-]', '', 'g'))) desc
        limit 1),
      '5.1.1.02');
    lin := jsonb_build_array(
      jsonb_build_object('cta', contab_cta(cta, r.empresa_id), 'debe', case when nc then 0 else b end, 'haber', case when nc then b else 0 end));
    if i > 0.005 then
      lin := lin || jsonb_build_object('cta', contab_cta('1.1.3.01', r.empresa_id), 'debe', case when nc then 0 else i end, 'haber', case when nc then i else 0 end);
    end if;
    lin := lin || jsonb_build_object('cta', contab_cta('2.1.1.01', r.empresa_id), 'debe', case when nc then t else 0 end, 'haber', case when nc then 0 else t end);
  end if;
  return lin;
end $$;

-- Comprobación: 03/11/2026 (factura del 28/10 registrada el 03/11, ejemplo de Luis).
select public.contab_fecha_asiento('28/10/26', '2026-11', '2026-11-03 10:00-04') as fecha_del_asiento;
