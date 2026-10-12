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
function getDashboardKPIs(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  const gestiones = getDataAsObjects(SHEET_NAMES.GESTIONES);
  const ahora     = new Date();
  const hoy       = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyy-MM-dd');
  const mesActual = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyy-MM');

  // === EXPEDIENTES ===
  const estadosCerrados    = ['CERRADO_EXITOSO', 'CERRADO_SIN_ACUERDO', 'DERIVADO_COACTIVA'];
  const expActivos         = expedientes.filter(e => !estadosCerrados.includes(e.ESTADO_EXPEDIENTE));
  const expCerrados        = expedientes.filter(e => estadosCerrados.includes(e.ESTADO_EXPEDIENTE));
  const expSinMovimiento   = expActivos.filter(e => e.ALERTA_ESTADO === 'SIN_MOVIMIENTO');
  const expVencidos        = expActivos.filter(e => e.ALERTA_ESTADO === 'VENCIDO');
  const expCriticos        = expActivos.filter(e => e.ALERTA_ESTADO === 'CRITICO');
  const expProximoVencer   = expActivos.filter(e => e.ALERTA_ESTADO === 'PROXIMO_VENCER');

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
  const productividad = getProductividadFuncionario(token);

  return {
    ok: true,
    kpis: {
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

      // Productividad
      productividadFuncionario: productividad.ok ? productividad.ranking : [],

      fechaCalculo: _fmt(ahora)
    }
  };
}

/**
 * Retorna ranking de productividad por funcionario.
 * @param {string} token
 * @returns {{ ok: boolean, ranking?: Array, error?: string }}
 */
function getProductividadFuncionario(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  const gestiones   = getDataAsObjects(SHEET_NAMES.GESTIONES);
  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
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
function getTendenciaGestiones(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  const gestiones = getDataAsObjects(SHEET_NAMES.GESTIONES);
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

function _fmt(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
