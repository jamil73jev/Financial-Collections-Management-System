/**
 * PagoService.gs
 * Módulo de pagos y conciliación para SIGECO.
 * Gestiona el registro de pagos (parciales/totales), actualización de saldos
 * y cierre automático de expedientes al saldar la deuda.
 *
 * Permisos: Solo SUPERVISOR y ADMINISTRADOR pueden registrar pagos.
 * El ETL automático también escribe pagos via _registrarPagoInterno().
 */

// ============================================================
// REGISTRO MANUAL DE PAGO
// ============================================================

/**
 * Registra un pago (parcial o total) sobre un expediente.
 * Actualiza SALDO_PENDIENTE y cierra el expediente si queda en cero.
 *
 * @param {string} token
 * @param {Object} datos
 *   datos.idExpediente   — ID del expediente
 *   datos.monto          — monto pagado (número > 0)
 *   datos.tipoPago       — 'ABONO' | 'PAGO_TOTAL' | 'CUOTA_CONVENIO'
 *   datos.referencia     — N° comprobante u observación (opcional)
 *   datos.fechaPago      — fecha ISO (default: hoy)
 * @returns {{ ok, saldoPendiente?, porcentaje?, cerradoAutomaticamente?, error? }}
 */
function registrarPago(token, datos) {
  const acceso = checkAccess(token, 'REGISTRAR_PAGO');
  if (!acceso.ok) return acceso;
  const sesion = acceso.sesion;

  if (!datos) return { ok: false, error: 'Datos de pago requeridos. Esta función debe llamarse desde la web, no desde el editor.' };
  if (!datos.idExpediente) return { ok: false, error: 'idExpediente requerido.' };
  const monto = parseFloat(datos.monto);
  if (!monto || monto <= 0) return { ok: false, error: 'El monto debe ser mayor a cero.' };

  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
  const exp = expedientes.find(e => e.ID_EXPEDIENTE === datos.idExpediente);
  if (!exp) return { ok: false, error: 'Expediente no encontrado: ' + datos.idExpediente };

  if (esEstadoTerminal(exp.ESTADO_EXPEDIENTE)) {
    return { ok: false, error: 'El expediente ya está cerrado (' + exp.ESTADO_EXPEDIENTE + ').' };
  }

  const ahora       = new Date();
  const fechaPago   = datos.fechaPago ? new Date(datos.fechaPago) : ahora;
  const tipoPago    = datos.tipoPago || 'ABONO';

  const resultado = _registrarPagoInterno({
    idExpediente: datos.idExpediente,
    ruc:          exp.RUC || '',
    monto,
    tipoPago,
    referencia:   datos.referencia || '',
    registradoPor: sesion.usuario,
    fuente:       'MANUAL',
    fechaPago,
    exp,
    token
  });

  logAction({
    token,
    hoja:         SHEET_NAMES.PAGOS,
    idExpediente: datos.idExpediente,
    accion:       'REGISTRAR_PAGO_MANUAL',
    contexto:     'Monto: ' + monto + ' | Tipo: ' + tipoPago,
    origen:       'PagoService.gs'
  });

  invalidarCacheDashboard();
  if (typeof invalidarCacheMaestro === 'function') invalidarCacheMaestro();

  return resultado;
}

// ============================================================
// DASHBOARD DE CONCILIACIÓN
// ============================================================

/**
 * Retorna todos los datos para el módulo de conciliación.
 * @param {string} token
 * @returns {{ ok, kpis, tendencia, gestores, pagosRecientes, expedientes }}
 */
function getConciliacionDashboard(token) {
  const acceso = checkAccess(token, 'VER_SEGUIMIENTO');
  if (!acceso.ok) return acceso;

  // ── Caché: 3 minutos (se invalida automáticamente al registrar pagos) ──
  const _cache    = CacheService.getScriptCache();
  const _cacheKey = 'conciliacion_dashboard';
  try {
    const cached = _cache.get(_cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* JSON corrupto — recalcular */ }
  // ─────────────────────────────────────────────────────────────────────

  try {
    const todosExp  = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
    const pagos     = getDataAsObjects(SHEET_NAMES.PAGOS);
    const usuarios  = getDataAsObjects(SHEET_NAMES.USUARIOS);

    // Mapa correo → nombre de usuario
    const mapaUsuarios = {};
    usuarios.forEach(u => {
      if (u.CORREO_INSTITUCIONAL) mapaUsuarios[u.CORREO_INSTITUCIONAL] = u.NOMBRE || u.CORREO_INSTITUCIONAL;
    });

    // ── KPIs globales ───────────────────────────────────────
    const deudaOriginalTotal   = todosExp.reduce((s, e) => s + (parseFloat(e.TOTAL_DEUDA) || 0), 0);
    const montoRecaudadoTotal  = pagos.reduce((s, p) => s + (parseFloat(p.MONTO_PAGADO) || 0), 0);
    const saldoPendienteTotal  = todosExp
      .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true)
      .reduce((s, e) => {
        const saldo = parseFloat(e.SALDO_PENDIENTE);
        return s + (isNaN(saldo) ? (parseFloat(e.TOTAL_DEUDA) || 0) : saldo);
      }, 0);
    const cerradosPago = todosExp.filter(e => e.ESTADO_EXPEDIENTE === 'CERRADO_EXITOSO').length;
    const conPagoParcial = todosExp.filter(e =>
      (e.ACTIVO === 'TRUE' || e.ACTIVO === true) &&
      parseFloat(e.MONTO_PAGADO) > 0 &&
      e.ESTADO_EXPEDIENTE !== 'CERRADO_EXITOSO'
    ).length;

    // ── Tendencia por mes (últimos 6 meses) ─────────────────
    const porMes = {};
    pagos.forEach(p => {
      const mes = String(p.FECHA_PAGO || '').substring(0, 7);
      if (!mes || mes.length < 7) return;
      if (!porMes[mes]) porMes[mes] = { mes, recaudado: 0, cantidad: 0 };
      porMes[mes].recaudado += parseFloat(p.MONTO_PAGADO) || 0;
      porMes[mes].cantidad++;
    });
    const tendencia = Object.values(porMes)
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .slice(-6)
      .map(t => ({ ...t, recaudado: parseFloat(t.recaudado.toFixed(2)) }));

    // ── Stats por gestor (solo expedientes activos) ──────────
    const porGestor = {};
    todosExp.filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true).forEach(e => {
      const correo = e.FUNCIONARIO_ASIGNADO || '';
      if (!correo) return;
      if (!porGestor[correo]) porGestor[correo] = {
        correo,
        nombre:         mapaUsuarios[correo] || correo.split('@')[0],
        totalAsignados: 0,
        cerradosPago:   0,
        montoRecaudado: 0,
        saldoPendiente: 0
      };
      const g = porGestor[correo];
      g.totalAsignados++;
      if (e.ESTADO_EXPEDIENTE === 'CERRADO_EXITOSO') g.cerradosPago++;
      g.montoRecaudado += parseFloat(e.MONTO_PAGADO) || 0;
      const saldo = parseFloat(e.SALDO_PENDIENTE);
      g.saldoPendiente += isNaN(saldo) ? (parseFloat(e.TOTAL_DEUDA) || 0) : saldo;
    });

    const gestores = Object.values(porGestor)
      .map(g => ({
        ...g,
        montoRecaudado: parseFloat(g.montoRecaudado.toFixed(2)),
        saldoPendiente: parseFloat(g.saldoPendiente.toFixed(2)),
        efectividad:    g.totalAsignados > 0
          ? parseFloat((g.cerradosPago / g.totalAsignados * 100).toFixed(1))
          : 0
      }))
      .sort((a, b) => b.montoRecaudado - a.montoRecaudado);

    // ── Pagos recientes ──────────────────────────────────────
    const pagosRecientes = pagos
      .sort((a, b) => new Date(b.TIMESTAMP || 0) - new Date(a.TIMESTAMP || 0))
      .slice(0, 50)
      .map(p => ({
        id:           String(p.ID_PAGO || ''),
        fecha:        String(p.FECHA_PAGO || '').substring(0, 10),
        idExpediente: String(p.ID_EXPEDIENTE || ''),
        ruc:          String(p.RUC || ''),
        monto:        parseFloat(p.MONTO_PAGADO) || 0,
        tipo:         String(p.TIPO_PAGO || ''),
        referencia:   String(p.REFERENCIA || ''),
        registradoPor: String(p.REGISTRADO_POR || ''),
        fuente:       String(p.FUENTE || '')
      }));

    // ── Lista de expedientes con estado de pago ──────────────
    const listaExpedientes = todosExp
      .filter(e => parseFloat(e.TOTAL_DEUDA) > 0)
      .map(e => {
        const saldo  = parseFloat(e.SALDO_PENDIENTE);
        const pagado = parseFloat(e.MONTO_PAGADO) || 0;
        const deuda  = parseFloat(e.TOTAL_DEUDA) || 0;
        const saldoFinal = isNaN(saldo) ? deuda - pagado : saldo;
        const porcentaje = deuda > 0 ? parseFloat(((pagado / deuda) * 100).toFixed(1)) : 0;
        return {
          id:             String(e.ID_EXPEDIENTE || ''),
          contribuyente:  String(e.CONTRIBUYENTE || ''),
          ruc:            String(e.RUC || ''),
          gestor:         String(e.FUNCIONARIO_ASIGNADO || ''),
          nombreGestor:   mapaUsuarios[e.FUNCIONARIO_ASIGNADO] || (e.FUNCIONARIO_ASIGNADO || '').split('@')[0],
          deudaOriginal:  deuda,
          montoRecaudado: parseFloat(pagado.toFixed(2)),
          saldoPendiente: parseFloat(Math.max(0, saldoFinal).toFixed(2)),
          porcentaje,
          estado:         String(e.ESTADO_EXPEDIENTE || ''),
          activo:         e.ACTIVO === 'TRUE' || e.ACTIVO === true,
          fechaUltimoPago: String(e.FECHA_ULTIMO_PAGO || '').substring(0, 10)
        };
      });

    const resultado = {
      ok: true,
      kpis: {
        deudaOriginalTotal:   parseFloat(deudaOriginalTotal.toFixed(2)),
        montoRecaudadoTotal:  parseFloat(montoRecaudadoTotal.toFixed(2)),
        saldoPendienteTotal:  parseFloat(saldoPendienteTotal.toFixed(2)),
        porcentajeRecuperacion: deudaOriginalTotal > 0
          ? parseFloat((montoRecaudadoTotal / deudaOriginalTotal * 100).toFixed(1))
          : 0,
        expedientesCerradosPago: cerradosPago,
        expedientesConPagoParcial: conPagoParcial,
        totalPagosRegistrados: pagos.length
      },
      tendencia,
      gestores,
      pagosRecientes,
      expedientes: listaExpedientes
    };

    // Guardar en caché por 3 minutos
    try { _cache.put(_cacheKey, JSON.stringify(resultado), 180); } catch (e) {}

    return resultado;

  } catch (err) {
    Logger.log('getConciliacionDashboard ERROR: ' + err.message + '\n' + err.stack);
    return { ok: false, error: 'Error cargando datos de conciliación: ' + err.message };
  }
}

// ============================================================
// SETUP / MIGRACIÓN
// ============================================================

/**
 * Crea la hoja PAGOS y agrega columnas de recaudación en EXPEDIENTES.
 * Ejecutar UNA VEZ desde la consola GAS después de importar el proyecto.
 */
function setupConciliacion() {
  Logger.log('=== setupConciliacion() ===');
  const ss = getSpreadsheet();

  // ── Crear hoja PAGOS si no existe ────────────────────────
  let hojaPagos = ss.getSheetByName(SHEET_NAMES.PAGOS);
  if (!hojaPagos) {
    hojaPagos = ss.insertSheet(SHEET_NAMES.PAGOS);
    hojaPagos.appendRow(HEADERS.PAGOS);
    const headerRange = hojaPagos.getRange(1, 1, 1, HEADERS.PAGOS.length);
    headerRange.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
    Logger.log('OK: hoja PAGOS creada');
  } else {
    Logger.log('OK: hoja PAGOS ya existe');
  }

  // ── Agregar columnas de recaudación en EXPEDIENTES ───────
  const hojaExp    = ss.getSheetByName(SHEET_NAMES.EXPEDIENTES);
  const headerRow  = hojaExp.getRange(1, 1, 1, hojaExp.getLastColumn()).getValues()[0];
  const colsNuevas = ['MONTO_PAGADO', 'SALDO_PENDIENTE', 'PORCENTAJE_RECUPERADO', 'FECHA_ULTIMO_PAGO'];

  colsNuevas.forEach(col => {
    if (!headerRow.includes(col)) {
      const nextCol = hojaExp.getLastColumn() + 1;
      hojaExp.getRange(1, nextCol).setValue(col)
        .setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
      // Inicializar filas existentes
      const lastRow = hojaExp.getLastRow();
      if (lastRow > 1) {
        if (col === 'MONTO_PAGADO' || col === 'PORCENTAJE_RECUPERADO') {
          hojaExp.getRange(2, nextCol, lastRow - 1, 1).setValue(0);
        } else if (col === 'SALDO_PENDIENTE') {
          // Copiar TOTAL_DEUDA como saldo inicial
          const idxDeuda = headerRow.indexOf('TOTAL_DEUDA') + 1;
          if (idxDeuda > 0) {
            const deudas = hojaExp.getRange(2, idxDeuda, lastRow - 1, 1).getValues();
            hojaExp.getRange(2, nextCol, lastRow - 1, 1).setValues(deudas);
          } else {
            hojaExp.getRange(2, nextCol, lastRow - 1, 1).setValue(0);
          }
        } else {
          hojaExp.getRange(2, nextCol, lastRow - 1, 1).setValue('');
        }
      }
      Logger.log('OK: columna ' + col + ' agregada en EXPEDIENTES');
    } else {
      Logger.log('OK: columna ' + col + ' ya existe en EXPEDIENTES');
    }
  });

  Logger.log('=== setupConciliacion() COMPLETO ===');
  return { ok: true, mensaje: 'Setup de conciliación completado. Ver logs para detalles.' };
}

// ============================================================
// FUNCIÓN INTERNA — usada por PagoService y AutomationService
// ============================================================

/**
 * Escribe en PAGOS y actualiza EXPEDIENTES (saldo, porcentaje, cierre).
 * @param {Object} params
 * @returns {{ ok, saldoPendiente, porcentaje, cerradoAutomaticamente }}
 */
function _registrarPagoInterno(params) {
  const { idExpediente, ruc, monto, tipoPago, referencia,
          registradoPor, fuente, fechaPago, exp, token } = params;

  const ahora     = fechaPago || new Date();
  const ahoraISO  = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const prefijo   = getConfig('PREFIJO_GESTION', 'GES');
  const idPago    = 'PAG-' + Utilities.formatDate(new Date(), PARAMS.TIMEZONE, 'yyyyMMddHHmmss') +
                    '-' + Math.floor(Math.random() * 1000);

  const fechaPagoStr = Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd");

  // Escribir en hoja PAGOS
  appendRow(SHEET_NAMES.PAGOS, [
    idPago,          // ID_PAGO
    fechaPagoStr,    // FECHA_PAGO
    idExpediente,    // ID_EXPEDIENTE
    ruc,             // RUC
    monto,           // MONTO_PAGADO
    tipoPago,        // TIPO_PAGO
    referencia,      // REFERENCIA
    registradoPor,   // REGISTRADO_POR
    fuente,          // FUENTE
    ahoraISO         // TIMESTAMP
  ]);

  // Recalcular saldos en EXPEDIENTES
  const pagadoAnterior = parseFloat(exp.MONTO_PAGADO) || 0;
  const deudaOriginal  = parseFloat(exp.TOTAL_DEUDA) || 0;
  const nuevoPagado    = pagadoAnterior + monto;
  const saldoNuevo     = parseFloat(Math.max(0, deudaOriginal - nuevoPagado).toFixed(2));
  const porcentaje     = deudaOriginal > 0
    ? parseFloat((nuevoPagado / deudaOriginal * 100).toFixed(1))
    : 0;

  updateRowFields(SHEET_NAMES.EXPEDIENTES, exp._rowIndex, {
    MONTO_PAGADO:           parseFloat(nuevoPagado.toFixed(2)),
    SALDO_PENDIENTE:        saldoNuevo,
    PORCENTAJE_RECUPERADO:  Math.min(100, porcentaje),
    FECHA_ULTIMO_PAGO:      fechaPagoStr
  });

  // Cierre automático si deuda saldada
  let cerradoAutomaticamente = false;
  if (saldoNuevo <= 0) {
    updateRowFields(SHEET_NAMES.EXPEDIENTES, exp._rowIndex, {
      ESTADO_EXPEDIENTE: 'CERRADO_EXITOSO',
      ACTIVO:            'FALSE'
    });
    cerradoAutomaticamente = true;

    logActionSystem({
      hoja:         SHEET_NAMES.EXPEDIENTES,
      idExpediente,
      accion:       'CIERRE_AUTOMATICO_PAGO',
      contexto:     'Deuda saldada. Pago: ' + monto + ' | Fuente: ' + fuente,
      origen:       'PagoService.gs'
    });

    // Notificar si es pago manual con token
    if (token && fuente === 'MANUAL' && typeof enviarConfirmacionCierre === 'function') {
      try { enviarConfirmacionCierre(registradoPor, exp); } catch (e) { /* no bloquear */ }
    }
  }

  return {
    ok:                     true,
    idPago,
    saldoPendiente:         saldoNuevo,
    porcentaje:             Math.min(100, porcentaje),
    cerradoAutomaticamente
  };
}

// ============================================================
// MACHEO DE PAGOS DESDE HOJA EXTERNA
// ============================================================

/**
 * Previsualiza el cruce entre una hoja de pagos y los expedientes SIGECO.
 * NO registra nada — categoriza: matcheados, ambiguos, sinMatch, duplicados.
 */
function previewMacheoDesdeHoja(token, spreadsheetId, sheetName) {
  const acceso = checkAccess(token, 'REGISTRAR_PAGO');
  if (!acceso.ok) return acceso;
  if (!spreadsheetId) return { ok: false, error: 'Se requiere el ID del Google Sheets.' };

  try {
    const ss   = SpreadsheetApp.openById(spreadsheetId);
    const hoja = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
    if (!hoja) return { ok: false, error: 'Hoja no encontrada: ' + (sheetName || 'primera hoja') };

    const datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return { ok: false, error: 'La hoja no tiene datos.' };

    const headers  = datos[0].map(h => String(h).trim().toUpperCase().replace(/\s+/g, '_'));
    const idxRUC     = _findColHoja(headers, ['RUC','CEDULA','CEDULA_RUC','IDENTIFICACION','ID_CONTRIBUYENTE']);
    const idxMonto   = _findColHoja(headers, ['SUMA_DE_VALORPAGADONETO','VALORPAGADONETO','MONTO_PAGADO','MONTO','VALOR','VALOR_PAGADO','IMPORTE','VALOR_ABONO']);
    const idxFecha   = _findColHoja(headers, ['ULTIMAFECHAMOVIMIENTO','PRIMERAFECHAMOVIMIENTO','FECHA_PAGO','FECHA','FECHA_DEPOSITO','FECHA_TRANSACCION','FECHA_COBRO']);
    const idxRef     = _findColHoja(headers, ['IDLIQUIDACION','REFERENCIA','COMPROBANTE','NRO_COMPROBANTE','REFERENCIA_BANCARIA','NRO_RECIBO']);
    const idxNombre  = _findColHoja(headers, ['NOMBRECONTRIBUYENTE','NOMBRE','NOMBRE_CONTRIBUYENTE','CONTRIBUYENTE','RAZON_SOCIAL','NOMBRE_DEUDOR']);
    const idxCIC     = _findColHoja(headers, ['CIC','CODIGO_CIC','IDCIC']);
    const idxEstado  = _findColHoja(headers, ['ESTADO_COBRO','ESTADOCOBRO','ESTADO','ESTADO_PAGO']);
    const idxAnio    = _findColHoja(headers, ['ANIO_PAGO','ANIOPAGO','AÑO_PAGO','ANIO','AÑO']);
    const idxImpuesto = _findColHoja(headers, ['TIPO_IMPUESTO','IMPUESTO','TIPO_OBLIGACION']);
    const idxReverso = _findColHoja(headers, ['VALOR_REVERSO','VALORREVERSO','REVERSO','MONTO_REVERSO']);

    if (idxRUC   === -1) return { ok: false, error: 'No se encontro columna RUC. Encabezados: ' + headers.join(', ') };
    if (idxMonto === -1) return { ok: false, error: 'No se encontro columna de monto (Suma de ValorPagadoNeto). Encabezados: ' + headers.join(', ') };

    const todosExp = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);

    const expPorRUC = {};
    todosExp.forEach(exp => {
      const ruc = String(exp.RUC || '').trim();
      if (!ruc) return;
      if (!expPorRUC[ruc]) expPorRUC[ruc] = [];
      expPorRUC[ruc].push(exp);
    });

    const pagosRegistrados = getDataAsObjects(SHEET_NAMES.PAGOS);
    const matcheados = [], ambiguos = [], sinMatch = [], duplicados = [];

    for (let i = 1; i < datos.length; i++) {
      const fila = datos[i];
      const ruc  = String(fila[idxRUC] || '').trim();
      if (!ruc) continue;

      const montoRaw = String(fila[idxMonto] || '0').replace(/,/g,'.').replace(/[^0-9.-]/g,'');
      const monto    = parseFloat(montoRaw) || 0;
      if (monto <= 0) continue;

      const fechaStr     = _formatFechaHoja(idxFecha    >= 0 ? fila[idxFecha]    : null);
      const referencia   = idxRef      >= 0 ? String(fila[idxRef]      || '').trim() : '';
      const nombre       = idxNombre   >= 0 ? String(fila[idxNombre]   || '').trim() : '';
      const cic          = idxCIC      >= 0 ? String(fila[idxCIC]      || '').trim() : '';
      const estadoCobro  = idxEstado   >= 0 ? String(fila[idxEstado]   || '').trim() : '';
      const anioPago     = idxAnio     >= 0 ? String(fila[idxAnio]     || '').trim() : '';
      const impuesto     = idxImpuesto >= 0 ? String(fila[idxImpuesto] || '').trim() : '';
      const valorReverso = idxReverso  >= 0 ? (parseFloat(String(fila[idxReverso]||'0').replace(/,/g,'.')) || 0) : 0;
      const registro     = { fila: i + 1, ruc, monto, fechaPago: fechaStr, referencia, nombre,
                             cic, estadoCobro, anioPago, impuesto, valorReverso };

      const esDuplicado = pagosRegistrados.some(p =>
        String(p.RUC || '').trim() === ruc &&
        Math.abs((parseFloat(p.MONTO_PAGADO) || 0) - monto) < 0.01 &&
        (!fechaStr || String(p.FECHA_PAGO || '').substring(0, 10) === fechaStr.substring(0, 10))
      );
      if (esDuplicado) {
        duplicados.push({ ...registro, motivo: 'Pago ya registrado (RUC + monto + fecha)' });
        continue;
      }

      const expsRUC     = expPorRUC[ruc] || [];
      const expsActivos = expsRUC.filter(e =>
        !esEstadoTerminal(e.ESTADO_EXPEDIENTE) && (e.ACTIVO === 'TRUE' || e.ACTIVO === true)
      );

      if (expsActivos.length === 0) {
        const tieneCerrados = expsRUC.some(e => esEstadoTerminal(e.ESTADO_EXPEDIENTE));
        sinMatch.push({ ...registro, motivo: tieneCerrados
          ? 'RUC existe pero todos los expedientes estan cerrados'
          : 'RUC no encontrado en SIGECO' });
        continue;
      }

      if (expsActivos.length === 1) {
        const exp   = expsActivos[0];
        const saldo = parseFloat(exp.SALDO_PENDIENTE) || parseFloat(exp.TOTAL_DEUDA) || 0;
        matcheados.push({
          ...registro,
          idExpediente:   exp.ID_EXPEDIENTE,
          contribuyente:  exp.CONTRIBUYENTE || '',
          saldoPendiente: parseFloat(saldo.toFixed(2)),
          tipoPago:       monto >= saldo ? 'PAGO_TOTAL' : 'ABONO',
          confianza:      'ALTA',
          seleccionado:   true
        });
        continue;
      }

      const candidatos = expsActivos.map(exp => {
        const saldo = parseFloat(exp.SALDO_PENDIENTE) || parseFloat(exp.TOTAL_DEUDA) || 0;
        return {
          idExpediente:     exp.ID_EXPEDIENTE,
          contribuyente:    exp.CONTRIBUYENTE || '',
          estadoExpediente: exp.ESTADO_EXPEDIENTE,
          saldoPendiente:   parseFloat(saldo.toFixed(2)),
          tipoPago:         monto >= saldo ? 'PAGO_TOTAL' : 'ABONO',
          diferenciaMonto:  Math.abs(saldo - monto)
        };
      });
      candidatos.sort((a, b) => a.diferenciaMonto - b.diferenciaMonto);

      const mejor     = candidatos[0];
      const confianza = mejor.diferenciaMonto < 0.01         ? 'ALTA'
                      : mejor.diferenciaMonto < monto * 0.10 ? 'MEDIA' : 'BAJA';

      ambiguos.push({
        ...registro,
        candidatos,
        idExpedienteSeleccionado: mejor.idExpediente,
        tipoPagoSugerido:         mejor.tipoPago,
        confianza,
        seleccionado:             confianza === 'ALTA'
      });
    }

    return {
      ok: true,
      resumen: {
        total:      matcheados.length + ambiguos.length + sinMatch.length + duplicados.length,
        matcheados: matcheados.length,
        ambiguos:   ambiguos.length,
        sinMatch:   sinMatch.length,
        duplicados: duplicados.length
      },
      matcheados, ambiguos, sinMatch, duplicados
    };

  } catch (err) {
    Logger.log('previewMacheoDesdeHoja ERROR: ' + err.message);
    return { ok: false, error: 'Error accediendo a la hoja: ' + err.message };
  }
}

/**
 * Aplica los pagos confirmados del proceso de macheo.
 */
function aplicarMacheoConfirmado(token, pagosConfirmados) {
  const acceso = checkAccess(token, 'REGISTRAR_PAGO');
  if (!acceso.ok) return acceso;
  const sesion = acceso.sesion;

  if (!Array.isArray(pagosConfirmados) || pagosConfirmados.length === 0)
    return { ok: false, error: 'No hay pagos para aplicar.' };

  const todosExp = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
  const mapaExp  = {};
  todosExp.forEach(e => { mapaExp[e.ID_EXPEDIENTE] = e; });

  let aplicados = 0;
  const errores = [];

  pagosConfirmados.forEach((pago, idx) => {
    const exp = mapaExp[pago.idExpediente];
    if (!exp) { errores.push({ idx, idExpediente: pago.idExpediente, error: 'Expediente no encontrado' }); return; }
    if (esEstadoTerminal(exp.ESTADO_EXPEDIENTE)) {
      errores.push({ idx, idExpediente: pago.idExpediente, error: 'Expediente cerrado: ' + exp.ESTADO_EXPEDIENTE }); return;
    }
    const montoPago = parseFloat(pago.monto);
    if (!(montoPago > 0)) {
      errores.push({ idx, idExpediente: pago.idExpediente, error: 'Monto inválido: ' + pago.monto }); return;
    }
    try {
      const resultado = _registrarPagoInterno({
        idExpediente:  pago.idExpediente,
        ruc:           pago.ruc || exp.RUC || '',
        monto:         montoPago,
        tipoPago:      pago.tipoPago || 'ABONO',
        referencia:    pago.referencia || 'Macheo desde hoja externa',
        registradoPor: sesion.usuario,
        fuente:        'MACHEO_HOJA',
        fechaPago:     pago.fechaPago ? new Date(pago.fechaPago) : new Date(),
        exp,
        token
      });
      if (resultado.ok) {
        aplicados++;
        exp.MONTO_PAGADO    = (parseFloat(exp.MONTO_PAGADO) || 0) + parseFloat(pago.monto);
        exp.SALDO_PENDIENTE = resultado.saldoPendiente;
      } else {
        errores.push({ idx, idExpediente: pago.idExpediente, error: resultado.error || 'Error al registrar' });
      }
    } catch (e) {
      errores.push({ idx, idExpediente: pago.idExpediente, error: e.message });
    }
  });

  logAction({
    token, hoja: SHEET_NAMES.PAGOS, accion: 'MACHEO_PAGOS_HOJA_EXTERNA',
    contexto: 'Aplicados: ' + aplicados + ' | Errores: ' + errores.length,
    origen: 'PagoService.gs'
  });
  invalidarCacheDashboard();
  if (typeof invalidarCacheMaestro === 'function') invalidarCacheMaestro();
  return { ok: true, aplicados, errores };
}

function _findColHoja(headers, nombres) {
  for (const nombre of nombres) {
    const idx = headers.indexOf(nombre);
    if (idx >= 0) return idx;
  }
  return -1;
}

function _formatFechaHoja(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, PARAMS.TIMEZONE, 'yyyy-MM-dd');
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const p = s.split('/');
    return p[2] + '-' + p[1] + '-' + p[0];
  }
  return s;
}