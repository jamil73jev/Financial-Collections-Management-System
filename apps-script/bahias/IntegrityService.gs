/**
 * IntegrityService.gs
 * Verificación de integridad estructural y referencial del sistema SIGECO.
 * Uso: Administración → Verificar Integridad.
 * Retorna un reporte completo de problemas encontrados.
 */

/**
 * Ejecuta verificación completa de integridad.
 * @param {string} token
 * @returns {{ ok: boolean, reporte?: Object, error?: string }}
 */
function runFullCheck_(token) {
  const acceso = checkAccess_(token, 'VERIFICAR_INTEGRIDAD');
  if (!acceso.ok) return acceso;

  const reporte = {
    fechaVerificacion: _fmtIntegridad_(new Date()),
    ejecutadoPor:      acceso.sesion.usuario,
    checks: []
  };

  reporte.checks.push(_checkHojas_());
  reporte.checks.push(_checkEncabezados_());
  reporte.checks.push(_checkExpedientesSinResponsable_());
  reporte.checks.push(_checkGestionesSinExpediente_());
  reporte.checks.push(_checkCamposCriticosVacios_());
  reporte.checks.push(_checkRolesCatalogo_());
  reporte.checks.push(_checkBitacoraCorrupta_());

  const totalErrores    = reporte.checks.reduce((s, c) => s + c.errores.length, 0);
  const totalAdvertencias = reporte.checks.reduce((s, c) => s + (c.advertencias || []).length, 0);

  reporte.totalErrores      = totalErrores;
  reporte.totalAdvertencias = totalAdvertencias;
  reporte.estado            = totalErrores === 0 ? 'OK' : 'CON_ERRORES';

  logAction_({
    token,
    hoja:    'SISTEMA',
    accion:  'VERIFICAR_INTEGRIDAD',
    contexto: 'Errores: ' + totalErrores + ' | Advertencias: ' + totalAdvertencias,
    origen:  'IntegrityService.gs'
  });

  return { ok: true, reporte };
}

// ============================================================
// CHECKS INDIVIDUALES
// ============================================================

function _checkHojas_() {
  const check = { nombre: 'Hojas del sistema', errores: [], advertencias: [] };

  const ss = getSpreadsheet_();
  Object.values(SHEET_NAMES).forEach(nombre => {
    if (!ss.getSheetByName(nombre)) {
      check.errores.push('Hoja faltante: ' + nombre);
    }
  });

  return check;
}

function _checkEncabezados_() {
  const check = { nombre: 'Encabezados de hojas', errores: [], advertencias: [] };

  Object.entries(HEADERS).forEach(([nombreClave, esperados]) => {
    const nombreHoja = SHEET_NAMES[nombreClave];
    if (!nombreHoja) return;

    let hoja;
    try { hoja = getHoja_(nombreHoja); } catch (e) {
      check.errores.push('No se puede leer hoja: ' + nombreHoja);
      return;
    }

    const actuales = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];

    esperados.forEach((col, idx) => {
      if (actuales[idx] !== col) {
        check.errores.push(
          nombreHoja + ' — columna ' + (idx + 1) +
          ': esperado "' + col + '", encontrado "' + (actuales[idx] || '(vacío)') + '"'
        );
      }
    });
  });

  return check;
}

function _checkExpedientesSinResponsable_() {
  const check = { nombre: 'Expedientes sin responsable', errores: [], advertencias: [] };

  const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  const estadosPermitidosSinFunc = ['PENDIENTE_ASIGNACION'];

  expedientes.forEach(e => {
    if (!e.FUNCIONARIO_ASIGNADO && !estadosPermitidosSinFunc.includes(e.ESTADO_EXPEDIENTE)) {
      check.errores.push(
        'Expediente ' + e.ID_EXPEDIENTE + ' (estado: ' + e.ESTADO_EXPEDIENTE +
        ') no tiene funcionario asignado.'
      );
    }
  });

  return check;
}

function _checkGestionesSinExpediente_() {
  const check = { nombre: 'Gestiones huérfanas', errores: [], advertencias: [] };

  const idsExpedientes = new Set(
    getDataAsObjects_(SHEET_NAMES.EXPEDIENTES).map(e => e.ID_EXPEDIENTE)
  );

  const gestiones = getDataAsObjects_(SHEET_NAMES.GESTIONES);
  gestiones.forEach(g => {
    if (!g.ID_EXPEDIENTE) {
      check.errores.push('Gestión ' + g.ID_GESTION + ' sin ID_EXPEDIENTE.');
    } else if (!idsExpedientes.has(g.ID_EXPEDIENTE)) {
      check.errores.push(
        'Gestión ' + g.ID_GESTION + ' referencia expediente inexistente: ' + g.ID_EXPEDIENTE
      );
    }
  });

  return check;
}

function _checkCamposCriticosVacios_() {
  const check = { nombre: 'Campos críticos vacíos', errores: [], advertencias: [] };

  const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  expedientes.forEach(e => {
    if (!e.RUC)              check.advertencias.push('Expediente ' + e.ID_EXPEDIENTE + ': RUC vacío.');
    if (!e.CONTRIBUYENTE)    check.errores.push('Expediente ' + e.ID_EXPEDIENTE + ': CONTRIBUYENTE vacío.');
    if (!e.ESTADO_EXPEDIENTE) check.errores.push('Expediente ' + e.ID_EXPEDIENTE + ': ESTADO_EXPEDIENTE vacío.');
    if (!e.PRIORIDAD)        check.advertencias.push('Expediente ' + e.ID_EXPEDIENTE + ': PRIORIDAD vacía.');

    // Verificar valores de catálogo
    if (e.ESTADO_EXPEDIENTE && !CATALOGOS.ESTADOS_EXPEDIENTE.includes(e.ESTADO_EXPEDIENTE)) {
      check.errores.push(
        'Expediente ' + e.ID_EXPEDIENTE + ': ESTADO_EXPEDIENTE fuera de catálogo: ' + e.ESTADO_EXPEDIENTE
      );
    }
    if (e.PRIORIDAD && !CATALOGOS.PRIORIDADES.includes(e.PRIORIDAD)) {
      check.advertencias.push(
        'Expediente ' + e.ID_EXPEDIENTE + ': PRIORIDAD fuera de catálogo: ' + e.PRIORIDAD
      );
    }
  });

  return check;
}

function _checkRolesCatalogo_() {
  const check = { nombre: 'Roles de usuarios', errores: [], advertencias: [] };

  const usuarios = getDataAsObjects_(SHEET_NAMES.USUARIOS);
  usuarios.forEach(u => {
    if (!CATALOGOS.ROLES.includes(u.ROL)) {
      check.errores.push(
        'Usuario ' + u.CORREO_INSTITUCIONAL + ': ROL inválido: ' + u.ROL
      );
    }
    if (!u.CORREO_INSTITUCIONAL) {
      check.errores.push(
        'Usuario fila ' + u._rowIndex + ': CORREO_INSTITUCIONAL vacío.'
      );
    }
  });

  return check;
}

function _checkBitacoraCorrupta_() {
  const check = { nombre: 'Integridad de bitácora', errores: [], advertencias: [] };

  const logs = getDataAsObjects_(SHEET_NAMES.BITACORA);
  let vacios = 0;

  logs.forEach(l => {
    if (!l.ID_LOG || !l.FECHA_HORA || !l.ACCION) vacios++;
  });

  if (vacios > 0) {
    check.advertencias.push(vacios + ' registros en BITACORA con campos críticos vacíos.');
  }

  check.advertencias.push('Total registros en BITACORA: ' + logs.length);

  return check;
}

function _fmtIntegridad_(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
