-- ============================================================================
--  EL CICLO DE COBRO DE CADA CUENTA
--  Correr una sola vez en Supabase → SQL Editor.
-- ============================================================================
--
--  QUÉ FALTABA
--  La cuenta guardaba su plan y la fecha en que terminaba la cortesía, y nada
--  más. No había forma de saber desde cuándo está activo un plan, cuándo toca
--  cobrar, ni a quién se le dio un beneficio y por qué. Una cuenta "activa"
--  quedaba activa para siempre.
--
--  LAS CUATRO SITUACIONES QUE HAY QUE DISTINGUIR
--    · EXENTA          no se le cobra nunca (la firma del fundador, su
--                      esposa). Se guarda el motivo: un favor sin motivo
--                      escrito, dentro de un año, nadie lo recuerda.
--    · CORTESÍA HASTA  no se le cobra hasta una fecha (el año de gracia de un
--                      colega que ayuda a probar el producto).
--    · DE PAGO         tiene ciclo: desde cuándo y cuándo toca el próximo.
--    · SIN PLAN        todavía no eligió nada.
--
--  Y CADA BENEFICIO QUEDA ANOTADO
--  `beneficios_cuenta` guarda quién lo otorgó, cuándo, por cuánto y por qué.
--  Es lo que convierte un favor en una decisión con registro.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1) El ciclo, en la cuenta
-- ────────────────────────────────────────────────────────────────────────────
alter table public.cuentas
  add column if not exists ciclo          text not null default 'mensual',
  add column if not exists plan_desde     date,
  add column if not exists proximo_cobro  date,
  add column if not exists cortesia_hasta date,
  add column if not exists exenta         boolean not null default false,
  add column if not exists exenta_motivo  text;

alter table public.cuentas drop constraint if exists cuentas_ciclo_chk;
alter table public.cuentas
  add constraint cuentas_ciclo_chk check (ciclo in ('mensual', 'anual'));

comment on column public.cuentas.ciclo          is 'mensual | anual: cada cuánto toca cobrar.';
comment on column public.cuentas.plan_desde     is 'Desde cuándo está activo el plan pagado.';
comment on column public.cuentas.proximo_cobro  is 'Fecha del próximo cobro. Nula si es exenta o no tiene plan.';
comment on column public.cuentas.cortesia_hasta is 'No se le cobra hasta esta fecha (gracia otorgada por el fundador).';
comment on column public.cuentas.exenta         is 'No se le cobra nunca. Siempre con motivo escrito.';


-- ────────────────────────────────────────────────────────────────────────────
--  2) El registro de lo que se otorga
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.beneficios_cuenta (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null references public.cuentas(id) on delete cascade,
  tipo        text not null check (tipo in ('cortesia', 'exencion', 'pago', 'ajuste')),
  meses       integer,
  hasta       date,
  motivo      text not null,
  otorgado_por text,
  creado_en   timestamptz not null default now()
);

create index if not exists beneficios_cuenta_idx on public.beneficios_cuenta (cuenta_id, creado_en desc);

comment on table public.beneficios_cuenta is
  'Meses gratis, exenciones y pagos verificados: quién, cuándo, cuánto y por qué.';

-- Solo el fundador. Una cuenta no se regala beneficios a sí misma.
alter table public.beneficios_cuenta enable row level security;
drop policy if exists "fundador_beneficios" on public.beneficios_cuenta;
create policy "fundador_beneficios" on public.beneficios_cuenta for all
  using (public.soy_superadmin())
  with check (public.soy_superadmin());


-- ============================================================================
--  NINGUNA CUENTA NACE CON PRIVILEGIO
--
--  Aquí no se fija la situación de nadie a propósito. Todas las cuentas son
--  iguales al salir de este script: sin exención y sin cortesía. Los
--  beneficios se otorgan desde el Panel del Fundador, uno por uno, con su
--  motivo escrito y su registro en `beneficios_cuenta`.
--
--  Escribir aquí "esta cuenta no paga" seria condenarla a esa condición en el
--  código, y mañana no se sabría quién lo decidió ni por qué.
-- ============================================================================


-- ============================================================================
--  COMPROBACIÓN — el estado de todas las cuentas
-- ============================================================================
-- select nombre, plan_id, estado, exenta, exenta_motivo, cortesia_hasta,
--        plan_desde, ciclo, proximo_cobro
--   from public.cuentas order by creado_en;
-- ============================================================================
