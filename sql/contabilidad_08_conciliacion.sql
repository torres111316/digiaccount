-- ============================================================
-- DigiAccount · Contabilidad 08: subcuenta por banco y asiento de cada línea
-- del estado de cuenta
-- Ejecutar en: Supabase SQL Editor, después de contabilidad_01 a _07. Re-ejecutable.
--
-- POR QUÉ: la conciliación solo cruzaba el estado de cuenta contra Tesorería
-- (y por monto, contra la regla de Luis), vivía solo en Tesorería y todo iba a
-- «Bancos» en general. Ahora (Luis, 05/11 y 08/11):
--   · Cada banco de la empresa tiene SU subcuenta: 1.1.1.03.NN (la caja,
--     1.1.1.01.NN). La crea la base al dar de alta el banco.
--   · Cada línea del estado de cuenta se CLASIFICA y, al conciliarla, la base
--     hace su asiento. Si entra dinero: Debe el banco / Haber la contrapartida;
--     si sale, al revés.
--       cobro → 1.1.2.01 · pago → 2.1.1.01 · comision → 6.3.1.02
--       igtf → 6.3.1.04 · otra → la cuenta elegida
--       registrado → ya estaba en libros contra «Bancos» o «Caja» en general
--                    (nómina, Tesorería, una presunción de contado): solo
--                    pasa a la subcuenta
--       transferencia → contra la subcuenta del otro banco. Las dos puntas se
--                    enlazan (extracto_par_id, en cualquiera de las dos) y
--                    entre las dos hay UN asiento; si se deshace la que lo
--                    tenía, lo toma la otra
--       impuesto → se enlaza la declaración: si no tenía pago, se le pone
--                    desde aquí y su asiento lo hace el motor del plan 2b; si
--                    ya lo tenía contra otra cuenta, se pasa a la subcuenta
--   · Las cuentas en dólares no se concilian todavía: el diferencial cambiario
--     llega con el plan 4b.
--   · Las líneas que ya estaban cargadas antes de este SQL quedan «históricas»:
--     pudieron registrarse a mano con la conciliación vieja y no se aprueban en
--     bloque (se concilian una por una).
-- Pruebas: sql/pruebas/contabilidad_08_pruebas.sql.
-- ============================================================

-- ---- Subcuenta por banco -------------------------------------------------
alter table public.cuentas_tesoreria add column if not exists cuenta_contable text;
comment on column public.cuentas_tesoreria.cuenta_contable is
  'Subcuenta del plan para este banco o caja (1.1.1.03.NN / 1.1.1.01.NN); la pone la base';

create or replace function public.contab_banco_subcuenta()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  padre text;
  dueña uuid;
  cod text;
  n int;
  acceso boolean;
begin
  if new.empresa_id is null then return new; end if;
  -- La cuenta que da de alta el banco tiene que ser la dueña de la empresa o
  -- tener acceso a ella: si no, este disparador crearía cuentas en el plan de
  -- una empresa ajena.
  if tg_op = 'INSERT' or new.empresa_id is distinct from old.empresa_id or new.cuenta_id is distinct from old.cuenta_id then
    select cuenta_id into dueña from empresas where id = new.empresa_id;
    acceso := dueña is not distinct from new.cuenta_id;
    if not acceso and to_regclass('public.empresa_acceso') is not null then
      execute 'select exists (select 1 from public.empresa_acceso where empresa_id = $1 and cuenta_id = $2)'
         into acceso using new.empresa_id, new.cuenta_id;
    end if;
    if not coalesce(acceso, false) then raise exception 'Ese banco no es de una empresa de tu cuenta'; end if;
  end if;
  if coalesce(trim(new.cuenta_contable), '') <> '' then return new; end if;
  padre := case when (coalesce(new.tipo, '') || ' ' || coalesce(new.nombre, '')) ~* '(efectivo|caja)' then '1.1.1.01' else '1.1.1.03' end;
  select cuenta_id into dueña from empresas where id = new.empresa_id;
  perform pg_advisory_xact_lock(hashtext('subcuenta:' || new.empresa_id::text));
  -- Si la empresa ya tenía una cuenta propia de ese banco (con su nombre) y
  -- ningún otro banco la usa, se reusa.
  select c.codigo into cod from cuentas_contables c
   where c.empresa_id = new.empresa_id and c.codigo ~ ('^' || replace(padre, '.', '\.') || '\.[0-9]{2}$')
     and upper(trim(c.nombre)) = upper(trim(coalesce(new.nombre, '')))
     and not exists (select 1 from cuentas_tesoreria t where t.empresa_id = new.empresa_id and t.cuenta_contable = c.codigo and t.id <> new.id)
   order by c.codigo limit 1;
  if cod is null then
    select coalesce(max(substr(codigo, length(padre) + 2)::int), 0) + 1 into n from cuentas_contables
     where empresa_id = new.empresa_id and codigo ~ ('^' || replace(padre, '.', '\.') || '\.[0-9]{2}$');
    cod := padre || '.' || lpad(n::text, 2, '0');
    insert into cuentas_contables (cuenta_id, empresa_id, codigo, nombre, tipo, naturaleza)
    values (coalesce(dueña, new.cuenta_id), new.empresa_id, cod, coalesce(nullif(trim(new.nombre), ''), 'Banco'), 'Cuenta', 'Deudora');
  end if;
  new.cuenta_contable := cod;
  return new;
end $$;

drop trigger if exists trg_banco_subcuenta on public.cuentas_tesoreria;
create trigger trg_banco_subcuenta before insert or update on public.cuentas_tesoreria
  for each row execute function public.contab_banco_subcuenta();

-- Los bancos que ya existen reciben la suya.
update public.cuentas_tesoreria set nombre = nombre where coalesce(trim(cuenta_contable), '') = '';

-- ---- Cabecera del estado de cuenta ---------------------------------------
create table if not exists public.estados_cuenta (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid,
  empresa_id     uuid not null,
  cuenta_teso_id uuid not null references public.cuentas_tesoreria(id) on delete cascade,
  periodo        text not null check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  banco          text,
  saldo_inicial  numeric(18,2),
  saldo_final    numeric(18,2),
  archivo        text,
  creado_en      timestamptz not null default now(),
  unique (cuenta_teso_id, periodo)
);
alter table public.estados_cuenta enable row level security;
drop policy if exists estados_cuenta_todo on public.estados_cuenta;
create policy estados_cuenta_todo on public.estados_cuenta for all
  using (public.soy_superadmin() or empresa_id in (select public.mis_empresas()))
  with check ((public.soy_superadmin() or empresa_id in (select public.mis_empresas()))
              and exists (select 1 from public.cuentas_tesoreria t where t.id = cuenta_teso_id and t.empresa_id = estados_cuenta.empresa_id));
grant select, insert, update, delete on public.estados_cuenta to authenticated;

-- ---- Clasificación de cada línea -----------------------------------------
alter table public.extracto_bancario add column if not exists clase text;
alter table public.extracto_bancario add column if not exists cuenta_contra text;
alter table public.extracto_bancario add column if not exists libro_fiscal_id uuid references public.libro_fiscal(id) on delete set null;
alter table public.extracto_bancario add column if not exists declaracion_id uuid references public.declaraciones(id) on delete set null;
alter table public.extracto_bancario add column if not exists extracto_par_id uuid references public.extracto_bancario(id) on delete set null;
alter table public.extracto_bancario add column if not exists estado text not null default 'pendiente';
alter table public.extracto_bancario add column if not exists sugerencia jsonb;
alter table public.extracto_bancario add column if not exists tercero_nombre text;
alter table public.extracto_bancario add column if not exists tercero_rif text;
-- true cuando ESTA línea le puso el pago a su declaración (para quitárselo si se deshace).
alter table public.extracto_bancario add column if not exists pago_puesto boolean not null default false;

alter table public.extracto_bancario drop constraint if exists extracto_clase_valida;
alter table public.extracto_bancario add constraint extracto_clase_valida check (clase is null or clase in
  ('cobro', 'pago', 'comision', 'igtf', 'otra', 'registrado', 'transferencia', 'impuesto'));
alter table public.extracto_bancario drop constraint if exists extracto_estado_valido;
alter table public.extracto_bancario add constraint extracto_estado_valido check (estado in ('pendiente', 'sugerida', 'conciliada', 'historica'));
create index if not exists extracto_empresa_periodo on public.extracto_bancario (empresa_id, periodo);
create index if not exists extracto_par on public.extracto_bancario (extracto_par_id) where extracto_par_id is not null;

-- Las líneas cargadas antes de este SQL (las 233 de junio de 2026): históricas.
update public.extracto_bancario set estado = 'historica'
 where clase is null and estado = 'pendiente' and creado_en < '2026-11-09 00:00:00-04';

-- ¿Tiene asiento la otra punta de una transferencia? (el enlace puede estar en cualquiera de las dos)
create or replace function public.contab_par_con_asiento(x public.extracto_bancario)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from extracto_bancario y
      join asientos a on a.origen_tabla = 'extracto_bancario' and a.origen_id = y.id
     where y.id <> x.id and y.clase = 'transferencia' and y.estado = 'conciliada'
       and (y.id = x.extracto_par_id or y.extracto_par_id = x.id))
$$;

-- Las líneas del asiento de una línea conciliada (null = no lleva asiento).
create or replace function public.contab_lineas_extracto(x public.extracto_bancario)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  banco text;
  contra text;
  m numeric := round(abs(coalesce(x.monto, 0)), 2);
  d declaraciones;
begin
  if x.estado <> 'conciliada' or x.clase is null or m < 0.005 then return null; end if;
  select cuenta_contable into banco from cuentas_tesoreria where id = x.cuenta_teso_id and empresa_id = x.empresa_id;
  if coalesce(banco, '') = '' then return null; end if;
  contra := case x.clase
    when 'cobro' then '1.1.2.01'
    when 'pago' then '2.1.1.01'
    when 'comision' then '6.3.1.02'
    when 'igtf' then '6.3.1.04'
    when 'otra' then nullif(trim(x.cuenta_contra), '')
    when 'registrado' then coalesce(nullif(trim(x.cuenta_contra), ''), case when banco like '1.1.1.01.%' then '1.1.1.01' else '1.1.1.03' end)
    when 'transferencia' then nullif(trim(x.cuenta_contra), '')
    else null end;
  if x.clase = 'transferencia' and contab_par_con_asiento(x) then
    return null;   -- la otra punta ya la contabilizó
  end if;
  if x.clase = 'impuesto' then
    if x.pago_puesto or x.declaracion_id is null then return null; end if;   -- el asiento es el del pago de la declaración
    select * into d from declaraciones where id = x.declaracion_id and empresa_id = x.empresa_id;
    contra := case when coalesce(d.cuenta_pago, '') like '1.1.1.%' then d.cuenta_pago else '1.1.1.03' end;
  end if;
  if contra is null or contra = banco then return null; end if;
  if x.monto > 0 then
    return jsonb_build_array(
      jsonb_build_object('cta', contab_cta(banco, x.empresa_id), 'debe', m, 'haber', 0),
      jsonb_build_object('cta', contab_cta(contra, x.empresa_id), 'debe', 0, 'haber', m));
  end if;
  return jsonb_build_array(
    jsonb_build_object('cta', contab_cta(contra, x.empresa_id), 'debe', m, 'haber', 0),
    jsonb_build_object('cta', contab_cta(banco, x.empresa_id), 'debe', 0, 'haber', m));
end $$;

-- ANTES de guardar: que todo sea de la misma empresa, que la fecha se entienda,
-- que la cuenta sea en bolívares, y el enlace del impuesto con su declaración.
create or replace function public.contab_extracto_antes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b cuentas_tesoreria;
  sigue boolean;
begin
  -- ¿Deja de valer el pago que esta línea le había puesto a su declaración?
  if tg_op in ('UPDATE', 'DELETE') and old.pago_puesto then
    sigue := tg_op = 'UPDATE' and new.estado = 'conciliada' and new.clase = 'impuesto'
             and new.declaracion_id is not distinct from old.declaracion_id
             and new.cuenta_teso_id = old.cuenta_teso_id and new.fecha is not distinct from old.fecha;
    if not sigue then
      update declaraciones set fecha_pago = null, numero_pago = null, cuenta_pago = null
       where id = old.declaracion_id and empresa_id = old.empresa_id;
      if tg_op = 'UPDATE' then new.pago_puesto := false; end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;

  select * into b from cuentas_tesoreria where id = new.cuenta_teso_id;
  if not found or b.empresa_id is distinct from new.empresa_id then
    raise exception 'Ese banco no es de esta empresa';
  end if;
  if new.declaracion_id is not null
     and not exists (select 1 from declaraciones where id = new.declaracion_id and empresa_id = new.empresa_id) then
    raise exception 'Esa declaración no es de esta empresa';
  end if;
  if new.libro_fiscal_id is not null
     and not exists (select 1 from libro_fiscal where id = new.libro_fiscal_id and empresa_id = new.empresa_id) then
    raise exception 'Esa factura no es de esta empresa';
  end if;
  if new.extracto_par_id is not null
     and not exists (select 1 from extracto_bancario where id = new.extracto_par_id and empresa_id = new.empresa_id) then
    raise exception 'La otra punta de la transferencia no es de esta empresa';
  end if;

  if new.estado = 'conciliada' then
    if contab_fecha_factura(new.fecha) is null then
      raise exception 'La fecha de la línea («%») no se entiende: corrígela como dd/mm/aaaa antes de conciliar', new.fecha;
    end if;
    if coalesce(b.moneda, 'Bs') !~* '^\s*(bs|ves|bol)' then
      raise exception 'La cuenta % está en %: las cuentas en divisas se concilian con el diferencial cambiario (plan 4b)', b.nombre, b.moneda;
    end if;
  end if;

  -- ¿Pone esta línea el pago de una declaración que todavía no lo tenía?
  if new.estado = 'conciliada' and new.clase = 'impuesto' and new.declaracion_id is not null and not new.pago_puesto then
    update declaraciones
       set fecha_pago = contab_fecha_factura(new.fecha), numero_pago = nullif(trim(coalesce(new.referencia, '')), ''), cuenta_pago = b.cuenta_contable
     where id = new.declaracion_id and empresa_id = new.empresa_id and fecha_pago is null;
    if found then new.pago_puesto := true; end if;
  end if;
  return new;
end $$;

-- DESPUÉS de guardar: el asiento de la línea (crear, cambiar o borrar). Si una
-- punta de transferencia pierde su asiento, la otra se recalcula y lo toma.
create or replace function public.contab_sync_extracto()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  x extracto_bancario;
  lin jsonb;
  tot numeric;
  dueña uuid;
  nb text;
  tenia boolean;
begin
  x := case when tg_op = 'DELETE' then old else new end;
  -- Un candado por empresa: dos puntas conciliadas a la vez no pueden quedar con dos asientos.
  perform pg_advisory_xact_lock(hashtext('extracto:' || x.empresa_id::text));
  tenia := exists (select 1 from asientos where origen_tabla = 'extracto_bancario' and origen_id = x.id);
  if tg_op = 'DELETE' then
    delete from asientos where origen_tabla = 'extracto_bancario' and origen_id = x.id;
    lin := null;
  else
    lin := contab_lineas_extracto(x);
    if lin is null then
      delete from asientos where origen_tabla = 'extracto_bancario' and origen_id = x.id;
    else
      select cuenta_id into dueña from empresas where id = x.empresa_id;
      select nombre into nb from cuentas_tesoreria where id = x.cuenta_teso_id;
      select round(sum(coalesce((e->>'debe')::numeric, 0)), 2) into tot from jsonb_array_elements(lin) e;
      update asientos set fecha = to_char(contab_fecha_factura(x.fecha), 'DD/MM/YYYY'),
                          periodo = to_char(contab_fecha_factura(x.fecha), 'YYYY-MM'),
                          descripcion = coalesce(nb, 'Banco') || ' · ' || coalesce(x.descripcion, ''),
                          referencia = coalesce(x.referencia, ''), lineas = lin, total = tot, origen = 'motor'
       where origen_tabla = 'extracto_bancario' and origen_id = x.id;
      if not found then
        insert into asientos (cuenta_id, empresa_id, fecha, periodo, descripcion, referencia, origen, origen_tabla, origen_id, lineas, total)
        values (coalesce(dueña, x.cuenta_id), x.empresa_id, to_char(contab_fecha_factura(x.fecha), 'DD/MM/YYYY'),
                to_char(contab_fecha_factura(x.fecha), 'YYYY-MM'), coalesce(nb, 'Banco') || ' · ' || coalesce(x.descripcion, ''),
                coalesce(x.referencia, ''), 'motor', 'extracto_bancario', x.id, lin, tot);
      end if;
    end if;
  end if;
  if tenia and lin is null then
    update extracto_bancario set extracto_par_id = extracto_par_id
     where empresa_id = x.empresa_id and id <> x.id and clase = 'transferencia' and estado = 'conciliada'
       and (id = x.extracto_par_id or extracto_par_id = x.id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_contab_extracto_antes on public.extracto_bancario;
create trigger trg_contab_extracto_antes before update or delete on public.extracto_bancario
  for each row execute function public.contab_extracto_antes();
drop trigger if exists trg_contab_extracto_antes_ins on public.extracto_bancario;
create trigger trg_contab_extracto_antes_ins before insert on public.extracto_bancario
  for each row execute function public.contab_extracto_antes();
drop trigger if exists trg_contab_extracto on public.extracto_bancario;
create trigger trg_contab_extracto after insert or delete on public.extracto_bancario
  for each row execute function public.contab_sync_extracto();
drop trigger if exists trg_contab_extracto_upd on public.extracto_bancario;
create trigger trg_contab_extracto_upd after update of clase, cuenta_contra, estado, monto, fecha, descripcion, referencia,
    extracto_par_id, declaracion_id, cuenta_teso_id, pago_puesto
  on public.extracto_bancario for each row execute function public.contab_sync_extracto();

-- Comprobación
select (select count(*) from cuentas_tesoreria where coalesce(cuenta_contable, '') = '') as bancos_sin_subcuenta,
       (select count(*) from extracto_bancario where estado = 'historica') as lineas_historicas,
       (select count(*) from pg_trigger where tgname in ('trg_banco_subcuenta', 'trg_contab_extracto', 'trg_contab_extracto_upd', 'trg_contab_extracto_antes', 'trg_contab_extracto_antes_ins')) as disparadores;
