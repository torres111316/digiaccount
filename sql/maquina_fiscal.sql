-- =============================================================
-- VENTAS POR MÁQUINA FISCAL · el reporte Z diario
--
-- Un negocio que vende al público por impresora fiscal no asienta una
-- factura por venta: asienta UN renglón por día con el reporte Z, que dice
-- qué máquina fue, qué número de Z, y desde qué comprobante hasta cuál.
-- Es lo que exige el Reglamento del IVA para las ventas a no contribuyentes,
-- y es la forma correcta del libro — no una simplificación.
--
-- POR QUÉ NO ALCANZA LO QUE HABÍA
--   `libro_fiscal` da por sentado que toda venta tiene un tercero y un
--   número de factura. Un reporte Z no tiene ninguno de los dos, y guardarlo
--   así lo dejaría como "una venta sin cliente": se perdería justo lo que lo
--   identifica y lo hace verificable contra la máquina.
--
--   El libro de Radian son 236 reportes Z y 2 facturas. Los dos conviven en
--   el mismo libro, así que las columnas son opcionales y cada renglón es de
--   una clase o de la otra.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

alter table public.libro_fiscal
  -- Serial de la impresora fiscal, tal como sale impreso en el reporte.
  add column if not exists maquina_fiscal text,
  -- Número del reporte Z. Es correlativo por máquina y no se repite.
  add column if not exists numero_zeta text,
  -- Rango de comprobantes que abarca ese Z.
  add column if not exists comprobante_desde text,
  add column if not exists comprobante_hasta text;

comment on column public.libro_fiscal.maquina_fiscal is
  'Serial de la impresora fiscal. Presente solo en los renglones de reporte Z.';
comment on column public.libro_fiscal.numero_zeta is
  'Número del reporte Z diario, correlativo por máquina.';

-- Un renglón de máquina fiscal se reconoce porque tiene máquina Y número de
-- Z. Tener uno sin el otro es un registro a medio llenar: no se puede
-- verificar contra la máquina ni ubicar en su correlativo.
alter table public.libro_fiscal drop constraint if exists libro_maquina_chk;
alter table public.libro_fiscal
  add constraint libro_maquina_chk check (
    (maquina_fiscal is null and numero_zeta is null)
    or (maquina_fiscal is not null and numero_zeta is not null)
  );

-- El mismo Z no se asienta dos veces. Es la protección real contra cargar el
-- libro dos veces: el número de Z es del aparato y no se repite jamás, así
-- que sirve de llave donde no hay número de factura.
create unique index if not exists libro_zeta_unico
  on public.libro_fiscal (empresa_id, maquina_fiscal, numero_zeta)
  where maquina_fiscal is not null;

create index if not exists libro_por_maquina
  on public.libro_fiscal (empresa_id, maquina_fiscal)
  where maquina_fiscal is not null;

-- -------------------------------------------------------------
-- CÓMO DESACTIVARLO
--
-- Son columnas nuevas que nada existente lee: mientras la pantalla no las
-- muestre, el sistema se comporta igual que antes.
--
--   drop index if exists public.libro_zeta_unico;
--   drop index if exists public.libro_por_maquina;
--   alter table public.libro_fiscal drop constraint if exists libro_maquina_chk;
--   alter table public.libro_fiscal drop column if exists maquina_fiscal,
--                                   drop column if exists numero_zeta,
--                                   drop column if exists comprobante_desde,
--                                   drop column if exists comprobante_hasta;
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- COMPROBACIÓN
--
-- Cómo vende cada empresa:
--   select e.nombre,
--          count(*) filter (where l.maquina_fiscal is not null) as por_maquina,
--          count(*) filter (where l.maquina_fiscal is null)     as por_factura
--     from public.libro_fiscal l
--     join public.empresas e on e.id = l.empresa_id
--    where l.tipo = 'venta'
--    group by 1 order by 1;
--
-- Que la numeración de los Z no tenga saltos (un salto puede ser un día sin
-- ventas, o un reporte que no se asentó):
--   select periodo, numero_zeta, comprobante_desde, comprobante_hasta, total
--     from public.libro_fiscal
--    where empresa_id = '<uuid>' and maquina_fiscal is not null
--    order by numero_zeta::bigint;
-- -------------------------------------------------------------
