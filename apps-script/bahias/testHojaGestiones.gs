/**
 * Prueba específica para la hoja de Gestiones.
 */
function testHojaGestiones_() {
  const nombreHojja = SHEET_NAMES.GESTIONES;
  Logger.log('Buscando hoja: ' + nombreHojja);
  
  try {
    const hoja = getHoja_(nombreHojja);
    const lastCol = hoja.getLastColumn();
    const lastRow = hoja.getLastRow();
    Logger.log('Columnas: ' + lastCol + ' | Filas: ' + lastRow);
    
    if (lastCol === 0) {
      Logger.log('ERROR: La hoja no tiene columnas. Ejecuta setupSystem_().');
      return;
    }
    
    const headers = hoja.getRange(1, 1, 1, lastCol).getValues()[0];
    Logger.log('Encabezados encontrados: ' + headers.join(', '));
    
    const expected = HEADERS.GESTIONES;
    expected.forEach((h, i) => {
       if (headers[i] !== h) {
         Logger.log('ADVERTENCIA: Encabezado ' + (i+1) + ' esperado "' + h + '", encontrado "' + headers[i] + '"');
       }
    });

    const data = getDataAsObjects_(nombreHojja);
    Logger.log('Total registros cargados (objetos): ' + data.length);
    if (data.length > 0) {
      Logger.log('Primer registro: ' + JSON.stringify(data[0]));
    }
    
  } catch (e) {
    Logger.log('ERROR CRÍTICO: ' + e.message);
  }
}


