/**
 * AutomationService.gs
 * Módulo encargado de la automatización de procesos de negocio.
 * Principalmente: Conciliación automática de pagos desde el padrón ETL.
 *
 * Flujo ETL:
 *   1. DriveImportService importa el CSV fresco de CONTRIBUYENTES (6am)
 *   2. runAutomaticReconciliation() compara la deuda actualizada vs. EXPEDIENTES
 *   3. RUC desaparecido o deuda = 0  → cierre total (CERRADO_EXITOSO via PagoService)
 *   4. Deuda disminuyó              → pago parcial (abono registrado en PAGOS)
 *   5. Sin cambio                   → sin acción
 */

function runAutomaticReconciliation() {
  try {
    Logger.log('=== INICIANDO CONCILIACIÓN AUTOMÁTICA DE PAGOS ===');

    // ── 1. Foto actual de la deuda en el padrón ──────────────
    const contribuyentes = getDataAsObjects(SHEET_NAMES.CONTRIBUYENTES);

    // Mapa RUC → deuda actual (0 si ya no aparece = pagó todo)
    const deudaActualPorRUC = {};
    contribuyentes.forEach(c => {
      if (!c.RUC) return;
      const deuda = parseFloat(String(c.TOTAL_DEUDA || 0).replace(/,/g, '.')) || 0;
      const ruc   = String(c.RUC).trim();
      // Conservar la deuda mayor si hay duplicados de RUC
      if (deudaActualPorRUC[ruc] === undefined || deuda > deudaActualPorRUC[ruc]) {
        deudaActualPorRUC[ruc] = deuda;
      }
    });

    // ── 2. Obtener expedientes activos en gestión ─────────────
    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
    const ESTADOS_ACTIVOS = ['EN_GESTION', 'PENDIENTE_ASIGNACION', 'GESTION_PAUSADA', 'COMPROMETIDO_PAGO'];

    const activos = expedientes.filter(e =>
      (e.ACTIVO === 'TRUE' || e.ACTIVO === true) &&
      ESTADOS_ACTIVOS.includes(e.ESTADO_EXPEDIENTE)
    );

    if (activos.length === 0) {
      Logger.log('Sin expedientes activos para conciliar.');
      return { ok: true, cierres: 0, abonos: 0 };
    }

    let cierres = 0;
    let abonos  = 0;
    const ahora = new Date();

    activos.forEach(exp => {
      const ruc         = String(exp.RUC || '').trim();
      const saldoActual = parseFloat(exp.SALDO_PENDIENTE);
      const saldoRef    = isNaN(saldoActual) ? (parseFloat(exp.TOTAL_DEUDA) || 0) : saldoActual;

      // Si el RUC ya no está en el padrón → deuda saldada (pago total)
      if (deudaActualPorRUC[ruc] === undefined || deudaActualPorRUC[ruc] <= 0) {
        if (saldoRef > 0) {
          // Registrar el pago del saldo restante
          try {
            _registrarPagoInterno({
              idExpediente:  exp.ID_EXPEDIENTE,
              ruc,
              monto:         saldoRef,
              tipoPago:      'PAGO_TOTAL',
              referencia:    'Conciliación automática ETL — deuda saldada en padrón',
              registradoPor: 'SISTEMA_ETL',
              fuente:        'ETL_AUTOMATICO',
              fechaPago:     ahora,
              exp,
              token:         null
            });
            cierres++;
            Logger.log('PAGO_TOTAL ETL: ' + exp.ID_EXPEDIENTE + ' (' + ruc + ') monto: ' + saldoRef);
          } catch (ePago) {
            Logger.log('Error registrando pago ETL total para ' + exp.ID_EXPEDIENTE + ': ' + ePago.message);
          }
        }
        return;
      }

      // Si la deuda actual es menor al saldo pendiente → pago parcial
      const deudaNueva = deudaActualPorRUC[ruc];
      if (deudaNueva < saldoRef) {
        const montoAbonado = parseFloat((saldoRef - deudaNueva).toFixed(2));
        if (montoAbonado > 0.01) { // ignorar diferencias centavos por redondeo
          try {
            _registrarPagoInterno({
              idExpediente:  exp.ID_EXPEDIENTE,
              ruc,
              monto:         montoAbonado,
              tipoPago:      'ABONO',
              referencia:    'Abono detectado por ETL — deuda redujo de ' + saldoRef + ' a ' + deudaNueva,
              registradoPor: 'SISTEMA_ETL',
              fuente:        'ETL_AUTOMATICO',
              fechaPago:     ahora,
              exp,
              token:         null
            });
            abonos++;
            Logger.log('ABONO ETL: ' + exp.ID_EXPEDIENTE + ' abono: ' + montoAbonado +
                       ' (saldo ' + saldoRef + ' → ' + deudaNueva + ')');
          } catch (ePago) {
            Logger.log('Error registrando abono ETL para ' + exp.ID_EXPEDIENTE + ': ' + ePago.message);
          }
        }
      }
    });

    logActionSystem({
      hoja:    SHEET_NAMES.EXPEDIENTES,
      accion:  'CONCILIACION_AUTOMATICA_ETL',
      contexto: 'Cierres: ' + cierres + ' | Abonos: ' + abonos,
      origen:  'AutomationService.gs'
    });

    invalidarCacheDashboard();
    if (typeof invalidarCacheMaestro === 'function') invalidarCacheMaestro();

    Logger.log('=== CONCILIACIÓN FINALIZADA === Cierres: ' + cierres + ' | Abonos: ' + abonos);
    return { ok: true, cierres, abonos };

  } catch (err) {
    Logger.log('runAutomaticReconciliation ERROR: ' + err.message + '\n' + err.stack);
    logActionSystem({
      hoja:    SHEET_NAMES.EXPEDIENTES,
      accion:  'ERROR_CONCILIACION_ETL',
      contexto: err.message,
      origen:  'AutomationService.gs'
    });
    return { ok: false, error: err.message };
  }
}
