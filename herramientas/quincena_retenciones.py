# -*- coding: utf-8 -*-
"""
Le pone la quincena a las retenciones de IVA, leyéndola de los archivos
RET IVA que se le entregan al SENIAT.

POR QUÉ NO SE DEDUCE DE LA FECHA
  La quincena de una retención es el período en que se DECLARA, no cuándo
  ocurrió la operación. El archivo "RET IVA 1RA QUINCENA DE ENERO" de
  Radian trae operaciones del 2, el 16 y el 19 de diciembre. Sacarla del
  día de la factura las repartiría mal, y el TXT saldría con retenciones
  que no son de ese período.

  Por eso se lee de donde consta: el archivo que se presentó.

DOS FORMAS DE NOMBRAR, LAS DOS LEGIBLES
  Radian  ·  "RET IVA 1RA QUINCENA DE ENERO"      -> la dice el nombre
  GATMA   ·  "RET IVA 15012026"                   -> el día de corte:
             15 es la primera, 28/30/31 la segunda

  El nombre del archivo manda sobre lo que diga la hoja por dentro: en
  "RET IVA 15012026 GATMA" la hoja se llama "RET IVA 31122025", copiada
  del mes anterior. El período (aaaamm) sí se lee de adentro y se
  contrasta; si no concuerda con la retención ya cargada, se avisa y no
  se toca.

USO
  python quincena_retenciones.py "<carpeta>" --rif <RIF>
  Agregar --aplicar cuando el ensayo se vea bien.
"""
import argparse
import glob
import os
import re
import sys

from cargar_libros import api, norm_rif

MESES = {'ENERO': 1, 'FEBRERO': 2, 'MARZO': 3, 'ABRIL': 4, 'MAYO': 5, 'JUNIO': 6,
         'JULIO': 7, 'AGOSTO': 8, 'SEPTIEMBRE': 9, 'OCTUBRE': 10, 'NOVIEMBRE': 11,
         'DICIEMBRE': 12}


def quincena_del_nombre(nombre):
    """1, 2, o None si el nombre no lo dice."""
    n = nombre.upper()
    if re.search(r'\b(1RA|1ERA|PRIMERA)\b', n):
        return 1
    if re.search(r'\b(2DA|2NDA|SEGUNDA)\b', n):
        return 2
    # 'RET IVA 15012026' -> día de corte. El 15 cierra la primera quincena;
    # 28, 29, 30 o 31 cierran la segunda, según el mes.
    m = re.search(r'\b(\d{2})(\d{2})(\d{4})\b', n)
    if m:
        dia = int(m.group(1))
        if dia == 15:
            return 1
        if dia >= 28:
            return 2
    return None


def llave(rif, factura):
    """Identifica una retención sin depender del número de comprobante.

    El comprobante NO sirve de llave: lleva el período en sus primeros seis
    dígitos, y el libro de compras anotó el del mes de la operación mientras
    la declaración usó el del período en que se declaró — 20251100000038
    contra 20251200000038, la misma retención. La factura y el RIF sí son
    del documento y no cambian.

    Las facturas se comparan sin ceros a la izquierda: el libro escribe
    '0000025244' y el archivo del SENIAT '25244'.
    """
    return (norm_rif(rif), str(factura or '').strip().lstrip('0') or '0')


def leer(ruta):
    """(rif_agente, periodo, [(llave, comprobante)])"""
    import openpyxl
    h = openpyxl.load_workbook(ruta, data_only=True).worksheets[0]
    rif, per, filas = '', '', []
    for f in h.iter_rows(values_only=True):
        if not f or not f[0]:
            continue
        rif = rif or str(f[0]).strip()
        p = str(f[1] or '').strip().replace('.0', '')
        if len(p) == 6 and p.isdigit():
            per = per or p
        # En una declaración vacía todas las columnas vienen en cero.
        comp = str(f[12] or '').strip().replace('.0', '')
        fac = str(f[6] or '').strip().replace('.0', '')
        if comp and comp != '0' and fac and fac != '0':
            filas.append((llave(f[5], fac), comp))
    return rif, per, filas


def main():
    ap = argparse.ArgumentParser(description='Pone la quincena a las retenciones de IVA.')
    ap.add_argument('ruta', help='Carpeta donde buscar los RET IVA*.xlsx')
    ap.add_argument('--rif', required=True)
    ap.add_argument('--aplicar', action='store_true')
    args = ap.parse_args()

    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token. PowerShell:  $env:DA_TOKEN=\'...\'')

    emps = api('empresas?select=id,nombre,rif', token)
    emp = next((e for e in emps if norm_rif(e['rif']) == norm_rif(args.rif)), None)
    if not emp:
        sys.exit('No se encontró ninguna empresa con RIF %s' % args.rif)

    ya = api('retenciones?empresa_id=eq.%s&tipo=eq.iva&direccion=eq.practicada'
             '&select=id,comprobante,factura,tercero_rif,periodo,quincena'
             '&limit=3000' % emp['id'], token)
    por_comp = {}
    for r in ya:
        k = llave(r.get('tercero_rif'), r.get('factura'))
        if k[1] != '0':
            por_comp.setdefault(k, []).append(r)

    print('\n%s\n  %s\n  %d retenciones practicadas cargadas · %d identificables\n%s\n'
          % ('=' * 72, emp['nombre'][:60], len(ya), len(por_comp), '=' * 72))

    archivos = sorted(glob.glob(os.path.join(args.ruta, '**', 'RET IVA*.xlsx'),
                                recursive=True))
    cambios, sinq, sinmatch, choques, distinto, otroper, yaestaba = [], [], [], [], [], [], 0
    reclamadas = {}          # id de retención -> (quincena, archivo que la reclamó)

    for a in archivos:
        nom = os.path.basename(a)
        q = quincena_del_nombre(nom)
        rif, per, entradas = leer(a)
        if norm_rif(rif) != norm_rif(args.rif):
            continue
        if q is None:
            sinq.append(nom)
            continue
        if not entradas:
            continue                      # declaración sin retenciones

        marca = []
        for k, comp in entradas:
            filas = por_comp.get(k)
            if not filas:
                sinmatch.append((nom, '%s / factura %s' % (k[0], k[1])))
                continue
            for r in filas:
                # El comprobante del libro puede traer otro período en sus
                # primeros dígitos que el realmente declarado. Se anota para
                # revisarlo, pero no impide marcar la quincena.
                cargado = str(r.get('comprobante') or '').strip()
                if cargado and cargado != comp:
                    distinto.append((nom, k[1], cargado, comp))
                # El período de la retención cargada sale del MES DEL LIBRO;
                # el del archivo es aquel en que se DECLARÓ, y no siempre es
                # el mismo — el de "1ra quincena de enero" trae operaciones de
                # diciembre. Se anota para decidirlo aparte: cambiar el
                # período mueve la retención de declaración, y eso no se hace
                # de pasada mientras se marca una quincena.
                if per and r['periodo'] and r['periodo'].replace('-', '') != per:
                    otroper.append((nom, k[1], r['periodo'], per[:4] + '-' + per[4:]))
                if r['quincena'] == q:
                    marca.append(k)          # ya estaba, no hay nada que hacer
                    continue
                # Dos archivos que reclamen la misma retención para quincenas
                # distintas es un dato que se contradice: se avisa y no se toca.
                previo = reclamadas.get(r['id'])
                if previo and previo[0] != q:
                    choques.append((nom, k[1], 'Q%d según %s' % (previo[0], previo[1]),
                                    'Q%d' % q))
                    continue
                reclamadas[r['id']] = (q, nom)
                cambios.append((r['id'], q, k[1], nom))
        yaestaba += len(marca)
        print('  %-46s Q%d · %2d retención(es)%s'
              % (nom[:46], q, len(entradas),
                 ('  (%d ya marcados)' % len(marca)) if marca else ''))

    print('')
    if sinq:
        print('%d archivo(s) sin quincena legible en el nombre (se saltan):' % len(sinq))
        for n in sinq[:8]:
            print('    %s' % n)
        print('')
    if choques:
        print('%d comprobante(s) cuyo período no concuerda — NO se tocan:' % len(choques))
        for n, c, a1, a2 in choques[:8]:
            print('    %-40s %s: cargado %s, el archivo dice %s' % (n[:40], c, a1, a2))
        print('')
    if sinmatch:
        print('%d comprobante(s) del archivo que NO están cargados:' % len(sinmatch))
        for n, c in sinmatch[:8]:
            print('    %-40s %s' % (n[:40], c))
        if len(sinmatch) > 8:
            print('    ... y %d más' % (len(sinmatch) - 8))
        print('')

    if distinto:
        print('%d con OTRO número de comprobante que el declarado.\n'
              'Los primeros seis dígitos son el período: el libro anotó el del mes\n'
              'de la operación y la declaración usó el del período. El del archivo\n'
              'es el que se presentó. NO se cambia aquí — dilo y lo corrijo:'
              % len(distinto))
        for n, fac, cargado, real in distinto[:6]:
            print('    factura %-12s cargado %s  ·  declarado %s' % (fac, cargado, real))
        if len(distinto) > 6:
            print('    ... y %d más' % (len(distinto) - 6))
        print('')

    if otroper:
        print('%d declaradas en un período distinto al mes de su libro.\n'
              'Es normal: una retención se entera cuando toca, no cuando ocurrió\n'
              'la compra. Cambiarlo mueve la retención de declaración, así que\n'
              'tampoco se toca aquí:' % len(otroper))
        for n, fac, cargado, real in otroper[:6]:
            print('    factura %-12s libro %s  ·  declarada en %s' % (fac, cargado, real))
        if len(otroper) > 6:
            print('    ... y %d más' % (len(otroper) - 6))
        print('')

    print('A marcar: %d retención(es)' % len(cambios))
    if not cambios:
        return 0
    if not args.aplicar:
        print('\nEnsayo: no se escribió nada. Agrega --aplicar para hacerlo.\n')
        return 0

    for i, (rid, q, comp, nom) in enumerate(cambios, 1):
        api('retenciones?id=eq.%s' % rid, token, 'PATCH', {'quincena': q},
            prefer='return=minimal')
        if i % 25 == 0 or i == len(cambios):
            print('  %d/%d' % (i, len(cambios)))
    print('\nListo: %d retenciones marcadas.\n' % len(cambios))
    return 0


if __name__ == '__main__':
    sys.exit(main())
