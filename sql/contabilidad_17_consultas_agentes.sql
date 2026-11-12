-- ============================================================
-- DigiAccount · Contabilidad 17: consultas de solo lectura para los agentes (Roberth)
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _16. Re-ejecutable.
--
-- POR QUÉ (Luis, 12/11/2026): Roberth, el agente de Contabilidad, tiene que
-- estar al tanto de la contabilidad nueva (resúmenes por período, propuestas
-- de los módulos, cuadre con la Forma 30) y responder con las MISMAS cifras
-- que la app. Los reportes de la app se calculan en el navegador; estas dos
-- funciones hacen lo mismo en la base para que el agente las lea:
--   · contab_saldos_periodo: el Balance de Comprobación de un rango de fechas
--     (saldo anterior, debe, haber y saldo final por cuenta), al nivel pedido
--     (1 Detalle, 2 Cuenta, 3 Grupo, 4 Clase), como la barra de los reportes.
--   · contab_correcciones: lo que Luis corrigió al aprobar (propuesto contra
--     aprobado), en resúmenes y en propuestas de los módulos. De ahí aprende.
-- Lo demás que lee el agente ya existe: contab_por_contabilizar (SQL 15),
-- contab_borradores (SQL 16) y contab_cuadre_iva (SQL 13).
-- Pruebas: sql/pruebas/contabilidad_17_pruebas.sql.
-- ============================================================

create or replace function public.contab_saldos_periodo(p_empresa uuid, p_desde text, p_hasta text, p_nivel int default 1)
returns table (cuenta text, nombre text, saldo_anterior numeric, debe numeric, haber numeric, saldo_final numeric)
language sql stable security invoker set search_path = public, pg_temp as $$
  with seg as (select case p_nivel when 2 then 3 when 3 then 2 when 4 then 1 else 0 end as n),
  lin as (
    select split_part(e->>'cta', ' · ', 1) as cod, split_part(e->>'cta', ' · ', 2) as nom,
           contab_fecha_factura(a.fecha) as f,
           coalesce((e->>'debe')::numeric, 0) as d, coalesce((e->>'haber')::numeric, 0) as h
      from asientos a cross join lateral jsonb_array_elements(a.lineas) e
     where a.empresa_id = p_empresa
  ),
  cor as (
    select case when (select n from seg) = 0 then cod
                else array_to_string((string_to_array(cod, '.'))[1:(select n from seg)], '.') end as cod,
           nom, f, d, h
      from lin
     where f is null or f <= p_hasta::date
  )
  select c.cod,
         coalesce((select b.nombre from plan_cuentas_base b where b.codigo = c.cod),
                  (select x.nombre from cuentas_contables x where x.empresa_id = p_empresa and x.codigo = c.cod limit 1),
                  min(c.nom)),
         round(sum(case when c.f is null or c.f < p_desde::date then c.d - c.h else 0 end), 2),
         round(sum(case when c.f >= p_desde::date then c.d else 0 end), 2),
         round(sum(case when c.f >= p_desde::date then c.h else 0 end), 2),
         round(sum(c.d - c.h), 2)
    from cor c
   group by c.cod
  having abs(sum(c.d - c.h)) >= 0.005 or sum(case when c.f >= p_desde::date then c.d + c.h else 0 end) >= 0.005
   order by c.cod
$$;
comment on function public.contab_saldos_periodo(uuid, text, text, int) is
  'Balance de Comprobación de un rango (aaaa-mm-dd): saldo anterior (debe − haber antes del rango), debe y haber del rango y saldo final. Nivel 1 Detalle, 2 Cuenta, 3 Grupo, 4 Clase. Lo usan los agentes (sql/contabilidad_17).';
grant execute on function public.contab_saldos_periodo(uuid, text, text, int) to authenticated;

create or replace function public.contab_correcciones(p_empresa uuid, p_limite int default 50)
returns table (cuando timestamptz, que text, periodo text, quincena int, propuesta jsonb, aprobado jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  select * from (
    select r.aprobado_en, 'resumen: ' || r.tipo, r.periodo, r.quincena::int, r.propuesta, r.lineas
      from contab_resumenes r where r.empresa_id = p_empresa and r.corregido
    union all
    select b.aprobado_en, 'propuesta del módulo: ' || coalesce(b.origen_tabla, b.referencia, ''), b.periodo, null::int,
           coalesce(b.resuelta, b.propuesta), b.aprobado
      from contab_borradores b where b.empresa_id = p_empresa and b.corregido
  ) x
  order by 1 desc nulls last
  limit greatest(1, least(coalesce(p_limite, 50), 200))
$$;
comment on function public.contab_correcciones(uuid, int) is
  'Lo que Luis corrigió al aprobar: lo propuesto contra lo aprobado (resúmenes y propuestas de los módulos). Para que los agentes aprendan (sql/contabilidad_17).';
grant execute on function public.contab_correcciones(uuid, int) to authenticated;

-- Comprobación
select to_regprocedure('public.contab_saldos_periodo(uuid, text, text, int)') is not null as saldos,
       to_regprocedure('public.contab_correcciones(uuid, int)') is not null as correcciones;
