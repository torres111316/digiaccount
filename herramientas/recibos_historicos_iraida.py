# -*- coding: utf-8 -*-
"""
Genera los 53 recibos semanales históricos de JULIEXY y REISON.

DE DÓNDE SALEN LOS NÚMEROS
  No se recalculan: se copian de los recibos que YA se emitieron para dos
  compañeros con exactamente el mismo cargo y el mismo paquete semanal.

      NÉSTOR  → JULIEXY   Atención al cliente (barra) · 42,86 $/semana
      ÁNGEL   → REISON    Panadero                    · 53,71 $/semana

  Los cuatro entraron el 19/07/2025, así que cubren las mismas 53 semanas
  con las mismas tasas del BCV. Recalcularlos abriría la puerta a que un
  redondeo o una tasa distinta diera un céntimo de diferencia con lo ya
  entregado, y son recibos firmados: tienen que decir lo mismo.

  Por eso lo único que cambia es la identidad —nombre, cédula y el
  identificador del trabajador dentro del número de recibo—, y el
  programa comprueba después que del compañero no quedó ni rastro.

USO
  python recibos_historicos_iraida.py            (ensayo, no escribe)
  python recibos_historicos_iraida.py --generar
"""
import os
import re
import sys

ORIGEN = r'C:\Users\torre\OneDrive\Documentos\Recibos Iraida'
SALIDA = ORIGEN

# molde -> destino. El molde es el compañero de mismo cargo y mismo paquete.
PARES = [
    {'molde': 'Recibos semanales - NESTOR ENRIQUE ESPINAL PEÑA.html',
     'de_nombre': 'NESTOR ENRIQUE ESPINAL PEÑA', 'de_cedula': 'V24712495',
     'de_id': '7d0ac057-46f9-483b-914d-0e23755684eb',
     'a_nombre': 'JULIEXY NOHELIA PEÑA TORRES', 'a_cedula': 'V29745926',
     'a_id': 'bfecf820-06dd-4452-bd1e-caf07f12df96'},
    {'molde': 'Recibos semanales - ANGEL GABRIEL MENDOZA ESCOBAR.html',
     'de_nombre': 'ANGEL GABRIEL MENDOZA ESCOBAR', 'de_cedula': 'V16822677',
     'de_id': 'b7372671-e475-49d4-8934-75398feb25a3',
     'a_nombre': 'REISON ADAN RODRIGUEZ LEAL', 'a_cedula': 'V24154402',
     'a_id': '73b0cc39-9aaf-448c-a8d3-537cd4e27bb8'},

    # MARIANNYS entró casi un mes después, el 16/08/2025, así que no le
    # tocan las 53 semanas: se recortan las que son anteriores a su ingreso.

    # El molde vuelve a ser ÁNGEL porque comparten el paquete —53,71 $ a la
    # semana— aunque el cargo sea distinto (pastelera y panadero): lo que
    # tiene que coincidir para copiar los importes es el paquete, no el
    # nombre del puesto. El cargo se cambia como el nombre y la cédula.

    # Se cuenta desde la primera semana COMPLETA posterior al ingreso. El
    # 16/08 cayó sábado, así que la semana del 11 al 17 la trabajó apenas dos
    # días: copiarle ahí el recibo de una semana entera le pagaría cinco días
    # que no trabajó. Ese pago parcial, si corresponde, se calcula aparte. 
    {'molde': 'Recibos semanales - ANGEL GABRIEL MENDOZA ESCOBAR.html',
     'de_nombre': 'ANGEL GABRIEL MENDOZA ESCOBAR', 'de_cedula': 'V16822677',
     'de_id': 'b7372671-e475-49d4-8934-75398feb25a3',
     'de_cargo': 'PANADERO', 'de_ingreso': '19/07/2025',
     'a_nombre': 'MARIANNYS CAROLINA RIVERO MORENO', 'a_cedula': 'V20241119',
     'a_id': 'b4bca898-8e0b-4386-83a5-52e0aacef65f',
     'a_cargo': 'PASTELERA', 'a_ingreso': '16/08/2025',
     'desde': '2025-08-18', 'semanas_esperadas': 49},
]


def recortar(html, desde_iso):
    """Deja solo los recibos de semanas que EMPIEZAN en o después de `desde_iso`.

    Cada recibo es un `<div class="recibo-doc">`, y el documento trae uno tras
    otro después de un `<style>` común. Se parte por ese div, se descartan los
    anteriores y se vuelve a armar: así el encabezado, los estilos y el cierre
    quedan intactos y solo cambia cuántos recibos hay en medio.
    """
    marca = '<div class="recibo-doc">'
    trozos = html.split(marca)
    cabeza, recibos = trozos[0], trozos[1:]
    quedan, fuera = [], 0
    for r in recibos:
        m = re.search(r'Semana\s+(\d{2})/(\d{2})/(\d{4})\s*al', r)
        if not m:
            quedan.append(r)          # sin fecha legible no se descarta nada
            continue
        ini = '%s-%s-%s' % (m.group(3), m.group(2), m.group(1))
        if ini >= desde_iso:
            quedan.append(r)
        else:
            fuera += 1
    return cabeza + marca + marca.join(quedan), fuera


def montos(html):
    """Todos los importes del documento, para comprobar que no se movió ninguno."""
    return re.findall(r'>\s*(−?\s*[\d.]+,\d{2})\s*<', html)


def main():
    generar = '--generar' in sys.argv
    problemas = 0

    for p in PARES:
        ruta = os.path.join(ORIGEN, p['molde'])
        if not os.path.exists(ruta):
            print('NO ESTÁ el molde: %s' % p['molde'])
            problemas += 1
            continue

        h = open(ruta, encoding='utf-8').read()
        if p.get('desde'):
            h, quitadas = recortar(h, p['desde'])
            print('')
            print('  se quitan %d semanas anteriores al %s' % (quitadas, p['desde']))
        antes = montos(h)
        semanas = len(re.findall(r'Semana\s+\d{2}/\d{2}/\d{4}\s*al\s*\d{2}/\d{2}/\d{4}', h))

        nuevo = h
        # El cargo y la fecha de ingreso también cambian cuando el molde es de
        # otro puesto. Se hacen ANTES del nombre para que el reemplazo del
        # cargo no toque un nombre que lo contenga.
        if p.get('de_cargo'):
            nuevo = nuevo.replace('>' + p['de_cargo'] + '<', '>' + p['a_cargo'] + '<')
        if p.get('de_ingreso'):
            nuevo = nuevo.replace('>' + p['de_ingreso'] + '<', '>' + p['a_ingreso'] + '<')
        # El identificador va en mayúsculas dentro del número de recibo y en
        # minúsculas en cualquier otro sitio: se cambian las dos formas.
        nuevo = nuevo.replace(p['de_id'].upper(), p['a_id'].upper())
        nuevo = nuevo.replace(p['de_id'], p['a_id'])
        nuevo = nuevo.replace(p['de_nombre'], p['a_nombre'])
        nuevo = nuevo.replace(p['de_cedula'], p['a_cedula'])

        despues = montos(nuevo)
        rastro = []
        for token in (p['de_nombre'], p['de_cedula'], p['de_id'], p['de_id'].upper()):
            if token in nuevo:
                rastro.append(token)
        # Un apellido suelto delataría un cambio a medias.
        for cacho in p['de_nombre'].split():
            if len(cacho) > 3 and cacho not in p['a_nombre'] and cacho in nuevo:
                rastro.append(cacho)

        salida = os.path.join(SALIDA, 'Recibos semanales - %s.html' % p['a_nombre'])
        print('\n%s' % ('=' * 70))
        print('  %s  →  %s' % (p['de_nombre'], p['a_nombre']))
        print('%s' % ('=' * 70))
        print('  semanas en el documento : %d' % semanas)
        print('  importes                : %d  (iguales: %s)'
              % (len(despues), 'sí' if antes == despues else 'NO'))
        print('  nombre nuevo aparece    : %d veces' % nuevo.count(p['a_nombre']))
        print('  cédula nueva aparece    : %d veces' % nuevo.count(p['a_cedula']))
        print('  rastro del compañero    : %s' % (', '.join(sorted(set(rastro))) or 'ninguno'))

        esperadas = p.get('semanas_esperadas', 53)
        if semanas != esperadas or antes != despues or rastro:
            print('  >>> NO SE ESCRIBE: algo no cuadra.')
            problemas += 1
            continue

        if generar:
            with open(salida, 'w', encoding='utf-8') as f:
                f.write(nuevo)
            print('  ESCRITO: %s' % os.path.basename(salida))
        else:
            print('  (ensayo — se escribiría en %s)' % os.path.basename(salida))

    if not generar and not problemas:
        print('\nEnsayo. Agrega --generar para escribir los archivos.')
    return 1 if problemas else 0


if __name__ == '__main__':
    sys.exit(main())
