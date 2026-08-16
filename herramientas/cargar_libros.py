# -*- coding: utf-8 -*-
"""
Carga un libro de compras o de ventas en DigiAccount.

Lee el archivo con el MISMO código que `revisar_libros.py` —de ahí importa
todo lo que interpreta columnas— para que no pueda aprobarse una cosa y
cargarse otra.

TRES COSAS QUE NO HACE
  · No carga nada sin `--cargar`. Por defecto solo dice qué haría.
  · No carga un libro con problemas. Los que ya se revisaron y se aceptan
    se habilitan uno por uno con `--aceptar`, escribiendo su nombre.
  · No carga dos veces la misma factura. Antes de escribir lee lo que ya
    está y compara por número de factura y período, así que una corrida
    interrumpida se retoma sin duplicar el libro.

LA LÍNEA DE LA SUCURSAL NO SE CARGA
  El libro de la casa matriz trae la sucursal como una sola fila de
  resumen, porque el Excel no sabe consolidar. Cargarla junto a las
  facturas de la sucursal contaría el período dos veces. Aquí se descarta
  siempre: con `sucursal_id` en cada factura, el total sale solo.

EL TOKEN NO VA EN LA LÍNEA DE COMANDOS
  Va en la variable de entorno DA_TOKEN. Lo que se escribe en la línea de
  comandos queda en el historial del shell y sale en cualquier traza de
  error.

USO
  set DA_TOKEN=...                             (PowerShell: $env:DA_TOKEN='...')

  python cargar_libros.py "Libro de Ventas GATMA.xlsx" ^
      --rif J-50282611-4 --tipo venta --desde 2025-10

  Agregar --cargar cuando el ensayo se vea bien.
  Para el libro de la sucursal, agregar --sucursal 02
"""
import argparse
import json
import os
import sys
import urllib.error
import re
import urllib.request
from datetime import date

from revisar_libros import (TOLERANCIA, hojas_desde_md, hojas_desde_xlsx, mm,
                            recorrer_hoja, revisar_hoja)

URL = os.environ.get('DA_URL', 'https://esnicjnuymqgktqoueyq.supabase.co')

# Problemas que impiden cargar mientras no se habiliten a mano. 'estructura'
# no está: si no se entendió el archivo, no hay nada que habilitar.
HABILITABLES = ('sin tercero', 'sin factura', 'periodo', 'fecha')


def api(ruta, token, metodo='GET', cuerpo=None, prefer=None):
    req = urllib.request.Request(
        URL + '/rest/v1/' + ruta, method=metodo,
        data=json.dumps(cuerpo).encode('utf-8') if cuerpo is not None else None)
    req.add_header('apikey', token)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Content-Type', 'application/json')
    if prefer:
        req.add_header('Prefer', prefer)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            cuerpo_txt = r.read().decode('utf-8')
            return json.loads(cuerpo_txt) if cuerpo_txt.strip() else []
    except urllib.error.HTTPError as e:
        detalle = e.read().decode('utf-8', 'replace')[:400]
        # El token nunca se imprime: la traza de un error acaba pegada en un
        # chat o en un ticket más veces de las que uno quisiera.
        sys.exit('La base respondió %s en %s\n%s' % (e.code, ruta.split('?')[0], detalle))
    except urllib.error.URLError as e:
        sys.exit('No se pudo conectar con %s: %s' % (URL, e.reason))


def norm_rif(v):
    """J-50282611-4 y J501289670 son el mismo RIF escrito distinto."""
    t = ''.join(c for c in str(v or '').upper() if c.isalnum())
    return t


def rif_utilizable(v):
    """Un RIF a medio escribir no es un RIF.

    En el libro de Barquisimeto hay una factura cuyo RIF es la letra 'V'
    sola. Guardarla así es peor que dejarla vacía: vacío dice que no se
    sabe, y 'V' parece un dato. Además nadie la buscaría después, porque
    las que quedan por completar se listan por su RIF vacío.
    """
    return len(re.sub(r'\D', '', str(v or ''))) >= 7


def fecha_libro(f):
    """El libro guarda la fecha como texto dd/mm/aa, no como fecha."""
    return '%02d/%02d/%02d' % (f.day, f.month, f.year % 100)


def main():
    ap = argparse.ArgumentParser(description='Carga un libro fiscal en DigiAccount.')
    ap.add_argument('archivo')
    ap.add_argument('--rif', required=True, help='RIF de la empresa dueña del libro')
    ap.add_argument('--tipo', required=True, choices=['compra', 'venta'])
    ap.add_argument('--desde', default=None, metavar='aaaa-mm',
                    help='Ignora los períodos anteriores a este')
    ap.add_argument('--sucursal', default=None, metavar='CODIGO',
                    help='Código del establecimiento del que salen estas operaciones')
    ap.add_argument('--aceptar', action='append', default=[], metavar='CLASE',
                    help='Carga a pesar de esta clase de problema (%s)' % ', '.join(HABILITABLES))
    ap.add_argument('--cargar', action='store_true',
                    help='Escribe de verdad. Sin esto solo se muestra qué haría.')
    args = ap.parse_args()

    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token. PowerShell:  $env:DA_TOKEN=\'...\'')

    malas = [a for a in args.aceptar if a not in HABILITABLES]
    if malas:
        sys.exit('No se puede aceptar %s. Solo: %s'
                 % (', '.join(malas), ', '.join(HABILITABLES)))

    if args.archivo.lower().endswith('.md'):
        hojas = hojas_desde_md(args.archivo)
    elif args.archivo.lower().endswith(('.xlsx', '.xlsm')):
        hojas = hojas_desde_xlsx(args.archivo)
    else:
        sys.exit('Formato no reconocido. Se esperaba .md o .xlsx')

    # ---- 1) revisar antes que nada ----
    problemas, resumen = [], []
    for h in hojas:
        revisar_hoja(h, problemas, resumen)
    # Los períodos que no se van a cargar tampoco tienen por qué frenar.
    if args.desde:
        hojas_fuera = {r['hoja'] for r in resumen
                       if r['periodo'] and r['periodo'] < args.desde}
        problemas = [p for p in problemas if p[0] not in hojas_fuera]

    frenan = [p for p in problemas if p[2] not in args.aceptar]
    if frenan:
        print('\nNo se carga: %d problema(s) sin resolver.\n' % len(frenan))
        for hoja, ref, clase, msg in frenan[:40]:
            print('  [%s] %-24s %-12s %s' % (clase, hoja[:24], ref[:12], msg))
        if len(frenan) > 40:
            print('  ... y %d más' % (len(frenan) - 40))
        clases = sorted({p[2] for p in frenan if p[2] in HABILITABLES})
        print('\nCorrige el archivo, o si ya los revisaste:  %s'
              % ' '.join('--aceptar "%s"' % c for c in clases))
        return 1
    if args.aceptar:
        print('\nSe carga aceptando: %s' % ', '.join(args.aceptar))

    # ---- 2) a qué empresa y a qué establecimiento ----
    emps = api('empresas?rif=eq.%s&select=id,nombre,cuenta_id,rif' % args.rif, token)
    if not emps:
        # El RIF pudo guardarse con o sin guiones.
        todas = api('empresas?select=id,nombre,cuenta_id,rif', token)
        emps = [e for e in todas if norm_rif(e.get('rif')) == norm_rif(args.rif)]
    if not emps:
        sys.exit('No se encontró ninguna empresa con RIF %s' % args.rif)
    if len(emps) > 1:
        sys.exit('Hay %d empresas con RIF %s. Revisa antes de cargar.' % (len(emps), args.rif))
    emp = emps[0]

    sucursal_id, sucursal_nom = None, '(sin establecimiento)'
    if args.sucursal:
        sucs = api('sucursales?empresa_id=eq.%s&codigo=eq.%s&select=id,nombre,codigo'
                   % (emp['id'], args.sucursal), token)
        if not sucs:
            sys.exit('La empresa no tiene un establecimiento con código "%s". '
                     'Créalo antes de cargar su libro.' % args.sucursal)
        sucursal_id, sucursal_nom = sucs[0]['id'], sucs[0]['nombre']

    # ---- 3) lo que ya está cargado, para no repetirlo ----
    ya = api('libro_fiscal?empresa_id=eq.%s&tipo=eq.%s&select=numero_factura,periodo'
             % (emp['id'], args.tipo), token)
    existentes = {(str(r.get('numero_factura') or '').strip(), r.get('periodo')) for r in ya}

    print('\n%s' % ('=' * 72))
    print('  %s' % emp['nombre'])
    print('  RIF %s · libro de %ss · %s' % (emp.get('rif'), args.tipo, sucursal_nom))
    print('  %d operaciones ya cargadas en este libro' % len(ya))
    print('%s\n' % ('=' * 72))

    # ---- 4) armar los registros ----
    nuevos, repetidos, saltados = [], [], 0
    tot = {'operaciones': 0, 'anuladas': 0, 'base': 0.0, 'iva': 0.0}

    for h in hojas:
        meta, filas = recorrer_hoja(h)
        per, quin = meta['periodo'], meta['quincena']
        if not per:
            continue
        if args.desde and per < args.desde:
            saltados += sum(1 for r in filas if r['clase'] != 'sucursal')
            continue

        for r in filas:
            if r['clase'] == 'sucursal':
                continue          # resumen, no operación

            ref = str(r['factura'] or '').strip()
            if (ref, per) in existentes:
                repetidos.append((meta['hoja'], ref))
                continue

            f = r['fecha']
            if not f:
                # Una anulada suele venir sin fecha. Se le pone el primer día
                # de su período: no inventa una operación, la ubica donde se
                # declaró.
                a, m = int(per[:4]), int(per[5:7])
                f = date(a, m, 1 if quin != 2 else 16)

            anulada = r['clase'] == 'anulada'
            base = 0.0 if anulada else r['base']
            iva = 0.0 if anulada else r['iva']
            alic = r['alicuota'] or 0.16
            if alic > 1:
                alic = alic / 100.0

            reg = {
                'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'],
                'sucursal_id': sucursal_id,
                'tipo': args.tipo, 'fecha': fecha_libro(f),
                'periodo': per, 'quincena': quin,
                # Una anulada conserva su número para que no se pierda el
                # salto en la serie, pero no lleva tercero ni montos.
                'tercero_nombre': 'ANULADA' if anulada else r['nombre'],
                'tercero_rif': (r['rif'] if not anulada and rif_utilizable(r['rif'])
                                else ''),
                'numero_factura': ref, 'numero_control': r['control'],
                'tipo_doc': 'FC' if args.tipo == 'compra' else 'FV',
                'exento': 0.0 if anulada else r['exento'],
                'base': base, 'alicuota': alic, 'iva': iva,
                'igtf': 0.0 if anulada else r['igtf'],
                'total': 0.0 if anulada else r['total'],
                # Estos libros son todos de alícuota general. El desglose por
                # renglón de la Forma 30 va explícito igual: dejarlo en cero
                # haría que el formulario no cuadre con su propio libro.
                'base_gen': base, 'iva_gen': iva,
                'base_red': 0.0, 'iva_red': 0.0,
                'base_adic': 0.0, 'iva_adic': 0.0,
            }
            nuevos.append((meta['hoja'], reg))
            tot['anuladas' if anulada else 'operaciones'] += 1
            tot['base'] += base
            tot['iva'] += iva

    # ---- 5) mostrar y (si toca) escribir ----
    if saltados:
        print('%d fila(s) de períodos anteriores a %s: no se cargan.\n'
              % (saltados, args.desde))
    if repetidos:
        print('%d ya estaban cargadas, se dejan como están:' % len(repetidos))
        for hoja, ref in repetidos[:10]:
            print('    %-24s %s' % (hoja[:24], ref))
        if len(repetidos) > 10:
            print('    ... y %d más' % (len(repetidos) - 10))
        print('')

    if not nuevos:
        print('No hay nada nuevo que cargar.\n')
        return 0

    print('A cargar: %d operaciones y %d anuladas' % (tot['operaciones'], tot['anuladas']))
    print('          base %s · IVA %s\n' % (mm(tot['base']), mm(tot['iva'])))

    sin_tercero = [r for _, r in nuevos
                   if r['tercero_nombre'] != 'ANULADA' and not r['tercero_rif']]
    if sin_tercero:
        print('%d entran SIN RIF ni nombre, para completar después:'
              % len(sin_tercero))
        for r in sin_tercero:
            print('    %s  %s  %s' % (r['periodo'], r['numero_factura'], mm(r['total'])))
        print('')

    if not args.cargar:
        print('Ensayo: no se escribió nada. Agrega --cargar para hacerlo.\n')
        return 0

    # De a lotes: un error a mitad de camino deja cargado lo anterior, y por
    # eso la corrida se puede repetir sin duplicar.
    LOTE = 50
    regs = [r for _, r in nuevos]
    hechos = 0
    for i in range(0, len(regs), LOTE):
        api('libro_fiscal', token, 'POST', regs[i:i + LOTE], prefer='return=minimal')
        hechos += len(regs[i:i + LOTE])
        print('  %d/%d' % (hechos, len(regs)))

    print('\nListo: %d registros cargados.\n' % hechos)
    if sin_tercero:
        print('Para encontrar las que quedaron sin tercero:\n')
        print("  select periodo, fecha, numero_factura, total")
        print("    from libro_fiscal")
        print("   where empresa_id = '%s' and tipo = '%s'" % (emp['id'], args.tipo))
        print("     and coalesce(tercero_rif, '') = ''")
        print("     and coalesce(tercero_nombre, '') <> 'ANULADA'")
        print("   order by periodo, numero_factura;\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
