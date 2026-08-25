-- ============================================================================
--  Se acaba la prueba abierta de 14 dias
--  24/08/2026
--
--  POR QUE
--    Un sistema fiscal no se evalua en dos semanas: hay que cargar un mes de
--    facturas, ver el libro armarse y que el portal acepte el TXT. El que
--    entraba a probar solo alcanzaba a ver formularios vacios. Y una prueba
--    que se lleva cualquiera deja sin valor el mes de cortesia que van a
--    repartir los socios del programa de referidos.
--
--  QUE NO SE TOCA
--    La maquinaria de prueba se CONSERVA COMPLETA: la columna, el banner de
--    vencimiento y el guardian de blindaje_db.sql que impide que una cuenta
--    se estire sola la fecha. No se desmonta nada: cambia unicamente QUIEN
--    dispara el reloj. Hoy lo dispara el registro; manana lo dispara el canje
--    de un cupon de socio, o nosotros tras una demostracion.
--
--  QUIEN YA ESTA EN PRUEBA
--    Conserva sus dias. Esto es un DEFAULT de columna: solo afecta a las
--    cuentas que se creen de aqui en adelante. No toca una sola fila existente.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
--  PARTE 1 · DIAGNOSTICO — correr esto PRIMERO y leer el resultado
--
--  Hace falta saber QUIEN pone los 14 dias. Si es un DEFAULT de la columna,
--  la Parte 2 lo resuelve. Si ademas hay un TRIGGER que la escribe, la Parte 2
--  NO alcanza: en ese caso hay que ver el trigger antes de tocar nada.
-- ─────────────────────────────────────────────────────────────────────────

-- 1.a · El valor por defecto de la columna
select column_name,
       data_type,
       is_nullable,
       column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'cuentas'
   and column_name  = 'trial_termina_en';

-- 1.b · Triggers vivos sobre la tabla de cuentas
select t.tgname                          as trigger_name,
       p.proname                         as funcion,
       pg_get_triggerdef(t.oid)          as definicion
  from pg_trigger t
  join pg_proc    p on p.oid = t.tgfoid
 where t.tgrelid = 'public.cuentas'::regclass
   and not t.tgisinternal;

-- 1.c · Cuantas cuentas estan en prueba ahora mismo (estas conservan sus dias)
select count(*) filter (where trial_termina_en is not null)                as con_fecha,
       count(*) filter (where trial_termina_en > now())                    as prueba_vigente,
       count(*) filter (where trial_termina_en <= now())                   as prueba_vencida,
       min(trial_termina_en)                                               as la_mas_proxima,
       max(trial_termina_en)                                               as la_mas_lejana
  from public.cuentas;


-- ─────────────────────────────────────────────────────────────────────────
--  PARTE 2 · EL CAMBIO
--
--  Correr solo si la Parte 1 mostro un column_default con los 14 dias y
--  NINGUN trigger que escriba esa fecha. Quitar el default no borra datos:
--  las cuentas nuevas simplemente nacen sin fecha de vencimiento, que es
--  como debe quedar cuando no hay cortesia otorgada.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.cuentas alter column trial_termina_en drop default;


-- ─────────────────────────────────────────────────────────────────────────
--  PARTE 3 · VERIFICACION
--  column_default tiene que volver vacio (null).
-- ─────────────────────────────────────────────────────────────────────────

select column_name, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'cuentas'
   and column_name  = 'trial_termina_en';
