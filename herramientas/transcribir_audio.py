# -*- coding: utf-8 -*-
"""
Transcribe un audio a texto EN ESTA MAQUINA. No sube nada a ningun servicio.

POR QUE LOCAL
  Son grabaciones de reuniones y eventos con voces de colegas
  identificables. Subirlas a un servicio externo es publicarlas, y esa no
  es una decision que se toma de paso.

  Usa faster-whisper, que es el Whisper de OpenAI corriendo aqui. Trae su
  propio decodificador de audio (PyAV), asi que no hace falta ffmpeg y lee
  aac, m4a, mp3, ogg, opus (las notas de voz de WhatsApp), wav y mp4.

POR QUE VA POR BLOQUES
  Si se le entrega el archivo completo, la libreria calcula el
  espectrograma de TODO antes de empezar —para dos horas y media pedia
  2,7 GB— y se queda sin memoria. Aqui el audio se decodifica y se
  transcribe de a bloques de diez minutos, asi que da igual que la
  grabacion dure dos horas o seis.

  El corte entre bloques no cae en cualquier parte: se busca el momento
  mas silencioso de los ultimos veinte segundos y se corta ahi, para no
  partir una palabra por la mitad.

CUANTO TARDA
  En este equipo (4 nucleos) el modelo `small` va a mas o menos el doble
  de tiempo real: dos horas y media de grabacion, alrededor de una hora y
  cuarto. `medium` entiende mejor los nombres propios y los terminos
  tecnicos pero tarda el triple: conviene arrancar con `small` y, si un
  tramo importante quedo confuso, repetir SOLO ese tramo con --desde y
  --hasta.

QUE DEJA
  Dos archivos junto al audio, que se van escribiendo en cada bloque: si
  esto se interrumpe, lo transcrito hasta ahi no se pierde.
    · <nombre>.txt          texto corrido, para leer
    · <nombre>.marcas.txt   con [hh:mm:ss] por parrafo, para poder citar
                            el minuto exacto de lo que se dijo

USO
  python transcribir_audio.py "C:\\ruta\\evento.aac"
  python transcribir_audio.py "...\\evento.aac" --desde 01:50:00 --hasta 02:20:00
  python transcribir_audio.py "...\\evento.aac" --modelo medium
  python transcribir_audio.py "...\\evento.aac" --sin-vad
"""
import argparse
import os
import sys
import time

TASA = 16000            # lo que espera Whisper
BLOQUE_MIN = 10         # minutos por bloque
BUSCAR_SILENCIO_S = 20  # margen final donde se busca el corte


def hms(segundos):
    s = int(segundos)
    return '%02d:%02d:%02d' % (s // 3600, (s % 3600) // 60, s % 60)


def a_segundos(txt):
    """'01:50:00' o '50:00' o '3000' -> segundos."""
    if not txt:
        return None
    total = 0.0
    for p in str(txt).split(':'):
        total = total * 60 + float(p)
    return total


def corte_en_silencio(x, desde_muestra):
    """Indice donde conviene cortar: el tramo mas callado del final.

    Se mira en ventanas de 200 ms y se elige la de menor energia. Cortar en
    una pausa evita partir una palabra y que el modelo la escriba mal a los
    dos lados del corte.
    """
    import numpy as np
    ventana = int(0.2 * TASA)
    mejor, mejor_v = len(x), None
    i = max(desde_muestra, 0)
    while i + ventana <= len(x):
        v = float(np.abs(x[i:i + ventana]).mean())
        if mejor_v is None or v < mejor_v:
            mejor_v, mejor = v, i + ventana // 2
        i += ventana
    return mejor


def bloques(ruta, desde=None, hasta=None):
    """Genera (offset_en_segundos, muestras) sin cargar el archivo entero."""
    import av
    import numpy as np

    contenedor = av.open(ruta)
    stream = contenedor.streams.audio[0]
    if desde:
        contenedor.seek(int(desde * av.time_base))

    remuestreador = av.audio.resampler.AudioResampler(
        format='s16', layout='mono', rate=TASA)

    largo = int(BLOQUE_MIN * 60 * TASA)
    margen = int(BUSCAR_SILENCIO_S * TASA)
    pendiente = np.zeros(0, dtype=np.float32)
    offset = None

    def convertir(marco):
        return marco.to_ndarray().flatten().astype(np.float32) / 32768.0

    for marco in contenedor.decode(stream):
        t = float(marco.pts * marco.time_base) if marco.pts is not None else None
        if t is not None:
            if desde and t + 1 < desde:
                continue
            if hasta and t > hasta:
                break
        if offset is None:
            offset = t if t is not None else float(desde or 0)
        for m2 in remuestreador.resample(marco):
            pendiente = np.concatenate([pendiente, convertir(m2)])
        while len(pendiente) >= largo:
            corte = corte_en_silencio(pendiente[:largo], largo - margen)
            yield offset, pendiente[:corte]
            offset += corte / float(TASA)
            pendiente = pendiente[corte:]

    for m2 in (remuestreador.resample(None) or []):
        pendiente = np.concatenate([pendiente, convertir(m2)])
    if len(pendiente):
        yield (offset if offset is not None else float(desde or 0)), pendiente
    contenedor.close()


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('audio')
    ap.add_argument('--modelo', default='small',
                    help='tiny, base, small (por defecto), medium, large-v3')
    ap.add_argument('--idioma', default='es')
    ap.add_argument('--desde', default=None, help='hh:mm:ss')
    ap.add_argument('--hasta', default=None, help='hh:mm:ss')
    ap.add_argument('--sin-vad', action='store_true', dest='sin_vad',
                    help='no filtrar silencios (grabaciones de sala con nivel bajo)')
    a = ap.parse_args()

    if not os.path.exists(a.audio):
        sys.exit('No esta el archivo: %s' % a.audio)

    import av
    from faster_whisper import WhisperModel

    desde, hasta = a_segundos(a.desde), a_segundos(a.hasta)

    base = os.path.splitext(a.audio)[0]
    sufijo = ''
    if a.desde or a.hasta:
        sufijo = (' (%s-%s)' % (a.desde or 'inicio', a.hasta or 'fin')).replace(':', '')
    salida_txt = base + sufijo + '.txt'
    salida_marcas = base + sufijo + '.marcas.txt'

    c = av.open(a.audio)
    dur_total = c.duration / av.time_base if c.duration else 0
    c.close()
    dur = (min(hasta, dur_total) if hasta else dur_total) - (desde or 0)

    print('audio  : %s  (%.0f MB, %s)'
          % (os.path.basename(a.audio), os.path.getsize(a.audio) / 1048576.0, hms(dur_total)))
    print('tramo  : %s -> %s   (%s de audio)'
          % (hms(desde or 0), hms(hasta or dur_total), hms(dur)))
    print('modelo : %s   idioma: %s%s' % (a.modelo, a.idioma, '   sin VAD' if a.sin_vad else ''))
    print('cargando el modelo (la primera vez lo descarga)...')

    # int8 en CPU: es lo que hace esto viable en un equipo sin tarjeta grafica.
    modelo = WhisperModel(a.modelo, device='cpu', compute_type='int8',
                          cpu_threads=os.cpu_count() or 4)

    opciones = dict(language=a.idioma, beam_size=5)
    # El VAD salta los silencios y ahorra tiempo, pero en una grabacion de
    # sala con el nivel bajo puede tragarse la voz entera y devolver un
    # archivo vacio. Para ese caso esta --sin-vad.
    if not a.sin_vad:
        opciones['vad_filter'] = True
        opciones['vad_parameters'] = {'min_silence_duration_ms': 700}

    print('transcribiendo por bloques de %d minutos...\n' % BLOQUE_MIN)
    t0 = time.time()
    corrido, marcas = [], []

    for offset, muestras in bloques(a.audio, desde, hasta):
        segmentos, _ = modelo.transcribe(muestras, **opciones)
        for s in segmentos:
            texto = s.text.strip()
            if not texto:
                continue
            corrido.append(texto)
            marcas.append('[%s] %s' % (hms(offset + s.start), texto))
        fin = offset + len(muestras) / float(TASA)
        hecho = (fin - (desde or 0)) / dur if dur else 0
        transcurrido = time.time() - t0
        falta = (transcurrido / hecho - transcurrido) if hecho > 0.02 else 0
        print('  %s  (%.0f%%)  transcurrido %s   faltan ~%s   [%d parrafos]'
              % (hms(fin), hecho * 100, hms(transcurrido), hms(falta), len(corrido)))
        # Se guarda en cada bloque: una interrupcion no borra lo ya hecho.
        with open(salida_txt, 'w', encoding='utf-8') as f:
            f.write(' '.join(corrido))
        with open(salida_marcas, 'w', encoding='utf-8') as f:
            f.write('\n'.join(marcas))

    if not corrido:
        print('')
        print('No se reconocio voz en el audio. Puede ser por dos motivos:')
        print('  - el nivel de la grabacion es muy bajo y el filtro de silencios')
        print('    se la comio  ->  repetir con --sin-vad')
        print('  - el archivo no tiene habla (musica, ruido, o no es el que era)')
        return 1

    print('\nlisto en %s' % hms(time.time() - t0))
    print('  %s' % salida_txt)
    print('  %s' % salida_marcas)
    print('  %d parrafos, %d palabras' % (len(corrido), len(' '.join(corrido).split())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
