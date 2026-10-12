/**
 * ExpedienteService.gs
 * Gestión de expedientes del sistema SIGECO.
 * El EXPEDIENTE es la entidad operativa central del sistema.
 * Un expediente = un caso de seguimiento para un contribuyente/periodo/obligación.
 */

/**
 * Crea un nuevo expediente.
 * @param {string} token
 * @param {Object} datos
 * @param {string} datos.ruc
 * @param {string} datos.contribuyente
 * @param {string} datos.periodo
 * @param {string} datos.tipoObligacion
 * @param {string} datos.estadoExpediente
 * @param {string} datos.prioridad
 * @param {string} [datos.funcionarioAsignado]
 * @param {string} [datos.observacionGeneral]
 * @param {string} [datos.codigoInterno]
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
function createExpediente(token, datos) {
  const acceso = checkAccess(token, 'CREAR_EXPEDIENTE');
  if (!acceso.ok) return acceso;

  const validacion = validateExpediente(datos);
  if (!validacion.valido) {
    return { ok: false, error: validacion.errores.join(' | ') };
  }

  const ahora = new Date();
  const id    = _generarIdExpediente(ahora);

  const fila = [
    id,                                          // ID_EXPEDIENTE
    datos.codigoInterno || '',                   // CODIGO_INTERNO
    String(datos.ruc).trim(),                    // RUC
    datos.contribuyente,                         // CONTRIBUYENTE
    datos.periodo,                               // PERIODO
    datos.tipoObligacion,                        // TIPO_OBLIGACION
    datos.estadoExpediente,                      // ESTADO_EXPEDIENTE
    datos.prioridad,                             // PRIORIDAD
    datos.funcionarioAsignado || '',             // FUNCIONARIO_ASIGNADO
    datos.funcionarioAsignado ? _fmt(ahora) : '',// FECHA_ASIGNACION
    '',                                          // FECHA_ULTIMA_GESTION
    datos.fechaProximaGestion || '',             // FECHA_PROXIMA_GESTION
    0,                                           // DIAS_SIN_MOVIMIENTO
    '',                                          // RESULTADO_ULTIMA_GESTION
    datos.observacionGeneral || '',              // OBSERVACION_GENERAL
    'OK',                                        // ALERTA_ESTADO
    'TRUE'                                       // ACTIVO
  ];

  appendRow(SHEET_NAMES.EXPEDIENTES, fila);

  logAction({
    token,
    hoja:          SHEET_NAMES.EXPEDIENTES,
    idExpediente:  id,
    accion:        'CREAR_EXPEDIENTE',
    contexto:      'RUC: ' + datos.ruc + ' | Periodo: ' + datos.periodo +
                   ' | Prioridad: ' + datos.prioridad,
    origen:        'ExpedienteService.gs'
  });

  return { ok: true, id };
}

/**
 * Actualiza campos específicos de un expediente.
 * Registra cada cambio individualmente en BITACORA.
 * @param {string} token
 * @param {string} idExpediente
 * @param {Object} cambios  — { campo: nuevoValor, ... }
 * @returns {{ ok: boolean, error?: string }}
 */
function updateExpediente(token, idExpediente, cambios) {
  const acceso = checkAccess(token, 'ACTUALIZAR_EXPEDIENTE');
  if (!acceso.ok) return acceso;

  const { existe, expediente } = validarExpedienteExiste(idExpediente);
  if (!existe) return { ok: false, error: 'Expediente no encontrado: ' + idExpediente };

  // Verificar acceso al expediente (gestor solo ve los suyos)
  if (!puedeAccederExpediente(acceso.sesion, expediente)) {
    return { ok: false, error: 'Sin acceso a este expediente.' };
  }

  // Campos protegidos que no puede cambiar un GESTOR
  const camposProtegidos = ['ID_EXPEDIENTE', 'RUC', 'ACTIVO'];
  const camposReasignacion = ['FUNCIONARIO_ASIGNADO', 'FECHA_ASIGNACION'];

  const camposPermitidos = {};
  for (const [campo, valor] of Object.entries(cambios)) {
    if (camposProtegidos.includes(campo)) continue;
    if (camposReasignacion.includes(campo) &&
        acceso.sesion.nivel < ROLES.SUPERVISOR.nivel) continue;
    camposPermitidos[campo] = valor;
  }

  if (Object.keys(camposPermitidos).length === 0) {
    return { ok: false, error: 'No hay campos permitidos para actualizar.' };
  }

  // Aplicar cambios y registrar cada uno en bitácora
  Object.entries(camposPermitidos).forEach(([campo, nuevoValor]) => {
    const valorAnterior = expediente[campo];
    updateRowFields(SHEET_NAMES.EXPEDIENTES, expediente._rowIndex, {
      [campo]: nuevoValor
    });
    logChange({
      token,
      hoja:          SHEET_NAMES.EXPEDIENTES,
      idExpediente,
      accion:        'ACTUALIZAR_EXPEDIENTE',
      campo,
      valorAnterior,
      valorNuevo:    nuevoValor,
      origen:        'ExpedienteService.gs'
    });
  });

  return { ok: true };
}

/**
 * Retorna un expediente por ID.
 * @param {string} token
 * @param {string} idExpediente
 * @returns {{ ok: boolean, expediente?: Object, error?: string }}
 */
function getExpediente(token, idExpediente) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  const { existe, expediente } = validarExpedienteExiste(idExpediente);
  if (!existe) return { ok: false, error: 'Expediente no encontrado.' };

  if (!puedeAccederExpediente(sesion, expediente)) {
    return { ok: false, error: 'Sin acceso a este expediente.' };
  }

  return { ok: true, expediente: _limpiarExpediente(expediente) };
}

/**
 * Retorna lista paginada de expedientes con filtros.
 * @param {string} token
 * @param {number} pagina — base 1
 * @param {Object} [filtros] — { estado, prioridad, funcionario, alerta, ruc, sinMovimiento }
 * @returns {{ ok: boolean, expedientes?: Array, total?: number, pagina?: number, error?: string }}
 */
function listExpedientes(token, pagina, filtros) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  pagina  = parseInt(pagina) || 1;
  filtros = filtros || {};

  let registros = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
    .filter(r => r.ACTIVO === 'TRUE' || r.ACTIVO === true);

  // Gestor solo ve los suyos
  if (sesion.nivel < ROLES.SUPERVISOR.nivel) {
    registros = registros.filter(r =>
      (r.FUNCIONARIO_ASIGNADO || '').toLowerCase() === sesion.usuario.toLowerCase()
    );
  }

  // Filtros adicionales
  if (filtros.estado) {
    registros = registros.filter(r => r.ESTADO_EXPEDIENTE === filtros.estado);
  }
  if (filtros.prioridad) {
    registros = registros.filter(r => r.PRIORIDAD === filtros.prioridad);
  }
  if (filtros.funcionario) {
    registros = registros.filter(r =>
      (r.FUNCIONARIO_ASIGNADO || '').toLowerCase().includes(filtros.funcionario.toLowerCase())
    );
  }
  if (filtros.alerta) {
    registros = registros.filter(r => r.ALERTA_ESTADO === filtros.alerta);
  }
  if (filtros.ruc) {
    registros = registros.filter(r =>
      String(r.RUC).includes(filtros.ruc)
    );
  }
  if (filtros.busqueda) {
    const q = filtros.busqueda.toLowerCase();
    registros = registros.filter(r =>
      (r.CONTRIBUYENTE || '').toLowerCase().includes(q) ||
      String(r.RUC).includes(q) ||
      (r.ID_EXPEDIENTE || '').toLowerCase().includes(q)
    );
  }

  // Ordenar: CRITICO y ALTA prioridad primero, luego por días sin movimiento desc
  const ordenPrioridad = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };
  registros.sort((a, b) => {
    const pa = ordenPrioridad[a.PRIORIDAD] ?? 99;
    const pb = ordenPrioridad[b.PRIORIDAD] ?? 99;
    if (pa !== pb) return pa - pb;
    return (parseInt(b.DIAS_SIN_MOVIMIENTO) || 0) - (parseInt(a.DIAS_SIN_MOVIMIENTO) || 0);
  });

  const total  = registros.length;
  const inicio = (pagina - 1) * PARAMS.PAGE_SIZE;
  const datos  = registros
    .slice(inicio, inicio + PARAMS.PAGE_SIZE)
    .map(_limpiarExpediente);

  return { ok: true, expedientes: datos, total, pagina, pageSize: PARAMS.PAGE_SIZE };
}

/**
 * Retorna el historial de gestiones de un expediente.
 * @param {string} token
 * @param {string} idExpediente
 * @returns {{ ok: boolean, gestiones?: Array, error?: string }}
 */
function getHistorialExpediente(token, idExpediente) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  const { existe, expediente } = validarExpedienteExiste(idExpediente);
  if (!existe) return { ok: false, error: 'Expediente no encontrado.' };

  if (!puedeAccederExpediente(sesion, expediente)) {
    return { ok: false, error: 'Sin acceso a este expediente.' };
  }

  const gestiones = getDataAsObjects(SHEET_NAMES.GESTIONES)
    .filter(g => g.ID_EXPEDIENTE === idExpediente)
    .sort((a, b) => {
      const tA = a.TIMESTAMP ? new Date(a.TIMESTAMP).getTime() : 0;
      const tB = b.TIMESTAMP ? new Date(b.TIMESTAMP).getTime() : 0;
      return tB - tA;
    })
    .map(g => ({
      id:                String(g.ID_GESTION || ''),
      fechaRegistro:     String(g.FECHA_REGISTRO || ''),
      funcionario:       String(g.FUNCIONARIO || ''),
      tipoGestion:       String(g.TIPO_GESTION || ''),
      resultado:         String(g.RESULTADO || ''),
      observacion:       String(g.OBSERVACION || ''),
      fechaProxima:      String(g.FECHA_PROXIMA_GESTION || ''),
      estadoPostGestion: String(g.ESTADO_POST_GESTION || ''),
      usuarioEditor:     String(g.USUARIO_EDITOR || ''),
      timestamp:         String(g.TIMESTAMP || '')
    }));

  return { ok: true, gestiones };
}

/**
 * Desactiva (cierre lógico) un expediente. Solo SUPERVISOR+.
 * @param {string} token
 * @param {string} idExpediente
 * @param {string} motivoCierre
 * @returns {{ ok: boolean, error?: string }}
 */
function cerrarExpediente(token, idExpediente, motivoCierre) {
  const acceso = checkAccess(token, 'CERRAR_EXPEDIENTE');
  if (!acceso.ok) return acceso;

  const { existe, expediente } = validarExpedienteExiste(idExpediente);
  if (!existe) return { ok: false, error: 'Expediente no encontrado.' };

  const estadoAnterior = expediente.ESTADO_EXPEDIENTE;
  updateRowFields(SHEET_NAMES.EXPEDIENTES, expediente._rowIndex, {
    ESTADO_EXPEDIENTE: 'CERRADO_SIN_ACUERDO',
    OBSERVACION_GENERAL: (expediente.OBSERVACION_GENERAL || '') +
                          ' | CIERRE: ' + motivoCierre
  });

  logChange({
    token,
    hoja:          SHEET_NAMES.EXPEDIENTES,
    idExpediente,
    accion:        'CERRAR_EXPEDIENTE',
    campo:         'ESTADO_EXPEDIENTE',
    valorAnterior: estadoAnterior,
    valorNuevo:    'CERRADO_SIN_ACUERDO',
    contexto:      'Motivo: ' + motivoCierre,
    origen:        'ExpedienteService.gs'
  });

  return { ok: true };
}

// ============================================================
// FUNCIONES PRIVADAS
// ============================================================

function _generarIdExpediente(fecha) {
  const prefijo  = getConfig('PREFIJO_EXPEDIENTE', 'EXP');
  const fechaStr = Utilities.formatDate(fecha, PARAMS.TIMEZONE, 'yyyyMMdd');
  const sufijo   = String(fecha.getTime()).slice(-4);
  return prefijo + '-' + fechaStr + '-' + sufijo;
}

function _limpiarExpediente(exp) {
  const safeStr = (v) => {
    if (v instanceof Date) return Utilities.formatDate(v, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
    return String(v || '');
  };
  
  return {
    id:                   String(exp.ID_EXPEDIENTE || ''),
    codigoInterno:        String(exp.CODIGO_INTERNO || ''),
    ruc:                  String(exp.RUC || ''),
    contribuyente:        String(exp.CONTRIBUYENTE || ''),
    periodo:              String(exp.PERIODO || ''),
    tipoObligacion:       String(exp.TIPO_OBLIGACION || ''),
    estadoExpediente:     String(exp.ESTADO_EXPEDIENTE || ''),
    prioridad:            String(exp.PRIORIDAD || ''),
    funcionarioAsignado:  String(exp.FUNCIONARIO_ASIGNADO || ''),
    fechaAsignacion:      safeStr(exp.FECHA_ASIGNACION),
    fechaUltimaGestion:   safeStr(exp.FECHA_ULTIMA_GESTION),
    fechaProximaGestion:  safeStr(exp.FECHA_PROXIMA_GESTION),
    diasSinMovimiento:    parseInt(exp.DIAS_SIN_MOVIMIENTO) || 0,
    resultadoUltimaGest:  String(exp.RESULTADO_ULTIMA_GESTION || ''),
    observacionGeneral:   String(exp.OBSERVACION_GENERAL || ''),
    alertaEstado:         String(exp.ALERTA_ESTADO || 'OK'),
    activo:               exp.ACTIVO === 'TRUE' || exp.ACTIVO === true
  };
}

function _fmt(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
