-- =============================================================
-- SUCURSALES · establecimientos de una misma empresa
--
-- Una sucursal NO es otro contribuyente: es otro establecimiento del mismo.
-- Comparte el RIF, y por lo tanto declara junto con la casa matriz.
--
-- POR QUÉ NO SE REGISTRA COMO OTRA EMPRESA
--   Sería lo natural con el sistema tal como estaba, y rompería la
--   declaración: dos empresas con el mismo RIF, el libro partido en dos, y la
--   Forma 30 calculada por separado sobre cada mitad. Se declararía dos veces
--   o la mitad. Un RIF es un contribuyente y declara una vez.
--
-- CÓMO QUEDA
--   El libro sigue siendo UNO por empresa —así la Forma 30 se mantiene
--   consolidada sin tocar nada de lo ya construido— pero cada renglón puede
--   decir de qué establecimiento salió. Es información, no partición.
--
-- SIN SUCURSALES NO CAMBIA NADA
--   Una empresa sin filas en esta tabla no tiene sucursales, y todo funciona
--   exactamente como hoy. No se crea una casa matriz automática para todos:
--   sería ruido en las empresas de un solo local, que son la mayoría.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

create table if not exists public.sucursales (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,

  nombre      text not null,
  -- Código corto del establecimiento. Cuando haya imprenta, es el que
  -- distingue los rangos de números de control: la casa matriz y la sucursal
  -- no pueden compartir numeración (000102, Art. 7.4).
  codigo      text not null,

  -- Va impreso en la factura de ese establecimiento, no el de la casa matriz.
  direccion   text,
  telefono    text,

  es_matriz   boolean not null default false,
  activa      boolean not null default true,
  creado_en   timestamptz not null default now(),

  constraint sucursales_codigo_chk check (codigo ~ '^[A-Za-z0-9-]{1,6}$')
);

-- El código identifica al establecimiento dentro de su empresa.
create unique index if not exists sucursales_codigo_unico
  on public.sucursales (empresa_id, lower(codigo));

-- Una empresa tiene UNA casa matriz, o ninguna. Dos sería un dato que se
-- contradice a sí mismo justo donde hay que decidir qué dirección se imprime.
create unique index if not exists sucursales_una_matriz
  on public.sucursales (empresa_id) where es_matriz;

create index if not exists sucursales_por_empresa
  on public.sucursales (empresa_id) where activa;

-- -------------------------------------------------------------
-- DE QUÉ ESTABLECIMIENTO SALIÓ CADA OPERACIÓN
--
-- Nullable a propósito, y el nulo se lee distinto según el caso:
--   · empresa sin sucursales      -> siempre nulo, no aplica
--   · operaciones anteriores      -> nulo porque nadie lo registró entonces
-- Rellenarlo hacia atrás sería afirmar algo que nadie comprobó.
-- -------------------------------------------------------------
alter table public.libro_fiscal
  add column if not exists sucursal_id uuid references public.sucursales(id) on delete set null;

create index if not exists libro_por_sucursal
  on public.libro_fiscal (sucursal_id) where sucursal_id is not null;

comment on column public.libro_fiscal.sucursal_id is
  'Establecimiento del que salió la operación. Nulo = la empresa no tiene sucursales, o es anterior al registro. El libro y la Forma 30 siguen consolidados por empresa.';

-- Una operación no puede pertenecer al establecimiento de OTRA empresa. Sin
-- esto, un error de la pantalla o de una carga masiva enlazaría la venta de
-- una empresa a la sucursal de otra, y el reporte por establecimiento saldría
-- mezclado entre contribuyentes.
create or replace function public.tg_sucursal_de_la_empresa()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if NEW.sucursal_id is not null then
    if not exists (
      select 1 from public.sucursales s
       where s.id = NEW.sucursal_id and s.empresa_id = NEW.empresa_id
    ) then
      raise exception 'La sucursal indicada no pertenece a esta empresa';
    end if;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_sucursal_de_la_empresa on public.libro_fiscal;
create trigger trg_sucursal_de_la_empresa
  before insert or update of sucursal_id, empresa_id on public.libro_fiscal
  for each row execute function public.tg_sucursal_de_la_empresa();

-- -------------------------------------------------------------
-- SEGURIDAD
-- -------------------------------------------------------------
alter table public.sucursales enable row level security;
drop policy if exists "tenant_sucursales" on public.sucursales;
create policy "tenant_sucursales" on public.sucursales for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id()) or public.soy_superadmin());

-- -------------------------------------------------------------
-- DAR DE ALTA LOS ESTABLECIMIENTOS  (se corre a mano)
--
-- Para la C.A. con una sucursal, son dos filas: la casa matriz y la sucursal.
-- Hay que crear las DOS — si solo se registra la sucursal, las operaciones de
-- la matriz quedarían sin establecimiento y el reporte no cuadraría.
--
--   insert into public.sucursales (empresa_id, nombre, codigo, direccion, es_matriz)
--   values ('<uuid de la empresa>', 'Casa Matriz', '01', '<dirección fiscal>', true),
--          ('<uuid de la empresa>', '<nombre de la sucursal>', '02', '<su dirección>', false);
--
-- Y para marcar las operaciones ya cargadas que sean de la matriz:
--
--   update public.libro_fiscal
--      set sucursal_id = (select id from public.sucursales
--                          where empresa_id = '<uuid>' and es_matriz)
--    where empresa_id = '<uuid>' and sucursal_id is null;
--
-- (Hacerlo solo si consta que TODO lo cargado es de la matriz. Si el libro
--  mezcla los dos establecimientos, es preferible dejarlo en nulo antes que
--  atribuirle a la matriz operaciones que no son suyas.)
--
-- ¡OJO CON EL ORDEN! Ese update hay que correrlo ANTES de pasar la empresa a
-- factura digital. Una vez en ese modo, `tg_inalterable_libro` rechaza toda
-- modificación de una VENTA ya registrada — y con razón: una venta emitida no
-- se toca. Pero eso incluye ponerle el establecimiento, aunque no cambie ni un
-- monto. Después de ese punto solo se podría marcar lo nuevo, y el histórico
-- quedaría sin establecimiento para siempre.
--
-- Hoy la empresa está en modo libro, así que el update pasa sin problema. El
-- riesgo es futuro, y por eso queda escrito aquí y no en la memoria de nadie.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- CÓMO DESACTIVARLO
--
-- El disparador corre DENTRO del guardado del libro: si fallara, fallaría el
-- guardado. Para apagarlo sin perder nada:
--
--   drop trigger if exists trg_sucursal_de_la_empresa on public.libro_fiscal;
--
-- Para quitarlo del todo (borra los establecimientos registrados; el libro y
-- las declaraciones no se tocan):
--
--   drop function if exists public.tg_sucursal_de_la_empresa();
--   alter table public.libro_fiscal drop column if exists sucursal_id;
--   drop table if exists public.sucursales;
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- Los establecimientos de cada empresa:
--   select e.nombre as empresa, s.codigo, s.nombre, s.es_matriz
--     from public.sucursales s join public.empresas e on e.id = s.empresa_id
--    order by e.nombre, s.codigo;
--
-- Cómo se reparte el libro (el nulo es normal en empresas de un solo local):
--   select e.nombre as empresa,
--          coalesce(s.nombre, '— sin establecimiento —') as donde,
--          l.tipo, count(*)
--     from public.libro_fiscal l
--     join public.empresas e on e.id = l.empresa_id
--     left join public.sucursales s on s.id = l.sucursal_id
--    group by 1, 2, 3 order by 1, 2, 3;
--
-- Que el candado funciona (debe dar error):
--   update public.libro_fiscal set sucursal_id = '<sucursal de OTRA empresa>'
--    where id = '<una operación cualquiera>';
-- -------------------------------------------------------------
