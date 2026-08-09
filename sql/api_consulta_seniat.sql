-- =============================================================
-- API DE CONSULTA PARA EL SENIAT
--   Providencia SNAT/2024/000121, Art. 3 literal h:
--     "otorgar al SENIAT una clave de consulta con acceso al sistema, a la
--      INTERFAZ DE PROGRAMACIÓN DE APLICACIONES (API) y a las funcionalidades
--      sobre registros fiscales y de eventos"
--
-- LA CLAVE ES POR EMPRESA, NO UNA SOLA PARA TODO EL SISTEMA.
-- La Providencia 000102 autoriza a CADA EMISOR por separado, y DigiAccount
-- atiende a muchos contribuyentes en la misma base. Si el SENIAT fiscaliza a
-- la empresa X, no puede alcanzar los datos de la empresa Y. Una clave global
-- sería un hueco grande disfrazado de comodidad.
--
-- SOLO LECTURA POR CONSTRUCCIÓN.
-- No hay función que escriba. No es que estén "protegidas": es que no existen.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- Las claves. Se guarda el RESUMEN CRIPTOGRÁFICO, nunca la clave.
-- Ni el fundador puede recuperarla: si se pierde, se revoca y se emite otra.
-- Una clave que el proveedor puede leer no prueba nada sobre quién consultó.
-- -------------------------------------------------------------
create table if not exists public.claves_consulta (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresas(id),
  clave_hash   text not null,
  etiqueta     text not null,              -- p. ej. "SENIAT · Fiscalización 2026"
  creada_en    timestamptz not null default now(),
  creada_por   uuid,
  revocada_en  timestamptz,
  ultimo_uso   timestamptz,
  usos         integer not null default 0
);
create index if not exists claves_empresa on public.claves_consulta (empresa_id);

-- Registro de cada consulta. Es la contraparte del registro de eventos:
-- allí queda quién cambió algo; aquí, quién vino a mirar.
create table if not exists public.consultas_seniat (
  id             bigserial primary key,
  clave_id       uuid references public.claves_consulta(id),
  empresa_id     uuid,
  funcion        text not null,
  desde          date,
  hasta          date,
  filas          integer,
  consultado_en  timestamptz not null default now()
);
create index if not exists consultas_fecha on public.consultas_seniat (consultado_en desc);

alter table public.claves_consulta  enable row level security;
alter table public.consultas_seniat enable row level security;

-- Nadie escribe estas tablas desde una sesión de usuario. Las funciones de
-- abajo corren con privilegios propios y son las únicas que las tocan.
revoke all on public.claves_consulta  from anon, authenticated;
revoke all on public.consultas_seniat from anon, authenticated;

-- El dueño de la cuenta puede VER sus claves (nunca el valor) y quién consultó.
grant select (id, empresa_id, etiqueta, creada_en, revocada_en, ultimo_uso, usos)
  on public.claves_consulta to authenticated;
grant select on public.consultas_seniat to authenticated;

drop policy if exists claves_ver on public.claves_consulta;
create policy claves_ver on public.claves_consulta for select to authenticated
  using (exists (select 1 from public.empresas e
                  where e.id = empresa_id and e.cuenta_id = public.mi_cuenta_id())
         or public.soy_superadmin());

drop policy if exists consultas_ver on public.consultas_seniat;
create policy consultas_ver on public.consultas_seniat for select to authenticated
  using (exists (select 1 from public.empresas e
                  where e.id = empresa_id and e.cuenta_id = public.mi_cuenta_id())
         or public.soy_superadmin());

-- -------------------------------------------------------------
-- Emitir una clave. Solo el fundador: entregarle acceso al SENIAT es un acto
-- del proveedor del sistema, no del cliente.
-- Devuelve la clave EN CLARO una sola vez. Después ya no se puede recuperar.
-- -------------------------------------------------------------
create or replace function public.emitir_clave_consulta(p_empresa uuid, p_etiqueta text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_clave text;
begin
  if not public.soy_superadmin() then
    raise exception 'Solo el proveedor del sistema emite claves de consulta';
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa) then
    raise exception 'Esa empresa no existe';
  end if;

  -- 48 caracteres hexadecimales: suficiente para que no se adivine y todavía
  -- copiable de un correo.
  v_clave := encode(gen_random_bytes(24), 'hex');

  insert into public.claves_consulta (empresa_id, clave_hash, etiqueta, creada_por)
  values (p_empresa, encode(digest(v_clave, 'sha256'), 'hex'),
          coalesce(nullif(btrim(p_etiqueta), ''), 'Consulta SENIAT'), auth.uid());

  return v_clave;
end $$;

revoke all on function public.emitir_clave_consulta(uuid, text) from public, anon;
grant execute on function public.emitir_clave_consulta(uuid, text) to authenticated;

create or replace function public.revocar_clave_consulta(p_clave_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.soy_superadmin() then
    raise exception 'Solo el proveedor del sistema revoca claves de consulta';
  end if;
  update public.claves_consulta set revocada_en = now()
   where id = p_clave_id and revocada_en is null;
end $$;

revoke all on function public.revocar_clave_consulta(uuid) from public, anon;
grant execute on function public.revocar_clave_consulta(uuid) to authenticated;

-- -------------------------------------------------------------
-- Comprobar una clave y dejar constancia de la consulta.
-- Interna: no se expone.
-- -------------------------------------------------------------
create or replace function public.validar_clave(p_clave text, p_funcion text,
                                                p_desde date, p_hasta date, p_filas integer)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id      uuid;
  v_empresa uuid;
begin
  select id, empresa_id into v_id, v_empresa
    from public.claves_consulta
   where clave_hash = encode(digest(coalesce(p_clave, ''), 'sha256'), 'hex')
     and revocada_en is null;

  if v_id is null then
    raise exception 'Clave de consulta no válida o revocada'
      using errcode = 'insufficient_privilege';
  end if;

  update public.claves_consulta
     set ultimo_uso = now(), usos = usos + 1
   where id = v_id;

  insert into public.consultas_seniat (clave_id, empresa_id, funcion, desde, hasta, filas)
  values (v_id, v_empresa, p_funcion, p_desde, p_hasta, p_filas);

  return v_empresa;
end $$;

revoke all on function public.validar_clave(text, text, date, date, integer) from public, anon, authenticated;

-- -------------------------------------------------------------
-- LAS CONSULTAS
--
-- Cada una recibe la clave, comprueba a qué empresa pertenece y devuelve
-- SOLO los datos de esa empresa. El período es obligatorio: una fiscalización
-- se refiere a períodos, y obligar a acotarlo evita descargas completas
-- innecesarias.
-- -------------------------------------------------------------

-- A quién pertenece la clave. Lo primero que consultaría el SENIAT.
create or replace function public.seniat_empresa(p_clave text)
returns table (rif text, nombre text, condicion_fiscal text,
               modo_doc text, autorizada_desde date, autorizacion_seniat text)
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := public.validar_clave(p_clave, 'seniat_empresa', null, null, 1);
  return query
    select e.rif, e.nombre, e.condicion_fiscal, e.modo_doc, e.autorizada_desde, e.autorizacion_seniat
      from public.empresas e where e.id = v_empresa;
end $$;

-- Libro de ventas del período.
create or replace function public.seniat_libro_ventas(p_clave text, p_desde date, p_hasta date)
returns table (fecha text, periodo text, tercero_rif text, tercero_nombre text,
               numero_factura text, numero_control text, tipo_doc text,
               exento numeric, base_gen numeric, iva_gen numeric,
               base_red numeric, iva_red numeric, base_adic numeric, iva_adic numeric,
               iva numeric, igtf numeric, total numeric)
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := public.validar_clave(p_clave, 'seniat_libro_ventas', p_desde, p_hasta, null);
  return query
    select l.fecha, l.periodo, l.tercero_rif, l.tercero_nombre,
           l.numero_factura, l.numero_control, l.tipo_doc,
           l.exento, l.base_gen, l.iva_gen, l.base_red, l.iva_red,
           l.base_adic, l.iva_adic, l.iva, l.igtf, l.total
      from public.libro_fiscal l
     where l.empresa_id = v_empresa and l.tipo = 'venta'
       and l.periodo between to_char(p_desde, 'YYYY-MM') and to_char(p_hasta, 'YYYY-MM')
     order by l.periodo, l.numero_factura;
end $$;

-- Libro de compras del período.
create or replace function public.seniat_libro_compras(p_clave text, p_desde date, p_hasta date)
returns table (fecha text, periodo text, tercero_rif text, tercero_nombre text,
               numero_factura text, numero_control text, tipo_doc text,
               exento numeric, base_gen numeric, iva_gen numeric,
               base_red numeric, iva_red numeric, base_adic numeric, iva_adic numeric,
               iva numeric, total numeric)
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := public.validar_clave(p_clave, 'seniat_libro_compras', p_desde, p_hasta, null);
  return query
    select l.fecha, l.periodo, l.tercero_rif, l.tercero_nombre,
           l.numero_factura, l.numero_control, l.tipo_doc,
           l.exento, l.base_gen, l.iva_gen, l.base_red, l.iva_red,
           l.base_adic, l.iva_adic, l.iva, l.total
      from public.libro_fiscal l
     where l.empresa_id = v_empresa and l.tipo = 'compra'
       and l.periodo between to_char(p_desde, 'YYYY-MM') and to_char(p_hasta, 'YYYY-MM')
     order by l.periodo, l.fecha;
end $$;

-- Documentos emitidos: facturas y sus notas, con el vínculo entre ellas.
create or replace function public.seniat_documentos(p_clave text, p_desde date, p_hasta date)
returns table (tipo_doc text, numero text, control text, emitida_en timestamptz,
               cliente_rif text, cliente_nombre text,
               subtotal numeric, iva numeric, total numeric, estado text,
               corrige_a text, motivo text)
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := public.validar_clave(p_clave, 'seniat_documentos', p_desde, p_hasta, null);
  return query
    select f.tipo_doc, f.numero, f.control, f.emitida_en,
           f.cliente_rif, f.cliente_nombre,
           f.subtotal, f.iva, f.total, f.estado,
           orig.numero as corrige_a, f.motivo
      from public.facturas f
      left join public.facturas orig on orig.id = f.factura_afectada
     where f.empresa_id = v_empresa
       and f.emitida_en >= p_desde and f.emitida_en < (p_hasta + 1)
     order by f.emitida_en;
end $$;

-- Retenciones practicadas y sufridas.
create or replace function public.seniat_retenciones(p_clave text, p_desde date, p_hasta date)
returns table (tipo text, direccion text, comprobante text, fecha text, periodo text,
               tercero_rif text, tercero_nombre text, factura text,
               base numeric, pct numeric, monto numeric)
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := public.validar_clave(p_clave, 'seniat_retenciones', p_desde, p_hasta, null);
  return query
    select r.tipo, r.direccion, r.comprobante, r.fecha, r.periodo,
           r.tercero_rif, r.tercero_nombre, r.factura, r.base, r.pct, r.monto
      from public.retenciones r
     where r.empresa_id = v_empresa
       and r.periodo between to_char(p_desde, 'YYYY-MM') and to_char(p_hasta, 'YYYY-MM')
     order by r.periodo, r.comprobante;
end $$;

/* El registro de eventos. Es lo que exige expresamente el literal h:
   acceso "a los registros fiscales Y DE EVENTOS". Sin esto, la API estaría
   incompleta aunque devolviera todos los libros. */
create or replace function public.seniat_eventos(p_clave text, p_desde date, p_hasta date)
returns table (ocurrido_en timestamptz, accion text, tabla text,
               registro_id text, usuario_id uuid, antes jsonb, despues jsonb)
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  v_empresa := public.validar_clave(p_clave, 'seniat_eventos', p_desde, p_hasta, null);
  return query
    select ev.ocurrido_en, ev.accion, ev.tabla, ev.registro_id, ev.usuario_id, ev.antes, ev.despues
      from public.eventos_sistema ev
     where ev.empresa_id = v_empresa
       and ev.ocurrido_en >= p_desde and ev.ocurrido_en < (p_hasta + 1)
     order by ev.ocurrido_en;
end $$;

-- Las consultas se ejecutan con la clave anónima MÁS la clave de consulta:
-- el SENIAT no necesita usuario en el sistema, y la clave sola no abre nada
-- que no sea de su empresa.
do $$
declare f text;
begin
  foreach f in array array[
    'seniat_empresa(text)',
    'seniat_libro_ventas(text,date,date)',
    'seniat_libro_compras(text,date,date)',
    'seniat_documentos(text,date,date)',
    'seniat_retenciones(text,date,date)',
    'seniat_eventos(text,date,date)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- -------------------------------------------------------------
-- CÓMO SE USA
--
-- 1) Emitir la clave para una empresa (solo el fundador, desde el editor SQL
--    o desde el panel). Se muestra UNA sola vez:
--
-- select public.emitir_clave_consulta('<uuid de la empresa>', 'SENIAT · Fiscalización 2026');
--
-- 2) El SENIAT consulta por HTTP. Ejemplo del libro de ventas:
--
-- POST https://<proyecto>.supabase.co/rest/v1/rpc/seniat_libro_ventas
-- Headers: apikey: <clave anónima pública>
--          Content-Type: application/json
-- Body:    { "p_clave": "<la clave entregada>",
--            "p_desde": "2026-01-01", "p_hasta": "2026-12-31" }
--
-- 3) Ver quién ha consultado:
-- select * from public.consultas_seniat order by consultado_en desc limit 50;
--
-- 4) Revocar:
-- select public.revocar_clave_consulta('<uuid de la clave>');
-- -------------------------------------------------------------
