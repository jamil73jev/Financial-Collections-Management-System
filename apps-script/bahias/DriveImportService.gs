/**
 * DriveImportService.gs
 * ETL automático desde Google Drive hacia Google Sheets.
 * Reemplaza sync_powerbi.py sin costo alguno.
 *
 * FLUJO:
 *   Admin sube CSV → SIGECO_ETL/IMPORTS/
 *   Trigger 6 AM   → importCSVFromDrive_() detecta archivos nuevos
 *                  → parsea, valida, llama a syncMasterData_()
 *                  → mueve CSV a SIGECO_ETL/PROCESSED/ con timestamp
 *
 * SETUP INICIAL (una sola vez):
 *   Ejecutar setupDriveFolders_() → crea carpetas y muestra sus URLs
 */
const ETL_PARENT_FOLDER    = 'SIGECO_ETL';
const ETL_IMPORTS_FOLDER   = 'IMPORTS';
const ETL_PROCESSED_FOLDER = 'PROCESSED';

/**
 * FUNCIÓN PRINCIPAL — llamada por trigger diario (6:00 AM).
 * Detecta CSVs nuevos en Drive/SIGECO_ETL/IMPORTS y los importa.
 */
function importCSVFromDrive_() {
  try {
    Logger.log('=== DriveETL: Iniciando ===');
    const carpetaImports = _getOrCreateFolder_(ETL_PARENT_FOLDER, ETL_IMPORTS_FOLDER);
    const archivos       = carpetaImports.getFilesByType(MimeType.CSV);
    let procesados = 0, cargados = 0;
    const errores  = [];

    while (archivos.hasNext()) {
      const archivo = archivos.next();
      Logger.log('Procesando: ' + archivo.getName());
      const res = _procesarArchivoCSV_(archivo);
      if (res.ok) {
        procesados++;
        cargados += res.cargados || 0;
        _moverAProcesados_(archivo);
        Logger.log('OK ' + archivo.getName() + ': ' + res.cargados + ' registros');
      } else {
        errores.push(archivo.getName() + ': ' + res.error);
        Logger.log('ERROR ' + archivo.getName() + ': ' + res.error);
        // El archivo queda en IMPORTS para revisión manual del admin
      }
    }

    logActionSystem_({
      hoja:     SHEET_NAMES.CONTRIBUYENTES,
      accion:   'DRIVE_ETL_EJECUTADO',
      contexto: 'Archivos: ' + procesados + ' | Registros: ' + cargados +
                ' | Errores: ' + errores.length,
      origen:   'DriveImportService.gs'
    });

    if (procesados === 0 && errores.length === 0) {
      Logger.log('Sin CSVs nuevos en IMPORTS. Nada que procesar.');
    }
    Logger.log('=== DriveETL: Completado (' + procesados + ' archivos, ' + cargados + ' registros) ===');

  } catch (err) {
    Logger.log('ERROR DriveETL CRITICO: ' + err.message);
    logActionSystem_({
      hoja:     SHEET_NAMES.CONTRIBUYENTES,
      accion:   'DRIVE_ETL_ERROR',
      contexto: err.message,
      origen:   'DriveImportService.gs'
    });
  }
}

/** Parsea un archivo CSV y llama a syncMasterData_() de ImportService.gs. */
function _procesarArchivoCSV_(archivo) {
  try {
    const contenido = archivo.getBlob().getDataAsString('UTF-8');
    const registros = _parsearCSV_(contenido);
    if (!registros || registros.length === 0) {
      return { ok: false, error: 'Archivo vacio o sin filas de datos.' };
    }
    return syncMasterData_(registros, true);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Parsea CSV a array de objetos. Primera fila = headers. */
function _parsearCSV_(csv) {
  // Eliminar BOM si existe
  if (csv.charCodeAt(0) === 0xFEFF) {
    csv = csv.substring(1);
  }

  const lineas = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
                    .split('\n').filter(function(l) { return l.trim() !== ''; });

  if (lineas.length < 2) return [];

  const primeraLinea = lineas[0];
  const countCommas     = (primeraLinea.match(/,/g)  || []).length;
  const countSemicolons = (primeraLinea.match(/;/g)  || []).length;
  const delimitador = countSemicolons > countCommas ? ';' : ',';

  // Normalizar headers: quitar "Suma de", mayusculas, espacios → guion bajo, quitar tildes
  var headers = _parsearLineaCSV_(lineas[0], delimitador).map(function(h) {
    return h.trim()
            .replace(/^suma\s+de\s+/i, '')
            .toUpperCase()
            .replace(/\s+/g, '_')
            .replace(/\xC1/g, 'A').replace(/\xC9/g, 'E').replace(/\xCD/g, 'I')
            .replace(/\xD3/g, 'O').replace(/\xDA/g, 'U').replace(/\xD1/g, 'N')
            .replace(/\xE1/g, 'A').replace(/\xE9/g, 'E').replace(/\xED/g, 'I')
            .replace(/\xF3/g, 'O').replace(/\xFA/g, 'U').replace(/\xF1/g, 'N');
  });

  Logger.log('Headers normalizados: ' + headers.join(' | ') + ' | Delimitador: ' + delimitador);

  var registros = [];
  var errores   = 0;

  for (var i = 1; i < lineas.length; i++) {
    try {
      var valores = _parsearLineaCSV_(lineas[i], delimitador);
      if (valores.length < 1) continue;
      var obj = {};
      headers.forEach(function(h, idx) { obj[h] = (valores[idx] || '').trim(); });
      registros.push(obj);
    } catch(e) {
      errores++;
      if (errores <= 3) {
        Logger.log('Fila ' + (i + 1) + ' error: ' + e.message);
      }
    }
  }

  Logger.log('CSV parseado: ' + registros.length + ' registros, ' + errores + ' errores');
  return registros;
}

/** Parsea una línea CSV respetando valores entre comillas dobles. */
function _parsearLineaCSV_(linea, delimitador) {
  if (delimitador === undefined) delimitador = ',';
  var resultado = [];
  var campo = '', enComillas = false;
  for (var i = 0; i < linea.length; i++) {
    var c = linea[i];
    if (c === '"') {
      enComillas = !enComillas;
    } else if (c === delimitador && !enComillas) {
      resultado.push(campo.trim());
      campo = '';
    } else {
      campo += c;
    }
  }
  resultado.push(campo.trim());
  return resultado;
}

/** Mueve un archivo a PROCESSED con timestamp en el nombre. */
function _moverAProcesados_(archivo) {
  const carpetaProcesados = _getOrCreateFolder_(ETL_PARENT_FOLDER, ETL_PROCESSED_FOLDER);
  const carpetaImports    = _getOrCreateFolder_(ETL_PARENT_FOLDER, ETL_IMPORTS_FOLDER);
  const ts         = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, 'yyyyMMdd_HHmm');
  const nombreBase = archivo.getName().replace(/\.csv$/i, '');
  archivo.setName(nombreBase + '_OK_' + ts + '.csv');
  carpetaProcesados.addFile(archivo);
  carpetaImports.removeFile(archivo);
}

/** Obtiene o crea carpeta anidada en Drive. */
function _getOrCreateFolder_(parentName, childName) {
  const ps = DriveApp.getFoldersByName(parentName);
  const parentFolder = ps.hasNext() ? ps.next() : DriveApp.createFolder(parentName);
  const cs = parentFolder.getFoldersByName(childName);
  return cs.hasNext() ? cs.next() : parentFolder.createFolder(childName);
}

/**
 * Setup inicial: crea las carpetas en Drive y muestra sus URLs en el log.
 * Ejecutar UNA VEZ para preparar el sistema.
 */
function setupDriveFolders_() {
  const imports   = _getOrCreateFolder_(ETL_PARENT_FOLDER, ETL_IMPORTS_FOLDER);
  const processed = _getOrCreateFolder_(ETL_PARENT_FOLDER, ETL_PROCESSED_FOLDER);
  Logger.log('=== CARPETAS DRIVE CONFIGURADAS ===');
  Logger.log('IMPORTS:   ' + imports.getUrl());
  Logger.log('PROCESSED: ' + processed.getUrl());
  Logger.log('');
  Logger.log('INSTRUCCIONES PARA IMPORTAR DATOS:');
  Logger.log('1. Sube tu CSV a la carpeta IMPORTS (link arriba)');
  Logger.log('2. El trigger lo procesara automaticamente a las 6:00 AM');
  Logger.log('3. Para procesar de inmediato: ejecutar importCSVFromDrive_() manualmente');
  Logger.log('4. Archivos procesados se mueven a PROCESSED automaticamente');
}

/**
 * DIAGNOSTICO: Verifica que hay realmente en CONTRIBUYENTES
 */
function _diagnosticarContribuyentesDrive_() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.CONTRIBUYENTES);
  const datos = hoja.getDataRange().getValues();
  if (datos.length === 0) {
    Logger.log('ERROR: CONTRIBUYENTES vacio');
    return;
  }
  const headers  = datos[0];
  const primerReg = datos[1] || [];
  Logger.log('DIAGNOSTICO CONTRIBUYENTES');
  Logger.log('Total filas: ' + datos.length);
  Logger.log('Encabezados: ' + headers.join(' | '));
  Logger.log('\nPrimer registro (fila 2):');
  headers.forEach(function(h, idx) {
    Logger.log('  ' + h + ': ' + primerReg[idx]);
  });
  Logger.log('\nColumnas numericas:');
  var numericaCols = ['VALOR_IMPUESTO', 'VALOR_INTERES', 'VALOR_MULTA', 'VALOR_RECARGO', 'TOTAL_DEUDA'];
  numericaCols.forEach(function(col) {
    var idx   = headers.indexOf(col);
    var valor = idx >= 0 ? primerReg[idx] : 'NO ENCONTRADA';
    Logger.log('  ' + col + ' (indice ' + idx + '): ' + valor + ' (tipo: ' + typeof valor + ')');
  });
}
