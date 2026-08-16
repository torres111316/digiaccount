# -*- coding: utf-8 -*-
"""
Carga las retenciones de ISLR desde los archivos Macro_RET_ISLR del SENIAT.

DE DÓNDE SALEN
  El macro oficial guarda UNA declaración por archivo: su hoja `retISLR`
  trae el RIF del agente y el período en el encabezado, y debajo una fila
  por retención con el RIF retenido, la factura, el control, la fecha, el
  código de concepto, el monto de la operación y el porcentaje.

  El monto RETENIDO no está en el archivo: el macro lo calcula. Aquí se
  calcula igual, y por eso el ensayo lo muestra antes de escribir nada.

EL SUSTRAENDO
  En los conceptos de persona natural residente no se retiene el
  porcentaje pelado: se le resta un sustraendo (Parágrafo 2° Art. 9 del
  Decreto 1.808).

      sustraendo = 83,3334 × UT × %
      retenido   = (monto × %) − sustraendo,  nunca menor que cero

  La UT entra por parámetro, con 43 por defecto —la vigente en 2026— y se
  imprime siempre. Es el dato que más cambia y el que más caro sale
  suponer: con la UT equivocada, todas las retenciones de persona natural
  salen mal por igual.

USO
  python cargar_islr.py "<carpeta o archivo>"        (ensayo)
  python cargar_islr.py "<carpeta>" --cargar
"""
import argparse
import datetime
import glob
import os
import sys

from cargar_libros import api, fecha_libro, norm_rif
from revisar_libros import mm

# Conceptos con SUSTRAENDO: persona natural residente (Anexo 6.1).
CON_SUSTRAENDO = {2, 6, 10, 12, 14, 18, 25, 49, 53, 57, 61, 71, 73, 75, 77, 79, 83}

CONCEPTO = {
    1: 'Sueldos y salarios', 2: 'Honorarios profesionales no mercantiles',
    4: 'Honorarios profesionales no mercantiles', 18: 'Otras comisiones',
    20: 'Otras comisiones', 53: 'Contratistas o subcontratistas',
    55: 'Contratistas o subcontratistas', 57: 'Arrendamiento de inmuebles',
    59: 'Arrendamiento de inmuebles', 61: 'Arrendamiento de bienes muebles',
    63: 'Arrendamiento de bienes muebles', 71: 'Fletes', 72: 'Fletes',
    83: 'Publicidad y propaganda', 84: 'Publicidad y propaganda',
}


def fecha_de_serial(v):
    """El macro guarda la fecha como el número de días de Excel."""
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    if n < 20000:
        return None
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=n)


def leer_macro(ruta):
    """Devuelve (rif_agente, periodo, [retenciones]) de un Macro_RET_ISLR."""
    import xlrd
    h = xlrd.open_workbook(ruta).sheet_by_index(0)
    rif = str(h.cell_value(0, 7)).strip()
    per = str(h.cell_value(1, 7)).strip().replace('.0', '')
    filas = []
    # Los datos arrancan en la quinta fila; las dos anteriores son el
    # encabezado partido en dos líneas.
    for f in range(4, h.nrows):
        celdas = [h.cell_value(f, c) for c in range(8)]
        if not str(celdas[1]).strip():
            break                       # la primera vacía cierra la tabla
        filas.append(celdas)
    return rif, per, filas


def main():
    ap = argparse.ArgumentParser(description='Carga retenciones de ISLR del macro del SENIAT.')
    ap.add_argument('ruta', help='Un archivo .xls o una carpeta donde buscarlos')
    ap.add_argument('--ut', type=float, default=43.0,
                    help='Unidad Tributaria para el sustraendo (por defecto 43)')
    ap.add_argument('--rif', default=None,
                    help='Carga solo los archivos de este agente de retención. '
                         'Hace falta porque en una carpeta puede haber macros '
                         'de otra empresa guardados ahí por comodidad.')
    ap.add_argument('--cargar', action='store_true')
    args = ap.parse_args()

    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token. PowerShell:  $env:DA_TOKEN=\'...\'')

    if os.path.isdir(args.ruta):
        archivos = glob.glob(os.path.join(args.ruta, '**', 'Macro_RET_ISLR*.xls'),
                             recursive=True)
        # Del más reciente al más viejo. Cuando la misma declaración aparece
        # dos veces —se corrige y se vuelve a guardar el macro con otro
        # nombre— gana la guardada de último, que es la corregida. Por orden
        # alfabético ganaría "2026-02" sobre "2026-02 (2)", o sea la vieja.
        archivos.sort(key=os.path.getmtime, reverse=True)
    else:
        archivos = [args.ruta]
    if not archivos:
        sys.exit('No se encontró ningún Macro_RET_ISLR en %s' % args.ruta)

    empresas = api('empresas?select=id,nombre,cuenta_id,rif', token)
    por_rif = {norm_rif(e['rif']): e for e in empresas}

    print('\nUnidad Tributaria para el sustraendo: Bs %s\n' % mm(args.ut))

    pendientes, avisos, sin_empresa, otros = [], [], [], []
    llaves = {}

    for a in archivos:
        rif, per, filas = leer_macro(a)
        emp = por_rif.get(norm_rif(rif))
        nom = os.path.basename(a)
        if args.rif and norm_rif(rif) != norm_rif(args.rif):
            otros.append((nom, rif))
            continue
        if not emp:
            sin_empresa.append((nom, rif))
            continue

        print('%s' % nom)
        print('   %s · período %s · %d retención(es)' % (emp['nombre'][:44], per, len(filas)))

        for c in filas:
            rifret = str(c[1]).strip()
            fac = str(c[2]).replace('.0', '').strip()
            ctrl = str(c[3]).replace('.0', '').strip()
            f = fecha_de_serial(c[4])
            cod = int(float(c[5]))
            monto = float(c[6])
            pct = float(c[7])

            # Sustraendo: solo en los conceptos de persona natural residente.
            sus = 0.0
            if cod in CON_SUSTRAENDO:
                sus = round(83.3334 * args.ut * (pct / 100.0), 2)
                # El código dice persona natural; si el RIF empieza por J o G
                # el par no cuadra y el sustraendo probablemente sobra.
                if rifret[:1].upper() in ('J', 'G'):
                    avisos.append((nom, rifret, cod,
                                   'el concepto %03d es de persona natural pero el RIF '
                                   'no lo es' % cod))
            retenido = max(0.0, round(monto * pct / 100.0 - sus, 2))

            # La retención de ISLR nace con el PAGO o el abono en cuenta, así
            # que su fecha manda sobre el período en que se declara. Una
            # fecha fuera del período significa que uno de los dos está mal,
            # y de ahí sale una declaración presentada en el mes que no era.
            if f and f.strftime('%Y%m') != per:
                avisos.append((nom, rifret, cod,
                               'la operación es del %s pero el archivo declara el período %s'
                               % (f.isoformat(), per)))

            # La misma retención en dos archivos: pasa cuando se corrige una
            # declaración y se guarda el macro otra vez con otro nombre.
            k = (emp['id'], per, norm_rif(rifret), fac)
            if k in llaves:
                avisos.append((nom, rifret, cod,
                               'ya venía en %s (misma factura y período)' % llaves[k]))
                continue
            llaves[k] = nom

            print('      %-12s fact %-11s %s  cod %03d  %14s × %g%%%s = %s'
                  % (rifret, fac[:11], f.isoformat() if f else '(sin fecha)', cod,
                     mm(monto), pct,
                     (' − %s' % mm(sus)) if sus else '', mm(retenido)))

            pendientes.append({
                'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'],
                'direccion': 'practicada', 'tipo': 'islr',
                'fecha': fecha_libro(f) if f else '',
                'periodo': per[:4] + '-' + per[4:6],
                'tercero_rif': rifret, 'tercero_nombre': '',
                'factura': fac, 'numero_control': ctrl,
                'concepto_codigo': '%03d' % cod,
                'concepto': CONCEPTO.get(cod, 'Concepto %03d del Anexo 6.1' % cod),
                'sujeto': 'PN' if cod in CON_SUSTRAENDO else 'PJ',
                # 'base' en una retención de ISLR es el monto de la operación:
                # es sobre eso que se aplica el porcentaje.
                'base': monto, 'pct': pct, 'sustraendo': sus, 'monto': retenido,
                'estado': 'Registrado', 'comprobante': '',
            })
        print('')

    if otros:
        print('Archivos de otro agente de retención (se saltan por el --rif):')
        for nom, rif in otros:
            print('   %-46s RIF %s' % (nom[:46], rif))
        print('')

    if sin_empresa:
        print('Archivos de empresas que no están en el sistema (se saltan):')
        for nom, rif in sin_empresa:
            print('   %-46s RIF %s' % (nom[:46], rif))
        print('')

    if avisos:
        print('AVISOS — revisar antes de cargar:')
        for nom, rifret, cod, msg in avisos:
            print('   %-40s %-12s %s' % (nom[:40], rifret, msg))
        print('')

    if not pendientes:
        print('No hay nada que cargar.\n')
        return 0

    # Lo que ya esté cargado no se repite.
    nuevos = []
    for r in pendientes:
        ya = api('retenciones?empresa_id=eq.%s&tipo=eq.islr&periodo=eq.%s'
                 '&factura=eq.%s&select=id' % (r['empresa_id'], r['periodo'],
                                               r['factura']), token)
        if ya:
            continue
        nuevos.append(r)

    repes = len(pendientes) - len(nuevos)
    if repes:
        print('%d ya estaban registradas, se dejan como están.' % repes)
    print('A cargar: %d retenciones de ISLR · total %s\n'
          % (len(nuevos), mm(sum(r['monto'] for r in nuevos))))

    if not nuevos:
        return 0
    if not args.cargar:
        print('Ensayo: no se escribió nada. Agrega --cargar para hacerlo.\n')
        return 0

    api('retenciones', token, 'POST', nuevos, prefer='return=minimal')
    print('Listo: %d retenciones de ISLR cargadas.\n' % len(nuevos))
    return 0


if __name__ == '__main__':
    sys.exit(main())
