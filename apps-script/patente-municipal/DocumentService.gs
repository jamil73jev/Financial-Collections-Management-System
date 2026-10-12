/**
 * DocumentService.gs
 * Generación de documentos PDF para SIGECO.
 * Usa DocumentApp + DriveApp — scopes: drive, documents (ya incluidos).
 *
 * Exports:
 *   generarPDFExpediente(token, idExpediente) → { ok, url, nombre }
 *   generarCartaCobro(token, idExpediente)     → { ok, url, nombre }
 */

// ============================================================
// REPORTE COMPLETO DEL EXPEDIENTE
// ============================================================

function generarPDFExpediente(token, idExpediente) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    // ── Obtener datos ─────────────────────────────────────────
    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
    const exp = expedientes.find(e => e.ID_EXPEDIENTE === idExpediente);
    if (!exp) return { ok: false, error: 'Expediente no encontrado: ' + idExpediente };

    const gestiones = getDataAsObjects(SHEET_NAMES.GESTIONES)
      .filter(g => g.ID_EXPEDIENTE === idExpediente)
      .sort((a, b) => (new Date(b.TIMESTAMP || 0)) - (new Date(a.TIMESTAMP || 0)))
      .slice(0, 25);

    const municipio = getConfig('NOMBRE_MUNICIPIO', 'Municipio');
    const area      = getConfig('AREA_RESPONSABLE', 'Rentas');
    const ahora     = new Date();
    const fechaFmt  = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'dd/MM/yyyy HH:mm');

    // ── Crear Google Doc temporal ─────────────────────────────
    const docNombre = 'SIGECO_RPT_' + idExpediente + '_' + ahora.getTime();
    const doc  = DocumentApp.create(docNombre);
    const body = doc.getBody();

    // Márgenes
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(54).setMarginRight(54);

    // Encabezado
    const pTitulo = body.appendParagraph(municipio.toUpperCase());
    pTitulo.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    pTitulo.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    pTitulo.editAsText().setForegroundColor('#1a237e').setBold(true);

    const pSub = body.appendParagraph(area + ' — REPORTE DE EXPEDIENTE');
    pSub.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    pSub.editAsText().setForegroundColor('#555555');

    body.appendParagraph('Generado: ' + fechaFmt + '  |  Sistema: SIGECO v' + PARAMS.VERSION_SISTEMA)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setForegroundColor('#999999').setFontSize(9);

    body.appendHorizontalRule();

    // Datos del expediente
    _docAppendSectionTitle(body, 'DATOS DEL EXPEDIENTE');
    _docAppendTable(body, [
      ['ID Expediente',       exp.ID_EXPEDIENTE || ''],
      ['Contribuyente',       exp.CONTRIBUYENTE || ''],
      ['RUC',                 exp.RUC || ''],
      ['Tipo de Obligación',  (exp.TIPO_OBLIGACION || '').replace(/_/g, ' ')],
      ['Estado',              (exp.ESTADO_EXPEDIENTE || '').replace(/_/g, ' ')],
      ['Prioridad',           exp.PRIORIDAD || ''],
      ['Gestor Asignado',     exp.FUNCIONARIO_ASIGNADO || ''],
      ['Fecha Asignación',    _docFmtFecha(exp.FECHA_ASIGNACION)],
      ['Última Gestión',      _docFmtFecha(exp.FECHA_ULTIMA_GESTION)],
      ['Próxima Gestión',     _docFmtFecha(exp.FECHA_PROXIMA_GESTION)],
      ['Alerta',              exp.ALERTA_ESTADO || 'OK'],
      ['Días sin movimiento', String(exp.DIAS_SIN_MOVIMIENTO || 0)],
    ]);

    // Deuda
    _docAppendSectionTitle(body, 'DESGLOSE DE DEUDA');
    _docAppendTable(body, [
      ['Impuesto',  _docFmtMonto(exp.VALOR_IMPUESTO)],
      ['Interés',   _docFmtMonto(exp.VALOR_INTERES)],
      ['Multa',     _docFmtMonto(exp.VALOR_MULTA)],
      ['Recargo',   _docFmtMonto(exp.VALOR_RECARGO)],
      ['TOTAL',     _docFmtMonto(exp.TOTAL_DEUDA)],
    ]);
    // TOTAL en negrita
    const tablaDeuda = body.getTables()[body.getTables().length - 1];
    const filaTotal  = tablaDeuda.getRow(tablaDeuda.getNumRows() - 1);
    filaTotal.getCell(0).editAsText().setBold(true);
    filaTotal.getCell(1).editAsText().setBold(true).setForegroundColor('#1a237e');

    // Observación general
    if (exp.OBSERVACION_GENERAL) {
      _docAppendSectionTitle(body, 'OBSERVACIÓN GENERAL');
      body.appendParagraph(String(exp.OBSERVACION_GENERAL))
        .editAsText().setFontSize(10).setForegroundColor('#333333');
    }

    // Historial de gestiones
    _docAppendSectionTitle(body, 'HISTORIAL DE GESTIONES (' + gestiones.length + ')');
    if (gestiones.length > 0) {
      const tablaG = body.appendTable();
      // Cabecera
      const cabG = tablaG.appendTableRow();
      ['Fecha', 'Tipo', 'Resultado', 'Funcionario', 'Observación'].forEach(h => {
        const cell = cabG.appendTableCell(h);
        cell.setBackgroundColor('#1a237e');
        cell.editAsText().setForegroundColor('#ffffff').setBold(true).setFontSize(9);
      });
      // Filas
      gestiones.forEach(g => {
        const row = tablaG.appendTableRow();
        [
          _docFmtFecha(g.FECHA_REGISTRO),
          (g.TIPO_GESTION || '').replace(/_/g, ' '),
          (g.RESULTADO || '').replace(/_/g, ' '),
          g.FUNCIONARIO || '',
          g.OBSERVACION || ''
        ].forEach(val => {
          row.appendTableCell(val).editAsText().setFontSize(9);
        });
      });
    } else {
      body.appendParagraph('Sin gestiones registradas.')
        .editAsText().setItalic(true).setForegroundColor('#999999');
    }

    // Pie de página
    body.appendHorizontalRule();
    body.appendParagraph('Documento generado automáticamente por SIGECO — ' + municipio + ' · ' + fechaFmt)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setFontSize(8).setForegroundColor('#aaaaaa');

    doc.saveAndClose();

    // ── Exportar como PDF ─────────────────────────────────────
    const pdfBlob = DriveApp.getFileById(doc.getId())
      .getAs(MimeType.PDF)
      .setName('EXP_' + idExpediente + '.pdf');

    const carpeta  = _docObtenerCarpeta();
    const pdfFile  = carpeta.createFile(pdfBlob);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Eliminar doc temporal
    DriveApp.getFileById(doc.getId()).setTrashed(true);

    logAction({
      token,
      hoja:         SHEET_NAMES.EXPEDIENTES,
      idExpediente,
      accion:       'GENERAR_PDF_EXPEDIENTE',
      contexto:     pdfFile.getUrl(),
      origen:       'DocumentService.gs'
    });

    return { ok: true, url: pdfFile.getUrl(), nombre: pdfFile.getName() };

  } catch (err) {
    Logger.log('generarPDFExpediente ERROR: ' + err.message + '\n' + err.stack);
    return { ok: false, error: 'Error generando PDF: ' + err.message };
  }
}

// ============================================================
// CARTA FORMAL DE COBRO
// ============================================================

function generarCartaCobro(token, idExpediente) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES);
    const exp = expedientes.find(e => e.ID_EXPEDIENTE === idExpediente);
    if (!exp) return { ok: false, error: 'Expediente no encontrado: ' + idExpediente };

    // Obtener datos del contribuyente
    const contribuyentes = getDataAsObjects(SHEET_NAMES.CONTRIBUYENTES);
    const contrib = contribuyentes.find(c => String(c.RUC || '').trim() === String(exp.RUC || '').trim()) || {};

    const municipio  = getConfig('NOMBRE_MUNICIPIO', 'Municipio');
    const area       = getConfig('AREA_RESPONSABLE', 'Rentas');
    const ahora      = new Date();
    const fechaFmt   = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'dd \'' +
      _docMesTexto(ahora.getMonth()) + '\' \'de\' yyyy');
    const ciudad     = 'Ciudad'; // Se puede agregar a CONFIG

    const docNombre  = 'SIGECO_CARTA_' + idExpediente + '_' + ahora.getTime();
    const doc  = DocumentApp.create(docNombre);
    const body = doc.getBody();

    body.setMarginTop(72).setMarginBottom(54).setMarginLeft(72).setMarginRight(72);

    // Encabezado institucional
    const pInst = body.appendParagraph(municipio.toUpperCase());
    pInst.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    pInst.editAsText().setBold(true).setFontSize(14).setForegroundColor('#1a237e');

    body.appendParagraph(area)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setFontSize(11).setForegroundColor('#555555');

    body.appendParagraph(' ');

    // Número de oficio y fecha
    body.appendParagraph('Oficio N° ' + idExpediente)
      .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
      .editAsText().setFontSize(11);
    body.appendParagraph(ciudad + ', ' + fechaFmt)
      .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
      .editAsText().setFontSize(11);

    body.appendParagraph(' ');

    // Destinatario
    body.appendParagraph('Señor(a):')
      .editAsText().setFontSize(11);
    body.appendParagraph(exp.CONTRIBUYENTE || 'CONTRIBUYENTE')
      .editAsText().setBold(true).setFontSize(12);
    body.appendParagraph('RUC/CI: ' + (exp.RUC || ''))
      .editAsText().setFontSize(11);
    if (contrib.CORREO_GESTION) {
      body.appendParagraph('Correo: ' + contrib.CORREO_GESTION)
        .editAsText().setFontSize(11);
    }
    if (contrib.TELEFONO_GESTION) {
      body.appendParagraph('Teléfono: ' + contrib.TELEFONO_GESTION)
        .editAsText().setFontSize(11);
    }
    body.appendParagraph('Presente.-').editAsText().setFontSize(11);

    body.appendParagraph(' ');

    // Asunto
    const pAsunto = body.appendParagraph('ASUNTO: NOTIFICACIÓN DE OBLIGACIÓN TRIBUTARIA PENDIENTE');
    pAsunto.editAsText().setBold(true).setFontSize(11);

    body.appendParagraph(' ');

    // Cuerpo de la carta
    const totalDeuda = _docFmtMonto(exp.TOTAL_DEUDA);
    const cuerpo = 'De mi consideración:\n\n' +
      'Por medio de la presente, el ' + area + ' del ' + municipio +
      ' le notifica que usted mantiene una obligación tributaria pendiente de pago ' +
      'correspondiente a ' + (exp.TIPO_OBLIGACION || '').replace(/_/g, ' ') + '.\n\n' +
      'Los valores adeudados son los siguientes:';
    body.appendParagraph(cuerpo).editAsText().setFontSize(11);

    body.appendParagraph(' ');

    // Tabla de deuda
    const tablaD = body.appendTable();
    [
      ['CONCEPTO', 'VALOR'],
      ['Impuesto',           _docFmtMonto(exp.VALOR_IMPUESTO)],
      ['Intereses',          _docFmtMonto(exp.VALOR_INTERES)],
      ['Multas',             _docFmtMonto(exp.VALOR_MULTA)],
      ['Recargos',           _docFmtMonto(exp.VALOR_RECARGO)],
      ['TOTAL A CANCELAR',   totalDeuda],
    ].forEach(([concepto, valor], idx) => {
      const row = tablaD.appendTableRow();
      const c1 = row.appendTableCell(concepto);
      const c2 = row.appendTableCell(valor);
      if (idx === 0 || idx === 5) {
        [c1, c2].forEach(c => {
          c.setBackgroundColor(idx === 0 ? '#1a237e' : '#e3f2fd');
          c.editAsText().setBold(true)
            .setForegroundColor(idx === 0 ? '#ffffff' : '#1a237e').setFontSize(11);
        });
      } else {
        [c1, c2].forEach(c => c.editAsText().setFontSize(11));
      }
    });

    body.appendParagraph(' ');

    // Texto de cierre
    const cierre = 'Le comunicamos que tiene un plazo de CINCO (5) días hábiles, ' +
      'contados desde la recepción de esta notificación, para regularizar su situación ' +
      'tributaria. De no hacerlo, el ' + municipio + ' procederá con las acciones de ' +
      'cobro coactivo que la ley faculta.\n\n' +
      'Para mayor información o para coordinar un plan de pago, comuníquese con ' +
      'nuestra oficina de ' + area + '.\n\n' +
      'Atentamente,';
    body.appendParagraph(cierre).editAsText().setFontSize(11);

    body.appendParagraph(' ');
    body.appendParagraph(' ');
    body.appendParagraph('_________________________________')
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph('Director/a de ' + area)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setBold(true).setFontSize(11);
    body.appendParagraph(municipio)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setFontSize(11).setForegroundColor('#555555');

    doc.saveAndClose();

    // ── Exportar como PDF ─────────────────────────────────────
    const pdfBlob = DriveApp.getFileById(doc.getId())
      .getAs(MimeType.PDF)
      .setName('CARTA_COBRO_' + idExpediente + '.pdf');

    const carpeta  = _docObtenerCarpeta();
    const pdfFile  = carpeta.createFile(pdfBlob);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    DriveApp.getFileById(doc.getId()).setTrashed(true);

    logAction({
      token,
      hoja:         SHEET_NAMES.EXPEDIENTES,
      idExpediente,
      accion:       'GENERAR_CARTA_COBRO',
      contexto:     pdfFile.getUrl(),
      origen:       'DocumentService.gs'
    });

    return { ok: true, url: pdfFile.getUrl(), nombre: pdfFile.getName() };

  } catch (err) {
    Logger.log('generarCartaCobro ERROR: ' + err.message + '\n' + err.stack);
    return { ok: false, error: 'Error generando carta: ' + err.message };
  }
}

// ============================================================
// FUNCIONES PRIVADAS
// ============================================================

function _docObtenerCarpeta() {
  const nombreBase = 'SIGECO_DOCUMENTOS';
  const ahora = new Date();
  const anio  = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyy');
  const mes   = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'MM');

  // Buscar o crear carpeta raíz
  let raiz;
  const iter = DriveApp.getFoldersByName(nombreBase);
  raiz = iter.hasNext() ? iter.next() : DriveApp.createFolder(nombreBase);

  // Sub-carpeta año
  let carpetaAnio;
  const iterA = raiz.getFoldersByName(anio);
  carpetaAnio = iterA.hasNext() ? iterA.next() : raiz.createFolder(anio);

  // Sub-carpeta mes
  const iterM = carpetaAnio.getFoldersByName(mes);
  return iterM.hasNext() ? iterM.next() : carpetaAnio.createFolder(mes);
}

function _docAppendSectionTitle(body, titulo) {
  const p = body.appendParagraph(titulo);
  p.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  p.editAsText().setForegroundColor('#1a237e').setBold(true).setFontSize(11);
}

function _docAppendTable(body, filas) {
  const tabla = body.appendTable();
  filas.forEach(([label, valor]) => {
    const row  = tabla.appendTableRow();
    const cell1 = row.appendTableCell(label);
    const cell2 = row.appendTableCell(String(valor || ''));
    cell1.editAsText().setBold(true).setForegroundColor('#555555').setFontSize(10);
    cell2.editAsText().setFontSize(10);
    cell1.setWidth(180);
  });
}

function _docFmtFecha(val) {
  if (!val) return '—';
  return String(val).substring(0, 10);
}

function _docFmtMonto(valor) {
  const n = parseFloat(valor) || 0;
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '$ ' + parts.join('.');
}

function _docMesTexto(mesIdx) {
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
                  'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return meses[mesIdx] || '';
}
