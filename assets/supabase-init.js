/* =========================================================
   CONEXIÓN CON SUPABASE — el backend real de DigiAccount
   ---------------------------------------------------------
   La clave 'anon' es PÚBLICA y segura en el frontend: el
   acceso real a los datos lo controla RLS en la base de datos.
   La clave secreta (service_role) NUNCA va aquí.
   ========================================================= */
(function () {
  const SUPABASE_URL = 'https://esnicjnuymqgktqoueyq.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbmljam51eW1xZ2t0cW91ZXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MDI2NzksImV4cCI6MjA5NzI3ODY3OX0.RGM9o7ohWFDIE5BA4WwFkYx2NztAU68fk3Dbu7QifIU';

  // Creamos el cliente global que TODA la app usará: window.sb
  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log('[DigiAccount] Cliente Supabase listo ✓');

  // === Modo del documento de venta ===
  //  'recibo'  = por defecto. DigiAccount aún sin homologación SENIAT → emite RECIBOS (no fiscales).
  //  'factura' = al homologar ante el SENIAT → reactiva TODO el comportamiento fiscal
  //              (factura, N° de control, máquina fiscal, formato electrónico) que ya existe en el sistema.
  window.__MODO_DOC = window.__MODO_DOC || 'recibo';
  window.__esRecibo = function () { return (window.__MODO_DOC || 'recibo') !== 'factura'; };

  // === OCR de comprobantes (Agente IA · vía n8n + Gemini) ===
  // Recibe un File (foto/captura del pago), lo envía al workflow de n8n y devuelve
  // los datos extraídos: { ok, banco, monto, referencia, fecha, telefono, cuenta, tipo, confianza }.
  // El token solo evita el uso casual del webhook por terceros (no es un secreto fuerte).
  const OCR_URL = 'https://n8n.digiaccount.io/webhook/ocr-comprobante';
  const OCR_TOKEN = 'da-ocr-x9K2mQ7vT4wP8nR3';
  window.__ocrComprobante = function (file) {
    return new Promise(function (resolve) {
      try {
        if (!file || !/^image\/(jpeg|jpg|png|webp)$/.test(file.type)) {
          resolve({ ok: false, error: 'Formato no soportado (usa JPG, PNG o WebP)' }); return;
        }
        if (file.size > 5 * 1024 * 1024) {
          resolve({ ok: false, error: 'La imagen supera 5MB' }); return;
        }
        const r = new FileReader();
        r.onerror = function () { resolve({ ok: false, error: 'No se pudo leer el archivo' }); };
        r.onload = function () {
          const b64 = String(r.result).split(',')[1] || '';
          fetch(OCR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: OCR_TOKEN, imagen: b64, mime: file.type }),
          })
            .then(function (res) { return res.json(); })
            .then(function (j) { resolve(j && typeof j === 'object' ? j : { ok: false, error: 'Respuesta inválida' }); })
            .catch(function (e) { resolve({ ok: false, error: 'Sin conexión con el lector: ' + e.message }); });
        };
        r.readAsDataURL(file);
      } catch (e) { resolve({ ok: false, error: e.message }); }
    });
  };

  // === Extractor de estados de cuenta (Agente IA asíncrono) ===
  // El PDF puede tardar varios minutos: se envía, el agente responde por la tabla
  // trabajos_ia, y la app la consulta hasta que el resultado esté listo.
  const EXTRACTO_URL = 'https://n8n.digiaccount.io/webhook/extracto-bancario';
  const uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  };
  window.__extraerEstadoCuenta = async function (file) {
    if (!file || !(/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || ''))) {
      return { ok: false, error: 'El estado de cuenta debe ser un PDF' };
    }
    if (file.size > 15 * 1024 * 1024) return { ok: false, error: 'El PDF supera 15MB' };
    if (!window.__CUENTA_ID) return { ok: false, error: 'No hay sesión activa' };
    const b64 = await new Promise(function (res) {
      const r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { res(''); };
      r.readAsDataURL(file);
    });
    if (!b64) return { ok: false, error: 'No se pudo leer el archivo' };
    const job = uuid();
    try {
      const resp = await fetch(EXTRACTO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: OCR_TOKEN, job: job, cuenta_id: window.__CUENTA_ID, archivo: b64, mime: 'application/pdf' }),
      });
      if (!resp.ok) return { ok: false, error: 'El agente no respondió (' + resp.status + ')' };
    } catch (e) { return { ok: false, error: 'Sin conexión con el agente: ' + e.message }; }
    return { ok: true, job: job };
  };
  // Espera el resultado de un trabajo de IA consultando trabajos_ia (hasta ~12 min)
  window.__esperarTrabajoIA = async function (job, onTick) {
    const INTERVALO = 8000, MAX = 90;
    for (let i = 0; i < MAX; i++) {
      await new Promise(function (r) { setTimeout(r, INTERVALO); });
      if (onTick) { try { onTick(i + 1, Math.round((i + 1) * INTERVALO / 1000)); } catch (e) {} }
      try {
        const { data, error } = await window.sb.from('trabajos_ia').select('estado, resultado').eq('id', job).maybeSingle();
        if (error || !data) continue;
        if (data.estado === 'listo') return data.resultado || { ok: false, error: 'Resultado vacío' };
        if (data.estado === 'error') return (data.resultado && typeof data.resultado === 'object') ? data.resultado : { ok: false, error: 'El agente reportó un error' };
      } catch (e) {}
    }
    return { ok: false, error: 'Tiempo de espera agotado — el agente sigue ocupado, reintenta en unos minutos' };
  };
})();
