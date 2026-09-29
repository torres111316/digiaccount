# La sonda de navegador

Hay fallos que **no se ven** leyendo el código como texto (`correr.js`) ni con
un DOM de mentira (`tablas.js`), porque dependen de cómo el navegador **pinta**
las cosas. Estos dos costaron caro:

1. **El motor de tablas borraba los contadores del pie.** Escribía el pie con
   `innerHTML`, y dentro de catorce pies viven elementos con `id` que los
   módulos rellenan (`tercerosShown`, `invShown`, `leadsShown`…). Se llevó por
   delante **13 de 24**, y el módulo de Contactos reventaba después al escribir
   sobre algo que ya no existía.

2. **Ctrl+P pulsaba el botón de un recibo cerrado.** Buscaba el botón de
   imprimir «visible» por su tamaño; pero las ventanas de esta app no se
   esconden con `display:none`, se quedan con `opacity: 0`. Todas medían.

Ninguno de los dos da error en consola. Los dos se ven en un segundo aquí.

## Cómo se corre

Desde la raíz del proyecto, en dos terminales:

```
python -m http.server 8099
```

```
python herramientas/pruebas/navegador/correr.py
```

El segundo arma un `index.html` temporal con la sonda dentro, lo abre en Chrome
sin ventana y escribe el resultado. Termina con error si algo falla, así que
sirve antes de un Deploy.

Necesita Chrome instalado. Si no lo encuentra, lo dice y sale bien — no bloquea
nada.

## Por qué la sonda va en un archivo aparte

El CSP de la app es `script-src 'self'`: un `<script>` escrito dentro del HTML
queda bloqueado. Por eso `correr.py` deja un `_sonda.js` al lado del index y lo
enlaza — y por eso hace falta el servidor local, no vale abrir el archivo
directamente.

Los dos archivos temporales se borran siempre, incluso si Chrome falla.
