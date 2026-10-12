/**
 * CacheAPI.gs
 * Optimización con CacheService para operaciones pesadas
 */

/**
 * Lista expedientes OPTIMIZADA con caché.
 * @param {string} token
 * @param {number} pagina
 * @param {Object} filtros
 * @returns {Object}
 */
function listExpedientesOptimizado_(token, pagina, filtros) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  pagina = Math.max(1, parseInt(pagina) || 1);
  const pageSize = PARAMS.PAGE_SIZE || 50;
  filtros = filtros || {};

  // Definir _parse al inicio para evitar "before initialization"
  const _parse = (v) => {
    if (typeof v === 'number') return v;
    let s = String(v || '0').replace(/[^0-9,.-]/g, '').replace(/,/g, '.');
    let n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  try {
    // Crear clave de caché basada en filtros, sesión Y usuario para rapidez extrema.
    // ⚠️ Es crítico incluir el usuario: dos Gestores distintos tienen vistas diferentes
    // y NO deben compartir la misma entrada de caché.
    const baseCacheKey = JSON.stringify(filtros).replace(/[^a-z0-9]/gi, '').substring(0, 15);
    const usuarioKey   = String(sesion.usuario || sesion.userId || '').replace(/[^a-z0-9]/gi, '').substring(0, 20);
    const cacheKey = `exp_p${pagina}_${sesion.rol}_${usuarioKey}_${baseCacheKey}_g${_getCacheGen_()}`;
    const cache = CacheService.getScriptCache();
    let response = null;

    try {
      const cached = cache.get(cacheKey);
      if (cached) {
        Logger.log('Retornando página desde caché ultra-rápido');
        return JSON.parse(cached);
      }
    } catch (e) {}

    // Si no está en caché de página, intentar desde Caché Maestro (Toda la lista procesada)
    const masterCacheKey = 'expedientes_master_list';
    let datos = getLargeCache_(masterCacheKey);

    if (!datos) {
      Logger.log('📂 Caché Maestro vacío. Leyendo desde Spreadsheet...');
      // Leemos solo las columnas necesarias para el listado (ahorramos 40% de memoria)
      const columnasListado = [
        'ID_EXPEDIENTE','CODIGO_INTERNO','RUC','CONTRIBUYENTE',
        'MERCADO_SECTOR','GIRO_DEL_NEGOCIO','ESTADO_COMERCIANTE',
        'TIPO_OBLIGACION','ESTADO_EXPEDIENTE','PRIORIDAD','FUNCIONARIO_ASIGNADO',
        'FECHA_ASIGNACION','FECHA_ULTIMA_GESTION','FECHA_PROXIMA_GESTION',
        'DIAS_SIN_MOVIMIENTO','RESULTADO_ULTIMA_GESTION','ALERTA_ESTADO',
        'TOTAL_DEUDA','TOTAL_POR_COBRAR','ESTADO_DE_DEUDA','ACTIVO'
      ];
      datos = getDataAsObjectsSelected_(SHEET_NAMES.EXPEDIENTES, columnasListado);
      
      // Guardar en Caché Maestro por 15 minutos para todos los usuarios
      setLargeCache_(masterCacheKey, datos, 900);
    } else {
      Logger.log('Lista completa recuperada desde caché maestro');
    }

    // Solo expedientes activos (los cerrados van a EXPEDIENTES_CERRADOS)
    datos = datos.filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

    // Aplicar filtros sobre los datos (ya sea de hoja o de caché maestro)
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      datos = datos.filter(e =>
        String(e.ID_EXPEDIENTE || '').toLowerCase().includes(q) ||
        String(e.CONTRIBUYENTE || '').toLowerCase().includes(q) ||
        String(e.RUC || '').toLowerCase().includes(q)
      );
    }

    if (filtros.estado && filtros.estado !== '') {
      datos = datos.filter(e => e.ESTADO_EXPEDIENTE === filtros.estado);
    }

    if (filtros.prioridad && filtros.prioridad !== '') {
      datos = datos.filter(e => e.PRIORIDAD === filtros.prioridad);
    }

    if (filtros.alerta && filtros.alerta !== '') {
      datos = datos.filter(e => e.ALERTA_ESTADO === filtros.alerta);
    }
    
    if (filtros.tipoPersona && filtros.tipoPersona !== '') {
      datos = datos.filter(e => e.MERCADO_SECTOR === filtros.tipoPersona);
    }

    // Filtro por funcionario: solo roles 3+ (Supervisor/Admin)
    if (filtros.funcionario && filtros.funcionario !== '' && sesion.nivel >= 3) {
      const funcLower = filtros.funcionario.toLowerCase();
      datos = datos.filter(e =>
        String(e.FUNCIONARIO_ASIGNADO || '').toLowerCase().includes(funcLower)
      );
    }

    if (sesion.rol === 'GESTOR') {
      // Solo expedientes asignados explícitamente a este gestor.
      // Se eliminan las condiciones que incluían expedientes sin gestor (!e.FUNCIONARIO_ASIGNADO
      // o cadena vacía), que causaban que expedientes de otros gestores o sin asignar
      // aparecieran mezclados en la vista de cualquier gestor.
      const usuarioLower = String(sesion.usuario || '').toLowerCase().trim();
      datos = datos.filter(e =>
        String(e.FUNCIONARIO_ASIGNADO || '').toLowerCase().trim() === usuarioLower
      );
    }

    // Ordenar por mayor deuda primero
    datos.sort((a, b) => _parse(b.TOTAL_DEUDA) - _parse(a.TOTAL_DEUDA));

    const total = datos.length;
    const inicio = (pagina - 1) * pageSize;
    const fin = inicio + pageSize;
    const datosPaginados = datos.slice(inicio, fin);

    const expedientes = datosPaginados.map(e => ({
      id:                  e.ID_EXPEDIENTE,
      codigoInterno:       e.CODIGO_INTERNO,
      ruc:                 e.RUC,
      contribuyente:       e.CONTRIBUYENTE,
      mercadoSector:       e.MERCADO_SECTOR,
      giroNegocio:         e.GIRO_DEL_NEGOCIO,
      estadoComerciant:    e.ESTADO_COMERCIANTE,
      estadoDeDeuda:       e.ESTADO_DE_DEUDA,
      tipoObligacion:      e.TIPO_OBLIGACION,
      estadoExpediente:    e.ESTADO_EXPEDIENTE,
      prioridad:           e.PRIORIDAD,
      funcionarioAsignado: e.FUNCIONARIO_ASIGNADO,
      fechaAsignacion:     e.FECHA_ASIGNACION,
      fechaUltimaGestion:  e.FECHA_ULTIMA_GESTION,
      fechaProximaGestion: e.FECHA_PROXIMA_GESTION,
      diasSinMovimiento:   parseInt(e.DIAS_SIN_MOVIMIENTO) || 0,
      resultadoUltimaGestion: e.RESULTADO_ULTIMA_GESTION,
      observacionGeneral:  e.OBSERVACION_GENERAL,
      alertaEstado:        e.ALERTA_ESTADO,
      totalDeuda:          _parse(e.TOTAL_DEUDA),
      totalPorCobrar:      _parse(e.TOTAL_POR_COBRAR),
      activo:              e.ACTIVO === 'TRUE' || e.ACTIVO === true
    }));

    response = {
      ok: true,
      expedientes: expedientes,
      total: total,
      pagina,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };

    // Cachear resultado por 5 minutos para velocidad instantánea en navegación
    try {
      cache.put(cacheKey, JSON.stringify(response), 300);
    } catch (e) {
      Logger.log('Cache put failed (puedes ignorar): ' + e.message);
    }

    return response;

  } catch (err) {
    Logger.log('listExpedientesOptimizado_ ERROR: ' + err.message + '\n' + err.stack);
    return { ok: false, error: 'Error en listado optimizado: ' + err.message };
  }
}

/**
 * Obtiene estadísticas rápidas (cacheadas).
 * @param {string} token
 * @returns {Object}
 */
function getEstadisticasRapidas_(token) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = 'estadisticas_rapidas';

    // Intentar desde caché
    try {
      const cached = cache.get(cacheKey);
      if (cached) {
        Logger.log('Estadísticas recuperadas desde caché');
        return JSON.parse(cached);
      }
    } catch (e) {}

    // Calcular — solo leer las columnas estrictamente necesarias de cada hoja
    // EXPEDIENTES: solo ACTIVO y ALERTA_ESTADO (evita transferir las 26 columnas completas)
    const expedientes = getDataAsObjectsSelected_(
      SHEET_NAMES.EXPEDIENTES, ['ACTIVO', 'ALERTA_ESTADO']
    );
    // CONTRIBUYENTES: countRows_() usa getLastRow()-1 (O(1), sin leer celdas)
    // y solo leer TOTAL_DEUDA en lugar de las 16 columnas completas
    const totalContribuyentes = countRows_(SHEET_NAMES.CONTRIBUYENTES);
    const contribDeuda = getDataAsObjectsSelected_(
      SHEET_NAMES.CONTRIBUYENTES, ['TOTAL_DEUDA']
    );

    const stats = {
      ok: true,
      totalExpedientes:    expedientes.length,
      totalContribuyentes,
      expActivos:          expedientes.filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true).length,
      expCriticos:         expedientes.filter(e => e.ALERTA_ESTADO === 'CRITICO').length,
      expVencidos:         expedientes.filter(e => e.ALERTA_ESTADO === 'VENCIDO').length,
      expSinMovimiento:    expedientes.filter(e => e.ALERTA_ESTADO === 'SIN_MOVIMIENTO').length,
      deudaTotal:          contribDeuda.reduce((sum, c) => sum + (parseFloat(c.TOTAL_DEUDA) || 0), 0)
    };

    // Cachear por 10 minutos
    try {
      cache.put(cacheKey, JSON.stringify(stats), 600);
    } catch (e) {}

    return stats;

  } catch (err) {
    Logger.log('getEstadisticasRapidas_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Limpia todo el caché (ejecutar después de cambios importantes).
 * @param {string} token
 * @returns {Object}
 */
function limpiarCacheGlobal_(token) {
  const acceso = checkAccess_(token, 'MODIFICAR_CONFIG');
  if (!acceso.ok) return acceso;

  try {
    const cache = CacheService.getScriptCache();
    // Invalida claves específicas conocidas
    cache.removeAll(['kpis_dashboard', 'estadisticas_rapidas', 'dashboard_data']);
    
    if (typeof invalidarCacheDashboard_ === 'function') {
      invalidarCacheDashboard_();
    }

    Logger.log('✅ Caché global limpiado (claves principales)');
    return { ok: true, mensaje: 'Caché principal limpiado exitosamente' };

  } catch (err) {
    Logger.log('limpiarCacheGlobal_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Guarda un objeto grande en caché dividiéndolo en partes (Sharding).
 * @param {string} key
 * @param {any} data
 * @param {number} ttl - Tiempo de vida en segundos
 */
function setLargeCache_(key, data, ttl) {
  try {
    const cache = CacheService.getScriptCache();
    const fullStr = JSON.stringify(data);
    const chunkSize = 90000; // ~90KB (límite es 100KB)
    const numChunks = Math.ceil(fullStr.length / chunkSize);
    
    for (let i = 0; i < numChunks; i++) {
      const chunk = fullStr.substring(i * chunkSize, (i + 1) * chunkSize);
      cache.put(`${key}_p${i}`, chunk, ttl);
    }
    cache.put(`${key}_meta`, JSON.stringify({ count: numChunks }), ttl);
    Logger.log(`Cache Large Set: ${key} (${numChunks} partes)`);
  } catch (e) {
    Logger.log('setLargeCache_ ERROR: ' + e.message);
  }
}

/**
 * Recupera un objeto grande desde partes fragmentadas.
 * @param {string} key
 * @returns {any|null}
 */
function getLargeCache_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const metaStr = cache.get(`${key}_meta`);
    if (!metaStr) return null;
    
    const meta = JSON.parse(metaStr);
    let fullStr = '';
    for (let i = 0; i < meta.count; i++) {
      const chunk = cache.get(`${key}_p${i}`);
      if (!chunk) return null; // Si falta una parte, el rdo no es válido
      fullStr += chunk;
    }
    return JSON.parse(fullStr);
  } catch (e) {
    Logger.log('getLargeCache_ ERROR: ' + e.message);
    return null;
  }
}

/**
 * Invalida el caché maestro de expedientes.
 * Se debe llamar cada vez que se crea, edita o elimina un expediente.
 */
/**
 * Retorna la generacion actual del cache de paginas.
 * Se incluye en la clave de cada pagina para invalidar todas de golpe.
 */
function _getCacheGen_() {
  try {
    const val = CacheService.getScriptCache().get('exp_cache_gen');
    return val ? parseInt(val) : 0;
  } catch (e) { return 0; }
}

/**
 * Incrementa la generacion del cache de paginas.
 * Hace que todas las paginas cacheadas de todos los gestores queden obsoletas de inmediato.
 */
function _bumpCacheGen_() {
  try {
    const cache = CacheService.getScriptCache();
    const gen   = _getCacheGen_() + 1;
    cache.put('exp_cache_gen', String(gen), 3600);
    Logger.log('Cache gen bumped -> ' + gen);
  } catch (e) {
    Logger.log('_bumpCacheGen_ ERROR: ' + e.message);
  }
}

function invalidarCacheMaestro_() {
  try {
    const cache = CacheService.getScriptCache();

    // 1. Limpiar Master List (Sharding)
    const metaStr = cache.get('expedientes_master_list_meta');
    if (metaStr) {
      const meta = JSON.parse(metaStr);
      const keys = ['expedientes_master_list_meta'];
      for (let i = 0; i < meta.count; i++) {
        keys.push('expedientes_master_list_p' + i);
      }
      cache.removeAll(keys);
    }

    // 2. Invalidar TODAS las paginas cacheadas de todos los gestores de golpe
    _bumpCacheGen_();

    // 3. Limpiar KPIs de Dashboard para forzar recalculo
    cache.remove('kpis_dashboard');
    cache.remove('estadisticas_rapidas');

    Logger.log('Cache Maestro + paginas de gestores invalidados');
  } catch (e) {
    Logger.log('invalidarCacheMaestro_ ERROR: ' + e.message);
  }
}
