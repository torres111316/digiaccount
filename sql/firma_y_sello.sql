  -- ============================================================================
  --  FIRMA Y SELLO DE LA EMPRESA
  --  27/08/2026
  --
  --  PARA QUE
  --    Los comprobantes de retencion se imprimen con una linea vacia donde el
  --    agente firma a mano. Teniendo la firma y el sello en digital, se pueden
  --    estampar y el documento sale listo para entregar.
  --
  --  QUE ES Y QUE NO ES
  --    Es un FACSIMIL: la imagen de una firma manuscrita. NO es una firma
  --    electronica certificada en el sentido de la Ley sobre Mensajes de Datos y
  --    Firmas Electronicas. Para un comprobante de retencion es la practica
  --    normal y aceptada, pero conviene no confundir una cosa con la otra.
  --
  --  POR QUE UNA TABLA APARTE Y NO COLUMNAS EN empresas
  --    Las imagenes van como data URL, y aunque son pequenas, meterlas en
  --    `empresas` haria que CADA consulta de empresa las arrastre — el selector,
  --    el encabezado, el cambio de empresa. Aparte se leen solo al imprimir o al
  --    abrir la configuracion.
  --
  --  DE PASO: EL LOGO
  --    Hoy el logo se carga en Configuracion, se previsualiza y dice "se usara
  --    en tus documentos" — pero no se guarda en ninguna parte y se pierde al
  --    recargar. Una promesa que el sistema no cumplia. Aqui tambien se guarda.
  --
  --  QUIEN FIRMA
  --    No basta la imagen: un comprobante debe decir QUIEN firmo. Se guarda el
  --    nombre, la cedula y el cargo, que es lo que se imprime debajo del trazo.
  -- ============================================================================

  create table if not exists public.empresa_firma (
    empresa_id        uuid primary key references public.empresas(id) on delete cascade,
    cuenta_id         uuid not null references public.cuentas(id) on delete cascade,

    -- Imagenes como data URL (data:image/png;base64,...)
    firma_img         text,
    sello_img         text,
    logo_img          text,

    -- Quien firma. Se imprime debajo del trazo.
    firmante_nombre   text,
    firmante_cedula   text,
    firmante_cargo    text,

    -- Si se estampan automaticamente al imprimir, o si el documento sale con la
    -- linea en blanco para firmar a mano. Hay contadores que prefieren lo
    -- segundo, y es una decision de cada empresa.
    estampar          boolean not null default true,

    actualizado_en    timestamptz not null default now(),
    creado_en         timestamptz not null default now()
  );

  comment on table public.empresa_firma is
    'Firma, sello y logo de la empresa para estampar en los documentos. La firma es un facsimil, no una firma electronica certificada.';


  -- ─────────────────────────────────────────────────────────────────────────
  --  Un tope de tamano, en la base y no solo en la pantalla.
  --  Una firma en PNG pesa 20-60 KB. Medio mega ya es una foto sin recortar, y
  --  eso hace lento cada documento que se imprima.
  -- ─────────────────────────────────────────────────────────────────────────
  create or replace function public.validar_tamano_firma()
  returns trigger
  language plpgsql
  as $$
  declare
    v_max int := 700000;   -- ~500 KB reales; el data URL crece un tercio en base64
  begin
    if length(coalesce(new.firma_img, '')) > v_max
      or length(coalesce(new.sello_img, '')) > v_max
      or length(coalesce(new.logo_img,  '')) > v_max then
      raise exception 'Esa imagen pesa demasiado. Recortala y subela de nuevo: una firma o un sello no deberian pasar de 500 KB.'
        using errcode = 'check_violation';
    end if;
    return new;
  end;
  $$;

  drop trigger if exists trg_tamano_firma on public.empresa_firma;
  create trigger trg_tamano_firma
    before insert or update on public.empresa_firma
    for each row execute function public.validar_tamano_firma();


  -- ─────────────────────────────────────────────────────────────────────────
  --  RLS · la firma de una empresa es de su cuenta y de nadie mas
  -- ─────────────────────────────────────────────────────────────────────────
  alter table public.empresa_firma enable row level security;

  drop policy if exists firma_todo on public.empresa_firma;
  create policy firma_todo on public.empresa_firma for all
    using (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id())
    with check (public.soy_superadmin() or cuenta_id = public.mi_cuenta_id());


  -- ─────────────────────────────────────────────────────────────────────────
  --  VERIFICACION
  -- ─────────────────────────────────────────────────────────────────────────
  select 'tabla creada' as revision,
        case when exists (select 1 from information_schema.tables
                            where table_schema='public' and table_name='empresa_firma')
              then 'si' else 'NO' end as hallazgo
  union all
  select 'tope de tamano enganchado',
        case when exists (select 1 from pg_trigger
                            where tgrelid = 'public.empresa_firma'::regclass
                              and tgname = 'trg_tamano_firma' and not tgisinternal)
              then 'si' else 'NO' end
  union all
  select 'politica RLS',
        (select count(*)::text from pg_policies
          where schemaname='public' and tablename='empresa_firma')
  union all
  select 'nada existente fue modificado', 'correcto: solo CREATE';
