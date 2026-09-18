# -*- coding: utf-8 -*-
"""Mapa de app.js: que hay dentro y donde empieza cada cosa.

Recorre el archivo contando llaves —saltando cadenas, plantillas, expresiones
regulares y comentarios, que es donde estos contadores se equivocan— y anota
cada bloque de nivel superior con su primera linea y su tamaño.

No modifica nada: solo mira.
"""
import io, json, re, sys

RUTA = r'c:\Users\torre\OneDrive\Escritorio\PROYECTOS\DigiAccount\assets\app.js'
src = io.open(RUTA, encoding='utf-8').read()

i, n = 0, len(src)
prof = 0
linea = 1
cortes = []          # (linea, profundidad_antes) de cada '(' de nivel 0
inicios = []         # lineas donde empieza un bloque de nivel superior
fin_de_bloque = []   # lineas donde la profundidad vuelve a 0

def es_regex(antes):
    """Una barra inicia regex si lo anterior es operador o apertura."""
    t = antes.rstrip()
    if not t:
        return True
    return t[-1] in '(,=:[!&|?{};+-*%~^<>' or t.endswith('return') or t.endswith('typeof')

while i < n:
    c = src[i]
    if c == '\n':
        linea += 1; i += 1; continue
    # comentarios
    if c == '/' and i + 1 < n:
        if src[i+1] == '/':
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if src[i+1] == '*':
            j = src.find('*/', i + 2)
            trozo = src[i:(n if j < 0 else j+2)]
            linea += trozo.count('\n')
            i = n if j < 0 else j + 2
            continue
        if es_regex(src[max(0, i-80):i]):
            j = i + 1
            while j < n and src[j] != '\n':
                if src[j] == '\\': j += 2; continue
                if src[j] == '[':
                    while j < n and src[j] != ']':
                        j += 2 if src[j] == '\\' else 1
                if src[j] == '/': break
                j += 1
            i = j + 1
            continue
    # cadenas
    if c in '"\'`':
        cierre = c
        j = i + 1
        while j < n:
            if src[j] == '\\': j += 2; continue
            if src[j] == '\n' and cierre != '`': break
            if src[j] == '\n': linea += 1
            if src[j] == cierre: break
            j += 1
        i = j + 1
        continue
    if c in '{([':
        if prof == 0 and c == '(':
            inicios.append(linea)
        prof += 1
    elif c in '})]':
        prof -= 1
        if prof == 0:
            fin_de_bloque.append(linea)
    i += 1

# Nombre de cada bloque: el comentario o el nombre de la funcion que lo abre
lineas = src.split('\n')
bloques = []
for k, ln in enumerate(inicios):
    txt = lineas[ln-1]
    m = re.search(r'function\s+([A-Za-z0-9_$]+)', txt)
    nombre = m.group(1) if m else txt.strip()[:60]
    fin = fin_de_bloque[k] if k < len(fin_de_bloque) else len(lineas)
    bloques.append({'linea': ln, 'fin': fin, 'lineas': fin - ln + 1, 'nombre': nombre})

bloques.sort(key=lambda b: -b['lineas'])
print('Bloques de nivel superior:', len(bloques), '· líneas del archivo:', len(lineas))
print()
print('Los 25 más grandes:')
for b in bloques[:25]:
    print('  %6d líneas · desde la %6d · %s' % (b['lineas'], b['linea'], b['nombre']))
io.open(r'C:\Users\torre\AppData\Local\Temp\claude\c--Users-torre-OneDrive-Escritorio-PROYECTOS\bd3164b4-37b2-4d5f-b60e-cd469216c476\scratchpad\mapa_app.json', 'w', encoding='utf-8').write(
    json.dumps(sorted(bloques, key=lambda b: b['linea']), ensure_ascii=False, indent=1))
