/**
 * AssignmentService.gs
 * Lógica de distribución automática de expedientes entre gestores.
 * Optimiza la carga de trabajo basada en cuotas diarias.
 */

/**
 * Ejecuta la asignación masiva de contribuyentes sin expediente a gestores activos.
 * Solo ADMINISTRADOR.
 * @param {string} token
 * @param {number} [limitTotal] — Límite de expedientes a crear en esta corrida.
 * @returns {{ ok: boolean, asignados?: number, error?: string }}
 */
function autoAssignExpedientes(token, limitTotal) {
  const acceso = checkAccess(token, 'REASIGNAR_EXPEDIENTE');
  if (!acceso.ok) return acceso;

  // Evita que dos ejecuciones simultáneas (dos administradores, o un doble clic)
  // lean el mismo snapshot de "pendientes" y creen expedientes duplicados para
  // el mismo RUC, o descoordinen el reparto round-robin entre gestores.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { ok: false, error: 'Otra asignación masiva está en curso. Intente de nuevo en unos segundos.' };
  }

  try {
    return _autoAssignExpedientesInterno(token, limitTotal);
  } finally {
    lock.releaseLock();
  }
}

function _autoAssignExpedientesInterno(token, limitTotal) {
  // 1. Obtener gestores activos
  const rGestores = getGestoresActivos(token);
  if (!rGestores.ok || rGestores.gestores.length === 0) {
    return { ok: false, error: 'No hay gestores activos para asignar expedientes.' };
  }
  const gestores = rGestores.gestores;

  // 2. Obtener contribuyentes pendientes
  const contribuyentes = getDataAsObjects(SHEET_NAMES.CONTRIBUYENTES);
  const expedientes    = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
  
  // Mapa de expedientes existentes para evitar duplicados (RUC + TIPO_OBLIGACION)
  const mapaExistentes = {};
  expedientes.forEach(e => {
    if (e.ACTIVO === 'TRUE' || e.ACTIVO === true) {
      mapaExistentes[e.RUC + '|' + e.TIPO_OBLIGACION] = true;
    }
  });

  const tipoOblAutoAsig = 'IMPUESTO_15_POR_MIL';
  const pendientes = contribuyentes.filter(c => !mapaExistentes[c.RUC + '|' + tipoOblAutoAsig]);

  if (pendientes.length === 0) {
    return { ok: true, asignados: 0, mensaje: 'No hay contribuyentes nuevos para asignar.' };
  }

  // 3. Calcular cuotas
  const cuotaPorGestor = PARAMS.CASES_PER_DAY_QUOTA || 20;
  const maxAsignables  = limitTotal || (gestores.length * cuotaPorGestor);
  const aProcesar      = pendientes.slice(0, maxAsignables);

  // 4. Asignación priorizando al gestor con menos carga actual — así un
  // gestor recién ingresado (con 0 o pocos expedientes) recibe más casos
  // de este lote hasta emparejarse con el resto, en vez de recibir la
  // misma cantidad que alguien que ya tenía cientos asignados.
  const cargaPorGestor = _calcularCargaPorGestor(gestores, expedientes);
  let asignados = 0;

  aProcesar.forEach(c => {
    const gestor = _elegirGestorConMenorCarga(gestores, cargaPorGestor);

    // Crear el expediente
    const datosExp = {
      ruc:                 c.RUC,
      contribuyente:       c.NOMBRE_CONTRIBUYENTE,
      tipoPersona:         c.TIPO_PERSONA || '',
      tipoObligacion:      tipoOblAutoAsig,
      estadoExpediente:    'EN_GESTION',
      prioridad:           'MEDIA',
      funcionarioAsignado: gestor.correo,
      observacionGeneral:  'Asignación automática masiva.',
      valorImpuesto:       parseFloat(c.VALOR_IMPUESTO) || 0,
      valorInteres:        parseFloat(c.INTERESES)      || 0,
      valorMulta:          0,
      valorRecargo:        parseFloat(c.RECARGO)        || 0,
      totalDeuda:          parseFloat(c.TOTAL_DEUDA)    || 0
    };

    const res = createExpediente(token, datosExp);
    if (res.ok) {
      asignados++;
      cargaPorGestor[_normCorreo(gestor.correo)]++;
    }
  });

  logAction({
    token,
    hoja:    SHEET_NAMES.EXPEDIENTES,
    accion:  'ASIGNACION_AUTOMATICA_MASIVA',
    contexto: 'Expedientes asignados: ' + asignados + ' entre ' + gestores.length + ' gestores.',
    origen:  'AssignmentService.gs'
  });

  return { ok: true, asignados };
}


/**
 * Redistribuye expedientes sin gestión (FECHA_ULTIMA_GESTION vacío) o con
 * alerta SIN_MOVIMIENTO a gestores activos. NO toca expedientes que ya
 * tuvieron alguna gestión y solo están envejecidos por días — esos los
 * gestiona quien ya los tenía.
 * Solo ADMINISTRADOR.
 * @param {string} token
 * @param {boolean} [forzar] — si es true, ignora la protección de 24h entre
 *   redistribuciones de un mismo expediente. Uso puntual de administrador
 *   (ej. justo después de corregir datos manualmente); no usar de rutina.
 * @returns {{ ok: boolean, redistribuidos?: number, error?: string }}
 */
function redistribuirExpedientesSinGestion(token, forzar) {
  const acceso = checkAccess(token, 'REASIGNAR_EXPEDIENTE');
  if (!acceso.ok) return acceso;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { ok: false, error: 'Otra redistribución está en curso. Intente de nuevo en unos segundos.' };
  }

  try {
    return _redistribuirExpedientesSinGestionInterno(token, !!forzar);
  } finally {
    lock.releaseLock();
  }
}

function _redistribuirExpedientesSinGestionInterno(token, forzar) {
  const HORAS_ENFRIAMIENTO = 24;

  // 1. Obtener gestores activos
  const rGestores = getGestoresActivos(token);
  if (!rGestores.ok || rGestores.gestores.length === 0) {
    return { ok: false, error: 'No hay gestores activos para redistribuir expedientes.' };
  }
  const gestores = rGestores.gestores;

  // 2. Obtener expedientes
  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
  const ahora = new Date();

  // 3. Filtrar expedientes que cumplan las condiciones:
  const aRedistribuir = expedientes.filter(e => {
    if (!(e.ACTIVO === 'TRUE' || e.ACTIVO === true)) return false;
    if (esEstadoTerminal(e.ESTADO_EXPEDIENTE)) return false;

    // Nunca tuvo gestión registrada
    const sinGestion = !e.FECHA_ULTIMA_GESTION || String(e.FECHA_ULTIMA_GESTION).trim() === '';

    // O quedó marcado explícitamente como sin movimiento
    const sinMovimiento = e.ALERTA_ESTADO === 'SIN_MOVIMIENTO';

    if (!sinGestion && !sinMovimiento) return false;

    // Protección: si se le tocó la asignación hace menos de 24h (por esta
    // misma redistribución, por una corrida anterior que se cortó a medias,
    // o por una asignación manual), no volver a moverlo todavía. Sin esto,
    // un expediente que sigue sin FECHA_ULTIMA_GESTION porque nadie alcanzó
    // a gestionarlo aún puede rebotar de gestor en gestor en cada corrida.
    // `forzar` permite que un administrador la ignore puntualmente.
    if (!forzar && e.FECHA_ASIGNACION) {
      const fAsig = new Date(e.FECHA_ASIGNACION);
      if (!isNaN(fAsig.getTime())) {
        const horasDesdeAsignacion = (ahora - fAsig) / 3600000;
        if (horasDesdeAsignacion < HORAS_ENFRIAMIENTO) return false;
      }
    }

    return true;
  });

  if (aRedistribuir.length === 0) {
    return { ok: true, redistribuidos: 0, mensaje: 'No hay expedientes sin gestión para redistribuir.' };
  }

  // 4. Preparar los cambios en memoria — se escriben todos juntos al final
  // (una sola lectura + una sola escritura del rango afectado en
  // EXPEDIENTES, y un solo append en BITACORA) para no exceder el límite
  // de 6 minutos de ejecución de Apps Script cuando hay muchos expedientes
  // que redistribuir.
  const ahoraStr = Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const prefijoLog = getConfig('PREFIJO_LOG', 'LOG');
  const sesionActual = verificarSesion(token) || {};
  const usuarioLog = sesionActual.usuario || 'SISTEMA';
  const rolLog = sesionActual.rol || 'SISTEMA';

  // Carga actual de cada gestor (expedientes activos y no terminales que ya
  // tiene asignados). Se reparte siempre al que tenga MENOS carga en este
  // momento, en vez de por turno ciego — así un gestor recién ingresado
  // (con 0 expedientes) recibe más casos de este lote hasta emparejarse con
  // el resto, en lugar de recibir la misma cantidad que alguien que ya
  // tenía cientos asignados.
  const cargaPorGestor = _calcularCargaPorGestor(gestores, expedientes);

  const actualizaciones = [];
  const filasBitacora = [];

  aRedistribuir.forEach((exp, i) => {
    const gestor = _elegirGestorConMenorCarga(gestores, cargaPorGestor);
    cargaPorGestor[_normCorreo(gestor.correo)]++;
    const gestorAnterior = exp.FUNCIONARIO_ASIGNADO;

    const obsAnterior = exp.OBSERVACION_GENERAL ? exp.OBSERVACION_GENERAL + '\n' : '';
    const obsNueva = obsAnterior + 'Reasignado automáticamente por falta de gestión (anterior: ' + (gestorAnterior || 'Ninguno') + ').';

    actualizaciones.push({
      rowIndex: exp._rowIndex,
      campos: {
        FUNCIONARIO_ASIGNADO: gestor.correo,
        OBSERVACION_GENERAL: obsNueva,
        FECHA_ASIGNACION: ahoraStr,
        ALERTA_ESTADO: 'OK', // Reseteamos la alerta
        DIAS_SIN_MOVIMIENTO: 0 // Reseteamos los días
      }
    });

    filasBitacora.push([
      prefijoLog + '-' + ahora.getTime() + '-' + i,
      ahoraStr,
      usuarioLog,
      rolLog,
      SHEET_NAMES.EXPEDIENTES,
      exp.ID_EXPEDIENTE,
      'REASIGNACION_AUTOMATICA',
      'FUNCIONARIO_ASIGNADO',
      gestorAnterior || '(Sin asignar)',
      gestor.correo,
      'Redistribución automática por falta de gestión.',
      'AssignmentService.gs'
    ]);
  });

  batchUpdateRows(SHEET_NAMES.EXPEDIENTES, actualizaciones);
  _appendBitacoraEnLote(filasBitacora);

  const redistribuidos = actualizaciones.length;

  logAction({
    token,
    hoja:    SHEET_NAMES.EXPEDIENTES,
    accion:  'REDISTRIBUCION_MASIVA',
    contexto: 'Expedientes redistribuidos: ' + redistribuidos + ' entre ' + gestores.length + ' gestores.' +
              (forzar ? ' (protección de 24h ignorada manualmente)' : ''),
    origen:  'AssignmentService.gs'
  });

  if (typeof limpiarCacheGlobal === 'function') limpiarCacheGlobal();

  return { ok: true, redistribuidos };
}

/**
 * Agrega muchas filas a BITACORA en una sola llamada a la API de Sheets,
 * en vez de una llamada por fila (que es lo que hace logChange/appendRow).
 * El orden de columnas debe coincidir con HEADERS.BITACORA.
 */
function _appendBitacoraEnLote(filas) {
  if (!filas || filas.length === 0) return;
  const hoja = getHoja(SHEET_NAMES.BITACORA);
  const lastRow = hoja.getLastRow();
  hoja.getRange(lastRow + 1, 1, filas.length, filas[0].length).setValues(filas);
}

/**
 * Calcula cuántos expedientes activos y no terminales tiene asignados cada
 * gestor ahora mismo. Usado por autoAssignExpedientes y
 * redistribuirExpedientesSinGestion para repartir priorizando a quien tenga
 * menos carga, en vez de un round-robin ciego que le da la misma cantidad
 * de casos nuevos a un gestor recién ingresado que a uno que ya tenía
 * cientos asignados.
 * @param {Array<{correo:string}>} gestores
 * @param {Array<Object>} expedientes — filas de EXPEDIENTES (getDataAsObjects)
 * @returns {Object} mapa { correo: cantidadDeExpedientes }
 */
function _calcularCargaPorGestor(gestores, expedientes) {
  const carga = {};
  gestores.forEach(g => { carga[_normCorreo(g.correo)] = 0; });
  expedientes.forEach(e => {
    const key = _normCorreo(e.FUNCIONARIO_ASIGNADO);
    if ((e.ACTIVO === 'TRUE' || e.ACTIVO === true) &&
        !esEstadoTerminal(e.ESTADO_EXPEDIENTE) &&
        key &&
        carga[key] !== undefined) {
      carga[key]++;
    }
  });
  return carga;
}

/**
 * Normaliza un correo para comparaciones (trim + minúsculas). El valor
 * guardado en EXPEDIENTES.FUNCIONARIO_ASIGNADO no siempre coincide
 * carácter-por-carácter con USUARIOS.CORREO_INSTITUCIONAL (espacios,
 * mayúsculas) — comparar en crudo subestima silenciosamente la carga real
 * de un gestor. getGestores() (UtilAPI.gs) ya normaliza así para calcular
 * lo que se ve en la pantalla de Empleados; aquí usamos el mismo criterio.
 */
function _normCorreo(correo) {
  return String(correo || '').trim().toLowerCase();
}

/**
 * Elige, de la lista de gestores, al que tenga menos carga según el mapa
 * calculado por _calcularCargaPorGestor(). El llamador debe incrementar
 * carga[_normCorreo(gestor.correo)] después de asignarle un caso, para que
 * la siguiente elección considere el reparto ya hecho en esta misma corrida.
 */
function _elegirGestorConMenorCarga(gestores, carga) {
  let elegido = gestores[0];
  gestores.forEach(g => {
    if (carga[_normCorreo(g.correo)] < carga[_normCorreo(elegido.correo)]) elegido = g;
  });
  return elegido;
}
