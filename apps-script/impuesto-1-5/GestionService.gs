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
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
function registerGestion(token, datos) {
  const acceso = checkAccess(token, 'REGISTRAR_GESTION');
  if (!acceso.ok) return acceso;

  const sesion = acceso.sesion;

  // Validar datos de la gestión
  const validacion = validateGestion({
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
  const { existe, expediente } = validarExpedienteExiste(datos.idExpediente);
  if (!existe) return { ok: false, error: 'Expediente no encontrado: ' + datos.idExpediente };

  // Verificar acceso al expediente
  if (!puedeAccederExpediente(sesion, expediente)) {
    return { ok: false, error: 'Sin acceso a este expediente.' };
  }

  const ahora = new Date();
  const id    = _generarIdGestion(ahora);

  // Registrar gestión
  appendRow(SHEET_NAMES.GESTIONES, [
    id,                                         // ID_GESTION
    _fmt(ahora),                                // FECHA_REGISTRO
    datos.idExpediente,                         // ID_EXPEDIENTE
    sesion.usuario,                             // FUNCIONARIO
    datos.tipoGestion,                          // TIPO_GESTION
    datos.resultado,                            // RESULTADO
    datos.observacion || '',                    // OBSERVACION
    datos.fechaProximaGestion || '',            // FECHA_PROXIMA_GESTION
    datos.estadoPostGestion || '',              // ESTADO_POST_GESTION
    sesion.usuario,                             // USUARIO_EDITOR
    ahora.toISOString()                         // TIMESTAMP
  ]);

  // Actualizar expediente automáticamente
  _actualizarExpedienteDesdeGestion(token, expediente, datos, ahora);

  logAction({
    token,
    hoja:         SHEET_NAMES.GESTIONES,
    idExpediente: datos.idExpediente,
    accion:       'REGISTRAR_GESTION',
    contexto:     'Tipo: ' + datos.tipoGestion + ' | Resultado: ' + datos.resultado,
    origen:       'GestionService.gs'
  });

  return { ok: true, id };
}

/**
 * Retorna lista paginada de gestiones con filtros.
 * @param {string} token
 * @param {number} pagina — base 1
 * @param {Object} [filtros] — { idExpediente, funcionario, tipo, resultado, desde, hasta }
 * @returns {{ ok: boolean, gestiones?: Array, total?: number, pagina?: number, error?: string }}
 */
function getGestiones(token, pagina, filtros) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  pagina  = parseInt(pagina) || 1;
  filtros = filtros || {};

  let registros = getDataAsObjects(SHEET_NAMES.GESTIONES);

  // Gestor solo ve sus propias gestiones
  if (sesion.nivel < ROLES.SUPERVISOR.nivel) {
    registros = registros.filter(r =>
      (r.FUNCIONARIO || '').toLowerCase() === sesion.usuario.toLowerCase()
    );
  }

  if (filtros.idExpediente) {
    registros = registros.filter(r => r.ID_EXPEDIENTE === filtros.idExpediente);
  }
  if (filtros.funcionario) {
    registros = registros.filter(r =>
      (r.FUNCIONARIO || '').toLowerCase().includes(filtros.funcionario.toLowerCase())
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
function _actualizarExpedienteDesdeGestion(token, expediente, datosGestion, ahora) {
  const cambios = {};

  // Siempre actualizar fecha última gestión y resultado
  cambios['FECHA_ULTIMA_GESTION']   = _fmt(ahora);
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
      logChange({
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
  updateRowFields(SHEET_NAMES.EXPEDIENTES, expediente._rowIndex, cambios);

  // Registrar actualización en bitácora
  logChange({
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

function _generarIdGestion(fecha) {
  const prefijo  = getConfig('PREFIJO_GESTION', 'GES');
  const fechaStr = Utilities.formatDate(fecha, PARAMS.TIMEZONE, 'yyyyMMddHHmmss');
  return prefijo + '-' + fechaStr;
}

function _fmt(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
