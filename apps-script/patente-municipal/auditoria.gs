function auditarSincroniaGestiones() {
  const ss = getSpreadsheet();
  const shExp        = ss.getSheetByName('EXPEDIENTES');
  const shGes        = ss.getSheetByName('GESTIONES');

  const expData = shExp.getDataRange().getValues();
  const gesData = shGes.getDataRange().getValues();

  const expHeaders = expData[0];
  const gesHeaders = gesData[0];

  const iExpId      = expHeaders.indexOf('ID_EXPEDIENTE');
  const iFechaUlt   = expHeaders.indexOf('FECHA_ULTIMA_GESTION');
  const iResUlt     = expHeaders.indexOf('RESULTADO_ULTIMA_GESTION');

  const iGesExpId   = gesHeaders.indexOf('ID_EXPEDIENTE');
  const iGesDate    = gesHeaders.indexOf('FECHA_REGISTRO');
  const iGesResult  = gesHeaders.indexOf('RESULTADO');

  // Agrupar gestiones por expediente → tomar la más reciente
  const ultimaGestion = {};
  for (let i = 1; i < gesData.length; i++) {
    const id     = gesData[i][iGesExpId];
    const fecha  = gesData[i][iGesDate];
    const result = gesData[i][iGesResult];
    if (!id) continue;
    if (!ultimaGestion[id] || fecha > ultimaGestion[id].fecha) {
      ultimaGestion[id] = { fecha, resultado: result };
    }
  }

  let sinGestion       = 0;
  let desincronizados  = 0;
  let correctos        = 0;

  const problemas = [];

  for (let i = 1; i < expData.length; i++) {
    const id       = expData[i][iExpId];
    const fecSheet = expData[i][iFechaUlt];
    const resSheet = expData[i][iResUlt];
    if (!id) continue;

    const ult = ultimaGestion[id];

    if (!ult) {
      sinGestion++;
      continue;
    }

    const fechaOk    = String(fecSheet).substring(0, 10) === String(ult.fecha).substring(0, 10);
    const resultOk   = resSheet === ult.resultado;

    if (!fechaOk || !resultOk) {
      desincronizados++;
      problemas.push({ id, fecSheet, fecReal: ult.fecha, resSheet, resReal: ult.resultado });
    } else {
      correctos++;
    }
  }

  Logger.log('=== AUDITORÍA SINCRONÍA GESTIONES ===');
  Logger.log('Correctos:        ' + correctos);
  Logger.log('Sin gestión:      ' + sinGestion);
  Logger.log('Desincronizados:  ' + desincronizados);
  if (problemas.length > 0) {
    Logger.log('Detalle problemas:');
    problemas.forEach(p => Logger.log(JSON.stringify(p)));
  }
}
