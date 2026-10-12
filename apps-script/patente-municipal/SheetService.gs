/**
 * SheetService.gs
 * Utilidades de lectura y escritura en batch sobre Google Sheets.
 * Toda operación de hoja del sistema pasa por aquí.
 * NUNCA usar índices numéricos de columna fuera de este servicio.
 */

// Cache de encabezados a nivel de módulo (vive solo durante la ejecución actual de GAS).
// Evita releer la fila de encabezados en cada llamada a updateRowFields dentro del mismo dispatch().
const _headersCache = {};

/**
 * Convierte cualquier valor de fecha a un objeto Date válido.
 * Definida aquí (SheetService) para estar disponible en todos los archivos del proyecto.
 * @param {Date|string|number} valor
 * @returns {Date}
 */
function _toDate(valor) {
  if (valor instanceof Date) return valor;
  const d = new Date(valor);
  if (isNaN(d.getTime())) {
    Logger.log('_toDate: valor inválido → ' + JSON.stringify(valor) + ' — usando new Date()');
    return new Date();
  }
  return d;
}

// Cache del objeto Spreadsheet: se abre UNA sola vez por ejecución GAS.
// Evita llamar SpreadsheetApp.openById() en cada operación de hoja.
let _ssCache = null;

/**
 * Retorna el Spreadsheet. Usa cache de ejecución para no abrir el SS múltiples veces.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  if (_ssCache) return _ssCache;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  _ssCache = id
    ? SpreadsheetApp.openById(id)
    : SpreadsheetApp.getActiveSpreadsheet();
  return _ssCache;
}

/**
 * Retorna una hoja por nombre. Lanza error si no existe.
 * @param {string} nombre
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getHoja(nombre) {
  const hoja = getSpreadsheet().getSheetByName(nombre);
  if (!hoja) throw new Error('Hoja no encontrada: ' + nombre);
  return hoja;
}

/**
 * Lee todos los datos de una hoja y retorna un array de objetos,
 * usando los encabezados de la fila 1 como keys.
 * Excluye filas completamente vacías.
 * @param {string} nombreHoja
 * @returns {Array<Object>}
 */
function getDataAsObjects(nombreHoja) {
  return getDataAsObjectsSelected(nombreHoja, null);
}

/**
 * Versión optimizada que solo lee y procesa columnas específicas.
 * @param {string} nombreHoja
 * @param {Array<string>} columnasRequeridas - Nombres de headers (ej: ['ID_EXPEDIENTE', 'RUC'])
 */
function getDataAsObjectsSelected(nombreHoja, columnasRequeridas) {
  const hoja = getHoja(nombreHoja);
  const fullData = hoja.getDataRange().getValues();
  if (fullData.length < 2) return [];

  const headersRaw = fullData[0];
  const headersNorm = headersRaw.map(h => String(h || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, ''));
  
  // Mapear índices de las columnas que queremos
  const indicesAMapear = [];
  headersNorm.forEach((h, i) => {
    if (!columnasRequeridas || columnasRequeridas.includes(h)) {
      indicesAMapear.push({ name: h, idx: i });
    }
  });

  return fullData.slice(1)
    .filter(fila => fila.some(v => v !== '' && v !== null))
    .map((fila, fIdx) => {
      const obj = { _rowIndex: fIdx + 2 };
      indicesAMapear.forEach(col => {
        let val = fila[col.idx];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, PARAMS.TIMEZONE || 'UTC', "yyyy-MM-dd'T'HH:mm:ss");
        }
        obj[col.name] = val;
      });
      return obj;
    });
}

/**
 * Agrega una fila al final de la hoja.
 * @param {string} nombreHoja
 * @param {Array} valores  — en el orden exacto de HEADERS[hoja]
 */
function appendRow(nombreHoja, valores) {
  const hoja = getHoja(nombreHoja);
  hoja.appendRow(valores);
}

/**
 * Actualiza campos específicos de una fila por número de fila.
 * @param {string} nombreHoja
 * @param {number} numFila    — 1-indexed
 * @param {Object} cambios    — { COLUMNA: valor, ... }
 */
function updateRowFields(nombreHoja, numFila, cambios) {
  if (!cambios || Object.keys(cambios).length === 0) return;

  const hoja    = getHoja(nombreHoja);
  const lastCol = hoja.getLastColumn();

  // Usar cache de encabezados para no releerlos en cada llamada del mismo dispatch()
  const cacheKey = nombreHoja + '_' + lastCol;
  if (!_headersCache[cacheKey]) {
    _headersCache[cacheKey] = hoja.getRange(1, 1, 1, lastCol).getValues()[0];
  }
  const headers = _headersCache[cacheKey];

  // Leer la fila completa una sola vez
  const rowVals = hoja.getRange(numFila, 1, 1, lastCol).getValues()[0];

  // Modificar en memoria
  Object.entries(cambios).forEach(([campo, valor]) => {
    const colIdx = headers.indexOf(campo);
    if (colIdx === -1) throw new Error('Columna no encontrada: ' + campo + ' en ' + nombreHoja);
    rowVals[colIdx] = valor;
  });

  // Escribir de vuelta en una sola llamada al API
  hoja.getRange(numFila, 1, 1, lastCol).setValues([rowVals]);
}

/**
 * Actualiza múltiples filas en batch usando setValues.
 * Más eficiente que updateRowFields para actualizaciones masivas.
 * @param {string} nombreHoja
 * @param {Array<{rowIndex: number, campos: Object}>} actualizaciones
 */
function batchUpdateRows(nombreHoja, actualizaciones) {
  if (!actualizaciones || actualizaciones.length === 0) return;

  const hoja    = getHoja(nombreHoja);
  const lastCol = hoja.getLastColumn();
  const headers = hoja.getRange(1, 1, 1, lastCol).getValues()[0];

  // Leer TODAS las filas afectadas de una sola vez
  const rowNums   = [...new Set(actualizaciones.map(a => a.rowIndex))].sort((a, b) => a - b);
  const lastRow   = hoja.getLastRow();
  // Leer bloque completo desde la primera fila modificada hasta la última
  const minRow    = rowNums[0];
  const maxRow    = rowNums[rowNums.length - 1];
  const bloque    = hoja.getRange(minRow, 1, maxRow - minRow + 1, lastCol).getValues();

  // Aplicar todos los cambios en memoria
  actualizaciones.forEach(({ rowIndex, campos }) => {
    const bloqueIdx = rowIndex - minRow;
    Object.entries(campos).forEach(([campo, valor]) => {
      const colIdx = headers.indexOf(campo);
      if (colIdx !== -1) bloque[bloqueIdx][colIdx] = valor;
    });
  });

  // Escribir todo el bloque de vuelta en UNA sola llamada API
  hoja.getRange(minRow, 1, maxRow - minRow + 1, lastCol).setValues(bloque);
}

/**
 * Busca la primera fila que tenga un valor específico en una columna.
 * Carga todos los datos en memoria — usar findRowByFieldFast para hojas grandes.
 * @param {string} nombreHoja
 * @param {string} columna   — nombre del header
 * @param {*}      valor
 * @returns {Object|null}    — objeto de la fila o null si no existe
 */
function findRowByField(nombreHoja, columna, valor) {
  const registros = getDataAsObjects(nombreHoja);
  const valStr = String(valor).trim().toLowerCase();
  return registros.find(r => {
    const rVal = r[columna];
    return rVal !== undefined && rVal !== null && String(rVal).trim().toLowerCase() === valStr;
  }) || null;
}

/**
 * Versión optimizada de findRowByField usando TextFinder nativo de Sheets.
 * Evita cargar toda la hoja en memoria — ideal para hojas con miles de filas.
 * Tiempo: O(1 columna) en lugar de O(N filas × M columnas).
 *
 * @param {string} nombreHoja
 * @param {string} columna   — nombre del header (case-insensitive)
 * @param {*}      valor
 * @returns {Object|null}    — objeto de la fila o null si no existe
 */
function findRowByFieldFast(nombreHoja, columna, valor) {
  const hoja    = getHoja(nombreHoja);
  const lastRow = hoja.getLastRow();
  if (lastRow < 2) return null;

  const lastCol    = hoja.getLastColumn();
  const rawHeaders = hoja.getRange(1, 1, 1, lastCol).getValues()[0];
  const normHeaders = rawHeaders.map(h =>
    String(h || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
  );
  const columnaUpper = String(columna).toUpperCase();
  const colIdx = normHeaders.indexOf(columnaUpper);
  if (colIdx === -1) return null;

  // Búsqueda nativa en servidor — no transfiere datos de las filas que no coinciden
  const finder = hoja
    .getRange(2, colIdx + 1, lastRow - 1, 1)
    .createTextFinder(String(valor).trim())
    .matchEntireCell(true);
  const match = finder.findNext();
  if (!match) return null;

  // Solo leer la fila encontrada (1 fila vs N filas)
  const rowNum  = match.getRow();
  const rowData = hoja.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  const obj = { _rowIndex: rowNum };
  normHeaders.forEach((h, i) => {
    let v = rowData[i];
    if (v instanceof Date) {
      const tz = (typeof PARAMS !== 'undefined' && PARAMS.TIMEZONE) || 'UTC';
      v = Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
    }
    obj[h] = v;
  });
  return obj;
}

/**
 * Retorna el índice de la columna (1-indexed) por nombre de header.
 * @param {string} nombreHoja
 * @param {string} columna
 * @returns {number}
 */
function getColIndex(nombreHoja, columna) {
  const hoja    = getHoja(nombreHoja);
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  const idx     = headers.indexOf(columna);
  if (idx === -1) throw new Error('Columna no encontrada: ' + columna + ' en ' + nombreHoja);
  return idx + 1;
}

/**
 * Cuenta filas con datos (excluyendo encabezado).
 * @param {string} nombreHoja
 * @returns {number}
 */
function countRows(nombreHoja) {
  const hoja = getHoja(nombreHoja);
  const last = hoja.getLastRow();
  return Math.max(last - 1, 0);
}

/**
 * Escribe un bloque completo de datos en una hoja (reemplaza todo desde fila 2).
 * Útil para refrescar hojas calculadas como SEGUIMIENTO y DASHBOARD.
 * @param {string}   nombreHoja
 * @param {Array<Array>} filas  — array de arrays de valores
 */
function overwriteDataSection(nombreHoja, filas) {
  const hoja = getHoja(nombreHoja);

  // Limpiar datos existentes (desde fila 2)
  const lastRow = hoja.getLastRow();
  if (lastRow > 1) {
    hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).clearContent();
  }

  if (filas && filas.length > 0) {
    const headers   = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    const numCols   = Math.min(filas[0].length, headers.length);
    hoja.getRange(2, 1, filas.length, numCols).setValues(
      filas.map(f => f.slice(0, numCols))
    );
  }
}

// ============================================================
// FUNCIONES DE TESTING / DEBUGGING
// Ejecutar estas en Apps Script editor para diagnosticar
// ============================================================

/**
 * Lista todas las hojas disponibles en el spreadsheet.
 * Ejecutar en console: listAllSheets()
 */
function listAllSheets() {
  const ss = getSpreadsheet();
  const hojas = ss.getSheets();
  Logger.log('=== HOJAS DISPONIBLES ===');
  Logger.log('Total: ' + hojas.length);
  hojas.forEach((h, idx) => {
    Logger.log((idx + 1) + '. ' + h.getName() + ' (' + h.getLastRow() + ' filas)');
  });
}

/**
 * Verifica que SHEET_NAMES y hojas existan.
 * Ejecutar en console: verifySheetStructure()
 */
function verifySheetStructure() {
  Logger.log('=== VERIFICACIÓN DE ESTRUCTURA ===');

  // 1. Verificar SHEET_NAMES
  if (!SHEET_NAMES) {
    Logger.log('❌ SHEET_NAMES no está definido. Revisa Constants.gs');
    return;
  }
  Logger.log('✅ SHEET_NAMES disponible');

  // 2. Verificar que exista cada hoja
  const ss = getSpreadsheet();
  Object.entries(SHEET_NAMES).forEach(([key, nombre]) => {
    const existe = !!ss.getSheetByName(nombre);
    Logger.log((existe ? '✅' : '❌') + ' ' + nombre);
  });

  // 3. Verificar HEADERS
  if (!HEADERS) {
    Logger.log('❌ HEADERS no está definido. Revisa Constants.gs');
    return;
  }
  Logger.log('✅ HEADERS disponible');
}

/**
 * Lee CONTRIBUYENTES y muestra stats.
 * Ejecutar en console: testContribuyentes()
 */
function testContribuyentes() {
  try {
    Logger.log('=== TEST: CONTRIBUYENTES ===');
    const nombreHoja = SHEET_NAMES.CONTRIBUYENTES;
    Logger.log('Leyendo hoja: ' + nombreHoja);

    const datos = getDataAsObjects(nombreHoja);
    Logger.log('Total registros: ' + datos.length);

    if (datos.length === 0) {
      Logger.log('⚠️  La hoja está vacía o solo tiene encabezados');
      return;
    }

    const primero = datos[0];
    Logger.log('\n✅ PRIMEROS DATOS:');
    Logger.log('  RUC: ' + (primero.RUC || 'N/A'));
    Logger.log('  Nombre: ' + (primero.NOMBRE_CONTRIBUYENTE || 'N/A'));
    Logger.log('  Tipo Persona: ' + (primero.TIPO_PERSONA || 'N/A'));
    Logger.log('  Total Deuda: $' + (primero.TOTAL_DEUDA || 0));
    Logger.log('  Multa: $' + (primero.VALOR_MULTA || 0));
    Logger.log('  Año Solicitud: ' + (primero['AÑO_SOLICITUD'] || 'N/A'));
    Logger.log('  Tipo Impuesto: ' + (primero.TIPO_IMPUESTO || 'N/A'));

    Logger.log('\n✅ COLUMNAS DETECTADAS:');
    Object.keys(primero)
      .filter(k => k !== '_rowIndex')
      .forEach(k => Logger.log('  • ' + k));

  } catch (err) {
    Logger.log('❌ Error: ' + err.message);
  }
}

/**
 * Lee EXPEDIENTES y muestra stats.
 * Ejecutar en console: testExpedientes()
 */
function testExpedientes() {
  try {
    Logger.log('=== TEST: EXPEDIENTES ===');
    const nombreHoja = SHEET_NAMES.EXPEDIENTES;
    Logger.log('Leyendo hoja: ' + nombreHoja);

    const datos = getDataAsObjects(nombreHoja);
    Logger.log('Total expedientes: ' + datos.length);

    if (datos.length === 0) {
      Logger.log('⚠️  Aún no hay expedientes (espera a autoAssignInternal)');
      return;
    }

    Logger.log('\n✅ EXPEDIENTES CREADOS:');
    datos.slice(0, 3).forEach((e, idx) => {
      Logger.log((idx + 1) + '. ID: ' + e.ID_EXPEDIENTE);
      Logger.log('   RUC: ' + e.RUC + ' | ' + e.CONTRIBUYENTE);
      Logger.log('   Prioridad: ' + e.PRIORIDAD + ' | Estado: ' + e.ESTADO_EXPEDIENTE);
    });

    if (datos.length > 3) {
      Logger.log('\n... y ' + (datos.length - 3) + ' más');
    }

  } catch (err) {
    Logger.log('❌ Error: ' + err.message);
  }
}

/**
 * Ejecuta todos los tests en secuencia.
 * Ejecutar en console: runAllTests()
 */
function runAllTests() {
  Logger.log('\n\n========== SUITE DE TESTS ==========\n');
  listAllSheets();
  Logger.log('\n');
  verifySheetStructure();
  Logger.log('\n');
  testContribuyentes();
  Logger.log('\n');
  testExpedientes();
  Logger.log('\n\n====== TESTS COMPLETADOS ======\n');
}



// Función eliminada: corregirValorDeudaExpedientes_DESACTIVADA()
// Esta función ya no se necesita. Fue reemplazada por importarYProcesarCSV() en DataManagementService.gs

