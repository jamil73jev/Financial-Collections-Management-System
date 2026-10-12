/**
 * PowerBIService.gs
 * Servicio de integración con Power BI Desktop.
 * Permite recibir datos empujados desde el script Python de Power BI.
 */

/**
 * Procesa la petición de sincronización de datos.
 * @param {Object} payload { key, action, reemplazar, data }
 * @returns {Object} Respuesta JSON para Power BI
 */
function handlePowerBIRequest(payload) {
  // 1. Validar API Key (leída desde Script Properties — ver SecretsService.gs)
  const apiKey = getPowerBIApiKey();
  if (payload.key !== apiKey) {
    Logger.log('PowerBIService: Intento de acceso con API Key inválida.');
    return { ok: false, error: 'API Key no válida' };
  }

  // 2. Procesar acción
  switch (payload.action) {
    case 'syncMasterData':
      return syncMasterData(payload.data, payload.reemplazar);
    
    default:
      return { ok: false, error: 'Acción PowerBI no reconocida: ' + payload.action };
  }
}

/**
 * Sincroniza datos maestros o de hechos desde Power BI.
 * Si no se especifica el nombre de la hoja, intenta inferirlo o usa una por defecto.
 */
function syncMasterData(data, reemplazar) {
  try {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return { ok: false, error: 'No se recibieron datos' };
    }

    // Determinar la hoja destino (usamos el nombre de la tabla si viene en los campos)
    // Para simplificar, crearemos una hoja llamada 'POWERBI_SYCH' o similar
    // Pero lo mejor es determinarla por el contenido.
    // Como el usuario mostró 'FactDetalleDeclaracion15PorMil', intentamos ver si podemos deducirlo.
    let nombreHoja = 'DATA_POWERBI_IMPORT'; 
    
    // Si la data tiene campos específicos, podemos mapear
    const headers = Object.keys(data[0]);
    if (headers.includes('IdFactDetalleDeclaracion15PorMil')) {
      nombreHoja = 'FACT_DETALLE_15MIL';
    } else if (headers.includes('RUC') && headers.includes('NOMBRE_CONTRIBUYENTE')) {
      nombreHoja = SHEET_NAMES.CONTRIBUYENTES;
    }

    const ss = getSpreadsheet();
    let hoja = ss.getSheetByName(nombreHoja);

    // Crear hoja si no existe
    if (!hoja) {
      hoja = ss.insertSheet(nombreHoja);
      hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
      hoja.setFrozenRows(1);
      // Aplicar formato de cabecera estándar
      const headerRange = hoja.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
    }

    // Transformar JSON a Array de Arrays
    const filas = data.map(obj => headers.map(h => obj[h] || ''));

    if (reemplazar) {
      // Limpiar datos antiguos (excepto header)
      const lastRow = hoja.getLastRow();
      if (lastRow > 1) {
        hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).clearContent();
      }
      // Insertar nuevos
      if (filas.length > 0) {
        hoja.getRange(2, 1, filas.length, headers.length).setValues(filas);
      }
    } else {
      // Append directo
      hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, headers.length).setValues(filas);
    }

    // Auditoría
    logAction({
      usuario: 'API_POWERBI',
      hoja: nombreHoja,
      accion: 'SYNC_POWERBI',
      contexto: 'Registros sincronizados: ' + filas.length + ' | Modo: ' + (reemplazar ? 'REEMPLAZAR' : 'APILAR'),
      origen: 'PowerBIService.gs'
    });

    return { 
      ok: true, 
      cargados: filas.length, 
      tabla: nombreHoja,
      timestamp: new Date().toISOString() 
    };

  } catch (e) {
    Logger.log('Error en PowerBIService.syncMasterData: ' + e.message);
    return { ok: false, error: e.message };
  }
}

