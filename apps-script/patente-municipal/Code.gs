/**
 * Code.gs
 * Punto de entrada principal de SIGECO v2.
 * Responsabilidades: doGet(), include(), onOpen() (si aplica).
 * NO contiene lógica de negocio — todo está en los módulos de servicios.
 */

// ============================================================
// PUNTO DE ENTRADA WEB APP
// ============================================================

/**
 * Punto de entrada de la web app.
 * Carga Index.html con la configuración básica del sistema.
 */
function doGet(e) {
  // ── Health check: URL?health=1 ────────────────────────────────────
  if (e && e.parameter && e.parameter.health === '1') {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return ContentService.createTextOutput(JSON.stringify({
        ok:       true,
        version:  PARAMS.VERSION_SISTEMA,
        sistema:  PARAMS.NOMBRE_SISTEMA,
        timestamp: new Date().toISOString(),
        sheets:   ss.getSheets().length,
        triggers: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction())
      })).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false, error: err.message
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  // ─────────────────────────────────────────────────────────────────

  const template = HtmlService.createTemplateFromFile('Index');

  template.appConfig = JSON.stringify({
    titulo:    PARAMS.NOMBRE_SISTEMA,
    version:   PARAMS.VERSION_SISTEMA,
    catalogos: CATALOGOS,
    roles:     ROLES
  });

  // Pasar variables de plantilla
  template.PARAMS = PARAMS;
  template.CATALOGOS = CATALOGOS;
  template.ROLES = ROLES;

  return template.evaluate()
    .setTitle('SIGECO — Sistema de Seguimiento Recaudatorio')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * Incluye archivos HTML parciales en el template principal.
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
// DISPATCHER DE LLAMADAS DESDE EL FRONTEND
// El frontend llama google.script.run.dispatch(action, payload)
// Este dispatcher centraliza todas las llamadas del frontend.
// ============================================================

/**
 * Dispatcher principal: recibe todas las llamadas del frontend.
 * @param {string} action   — nombre de la función a ejecutar
 * @param {Object} payload  — datos de entrada (siempre incluye token)
 * @returns {Object}        — resultado de la función
 */
function dispatch(action, payload) {
  if (!action) {
    Logger.log('⚠ï¸ dispatch: Se detectó ejecución manual desde el editor sin parámetros.');
    Logger.log('Para iniciar el sistema, ejecute la función: setupSystem');
    return { ok: false, error: 'Ejecución manual no permitida sin parámetros.' };
  }
  payload = payload || {};

  // Toda acción, salvo 'login', debe llegar con un token de sesión no vacío.
  // Sin este guardado, un token ausente/nulo es tratado por checkAccess()/requireRole()
  // como una llamada interna del propio sistema con privilegios de ADMINISTRADOR
  // (ver SecurityService.gs) — eso solo debe ocurrir para código ejecutado directamente
  // en el servidor (triggers, funciones de diagnóstico), nunca para una llamada
  // que llega desde el navegador a través de este dispatcher.
  if (action !== 'login' && (typeof payload.token !== 'string' || !payload.token.trim())) {
    return { ok: false, error: 'Sesión requerida.' };
  }

  try {
    switch (action) {
      // Auth
      case 'login':               return login(payload.usuario, payload.password);
      case 'logout':              return logout(payload.token), { ok: true };
      case 'verificarSesion':     return verificarSesionPublica(payload.token);
      case 'cambiarPassword':     return cambiarPassword(payload.token, payload.usuarioId, payload.nuevaPassword);

      // Expedientes (OPTIMIZADOS CON CACHÉ)
      case 'createExpediente':    return createExpediente(payload.token, payload.datos);
      case 'updateExpediente':    return updateExpediente(payload.token, payload.idExpediente, payload.cambios);
      case 'getExpediente':       return getExpediente(payload.token, payload.idExpediente);
      case 'getDesgloseDeudaFull': return getDesgloseDetallado(payload.token, payload.ruc, payload.nombre);
      case 'listExpedientes':     return listExpedientesOptimizado(payload.token, payload.pagina, payload.filtros);
      case 'cerrarExpediente':              return cerrarExpediente(payload.token, payload.idExpediente, payload.motivo);
      case 'cerrarExpedienteConRegistro':   return cerrarExpedienteConRegistro(payload.token, payload.idExpediente, payload.motivo, payload.observacion);
      case 'cerrarExpedienteExento':        return cerrarExpedienteExento(payload.token, payload.idExpediente, payload.observacion);
      case 'listExpedientesCerrados':       return listExpedientesCerrados(payload.token, payload.pagina, payload.filtros);
      case 'reabrirExpediente':             return reabrirExpediente(payload.token, payload.idExpediente, payload.nuevoFuncionario);
      case 'setupExpedientesCerradosSheet': return setupExpedientesCerradosSheet();
      case 'getHistorialExpediente': return getHistorialExpediente(payload.token, payload.idExpediente);

      // Gestiones
      case 'registerGestion':     return registerGestion(payload.token, payload.datos);
      case 'getGestiones':        return getGestiones(payload.token, payload.pagina, payload.filtros);

      // Seguimiento
      case 'getSeguimientoData':  return getSeguimientoData(payload.token, payload.categoria);
      case 'calcDiasSinMovimiento': return calcDiasSinMovimiento(payload.token);

      // Alertas
      case 'checkAlerts':         return checkAlerts(payload.token);
      case 'getAlertSummary':     return getAlertSummary(payload.token);

      // Dashboard
      case 'getDashboardKPIs':    return getDashboardKPIs(payload.token);
      case 'getProductividad':    return getProductividadFuncionario(payload.token);
      case 'getTendencia':        return getTendenciaGestiones(payload.token);

      // Bitácora
      case 'getBitacora':         return getBitacora(payload.token, payload.pagina, payload.filtros);

      // Usuarios
      case 'getUsuarios':         return getUsuarios(payload.token);
      case 'crearUsuario':        return crearUsuario(payload.token, payload.datos);
      case 'toggleUsuarioActivo': return toggleUsuarioActivo(payload.token, payload.usuarioId);
      case 'getGestoresActivos':  return getGestoresActivos(payload.token);

      // Contribuyentes / Importación
      case 'processContribuyentesData': return processContribuyentesData(payload.token, payload.filas, payload.reemplazar);
      case 'getContribuyentePorRUC':    return getContribuyentePorRUC(payload.token, payload.ruc);
      case 'getEstadisticasContribuyentes': return getEstadisticasContribuyentes(payload.token);

      // Integridad y Asignación
      case 'runFullCheck':        return runFullCheck(payload.token);
      case 'autoAssignExpedientes': return autoAssignExpedientes(payload.token, payload.limitTotal);
      case 'redistribuirExpedientesSinGestion': return redistribuirExpedientesSinGestion(payload.token, payload.forzar);
      case 'insertTestData':      return insertTestData(payload.token);
      case 'clearTestData':       return clearTestData(payload.token);

      // Config
      case 'getConfigMap':        return { ok: true, config: getConfigMap() };
      case 'setConfig':           return setConfig(payload.token, payload.clave, payload.valor);
      case 'getCatalogos':        return getCatalogos();

      // Caché y Optimización
      case 'limpiarCacheGlobal':  return limpiarCacheGlobal(payload.token);
      case 'getEstadisticasRapidas': return getEstadisticasRapidas(payload.token);

      // Tareas Asíncronas
      case 'verEstadoCola':       return verEstadoCola();

      // Auditoría de Respaldos
      case 'auditoriaRespaldosCompleta': return { ok: true, mensaje: 'Auditoría iniciada. Ver logs en Apps Script.' };
      case 'respaldoManualDePrueba':     return { ok: true, mensaje: 'Respaldo manual iniciado. Ver logs en Apps Script.' };

      // Exportación — descarga directa en navegador (sin Drive)
      case 'getExportData':       return getExportData(payload.token, payload.tipo, payload.filtros);
      // Exportación legacy (fallback)
      case 'exportExpedientes':   return exportExpedientes(payload.token, payload.filtros);
      case 'exportGestiones':     return exportGestiones(payload.token, payload.filtros);
      case 'exportSeguimiento':   return exportSeguimiento(payload.token);
      case 'exportGestores':      return exportGestores(payload.token);
      case 'exportUsuarios':      return exportUsuarios(payload.token);

      // Empleados / Gestores
      case 'getGestores':         return getGestores(payload.token);

      // Documentos / PDF
      case 'generarPDFExpediente': return generarPDFExpediente(payload.token, payload.idExpediente);
      case 'generarCartaCobro':    return generarCartaCobro(payload.token, payload.idExpediente);

      // Conciliación / Pagos
      case 'registrarPago':            return registrarPago(payload.token, payload.datos);
      case 'getConciliacionDashboard': return getConciliacionDashboard(payload.token);
      case 'setupConciliacion':        return setupConciliacion();
      case 'procesarPagosETL':              return procesarPagosETL(payload.token);
      case 'setupPagosETLSheet':            return setupPagosETLSheet();
      case 'setupContribuyentesETLSheet':   return setupContribuyentesETLSheet();
      case 'importarYProcesarCSVWeb':       return importarYProcesarCSVWeb(payload.token);
      case 'previewMacheoDesdeHoja':         return previewMacheoDesdeHoja(payload.token, payload.spreadsheetId, payload.sheetName);
      case 'aplicarMacheoConfirmado':        return aplicarMacheoConfirmado(payload.token, payload.pagosConfirmados);

      // Resultados y Alertas
      case 'getResultadosData':        return getResultadosData(payload.token);

      default:
        Logger.log('dispatch: acción no reconocida: ' + action);
        return { ok: false, error: 'Acción no reconocida: ' + action };
    }
  } catch (e) {
    Logger.log('dispatch ERROR [' + (action||'unknown') + ']: ' + e.message + '\n' + e.stack);
    return { ok: false, error: 'Error crítico en el servidor: ' + e.message };
  }

  // Fallback absoluto por si algo salta del switch/catch
  return { ok: false, error: 'Respuesta vacía del servidor para: ' + action };
}

/**
 * FUNCIÓN REMOVIDA: doPost() para Power BI
 *
 * CONTEXTO: La integración con Power BI ha sido eliminada del sistema.
 * El sistema ahora recibe datos ÚNICAMENTE desde Google Drive.
 *
 * NUEVO FLUJO DE IMPORTACIÓN:
 * 1. Analista: Prepara datos en Power BI Desktop
 * 2. Analista: Exporta tabla a CSV desde Power BI
 * 3. Admin: Descarga CSV y lo sube a Google Drive/SIGECO_ETL/IMPORTS/
 * 4. Sistema (Trigger automático 6 AM): DriveImportService.importCSVFromDrive()
 * 5. Sistema: Parsea, normaliza, valida e inserta en hoja CONTRIBUYENTES
 * 6. Dashboard y expedientes: Se actualizan automáticamente
 *
 * NO hay conexión directa con Power BI. No hay API Key. No hay endpoint HTTP
 * escuchando requests de Power BI. La importación es simple, directa y robusta.
 */

/**
 * DIAGNÓSTICO CRÍTICO: Verifica la estructura de la hoja EXPEDIENTES
 * y identifica por qué no se asignan expedientes correctamente.
 * Ejecutar en la consola de Apps Script: diagnosticoAsignacion()
 */
function diagnosticoAsignacion() {
  Logger.log('\n\n' + '='.repeat(80));
  Logger.log('  DIAGNÓSTICO CRÍTICO: ¿POR QUÉ NO SE ASIGNAN EXPEDIENTES?');
  Logger.log('='.repeat(80) + '\n');

  try {
    // ──────────────────────────────────────────────────────────────────
    // 1. VERIFICAR ESTRUCTURA DE HOJA EXPEDIENTES
    // ──────────────────────────────────────────────────────────────────
    Logger.log('\n[1] ESTRUCTURA DE LA HOJA EXPEDIENTES:');
    Logger.log('─'.repeat(80));

    const hoja = getHoja(SHEET_NAMES.EXPEDIENTES);
    const headerRow = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    const lastRow = hoja.getLastRow();
    const lastCol = hoja.getLastColumn();

    Logger.log('• Nombre de hoja: ' + SHEET_NAMES.EXPEDIENTES);
    Logger.log('• Total de filas en hoja: ' + lastRow);
    Logger.log('• Total de columnas en hoja: ' + lastCol);
    Logger.log('• Columnas actuales en la hoja:');
    headerRow.forEach((col, idx) => {
      Logger.log('  [' + (idx + 1) + '] ' + col);
    });

    // ──────────────────────────────────────────────────────────────────
    // 2. VERIFICAR HEADERS DEFINIDOS EN CONSTANTS.GS
    // ──────────────────────────────────────────────────────────────────
    Logger.log('\n[2] HEADERS ESPERADOS (Constants.gs):');
    Logger.log('─'.repeat(80));

    const headersEsperados = HEADERS.EXPEDIENTES;
    Logger.log('• Total de columnas esperadas: ' + headersEsperados.length);
    Logger.log('• Columnas esperadas:');
    headersEsperados.forEach((col, idx) => {
      Logger.log('  [' + (idx + 1) + '] ' + col);
    });

    // ──────────────────────────────────────────────────────────────────
    // 3. COMPARAR: ACTUAL vs ESPERADO
    // ──────────────────────────────────────────────────────────────────
    Logger.log('\n[3] ANÁLISIS: DIFERENCIAS ACTUAL vs ESPERADO:');
    Logger.log('─'.repeat(80));

    if (lastCol !== headersEsperados.length) {
      Logger.log('❌ ERROR CRÍTICO: Número de columnas no coincide!');
      Logger.log('   • Columnas en hoja: ' + lastCol);
      Logger.log('   • Columnas esperadas: ' + headersEsperados.length);
      Logger.log('   • Diferencia: ' + (lastCol - headersEsperados.length));
    }

    let mismatchCount = 0;
    for (let i = 0; i < Math.max(lastCol, headersEsperados.length); i++) {
      const actual = headerRow[i] || '[vacío]';
      const esperado = headersEsperados[i] || '[no definido]';

      if (actual !== esperado) {
        Logger.log('❌ Columna ' + (i + 1) + ': "' + actual + '" â‰  "' + esperado + '"');
        mismatchCount++;
      }
    }

    if (mismatchCount === 0 && lastCol === headersEsperados.length) {
      Logger.log('✅ OK: Todas las columnas coinciden');
    }

    // ──────────────────────────────────────────────────────────────────
    // 4. VERIFICAR GESTORES ACTIVOS
    // ──────────────────────────────────────────────────────────────────
    Logger.log('\n[4] GESTORES ACTIVOS:');
    Logger.log('─'.repeat(80));

    const gestoresResult = getGestoresActivos(null);
    if (gestoresResult.ok) {
      Logger.log('✅ Se encontraron ' + gestoresResult.gestores.length + ' gestores activos:');
      gestoresResult.gestores.forEach((g, idx) => {
        Logger.log('  [' + (idx + 1) + '] ' + g.nombre + ' (' + g.correo + ') - ROL: ' + g.rol);
      });

      if (gestoresResult.gestores.length === 0) {
        Logger.log('❌ ERROR: No hay gestores activos. autoAssignInternal no puede funcionar.');
      }
    } else {
      Logger.log('❌ Error al obtener gestores: ' + gestoresResult.error);
    }

    // ──────────────────────────────────────────────────────────────────
    // 5. VERIFICAR CONTRIBUYENTES SIN EXPEDIENTE
    // ──────────────────────────────────────────────────────────────────
    Logger.log('\n[5] CONTRIBUYENTES SIN EXPEDIENTE:');
    Logger.log('─'.repeat(80));

    const contribuyentes = getDataAsObjects(SHEET_NAMES.CONTRIBUYENTES);
    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);

    Logger.log('• Total contribuyentes: ' + contribuyentes.length);
    Logger.log('• Total expedientes activos: ' + expedientes.filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true).length);

    const mapaExistentes = {};
    expedientes.forEach(e => {
      if (e.ACTIVO === 'TRUE' || e.ACTIVO === true) {
        const clave = String(e.RUC || '').trim();
        mapaExistentes[clave] = true;
      }
    });

    const pendientes = contribuyentes.filter(c => {
      const clave = String(c.RUC || '').trim();
      return !mapaExistentes[clave];
    });

    Logger.log('• Contribuyentes SIN expediente: ' + pendientes.length);
    if (pendientes.length > 0) {
      Logger.log('  Primeros 3:');
      pendientes.slice(0, 3).forEach((c, idx) => {
        Logger.log('    [' + (idx + 1) + '] RUC: ' + c.RUC + ' | ' + (c.NOMBRE_CONTRIBUYENTE || 'Sin nombre'));
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // 6. TEST: CREAR UN EXPEDIENTE MANUALMENTE
    // ──────────────────────────────────────────────────────────────────
    Logger.log('\n[6] TEST MANUAL: Intentar crear 1 expediente de prueba:');
    Logger.log('─'.repeat(80));

    if (pendientes.length > 0 && gestoresResult.gestores.length > 0) {
      const testContrib = pendientes[0];
      const testGestor = gestoresResult.gestores[0];

      Logger.log('Usando:');
      Logger.log('  • Contribuyente: ' + testContrib.NOMBRE_CONTRIBUYENTE + ' (RUC: ' + testContrib.RUC + ')');
      Logger.log('  • Gestor: ' + testGestor.nombre + ' (' + testGestor.correo + ')');

      // Simular lo que hace autoAssignInternal
      const headers = HEADERS.EXPEDIENTES;
      const ahora = new Date();
      const mes = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyyMM');
      const fechaAsignacion = Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
      const idCounter = expedientes.length + 1;

      const fila = [];
      headers.forEach(header => {
        let valor = '';
        switch (header) {
          case 'ID_EXPEDIENTE':
            valor = 'EXP-' + mes + '-' + String(idCounter).padStart(4, '0');
            break;
          case 'CODIGO_INTERNO':
            valor = idCounter;
            break;
          case 'RUC':
            valor = testContrib.RUC;
            break;
          case 'CONTRIBUYENTE':
            valor = testContrib.NOMBRE_CONTRIBUYENTE || '';
            break;
          case 'FUNCIONARIO_ASIGNADO':
            valor = testGestor.correo;
            break;
          case 'FECHA_ASIGNACION':
            valor = fechaAsignacion;
            break;
          case 'ESTADO_EXPEDIENTE':
            valor = 'EN_GESTION';
            break;
          case 'AÑO_SOLICITUD':
            valor = testContrib['AÑO_SOLICITUD'] || new Date().getFullYear();
            break;
          case 'TIPO_OBLIGACION':
            valor = 'IMPUESTO_15';
            break;
          case 'PRIORIDAD':
            valor = 'MEDIA';
            break;
          case 'ALERTA_ESTADO':
            valor = 'OK';
            break;
          case 'ACTIVO':
            valor = 'TRUE';
            break;
          case 'TOTAL_DEUDA':
            valor = parseFloat(String(testContrib.TOTAL_DEUDA || 0).replace(',', '.')) || 0;
            break;
          default:
            valor = '';
        }
        fila.push(valor);
      });

      Logger.log('\nFila construida (valores en orden):');
      fila.forEach((v, idx) => {
        Logger.log('  [' + (idx + 1) + '] ' + headers[idx] + ' = ' + v);
      });

      // No lo escribimos realmente, solo mostramos los datos
      Logger.log('\n✅ Fila lista para escribir. Estructura parece correcta.');
      Logger.log('   El siguiente paso: revisar si appendRow() está escribiendo correctamente.');
    }

    // ──────────────────────────────────────────────────────────────────
    // 7. CONCLUSIONES Y RECOMENDACIONES
    // ──────────────────────────────────────────────────────────────────
    Logger.log('\n[7] CONCLUSIONES Y PRÓXIMOS PASOS:');
    Logger.log('─'.repeat(80));

    if (mismatchCount > 0) {
      Logger.log('❌ PROBLEMA IDENTIFICADO: Desalineamiento de columnas');
      Logger.log('   Acción: Verificar que la hoja EXPEDIENTES tiene las columnas en el orden exacto de HEADERS.EXPEDIENTES');
    } else if (gestoresResult.gestores.length === 0) {
      Logger.log('❌ PROBLEMA IDENTIFICADO: No hay gestores activos');
      Logger.log('   Acción: Crear o activar al menos 1 gestor en la hoja USUARIOS');
    } else if (pendientes.length === 0) {
      Logger.log('⚠ï¸ INFORMACIÓN: No hay contribuyentes sin expediente');
      Logger.log('   Todos los contribuyentes ya tienen expedientes asignados.');
    } else {
      Logger.log('✅ ESTRUCTURA PARECE CORRECTA');
      Logger.log('   Si los expedientes aún no aparecen, el problema podría ser:');
      Logger.log('   1. Caché no se está invalidando correctamente');
      Logger.log('   2. El filtrado en CacheAPI.gs tiene otro problema');
      Logger.log('   3. El FUNCIONARIO_ASIGNADO se está escribiendo pero con espacios o mayúsculas incorrectas');
    }

    Logger.log('\n' + '='.repeat(80) + '\n');

  } catch (err) {
    Logger.log('❌ Error en diagnóstico: ' + err.message);
    Logger.log(err.stack);
  }
}

/**
 * VERIFICACIÓN RÁPIDA: Simula una asignación sin escribir datos reales.
 * Útil para verificar que todo el lógica está correcta antes de hacer cambios.
 * Ejecutar en console: verificarAsignacionLogica()
 */
function verificarAsignacionLogica() {
  Logger.log('\n' + '='.repeat(80));
  Logger.log('  VERIFICACIÓN RÁPIDA: Lógica de Asignación');
  Logger.log('='.repeat(80) + '\n');

  try {
    // 1. Obtener gestores activos
    Logger.log('[1] Obteniendo gestores activos...');
    const rGestores = getGestoresActivos(null);  // null token = sistema

    if (!rGestores.ok) {
      Logger.log('❌ Error: ' + rGestores.error);
      return;
    }

    if (rGestores.gestores.length === 0) {
      Logger.log('❌ Error: No hay gestores activos');
      return;
    }

    Logger.log('✅ Gestores encontrados: ' + rGestores.gestores.length);
    rGestores.gestores.forEach((g, i) => {
      Logger.log('  [' + (i + 1) + '] ' + g.nombre + ' (' + g.correo + ')');
    });

    // 2. Obtener contribuyentes sin expediente
    Logger.log('\n[2] Obteniendo contribuyentes sin expediente...');
    const contribuyentes = getDataAsObjects(SHEET_NAMES.CONTRIBUYENTES);
    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);

    Logger.log('   Total contribuyentes: ' + contribuyentes.length);
    Logger.log('   Total expedientes: ' + expedientes.length);

    const mapaExistentes = {};
    expedientes.forEach(e => {
      if (e.ACTIVO === 'TRUE' || e.ACTIVO === true) {
        const clave = String(e.RUC || '').trim();
        mapaExistentes[clave] = true;
      }
    });

    const pendientes = contribuyentes.filter(c => {
      const clave = String(c.RUC || '').trim();
      return !mapaExistentes[clave];
    });

    Logger.log('✅ Pendientes: ' + pendientes.length);

    if (pendientes.length === 0) {
      Logger.log('⚠ï¸ No hay contribuyentes sin expediente. Nada que asignar.');
      return;
    }

    // 3. Simular asignación round-robin
    Logger.log('\n[3] Simulando asignación round-robin...');
    const gestoresArray = rGestores.gestores;
    let gestorIdx = 0;

    Logger.log('Primeros 5 expedientes se asignarían así:');
    for (let i = 0; i < Math.min(5, pendientes.length); i++) {
      const c = pendientes[i];
      const gestor = gestoresArray[gestorIdx % gestoresArray.length];
      Logger.log('  [' + (i + 1) + '] RUC: ' + c.RUC + ' → ' + gestor.nombre + ' (' + gestor.correo + ')');
      gestorIdx++;
    }

    // 4. Simular filtrado para cada gestor
    Logger.log('\n[4] Simulando filtrado por sesión (lo que ve cada gestor)...');
    gestoresArray.forEach((gestor, idx) => {
      // Simular sesion
      const sesionSimulada = { correo: gestor.correo.toLowerCase(), rol: 'GESTOR' };

      // Simular filtrado (esto es lo que hace CacheAPI.gs)
      const expedientesDelGestor = expedientes.filter(e => {
        const asignado = (e.FUNCIONARIO_ASIGNADO || '').toLowerCase();
        const correo = (sesionSimulada.correo || '').toLowerCase();
        return asignado === correo || !e.FUNCIONARIO_ASIGNADO;
      });

      Logger.log('  Gestor ' + gestor.nombre + ' (' + gestor.correo + '):');
      Logger.log('    - Debería ver: ' + expedientesDelGestor.length + ' expedientes (actuales)');

      // Contar cuántos de los nuevos le tocarían
      const nuevosDelGestor = pendientes.filter((_, i) => {
        return (gestoresArray.indexOf(gestor) + i % gestoresArray.length) === gestoresArray.indexOf(gestor);
      }).length;
      Logger.log('    - Recibiría aprox: ' + nuevosDelGestor + ' nuevos expedientes');
    });

    Logger.log('\n' + '='.repeat(80));
    Logger.log('✅ Verificación completada. Si todo es correcto, ejecutar:');
    Logger.log('   autoAssignExpedientes(null, ' + Math.min(20, pendientes.length) + ')');
    Logger.log('   (Primero con un límite pequeño para validar)');
    Logger.log('='.repeat(80) + '\n');

  } catch (err) {
    Logger.log('❌ Error en verificación: ' + err.message);
    Logger.log(err.stack);
  }
}

