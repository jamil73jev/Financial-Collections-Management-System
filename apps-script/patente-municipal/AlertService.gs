/**
 * AlertService.gs
 * Motor de alertas del sistema SIGECO.
 * Evalúa condiciones de alerta y actualiza ALERTA_ESTADO en EXPEDIENTES.
 * Puede ejecutarse manualmente o como trigger programado.
 */

/**
 * Ejecuta el ciclo completo de verificación de alertas.
 * Actualiza ALERTA_ESTADO en todos los expedientes activos.
 * @param {string} token
 * @returns {{ ok: boolean, resumen?: Object, error?: string }}
 */
function checkAlerts(token) {
  const acceso = checkAccess(token, 'VERIFICAR_INTEGRIDAD');
  if (!acceso.ok) return acceso;

  return _ejecutarCicloAlertas(token);
}

/**
 * Versión sin token para uso interno/trigger programado.
 * Solo llamar desde funciones de mantenimiento.
 */
function checkAlertsInterno() {
  _ejecutarCicloAlertas(null);
}

/**
 * Retorna resumen de alertas activas para el dashboard.
 * @param {string} token
 * @returns {{ ok: boolean, alertas?: Object, error?: string }}
 */
function getAlertSummary(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  const resumen = {
    ok:            0,
    sinMovimiento: 0,
    proximoVencer: 0,
    vencido:       0,
    critico:       0,
    total:         0
  };

  expedientes.forEach(e => {
    const alerta = e.ALERTA_ESTADO || 'OK';
    if (resumen[alerta.toLowerCase()] !== undefined) {
      resumen[alerta.toLowerCase()]++;
    } else if (alerta === 'PROXIMO_VENCER') {
      resumen.proximoVencer++;
    } else if (alerta === 'SIN_MOVIMIENTO') {
      resumen.sinMovimiento++;
    } else {
      resumen.ok++;
    }
    resumen.total++;
  });

  // Recalcular con claves correctas
  const conteo = { OK: 0, SIN_MOVIMIENTO: 0, PROXIMO_VENCER: 0, VENCIDO: 0, CRITICO: 0 };
  expedientes.forEach(e => {
    const alerta = e.ALERTA_ESTADO || 'OK';
    if (conteo[alerta] !== undefined) conteo[alerta]++;
    else conteo.OK++;
  });

  return {
    ok: true,
    alertas: {
      total:         expedientes.length,
      ok:            conteo.OK,
      sinMovimiento: conteo.SIN_MOVIMIENTO,
      proximoVencer: conteo.PROXIMO_VENCER,
      vencido:       conteo.VENCIDO,
      critico:       conteo.CRITICO
    }
  };
}

/**
 * Instala trigger para ejecutar alertas automáticamente cada día.
 */
function installAlertTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkAlertsInterno')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('checkAlertsInterno')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  Logger.log('Trigger de alertas instalado (diario 7am).');
}

// ============================================================
// FUNCIÓN INTERNA DE CICLO
// ============================================================

function _ejecutarCicloAlertas(token) {
  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  const diasAlerta = getDiasAlerta();
  const ahora      = new Date();

  const conteo = { OK: 0, SIN_MOVIMIENTO: 0, PROXIMO_VENCER: 0, VENCIDO: 0, CRITICO: 0 };
  let actualizados = 0;

  // Calculamos todos los cambios en memoria y los escribimos en un solo lote
  // al final (antes hacía updateRowFields por cada expediente activo — con
  // varios miles de expedientes esto excede el límite de 6 minutos de
  // ejecución de Apps Script, y este ciclo corre automáticamente cada
  // madrugada vía trigger, así que un timeout aquí pasa desapercibido).
  const actualizaciones = [];

  expedientes.forEach(exp => {
    // Calcular días sin movimiento
    const fechaRef = exp.FECHA_ULTIMA_GESTION || exp.FECHA_ASIGNACION;
    let dias       = parseInt(exp.DIAS_SIN_MOVIMIENTO) || 0;

    if (fechaRef) {
      const fechaUlt = new Date(fechaRef);
      if (!isNaN(fechaUlt.getTime())) {
        dias = Math.floor((ahora - fechaUlt) / (1000 * 60 * 60 * 24));
      }
    }

    const nuevaAlerta = _calcularAlerta(exp, dias, ahora, diasAlerta);
    const alertaActual = exp.ALERTA_ESTADO || 'OK';

    const cambios = { DIAS_SIN_MOVIMIENTO: dias };
    if (nuevaAlerta !== alertaActual) {
      cambios.ALERTA_ESTADO = nuevaAlerta;
    }

    actualizaciones.push({ rowIndex: exp._rowIndex, campos: cambios });

    if (conteo[nuevaAlerta] !== undefined) conteo[nuevaAlerta]++;
    actualizados++;
  });

  if (actualizaciones.length > 0) {
    batchUpdateRows(SHEET_NAMES.EXPEDIENTES, actualizaciones);
  }

  if (token) {
    logAction({
      token,
      hoja:    SHEET_NAMES.EXPEDIENTES,
      accion:  'CICLO_ALERTAS',
      contexto: JSON.stringify(conteo),
      origen:  'AlertService.gs'
    });
  }

  Logger.log('Ciclo alertas: ' + JSON.stringify(conteo));
  return { ok: true, resumen: { ...conteo, actualizados } };
}

function _calcularAlerta(exp, dias, ahora, diasAlerta) {
  if (esEstadoTerminal(exp.ESTADO_EXPEDIENTE)) return 'OK';

  if (dias >= diasAlerta.critico) return 'CRITICO';

  if (exp.FECHA_PROXIMA_GESTION) {
    const fpg = new Date(exp.FECHA_PROXIMA_GESTION);
    if (!isNaN(fpg.getTime())) {
      if (fpg < ahora) return 'VENCIDO';
      const diasHasta = Math.floor((fpg - ahora) / (1000 * 60 * 60 * 24));
      if (diasHasta <= diasAlerta.proximoVencer) return 'PROXIMO_VENCER';
    }
  }

  if (dias >= diasAlerta.sinMovimiento) return 'SIN_MOVIMIENTO';

  return 'OK';
}


