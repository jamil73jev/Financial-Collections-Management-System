/**
 * Setup.gs
 * Función de instalación inicial del sistema SIGECO.
 * Ejecutar una sola vez por el ADMINISTRADOR desde el editor de Apps Script.
 * Crea hojas, encabezados, formatos, configuración inicial y usuario admin.
 */

/**
 * Punto de entrada principal de instalación.
 * Idempotente: puede ejecutarse múltiples veces sin duplicar datos.
 */
function setupSystem() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (!ss) {
    // Si se ejecuta como script independiente (standalone)
    const savedId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (savedId) {
      ss = SpreadsheetApp.openById(savedId);
    } else {
      ss = SpreadsheetApp.create('SIGECO_BASE_DE_DATOS');
      PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
      Logger.log('Se creó un nuevo Google Sheet (Base de Datos): ' + ss.getUrl());
    }
  }

  Logger.log('=== INICIANDO setupSystem() ===');

  try {
    _crearHojasFaltantes(ss);
    _escribirEncabezados(ss);
    _aplicarFormatoEncabezados(ss);
    _cargarConfigDefaults(ss);
    _crearUsuarioAdminInicial(ss);
    _almacenarIdSpreadsheet(ss);

    // NUEVO: Instalar triggers automáticos
    Logger.log('Instalando triggers del sistema...');
    if (typeof installCleanupTrigger === 'function') installCleanupTrigger();
    if (typeof installBackupTrigger === 'function') installBackupTrigger();

    Logger.log('=== setupSystem() COMPLETADO ===');
    Logger.log('El sistema se instaló correctamente.');
    Logger.log('Usuario inicial: admin@municipio.gob.ec');
    Logger.log('Contraseña: Admin2024!');
  } catch (e) {
    Logger.log('ERROR en setupSystem: ' + e.message);
    throw e;
  }
}

/**
 * Crea hojas faltantes según SHEET_NAMES.
 * No toca hojas existentes.
 */
function _crearHojasFaltantes(ss) {
  const hojasExistentes = ss.getSheets().map(h => h.getName());

  Object.values(SHEET_NAMES).forEach(nombre => {
    if (!hojasExistentes.includes(nombre)) {
      ss.insertSheet(nombre);
      Logger.log('Hoja creada: ' + nombre);
    } else {
      Logger.log('Hoja ya existe (omitida): ' + nombre);
    }
  });

  // Ordenar hojas según el orden lógico del sistema
  const ordenDeseado = [
    SHEET_NAMES.CONFIG,
    SHEET_NAMES.USUARIOS,
    SHEET_NAMES.CONTRIBUYENTES,
    SHEET_NAMES.EXPEDIENTES,
    SHEET_NAMES.GESTIONES,
    SHEET_NAMES.SEGUIMIENTO,
    SHEET_NAMES.BITACORA,
    SHEET_NAMES.DASHBOARD
  ];

  ordenDeseado.forEach((nombre, idx) => {
    const hoja = ss.getSheetByName(nombre);
    if (hoja) ss.setActiveSheet(hoja) && ss.moveActiveSheet(idx + 1);
  });
}

/**
 * Escribe encabezados en la fila 1 de cada hoja.
 * Solo escribe si la fila 1 está vacía para no sobrescribir datos.
 */
function _escribirEncabezados(ss) {
  Object.entries(HEADERS).forEach(([nombreClave, encabezados]) => {
    const nombreHoja = SHEET_NAMES[nombreClave];
    if (!nombreHoja) return;

    const hoja = ss.getSheetByName(nombreHoja);
    if (!hoja) return;

    const primeraFila = hoja.getRange(1, 1, 1, encabezados.length).getValues()[0];
    const estaVacia = primeraFila.every(v => v === '' || v === null);

    if (estaVacia) {
      hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
      hoja.setFrozenRows(1);
      Logger.log('Encabezados escritos: ' + nombreHoja);
    } else {
      Logger.log('Encabezados existentes (omitido): ' + nombreHoja);
    }
  });
}

/**
 * Aplica formato visual a los encabezados de todas las hojas.
 */
function _aplicarFormatoEncabezados(ss) {
  Object.entries(HEADERS).forEach(([nombreClave, encabezados]) => {
    const nombreHoja = SHEET_NAMES[nombreClave];
    if (!nombreHoja) return;

    const hoja = ss.getSheetByName(nombreHoja);
    if (!hoja) return;

    const rangoHeader = hoja.getRange(1, 1, 1, encabezados.length);
    rangoHeader
      .setBackground(FORMATOS.HEADER_BG_COLOR)
      .setFontColor(FORMATOS.HEADER_FONT_COLOR)
      .setFontSize(FORMATOS.HEADER_FONT_SIZE)
      .setFontWeight('bold')
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('center');

    hoja.setRowHeight(1, 28);

    // Activar filtros si no existen
    if (!hoja.getFilter()) {
      hoja.getRange(1, 1, Math.max(hoja.getLastRow(), 2), encabezados.length)
          .createFilter();
    }
  });
}

/**
 * Carga los valores por defecto en CONFIG si no existen.
 */
function _cargarConfigDefaults(ss) {
  const hojaConfig = ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (!hojaConfig) return;

  const datosActuales = hojaConfig.getDataRange().getValues();
  const clavesExistentes = datosActuales.slice(1).map(r => r[0]).filter(Boolean);

  const filasPorAgregar = CONFIG_DEFAULTS.filter(
    ([clave]) => !clavesExistentes.includes(clave)
  );

  if (filasPorAgregar.length > 0) {
    const ultimaFila = Math.max(hojaConfig.getLastRow(), 1);
    hojaConfig.getRange(ultimaFila + 1, 1, filasPorAgregar.length, 4)
              .setValues(filasPorAgregar);
    Logger.log('CONFIG: ' + filasPorAgregar.length + ' valores cargados.');
  }
}

/**
 * Crea el usuario administrador inicial si no existe.
 * La contraseña debe cambiarse en el primer acceso.
 */
function _crearUsuarioAdminInicial(ss) {
  const hojaUsuarios = ss.getSheetByName(SHEET_NAMES.USUARIOS);
  if (!hojaUsuarios) return;

  const datos = hojaUsuarios.getDataRange().getValues();
  const usuariosExistentes = datos.slice(1).map(r => r[2]); // CORREO_INSTITUCIONAL

  const correoAdmin = 'admin@municipio.gob.ec';
  if (usuariosExistentes.includes(correoAdmin)) {
    Logger.log('Usuario admin ya existe (omitido).');
    return;
  }

  const salt     = Utilities.getUuid();
  // La contraseña inicial NO se guarda en el código: definir ADMIN_INITIAL_PASSWORD en las propiedades del script.
  const password = PropertiesService.getScriptProperties().getProperty('ADMIN_INITIAL_PASSWORD');
  if (!password) { throw new Error('Defina ADMIN_INITIAL_PASSWORD en las propiedades del script.'); }
  const hash     = _hashPasswordConSalt(password, salt);
  const ahora    = _formatearFecha(new Date());

  const fila = [
    'USR-001',        // ID_USUARIO
    'Administrador',  // NOMBRE
    correoAdmin,      // CORREO_INSTITUCIONAL
    'ADMINISTRADOR',  // ROL
    'Sistemas',       // AREA
    'ACTIVO',         // ESTADO
    'TRUE',           // ACTIVO
    ahora,            // FECHA_CREACION
    '',               // ULTIMO_ACCESO
    hash,             // PASSWORD_HASH
    salt              // PASSWORD_SALT
  ];

  const ultimaFila = Math.max(hojaUsuarios.getLastRow(), 1);
  hojaUsuarios.getRange(ultimaFila + 1, 1, 1, fila.length).setValues([fila]);
  Logger.log('Usuario admin creado: ' + correoAdmin);
}

/**
 * Almacena el ID del spreadsheet en PropertiesService para referencia del sistema.
 */
function _almacenarIdSpreadsheet(ss) {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Logger.log('Spreadsheet ID almacenado: ' + ss.getId());
}

/**
 * Reinicia solo los encabezados (sin borrar datos).
 * Usar si se corrompen los encabezados.
 */
function resetHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(HEADERS).forEach(([nombreClave, encabezados]) => {
    const hoja = ss.getSheetByName(SHEET_NAMES[nombreClave]);
    if (!hoja) return;
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  });
  Logger.log('Encabezados reiniciados.');
}

/**
 * Hash de contraseña con salt (SHA-256).
 * @param {string} password
 * @param {string} salt
 * @returns {string} hash hex
 */
function _hashPasswordConSalt(password, salt) {
  const combined = salt + password + salt;
  const bytes    = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    combined,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/**
 * Formatea fecha a string ISO local (Ecuador GMT-5).
 * @param {Date} fecha
 * @returns {string}
 */
function _formatearFecha(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
