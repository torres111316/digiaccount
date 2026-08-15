# Prueba de `revisar_libros.py`

`libro_con_errores.md` es un libro recortado que reproduce, con los datos
reales de GATMA, los cuatro errores que aparecieron al revisar sus libros
antes de cargarlos. Sirve para comprobar que el revisor los sigue viendo
después de cualquier cambio.

Se corre así:

```
python herramientas/revisar_libros.py herramientas/pruebas/libro_con_errores.md
```

Debe reportar **8 problemas**, ni más ni menos:

| Clase | Cuántos | Qué |
|---|---|---|
| no cuadra | 1 | Septiembre: el total supera a base+IVA en 98.781,14 |
| sin tercero | 4 | Febrero 2da: las facturas 000091 y 000092 sin RIF ni nombre |
| fecha | 2 | Septiembre: fecha 20/08/2026 — futura y fuera del período |
| periodo | 1 | La hoja se llama 2da quincena y su rango dice la primera |

Y en el resumen, tres cosas más que no son problemas pero deben verse:

- La línea **SUCURSAL BARQUISIMETO** aparece aparte, marcada como no
  cargable. Es un resumen, no una operación: cargarla junto a las facturas
  de la sucursal contaría el período dos veces.
- **Septiembre** sale como `mes`, no como quincena — su rango cubre el mes
  completo.
- **Junio 1ra** y sus dos operaciones con RIF y nombre no generan ninguna
  queja. Que no haya falsos positivos importa tanto como que detecte: un
  revisor que se queja de todo se ignora, y entonces no revisa nada.

## Por qué este archivo tiene la codificación rota

Los encabezados dicen `NÂ° de Factura` y `RazÃ³n Social` a propósito. Así
salen del export, y no es un detalle cosmético: `NÂ°` normaliza a `na` y
deja de parecerse a `n`, de modo que el revisor no encontraba la columna
del número de factura. Peor, al no ubicar esa columna, el apodo suelto
`iva` se enganchaba a **Compras Sin Derecho a Crédito IVA** y comparaba el
impuesto contra el monto exento.

Si algún día se "arregla" la codificación de este archivo, la prueba deja
de cubrir el caso que la motivó.
