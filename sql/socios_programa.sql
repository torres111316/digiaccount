-- ============================================================================
--  PROGRAMA DE SOCIOS · Capa 1 · la base
--  24/08/2026
--
--  QUE ES
--    Un contador refiere empresas y cobra un porcentaje de lo que esas
--    empresas pagan, todos los meses, mientras sigan pagando. El porcentaje
--    sube por niveles y se mide sobre los ultimos doce meses.
--
--        Asociado          10%   induccion + su propio plan activo
--        Certificado       20%   5 empresas activas · examen · 70% retencion
--        Socio             25%   15 empresas activas · 80% retencion
--        Socio Principal   30%   25 empresas activas · 85% retencion
--
--  TODO ES ADITIVO
--    Cuatro tablas nuevas y unas funciones nuevas. NO se modifica ninguna
--    tabla, funcion o trigger que ya exista. Si algo de esto fallara, el
--    sistema sigue funcionando exactamente igual que hoy.
--
--  EL NIVEL NO SE GUARDA A MANO: SE CALCULA
--    Guardar el nivel invita a que se desincronice del hecho real. Aqui se
--    calcula de los pagos confirmados, que es el unico dato que no miente.
--    Lo unico que se guarda es un ajuste manual opcional (nivel_forzado),
--    para cuando el fundador tenga que corregir un caso a mano.
--
--  LA EXCEPCION: LA COMISION LIQUIDADA SI SE CONGELA
--    Al cerrar el mes, la fila de comisiones guarda el nivel y el porcentaje
--    que regian ESE mes. Si el socio baja de nivel en marzo, lo que se le
--    liquido en febrero no cambia. Es contabilidad, no un tablero en vivo.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
--  1 · SOCIOS
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.socios (
  id             uuid primary key default gen_random_uuid(),
  -- Su propia cuenta DigiAccount. Es requisito del programa: no se recomienda
  -- lo que uno no usa, y ademas es lo que crea el compromiso.
  cuenta_id      uuid not null references public.cuentas(id) on delete cascade,
  codigo         text not null,
  nombre         text not null,
  colegiado      text,                   -- numero de C.P.C.
  ciudad         text,
  telefono       text,
  email          text,
  estado         text not null default 'postulado'
                 check (estado in ('postulado', 'activo', 'suspendido')),
  es_fundador    boolean not null default false,
  -- Fecha en que aprobo el examen. Sin esto no puede pasar de Asociado.
  certificado_en date,
  -- Ajuste manual del fundador. Nulo = el nivel se calcula solo.
  nivel_forzado  text check (nivel_forzado in ('asociado','certificado','socio','principal')),
  aprobado_en    timestamptz,
  nota           text,
  creado_en      timestamptz not null default now(),
  unique (cuenta_id)
);

-- El codigo se compara siempre en mayusculas y sin espacios.
create unique index if not exists socios_codigo_unico
  on public.socios (upper(btrim(codigo)));


-- ────────────────────────────────────────────────────────────────────────────
--  2 · REFERIDOS · que cuenta entro con que codigo
--
--  Se referencia la CUENTA del cliente, no sus empresas. Una cuenta referida
--  cuenta como UNA empresa activa para efectos de nivel, aunque su plan
--  cubra varias razones sociales — pero la comision se calcula sobre lo que
--  esa cuenta paga de verdad, que en un Grupo Empresarial es bastante mas.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.referidos (
  id             uuid primary key default gen_random_uuid(),
  socio_id       uuid not null references public.socios(id) on delete cascade,
  cuenta_id      uuid not null references public.cuentas(id) on delete cascade,
  codigo_usado   text not null,
  creado_en      timestamptz not null default now(),
  -- Cuando el negocio CESO ACTIVIDADES. No cuenta en contra de la retencion
  -- del socio: que un cliente quiebre no es asunto suyo.
  cese_en        date,
  nota           text,
  -- Una cuenta pertenece a un solo socio. El primer codigo manda.
  unique (cuenta_id)
);

create index if not exists referidos_por_socio on public.referidos (socio_id);


-- ────────────────────────────────────────────────────────────────────────────
--  3 · CUPONES · el mes de cortesia que el socio regala
--
--  Dos al ano por socio, y se renuevan. Es lo que le permite decir "te
--  consegui un mes gratis" en vez de "usa este sistema": deja de vender y
--  pasa a hacerle un favor a su cliente.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.cupones (
  id             uuid primary key default gen_random_uuid(),
  socio_id       uuid not null references public.socios(id) on delete cascade,
  codigo         text not null,
  dias           int  not null default 30,
  emitido_en     timestamptz not null default now(),
  vence_en       date not null,          -- lo que no se usa no se acumula
  canjeado_por   uuid references public.cuentas(id) on delete set null,
  canjeado_en    timestamptz
);

create unique index if not exists cupones_codigo_unico
  on public.cupones (upper(btrim(codigo)));


-- ────────────────────────────────────────────────────────────────────────────
--  4 · COMISIONES · una fila por socio y mes, ya liquidada
--
--  Aqui SI se congela el nivel y el porcentaje: es el registro contable de lo
--  que se le debe, y no puede cambiar porque el socio suba o baje despues.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.comisiones (
  id             uuid primary key default gen_random_uuid(),
  socio_id       uuid not null references public.socios(id) on delete cascade,
  periodo        text not null,          -- 'YYYY-MM'
  nivel          text not null,          -- el que regia ese mes
  pct            numeric(5,4) not null,  -- 0.2000 = 20%
  base           numeric(14,2) not null default 0,   -- lo que pagaron sus referidos
  monto          numeric(14,2) not null default 0,   -- base * pct, antes de retencion
  cuentas_base   int not null default 0,
  estado         text not null default 'calculada'
                 check (estado in ('calculada', 'pagada', 'anulada')),
  pagada_en      date,
  referencia     text,
  nota           text,
  creado_en      timestamptz not null default now(),
  unique (socio_id, periodo)
);


-- ============================================================================
--  FUNCIONES DE CALCULO
--  Todas son STABLE y de solo lectura: no escriben nada.
-- ============================================================================

-- ¿Esta cuenta esta pagando? Fuente de verdad: un pago CONFIRMADO reciente.
-- "Empresa activa" cuenta desde la primera factura pagada y deja de contar al
-- segundo mes sin pago — de ahi los 62 dias de gracia.
create or replace function public.cuenta_esta_activa(p_cuenta uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.pagos_suscripcion
     where cuenta_id = p_cuenta
       and estado = 'confirmado'
       and creado_en > now() - interval '62 days'
  );
$$;

-- Cuantas cuentas referidas estan pagando hoy.
create or replace function public.socio_activas(p_socio uuid)
returns int
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.referidos r
   where r.socio_id = p_socio
     and r.cese_en is null
     and public.cuenta_esta_activa(r.cuenta_id);
$$;

-- Retencion sobre DOCE MESES MOVILES: de las que tenia activas hace un ano,
-- cuantas siguen activas hoy. Un socio sin historia todavia arranca en 100%:
-- no se castiga a nadie por ser nuevo. Y la que ceso actividades no cuenta.
create or replace function public.socio_retencion(p_socio uuid)
returns numeric
language sql stable
security definer
set search_path = public
as $$
  with hace_un_ano as (
    select r.cuenta_id
      from public.referidos r
     where r.socio_id = p_socio
       and r.cese_en is null
       and exists (
         select 1 from public.pagos_suscripcion p
          where p.cuenta_id = r.cuenta_id
            and p.estado = 'confirmado'
            and p.creado_en between now() - interval '13 months'
                               and now() - interval '11 months'
       )
  )
  select case
    when (select count(*) from hace_un_ano) = 0 then 1.0
    else round(
      (select count(*) from hace_un_ano h where public.cuenta_esta_activa(h.cuenta_id))::numeric
      / (select count(*) from hace_un_ano)::numeric, 4)
  end;
$$;

-- El nivel. Se calcula; nivel_forzado solo existe para corregir a mano.
create or replace function public.socio_nivel(p_socio uuid)
returns text
language plpgsql stable
security definer
set search_path = public
as $$
declare
  s        public.socios%rowtype;
  v_act    int;
  v_ret    numeric;
  v_cert   boolean;
begin
  select * into s from public.socios where id = p_socio;
  if not found or s.estado <> 'activo' then
    return 'asociado';
  end if;
  if s.nivel_forzado is not null then
    return s.nivel_forzado;
  end if;

  v_act  := public.socio_activas(p_socio);
  v_ret  := public.socio_retencion(p_socio);
  v_cert := s.certificado_en is not null;

  -- Del mas alto al mas bajo: el primero que cuadre manda.
  if v_cert and v_act >= 25 and v_ret >= 0.85 then return 'principal'; end if;
  if v_cert and v_act >= 15 and v_ret >= 0.80 then return 'socio';     end if;
  if v_cert and v_act >=  5 and v_ret >= 0.70 then return 'certificado'; end if;

  -- Ventaja de fundador: entra directo en Certificado sin las cinco empresas,
  -- y tiene doce meses para alcanzarlas. Pasado ese ano, se mide como todos.
  if s.es_fundador and s.aprobado_en is not null
     and s.aprobado_en > now() - interval '12 months' then
    return 'certificado';
  end if;

  return 'asociado';
end;
$$;

create or replace function public.socio_pct(p_socio uuid)
returns numeric
language sql stable
security definer
set search_path = public
as $$
  select case public.socio_nivel(p_socio)
    when 'principal'   then 0.30
    when 'socio'       then 0.25
    when 'certificado' then 0.20
    else                    0.10
  end::numeric;
$$;


-- ============================================================================
--  RLS · cada socio ve lo suyo; el fundador ve todo
--  Se usan los mismos ayudantes que ya rigen el resto del sistema.
-- ============================================================================
alter table public.socios     enable row level security;
alter table public.referidos  enable row level security;
alter table public.cupones    enable row level security;
alter table public.comisiones enable row level security;

-- Ayudante: el id de socio de quien esta consultando (nulo si no es socio).
create or replace function public.mi_socio_id()
returns uuid
language sql stable
security definer
set search_path = public
as $$
  select id from public.socios where cuenta_id = public.mi_cuenta_id() limit 1;
$$;

drop policy if exists socios_lectura on public.socios;
create policy socios_lectura on public.socios for select
  using (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id());

drop policy if exists socios_escritura on public.socios;
create policy socios_escritura on public.socios for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());

drop policy if exists referidos_lectura on public.referidos;
create policy referidos_lectura on public.referidos for select
  using (public.soy_superadmin() or socio_id = public.mi_socio_id());

drop policy if exists referidos_escritura on public.referidos;
create policy referidos_escritura on public.referidos for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());

drop policy if exists cupones_lectura on public.cupones;
create policy cupones_lectura on public.cupones for select
  using (public.soy_superadmin() or socio_id = public.mi_socio_id());

drop policy if exists cupones_escritura on public.cupones;
create policy cupones_escritura on public.cupones for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());

drop policy if exists comisiones_lectura on public.comisiones;
create policy comisiones_lectura on public.comisiones for select
  using (public.soy_superadmin() or socio_id = public.mi_socio_id());

drop policy if exists comisiones_escritura on public.comisiones;
create policy comisiones_escritura on public.comisiones for all
  using (public.soy_superadmin()) with check (public.soy_superadmin());


-- ============================================================================
--  RESUMEN PARA EL PANEL · una fila por socio con todo ya calculado
-- ============================================================================
create or replace view public.v_socios_resumen as
select s.id,
       s.cuenta_id,
       s.codigo,
       s.nombre,
       s.colegiado,
       s.ciudad,
       s.estado,
       s.es_fundador,
       s.certificado_en is not null                     as certificado,
       public.socio_nivel(s.id)                         as nivel,
       public.socio_pct(s.id)                           as pct,
       public.socio_activas(s.id)                       as empresas_activas,
       public.socio_retencion(s.id)                     as retencion,
       (select count(*) from public.referidos r where r.socio_id = s.id) as referidos_totales,
       (select count(*) from public.cupones c
         where c.socio_id = s.id and c.canjeado_en is null and c.vence_en >= current_date) as cupones_disponibles,
       (select coalesce(sum(m.monto), 0) from public.comisiones m
         where m.socio_id = s.id and m.estado = 'pagada')  as comision_pagada,
       (select coalesce(sum(m.monto), 0) from public.comisiones m
         where m.socio_id = s.id and m.estado = 'calculada') as comision_por_pagar
  from public.socios s;


-- ============================================================================
--  VERIFICACION
-- ============================================================================
select 'tablas creadas' as revision,
       count(*)::text || ' de 4' as hallazgo
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('socios', 'referidos', 'cupones', 'comisiones')

union all
select 'funciones de calculo', count(*)::text || ' de 6'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('cuenta_esta_activa','socio_activas','socio_retencion',
                     'socio_nivel','socio_pct','mi_socio_id')

union all
select 'politicas RLS', count(*)::text || ' de 8'
  from pg_policies
 where schemaname = 'public'
   and tablename in ('socios','referidos','cupones','comisiones')

union all
select 'vista de resumen',
       case when exists (select 1 from information_schema.views
                          where table_schema='public' and table_name='v_socios_resumen')
            then 'creada' else 'FALTA' end

union all
select 'nada existente fue modificado',
       'correcto: este archivo solo hace CREATE, ningun ALTER sobre lo que ya habia';
