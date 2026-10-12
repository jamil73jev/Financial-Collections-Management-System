/**
 * Scripts/Mantenimiento.gs
 * Utilidades de reparación y mantenimiento de datos para el administrador.
 */

/**
 * Función crítica: Sincroniza retroactivamente la columna VALOR_DEUDA en la hoja EXPEDIENTES.
 * Lee de la hoja CONTRIBUYENTES y mapea por RUC|PERIODO.
 * Ejecutar desde el editor de Apps Script.
 */
function sincronizarDeudaExpedientes_() {
  Logger.log('=== INICIANDO SINCRONIZACIÓN DE DEUDA ===');
  
  const ss = getSpreadsheet_();
  const hojaC = ss.getSheetByName(SHEET_NAMES.CONTRIBUYENTES);
  const hojaE = ss.getSheetByName(SHEET_NAMES.EXPEDIENTES);
  
  if (!hojaC || !hojaE) {
    Logger.log('Error: No se encontraron las hojas necesarias.');
    return;
  }

  // 1. Cargar Contribuyentes para mapear deudas
  const datosC = hojaC.getDataRange().getValues();
  const headersC = datosC[0].map(h => String(h).trim().toUpperCase());
  const colRucC = headersC.indexOf('RUC');
  const colPerC = headersC.indexOf('PERIODO');
  const colDeuC = headersC.indexOf('TOTAL_DEUDA');

  const mapaDeuda = {};
  for (let i = 1; i < datosC.length; i++) {
    const ruc = String(datosC[i][colRucC]).trim();
    const per = String(datosC[i][colPerC]).trim();
    const deu = parseFloat(datosC[i][colDeuC]) || 0;
    mapaDeuda[ruc + '|' + per] = deu;
  }
  Logger.log('Mapa de deudas cargado: ' + Object.keys(mapaDeuda).length + ' registros.');

  // 2. Procesar Expedientes
  const datosE = hojaE.getDataRange().getValues();
  const headersE = datosE[0].map(h => String(h).trim().toUpperCase());
  const colRucE = headersE.indexOf('RUC');
  const colPerE = headersE.indexOf('PERIODO');
  const colActE = headersE.indexOf('ACTIVO');
  const colDeuE = headersE.indexOf('VALOR_DEUDA');

  Logger.log('Indices detectados - RUC: ' + colRucE + ', Periodo: ' + colPerE + ', Activo: ' + colActE + ', Deuda: ' + colDeuE);

  let actualizados = 0;
  const nuevasFilas = [];

  for (let i = 1; i < datosE.length; i++) {
    const fila = datosE[i];
    const ruc = String(fila[colRucE]).trim();
    const per = String(fila[colPerE]).trim();
    const key = ruc + '|' + per;

    // Solo actualizar si la deuda está vacía o es 0
    if (!fila[colDeuE] || fila[colDeuE] === 0) {
      if (mapaDeuda[key]) {
        fila[colDeuE] = mapaDeuda[key];
        actualizados++;
      }
    }
    
    // Asegurar que ACTIVO sea TRUE si está vacío
    if (!fila[colActE]) {
      fila[colActE] = 'TRUE';
    }
  }

  // Escribir cambios en batch (mucho más rápido)
  if (actualizados > 0) {
    hojaE.getRange(2, 1, datosE.length - 1, datosE[0].length).setValues(datosE.slice(1));
    Logger.log('Sincronización completada. Registros actualizados: ' + actualizados);
  } else {
    Logger.log('No se encontraron expedientes que requieran actualización de deuda.');
  }

  // Limpiar caché para que el dashboard se refresque
  if (typeof limpiarCacheGlobal_ === 'function') {
    limpiarCacheGlobal_();
    Logger.log('Caché global invalidado.');
  }
}

