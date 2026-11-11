# Contabilidad · Plan 5: reportes por nivel y período, Flujo de Efectivo, cuadre con la Forma 30 y asiento de apertura

Spec: `docs/superpowers/specs/2026-11-02-contabilidad-design.md` §7 y §8.
Ejecución: directa (inline), rama `contabilidad-plan5`, revisión final con un subagente.

## Lo que hay hoy (11/11/2026)

- Diario, Mayor, Balance de Comprobación, Resultados, Balance General y Flujo
  salen de **todos** los asientos de la empresa, sin período (solo el Diario
  tiene un selector de mes).
- Niveles: `rollUp(cuentas, n)` corta el código a `n` segmentos; los botones
  dicen «Nivel 1/2/3/Detalle» al revés de como los pide la spec, y un código
  cortado que no está en el plan (3.1.1) sale sin nombre.
- Flujo: el efectivo de cada asiento se le asigna entero a la contrapartida
  más grande; el efectivo inicial es siempre 0.
- Apertura (`sql/apertura_empresa.sql`): cuadra y se cierra, pero sus
  renglones no tienen cuenta contable y cerrar **no genera asiento**: el
  Balance nunca la ve. En Supabase no hay ninguna apertura cargada.
- No existe comparación entre el IVA de la contabilidad y el del libro.

## Decisiones

1. **Niveles** (spec): 1 Detalle (sin enrollar), 2 Cuenta (3 segmentos,
   1.1.1), 3 Grupo (2 segmentos, 1.1), 4 Clase (1 segmento). El nombre de un
   código cortado que no está en el plan: el de su única cuenta hija, o el del
   ancestro más cercano. El Balance General nunca baja de Grupo (necesita
   corriente / no corriente).
2. **Período** común a los seis reportes: Todo, Día, Semana (lunes a domingo),
   Mes, Año, con flechas. Arranca en el mes del último asiento.
   - Diario, Resultados y Flujo: los asientos **dentro** del rango.
   - Mayor y Comprobación: saldo anterior (antes del rango) + movimientos del
     rango + saldo final.
   - Balance General: saldos **al** fin del rango. El resultado de las cuentas
     4, 5 y 6 se parte en «del ejercicio» (desde el 1 de enero del año del
     corte) y «de ejercicios anteriores» (antes), para que cuadre sin asientos
     de cierre.
3. **Flujo de Efectivo, método directo**: en cada asiento con efectivo
   (1.1.1.x), cada línea que no es efectivo aporta su `haber − debe`. Como el
   asiento cuadra, la suma es exactamente lo que entró o salió de caja y
   bancos; no hay prorrateo. Actividad por la contrapartida: 1.2 inversión;
   2.2 y 3 financiamiento; lo demás operación, con rótulos del método directo
   (cobros a clientes, pagos a proveedores, al personal, impuestos...).
   Efectivo inicial = saldo 1.1.1 antes del rango; se verifica que inicial +
   variación = saldo 1.1.1 al fin.
4. **Cuadre con la Forma 30**: `contab_cuadre_iva(empresa, periodo, quincena)`
   en la base. Contabilidad: 2.1.3.01 (haber − debe) y 1.1.3.01 (debe − haber)
   de los asientos del período, sin la liquidación (F30-) ni la apertura.
   Fiscal: el IVA del libro (y de los recibos en modo recibos) con las mismas
   reglas del motor (anuladas fuera, NC resta). Quincena: la guardada en la
   fila del libro, o la del día. Se muestra en el Balance de Comprobación por
   cada mes (o quincena) del rango: «cuadra / no cuadra» con la diferencia.
5. **Apertura con asiento**: `apertura_guia.cuenta` (cuenta sugerida por
   renglón) y `apertura_partidas.cuenta_contable` (la elegida). Renglón nuevo
   de guía: depreciación acumulada (haber). Cerrar la apertura valida las
   cuentas y genera el asiento `APERTURA` a la fecha de corte
   (`origen_tabla = 'apertura'`, `origen_id = empresa`); reabrir lo borra.
   En pantalla: selector de cuenta (bancos de Tesorería con su subcuenta
   primero) y «Traer de Activos fijos» (costo + depreciación inicial).

## Tareas

1. SQL `contabilidad_13_apertura_y_cuadre.sql` + espejo (tablas de apertura)
   + `sql/pruebas/contabilidad_13_pruebas.sql` (rojo → verde).
2. JS: funciones puras (rango, nivel, flujo, saldo anterior) con pruebas en
   `herramientas/pruebas/correr.js`; luego la barra común y los seis reportes.
3. JS: apertura (cuenta por renglón, traer activos, recargar asientos al cerrar).
4. JS: panel del cuadre con la Forma 30.
5. Verificación en vivo (`verificar_motor_contable.py`: apertura y cuadre),
   `sw.js` (versión), revisión final, merge.

## Fuera de este plan

- Numeración cronológica de los asientos (la apertura entra con un número
  posterior a asientos de fechas siguientes): plan 6.
- Cuentas de empresas relacionadas y accionistas: pendiente de Luis.
