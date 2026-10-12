/**
 * SheetService.gs
 * Utilidades de lectura y escritura en batch sobre Google Sheets.
 * Toda operación de hoja del sistema pasa por aquí.
 * NUNCA usar índices numéricos de columna fuera de este servicio.
 */

/**
 * Retorna el Spreadsheet activo.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id
    ? SpreadsheetApp.openById(id)
    : SpreadsheetApp.getActiveSpreadsheet();
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
  const hoja = getHoja(nombreHoja);
  const datos = hoja.getDataRange().getValues();
  if (datos.length < 2) return [];

  const headers = datos[0];
  return datos.slice(1)
    .filter(fila => fila.some(v => v !== '' && v !== null && v !== undefined))
    .map((fila, idx) => {
      const obj = { _rowIndex: idx + 2 }; // fila real en la hoja (1-indexed, +1 por header)
      headers.forEach((h, i) => { obj[h] = fila[i]; });
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
  const hoja    = getHoja(nombreHoja);
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];

  Object.entries(cambios).forEach(([campo, valor]) => {
    const colIdx = headers.indexOf(campo);
    if (colIdx === -1) throw new Error('Columna no encontrada: ' + campo + ' en ' + nombreHoja);
    hoja.getRange(numFila, colIdx + 1).setValue(valor);
  });
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
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];

  actualizaciones.forEach(({ rowIndex, campos }) => {
    Object.entries(campos).forEach(([campo, valor]) => {
      const colIdx = headers.indexOf(campo);
      if (colIdx !== -1) {
        hoja.getRange(rowIndex, colIdx + 1).setValue(valor);
      }
    });
  });
}

/**
 * Busca la primera fila que tenga un valor específico en una columna.
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
