# Contabilidad · Propuestas desde cada módulo («Por contabilizar» para todo)

Pedido de Luis (12/11/2026): desde cada módulo (Fiscal, Nómina, Activos, etc.)
sugerir el asiento con los datos ya cargados y llevarlo a Contabilidad, con
los montos puestos y la opción de modificarlo antes de aprobar. Sin alterar
la lógica de los módulos.

Alcance: empresas en modo revisión (`empresas.contab_resumen = true`, las de
la firma). En las demás todo sigue como hoy.

## Diseño

- **Borradores** (`contab_borradores`): un asiento propuesto por un módulo,
  con clave única por empresa (p. ej. `F30-10/2026`, `DECL-<id>`,
  `NOM-quincenal-2026-10-01`, `DEPR-10/2026`). Guarda la propuesta, lo
  aprobado, si se corrigió, la huella y el asiento resultante.
- RPC comunes: `contab_proponer` (crea o actualiza; si ya estaba aprobado y
  la propuesta cambió, queda «desactualizado»), `contab_aprobar_borrador`
  (con huella, bloqueo y mes cerrado), `contab_deshacer_borrador`.
- «Por contabilizar» lista los resúmenes (SQL 15) y los borradores, juntos,
  por período. `contab_filas_sin_asiento` cuenta los borradores pendientes:
  «Cerrar mes» no cierra con algo sin aprobar.
- Botón «Contabilizar» en cada módulo → abre Contabilidad › Por contabilizar
  en ese período, con el asiento abierto.

## Cada módulo

| Módulo | Cómo propone |
|---|---|
| Libros y retenciones | ya hecho (resúmenes, SQL 15) |
| Liquidación de la Forma 30 | `contab_proponer_liquidacion_iva` (la lógica de «Cerrar mes» llevada a la base, por mes o quincena); exige ventas, compras y retenciones de IVA sufridas aprobadas |
| Declaraciones y pagos | el disparador de `declaraciones` propone en vez de asentar |
| Depreciación / baja / anular baja | las funciones del SQL 07 proponen en vez de asentar |
| Revaluación (SQL 12) | propone en vez de asentar (si el SQL 12 está) |
| Nómina, criptoactivos, impuesto diferido | el navegador manda las líneas a `contab_proponer` |

## Tareas
1. SQL 16 + pruebas: borradores, RPC, liquidación F30, declaraciones, activos, revaluación, cierre.
2. JS: Por contabilizar con borradores; botones en Libro de Compras, Ventas, Forma 30, Declaraciones, Nómina, Activos, Cripto, Diferido; «Cerrar mes» en modo revisión.
3. Pruebas JS, verificación en vivo, revisión final, merge.
