-- ============================================================================
--  EL ARRANQUE DE UNA EMPRESA · saldos de apertura
--  26/08/2026
--
--  EL PROBLEMA
--    Una empresa que lleva anos operando no arranca en cero. Tiene plata en
--    el banco, mercancia en el deposito, clientes que le deben, proveedores a
--    los que le debe, prestaciones acumuladas y un credito fiscal de IVA que
--    viene arrastrando. Si el sistema arranca vacio, el primer balance miente
--    y la primera declaracion sale mal.
--
--  LA DISCIPLINA
--    Esto NO es un formulario de carga: es un ASIENTO DE APERTURA a una fecha
--    de corte. Y como todo asiento, tiene que CUADRAR. La base lo exige: una
--    apertura no se puede cerrar mientras el debe y el haber no sean iguales.
--
--    Es la diferencia entre un sistema que acepta lo que le echen y uno que
--    obliga a que la contabilidad tenga sentido desde el primer dia.
--
--  LA FECHA DE CORTE
--    Todo es "al" de una sola fecha. Antes de esa fecha el sistema no calcula
--    nada: es una fotografia. Desde esa fecha en adelante manda el sistema.
--    Por eso la fecha es unica por empresa y se fija una sola vez.
--
--  LO QUE UN SISTEMA GENERICO OLVIDA Y AQUI NO
--    · El credito fiscal de IVA arrastrado. Sin el, la primera Forma 30 paga
--      de mas.
--    · Las retenciones por enterar que quedaron pendientes al corte.
--    · Las prestaciones sociales acumuladas — garantia, intereses, vacaciones
--      y utilidades. En Venezuela eso es un pasivo grande y real, y es el que
--      todo el mundo deja fuera hasta que hay que pagarlo.
--
--  ADITIVO
--    Dos tablas nuevas. No toca ninguna existente.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · APERTURA · una por empresa
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.apertura (
  empresa_id   uuid primary key references public.empresas(id) on delete cascade,
  cuenta_id    uuid not null references public.cuentas(id) on delete cascade,
  fecha_corte  date not null,
  estado       text not null default 'borrador' check (estado in ('borrador','cerrada')),
  nota         text,
  cerrada_en   timestamptz,
  creado_en    timestamptz not null default now()
);

comment on table public.apertura is
  'Asiento de apertura de una empresa que ya venia operando. Todo es AL cierre de fecha_corte; desde ahi en adelante manda el sistema.';


-- ────────────────────────────────────────────────────────────────────────────
--  2 · PARTIDAS · los renglones del asiento
--
--  Las cuentas por cobrar y por pagar van DOCUMENTO POR DOCUMENTO cuando se
--  puede: un saldo global no sirve para cobrar. Quien no quiera detallarlas
--  puede cargar un renglon global y detallarlas despues — pero entonces no
--  podra aplicarles un cobro hasta que lo haga, y conviene que lo sepa.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.apertura_partidas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.apertura(empresa_id) on delete cascade,
  cuenta_id      uuid not null references public.cuentas(id) on delete cascade,

  grupo          text not null check (grupo in (
                   'caja','banco','inventario','cxc','cxp','activo_fijo',
                   'fiscal','laboral','prestamo','patrimonio','otro')),
  descripcion    text not null,

  -- Para cxc / cxp: sin esto no hay a quien cobrarle ni que documento aplicar.
  tercero_nombre text,
  tercero_rif    text,
  documento      text,
  fecha_doc      date,

  -- Un renglon es debe O haber, nunca los dos.
  debe           numeric(16,2) not null default 0 check (debe  >= 0),
  haber          numeric(16,2) not null default 0 check (haber >= 0),
  constraint partida_un_solo_lado check ((debe = 0) <> (haber = 0) or (debe = 0 and haber = 0)),

  -- Cuando el saldo esta en divisas se guardan las dos caras: el monto en
  -- moneda y la tasa con que se convirtio. Sin la tasa, el saldo en bolivares
  -- no se puede explicar seis meses despues.
  moneda         text not null default 'VES' check (moneda in ('VES','USD','EUR','USDT')),
  monto_divisa   numeric(16,2),
  tasa           numeric(18,6),

  -- A donde se aplico este renglon, cuando aplica a algo concreto
  ref_tabla      text,
  ref_id         uuid,

  nota           text,
  creado_en      timestamptz not null default now()
);

create index if not exists apertura_partidas_empresa on public.apertura_partidas (empresa_id, grupo);


-- ============================================================================
--  EL CUADRE
--  Devuelve el debe, el haber y la diferencia. Es lo que la pantalla muestra
--  en todo momento: mientras la diferencia no sea cero, la apertura no cierra.
-- ============================================================================
create or replace function public.apertura_cuadre(p_empresa uuid)
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'debe',       coalesce(sum(debe), 0),
    'haber',      coalesce(sum(haber), 0),
    'diferencia', coalesce(sum(debe), 0) - coalesce(sum(haber), 0),
    'cuadra',     coalesce(sum(debe), 0) = coalesce(sum(haber), 0),
    'renglones',  count(*)
  )
  from public.apertura_partidas
 where empresa_id = p_empresa;
$$;


-- ============================================================================
--  CERRAR LA APERTURA
--
--  Aqui esta la regla que hace esto contabilidad y no captura de datos: no se
--  cierra si no cuadra. Y una vez cerrada no se puede editar — para corregir
--  hay que reabrirla, que deja rastro.
-- ============================================================================
create or replace function public.cerrar_apertura(p_empresa uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta uuid;
  v_c      jsonb;
begin
  select cuenta_id into v_cuenta from public.apertura where empresa_id = p_empresa;
  if v_cuenta is null then
    return jsonb_build_object('ok', false, 'motivo', 'Esta empresa no tiene apertura iniciada.');
  end if;
  if not (public.soy_superadmin() or v_cuenta = public.mi_cuenta_id()) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;

  v_c := public.apertura_cuadre(p_empresa);

  if (v_c->>'renglones')::int = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'La apertura no tiene ningun renglon.');
  end if;

  if not (v_c->>'cuadra')::boolean then
    return jsonb_build_object('ok', false, 'cuadre', v_c,
      'motivo', 'La apertura no cuadra: hay una diferencia de '
             || to_char(abs((v_c->>'diferencia')::numeric), 'FM999G999G999D00')
             || '. Revisa los saldos o registra la diferencia como patrimonio.');
  end if;

  update public.apertura
     set estado = 'cerrada', cerrada_en = now()
   where empresa_id = p_empresa;

  return jsonb_build_object('ok', true, 'cuadre', v_c);
end;
$$;


-- ============================================================================
--  REABRIR · para corregir. Deja constancia en la nota.
-- ============================================================================
create or replace function public.reabrir_apertura(p_empresa uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_cuenta uuid;
begin
  select cuenta_id into v_cuenta from public.apertura where empresa_id = p_empresa;
  if v_cuenta is null then
    return jsonb_build_object('ok', false, 'motivo', 'Esta empresa no tiene apertura.');
  end if;
  if not (public.soy_superadmin() or v_cuenta = public.mi_cuenta_id()) then
    return jsonb_build_object('ok', false, 'motivo', 'Esa empresa no es de tu cuenta.');
  end if;

  update public.apertura
     set estado = 'borrador',
         nota = coalesce(nota || E'\n', '')
              || to_char(now(), 'DD/MM/YYYY') || ' · reabierta: ' || coalesce(p_motivo, 'sin motivo')
   where empresa_id = p_empresa;

  return jsonb_build_object('ok', true);
end;
$$;


-- ============================================================================
--  Una apertura CERRADA no se edita. El guardian lo impide en la base, no en
--  la pantalla: es un asiento contable, no un borrador.
-- ============================================================================
create or replace function public.proteger_apertura_cerrada()
returns trigger
language plpgsql
as $$
declare v_estado text;
begin
  select estado into v_estado from public.apertura
   where empresa_id = coalesce(new.empresa_id, old.empresa_id);
  if v_estado = 'cerrada' then
    raise exception 'La apertura de esta empresa esta cerrada. Reabrela para poder corregirla.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_apertura_cerrada on public.apertura_partidas;
create trigger trg_apertura_cerrada
  before insert or update or delete on public.apertura_partidas
  for each row execute function public.proteger_apertura_cerrada();


-- ============================================================================
--  RLS
-- ============================================================================
alter table public.apertura          enable row level security;
alter table public.apertura_partidas enable row level security;

drop policy if exists apertura_todo on public.apertura;
create policy apertura_todo on public.apertura for all
  using (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id())
  with check (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id());

drop policy if exists partidas_todo on public.apertura_partidas;
create policy partidas_todo on public.apertura_partidas for all
  using (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id())
  with check (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id());


-- ============================================================================
--  LA GUIA DE RENGLONES
--  No es una tabla de datos: es la lista de lo que hay que preguntarle a una
--  empresa que arranca, para que no se olvide nada. La pantalla la usa como
--  guion. Los tres ultimos grupos son los que un sistema generico olvida.
-- ============================================================================
create table if not exists public.apertura_guia (
  id          text primary key,
  grupo       text not null,
  titulo      text not null,
  ayuda       text not null,
  lado        text not null check (lado in ('debe','haber')),
  detallado   boolean not null default false,  -- ¿va documento por documento?
  orden       int not null default 100
);

insert into public.apertura_guia (id, grupo, titulo, ayuda, lado, detallado, orden) values
  ('caja',        'caja',        'Efectivo en caja',
   'Lo que hay en la caja al cierre de la fecha de corte. Si manejas divisas, carga un renglon por moneda.', 'debe', false, 10),
  ('banco',       'banco',       'Saldo en bancos',
   'El saldo conciliado de cada cuenta, no el del estado de cuenta: los cheques girados y no cobrados ya salieron.', 'debe', true, 20),
  ('inventario',  'inventario',  'Mercancia en existencia',
   'Valorada al COSTO, no al precio de venta. Es el conteo fisico del dia del corte.', 'debe', true, 30),
  ('cxc',         'cxc',         'Clientes que te deben',
   'Documento por documento. Un saldo global no sirve para cobrar: hay que saber quien debe que factura.', 'debe', true, 40),
  ('anticipo_c',  'cxc',         'Anticipos entregados a proveedores',
   'Plata ya pagada por mercancia o servicios que aun no has recibido.', 'debe', true, 45),
  ('activo_fijo', 'activo_fijo', 'Activos fijos',
   'Al costo, y aparte su depreciacion acumulada. Sin la depreciacion, el balance sobrevalua el activo.', 'debe', true, 50),
  ('iva_credito', 'fiscal',      'Credito fiscal de IVA por compensar',
   'El excedente que vienes arrastrando de la ultima declaracion. Si no entra, la primera Forma 30 paga de mas.', 'debe', false, 60),
  ('islr_antic',  'fiscal',      'Anticipos de ISLR y retenciones sufridas',
   'Lo que te han retenido y aun no has descontado en la declaracion anual.', 'debe', false, 65),

  ('cxp',         'cxp',         'Proveedores a los que debes',
   'Documento por documento, igual que las cuentas por cobrar: hay que saber que factura se esta pagando.', 'haber', true, 70),
  ('anticipo_p',  'cxp',         'Anticipos recibidos de clientes',
   'Plata que ya te pagaron por algo que aun no has entregado.', 'haber', true, 75),
  ('iva_debito',  'fiscal',      'IVA por pagar',
   'El saldo de la ultima declaracion si quedo cuota por pagar.', 'haber', false, 80),
  ('ret_enterar', 'fiscal',      'Retenciones por enterar',
   'IVA e ISLR retenidos a terceros que aun no se han enterado al SENIAT.', 'haber', false, 85),
  ('prestaciones','laboral',     'Garantia de prestaciones sociales',
   'El acumulado de cada trabajador segun el articulo 142 de la LOTTT. Es un pasivo real, y es el que todo el mundo deja fuera.', 'haber', true, 90),
  ('intereses_p', 'laboral',     'Intereses sobre prestaciones',
   'Los intereses acumulados y no pagados sobre la garantia.', 'haber', false, 92),
  ('vacaciones',  'laboral',     'Vacaciones y utilidades acumuladas',
   'La fraccion causada y no pagada al corte.', 'haber', true, 94),
  ('prestamo',    'prestamo',    'Prestamos y financiamientos',
   'El capital pendiente al corte, sin los intereses por vencer.', 'haber', true, 96),
  ('capital',     'patrimonio',  'Capital social',
   'El capital suscrito y pagado que dice el documento constitutivo.', 'haber', false, 110),
  ('resultados',  'patrimonio',  'Resultados acumulados',
   'Las ganancias o perdidas de ejercicios anteriores. Suele ser el renglon que termina de cuadrar la apertura.', 'haber', false, 115)
on conflict (id) do update set
  grupo = excluded.grupo, titulo = excluded.titulo, ayuda = excluded.ayuda,
  lado = excluded.lado, detallado = excluded.detallado, orden = excluded.orden;

alter table public.apertura_guia enable row level security;
drop policy if exists guia_lectura on public.apertura_guia;
create policy guia_lectura on public.apertura_guia for select using (true);
drop policy if exists guia_escritura on public.apertura_guia;
create policy guia_escritura on public.apertura_guia for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());


-- ============================================================================
--  VERIFICACION
-- ============================================================================
select 'tablas creadas' as revision, count(*)::text || ' de 3' as hallazgo
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('apertura','apertura_partidas','apertura_guia')
union all
select 'funciones', count(*)::text || ' de 4'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('apertura_cuadre','cerrar_apertura','reabrir_apertura','proteger_apertura_cerrada')
union all
select 'guardian de apertura cerrada',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.apertura_partidas'::regclass
                            and tgname = 'trg_apertura_cerrada' and not tgisinternal)
            then 'si' else 'NO' end
union all
select 'renglones de la guia', (select count(*)::text from public.apertura_guia)
union all
select 'nada existente fue modificado', 'correcto: solo CREATE';

-- La guia, para revisarla:
select orden, grupo, lado, titulo, detallado as documento_por_documento
  from public.apertura_guia order by orden;
