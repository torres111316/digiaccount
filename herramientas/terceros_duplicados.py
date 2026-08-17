# -*- coding: utf-8 -*-
"""
Deja un solo tercero donde había varios, y hace que las facturas lo sigan.

POR QUÉ NO SE PIERDE NINGUNA FACTURA
  Ninguna tabla apunta a `terceros.id`. El libro fiscal, las retenciones y
  los movimientos de tesorería guardan el tercero como TEXTO, en sus
  columnas `tercero_rif` y `tercero_nombre`. Así que borrar una fila
  repetida de `terceros` no desconecta nada: la factura no la miraba.

  Pero cuando se unen DOS RIF distintos sí hay que mover las facturas, o
  quedarían nombrando un RIF que ya no existe en el directorio. Eso es lo
  que hace `repuntar()`, y después se cuenta: las filas que nombraban a los
  dos RIF tienen que ser exactamente las que nombran al que quedó. Si el
  número no cuadra, el programa se detiene sin seguir con el resto.

LOS TRES CASOS, QUE NO SON IGUALES
  1. MISMO RIF, VARIAS FILAS. La importación por Telegram insertó ELITE UET
     SUPPLY cinco veces en la misma décima de segundo. Se borran las de
     sobra y ya: no hay nada que mover.

  2. EL MISMO NÚMERO ESCRITO DE DOS FORMAS. `V9339055` y `V09339055` son la
     misma cédula, con y sin el cero de adelante. Se queda la de ocho
     dígitos, que es la cédula completa.

  3. UN DÍGITO VERIFICADOR IMPOSIBLE. De `J503431253` y `J543431253`, uno de
     los dos no puede existir: la cuenta del verificador no da. Se queda el
     que cuadra. En FRIGOCARNES el bueno tiene 39 facturas y el malo 1, así
     que la frecuencia dice lo mismo que la aritmética.

LO QUE NO SE TOCA, A PROPÓSITO
  Dos cédulas distintas bajo el mismo nombre. `JUAN SANCHEZ V14438348` y
  `JUAN SANCHEZ V14998630` se diferencian en cinco dígitos: eso no es un
  duplicado, son dos personas con un nombre común. Y una cédula no lleva
  dígito verificador, así que no hay con qué decidir ni cuando se
  diferencian en uno. Unirlas mudaría las facturas de una persona a la
  cuenta de otra. Se listan al final para revisarlas a mano.

USO
  python terceros_duplicados.py --cuenta <uuid|correo>
  Agregar --cargar cuando el ensayo se vea bien.
"""
import argparse
import os
import sys
import unicodedata

from cargar_libros import api, norm_rif
from terceros_desde_libros import cuadra, digito, todas

# Donde el tercero quedó copiado como texto. Si alguna de estas tablas pasa
# algún día a guardar `tercero_id`, hay que repuntar ese id también y este
# programa deja de estar completo.
USAN_EL_RIF = ('libro_fiscal', 'retenciones', 'movimientos_tesoreria')

# Datos que se rescatan de la copia que se va, si al que queda le faltan.
RESCATABLES = ('domicilio', 'telefono', 'email', 'condicion_fiscal', 'tipo_persona')


def plano(nombre):
    """Nombre comparable: sin acentos, sin puntuación y sin la forma jurídica."""
    t = unicodedata.normalize('NFKD', str(nombre or '').upper())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = ''.join(c if c.isalnum() else ' ' for c in t)
    return ' '.join(p for p in t.split() if p not in ('CA', 'SA', 'FP', 'SRL', 'C', 'A', 'S'))


def solo_digitos(r):
    return ''.join(c for c in r if c.isdigit())


def cuantas(rif, token):
    """Filas que nombran ese RIF en cada tabla que lo copia como texto."""
    return {t: len(api('%s?tercero_rif=eq.%s&select=tercero_rif' % (t, rif), token))
            for t in USAN_EL_RIF}


def repuntar(malo, bueno, nombre, token):
    """Manda las facturas del RIF que se va al que se queda."""
    for t in USAN_EL_RIF:
        api('%s?tercero_rif=eq.%s' % (t, malo), token, 'PATCH',
            {'tercero_rif': bueno, 'tercero_nombre': nombre}, prefer='return=minimal')


def unir(queda, sobran):
    """Roles y datos de las copias que se van, para no perder nada al borrar."""
    p = {}
    for campo in ('es_cliente', 'es_proveedor', 'agente_retencion'):
        if not queda.get(campo) and any(s.get(campo) for s in sobran):
            p[campo] = True
    for campo in RESCATABLES:
        if not str(queda.get(campo) or '').strip():
            traido = next((str(s.get(campo)).strip() for s in sobran
                           if str(s.get(campo) or '').strip()), None)
            if traido:
                p[campo] = traido
    return p


def distancia(a, b):
    """Cuántos cambios de un dígito separan a dos números.

    Cuenta sustituir, meter y quitar un dígito. Sirve para distinguir un
    tipeo de dos personas distintas: `V12551728` y `V12554728` están a 1;
    `V14438348` y `V14998630`, a 5. Una transposición sale 2, que es lo que
    corresponde: `V21726456` y `V21756426` es el mismo Danny Naranjo con dos
    dígitos bailados.
    """
    if a == b:
        return 0
    ant = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        act = [i]
        for j, cb in enumerate(b, 1):
            act.append(min(ant[j] + 1, act[j - 1] + 1, ant[j - 1] + (ca != cb)))
        ant = act
    return ant[-1]


# Hasta dos dígitos de diferencia se toma por tipeo del mismo tercero; de
# tres en adelante, se dejan separados. El corte lo puso Luis: los que se
# diferencian en todo el RIF «es probable que sean personas distintas».
TOPE = 2


def decidir(copias, veces):
    """Cuál se queda de un grupo con el mismo nombre y RIF distinto.

    `veces` dice cuántas filas de libro nombran cada RIF. Devuelve
    (queda, sobran, motivo, dudosos) — `dudosos` son los del grupo que se
    dejan como están porque su RIF se diferencia demasiado.

    El que se queda se elige en este orden:
      1. el único cuyo dígito verificador cuadra — es aritmética, no opinión;
      2. si no hay verificador que valga (las cédulas no lo traen), el que
         más facturas tiene, que es el que se ha venido usando;
      3. a igualdad, el que trae el RIF más largo.
    """
    rifs = sorted(set(norm_rif(t.get('rif')) for t in copias if (t.get('rif') or '').strip()))
    if len(rifs) < 2:
        return None

    # Un RIF a medio escribir nunca puede ser el que se queda, y tampoco se
    # puede fusionar por RIF: el mismo 'V' pelado lo comparten terceros
    # distintos —hay una factura de Edgar Aguero y otra de Antonio García,
    # las dos con RIF 'V'—, así que repuntar por RIF le pasaría la factura de
    # uno al otro. Esos se resuelven por NOMBRE, en `rellenar_por_nombre()`.
    enteros = [r for r in rifs if len(solo_digitos(r)) >= 7]
    if len(enteros) < 2:
        return None

    completos = [r for r in enteros if digito(r) is not None]
    buenos = [r for r in completos if cuadra(r)]
    if len(completos) == len(enteros) and len(buenos) == 1:
        ancla, motivo = buenos[0], 'el único con el verificador bueno'
    else:
        ancla = max(enteros, key=lambda r: (veces.get(r, 0), len(solo_digitos(r))))
        motivo = 'el que tiene más facturas'

    na = solo_digitos(ancla)
    juntar, dudosos, porques = [], [], []
    for r in enteros:
        if r == ancla:
            continue
        n = solo_digitos(r)
        if n.lstrip('0') == na.lstrip('0'):
            juntar.append(r)
            porques.append('%s es el mismo número sin el cero de adelante' % r)
        elif r[:1] != ancla[:1] and n == na:
            # Mismos dígitos y otra letra: una C.A. no puede ser V.
            juntar.append(r)
            porques.append('%s tiene los mismos dígitos con otra letra' % r)
        elif distancia(n, na) <= TOPE:
            juntar.append(r)
            porques.append('%s está a %d dígito(s)' % (r, distancia(n, na)))
        else:
            dudosos.append(r)

    if not juntar:
        return None
    queda = next(t for t in copias if norm_rif(t.get('rif')) == ancla)
    sobran = [t for t in copias if norm_rif(t.get('rif')) in juntar]
    resto = [t for t in copias if norm_rif(t.get('rif')) in dudosos]
    return queda, sobran, '%s; %s' % (motivo, ' · '.join(porques)), resto


def aplicar(queda, sobran, motivo, token, cargar):
    """Imprime el caso y, con --cargar, lo ejecuta y lo comprueba."""
    rif_q = norm_rif(queda['rif']) if (queda.get('rif') or '').strip() else ''
    otros = [norm_rif(s['rif']) for s in sobran if (s.get('rif') or '').strip()]
    mover = sorted(set(r for r in otros if r and r != rif_q))

    print('%-12s %s' % (rif_q, queda['nombre']))
    if motivo:
        print('   por qué:  %s' % motivo)
    for s in sobran:
        print('   se borra  %-12s %s' % (norm_rif(s.get('rif')), (s.get('nombre') or '')[:40]))

    antes = {r: cuantas(r, token) for r in [rif_q] + mover}
    for r, c in antes.items():
        print('   nombran a %-12s %s' % (r, ', '.join('%s %d' % kv for kv in c.items())))
    if not cargar:
        print('')
        return

    parche = unir(queda, sobran)
    if parche:
        api('terceros?id=eq.%s' % queda['id'], token, 'PATCH', parche, prefer='return=minimal')
        print('   se le pasa: %s' % ', '.join('%s=%r' % kv for kv in sorted(parche.items())))
    for r in mover:
        repuntar(r, rif_q, queda['nombre'], token)
    for s in sobran:
        api('terceros?id=eq.%s' % s['id'], token, 'DELETE', prefer='return=minimal')

    # La comprobación que pidió Luis: que la factura siga hallando su tercero.
    for tabla in USAN_EL_RIF:
        esperado = sum(antes[r][tabla] for r in antes)
        real = cuantas(rif_q, token)[tabla]
        if real != esperado:
            sys.exit('   PARADO en %s: esperaba %d filas nombrando %s y hay %d'
                     % (tabla, esperado, rif_q, real))
    for r in mover:
        if any(cuantas(r, token).values()):
            sys.exit('   PARADO: quedaron filas nombrando el RIF viejo %s' % r)
        if api('terceros?rif=eq.%s&select=id' % r, token):
            sys.exit('   PARADO: el tercero %s no se borró' % r)
    quedan = api('terceros?rif=eq.%s&select=id,rif' % rif_q, token)
    if len(quedan) != 1:
        sys.exit('   PARADO: quedaron %d terceros con el RIF %s' % (len(quedan), rif_q))
    print('   bien: 1 tercero, %s' % ', '.join('%s %d' % kv for kv in cuantas(rif_q, token).items()))
    print('')


def parecidos_que_el_verificador_separa(d, veces):
    """El mismo tercero con el nombre escrito distinto y un RIF imposible.

    'COVENCAUCHO IN, S.A.' y 'COVENCAUCHO INDUSTRIAS, S.A.' no colapsan al
    mismo nombre, así que el pase anterior no las ve. Aquí se emparejan por
    la primera palabra y un RIF a dos dígitos o menos — pero SOLO se fusionan
    si el verificador descarta uno de los dos.

    Ese último requisito es el que hace segura la regla. Sin él, 'ANA JULIA
    PAEZ' (V16822699), 'ANA LOPEZ' (V16823695) y 'ANA PERALTA' (V16822695)
    también calzan: misma primera palabra y cédulas a dos dígitos. Son tres
    personas distintas. Una cédula no trae verificador, así que ninguna de
    las tres entra — y las empresas, que sí lo traen, se resuelven solas.
    """
    pares, vistos = [], set()
    for i, a in enumerate(d):
        for b in d[i + 1:]:
            pa, pb = plano(a['nombre']), plano(b['nombre'])
            if pa == pb or not pa or not pb or pa.split()[0] != pb.split()[0]:
                continue
            ra, rb = norm_rif(a['rif']), norm_rif(b['rif'])
            if digito(ra) is None or digito(rb) is None:
                continue
            if distancia(solo_digitos(ra), solo_digitos(rb)) > TOPE:
                continue
            buenos = [r for r in (ra, rb) if cuadra(r)]
            if len(buenos) != 1 or tuple(sorted((ra, rb))) in vistos:
                continue
            vistos.add(tuple(sorted((ra, rb))))
            queda, sobra = (a, b) if norm_rif(a['rif']) == buenos[0] else (b, a)
            pares.append((queda, [sobra],
                          'el verificador de %s no da, y el nombre es el mismo escrito distinto'
                          % norm_rif(sobra['rif'])))
    return pares


def facturas_con_rif_fantasma(cta, token, cargar):
    """Facturas que nombran un RIF que no existe en el directorio.

    Es el caso de MAFERCA: el libro de Radian la anotó como J-29900403-6 en
    una factura y J-29901403-6 en la siguiente. Solo el segundo se dio de
    alta, porque el primero no puede existir. Aquí se manda la factura al
    tercero bueno: mismo nombre, un dígito de diferencia.

    Se exige el nombre igual Y el RIF a dos dígitos o menos. Con uno solo de
    los dos no alcanza: hay proveedores con RIF vecinos y hay homónimos.
    """
    d = [t for t in todas('terceros?cuenta_id=eq.%s&select=id,nombre,rif' % cta['id'], token)
         if (t.get('rif') or '').strip()]
    conocidos = set(norm_rif(t['rif']) for t in d)
    emps = [e['id'] for e in api('empresas?cuenta_id=eq.%s&select=id' % cta['id'], token)]

    hechas, huerfanas = [], []
    for tabla in USAN_EL_RIF:
        # Sin `periodo`: movimientos_tesoreria no la tiene, se lleva por fecha.
        for r in todas('%s?empresa_id=in.(%s)&select=id,tercero_rif,tercero_nombre'
                       % (tabla, ','.join(emps)), token):
            rif = norm_rif(r.get('tercero_rif'))
            if not rif or rif in conocidos or len(solo_digitos(rif)) < 7:
                continue
            cand = [t for t in d
                    if plano(t['nombre']) == plano(r.get('tercero_nombre'))
                    and distancia(solo_digitos(norm_rif(t['rif'])), solo_digitos(rif)) <= TOPE]
            if len(cand) != 1:
                huerfanas.append((tabla, r, cand))
                continue
            t = cand[0]
            if cargar:
                api('%s?id=eq.%s' % (tabla, r['id']), token, 'PATCH',
                    {'tercero_rif': norm_rif(t['rif']), 'tercero_nombre': t['nombre']},
                    prefer='return=minimal')
            hechas.append((tabla, r, t))

    print('--- FILAS QUE NOMBRABAN UN RIF INEXISTENTE (%d) ---\n' % len(hechas))
    for tabla, r, t in hechas:
        print('   %-22s %-11s -> %-11s %s'
              % (tabla, norm_rif(r['tercero_rif']), norm_rif(t['rif']),
                 t['nombre'][:30]))
    print('')
    if huerfanas:
        print('--- RIF INEXISTENTE Y SIN A QUIÉN MANDARLO (%d) ---\n' % len(huerfanas))
        for tabla, r, cand in huerfanas:
            print('   %-22s %-11s %-30s candidatos: %d'
                  % (tabla, norm_rif(r['tercero_rif']),
                     (r['tercero_nombre'] or '')[:30], len(cand)))
        print('')


def incompleta(r):
    """Factura a la que le falta el tercero.

    Los reportes Z quedan fuera: un Z es el resumen de un día de ventas por
    máquina fiscal y NO lleva tercero. Contarlos como huecos son 240 falsas
    alarmas que tapan las 17 de verdad.
    """
    if (r.get('numero_zeta') or '').strip():
        return False
    if (r.get('tercero_nombre') or '').upper() == 'ANULADA':
        return False
    return (not (r.get('tercero_nombre') or '').strip()
            or len(solo_digitos(norm_rif(r.get('tercero_rif')))) < 7)


def rellenar_por_nombre(cta, token, cargar):
    """Le pone el RIF del directorio a la factura que solo trae el nombre.

    Se hace POR NOMBRE y solo cuando en el directorio hay UN tercero con ese
    nombre exacto. Si hay dos, no se toca: son las dos personas que se
    dejaron separadas justamente porque no se sabe cuál es.
    """
    d = todas('terceros?cuenta_id=eq.%s&select=id,nombre,rif' % cta['id'], token)
    por_nombre = {}
    for t in d:
        if len(solo_digitos(norm_rif(t.get('rif')))) >= 7:
            por_nombre.setdefault(plano(t['nombre']), []).append(t)

    lib = todas('libro_fiscal?empresa_id=in.(%s)&select=id,periodo,tipo,numero_factura,'
                'numero_zeta,tercero_rif,tercero_nombre'
                % ','.join(e['id'] for e in api('empresas?cuenta_id=eq.%s&select=id' % cta['id'],
                                                token)), token)
    hechas, sin_dato, ambiguas = [], [], []
    for r in lib:
        if not incompleta(r):
            continue
        cand = por_nombre.get(plano(r.get('tercero_nombre')), [])
        if not (r.get('tercero_nombre') or '').strip() or not cand:
            sin_dato.append(r)
        elif len(cand) > 1:
            ambiguas.append((r, cand))
        else:
            t = cand[0]
            if cargar:
                api('libro_fiscal?id=eq.%s' % r['id'], token, 'PATCH',
                    {'tercero_rif': norm_rif(t['rif']), 'tercero_nombre': t['nombre']},
                    prefer='return=minimal')
            hechas.append((r, t))

    print('--- FACTURAS A LAS QUE SE LES PONE EL RIF DEL DIRECTORIO (%d) ---\n' % len(hechas))
    for r, t in hechas:
        print('   %-9s %-8s %-22s %r -> %-11s %s'
              % (r['periodo'], r['numero_factura'] or '', (r['tercero_nombre'] or '')[:22],
                 r['tercero_rif'], norm_rif(t['rif']), t['nombre'][:24]))
    print('')
    if ambiguas:
        print('--- NO SE LES PONE: HAY DOS TERCEROS CON ESE NOMBRE (%d) ---\n' % len(ambiguas))
        for r, cand in ambiguas:
            print('   %-9s %-8s %-22s  candidatos: %s'
                  % (r['periodo'], r['numero_factura'] or '', (r['tercero_nombre'] or '')[:22],
                     ' '.join(norm_rif(c['rif']) for c in cand)))
        print('')
    return sin_dato


def main():
    ap = argparse.ArgumentParser(description='Deja un solo tercero y repunta las facturas.')
    ap.add_argument('--cuenta', required=True, help='uuid de la cuenta, o el correo de contacto')
    ap.add_argument('--cargar', action='store_true')
    args = ap.parse_args()

    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token. PowerShell:  $env:DA_TOKEN=\'...\'')

    cuentas = api('cuentas?select=id,nombre,email_contacto', token)
    cta = next((c for c in cuentas if c['id'] == args.cuenta
                or (c.get('email_contacto') or '').lower() == args.cuenta.lower()), None)
    if not cta:
        print('Cuentas disponibles:')
        for c in cuentas:
            print('   %-38s %s' % (c['nombre'], c['id']))
        sys.exit('\nNo se encontró la cuenta "%s"' % args.cuenta)

    d = todas('terceros?cuenta_id=eq.%s&select=*' % cta['id'], token)
    print('\n%s\n  %s · %d terceros\n%s\n' % ('=' * 72, cta['nombre'], len(d), '=' * 72))

    # ---- 1. Mismo RIF, varias filas -------------------------------------
    mismo = {}
    for t in d:
        if (t.get('rif') or '').strip():
            mismo.setdefault(norm_rif(t['rif']), []).append(t)
    mismo = {k: sorted(v, key=lambda x: x.get('creado_en') or '')
             for k, v in mismo.items() if len(v) > 1}
    print('--- EL MISMO RIF, REPETIDO (%d) ---\n' % len(mismo))
    for rif, copias in sorted(mismo.items()):
        aplicar(copias[0], copias[1:], 'la misma fila cargada %d veces' % len(copias),
                token, args.cargar)

    # ---- 2 y 3. Mismo nombre, RIF distinto ------------------------------
    d = todas('terceros?cuenta_id=eq.%s&select=*' % cta['id'], token)   # ya sin los borrados
    grupos = {}
    for t in d:
        if (t.get('nombre') or '').strip():
            grupos.setdefault(plano(t['nombre']), []).append(t)
    grupos = {k: v for k, v in grupos.items()
              if len(set(norm_rif(x.get('rif')) for x in v)) > 1}

    # Cuántas facturas tiene cada RIF: es lo que decide cuando el
    # verificador no puede (las cédulas no lo traen).
    veces = {}
    for copias in grupos.values():
        for t in copias:
            r = norm_rif(t.get('rif'))
            if r and r not in veces:
                veces[r] = cuantas(r, token)['libro_fiscal']

    decididos, a_mano = [], []
    for k, copias in sorted(grupos.items()):
        r = decidir(copias, veces)
        if r:
            decididos.append((k, r))
            if r[3]:
                a_mano.append((k, r[3]))
        else:
            a_mano.append((k, copias))

    print('--- MISMO NOMBRE, SE PUEDE DECIDIR CUÁL RIF ES (%d) ---\n' % len(decididos))
    for k, (queda, sobran, motivo, _) in decididos:
        aplicar(queda, sobran, motivo, token, args.cargar)

    print('--- SE DEJAN SEPARADOS: PROBABLEMENTE NO SON LA MISMA PERSONA (%d) ---' % len(a_mano))
    print('    Se diferencian en más de %d dígitos. Una cédula no trae' % TOPE)
    print('    verificador, así que aquí no hay con qué decidir: dos personas')
    print('    con el mismo nombre corriente tienen cada una su registro.\n')
    for k, copias in a_mano:
        for t in sorted(copias, key=lambda x: norm_rif(x.get('rif'))):
            rif = norm_rif(t.get('rif'))
            c = cuantas(rif, token) if rif else {}
            print('   %-12s %-40s %s' % (rif, (t.get('nombre') or '')[:40],
                                         ', '.join('%s %d' % kv for kv in c.items() if kv[1])))
        print('')

    # ---- 4. El nombre escrito distinto, y el verificador decide -----------
    d = [t for t in todas('terceros?cuenta_id=eq.%s&select=*' % cta['id'], token)
         if (t.get('rif') or '').strip()]
    pares = parecidos_que_el_verificador_separa(d, veces)
    print('--- NOMBRE ESCRITO DISTINTO, EL VERIFICADOR DECIDE (%d) ---\n' % len(pares))
    for queda, sobran, motivo in pares:
        aplicar(queda, sobran, motivo, token, args.cargar)

    # ---- 5. Facturas que nombran un RIF que no está en el directorio ------
    facturas_con_rif_fantasma(cta, token, args.cargar)

    # Ya sin duplicados, se le pone el RIF a la factura que solo trae nombre.
    sin = rellenar_por_nombre(cta, token, args.cargar)

    # Lo que queda no se arregla desde aquí: hay que conseguir el dato.
    print('--- SIGUEN SIN TERCERO, HAY QUE CONSEGUIR EL DATO (%d) ---\n' % len(sin))
    for r in sin:
        print('   %-9s %-7s %-9s %-11s %s'
              % (r['periodo'], r['tipo'], r['numero_factura'] or '',
                 r['tercero_rif'] or '(vacío)', (r['tercero_nombre'] or '(vacío)')[:30]))
    print('')

    # Un tercero con el RIF a medio escribir que ya nadie usa no debe quedar
    # en el desplegable: se elegiría y volvería a ensuciar una factura.
    for t in todas('terceros?cuenta_id=eq.%s&select=id,nombre,rif' % cta['id'], token):
        if (t.get('rif') or '').strip() and len(solo_digitos(norm_rif(t['rif']))) < 7:
            usos = cuantas(norm_rif(t['rif']), token)
            print('TERCERO CON EL RIF A MEDIO ESCRIBIR: %r %s · lo nombran %s'
                  % (t['rif'], t['nombre'], ', '.join('%s %d' % kv for kv in usos.items())))
            if args.cargar and not any(usos.values()):
                api('terceros?id=eq.%s' % t['id'], token, 'DELETE', prefer='return=minimal')
                print('   ya no lo usa nadie: borrado.')
            print('')

    if not args.cargar and (mismo or decididos):
        print('Ensayo: no se borró ni se movió nada. Agrega --cargar para hacerlo.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())

