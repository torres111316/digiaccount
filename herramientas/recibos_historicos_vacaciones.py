# -*- coding: utf-8 -*-
"""
Arma los recibos semanales historicos de un trabajador que sale de vacaciones.

EL ACUERDO
  Los recibos semanales se empezaron a emitir desde la aplicacion a partir
  del 27/07/2026. Hacia atras queda el ano de trabajo del grupo que entro
  el 19/07/2025: 53 semanas que se van generando A MEDIDA QUE CADA UNO SALE
  DE VACACIONES, que es cuando hace falta el expediente completo.

  Ya se hicieron asi los de JULIEXY, REISON y MARIANNYS.

DE DONDE SALEN LOS NUMEROS
  No se recalculan: se copian del documento ya emitido de un companero con
  el MISMO PAQUETE SEMANAL. Recalcular abriria la puerta a que un redondeo
  o una tasa distinta diera un centimo de diferencia con lo que ya se
  entrego firmado, y los recibos de una misma semana tienen que decir lo
  mismo para todo el que cobra igual.

  Lo unico que cambia es la identidad: nombre, cedula, cargo, fecha de
  ingreso y el identificador del trabajador dentro del numero de recibo.
  Al final el programa comprueba que del companero no quedo ni rastro y que
  no se movio ni un importe.

LOS DATOS SALEN DEL SISTEMA, NO DE AQUI
  Nombre, cedula, cargo, ingreso, paquete y fechas de vacaciones se leen de
  `empleados`. Tecleados a mano es donde se cuela una cedula equivocada, y
  una cedula equivocada en un recibo firmado no se arregla despues.

  El token va en la variable de entorno DA_TOKEN (PowerShell: $env:DA_TOKEN='...').

USO
  python recibos_historicos_vacaciones.py VALERIA              (ensayo)
  python recibos_historicos_vacaciones.py VALERIA --generar
  python recibos_historicos_vacaciones.py --cedula V30068465
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ORIGEN = r'C:\Users\torre\OneDrive\Documentos\Recibos Iraida'
SALIDA = ORIGEN

URL = os.environ.get('DA_URL', 'https://esnicjnuymqgktqoueyq.supabase.co')
ANON = ('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6'
        'ImVzbmljam51eW1xZ2t0cW91ZXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MDI2'
        'NzksImV4cCI6MjA5NzI3ODY3OX0.RGM9o7ohWFDIE5BA4WwFkYx2NztAU68fk3Dbu7QifIU')

# El molde se elige por el PAQUETE SEMANAL, no por el cargo: lo que tiene
# que coincidir para copiar importes es cuanto cobra, no como se llama el
# puesto. MARIANNYS es pastelera y su molde fue el panadero.
MOLDES = {
    53.71: {'archivo': 'Recibos semanales - ANGEL GABRIEL MENDOZA ESCOBAR.html',
            'nombre': 'ANGEL GABRIEL MENDOZA ESCOBAR', 'cedula': 'V16822677',
            'id': 'b7372671-e475-49d4-8934-75398feb25a3',
            'cargo': 'PANADERO', 'ingreso': '19/07/2025'},
    42.86: {'archivo': 'Recibos semanales - NESTOR ENRIQUE ESPINAL PE\u00d1A.html',
            'nombre': 'NESTOR ENRIQUE ESPINAL PE\u00d1A', 'cedula': 'V24712495',
            'id': '7d0ac057-46f9-483b-914d-0e23755684eb',
            'cargo': 'ATENCI\u00d3N AL CLIENTE (BARRA)', 'ingreso': '19/07/2025'},
}


# ---------------------------------------------------------------- sistema

def api(ruta):
    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit("Falta el token. PowerShell:  $env:DA_TOKEN='...'")
    req = urllib.request.Request(URL + '/rest/v1/' + ruta)
    req.add_header('apikey', ANON)
    req.add_header('Authorization', 'Bearer ' + token)
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        sys.exit('La consulta fallo (%s): %s' % (e.code, e.read().decode('utf-8')[:300]))


def buscar(texto, por_cedula=False):
    campo = 'cedula' if por_cedula else 'nombre'
    filas = api('empleados?select=*&%s=ilike.*%s*' % (campo, urllib.parse.quote(texto.upper())))
    if not filas:
        sys.exit('No hay ningun trabajador que coincida con "%s".' % texto)
    if len(filas) > 1:
        print('Coincide con mas de uno. Se preciso mas:')
        for f in filas:
            print('   %s  %s' % (f['cedula'], f['nombre']))
        sys.exit(1)
    return filas[0]


# ---------------------------------------------------------------- fechas

def dmy(iso):
    return '%s/%s/%s' % (iso[8:10], iso[5:7], iso[0:4])


def lunes_de_la_primera_semana(ingreso_iso):
    """Primera semana COMPLETA del trabajador.

    Si entro un sabado, la semana en curso la trabajo dos dias: copiarle ahi
    el recibo de una semana entera le pagaria cinco dias que no trabajo. Ese
    pago parcial, si corresponde, se calcula aparte.
    """
    d = dt.date(*map(int, ingreso_iso.split('-')))
    return (d + dt.timedelta(days=(7 - d.weekday()) % 7)).isoformat()


# ---------------------------------------------------------------- molde

def semanas(html):
    """(inicio, fin) de cada recibo del documento, en ISO."""
    iso = lambda f: '%s-%s-%s' % (f[6:], f[3:5], f[0:2])
    return [(iso(a), iso(b)) for a, b in
            re.findall(r'Semana\s+(\d{2}/\d{2}/\d{4})\s*al\s*(\d{2}/\d{2}/\d{4})', html)]


def recortar(html, desde_iso):
    """Deja solo los recibos de semanas que EMPIEZAN en o despues de `desde_iso`.

    Cada recibo es un `<div class="recibo-doc">` y vienen uno tras otro
    despues de un `<style>` comun. Se parte por ese div, se descartan los
    anteriores y se rearma: encabezado, estilos y cierre quedan intactos.
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
    """Todos los importes, para comprobar que no se movio ninguno al copiar."""
    return re.findall(r'>\s*(\u2212?\s*[\d.]+,\d{2})\s*<', html)


# ---------------------------------------------------------------- principal

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    generar = '--generar' in sys.argv
    por_cedula = '--cedula' in sys.argv
    if not args:
        sys.exit(__doc__.strip().split('USO')[-1])

    emp = buscar(args[0], por_cedula)
    paquete = round(float(emp.get('contingencia_usd') or 0), 2)
    cedula = re.sub(r'[^A-Z0-9]', '', (emp.get('cedula') or '').upper())

    print('\n%s' % ('=' * 70))
    print('  %s' % emp['nombre'])
    print('%s' % ('=' * 70))
    print('  cedula        : %s' % cedula)
    print('  cargo         : %s' % emp.get('cargo'))
    print('  ingreso       : %s' % dmy(emp['ingreso']))
    print('  paquete       : %.2f $/semana  (frecuencia: %s)' % (paquete, emp.get('frecuencia')))
    print('  vacaciones    : %s  ->  %s'
          % (dmy(emp['vacaciones_desde']) if emp.get('vacaciones_desde') else '(sin marcar)',
             dmy(emp['vacaciones_hasta']) if emp.get('vacaciones_hasta') else ''))

    if emp.get('frecuencia') != 'semanal':
        sys.exit('  >>> Este trabajador NO cobra semanal. Este generador es solo de recibos semanales.')

    molde = MOLDES.get(paquete)
    if not molde:
        sys.exit('  >>> No hay molde para un paquete de %.2f $. Hay para: %s.\n'
                 '      Sus recibos se generan desde la aplicacion.'
                 % (paquete, ', '.join('%.2f' % k for k in sorted(MOLDES))))
    print('  molde         : %s' % molde['nombre'])

    ruta = os.path.join(ORIGEN, molde['archivo'])
    if not os.path.exists(ruta):
        sys.exit('  >>> NO ESTA el molde: %s' % molde['archivo'])
    h = open(ruta, encoding='utf-8').read()

    # 1. Recorte por su fecha de ingreso: solo semanas completas suyas.
    desde = lunes_de_la_primera_semana(emp['ingreso'])
    if desde > semanas(h)[0][0]:
        h, quitadas = recortar(h, desde)
        print('  se quitan %d semanas anteriores al %s (entro el %s)'
              % (quitadas, dmy(desde), dmy(emp['ingreso'])))

    antes = montos(h)
    sem = semanas(h)

    # 2. La copia. Cargo e ingreso van ANTES que el nombre, para que el
    #    reemplazo del cargo no toque un nombre que lo contenga.
    nuevo = h
    nuevo = nuevo.replace('>' + molde['cargo'] + '<', '>' + (emp.get('cargo') or '') + '<')
    nuevo = nuevo.replace('>' + molde['ingreso'] + '<', '>' + dmy(emp['ingreso']) + '<')
    # El identificador va en MAYUSCULAS dentro del numero de recibo y en
    # minusculas en cualquier otro sitio: se cambian las dos formas.
    nuevo = nuevo.replace(molde['id'].upper(), emp['id'].upper())
    nuevo = nuevo.replace(molde['id'], emp['id'])
    nuevo = nuevo.replace(molde['nombre'], emp['nombre'])
    nuevo = nuevo.replace(molde['cedula'], cedula)

    despues = montos(nuevo)

    # 3. Que no quede rastro del companero. Un apellido suelto delataria un
    #    cambio a medias, y ese recibo saldria a nombre de dos personas.
    rastro = []
    sospechosos = [molde['nombre'], molde['cedula'], molde['id'], molde['id'].upper()]
    # El cargo solo es rastro si el suyo es DISTINTO. Si comparten puesto
    # —los dos de barra— que aparezca es lo correcto.
    if molde['cargo'] != emp.get('cargo'):
        sospechosos.append(molde['cargo'])
    for token in sospechosos:
        if token in nuevo:
            rastro.append(token)
    for cacho in molde['nombre'].split():
        if len(cacho) > 3 and cacho not in emp['nombre'] and cacho in nuevo:
            rastro.append(cacho)

    print('  ' + '-' * 66)
    print('  semanas       : %d  (%s al %s)' % (len(sem), dmy(sem[0][0]), dmy(sem[-1][1])))
    print('  importes      : %d  (iguales al molde: %s)'
          % (len(despues), 'si' if antes == despues else 'NO'))
    print('  su nombre sale: %d veces' % nuevo.count(emp['nombre']))
    print('  su cedula sale: %d veces' % nuevo.count(cedula))
    print('  rastro del companero: %s' % (', '.join(sorted(set(rastro))) or 'ninguno'))

    # 4. Lo que este documento NO cubre: entre el fin del molde y el dia en
    #    que salio de vacaciones tambien trabajo, y esas semanas necesitan la
    #    tasa BCV real de cada una. No se copian ni se inventan.
    if emp.get('vacaciones_desde'):
        fin = dt.date(*map(int, semanas(nuevo)[-1][1].split('-')))
        vac = dt.date(*map(int, emp['vacaciones_desde'].split('-')))
        faltan = int((vac - dt.timedelta(days=1) - fin).days / 7)
        if faltan > 0:
            print('  ' + '-' * 66)
            print('  OJO: faltan %d semanas entre el %s y el %s (salio de vacaciones).'
                  % (faltan, dmy((fin + dt.timedelta(days=1)).isoformat()),
                     dmy((vac - dt.timedelta(days=1)).isoformat())))
            print('       Esas se generan desde la aplicacion con la tasa BCV de cada')
            print('       una. Este programa no las inventa.')

    if antes != despues or rastro:
        print('  >>> NO SE ESCRIBE: algo no cuadra.')
        return 1

    salida = os.path.join(SALIDA, 'Recibos semanales - %s.html' % emp['nombre'])
    if generar:
        with open(salida, 'w', encoding='utf-8') as f:
            f.write(nuevo)
        print('  ESCRITO: %s' % os.path.basename(salida))
    else:
        print('  (ensayo - se escribiria en %s)' % os.path.basename(salida))
        print('\nEnsayo. Agrega --generar para escribir el archivo.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
