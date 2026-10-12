/**
 * ConfigService.gs
 * Gestión de la hoja CONFIG del sistema.
 * Provee lectura y escritura de parámetros de configuración.
 *
 * OPTIMIZACIÓN v2.1: getConfigMap() usa CacheService con TTL de 2 minutos.
 * Durante registerGestion se llama ~6 veces; con caché solo 1 hace la lectura real.
 */

const _CONFIG_CACHE_KEY = 'sigeco_config_map_v1';
const _CONFIG_CACHE_TTL = 120; // segundos — CONFIG rara vez cambia en producción

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
 * Resultado cacheado 2 minutos para evitar N lecturas de la hoja CONFIG
 * durante un mismo flujo de negocio (registerGestion, logAction, etc.).
 * @returns {Object}
 */
function getConfigMap() {
  const cache = CacheService.getScriptCache();
  try {
    const cached = cache.get(_CONFIG_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* si falla el cache, continuar con lectura de hoja */ }

  const registros = getDataAsObjects(SHEET_NAMES.CONFIG);
  const mapa = {};
  registros.forEach(r => {
    if (r.ACTIVO === 'TRUE' || r.ACTIVO === true) {
      mapa[r.CLAVE] = r.VALOR;
    }
  });

  try { cache.put(_CONFIG_CACHE_KEY, JSON.stringify(mapa), _CONFIG_CACHE_TTL); } catch (e) {}
  return mapa;
}

/**
 * Actualiza el valor de una clave existente en CONFIG e invalida el caché.
 * Solo ADMINISTRADOR puede llamar esta función.
 * @param {string} token
 * @param {string} clave
 * @param {string} nuevoValor
 * @returns {{ ok: boolean, error?: string }}
 */
function setConfig(token, clave, nuevoValor) {
  const acceso = checkAccess(token, 'MODIFICAR_CONFIG');
  if (!acceso.ok) return acceso;

  const registros = getDataAsObjects(SHEET_NAMES.CONFIG);
  const registro  = registros.find(r => r.CLAVE === clave);
  if (!registro) return { ok: false, error: 'Clave de configuración no encontrada: ' + clave };

  updateRowFields(SHEET_NAMES.CONFIG, registro._rowIndex, { VALOR: nuevoValor });

  // Invalidar caché para que la próxima llamada lea el valor actualizado
  try { CacheService.getScriptCache().remove(_CONFIG_CACHE_KEY); } catch (e) {}
  return { ok: true };
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
