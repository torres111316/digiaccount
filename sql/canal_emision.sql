-- =============================================================
-- CANAL DE EMISIÓN EN EL LIBRO
--
-- El libro no decía POR DÓNDE se emitió cada documento. Para la homologación
-- eso hace falta: un libro de ventas tiene que poder responder si una
-- operación salió por forma libre de imprenta, por factura electrónica o por
-- máquina fiscal — cada una con su régimen.
--
-- POR QUÉ NO ES LO MISMO QUE empresas.medio_emision
--   La preferencia de la empresa dice cómo emite HOY. El libro tiene que
--   decir cómo se emitió ENTONCES. Una empresa que pase de forma libre a
--   electrónica no puede reescribir su pasado, así que el canal se congela
--   en cada documento en el momento de registrarlo.
--
-- EL VALOR 'recibo'
--   empresas.modo_doc arranca en 'recibo' para todas: hoy el sistema emite
--   recibos, no facturas fiscales. Un recibo no tiene canal de emisión fiscal
--   porque no es un documento fiscal. Decir que salió "por forma libre" sería
--   falso. Por eso 'recibo' es un valor propio y no una ausencia.
--
-- LAS FILAS VIEJAS QUEDAN EN null
--   No se rellenan. Poner el canal de hoy sobre documentos de antes sería
--   afirmar algo que nadie comprobó. null se lee como "anterior al registro
--   del canal", que es la verdad.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

alter table public.libro_fiscal
  add column if not exists canal text;

alter table public.libro_fiscal drop constraint if exists libro_canal_chk;
alter table public.libro_fiscal
  add constraint libro_canal_chk check (canal is null or canal in (
    'recibo',          -- documento no fiscal: la empresa está en modo recibo
    'forma-libre',     -- factura de imprenta autorizada
    'electronica',     -- factura electrónica
    'maquina-fiscal'   -- máquina fiscal
  ));

comment on column public.libro_fiscal.canal is
  'Cómo se emitió el documento, congelado al registrarlo. null = anterior al registro del canal.';

-- -------------------------------------------------------------
-- QUÉ CANAL LE CORRESPONDE HOY A UNA EMPRESA
--
-- Una sola función para que el disparador y cualquier consulta usen el mismo
-- criterio. Si esto viviera duplicado en la pantalla y en la base, algún día
-- dirían cosas distintas.
-- -------------------------------------------------------------
create or replace function public.canal_de_emision(p_empresa uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
           when e.modo_doc = 'factura'
             then coalesce(nullif(e.medio_emision, ''), 'forma-libre')
           else 'recibo'
         end
    from public.empresas e
   where e.id = p_empresa;
$$;

-- -------------------------------------------------------------
-- SE LLENA SOLO AL REGISTRAR UNA VENTA
--
-- Va en la base y no en la pantalla a propósito. La pantalla se puede saltar
-- llamando a la API directamente; el disparador no. Es el mismo criterio que
-- inalterabilidad.sql y eventos_sistema.sql.
--
-- Solo VENTAS: el canal de una compra es el del PROVEEDOR, no el nuestro, y
-- eso se lee del documento recibido — no se puede deducir de nuestra ficha.
-- -------------------------------------------------------------
create or replace function public.tg_canal_venta()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.canal is null and NEW.tipo = 'venta' and NEW.empresa_id is not null then
    NEW.canal := public.canal_de_emision(NEW.empresa_id);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_canal_venta on public.libro_fiscal;
create trigger trg_canal_venta
  before insert on public.libro_fiscal
  for each row execute function public.tg_canal_venta();

revoke all on function public.canal_de_emision(uuid) from public;
grant execute on function public.canal_de_emision(uuid) to authenticated, service_role;


-- -------------------------------------------------------------
-- LA API DEL SENIAT LO ENTREGA
--
-- Es el punto de todo esto: que un fiscal pueda preguntar por dónde salió
-- cada documento. Se redefine la función completa porque en PostgreSQL no se
-- puede agregar una columna al RETURNS TABLE de una función existente.
-- -------------------------------------------------------------
drop function if exists public.seniat_libro_ventas(text, date, date);
create or replace function public.seniat_libro_ventas(p_clave text, p_desde date, p_hasta date)
returns table (fecha text, periodo text, tercero_rif text, tercero_nombre text,
               numero_factura text, numero_control text, tipo_doc text, canal text,
               exento numeric, base_gen numeric, iva_gen numeric,
               base_red numeric, iva_red numeric, base_adic numeric, iva_adic numeric,
               iva numeric, igtf numeric, total numeric)
language plpgsql security definer set search_path = public as $fn$
declare v_empresa uuid;
begin
  v_empresa := public.validar_clave(p_clave, 'seniat_libro_ventas', p_desde, p_hasta, null);
  return query
    select l.fecha, l.periodo, l.tercero_rif, l.tercero_nombre,
           l.numero_factura, l.numero_control, l.tipo_doc, l.canal,
           l.exento, l.base_gen, l.iva_gen, l.base_red, l.iva_red,
           l.base_adic, l.iva_adic, l.iva, l.igtf, l.total
      from public.libro_fiscal l
     where l.empresa_id = v_empresa and l.tipo = 'venta'
       and l.periodo between to_char(p_desde, 'YYYY-MM') and to_char(p_hasta, 'YYYY-MM')
     order by l.periodo, l.numero_factura;
end $fn$;

-- Mismos permisos que tenía antes de redefinirla (api_consulta_seniat.sql los
-- otorga en bloque a anon y authenticated). Al hacer DROP se pierden, así que
-- hay que volver a ponerlos exactamente iguales: ni más ni menos.
revoke all on function public.seniat_libro_ventas(text, date, date) from public;
grant execute on function public.seniat_libro_ventas(text, date, date) to anon, authenticated;

-- -------------------------------------------------------------
-- CÓMO DESACTIVARLO
--
-- El disparador corre DENTRO del guardado de una venta: si fallara, fallaría
-- el guardado. Para apagarlo sin perder nada:
--
--   drop trigger if exists trg_canal_venta on public.libro_fiscal;
--
-- La columna y lo ya registrado quedan intactos. Para quitarlo del todo:
--
--   drop function if exists public.tg_canal_venta();
--   drop function if exists public.canal_de_emision(uuid);
--   alter table public.libro_fiscal drop constraint if exists libro_canal_chk;
--   alter table public.libro_fiscal drop column if exists canal;
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- Qué canal le toca hoy a cada empresa:
--   select nombre, modo_doc, medio_emision, public.canal_de_emision(id) as canal
--     from public.empresas order by nombre;
--
-- Cómo quedó repartido el libro (las viejas salen en null):
--   select tipo, coalesce(canal, '— sin registrar —') as canal, count(*)
--     from public.libro_fiscal group by 1, 2 order by 1, 2;
-- -------------------------------------------------------------
