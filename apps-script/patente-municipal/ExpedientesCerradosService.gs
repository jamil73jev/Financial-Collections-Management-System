/**
 * ExpedientesCerradosService.gs
 * Gestión del ciclo de vida de expedientes cerrados.
 * Todo cierre copia el registro a EXPEDIENTES_CERRADOS y marca ACTIVO=FALSE en EXPEDIENTES.
 */

// ============================================================
// CIERRE CON REGISTRO (reemplaza el updateExpediente del frontend)
// ============================================================

/**
 * Cierra un expediente con motivo y observación.
 * Copia a EXPEDIENTES_CERRADOS y marca ACTIVO=FALSE en EXPEDIENTES.
 * Roles requeridos: SUPERVISOR o ADMINISTRADOR.
 *
 * @param {string} token
 * @param {string} idExpediente
 * @param {string} motivo       — valor de CATALOGOS.ESTADOS_EXPEDIENTE (terminal)
 * @param {string} observacion  — texto libre
 * @returns {{ ok, error? }}
 */
function cerrarExpedienteConRegistro(token, idExpediente, motivo, observacion) {
  const acceso = checkAccess(token, 'CERRAR_EXPEDIENTE');
  if (!acceso.ok) return acceso;
  const sesion = acceso.sesion;

  if (!idExpediente) return { ok: false, error: 'ID de expediente requerido.' };
  if (!motivo)       return { ok: false, error: 'Motivo de cierre requerido.' };

  const MOTIVOS_VALIDOS = ['CERRADO_EXITOSO', 'CERRADO_SIN_ACUERDO', 'DERIVADO_TITULO'];
  if (!MOTIVOS_VALIDOS.includes(motivo)) {
    return { ok: false, error: 'Motivo de cierre inválido: ' + motivo };
  }

  const { existe, expediente } = validarExpedienteExiste(idExpediente);
  if (!existe) return { ok: false, error: 'Expediente no encontrado: ' + idExpediente };

  if (expediente.ACTIVO === 'FALSE' || expediente.ACTIVO === false) {
    return { ok: false, error: 'El expediente ya está cerrado.' };
  }

  try {
    _copiarAExpedientesCerrados(expediente, motivo, sesion.usuario, observacion || '');

    updateRowFields(SHEET_NAMES.EXPEDIENTES, expediente._rowIndex, {
      ESTADO_EXPEDIENTE:   motivo,
      ACTIVO:              'FALSE',
      ALERTA_ESTADO:       'OK',
      OBSERVACION_GENERAL: observacion ? 'CIERRE: ' + observacion : 'Expediente cerrado'
    });

    logChange({
      token,
      hoja:          SHEET_NAMES.EXPEDIENTES,
      idExpediente,
      accion:        'CIERRE_EXPEDIENTE',
      campo:         'ESTADO_EXPEDIENTE',
      valorAnterior: expediente.ESTADO_EXPEDIENTE,
      valorNuevo:    motivo,
      contexto:      'Cerrado por ' + sesion.usuario + '. Obs: ' + (observacion || ''),
      origen:        'ExpedientesCerradosService.gs'
    });

    invalidarCacheMaestro();
    invalidarCacheDashboard();

    return { ok: true };
  } catch (err) {
    Logger.log('cerrarExpedienteConRegistro ERROR: ' + err.message);
    return { ok: false, error: 'Error al cerrar expediente: ' + err.message };
  }
}

// ============================================================
// CIERRE COMO EXENTO (solo para DERIVADO_SUPERVISOR)
// ============================================================

/**
 * Cierra un expediente como EXENTO.
 * Solo aplica a expedientes en estado DERIVADO_SUPERVISOR.
 * No genera recaudación — solo marca la exención.
 *
 * @param {string} token
 * @param {string} idExpediente
 * @param {string} observacion
 * @returns {{ ok, error? }}
 */
function cerrarExpedienteExento(token, idExpediente, observacion) {
  const acceso = checkAccess(token, 'CERRAR_EXPEDIENTE_EXENTO');
  if (!acceso.ok) return acceso;
  const sesion = acceso.sesion;

  if (!idExpediente) return { ok: false, error: 'ID de expediente requerido.' };
  if (!observacion || !String(observacion).trim()) return { ok: false, error: 'Motivo de la exención requerido.' };

  const { existe, expediente } = validarExpedienteExiste(idExpediente);
  if (!existe) return { ok: false, error: 'Expediente no encontrado: ' + idExpediente };

  if (expediente.ESTADO_EXPEDIENTE !== 'DERIVADO_SUPERVISOR') {
    return { ok: false, error: 'Solo se pueden cerrar como exentos los expedientes en estado DERIVADO_SUPERVISOR.' };
  }

  if (expediente.ACTIVO === 'FALSE' || expediente.ACTIVO === false) {
    return { ok: false, error: 'El expediente ya está cerrado.' };
  }

  try {
    _copiarAExpedientesCerrados(expediente, 'CERRADO_EXENTO', sesion.usuario, observacion || '');

    updateRowFields(SHEET_NAMES.EXPEDIENTES, expediente._rowIndex, {
      ESTADO_EXPEDIENTE:   'CERRADO_EXENTO',
      ACTIVO:              'FALSE',
      ALERTA_ESTADO:       'OK',
      OBSERVACION_GENERAL: 'EXENTO: ' + (observacion || 'Expediente cerrado como exento')
    });

    logChange({
      token,
      hoja:          SHEET_NAMES.EXPEDIENTES,
      idExpediente,
      accion:        'CIERRE_EXENTO',
      campo:         'ESTADO_EXPEDIENTE',
      valorAnterior: 'DERIVADO_SUPERVISOR',
      valorNuevo:    'CERRADO_EXENTO',
      contexto:      'Cerrado como exento por ' + sesion.usuario + '. Obs: ' + (observacion || ''),
      origen:        'ExpedientesCerradosService.gs'
    });

    invalidarCacheMaestro();
    invalidarCacheDashboard();

    return { ok: true };
  } catch (err) {
    Logger.log('cerrarExpedienteExento ERROR: ' + err.message);
    return { ok: false, error: 'Error al cerrar expediente como exento: ' + err.message };
  }
}

// ============================================================
// LISTADO DE EXPEDIENTES CERRADOS
// ============================================================

/**
 * Lista expedientes cerrados con paginación y filtros.
 * Accesible solo para SUPERVISOR y ADMINISTRADOR.
 *
 * @param {string} token
 * @param {number} pagina
 * @param {Object} filtros — { busqueda, motivo, funcionario, desde, hasta }
 * @returns {{ ok, expedientes, total, pagina, pageSize, totalPages }}
 */
function listExpedientesCerrados(token, pagina, filtros) {
  const acceso = checkAccess(token, 'VER_EXPEDIENTES_CERRADOS');
  if (!acceso.ok) return acceso;

  pagina  = Math.max(1, parseInt(pagina) || 1);
  filtros = filtros || {};
  const pageSize = PARAMS.PAGE_SIZE || 50;

  try {
    const ss = getSpreadsheet();

    // 1. Leer registros de EXPEDIENTES_CERRADOS
    let datos = ss.getSheetByName(SHEET_NAMES.EXPEDIENTES_CERRADOS)
      ? getDataAsObjects(SHEET_NAMES.EXPEDIENTES_CERRADOS)
      : [];

    // Índice de IDs ya presentes en EXPEDIENTES_CERRADOS
    const idsEnCerrados = new Set(datos.map(e => String(e.ID_EXPEDIENTE || '')));

    // 2. Buscar en EXPEDIENTES los que tienen estado cerrado pero no están en EXPEDIENTES_CERRADOS
    const expActivos = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
    expActivos.forEach(e => {
      if (!esEstadoTerminal(e.ESTADO_EXPEDIENTE)) return;
      if (idsEnCerrados.has(String(e.ID_EXPEDIENTE || ''))) return;
      // Mapear a la estructura de EXPEDIENTES_CERRADOS
      datos.push({
        ID_EXPEDIENTE:          e.ID_EXPEDIENTE,
        CODIGO_INTERNO:         e.CODIGO_INTERNO,
        RUC:                    e.RUC,
        CONTRIBUYENTE:          e.CONTRIBUYENTE,
        TIPO_PERSONA:           e.TIPO_PERSONA,
        TIPO_OBLIGACION:        e.TIPO_OBLIGACION,
        ESTADO_EXPEDIENTE:      e.ESTADO_EXPEDIENTE,
        PRIORIDAD:              e.PRIORIDAD,
        FUNCIONARIO_ASIGNADO:   e.FUNCIONARIO_ASIGNADO,
        FECHA_ASIGNACION:       e.FECHA_ASIGNACION,
        TOTAL_DEUDA:            e.TOTAL_DEUDA,
        MONTO_PAGADO:           e.MONTO_PAGADO,
        SALDO_PENDIENTE:        e.SALDO_PENDIENTE,
        FECHA_CIERRE:           e.FECHA_ULTIMA_GESTION || '',
        MOTIVO_CIERRE:          e.ESTADO_EXPEDIENTE,
        CERRADO_POR:            e.FUNCIONARIO_ASIGNADO || '',
        OBSERVACION_CIERRE:     e.OBSERVACION_GENERAL || ''
      });
    });

    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      datos = datos.filter(e =>
        String(e.ID_EXPEDIENTE || '').toLowerCase().includes(q) ||
        String(e.CONTRIBUYENTE || '').toLowerCase().includes(q) ||
        String(e.RUC || '').toLowerCase().includes(q)
      );
    }

    if (filtros.motivo && filtros.motivo !== '') {
      datos = datos.filter(e => e.MOTIVO_CIERRE === filtros.motivo);
    }

    if (filtros.funcionario && filtros.funcionario !== '') {
      const fLower = filtros.funcionario.toLowerCase();
      datos = datos.filter(e =>
        String(e.FUNCIONARIO_ASIGNADO || '').toLowerCase().includes(fLower)
      );
    }

    if (filtros.desde) {
      const desde = new Date(filtros.desde);
      datos = datos.filter(e => e.FECHA_CIERRE && new Date(e.FECHA_CIERRE) >= desde);
    }

    if (filtros.hasta) {
      const hasta = new Date(filtros.hasta);
      datos = datos.filter(e => e.FECHA_CIERRE && new Date(e.FECHA_CIERRE) <= hasta);
    }

    // Ordenar por fecha de cierre descendente
    datos.sort((a, b) => {
      const tA = a.FECHA_CIERRE ? new Date(a.FECHA_CIERRE).getTime() : 0;
      const tB = b.FECHA_CIERRE ? new Date(b.FECHA_CIERRE).getTime() : 0;
      return tB - tA;
    });

    const total  = datos.length;
    const inicio = (pagina - 1) * pageSize;
    const pag    = datos.slice(inicio, inicio + pageSize);

    const _parse = v => {
      if (typeof v === 'number') return v;
      const n = parseFloat(String(v || '0').replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? 0 : n;
    };

    const expedientes = pag.map(e => ({
      id:                  e.ID_EXPEDIENTE,
      codigoInterno:       e.CODIGO_INTERNO,
      ruc:                 e.RUC,
      contribuyente:       e.CONTRIBUYENTE,
      tipoPersona:         e.TIPO_PERSONA,
      tipoObligacion:      e.TIPO_OBLIGACION,
      estadoExpediente:    e.ESTADO_EXPEDIENTE,
      prioridad:           e.PRIORIDAD,
      funcionarioAsignado: e.FUNCIONARIO_ASIGNADO,
      fechaAsignacion:     e.FECHA_ASIGNACION,
      totalDeuda:          _parse(e.TOTAL_DEUDA),
      montoPagado:         _parse(e.MONTO_PAGADO),
      saldoPendiente:      _parse(e.SALDO_PENDIENTE),
      fechaCierre:         e.FECHA_CIERRE,
      motivoCierre:        e.MOTIVO_CIERRE,
      cerradoPor:          e.CERRADO_POR,
      observacionCierre:   e.OBSERVACION_CIERRE
    }));

    return { ok: true, expedientes, total, pagina, pageSize, totalPages: Math.ceil(total / pageSize) };

  } catch (err) {
    Logger.log('listExpedientesCerrados ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// REABRIR EXPEDIENTE (solo ADMINISTRADOR)
// ============================================================

/**
 * Reactiva un expediente cerrado y lo reasigna a un gestor.
 * Solo el ADMINISTRADOR puede ejecutar esta acción.
 *
 * @param {string} token
 * @param {string} idExpediente
 * @param {string} nuevoFuncionario — correo del gestor al que se reasignará
 * @returns {{ ok, error? }}
 */
function reabrirExpediente(token, idExpediente, nuevoFuncionario) {
  const acceso = checkAccess(token, 'REABRIR_EXPEDIENTE');
  if (!acceso.ok) return acceso;
  const sesion = acceso.sesion;

  if (!idExpediente)   return { ok: false, error: 'ID de expediente requerido.' };
  if (!nuevoFuncionario) return { ok: false, error: 'Funcionario requerido para reabrir.' };

  try {
    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
    const exp = expedientes.find(e => String(e.ID_EXPEDIENTE) === String(idExpediente));
    if (!exp) return { ok: false, error: 'Expediente no encontrado: ' + idExpediente };

    if (!esEstadoTerminal(exp.ESTADO_EXPEDIENTE)) {
      return { ok: false, error: 'El expediente no está en estado cerrado.' };
    }

    const estadoAnterior = exp.ESTADO_EXPEDIENTE;
    const ahora = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");

    updateRowFields(SHEET_NAMES.EXPEDIENTES, exp._rowIndex, {
      ESTADO_EXPEDIENTE:   'EN_GESTION',
      ACTIVO:              'TRUE',
      ALERTA_ESTADO:       'OK',
      FUNCIONARIO_ASIGNADO: nuevoFuncionario,
      FECHA_ASIGNACION:    ahora,
      DIAS_SIN_MOVIMIENTO: 0,
      OBSERVACION_GENERAL: 'REABIERTO por ' + sesion.usuario + ' el ' + ahora.substring(0, 10)
    });

    // Eliminar de EXPEDIENTES_CERRADOS para que no siga apareciendo en esa sección
    const hojaCerrados = getSpreadsheet().getSheetByName(SHEET_NAMES.EXPEDIENTES_CERRADOS);
    if (hojaCerrados) {
      const cerrados = getDataAsObjects(SHEET_NAMES.EXPEDIENTES_CERRADOS);
      const fila = cerrados.find(c => String(c.ID_EXPEDIENTE) === String(idExpediente));
      if (fila) hojaCerrados.deleteRow(fila._rowIndex);
    }

    logChange({
      token,
      hoja:          SHEET_NAMES.EXPEDIENTES,
      idExpediente,
      accion:        'REABRIR_EXPEDIENTE',
      campo:         'ESTADO_EXPEDIENTE',
      valorAnterior: estadoAnterior,
      valorNuevo:    'EN_GESTION',
      contexto:      'Reabierto por ' + sesion.usuario + '. Nuevo gestor: ' + nuevoFuncionario,
      origen:        'ExpedientesCerradosService.gs'
    });

    invalidarCacheMaestro();
    invalidarCacheDashboard();

    return { ok: true };
  } catch (err) {
    Logger.log('reabrirExpediente ERROR: ' + err.message);
    return { ok: false, error: 'Error al reabrir expediente: ' + err.message };
  }
}

// ============================================================
// SETUP DE HOJA
// ============================================================

/**
 * Crea la hoja EXPEDIENTES_CERRADOS si no existe.
 * Ejecutar una vez desde la consola GAS.
 */
function setupExpedientesCerradosSheet() {
  const ss  = getSpreadsheet();
  const nombre = SHEET_NAMES.EXPEDIENTES_CERRADOS;
  let hoja  = ss.getSheetByName(nombre);

  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.appendRow(HEADERS.EXPEDIENTES_CERRADOS);
    const rng = hoja.getRange(1, 1, 1, HEADERS.EXPEDIENTES_CERRADOS.length);
    rng.setBackground('#4a148c').setFontColor('#ffffff').setFontWeight('bold');
    hoja.setFrozenRows(1);
    Logger.log('OK: hoja ' + nombre + ' creada con ' + HEADERS.EXPEDIENTES_CERRADOS.length + ' columnas');
  } else {
    Logger.log('OK: hoja ' + nombre + ' ya existe');
  }

  return { ok: true, mensaje: 'Hoja ' + nombre + ' lista.' };
}

// ============================================================
// FUNCIÓN INTERNA
// ============================================================

/**
 * Copia un expediente a la hoja EXPEDIENTES_CERRADOS.
 * @param {Object} exp       — registro completo del expediente (con _rowIndex)
 * @param {string} motivo    — estado de cierre (CERRADO_EXITOSO, etc.)
 * @param {string} cerradoPor
 * @param {string} observacion
 */
function _copiarAExpedientesCerrados(exp, motivo, cerradoPor, observacion) {
  const ss   = getSpreadsheet();
  let hoja   = ss.getSheetByName(SHEET_NAMES.EXPEDIENTES_CERRADOS);

  if (!hoja) {
    setupExpedientesCerradosSheet();
    hoja = ss.getSheetByName(SHEET_NAMES.EXPEDIENTES_CERRADOS);
  }

  const ahora = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");

  // Construir fila en el orden de HEADERS.EXPEDIENTES_CERRADOS
  const fila = [
    exp.ID_EXPEDIENTE,
    exp.CODIGO_INTERNO || '',
    exp.RUC || '',
    exp.CONTRIBUYENTE || '',
    exp.TIPO_PERSONA || '',
    exp.TIPO_OBLIGACION || '',
    motivo,
    exp.PRIORIDAD || '',
    exp.FUNCIONARIO_ASIGNADO || '',
    exp.FECHA_ASIGNACION || '',
    exp.FECHA_ULTIMA_GESTION || '',
    exp.FECHA_PROXIMA_GESTION || '',
    exp.DIAS_SIN_MOVIMIENTO || 0,
    exp.RESULTADO_ULTIMA_GESTION || '',
    exp.OBSERVACION_GENERAL || '',
    exp.ALERTA_ESTADO || 'OK',
    'FALSE',
    parseFloat(exp.VALOR_IMPUESTO) || 0,
    parseFloat(exp.VALOR_INTERES)  || 0,
    parseFloat(exp.VALOR_MULTA)    || 0,
    parseFloat(exp.VALOR_RECARGO)  || 0,
    parseFloat(exp.TOTAL_DEUDA)    || 0,
    parseFloat(exp.MONTO_PAGADO)   || 0,
    parseFloat(exp.SALDO_PENDIENTE) || 0,
    parseFloat(exp.PORCENTAJE_RECUPERADO) || 0,
    exp.FECHA_ULTIMO_PAGO || '',
    // Columnas extra
    ahora,
    motivo,
    cerradoPor,
    observacion
  ];

  hoja.appendRow(fila);
  Logger.log('Expediente copiado a CERRADOS: ' + exp.ID_EXPEDIENTE + ' | Motivo: ' + motivo);
}
