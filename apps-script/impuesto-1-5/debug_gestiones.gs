/**
 * Debug script for getGestiones.
 * Run this to see if it produces null or an error.
 */
function debugGetGestiones() {
  const token = 'TOKEN_DE_PRUEBA'; // No importa si falla auth, queremos ver si retorna objeto
  try {
    const result = getGestiones(token, 1, {});
    Logger.log('RESULTADO getGestiones: ' + JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    Logger.log('ERROR en getGestiones: ' + e.message + '\n' + e.stack);
    return { ok: false, error: e.message };
  }
}

/**
 * Test dispatcher directly
 */
function debugDispatchGestiones() {
  try {
    const result = dispatch('getGestiones', { token: 'TOKEN_DE_PRUEBA', pagina: 1, filtros: {} });
    Logger.log('RESULTADO dispatcher: ' + JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    Logger.log('ERROR en dispatch: ' + e.message);
  }
}
