/**
 * ConfigService.gs
 * Gestión de la hoja CONFIG del sistema.
 * Provee lectura y escritura de parámetros de configuración.
 */

/**
 * Retorna el valor de una clave de configuración.
 * @param {string} clave
 * @param {*} valorDefault  — retornado si la clave no existe o está inactiva
 * @returns {string}
 */
function getConfig(clave, valorDefault) {
  const mapa = getConfigMap();
  return (clave in mapa) ? mapa[clave] : (valorDefault !== undefined ? valorDefault : '');
}

/**
 * Retorna todas las configuraciones activas como un mapa { CLAVE: VALOR }.
 * @returns {Object}
 */
function getConfigMap() {
  const registros = getDataAsObjects(SHEET_NAMES.CONFIG);
  const mapa = {};
  registros.forEach(r => {
    if (r.ACTIVO === 'TRUE' || r.ACTIVO === true) {
      mapa[r.CLAVE] = r.VALOR;
    }
  });
  return mapa;
}

/**
 * Actualiza el valor de una clave existente en CONFIG.
 * Solo ADMINISTRADOR puede llamar esta función (verificar antes de llamar).
 * @param {string} clave
 * @param {string} nuevoValor
 * @returns {boolean} true si encontró y actualizó
 */
function setConfig(clave, nuevoValor) {
  const registros = getDataAsObjects(SHEET_NAMES.CONFIG);
  const registro  = registros.find(r => r.CLAVE === clave);

  if (!registro) return false;

  updateRowFields(SHEET_NAMES.CONFIG, registro._rowIndex, { VALOR: nuevoValor });
  return true;
}

/**
 * Retorna el número de días configurado para alertas.
 * Usa los valores de CONFIG con fallback a PARAMS.
 * @returns {{ sinMovimiento: number, proximoVencer: number, critico: number }}
 */
function getDiasAlerta() {
  return {
    sinMovimiento: parseInt(getConfig('DIAS_ALERTA_SIN_MOVIMIENTO', PARAMS.DIAS_ALERTA_SIN_MOVIMIENTO)),
    proximoVencer: parseInt(getConfig('DIAS_ALERTA_PROXIMO_VENCER', PARAMS.DIAS_ALERTA_PROXIMO_VENCER)),
    critico:       parseInt(getConfig('DIAS_ALERTA_CRITICO',        PARAMS.DIAS_ALERTA_CRITICO))
  };
}
