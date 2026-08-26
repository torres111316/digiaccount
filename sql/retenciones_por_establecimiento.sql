-- ============================================================================
--  Las retenciones tambien son de un establecimiento
--  26/08/2026
--
--  EL PROBLEMA
--    sucursal_id vive solo en libro_fiscal. Las retenciones no lo tienen, asi
--    que al sacar el libro de compras de la sucursal el cuadro de retenciones
--    seguia mostrando TODAS las del periodo — las de casa matriz incluidas.
--
--    En un auxiliar por establecimiento eso no cuadra: el libro dice una cosa
--    y el cuadro que va debajo dice otra. Quien lo revise sobre la mesa no
--    tiene forma de saber cual de los dos numeros es el del establecimiento.
--
--  LA SOLUCION
--    La retencion hereda el establecimiento de SU FACTURA. No se pregunta al
--    registrarla —seria una respuesta de mas y una oportunidad de error— sino
--    que sale de la factura que se esta reteniendo, que ya lo sabe.
--
--  EL RELLENO
--    Las retenciones ya cargadas se emparejan con su factura por empresa,
--    numero y RIF del tercero. Una practicada sale de una COMPRA; una sufrida,
--    de una VENTA. Lo que no empareje queda en nulo y se comporta como hasta
--    hoy: aparece en el consolidado.
-- ============================================================================

alter table public.retenciones
  add column if not exists sucursal_id uuid references public.sucursales(id) on delete set null;

create index if not exists retenciones_por_sucursal
  on public.retenciones (sucursal_id) where sucursal_id is not null;

comment on column public.retenciones.sucursal_id is
  'Establecimiento de la factura que se retiene. Nulo = casa matriz o empresa sin sucursales.';


-- ─────────────────────────────────────────────────────────────────────────
--  Una retencion no puede quedar apuntando al establecimiento de OTRA
--  empresa. Es el mismo guardian que ya protege a libro_fiscal.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.validar_sucursal_retencion()
returns trigger
language plpgsql
as $$
begin
  if new.sucursal_id is not null then
    if not exists (
      select 1 from public.sucursales s
       where s.id = new.sucursal_id and s.empresa_id = new.empresa_id
    ) then
      raise exception 'Ese establecimiento no pertenece a esta empresa.'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sucursal_retencion on public.retenciones;
create trigger trg_sucursal_retencion
  before insert or update of sucursal_id, empresa_id on public.retenciones
  for each row execute function public.validar_sucursal_retencion();


-- ─────────────────────────────────────────────────────────────────────────
--  RELLENO · cada retencion toma el establecimiento de su factura
-- ─────────────────────────────────────────────────────────────────────────
update public.retenciones r
   set sucursal_id = l.sucursal_id
  from public.libro_fiscal l
 where r.sucursal_id is null
   and l.sucursal_id is not null
   and l.empresa_id = r.empresa_id
   and upper(btrim(coalesce(l.numero_factura, ''))) = upper(btrim(coalesce(r.factura, '')))
   and coalesce(l.numero_factura, '') <> ''
   and regexp_replace(upper(coalesce(l.tercero_rif, '')), '[^A-Z0-9]', '', 'g')
     = regexp_replace(upper(coalesce(r.tercero_rif, '')), '[^A-Z0-9]', '', 'g')
   -- Una practicada se le hace a un proveedor (compra); una sufrida la hace
   -- un cliente sobre una venta nuestra.
   and l.tipo = case when r.direccion = 'practicada' then 'compra' else 'venta' end;


-- ─────────────────────────────────────────────────────────────────────────
--  VERIFICACION
-- ─────────────────────────────────────────────────────────────────────────
select 'existe la columna' as revision,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'retenciones'
                            and column_name = 'sucursal_id')
            then 'si' else 'NO' end as hallazgo
union all
select 'guardian enganchado',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.retenciones'::regclass
                            and tgname = 'trg_sucursal_retencion' and not tgisinternal)
            then 'si' else 'NO' end
union all
select 'retenciones con establecimiento',
       (select count(*)::text from public.retenciones where sucursal_id is not null)
       || ' de ' || (select count(*)::text from public.retenciones);

-- Reparto por establecimiento, para cotejar contra el libro:
select coalesce(s.codigo || ' · ' || s.nombre, '(casa matriz / sin establecimiento)') as establecimiento,
       r.periodo,
       r.tipo,
       r.direccion,
       count(*)            as cuantas,
       sum(r.monto)        as total
  from public.retenciones r
  left join public.sucursales s on s.id = r.sucursal_id
 group by 1, 2, 3, 4
 order by r.periodo desc, 1;
