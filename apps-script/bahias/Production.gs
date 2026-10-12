/**
 * Importación productiva, idempotente y auditable de BASE BAHIA.
 * La hoja staging conserva los encabezados originales del Excel.
 */

const IMPORT_REQUIRED_FIELDS_ = [
  'RUC', 'NOMBRE_CONTRIBUYENTE', 'NO_DE_PUESTO',
  'TIPO_IMPUESTO', 'PERIODO_DESDE', 'PERIODO_HASTA'
];

const IMPORT_HEADER_MAP_ = {
  CATEGORIA_TIPO_MERCADO: 'CATEGORIA_TIPO_MERCADO',
  MERCADO_SECTOR: 'MERCADO_SECTOR',
  ASOCIACION: 'ASOCIACION',
  NO_DE_PUESTO: 'NO_DE_PUESTO',
  GIRO_DEL_NEGOCIO: 'GIRO_DEL_NEGOCIO',
  IDENTIFICACION: 'RUC',
  RUC: 'RUC',
  COMERCIANTE: 'NOMBRE_CONTRIBUYENTE',
  NOMBRE_CONTRIBUYENTE: 'NOMBRE_CONTRIBUYENTE',
  CORREOS: 'CORREO_GESTION',
  CORREO_GESTION: 'CORREO_GESTION',
  CELULARES: 'TELEFONO_GESTION',
  TELEFONO_GESTION: 'TELEFONO_GESTION',
  TELEFONOSDOMICILIO: 'TELEFONO_GESTION2',
  TELEFONO_GESTION2: 'TELEFONO_GESTION2',
  DETALLECONTACTOS: 'DETALLE_CONTACTOS',
  DETALLE_CONTACTOS: 'DETALLE_CONTACTOS',
  ESTADO_COMERCIANTE: 'ESTADO_COMERCIANTE',
  PERIODO_DESDE: 'PERIODO_DESDE',
  PERIODO_HASTA: 'PERIODO_HASTA',
  ESTADO_DE_DEUDA: 'ESTADO_DE_DEUDA',
  TIPO_DE_RUBRO: 'TIPO_IMPUESTO',
  TIPO_IMPUESTO: 'TIPO_IMPUESTO',
  TOTAL_DE_DEUDA: 'TOTAL_DEUDA',
  TOTAL_DEUDA: 'TOTAL_DEUDA',
  TOTAL_POR_COBRAR: 'TOTAL_POR_COBRAR',
  CODIGO_CEP: 'CODIGO_CEP'
};

function setupProductionImportSheet_(token) {
  const acceso = checkAccess_(token, 'IMPORTAR_CONTRIBUYENTES');
  if (!acceso.ok) return acceso;

  const ss = getSpreadsheet_();
  [SHEET_NAMES.IMPORT_CONTRIBUYENTES, SHEET_NAMES.IMPORT_REPORTE].forEach(nombre => {
    let hoja = ss.getSheetByName(nombre);
    if (!hoja) hoja = ss.insertSheet(nombre);
    const key = Object.keys(SHEET_NAMES).find(k => SHEET_NAMES[k] === nombre);
    const headers = HEADERS[key];
    hoja.getRange(1, 1, 1, headers.length).setValues([headers]);
    hoja.getRange(1, 1, 1, headers.length)
      .setBackground('#1b5e20').setFontColor('#ffffff').setFontWeight('bold');
    hoja.setFrozenRows(1);
  });
  return { ok: true, mensaje: 'Hojas de importación productiva preparadas.' };
}

function previewContribuyentesImport_(token) {
  const acceso = checkAccess_(token, 'IMPORTAR_CONTRIBUYENTES');
  if (!acceso.ok) return acceso;

  try {
    const analysis = _analyzeProductionImport_();
    return _publicImportAnalysis_(analysis);
  } catch (err) {
    Logger.log('previewContribuyentesImport_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function commitContribuyentesImport_(token, expectedChecksum) {
  const acceso = checkAccess_(token, 'IMPORTAR_CONTRIBUYENTES');
  if (!acceso.ok) return acceso;
  if (!expectedChecksum) return { ok: false, error: 'Debe ejecutar la vista previa antes de confirmar.' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { ok: false, error: 'Existe otra importación en curso. Intente nuevamente.' };
  }

  try {
    const analysis = _analyzeProductionImport_();
    if (analysis.checksum !== expectedChecksum) {
      return { ok: false, error: 'La hoja staging cambió después de la vista previa.' };
    }
    if (analysis.conflicts.length > 0) {
      return { ok: false, error: 'Existen claves duplicadas con datos incompatibles.', conflictos: analysis.conflicts };
    }
    if (analysis.accepted.length === 0) {
      return { ok: false, error: 'No existen filas válidas para importar.' };
    }

    const backupUrl = _createPreImportBackup_(analysis.checksum);
    const contribResult = _upsertContribuyentes_(analysis.accepted);
    const expResult = _upsertImportExpedientes_(analysis.accepted);
    let assignmentResult;
    try {
      assignmentResult = autoAssignExpedientes_(token, 100000);
    } catch (assignmentError) {
      Logger.log('Asignación posterior a importación ERROR: ' + assignmentError.message);
      assignmentResult = {
        ok: false,
        asignados: 0,
        error: assignmentError.message
      };
    }
    _writeImportReport_(analysis);

    if (typeof invalidarCacheMaestro_ === 'function') invalidarCacheMaestro_();
    if (typeof invalidarCacheDashboard_ === 'function') invalidarCacheDashboard_();

    logAction_({
      token,
      hoja: SHEET_NAMES.CONTRIBUYENTES,
      accion: 'IMPORTACION_PRODUCTIVA',
      contexto:
        'Checksum: ' + analysis.checksum +
        ' | Aceptadas: ' + analysis.accepted.length +
        ' | Insertadas: ' + contribResult.inserted +
        ' | Actualizadas: ' + contribResult.updated +
        ' | Expedientes creados: ' + expResult.created +
        ' | Expedientes asignados: ' + (assignmentResult.asignados || 0),
      origen: 'ProductionImportService.gs'
    });

    return {
      ok: true,
      checksum: analysis.checksum,
      sourceRows: analysis.sourceRows,
      accepted: analysis.accepted.length,
      duplicates: analysis.duplicates.length,
      rejected: analysis.rejected.length,
      generatedIdentities: analysis.generatedIdentities.length,
      contribuyentes: contribResult,
      expedientes: expResult,
      asignacion: assignmentResult,
      backupUrl
    };
  } catch (err) {
    Logger.log('commitContribuyentesImport_ ERROR: ' + err.message + '\n' + err.stack);
    return { ok: false, error: 'La importación no pudo completarse. Restaure el respaldo previo si hubo escrituras parciales.' };
  } finally {
    lock.releaseLock();
  }
}

function _analyzeProductionImport_() {
  const hoja = getHoja_(SHEET_NAMES.IMPORT_CONTRIBUYENTES);
  const values = hoja.getDataRange().getValues();
  if (values.length < 2) throw new Error('La hoja staging no contiene filas de datos.');

  const headers = values[0].map(_normalizeImportHeader_);
  const mappedHeaders = headers.map(h => IMPORT_HEADER_MAP_[h] || '');
  IMPORT_REQUIRED_FIELDS_.forEach(required => {
    if (!mappedHeaders.includes(required)) {
      throw new Error('Falta la columna requerida: ' + required);
    }
  });

  const source = values.slice(1).filter(row => row.some(v => v !== '' && v !== null));
  const checksum = _importChecksum_([values[0]].concat(source));
  const accepted = [];
  const rejected = [];
  const duplicates = [];
  const conflicts = [];
  const generatedIdentities = [];
  const exactSeen = {};
  const keySeen = {};

  source.forEach((row, index) => {
    const record = {};
    mappedHeaders.forEach((mapped, col) => {
      if (mapped) record[mapped] = _normalizeImportValue_(mapped, row[col]);
    });
    HEADERS.CONTRIBUYENTES.forEach(h => {
      if (record[h] === undefined) record[h] = '';
    });
    record.FECHA_CARGA = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
    const identityGenerated = _ensureImportIdentity_(record);

    const sourceRow = index + 2;
    const signature = HEADERS.CONTRIBUYENTES
      .filter(h => h !== 'FECHA_CARGA')
      .map(h => _stableImportValue_(record[h])).join('\u001f');

    if (exactSeen[signature]) {
      duplicates.push({
        fila: sourceRow,
        identificacion: record.RUC,
        detalle: 'Duplicado exacto de la fila ' + exactSeen[signature]
      });
      return;
    }
    exactSeen[signature] = sourceRow;

    const errors = _validateImportRecord_(record);
    if (errors.length) {
      rejected.push({
        fila: sourceRow,
        identificacion: record.RUC,
        detalle: errors.join('; ')
      });
      return;
    }

    const businessKey = _obligationKey_(record);
    if (keySeen[businessKey] && keySeen[businessKey].signature !== signature) {
      conflicts.push({
        fila: sourceRow,
        filaAnterior: keySeen[businessKey].row,
        identificacion: record.RUC,
        detalle: 'Misma clave de obligación con valores distintos.'
      });
      return;
    }
    keySeen[businessKey] = { row: sourceRow, signature };
    accepted.push({ sourceRow, businessKey, record, identityGenerated });
    if (identityGenerated) {
      generatedIdentities.push({
        fila: sourceRow,
        identificacion: record.RUC,
        detalle: 'Identificador interno generado por ausencia de cédula/RUC.'
      });
    }
  });

  const uniqueRucs = new Set(accepted.map(item => item.record.RUC));
  return {
    checksum,
    sourceRows: source.length,
    accepted,
    rejected,
    duplicates,
    conflicts,
    generatedIdentities,
    uniqueContribuyentes: uniqueRucs.size
  };
}

function _publicImportAnalysis_(analysis) {
  return {
    ok: analysis.conflicts.length === 0,
    checksum: analysis.checksum,
    sourceRows: analysis.sourceRows,
    accepted: analysis.accepted.length,
    duplicates: analysis.duplicates.length,
    rejected: analysis.rejected.length,
    conflicts: analysis.conflicts.length,
    generatedIdentities: analysis.generatedIdentities.length,
    uniqueContribuyentes: analysis.uniqueContribuyentes,
    detalleRechazos: analysis.rejected.concat(analysis.duplicates, analysis.conflicts),
    detalleAdvertencias: analysis.generatedIdentities
  };
}

function _validateImportRecord_(record) {
  const errors = [];
  IMPORT_REQUIRED_FIELDS_.forEach(field => {
    if (_stableImportValue_(record[field]) === '') errors.push(field + ' vacío');
  });
  if (record.RUC &&
      !/^\d{10}(\d{3})?$/.test(String(record.RUC)) &&
      !/^SINID-[A-F0-9]{16}$/.test(String(record.RUC))) {
    errors.push('Identificación debe contener 10 o 13 dígitos');
  }
  if (record.TOTAL_DEUDA < 0 || record.TOTAL_POR_COBRAR < 0) {
    errors.push('Los montos no pueden ser negativos');
  }
  return errors;
}

function _normalizeImportHeader_(value) {
  return String(value || '').trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function _normalizeImportValue_(field, value) {
  if (field === 'TOTAL_DEUDA' || field === 'TOTAL_POR_COBRAR') {
    return _parseImportAmount_(value);
  }
  if (field === 'PERIODO_DESDE' || field === 'PERIODO_HASTA') {
    if (value instanceof Date) {
      return Utilities.formatDate(value, PARAMS.TIMEZONE, 'yyyy-MM-dd');
    }
  }
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (field === 'RUC') {
    let digits = text.replace(/\D/g, '');
    if (digits.length === 9) digits = '0' + digits;
    if (digits.length === 12) digits = '0' + digits;
    return /^\d{10}(\d{3})?$/.test(digits) ? digits : '';
  }
  if (field === 'TIPO_IMPUESTO') return text.toUpperCase();
  return text;
}

function _ensureImportIdentity_(record) {
  if (/^\d{10}(\d{3})?$/.test(String(record.RUC || ''))) return false;
  const identitySeed = [
    record.NOMBRE_CONTRIBUYENTE,
    record.CATEGORIA_TIPO_MERCADO,
    record.MERCADO_SECTOR,
    record.ASOCIACION,
    record.NO_DE_PUESTO
  ].map(v => _normalizeImportHeader_(v)).join('|');
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    identitySeed,
    Utilities.Charset.UTF_8
  );
  const hex = digest.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('').toUpperCase();
  record.RUC = 'SINID-' + hex.substring(0, 16);
  return true;
}

function _parseImportAmount_(value) {
  if (typeof value === 'number') return value;
  let text = String(value === null || value === undefined ? '' : value)
    .trim().replace(/[^0-9,.-]/g, '');
  if (!text) return 0;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (comma >= 0) {
    text = text.replace(',', '.');
  }
  const parsed = parseFloat(text);
  return isNaN(parsed) ? 0 : parsed;
}

function _stableImportValue_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, PARAMS.TIMEZONE, 'yyyy-MM-dd');
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  return String(value === null || value === undefined ? '' : value).trim();
}

function _obligationKey_(record) {
  return [
    record.RUC,
    record.TIPO_IMPUESTO,
    record.NO_DE_PUESTO,
    record.PERIODO_DESDE,
    record.PERIODO_HASTA
  ].map(v => _stableImportValue_(v).toUpperCase()).join('|');
}

function _importChecksum_(rows) {
  const canonical = rows.map(row => row.map(_stableImportValue_).join('\u001f')).join('\u001e');
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    canonical,
    Utilities.Charset.UTF_8
  );
  return digest.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function _upsertContribuyentes_(accepted) {
  const existing = getDataAsObjects_(SHEET_NAMES.CONTRIBUYENTES);
  const finalRows = existing.map(obj => HEADERS.CONTRIBUYENTES.map(h => obj[h] === undefined ? '' : obj[h]));
  const indexByKey = {};
  existing.forEach((obj, index) => {
    const key = _obligationKey_(obj);
    if (key.replace(/\|/g, '')) indexByKey[key] = index;
  });

  let inserted = 0;
  let updated = 0;
  accepted.forEach(item => {
    const row = HEADERS.CONTRIBUYENTES.map(h => item.record[h] === undefined ? '' : item.record[h]);
    if (indexByKey[item.businessKey] !== undefined) {
      finalRows[indexByKey[item.businessKey]] = row;
      updated++;
    } else {
      indexByKey[item.businessKey] = finalRows.length;
      finalRows.push(row);
      inserted++;
    }
  });

  overwriteDataSection_(SHEET_NAMES.CONTRIBUYENTES, finalRows);
  return { inserted, updated, total: finalRows.length };
}

function _upsertImportExpedientes_(accepted) {
  const grouped = {};
  accepted.forEach(item => {
    const r = item.record;
    if (!grouped[r.RUC]) {
      grouped[r.RUC] = {
        ruc: r.RUC,
        nombre: r.NOMBRE_CONTRIBUYENTE,
        rows: [],
        rubros: new Set(),
        totalDeuda: 0,
        totalPorCobrar: 0
      };
    }
    grouped[r.RUC].rows.push(r);
    grouped[r.RUC].rubros.add(_mapImportObligation_(r.TIPO_IMPUESTO));
    grouped[r.RUC].totalDeuda += Number(r.TOTAL_DEUDA) || 0;
    grouped[r.RUC].totalPorCobrar += Number(r.TOTAL_POR_COBRAR) || 0;
  });

  const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
  const activeByRuc = {};
  expedientes.forEach(exp => {
    if ((exp.ACTIVO === true || exp.ACTIVO === 'TRUE') && exp.RUC) {
      activeByRuc[String(exp.RUC).trim()] = exp;
    }
  });

  let nextCode = expedientes.reduce((max, exp) => {
    const value = parseInt(exp.CODIGO_INTERNO, 10);
    return isNaN(value) ? max : Math.max(max, value);
  }, 0) + 1;
  const now = new Date();
  const month = Utilities.formatDate(now, PARAMS.TIMEZONE, 'yyyyMM');
  const timestamp = Utilities.formatDate(now, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const newRows = [];
  const updates = [];

  Object.keys(grouped).sort().forEach(ruc => {
    const group = grouped[ruc];
    const first = group.rows[0];
    const rubros = Array.from(group.rubros).filter(Boolean);
    const tipoObligacion = rubros.length > 1 ? 'MULTIPLE' : (rubros[0] || 'MULTIPLE');
    const existing = activeByRuc[ruc];
    const priority = _importPriority_(group.totalDeuda);

    if (existing) {
      const paid = Number(existing.MONTO_PAGADO) || 0;
      updates.push({
        rowIndex: existing._rowIndex,
        campos: {
          CONTRIBUYENTE: group.nombre,
          TIPO_OBLIGACION: tipoObligacion,
          PRIORIDAD: priority,
          TOTAL_DEUDA: group.totalDeuda,
          TOTAL_POR_COBRAR: group.totalPorCobrar,
          SALDO_PENDIENTE: Math.max(group.totalPorCobrar - paid, 0),
          CATEGORIA_TIPO_MERCADO: first.CATEGORIA_TIPO_MERCADO,
          MERCADO_SECTOR: first.MERCADO_SECTOR,
          ASOCIACION: first.ASOCIACION,
          NO_DE_PUESTO: first.NO_DE_PUESTO,
          GIRO_DEL_NEGOCIO: first.GIRO_DEL_NEGOCIO,
          ESTADO_COMERCIANTE: first.ESTADO_COMERCIANTE,
          PERIODO_DESDE: first.PERIODO_DESDE,
          PERIODO_HASTA: first.PERIODO_HASTA,
          ESTADO_DE_DEUDA: first.ESTADO_DE_DEUDA,
          CODIGO_CEP: first.CODIGO_CEP
        }
      });
      return;
    }

    const code = nextCode++;
    const values = {
      ID_EXPEDIENTE: 'EXP-' + month + '-' + String(code).padStart(4, '0'),
      CODIGO_INTERNO: code,
      RUC: ruc,
      CONTRIBUYENTE: group.nombre,
      TIPO_PERSONA: ruc.indexOf('SINID-') === 0
        ? 'SIN_IDENTIFICACION'
        : (ruc.length === 13 ? 'JURIDICA' : 'NATURAL'),
      TIPO_OBLIGACION: tipoObligacion,
      ESTADO_EXPEDIENTE: 'PENDIENTE_ASIGNACION',
      PRIORIDAD: priority,
      FUNCIONARIO_ASIGNADO: '',
      FECHA_ASIGNACION: '',
      DIAS_SIN_MOVIMIENTO: 0,
      OBSERVACION_GENERAL:
        'Carga productiva BASE BAHIA ' + timestamp +
        (ruc.indexOf('SINID-') === 0 ? ' | Requiere completar identificación' : ''),
      ALERTA_ESTADO: 'OK',
      ACTIVO: 'TRUE',
      TOTAL_DEUDA: group.totalDeuda,
      MONTO_PAGADO: 0,
      SALDO_PENDIENTE: group.totalPorCobrar,
      PORCENTAJE_RECUPERADO: 0,
      CATEGORIA_TIPO_MERCADO: first.CATEGORIA_TIPO_MERCADO,
      MERCADO_SECTOR: first.MERCADO_SECTOR,
      ASOCIACION: first.ASOCIACION,
      NO_DE_PUESTO: first.NO_DE_PUESTO,
      GIRO_DEL_NEGOCIO: first.GIRO_DEL_NEGOCIO,
      ESTADO_COMERCIANTE: first.ESTADO_COMERCIANTE,
      PERIODO_DESDE: first.PERIODO_DESDE,
      PERIODO_HASTA: first.PERIODO_HASTA,
      ESTADO_DE_DEUDA: first.ESTADO_DE_DEUDA,
      TOTAL_POR_COBRAR: group.totalPorCobrar,
      CODIGO_CEP: first.CODIGO_CEP
    };
    newRows.push(HEADERS.EXPEDIENTES.map(h => values[h] === undefined ? '' : values[h]));
  });

  if (updates.length) batchUpdateRows_(SHEET_NAMES.EXPEDIENTES, updates);
  if (newRows.length) {
    const hoja = getHoja_(SHEET_NAMES.EXPEDIENTES);
    hoja.getRange(hoja.getLastRow() + 1, 1, newRows.length, HEADERS.EXPEDIENTES.length)
      .setValues(newRows);
  }
  return { created: newRows.length, updated: updates.length, totalSourceContribuyentes: Object.keys(grouped).length };
}

function _mapImportObligation_(value) {
  const normalized = _normalizeImportHeader_(value);
  if (normalized === 'TASAS_POR_CREDENCIALES') return 'TASA_CREDENCIALES';
  if (normalized === 'TASAS_POR_OCUPACION_PUESTOS') return 'TASA_OCUPACION_PUESTOS';
  return 'MULTIPLE';
}

function _importPriority_(amount) {
  const value = Number(amount) || 0;
  if (value >= 50000) return 'CRITICA';
  if (value >= 10000) return 'ALTA';
  if (value >= 1000) return 'MEDIA';
  return 'BAJA';
}

function _createPreImportBackup_(checksum) {
  const ss = getSpreadsheet_();
  const source = DriveApp.getFileById(ss.getId());
  const parents = source.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folders = parent.getFoldersByName('SIGECO_BACKUPS');
  const backupFolder = folders.hasNext() ? folders.next() : parent.createFolder('SIGECO_BACKUPS');
  const stamp = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, 'yyyyMMdd_HHmmss');
  const copy = source.makeCopy(ss.getName() + '_PREIMPORT_' + stamp + '_' + checksum.substring(0, 8), backupFolder);
  return copy.getUrl();
}

function _writeImportReport_(analysis) {
  const hoja = getHoja_(SHEET_NAMES.IMPORT_REPORTE);
  const now = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const rows = [];
  analysis.rejected.forEach(item => rows.push([
    now, analysis.checksum, 'RECHAZADO', item.fila, item.identificacion, item.detalle
  ]));
  analysis.duplicates.forEach(item => rows.push([
    now, analysis.checksum, 'DUPLICADO_EXACTO', item.fila, item.identificacion, item.detalle
  ]));
  analysis.conflicts.forEach(item => rows.push([
    now, analysis.checksum, 'CONFLICTO', item.fila, item.identificacion, item.detalle
  ]));
  analysis.generatedIdentities.forEach(item => rows.push([
    now, analysis.checksum, 'IDENTIDAD_GENERADA', item.fila, item.identificacion, item.detalle
  ]));
  if (rows.length) {
    hoja.getRange(hoja.getLastRow() + 1, 1, rows.length, HEADERS.IMPORT_REPORTE.length)
      .setValues(rows);
  }
}
