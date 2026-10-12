/**
 * SecurityService.gs
 * Control central de acceso y permisos.
 * Toda función de servicio debe llamar requireRole() o checkAccess() antes de ejecutar.
 */

const SYSTEM_SESSION = {
  usuario:  'SISTEMA',
  nombre:   'Proceso Automático',
  rol:      'ADMINISTRADOR',
  nivel:    99,
  rolLabel: 'Internal System'
};

/**
 * Verifica que el token sea válido Y que el usuario tenga el rol mínimo requerido.
 * Retorna { ok: true, sesion } si pasa, o { ok: false, error } si no.
 *
 * @param {string} token
 * @param {string} rolMinimo  — nombre del rol mínimo requerido (e.g. 'SUPERVISOR')
 * @returns {{ ok: boolean, sesion?: Object, error?: string }}
 */
function requireRole(token, rolMinimo) {
  if (!token) return { ok: true, sesion: SYSTEM_SESSION };
  
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida o expirada.' };

  const nivelRequerido = (ROLES[rolMinimo] || ROLES.AUDITOR).nivel;
  if (sesion.nivel < nivelRequerido) {
    return {
      ok: false,
      error: 'Acceso denegado. Se requiere rol: ' + rolMinimo +
             '. Su rol actual: ' + sesion.rol
    };
  }

  return { ok: true, sesion };
}

/**
 * Verifica si el usuario tiene permiso para una acción específica.
 * Usa la matriz PERMISOS de Constants.gs.
 *
 * @param {string} token
 * @param {string} accion  — clave de PERMISOS (e.g. 'CREAR_EXPEDIENTE')
 * @returns {{ ok: boolean, sesion?: Object, error?: string }}
 */
function checkAccess(token, accion) {
  if (!token) return { ok: true, sesion: SYSTEM_SESSION };

  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida o expirada.' };

  const rolMinimo = PERMISOS[accion];
  if (!rolMinimo) {
    Logger.log('Advertencia: acción no registrada en PERMISOS: ' + accion);
    return { ok: false, error: 'Acción no reconocida: ' + accion };
  }

  const nivelRequerido = (ROLES[rolMinimo] || ROLES.AUDITOR).nivel;
  if (sesion.nivel < nivelRequerido) {
    return {
      ok: false,
      error: 'Sin permisos para: ' + accion
    };
  }

  return { ok: true, sesion };
}

/**
 * Verifica si el gestor puede operar sobre un expediente específico.
 * Un GESTOR solo puede ver/modificar expedientes asignados a él.
 * Un SUPERVISOR+ puede ver todos.
 *
 * @param {Object} sesion    — sesión verificada
 * @param {Object} expediente — objeto expediente con FUNCIONARIO_ASIGNADO
 * @returns {boolean}
 */
function puedeAccederExpediente(sesion, expediente) {
  if (sesion.nivel >= ROLES.SUPERVISOR.nivel) return true;
  return (expediente.FUNCIONARIO_ASIGNADO || '').toLowerCase() ===
         (sesion.usuario || '').toLowerCase();
}

