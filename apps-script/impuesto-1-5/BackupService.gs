/**
 * BackupService.gs
 * Servicio de respaldos automáticos para el sistema SIGECO.
 * Genera copias del spreadsheet en una carpeta de Drive específica.
 */

// ============================================================
// RESPALDOS AUTOMÁTICOS
// ============================================================

/**
 * Función principal para respaldar el spreadsheet.
 * Crea una copia del archivo actual en una carpeta llamada "SIGECO_BACKUPS".
 */
function realizarRespaldoDiario() {
  Logger.log('Iniciando respaldo automático...');
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      Logger.log('ERROR: No se encontró el Spreadsheet para respaldar.');
      return;
    }

    const nombreArchivo = ss.getName();
    const ahora = new Date();
    const fechaHoraStr = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyyMMdd_HHmm');
    const nuevoNombre = `${nombreArchivo}_BACKUP_${fechaHoraStr}`;

    // Obtener la carpeta donde reside el archivo original
    const archivoActual = DriveApp.getFileById(ss.getId());
    const parents = archivoActual.getParents();
    let parentFolder = DriveApp.getRootFolder();
    if (parents.hasNext()) {
      parentFolder = parents.next();
    }

    // Buscar o crear carpeta de respaldos "SIGECO_BACKUPS"
    const nombreCarpetaBackups = 'SIGECO_BACKUPS';
    let carpetaBackups;
    const carpetas = parentFolder.getFoldersByName(nombreCarpetaBackups);
    
    if (carpetas.hasNext()) {
      carpetaBackups = carpetas.next();
    } else {
      carpetaBackups = parentFolder.createFolder(nombreCarpetaBackups);
      Logger.log(`Carpeta de respaldos creada: ${nombreCarpetaBackups}`);
    }

    // Hacer la copia
    const copia = archivoActual.makeCopy(nuevoNombre, carpetaBackups);
    Logger.log(`Respaldo creado exitosamente: ${copia.getUrl()}`);

    // (Opcional) Limpiar respaldos antiguos si hay demasiados
    _limpiarRespaldosAntiguos(carpetaBackups, 30); // Mantener últimos 30 días

    // Registrar en Bitácora usando un token "SISTEMA" simulado
    try {
      const prefijo = getConfig('PREFIJO_LOG', 'LOG');
      const idLog = prefijo + '-' + ahora.getTime();
      appendRow(SHEET_NAMES.BITACORA, [
        idLog,
        Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss"),
        'SISTEMA',
        'ADMINISTRADOR',
        'SISTEMA',
        '',
        'RESPALDO_AUTOMATICO',
        '',
        '',
        copia.getUrl(),
        'Respaldo diario exitoso',
        'BackupService.gs'
      ]);
    } catch (e) {
      Logger.log('No se pudo escribir el log del respaldo: ' + e.message);
    }

  } catch (error) {
    Logger.log('ERROR grave durante el respaldo: ' + error.message);
  }
}

/**
 * Mantiene solo una cantidad máxima de respaldos recientes.
 * @param {GoogleAppsScript.Drive.Folder} carpeta 
 * @param {number} maxArchivos 
 */
function _limpiarRespaldosAntiguos(carpeta, maxArchivos) {
  const archivos = carpeta.getFiles();
  const lista = [];
  
  while (archivos.hasNext()) {
    lista.push(archivos.next());
  }
  
  // Ordenar por fecha de creación descendente (más recientes primero)
  lista.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  
  // Borrar los que exceden el límite
  if (lista.length > maxArchivos) {
    Logger.log(`Limpiando respaldos antiguos. Manteniendo: ${maxArchivos}, Total: ${lista.length}`);
    for (let i = maxArchivos; i < lista.length; i++) {
        lista[i].setTrashed(true);
    }
  }
}

/**
 * Instala un activador (trigger) diario para el respaldo.
 * Debe ejecutarse una vez (o mediante Setup.gs).
 */
function installBackupTrigger() {
  // Eliminar triggers previos para evitar duplicados
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'realizarRespaldoDiario')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Crear trigger para ejecutarse entre las 2:00 AM y 3:00 AM
  ScriptApp.newTrigger('realizarRespaldoDiario')
    .timeBased()
    .everyDays(1)
    .atHour(2) 
    .create();

  Logger.log('Trigger de respaldo diario instalado (2:00 AM - 3:00 AM).');
}
