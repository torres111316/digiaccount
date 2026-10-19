/* CORREO DE ENTRADA · facturas@digiaccount.io  →  n8n
 *
 * Cloudflare Email Routing entrega aquí cada correo que llega a la dirección.
 * El programa hace dos cosas, en este orden:
 *
 *   1. Deja una COPIA en el Gmail de Luis (variable COPIA_A). Va primero a
 *      propósito: si n8n está caído, el correo no se pierde.
 *   2. Lo desarma (remitente, asunto, texto y adjuntos) y se lo entrega a n8n
 *      por un webhook, con una llave compartida en la cabecera. n8n hace el
 *      resto: es la puerta de entrada de Arelis.
 *
 * Variables del Worker (Cloudflare → Workers → este Worker → Settings → Variables):
 *   N8N_URL     URL del webhook de n8n                      (texto)
 *   N8N_LLAVE   la llave compartida con la credencial de n8n (SECRETO, cifrada)
 *   COPIA_A     correo verificado en Email Routing           (texto)
 *
 * Se construye con:  npm run build   →  dist/worker.js  (un solo archivo para
 * pegar en el editor de Cloudflare; incluye postal-mime, que lee el correo).
 */
import PostalMime from 'postal-mime';

// Lo que no vale la pena mandar a n8n: firmas, logos incrustados, etc.
const MIN_BYTES_ADJUNTO = 2048;
// n8n acepta hasta 16 MB por llamada; en base64 el archivo crece un tercio.
const MAX_BYTES_TOTAL = 11 * 1024 * 1024;

function aBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const PASO = 0x8000;
  for (let i = 0; i < bytes.length; i += PASO) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + PASO));
  }
  return btoa(bin);
}

export default {
  async email(message, env, ctx) {
    // 1 · La copia, siempre
    if (env.COPIA_A) {
      try { await message.forward(env.COPIA_A); }
      catch (e) { console.log('No se pudo reenviar la copia:', e && e.message); }
    }

    // 2 · Desarmar el correo
    const crudo = await new Response(message.raw).arrayBuffer();
    const correo = await PostalMime.parse(crudo);

    let total = 0;
    const adjuntos = [];
    const omitidos = [];
    for (const a of correo.attachments || []) {
      const tam = a.content ? a.content.byteLength : 0;
      const nombre = a.filename || 'adjunto';
      // Imágenes pegadas en la firma: no son documentos
      if (a.disposition === 'inline' && tam < 50 * 1024) continue;
      if (tam < MIN_BYTES_ADJUNTO) continue;
      if (total + tam > MAX_BYTES_TOTAL) { omitidos.push(nombre); continue; }
      total += tam;
      adjuntos.push({ nombre, tipo: a.mimeType || 'application/octet-stream', tamano: tam, base64: aBase64(a.content) });
    }

    const carga = {
      para: message.to,
      de: message.from,
      de_nombre: (correo.from && correo.from.name) || '',
      responder_a: (correo.replyTo && correo.replyTo[0] && correo.replyTo[0].address) || message.from,
      asunto: correo.subject || '',
      fecha: correo.date || new Date().toISOString(),
      id_mensaje: correo.messageId || '',
      texto: (correo.text || '').slice(0, 20000),
      adjuntos,
      omitidos, // demasiado grandes para mandarlos: quedan en la copia de Gmail
    };

    // 3 · Entregarlo a n8n
    if (!env.N8N_URL || !env.N8N_LLAVE) {
      console.log('Faltan N8N_URL o N8N_LLAVE: el correo solo quedó en la copia.');
      return;
    }
    const resp = await fetch(env.N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Llave-Correo': env.N8N_LLAVE },
      body: JSON.stringify(carga),
    });
    if (!resp.ok) {
      console.log('n8n respondió ' + resp.status + ' para el correo de ' + message.from);
    }
  },
};
