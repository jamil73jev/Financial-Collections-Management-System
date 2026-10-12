/**
 * BitacoraService.gs
 * Registro inmutable de auditoría del sistema SIGECO.
 * REGLA ABSOLUTA: la bitácora es solo append. Nunca se modifica ni elimina.
 * Toda modificación crítica del sistema debe llamar logChange() o logAction().
 */

/**
 * Registra un cambio de campo específico en un registro.
 * Usar cuando se modifica un valor existente.
 *
 * @param {Object} params
 * @param {string} params.token          — token de sesión del usuario
 * @param {string} params.hoja           — nombre de la hoja afectada
 * @param {string} [params.idExpediente] — ID del expediente si aplica
 * @param {string} params.accion         — descripción de la acción
 * @param {string} params.campo          — nombre del campo modificado
 * @param {*}      params.valorAnterior  — valor antes del cambio
 * @param {*}      params.valorNuevo     — valor después del cambio
 * @param {string} [params.contexto]     — contexto adicional
 * @param {string} [params.origen]       — módulo origen (e.g. 'ExpedienteService.gs')
 */
function logChange(params) {
  if (!params) {
    Logger.log('logChange: No se proporcionaron parámetros.');
    return;
  }
  const { token, hoja, idExpediente, accion, campo,
          valorAnterior, valorNuevo, contexto, origen } = params;

  const sesion = verificarSesion(token);
  const usuario = sesion ? sesion.usuario : 'SISTEMA';
  const rol     = sesion ? sesion.rol     : 'SISTEMA';

  _escribirBitacora(
    usuario, rol, hoja, idExpediente || '',
    accion, campo, valorAnterior, valorNuevo,
    contexto || '', origen || ''
  );
}

/**
 * Registra una acción general (sin cambio de campo específico).
 * Usar para creaciones, importaciones, ejecuciones administrativas.
 *
 * @param {Object} params
 * @param {string} params.token
 * @param {string} params.hoja
 * @param {string} [params.idExpediente]
 * @param {string} params.accion
 * @param {string} [params.contexto]
 * @param {string} [params.origen]
 */
function logAction(params) {
  if (!params) {
    Logger.log('logAction: No se proporcionaron parámetros.');
    return;
  }
  const { token, hoja, idExpediente, accion, contexto, origen } = params;

  const sesion  = verificarSesion(token);
  const usuario = sesion ? sesion.usuario : 'SISTEMA';
  const rol     = sesion ? sesion.rol     : 'SISTEMA';

  _escribirBitacora(
    usuario, rol, hoja, idExpediente || '',
    accion, '', '', '',
    contexto || '', origen || ''
  );
}

/**
 * Registra una acción del sistema (sin token de usuario).
 * @param {Object} params
 */
function logActionSystem(params) {
  const { hoja, idExpediente, accion, contexto, origen } = params;
  _escribirBitacora(
    'SISTEMA', 'SISTEMA', hoja, idExpediente || '',
    accion, '', '', '',
    contexto || '', origen || ''
  );
}

/**
 * Retorna registros paginados de la bitácora.
 * Solo accesible para AUDITOR y ADMINISTRADOR.
 *
 * @param {string} token
 * @param {number} pagina     — base 1
 * @param {Object} [filtros]  — { usuario, hoja, accion, desde, hasta }
 * @returns {{ ok: boolean, logs?: Array, total?: number, pagina?: number, error?: string }}
 */
function getBitacora(token, pagina, filtros) {
  const acceso = checkAccess(token, 'VER_BITACORA');
  if (!acceso.ok) return acceso;

  pagina = parseInt(pagina) || 1;
  filtros = filtros || {};

  let registros = getDataAsObjects(SHEET_NAMES.BITACORA);

  // Aplicar filtros
  if (filtros.usuario) {
    registros = registros.filter(r =>
      String(r.USUARIO || '').toLowerCase().includes(filtros.usuario.toLowerCase())
    );
  }
  if (filtros.hoja) {
    registros = registros.filter(r => r.HOJA === filtros.hoja);
  }
  if (filtros.accion) {
    registros = registros.filter(r =>
      String(r.ACCION || '').toLowerCase().includes(filtros.accion.toLowerCase())
    );
  }
  if (filtros.desde) {
    const desde = new Date(filtros.desde);
    registros = registros.filter(r => new Date(r.FECHA_HORA) >= desde);
  }
  if (filtros.hasta) {
    const hasta = new Date(filtros.hasta);
    registros = registros.filter(r => new Date(r.FECHA_HORA) <= hasta);
  }

  // Ordenar por fecha descendente (manejar nulos/invalidos)
  registros.sort((a, b) => {
    const tA = a.FECHA_HORA ? new Date(a.FECHA_HORA).getTime() : 0;
    const tB = b.FECHA_HORA ? new Date(b.FECHA_HORA).getTime() : 0;
    return tB - tA;
  });

  const total  = registros.length;
  const inicio = (pagina - 1) * PARAMS.PAGE_SIZE;
  const logs   = registros.slice(inicio, inicio + PARAMS.PAGE_SIZE)
    .map(r => ({
      id:            String(r.ID_LOG || ''),
      fechaHora:     String(r.FECHA_HORA || ''),
      usuario:       String(r.USUARIO || ''),
      rol:           String(r.ROL || ''),
      hoja:          String(r.HOJA || ''),
      idExpediente:  String(r.ID_EXPEDIENTE || ''),
      accion:        String(r.ACCION || ''),
      campo:         String(r.CAMPO || ''),
      valorAnterior: String(r.VALOR_ANTERIOR || ''),
      valorNuevo:    String(r.VALOR_NUEVO || ''),
      contexto:      String(r.CONTEXTO || ''),
      origen:        String(r.ORIGEN || '')
    }));

  return { ok: true, logs, total, pagina, pageSize: PARAMS.PAGE_SIZE };
}

// ============================================================
// FUNCIÓN PRIVADA — escritura append-only
// ============================================================

function _escribirBitacora(usuario, rol, hoja, idExpediente,
                            accion, campo, valorAnterior, valorNuevo,
                            contexto, origen) {
  try {
    const ahora   = new Date();
    const prefijo = getConfig('PREFIJO_LOG', 'LOG');
    const idLog   = prefijo + '-' + ahora.getTime() + '-' +
                    Math.floor(Math.random() * 1000); // único por milisegundo

    appendRow(SHEET_NAMES.BITACORA, [
      idLog,
      Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss"),
      usuario,
      rol,
      hoja,
      idExpediente,
      accion,
      campo,
      String(valorAnterior !== undefined ? valorAnterior : ''),
      String(valorNuevo    !== undefined ? valorNuevo    : ''),
      contexto,
      origen
    ]);
  } catch (e) {
    Logger.log('ERROR escribiendo BITACORA: ' + e.message);
    // No relanzar — la bitácora no debe romper el flujo principal
  }
}

