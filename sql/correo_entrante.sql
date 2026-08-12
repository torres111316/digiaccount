-- =============================================================
-- CORREO DE ENTRADA · facturas@torresyasociados.digiaccount.io
--
-- Una sola dirección para toda la firma. Lo que llega ahí no entra al libro:
-- cae en una BANDEJA de pendientes y espera aprobación humana.
--
-- Esto no es prudencia de más. La Providencia 000121 hace al proveedor del
-- sistema coautor de defraudación si el sistema PERMITE alterar un documento
-- fiscal. Un correo de un desconocido que escriba directo en libro_fiscal
-- sería exactamente eso. Por eso la bandeja es una tabla aparte y el paso a
-- los libros lo da una persona.
--
-- CÓMO SE IDENTIFICA LA EMPRESA
--   La dirección es una sola, así que el destino ya no dice de quién es el
--   documento. Se usan dos señales independientes:
--     1. El REMITENTE, contra los correos autorizados de cada empresa
--     2. El RIF DEL RECEPTOR leído en el documento
--   Las dos coinciden  -> se asigna sola
--   Solo una           -> se propone, decide el contador
--   Ninguna            -> queda sin empresa, en la bandeja "Sin asignar"
--   Es la misma regla del cruce de cobros: una sola señal nunca asigna.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

-- -------------------------------------------------------------
-- 1 · QUÉ CORREOS IDENTIFICAN A CADA EMPRESA
-- -------------------------------------------------------------
create table if not exists public.correos_empresa (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  -- Siempre en minúsculas: el correo no distingue mayúsculas y comparar
  -- "Admin@" contra "admin@" sería un fallo silencioso de enrutamiento.
  correo      text not null,
  -- 'cliente'   el propio cliente reenviando
  -- 'proveedor' un proveedor que manda directo a la dirección
  rol         text not null default 'cliente',
  nota        text,
  creado_en   timestamptz not null default now(),
  constraint correos_empresa_rol_chk check (rol in ('cliente', 'proveedor')),
  constraint correos_empresa_fmt_chk check (correo = lower(correo) and correo like '%@%.%')
);

-- Un mismo correo no puede identificar a dos empresas: sería ambiguo justo
-- donde el enrutamiento tiene que ser certero.
create unique index if not exists correos_empresa_unico
  on public.correos_empresa (lower(correo));

create index if not exists correos_empresa_por_empresa
  on public.correos_empresa (empresa_id);

-- -------------------------------------------------------------
-- 2 · LA BANDEJA DE ENTRADA
-- -------------------------------------------------------------
create table if not exists public.documentos_entrantes (
  id            uuid primary key default gen_random_uuid(),
  -- La cuenta SIEMPRE se conoce (es la firma dueña del buzón).
  cuenta_id     uuid not null references public.cuentas(id) on delete cascade,
  -- La empresa puede no conocerse todavía: por eso admite null.
  empresa_id    uuid references public.empresas(id) on delete set null,

  origen        text not null default 'correo',
  remitente     text,
  asunto        text,
  recibido_en   timestamptz not null default now(),

  -- El archivo tal como llegó, en el bucket 'documentos-fiscales'.
  archivo_path  text,
  archivo_nombre text,
  archivo_tipo  text,

  -- Qué creyó María que es y qué le sacó.
  tipo_detectado text not null default 'desconocido',
  datos         jsonb not null default '{}'::jsonb,

  -- Cómo se identificó la empresa. Se guarda para poder auditar después por
  -- qué un documento fue a parar a una empresa y no a otra.
  senal         text not null default 'ninguna',

  estado        text not null default 'pendiente',
  -- Una vez aprobado, a qué registro del libro dio origen.
  libro_id      uuid references public.libro_fiscal(id) on delete set null,
  aprobado_por  uuid references auth.users(id) on delete set null,
  aprobado_en   timestamptz,
  motivo        text,

  -- Huella del archivo, para no registrar dos veces la misma factura cuando
  -- el proveedor la reenvía o el cliente la manda además por WhatsApp.
  huella        text,

  constraint doc_ent_origen_chk check (origen in ('correo', 'whatsapp', 'app')),
  constraint doc_ent_tipo_chk check (tipo_detectado in (
    'factura_compra', 'factura_venta', 'comprobante_retencion',
    'nota_credito', 'nota_debito', 'extracto_banco', 'desconocido')),
  constraint doc_ent_senal_chk check (senal in (
    'remitente+rif', 'remitente', 'rif', 'conflicto', 'manual', 'ninguna')),
  constraint doc_ent_estado_chk check (estado in (
    'pendiente', 'aprobado', 'descartado', 'duplicado')),
  -- Un documento aprobado tiene que decir quién lo aprobó y cuándo. Sin eso
  -- no hay rastro de quién dejó entrar qué a los libros.
  constraint doc_ent_aprobado_chk check (
    estado <> 'aprobado' or (aprobado_por is not null and aprobado_en is not null))
);

create index if not exists doc_ent_bandeja
  on public.documentos_entrantes (cuenta_id, estado, recibido_en desc);
create index if not exists doc_ent_por_empresa
  on public.documentos_entrantes (empresa_id, estado);
-- La huella solo tiene que ser única entre lo que aún no se ha descartado.
create unique index if not exists doc_ent_huella_unica
  on public.documentos_entrantes (cuenta_id, huella)
  where huella is not null and estado in ('pendiente', 'aprobado');

-- -------------------------------------------------------------
-- 3 · SEGURIDAD
-- -------------------------------------------------------------
alter table public.correos_empresa enable row level security;
drop policy if exists "tenant_correos_empresa" on public.correos_empresa;
create policy "tenant_correos_empresa" on public.correos_empresa for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

alter table public.documentos_entrantes enable row level security;
drop policy if exists "tenant_documentos_entrantes" on public.documentos_entrantes;
create policy "tenant_documentos_entrantes" on public.documentos_entrantes for all
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin())
  with check (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

-- -------------------------------------------------------------
-- 4 · A QUIÉN PERTENECE UN CORREO
--
-- La usa el flujo de n8n al recibir. Devuelve la empresa y con qué señal se
-- llegó a ella, para que quede registrado en el documento.
-- -------------------------------------------------------------
create or replace function public.empresa_por_correo(
  p_cuenta uuid,
  p_remitente text,
  p_rif_receptor text default null
) returns table (empresa_id uuid, senal text)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_rem uuid;   -- empresa según el remitente
  v_rif uuid;   -- empresa según el RIF del receptor leído en el documento
begin
  select ce.empresa_id into v_rem
    from public.correos_empresa ce
    join public.empresas e on e.id = ce.empresa_id
   where e.cuenta_id = p_cuenta
     and ce.correo = lower(trim(coalesce(p_remitente, '')))
   limit 1;

  if p_rif_receptor is not null and length(trim(p_rif_receptor)) > 0 then
    select e.id into v_rif
      from public.empresas e
     where e.cuenta_id = p_cuenta
       -- Se comparan solo los alfanuméricos: los RIF se escriben con y sin
       -- guion, y esa diferencia no debe romper el enrutamiento.
       and regexp_replace(upper(coalesce(e.rif, '')), '[^A-Z0-9]', '', 'g')
         = regexp_replace(upper(p_rif_receptor), '[^A-Z0-9]', '', 'g')
     limit 1;
  end if;

  if v_rem is not null and v_rif is not null and v_rem = v_rif then
    -- Doble señal coincidente: la única que permite asignar sola.
    return query select v_rem, 'remitente+rif'::text;
  elsif v_rem is not null and v_rif is not null then
    /* Las dos señales se CONTRADICEN: el remitente dice una empresa y el RIF
       del documento dice otra. Eso no es "una señal": es un aviso. Se
       devuelve la del remitente para no perder la pista, marcada como
       conflicto para que nunca se apruebe sin que alguien la mire. */
    return query select v_rem, 'conflicto'::text;
  elsif v_rem is not null then
    return query select v_rem, 'remitente'::text;
  elsif v_rif is not null then
    return query select v_rif, 'rif'::text;
  else
    return query select null::uuid, 'ninguna'::text;
  end if;
end;
$fn$;

/* SOLO service_role. La función es SECURITY DEFINER y recibe la cuenta como
   parámetro: si un usuario cualquiera pudiera llamarla, podría pasarle la
   cuenta de OTRA firma y averiguar qué correos y RIF tiene registrados.
   El único que la necesita es el flujo de n8n, que corre con service_role. */
revoke all on function public.empresa_por_correo(uuid, text, text) from public;
revoke all on function public.empresa_por_correo(uuid, text, text) from authenticated;
grant execute on function public.empresa_por_correo(uuid, text, text) to service_role;

-- -------------------------------------------------------------
-- CÓMO DESACTIVARLO
--
-- Nada de esto corre dentro de una operación existente, así que no puede
-- hacer fallar un guardado. Para apagarlo basta con dejar de alimentar la
-- bandeja desde n8n. Si además hay que quitarlo:
--
--   drop function if exists public.empresa_por_correo(uuid, text, text);
--   drop table if exists public.documentos_entrantes;
--   drop table if exists public.correos_empresa;
--
-- (Eso borra la bandeja y los correos registrados; los libros no se tocan.)
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- COMPROBACIÓN
-- select * from public.empresa_por_correo(
--          (select id from public.cuentas limit 1),
--          'admin@shadday.com', 'J-40123456-7');
--
-- select estado, count(*) from public.documentos_entrantes group by estado;
-- -------------------------------------------------------------
