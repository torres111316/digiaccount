"""Verifica EN VIVO el motor contable del libro fiscal (sql/contabilidad_04_motor.sql).

POR QUÉ: las pruebas de sql/pruebas/ corren en un espejo del esquema
(PGlite). Esto comprueba lo mismo en la base de verdad, después de que Luis
corre los SQL en Supabase: que cada fila del libro tenga su asiento, que
editarla lo cambie sin duplicarlo, y que anularla o borrarla lo quite.

Trabaja en la empresa «DigiAccount» (la del fundador, sin libro fiscal), con
facturas marcadas PRUEBA-MOTOR, y las borra al final pase lo que pase.

EL TOKEN NO VA EN LA LÍNEA DE COMANDOS: va en la variable de entorno DA_TOKEN.

USO
  python herramientas/verificar_motor_contable.py
Termina con «TODO OK» o con «FALLA: ...» (código de salida 1).
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = 'https://esnicjnuymqgktqoueyq.supabase.co/rest/v1/'
MARCA = 'PRUEBA-MOTOR'


def api(ruta, token, metodo='GET', cuerpo=None, prefer=None):
    cab = {'apikey': token, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    if prefer:
        cab['Prefer'] = prefer
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(BASE + ruta, data=datos, headers=cab, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        raise RuntimeError('%s %s → %s %s' % (metodo, ruta.split('?')[0], e.code, e.read().decode()[:300]))


def falla(msg):
    print('FALLA: ' + msg)
    raise SystemExit(1)


def cuadra(asiento):
    d = sum(float(l.get('debe') or 0) for l in asiento['lineas'])
    h = sum(float(l.get('haber') or 0) for l in asiento['lineas'])
    return abs(d - h) < 0.005


def asientos_de(token, ids):
    return api('asientos?origen_tabla=eq.libro_fiscal&origen_id=in.(%s)&select=*' % ','.join(ids), token)


def main():
    # La consola de Windows no es UTF-8 por defecto y se cae con «→» o «·».
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    token = os.environ.get('DA_TOKEN', '').strip()
    if not token:
        sys.exit('Falta el token en DA_TOKEN.')

    emp = api('empresas?nombre=eq.DigiAccount&select=id,cuenta_id,fiscal_activo', token)
    if not emp:
        falla('no encontré la empresa DigiAccount')
    emp = emp[0]
    print('Empresa DigiAccount %s · cuenta %s' % (emp['id'], emp['cuenta_id']))

    plan = api('plan_cuentas_base?select=codigo', token)
    print('  plan_cuentas_base: %d cuentas' % len(plan))
    sin_periodo = api('asientos?periodo=is.null&select=id&limit=5', token)

    comunes = {'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'periodo': '2026-11'}
    filas = [
        dict(comunes, tipo='venta', fecha='02/11/26', tercero_nombre='CLIENTE ' + MARCA, tercero_rif='J000000001',
             numero_factura=MARCA + '-V', tipo_doc='FV', exento=0, base=1000, iva=160, total=1160),
        dict(comunes, tipo='compra', fecha='02/11/26', tercero_nombre='PROVEEDOR ' + MARCA, tercero_rif='J000000002',
             numero_factura=MARCA + '-C', tipo_doc='FC', exento=0, base=500, iva=80, total=580),
        dict(comunes, tipo='venta', fecha='02/11/26', tercero_nombre='', tercero_rif='', numero_factura='',
             numero_zeta=MARCA + '-Z', maquina_fiscal='PRUEBA', tipo_doc='FV', exento=0, base=300, iva=48, total=348),
    ]
    print('Voy a insertar 3 filas de prueba (venta, compra y reporte Z) marcadas %s y las borraré al final.' % MARCA)
    ids = []
    try:
        creadas = api('libro_fiscal', token, 'POST', filas, prefer='return=representation')
        ids = [f['id'] for f in creadas]
        venta, compra, zeta = ids

        a = asientos_de(token, ids)
        if len(a) != 3:
            falla('se esperaban 3 asientos y hay %d (¿se corrió contabilidad_04_motor.sql?)' % len(a))
        if not all(cuadra(x) for x in a):
            falla('hay asientos que no cuadran')
        if not all(x['numero'] for x in a):
            falla('hay asientos sin número')
        print('  OK  3 filas → 3 asientos cuadrados, numerados %s' % sorted(x['numero'] for x in a))

        api('libro_fiscal?id=eq.' + compra, token, 'PATCH', {'base': 700, 'iva': 112, 'total': 812})
        a = asientos_de(token, [compra])
        if len(a) != 1 or abs(float(a[0]['total']) - 812) > 0.005:
            falla('editar la compra debía dejar 1 asiento de 812 y dejó %s' % [x['total'] for x in a])
        print('  OK  editar la compra cambia su asiento sin duplicarlo')

        api('libro_fiscal?id=eq.' + venta, token, 'PATCH', {'tercero_nombre': 'ANULADA', 'base': 0, 'iva': 0, 'total': 0})
        if asientos_de(token, [venta]):
            falla('anular la venta debía quitar su asiento')
        print('  OK  anular la venta quita su asiento')
    finally:
        if ids:
            api('libro_fiscal?id=in.(%s)' % ','.join(ids), token, 'DELETE')
            resto = asientos_de(token, ids)
            if resto:
                falla('quedaron %d asientos huérfanos de las filas de prueba' % len(resto))
            print('  OK  filas de prueba borradas, sin asientos huérfanos')

    if sin_periodo:
        falla('hay asientos sin período (¿se corrió contabilidad_04_motor.sql completo?)')
    if len(plan) != 131:
        falla('plan_cuentas_base debía tener 131 cuentas y tiene %d' % len(plan))
    print('TODO OK')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as e:
        falla(str(e))
