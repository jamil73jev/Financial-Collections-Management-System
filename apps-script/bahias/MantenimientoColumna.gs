function ejecutarMantenimientoColumna_() {
  const ss = getSpreadsheet_();
  const hojaExp = ss.getSheetByName('EXPEDIENTES');
  const hojaCon = ss.getSheetByName('CONTRIBUYENTES');
  
  Logger.log('----------------------------------------------------');
  Logger.log(' DIAGNÓSTICO DE CONEXIÓN');
  Logger.log(' Spreadsheet ID: ' + ss.getId());
  Logger.log(' Nombre Archivo: ' + ss.getName());
  Logger.log(' Enlace: ' + ss.getUrl());
  Logger.log('----------------------------------------------------');

  if (!hojaExp || !hojaCon) {
    Logger.log('❌ Error: No se encontró una de las hojas necesarias.');
    return;
  }
  
  const soloDigitos = (v) => String(v || '').trim().replace(/\.\d+$/, '').replace(/[^0-9]/g, '');
  const sinCeros = (s) => s.replace(/^0+/, '') || '0';
  const norm = (v) => sinCeros(soloDigitos(v));

  // 1. SINCRONIZACIÓN ABSOLUTA: TIPO_PERSONA debe ser la Columna 5
  // Verificamos qué hay en la Columna 5 actualmente
  const headerCol5 = String(hojaExp.getRange(1, 5).getValue()).trim().toUpperCase();
  
  if (headerCol5 !== 'TIPO_PERSONA') {
    Logger.log('⚠️ Columna 5 no es TIPO_PERSONA (es ' + headerCol5 + '). Insertando obligatoriamente...');
    // Insertamos columna en la posición 5 desplazando lo demás
    hojaExp.insertColumnBefore(5);
    const cell = hojaExp.getRange(1, 5);
    cell.setValue('TIPO_PERSONA');
    cell.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
    Logger.log('✅ Columna TIPO_PERSONA insertada en la posición 5.');
  } else {
    Logger.log('ℹ️ La columna 5 ya es TIPO_PERSONA. Procediendo a poblar datos.');
  }

  // 2. POBLAMIENTO MASIVO
  const dataCon = hojaCon.getDataRange().getValues();
  const headersCon = dataCon[0];
  const rucIdxCon = headersCon.indexOf('RUC');
  const tipoIdxCon = headersCon.findIndex(h => String(h).toUpperCase().includes('TIPO_PERSONA'));
  
  const mapaContrib = {};
  for (let i = 1; i < dataCon.length; i++) {
    const rMatch = norm(dataCon[i][rucIdxCon]);
    if (rMatch) mapaContrib[rMatch] = dataCon[i][tipoIdxCon];
  }
  
  const dataExp = hojaExp.getDataRange().getValues();
  const nuevosValores = [];
  let cnt = 0;
  
  // Asumimos que RUC está en la columna 3 (según screenshot)
  const rucIdxExp = 2; // 0-indexed index for Column 3
  
  for (let i = 1; i < dataExp.length; i++) {
    const rMatch = norm(dataExp[i][rucIdxExp]);
    const val = mapaContrib[rMatch] || 'NATURAL';
    nuevosValores.push([val]);
    cnt++;
  }
  
  if (nuevosValores.length > 0) {
    hojaExp.getRange(2, 5, nuevosValores.length, 1).setValues(nuevosValores);
  }
  
  Logger.log('✅ MANTENIMIENTO COMPLETADO.');
  Logger.log('Se actualizaron ' + cnt + ' filas en la columna 5 de EXPEDIENTES.');
}

