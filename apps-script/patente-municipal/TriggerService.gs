/**
 * TriggerService.gs
 * Gestión centralizada de triggers automáticos del sistema.
 * Patrón: idempotente — elimina triggers previos antes de crear nuevos.
 *
 * TRIGGERS INSTALADOS:
 *   2:00 AM — installBackupTrigger()       (en BackupService.gs)
 *   6:00 AM — importCSVFromDrive()         ETL desde Google Drive
 *   7:00 AM — calcDiasSinMovimientoAuto()  Recalcula alertas
 *   cada 4h — limpiarSesionesExpiradas()   Limpieza de sesiones
 */

/**
 * Instala TODOS los triggers del sistema.
 * Ejecutar desde Setup.gs o manualmente si se necesita reinstalar.
 */
function installAllTriggers() {
  installDriveImportTrigger();
  installAlertCalculationTrigger();
  installSessionCleanupTrigger();
  if (typeof installBackupTrigger === 'function') installBackupTrigger();

  Logger.log('=== Triggers instalados: ===');
  listarTriggers();
}

/** Trigger ETL: importa CSVs de Google Drive a Sheets (6:00 AM diario). */
function installDriveImportTrigger() {
  _removeTrigger('importCSVFromDrive');
  ScriptApp.newTrigger('importCSVFromDrive')
    .timeBased().everyDays(1).atHour(6).create();
  Logger.log('✅ DriveImport: 6:00 AM diario');
}

/** Trigger Alertas: recalcula DIAS_SIN_MOVIMIENTO y ALERTA_ESTADO (7:00 AM diario). */
function installAlertCalculationTrigger() {
  _removeTrigger('calcDiasSinMovimientoAutomatico');
  ScriptApp.newTrigger('calcDiasSinMovimientoAutomatico')
    .timeBased().everyDays(1).atHour(7).create();
  Logger.log('✅ AlertCalculation: 7:00 AM diario (después del ETL)');
}

/** Trigger Sesiones: limpia sesiones expiradas (cada 4 horas). */
function installSessionCleanupTrigger() {
  _removeTrigger('limpiarSesionesExpiradas');
  ScriptApp.newTrigger('limpiarSesionesExpiradas')
    .timeBased().everyHours(4).create();
  Logger.log('✅ SessionCleanup: cada 4 horas');
}

/** Elimina un trigger por nombre de función (previene duplicados). */
function _removeTrigger(functionName) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === functionName)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** Lista todos los triggers instalados (útil para verificar). */
function listarTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('Total triggers: ' + triggers.length);
  triggers.forEach(t => Logger.log('  • ' + t.getHandlerFunction()));
}

/**
 * Recalcula alertas para todos los expedientes activos.
 * Versión sin token — diseñada para uso de trigger automático.
 * Reutiliza la misma lógica de negocio del sistema.
 */
function calcDiasSinMovimientoAutomatico() {
  try {
    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
      .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

    const ahora        = new Date();
    let   actualizados = 0;
    const diasCritico  = parseInt(PARAMS.DIAS_ALERTA_CRITICO)        || 30;
    const diasSinMov   = parseInt(PARAMS.DIAS_ALERTA_SIN_MOVIMIENTO) || 15;
    const diasProxVenc = parseInt(PARAMS.DIAS_ALERTA_PROXIMO_VENCER) || 3;

    expedientes.forEach(exp => {
      const fechaRef = exp.FECHA_ULTIMA_GESTION || exp.FECHA_ASIGNACION;
      const fecha    = fechaRef ? new Date(fechaRef) : null;
      const dias     = fecha && !isNaN(fecha)
        ? Math.floor((ahora - fecha) / 86400000)
        : 0;

      let alerta = 'OK';
      if (exp.FECHA_PROXIMA_GESTION) {
        const fp = new Date(exp.FECHA_PROXIMA_GESTION);
        if (!isNaN(fp)) {
          if (fp < ahora) {
            alerta = 'VENCIDO';
          } else if (Math.floor((fp - ahora) / 86400000) <= diasProxVenc) {
            alerta = 'PROXIMO_VENCER';
          }
        }
      }
      if (alerta === 'OK') {
        if      (dias >= diasCritico) alerta = 'CRITICO';
        else if (dias >= diasSinMov)  alerta = 'SIN_MOVIMIENTO';
      }

      if (String(dias) !== String(exp.DIAS_SIN_MOVIMIENTO) || alerta !== exp.ALERTA_ESTADO) {
        updateRowFields(SHEET_NAMES.EXPEDIENTES, exp._rowIndex, {
          DIAS_SIN_MOVIMIENTO: dias,
          ALERTA_ESTADO:       alerta
        });
        actualizados++;
      }
    });

    invalidarCacheDashboard();

    logActionSystem({
      hoja:     SHEET_NAMES.EXPEDIENTES,
      accion:   'CALCULO_ALERTAS_AUTO',
      contexto: 'Actualizados: ' + actualizados + ' / ' + expedientes.length,
      origen:   'TriggerService.gs'
    });

    Logger.log('✅ AlertCalculation: ' + actualizados + ' expedientes actualizados.');

  } catch (err) {
    Logger.log('❌ calcDiasSinMovimientoAutomatico: ' + err.message);
    logActionSystem({
      hoja:     SHEET_NAMES.EXPEDIENTES,
      accion:   'CALCULO_ALERTAS_ERROR',
      contexto: err.message,
      origen:   'TriggerService.gs'
    });
  }
}

