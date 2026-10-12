/**
 * GestionService.gs
 * Registro de gestiones sobre expedientes.
 * Toda gestión es append-only y dispara actualización automática del expediente.
 * Es el corazón operativo del sistema de seguimiento.
 */

/**
 * Registra una nueva gestión sobre un expediente.
 * Actualiza automáticamente los campos derivados del expediente.
 *
 * @param {string} token
 * @param {Object} datos
 * @param {string} datos.idExpediente
 * @param {string} datos.tipoGestion
 * @param {string} datos.resultado
 * @param {string} [datos.observacion]
 * @param {string} [datos.fechaProximaGestion]  — ISO date string
 * @param {string} [datos.estadoPostGestion]    — nuevo estado del expediente
 * @param {number} [datos.montoRecaudado]       — valor pagado en esta gestión
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
function registerGestion_(token, datos) {
  if (!datos) return { ok: false, error: 'Datos de gestión no proporcionados.' };

  const acceso = checkAccess_(token, 'REGISTRAR_GESTION');
  if (!acceso.ok) return acceso;

  const sesion = acceso.sesion;

  // Validar datos de la gestión
  const validacion = validateGestion_({
    idExpediente:      datos.idExpediente,
    tipoGestion:       datos.tipoGestion,
    resultado:         datos.resultado,
    funcionario:       sesion.usuario,
    estadoPostGestion: datos.estadoPostGestion,
    fechaProximaGestion: datos.fechaProximaGestion
  });
  if (!validacion.valido) {
    return { ok: false, error: validacion.errores.join(' | ') };
  }

  // Validar que el expediente existe
  const { existe, expediente } = validarExpedienteExiste_(datos.idExpediente);
  if (!existe) return { ok: false, error: 'Expediente no encontrado: ' + datos.idExpediente };

  // Bloquear gestiones en estados terminales
  const ESTADOS_TERMINALES = ['CERRADO_EXITOSO', 'CERRADO_SIN_ACUERDO', 'DERIVADO_TITULO', 'CERRADO_EXENTO'];
  if (ESTADOS_TERMINALES.includes(expediente.ESTADO_EXPEDIENTE)) {
    return { ok: false, error: 'El expediente está cerrado (' + expediente.ESTADO_EXPEDIENTE.replace(/_/g,' ') + '). No se pueden registrar nuevas gestiones.' };
  }

  // Verificar acceso al expediente
  if (!puedeAccederExpediente_(sesion, expediente)) {
    return { ok: false, error: 'Sin acceso a este expediente.' };
  }

  const ahora = new Date();
  const id    = _generarIdGestion_(ahora);

  // Registrar gestión
  appendRow_(SHEET_NAMES.GESTIONES, [
    id,                                         // ID_GESTION
    _fmtGestion_(ahora),                         // FECHA_REGISTRO
    datos.idExpediente,                         // ID_EXPEDIENTE
    sesion.usuario,                             // FUNCIONARIO
    datos.tipoGestion,                          // TIPO_GESTION
    datos.resultado,                            // RESULTADO
    datos.observacion || '',                    // OBSERVACION
    datos.fechaProximaGestion || '',            // FECHA_PROXIMA_GESTION
    datos.estadoPostGestion || '',              // ESTADO_POST_GESTION
    parseFloat(datos.montoRecaudado) || 0,      // MONTO_RECAUDADO
    sesion.usuario,                             // USUARIO_EDITOR
    ahora.toISOString()                         // TIMESTAMP
  ]);

  // Actualizar expediente automáticamente
  _actualizarExpedienteDesdeGestion_(token, expediente, datos, ahora);

  logAction_({
    token,
    hoja:         SHEET_NAMES.GESTIONES,
    idExpediente: datos.idExpediente,
    accion:       'REGISTRAR_GESTION',
    contexto:     'Tipo: ' + datos.tipoGestion + ' | Resultado: ' + datos.resultado,
    origen:       'GestionService.gs'
  });

  invalidarCacheDashboard_();
  if (typeof invalidarCacheMaestro_ === 'function') {
    invalidarCacheMaestro_();
  }

  // ── Hooks externos: encolados en una sola operación (no bloquean) ────────
  // encolarTareasExternas_() hace 1 read+write de PropertiesService en lugar de N.
  // El trigger procesarColaTareas_() los ejecuta en el siguiente ciclo (≤1 min).
  const tareasExternas = [];
  if (datos.fechaProximaGestion) {
    if (getConfig_('CALENDAR_ACTIVO', 'TRUE') === 'TRUE') {
      tareasExternas.push({ tipo: 'CALENDAR', payload: {
        gestor: sesion.usuario, expediente, fechaProxima: datos.fechaProximaGestion, idGestion: id
      }});
    }
    if (getConfig_('NOTIF_RECORDATORIO_ACTIVO', 'TRUE') === 'TRUE') {
      tareasExternas.push({ tipo: 'EMAIL_RECORDATORIO', payload: {
        gestor: sesion.usuario, expediente, fechaProxima: datos.fechaProximaGestion
      }});
    }
  }
  if (datos.estadoPostGestion === 'CERRADO_EXITOSO' &&
      getConfig_('NOTIF_CIERRE_ACTIVO', 'TRUE') === 'TRUE') {
    tareasExternas.push({ tipo: 'EMAIL_CIERRE', payload: { gestor: sesion.usuario, expediente }});
  }
  if (tareasExternas.length > 0) encolarTareasExternas_(tareasExternas);
  // ─────────────────────────────────────────────────────────────────────────

  return { ok: true, id };
}

/**
 * Retorna lista paginada de gestiones con filtros.
 * @param {string} token
 * @param {number} pagina — base 1
 * @param {Object} [filtros] — { idExpediente, funcionario, tipo, resultado, desde, hasta }
 * @returns {{ ok: boolean, gestiones?: Array, total?: number, pagina?: number, error?: string }}
 */
function _legacyGetGestiones_(token, pagina, filtros) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  pagina  = parseInt(pagina) || 1;
  filtros = filtros || {};

  let registros = getDataAsObjects_(SHEET_NAMES.GESTIONES);

  // Gestor solo ve sus propias gestiones
  if (sesion.nivel < ROLES.SUPERVISOR.nivel) {
    registros = registros.filter(r =>
      String(r.FUNCIONARIO || '').toLowerCase() === String(sesion.usuario || '').toLowerCase()
    );
  }

  if (filtros.idExpediente) {
    registros = registros.filter(r => r.ID_EXPEDIENTE === filtros.idExpediente);
  }
  if (filtros.funcionario) {
    registros = registros.filter(r =>
      String(r.FUNCIONARIO || '').toLowerCase().includes(filtros.funcionario.toLowerCase())
    );
  }
  if (filtros.tipo) {
    registros = registros.filter(r => r.TIPO_GESTION === filtros.tipo);
  }
  if (filtros.resultado) {
    registros = registros.filter(r => r.RESULTADO === filtros.resultado);
  }
  if (filtros.desde) {
    const desde = new Date(filtros.desde);
    registros = registros.filter(r => new Date(r.FECHA_REGISTRO) >= desde);
  }
  if (filtros.hasta) {
    const hasta = new Date(filtros.hasta);
    registros = registros.filter(r => new Date(r.FECHA_REGISTRO) <= hasta);
  }

  // Ordenar por fecha descendente (manejar nulos/invalidos)
  registros.sort((a, b) => {
    const tA = a.TIMESTAMP ? new Date(a.TIMESTAMP).getTime() : 0;
    const tB = b.TIMESTAMP ? new Date(b.TIMESTAMP).getTime() : 0;
    return tB - tA;
  });

  const total  = registros.length;
  const inicio = (pagina - 1) * PARAMS.PAGE_SIZE;
  const datos  = registros.slice(inicio, inicio + PARAMS.PAGE_SIZE).map(g => ({
    id:                String(g.ID_GESTION || ''),
    fechaRegistro:     String(g.FECHA_REGISTRO || ''),
    idExpediente:      String(g.ID_EXPEDIENTE || ''),
    funcionario:       String(g.FUNCIONARIO || ''),
    tipoGestion:       String(g.TIPO_GESTION || ''),
    resultado:         String(g.RESULTADO || ''),
    observacion:       String(g.OBSERVACION || ''),
    fechaProxima:      String(g.FECHA_PROXIMA_GESTION || ''),
    estadoPostGestion: String(g.ESTADO_POST_GESTION || ''),
    montoRecaudado:    parseFloat(g.MONTO_RECAUDADO) || 0,
    usuarioEditor:     String(g.USUARIO_EDITOR || ''),
    timestamp:         String(g.TIMESTAMP || '')
  }));

  return { 
    ok: true, 
    gestiones: datos, 
    total: total, 
    pagina: pagina, 
    pageSize: PARAMS.PAGE_SIZE 
  };
}

// ============================================================
// ACTUALIZACIÓN AUTOMÁTICA DEL EXPEDIENTE
// ============================================================

/**
 * Actualiza los campos derivados del expediente cuando se registra una gestión.
 * @param {string} token
 * @param {Object} expediente   — registro actual del expediente
 * @param {Object} datosGestion — datos de la gestión registrada
 * @param {Date}   ahora
 */
function _actualizarExpedienteDesdeGestion_(token, expediente, datosGestion, ahora) {
  if (!datosGestion) {
    Logger.log('_actualizarExpedienteDesdeGestion_: datosGestion es undefined — llamado desde: ' + new Error().stack);
    return;
  }
  const cambios = {};

  // Siempre actualizar fecha última gestión y resultado
  cambios['FECHA_ULTIMA_GESTION']   = _fmtGestion_(ahora);
  cambios['RESULTADO_ULTIMA_GESTION'] = datosGestion.resultado;
  cambios['DIAS_SIN_MOVIMIENTO']    = 0;
  cambios['ALERTA_ESTADO']          = 'OK';

  // Actualizar fecha próxima gestión si se proporcionó
  if (datosGestion.fechaProximaGestion) {
    cambios['FECHA_PROXIMA_GESTION'] = datosGestion.fechaProximaGestion;
  }

  // Actualizar estado del expediente si se indicó un estado post-gestión
  if (datosGestion.estadoPostGestion &&
      CATALOGOS.ESTADOS_EXPEDIENTE.includes(datosGestion.estadoPostGestion)) {
    const estadoAnterior = expediente.ESTADO_EXPEDIENTE;
    if (estadoAnterior !== datosGestion.estadoPostGestion) {
      cambios['ESTADO_EXPEDIENTE'] = datosGestion.estadoPostGestion;

      // Registrar cambio de estado en bitácora
      logChange_({
        token,
        hoja:          SHEET_NAMES.EXPEDIENTES,
        idExpediente:  expediente.ID_EXPEDIENTE,
        accion:        'CAMBIO_ESTADO_EXPEDIENTE',
        campo:         'ESTADO_EXPEDIENTE',
        valorAnterior: estadoAnterior,
        valorNuevo:    datosGestion.estadoPostGestion,
        contexto:      'Actualizado por gestión: ' + datosGestion.tipoGestion,
        origen:        'GestionService.gs'
      });
    }
  }

  // Aplicar todos los cambios en batch
  updateRowFields_(SHEET_NAMES.EXPEDIENTES, expediente._rowIndex, cambios);

  // Registrar actualización en bitácora
  logChange_({
    token,
    hoja:          SHEET_NAMES.EXPEDIENTES,
    idExpediente:  expediente.ID_EXPEDIENTE,
    accion:        'ACTUALIZAR_POR_GESTION',
    campo:         'FECHA_ULTIMA_GESTION',
    valorAnterior: expediente.FECHA_ULTIMA_GESTION || '',
    valorNuevo:    cambios['FECHA_ULTIMA_GESTION'],
    contexto:      'Resultado: ' + datosGestion.resultado,
    origen:        'GestionService.gs'
  });
}

// ============================================================
// FUNCIONES PRIVADAS
// ============================================================

function _generarIdGestion_(fecha) {
  const prefijo = getConfig_('PREFIJO_GESTION', 'GES');
  const d       = _toDate_(fecha);
  const fechaStr = Utilities.formatDate(d, PARAMS.TIMEZONE, 'yyyyMMddHHmmss');
  return prefijo + '-' + fechaStr;
}

/**
 * Formatea una fecha como ISO datetime string.
 * Acepta Date, string ISO o timestamp numérico — nunca lanza por tipo incorrecto.
 * @param {Date|string|number} fecha
 * @returns {string}
 */
function _fmtGestion_(fecha) {
  return Utilities.formatDate(_toDate_(fecha), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

// _toDate_ está definido en SheetService.gs (disponible globalmente en todo el proyecto)
