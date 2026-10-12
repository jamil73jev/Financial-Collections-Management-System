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
        timestamp: new Date().toISOString()
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
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * Incluye archivos HTML parciales en el template principal.
 * @param {string} filename
 * @returns {string}
 */
function include_(filename) {
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
    return { ok: false, error: 'Ejecución manual no permitida sin parámetros.' };
  }
  payload = payload || {};
  let sesionActual = null;

  try {
    if (action === 'login') return login_(payload.usuario, payload.password);
    if (action === 'logout') {
      logout_(payload.token);
      return { ok: true };
    }

    const sesion = verificarSesion_(payload.token);
    sesionActual = sesion;
    if (!sesion) return { ok: false, error: 'Sesión inválida o expirada.' };

    if (action === 'verificarSesion') return verificarSesionPublica_(payload.token);
    if (action === 'cambiarPassword') {
      return cambiarPassword_(payload.token, payload.usuarioId, payload.nuevaPassword);
    }
    if (sesion.requiereCambioPassword) {
      return { ok: false, error: 'Debe cambiar su contraseña temporal antes de continuar.' };
    }
    if (action === 'diagnosticoSistema') {
      if (sesion.rol !== 'ADMINISTRADOR') {
        return { ok: false, error: 'No tiene permisos para esta acción.' };
      }
      return _diagnosticoRuntime_();
    }

    const actions = _buildActionRegistry_(payload);
    const route = actions[action];
    if (!route) {
      Logger.log('dispatch: acción no reconocida: ' + action);
      return { ok: false, error: 'Acción no reconocida.' };
    }

    const nivelRequerido = (ROLES[route.rol] || ROLES.ADMINISTRADOR).nivel;
    if (sesion.nivel < nivelRequerido) {
      return { ok: false, error: 'No tiene permisos para esta acción.' };
    }
    return route.run();
  } catch (e) {
    const traceId = Utilities.getUuid().substring(0, 8);
    Logger.log(
      'dispatch ERROR [' + (action || 'unknown') + '] [' + traceId + ']: ' +
      e.message + '\n' + e.stack
    );
    const esAdmin = sesionActual && sesionActual.rol === 'ADMINISTRADOR';
    return {
      ok: false,
      error: esAdmin
        ? 'Error interno [' + traceId + ']: ' + e.message
        : 'Error interno del servidor. Referencia: ' + traceId
    };
  }
}

function _diagnosticoRuntime_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return {
    ok: true,
    version: PARAMS.VERSION_SISTEMA,
    spreadsheetDisponible: !!ss,
    hojas: ss ? ss.getSheets().map(sheet => sheet.getName()) : [],
    handlers: {
      getUsuarios: typeof getUsuarios_ === 'function',
      crearUsuario: typeof crearUsuario_ === 'function',
      listExpedientes: typeof listExpedientesOptimizado_ === 'function',
      getDataAsObjects: typeof getDataAsObjects_ === 'function',
      checkAccess: typeof checkAccess_ === 'function'
    }
  };
}

function _buildActionRegistry_(p) {
  const route = (rol, run) => ({ rol, run });
  return {
    createExpediente: route('GESTOR', () => createExpediente_(p.token, p.datos)),
    updateExpediente: route('GESTOR', () => updateExpediente_(p.token, p.idExpediente, p.cambios)),
    getExpediente: route('GESTOR', () => getExpediente_(p.token, p.idExpediente)),
    getDesgloseDeudaFull: route('GESTOR', () => getDesgloseDetallado_(p.token, p.ruc, p.nombre)),
    listExpedientes: route('GESTOR', () => listExpedientesOptimizado_(p.token, p.pagina, p.filtros)),
    cerrarExpediente: route('SUPERVISOR', () => cerrarExpediente_(p.token, p.idExpediente, p.motivo)),
    cerrarExpedienteConRegistro: route('SUPERVISOR', () => cerrarExpedienteConRegistro_(p.token, p.idExpediente, p.motivo, p.observacion)),
    cerrarExpedienteExento: route('SUPERVISOR', () => cerrarExpedienteExento_(p.token, p.idExpediente, p.observacion)),
    listExpedientesCerrados: route('SUPERVISOR', () => listExpedientesCerrados_(p.token, p.pagina, p.filtros)),
    reabrirExpediente: route('SUPERVISOR', () => reabrirExpediente_(p.token, p.idExpediente, p.nuevoFuncionario)),
    setupExpedientesCerradosSheet: route('ADMINISTRADOR', () => setupExpedientesCerradosSheet_()),
    getHistorialExpediente: route('GESTOR', () => getHistorialExpediente_(p.token, p.idExpediente)),
    registerGestion: route('GESTOR', () => registerGestion_(p.token, p.datos)),
    getGestiones: route('GESTOR', () => getGestiones_(p.token, p.pagina, p.filtros)),
    getSeguimientoData: route('SUPERVISOR', () => getSeguimientoData_(p.token, p.categoria)),
    calcDiasSinMovimiento: route('SUPERVISOR', () => calcDiasSinMovimiento_(p.token)),
    checkAlerts: route('GESTOR', () => checkAlerts_(p.token)),
    getAlertSummary: route('GESTOR', () => getAlertSummary_(p.token)),
    getDashboardKPIs: route('GESTOR', () => getDashboardKPIs_(p.token)),
    getProductividad: route('GESTOR', () => getProductividadFuncionario_(p.token)),
    getTendencia: route('GESTOR', () => getTendenciaGestiones_(p.token)),
    getBitacora: route('AUDITOR', () => getBitacora_(p.token, p.pagina, p.filtros)),
    getUsuarios: route('ADMINISTRADOR', () => getUsuarios_(p.token)),
    crearUsuario: route('ADMINISTRADOR', () => crearUsuario_(p.token, p.datos)),
    toggleUsuarioActivo: route('ADMINISTRADOR', () => toggleUsuarioActivo_(p.token, p.usuarioId)),
    getGestoresActivos: route('SUPERVISOR', () => getGestoresActivos_(p.token)),
    getContribuyentePorRUC: route('GESTOR', () => getContribuyentePorRUC_(p.token, p.ruc)),
    getEstadisticasContribuyentes: route('ADMINISTRADOR', () => getEstadisticasContribuyentes_(p.token)),
    setupProductionImportSheet: route('ADMINISTRADOR', () => setupProductionImportSheet_(p.token)),
    previewContribuyentesImport: route('ADMINISTRADOR', () => previewContribuyentesImport_(p.token)),
    commitContribuyentesImport: route('ADMINISTRADOR', () => commitContribuyentesImport_(p.token, p.checksum)),
    runFullCheck: route('ADMINISTRADOR', () => runFullCheck_(p.token)),
    autoAssignExpedientes: route('SUPERVISOR', () => autoAssignExpedientes_(p.token, p.limitTotal)),
    getConfigMap: route('ADMINISTRADOR', () => ({ ok: true, config: getConfigMap_() })),
    setConfig: route('ADMINISTRADOR', () => ({ ok: setConfig_(p.clave, p.valor) })),
    getCatalogos: route('AUDITOR', () => getCatalogos_()),
    limpiarCacheGlobal: route('ADMINISTRADOR', () => limpiarCacheGlobal_(p.token)),
    getEstadisticasRapidas: route('GESTOR', () => getEstadisticasRapidas_(p.token)),
    verEstadoCola: route('ADMINISTRADOR', () => verEstadoCola_()),
    getExportData: route('GESTOR', () => getExportData_(p.token, p.tipo, p.filtros)),
    exportExpedientes: route('GESTOR', () => exportExpedientes_(p.token, p.filtros)),
    exportGestiones: route('GESTOR', () => exportGestiones_(p.token, p.filtros)),
    exportSeguimiento: route('SUPERVISOR', () => exportSeguimiento_(p.token)),
    exportGestores: route('SUPERVISOR', () => exportGestores_(p.token)),
    exportUsuarios: route('ADMINISTRADOR', () => exportUsuarios_(p.token)),
    getGestores: route('GESTOR', () => getGestores_(p.token)),
    generarPDFExpediente: route('GESTOR', () => generarPDFExpediente_(p.token, p.idExpediente)),
    generarCartaCobro: route('GESTOR', () => generarCartaCobro_(p.token, p.idExpediente)),
    registrarPago: route('SUPERVISOR', () => registrarPago_(p.token, p.datos)),
    getConciliacionDashboard: route('SUPERVISOR', () => getConciliacionDashboard_(p.token)),
    setupConciliacion: route('ADMINISTRADOR', () => setupConciliacion_()),
    procesarPagosETL: route('SUPERVISOR', () => procesarPagosETL_(p.token)),
    setupPagosETLSheet: route('ADMINISTRADOR', () => setupPagosETLSheet_()),
    setupContribuyentesETLSheet: route('ADMINISTRADOR', () => setupContribuyentesETLSheet_()),
    importarYProcesarCSVWeb: route('ADMINISTRADOR', () => importarYProcesarCSVWeb_(p.token)),
    previewMacheoDesdeHoja: route('SUPERVISOR', () => previewMacheoDesdeHoja_(p.token, p.spreadsheetId, p.sheetName)),
    aplicarMacheoConfirmado: route('SUPERVISOR', () => aplicarMacheoConfirmado_(p.token, p.pagosConfirmados)),
    getResultadosData: route('GESTOR', () => getResultadosData_(p.token))
  };
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
 * 4. Sistema (Trigger automático 6 AM): DriveImportService.importCSVFromDrive_()
 * 5. Sistema: Parsea, normaliza, valida e inserta en hoja CONTRIBUYENTES
 * 6. Dashboard y expedientes: Se actualizan automáticamente
 *
 * NO hay conexión directa con Power BI. No hay API Key. No hay endpoint HTTP
 * escuchando requests de Power BI. La importación es simple, directa y robusta.
 */

/**
 * DIAGNÓSTICO CRÍTICO: Verifica la estructura de la hoja EXPEDIENTES
 * y identifica por qué no se asignan expedientes correctamente.
 * Ejecutar en la consola de Apps Script: diagnosticoAsignacion_()
 */
function diagnosticoAsignacion_() {
  Logger.log('\n\n' + '='.repeat(80));
  Logger.log('  DIAGNÓSTICO CRÍTICO: ¿POR QUÉ NO SE ASIGNAN EXPEDIENTES?');
  Logger.log('='.repeat(80) + '\n');

  try {
    // ──────────────────────────────────────────────────────────────────
    // 1. VERIFICAR ESTRUCTURA DE HOJA EXPEDIENTES
    // ──────────────────────────────────────────────────────────────────
    Logger.log('\n[1] ESTRUCTURA DE LA HOJA EXPEDIENTES:');
    Logger.log('─'.repeat(80));

    const hoja = getHoja_(SHEET_NAMES.EXPEDIENTES);
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
        Logger.log('❌ Columna ' + (i + 1) + ': "' + actual + '" != "' + esperado + '"');
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

    const gestoresResult = getGestoresActivos_(null);
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

    const contribuyentes = getDataAsObjects_(SHEET_NAMES.CONTRIBUYENTES);
    const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);

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
      Logger.log('   El siguiente paso: revisar si appendRow_() está escribiendo correctamente.');
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
      Logger.log('INFORMACIÓN: No hay contribuyentes sin expediente');
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
 * Ejecutar en console: verificarAsignacionLogica_()
 */
function verificarAsignacionLogica_() {
  Logger.log('\n' + '='.repeat(80));
  Logger.log('  VERIFICACIÓN RÁPIDA: Lógica de Asignación');
  Logger.log('='.repeat(80) + '\n');

  try {
    // 1. Obtener gestores activos
    Logger.log('[1] Obteniendo gestores activos...');
    const rGestores = getGestoresActivos_(null);  // null token = sistema

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
    const contribuyentes = getDataAsObjects_(SHEET_NAMES.CONTRIBUYENTES);
    const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);

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
      Logger.log('No hay contribuyentes sin expediente. Nada que asignar.');
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
    Logger.log('   autoAssignExpedientes_(null, ' + Math.min(20, pendientes.length) + ')');
    Logger.log('   (Primero con un límite pequeño para validar)');
    Logger.log('='.repeat(80) + '\n');

  } catch (err) {
    Logger.log('❌ Error en verificación: ' + err.message);
    Logger.log(err.stack);
  }
}
