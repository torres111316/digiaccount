# -*- coding: utf-8 -*-
"""
Asigna la quincena a retenciones que quedaron sin ella.

POR QUÉ EXISTE
  Una retención sin quincena sale en las DOS declaraciones quincenales, así
  que presentando las dos se enteraría dos veces. La pantalla ya deja
  asignarla una por una; esto sirve para un lote, y para cuando la pantalla
  todavía no está actualizada en la máquina de quien lo necesita.

NO DEDUCE NADA
  La quincena se pasa por parámetro. No se saca de la fecha: la quincena de
  una retención es la del período en que se ENTERA, no la del día de la
  factura — en Radian hay nueve de octubre fechadas en septiembre, compras
  recibidas tarde, y por el día se irían a la que no es.

USO
  python quincena_a_mano.py --rif V-19265125-1 --periodo 2026-08 --quincena 1
  Agregar --cargar cuando el ensayo se vea bien.
"""
import argparse
import os
import sys

from cargar_libros import api, norm_rif


def main():
    ap = argparse.ArgumentParser(description='Asigna la quincena a retenciones sin ella.')
    ap.add_argument('--rif', required=True)
    ap.add_argument('--periodo', required=True, help="'aaaa-mm'")
    ap.add_argument('--quincena', required=True, type=int, choices=[1, 2])
    ap.add_argument('--tipo', default='iva', choices=['iva', 'islr'])
    ap.add_argument('--cargar', action='store_true')
    args = ap.parse_args()

    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token en DA_TOKEN.')

    objetivo = norm_rif(args.rif)
    emp = next((e for e in api('empresas?select=id,nombre,rif', token)
                if norm_rif(e.get('rif')) == objetivo), None)
    if not emp:
        sys.exit('No hay ninguna empresa con el RIF %s' % args.rif)

    filas = api('retenciones?empresa_id=eq.%s&periodo=eq.%s&tipo=eq.%s&direccion=eq.practicada'
                '&select=id,comprobante,fecha,factura,tercero_nombre,monto,quincena'
                % (emp['id'], args.periodo, args.tipo), token)
    sin = [r for r in filas if r.get('quincena') not in (1, 2)]

    print('\n%s\n  %s · %s · %s · retenciones de %s\n%s\n'
          % ('=' * 88, emp['nombre'], emp['rif'], args.periodo, args.tipo.upper(), '=' * 88))
    print('del período: %d   ya con quincena: %d   sin quincena: %d'
          % (len(filas), len(filas) - len(sin), len(sin)))
    if not sin:
        print('\nNo hay ninguna sin quincena. Nada que hacer.\n')
        return 0

    print('\nse les pondría la %dra/da quincena:\n' % args.quincena)
    print('%-14s %-10s %-12s %-24s %14s' % ('comprobante', 'fecha', 'factura', 'proveedor', 'retenido'))
    print('-' * 80)
    for r in sorted(sin, key=lambda x: x.get('fecha') or ''):
        print('%-14s %-10s %-12s %-24s %14s'
              % (r.get('comprobante') or '(sin)', r.get('fecha') or '', r.get('factura') or '',
                 (r.get('tercero_nombre') or '')[:24], '{:,.2f}'.format(float(r.get('monto') or 0))))
    print('-' * 80)
    print('%-63s %14s' % ('TOTAL (%d)' % len(sin), '{:,.2f}'.format(sum(float(r.get('monto') or 0) for r in sin))))

    if not args.cargar:
        print('\nEnsayo: no se escribió nada. Agrega --cargar para hacerlo.\n')
        return 0

    for r in sin:
        api('retenciones?id=eq.%s' % r['id'], token, 'PATCH',
            {'quincena': args.quincena}, prefer='return=minimal')
    quedan = [x for x in api('retenciones?empresa_id=eq.%s&periodo=eq.%s&tipo=eq.%s&direccion=eq.practicada&select=quincena'
                             % (emp['id'], args.periodo, args.tipo), token)
              if x.get('quincena') not in (1, 2)]
    print('\n%d asignadas · quedan sin quincena en %s: %d\n' % (len(sin), args.periodo, len(quedan)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
