-- =============================================================
-- IDENTIDAD VISUAL DE LA EMPRESA
--
-- Los colores de la empresa se mostraban en Configuración pero no tenían
-- dónde guardarse: al recargar volvían al valor por defecto. Un campo que se
-- deja escribir y no guarda es peor que no tenerlo, porque quien lo llenó
-- cree que quedó.
--
-- Idempotente. No borra ni modifica ningún dato existente.
-- =============================================================

alter table public.empresas
  -- Color principal: cabeceras y acentos de facturas y reportes.
  add column if not exists color_primario   text,
  -- Color secundario: subtítulos, bordes y detalles.
  add column if not exists color_secundario text;

-- Solo se admiten colores en formato #RRGGBB. Un valor suelto ahí termina
-- inyectado en el estilo de un documento que se imprime.
alter table public.empresas drop constraint if exists empresas_color_primario_chk;
alter table public.empresas
  add constraint empresas_color_primario_chk
  check (color_primario is null or color_primario ~ '^#[0-9A-Fa-f]{6}$');

alter table public.empresas drop constraint if exists empresas_color_secundario_chk;
alter table public.empresas
  add constraint empresas_color_secundario_chk
  check (color_secundario is null or color_secundario ~ '^#[0-9A-Fa-f]{6}$');

-- -------------------------------------------------------------
-- COMPROBACIÓN
-- select nombre, color_primario, color_secundario from public.empresas order by nombre;
-- -------------------------------------------------------------
