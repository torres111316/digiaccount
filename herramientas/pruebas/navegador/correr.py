# -*- coding: utf-8 -*-
"""Corre la sonda dentro del index.html REAL, con Chrome sin ventana.

   Ver LEEME.md. Necesita el servidor local levantado (puerto 8099 por
   defecto) porque el CSP de la app no admite scripts de fuera.
"""
import html
import io
import os
import re
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(AQUI)))
PUERTO = os.environ.get('DA_PUERTO', '8099')

CHROMES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
chrome = next((c for c in CHROMES if os.path.exists(c)), None)
if not chrome:
    print('No encuentro Chrome. Esta prueba se salta (no bloquea nada).')
    sys.exit(0)

os.chdir(RAIZ)

# La sonda tiene que servirse desde el mismo sitio: el CSP de la app es
# `script-src 'self'` y no admite scripts pegados dentro del HTML.
sonda = io.open(os.path.join(AQUI, 'sonda.js'), encoding='utf-8').read()
io.open('_sonda.js', 'w', encoding='utf-8', newline='').write(sonda)

pagina = io.open('index.html', encoding='utf-8', newline='').read()
assert '</body>' in pagina, 'index.html sin </body>'
pagina = pagina.replace('</body>', '<script src="_sonda.js"></script></body>', 1)
io.open('_sonda.html', 'w', encoding='utf-8', newline='').write(pagina)

def mirar(ancho, alto):
    """Abre la app a ese tamaño y devuelve lo que la sonda escribio."""
    bruto = subprocess.run(
        [chrome, '--headless=new', '--disable-gpu',
         '--window-size=%d,%d' % (ancho, alto),
         '--virtual-time-budget=16000', '--dump-dom',
         'http://127.0.0.1:%s/_sonda.html' % PUERTO],
        capture_output=True, timeout=120).stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="SONDA">(.*?)</pre>', bruto, re.S)
    return html.unescape(m.group(1)) if m else None


try:
    # Dos tamaños: la app cambia de traje en 560px, y el fallo que motivo
    # esta prueba -no llegar al paginador- solo pasaba en el estrecho.
    # Chrome sin ventana no baja de 500px de ancho.
    partes = [mirar(1400, 900), mirar(500, 740)]
finally:
    # Los dos archivos son de usar y tirar: que no queden en la carpeta ni,
    # peor, en un commit.
    for f in ('_sonda.js', '_sonda.html'):
        try:
            os.remove(f)
        except OSError:
            pass

if not any(partes):
    print('La sonda no llego a correr.')
    print('Levanta el servidor y vuelve a intentar:')
    print('   python -m http.server ' + PUERTO)
    sys.exit(2)

hubo = False
for texto in partes:
    if texto is None:
        print('(una de las dos pasadas no devolvio nada)')
        hubo = True
        continue
    print(texto)
    print('-' * 62)
    if 'FALLA' in texto:
        hubo = True
sys.exit(1 if hubo else 0)
