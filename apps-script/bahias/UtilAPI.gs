/**
 * UtilAPI.gs
 * API de utilidades: usuarios, bitácora, búsqueda
 */

/**
 * Obtiene lista de usuarios.
 * @param {string} token
 * @returns {{ ok, usuarios: [], error? }}
 */
function getUsuarios_(token) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  // Solo ADMIN puede ver todos los usuarios
  if (sesion.rol !== 'ADMINISTRADOR') {
    return { ok: false, error: 'Solo administradores pueden ver usuarios.' };
  }

  try {
    const usuarios = getDataAsObjects_(SHEET_NAMES.USUARIOS);
    return {
      ok: true,
      usuarios: usuarios.map(u => ({
        id:               u.ID_USUARIO,
        nombre:           u.NOMBRE,
        correo:           u.CORREO_INSTITUCIONAL,
        rol:              u.ROL,
        area:             u.AREA,
        estado:           u.ESTADO,
        activo:           u.ACTIVO === 'TRUE' || u.ACTIVO === true,
        fechaCreacion:    u.FECHA_CREACION,
        ultimoAcceso:     u.ULTIMO_ACCESO
      }))
    };
  } catch (err) {
    Logger.log('getUsuarios_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene bitácora de auditoría con paginación.
 * @param {string} token
 * @param {number} pagina
 * @param {Object} filtros { usuario, accion, hoja }
 * @returns {{ ok, logs: [], total, pagina, pageSize }}
 */
function _legacyGetBitacora_(token, pagina, filtros) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  // Solo AUDITOR y ADMIN
  if (sesion.nivel < 1) {
    return { ok: false, error: 'No tienes permisos para ver bitácora.' };
  }

  pagina = Math.max(1, parseInt(pagina) || 1);
  const pageSize = PARAMS.PAGE_SIZE || 50;
  filtros = filtros || {};

  try {
    let logs = getDataAsObjects_(SHEET_NAMES.BITACORA);

    // Aplicar filtros
    if (filtros.usuario && filtros.usuario !== '') {
      logs = logs.filter(l => (l.USUARIO || '').includes(filtros.usuario));
    }

    if (filtros.accion && filtros.accion !== '') {
      logs = logs.filter(l => l.ACCION === filtros.accion);
    }

    if (filtros.hoja && filtros.hoja !== '') {
      logs = logs.filter(l => l.HOJA === filtros.hoja);
    }

    // Ordenar por fecha descendente
    logs.sort((a, b) =>
      new Date(b.FECHA_HORA) - new Date(a.FECHA_HORA)
    );

    // Paginación
    const total = logs.length;
    const inicio = (pagina - 1) * pageSize;
    const fin = inicio + pageSize;
    const paginados = logs.slice(inicio, fin);

    return {
      ok: true,
      logs: paginados.map(l => ({
        id:              l.ID_LOG,
        fechaHora:       l.FECHA_HORA,
        usuario:         l.USUARIO,
        rol:             l.ROL,
        hoja:            l.HOJA,
        idExpediente:    l.ID_EXPEDIENTE,
        accion:          l.ACCION,
        campo:           l.CAMPO,
        valorAnterior:   l.VALOR_ANTERIOR,
        valorNuevo:      l.VALOR_NUEVO,
        contexto:        l.CONTEXTO,
        origen:          l.ORIGEN
      })),
      total,
      pagina,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };

  } catch (err) {
    Logger.log('getBitacora_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene resumen de alertas.
 * @param {string} token
 * @returns {{ ok, resumen: { total, criticos, vencidos, sinMovimiento }, error? }}
 */
function _legacyGetAlertSummary_(token) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);

    const resumen = {
      total: expedientes.length,
      criticos: 0,
      vencidos: 0,
      sinMovimiento: 0,
      ok: 0
    };

    expedientes.forEach(e => {
      const alerta = e.ALERTA_ESTADO || 'OK';
      if (alerta === 'CRITICO') resumen.criticos++;
      else if (alerta === 'VENCIDO') resumen.vencidos++;
      else if (alerta === 'SIN_MOVIMIENTO') resumen.sinMovimiento++;
      else resumen.ok++;
    });

    return {
      ok: true,
      resumen
    };

  } catch (err) {
    Logger.log('getAlertSummary_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}



/**
 * Obtiene lista simplificada de gestores activos.
 * Usado por autoAssignExpedientes_ y los selectores del frontend.
 * Acepta token=null para llamadas internas del sistema.
 * @param {string|null} token
 * @returns {{ ok, gestores: [], error? }}
 */
function getGestoresActivos_(token) {
  if (token !== null) {
    const sesion = verificarSesion_(token);
    if (!sesion) return { ok: false, error: 'Sesión inválida.' };
    if (sesion.nivel < ROLES.SUPERVISOR.nivel) {
      return { ok: false, error: 'Solo supervisores y administradores pueden ver gestores activos.' };
    }
  }

  try {
    const usuarios = getDataAsObjects_(SHEET_NAMES.USUARIOS);
    const gestores = usuarios.filter(u =>
      u.ROL === 'GESTOR' && (u.ACTIVO === 'TRUE' || u.ACTIVO === true)
    );
    return {
      ok: true,
      gestores: gestores.map(g => ({
        id:     g.ID_USUARIO,
        nombre: g.NOMBRE,
        correo: g.CORREO_INSTITUCIONAL,
        rol:    g.ROL,
        area:   g.AREA || ''
      }))
    };
  } catch (err) {
    Logger.log('getGestoresActivos_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene lista de gestores (ROL=GESTOR) con KPIs de productividad.
 * Accesible para SUPERVISOR y ADMINISTRADOR.
 * @param {string} token
 * @returns {{ ok, gestores: [], error? }}
 */
function getGestores_(token) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  if (sesion.nivel < ROLES.SUPERVISOR.nivel) {
    return { ok: false, error: 'Solo supervisores y administradores pueden ver gestores.' };
  }

  try {
    const usuarios = getDataAsObjects_(SHEET_NAMES.USUARIOS);
    const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
    const gestiones = getDataAsObjects_(SHEET_NAMES.GESTIONES);

    const gestores = usuarios.filter(u => u.ROL === 'GESTOR' && (u.ACTIVO === 'TRUE' || u.ACTIVO === true));

    const ahora = new Date();
    const mesActual = ahora.getMonth();
    const anoActual = ahora.getFullYear();

    return {
      ok: true,
      gestores: gestores.map(g => {
        const correoGestor = String(g.CORREO_INSTITUCIONAL || '').trim().toLowerCase();
        const expAsignados = expedientes.filter(e =>
          String(e.FUNCIONARIO_ASIGNADO || '').trim().toLowerCase() === correoGestor
        );
        const expCerrados = expAsignados.filter(e => e.ESTADO_EXPEDIENTE === 'CERRADO_EXITOSO').length;
        const gestPersona = gestiones.filter(ge =>
          String(ge.FUNCIONARIO || '').trim().toLowerCase() === correoGestor
        );
        const gestMes = gestPersona.filter(ge => {
          const f = new Date(ge.FECHA_REGISTRO);
          return f.getMonth() === mesActual && f.getFullYear() === anoActual;
        }).length;

        const totalAsignados = expAsignados.length;
        const efectividad = totalAsignados > 0 ? parseFloat(((expCerrados / totalAsignados) * 100).toFixed(1)) : 0;

        return {
          id:                g.ID_USUARIO,
          nombre:            g.NOMBRE,
          correo:            g.CORREO_INSTITUCIONAL,
          area:              g.AREA || '—',
          estado:            g.ESTADO,
          ultimoAcceso:      g.ULTIMO_ACCESO || '—',
          totalAsignados:    totalAsignados,
          expedientesCerrados: expCerrados,
          totalGestiones:    gestPersona.length,
          gestionesMes:      gestMes,
          efectividad:       efectividad
        };
      })
    };
  } catch (err) {
    Logger.log('getGestores_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}
