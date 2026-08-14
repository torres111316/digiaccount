-- =============================================================
-- MODO DE DOCUMENTO POR EMPRESA  —  el interruptor de la homologación
--
-- 'recibo'  = como trabajan todas las empresas hoy. No cambia nada.
-- 'factura' = documentos inalterables: se corrigen SOLO con notas de crédito
--             o débito (Providencia SNAT/2024/000121, Art. 3 literal d).
--
-- POR QUÉ ARRANCA EN 'recibo' PARA TODOS
-- Ninguna cuenta que esté trabajando puede verse afectada por un cambio que
-- no pidió. El candado no aprieta hasta que alguien lo encienda, empresa por
-- empresa.
--
-- POR QUÉ LO ENCIENDE EL FUNDADOR Y NO EL CLIENTE
-- La Providencia SNAT/2024/000102 (Arts. 17 al 20) exige que CADA EMISOR
-- tenga su propia autorización del SENIAT, con solicitud, recaudos y 30 días
-- hábiles de respuesta. Si el cliente pudiera encenderlo solo, estaría
-- emitiendo facturas digitales sin autorización — y por la disposición final
-- quinta de la 000121, el proveedor del sistema responde como coautor.
-- El interruptor es, en la práctica, la constancia de que esa empresa ya
-- tiene su autorización.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- NOTA (14/08/2026): la Providencia SNAT/2024/000121 fue DEROGADA por la
-- SNAT/2026/00084, Gaceta Oficial 43.435 del 12/08/2026, sin norma que la
-- sustituya. Lo que sigue NO es obligatorio hoy. Se conserva porque el motivo
-- de ingeniería no dependía de la norma: un registro fiscal que se pueda
-- alterar en silencio es malo con providencia o sin ella. Y una derogatoria
-- sin reemplazo suele preceder a una norma nueva.
-- =============================================================

alter table public.empresas
  add column if not exists modo_doc text not null default 'recibo';

alter table public.empresas drop constraint if exists empresas_modo_doc_chk;
alter table public.empresas
  add constraint empresas_modo_doc_chk check (modo_doc in ('recibo', 'factura'));

-- Cuándo se autorizó y con qué providencia: va impreso en la factura
-- (000102 Art. 7, numeral 14 exige los datos de la autorización).
alter table public.empresas
  add column if not exists autorizada_desde date,
  add column if not exists autorizacion_seniat text;

-- -------------------------------------------------------------
-- Solo el fundador puede encender el modo factura.
--
-- El permiso se da POR COLUMNA, igual que en perfiles: sin esto, cualquier
-- administrador de una cuenta podría ponerse en modo factura desde la API y
-- empezar a emitir sin autorización del SENIAT.
-- -------------------------------------------------------------
revoke update (modo_doc, autorizada_desde, autorizacion_seniat)
  on public.empresas from authenticated;

drop policy if exists empresas_modo_doc_fundador on public.empresas;
create policy empresas_modo_doc_fundador on public.empresas for update to authenticated
  using (public.soy_superadmin())
  with check (public.soy_superadmin());

-- Se le devuelve el permiso SOLO al fundador. Como las políticas de RLS se
-- suman, la de arriba deja pasar al fundador y el grant de abajo le da la
-- columna; para todos los demás, la columna sigue sin permiso de escritura.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant update (modo_doc, autorizada_desde, autorizacion_seniat) on public.empresas to authenticated';
  end if;
end $$;

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- 1) Todas las empresas deben quedar en 'recibo':
-- select nombre, modo_doc, autorizada_desde from public.empresas order by nombre;
--
-- 2) Para encender una empresa (solo cuando tenga su autorización del SENIAT):
-- update public.empresas
--    set modo_doc = 'factura',
--        autorizada_desde = current_date,
--        autorizacion_seniat = 'SNAT/INTI/GRTI/... N° ...'
--  where id = '<uuid de la empresa>';
--
-- 3) Para devolverla a recibo si hiciera falta:
-- update public.empresas set modo_doc = 'recibo' where id = '<uuid>';
-- -------------------------------------------------------------
