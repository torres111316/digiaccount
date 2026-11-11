-- ============================================================
-- DigiAccount · Contabilidad 15: compras, ventas y retenciones en un asiento RESUMEN por período
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _14, de
-- condicion_fiscal_historial.sql y de dpp_y_cierres.sql. Re-ejecutable.
--
-- POR QUÉ (Luis, 11/11/2026): en las empresas de la firma, compras, ventas y
-- retenciones van en UN asiento por período con los totales que se declaran;
-- el detalle está en los libros. «Lo que se declara quincenal se contabiliza
-- quincenal y lo que se declara mensual se contabiliza mensual.»
--   · Ventas, compras y retenciones de IVA SUFRIDAS: el período de la Forma 30
--     (quincena solo el especial persona jurídica; la firma personal especial
--     declara el IVA mensual).
--   · Retenciones de IVA PRACTICADAS: quincena en todo especial (C.A. o F.P.).
--   · Retenciones de ISLR: mensual.
--   La condición es la del período (condicion_fiscal_en), no la de hoy.
-- Cómo funciona:
--   · empresas.contab_resumen: true = resumen por período; false o vacío = un
--     asiento por documento (lo de siempre). Se cambia en la ficha de la
--     empresa. Este SQL deja en resumen las empresas de la firma de Luis
--     (cuenta «Luis Torres», plan firma_contable), salvo KEYPIZZAS.
--   · En modo resumen el motor por documento NO corre al cargar o editar una
--     factura o una retención (sus disparadores llevan la condición). Lo que
--     ya tenía asiento lo conserva y no se suma otra vez al resumen.
--   · contab_resumen_grupos: UNA pasada por el libro y las retenciones del
--     rango; por tipo, período y quincena, las líneas que haría el motor
--     documento por documento (mismas reglas y cuentas, la de cada proveedor
--     incluida), neteadas por cuenta, y una huella de los documentos. De ahí
--     salen la lista, la propuesta y «Cerrar mes», con la misma huella.
--   · contab_aprobar_resumen: Luis lo aprueba tal cual o corregido. Queda en
--     contab_resumenes la propuesta y lo aprobado: de ahí aprenden los agentes.
--   · Si después cambia un documento del período, el resumen queda
--     «desactualizado» (la huella ya no coincide) y la pantalla lo avisa.
--   · Un mes cerrado no se aprueba ni se deshace (descuadraría la F30).
-- OJO: si se vuelven a correr contabilidad_04 o _05, recrean sus disparadores
-- sin la condición del modo resumen: correr este después.
-- Pruebas: sql/pruebas/contabilidad_15_pruebas.sql.
-- ============================================================

alter table public.empresas add column if not exists contab_resumen boolean;
comment on column public.empresas.contab_resumen is
  'true = compras, ventas y retenciones en un asiento resumen por período (sql/contabilidad_15); false o null = uno por documento.';

-- Las empresas de la firma, por su CUENTA (no por nombre: hay nombres repetidos
-- entre la firma y los clientes que usan el sistema por su cuenta). Solo las que
-- todavía no tienen valor: si Luis ya eligió en la ficha, se respeta.
update public.empresas set contab_resumen = true
 where contab_resumen is null
   and cuenta_id = '512df301-6b78-4078-b4b3-f0018e8627bc'
   and id <> '235aa6fe-1fc3-4ce5-b155-f6f0f1b66877';   -- KEYPIZZAS sigue por documento

create or replace function public.contab_es_resumen(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select contab_resumen from empresas where id = p_empresa), false)
$$;
grant execute on function public.contab_es_resumen(uuid) to authenticated;

-- ¿Este resumen va por quincena en ese período?
create or replace function public.contab_resumen_quincenal(p_empresa uuid, p_periodo text, p_tipo text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
             when p_tipo in ('ret_islr_practicadas', 'ret_islr_sufridas') then false
             when coalesce(public.condicion_fiscal_en(p_empresa, p_periodo), '') <> 'especial' then false
             when p_tipo = 'ret_iva_practicadas' then true
             else upper(left(regexp_replace(coalesce(e.rif, ''), '[^A-Za-z]', '', 'g'), 1)) not in ('V', 'E')
           end
      from empresas e where e.id = p_empresa), false)
$$;
grant execute on function public.contab_resumen_quincenal(uuid, text, text) to authenticated;

-- ── Los resúmenes aprobados (y lo que propuso el sistema) ─────────────────
create table if not exists public.contab_resumenes (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid,
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  tipo        text not null check (tipo in ('ventas', 'compras', 'ret_iva_practicadas', 'ret_islr_practicadas',
                                            'ret_iva_sufridas', 'ret_islr_sufridas')),
  periodo     text not null,
  quincena    smallint check (quincena in (1, 2)),
  propuesta   jsonb not null,
  lineas      jsonb not null,
  corregido   boolean not null default false,
  huella      text not null,
  documentos  int not null default 0,
  asiento_id  uuid,
  aprobado_por text,
  aprobado_en timestamptz not null default now()
);
create unique index if not exists contab_resumenes_unico
  on public.contab_resumenes (empresa_id, tipo, periodo, coalesce(quincena, 0));
comment on table public.contab_resumenes is
  'Asientos resumen aprobados por período. propuesta = lo que calculó el sistema; lineas = lo aprobado; corregido = si difieren (para que los agentes aprendan).';

alter table public.contab_resumenes enable row level security;
drop policy if exists contab_resumenes_ver on public.contab_resumenes;
create policy contab_resumenes_ver on public.contab_resumenes for select
  using (public.soy_superadmin() or empresa_id in (select public.mis_empresas()));
-- La escritura pasa solo por las funciones de abajo.

-- ── Una sola pasada: los grupos (tipo, período, quincena) de un rango ─────
-- Un documento ya está contabilizado (y no entra al resumen) si tiene asiento
-- propio, si su mes está en un resumen histórico LV-/LC- (o RIVA-), si tiene
-- un asiento suelto de antes del motor, o si es una retención ya cubierta.
drop function if exists public.contab_docs_resumen(uuid, text, text, int);
create or replace function public.contab_resumen_grupos(p_empresa uuid, p_desde text, p_hasta text)
returns table (tipo text, periodo text, quincena int, documentos int, con_asiento_propio int, huella text, lineas jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with libro as (
    select l.id, case l.tipo when 'venta' then 'ventas' else 'compras' end as tipo, x.per,
           coalesce(l.quincena, case when extract(day from contab_fecha_factura(l.fecha)) <= 15 then 1 else 2 end) as qd,
           x.lin,
           (exists (select 1 from asientos a where a.origen_tabla = 'libro_fiscal' and a.origen_id = l.id)
            or exists (select 1 from asientos a where a.empresa_id = l.empresa_id
                         and a.referencia = (case when l.tipo = 'venta' then 'LV-' else 'LC-' end) || substr(x.per, 6, 2) || '/' || substr(x.per, 1, 4))
            or (contab_heredado(l.empresa_id, l.tipo,
                  case when coalesce(trim(l.numero_zeta), '') <> '' then l.numero_zeta else l.numero_factura end,
                  l.tercero_nombre, coalesce(trim(l.numero_zeta), '') <> '')).estado <> 'ninguno') as con_asiento
      from libro_fiscal l
      cross join lateral (select contab_periodo_de(l.fecha, l.periodo) as per, contab_lineas_libro(l) as lin) x
     where l.empresa_id = p_empresa and l.tipo in ('venta', 'compra')
       and x.per between p_desde and p_hasta and x.lin is not null
  ), ret as (
    select t.id,
           'ret_' || case when lower(coalesce(t.tipo, '')) = 'iva' then 'iva' else 'islr' end
                  || case when lower(coalesce(t.direccion, '')) like 'practicada%' then '_practicadas' else '_sufridas' end as tipo,
           x.per,
           coalesce(t.quincena, case when extract(day from contab_fecha_factura(t.fecha)) <= 15 then 1 else 2 end) as qd,
           x.lin,
           (exists (select 1 from asientos a where a.origen_tabla = 'retenciones' and a.origen_id = t.id)
            or contab_ret_en_resumen(t) <> 'normal') as con_asiento
      from retenciones t
      cross join lateral (select contab_periodo_de(t.fecha, t.periodo) as per, contab_lineas_retencion(t) as lin) x
     where t.empresa_id = p_empresa and lower(coalesce(t.tipo, '')) in ('iva', 'islr')
       and (lower(coalesce(t.direccion, '')) like 'practicada%' or lower(coalesce(t.direccion, '')) like 'sufrida%')
       and x.per between p_desde and p_hasta and x.lin is not null
  ), docs as (
    select d.*, case when contab_resumen_quincenal(p_empresa, d.per, d.tipo) then d.qd else 0 end as q
      from (select * from libro union all select * from ret) d
  ), lineas as (
    select d.tipo, d.per, d.q, split_part(e->>'cta', ' · ', 1) as cod, e->>'cta' as cta,
           coalesce((e->>'debe')::numeric, 0) - coalesce((e->>'haber')::numeric, 0) as neto
      from docs d, jsonb_array_elements(d.lin) e where not d.con_asiento
  ), netas as (
    select tipo, per, q, cod, min(cta) as cta, round(sum(neto), 2) as neto from lineas group by tipo, per, q, cod
  )
  select g.tipo, g.per, nullif(g.q, 0),
         count(*) filter (where not g.con_asiento)::int,
         count(*) filter (where g.con_asiento)::int,
         -- La huella usa el código de la cuenta, no su nombre: renombrar una cuenta no desactualiza nada.
         md5(string_agg(g.id::text || ':' || g.con_asiento::text || ':'
               || (select string_agg(split_part(e->>'cta', ' · ', 1) || '/' || coalesce(e->>'debe', '0') || '/' || coalesce(e->>'haber', '0'), ',' order by o)
                     from jsonb_array_elements(g.lin) with ordinality z(e, o)), '|' order by g.id)),
         coalesce((select jsonb_agg(jsonb_build_object('cta', n.cta, 'debe', greatest(n.neto, 0), 'haber', greatest(-n.neto, 0))
                                    order by (n.neto < 0), n.cod)
                     from netas n where n.tipo = g.tipo and n.per = g.per and n.q = g.q and abs(n.neto) >= 0.005), '[]'::jsonb)
    from docs g
   group by g.tipo, g.per, g.q
$$;

-- El asiento que se propone para un tipo, período y quincena.
create or replace function public.contab_propuesta_resumen(p_empresa uuid, p_tipo text, p_periodo text, p_quincena int default null)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object('lineas', g.lineas, 'documentos', g.documentos, 'con_asiento_propio', g.con_asiento_propio, 'huella', g.huella)
       from contab_resumen_grupos(p_empresa, p_periodo, p_periodo) g
      where g.tipo = p_tipo and coalesce(g.quincena, 0) = coalesce(p_quincena, 0)),
    jsonb_build_object('lineas', '[]'::jsonb, 'documentos', 0, 'con_asiento_propio', 0, 'huella', md5('')))
$$;
grant execute on function public.contab_propuesta_resumen(uuid, text, text, int) to authenticated;

-- Normaliza y valida las líneas que aprueba Luis: cuenta del plan (no grupo),
-- montos positivos de un solo lado, y que cuadre.
create or replace function public.contab_validar_lineas(p_empresa uuid, p_lineas jsonb)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  e jsonb; cod text; d numeric; h numeric; td numeric := 0; th numeric := 0;
  out jsonb := '[]'::jsonb;
begin
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 2 then
    raise exception 'El asiento necesita al menos dos líneas.';
  end if;
  for e in select * from jsonb_array_elements(p_lineas) loop
    cod := trim(split_part(coalesce(e->>'cta', ''), ' · ', 1));
    d := round(coalesce((e->>'debe')::numeric, 0), 2);
    h := round(coalesce((e->>'haber')::numeric, 0), 2);
    if cod = '' then raise exception 'Hay una línea sin cuenta.'; end if;
    if d < 0 or h < 0 or (d > 0 and h > 0) or (d = 0 and h = 0) then
      raise exception 'La línea de la cuenta % debe llevar un monto positivo en el Debe o en el Haber, no en los dos.', cod;
    end if;
    if exists (select 1 from plan_cuentas_base where codigo = cod and tipo ilike 'grupo')
       or exists (select 1 from cuentas_contables where empresa_id = p_empresa and codigo = cod and tipo ilike 'grupo') then
      raise exception 'La cuenta % es un grupo del plan: elige una de sus cuentas.', cod;
    end if;
    out := out || jsonb_build_object('cta', contab_cta(cod, p_empresa), 'debe', d, 'haber', h);
    td := td + d; th := th + h;
  end loop;
  if abs(td - th) >= 0.005 then
    raise exception 'El asiento no cuadra: Debe % y Haber %.', td, th;
  end if;
  return out;
end $$;

create or replace function public.contab_ref_resumen(p_tipo text, p_periodo text, p_quincena int)
returns text language sql immutable as $$
  select 'RES-' || case p_tipo when 'ventas' then 'VEN' when 'compras' then 'COM'
                               when 'ret_iva_practicadas' then 'RIVA-P' when 'ret_islr_practicadas' then 'RISLR-P'
                               when 'ret_iva_sufridas' then 'RIVA-S' else 'RISLR-S' end
         || '-' || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4)
         || case when p_quincena is null then '' else '-Q' || p_quincena end
$$;

-- Aprueba (o rehace) el resumen de un período. p_lineas null = la propuesta tal
-- cual. p_huella = la de la propuesta que se vio: si cambió un documento
-- mientras se revisaba, no se aprueba sobre datos viejos.
drop function if exists public.contab_aprobar_resumen(uuid, text, text, int, jsonb);
create or replace function public.contab_aprobar_resumen(p_empresa uuid, p_tipo text, p_periodo text,
                                                         p_quincena int default null, p_lineas jsonb default null,
                                                         p_huella text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  quin boolean;
  prop jsonb;
  lin jsonb;
  dueña uuid;
  fin date;
  rid uuid;
  aid uuid;
  num int;
  tot numeric;
  nombre text := case p_tipo when 'ventas' then 'ventas' when 'compras' then 'compras'
                              when 'ret_iva_practicadas' then 'retenciones de IVA practicadas'
                              when 'ret_islr_practicadas' then 'retenciones de ISLR practicadas'
                              when 'ret_iva_sufridas' then 'retenciones de IVA sufridas'
                              else 'retenciones de ISLR sufridas' end;
begin
  if not (public.soy_superadmin() or p_empresa in (select public.mis_empresas())) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;
  if not contab_es_resumen(p_empresa) then
    return jsonb_build_object('ok', false, 'motivo', 'Esta empresa contabiliza por documento: no lleva resúmenes.');
  end if;
  if p_periodo !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'motivo', 'Período inválido: ' || coalesce(p_periodo, '(vacío)'));
  end if;
  if exists (select 1 from cierres_mensuales where empresa_id = p_empresa and periodo = p_periodo) then
    return jsonb_build_object('ok', false, 'motivo', 'El mes está cerrado: reábrelo para cambiar su contabilidad.');
  end if;
  quin := contab_resumen_quincenal(p_empresa, p_periodo, p_tipo);
  if quin and p_quincena is null then
    return jsonb_build_object('ok', false, 'motivo', 'En ese período ' || nombre || ' se declaran por quincena: indica la quincena.');
  end if;
  if not quin and p_quincena is not null then
    return jsonb_build_object('ok', false, 'motivo', 'En ese período ' || nombre || ' se declaran por mes, no por quincena.');
  end if;
  -- Dos aprobaciones del mismo período a la vez (doble clic, dos pestañas): una espera a la otra.
  perform pg_advisory_xact_lock(hashtext('resumen:' || p_empresa::text || ':' || p_tipo || ':' || p_periodo || ':' || coalesce(p_quincena, 0)));
  prop := contab_propuesta_resumen(p_empresa, p_tipo, p_periodo, p_quincena);
  if p_huella is not null and p_huella <> prop->>'huella' then
    return jsonb_build_object('ok', false, 'motivo', 'Cambió un documento de ese período mientras lo revisabas: vuelve a abrirlo para ver la propuesta al día.');
  end if;
  if (prop->>'documentos')::int = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'No hay documentos sin asiento en ese período (si tenía un resumen, deshazlo).');
  end if;
  begin
    lin := contab_validar_lineas(p_empresa, coalesce(p_lineas, prop->'lineas'));
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  select round(sum((e->>'debe')::numeric), 2) into tot from jsonb_array_elements(lin) e;
  select cuenta_id into dueña from empresas where id = p_empresa;
  fin := case when p_quincena = 1 then to_date(p_periodo || '-15', 'YYYY-MM-DD')
              else (to_date(p_periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date end;

  -- Rehacer: se reemplaza el asiento anterior del mismo período.
  select id, asiento_id into rid, aid from contab_resumenes
   where empresa_id = p_empresa and tipo = p_tipo and periodo = p_periodo and coalesce(quincena, 0) = coalesce(p_quincena, 0);
  rid := coalesce(rid, gen_random_uuid());
  if aid is not null then delete from asientos where id = aid; end if;

  insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
  values (dueña, p_empresa, to_char(fin, 'DD/MM/YYYY'), p_periodo,
          'Resumen de ' || nombre || ' · ' || to_char(to_date(p_periodo || '-01', 'YYYY-MM-DD'), 'MM/YYYY')
            || case when p_quincena is null then '' else ' · ' || p_quincena || 'ª quincena' end
            || ' · ' || (prop->>'documentos') || ' documento(s)',
          contab_ref_resumen(p_tipo, p_periodo, p_quincena), 'resumen', 'contab_resumenes', rid, lin, tot)
  returning id, numero into aid, num;

  insert into contab_resumenes (id, cuenta_id, empresa_id, tipo, periodo, quincena, propuesta, lineas, corregido, huella, documentos, asiento_id, aprobado_por)
  values (rid, dueña, p_empresa, p_tipo, p_periodo, p_quincena, prop->'lineas', lin,
          lin is distinct from prop->'lineas', prop->>'huella', (prop->>'documentos')::int, aid,
          coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', current_user))
  on conflict (empresa_id, tipo, periodo, coalesce(quincena, 0)) do update
    set propuesta = excluded.propuesta, lineas = excluded.lineas, corregido = excluded.corregido,
        huella = excluded.huella, documentos = excluded.documentos, asiento_id = excluded.asiento_id,
        aprobado_por = excluded.aprobado_por, aprobado_en = now();

  return jsonb_build_object('ok', true, 'asiento', num, 'corregido', lin is distinct from prop->'lineas');
end $$;
grant execute on function public.contab_aprobar_resumen(uuid, text, text, int, jsonb, text) to authenticated;

-- Deshacer un resumen aprobado: se borra su asiento y vuelve a «pendiente».
create or replace function public.contab_deshacer_resumen(p_resumen uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r contab_resumenes;
begin
  select * into r from contab_resumenes where id = p_resumen;
  if r.id is null then return jsonb_build_object('ok', false, 'motivo', 'No existe ese resumen.'); end if;
  if not (public.soy_superadmin() or r.empresa_id in (select public.mis_empresas())) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;
  if exists (select 1 from cierres_mensuales where empresa_id = r.empresa_id and periodo = r.periodo) then
    return jsonb_build_object('ok', false, 'motivo', 'El mes está cerrado: reábrelo para cambiar su contabilidad.');
  end if;
  perform pg_advisory_xact_lock(hashtext('resumen:' || r.empresa_id::text || ':' || r.tipo || ':' || r.periodo || ':' || coalesce(r.quincena, 0)));
  delete from asientos where id = r.asiento_id;
  delete from contab_resumenes where id = r.id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.contab_deshacer_resumen(uuid) to authenticated;

-- Si alguien borra a mano el asiento de un resumen, el resumen vuelve a pendiente.
create or replace function public.contab_resumen_sin_asiento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from contab_resumenes where asiento_id = old.id;
  return old;
end $$;
drop trigger if exists trg_contab_resumen_sin_asiento on public.asientos;
create trigger trg_contab_resumen_sin_asiento after delete on public.asientos
  for each row when (old.origen_tabla = 'contab_resumenes') execute function public.contab_resumen_sin_asiento();

-- ── Lo que hay por contabilizar ───────────────────────────────────────────
-- Por cada tipo, período y quincena con documentos (o con un resumen
-- aprobado): la propuesta, la huella y el estado (pendiente, aprobado,
-- desactualizado). Una sola pasada (contab_resumen_grupos).
create or replace function public.contab_por_contabilizar(p_empresa uuid, p_desde text, p_hasta text)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  with g as (select * from contab_resumen_grupos(p_empresa, p_desde, least(p_hasta, to_char(to_date(p_desde || '-01', 'YYYY-MM-DD') + interval '35 months', 'YYYY-MM')))),
       r as (select * from contab_resumenes
              where empresa_id = p_empresa and periodo between p_desde and p_hasta)
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', coalesce(g.tipo, r.tipo), 'periodo', coalesce(g.periodo, r.periodo), 'quincena', coalesce(g.quincena, r.quincena),
           'documentos', coalesce(g.documentos, 0), 'con_asiento_propio', coalesce(g.con_asiento_propio, 0),
           'propuesta', coalesce(g.lineas, '[]'::jsonb), 'huella', coalesce(g.huella, md5('')),
           'estado', case when r.id is null then 'pendiente' when r.huella = coalesce(g.huella, md5('')) then 'aprobado' else 'desactualizado' end,
           'resumen_id', r.id, 'lineas', r.lineas, 'corregido', r.corregido, 'aprobado_en', r.aprobado_en)
         order by coalesce(g.periodo, r.periodo), coalesce(g.quincena, r.quincena, 0),
                  array_position(array['ventas', 'compras', 'ret_iva_practicadas', 'ret_islr_practicadas', 'ret_iva_sufridas', 'ret_islr_sufridas'],
                                 coalesce(g.tipo, r.tipo))), '[]'::jsonb)
    from g full join r on r.tipo = g.tipo and r.periodo = g.periodo and coalesce(r.quincena, 0) = coalesce(g.quincena, 0)
   where coalesce(g.documentos, 0) > 0 or r.id is not null
$$;
grant execute on function public.contab_por_contabilizar(uuid, text, text) to authenticated;

-- ── El motor por documento no corre en modo resumen ───────────────────────
-- (la versión anterior de este SQL dejaba correr al motor y borraba después;
-- eso se llevaba también los asientos sueltos de antes del motor que adoptaba).
drop trigger if exists trg_contab_libro_resumen on public.libro_fiscal;
drop trigger if exists trg_contab_retencion_resumen on public.retenciones;
drop function if exists public.contab_quitar_si_resumen();

drop trigger if exists trg_contab_libro on public.libro_fiscal;
create trigger trg_contab_libro after insert or update on public.libro_fiscal
  for each row when (not public.contab_es_resumen(new.empresa_id)) execute function public.contab_sync_libro();
drop trigger if exists trg_contab_libro_borrar on public.libro_fiscal;
create trigger trg_contab_libro_borrar after delete on public.libro_fiscal
  for each row execute function public.contab_sync_libro();

drop trigger if exists trg_contab_retencion on public.retenciones;
create trigger trg_contab_retencion
  after insert or update of monto, estado, direccion, tipo, fecha, periodo, comprobante, factura, tercero_nombre, empresa_id
  on public.retenciones
  for each row when (not public.contab_es_resumen(new.empresa_id)) execute function public.contab_sync_retencion();
drop trigger if exists trg_contab_retencion_borrar on public.retenciones;
create trigger trg_contab_retencion_borrar after delete on public.retenciones
  for each row execute function public.contab_sync_retencion();

-- «Cerrar mes»: en modo resumen, un período está contabilizado si cada grupo
-- con documentos tiene su resumen aprobado y al día; un resumen cuyo período
-- ya no tiene documentos (se borraron o anularon) también hay que deshacerlo.
create or replace function public.contab_filas_sin_asiento(p_empresa uuid, p_periodo text)
returns integer language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare n int := 0;
begin
  if not contab_es_resumen(p_empresa) then
    select (
      select count(*)::int
        from libro_fiscal l
       where l.empresa_id = p_empresa
         and public.contab_periodo_de(l.fecha, l.periodo) = p_periodo
         and public.contab_lineas_libro(l) is not null
         and not exists (select 1 from asientos a where a.origen_tabla = 'libro_fiscal' and a.origen_id = l.id)
         and not exists (select 1 from asientos a where a.empresa_id = l.empresa_id
                            and a.referencia = (case when l.tipo = 'venta' then 'LV-' else 'LC-' end)
                                               || substr(p_periodo, 6, 2) || '/' || substr(p_periodo, 1, 4))
         and (public.contab_heredado(l.empresa_id, l.tipo,
                case when coalesce(trim(l.numero_zeta), '') <> '' then l.numero_zeta else l.numero_factura end,
                l.tercero_nombre, coalesce(trim(l.numero_zeta), '') <> '')).estado = 'ninguno'
    ) + (
      select count(*)::int
        from retenciones t
       where t.empresa_id = p_empresa
         and public.contab_periodo_de(t.fecha, t.periodo) = p_periodo
         and public.contab_lineas_retencion(t) is not null
         and not exists (select 1 from asientos a where a.origen_tabla = 'retenciones' and a.origen_id = t.id)
         and public.contab_ret_en_resumen(t) <> 'cubierta'
    ) into n;
  else
    select coalesce(sum(case when coalesce(g.documentos, 0) > 0 then g.documentos else 1 end), 0)::int into n
      from (select * from contab_resumen_grupos(p_empresa, p_periodo, p_periodo)) g
      full join (select * from contab_resumenes where empresa_id = p_empresa and periodo = p_periodo) r
        on r.tipo = g.tipo and coalesce(r.quincena, 0) = coalesce(g.quincena, 0)
     where (coalesce(g.documentos, 0) > 0 and (r.id is null or r.huella <> g.huella))
        or (r.id is not null and coalesce(g.documentos, 0) = 0);
  end if;
  return n + (
    select count(*)::int
      from movimientos_tesoreria m
     where m.empresa_id = p_empresa and m.contab_motor and coalesce(m.monto, 0) > 0
       and to_char(public.contab_fecha_factura(m.fecha), 'YYYY-MM') = p_periodo
       and not (m.tipo = 'ingreso' and (public.contab_mov_par(m)).id is not null)
       and not exists (select 1 from asientos a where a.origen_tabla = 'movimientos_tesoreria' and a.origen_id = m.id));
end $$;
grant execute on function public.contab_filas_sin_asiento(uuid, text) to authenticated;

-- Cuántos resúmenes aprobados tiene una empresa (la ficha no deja volver a
-- «por documento» mientras haya: ese período quedaría contado dos veces).
create or replace function public.contab_resumenes_aprobados(p_empresa uuid)
returns int language sql stable security invoker set search_path = public, pg_temp as $$
  select count(*)::int from contab_resumenes where empresa_id = p_empresa
$$;
grant execute on function public.contab_resumenes_aprobados(uuid) to authenticated;

-- Comprobación: qué empresas quedan en resumen (las de la firma) y cuántas por documento.
select e.nombre, contab_es_resumen(e.id) as en_resumen
  from empresas e order by 2 desc, 1;
