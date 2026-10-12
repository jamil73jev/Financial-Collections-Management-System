/**
 * ExportService.gs
 * Exportación de datos a Google Sheets → descarga .xlsx
 * Genera un Sheet temporal, lo convierte a XLSX y retorna URL de descarga.
 */

/**
 * Exporta expedientes a Excel.
 * @param {string} token
 * @param {Object} [filtros] — mismos filtros que listExpedientes
 * @returns {{ ok, url?, nombre?, error? }}
 */
function exportExpedientes(token, filtros) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    filtros = filtros || {};
    let datos = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);

    if (sesion.rol === 'GESTOR') {
      datos = datos.filter(e =>
        String(e.FUNCIONARIO_ASIGNADO || '').toLowerCase() === String(sesion.usuario || '').toLowerCase()
      );
    }
    if (filtros.estado) datos = datos.filter(e => e.ESTADO_EXPEDIENTE === filtros.estado);
    if (filtros.prioridad) datos = datos.filter(e => e.PRIORIDAD === filtros.prioridad);
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      datos = datos.filter(e =>
        String(e.ID_EXPEDIENTE||'').toLowerCase().includes(q) ||
        String(e.CONTRIBUYENTE||'').toLowerCase().includes(q) ||
        String(e.RUC||'').toLowerCase().includes(q)
      );
    }

    const filas = datos.map(e => [
      e.ID_EXPEDIENTE, e.CODIGO_INTERNO, e.RUC, e.CONTRIBUYENTE,
      e.TIPO_PERSONA, e.TIPO_OBLIGACION, e.ESTADO_EXPEDIENTE, e.PRIORIDAD,
      e.FUNCIONARIO_ASIGNADO, e.FECHA_ASIGNACION, e.FECHA_ULTIMA_GESTION,
      e.FECHA_PROXIMA_GESTION, e.DIAS_SIN_MOVIMIENTO, e.RESULTADO_ULTIMA_GESTION,
      e.ALERTA_ESTADO, e.VALOR_IMPUESTO, e.VALOR_INTERES, e.VALOR_MULTA,
      e.VALOR_RECARGO, e.TOTAL_DEUDA
    ]);

    const encabezados = [
      'ID Expediente','Código Interno','RUC','Contribuyente','Tipo Persona',
      'Tipo Obligación','Estado','Prioridad','Funcionario Asignado',
      'Fecha Asignación','Última Gestión','Próxima Gestión','Días sin Movimiento',
      'Último Resultado','Alerta','Impuesto','Interés','Multa','Recargo','Total Deuda'
    ];

    return _generarExcel('Expedientes_SIGECO', 'Expedientes', encabezados, filas);
  } catch (err) {
    Logger.log('exportExpedientes ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Exporta gestiones a Excel.
 * @param {string} token
 * @param {Object} [filtros]
 * @returns {{ ok, url?, nombre?, error? }}
 */
function exportGestiones(token, filtros) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    filtros = filtros || {};
    let datos = getDataAsObjects(SHEET_NAMES.GESTIONES);

    if (sesion.rol === 'GESTOR') {
      datos = datos.filter(g =>
        String(g.FUNCIONARIO || '').toLowerCase() === String(sesion.usuario || '').toLowerCase()
      );
    }
    if (filtros.idExpediente) datos = datos.filter(g => g.ID_EXPEDIENTE === filtros.idExpediente);
    if (filtros.tipo) datos = datos.filter(g => g.TIPO_GESTION === filtros.tipo);
    if (filtros.resultado) datos = datos.filter(g => g.RESULTADO === filtros.resultado);

    const encabezados = [
      'ID Gestión','Fecha Registro','ID Expediente','Funcionario',
      'Tipo Gestión','Resultado','Observación','Fecha Próxima Gestión',
      'Estado Post-Gestión','Monto Recaudado'
    ];
    const filas = datos.map(g => [
      g.ID_GESTION, g.FECHA_REGISTRO, g.ID_EXPEDIENTE, g.FUNCIONARIO,
      g.TIPO_GESTION, g.RESULTADO, g.OBSERVACION, g.FECHA_PROXIMA_GESTION,
      g.ESTADO_POST_GESTION, g.MONTO_RECAUDADO || 0
    ]);

    return _generarExcel('Gestiones_SIGECO', 'Gestiones', encabezados, filas);
  } catch (err) {
    Logger.log('exportGestiones ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Exporta seguimiento a Excel.
 * @param {string} token
 * @returns {{ ok, url?, nombre?, error? }}
 */
function exportSeguimiento(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };
  if (sesion.nivel < ROLES.SUPERVISOR.nivel) return { ok: false, error: 'Acceso denegado.' };

  try {
    const datos = getDataAsObjects(SHEET_NAMES.SEGUIMIENTO);
    const encabezados = [
      'Categoría','ID Expediente','Contribuyente','Funcionario',
      'Estado Expediente','Prioridad','Días sin Movimiento',
      'Fecha Próxima Gestión','Alerta Estado','Fecha Actualización'
    ];
    const filas = datos.map(s => [
      s.CATEGORIA, s.ID_EXPEDIENTE, s.CONTRIBUYENTE, s.FUNCIONARIO,
      s.ESTADO_EXPEDIENTE, s.PRIORIDAD, s.DIAS_SIN_MOVIMIENTO,
      s.FECHA_PROXIMA_GESTION, s.ALERTA_ESTADO, s.FECHA_ACTUALIZACION
    ]);

    return _generarExcel('Seguimiento_SIGECO', 'Seguimiento', encabezados, filas);
  } catch (err) {
    Logger.log('exportSeguimiento ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Exporta gestores con KPIs a Excel.
 * @param {string} token
 * @returns {{ ok, url?, nombre?, error? }}
 */
function exportGestores(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };
  if (sesion.nivel < ROLES.SUPERVISOR.nivel) return { ok: false, error: 'Acceso denegado.' };

  try {
    const r = getGestores(token);
    if (!r.ok) return r;

    const encabezados = [
      'ID','Nombre','Correo','Área','Estado','Último Acceso',
      'Exp. Asignados','Exp. Cerrados (Exitoso)','Total Gestiones',
      'Gestiones este Mes','Efectividad (%)'
    ];
    const filas = r.gestores.map(g => [
      g.id, g.nombre, g.correo, g.area, g.estado, g.ultimoAcceso,
      g.totalAsignados, g.expedientesCerrados, g.totalGestiones,
      g.gestionesMes, g.efectividad
    ]);

    return _generarExcel('Gestores_SIGECO', 'Gestores', encabezados, filas);
  } catch (err) {
    Logger.log('exportGestores ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Genera un Google Sheet temporal, escribe datos y retorna URL de descarga XLSX.
 * @private
 */
function _generarExcel(nombreBase, nombreHoja, encabezados, filas) {
  const timestamp = Utilities.formatDate(new Date(), 'America/Guayaquil', 'yyyyMMdd_HHmmss');
  const nombre = nombreBase + '_' + timestamp;

  const ss = SpreadsheetApp.create(nombre);
  const hoja = ss.getActiveSheet();
  hoja.setName(nombreHoja);

  // Encabezados
  hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  hoja.getRange(1, 1, 1, encabezados.length)
    .setBackground('#1a237e')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  // Datos
  if (filas.length > 0) {
    hoja.getRange(2, 1, filas.length, encabezados.length).setValues(filas);
  }

  // Auto-resize columnas
  hoja.autoResizeColumns(1, encabezados.length);
  hoja.setFrozenRows(1);

  // Mover a carpeta SIGECO si existe, sino usar raíz
  const ssFile = DriveApp.getFileById(ss.getId());
  const carpetas = DriveApp.getFoldersByName('SIGECO');
  if (carpetas.hasNext()) {
    ssFile.moveTo(carpetas.next());
  }

  // Generar URL de descarga XLSX
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx&id=' + ss.getId();

  // Programar eliminación automática del Sheet temporal después de 24h
  ScriptApp.newTrigger('_eliminarSheetTemporal')
    .timeBased()
    .after(86400000)
    .create();
  PropertiesService.getScriptProperties().setProperty('TEMP_SHEET_' + ss.getId(), ss.getId());

  return { ok: true, url: url, nombre: nombre + '.xlsx', total: filas.length };
}

/**
 * Limpia sheets temporales de exportación.
 * Invocado por trigger automático 24h después de la exportación.
 */
function _eliminarSheetTemporal() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).filter(k => k.startsWith('TEMP_SHEET_')).forEach(k => {
    try {
      const id = props[k];
      DriveApp.getFileById(id).setTrashed(true);
      PropertiesService.getScriptProperties().deleteProperty(k);
    } catch (e) { Logger.log('Error eliminando sheet temporal: ' + e.message); }
  });
}
/**
 * Retorna datos crudos (encabezados + filas) para que el frontend
 * genere el XLSX con SheetJS y lo descargue directamente en el navegador.
 * NO crea archivos en Drive.
 *
 * @param {string} token
 * @param {string} tipo — 'expedientes' | 'gestiones' | 'seguimiento' | 'gestores' | 'usuarios'
 * @param {Object} [filtros]
 * @returns {{ ok, encabezados?, filas?, nombre?, total?, error? }}
 */
function getExportData(token, tipo, filtros) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  filtros = filtros || {};

  try {
    let encabezados = [];
    let filas = [];
    let nombreBase = '';

    switch (tipo) {

      case 'expedientes': {
        let datos = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
        if (sesion.rol === 'GESTOR') {
          datos = datos.filter(e =>
            String(e.FUNCIONARIO_ASIGNADO || '').toLowerCase() === String(sesion.usuario || '').toLowerCase()
          );
        }
        if (filtros.estado)    datos = datos.filter(e => e.ESTADO_EXPEDIENTE === filtros.estado);
        if (filtros.prioridad) datos = datos.filter(e => e.PRIORIDAD === filtros.prioridad);
        if (filtros.busqueda) {
          const q = filtros.busqueda.toLowerCase();
          datos = datos.filter(e =>
            String(e.ID_EXPEDIENTE  || '').toLowerCase().includes(q) ||
            String(e.CONTRIBUYENTE  || '').toLowerCase().includes(q) ||
            String(e.RUC            || '').toLowerCase().includes(q)
          );
        }
        encabezados = [
          'ID Expediente','Código Interno','RUC','Contribuyente','Tipo Persona',
          'Tipo Obligación','Estado','Prioridad','Funcionario Asignado',
          'Fecha Asignación','Última Gestión','Próxima Gestión','Días sin Movimiento',
          'Último Resultado','Alerta','Impuesto','Interés','Multa','Recargo','Total Deuda'
        ];
        filas = datos.map(e => [
          e.ID_EXPEDIENTE, e.CODIGO_INTERNO, e.RUC, e.CONTRIBUYENTE,
          e.TIPO_PERSONA, e.TIPO_OBLIGACION, e.ESTADO_EXPEDIENTE, e.PRIORIDAD,
          e.FUNCIONARIO_ASIGNADO, e.FECHA_ASIGNACION, e.FECHA_ULTIMA_GESTION,
          e.FECHA_PROXIMA_GESTION, e.DIAS_SIN_MOVIMIENTO, e.RESULTADO_ULTIMA_GESTION,
          e.ALERTA_ESTADO, e.VALOR_IMPUESTO, e.VALOR_INTERES, e.VALOR_MULTA,
          e.VALOR_RECARGO, e.TOTAL_DEUDA
        ]);
        nombreBase = 'Expedientes_SIGECO';
        break;
      }

      case 'gestiones': {
        let datos = getDataAsObjects(SHEET_NAMES.GESTIONES);
        if (sesion.rol === 'GESTOR') {
          datos = datos.filter(g =>
            String(g.FUNCIONARIO || '').toLowerCase() === String(sesion.usuario || '').toLowerCase()
          );
        }
        if (filtros.idExpediente) datos = datos.filter(g => g.ID_EXPEDIENTE === filtros.idExpediente);
        if (filtros.tipo)         datos = datos.filter(g => g.TIPO_GESTION === filtros.tipo);
        if (filtros.resultado)    datos = datos.filter(g => g.RESULTADO === filtros.resultado);
        encabezados = [
          'ID Gestión','Fecha Registro','ID Expediente','Funcionario',
          'Tipo Gestión','Resultado','Observación','Fecha Próxima Gestión',
          'Estado Post-Gestión','Monto Recaudado'
        ];
        filas = datos.map(g => [
          g.ID_GESTION, g.FECHA_REGISTRO, g.ID_EXPEDIENTE, g.FUNCIONARIO,
          g.TIPO_GESTION, g.RESULTADO, g.OBSERVACION, g.FECHA_PROXIMA_GESTION,
          g.ESTADO_POST_GESTION, g.MONTO_RECAUDADO || 0
        ]);
        nombreBase = 'Gestiones_SIGECO';
        break;
      }

      case 'seguimiento': {
        if (sesion.nivel < ROLES.SUPERVISOR.nivel) return { ok: false, error: 'Acceso denegado.' };
        const datos = getDataAsObjects(SHEET_NAMES.SEGUIMIENTO);
        encabezados = [
          'Categoría','ID Expediente','Contribuyente','Funcionario',
          'Estado Expediente','Prioridad','Días sin Movimiento',
          'Fecha Próxima Gestión','Alerta Estado','Fecha Actualización'
        ];
        filas = datos.map(s => [
          s.CATEGORIA, s.ID_EXPEDIENTE, s.CONTRIBUYENTE, s.FUNCIONARIO,
          s.ESTADO_EXPEDIENTE, s.PRIORIDAD, s.DIAS_SIN_MOVIMIENTO,
          s.FECHA_PROXIMA_GESTION, s.ALERTA_ESTADO, s.FECHA_ACTUALIZACION
        ]);
        nombreBase = 'Seguimiento_SIGECO';
        break;
      }

      case 'gestores': {
        if (sesion.nivel < ROLES.SUPERVISOR.nivel) return { ok: false, error: 'Acceso denegado.' };
        const r = getGestores(token);
        if (!r.ok) return r;
        encabezados = [
          'ID','Nombre','Correo','Área','Estado','Último Acceso',
          'Exp. Asignados','Exp. Cerrados','Total Gestiones','Gestiones Mes','Efectividad (%)'
        ];
        filas = r.gestores.map(g => [
          g.id, g.nombre, g.correo, g.area, g.estado, g.ultimoAcceso,
          g.totalAsignados, g.expedientesCerrados, g.totalGestiones,
          g.gestionesMes, g.efectividad
        ]);
        nombreBase = 'Gestores_SIGECO';
        break;
      }

      case 'usuarios': {
        if (sesion.rol !== 'ADMINISTRADOR') return { ok: false, error: 'Solo administradores.' };
        const datos = getDataAsObjects(SHEET_NAMES.USUARIOS);
        encabezados = [
          'ID','Nombre','Correo','Rol','Área','Estado','Activo','Fecha Creación','Último Acceso'
        ];
        filas = datos.map(u => [
          u.ID_USUARIO, u.NOMBRE, u.CORREO_INSTITUCIONAL, u.ROL,
          u.AREA, u.ESTADO, u.ACTIVO, u.FECHA_CREACION, u.ULTIMO_ACCESO
        ]);
        nombreBase = 'Usuarios_SIGECO';
        break;
      }

      default:
        return { ok: false, error: 'Tipo de exportación no reconocido: ' + tipo };
    }

    const timestamp = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, 'yyyyMMdd_HHmmss');
    return {
      ok:          true,
      encabezados: encabezados,
      filas:       filas,
      nombre:      nombreBase + '_' + timestamp + '.xlsx',
      total:       filas.length
    };

  } catch (err) {
    Logger.log('getExportData ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Exporta usuarios del sistema a Excel.
 * Solo ADMINISTRADOR.
 */
function exportUsuarios(token) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesion invalida.' };
  if (sesion.rol !== 'ADMINISTRADOR') return { ok: false, error: 'Solo administradores.' };

  try {
    const usuarios = getDataAsObjects(SHEET_NAMES.USUARIOS);
    const encabezados = ['ID','Nombre','Correo','Rol','Area','Estado','Activo','Fecha Creacion','Ultimo Acceso'];
    const filas = usuarios.map(u => [
      u.ID_USUARIO, u.NOMBRE, u.CORREO_INSTITUCIONAL, u.ROL,
      u.AREA, u.ESTADO, u.ACTIVO, u.FECHA_CREACION, u.ULTIMO_ACCESO
    ]);
    return _generarExcel('Usuarios_SIGECO', 'Usuarios', encabezados, filas);
  } catch (err) {
    Logger.log('exportUsuarios ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}