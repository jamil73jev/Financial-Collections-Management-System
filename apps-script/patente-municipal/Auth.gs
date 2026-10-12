/**
 * Auth.gs
 * Autenticación y gestión de sesiones del sistema SIGECO.
 * Usa ScriptProperties para sesiones (necesario en web app "Anyone can access").
 * v2: salt en hash, token via UUID, sin credenciales hardcodeadas.
 *
 * OPTIMIZACIÓN v2.1: _sesionCache evita múltiples lecturas de PropertiesService
 * dentro del mismo dispatch(). Cada ejecución de GAS arranca con caché vacío.
 */

const SESSION_PREFIX = 'ses_';

// Cache a nivel de módulo: se reinicia automáticamente en cada ejecución de GAS.
// Permite que verificarSesion() devuelva el resultado sin ir a PropertiesService
// cuando se llama múltiples veces con el mismo token en un solo dispatch().
const _sesionCache = {};

// ============================================================
// AUTENTICACIÓN
// ============================================================

/**
 * Autentica un usuario. Retorna token y datos de sesión si es válido.
 * @param {string} usuario  — nombre de usuario o correo
 * @param {string} password
 * @returns {{ ok: boolean, token?: string, sesion?: Object, error?: string }}
 */
function login(usuario, password) {
  try {
    if (!usuario || !password) {
      return { ok: false, error: 'Credenciales requeridas.' };
    }

    const usuarios = getDataAsObjects(SHEET_NAMES.USUARIOS);
    const user = usuarios.find(u =>
      (u.CORREO_INSTITUCIONAL || '').toLowerCase() === usuario.toLowerCase() ||
      (u.NOMBRE || '').toLowerCase() === usuario.toLowerCase()
    );

    if (!user) return { ok: false, error: 'Usuario no encontrado.' };
    if (user.ACTIVO !== 'TRUE' && user.ACTIVO !== true) {
      return { ok: false, error: 'Usuario inactivo.' };
    }

    const hashEsperado = _hashPasswordConSalt(password, user.PASSWORD_SALT || '');
    if (hashEsperado !== user.PASSWORD_HASH) {
      return { ok: false, error: 'Contraseña incorrecta.' };
    }

    const token  = _generarToken();
    const ahora  = new Date();
    const sesion = {
      token,
      userId:   user.ID_USUARIO,
      usuario:  user.CORREO_INSTITUCIONAL,
      nombre:   user.NOMBRE,
      email:    user.CORREO_INSTITUCIONAL,
      rol:      user.ROL,
      nivel:    (ROLES[user.ROL] || ROLES.AUDITOR).nivel,
      rolLabel: (ROLES[user.ROL] || ROLES.AUDITOR).label,
      loginAt:  ahora.toISOString()
    };

    PropertiesService.getScriptProperties()
      .setProperty(SESSION_PREFIX + token, JSON.stringify(sesion));

    // Actualizar ULTIMO_ACCESO
    try {
      updateRowFields(SHEET_NAMES.USUARIOS, user._rowIndex, {
        ULTIMO_ACCESO: _formatFecha(ahora)
      });
    } catch (e) { /* no bloquear login si falla */ }

    _logAuthAction(sesion, 'LOGIN_EXITOSO');
    // Incluir catálogos en la respuesta para evitar un round-trip extra desde el frontend
    return { ok: true, token, sesion: _sesionPublica(sesion), catalogos: CATALOGOS };
  } catch (e) {
    Logger.log('Error en login: ' + e.message);
    return { ok: false, error: 'Error interno en autenticación.' };
  }
}

/**
 * Cierra la sesión invalidando el token.
 * @param {string} token
 */
function logout(token) {
  if (!token) return;
  const sesion = verificarSesion(token);
  PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
  delete _sesionCache[token];
  if (sesion) _logAuthAction(sesion, 'LOGOUT');
}

// ============================================================
// VERIFICACIÓN DE SESIÓN
// ============================================================

/**
 * Verifica y retorna la sesión completa (uso interno del backend).
 * Usa un cache a nivel de módulo para evitar múltiples lecturas de
 * PropertiesService cuando se llama varias veces en el mismo dispatch().
 * @param {string} token
 * @returns {Object|null}
 */
function verificarSesion(token) {
  if (!token) return null;

  // Cache hit: mismo token ya verificado en este dispatch()
  if (Object.prototype.hasOwnProperty.call(_sesionCache, token)) {
    return _sesionCache[token];
  }

  const raw = PropertiesService.getScriptProperties()
                .getProperty(SESSION_PREFIX + token);
  if (!raw) {
    _sesionCache[token] = null;
    return null;
  }

  let sesion;
  try { sesion = JSON.parse(raw); } catch (e) {
    _sesionCache[token] = null;
    return null;
  }

  const ahora       = new Date();
  const loginAt     = new Date(sesion.loginAt);
  const horasTransc = (ahora - loginAt) / (1000 * 60 * 60);

  if (horasTransc > PARAMS.SESSION_HOURS) {
    PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
    _sesionCache[token] = null;
    return null;
  }

  _sesionCache[token] = sesion;
  return sesion;
}

/**
 * Verifica la sesión y retorna datos públicos (uso desde frontend).
 * @param {string} token
 * @returns {{ ok: boolean, sesion?: Object, error?: string }}
 */
function verificarSesionPublica(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida o expirada.' };
  return { ok: true, sesion: _sesionPublica(sesion) };
}

// ============================================================
// GESTIÓN DE CONTRASEÑAS
// ============================================================

/**
 * Cambia la contraseña de un usuario.
 * Solo ADMINISTRADOR puede cambiar contraseñas de otros usuarios.
 * @param {string} token
 * @param {string} usuarioId
 * @param {string} nuevaPassword
 * @returns {{ ok: boolean, error?: string }}
 */
function cambiarPassword(token, usuarioId, nuevaPassword) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  if (sesion.userId !== usuarioId && sesion.nivel < ROLES.ADMINISTRADOR.nivel) {
    return { ok: false, error: 'Sin permisos para cambiar contraseña de otro usuario.' };
  }

  if (!nuevaPassword || nuevaPassword.length < 8) {
    return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
  }

  const usuarios = getDataAsObjects(SHEET_NAMES.USUARIOS);
  const user     = usuarios.find(u => u.ID_USUARIO === usuarioId);
  if (!user) return { ok: false, error: 'Usuario no encontrado.' };

  const salt = Utilities.getUuid();
  const hash = _hashPasswordConSalt(nuevaPassword, salt);

  updateRowFields(SHEET_NAMES.USUARIOS, user._rowIndex, {
    PASSWORD_HASH: hash,
    PASSWORD_SALT: salt
  });

  _logAuthAction(sesion, 'CAMBIO_PASSWORD_USUARIO_' + usuarioId);
  return { ok: true };
}

// ============================================================
// LIMPIEZA DE SESIONES
// ============================================================

/**
 * Elimina sesiones expiradas. Ejecutar como trigger cada 4 horas.
 * @returns {number} cantidad eliminada
 */
function limpiarSesionesExpiradas() {
  const props    = PropertiesService.getScriptProperties().getProperties();
  const ahora    = new Date();
  let eliminadas = 0;

  Object.entries(props).forEach(([key, val]) => {
    if (!key.startsWith(SESSION_PREFIX)) return;
    try {
      const sesion      = JSON.parse(val);
      const horasTrans  = (ahora - new Date(sesion.loginAt)) / (1000 * 60 * 60);
      if (horasTrans > PARAMS.SESSION_HOURS) {
        PropertiesService.getScriptProperties().deleteProperty(key);
        eliminadas++;
      }
    } catch (e) {
      PropertiesService.getScriptProperties().deleteProperty(key);
      eliminadas++;
    }
  });

  Logger.log('Sesiones expiradas eliminadas: ' + eliminadas);
  return eliminadas;
}

/**
 * Instala trigger automático de limpieza de sesiones.
 */
function installCleanupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'limpiarSesionesExpiradas')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('limpiarSesionesExpiradas')
    .timeBased()
    .everyHours(4)
    .create();

  Logger.log('Trigger de limpieza de sesiones instalado.');
}

// ============================================================
// FUNCIONES PRIVADAS
// ============================================================

function _generarToken() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function _hashPasswordConSalt(password, salt) {
  const combined = salt + password + salt;
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    combined,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function _sesionPublica(sesion) {
  return {
    userId:   sesion.userId,
    usuario:  sesion.usuario,
    nombre:   sesion.nombre,
    rol:      sesion.rol,
    nivel:    sesion.nivel,
    rolLabel: sesion.rolLabel
  };
}

function _logAuthAction(sesion, accion) {
  try {
    const prefijo   = getConfig('PREFIJO_LOG', 'LOG');
    const ahora     = new Date();
    const idLog     = prefijo + '-' + ahora.getTime();
    const fechaHora = _formatFecha(ahora);

    appendRow(SHEET_NAMES.BITACORA, [
      idLog, fechaHora,
      sesion.usuario || '', sesion.rol || '',
      'AUTH', '', accion, '', '', '', 'Autenticacion', 'Auth.gs'
    ]);
  } catch (e) {
    Logger.log('No se pudo escribir en BITACORA (auth): ' + e.message);
  }
}

function _formatFecha(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
