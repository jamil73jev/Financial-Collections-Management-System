/**
 * DashboardService.gs
 * Cálculo de KPIs institucionales para el dashboard.
 * Retorna datos calculados en runtime — no escribe en la hoja DASHBOARD.
 * Accesible para todos los roles (GESTOR+).
 */

/**
 * Retorna todos los KPIs para el dashboard.
 * @param {string} token
 * @returns {{ ok: boolean, kpis?: Object, error?: string }}
 */
function getDashboardKPIs_(token) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  // ── CACHÉ: retornar desde caché si existe (TTL 5 minutos) ────────
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'kpis_dashboard';
  const cached   = cache.get(cacheKey);
  if (cached) {
    try {
      return { ok: true, kpis: JSON.parse(cached), fromCache: true };
    } catch (e) { /* JSON corrupto — recalcular */ }
  }
  // ─────────────────────────────────────────────────────────────────

  const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  // Solo las columnas que realmente se usan en este servicio (↓ transferencia ~60%)
  const gestiones = getDataAsObjectsSelected_(SHEET_NAMES.GESTIONES,
    ['FUNCIONARIO', 'TIPO_GESTION', 'FECHA_REGISTRO', 'TIMESTAMP', 'MONTO_RECAUDADO']);
  const ahora     = new Date();
  const hoy       = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyy-MM-dd');
  const mesActual = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyy-MM');

  // === EXPEDIENTES ===
  // Los expedientes ya son ACTIVO=TRUE (filtro de línea 28-29).
  // "En gestión activa" = no está en un estado terminal/cerrado.
  const ESTADOS_TERMINALES = ['CERRADO_EXITOSO', 'CERRADO_SIN_ACUERDO', 'DERIVADO_TITULO', 'CERRADO_EXENTO'];
  const expActivos         = expedientes.filter(e => !ESTADOS_TERMINALES.includes(e.ESTADO_EXPEDIENTE));
  const expCerrados        = expedientes.filter(e => ESTADOS_TERMINALES.includes(e.ESTADO_EXPEDIENTE));
  const expSinMovimiento   = expActivos.filter(e => e.ALERTA_ESTADO === 'SIN_MOVIMIENTO');
  const expVencidos        = expActivos.filter(e => e.ALERTA_ESTADO === 'VENCIDO');
  const expCriticos        = expActivos.filter(e => e.ALERTA_ESTADO === 'CRITICO');
  const expProximoVencer   = expActivos.filter(e => e.ALERTA_ESTADO === 'PROXIMO_VENCER');

  // === FINANCIERO ===
  const _toNum = v => {
    if (typeof v === 'number') return v;
    let s = String(v || '0').replace(/[^0-9,.-]/g, '').replace(/,/g, '.');
    let n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const totalDeuda = expActivos.reduce((sum, e) => sum + _toNum(e.TOTAL_DEUDA), 0);
  const totalRecaudado = gestiones.reduce((sum, g) => sum + _toNum(g.MONTO_RECAUDADO), 0);

  // Días promedio sin movimiento (solo activos con fecha)
  const diasMovimiento = expActivos
    .map(e => parseInt(e.DIAS_SIN_MOVIMIENTO) || 0)
    .filter(d => d > 0);
  const promedioDias   = diasMovimiento.length > 0
    ? Math.round(diasMovimiento.reduce((a, b) => a + b, 0) / diasMovimiento.length)
    : 0;

  // Porcentaje seguimiento oportuno (activos con alerta OK)
  const expOK = expActivos.filter(e => e.ALERTA_ESTADO === 'OK' || !e.ALERTA_ESTADO);
  const pctOportuno = expActivos.length > 0
    ? Math.round((expOK.length / expActivos.length) * 100)
    : 100;

  // === POR ESTADO ===
  const porEstado = {};
  CATALOGOS.ESTADOS_EXPEDIENTE.forEach(e => { porEstado[e] = 0; });
  expedientes.forEach(e => {
    if (porEstado[e.ESTADO_EXPEDIENTE] !== undefined) porEstado[e.ESTADO_EXPEDIENTE]++;
  });

  // === POR PRIORIDAD ===
  const porPrioridad = {};
  CATALOGOS.PRIORIDADES.forEach(p => { porPrioridad[p] = 0; });
  expedientes.forEach(e => {
    if (porPrioridad[e.PRIORIDAD] !== undefined) porPrioridad[e.PRIORIDAD]++;
  });

  // === GESTIONES ===
  const gestionesMes = gestiones.filter(g => {
    const fecha = String(g.FECHA_REGISTRO || g.TIMESTAMP || '');
    return fecha.startsWith(mesActual);
  });

  const gestionesPorTipo = {};
  CATALOGOS.TIPOS_GESTION.forEach(t => { gestionesPorTipo[t] = 0; });
  gestiones.forEach(g => {
    if (gestionesPorTipo[g.TIPO_GESTION] !== undefined) gestionesPorTipo[g.TIPO_GESTION]++;
  });

  // === PRODUCTIVIDAD POR FUNCIONARIO ===
  // Pasamos los datos ya cargados — evita releer GESTIONES y EXPEDIENTES por segunda vez
  const productividad = getProductividadFuncionario_(token, gestiones, expedientes);

  // Función para formatear moneda (2 decimales + separador de miles)
  const _fmtMoney = (num) => {
    if (typeof num !== 'number') num = parseFloat(num) || 0;
    // Redondear a 2 decimales
    const redondeado = Math.round(num * 100) / 100;
    // Convertir con separador de miles y 2 decimales
    return redondeado.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const kpis = {
    // Expedientes
    totalExpedientes:    expedientes.length,
    expActivos:          expActivos.length,
    expCerrados:         expCerrados.length,
    expSinMovimiento:    expSinMovimiento.length,
    expVencidos:         expVencidos.length,
    expCriticos:         expCriticos.length,
    expProximoVencer:    expProximoVencer.length,

    // Métricas
    promedioDiasSinMovimiento: promedioDias,
    porcentajeSeguimientoOportuno: pctOportuno,

    // Distribuciones
    porEstado,
    porPrioridad,

    // Gestiones
    totalGestiones:    gestiones.length,
    gestionesMes:      gestionesMes.length,
    gestionesPorTipo,

    // Financiero (formateado con 2 decimales y separador de miles)
    totalDeuda:        _fmtMoney(totalDeuda),
    totalRecaudado:    _fmtMoney(totalRecaudado),

    // Productividad
    productividadFuncionario: productividad.ok ? productividad.ranking : [],

    fechaCalculo: _fmtDash_(ahora)
  };

  // ── CACHÉ: guardar resultado por 5 minutos ────────────────────────
  try {
    cache.put(cacheKey, JSON.stringify(kpis), 300);
  } catch (e) {
    Logger.log('Cache KPIs omitido (JSON demasiado grande): ' + e.message);
  }
  // ─────────────────────────────────────────────────────────────────

  return { ok: true, kpis };
}

/**
 * Invalida la caché del dashboard.
 * Llamar tras cualquier operación que modifique expedientes o gestiones.
 */
function invalidarCacheDashboard_() {
  const cache = CacheService.getScriptCache();
  cache.remove('kpis_dashboard');
  cache.remove('conciliacion_dashboard');
}

/**
 * Retorna ranking de productividad por funcionario.
 * @param {string} token
 * @param {Array} [gestionesIn]   — datos ya cargados (evita doble lectura si se llama desde getDashboardKPIs_)
 * @param {Array} [expedientesIn] — expedientes activos ya filtrados (ídem)
 * @returns {{ ok: boolean, ranking?: Array, error?: string }}
 */
function getProductividadFuncionario_(token, gestionesIn, expedientesIn) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  // Reusar datos si ya fueron cargados por el llamador; si no, leer solo columnas necesarias
  const gestiones   = gestionesIn || getDataAsObjectsSelected_(SHEET_NAMES.GESTIONES,
    ['FUNCIONARIO', 'TIPO_GESTION', 'FECHA_REGISTRO', 'TIMESTAMP']);
  const expedientes = expedientesIn || getDataAsObjects_(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  const ahora     = new Date();
  const mesActual = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyy-MM');

  // Mapa de gestiones por funcionario
  const mapaGest = {};
  gestiones.forEach(g => {
    const func = g.FUNCIONARIO || '(Sin asignar)';
    if (!mapaGest[func]) {
      mapaGest[func] = { funcionario: func, totalGestiones: 0, gestionesMes: 0 };
    }
    mapaGest[func].totalGestiones++;
    const fecha = String(g.FECHA_REGISTRO || g.TIMESTAMP || '');
    if (fecha.startsWith(mesActual)) mapaGest[func].gestionesMes++;
  });

  // Mapa de expedientes por funcionario
  const mapaExp = {};
  expedientes.forEach(e => {
    const func = e.FUNCIONARIO_ASIGNADO || '(Sin asignar)';
    if (!mapaExp[func]) {
      mapaExp[func] = { expedientesAsignados: 0, vencidos: 0, enGestion: 0 };
    }
    mapaExp[func].expedientesAsignados++;
    if (e.ALERTA_ESTADO === 'VENCIDO' || e.ALERTA_ESTADO === 'CRITICO') mapaExp[func].vencidos++;
    if (e.ESTADO_EXPEDIENTE === 'EN_GESTION') mapaExp[func].enGestion++;
  });

  // Consolidar ranking
  const todos = new Set([...Object.keys(mapaGest), ...Object.keys(mapaExp)]);
  const ranking = Array.from(todos).map(func => {
    const g = mapaGest[func] || { totalGestiones: 0, gestionesMes: 0 };
    const e = mapaExp[func]  || { expedientesAsignados: 0, vencidos: 0, enGestion: 0 };
    return {
      funcionario:          func,
      totalGestiones:       g.totalGestiones,
      gestionesMes:         g.gestionesMes,
      expedientesAsignados: e.expedientesAsignados,
      expedientesVencidos:  e.vencidos,
      expedientesEnGestion: e.enGestion
    };
  });

  ranking.sort((a, b) => b.gestionesMes - a.gestionesMes);

  return { ok: true, ranking };
}

/**
 * Retorna datos de tendencia de gestiones por mes (últimos 6 meses).
 * @param {string} token
 * @returns {{ ok: boolean, tendencia?: Array, error?: string }}
 */
function getTendenciaGestiones_(token) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  // Solo necesitamos la fecha — lectura mínima
  const gestiones = getDataAsObjectsSelected_(SHEET_NAMES.GESTIONES, ['FECHA_REGISTRO', 'TIMESTAMP']);
  const ahora     = new Date();

  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    const mes = Utilities.formatDate(d, PARAMS.TIMEZONE, 'yyyy-MM');
    meses.push({ mes, etiqueta: Utilities.formatDate(d, PARAMS.TIMEZONE, 'MMM yyyy'), total: 0 });
  }

  gestiones.forEach(g => {
    const fecha = String(g.FECHA_REGISTRO || g.TIMESTAMP || '').substring(0, 7);
    const mesDato = meses.find(m => m.mes === fecha);
    if (mesDato) mesDato.total++;
  });

  return { ok: true, tendencia: meses };
}

function _fmtDash_(fecha) {
  if (!(fecha instanceof Date)) fecha = new Date(fecha);
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
