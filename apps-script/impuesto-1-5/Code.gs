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
  payload = payload || {};

  try {
    switch (action) {
      // Auth
      case 'login':               return login(payload.usuario, payload.password);
      case 'logout':              return logout(payload.token), { ok: true };
      case 'verificarSesion':     return verificarSesionPublica(payload.token);
      case 'cambiarPassword':     return cambiarPassword(payload.token, payload.usuarioId, payload.nuevaPassword);

      // Expedientes
      case 'createExpediente':    return createExpediente(payload.token, payload.datos);
      case 'updateExpediente':    return updateExpediente(payload.token, payload.idExpediente, payload.cambios);
      case 'getExpediente':       return getExpediente(payload.token, payload.idExpediente);
      case 'listExpedientes':     return listExpedientes(payload.token, payload.pagina, payload.filtros);
      case 'cerrarExpediente':    return cerrarExpediente(payload.token, payload.idExpediente, payload.motivo);
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
      case 'insertTestData':      return insertTestData(payload.token);
      case 'clearTestData':       return clearTestData(payload.token);

      // Config
      case 'getConfigMap':        return { ok: true, config: getConfigMap() };
      case 'setConfig':           return { ok: setConfig(payload.clave, payload.valor) };
      case 'getCatalogos':        return getCatalogos();

      default:
        Logger.log('dispatch: acción no reconocida: ' + action);
        return { ok: false, error: 'Acción no reconocida: ' + action };
    }
  } catch (e) {
    Logger.log('dispatch ERROR [' + action + ']: ' + e.message + '\n' + e.stack);
    return { ok: false, error: 'Error interno del servidor: ' + e.message };
  }
}
