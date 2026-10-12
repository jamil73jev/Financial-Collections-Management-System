/**
 * SeguimientoService.gs
 * Cálculo de días sin movimiento y consolidación de vistas de seguimiento.
 * Opera en batch sobre todos los expedientes activos.
 */

/**
 * Retorna datos consolidados para la vista de Seguimiento.
 * Accesible para SUPERVISOR y ADMINISTRADOR.
 * @param {string} token
 * @param {string} [categoria] — 'VENCIDOS'|'SIN_MOVIMIENTO'|'CRITICOS'|'POR_FUNCIONARIO'|'TODOS'
 * @returns {{ ok: boolean, data?: Object, error?: string }}
 */
function _legacyGetSeguimientoData_(token, categoria) {
  const acceso = checkAccess_(token, 'VER_SEGUIMIENTO');
  if (!acceso.ok) return acceso;

  const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  const diasAlerta = getDiasAlerta_();
  const ahora      = new Date();

  const resultado = {
    resumen:        _calcResumen_(expedientes),
    vencidos:       _filtrarVencidos_(expedientes, ahora),
    sinMovimiento:  _filtrarSinMovimiento_(expedientes, diasAlerta.sinMovimiento),
    criticos:       _filtrarCriticos_(expedientes, diasAlerta.critico),
    proximosVencer: _filtrarProximosVencer_(expedientes, ahora, diasAlerta.proximoVencer),
    porFuncionario: _agruparPorFuncionario_(expedientes),
    porEstado:      _agruparPorEstado_(expedientes),
    porPrioridad:   _agruparPorPrioridad_(expedientes),
    fechaCalculo:   _fmtSeguimiento_(ahora)
  };

  return { ok: true, data: resultado };
}

/**
 * Recalcula DIAS_SIN_MOVIMIENTO y ALERTA_ESTADO en batch para todos los expedientes activos.
 * Ejecutar como proceso programado o manualmente desde menú Administración.
 * @param {string} token
 * @returns {{ ok: boolean, actualizados?: number, error?: string }}
 */
function calcDiasSinMovimiento_(token) {
  const acceso = checkAccess_(token, 'VERIFICAR_INTEGRIDAD');
  if (!acceso.ok) return acceso;

  const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  const diasAlerta = getDiasAlerta_();
  const ahora      = new Date();
  let   actualizados = 0;

  expedientes.forEach(exp => {
    const fechaRef   = exp.FECHA_ULTIMA_GESTION || exp.FECHA_ASIGNACION;
    if (!fechaRef) return;

    const fechaUlt   = new Date(fechaRef);
    if (isNaN(fechaUlt.getTime())) return;

    const dias       = Math.floor((ahora - fechaUlt) / (1000 * 60 * 60 * 24));
    const alerta     = _calcularAlertaEstado_(exp, dias, ahora, diasAlerta);

    updateRowFields_(SHEET_NAMES.EXPEDIENTES, exp._rowIndex, {
      DIAS_SIN_MOVIMIENTO: dias,
      ALERTA_ESTADO:       alerta
    });
    actualizados++;
  });

  logAction_({
    token,
    hoja:    SHEET_NAMES.EXPEDIENTES,
    accion:  'RECALCULAR_DIAS_SIN_MOVIMIENTO',
    contexto: 'Expedientes actualizados: ' + actualizados,
    origen:  'SeguimientoService.gs'
  });

  return { ok: true, actualizados };
}

// ============================================================
// FILTROS INTERNOS
// ============================================================

function _filtrarVencidos_(expedientes, ahora) {
  return expedientes
    .filter(e => {
      if (!e.FECHA_PROXIMA_GESTION) return false;
      const fpg = new Date(e.FECHA_PROXIMA_GESTION);
      return !isNaN(fpg.getTime()) && fpg < ahora;
    })
    .map(_mapExpResumen_);
}

function _filtrarSinMovimiento_(expedientes, diasLimite) {
  return expedientes
    .filter(e => (parseInt(e.DIAS_SIN_MOVIMIENTO) || 0) >= diasLimite)
    .map(_mapExpResumen_);
}

function _filtrarCriticos_(expedientes, diasCritico) {
  return expedientes
    .filter(e =>
      e.ALERTA_ESTADO === 'CRITICO' ||
      (parseInt(e.DIAS_SIN_MOVIMIENTO) || 0) >= diasCritico
    )
    .map(_mapExpResumen_);
}

function _filtrarProximosVencer_(expedientes, ahora, diasAntes) {
  const limite = new Date(ahora.getTime() + diasAntes * 24 * 60 * 60 * 1000);
  return expedientes
    .filter(e => {
      if (!e.FECHA_PROXIMA_GESTION) return false;
      const fpg = new Date(e.FECHA_PROXIMA_GESTION);
      return !isNaN(fpg.getTime()) && fpg >= ahora && fpg <= limite;
    })
    .map(_mapExpResumen_);
}

function _calcResumen_(expedientes) {
  const total   = expedientes.length;
  const activos = expedientes.filter(e =>
    !['CERRADO_EXITOSO','CERRADO_EXENTO','DERIVADO_SUPERVISOR'].includes(e.ESTADO_EXPEDIENTE)
  ).length;

  return {
    total,
    activos,
    cerrados:   total - activos,
    criticos:   expedientes.filter(e => e.PRIORIDAD === 'CRITICA').length,
    alertas:    expedientes.filter(e => e.ALERTA_ESTADO !== 'OK').length
  };
}

function _agruparPorFuncionario_(expedientes) {
  const mapa = {};
  expedientes.forEach(e => {
    const func = e.FUNCIONARIO_ASIGNADO || '(Sin asignar)';
    if (!mapa[func]) mapa[func] = { funcionario: func, total: 0, vencidos: 0, enGestion: 0 };
    mapa[func].total++;
    if (e.ALERTA_ESTADO === 'VENCIDO' || e.ALERTA_ESTADO === 'CRITICO') mapa[func].vencidos++;
    if (e.ESTADO_EXPEDIENTE === 'EN_GESTION') mapa[func].enGestion++;
  });
  return Object.values(mapa).sort((a, b) => b.total - a.total);
}

function _agruparPorEstado_(expedientes) {
  const mapa = {};
  CATALOGOS.ESTADOS_EXPEDIENTE.forEach(e => { mapa[e] = 0; });
  expedientes.forEach(e => {
    if (mapa[e.ESTADO_EXPEDIENTE] !== undefined) mapa[e.ESTADO_EXPEDIENTE]++;
  });
  return mapa;
}

function _agruparPorPrioridad_(expedientes) {
  const mapa = {};
  CATALOGOS.PRIORIDADES.forEach(p => { mapa[p] = 0; });
  expedientes.forEach(e => {
    if (mapa[e.PRIORIDAD] !== undefined) mapa[e.PRIORIDAD]++;
  });
  return mapa;
}

function _calcularAlertaEstado_(exp, dias, ahora, diasAlerta) {
  // Expedientes cerrados no generan alerta
  const estadosCerrados = ['CERRADO_EXITOSO','CERRADO_EXENTO','DERIVADO_SUPERVISOR'];
  if (estadosCerrados.includes(exp.ESTADO_EXPEDIENTE)) return 'OK';

  if (dias >= diasAlerta.critico) return 'CRITICO';

  if (exp.FECHA_PROXIMA_GESTION) {
    const fpg = new Date(exp.FECHA_PROXIMA_GESTION);
    if (!isNaN(fpg.getTime())) {
      if (fpg < ahora) return 'VENCIDO';
      const diasHastaVencer = Math.floor((fpg - ahora) / (1000 * 60 * 60 * 24));
      if (diasHastaVencer <= diasAlerta.proximoVencer) return 'PROXIMO_VENCER';
    }
  }

  if (dias >= diasAlerta.sinMovimiento) return 'SIN_MOVIMIENTO';

  return 'OK';
}

function _mapExpResumen_(e) {
  return {
    id:                  String(e.ID_EXPEDIENTE || ''),
    contribuyente:       String(e.CONTRIBUYENTE || ''),
    ruc:                 String(e.RUC || ''),
    tipoPersona:         String(e.TIPO_PERSONA || ''),
    estado:              String(e.ESTADO_EXPEDIENTE || ''),
    prioridad:           String(e.PRIORIDAD || ''),
    funcionario:         String(e.FUNCIONARIO_ASIGNADO || ''),
    diasSinMovimiento:   parseInt(e.DIAS_SIN_MOVIMIENTO) || 0,
    fechaProxima:        String(e.FECHA_PROXIMA_GESTION || ''),
    alertaEstado:        String(e.ALERTA_ESTADO || 'OK')
  };
}

function _fmtSeguimiento_(fecha) {
  return Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
