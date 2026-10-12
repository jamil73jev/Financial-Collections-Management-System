/**
 * SIGECO v2 - Auditoría Completa de Servicios
 * Copia y pega este contenido en un nuevo archivo .gs y ejecuta 'ejecutarAuditoriaCompleta'.
 */
function ejecutarAuditoriaCompleta() {
  const reporte = {
    sistema: {},
    servicios_base: {},
    servicios_negocio: {},
    hojas_calculo: {}
  };

  Logger.log('=== INICIANDO AUDITORÍA INTEGRAL SIGECO v2 ===');

  // 1. Verificación de Propiedades y Spreadsheet
  try {
    const ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    reporte.sistema.spreadSheetId = ssId || 'NO_CONFIGURADO';
    
    const ss = getSpreadsheet();
    reporte.sistema.spreadSheetUrl = ss.getUrl();
    reporte.sistema.spreadSheetName = ss.getName();
    
    // Verificación de Hojas
    if (typeof SHEET_NAMES !== 'undefined') {
      Object.entries(SHEET_NAMES).forEach(([key, nombre]) => {
        const hoja = ss.getSheetByName(nombre);
        reporte.hojas_calculo[nombre] = hoja ? 'EXISTE' : 'FALTANTE';
      });
    }
  } catch (e) {
    reporte.sistema.error = e.message;
  }

  // 2. Verificación de Funciones Base (Infrastructure)
  const baseFuncs = [
    'getSpreadsheet', 'getHoja', 'getDataAsObjects', 'appendRow', 'updateRowFields', 
    'checkAccess', 'requireRole', 'logAction', 'logChange', 'verificarSesion'
  ];
  baseFuncs.forEach(fn => {
    reporte.servicios_base[fn] = (typeof this[fn] === 'function') ? 'OK' : 'MISSING';
  });

  // 3. Verificación de Funciones de Negocio (Dispatcher)
  const businessFuncs = [
    'login', 'logout', 'verificarSesionPublica', 'cambiarPassword',
    'createExpediente', 'updateExpediente', 'getExpediente', 'listExpedientes', 
    'cerrarExpediente', 'getHistorialExpediente', 'registerGestion', 'getGestiones',
    'getSeguimientoData', 'calcDiasSinMovimiento', 'checkAlerts', 'getAlertSummary',
    'getDashboardKPIs', 'getBitacora', 'getUsuarios', 'crearUsuario', 
    'processContribuyentesData', 'runFullCheck', 'getConfigMap', 'getCatalogos'
  ];
  businessFuncs.forEach(fn => {
    reporte.servicios_negocio[fn] = (typeof this[fn] === 'function') ? 'OK' : 'MISSING';
  });

  // Salida de resultados
  Logger.log('--- RESULTADO DE AUDITORÍA ---');
  Logger.log(JSON.stringify(reporte, null, 2));

  // Diagnóstico rápido
  let faltantes = 0;
  [...baseFuncs, ...businessFuncs].forEach(f => { if (typeof this[f] !== 'function') faltantes++; });

  if (faltantes > 0) {
    Logger.log('⚠️ ALERTA: Faltan ' + faltantes + ' funciones críticas. Revisa si todos los archivos .gs están cargados.');
  } else {
    Logger.log('✅ EXCELENTE: Todas las funciones están mapeadas correctamente.');
  }

  return reporte;
}
