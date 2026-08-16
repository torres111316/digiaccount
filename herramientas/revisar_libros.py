# -*- coding: utf-8 -*-
"""
Revisa un libro de compras o de ventas ANTES de cargarlo.

POR QUÉ EXISTE
  Los libros de GATMA traían un total que no cuadraba con su base, una fecha
  del futuro, cuatro facturas sin cliente y encabezados de período copiados
  de la quincena anterior. Todo eso se encontró leyendo el archivo a ojo, y
  a ojo se escapa: nadie relee cien filas buscando la que no suma.

  Un libro que no cuadra no se arregla después. Se declara mal, y la
  corrección es una sustitutiva.

QUÉ REVISA
  Fila por fila:
    · que el total sea la suma de sus partes
    · que el IVA corresponda a la base por su alícuota
    · que la fecha caiga en el período de la hoja
    · que una operación con montos tenga RIF, nombre y número de factura
  Y de la hoja completa:
    · que la suma de las filas dé el renglón de TOTALES
    · que la hoja tenga un período legible en su encabezado

QUÉ NO HACE
  No corrige nada ni escribe en la base. Solo dice qué está mal y dónde.
  Corregir es del contador: si el total y la base no cuadran, cuál de los
  dos manda es un dato del documento, no una deducción.

USO
  python revisar_libros.py <archivo.md|.xlsx> [--tipo compra|venta]

  El tipo se deduce del encabezado si no se indica.
"""
import argparse
import re
import sys
import unicodedata
from datetime import date

# Los importes se comparan con una tolerancia: los libros se llevan con
# decimales redondeados a mano y una diferencia de un céntimo no es un error.
TOLERANCIA = 0.02

MESES = {
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
    'julio': 7, 'agosto': 8, 'septiembre': 9, 'setiembre': 9, 'octubre': 10,
    'noviembre': 11, 'diciembre': 12,
}


def desmojibake(s):
    """Repara el texto de un archivo UTF-8 que se leyó como latin-1.

    Así llegan estos exports: 'RazÃ³n Social', 'NÂ° de Factura'. El daño es
    reversible —volver a codificar en latin-1 y decodificar como UTF-8
    devuelve el original— y hay que deshacerlo ANTES de comparar, porque
    'NÂ°' normaliza a 'na' y deja de parecerse a 'n'.

    Si el texto está sano la conversión falla y se devuelve tal cual.
    """
    try:
        return s.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def plano(s):
    """Texto comparable: sin acentos, sin símbolos, en minúsculas.

    Los encabezados llegan escritos de muchas formas —'Nº de Factura',
    'N° de Factura'— y son la misma columna. Buscarlos por su texto exacto
    obligaría a perseguir cada variante.
    """
    s = unicodedata.normalize('NFKD', desmojibake(str(s or '')))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def num(v):
    """Un importe, o None si la celda no trae uno.

    Vacío y cero son cosas distintas: una fila sin llenar no es una
    operación de cero bolívares.
    """
    t = str(v or '').strip()
    if not t or t.lower() in ('nan', 'none', '-'):
        return None
    t = t.replace(' ', '')
    # 1.234,56 (es) frente a 1234.56 (que es como sale del export)
    if ',' in t and '.' in t:
        t = t.replace('.', '').replace(',', '.') if t.rfind(',') > t.rfind('.') else t.replace(',', '')
    elif ',' in t:
        t = t.replace(',', '.')
    try:
        return float(t)
    except ValueError:
        return None


def texto(v):
    t = str(v or '').strip()
    return '' if t.lower() in ('nan', 'none') else t


def leer_fecha(v):
    """Devuelve (date, texto_original) o (None, texto) si no se entiende."""
    t = texto(v)
    if not t:
        return None, ''
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', t)          # 2026-06-02 00:00:00
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3))), t
        except ValueError:
            return None, t
    m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$', t)   # 02/06/2026
    if m:
        d, mes, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        a = a + 2000 if a < 100 else a
        try:
            return date(a, mes, d), t
        except ValueError:
            return None, t
    return None, t


def leer_periodo(lineas):
    """Saca el período de la hoja de su encabezado.

    'Mes Junio: 01/06/2026 al 15/06/2026' -> ('2026-06', 1, rango)

    La quincena sale del RANGO, no del nombre de la hoja: en estos libros
    hay hojas tituladas '2DA QUINCENA' cuyo encabezado quedó copiado de la
    primera. Es el rango el que dice qué se declaró.
    """
    for ln in lineas:
        t = texto(ln)
        m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})\s*al\s*(\d{1,2})/(\d{1,2})/(\d{4})', t)
        if not m:
            continue
        d1, m1, a1, d2, m2, a2 = (int(x) for x in m.groups())
        rango = '%02d/%02d/%d al %02d/%02d/%d' % (d1, m1, a1, d2, m2, a2)
        try:
            desde, hasta = date(a1, m1, d1), date(a2, m2, d2)
        except ValueError:
            return None, None, rango, 'El rango del encabezado tiene una fecha imposible: ' + rango
        if desde > hasta:
            return None, None, rango, 'El rango del encabezado empieza después de terminar: ' + rango
        periodo = '%d-%02d' % (a1, m1)
        if m1 != m2 or a1 != a2:
            return periodo, None, rango, 'El rango del encabezado cruza dos meses: ' + rango
        # Un rango que abarca el mes entero NO es una quincena: es la hoja
        # mensual de un contribuyente ordinario. Tratarla como segunda
        # quincena le inventaría una primera que nunca existió.
        if d1 == 1 and d2 >= 28:
            return periodo, None, rango, None
        quincena = 1 if d1 <= 15 and d2 <= 16 else 2
        return periodo, quincena, rango, None
    return None, None, '', 'La hoja no tiene un período legible en su encabezado'


class Hoja(object):
    def __init__(self, nombre, filas):
        self.nombre = nombre
        self.filas = filas          # lista de listas de celdas


def hojas_desde_md(ruta):
    """Lee las hojas de un export a Markdown: '## NOMBRE' y una tabla."""
    with open(ruta, 'r', encoding='utf-8') as f:
        texto_md = f.read()
    hojas, nombre, filas = [], None, []
    for ln in texto_md.splitlines():
        if ln.startswith('## '):
            if nombre is not None:
                hojas.append(Hoja(nombre, filas))
            nombre, filas = ln[3:].strip(), []
        elif ln.strip().startswith('|'):
            celdas = [c.strip() for c in ln.strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-{2,}:?', c or '') for c in celdas):
                filas.append(celdas)
    if nombre is not None:
        hojas.append(Hoja(nombre, filas))
    return hojas


def hojas_desde_xlsx(ruta):
    try:
        import openpyxl
    except ImportError:
        sys.exit('Para leer .xlsx hace falta openpyxl:  pip install openpyxl')
    libro = openpyxl.load_workbook(ruta, data_only=True)
    hojas = []
    for h in libro.worksheets:
        filas = [['' if c is None else c for c in fila]
                 for fila in h.iter_rows(values_only=True)]
        hojas.append(Hoja(h.title, filas))
    return hojas


# Cada columna que interesa, con las formas en que aparece escrita.
# Un apodo con '=' delante exige que el encabezado sea EXACTAMENTE eso.
#
# Hace falta para las columnas de nombre corto: en el libro de compras el
# IVA se llama solo 'IVA', y buscarlo por contenido lo engancha a la
# primera columna que mencione el IVA —'Compras Sin Derecho a Crédito
# IVA'— comparando entonces el impuesto contra el monto exento.
COLUMNAS = {
    'fecha':    ['fecha de la factura'],
    'nombre':   ['proveedor o razon social', 'nombre o razon social'],
    'factura':  ['=n de factura', '=numero de factura'],
    'control':  ['n control de factura', '=n de control'],
    'total':    ['total compras internas incluyendo el iva', 'total ventas incluyendo el iva'],
    'exento':   ['compras sin derecho a credito iva', 'ventas internas no gravadas'],
    'base':     ['base imponible'],
    'alicuota': ['alicuota'],
    'iva':      ['impuesto iva', '=iva'],
    'igtf':     ['igtf'],
    'retenido': ['iva retenido al vendedor', 'iva retenido por el comprador'],
    # 'Nº R.I.F.' queda como 'no r i f': las siglas separadas por puntos
    # dejan espacios entre las letras y no contienen la palabra 'rif'.
    'rif':      ['=no r i f', '=r i f', 'r i f', 'rif'],
    'operacion': ['n de oper', 'n de operacion'],
}


def mapear_columnas(fila):
    """Ubica cada columna por su nombre, nunca por su posición.

    El reparto de columnas CAMBIA entre hojas del mismo libro: unas traen
    'Numero de Comprobante' y otras no, y todo lo que sigue se corre un
    lugar. Leer por posición daría importes de la columna vecina —el peor
    error posible, porque el archivo se sigue viendo bien.

    Se resuelven primero los apodos exactos de TODOS los campos y después
    los aproximados, para que un nombre largo no se lleve la columna que
    otro campo reclama por su nombre completo.
    """
    encabezados = [plano(c) for c in fila]
    mapa = {}

    def buscar(exactos):
        for campo, apodos in COLUMNAS.items():
            if campo in mapa:
                continue
            for a in apodos:
                if a.startswith('=') != exactos:
                    continue
                for i, enc in enumerate(encabezados):
                    if i in mapa.values():
                        continue
                    if (enc == a[1:]) if exactos else (a in enc):
                        mapa[campo] = i
                        break
                if campo in mapa:
                    break

    buscar(True)
    buscar(False)
    return mapa


def es_encabezado(fila):
    p = [plano(c) for c in fila]
    return any('fecha de la factura' in c for c in p) and any('base imponible' in c for c in p)


def celda(fila, mapa, campo):
    i = mapa.get(campo)
    return fila[i] if i is not None and i < len(fila) else ''


def recorrer_hoja(hoja):
    """Lee una hoja y devuelve (meta, filas), sin juzgar nada.

    Lo usan TANTO el revisor como el cargador. Que cada uno interpretara
    las columnas por su lado terminaría en que uno aprueba lo que el otro
    carga distinto, y la diferencia aparecería en una declaración.

    Cada fila trae 'clase':
      'operacion'  una compra o venta real
      'anulada'    numerada pero en cero
      'sucursal'   el resumen de un establecimiento; NO es una operación
    """
    lineas = [c for fila in hoja.filas[:12] for c in fila]
    periodo, quincena, rango, err_per = leer_periodo(lineas)
    meta = {'hoja': hoja.nombre, 'periodo': periodo, 'quincena': quincena,
            'rango': rango, 'errores': [], 'totales': None}

    if err_per:
        meta['errores'].append(('periodo', err_per))

    # La hoja dice una quincena en su nombre y otra en su rango.
    # Las alternativas largas van primero: la expresión toma la primera que
    # case, y con '1' delante '1ra' nunca llegaría a probarse.
    m_nom = re.search(r'(1ra|2da|primera|segunda|1|2)\s*quincena', plano(hoja.nombre))
    if m_nom and quincena:
        dice = 1 if m_nom.group(1) in ('1', '1ra', 'primera') else 2
        if dice != quincena:
            meta['errores'].append(('periodo',
                                    'La hoja se llama %sda quincena pero su encabezado dice %s'
                                    % (dice, rango)))

    i_enc = next((i for i, f in enumerate(hoja.filas) if es_encabezado(f)), None)
    if i_enc is None:
        meta['errores'].append(('estructura', 'No se encontró la fila de encabezados'))
        return meta, []
    mapa = mapear_columnas(hoja.filas[i_enc])
    faltan = [c for c in ('fecha', 'total', 'base', 'iva') if c not in mapa]
    if faltan:
        meta['errores'].append(('estructura',
                                'Faltan columnas en el encabezado: ' + ', '.join(faltan)))
        return meta, []

    # Compras y ventas no se revisan igual: en una compra la fecha de la
    # factura puede ser anterior a su período y en una venta no. Se deduce
    # del encabezado, que dice 'Proveedor' o 'Nombre' según el libro.
    i_nom = mapa.get('nombre')
    meta['tipo'] = ('compra' if i_nom is not None
                    and 'proveedor' in plano(hoja.filas[i_enc][i_nom]) else 'venta')

    filas, cerrada = [], False
    for fila in hoja.filas[i_enc + 1:]:
        crudo = ' '.join(texto(c) for c in fila)
        if not crudo.strip():
            continue

        # El renglón de TOTALES de la hoja, para contrastarlo después.
        #
        # Se toma el PRIMERO y nunca se reemplaza. Estas hojas traen un
        # segundo TOTALES, vacío, del bloque "VIENEN" que arrastra saldos
        # entre páginas; dejarlo pisar al primero hacía que el revisor
        # comparara las filas contra cero y denunciara como descuadre cada
        # hoja que sí cuadraba.
        if re.match(r'^\s*totales?\s*:?\s*$', plano(texto(fila[0]) if fila else '')):
            if not cerrada:
                crudos = {k: num(celda(fila, mapa, k))
                          for k in ('total', 'exento', 'base', 'iva')}
                # Vacío no es cero. Ese renglón son fórmulas =SUM(), y un
                # archivo guardado por algo que no sea Excel no deja
                # almacenado su resultado. Leerlo como cero haría que el
                # revisor contrastara las filas contra nada y denunciara
                # como descuadre todas las hojas. Sin ese dato, no se
                # contrasta y se dice que no se pudo.
                meta['totales'] = (None if all(v is None for v in crudos.values())
                                   else {k: (v or 0.0) for k, v in crudos.items()})
                cerrada = True
            continue
        # Debajo de TOTALES viene el cuadro de la Forma 30, que no son filas.
        if cerrada:
            continue

        f, f_txt = leer_fecha(celda(fila, mapa, 'fecha'))
        r = {
            'fecha': f, 'fecha_txt': f_txt,
            'rif': texto(celda(fila, mapa, 'rif')),
            'nombre': texto(celda(fila, mapa, 'nombre')),
            'factura': texto(celda(fila, mapa, 'factura')),
            'control': texto(celda(fila, mapa, 'control')),
            'total': num(celda(fila, mapa, 'total')) or 0.0,
            'exento': num(celda(fila, mapa, 'exento')) or 0.0,
            'base': num(celda(fila, mapa, 'base')) or 0.0,
            'iva': num(celda(fila, mapa, 'iva')) or 0.0,
            'igtf': num(celda(fila, mapa, 'igtf')) or 0.0,
            'retenido': num(celda(fila, mapa, 'retenido')) or 0.0,
            'alicuota': num(celda(fila, mapa, 'alicuota')),
        }

        # La línea de resumen de una sucursal: NO es una operación, y
        # cargarla junto a las facturas de esa sucursal contaría el período
        # dos veces.
        if re.search(r'sucursal', plano(r['rif'] + ' ' + r['nombre'] + ' ' + crudo)) and not r['factura']:
            r['clase'] = 'sucursal'
            filas.append(r)
            continue

        hay_monto = abs(r['total']) > TOLERANCIA or abs(r['base']) > TOLERANCIA
        if not hay_monto and not f and not r['factura']:
            continue                      # fila del formato, sin llenar

        r['ref'] = r['factura'] or (f_txt or '(sin fecha)')
        r['clase'] = 'operacion' if hay_monto else 'anulada'
        filas.append(r)

    return meta, filas


def revisar_hoja(hoja, problemas, resumen):
    meta, filas = recorrer_hoja(hoja)
    donde, periodo = meta['hoja'], meta['periodo']
    for clase, msg in meta['errores']:
        problemas.append((donde, '', clase, msg))

    suma = {'total': 0.0, 'exento': 0.0, 'base': 0.0, 'iva': 0.0}
    operaciones, sucursales, anuladas, tardias = 0, [], [], []

    for r in filas:
        if r['clase'] == 'sucursal':
            sucursales.append((donde, r['total'], r['base'], r['iva']))
            continue
        if r['clase'] == 'anulada':
            anuladas.append((donde, r['ref']))
            continue

        ref = r['ref']
        f, f_txt, rif, nombre, factura = r['fecha'], r['fecha_txt'], r['rif'], r['nombre'], r['factura']
        total, exento, base, iva, igtf, alic = (r['total'], r['exento'], r['base'],
                                                r['iva'], r['igtf'], r['alicuota'])
        operaciones += 1
        suma['total'] += total
        suma['exento'] += exento
        suma['base'] += base
        suma['iva'] += iva

        # --- el total es la suma de sus partes ---
        esperado = exento + base + iva + igtf
        if abs(total - esperado) > TOLERANCIA:
            problemas.append((donde, ref, 'no cuadra',
                              'Total %s pero exento+base+IVA+IGTF da %s (diferencia %s)'
                              % (mm(total), mm(esperado), mm(total - esperado))))

        # --- el IVA corresponde a la base ---
        if alic and base:
            a = alic if alic < 1 else alic / 100.0
            if abs(iva - base * a) > TOLERANCIA:
                problemas.append((donde, ref, 'no cuadra',
                                  'IVA %s pero base %s al %s%% da %s'
                                  % (mm(iva), mm(base), mm(a * 100), mm(base * a))))

        # --- la fecha ---
        if not f:
            problemas.append((donde, ref, 'fecha', 'Fecha ilegible o vacía: "%s"' % f_txt))
        elif f > date.today():
            problemas.append((donde, ref, 'fecha',
                              'Fecha en el futuro: %s' % f.isoformat()))
        elif periodo and f.strftime('%Y-%m') != periodo:
            antes = f.strftime('%Y-%m') < periodo
            if meta['tipo'] == 'compra' and antes:
                # Normal, no es un error: una factura de compra se declara
                # cuando llega, y puede llegar meses después de emitida. Es
                # exactamente para esto que el registro guarda el período
                # aparte de la fecha. Se anota para que se vea, no para
                # frenar la carga.
                tardias.append((donde, ref, f.isoformat(), periodo))
            else:
                problemas.append((donde, ref, 'fecha',
                                  'Fecha %s %s del período %s de la hoja'
                                  % (f.isoformat(),
                                     'anterior a' if antes else 'posterior a', periodo)))

        # --- de quién es la operación ---
        if not rif or len(re.sub(r'\D', '', rif)) < 7:
            problemas.append((donde, ref, 'sin tercero',
                              'RIF vacío o incompleto ("%s") en una operación de %s'
                              % (rif, mm(total))))
        if not nombre:
            problemas.append((donde, ref, 'sin tercero',
                              'Sin nombre en una operación de %s' % mm(total)))
        if not factura:
            problemas.append((donde, ref, 'sin factura',
                              'Sin número de factura en una operación de %s' % mm(total)))

    # --- la hoja suma lo que dice sumar ---
    if meta['totales']:
        for campo in ('total', 'base', 'iva'):
            dice = meta['totales'].get(campo) or 0.0
            # El TOTALES de la casa matriz incluye la línea de la sucursal.
            propio = suma[campo] + sum(s[{'total': 1, 'base': 2, 'iva': 3}[campo]]
                                       for s in sucursales)
            if abs(dice - propio) > TOLERANCIA:
                problemas.append((donde, 'TOTALES', 'no cuadra',
                                  'La hoja dice %s de %s pero sus filas suman %s (diferencia %s)'
                                  % (mm(dice), campo, mm(propio), mm(dice - propio))))

    resumen.append({
        'hoja': donde, 'periodo': periodo, 'quincena': meta['quincena'],
        'operaciones': operaciones, 'anuladas': anuladas, 'tardias': tardias,
        'sucursales': sucursales, 'base': suma['base'],
        # Que no se haya podido contrastar es un dato: significa que esa
        # hoja se revisó con una comprobación menos.
        'sin_totales': meta['totales'] is None and operaciones > 0,
    })


def mm(v):
    return '{:,.2f}'.format(v).replace(',', '~').replace('.', ',').replace('~', '.')


def main():
    ap = argparse.ArgumentParser(description='Revisa un libro fiscal antes de cargarlo.')
    ap.add_argument('archivo')
    ap.add_argument('--tipo', choices=['compra', 'venta'], default=None)
    args = ap.parse_args()

    if args.archivo.lower().endswith('.md'):
        hojas = hojas_desde_md(args.archivo)
    elif args.archivo.lower().endswith(('.xlsx', '.xlsm')):
        hojas = hojas_desde_xlsx(args.archivo)
    else:
        sys.exit('Formato no reconocido. Se esperaba .md o .xlsx')

    if not hojas:
        sys.exit('El archivo no tiene hojas legibles.')

    problemas, resumen = [], []
    for h in hojas:
        revisar_hoja(h, problemas, resumen)

    out = sys.stdout
    out.write('\n%s\n' % ('=' * 72))
    out.write('  %s\n' % args.archivo)
    out.write('%s\n\n' % ('=' * 72))

    tot_ops = sum(r['operaciones'] for r in resumen)
    tot_anu = sum(len(r['anuladas']) for r in resumen)
    tot_suc = sum(len(r['sucursales']) for r in resumen)

    out.write('%d hoja(s) · %d operaciones · %d en cero · %d línea(s) de sucursal\n\n'
              % (len(resumen), tot_ops, tot_anu, tot_suc))

    for r in resumen:
        per = r['periodo'] or '?'
        q = ('Q%d' % r['quincena']) if r['quincena'] else 'mes'
        out.write('  %-28s %s %-4s %3d oper.  base %16s\n'
                  % (r['hoja'][:28], per, q, r['operaciones'], mm(r['base'])))

    if tot_suc:
        out.write('\nLíneas de resumen de sucursal (NO se cargan: las facturas\n'
                  'de la sucursal ya vienen en su propio libro):\n')
        for r in resumen:
            for s in r['sucursales']:
                out.write('  %-28s  total %16s\n' % (s[0][:28], mm(s[1])))

    if tot_anu:
        out.write('\nOperaciones en cero (revisar si son ANULADAS):\n')
        for r in resumen:
            for a in r['anuladas']:
                out.write('  %-28s  %s\n' % (a[0][:28], a[1]))

    tot_tar = sum(len(r.get('tardias') or []) for r in resumen)
    if tot_tar:
        out.write('\nCompras declaradas después de la fecha de su factura.\n'
                  'Es normal —el crédito se toma cuando llega la factura— y por eso\n'
                  'el registro guarda el período aparte de la fecha:\n')
        for r in resumen:
            for hoja, ref, fch, per in (r.get('tardias') or []):
                out.write('  %-24s %-12s factura del %s → se declara en %s\n'
                          % (hoja[:24], ref[:12], fch, per))

    sin_tot = [r['hoja'] for r in resumen if r.get('sin_totales')]
    if sin_tot:
        out.write('\nEn %d hoja(s) no se pudo contrastar contra su renglón de TOTALES:\n'
                  'son fórmulas sin resultado guardado. Ábrelas y guárdalas en Excel\n'
                  'para que quede almacenado, y vuelve a revisar:\n' % len(sin_tot))
        for h in sin_tot[:8]:
            out.write('  %s\n' % h)
        if len(sin_tot) > 8:
            out.write('  ... y %d más\n' % (len(sin_tot) - 8))

    if not problemas:
        out.write('\nSin problemas. El libro se puede cargar.\n\n')
        return 0

    out.write('\n%s\n  %d PROBLEMA(S) — corregir antes de cargar\n%s\n\n'
              % ('-' * 72, len(problemas), '-' * 72))
    orden = ['no cuadra', 'sin tercero', 'fecha', 'sin factura', 'periodo', 'estructura']
    for clase in orden:
        delclase = [p for p in problemas if p[2] == clase]
        if not delclase:
            continue
        out.write('%s (%d)\n' % (clase.upper(), len(delclase)))
        for hoja, ref, _, msg in delclase:
            out.write('  %-24s %-12s %s\n' % (hoja[:24], ref[:12], msg))
        out.write('\n')
    return 1


if __name__ == '__main__':
    sys.exit(main())
