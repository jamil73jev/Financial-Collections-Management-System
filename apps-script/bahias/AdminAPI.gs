/**
 * AdminAPI.gs
 * Funciones de administración: usuarios, config, integridad
 */

/**
 * Crea un nuevo usuario.
 * Solo ADMINISTRADOR.
 * @param {string} token
 * @param {Object} datos { nombre, correo, rol, area, password }
 * @returns {{ ok, usuarioId?, error? }}
 */
function crearUsuario_(token, datos) {
  const acceso = checkAccess_(token, 'GESTIONAR_USUARIOS');
  if (!acceso.ok) return acceso;

  try {
    if (!datos.nombre || !datos.correo || !datos.rol || !datos.password) {
      return { ok: false, error: 'Faltan campos requeridos.' };
    }

    if (datos.password.length < 8) {
      return { ok: false, error: 'Contraseña debe tener al menos 8 caracteres.' };
    }

    const correoNormalizado = String(datos.correo || '').trim().toLowerCase();
    if (!correoNormalizado.endsWith('@' + PARAMS.ALLOWED_DOMAIN)) {
      return { ok: false, error: 'El correo debe pertenecer a @' + PARAMS.ALLOWED_DOMAIN + '.' };
    }

    // Verificar que el correo no exista
    const usuarios = getDataAsObjects_(SHEET_NAMES.USUARIOS);
    if (usuarios.find(u =>
      String(u.CORREO_INSTITUCIONAL || '').trim().toLowerCase() === correoNormalizado
    )) {
      return { ok: false, error: 'El correo ya está registrado.' };
    }

    // Generar ID y hash
    const maxId = Math.max(...usuarios.map(u => parseInt(u.ID_USUARIO.replace('USR-', '')) || 0));
    const nuevoId = 'USR-' + String(maxId + 1).padStart(3, '0');
    const salt = Utilities.getUuid();
    const hash = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      salt + datos.password + salt,
      Utilities.Charset.UTF_8
    ).map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');

    const ahora = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
    const fila = [
      nuevoId,
      datos.nombre,
      correoNormalizado,
      datos.rol,
      datos.area || '',
      'ACTIVO',
      'TRUE',
      ahora,
      '',
      hash,
      salt,
      'TRUE'
    ];

    appendRow_(SHEET_NAMES.USUARIOS, fila);

    logActionSystem_({
      hoja: SHEET_NAMES.USUARIOS,
      accion: 'CREAR_USUARIO',
      contexto: 'ID: ' + nuevoId + ' | Correo: ' + datos.correo + ' | Rol: ' + datos.rol,
      origen: 'AdminAPI.gs'
    });

    return { ok: true, usuarioId: nuevoId };

  } catch (err) {
    Logger.log('criarUsuario ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Activa o desactiva un usuario.
 * Solo ADMINISTRADOR.
 * @param {string} token
 * @param {string} usuarioId
 * @returns {{ ok, error? }}
 */
function toggleUsuarioActivo_(token, usuarioId) {
  const acceso = checkAccess_(token, 'GESTIONAR_USUARIOS');
  if (!acceso.ok) return acceso;

  try {
    const usuarios = getDataAsObjects_(SHEET_NAMES.USUARIOS);
    const usuario = usuarios.find(u => u.ID_USUARIO === usuarioId);

    if (!usuario) {
      return { ok: false, error: 'Usuario no encontrado.' };
    }

    const nuevoValor = usuario.ACTIVO === 'TRUE' || usuario.ACTIVO === true ? 'FALSE' : 'TRUE';
    const rowIndex = usuario._rowIndex;

    updateRowFields_(SHEET_NAMES.USUARIOS, rowIndex, {
      ACTIVO: nuevoValor,
      ESTADO: nuevoValor === 'TRUE' ? 'ACTIVO' : 'INACTIVO'
    });

    logActionSystem_({
      hoja: SHEET_NAMES.USUARIOS,
      accion: 'TOGGLE_USUARIO',
      contexto: 'ID: ' + usuarioId + ' | Nuevo estado: ' + nuevoValor,
      origen: 'AdminAPI.gs'
    });

    return { ok: true };

  } catch (err) {
    Logger.log('toggleUsuarioActivo_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene mapa de configuración.
 * @returns {Object}
 */
function _legacyAdminGetConfigMap_() {
  try {
    const configs = getDataAsObjects_(SHEET_NAMES.CONFIG);
    const mapa = {};
    configs.forEach(c => {
      if (c.ACTIVO === 'TRUE' || c.ACTIVO === true) {
        mapa[c.CLAVE] = c.VALOR;
      }
    });
    return mapa;
  } catch (err) {
    Logger.log('getConfigMap_ ERROR: ' + err.message);
    return {};
  }
}

/**
 * Establece un valor de configuración.
 * Solo ADMINISTRADOR.
 * @param {string} clave
 * @param {string} valor
 * @returns {boolean}
 */
function _legacyAdminSetConfig_(clave, valor) {
  try {
    const configs = getDataAsObjects_(SHEET_NAMES.CONFIG);
    const config = configs.find(c => c.CLAVE === clave);

    if (!config) {
      // Crear nuevo
      const hojaConfig = getHoja_(SHEET_NAMES.CONFIG);
      hojaConfig.appendRow([clave, valor, '', 'TRUE']);
    } else {
      // Actualizar existente
      updateRowFields_(SHEET_NAMES.CONFIG, config._rowIndex, {
        VALOR: valor
      });
    }

    Logger.log('Config actualizada: ' + clave + ' = ' + valor);
    return true;

  } catch (err) {
    Logger.log('setConfig_ ERROR: ' + err.message);
    return false;
  }
}

/**
 * Verifica integridad del sistema.
 * Solo ADMINISTRADOR.
 * @param {string} token
 * @returns {{ ok, errores: [], warnings: [] }}
 */
function _legacyAdminRunFullCheck_(token) {
  const acceso = checkAccess_(token, 'VERIFICAR_INTEGRIDAD');
  if (!acceso.ok) return acceso;

  const errores = [];
  const warnings = [];

  try {
    // Verificar que existan todas las hojas
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Object.values(SHEET_NAMES).forEach(nombre => {
      if (!ss.getSheetByName(nombre)) {
        errores.push('Falta hoja: ' + nombre);
      }
    });

    // Verificar encabezados
    Object.entries(HEADERS).forEach(([clave, headers]) => {
      try {
        const hoja = ss.getSheetByName(SHEET_NAMES[clave]);
        if (hoja) {
          const headerActual = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
          if (headerActual.length !== headers.length) {
            warnings.push('Encabezados mismatch en ' + SHEET_NAMES[clave] +
              ' (esperado: ' + headers.length + ', actual: ' + headerActual.length + ')');
          }
        }
      } catch (e) {
        warnings.push('Error verificando encabezados en ' + SHEET_NAMES[clave]);
      }
    });

    // Verificar datos críticos
    const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
    const gestiones = getDataAsObjects_(SHEET_NAMES.GESTIONES);
    const usuarios = getDataAsObjects_(SHEET_NAMES.USUARIOS);

    if (expedientes.length === 0) warnings.push('No hay expedientes en el sistema.');
    if (usuarios.length === 0) errores.push('No hay usuarios en el sistema.');
    if (gestiones.length === 0) warnings.push('No hay gestiones registradas.');

    // Verificar usuarios activos
    const activos = usuarios.filter(u => u.ACTIVO === 'TRUE' || u.ACTIVO === true);
    if (activos.length === 0) warnings.push('No hay usuarios activos.');

    // Verificar gestores
    const gestores = usuarios.filter(u => u.ROL === 'GESTOR' && (u.ACTIVO === 'TRUE' || u.ACTIVO === true));
    if (gestores.length === 0) warnings.push('No hay gestores activos.');

    logActionSystem_({
      hoja: SHEET_NAMES.CONFIG,
      accion: 'FULL_CHECK',
      contexto: 'Errores: ' + errores.length + ' | Warnings: ' + warnings.length,
      origen: 'AdminAPI.gs'
    });

    return {
      ok: true,
      errores,
      warnings,
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    Logger.log('runFullCheck_ ERROR: ' + err.message);
    return {
      ok: false,
      error: err.message,
      errores: [err.message],
      warnings: []
    };
  }
}

/**
 * Obtiene estadísticas de contribuyentes.
 * @param {string} token
 * @returns {{ ok, stats: {...} }}
 */
function getEstadisticasContribuyentes_(token) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    const contribuyentes = getDataAsObjects_(SHEET_NAMES.CONTRIBUYENTES);
    const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);

    const stats = {
      totalContribuyentes: contribuyentes.length,
      totalDeudaGlobal: 0,
      totalDeudaPromedio: 0,
      deudaMasAlta: 0,
      deudaMasBaja: Infinity,
      conExpediente: 0,
      sinExpediente: 0,
      tiposPersonas: {},
      actividadesTop: {}
    };

    // Procesar contribuyentes
    contribuyentes.forEach(c => {
      const deuda = parseFloat(c.TOTAL_DEUDA) || 0;
      stats.totalDeudaGlobal += deuda;
      if (deuda > stats.deudaMasAlta) stats.deudaMasAlta = deuda;
      if (deuda < stats.deudaMasBaja) stats.deudaMasBaja = deuda;

      const tipo = c.TIPO_PERSONA || 'Desconocido';
      stats.tiposPersonas[tipo] = (stats.tiposPersonas[tipo] || 0) + 1;

      const actividad = c.ACTIVIDAD_ECONOMICA || 'Otros';
      stats.actividadesTop[actividad] = (stats.actividadesTop[actividad] || 0) + 1;
    });

    stats.totalDeudaPromedio = stats.totalContribuyentes > 0
      ? (stats.totalDeudaGlobal / stats.totalContribuyentes).toFixed(2)
      : 0;

    // Contar expedientes
    const rucsConExp = new Set();
    expedientes.forEach(e => {
      if (e.ACTIVO === 'TRUE' || e.ACTIVO === true) {
        rucsConExp.add(e.RUC);
      }
    });

    stats.conExpediente = rucsConExp.size;
    stats.sinExpediente = stats.totalContribuyentes - stats.conExpediente;

    // Top 5 actividades
    stats.actividadesTop = Object.entries(stats.actividadesTop)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

    return { ok: true, stats };

  } catch (err) {
    Logger.log('getEstadisticasContribuyentes_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}
