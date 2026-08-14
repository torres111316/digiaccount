-- =============================================================
-- REGISTRO DE EVENTOS  —  Providencia SNAT/2024/000121, Art. 3
--
--   literal c: "registro de eventos automático (en el momento en que se
--               producen: interacciones, operaciones, sucesos)"
--   literal e: "seguimiento claro y fiable; todo registro fechado con hora"
--   literal a: trazabilidad e inalterabilidad de los registros
--
-- POR QUÉ CON DISPARADORES Y NO DESDE LA APLICACIÓN
-- Un registro que escribe el navegador se salta entrando por la API con un
-- token válido: bastaría un cliente de PostgREST y no quedaría rastro. El
-- disparador vive dentro de la base y se dispara venga de donde venga la
-- operación —la app, la API, el editor SQL, n8n—. Esa es la diferencia
-- entre "automático" y "automático mientras usen la pantalla".
--
-- POR QUÉ ESTO PROTEGE A DIGIACCOUNT
-- La disposición final QUINTA de la 000121 hace al proveedor del sistema
-- COAUTOR de defraudación tributaria si sus clientes lo usan para alterar
-- registros. El log es la prueba de qué hizo cada quién y cuándo.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- NOTA (14/08/2026): la Providencia SNAT/2024/000121 fue DEROGADA por la
-- SNAT/2026/00084, Gaceta Oficial 43.435 del 12/08/2026, sin norma que la
-- sustituya. Lo que sigue NO es obligatorio hoy. Se conserva porque el motivo
-- de ingeniería no dependía de la norma: un registro fiscal que se pueda
-- alterar en silencio es malo con providencia o sin ella. Y una derogatoria
-- sin reemplazo suele preceder a una norma nueva.
-- =============================================================

create table if not exists public.eventos_sistema (
  id          bigserial primary key,
  ocurrido_en timestamptz not null default now(),   -- Art. 3.e: fechado con hora
  usuario_id  uuid,                                  -- quién (auth.uid en el momento del hecho)
  cuenta_id   uuid,                                  -- de qué cuenta
  empresa_id  uuid,                                  -- de qué empresa, cuando la fila la tiene
  accion      text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  tabla       text not null,
  registro_id text,
  antes       jsonb,                                 -- estado previo (UPDATE y DELETE)
  despues     jsonb                                  -- estado nuevo (INSERT y UPDATE)
);

create index if not exists eventos_fecha   on public.eventos_sistema (ocurrido_en desc);
create index if not exists eventos_cuenta  on public.eventos_sistema (cuenta_id, ocurrido_en desc);
create index if not exists eventos_registro on public.eventos_sistema (tabla, registro_id);

-- -------------------------------------------------------------
-- El disparador. Corre con privilegios para poder escribir en una tabla
-- donde NADIE más puede escribir.
-- -------------------------------------------------------------
create or replace function public.tg_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_antes   jsonb;
  v_despues jsonb;
begin
  if TG_OP = 'DELETE' then
    v_antes := to_jsonb(OLD); v_despues := null;
  elsif TG_OP = 'UPDATE' then
    v_antes := to_jsonb(OLD); v_despues := to_jsonb(NEW);
  else
    v_antes := null; v_despues := to_jsonb(NEW);
  end if;

  insert into public.eventos_sistema
    (usuario_id, cuenta_id, empresa_id, accion, tabla, registro_id, antes, despues)
  values (
    auth.uid(),
    nullif(coalesce(v_despues->>'cuenta_id',  v_antes->>'cuenta_id'),  '')::uuid,
    nullif(coalesce(v_despues->>'empresa_id', v_antes->>'empresa_id'), '')::uuid,
    TG_OP, TG_TABLE_NAME,
    coalesce(v_despues->>'id', v_antes->>'id'),
    v_antes, v_despues
  );

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

-- -------------------------------------------------------------
-- Se enganchan las tablas que el SENIAT puede pedir: los documentos y
-- registros fiscales, más la identidad fiscal de la empresa (cambiarle el
-- RIF o la condición a una empresa cambia lo que declara).
--
-- El bucle evita catorce bloques repetidos y, sobre todo, evita que a
-- alguien se le olvide una tabla al copiar y pegar.
-- -------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array[
    'libro_fiscal', 'facturas', 'retenciones', 'asientos',
    'documentos_fiscales', 'empresas', 'recibos_nomina', 'movimientos_tesoreria'
  ];
begin
  foreach t in array tablas loop
    -- Solo si la tabla existe: así este archivo corre igual en una base
    -- que todavía no tenga alguno de los módulos.
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = t) then
      execute format('drop trigger if exists trg_auditar on public.%I', t);
      execute format(
        'create trigger trg_auditar after insert or update or delete on public.%I
           for each row execute function public.tg_auditar()', t);
      raise notice 'auditoría activada en %', t;
    else
      raise notice 'tabla % no existe todavía, se omite', t;
    end if;
  end loop;
end $$;

-- -------------------------------------------------------------
-- SEGURIDAD DEL LOG
--
-- Se puede LEER (cada quien lo suyo) pero NADIE puede escribirlo, cambiarlo
-- ni borrarlo desde la aplicación: el único que escribe es el disparador,
-- que corre con privilegios propios.
--
-- Un registro de eventos que el usuario puede editar no es un registro de
-- eventos. Sin esta parte, todo lo de arriba es decorativo.
-- -------------------------------------------------------------
alter table public.eventos_sistema enable row level security;

revoke all on public.eventos_sistema from anon, authenticated;
grant select on public.eventos_sistema to authenticated;
revoke all on sequence public.eventos_sistema_id_seq from anon, authenticated;

drop policy if exists eventos_ver on public.eventos_sistema;
create policy eventos_ver on public.eventos_sistema for select to authenticated
  using (cuenta_id = public.mi_cuenta_id() or public.soy_superadmin());

-- No hay política de INSERT, UPDATE ni DELETE, y es deliberado: sin política
-- y sin permiso, ninguna sesión de usuario puede tocar esta tabla.

-- -------------------------------------------------------------
-- COMPROBACIÓN (descomentar y correr después)
--
-- 1) ¿Quedaron los disparadores puestos?
--
--    OJO: information_schema.triggers devuelve UNA FILA POR EVENTO, así que un
--    disparador declarado "after insert or update or delete" aparece TRES veces
--    por tabla. No están repetidos. Esta consulta los agrupa para que se lean
--    las 8 tablas de una vez, cada una con sus tres eventos:
--
-- select event_object_table as tabla,
--        string_agg(event_manipulation, ', ' order by event_manipulation) as eventos
--   from information_schema.triggers
--  where trigger_schema = 'public' and trigger_name = 'trg_auditar'
--  group by event_object_table
--  order by tabla;
--
-- 2) ¿Está grabando? Registra o edita cualquier factura y corre:
-- select ocurrido_en, accion, tabla, registro_id
--   from public.eventos_sistema order by ocurrido_en desc limit 10;
-- -------------------------------------------------------------

-- =============================================================
-- CÓMO DESACTIVARLO SI ALGO MOLESTA
--
-- Este archivo NO borra ni modifica un solo dato existente: solo agrega una
-- tabla, una función y disparadores. Pero un disparador se ejecuta DENTRO de
-- cada operación, así que si fallara, fallaría también la operación.
--
-- Por eso queda escrito aquí el botón de emergencia. Quita los disparadores
-- y todo vuelve a comportarse exactamente como antes, con el historial ya
-- grabado intacto. No hace falta reinstalar nada ni tocar la aplicación:
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['libro_fiscal','facturas','retenciones','asientos',
--                            'documentos_fiscales','empresas','recibos_nomina',
--                            'movimientos_tesoreria'] loop
--     execute format('drop trigger if exists trg_auditar on public.%I', t);
--   end loop;
-- end $$;
--
-- Para volver a activarlos, se corre este archivo otra vez.
-- =============================================================
