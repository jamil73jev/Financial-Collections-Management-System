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
function autoAssignExpedientes_(token, limitTotal) {
  const acceso = checkAccess_(token, 'REASIGNAR_EXPEDIENTE');
  if (!acceso.ok) return acceso;

  const rGestores = getGestoresActivos_(token);
  if (!rGestores.ok || rGestores.gestores.length === 0) {
    return { ok: false, error: 'No hay gestores activos para asignar expedientes.' };
  }
  const gestores = rGestores.gestores;
  const ordenPrioridad = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };
  const pendientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES)
    .filter(exp =>
      (exp.ACTIVO === 'TRUE' || exp.ACTIVO === true) &&
      exp.ESTADO_EXPEDIENTE === 'PENDIENTE_ASIGNACION' &&
      !String(exp.FUNCIONARIO_ASIGNADO || '').trim()
    )
    .sort((a, b) =>
      (ordenPrioridad[a.PRIORIDAD] === undefined ? 9 : ordenPrioridad[a.PRIORIDAD]) -
      (ordenPrioridad[b.PRIORIDAD] === undefined ? 9 : ordenPrioridad[b.PRIORIDAD])
    );

  if (pendientes.length === 0) {
    return { ok: true, asignados: 0, mensaje: 'No hay expedientes pendientes de asignación.' };
  }

  const requested = parseInt(limitTotal, 10);
  const maxAsignables = requested > 0
    ? requested
    : gestores.length * (PARAMS.CASES_PER_DAY_QUOTA || 20);
  const fecha = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const updates = pendientes.slice(0, maxAsignables).map((exp, index) => {
    const gestor = gestores[index % gestores.length];
    return {
      rowIndex: exp._rowIndex,
      campos: {
        FUNCIONARIO_ASIGNADO: gestor.correo,
        ESTADO_EXPEDIENTE: 'EN_GESTION',
        FECHA_ASIGNACION: fecha,
        OBSERVACION_GENERAL:
          (exp.OBSERVACION_GENERAL ? exp.OBSERVACION_GENERAL + ' | ' : '') +
          'Asignación automática a ' + gestor.correo
      }
    };
  });

  batchUpdateRows_(SHEET_NAMES.EXPEDIENTES, updates);
  if (typeof invalidarCacheMaestro_ === 'function') invalidarCacheMaestro_();

  logAction_({
    token,
    hoja: SHEET_NAMES.EXPEDIENTES,
    accion: 'ASIGNACION_AUTOMATICA_MASIVA',
    contexto: 'Expedientes asignados: ' + updates.length + ' entre ' + gestores.length + ' gestores.',
    origen: 'AssignmentService.gs'
  });

  return {
    ok: true,
    asignados: updates.length,
    pendientesRestantes: pendientes.length - updates.length
  };
}
