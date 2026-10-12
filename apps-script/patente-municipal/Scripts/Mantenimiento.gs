/**
 * Scripts/Mantenimiento.gs
 * Utilidades de reparación y mantenimiento de datos para el administrador.
 */

/**
 * Función crítica: Sincroniza retroactivamente la columna VALOR_DEUDA en la hoja EXPEDIENTES.
 * Lee de la hoja CONTRIBUYENTES y mapea por RUC|PERIODO.
 * Ejecutar desde el editor de Apps Script.
 */
function sincronizarDeudaExpedientes() {
  Logger.log('=== INICIANDO SINCRONIZACIÓN DE DEUDA ===');
  
  const ss = getSpreadsheet();
  const hojaC = ss.getSheetByName(SHEET_NAMES.CONTRIBUYENTES);
  const hojaE = ss.getSheetByName(SHEET_NAMES.EXPEDIENTES);
  
  if (!hojaC || !hojaE) {
    Logger.log('Error: No se encontraron las hojas necesarias.');
    return;
  }

  // 1. Cargar Contribuyentes para mapear deudas
  const datosC = hojaC.getDataRange().getValues();
  const headersC = datosC[0].map(h => String(h).trim().toUpperCase());
  const colRucC = headersC.indexOf('RUC');
  const colPerC = headersC.indexOf('PERIODO');
  const colDeuC = headersC.indexOf('TOTAL_DEUDA');

  const mapaDeuda = {};
  for (let i = 1; i < datosC.length; i++) {
    const ruc = String(datosC[i][colRucC]).trim();
    const per = String(datosC[i][colPerC]).trim();
    const deu = parseFloat(datosC[i][colDeuC]) || 0;
    mapaDeuda[ruc + '|' + per] = deu;
  }
  Logger.log('Mapa de deudas cargado: ' + Object.keys(mapaDeuda).length + ' registros.');

  // 2. Procesar Expedientes
  const datosE = hojaE.getDataRange().getValues();
  const headersE = datosE[0].map(h => String(h).trim().toUpperCase());
  const colRucE = headersE.indexOf('RUC');
  const colPerE = headersE.indexOf('PERIODO');
  const colActE = headersE.indexOf('ACTIVO');
  const colDeuE = headersE.indexOf('VALOR_DEUDA');

  Logger.log('Indices detectados - RUC: ' + colRucE + ', Periodo: ' + colPerE + ', Activo: ' + colActE + ', Deuda: ' + colDeuE);

  let actualizados = 0;
  const nuevasFilas = [];

  for (let i = 1; i < datosE.length; i++) {
    const fila = datosE[i];
    const ruc = String(fila[colRucE]).trim();
    const per = String(fila[colPerE]).trim();
    const key = ruc + '|' + per;

    // Solo actualizar si la deuda está vacía o es 0
    if (!fila[colDeuE] || fila[colDeuE] === 0) {
      if (mapaDeuda[key]) {
        fila[colDeuE] = mapaDeuda[key];
        actualizados++;
      }
    }
    
    // Asegurar que ACTIVO sea TRUE si está vacío
    if (!fila[colActE]) {
      fila[colActE] = 'TRUE';
    }
  }

  // Escribir cambios en batch (mucho más rápido)
  if (actualizados > 0) {
    hojaE.getRange(2, 1, datosE.length - 1, datosE[0].length).setValues(datosE.slice(1));
    Logger.log('Sincronización completada. Registros actualizados: ' + actualizados);
  } else {
    Logger.log('No se encontraron expedientes que requieran actualización de deuda.');
  }

  // Limpiar caché para que el dashboard se refresque
  if (typeof limpiarCacheGlobal === 'function') {
    limpiarCacheGlobal();
    Logger.log('Caché global invalidado.');
  }
}

/**
 * CORRECCIÓN PUNTUAL (uso único): revierte el FUNCIONARIO_ASIGNADO de los
 * expedientes que fueron redistribuidos por error por una versión anterior
 * de redistribuirExpedientesSinGestion() — la que usaba un umbral de "días
 * sin gestión" y por eso llegó a tocar expedientes que YA tenían gestión
 * registrada, quitándoselos al gestor que los estaba trabajando.
 *
 * Cada redistribución quedó registrada individualmente en BITACORA con
 * ACCION = 'REASIGNACION_AUTOMATICA', CAMPO = 'FUNCIONARIO_ASIGNADO' y el
 * gestor anterior en VALOR_ANTERIOR. Esta función lee esos registros y
 * restaura ese valor en el expediente correspondiente.
 *
 * NO toca OBSERVACION_GENERAL (el texto de la redistribución errónea queda
 * como constancia histórica) ni FECHA_ASIGNACION (no se guardó el valor
 * original en bitácora). Sí recalcula ALERTA_ESTADO/DIAS_SIN_MOVIMIENTO al
 * final, invocando el ciclo normal de alertas.
 *
 * Ejecutar UNA SOLA VEZ desde el editor de Apps Script: revertirRedistribucionErronea()
 */
function revertirRedistribucionErronea() {
  Logger.log('=== REVIRTIENDO REDISTRIBUCIÓN ERRÓNEA ===');

  const bitacora = getDataAsObjects(SHEET_NAMES.BITACORA)
    .filter(b => b.ACCION === 'REASIGNACION_AUTOMATICA');

  if (bitacora.length === 0) {
    Logger.log('No hay registros de REASIGNACION_AUTOMATICA en la bitácora. Nada que revertir.');
    return { ok: true, revertidos: 0, total: 0 };
  }

  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
  const mapaExp = {};
  expedientes.forEach(e => { mapaExp[String(e.ID_EXPEDIENTE)] = e; });

  const ahora = new Date();
  const ahoraStr = Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const prefijoLog = getConfig('PREFIJO_LOG', 'LOG');

  // Preparamos TODOS los cambios en memoria y los escribimos en un solo lote
  // al final (antes se hacía updateRowFields + logActionSystem por cada
  // expediente, uno por uno, lo cual agotó el límite de 6 minutos de
  // ejecución de Apps Script con muchos registros).
  const actualizaciones = [];
  const filasBitacora = [];
  const noEncontrados = [];
  const yaPreparado = {}; // si un expediente aparece más de una vez en el lote erróneo, solo se revierte una vez (a su primer valor anterior real, el más antiguo)

  bitacora.forEach((r, i) => {
    const idExp = String(r.ID_EXPEDIENTE || '');
    if (yaPreparado[idExp]) return;

    const exp = mapaExp[idExp];
    if (!exp) { noEncontrados.push(idExp); return; }

    yaPreparado[idExp] = true;
    const valorAnterior = (r.VALOR_ANTERIOR === '(Sin asignar)') ? '' : (r.VALOR_ANTERIOR || '');

    actualizaciones.push({
      rowIndex: exp._rowIndex,
      campos: { FUNCIONARIO_ASIGNADO: valorAnterior }
    });

    filasBitacora.push([
      prefijoLog + '-' + ahora.getTime() + '-' + i,
      ahoraStr,
      'SISTEMA', 'SISTEMA',
      SHEET_NAMES.EXPEDIENTES,
      idExp,
      'REVERSION_REDISTRIBUCION_ERRONEA',
      'FUNCIONARIO_ASIGNADO',
      r.VALOR_NUEVO || '',
      valorAnterior || '(sin asignar)',
      'Restaurado por reversión de la redistribución errónea del ' + r.FECHA_HORA + '.',
      'Scripts/Mantenimiento.gs (revertirRedistribucionErronea)'
    ]);
  });

  if (actualizaciones.length > 0) {
    batchUpdateRows(SHEET_NAMES.EXPEDIENTES, actualizaciones);
    _appendBitacoraEnLote(filasBitacora);
  }

  const revertidos = actualizaciones.length;
  Logger.log('Revertidos: ' + revertidos + ' de ' + bitacora.length + ' registros de bitácora.');
  if (noEncontrados.length > 0) {
    Logger.log('No encontrados (expediente ya no existe): ' + noEncontrados.join(', '));
  }

  // Recalcular alertas/días sin movimiento con los datos ya corregidos
  if (typeof checkAlertsInterno === 'function') {
    checkAlertsInterno();
    Logger.log('Ciclo de alertas recalculado.');
  }
  if (typeof limpiarCacheGlobal === 'function') {
    limpiarCacheGlobal();
    Logger.log('Caché global invalidado.');
  }

  return { ok: true, revertidos, total: bitacora.length, noEncontrados };
}

/**
 * CORRECCIÓN PUNTUAL (uso único): empareja la carga actual de expedientes
 * entre los gestores activos, moviendo el excedente del/de los gestor(es)
 * por encima del promedio hacia quienes están por debajo.
 *
 * Solo mueve expedientes SIN gestión real (FECHA_ULTIMA_GESTION vacío) —
 * nunca toca un expediente que ya tiene alguna gestión registrada, para no
 * quitarle trabajo en curso a nadie. Si un gestor sobrecargado no tiene
 * suficientes expedientes "sin gestión" para bajar hasta el promedio exacto,
 * se mueven los que haya disponibles y se deja así (no se fuerza el número
 * exacto a costa de tocar trabajo real).
 *
 * Ejecutar UNA SOLA VEZ desde el editor de Apps Script: rebalancearCargaGestores()
 */
function rebalancearCargaGestores() {
  Logger.log('=== REBALANCEANDO CARGA ENTRE GESTORES ===');

  const rGestores = getGestoresActivos(null);
  if (!rGestores.ok || rGestores.gestores.length === 0) {
    Logger.log('No hay gestores activos: ' + (rGestores.error || ''));
    return { ok: false, error: rGestores.error || 'No hay gestores activos.' };
  }
  const gestores = rGestores.gestores;

  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
    .filter(e => (e.ACTIVO === 'TRUE' || e.ACTIVO === true) && !esEstadoTerminal(e.ESTADO_EXPEDIENTE));

  // Agrupar por gestor (correo normalizado)
  const porGestor = {};
  gestores.forEach(g => { porGestor[_normCorreo(g.correo)] = []; });
  let totalConsiderado = 0;
  expedientes.forEach(e => {
    const key = _normCorreo(e.FUNCIONARIO_ASIGNADO);
    if (porGestor[key]) {
      porGestor[key].push(e);
      totalConsiderado++;
    }
  });

  const objetivo = Math.round(totalConsiderado / gestores.length);
  Logger.log('Total expedientes activos entre estos gestores: ' + totalConsiderado + ' | Objetivo por gestor: ~' + objetivo);

  const excedentes = []; // { exp, origenCorreo }
  const deficits = [];   // { gestor, faltan }

  gestores.forEach(g => {
    const lista = porGestor[_normCorreo(g.correo)] || [];
    const diferencia = lista.length - objetivo;

    if (diferencia > 0) {
      const sinGestion = lista.filter(e => !e.FECHA_ULTIMA_GESTION || String(e.FECHA_ULTIMA_GESTION).trim() === '');
      const aMover = sinGestion.slice(0, diferencia);
      aMover.forEach(exp => excedentes.push({ exp, origenCorreo: g.correo }));
      Logger.log(g.correo + ': tiene ' + lista.length + ' (excedente ' + diferencia + '), ' +
                 sinGestion.length + ' sin gestión real disponibles -> se mueven ' + aMover.length);
    } else if (diferencia < 0) {
      deficits.push({ gestor: g, faltan: -diferencia });
      Logger.log(g.correo + ': tiene ' + lista.length + ' (le faltan ' + (-diferencia) + ' para el objetivo)');
    } else {
      Logger.log(g.correo + ': tiene ' + lista.length + ' (ya está en el objetivo)');
    }
  });

  if (excedentes.length === 0 || deficits.length === 0) {
    Logger.log('No hay expedientes sin gestión real disponibles para mover, o nadie tiene déficit. Nada que hacer.');
    return { ok: true, movidos: 0 };
  }

  const ahora = new Date();
  const ahoraStr = Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const prefijoLog = getConfig('PREFIJO_LOG', 'LOG');

  const actualizaciones = [];
  const filasBitacora = [];
  let deficitIdx = 0;
  let movidos = 0;

  for (let i = 0; i < excedentes.length; i++) {
    let vueltas = 0;
    while (deficits[deficitIdx].faltan <= 0) {
      deficitIdx = (deficitIdx + 1) % deficits.length;
      vueltas++;
      if (vueltas > deficits.length) break;
    }
    if (deficits[deficitIdx].faltan <= 0) break; // ya no queda déficit pendiente en ningún gestor

    const destino = deficits[deficitIdx];
    const { exp, origenCorreo } = excedentes[i];

    const obsAnterior = exp.OBSERVACION_GENERAL ? exp.OBSERVACION_GENERAL + '\n' : '';
    const obsNueva = obsAnterior + 'Rebalanceado automáticamente por carga desigual entre gestores (anterior: ' + origenCorreo + ').';

    actualizaciones.push({
      rowIndex: exp._rowIndex,
      campos: {
        FUNCIONARIO_ASIGNADO: destino.gestor.correo,
        OBSERVACION_GENERAL: obsNueva,
        FECHA_ASIGNACION: ahoraStr
      }
    });

    filasBitacora.push([
      prefijoLog + '-' + ahora.getTime() + '-' + movidos,
      ahoraStr,
      'SISTEMA', 'SISTEMA',
      SHEET_NAMES.EXPEDIENTES,
      exp.ID_EXPEDIENTE,
      'REBALANCEO_CARGA',
      'FUNCIONARIO_ASIGNADO',
      origenCorreo,
      destino.gestor.correo,
      'Rebalanceo de carga entre gestores activos.',
      'Scripts/Mantenimiento.gs (rebalancearCargaGestores)'
    ]);

    destino.faltan--;
    movidos++;
    deficitIdx = (deficitIdx + 1) % deficits.length;
  }

  if (actualizaciones.length > 0) {
    batchUpdateRows(SHEET_NAMES.EXPEDIENTES, actualizaciones);
    _appendBitacoraEnLote(filasBitacora);
  }

  Logger.log('Expedientes movidos: ' + movidos);

  if (typeof checkAlertsInterno === 'function') {
    checkAlertsInterno();
    Logger.log('Ciclo de alertas recalculado.');
  }
  if (typeof limpiarCacheGlobal === 'function') {
    limpiarCacheGlobal();
    Logger.log('Caché global invalidado.');
  }

  return { ok: true, movidos };
}

/**
 * DIAGNÓSTICO (solo lectura — no modifica nada): revisa si el
 * FUNCIONARIO_ASIGNADO guardado en EXPEDIENTES coincide EXACTAMENTE con el
 * CORREO_INSTITUCIONAL de cada gestor, o si solo coincide al normalizar
 * (quitar espacios y pasar a minúsculas). Un desajuste ahí hace que el
 * cálculo de "carga actual" de un gestor salga en 0 aunque ya tenga miles
 * de expedientes, lo que explicaría por qué la redistribución le mandó
 * casi todo el lote a un solo gestor en vez de repartir parejo.
 *
 * También desglosa, según BITACORA, cuántos expedientes se le asignaron a
 * cada gestor en la última redistribución automática.
 *
 * Ejecutar desde el editor de Apps Script: diagnosticoCargaGestores()
 */
function diagnosticoCargaGestores() {
  Logger.log('=== DIAGNÓSTICO DE CARGA POR GESTOR ===');

  const rGestores = getGestoresActivos(null);
  if (!rGestores.ok) {
    Logger.log('Error obteniendo gestores: ' + rGestores.error);
    return;
  }

  const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
    .filter(e => e.ACTIVO === 'TRUE' || e.ACTIVO === true);

  rGestores.gestores.forEach(g => {
    const correoRaw = g.correo;
    const correoNorm = String(correoRaw || '').trim().toLowerCase();

    const exacto = expedientes.filter(e =>
      e.FUNCIONARIO_ASIGNADO === correoRaw && !esEstadoTerminal(e.ESTADO_EXPEDIENTE)
    ).length;

    const normalizado = expedientes.filter(e =>
      String(e.FUNCIONARIO_ASIGNADO || '').trim().toLowerCase() === correoNorm &&
      !esEstadoTerminal(e.ESTADO_EXPEDIENTE)
    ).length;

    Logger.log(correoRaw + ' -> coincidencia EXACTA: ' + exacto +
               ' | coincidencia NORMALIZADA (trim+lowercase): ' + normalizado +
               (exacto !== normalizado ? '   <-- DESAJUSTE DETECTADO' : ''));
  });

  // Desglose de la última redistribución automática según bitácora
  const bitacora = getDataAsObjects(SHEET_NAMES.BITACORA)
    .filter(b => b.ACCION === 'REASIGNACION_AUTOMATICA');

  const porDestino = {};
  bitacora.forEach(b => {
    const destino = b.VALOR_NUEVO || '(vacío)';
    porDestino[destino] = (porDestino[destino] || 0) + 1;
  });

  Logger.log('Total registros REASIGNACION_AUTOMATICA en bitácora: ' + bitacora.length);
  Logger.log('Desglose por gestor destino: ' + JSON.stringify(porDestino));
}

