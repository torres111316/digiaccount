/* =========================================================
   DigiAccount — Conciliación bancaria (Contabilidad y Tesorería)

   Una sola lógica con dos puertas (spec §6): la pestaña «Conciliación» de
   Contabilidad, para los clientes de la firma, y la de Tesorería. Cada línea
   del estado de cuenta se clasifica y, al conciliarla, la base hace su asiento
   (sql/contabilidad_08_conciliacion.sql).
   ========================================================= */
(function () {
  'use strict';

  /* SUGERENCIAS — regla de Luis: para asignar una línea a una factura, a una
     declaración o a un tercero hacen falta DOS coincidencias: el monto y una
     de estas (número del documento o referencia, RIF, teléfono, nombre). Con
     una sola, se sugiere pero no es «segura»: no entra en «Aprobar las
     seguras» y nunca se elige sola entre varias.

     linea: { id, fecha 'dd/mm/aaaa', descripcion, referencia, monto (+ entra, − sale) }
     ctx:   { documentos: [{ id, tipo:'venta'|'compra', numero, rif, tercero, saldo }],
              declaraciones: [{ id, impuesto, numero, a_pagar, pagada }],
              terceros: [{ nombre, rif, telefono }],
              otrasLineas: [{ id, cuenta_contable, fecha, monto }] }
     Devuelve { clase, seguro, motivo, ... } o null. */
  function sugerirLinea(linea, ctx) {
    ctx = ctx || {};
    const monto = Number(linea.monto) || 0;
    const abs = Math.round(Math.abs(monto) * 100) / 100;
    const texto = (String(linea.descripcion || '') + ' ' + String(linea.referencia || ''));
    const bajo = texto.toLowerCase();
    // Los números del texto, sin ceros a la izquierda (el banco y el libro los escriben distinto).
    const numeros = (texto.match(/\d+/g) || []).map((n) => n.replace(/^0+/, '')).filter(Boolean);
    const digitosTexto = texto.replace(/\D/g, '');
    const igual = (a, b) => Math.abs(a - b) <= 0.01;
    const dias = (f1, f2) => {
      const d = (f) => { const p = String(f || '').split('/'); return p.length === 3 ? Date.UTC(+p[2] < 100 ? 2000 + +p[2] : +p[2], +p[1] - 1, +p[0]) : NaN; };
      return Math.abs(d(f1) - d(f2)) / 86400000;
    };

    if (/comisi[oó]n|cargo por servicio|mantenimiento de cuenta/i.test(texto)) {
      return { clase: 'comision', seguro: true, motivo: 'La descripción dice que es una comisión del banco.' };
    }
    if (/\bigtf\b|grandes transacciones/i.test(texto)) {
      return { clase: 'igtf', seguro: true, motivo: 'La descripción dice que es IGTF.' };
    }

    // ¿Qué más coincide con este documento, además del monto?
    const segunda = (doc) => {
      const num = String(doc.numero || '').replace(/\D/g, '').replace(/^0+/, '');
      if (num.length >= 3 && numeros.indexOf(num) >= 0) return 'el número ' + doc.numero;
      const rif = String(doc.rif || '').replace(/\D/g, '');
      if (rif.length >= 6 && digitosTexto.indexOf(rif) >= 0) return 'el RIF';
      const palabras = String(doc.tercero || '').toUpperCase().split(/[^A-ZÁÉÍÓÚÑ]+/).filter((w) => w.length >= 4);
      if (palabras.some((w) => new RegExp('(^|[^A-ZÁÉÍÓÚÑ])' + w + '([^A-ZÁÉÍÓÚÑ]|$)').test(texto.toUpperCase()))) return 'el nombre';
      const ter = (ctx.terceros || []).find((t) => (doc.rif && t.rif === doc.rif) || (t.nombre && t.nombre === doc.tercero));
      const tel = String((ter && ter.telefono) || '').replace(/\D/g, '');
      if (tel.length >= 7 && digitosTexto.indexOf(tel.slice(-7)) >= 0) return 'el teléfono';
      return null;
    };

    // Impuesto: sale dinero por lo que se paga de una declaración sin pago.
    if (monto < 0) {
      const decl = (ctx.declaraciones || []).filter((d) => !d.pagada && igual(Number(d.a_pagar) || 0, abs));
      if (decl.length) {
        const conPlanilla = decl.find((d) => { const n = String(d.numero || '').replace(/\D/g, '').replace(/^0+/, ''); return n.length >= 4 && numeros.indexOf(n) >= 0; });
        const dice = /seniat|tesoro|impuesto/i.test(texto);
        const d = conPlanilla || (decl.length === 1 ? decl[0] : null);
        if (d && (conPlanilla || dice)) {
          return { clase: 'impuesto', seguro: true, declaracion_id: d.id, motivo: 'Monto de la declaración ' + (d.impuesto || '') + ' y ' + (conPlanilla ? 'su número de planilla.' : 'la descripción dice SENIAT.') };
        }
        return { clase: 'impuesto', seguro: false, declaracion_id: decl.length === 1 ? decl[0].id : null, motivo: 'Solo coincide el monto con una declaración por pagar: revísala.' };
      }
    }

    // Un documento: si entra dinero, una venta; si sale, una compra.
    const tipo = monto > 0 ? 'venta' : 'compra';
    const cand = (ctx.documentos || []).filter((d) => d.tipo === tipo && igual(Number(d.saldo) || 0, abs));
    if (cand.length) {
      const seguros = cand.map((d) => ({ d: d, por: segunda(d) })).filter((x) => x.por);
      const clase = monto > 0 ? 'cobro' : 'pago';
      if (seguros.length === 1) {
        const d = seguros[0].d;
        return { clase: clase, seguro: true, libro_fiscal_id: d.id, tercero_nombre: d.tercero || null, tercero_rif: d.rif || null,
          motivo: 'Monto de la factura ' + (d.numero || '') + ' y ' + seguros[0].por + '.' };
      }
      return { clase: clase, seguro: false, libro_fiscal_id: cand.length === 1 ? cand[0].id : null,
        motivo: cand.length === 1 ? 'Solo coincide el monto con la factura ' + (cand[0].numero || '') + ': revísala.'
          : 'Solo coincide el monto, con ' + cand.length + ' facturas: elige cuál.' };
    }

    // Transferencia entre bancos propios: el monto contrario en otro banco, a 3 días o menos.
    const par = (ctx.otrasLineas || []).find((o) => igual(Number(o.monto) || 0, -monto) && dias(o.fecha, linea.fecha) <= 3);
    if (par) {
      return { clase: 'transferencia', seguro: false, extracto_par_id: par.id, cuenta_contra: par.cuenta_contable,
        motivo: 'Hay un movimiento contrario por el mismo monto en otro de tus bancos.' };
    }
    return null;
  }
  window.__sugerirLinea = sugerirLinea;
})();
