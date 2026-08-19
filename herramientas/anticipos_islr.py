# -*- coding: utf-8 -*-
"""
Calcula el anticipo de ISLR del 1% sobre las ventas y lo deja registrado.

POR QUÉ SE CALCULA Y NO SE IMPORTA
  El anticipo no se declara aparte: lo genera el portal al presentar el IVA,
  así que no hay una relación que descargar ni un número de declaración que
  anotar. Lo que sí hace falta guardar es el MONTO de cada período: es lo que
  se rebaja en la declaración anual de ISLR, y sin él hay que rehacer la
  cuenta doce veces al cierre del ejercicio.

  La base es la misma que ya está cargada: los ingresos brutos del libro de
  ventas. Si el libro cuadra con la Forma 30 —y cuadra, se coteja contra las
  declaraciones presentadas—, el anticipo cuadra por construcción.

CADA CUÁNTO
  El anticipo sigue a la declaración de IVA. Un especial que declara por
  quincena genera uno por quincena; los demás, uno por mes. De ahí que la
  periodicidad no se pregunte: se toma de cómo esté declarando la empresa,
  que es lo que dice `quincena` en el propio libro.

LO QUE NO HACE
  No inventa el número de declaración. Estas filas quedan con `numero` nulo,
  y por eso hace falta `sql/declaraciones_sin_numero.sql`: la unicidad pasa a
  ser el período, de modo que volver a correr esto no duplica nada.

  Tampoco toca las ANULADAS ni los períodos ya cargados.

USO
  python anticipos_islr.py --rif J-50282611-4
  Agregar --cargar cuando el ensayo se vea bien.
"""
import argparse
import collections
import os
import sys

from cargar_libros import api, norm_rif
from terceros_desde_libros import todas

PCT = 0.01   # Decreto 3.719: 1% sobre los ingresos brutos del período


def main():
    ap = argparse.ArgumentParser(description='Anticipo de ISLR del 1% sobre las ventas.')
    ap.add_argument('--rif', required=True)
    ap.add_argument('--cargar', action='store_true')
    args = ap.parse_args()

    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token en DA_TOKEN.')

    objetivo = norm_rif(args.rif)
    emp = next((e for e in api('empresas?select=id,nombre,rif,cuenta_id', token)
                if norm_rif(e.get('rif')) == objetivo), None)
    if not emp:
        sys.exit('No hay ninguna empresa con el RIF %s' % args.rif)

    ventas = [r for r in todas(
        'libro_fiscal?empresa_id=eq.%s&tipo=eq.venta'
        '&select=periodo,quincena,base_gen,base_red,base_adic,exento,tercero_nombre' % emp['id'], token)
        if (r.get('tercero_nombre') or '').upper() != 'ANULADA']

    def n(v):
        return float(v or 0)

    # Ingresos brutos: todo lo vendido, gravado y exento. Es la base del 1%.
    grupos = collections.defaultdict(lambda: [0.0, 0])
    for r in ventas:
        clave = (r['periodo'], r['quincena'] if r['quincena'] in (1, 2) else None)
        grupos[clave][0] += n(r['base_gen']) + n(r['base_red']) + n(r['base_adic']) + n(r['exento'])
        grupos[clave][1] += 1

    print('\n%s\n  %s · %s\n  Anticipo de ISLR · %s%% de los ingresos brutos\n%s\n'
          % ('=' * 84, emp['nombre'], emp['rif'], PCT * 100, '=' * 84))

    ya = todas('declaraciones?empresa_id=eq.%s&impuesto=eq.ISLR_ANTICIPO'
               '&select=periodo,quincena,monto' % emp['id'], token)
    cargados = set((d['periodo'], d['quincena']) for d in ya)

    filas, repetidos = [], 0
    for (per, q), (bruto, ops) in sorted(grupos.items()):
        if (per, q) in cargados:
            repetidos += 1
            continue
        filas.append({
            'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'],
            'impuesto': 'ISLR_ANTICIPO', 'periodo': per, 'quincena': q,
            'numero': None, 'fecha': None, 'tipo': 'ORIGINARIA',
            'monto': round(bruto * PCT, 2), 'a_pagar': round(bruto * PCT, 2),
            'estado': None,
            'nota': 'Calculado sobre %s de ingresos brutos (%d operaciones del libro de ventas)'
                    % ('{:,.2f}'.format(bruto), ops),
        })

    print('%-9s %-9s %6s %18s %14s' % ('período', 'quincena', 'ops', 'ingresos brutos', 'anticipo 1%'))
    print('-' * 62)
    for f, (per, q) in zip(filas, [(x['periodo'], x['quincena']) for x in filas]):
        bruto, ops = grupos[(per, q)]
        print('%-9s %-9s %6d %18s %14s'
              % (per, '1ra' if q == 1 else '2da' if q == 2 else 'mes', ops,
                 '{:,.2f}'.format(bruto), '{:,.2f}'.format(f['monto'])))
    print('-' * 62)
    print('%-26s %18s %14s'
          % ('TOTAL (%d períodos)' % len(filas),
             '{:,.2f}'.format(sum(grupos[(f['periodo'], f['quincena'])][0] for f in filas)),
             '{:,.2f}'.format(sum(f['monto'] for f in filas))))
    if repetidos:
        print('\nya estaban cargados: %d períodos' % repetidos)

    if not filas:
        print('\nNo hay nada nuevo que registrar.\n')
        return 0
    if not args.cargar:
        print('\nEnsayo: no se escribió nada. Agrega --cargar para hacerlo.\n')
        return 0

    for i in range(0, len(filas), 100):
        api('declaraciones', token, 'POST', filas[i:i + 100], prefer='return=minimal')
    total = todas('declaraciones?empresa_id=eq.%s&impuesto=eq.ISLR_ANTICIPO&select=monto' % emp['id'], token)
    print('\n%d registrados · la empresa acumula %s de anticipos en %d períodos\n'
          % (len(filas), '{:,.2f}'.format(sum(float(d['monto']) for d in total)), len(total)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
