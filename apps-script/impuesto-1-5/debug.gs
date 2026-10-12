/**
 * Debug script to verify presence of all services.
 * Copy and run this in your Apps Script Editor.
 */
function testServiciosVisibles() {
  const servicios = [
    'getSpreadsheet', 'getHoja', 'getDataAsObjects', // SheetService
    'login', 'verificarSesion',                     // Auth.gs
    'checkAccess', 'requireRole',                   // SecurityService
    'runFullCheck',                                 // IntegrityService
    'createExpediente',                             // ExpedienteService
    'registerGestion',                              // GestionService
    'logAction'                                     // BitacoraService
  ];
  
  const resultados = {};
  servicios.forEach(s => {
    resultados[s] = (typeof this[s] === 'function') ? 'OK' : 'MISSING';
  });
  
  Logger.log('=== RESULTADOS DE VISIBILIDAD DE SERVICIOS ===');
  Logger.log(JSON.stringify(resultados, null, 2));
  
  if (resultados.checkAccess === 'MISSING') {
    Logger.log('ERROR CRÍTICO: El archivo SecurityService.gs parece no estar cargado o guardado.');
  }
  
  return resultados;
}
