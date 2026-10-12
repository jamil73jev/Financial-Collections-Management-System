/**
 * VerificacionService.gs
 * Auditoría y verificación de integridad de respaldos automáticos.
 * Diagnóstico completo del sistema de copias de seguridad.
 */

/**
 * FUNCIÓN PRINCIPAL: Auditoría completa de respaldos
 * Ejecutar desde el editor de Apps Script:
 *   auditoriaRespaldosCompleta()
 */
function auditoriaRespaldosCompleta() {
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🔍 AUDITORÍA COMPLETA DE RESPALDOS - ' + new Date().toISOString());
  Logger.log('═══════════════════════════════════════════════════════════════');

  try {
    // Parte 1: Estado del Trigger
    Logger.log('\n📋 PARTE 1: ESTADO DEL TRIGGER');
    _verificarTriggers();

    // Parte 2: Respaldos en Drive
    Logger.log('\n📂 PARTE 2: RESPALDOS EN GOOGLE DRIVE');
    const respaldos = _listarRespaldosEnDrive();

    // Parte 3: Integridad de respaldos
    Logger.log('\n🔐 PARTE 3: INTEGRIDAD DE RESPALDOS');
    if (respaldos && respaldos.length > 0) {
      const original = getSpreadsheet();
      respaldos.slice(0, 3).forEach((respaldo, idx) => {
        Logger.log(`\n  Analizando respaldo ${idx + 1}: ${respaldo.nombre}`);
        _verificarIntegridad(original, respaldo.id, respaldo.nombre);
      });
    } else {
      Logger.log('⚠️  No hay respaldos en la carpeta SIGECO_BACKUPS');
    }

    // Parte 4: Historial en Bitácora
    Logger.log('\nðŸ“œ PARTE 4: HISTORIAL DE RESPALDOS EN BITÁCORA');
    _verificarHistorialBitacora();

    // Parte 5: Recomendaciones
    Logger.log('\n💡 PARTE 5: DIAGNÓSTICO Y RECOMENDACIONES');
    _generarRecomendaciones(respaldos);

    Logger.log('\n═══════════════════════════════════════════════════════════════');
    Logger.log('✅ AUDITORÍA COMPLETADA');
    Logger.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    Logger.log('❌ ERROR en auditoriaRespaldosCompleta: ' + error.message);
    Logger.log(error.stack);
  }
}

/**
 * Verifica el estado de los triggers instalados
 */
function _verificarTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`Total triggers instalados: ${triggers.length}`);

  if (triggers.length === 0) {
    Logger.log('⚠️  NO HAY TRIGGERS INSTALADOS');
    return;
  }

  const triggerBackup = triggers.find(t => t.getHandlerFunction() === 'realizarRespaldoDiario');

  if (triggerBackup) {
    Logger.log('✅ Trigger de respaldo ENCONTRADO');
    Logger.log(`   - Función: realizarRespaldoDiario`);
    Logger.log(`   - Tipo: ${triggerBackup.getTriggerSource()}`);
    Logger.log(`   - Última ejecución: ${triggerBackup.getLastRun() || 'Nunca'}`);
  } else {
    Logger.log('❌ Trigger de respaldo NO ENCONTRADO');
    Logger.log('   Ejecutar: installBackupTrigger()');
  }

  // Listar todos los triggers
  Logger.log('\n  Triggers activos:');
  triggers.forEach(t => {
    Logger.log(`   • ${t.getHandlerFunction()} (${t.getTriggerSource()})`);
  });
}

/**
 * Lista todos los respaldos en la carpeta SIGECO_BACKUPS
 * @returns {Array} Array de objetos {nombre, id, fecha}
 */
function _listarRespaldosEnDrive() {
  try {
    const ss = getSpreadsheet();
    const archivoActual = DriveApp.getFileById(ss.getId());
    const parents = archivoActual.getParents();

    let parentFolder = DriveApp.getRootFolder();
    if (parents.hasNext()) {
      parentFolder = parents.next();
    }

    // Buscar carpeta SIGECO_BACKUPS
    const carpetas = parentFolder.getFoldersByName('SIGECO_BACKUPS');
    if (!carpetas.hasNext()) {
      Logger.log('⚠️  Carpeta SIGECO_BACKUPS NO EXISTE');
      return [];
    }

    const carpetaBackups = carpetas.next();
    const archivos = carpetaBackups.getFiles();
    const respaldos = [];

    while (archivos.hasNext()) {
      const archivo = archivos.next();
      respaldos.push({
        nombre: archivo.getName(),
        id: archivo.getId(),
        fecha: archivo.getDateCreated(),
        url: archivo.getUrl()
      });
    }

    // Ordenar por fecha descendente (más recientes primero)
    respaldos.sort((a, b) => b.fecha - a.fecha);

    Logger.log(`✅ Carpeta SIGECO_BACKUPS encontrada`);
    Logger.log(`   Total respaldos: ${respaldos.length}`);

    if (respaldos.length > 0) {
      Logger.log('\n   Últimos 5 respaldos:');
      respaldos.slice(0, 5).forEach((r, idx) => {
        const fechaStr = Utilities.formatDate(r.fecha, PARAMS.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
        Logger.log(`   ${idx + 1}. ${r.nombre}`);
        Logger.log(`      Fecha: ${fechaStr}`);
      });
    }

    return respaldos;

  } catch (error) {
    Logger.log('❌ Error listando respaldos: ' + error.message);
    return [];
  }
}

/**
 * Verifica la integridad de un respaldo comparándolo con el original
 * @param {Spreadsheet} original - Spreadsheet original
 * @param {string} respaldoId - ID del respaldo en Drive
 * @param {string} respaldoNombre - Nombre del respaldo
 */
function _verificarIntegridad(original, respaldoId, respaldoNombre) {
  try {
    // Abrir el respaldo
    const respaldo = SpreadsheetApp.openById(respaldoId);

    // Comparar estructura
    const hojasOriginal = original.getSheets();
    const hojasRespaldo = respaldo.getSheets();

    Logger.log(`   📊 Estructura:`);
    Logger.log(`      Original:  ${hojasOriginal.length} hojas`);
    Logger.log(`      Respaldo:  ${hojasRespaldo.length} hojas`);

    if (hojasOriginal.length !== hojasRespaldo.length) {
      Logger.log(`      ❌ DIFERENCIA EN NÚMERO DE HOJAS`);
    } else {
      Logger.log(`      ✅ Mismo número de hojas`);
    }

    // Verificar cada hoja
    Logger.log(`\n   📋 Detalle por hoja:`);
    let diferenciasEncontradas = false;

    hojasOriginal.forEach((hojaOrig, idx) => {
      const nombreHoja = hojaOrig.getName();
      const hojaRespaldo = respaldo.getSheetByName(nombreHoja);

      if (!hojaRespaldo) {
        Logger.log(`      ❌ ${nombreHoja}: NO EXISTE EN RESPALDO`);
        diferenciasEncontradas = true;
        return;
      }

      const filasOrig = hojaOrig.getLastRow();
      const filasResp = hojaRespaldo.getLastRow();
      const colsOrig = hojaOrig.getLastColumn();
      const colsResp = hojaRespaldo.getLastColumn();

      const statusFilas = filasOrig === filasResp ? '✅' : '❌';
      const statusCols = colsOrig === colsResp ? '✅' : '❌';

      Logger.log(`      ${statusFilas} ${nombreHoja}:`);
      Logger.log(`         Filas: Original=${filasOrig}, Respaldo=${filasResp}`);
      Logger.log(`         ${statusCols} Columnas: Original=${colsOrig}, Respaldo=${colsResp}`);

      if (filasOrig !== filasResp || colsOrig !== colsResp) {
        diferenciasEncontradas = true;
      }
    });

    // Resumen
    if (diferenciasEncontradas) {
      Logger.log(`\n   ⚠️  RESPALDO INCOMPLETO: Se encontraron diferencias`);
    } else {
      Logger.log(`\n   ✅ RESPALDO COMPLETO: Estructura idéntica`);
    }

  } catch (error) {
    Logger.log(`   ❌ Error verificando respaldo: ${error.message}`);
  }
}

/**
 * Revisa la bitácora y muestra historial de respaldos
 */
function _verificarHistorialBitacora() {
  try {
    const hojaBitacora = getHoja(SHEET_NAMES.BITACORA);
    const datos = getDataAsObjects(SHEET_NAMES.BITACORA);

    // Filtrar por tipo "RESPALDO_AUTOMATICO"
    const respaldos = datos.filter(row => row.TIPO === 'RESPALDO_AUTOMATICO');

    if (respaldos.length === 0) {
      Logger.log('⚠️  No hay registros de respaldos automáticos en la bitácora');
      return;
    }

    Logger.log(`✅ Encontrados ${respaldos.length} registros de respaldos`);
    Logger.log('\n   Últimos 5 respaldos registrados:');

    respaldos.slice(0, 5).forEach((r, idx) => {
      Logger.log(`   ${idx + 1}. ${r.FECHA_HORA}`);
      Logger.log(`      Usuario: ${r.USUARIO}`);
      Logger.log(`      Estado: ${r.DESCRIPCION || 'OK'}`);
      if (r.VALOR_ADICIONAL) {
        Logger.log(`      URL: ${r.VALOR_ADICIONAL}`);
      }
    });

  } catch (error) {
    Logger.log('❌ Error verificando bitácora: ' + error.message);
  }
}

/**
 * Genera recomendaciones basadas en los diagnósticos
 */
function _generarRecomendaciones(respaldos) {
  const triggers = ScriptApp.getProjectTriggers();
  const triggerBackup = triggers.find(t => t.getHandlerFunction() === 'realizarRespaldoDiario');
  const problemasDetectados = [];

  // Verificar problemas
  if (!triggerBackup) {
    problemasDetectados.push('El trigger de respaldo NO está instalado');
  }

  if (!respaldos || respaldos.length === 0) {
    problemasDetectados.push('No hay respaldos en la carpeta SIGECO_BACKUPS');
  } else if (respaldos.length < 5) {
    problemasDetectados.push(`Solo hay ${respaldos.length} respaldos (esperado: múltiples)}`);
  }

  if (problemasDetectados.length === 0) {
    Logger.log('✅ NO SE DETECTARON PROBLEMAS');
    Logger.log('\n   El sistema de respaldos parece estar funcionando correctamente.');
  } else {
    Logger.log('⚠️  PROBLEMAS DETECTADOS:');
    problemasDetectados.forEach((problema, idx) => {
      Logger.log(`   ${idx + 1}. ${problema}`);
    });

    Logger.log('\n   ACCIONES RECOMENDADAS:');
    if (!triggerBackup) {
      Logger.log('   • Ejecutar: installBackupTrigger()');
      Logger.log('   • O ejecutar: setupSystem() para instalar todos los triggers');
    }
    if (!respaldos || respaldos.length === 0) {
      Logger.log('   • Ejecutar: realizarRespaldoDiario() para crear un respaldo manual');
    }
  }
}

/**
 * Función auxiliar: Ejecuta respaldo manual de prueba
 * Ejecutar desde el editor:
 *   respaldoManualDePrueba()
 */
function respaldoManualDePrueba() {
  Logger.log('🔄 Iniciando respaldo manual de prueba...');
  Logger.log('═══════════════════════════════════════════════════════════════');

  try {
    // Ejecutar respaldo
    realizarRespaldoDiario();

    Logger.log('\n✅ Respaldo completado');
    Logger.log('\nVerificando respaldo creado...');

    // Pequeña pausa para que se registre
    Utilities.sleep(1000);

    // Verificar que se creó
    const respaldos = _listarRespaldosEnDrive();
    if (respaldos.length > 0) {
      const ultimoRespaldo = respaldos[0];
      Logger.log(`✅ Respaldo creado: ${ultimoRespaldo.nombre}`);
      Logger.log(`   Fecha: ${Utilities.formatDate(ultimoRespaldo.fecha, PARAMS.TIMEZONE, 'yyyy-MM-dd HH:mm:ss')}`);

      // Verificar integridad
      Logger.log('\n🔐 Verificando integridad del respaldo...');
      const original = getSpreadsheet();
      _verificarIntegridad(original, ultimoRespaldo.id, ultimoRespaldo.nombre);
    }

    Logger.log('\n═══════════════════════════════════════════════════════════════');
    Logger.log('✅ PRUEBA COMPLETADA\n');

  } catch (error) {
    Logger.log('❌ ERROR en respaldo manual: ' + error.message);
    Logger.log(error.stack);
  }
}

