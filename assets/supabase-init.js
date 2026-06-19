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
})();
