# -*- coding: utf-8 -*-
"""Saca un modulo de assets/app.js a su propio archivo.

Se usa para ir partiendo el archivo grande de a un modulo por vez, segun el
plan de docs/arquitectura.md. Mueve el bloque TAL CUAL: no toca una sola linea
de su cuerpo. Lo unico que agrega es la envoltura y, si hace falta, los nombres
cortos que el modulo usaba del bloque grande y que ya viven en el nucleo.

    python herramientas/sacar_modulo.py <nombre>

Antes de correrlo hay que comprobar que el modulo no dependa de nombres
privados del bloque grande (los que tenga deben estar ya en core.js). Despues,
hay que cablear el archivo nuevo en index.html y en sw.js, o la app arranca a
medias.

Los modulos que se pueden sacar y como se describen estan en FICHAS. Para
agregar uno nuevo, se anota aqui su ficha y se corre.
"""
import io, os, re, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(BASE, 'assets', 'app.js')
LF, CRLF = chr(10), chr(13) + chr(10)

FICHAS = {
    'tesoreriaModule': {
        'archivo': 'tesoreria.js',
        'titulo': 'TESORERIA',
        'que': ('Cuentas de banco y caja, movimientos, cobros y pagos, la conciliacion\n'
                '   contra el estado de cuenta, y las cuentas por cobrar y por pagar.'),
        'porque': ('Salio sin arrastrar nada: es el unico modulo grande que no usaba\n'
                   '   ningun nombre privado del bloque grande. Todo lo que necesita de los\n'
                   '   demas ya se lo pedia a `window.__*`.'),
        'usa': [],
        'expone': ('lo que expone —el cobrado de una\n'
                   '   factura, el recibo de cobro, la recarga de la vista— lo consumen\n'
                   '   ventas, compras y el panel'),
    },
    'facturas': {
        'archivo': 'facturas.js',
        'titulo': 'FACTURAS',
        'que': ('El visor de la factura fiscal venezolana: la factura en pantalla y\n'
                '   en papel, el ticket y como se comparte, y las notas de credito y de\n'
                '   debito que la corrigen sin tocarla.'),
        'porque': ('Solo usaba dos nombres privados del bloque grande —`esc` y\n'
                   '   `drawIcons`—, que ya viven en el nucleo. (El tercero, `fmtF`, no lo\n'
                   '   tenia nadie: faltaba, y por eso el boton de Notas reventaba.)'),
        'usa': ['esc', 'drawIcons'],
        'expone': ('lo que expone —la factura, su lista, el\n'
                   '   ticket en PDF y el compartir— lo consumen ventas, tesoreria y el\n'
                   '   modulo fiscal'),
    },
}


def main(nombre):
    ficha = FICHAS[nombre]
    src = io.open(APP, encoding='utf-8', newline='').read().replace(CRLF, LF).split(LF)

    # Se ubica el modulo por su nombre, no por numero de linea: si el archivo
    # se movio, el corte sigue cayendo donde debe.
    abre = None
    for i, ln in enumerate(src, 1):
        if ln.rstrip() == '  (function %s() {' % nombre:
            abre = i
            break
    if abre is None:
        raise SystemExit('no encuentro el modulo %s en app.js' % nombre)
    cierra = None
    for i in range(abre + 1, len(src) + 1):
        if src[i - 1].rstrip() == '  })();':
            cierra = i
            break
    if cierra is None:
        raise SystemExit('no encuentro donde cierra %s' % nombre)

    # La cabecera de comentario que va justo encima, si la tiene
    desde = abre
    if src[abre - 2].strip() == '========================================================= */':
        k = abre - 2
        while k > 0 and not src[k - 1].lstrip().startswith('/* ====='):
            k -= 1
        desde = k

    cuerpo = src[desde - 1:cierra]
    alias = ''.join('  const %s = window.__%s;%s' % (u, u, LF) for u in ficha['usa'])
    if alias:
        alias = '  // Los nombres cortos que usa el cuerpo, apuntando al nucleo.%s%s%s' % (LF, alias, LF)

    cabecera = (
        '/* =========================================================%s'
        '   DigiAccount ERP — %s%s'
        '   %s%s'
        '%s'
        '   %s%s'
        '%s'
        '   Se carga DESPUES de app.js: %s%s'
        '   a traves de `window.*`, y lo que necesita de ellos tambien.%s'
        '   ========================================================= */%s'
        '(function () {%s'
        "  'use strict';%s%s"
        % (LF, ficha['titulo'], LF, ficha['que'], LF, LF, ficha['porque'], LF, LF,
           ficha['expone'], LF, LF, LF, LF, LF, LF + alias))

    ruta_nueva = os.path.join(BASE, 'assets', ficha['archivo'])
    io.open(ruta_nueva, 'w', encoding='utf-8', newline='').write(
        (cabecera + LF.join(cuerpo) + LF + '})();' + LF).replace(LF, CRLF))

    nota = [
        '  /* %s vive ahora en assets/%s — se saco de aqui para que' % (ficha['titulo'], ficha['archivo']),
        '     este archivo deje de crecer. Lo que publica en `window.*` se sigue',
        '     usando igual desde los demas modulos. */',
    ]
    resto = src[:desde - 1] + nota + src[cierra:]
    io.open(APP, 'w', encoding='utf-8', newline='').write(LF.join(resto).replace(LF, CRLF))

    print('%s: lineas %d-%d (%d) -> assets/%s' % (nombre, desde, cierra, cierra - desde + 1, ficha['archivo']))
    print('app.js: %d lineas (antes %d)' % (len(resto), len(src)))
    print('FALTA cablearlo en index.html y en sw.js.')


if __name__ == '__main__':
    main(sys.argv[1])
