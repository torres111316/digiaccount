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
]


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
        antes = montos(h)
        semanas = len(re.findall(r'Semana\s+\d{2}/\d{2}/\d{4}\s*al\s*\d{2}/\d{2}/\d{4}', h))

        nuevo = h
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

        if semanas != 53 or antes != despues or rastro:
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
