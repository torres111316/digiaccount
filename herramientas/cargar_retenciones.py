# -*- coding: utf-8 -*-
"""
Carga las retenciones de IVA que vienen en los libros.

POR QUÉ VA APARTE DEL LIBRO
  Una retención no es una operación del libro: es un documento distinto,
  con su propio comprobante y su propio correlativo, que además se declara
  aparte. Vive en su propia tabla y alimenta el TXT del SENIAT y los
  comprobantes que hay que entregarle al proveedor.

  El cargador del libro leía la columna del retenido y no la escribía en
  ninguna parte. Doce millones de bolívares en retenciones se quedaban
  fuera, y las SUFRIDAS son descontables: sin ellas la autoliquidación
  paga de más.

DE DÓNDE SALE CADA COSA
  compras -> retención PRACTICADA (se la hicimos al proveedor)
  ventas  -> retención SUFRIDA    (nos la hizo el cliente)

  El porcentaje no se supone: se calcula del monto retenido contra el IVA
  del documento, y sale 75 o 100 según el caso. Fijarlo en 75 estaría mal
  justamente en los proveedores a los que se les retiene todo.

USO
  python cargar_retenciones.py <archivo.xlsx> --rif <RIF> --tipo compra|venta
  Agregar --cargar cuando el ensayo se vea bien.
"""
import argparse
import os
import sys
from datetime import date

from cargar_libros import api, fecha_libro, norm_rif
from revisar_libros import (hojas_desde_md, hojas_desde_xlsx, mm, recorrer_hoja)

# Los porcentajes que la ley contempla. Cualquier otro es un dato a revisar,
# no algo que se redondee al más cercano.
PCT_VALIDOS = (75.0, 100.0)


def main():
    ap = argparse.ArgumentParser(description='Carga las retenciones de IVA de un libro.')
    ap.add_argument('archivo')
    ap.add_argument('--rif', required=True)
    ap.add_argument('--tipo', required=True, choices=['compra', 'venta'])
    ap.add_argument('--desde', default=None, metavar='aaaa-mm')
    ap.add_argument('--cargar', action='store_true')
    args = ap.parse_args()

    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token. PowerShell:  $env:DA_TOKEN=\'...\'')

    if args.archivo.lower().endswith('.md'):
        hojas = hojas_desde_md(args.archivo)
    elif args.archivo.lower().endswith(('.xlsx', '.xlsm')):
        hojas = hojas_desde_xlsx(args.archivo)
    else:
        sys.exit('Formato no reconocido. Se esperaba .md o .xlsx')

    emps = api('empresas?rif=eq.%s&select=id,nombre,cuenta_id,rif' % args.rif, token)
    if not emps:
        # El RIF pudo guardarse con o sin guiones. Misma salvedad que en el
        # cargador del libro, y por eso se usa su misma función.
        todas = api('empresas?select=id,nombre,cuenta_id,rif', token)
        emps = [e for e in todas if norm_rif(e.get('rif')) == norm_rif(args.rif)]
    if not emps:
        sys.exit('No se encontró ninguna empresa con RIF %s' % args.rif)
    if len(emps) > 1:
        sys.exit('Hay %d empresas con RIF %s. Revisa antes de cargar.' % (len(emps), args.rif))
    emp = emps[0]

    direccion = 'practicada' if args.tipo == 'compra' else 'sufrida'
    ya = api('retenciones?empresa_id=eq.%s&tipo=eq.iva&direccion=eq.%s'
             '&select=factura,tercero_rif,periodo&limit=3000'
             % (emp['id'], direccion), token)
    existentes = {(str(r.get('factura') or '').strip(),
                   str(r.get('tercero_rif') or '').strip()) for r in ya}

    print('\n%s' % ('=' * 72))
    print('  %s' % emp['nombre'])
    print('  Retenciones de IVA %s (de %ss)' % (direccion.upper(), args.tipo))
    print('  %d ya registradas' % len(ya))
    print('%s\n' % ('=' * 72))

    nuevos, repetidas, raros, sincomp = [], 0, [], 0
    vistos_comp, repes_comp = {}, []
    total = 0.0

    for h in hojas:
        meta, filas = recorrer_hoja(h)
        per, quin = meta['periodo'], meta['quincena']
        if not per or (args.desde and per < args.desde):
            continue

        for r in filas:
            if r['clase'] not in ('operacion', 'zeta'):
                continue
            monto = r['retenido'] or 0.0
            if abs(monto) < 0.01:
                continue

            comp = str(r.get('comprobante') or '').strip()
            fac = str(r['factura'] or '').strip()

            # Sobre un reporte Z el porcentaje NO se puede calcular contra el
            # IVA del renglón, porque el cliente retuvo sobre SU compra y el
            # renglón es el día entero. Un 2,51% no es un error: es una
            # compra chica dentro de un día grande.
            #
            # En ese caso se guarda el monto y el comprobante, que es lo
            # cierto y lo que la hace descontable, y la base y el porcentaje
            # quedan nulos. Inventarlos dividiendo entre 0,75 sería suponer
            # una alícuota que no consta.
            ivadoc = r['iva'] or 0.0
            crudo = round(monto / ivadoc * 100, 2) if ivadoc else 0.0
            cuadra = crudo and any(abs(crudo - p) < 0.5 for p in PCT_VALIDOS)
            pct = round(crudo) if cuadra else None
            base = ivadoc if cuadra else None
            if not cuadra:
                raros.append((meta['hoja'], r['ref'], crudo, monto, ivadoc))

            # La llave es el RENGLÓN del libro, no el comprobante. Cada
            # renglón lleva una sola retención, así que el par período +
            # renglón la identifica sin depender de que el comprobante esté
            # bien escrito.
            #
            # Con el comprobante como llave se perdía plata: dos retenciones
            # de días distintos traían el mismo número —a uno le falta un
            # dígito— y la segunda se descartaba en silencio.
            k = (per, str(r['ref']))
            if k in existentes:
                repetidas += 1
                continue
            existentes.add(k)
            if comp:
                if comp in vistos_comp:
                    repes_comp.append((meta['hoja'], r['ref'], comp, vistos_comp[comp]))
                vistos_comp.setdefault(comp, r['ref'])

            if not comp:
                sincomp += 1

            f = r['fecha'] or date(int(per[:4]), int(per[5:7]), 1)
            nuevos.append({
                'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'],
                'direccion': direccion, 'tipo': 'iva',
                'fecha': fecha_libro(f), 'periodo': per, 'quincena': quin,
                'comprobante': comp,
                'tercero_nombre': r['nombre'], 'tercero_rif': r['rif'],
                'factura': fac, 'numero_control': r['control'],
                # En una retención de IVA la 'base' es el IVA del documento:
                # es sobre eso que se retiene, no sobre la base imponible.
                'base': base, 'pct': pct, 'monto': monto,
                'estado': 'Registrado',
            })
            total += monto

    if repetidas:
        print('%d ya estaban registradas, se dejan como están.\n' % repetidas)
    if raros:
        print('%d entran SIN base ni porcentaje: el renglón es un reporte Z del día\n'
              'entero y el cliente retuvo sobre su propia compra, así que el\n'
              'porcentaje contra el IVA del día no significa nada. El monto y el\n'
              'comprobante sí son ciertos, que es lo que las hace descontables:'
              % len(raros))
        for hoja, ref, pct, m, iv in raros[:6]:
            print('    %-16s %-8s  retenido %14s   (sería %5.2f%% del día)'
                  % (hoja[:16], str(ref)[:8], mm(m), pct))
        if len(raros) > 6:
            print('    ... y %d más' % (len(raros) - 6))
        print('')

    if not nuevos:
        print('No hay retenciones nuevas que cargar.\n')
        return 0

    if repes_comp:
        print('%d comprobante(s) repetido(s) en renglones distintos. Se cargan\n'
              'los dos —cada renglón es una retención— pero conviene revisar el\n'
              'número, porque suele ser un dígito mal tecleado:' % len(repes_comp))
        for hoja, ref, comp, antes in repes_comp:
            print('    %-16s %-8s comprobante %s, ya usado en %s'
                  % (hoja[:16], str(ref)[:8], comp, antes))
        print('')

    porpct = {}
    for r in nuevos:
        porpct[r['pct']] = porpct.get(r['pct'], 0) + 1
    print('A cargar: %d retenciones · total %s' % (len(nuevos), mm(total)))
    # El None va al final y se nombra, en vez de reventar al ordenar.
    for p in sorted(porpct, key=lambda x: (x is None, x)):
        print('          %d %s' % (porpct[p], ('al %g%%' % p) if p is not None
                                   else 'sin porcentaje (retención sobre un reporte Z)'))
    if sincomp:
        print('          %d sin número de comprobante' % sincomp)
    print('')

    if not args.cargar:
        print('Ensayo: no se escribió nada. Agrega --cargar para hacerlo.\n')
        return 0

    LOTE = 50
    hechos = 0
    for i in range(0, len(nuevos), LOTE):
        api('retenciones', token, 'POST', nuevos[i:i + LOTE], prefer='return=minimal')
        hechos += len(nuevos[i:i + LOTE])
        print('  %d/%d' % (hechos, len(nuevos)))
    print('\nListo: %d retenciones cargadas.\n' % hechos)
    return 0


if __name__ == '__main__':
    sys.exit(main())
