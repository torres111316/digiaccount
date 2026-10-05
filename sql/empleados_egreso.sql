-- Fecha de egreso del trabajador.
--
-- «Dar de baja» nunca borro al trabajador: solo lo marca inactivo. Pero no
-- guardaba QUE DIA se fue, y sin esa fecha no se puede volver a calcular ni
-- reimprimir su liquidacion, ni emitirle una constancia de trabajo.
--
-- Con esta columna, la pestaña de Liquidacion registra el egreso y sigue
-- mostrando al trabajador como «egresado». Es seguro correrlo mas de una vez.

alter table public.empleados add column if not exists fecha_egreso date;

comment on column public.empleados.fecha_egreso is
  'Ultimo dia trabajado. Nulo mientras el trabajador esta activo.';
