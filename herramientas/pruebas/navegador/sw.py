# -*- coding: utf-8 -*-
"""El service worker, con Chrome de verdad y un servidor que CUENTA.

   Lo que se comprueba es lo que Luis sufrio en el telefono:

   · Que al volver a abrir la app NO se baje otra vez el CSS, el JS y los
     218 KB de Supabase. Iban «primero la red», y con datos moviles eso era
     bajarselo todo cada vez. Eso era la lentitud.

   · Que un despliegue nuevo se siga notando: la NAVEGACION debe ir a la red.

   Se levanta un servidor propio que apunta cada peticion, asi que no hay que
   suponer nada: se ve quien pidio que y cuantas veces.
"""
import http.server
import io
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(AQUI)))

CHROMES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
chrome = next((c for c in CHROMES if os.path.exists(c)), None)
if not chrome:
    print('No encuentro Chrome. Esta prueba se salta (no bloquea nada).')
    sys.exit(0)

PEDIDOS = []
_candado = threading.Lock()


class Contador(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        with _candado:
            PEDIDOS.append(self.path.split('?')[0])
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

    def end_headers(self):
        """Sin cache del navegador.

           Sin esto, Chrome se guarda los archivos por su cuenta y no vuelve a
           pedirlos — ni siquiera cuando el service worker SI sale a la red.
           Entonces el contador marca cero y parece que todo va de la copia,
           cuando lo que pasa es que la medida no ve nada. Aqui se quiere
           medir al service worker, no al cache del navegador."""
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        return http.server.SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, *a):
        pass   # silencio: el resumen lo imprime esta prueba


os.chdir(RAIZ)
socketserver.TCPServer.allow_reuse_address = True
servidor = socketserver.TCPServer(('127.0.0.1', 0), Contador)
PUERTO = servidor.server_address[1]
threading.Thread(target=servidor.serve_forever, daemon=True).start()

perfil = tempfile.mkdtemp(prefix='da_sw_')


def abrir(segundos=14):
    """Abre la app en Chrome con un perfil que SE CONSERVA entre llamadas.

       Es lo que permite que la segunda vez ya haya service worker instalado
       — que es justo el caso que se quiere medir."""
    subprocess.run(
        [chrome, '--headless=new', '--disable-gpu',
         '--user-data-dir=' + perfil, '--no-first-run', '--no-default-browser-check',
         '--virtual-time-budget=%d' % (segundos * 1000), '--dump-dom',
         'http://127.0.0.1:%d/index.html' % PUERTO],
        capture_output=True, timeout=120)


fallas = 0


def ok(q, real, esperado):
    global fallas
    bien = str(real) == str(esperado)
    if not bien:
        fallas += 1
    print(('  OK  ' if bien else '  MAL ') + q + ' -> ' + str(real)
          + ('' if bien else '   (esperado %s)' % esperado))


try:
    print('\nPrimera visita (todavia no hay nada guardado)')
    abrir()
    time.sleep(1.5)
    with _candado:
        primera = list(PEDIDOS)
        PEDIDOS.clear()
    pesados = [p for p in primera if p.endswith(('.js', '.css'))]
    ok('se baja la app entera', len(pesados) > 5, True)

    print('\nSegunda visita (ya con la copia guardada)')
    abrir()
    time.sleep(1.5)
    with _candado:
        segunda = list(PEDIDOS)

    def cuantas(ruta):
        return sum(1 for p in segunda if p.endswith(ruta))

    ok('el index se vuelve a pedir (asi llega un despliegue nuevo)',
       cuantas('/index.html') >= 1, True)

    """Lo pesado NO se vuelve a pedir. Dentro de una version la copia ES la
       version -el nombre del cache lleva el numero-, asi que pedirlo otra vez
       es gastar datos del telefono en algo que ya se tiene."""
    ok('Supabase (218 KB) no se vuelve a pedir', cuantas('vendor/supabase.js'), 0)
    ok('app.js no se vuelve a pedir', cuantas('/assets/app.js'), 0)
    ok('app.css no se vuelve a pedir', cuantas('/assets/app.css'), 0)
    ok('abrir la app son 3 peticiones o menos', len(segunda) <= 3, True)

    print('\n  peticiones de la segunda visita (%d):' % len(segunda))
    for _p in segunda:
        print('     ', _p)

finally:
    servidor.shutdown()
    shutil.rmtree(perfil, ignore_errors=True)

print('\n' + ('HAY %d FALLA(S)' % fallas if fallas else 'TODO OK'))
sys.exit(1 if fallas else 0)
