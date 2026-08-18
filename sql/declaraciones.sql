-- =============================================================
-- LAS DECLARACIONES PRESENTADAS
--
-- Hasta ahora el sistema calculaba impuestos pero no guardaba ni una sola
-- declaración presentada. El panel de DPP, por ejemplo, es una calculadora:
-- saca el 9% y pinta la planilla, y ahí se acaba. Lo que el contador tiene
-- —el número que asignó el SENIAT, la fecha, el monto y si ya se pagó—
-- vivía en un Excel aparte, fuera del sistema.
--
-- UNA SOLA TABLA PARA TODOS LOS IMPUESTOS
--   DPP, IGTF y los anticipos de ISLR se declaran distinto pero se anotan
--   igual: número, período, tipo, monto, estado. Separarlos en tres tablas
--   obligaría a repetir la misma consulta tres veces para responder "qué
--   debe esta empresa", que es la pregunta que de verdad se hace.
--
-- LA QUINCENA VA APARTE DEL PERÍODO
--   El IGTF es quincenal. Guardar '2026-07-1ra' como texto haría imposible
--   ordenar por período o cruzarlo con `libro_fiscal`, que ya separa el mes
--   de la quincena. Nulo = la declaración es del mes completo, igual que en
--   el libro.
--
-- QUÉ IDENTIFICA A UNA DECLARACIÓN
--   El número que asigna el SENIAT, que no se repite. Por eso la llave
--   única es (empresa_id, impuesto, numero) y no el período: de un mismo
--   período puede haber una originaria y varias sustitutivas, y las tres
--   son declaraciones de verdad que hay que conservar.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

create table if not exists public.declaraciones (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid not null,
  empresa_id  uuid not null,
  impuesto    text not null,              -- DPP, IGTF, ISLR_ANTICIPO, IVA, ISLR_ANUAL...
  periodo     text not null,              -- 'aaaa-mm'
  quincena    smallint,                   -- 1, 2 o nulo (= el mes completo)
  numero      text not null,              -- el que asigna el SENIAT al transmitir
  fecha       date,                       -- fecha de registro de la declaración
  tipo        text not null default 'ORIGINARIA',
  monto       numeric(18,2) not null default 0,   -- monto declarado
  a_pagar     numeric(18,2) not null default 0,   -- monto a pagar (puede ser 0)
  estado      text,                       -- PAGO CONCILIADO, PENDIENTE DE PAGO...
  nota        text,
  creado_en   timestamptz not null default now(),
  constraint declaraciones_quincena_valida check (quincena is null or quincena in (1, 2)),
  constraint declaraciones_periodo_valido  check (periodo ~ '^\d{4}-\d{2}$'),
  unique (empresa_id, impuesto, numero)
);

comment on table public.declaraciones is
  'Declaraciones presentadas al SENIAT: número, período, monto y estado de pago.';
comment on column public.declaraciones.quincena is
  'Nulo = la declaración es del mes completo. 1 o 2 para las quincenales (IGTF).';

create index if not exists declaraciones_por_periodo
  on public.declaraciones (empresa_id, impuesto, periodo);

alter table public.declaraciones enable row level security;

drop policy if exists tenant_declaraciones on public.declaraciones;
create policy tenant_declaraciones on public.declaraciones for all
  using (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id())
         or public.soy_superadmin())
  with check (empresa_id in (select id from public.empresas where cuenta_id = public.mi_cuenta_id())
              or public.soy_superadmin());
