/**
 * debug_full.gs
 * Diagnóstico profundo de datos y estructuras.
 */
function diagnosticoSuperProfundo() {
  const ss = getSpreadsheet();
  Logger.log('----------------------------------------------------');
  Logger.log(' SPREADSHEET ID: ' + ss.getId());
  
  const hojas = ['EXPEDIENTES', 'CONTRIBUYENTES'];
  
  hojas.forEach(nombre => {
    Logger.log('\nAnalizando HOJA: ' + nombre);
    const hoja = ss.getSheetByName(nombre);
    if (!hoja) {
      Logger.log('❌ Hoja no encontrada.');
      return;
    }
    
    const lastCol = hoja.getLastColumn();
    const dataRange = hoja.getRange(1, 1, 3, lastCol); // Solo primeras 3 filas
    const values = dataRange.getValues();
    
    Logger.log('Headers (Fila 1):');
    values[0].forEach((h, i) => {
      Logger.log(`  [${i+1}] "${h}" (Type: ${typeof h})`);
    });
    
    Logger.log('Datos (Fila 2):');
    values[1].forEach((v, i) => {
      Logger.log(`  Col ${i+1}: "${v}" (Type: ${typeof v})`);
    });
  });
  
  Logger.log('\n----------------------------------------------------');
  Logger.log('DIAGNÓSTICO COMPLETADO. Copia estos logs por favor.');
}

