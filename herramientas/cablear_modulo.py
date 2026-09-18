# -*- coding: utf-8 -*-
"""Cablea un archivo de modulo recien sacado de app.js.

Lo pone en los tres sitios donde tiene que estar, o la app arranca a medias:

  1. index.html — la etiqueta <script>, justo antes de nomina.js
  2. sw.js      — la copia sin conexion, y sube la version de la cache
  3. herramientas/pruebas/correr.js — para que las pruebas lean tambien ahi

    python herramientas/cablear_modulo.py tesoreria.js

Respeta el final de linea de cada archivo (todo el proyecto usa CRLF), para no
ensuciar el diff con miles de lineas que en realidad no cambiaron.
"""
import io, os, re, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LF, CRLF = chr(10), chr(13) + chr(10)
ULTIMO = 'nomina.js'     # el que va de ultimo en el orden de carga


def cambiar(rel, pares):
    ruta = os.path.join(BASE, rel)
    s = io.open(ruta, encoding='utf-8', newline='').read()
    salto = CRLF if CRLF in s else LF
    for viejo, nuevo in pares:
        viejo, nuevo = viejo.replace(LF, salto), nuevo.replace(LF, salto)
        if nuevo in s:
            print('   ya estaba:', rel)
            return
        assert viejo in s, 'no encuentro en %s: %r' % (rel, viejo[:60])
        s = s.replace(viejo, nuevo, 1)
    io.open(ruta, 'w', encoding='utf-8', newline='').write(s)
    print('   listo:', rel)


def main(archivo):
    print('cableando assets/%s' % archivo)

    cambiar('index.html', [(
        '<script src="assets/%s"></script>' % ULTIMO,
        '<script src="assets/%s"></script>%s<script src="assets/%s"></script>' % (archivo, LF, ULTIMO))])

    # La version de la cache sube sola: sin eso, el telefono se queda con la vieja.
    sw = io.open(os.path.join(BASE, 'sw.js'), encoding='utf-8', newline='').read()
    ver = int(re.search(r"digiaccount-v(\d+)", sw).group(1))
    cambiar('sw.js', [
        ('digiaccount-v%d' % ver, 'digiaccount-v%d' % (ver + 1)),
        ("'./assets/%s'" % ULTIMO,
         "'./assets/%s',%s  './assets/%s'" % (archivo, LF, ULTIMO)),
    ])
    print('   cache: v%d -> v%d' % (ver, ver + 1))

    rel = os.path.join('herramientas', 'pruebas', 'correr.js')
    pruebas = io.open(os.path.join(BASE, rel), encoding='utf-8', newline='').read()
    lista = re.search(r"\[('[\w.]+\.js'(?:, '[\w.]+\.js')*)\]", pruebas).group(1)
    cambiar(rel, [(
        '[%s]' % lista,
        '[%s]' % lista.replace("'%s'" % ULTIMO, "'%s', '%s'" % (archivo, ULTIMO)))])


if __name__ == '__main__':
    main(sys.argv[1])
