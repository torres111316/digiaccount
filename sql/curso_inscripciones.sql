-- =============================================================
-- CURSO «FORMACIÓN EMPRESARIAL» · inscripciones desde digiaccount.io/curso
--
-- Flujo: la landing pide la configuración (precio vigente, tasa BCV) →
-- la persona se inscribe y sube su comprobante → n8n lo guarda y avisa a
-- Luis por Telegram con [Aprobar] [Rechazar] → al aprobar, la persona recibe
-- por correo el enlace al grupo de WhatsApp de su lote.
--
-- Tablas GLOBALES (de DigiAccount, no de una cuenta cliente): solo el
-- fundador las ve desde la app. n8n entra con service_role y SOLO usa las
-- tres funciones de abajo (no se les da permiso a anon/authenticated).
-- Nada se aprueba solo: el pago lo verifica Luis en su banco o en Binance.
-- Idempotente.
-- =============================================================

-- ── Ediciones (lotes) del curso ──────────────────────────────────────────
create table if not exists public.curso_ediciones (
  id               text primary key,                 -- p. ej. 'sabado-1'
  nombre           text not null,
  fecha            date,                             -- null = por confirmar
  hora             text not null default '8:30 a. m. a 5:30 p. m.',
  lugar            text,                             -- null = por confirmar
  preventa_hasta   date,                             -- último día de la preventa (hora de Caracas)
  precio           numeric(10,2) not null default 50,
  precio_preventa  numeric(10,2) not null default 40,
  precio_cliente   numeric(10,2) not null default 40, -- clientes de la firma (20 %)
  cupo_guia        int not null default 30,           -- guías impresas garantizadas
  grupo_whatsapp   text,                              -- enlace de invitación al grupo del lote
  activa           boolean not null default false,    -- la que muestra la landing
  creado_en        timestamptz not null default now()
);
-- Una sola edición activa a la vez
create unique index if not exists uq_curso_edicion_activa on public.curso_ediciones (activa) where activa;

insert into public.curso_ediciones (id, nombre, activa)
values ('sabado-1', 'Sábado intensivo · Lote 1', true)
on conflict (id) do nothing;

-- ── Inscripciones ────────────────────────────────────────────────────────
create table if not exists public.curso_inscripciones (
  id              bigserial primary key,
  edicion_id      text not null references public.curso_ediciones(id),
  nombre          text not null,
  cedula          text,
  whatsapp        text not null,
  correo          text not null,
  empresa         text,
  cliente_firma   boolean not null default false,     -- dice ser cliente: Luis lo confirma al aprobar
  tarifa          text not null check (tarifa in ('preventa','cliente','regular')),
  monto_usd       numeric(10,2) not null,
  tasa_bcv        numeric(14,4),                       -- tasa usada para mostrar el monto en Bs
  monto_bs        numeric(14,2),
  metodo          text not null check (metodo in ('pago_movil','binance')),
  referencia      text not null,
  telefono_origen text,                                -- pago móvil: teléfono desde el que pagó
  monto_pagado    text,                                -- lo que la persona dice que pagó (texto libre)
  fecha_pago      date,
  comprobante     text,                                -- ruta en Storage (bucket comprobantes-curso)
  estado          text not null default 'pendiente' check (estado in ('pendiente','aprobado','rechazado')),
  resuelto_en     timestamptz,
  token           uuid not null default gen_random_uuid(),  -- va en los botones de Telegram
  origen          text,                                -- de dónde vino (?o=flyer, pendon, …)
  consentimiento  boolean not null default false,
  ip              text,
  user_agent      text,
  creado_en       timestamptz not null default now()
);
create index if not exists idx_curso_insc_edicion on public.curso_inscripciones (edicion_id, estado);
create index if not exists idx_curso_insc_correo on public.curso_inscripciones (lower(correo));

alter table public.curso_ediciones enable row level security;
alter table public.curso_inscripciones enable row level security;
drop policy if exists curso_ediciones_admin on public.curso_ediciones;
create policy curso_ediciones_admin on public.curso_ediciones for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());
drop policy if exists curso_inscripciones_admin on public.curso_inscripciones;
create policy curso_inscripciones_admin on public.curso_inscripciones for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());

-- ── La tarifa vigente de hoy (hora de Caracas) ───────────────────────────
create or replace function public.curso_hoy() returns date
language sql stable as $$ select (now() at time zone 'America/Caracas')::date $$;

-- ── 1 · Configuración pública para la landing ───────────────────────────
create or replace function public.curso_config() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e public.curso_ediciones;
  t numeric;
  preventa boolean;
  inscritos int;
begin
  select * into e from public.curso_ediciones where activa limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'sin_edicion'); end if;
  select tasa into t from public.tasas_cambio
   where moneda = 'USD' and fuente = 'BCV' and fecha <= public.curso_hoy()
   order by fecha desc limit 1;
  preventa := e.preventa_hasta is not null and public.curso_hoy() <= e.preventa_hasta;
  select count(*) into inscritos from public.curso_inscripciones
   where edicion_id = e.id and estado = 'aprobado';
  return jsonb_build_object(
    'ok', true,
    'edicion', e.id, 'nombre', e.nombre,
    'fecha', e.fecha, 'hora', e.hora, 'lugar', e.lugar,
    'preventa', preventa, 'preventa_hasta', e.preventa_hasta,
    'precio', e.precio, 'precio_preventa', e.precio_preventa, 'precio_cliente', e.precio_cliente,
    'precio_vigente', case when preventa then e.precio_preventa else e.precio end,
    'tasa_bcv', t,
    'cupo_guia', e.cupo_guia,
    'guias_restantes', greatest(e.cupo_guia - inscritos, 0)
  );
end $$;

-- ── 2 · Registrar una inscripción (la llama n8n) ─────────────────────────
-- La tarifa la calcula el servidor, no el navegador.
create or replace function public.curso_inscribir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.curso_ediciones;
  t numeric;
  v_tarifa text;
  v_monto numeric;
  v_cliente boolean := coalesce((p->>'cliente_firma')::boolean, false);
  v_metodo text := p->>'metodo';
  r public.curso_inscripciones;
  previas int;
begin
  select * into e from public.curso_ediciones where activa limit 1;
  if not found then raise exception 'No hay una edición del curso abierta'; end if;
  if coalesce(trim(p->>'nombre'), '') = '' or coalesce(trim(p->>'whatsapp'), '') = ''
     or coalesce(trim(p->>'correo'), '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or coalesce(trim(p->>'referencia'), '') = '' or v_metodo not in ('pago_movil','binance') then
    raise exception 'Datos incompletos';
  end if;

  if v_cliente then v_tarifa := 'cliente'; v_monto := e.precio_cliente;
  elsif e.preventa_hasta is not null and public.curso_hoy() <= e.preventa_hasta then v_tarifa := 'preventa'; v_monto := e.precio_preventa;
  else v_tarifa := 'regular'; v_monto := e.precio;
  end if;
  select tasa into t from public.tasas_cambio
   where moneda = 'USD' and fuente = 'BCV' and fecha <= public.curso_hoy()
   order by fecha desc limit 1;

  select count(*) into previas from public.curso_inscripciones
   where edicion_id = e.id and lower(correo) = lower(trim(p->>'correo')) and estado <> 'rechazado';

  insert into public.curso_inscripciones (edicion_id, nombre, cedula, whatsapp, correo, empresa, cliente_firma,
    tarifa, monto_usd, tasa_bcv, monto_bs, metodo, referencia, telefono_origen, monto_pagado, fecha_pago,
    origen, consentimiento, ip, user_agent)
  values (e.id, trim(p->>'nombre'), nullif(trim(p->>'cedula'), ''), trim(p->>'whatsapp'), lower(trim(p->>'correo')),
    nullif(trim(p->>'empresa'), ''), v_cliente, v_tarifa, v_monto, t, case when t is null then null else round(v_monto * t, 2) end,
    v_metodo, trim(p->>'referencia'), nullif(trim(p->>'telefono_origen'), ''), nullif(trim(p->>'monto_pagado'), ''),
    nullif(p->>'fecha_pago', '')::date, nullif(p->>'origen', ''), coalesce((p->>'consentimiento')::boolean, false),
    nullif(p->>'ip', ''), left(p->>'user_agent', 300))
  returning * into r;

  return jsonb_build_object('ok', true, 'id', r.id, 'token', r.token, 'edicion', e.id, 'edicion_nombre', e.nombre,
    'tarifa', r.tarifa, 'monto_usd', r.monto_usd, 'tasa_bcv', r.tasa_bcv, 'monto_bs', r.monto_bs,
    'repetida', previas > 0);
end $$;

-- Guardar la ruta del comprobante (después de subirlo a Storage)
create or replace function public.curso_comprobante(p_id bigint, p_token uuid, p_ruta text) returns void
language sql security definer set search_path = public as $$
  update public.curso_inscripciones set comprobante = p_ruta where id = p_id and token = p_token;
$$;

-- ── 3 · Aprobar o rechazar (botones de Telegram → n8n) ───────────────────
-- Solo con el token de esa inscripción y solo si sigue pendiente: un segundo
-- toque al botón no cambia nada y devuelve el estado que ya tenía.
create or replace function public.curso_resolver(p_id bigint, p_token uuid, p_aprobar boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.curso_inscripciones;
  e public.curso_ediciones;
  ya boolean := false;
begin
  select * into r from public.curso_inscripciones where id = p_id and token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_encontrada'); end if;
  if r.estado = 'pendiente' then
    update public.curso_inscripciones
       set estado = case when p_aprobar then 'aprobado' else 'rechazado' end, resuelto_en = now()
     where id = r.id returning * into r;
  else
    ya := true;
  end if;
  select * into e from public.curso_ediciones where id = r.edicion_id;
  return jsonb_build_object('ok', true, 'ya_resuelta', ya, 'estado', r.estado, 'id', r.id,
    'nombre', r.nombre, 'correo', r.correo, 'whatsapp', r.whatsapp, 'monto_usd', r.monto_usd, 'tarifa', r.tarifa,
    'edicion_nombre', e.nombre, 'fecha', e.fecha, 'hora', e.hora, 'lugar', e.lugar, 'grupo_whatsapp', e.grupo_whatsapp,
    'aprobados', (select count(*) from public.curso_inscripciones where edicion_id = e.id and estado = 'aprobado'));
end $$;

-- Solo n8n (service_role) puede llamarlas
revoke all on function public.curso_config() from public, anon, authenticated;
revoke all on function public.curso_inscribir(jsonb) from public, anon, authenticated;
revoke all on function public.curso_comprobante(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.curso_resolver(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.curso_config() to service_role;
grant execute on function public.curso_inscribir(jsonb) to service_role;
grant execute on function public.curso_comprobante(bigint, uuid, text) to service_role;
grant execute on function public.curso_resolver(bigint, uuid, boolean) to service_role;

-- ── Comprobantes: bucket privado ─────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-curso', 'comprobantes-curso', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- =============================================================
-- Para cada edición nueva (cuando haya fecha y lugar):
--   update curso_ediciones set activa = false where activa;
--   insert into curso_ediciones (id, nombre, fecha, lugar, preventa_hasta, grupo_whatsapp, activa)
--   values ('sabado-2', 'Sábado intensivo · Lote 2', '2026-12-05', 'Lugar', '2026-11-29', 'https://chat.whatsapp.com/…', true);
-- Para la primera, basta con completar sus datos:
--   update curso_ediciones set fecha = '…', lugar = '…', preventa_hasta = '…', grupo_whatsapp = '…' where id = 'sabado-1';
-- =============================================================
