"""Arma el flujo de n8n «Curso · Inscripciones (landing digiaccount.io/curso)».

Tres entradas en un solo flujo:
  GET  /webhook/curso-config       → precio vigente, fecha, lugar y tasa BCV (para la landing)
  POST /webhook/curso-inscripcion  → registra, guarda el comprobante, avisa a Luis por Telegram
                                     y le confirma a la persona por correo
  GET  /webhook/curso-resolver     → los enlaces [Aprobar] [Rechazar] del Telegram.
                                     Primero muestra una página de confirmación (así la vista
                                     previa de un enlace nunca aprueba nada) y al confirmar
                                     resuelve y, si se aprueba, envía el enlace del grupo.

Uso:  python curso_inscripciones_workflow.py > curso_inscripciones_workflow.json
(lo sube a n8n el script publicar o se importa a mano). Requiere sql/curso_inscripciones.sql.
"""
import json
import sys

SUPA = 'https://esnicjnuymqgktqoueyq.supabase.co'
N8N = 'https://n8n.digiaccount.io'
CRED_SUPA = {'supabaseApi': {'id': '6HTJ7SkRWU2wYkmo', 'name': 'Supabase account'}}
CRED_RESEND = {'httpHeaderAuth': {'id': 'u5ikE6vKDD9zuEFu', 'name': 'Header Auth account'}}
CRED_TG = {'telegramApi': {'id': 'bHEGSP3YFkRPQHsE', 'name': 'Telegram Bot Asesor'}}
CHAT_LUIS = '924385022'
CORS = {'responseHeaders': {'entries': [{'name': 'Access-Control-Allow-Origin', 'value': '*'}]}}
HTML_HDR = {'responseHeaders': {'entries': [{'name': 'Content-Type', 'value': 'text/html; charset=utf-8'}]}}

nodes, conns = [], {}


def nodo(nombre, tipo, version, params, pos, cred=None, **extra):
    n = {'parameters': params, 'name': nombre, 'type': tipo, 'typeVersion': version, 'position': pos}
    if cred:
        n['credentials'] = cred
    n.update(extra)
    nodes.append(n)
    return nombre


def unir(a, b, salida=0):
    conns.setdefault(a, {'main': []})
    while len(conns[a]['main']) <= salida:
        conns[a]['main'].append([])
    conns[a]['main'][salida].append({'node': b, 'type': 'main', 'index': 0})


def rpc(nombre, fn, cuerpo, pos, **extra):
    return nodo(nombre, 'n8n-nodes-base.httpRequest', 4.4, {
        'method': 'POST', 'url': f'{SUPA}/rest/v1/rpc/{fn}',
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi',
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': cuerpo, 'options': {}}, pos, CRED_SUPA, **extra)


def resend(nombre, para, asunto, html, pos):
    return nodo(nombre, 'n8n-nodes-base.httpRequest', 4.4, {
        'method': 'POST', 'url': 'https://api.resend.com/emails',
        'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
        'sendBody': True, 'specifyBody': 'json',
        'jsonBody': "={{ JSON.stringify({ from: 'DigiAccount · Formación Empresarial <noreply@digiaccount.io>', reply_to: 'gerencia@digiaccount.io', to: [" + para + "], subject: " + asunto + ", html: " + html + " }) }}",
        'options': {}}, pos, CRED_RESEND, onError='continueRegularOutput')


def responder(nombre, cuerpo, pos, html=False):
    return nodo(nombre, 'n8n-nodes-base.respondToWebhook', 1.1, {
        'respondWith': 'text', 'responseBody': cuerpo, 'options': HTML_HDR if html else CORS}, pos)


# ═══ A · Configuración para la landing ═══════════════════════════════════
nodo('Config (GET)', 'n8n-nodes-base.webhook', 2, {
    'httpMethod': 'GET', 'path': 'curso-config', 'responseMode': 'responseNode', 'options': {'allowedOrigins': '*'}}, [0, 0],
    webhookId='curso-config')
rpc('Leer configuración', 'curso_config', '={}', [220, 0], onError='continueRegularOutput')
responder('Responder config', "={{ JSON.stringify($json.ok ? $json : { ok: false }) }}", [440, 0])
unir('Config (GET)', 'Leer configuración')
unir('Leer configuración', 'Responder config')

# ═══ B · Inscripción ═════════════════════════════════════════════════════
nodo('Inscripción (POST)', 'n8n-nodes-base.webhook', 2, {
    'httpMethod': 'POST', 'path': 'curso-inscripcion', 'responseMode': 'responseNode', 'options': {'allowedOrigins': '*'}}, [0, 300],
    webhookId='curso-inscripcion')

VALIDAR = r"""// Valida el formulario y convierte el comprobante (base64) en archivo.
const b = $json.body || {};
const h = $json.headers || {};
const t = (s, n) => String(s == null ? '' : s).trim().slice(0, n || 200);
const p = {
  nombre: t(b.nombre, 120), cedula: t(b.cedula, 20), whatsapp: t(b.whatsapp, 30), correo: t(b.correo, 120).toLowerCase(),
  empresa: t(b.empresa, 120), cliente_firma: b.cliente_firma === true || b.cliente_firma === 'true',
  metodo: b.metodo === 'binance' ? 'binance' : 'pago_movil', referencia: t(b.referencia, 60),
  telefono_origen: t(b.telefono_origen, 30), monto_pagado: t(b.monto_pagado, 40),
  fecha_pago: /^\d{4}-\d{2}-\d{2}$/.test(t(b.fecha_pago)) ? t(b.fecha_pago) : '',
  origen: t(b.origen, 40), consentimiento: b.consentimiento === true || b.consentimiento === 'true',
  ip: t(h['cf-connecting-ip'] || String(h['x-forwarded-for'] || '').split(',')[0], 60), user_agent: t(h['user-agent'], 300),
};
let status = 'ok';
if (t(b.website)) status = 'spam';
else if (!p.nombre || !p.whatsapp || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.correo) || !p.referencia) status = 'invalid';

const out = { json: { status, p, tieneArchivo: false } };
const a = b.comprobante;
if (status === 'ok' && a && a.base64) {
  const tipos = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const ext = tipos[a.tipo];
  const datos = String(a.base64).replace(/^data:[^,]+,/, '');
  if (ext && datos.length < 7000000) {             // ~5 MB
    out.json.tieneArchivo = true; out.json.ext = ext; out.json.mime = a.tipo;
    out.binary = { comprobante: { data: datos, mimeType: a.tipo, fileName: 'comprobante.' + ext } };
  }
}
return [out];"""
nodo('Validar', 'n8n-nodes-base.code', 2, {'jsCode': VALIDAR}, [220, 300])
nodo('¿Válido?', 'n8n-nodes-base.if', 2.2, {'conditions': {
    'options': {'version': 2, 'caseSensitive': True, 'typeValidation': 'loose'},
    'conditions': [{'id': 'v', 'leftValue': '={{ $json.status }}', 'rightValue': 'ok', 'operator': {'type': 'string', 'operation': 'equals'}}],
    'combinator': 'and'}, 'options': {}}, [440, 300])
responder('Responder rechazo', "={{ JSON.stringify({ ok: false, error: 'Revisa tus datos: nombre, WhatsApp, correo y referencia del pago son obligatorios.' }) }}", [660, 460])
rpc('Registrar (Supabase)', 'curso_inscribir', '={{ JSON.stringify({ p: $json.p }) }}', [660, 300], onError='continueErrorOutput')
responder('Responder error', "={{ JSON.stringify({ ok: false, error: 'No pudimos registrar tu inscripción. Escríbenos por WhatsApp al 0412-5070103.' }) }}", [880, 460])

PREPARAR = r"""// Arma el aviso para Luis y el correo para la persona.
const r = $json;                                   // respuesta de curso_inscribir
const v = $('Validar').first().json;
const p = v.p;
const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bs = (n) => n == null ? '' : Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const base = 'N8N/webhook/curso-resolver?id=' + r.id + '&t=' + r.token;
const tarifa = { preventa: 'Preventa', cliente: 'Cliente de la firma', regular: 'Precio regular' }[r.tarifa];
const metodo = p.metodo === 'binance' ? 'Binance' : 'Pago móvil';
const tel = p.whatsapp.replace(/\D/g, '').replace(/^0/, '58');
const aviso = '<b>🎓 Nueva inscripción · ' + e(r.edicion_nombre) + '</b>\n\n'
  + '<b>' + e(p.nombre) + '</b>' + (p.cedula ? ' · C.I. ' + e(p.cedula) : '') + (p.empresa ? '\n🏪 ' + e(p.empresa) : '') + '\n'
  + '📱 <a href="https://wa.me/' + tel + '">' + e(p.whatsapp) + '</a> · ✉️ ' + e(p.correo) + '\n\n'
  + '💵 <b>$' + r.monto_usd + '</b> (' + tarifa + ')' + (r.monto_bs ? ' = Bs ' + bs(r.monto_bs) + ' a ' + bs(r.tasa_bcv) : '') + '\n'
  + '🏦 ' + metodo + ' · Ref. <b>' + e(p.referencia) + '</b>'
  + (p.telefono_origen ? ' · desde ' + e(p.telefono_origen) : '') + (p.monto_pagado ? '\nDice que pagó: ' + e(p.monto_pagado) : '')
  + (p.fecha_pago ? ' · el ' + e(p.fecha_pago) : '') + '\n'
  + (p.cliente_firma ? '⚠️ Dice ser <b>cliente de la firma</b>: confírmalo.\n' : '')
  + (r.repetida ? '⚠️ Ya hay otra inscripción con este correo.\n' : '')
  + (v.tieneArchivo ? '' : '📎 Sin comprobante adjunto.\n')
  + (p.origen ? 'Vino de: ' + e(p.origen) + '\n' : '')
  + '\nVerifica el pago en tu banco o en Binance y luego:\n'
  + '<a href="' + base + '&a=ok">✅ APROBAR</a>        <a href="' + base + '&a=no">❌ RECHAZAR</a>';
const nombre1 = e(p.nombre.split(' ')[0]);
const correo = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2933">'
  + '<div style="background:#001b34;color:#fff;padding:22px 26px;border-radius:10px 10px 0 0"><b style="font-size:20px">Digi<span style="color:#00bfff">Account</span></b> · Formación Empresarial</div>'
  + '<div style="border:1px solid #d8dee6;border-top:0;padding:24px 26px;border-radius:0 0 10px 10px">'
  + '<h2 style="color:#003057;margin:0 0 12px">¡Recibimos tu inscripción, ' + nombre1 + '!</h2>'
  + '<p>Estamos verificando tu pago (' + metodo + ', referencia <b>' + e(p.referencia) + '</b>). Apenas se confirme, te llega otro correo con el <b>enlace al grupo de WhatsApp</b> del curso y todos los detalles.</p>'
  + '<p style="background:#ecf9ff;padding:12px 14px;border-radius:8px"><b>' + e(r.edicion_nombre) + '</b><br>Monto: <b>$' + r.monto_usd + '</b> (' + tarifa + ')</p>'
  + '<p>¿Alguna duda? Escríbenos por WhatsApp al <a href="https://wa.me/584125070103">0412-5070103</a>.</p>'
  + '<p style="color:#6b7b8d;font-size:13px">Luis Torres · Contador Público · DigiAccount</p></div></div>';
return [{ json: { id: r.id, token: r.token, ruta: r.edicion + '/' + r.id + '.' + (v.ext || 'jpg'), mime: v.mime, aviso,
  correo: p.correo, asunto: 'Recibimos tu inscripción · Formación Empresarial', html: correo,
  respuesta: { ok: true, id: r.id, monto_usd: r.monto_usd, monto_bs: r.monto_bs, tarifa: r.tarifa } },
  binary: $('Validar').first().binary }];""".replace('N8N/', N8N + '/')
nodo('Preparar aviso', 'n8n-nodes-base.code', 2, {'jsCode': PREPARAR}, [880, 300])
nodo('¿Trae comprobante?', 'n8n-nodes-base.if', 2.2, {'conditions': {
    'options': {'version': 2, 'caseSensitive': True, 'typeValidation': 'loose'},
    'conditions': [{'id': 'a', 'leftValue': "={{ $('Validar').first().json.tieneArchivo }}", 'rightValue': True, 'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
    'combinator': 'and'}, 'options': {}}, [1100, 300])
nodo('Guardar comprobante (Storage)', 'n8n-nodes-base.httpRequest', 4.4, {
    'method': 'POST', 'url': f"={SUPA}/storage/v1/object/comprobantes-curso/{{{{ $json.ruta }}}}",
    'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi',
    'sendHeaders': True, 'headerParameters': {'parameters': [
        {'name': 'Content-Type', 'value': '={{ $json.mime }}'}, {'name': 'x-upsert', 'value': 'true'}]},
    'sendBody': True, 'contentType': 'binaryData', 'inputDataFieldName': 'comprobante', 'options': {}},
    [1320, 200], CRED_SUPA, onError='continueRegularOutput')
rpc('Anotar comprobante', 'curso_comprobante',
    "={{ JSON.stringify({ p_id: $('Preparar aviso').first().json.id, p_token: $('Preparar aviso').first().json.token, p_ruta: $('Preparar aviso').first().json.ruta }) }}",
    [1540, 200], onError='continueRegularOutput')
nodo('Avisar a Luis (con comprobante)', 'n8n-nodes-base.telegram', 1.2, {
    'operation': 'sendDocument', 'chatId': CHAT_LUIS, 'binaryData': True, 'binaryPropertyName': 'comprobante',
    'additionalFields': {'caption': "={{ $('Preparar aviso').first().json.aviso }}", 'parse_mode': 'HTML'}},
    [1760, 200], CRED_TG, onError='continueRegularOutput')
nodo('Avisar a Luis (sin comprobante)', 'n8n-nodes-base.telegram', 1.2, {
    'chatId': CHAT_LUIS, 'text': "={{ $('Preparar aviso').first().json.aviso }}",
    'additionalFields': {'appendAttribution': False, 'parse_mode': 'HTML', 'disable_web_page_preview': True}},
    [1320, 420], CRED_TG, onError='continueRegularOutput')
resend('Correo a la persona (recibida)', "$('Preparar aviso').first().json.correo", "$('Preparar aviso').first().json.asunto",
       "$('Preparar aviso').first().json.html", [1980, 300])
responder('Responder OK', "={{ JSON.stringify($('Preparar aviso').first().json.respuesta) }}", [2200, 300])

unir('Inscripción (POST)', 'Validar')
unir('Validar', '¿Válido?')
unir('¿Válido?', 'Registrar (Supabase)', 0)
unir('¿Válido?', 'Responder rechazo', 1)
unir('Registrar (Supabase)', 'Preparar aviso', 0)
unir('Registrar (Supabase)', 'Responder error', 1)
unir('Preparar aviso', '¿Trae comprobante?')
# El aviso y el guardado salen en paralelo del IF: los dos necesitan el archivo,
# y la salida de un HTTP ya no lo trae.
unir('¿Trae comprobante?', 'Avisar a Luis (con comprobante)', 0)
unir('¿Trae comprobante?', 'Guardar comprobante (Storage)', 0)
unir('¿Trae comprobante?', 'Avisar a Luis (sin comprobante)', 1)
unir('Guardar comprobante (Storage)', 'Anotar comprobante')
unir('Avisar a Luis (con comprobante)', 'Correo a la persona (recibida)')
unir('Avisar a Luis (sin comprobante)', 'Correo a la persona (recibida)')
unir('Correo a la persona (recibida)', 'Responder OK')

# ═══ C · Aprobar o rechazar ═════════════════════════════════════════════
nodo('Resolver (GET)', 'n8n-nodes-base.webhook', 2, {
    'httpMethod': 'GET', 'path': 'curso-resolver', 'responseMode': 'responseNode', 'options': {}}, [0, 700],
    webhookId='curso-resolver')

PAGINA = r"""const pagina = (titulo, cuerpo, color) => '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + titulo + '</title></head>'
  + '<body style="margin:0;font-family:Arial,sans-serif;background:#eef3f9;color:#1f2933"><div style="max-width:480px;margin:40px auto;padding:0 16px">'
  + '<div style="background:#001b34;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><b>Digi<span style="color:#00bfff">Account</span></b> · Inscripciones del curso</div>'
  + '<div style="background:#fff;padding:22px 20px;border-radius:0 0 10px 10px;border-top:4px solid ' + (color || '#00bfff') + '">' + cuerpo + '</div></div></body></html>';
const boton = (href, txt, fondo) => '<a href="' + href + '" style="display:block;text-align:center;background:' + fondo + ';color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:12px">' + txt + '</a>';"""

DECIDIR = PAGINA + r"""
// Sin «c=1» solo se muestra la confirmación: abrir el enlace (o su vista previa) no cambia nada.
const q = $json.query || {};
const id = parseInt(q.id, 10), t = String(q.t || ''), aprobar = q.a === 'ok';
const valido = id > 0 && /^[0-9a-f-]{36}$/i.test(t) && (q.a === 'ok' || q.a === 'no');
let html = '';
if (!valido) html = pagina('Enlace inválido', '<h2>Enlace inválido</h2><p>Este enlace no corresponde a ninguna inscripción.</p>', '#c0392b');
else if (q.c !== '1') html = pagina('Confirmar', '<h2 style="margin-top:0">' + (aprobar ? '¿Aprobar' : '¿Rechazar') + ' la inscripción #' + id + '?</h2>'
  + '<p>' + (aprobar ? 'Confírmalo solo si ya viste el pago en tu banco o en Binance. La persona recibirá por correo el enlace al grupo de WhatsApp.'
                     : 'La persona recibirá un correo diciendo que no pudimos verificar su pago y que te escriba.') + '</p>'
  + boton('?id=' + id + '&t=' + t + '&a=' + q.a + '&c=1', aprobar ? '✅ Sí, aprobar' : '❌ Sí, rechazar', aprobar ? '#1c8f5a' : '#c0392b'));
return [{ json: { ejecutar: valido && q.c === '1', id, t, aprobar, html } }];"""
nodo('Decidir', 'n8n-nodes-base.code', 2, {'jsCode': DECIDIR}, [220, 700])
nodo('¿Ejecutar?', 'n8n-nodes-base.if', 2.2, {'conditions': {
    'options': {'version': 2, 'caseSensitive': True, 'typeValidation': 'loose'},
    'conditions': [{'id': 'x', 'leftValue': '={{ $json.ejecutar }}', 'rightValue': True, 'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
    'combinator': 'and'}, 'options': {}}, [440, 700])
responder('Mostrar confirmación', '={{ $json.html }}', [660, 860], html=True)
rpc('Resolver (Supabase)', 'curso_resolver', '={{ JSON.stringify({ p_id: $json.id, p_token: $json.t, p_aprobar: $json.aprobar }) }}', [660, 700], onError='continueRegularOutput')

# Enlaces de descarga firmados (bucket privado material-curso). Vencen 10 días después
# del curso (o en 120 días si aún no hay fecha). Si el archivo se reemplaza con el mismo
# nombre, el mismo enlace baja la versión nueva.
VENCE = ("={{ JSON.stringify({ expiresIn: (() => { const f = $('Resolver (Supabase)').first().json.fecha; "
         "const s = f ? Math.round((new Date(f + 'T23:59:00-04:00').getTime() + 10 * 864e5 - Date.now()) / 1000) : 120 * 86400; "
         "return Math.max(s, 7 * 86400); })() }) }}")
for i, (nombre, archivo) in enumerate([('Enlace guía', 'Guia-del-Participante.pdf'), ('Enlace plantilla', 'Plantilla-Conciliacion-Bancaria.xlsx')]):
    nodo(nombre, 'n8n-nodes-base.httpRequest', 4.4, {
        'method': 'POST', 'url': f'{SUPA}/storage/v1/object/sign/material-curso/{archivo}',
        'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'supabaseApi',
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': VENCE, 'options': {}}, [800 + 160 * i, 560], CRED_SUPA, onError='continueRegularOutput')

RESULTADO = PAGINA + r"""
const r = $('Resolver (Supabase)').first().json;
const firmado = (n, archivo) => { const u = $(n).first().json.signedURL; return u ? 'https://esnicjnuymqgktqoueyq.supabase.co/storage/v1' + u + '&download=' + archivo : ''; };
const urlGuia = firmado('Enlace guía', 'Guia-del-Participante.pdf');
const urlPlantilla = firmado('Enlace plantilla', 'Plantilla-Conciliacion-Bancaria.xlsx');
const e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
if (!r || !r.ok) return [{ json: { enviar: false, html: pagina('No encontrada', '<h2>No encontré esa inscripción</h2><p>Revisa el enlace o búscala en Supabase.</p>', '#c0392b') } }];
const aprobado = r.estado === 'aprobado';
const nombre1 = e(String(r.nombre).split(' ')[0]);
const fecha = r.fecha ? new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' }) : 'fecha por confirmar';
const grupo = r.grupo_whatsapp || '';
const tel = String(r.whatsapp).replace(/\D/g, '').replace(/^0/, '58');
const msgWa = '¡Hola ' + String(r.nombre).split(' ')[0] + '! Tu inscripción al curso «Tu negocio en orden» quedó confirmada ✅. '
  + (grupo ? 'Únete al grupo del curso aquí: ' + grupo : 'En estos días te agrego al grupo del curso.') + ' Nos vemos el ' + fecha + '.';
const correo = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2933">'
  + '<div style="background:#001b34;color:#fff;padding:22px 26px;border-radius:10px 10px 0 0"><b style="font-size:20px">Digi<span style="color:#00bfff">Account</span></b> · Formación Empresarial</div>'
  + '<div style="border:1px solid #d8dee6;border-top:0;padding:24px 26px;border-radius:0 0 10px 10px">'
  + (aprobado
    ? '<h2 style="color:#003057;margin:0 0 12px">¡Estás inscrito, ' + nombre1 + '! ✅</h2><p>Confirmamos tu pago. Te esperamos en el curso <b>«Tu negocio en orden»</b>:</p>'
      + '<p style="background:#ecf9ff;padding:12px 14px;border-radius:8px">📅 <b>' + e(fecha) + '</b><br>🕣 ' + e(r.hora) + '<br>📍 ' + e(r.lugar || 'Lugar por confirmar: te avisamos por el grupo') + '</p>'
      + (grupo ? '<p style="text-align:center"><a href="' + e(grupo) + '" style="display:inline-block;background:#25d366;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Unirme al grupo de WhatsApp del curso</a></p>' : '<p>En los próximos días te agregamos al grupo de WhatsApp del curso.</p>')
      + (urlGuia
        ? '<p><b>Tu material del curso</b> (descárgalo desde aquí cuando quieras; si actualizamos la guía, este mismo botón te da la versión nueva):</p>'
          + '<p style="text-align:center"><a href="' + urlGuia + '" style="display:inline-block;background:#00bfff;color:#001b34;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:bold;margin:4px">📘 Descargar la guía (PDF)</a>'
          + (urlPlantilla ? '<a href="' + urlPlantilla + '" style="display:inline-block;background:#003057;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:bold;margin:4px">📊 Plantilla de conciliación (Excel)</a>' : '') + '</p>'
          + '<p>Si puedes, <b>imprime la guía</b>; si no, trae un cuaderno para tus apuntes.'
        : '<p>Antes del curso te enviamos la <b>guía del participante en PDF</b>. Si puedes, imprímela; si no, trae un cuaderno para tus apuntes.')
      + ' Lleva también calculadora o teléfono y, si quieres conciliar tu banco en el taller, el estado de cuenta de un mes.</p>'
    : '<h2 style="color:#003057;margin:0 0 12px">No pudimos verificar tu pago</h2><p>Hola ' + nombre1 + ', revisamos y no encontramos el pago con los datos que enviaste. Puede ser un error en la referencia o el monto.</p><p>Escríbenos por WhatsApp al <a href="https://wa.me/584125070103">0412-5070103</a> con tu comprobante y lo resolvemos.</p>')
  + '<p style="color:#6b7b8d;font-size:13px">Luis Torres · Contador Público · DigiAccount</p></div></div>';
const cuerpo = (r.ya_resuelta ? '<p style="background:#fff7e6;padding:10px;border-radius:6px">Esta inscripción ya estaba <b>' + r.estado + '</b>: no se cambió ni se reenvió nada.</p>' : '')
  + '<h2 style="margin-top:0">' + (aprobado ? '✅ Aprobada' : '❌ Rechazada') + ' · #' + r.id + '</h2>'
  + '<p><b>' + e(r.nombre) + '</b><br>' + e(r.correo) + ' · ' + e(r.whatsapp) + '<br>$' + r.monto_usd + ' (' + e(r.tarifa) + ')</p>'
  + (aprobado ? '<p>Aprobados en este lote: <b>' + r.aprobados + '</b></p>' + (grupo ? '' : '<p style="color:#c0392b"><b>Ojo:</b> el lote aún no tiene enlace del grupo de WhatsApp (curso_ediciones.grupo_whatsapp).</p>')
      + boton('https://wa.me/' + tel + '?text=' + encodeURIComponent(msgWa), '💬 Escribirle por WhatsApp', '#25d366')
      + (urlGuia ? '<p style="font-size:13px;color:#6b7b8d;margin-top:16px">Enlace de la guía para fijarlo en el grupo (vence 10 días después del curso):<br><a href="' + urlGuia + '" style="word-break:break-all">' + urlGuia + '</a></p>' : '') : '');
return [{ json: { enviar: !r.ya_resuelta, correo: r.correo,
  asunto: aprobado ? '✅ Estás inscrito · Tu negocio en orden' : 'Sobre tu pago del curso · Formación Empresarial',
  htmlCorreo: correo, html: pagina('Inscripción #' + r.id, cuerpo, aprobado ? '#1c8f5a' : '#c0392b') } }];"""
nodo('Armar resultado', 'n8n-nodes-base.code', 2, {'jsCode': RESULTADO}, [880, 700])
nodo('¿Enviar correo?', 'n8n-nodes-base.if', 2.2, {'conditions': {
    'options': {'version': 2, 'caseSensitive': True, 'typeValidation': 'loose'},
    'conditions': [{'id': 'm', 'leftValue': '={{ $json.enviar }}', 'rightValue': True, 'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
    'combinator': 'and'}, 'options': {}}, [1100, 700])
resend('Correo a la persona (resultado)', "$('Armar resultado').first().json.correo", "$('Armar resultado').first().json.asunto",
       "$('Armar resultado').first().json.htmlCorreo", [1320, 620])
responder('Mostrar resultado', "={{ $('Armar resultado').first().json.html }}", [1540, 700], html=True)

unir('Resolver (GET)', 'Decidir')
unir('Decidir', '¿Ejecutar?')
unir('¿Ejecutar?', 'Resolver (Supabase)', 0)
unir('¿Ejecutar?', 'Mostrar confirmación', 1)
unir('Resolver (Supabase)', 'Enlace guía')
unir('Enlace guía', 'Enlace plantilla')
unir('Enlace plantilla', 'Armar resultado')
unir('Armar resultado', '¿Enviar correo?')
unir('¿Enviar correo?', 'Correo a la persona (resultado)', 0)
unir('¿Enviar correo?', 'Mostrar resultado', 1)
unir('Correo a la persona (resultado)', 'Mostrar resultado')

json.dump({'name': 'Curso · Inscripciones (landing digiaccount.io/curso)', 'nodes': nodes, 'connections': conns,
           'settings': {'executionOrder': 'v1'}}, sys.stdout, ensure_ascii=False, indent=1)
