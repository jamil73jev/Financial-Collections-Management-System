/**
 * UserService.gs
 * Gestión de usuarios del sistema SIGECO.
 * Operaciones CRUD sobre la hoja USUARIOS.
 * Solo ADMINISTRADOR puede crear/modificar usuarios.
 */

/**
 * Retorna la lista de usuarios activos (sin contraseñas).
 * @param {string} token
 * @returns {{ ok: boolean, usuarios?: Array, error?: string }}
 */
function getUsuarios(token) {
  const sesion = requireRole(token, 'ADMINISTRADOR');
  if (!sesion.ok) return sesion;

  const safeStr = (v) => v instanceof Date ? Utilities.formatDate(v, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss") : (v || '');
  const usuarios = getDataAsObjects(SHEET_NAMES.USUARIOS)
    .map(u => ({
      id:       u.ID_USUARIO,
      nombre:   u.NOMBRE,
      correo:   u.CORREO_INSTITUCIONAL,
      rol:      u.ROL,
      area:     u.AREA,
      estado:   u.ESTADO,
      activo:   u.ACTIVO === 'TRUE' || u.ACTIVO === true,
      fechaCreacion: safeStr(u.FECHA_CREACION),
      ultimoAcceso:  safeStr(u.ULTIMO_ACCESO)
    }));

  return { ok: true, usuarios };
}

/**
 * Retorna lista de gestores activos (para asignación de expedientes).
 * Accesible para SUPERVISOR y ADMINISTRADOR.
 * @param {string} token
 * @returns {{ ok: boolean, gestores?: Array, error?: string }}
 */
function getGestoresActivos(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };
  if (sesion.nivel < ROLES.SUPERVISOR.nivel) {
    return { ok: false, error: 'Sin permisos.' };
  }

  const gestores = getDataAsObjects(SHEET_NAMES.USUARIOS)
    .filter(u =>
      (u.ACTIVO === 'TRUE' || u.ACTIVO === true) &&
      (u.ROL === 'GESTOR' || u.ROL === 'SUPERVISOR')
    )
    .map(u => ({
      id:     u.ID_USUARIO,
      nombre: u.NOMBRE,
      correo: u.CORREO_INSTITUCIONAL,
      rol:    u.ROL
    }));

  return { ok: true, gestores };
}

/**
 * Crea un nuevo usuario institucional.
 * @param {string} token
 * @param {{ nombre, correo, rol, area, password }} datos
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
function crearUsuario(token, datos) {
  const sesion = requireRole(token, 'ADMINISTRADOR');
  if (!sesion.ok) return sesion;

  const { nombre, correo, rol, area, password } = datos;

  if (!nombre || !correo || !rol || !password) {
    return { ok: false, error: 'Campos obligatorios: nombre, correo, rol, password.' };
  }
  if (!CATALOGOS.ROLES.includes(rol)) {
    return { ok: false, error: 'Rol inválido: ' + rol };
  }
  if (password.length < 8) {
    return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
  }

  // Verificar duplicado por correo
  const existente = findRowByField(SHEET_NAMES.USUARIOS, 'CORREO_INSTITUCIONAL', correo.toLowerCase());
  if (existente) return { ok: false, error: 'Ya existe un usuario con ese correo.' };

  const ahora  = new Date();
  const id     = _generarIdUsuario();
  const salt   = Utilities.getUuid();
  const hash   = _hashPasswordConSalt(password, salt);

  appendRow(SHEET_NAMES.USUARIOS, [
    id,
    nombre,
    correo.toLowerCase(),
    rol,
    area || '',
    'ACTIVO',
    'TRUE',
    _formatFechaU(ahora),
    '',
    hash,
    salt
  ]);

  logAction({
    token,
    hoja:     SHEET_NAMES.USUARIOS,
    accion:   'CREAR_USUARIO',
    contexto: 'Usuario: ' + correo + ' / Rol: ' + rol
  });

  return { ok: true, id };
}

/**
 * Activa o desactiva un usuario.
 * @param {string} token
 * @param {string} usuarioId
 * @returns {{ ok: boolean, activo?: boolean, error?: string }}
 */
function toggleUsuarioActivo(token, usuarioId) {
  const sesion = requireRole(token, 'ADMINISTRADOR');
  if (!sesion.ok) return sesion;

  const usuarios = getDataAsObjects(SHEET_NAMES.USUARIOS);
  const user     = usuarios.find(u => u.ID_USUARIO === usuarioId);
  if (!user) return { ok: false, error: 'Usuario no encontrado.' };

  // No puede desactivarse a sí mismo
  if (sesion.sesion.userId === usuarioId) {
    return { ok: false, error: 'No puede desactivar su propia cuenta.' };
  }

  const nuevoEstado = (user.ACTIVO === 'TRUE' || user.ACTIVO === true) ? 'FALSE' : 'TRUE';
  updateRowFields(SHEET_NAMES.USUARIOS, user._rowIndex, {
    ACTIVO: nuevoEstado,
    ESTADO: nuevoEstado === 'TRUE' ? 'ACTIVO' : 'INACTIVO'
  });

  logAction({
    token,
    hoja:     SHEET_NAMES.USUARIOS,
    accion:   nuevoEstado === 'TRUE' ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO',
    contexto: 'UsuarioId: ' + usuarioId
  });

  return { ok: true, activo: nuevoEstado === 'TRUE' };
}

// ============================================================
// FUNCIONES PRIVADAS
// ============================================================

function _generarIdUsuario() {
  const ahora = new Date();
  return 'USR-' + Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyyMMdd') +
         '-' + String(ahora.getTime()).slice(-4);
}

function _hashPasswordConSalt(password, salt) {
  const combined = salt + password + salt;
  const bytes    = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    combined,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function _formatFechaU(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
