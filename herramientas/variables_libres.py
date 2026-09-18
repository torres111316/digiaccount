# -*- coding: utf-8 -*-
"""Variables libres de un modulo: todo identificador que usa y no define.

Sirve para saber si un modulo se puede sacar a su propio archivo. Si solo usa
cosas globales y cosas de `window`, sale limpio; si usa un nombre privado del
bloque grande, ese nombre hay que mudar primero al nucleo.

Por que un recorredor y no expresiones regulares: hay que separar el CODIGO
del TEXTO, y el texto de este proyecto esta lleno de palabras en español que
parecen variables. Ademas, dentro de una plantilla `...${ aqui hay codigo }...`
el texto se descarta pero lo de adentro de ${} NO: una dependencia que solo se
use ahi tiene que verse igual.

    python herramientas/variables_libres.py <desde> <hasta> [archivo]

Sin archivo mira assets/app.js. Para revisar uno ya separado, se le pasa
entero:

    python herramientas/variables_libres.py 1 99999 assets/tesoreria.js
"""
import io, os, re, sys

LF = chr(10)


def solo_codigo(src):
    """Devuelve el texto dejando solo lo que es codigo de verdad."""
    salida = []
    i, n = 0, len(src)
    # pila de plantillas abiertas: cuenta de llaves dentro de su ${}
    plantillas = []

    def antes_de_regex():
        """Una barra inicia una expresion regular si lo anterior es operador."""
        t = ''.join(salida).rstrip()
        if not t:
            return True
        return t[-1] in '(,=:[!&|?{};+-*%~^<>' or re.search(r'\b(return|typeof|case|in|of)$', t)

    while i < n:
        c = src[i]
        # ¿cerramos el ${} de una plantilla?
        if plantillas and c == '}' and plantillas[-1] == 0:
            plantillas.pop()
            salida.append(' ')
            i += 1
            # seguimos leyendo el texto de la plantilla
            i, texto_ok = saltar_plantilla(src, i, salida, plantillas)
            continue
        if plantillas:
            if c == '{':
                plantillas[-1] += 1
            elif c == '}':
                plantillas[-1] -= 1
        # comentarios
        if c == '/' and i + 1 < n:
            if src[i + 1] == '/':
                j = src.find(LF, i)
                i = n if j < 0 else j
                continue
            if src[i + 1] == '*':
                j = src.find('*/', i + 2)
                i = n if j < 0 else j + 2
                salida.append(' ')
                continue
            if antes_de_regex():
                j, dentro_clase = i + 1, False
                while j < n and src[j] != LF:
                    if src[j] == '\\':
                        j += 2
                        continue
                    if src[j] == '[':
                        dentro_clase = True
                    elif src[j] == ']':
                        dentro_clase = False
                    elif src[j] == '/' and not dentro_clase:
                        break
                    j += 1
                i = j + 1
                # las banderas que van pegadas al cierre (/.../gi) no son codigo:
                # sin comerselas, la `i` de /.../i.test() parece una variable
                while i < n and src[i] in 'dgimsuvy':
                    i += 1
                salida.append(' 0 ')
                continue
        # cadenas normales
        if c in '"\'':
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == c or src[j] == LF:
                    break
                j += 1
            i = j + 1
            salida.append(' "" ')
            continue
        # plantillas
        if c == '`':
            salida.append(' "" ')
            i, _ = saltar_plantilla(src, i + 1, salida, plantillas)
            continue
        salida.append(c)
        i += 1
    return ''.join(salida)


def saltar_plantilla(src, i, salida, plantillas):
    """Come el texto de una plantilla hasta el ` que la cierra o un ${."""
    n = len(src)
    while i < n:
        if src[i] == '\\':
            i += 2
            continue
        if src[i] == '`':
            return i + 1, True
        if src[i] == '$' and i + 1 < n and src[i + 1] == '{':
            plantillas.append(0)      # de aqui en adelante vuelve a ser codigo
            salida.append(' ')
            return i + 2, False
        i += 1
    return i, True


def libres(cuerpo):
    limpio = solo_codigo(cuerpo)

    definidos = set()
    definidos |= set(re.findall(r'(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)', limpio))
    # declaraciones con varios nombres: const a = 1, b = 2
    for grupo in re.findall(r'(?:const|let|var)\s+([^;\n]*)', limpio):
        for trozo in grupo.split(','):
            m = re.match(r'\s*([A-Za-z_$][\w$]*)\s*(?:=|$)', trozo)
            if m:
                definidos.add(m.group(1))
    # desestructuracion
    for grupo in re.findall(r'(?:const|let|var)\s*[\{\[]([^\}\]]*)[\}\]]\s*=', limpio):
        definidos |= set(re.findall(r'[A-Za-z_$][\w$]*', grupo))
    # parametros de funciones y de flechas
    for p in re.findall(r'\(([^()]*)\)\s*=>', limpio) + re.findall(r'function[^(]*\(([^()]*)\)', limpio):
        definidos |= set(re.findall(r'[A-Za-z_$][\w$]*', p))
    definidos |= set(re.findall(r'(?:catch|for)\s*\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)', limpio))
    definidos |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*=>', limpio))
    definidos |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function|\()', limpio))
    definidos |= set(re.findall(r'(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{', limpio))

    GLOBALES = set('''window document console Math JSON Date Number String Boolean Array Object Promise Set Map
     WeakMap WeakSet RegExp Error TypeError parseInt parseFloat isNaN isFinite setTimeout setInterval clearTimeout
     clearInterval alert confirm prompt fetch localStorage sessionStorage navigator location history URL URLSearchParams
     Blob FileReader File FormData Intl encodeURIComponent decodeURIComponent atob btoa undefined NaN Infinity
     globalThis Symbol Proxy Reflect BigInt
     if else for while do switch case break continue new typeof instanceof in of delete void try catch finally throw
     class extends super function const let var return default export import yield static get set from as await async
     this arguments true false null with debugger
     lucide supabase Image Event CustomEvent HTMLElement Node NodeList Element MutationObserver IntersectionObserver
     requestAnimationFrame cancelAnimationFrame structuredClone AbortController TextEncoder TextDecoder Uint8Array
     Uint8ClampedArray ArrayBuffer DataView crypto performance XMLHttpRequest MouseEvent KeyboardEvent Audio
     ResizeObserver DOMParser XMLSerializer Option Range NodeFilter caches getComputedStyle'''.split())

    usados = set(re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?=[\(\.\[])', limpio))
    return sorted(u for u in usados if u not in definidos and u not in GLOBALES)


if __name__ == '__main__':
    a, b = int(sys.argv[1]), int(sys.argv[2])
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ruta = sys.argv[3] if len(sys.argv) > 3 else os.path.join(raiz, 'assets', 'app.js')
    src = io.open(ruta, encoding='utf-8').read().split(LF)
    r = libres(LF.join(src[a - 1:b]))
    print('Lineas %d-%d · identificadores libres (%d): %s' % (a, b, len(r), ', '.join(r) or 'ninguno'))
