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

  // 1. Obtener gestores activos
  const rGestores = getGestoresActivos(token);
  if (!rGestores.ok || rGestores.gestores.length === 0) {
    return { ok: false, error: 'No hay gestores activos para asignar expedientes.' };
  }
  const gestores = rGestores.gestores;

  // 2. Obtener contribuyentes pendientes
  const contribuyentes = getDataAsObjects(SHEET_NAMES.CONTRIBUYENTES);
  const expedientes    = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
  
  // Mapa de expedientes existentes para evitar duplicados (RUC + PERIODO)
  const mapaExistentes = {};
  expedientes.forEach(e => {
    if (e.ACTIVO === 'TRUE' || e.ACTIVO === true) {
      mapaExistentes[e.RUC + '|' + e.PERIODO] = true;
    }
  });

  const pendientes = contribuyentes.filter(c => !mapaExistentes[c.RUC + '|' + (c.PERIODO || new Date().getFullYear())]);

  if (pendientes.length === 0) {
    return { ok: true, asignados: 0, mensaje: 'No hay contribuyentes nuevos para asignar.' };
  }

  // 3. Calcular cuotas
  const cuotaPorGestor = PARAMS.CASES_PER_DAY_QUOTA || 20;
  const maxAsignables  = limitTotal || (gestores.length * cuotaPorGestor);
  const aProcesar      = pendientes.slice(0, maxAsignables);

  // 4. Asignación Round Robin
  let asignados = 0;
  let gestorIdx = 0;

  aProcesar.forEach(c => {
    const gestor = gestores[gestorIdx];
    
    // Crear el expediente
    const datosExp = {
      ruc:                 c.RUC,
      contribuyente:       c.NOMBRE_CONTRIBUYENTE,
      periodo:             c.PERIODO || new Date().getFullYear(),
      tipoObligacion:      'IMPUESTO_15_POR_MIL',
      estadoExpediente:    'EN_GESTION',
      prioridad:           'MEDIA',
      funcionarioAsignado: gestor.correo,
      observacionGeneral:  'Asignación automática masiva.'
    };

    const res = createExpediente(token, datosExp);
    if (res.ok) {
      asignados++;
    }

    // Siguiente gestor (Round Robin)
    gestorIdx = (gestorIdx + 1) % gestores.length;
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
