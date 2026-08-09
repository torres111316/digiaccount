-- =============================================================
-- INALTERABILIDAD EN MODO FACTURA
--   Providencia SNAT/2024/000121, Art. 3:
--     literal a: "inalterabilidad e inviolabilidad de los registros"
--     literal d: "corrección o anulación de factura ÚNICAMENTE mediante
--                 notas de débito o crédito"
--
-- SOLO APLICA A LAS EMPRESAS EN modo_doc = 'factura'.
-- Una empresa en modo 'recibo' —o sea, todas hasta que el fundador encienda
-- alguna— no nota absolutamente ningún cambio.
--
-- POR QUÉ EN LA BASE Y NO EN LA PANTALLA
-- Una validación de pantalla se salta entrando por la API con un token
-- válido. Y la disposición final QUINTA de la 000121 no dice "si el sistema
-- alteró registros": dice que el proveedor responde como coautor si el
-- sistema PERMITE alterarlos. La diferencia entre esconder un botón y cerrar
-- la puerta es exactamente esa.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

-- ¿Esta empresa emite facturas digitales?
create or replace function public.en_modo_factura(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select modo_doc from public.empresas where id = p_empresa), 'recibo') = 'factura'
$$;

-- -------------------------------------------------------------
-- 1) Registros que NO se pueden borrar ni modificar en modo factura.
--    Se usa en retenciones y documentos_fiscales: son documentos que la
--    empresa emite o conserva, no registros de documentos ajenos.
-- -------------------------------------------------------------
create or replace function public.tg_inalterable() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
begin
  if TG_OP = 'DELETE' then v_empresa := OLD.empresa_id; else v_empresa := NEW.empresa_id; end if;

  if not public.en_modo_factura(v_empresa) then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  raise exception
    'Esta empresa emite FACTURAS DIGITALES: sus registros fiscales no se pueden %. Para corregir o anular, emite una nota de crédito o de débito.',
    case TG_OP when 'DELETE' then 'eliminar' else 'modificar' end
    using errcode = 'check_violation';
end $$;

-- -------------------------------------------------------------
-- 2) El Libro Fiscal se trata distinto según de quién sea el documento.
--
--    VENTAS: las facturas las emite ESTA empresa. Inalterables — se corrigen
--    con notas, como manda el literal d.
--
--    COMPRAS: el documento es del PROVEEDOR; el libro es el registro de un
--    documento ajeno. Si se escribió mal un RIF, la factura del proveedor
--    está perfecta y lo que hay que corregir es el registro. Obligar a una
--    nota de crédito ahí sería absurdo: la nota tendría que emitirla el
--    proveedor, no nosotros. La corrección se permite, y el registro de
--    eventos guarda el antes y el después.
--
--    Borrar NO se permite en ninguno de los dos casos: un libro fiscal con
--    filas desaparecidas deja de ser un libro.
-- -------------------------------------------------------------
create or replace function public.tg_inalterable_libro() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
  v_tipo    text;
begin
  /* El tipo se lee SIEMPRE de OLD, incluso al modificar. Si se leyera de
     NEW, bastaría cambiar el tipo de 'venta' a 'compra' en la misma
     sentencia para saltarse el candado. */
  if TG_OP = 'DELETE' then v_empresa := OLD.empresa_id; else v_empresa := NEW.empresa_id; end if;
  v_tipo := OLD.tipo;

  if not public.en_modo_factura(v_empresa) then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'DELETE' then
    raise exception
      'Esta empresa emite FACTURAS DIGITALES: no se puede eliminar un registro del libro fiscal. Anúlalo o corrígelo, pero la fila queda.'
      using errcode = 'check_violation';
  end if;

  if v_tipo = 'venta' then
    raise exception
      'Esta empresa emite FACTURAS DIGITALES: una venta registrada no se modifica. Emite una nota de crédito o de débito sobre esa factura.'
      using errcode = 'check_violation';
  end if;

  -- Compra: se deja corregir. El log guarda el antes y el después.
  return NEW;
end $$;

-- -------------------------------------------------------------
-- 3) La factura emitida: solo puede cambiar su ESTADO (por cobrar → cobrada).
--    El documento en sí —montos, cliente, renglones, número— queda firme.
--
--    Es lo que distingue "el documento no cambia" de "nada puede pasar":
--    que le paguen una factura no altera la factura.
-- -------------------------------------------------------------
create or replace function public.tg_inalterable_factura() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
begin
  if TG_OP = 'DELETE' then v_empresa := OLD.empresa_id; else v_empresa := NEW.empresa_id; end if;

  if not public.en_modo_factura(v_empresa) then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'DELETE' then
    raise exception
      'Esta empresa emite FACTURAS DIGITALES: un documento emitido no se elimina. Emite una nota de crédito para anularlo.'
      using errcode = 'check_violation';
  end if;

  /* Se compara el documento completo ignorando el estado. Si algo más
     cambió, se rechaza. Comparar así —y no columna por columna— evita que
     una columna nueva quede sin proteger el día que se agregue. */
  if (to_jsonb(OLD) - 'estado') is distinct from (to_jsonb(NEW) - 'estado') then
    raise exception
      'Esta empresa emite FACTURAS DIGITALES: el documento % no se modifica. Emite una nota de crédito o de débito.', OLD.numero
      using errcode = 'check_violation';
  end if;

  /* El estado puede moverse (por cobrar → cobrada), pero NO a 'Anulada'.
     Sin esto quedaba el hueco por el que entró todo esto: dejar el documento
     intacto y anularlo cambiándole el estado es anular sin nota, que es
     precisamente lo que prohíbe el literal d. */
  if NEW.estado ILIKE 'anulad%' and OLD.estado IS DISTINCT FROM NEW.estado then
    raise exception
      'Esta empresa emite FACTURAS DIGITALES: la factura % no se anula cambiándole el estado. Emite una nota de crédito.', OLD.numero
      using errcode = 'check_violation';
  end if;

  return NEW;
end $$;

-- -------------------------------------------------------------
-- Se enganchan los disparadores.
-- -------------------------------------------------------------
do $$
declare t text;
begin
  -- Documentos propios: ni borrar ni modificar
  foreach t in array array['retenciones', 'documentos_fiscales'] loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = t) then
      execute format('drop trigger if exists trg_inalterable on public.%I', t);
      execute format(
        'create trigger trg_inalterable before update or delete on public.%I
           for each row execute function public.tg_inalterable()', t);
      raise notice 'inalterabilidad activada en %', t;
    end if;
  end loop;
end $$;

drop trigger if exists trg_inalterable on public.libro_fiscal;
create trigger trg_inalterable before update or delete on public.libro_fiscal
  for each row execute function public.tg_inalterable_libro();

drop trigger if exists trg_inalterable on public.facturas;
create trigger trg_inalterable before update or delete on public.facturas
  for each row execute function public.tg_inalterable_factura();

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- 1) ¿Quedaron puestos?
-- select event_object_table as tabla,
--        string_agg(event_manipulation, ', ' order by event_manipulation) as eventos
--   from information_schema.triggers
--  where trigger_schema = 'public' and trigger_name = 'trg_inalterable'
--  group by event_object_table order by tabla;
--   → esperado: facturas, libro_fiscal, retenciones, documentos_fiscales
--
-- 2) Con una empresa en modo 'recibo' (todas hoy): eliminar y editar
--    funcionan exactamente como siempre. Nada cambió.
--
-- 3) Con una empresa en modo 'factura': intentar borrar del libro debe dar
--    el mensaje en español, no un error técnico.
-- -------------------------------------------------------------

-- =============================================================
-- CÓMO DESACTIVARLO SI ALGO MOLESTA
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['retenciones','documentos_fiscales','libro_fiscal','facturas'] loop
--     execute format('drop trigger if exists trg_inalterable on public.%I', t);
--   end loop;
-- end $$;
--
-- Para volver a activarlos, se corre este archivo otra vez.
-- =============================================================
