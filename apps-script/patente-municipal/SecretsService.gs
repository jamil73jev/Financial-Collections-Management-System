/**
 * SecretsService.gs
 * Gestión de API Keys y secrets en Script Properties.
 * Equivalente $0 de Secret Manager — sin costo, nativo en Apps Script.
 *
 * USO (una sola vez por el admin):
 *   1. Abrir Apps Script editor
 *   2. Seleccionar installSecrets → Ejecutar
 *   3. Copiar la clave del log
 *   4. Actualizar sync_powerbi.py si lo siguen usando
 */

/**
 * Instala la API Key en Script Properties.
 * Si no se pasa apiKey, genera una aleatoria segura (recomendado).
 * @param {string} [apiKey] — dejar vacío para generar automáticamente
 * @returns {string} La clave instalada
 */
function installSecrets(apiKey) {
  const props = PropertiesService.getScriptProperties();
  if (!apiKey) {
    apiKey = Utilities.getUuid() + '-' + Utilities.getUuid();
  }
  props.setProperty('POWERBI_API_KEY', apiKey);
  Logger.log('✅ Secret POWERBI_API_KEY instalado.');
  Logger.log('Clave: ' + apiKey);
  Logger.log('⚠️  Si usas sync_powerbi.py, actualízalo con esta nueva clave.');
  return apiKey;
}

/**
 * Obtiene la API Key desde Script Properties.
 * Lanza error si no está configurada (obliga a ejecutar installSecrets() primero).
 * @returns {string}
 */
function getPowerBIApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('POWERBI_API_KEY');
  if (!key) {
    throw new Error(
      'POWERBI_API_KEY no configurada. ' +
      'Ejecuta installSecrets() en el editor de Apps Script primero.'
    );
  }
  return key;
}

/**
 * Rota la API Key. Usar si se sospecha que fue comprometida.
 * Después de rotar, actualizar sync_powerbi.py con la nueva clave.
 * @returns {string} La nueva clave
 */
function rotarApiKey() {
  const nuevaClave = Utilities.getUuid() + '-' + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('POWERBI_API_KEY', nuevaClave);
  Logger.log('✅ API Key rotada. Nueva clave: ' + nuevaClave);
  Logger.log('⚠️  Actualiza sync_powerbi.py con esta nueva clave.');
  return nuevaClave;
}

/**
 * Verifica si la API Key está configurada (sin revelarla).
 * Útil para diagnóstico.
 */
function verificarSecretsConfigurados() {
  const key = PropertiesService.getScriptProperties().getProperty('POWERBI_API_KEY');
  if (key) {
    Logger.log('✅ POWERBI_API_KEY: configurada (longitud: ' + key.length + ')');
  } else {
    Logger.log('❌ POWERBI_API_KEY: NO configurada. Ejecutar installSecrets().');
  }
}

