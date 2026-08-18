# -*- coding: utf-8 -*-
"""
Carga en `declaraciones` las que ya se presentaron, desde el Excel de relación
que descarga el portal del SENIAT.

DE DÓNDE SALE EL EXCEL
  Del propio portal: trae una fila por declaración con el número que asignó
  el SENIAT, el período, la fecha de registro, el tipo, el monto y el estado
  de pago. Las columnas se leen POR NOMBRE, no por posición: el portal
  cambia el orden entre listados y leerlas por posición mete el monto en la
  fecha sin que nada avise.

EL PERÍODO VIENE PEGADO
  '202607' en el Excel, '2026-07' en la base — el mismo formato que
  `libro_fiscal`, para poder cruzarlos. La quincena va aparte: nula para el
  DPP, que es mensual, y 1 o 2 para el IGTF cuando le toque.

NO SE PISA NADA
  La llave es el número de declaración, que el SENIAT no repite. Lo que ya
  esté cargado se salta, así el programa se puede volver a correr cuando el
  Excel traiga un mes más sin duplicar los anteriores.

USO
  python cargar_declaraciones.py --rif J-50282611-4 --impuesto DPP --excel "...\\RELACION.xlsx"
  Agregar --cargar cuando el ensayo se vea bien.
"""
import argparse
import os
import sys
import unicodedata

import openpyxl

from cargar_libros import api, norm_rif
from terceros_desde_libros import todas


def plano(v):
    """Encabezado comparable: sin acentos, sin puntuación, en minúsculas.

    El portal escribe 'Nro. Declaración' y a veces 'Nro Declaracion', y el
    acento llega roto según cómo se haya guardado el archivo.
    """
    t = unicodedata.normalize('NFKD', str(v or '').lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in t).split())


# Cómo se llama cada dato en el Excel del portal. Se busca por «contiene»,
# después de aplanar, para aguantar las variantes de escritura.
COLUMNAS = {
    'numero': ['nro declaracion', 'numero declaracion', 'n declaracion'],
    'periodo': ['periodo'],
    'fecha': ['fecha registro', 'fecha de registro'],
    'tipo': ['tipo de declaracion', 'tipo declaracion'],
    'monto': ['monto declaracion', 'monto de declaracion'],
    'a_pagar': ['monto pagar', 'monto a pagar'],
    'estado': ['estado declaracion', 'estado de la declaracion', 'estado'],
}


def mapear(fila):
    """Del encabezado del Excel a la posición de cada columna."""
    plana = [plano(c) for c in fila]
    ix = {}
    for campo, apodos in COLUMNAS.items():
        for i, cab in enumerate(plana):
            if not cab:
                continue
            if any(a in cab for a in apodos):
                ix.setdefault(campo, i)
                break
    return ix


def periodo_de(v):
    """'202607' -> '2026-07'. Acepta también '2026-07'."""
    t = ''.join(c for c in str(v or '') if c.isdigit())
    return t[:4] + '-' + t[4:6] if len(t) >= 6 else ''


def fecha_de(v):
    if v is None or str(v).strip() == '':
        return None
    if hasattr(v, 'strftime'):
        return v.strftime('%Y-%m-%d')
    t = str(v).strip()[:10]
    return t if len(t) == 10 and t[4] == '-' else None


def numero_de(v):
    """El número tal cual, sin el '.0' que le pega Excel al leerlo como cifra."""
    t = str(v or '').strip()
    return t[:-2] if t.endswith('.0') else t


def monto_de(v):
    if isinstance(v, str):
        v = v.strip().replace('.', '').replace(',', '.')
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def main():
    ap = argparse.ArgumentParser(description='Carga declaraciones presentadas desde el Excel del portal.')
    ap.add_argument('--rif', required=True, help='RIF de la empresa (J-50282611-4)')
    ap.add_argument('--impuesto', required=True, help='DPP, IGTF, ISLR_ANTICIPO...')
    ap.add_argument('--excel', required=True)
    ap.add_argument('--quincena', type=int, choices=[1, 2],
                    help='solo para los quincenales; sin esto la declaración es del mes')
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

    s = openpyxl.load_workbook(args.excel, data_only=True).worksheets[0]
    filas = list(s.iter_rows(values_only=True))

    # El encabezado no siempre está en la primera fila: el portal a veces
    # deja un título arriba. Se busca la fila que traiga número y período.
    ix, arranque = {}, 0
    for i, f in enumerate(filas[:10]):
        m = mapear(f)
        if 'numero' in m and 'periodo' in m:
            ix, arranque = m, i + 1
            break
    faltan = [c for c in ('numero', 'periodo', 'monto') if c not in ix]
    if faltan:
        sys.exit('No se encontraron las columnas: %s\nEncabezados leídos: %s'
                 % (', '.join(faltan), [plano(c) for c in (filas[0] if filas else [])]))

    def dato(f, campo):
        i = ix.get(campo)
        return f[i] if i is not None and i < len(f) else None

    leidas, malas = [], []
    for f in filas[arranque:]:
        num, per = numero_de(dato(f, 'numero')), periodo_de(dato(f, 'periodo'))
        if not num or not per:
            if any(c is not None and str(c).strip() for c in f):
                malas.append(f)
            continue
        leidas.append({
            'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'],
            'impuesto': args.impuesto, 'periodo': per, 'quincena': args.quincena,
            'numero': num, 'fecha': fecha_de(dato(f, 'fecha')),
            'tipo': str(dato(f, 'tipo') or 'ORIGINARIA').strip().upper() or 'ORIGINARIA',
            'monto': monto_de(dato(f, 'monto')), 'a_pagar': monto_de(dato(f, 'a_pagar')),
            'estado': str(dato(f, 'estado') or '').strip().upper() or None,
        })

    print('\n%s\n  %s · %s\n  %s\n%s\n'
          % ('=' * 96, emp['nombre'], emp['rif'], args.impuesto, '=' * 96))

    ya = set(d['numero'] for d in todas(
        'declaraciones?empresa_id=eq.%s&impuesto=eq.%s&select=numero' % (emp['id'], args.impuesto), token))
    nuevas = [d for d in leidas if d['numero'] not in ya]

    print('filas con datos: %d   ya cargadas: %d   a cargar: %d'
          % (len(leidas), len(leidas) - len(nuevas), len(nuevas)))
    if malas:
        print('filas que no se pudieron leer: %d' % len(malas))
    print('')
    print('%-9s %-12s %-11s %-12s %14s %14s  %s'
          % ('período', 'número', 'fecha', 'tipo', 'monto', 'a pagar', 'estado'))
    print('-' * 96)
    for d in sorted(nuevas, key=lambda x: x['periodo']):
        print('%-9s %-12s %-11s %-12s %14s %14s  %s'
              % (d['periodo'], d['numero'], d['fecha'] or '—', d['tipo'],
                 '{:,.2f}'.format(d['monto']), '{:,.2f}'.format(d['a_pagar']), d['estado'] or ''))

    if nuevas:
        pers = [d['periodo'] for d in nuevas]
        print('\ndel %s al %s · suma declarada %s · suma a pagar %s'
              % (min(pers), max(pers),
                 '{:,.2f}'.format(sum(d['monto'] for d in nuevas)),
                 '{:,.2f}'.format(sum(d['a_pagar'] for d in nuevas))))
        faltantes = _huecos(pers)
        if faltantes:
            print('MESES SIN DECLARACIÓN entre el primero y el último: %s' % ', '.join(faltantes))
        pend = [d for d in nuevas if d['estado'] and 'PENDIENTE' in d['estado']]
        if pend:
            print('PENDIENTES DE PAGO: %s' % ', '.join(sorted(d['periodo'] for d in pend)))

    if not nuevas:
        print('\nNo hay nada nuevo que cargar.\n')
        return 0
    if not args.cargar:
        print('\nEnsayo: no se escribió nada. Agrega --cargar para hacerlo.\n')
        return 0

    for i in range(0, len(nuevas), 100):
        api('declaraciones', token, 'POST', nuevas[i:i + 100], prefer='return=minimal')
    total = len(todas('declaraciones?empresa_id=eq.%s&impuesto=eq.%s&select=id'
                      % (emp['id'], args.impuesto), token))
    print('\n%d cargadas · la empresa tiene ahora %d declaraciones de %s\n'
          % (len(nuevas), total, args.impuesto))
    return 0


def _huecos(periodos):
    """Meses sin declaración entre el primero y el último.

    Un mes que falta en una obligación mensual es una omisión, no un hueco
    inocente: conviene verlo al cargar y no cuando llega la sanción.
    """
    ps = sorted(set(periodos))
    y, m = int(ps[0][:4]), int(ps[0][5:7])
    ultimo, out = ps[-1], []
    while True:
        k = '%04d-%02d' % (y, m)
        if k > ultimo:
            return out
        if k not in ps:
            out.append(k)
        m += 1
        if m > 12:
            m, y = 1, y + 1


if __name__ == '__main__':
    sys.exit(main())
