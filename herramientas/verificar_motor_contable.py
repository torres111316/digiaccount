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


def asientos_de(token, ids, tabla='libro_fiscal'):
    return api('asientos?origen_tabla=eq.%s&origen_id=in.(%s)&select=*' % (tabla, ','.join(ids)), token)


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

    # Todas las filas con las mismas columnas: PostgREST lo exige en una inserción múltiple.
    comunes = {'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'periodo': '2026-11',
               'numero_zeta': None, 'maquina_fiscal': None}
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
    ret_ids = []
    decl_ids = []
    af_ids = []
    banco_ids = []
    sub_codigos = []
    mov_ids = []
    usd_ids = []
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

        # Una retención de IVA practicada sobre la compra (sql/contabilidad_05_retenciones.sql).
        ret = api('retenciones', token, 'POST', [{
            'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'direccion': 'practicada', 'tipo': 'iva',
            'fecha': '02/11/26', 'periodo': '2026-11', 'comprobante': MARCA + '-R', 'tercero_nombre': 'PROVEEDOR ' + MARCA,
            'tercero_rif': 'J000000002', 'factura': MARCA + '-C', 'base': 700, 'pct': 75, 'monto': 84}],
            prefer='return=representation')
        ret_ids.append(ret[0]['id'])
        a = asientos_de(token, ret_ids, 'retenciones')
        if len(a) != 1:
            falla('la retención de prueba no generó asiento (¿se corrió contabilidad_05_retenciones.sql?)')
        cods = [l['cta'].split(' · ')[0] for l in a[0]['lineas']]
        if cods != ['2.1.1.01', '2.1.3.02'] or not cuadra(a[0]):
            falla('la retención debía dar Debe 2.1.1.01 / Haber 2.1.3.02 y dio %s' % cods)
        print('  OK  la retención de IVA practicada tiene su asiento (CxP → Retenciones IVA por pagar)')
        api('retenciones?id=eq.' + ret_ids[0], token, 'PATCH', {'estado': 'Anulada'})
        if asientos_de(token, ret_ids, 'retenciones'):
            falla('anular la retención debía quitar su asiento')
        print('  OK  anular la retención quita su asiento')

        # Una declaración de DPP con su pago (sql/contabilidad_06_declaraciones.sql).
        dec = api('declaraciones', token, 'POST', [{
            'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'impuesto': 'DPP', 'periodo': '2026-10',
            'numero': MARCA + '-D', 'fecha': '2026-11-02', 'tipo': 'ORIGINARIA', 'monto': 900, 'a_pagar': 900,
            'fecha_pago': '2026-11-02', 'numero_pago': MARCA + '-P'}], prefer='return=representation')
        decl_ids.append(dec[0]['id'])
        a = asientos_de(token, decl_ids, 'declaraciones') + asientos_de(token, decl_ids, 'declaraciones_pago')
        if len(a) != 2 or not all(cuadra(x) for x in a):
            falla('la declaración de prueba debía dar 2 asientos cuadrados y dio %d (¿se corrió contabilidad_06_declaraciones.sql?)' % len(a))
        print('  OK  declaración de DPP y su pago: 2 asientos cuadrados')
        api('declaraciones?id=eq.' + decl_ids[0], token, 'PATCH', {'fecha_pago': None})
        if asientos_de(token, decl_ids, 'declaraciones_pago') or not asientos_de(token, decl_ids, 'declaraciones'):
            falla('quitar el pago debía dejar solo el asiento de la declaración')
        print('  OK  quitar el pago deja solo el asiento de la declaración')

        # Un activo fijo con su depreciación y su baja (sql/contabilidad_07_activos.sql).
        # En 2020, para no tocar ningún mes real de la empresa. Depreciar recalcula
        # TODOS sus activos: si la empresa tiene alguno de verdad, no se prueba aquí.
        if api('activos_fijos?empresa_id=eq.%s&select=id&limit=1' % emp['id'], token):
            falla('la empresa DigiAccount tiene activos fijos reales: la prueba de depreciación los tocaría')
        af = api('activos_fijos', token, 'POST', [{
            'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'codigo': MARCA + '-AF', 'nombre': 'Activo ' + MARCA,
            'categoria': 'Equipos', 'fecha_adq': '15/01/2020', 'costo': 1200, 'vida_util': 1, 'metodo': 'Línea recta',
            'valor_residual': 0}], prefer='return=representation')
        af_ids.append(af[0]['id'])
        total = api('rpc/contab_depreciar', token, 'POST', {'p_empresa': emp['id'], 'p_periodo': '2020-02'})
        total = api('rpc/contab_depreciar', token, 'POST', {'p_empresa': emp['id'], 'p_periodo': '2020-02'})
        dep = api('asientos?empresa_id=eq.%s&origen_tabla=eq.depreciacion&referencia=eq.DEPR-02/2020&select=*' % emp['id'], token)
        if abs(float(total or 0) - 100) > 0.005 or len(dep) != 1 or not cuadra(dep[0]):
            falla('depreciar febrero de 2020 dos veces debía dar 1 asiento de 100 y dio %s / %d asientos' % (total, len(dep)))
        print('  OK  depreciar dos veces el mismo mes: una cuota de 100 y un solo asiento')
        api('rpc/contab_baja_activo', token, 'POST', {'p_activo': af_ids[0], 'p_fecha': '2020-03-10', 'p_precio': 0, 'p_cuenta_cobro': None})
        a = asientos_de(token, af_ids, 'activos_fijos')
        cods = [l['cta'].split(' · ')[0] for l in a[0]['lineas']] if a else []
        if cods != ['1.2.1.09', '6.3.1.05', '1.2.1.04'] or not cuadra(a[0]):
            falla('la desincorporación debía dar 1.2.1.09 / 6.3.1.05 / 1.2.1.04 y dio %s' % cods)
        print('  OK  la desincorporación sale con su pérdida y cuadra')

        # Conciliación (sql/contabilidad_08 y _09): dos bancos de prueba con su subcuenta,
        # un estado de cuenta de febrero de 2020 y tres líneas conciliadas.
        bancos = api('cuentas_tesoreria', token, 'POST', [
            {'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'nombre': MARCA + ' A', 'banco': 'Prueba', 'tipo': 'Corriente', 'moneda': 'Bs', 'saldo_inicial': 0},
            {'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'nombre': MARCA + ' B', 'banco': 'Prueba', 'tipo': 'Corriente', 'moneda': 'Bs', 'saldo_inicial': 0}],
            prefer='return=representation')
        banco_ids.extend(b['id'] for b in bancos)
        sub_codigos.extend(b['cuenta_contable'] for b in bancos if b.get('cuenta_contable'))
        if len(sub_codigos) != 2 or not all(c.startswith('1.1.1.03.') for c in sub_codigos):
            falla('cada banco debía recibir su subcuenta 1.1.1.03.NN y recibió %s (¿se corrió contabilidad_08_conciliacion.sql?)' % sub_codigos)
        print('  OK  cada banco recibe su subcuenta: %s' % ', '.join(sub_codigos))
        subA, subB = sub_codigos
        api('estados_cuenta', token, 'POST', [{'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'cuenta_teso_id': banco_ids[0],
            'periodo': '2020-02', 'banco': 'Prueba', 'saldo_inicial': 0, 'saldo_final': 65}])
        comunesL = {'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'cuenta_teso_id': banco_ids[0], 'periodo': '2020-02', 'referencia': MARCA}
        lineas = api('extracto_bancario', token, 'POST', [
            dict(comunesL, fecha='03/02/2020', descripcion='COBRO ' + MARCA, monto=100, huella=MARCA + '-1', clase='cobro', estado='conciliada', cuenta_contra=None),
            dict(comunesL, fecha='04/02/2020', descripcion='COMISION ' + MARCA, monto=-5, huella=MARCA + '-2', clase='comision', estado='conciliada', cuenta_contra=None),
            dict(comunesL, fecha='05/02/2020', descripcion='TRF ' + MARCA, monto=-30, huella=MARCA + '-3', clase='transferencia', estado='conciliada', cuenta_contra=subB)],
            prefer='return=representation')
        lin_ids = [l['id'] for l in lineas]
        a = asientos_de(token, lin_ids, 'extracto_bancario')
        if len(a) != 3 or not all(cuadra(x) for x in a):
            falla('las 3 líneas conciliadas debían dar 3 asientos cuadrados y dieron %d' % len(a))
        print('  OK  cobro, comisión y transferencia conciliados: 3 asientos cuadrados')
        res = api('rpc/contab_conciliacion_resumen', token, 'POST', {'p_cuenta_teso': banco_ids[0], 'p_periodo': '2020-02'})
        if abs(float(res.get('saldo_libros') or 0) - 65) > 0.005 or res.get('diferencia') is None or abs(float(res.get('diferencia'))) > 0.005:
            falla('el resumen debía dar 65 en libros y diferencia 0, y dio %s' % res)
        print('  OK  el resumen de la conciliación cuadra: libros 65, diferencia 0')
        api('extracto_bancario?id=eq.' + lin_ids[0], token, 'PATCH', {'estado': 'pendiente'})
        if len(asientos_de(token, lin_ids, 'extracto_bancario')) != 2:
            falla('desconciliar el cobro debía quitar su asiento')
        print('  OK  desconciliar una línea quita su asiento')

        # Tesorería y diferencial cambiario (sql/contabilidad_10 a _12), en febrero de 2025
        # (hay tasas reales del BCV y la empresa no tiene movimientos ahí).
        t_doc = float(api('rpc/contab_tasa_bcv', token, 'POST', {'p_fecha': '2025-02-05'}))
        t_dia = float(api('rpc/contab_tasa_bcv', token, 'POST', {'p_fecha': '2025-02-27'}))
        if not (t_doc > 0 and t_dia > 0):
            falla('no hay tasas BCV de febrero de 2025 (¿se corrió contabilidad_10_recibos.sql?)')
        usd_doc = round(1160 / t_doc, 2)
        vusd = api('libro_fiscal', token, 'POST', [dict(comunes, tipo='venta', fecha='05/02/25', periodo='2025-02', tercero_nombre='CLIENTE ' + MARCA,
            tercero_rif='J000000003', numero_factura=MARCA + '-USD', tipo_doc='FV', exento=0, base=1000, iva=160, total=1160,
            moneda='USD', tasa=t_doc, total_usd=usd_doc)], prefer='return=representation')
        ids.append(vusd[0]['id'])
        cobro = api('movimientos_tesoreria', token, 'POST', [{'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'cuenta_teso_id': banco_ids[0],
            'fecha': '27/02/25', 'concepto': 'Cobro ' + MARCA, 'tipo': 'ingreso', 'referencia': MARCA, 'monto': round(usd_doc * t_dia, 2),
            'tercero_nombre': 'CLIENTE ' + MARCA, 'factura_ref': MARCA + '-USD'}], prefer='return=representation')
        mov_ids.append(cobro[0]['id'])
        a = asientos_de(token, mov_ids, 'movimientos_tesoreria')
        cods = [l['cta'].split(' · ')[0] for l in a[0]['lineas']] if a else []
        cxc = [l for l in (a[0]['lineas'] if a else []) if l['cta'].startswith('1.1.2.01')]
        if len(a) != 1 or not cuadra(a[0]) or cods[0] != subA or not cxc or abs(float(cxc[0]['haber']) - 1160) > 0.005:
            falla('el cobro del documento en dólares debía cancelar CxC por 1160 desde la subcuenta, y dio %s (¿se corrió contabilidad_11_tesoreria.sql?)' % [(l['cta'][:12], l['debe'], l['haber']) for l in (a[0]['lineas'] if a else [])])
        print('  OK  cobro en Tesorería de una factura en dólares: CxC a la tasa del documento y el diferencial (%s)' % ', '.join(cods))
        cusd = api('cuentas_tesoreria', token, 'POST', [{'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'nombre': MARCA + ' USD',
            'banco': 'Prueba', 'tipo': 'Corriente', 'moneda': 'USD', 'saldo_inicial': 0}], prefer='return=representation')
        banco_ids.append(cusd[0]['id'])
        if cusd[0].get('cuenta_contable'):
            sub_codigos.append(cusd[0]['cuenta_contable'])
        musd = api('movimientos_tesoreria', token, 'POST', [{'cuenta_id': emp['cuenta_id'], 'empresa_id': emp['id'], 'cuenta_teso_id': cusd[0]['id'],
            'fecha': '27/02/25', 'concepto': 'Aporte ' + MARCA, 'tipo': 'ingreso', 'referencia': MARCA, 'monto': 10, 'cuenta_contra': '3.1.1.01'}],
            prefer='return=representation')
        mov_ids.append(musd[0]['id'])
        a = asientos_de(token, [musd[0]['id']], 'movimientos_tesoreria')
        if len(a) != 1 or str(a[0]['lineas'][0].get('usd')) not in ('10', '10.0', '10.00') or abs(float(a[0]['lineas'][0]['debe']) - round(10 * t_dia, 2)) > 0.005:
            falla('el ingreso de 10 USD debía quedar en Bs a la tasa del día y guardar los dólares, y dio %s' % (a[0]['lineas'] if a else 'sin asiento'))
        print('  OK  cuenta en dólares: 10 USD en Bs a la tasa del día (%.2f), con los dólares en la línea' % round(10 * t_dia, 2))
        # La revaluación es del SQL 12 (paso 2): si todavía no se corrió, se salta.
        try:
            rev = api('rpc/contab_revaluar', token, 'POST', {'p_empresa': emp['id'], 'p_periodo': '2025-02'})
        except RuntimeError as e:
            if 'PGRST202' not in str(e):
                raise
            rev = None
            print('  --  revaluación omitida: el SQL 12 todavía no se corrió')
        if rev is not None:
            api('rpc/contab_revaluar', token, 'POST', {'p_empresa': emp['id'], 'p_periodo': '2025-02'})
            r = api('asientos?empresa_id=eq.%s&origen_tabla=eq.revaluacion&referencia=eq.REV-02/2025&select=*' % emp['id'], token)
            if len(r) > 1 or (r and not cuadra(r[0])):
                falla('la revaluación de febrero debía dar a lo sumo un asiento cuadrado y dio %d' % len(r))
            print('  OK  revaluación de febrero 2025 (dos veces): %s · %d asiento' % (rev, len(r)))
    finally:
        # PRIMERO se borra todo y DESPUÉS se comprueba: si una comprobación
        # fallara en medio, el resto de las filas de prueba quedaría en producción.
        if decl_ids:
            api('declaraciones?id=in.(%s)' % ','.join(decl_ids), token, 'DELETE')
        if mov_ids:
            api('movimientos_tesoreria?id=in.(%s)' % ','.join(mov_ids), token, 'DELETE')
        api('asientos?empresa_id=eq.%s&origen_tabla=eq.revaluacion&referencia=eq.REV-02/2025' % emp['id'], token, 'DELETE')
        if banco_ids:
            ids_b = ','.join(banco_ids)
            api('extracto_bancario?cuenta_teso_id=in.(%s)' % ids_b, token, 'DELETE')
            api('cuentas_tesoreria?id=in.(%s)' % ids_b, token, 'DELETE')
            for c in sub_codigos:
                api('cuentas_contables?empresa_id=eq.%s&codigo=eq.%s' % (emp['id'], c), token, 'DELETE')
        if af_ids:
            api('asientos?origen_tabla=eq.activos_fijos&origen_id=in.(%s)' % ','.join(af_ids), token, 'DELETE')
            api('activos_fijos?id=in.(%s)' % ','.join(af_ids), token, 'DELETE')
            api('asientos?empresa_id=eq.%s&origen_tabla=eq.depreciacion&referencia=eq.DEPR-02/2020' % emp['id'], token, 'DELETE')
        if ret_ids:
            api('retenciones?id=in.(%s)' % ','.join(ret_ids), token, 'DELETE')
        if ids:
            api('libro_fiscal?id=in.(%s)' % ','.join(ids), token, 'DELETE')
        huerfanos = (len(asientos_de(token, ret_ids, 'retenciones')) if ret_ids else 0) + (len(asientos_de(token, ids)) if ids else 0)             + (len(asientos_de(token, decl_ids, 'declaraciones')) + len(asientos_de(token, decl_ids, 'declaraciones_pago')) if decl_ids else 0)
        if huerfanos:
            falla('quedaron %d asientos huérfanos de las filas de prueba' % huerfanos)
        if af_ids and (asientos_de(token, af_ids, 'activos_fijos') or api('activos_depreciacion?activo_id=in.(%s)&select=id' % ','.join(af_ids), token)):
            falla('quedaron restos del activo de prueba')
        if banco_ids and api('asientos?empresa_id=eq.%s&origen_tabla=eq.extracto_bancario&referencia=eq.%s&select=id' % (emp['id'], MARCA), token):
            falla('quedaron asientos de las líneas de prueba')
        if mov_ids and asientos_de(token, mov_ids, 'movimientos_tesoreria'):
            falla('quedaron asientos de los movimientos de prueba')
        if ids or ret_ids or decl_ids or af_ids or banco_ids:
            print('  OK  filas de prueba borradas, sin asientos huérfanos')

    if sin_periodo:
        falla('hay asientos sin período (¿se corrió contabilidad_04_motor.sql completo?)')
    if len(plan) != 132:
        falla('plan_cuentas_base debía tener 132 cuentas y tiene %d (¿se corrió contabilidad_07_activos.sql?)' % len(plan))
    print('TODO OK')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as e:
        falla(str(e))
