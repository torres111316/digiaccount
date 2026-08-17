# -*- coding: utf-8 -*-
"""
Da de alta en el directorio los terceros que ya están en los libros.

  libro de COMPRAS -> proveedor
  libro de VENTAS  -> cliente

QUÉ HACE CON LOS QUE YA EXISTEN
  Nada, salvo una cosa: si le falta el ROL con el que aparece en el libro
  —está como cliente y sale en un libro de compras— se le agrega ese rol.
  No se duplica y no se le toca el nombre.

  Sin eso el tercero existe pero no aparece en el desplegable, porque el
  formulario filtra por rol: clientes en ventas, proveedores en compras.
  Un tercero invisible se vuelve a escribir a mano y termina duplicado con
  otra grafía.

EL DIRECTORIO ES POR CUENTA, NO POR EMPRESA
  `terceros` se llavea por cuenta_id. Se leen solo los libros de las
  empresas de la cuenta indicada: MEDECLO es de otro contador y sus
  terceros no tienen por qué entrar aquí.

QUÉ SE SALTA
  Las filas ANULADA, las que no traen RIF, y los RIF a medio escribir
  —menos de 8 caracteres, como la 'V' sola de una factura de Radian—.
  Un RIF incompleto en el directorio es peor que ninguno: se elige del
  desplegable y se arrastra a la próxima factura.

USO
  python terceros_desde_libros.py --cuenta <uuid|correo>
  Agregar --cargar cuando el ensayo se vea bien.
"""
import argparse
import os
import sys

from cargar_libros import api, norm_rif


def todas(ruta, token, tam=1000):
    """Trae TODAS las filas, de mil en mil.

    PostgREST corta en mil aunque se le pida más, y lo hace en silencio: el
    tope se ve igual que un resultado completo. Sin paginar, este programa
    leía 1.000 de las 1.500 filas de libro y daba por completo un directorio
    al que le faltaban terceros.
    """
    out, desde = [], 0
    while True:
        sep = '&' if '?' in ruta else '?'
        lote = api('%s%slimit=%d&offset=%d' % (ruta, sep, tam, desde), token)
        out.extend(lote)
        if len(lote) < tam:
            return out
        desde += tam


def util(rif):
    """Un RIF sirve si tiene letra y al menos 7 dígitos."""
    r = norm_rif(rif)
    return len(r) >= 8 and r[0].isalpha() and sum(c.isdigit() for c in r) >= 7


# Peso de la letra y de cada uno de los ocho dígitos del cuerpo.
_LETRA = {'V': 1, 'E': 2, 'J': 3, 'P': 4, 'G': 5}
_PESOS = (3, 2, 7, 6, 5, 4, 3, 2)


def digito(rif):
    """Dígito verificador que le corresponde al RIF, o None si no se puede saber.

    Solo se puede calcular cuando el RIF viene completo: letra + ocho dígitos
    de cuerpo + el verificador. Muchas ventas a personas naturales se anotaron
    con la cédula pelada (V19198813, ocho dígitos en total) y ahí no hay nada
    que comprobar; se devuelve None y se deja pasar.

    Sirve para atajar un tipeo antes de que entre al directorio: MAFERCA quedó
    en el libro de noviembre de Radian como J-29901403-6 en una factura y como
    J-29900403-6 en la siguiente. El segundo no cuadra, y con él la retención
    salió al SENIAT con un RIF que no existe.
    """
    r = norm_rif(rif)
    if len(r) != 10 or r[0] not in _LETRA or not r[1:].isdigit():
        return None
    s = _LETRA[r[0]] * 4 + sum(int(d) * p for d, p in zip(r[1:9], _PESOS))
    v = 11 - s % 11
    return 0 if v > 9 else v


def cuadra(rif):
    """False solo cuando el verificador se puede calcular y no coincide."""
    d = digito(rif)
    return d is None or d == int(norm_rif(rif)[9])


def main():
    ap = argparse.ArgumentParser(description='Registra los terceros que ya están en los libros.')
    ap.add_argument('--cuenta', required=True, help='uuid de la cuenta, o el correo de contacto')
    ap.add_argument('--cargar', action='store_true')
    args = ap.parse_args()

    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token. PowerShell:  $env:DA_TOKEN=\'...\'')

    cuentas = api('cuentas?select=id,nombre,email_contacto', token)
    cta = next((c for c in cuentas if c['id'] == args.cuenta
                or (c.get('email_contacto') or '').lower() == args.cuenta.lower()), None)
    if not cta:
        print('Cuentas disponibles:')
        for c in cuentas:
            print('   %-38s %s' % (c['nombre'], c['id']))
        sys.exit('\nNo se encontró la cuenta "%s"' % args.cuenta)

    emps = api('empresas?cuenta_id=eq.%s&select=id,nombre' % cta['id'], token)
    porEmp = {e['id']: e['nombre'] for e in emps}
    print('\n%s\n  %s\n  %d empresas\n%s\n' % ('=' * 72, cta['nombre'], len(emps), '=' * 72))

    dir_ = todas('terceros?cuenta_id=eq.%s&select=id,nombre,rif,es_cliente,es_proveedor'
                 % cta['id'], token)
    por_rif = {norm_rif(t['rif']): t for t in dir_ if t.get('rif')}
    print('en el directorio: %d terceros' % len(dir_))

    lib = todas('libro_fiscal?empresa_id=in.(%s)&select=empresa_id,tipo,tercero_nombre,tercero_rif'
                % ','.join(porEmp), token)
    print('filas de libro leídas: %d\n' % len(lib))

    vistos, saltados = {}, {'anulada': 0, 'sin_rif': 0, 'rif_corto': 0}
    for r in lib:
        nom = (r['tercero_nombre'] or '').strip()
        if nom.upper() == 'ANULADA':
            saltados['anulada'] += 1
            continue
        if not (r['tercero_rif'] or '').strip():
            saltados['sin_rif'] += 1
            continue
        if not util(r['tercero_rif']):
            saltados['rif_corto'] += 1
            continue
        k = norm_rif(r['tercero_rif'])
        v = vistos.setdefault(k, {'nombre': '', 'cli': False, 'prov': False,
                                  'n': 0, 'emp': set()})
        # Se queda el nombre más completo de los que aparezcan.
        if len(nom) > len(v['nombre']):
            v['nombre'] = nom
        if r['tipo'] == 'venta':
            v['cli'] = True
        else:
            v['prov'] = True
        v['n'] += 1
        v['emp'].add(porEmp.get(r['empresa_id'], '?'))

    print('terceros distintos en los libros: %d' % len(vistos))
    print('  se saltan: %d anuladas · %d sin RIF · %d con el RIF a medias\n'
          % (saltados['anulada'], saltados['sin_rif'], saltados['rif_corto']))

    nuevos, roles, malos = [], [], []
    for k, v in vistos.items():
        if not v['nombre']:
            continue                       # sin nombre no se da de alta
        ya = por_rif.get(k)
        if not ya:
            if not cuadra(k):
                # Un RIF con el verificador malo no nace: se elegiría del
                # desplegable y se arrastraría al próximo TXT.
                malos.append((k, v))
            else:
                nuevos.append((k, v))
            continue
        # Al que ya existe se le completa el rol aunque su RIF venga malo:
        # el tercero está creado de todos modos, y negarle el rol solo lo
        # esconde del desplegable. El RIF se corrige aparte.
        falta = {}
        if v['cli'] and not ya.get('es_cliente'):
            falta['es_cliente'] = True
        if v['prov'] and not ya.get('es_proveedor'):
            falta['es_proveedor'] = True
        if falta:
            roles.append((ya, v, falta))

    if nuevos:
        print('A DAR DE ALTA (%d):' % len(nuevos))
        for k, v in sorted(nuevos, key=lambda x: -x[1]['n']):
            rol = '/'.join((['cliente'] if v['cli'] else [])
                           + (['proveedor'] if v['prov'] else []))
            print('   %-12s %-42s %-18s %3d ops  %s'
                  % (k, v['nombre'][:42], rol, v['n'], ', '.join(sorted(v['emp']))[:28]))
        print('')

    if roles:
        print('YA EXISTEN, pero les falta un rol (%d):' % len(roles))
        for ya, v, falta in roles:
            print('   %-12s %-42s + %s'
                  % (norm_rif(ya['rif']), (ya['nombre'] or '')[:42],
                     ', '.join('cliente' if f == 'es_cliente' else 'proveedor' for f in falta)))
        print('')

    if malos:
        print('NO SE CARGAN, el dígito verificador no cuadra (%d):' % len(malos))
        for k, v in malos:
            print('   %-12s %-42s debería terminar en %d  · %d ops  %s'
                  % (k, v['nombre'][:42], digito(k), v['n'], ', '.join(sorted(v['emp']))[:26]))
        print('')

    if not nuevos and not roles:
        print('El directorio ya está completo. No hay nada que hacer.\n')
        return 0
    if not args.cargar:
        print('Ensayo: no se escribió nada. Agrega --cargar para hacerlo.\n')
        return 0

    if nuevos:
        filas = [{
            'cuenta_id': cta['id'], 'nombre': v['nombre'], 'rif': k,
            'es_cliente': v['cli'], 'es_proveedor': v['prov'],
            # tipo_persona sale de la letra del RIF: V/E natural, el resto jurídica.
            'tipo_persona': 'natural' if k[0] in ('V', 'E') else 'juridica',
        } for k, v in nuevos]
        for i in range(0, len(filas), 100):
            api('terceros', token, 'POST', filas[i:i + 100], prefer='return=minimal')
        print('  %d dados de alta' % len(filas))

    for ya, v, falta in roles:
        api('terceros?id=eq.%s' % ya['id'], token, 'PATCH', falta, prefer='return=minimal')
    if roles:
        print('  %d con su rol agregado' % len(roles))

    print('\nListo.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
