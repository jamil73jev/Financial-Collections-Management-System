/**
 * TestData.gs
 * Datos de prueba para validación funcional del sistema SIGECO.
 * Ejecutar desde el editor Apps Script: insertTestData()
 * Para limpiar: clearTestData()
 * Solo ADMINISTRADOR puede ejecutar estas funciones.
 */

const TEST_PREFIX = 'TEST-';

/**
 * Inserta un conjunto completo de datos de prueba.
 * @param {string} token
 */
function insertTestData(token) {
  const acceso = checkAccess(token, 'INSERTAR_DATOS_PRUEBA');
  if (!acceso.ok) return acceso;

  Logger.log('=== Insertando datos de prueba ===');

  try {
    _insertarContribuyentesPrueba();
    _insertarExpedientesPrueba();
    _insertarGestionesPrueba();
    
    logAction({
      token,
      hoja: 'SISTEMA',
      accion: 'INSERTAR_DATOS_PRUEBA',
      contexto: 'Carga masiva de datos de testing'
    });
    
    return { ok: true, mensaje: 'Datos de prueba insertados.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Elimina todos los registros de prueba.
 * @param {string} token
 */
function clearTestData(token) {
  const acceso = checkAccess(token, 'LIMPIAR_DATOS_PRUEBA');
  if (!acceso.ok) return acceso;

  Logger.log('=== Limpiando datos de prueba ===');

  [SHEET_NAMES.CONTRIBUYENTES, SHEET_NAMES.EXPEDIENTES, SHEET_NAMES.GESTIONES].forEach(nombre => {
    const hoja    = getHoja(nombre);
    const datos   = hoja.getDataRange().getValues();
    const headers = datos[0];

    // Buscar columna ID o RUC
    const colId  = headers.indexOf('ID_EXPEDIENTE');
    const colRuc = headers.indexOf('RUC');
    const colGes = headers.indexOf('ID_GESTION');
    const colRef = colId !== -1 ? colId : colRuc !== -1 ? colRuc : colGes;

    if (colRef === -1) return;

    // Marcar filas a eliminar (de abajo hacia arriba para no desplazar índices)
    for (let i = datos.length - 1; i >= 1; i--) {
      const val = String(datos[i][colRef] || '');
      if (val.startsWith(TEST_PREFIX)) {
        hoja.deleteRow(i + 1);
      }
    }
  });

  logAction({
    token,
    hoja: 'SISTEMA',
    accion: 'LIMPIAR_DATOS_PRUEBA',
    contexto: 'Limpieza de registros con prefijo TEST-'
  });

  return { ok: true, mensaje: 'Datos de prueba eliminados.' };
}

// ============================================================
// CONTRIBUYENTES DE PRUEBA (10 registros)
// ============================================================
function _insertarContribuyentesPrueba() {
  const ahora = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const registros = [
    ['0912345678001', 'EMPRESA ABC S.A.',         'J', 'Av. Quito 123', 'abc@empresa.ec',    '0991234567', 'Juan Pérez',   'Comercio al por mayor', 'DEUDOR', 'DEFINITIVA', 1200.00, 80.00, 45.00, 1325.00, '2023', '2023', 'TC-001', 'ACTIVO', ahora],
    ['0923456789001', 'DISTRIBUIDORA XYZ CIA.',   'J', 'Av. 9 de Oct.', 'xyz@dist.ec',       '0992345678', 'María López',  'Distribución',          'DEUDOR', 'DEFINITIVA',  850.00, 55.00, 30.00,  935.00, '2023', '2023', 'TC-002', 'ACTIVO', ahora],
    ['0934567890001', 'CONSTRUCTORA DELTA S.A.',  'J', 'Km 12 Vía Dua', 'delta@const.ec',    '0993456789', 'Carlos Ruiz',  'Construcción',          'DEUDOR', 'DEFINITIVA', 3500.00,200.00,120.00, 3820.00, '2022', '2022', 'TC-003', 'ACTIVO', ahora],
    ['0945678901001', 'FARMACIA SALUD TOTAL',     'J', 'Cdla. Alborada', 'salud@farm.ec',    '0994567890', 'Ana Torres',   'Comercio farma.',       'DEUDOR', 'ANTICIPADA',  320.00, 20.00,  8.00,  348.00, '2023', '2023', 'TC-004', 'ACTIVO', ahora],
    ['0956789012001', 'IMPORTADORA NORTE CIA.',   'J', 'Parq. Industrial','norte@imp.ec',    '0995678901', 'Luis Vera',    'Importación',           'DEUDOR', 'DEFINITIVA', 6200.00,380.00,250.00, 6830.00, '2022', '2022', 'TC-005', 'ACTIVO', ahora],
    ['0901234567890', 'PEDRO ALVARADO MORA',      'N', 'Av. Del Ejército','pedro@mail.com',  '0980123456', '',             'Servicios',             'DEUDOR', 'DEFINITIVA',  450.00, 28.00, 15.00,  493.00, '2023', '2023', 'TC-006', 'ACTIVO', ahora],
    ['0967890123001', 'TECNOLOGÍAS AVANCE S.A.',  'J', 'Av. Francisco', 'avance@tech.ec',   '0997890123', 'Roberto Díaz', 'Tecnología',            'DEUDOR', 'DEFINITIVA', 1800.00,110.00, 70.00, 1980.00, '2023', '2023', 'TC-007', 'ACTIVO', ahora],
    ['0978901234001', 'AGRO CAMPO UNIDO CIA.',    'J', 'Km 45 Via Dur', 'campo@agro.ec',    '0978901234', 'Elena Castro', 'Agricultura',           'DEUDOR', 'DEFINITIVA',  980.00, 60.00, 35.00, 1075.00, '2022', '2022', 'TC-008', 'ACTIVO', ahora],
    ['0989012345001', 'HOTELERÍA CONFORT S.A.',   'J', 'Av. Malecón',   'confort@hotel.ec', '0989012345', 'Marco Flores', 'Hotelería',             'DEUDOR', 'DEFINITIVA', 2200.00,140.00, 88.00, 2428.00, '2022', '2022', 'TC-009', 'ACTIVO', ahora],
    ['0990123456001', 'SEGURIDAD TOTAL CIA.',     'J', 'Ciudadela León', 'total@seg.ec',    '0990123456', 'Patricia Gil', 'Seguridad privada',     'DEUDOR', 'COMPLEMENTARIA', 760.00, 48.00, 25.00, 833.00, '2023', '2023', 'TC-010', 'ACTIVO', ahora]
  ];

  const hoja = getHoja(SHEET_NAMES.CONTRIBUYENTES);
  registros.forEach(fila => appendRow(SHEET_NAMES.CONTRIBUYENTES, fila));
  Logger.log('Contribuyentes de prueba: ' + registros.length);
}

// ============================================================
// EXPEDIENTES DE PRUEBA (15 registros, escenarios variados)
// ============================================================
function _insertarExpedientesPrueba() {
  const ahora      = new Date();
  const hace5d     = _fmtD(new Date(ahora.getTime() - 5  * 86400000));
  const hace15d    = _fmtD(new Date(ahora.getTime() - 15 * 86400000));
  const hace35d    = _fmtD(new Date(ahora.getTime() - 35 * 86400000));
  const hace60d    = _fmtD(new Date(ahora.getTime() - 60 * 86400000));
  const enTresDias = _fmtD(new Date(ahora.getTime() + 3  * 86400000));
  const enUnMes    = _fmtD(new Date(ahora.getTime() + 30 * 86400000));
  const ayer       = _fmtD(new Date(ahora.getTime() - 1  * 86400000));

  const expedientes = [
    // ID_EXPEDIENTE, COD_INTERNO, RUC, CONTRIBUYENTE, TIPO_PERSONA, TIPO_OBLIG, ESTADO, PRIORIDAD,
    // FUNCIONARIO, FECHA_ASIG, FECHA_ULT_GEST, FECHA_PROX_GEST, DIAS_MOV, RESULTADO_ULT,
    // OBSERVACION, ALERTA, ACTIVO, VALOR_IMPUESTO, VALOR_INTERES, VALOR_MULTA, VALOR_RECARGO, TOTAL_DEUDA

    // Escenario 1: Activo, gestión reciente, OK
    [TEST_PREFIX+'EXP-001', 'CI-2023-001', '0912345678001', 'EMPRESA ABC S.A.',        'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'ALTA',   'gestor1@municipio.gob.ec', hace15d, hace5d,  enUnMes,    5,  'CONTACTADO',   'En negociación de pago', 'OK',            'TRUE', 1500.00, 250.00, 0, 100.00, 1850.00],
    // Escenario 2: Sin movimiento > 15 días
    [TEST_PREFIX+'EXP-002', 'CI-2023-002', '0923456789001', 'DISTRIBUIDORA XYZ CIA.',  'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'MEDIA',  'gestor1@municipio.gob.ec', hace35d, hace35d, '',         35, 'SIN_RESPUESTA','Primer intento fallido',  'SIN_MOVIMIENTO','TRUE', 3200.00, 480.00, 0, 200.00, 3880.00],
    // Escenario 3: Vencido (fecha próxima < hoy)
    [TEST_PREFIX+'EXP-003', 'CI-2022-001', '0934567890001', 'CONSTRUCTORA DELTA S.A.', 'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'CRITICA','gestor2@municipio.gob.ec', hace60d, hace15d, ayer,       15, 'RECHAZO',      'Cliente no acepta deuda', 'VENCIDO',       'TRUE', 8500.00, 1700.00, 0, 600.00, 10800.00],
    // Escenario 4: Crítico (> 30 días sin movimiento)
    [TEST_PREFIX+'EXP-004', 'CI-2022-002', '0934567890001', 'CONSTRUCTORA DELTA S.A.', 'JURIDICA', 'IMPUESTO_15_POR_MIL', 'GESTION_PAUSADA',     'CRITICA','gestor2@municipio.gob.ec', hace60d, hace60d, '',         60, 'NO_LOCALIZADO','Direcciones no válidas',  'CRITICO',       'TRUE', 4200.00, 900.00, 0, 350.00, 5450.00],
    // Escenario 5: Próximo a vencer (dentro de 3 días)
    [TEST_PREFIX+'EXP-005', 'CI-2023-003', '0945678901001', 'FARMACIA SALUD TOTAL',    'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'BAJA',   'gestor1@municipio.gob.ec', hace15d, hace5d,  enTresDias, 5,  'CONTACTADO',   'Acordó pago semana próx.','PROXIMO_VENCER','TRUE', 750.00, 90.00, 0, 50.00, 890.00],
    // Escenario 6: Pendiente de asignación
    [TEST_PREFIX+'EXP-006', 'CI-2022-003', '0956789012001', 'IMPORTADORA NORTE CIA.',  'JURIDICA', 'IMPUESTO_15_POR_MIL', 'PENDIENTE_ASIGNACION','CRITICA','',                         hace5d,  '',      '',         0,  '',             'Pendiente asignación gestor', 'OK',          'TRUE', 6100.00, 1100.00, 0, 450.00, 7650.00],
    // Escenario 7: Promesa de pago
    [TEST_PREFIX+'EXP-007', 'CI-2023-004', '0901234567890', 'PEDRO ALVARADO MORA',     'NATURAL',  'IMPUESTO_15_POR_MIL', 'COMPROMETIDO_PAGO',   'MEDIA',  'gestor2@municipio.gob.ec', hace15d, hace5d,  enTresDias, 5,  'PROMESA_PAGO', 'Prometió pago viernes',   'PROXIMO_VENCER','TRUE', 980.00, 140.00, 0, 70.00, 1190.00],
    // Escenario 8: Cerrado exitoso
    [TEST_PREFIX+'EXP-008', 'CI-2023-005', '0967890123001', 'TECNOLOGÍAS AVANCE S.A.', 'JURIDICA', 'IMPUESTO_15_POR_MIL', 'CERRADO_EXITOSO',     'MEDIA',  'gestor1@municipio.gob.ec', hace35d, hace5d,  '',         5,  'PAGO_CONFIRMADO','Pago realizado en caja',  'OK',           'TRUE', 2300.00, 380.00, 0, 160.00, 2840.00],
    // Escenario 9: Gestión activa regular
    [TEST_PREFIX+'EXP-009', 'CI-2022-004', '0978901234001', 'AGRO CAMPO UNIDO CIA.',   'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'ALTA',   'gestor2@municipio.gob.ec', hace35d, hace5d,  enUnMes,    5,  'ACUERDO_PARCIAL','Pago parcial recibido',  'OK',           'TRUE', 5400.00, 950.00, 0, 400.00, 6750.00],
    // Escenario 10: Sin respuesta, prioridad alta
    [TEST_PREFIX+'EXP-010', 'CI-2022-005', '0989012345001', 'HOTELERÍA CONFORT S.A.',  'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'ALTA',   'gestor1@municipio.gob.ec', hace35d, hace15d, '',         15, 'SIN_RESPUESTA','3 intentos sin éxito',   'SIN_MOVIMIENTO','TRUE', 7800.00, 1560.00, 0, 580.00, 9940.00],
    // Escenario 11: Derivado a coactiva
    [TEST_PREFIX+'EXP-011', 'CI-2022-006', '0989012345001', 'HOTELERÍA CONFORT S.A.',  'JURIDICA', 'IMPUESTO_15_POR_MIL', 'DERIVADO_COACTIVA',   'CRITICA','gestor2@municipio.gob.ec', hace60d, hace35d, '',         35, 'DERIVAR_COACTIVA','Derivado por incumplimiento','OK',       'TRUE', 12000.00, 2800.00, 0, 900.00, 15700.00],
    // Escenario 12: Sin movimiento media prioridad
    [TEST_PREFIX+'EXP-012', 'CI-2023-006', '0990123456001', 'SEGURIDAD TOTAL CIA.',    'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'MEDIA',  'gestor2@municipio.gob.ec', hace35d, hace20d, '',         20, 'NO_LOCALIZADO','No contesta teléfono',   'SIN_MOVIMIENTO','TRUE', 1100.00, 165.00, 0, 80.00, 1345.00],
    // Escenario 13: Expediente nuevo
    [TEST_PREFIX+'EXP-013', 'CI-2023-007', '0912345678001', 'EMPRESA ABC S.A.',        'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'BAJA',   'gestor1@municipio.gob.ec', hace5d,  hace5d,  enUnMes,    5,  'CONTACTADO',   'Primera gestión realizada','OK',          'TRUE', 900.00, 110.00, 0, 60.00, 1070.00],
    // Escenario 14: Vencido prioridad crítica
    [TEST_PREFIX+'EXP-014', 'CI-2022-007', '0956789012001', 'IMPORTADORA NORTE CIA.',  'JURIDICA', 'IMPUESTO_15_POR_MIL', 'EN_GESTION',          'CRITICA','gestor2@municipio.gob.ec', hace60d, hace35d, ayer,       35, 'RECHAZO',      'Disputa legal en curso',  'VENCIDO',       'TRUE', 9500.00, 2100.00, 0, 750.00, 12350.00],
    // Escenario 15: Complementario reciente
    [TEST_PREFIX+'EXP-015', 'CI-2023-008', '0990123456001', 'SEGURIDAD TOTAL CIA.',    'JURIDICA', 'IMPUESTO_15_POR_MIL_COMPLEMENTARIO', 'EN_GESTION', 'MEDIA', 'gestor1@municipio.gob.ec', hace5d, hace5d, enUnMes, 5, 'CONTACTADO', 'Declaración complementaria', 'OK', 'TRUE', 1800.00, 270.00, 0, 120.00, 2190.00]
  ];

  expedientes.forEach(fila => appendRow(SHEET_NAMES.EXPEDIENTES, fila));
  Logger.log('Expedientes de prueba: ' + expedientes.length);
}

// ============================================================
// GESTIONES DE PRUEBA (30 registros)
// ============================================================
function _insertarGestionesPrueba() {
  const ahora   = new Date();
  const ts      = (diasAtras) =>
    Utilities.formatDate(new Date(ahora.getTime() - diasAtras * 86400000), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");

  const gestiones = [
    // EXP-001 (3 gestiones)
    [TEST_PREFIX+'GES-001', ts(15),'TEST-EXP-001','gestor1@municipio.gob.ec','LLAMADA_TELEFONICA','SIN_RESPUESTA',  'Primera llamada sin respuesta','', '',             'gestor1@municipio.gob.ec', ts(15)],
    [TEST_PREFIX+'GES-002', ts(10),'TEST-EXP-001','gestor1@municipio.gob.ec','CORREO_ELECTRONICO','CONTACTADO',    'Correo enviado, respuesta al día siguiente', ts(3),'EN_GESTION','gestor1@municipio.gob.ec', ts(10)],
    [TEST_PREFIX+'GES-003', ts(5), 'TEST-EXP-001','gestor1@municipio.gob.ec','LLAMADA_TELEFONICA','CONTACTADO',    'Empresa confirma revisión de deuda',ts(30),'EN_GESTION','gestor1@municipio.gob.ec', ts(5)],
    // EXP-002 (2 gestiones)
    [TEST_PREFIX+'GES-004', ts(35),'TEST-EXP-002','gestor1@municipio.gob.ec','LLAMADA_TELEFONICA','SIN_RESPUESTA',  'Número no contesta', '', '',             'gestor1@municipio.gob.ec', ts(35)],
    [TEST_PREFIX+'GES-005', ts(35),'TEST-EXP-002','gestor1@municipio.gob.ec','CORREO_ELECTRONICO','SIN_RESPUESTA',  'Sin respuesta al correo', '', '',        'gestor1@municipio.gob.ec', ts(35)],
    // EXP-003 (3 gestiones)
    [TEST_PREFIX+'GES-006', ts(60),'TEST-EXP-003','gestor2@municipio.gob.ec','VISITA_DOMICILIARIA','NO_LOCALIZADO','Dirección no válida', '', '',             'gestor2@municipio.gob.ec', ts(60)],
    [TEST_PREFIX+'GES-007', ts(30),'TEST-EXP-003','gestor2@municipio.gob.ec','LLAMADA_TELEFONICA','CONTACTADO',    'Contactado, rechaza deuda', ts(15),'EN_GESTION','gestor2@municipio.gob.ec', ts(30)],
    [TEST_PREFIX+'GES-008', ts(15),'TEST-EXP-003','gestor2@municipio.gob.ec','NOTIFICACION_ESCRITA','RECHAZO',    'Notificación formal entregada', ts(0),'EN_GESTION','gestor2@municipio.gob.ec', ts(15)],
    // EXP-004 (1 gestión)
    [TEST_PREFIX+'GES-009', ts(60),'TEST-EXP-004','gestor2@municipio.gob.ec','VISITA_DOMICILIARIA','NO_LOCALIZADO','Empresa cerrada, sin actividad', '', '', 'gestor2@municipio.gob.ec', ts(60)],
    // EXP-005 (2 gestiones)
    [TEST_PREFIX+'GES-010', ts(15),'TEST-EXP-005','gestor1@municipio.gob.ec','LLAMADA_TELEFONICA','CONTACTADO',    'Primera llamada exitosa', ts(7),'EN_GESTION','gestor1@municipio.gob.ec', ts(15)],
    [TEST_PREFIX+'GES-011', ts(5), 'TEST-EXP-005','gestor1@municipio.gob.ec','WHATSAPP',          'PROMESA_PAGO',  'Promete pago esta semana', ts(3),'COMPROMETIDO_PAGO','gestor1@municipio.gob.ec', ts(5)],
    // EXP-007 (3 gestiones)
    [TEST_PREFIX+'GES-012', ts(15),'TEST-EXP-007','gestor2@municipio.gob.ec','LLAMADA_TELEFONICA','CONTACTADO',    'Persona natural, dispuesto a pagar', ts(10),'EN_GESTION','gestor2@municipio.gob.ec', ts(15)],
    [TEST_PREFIX+'GES-013', ts(10),'TEST-EXP-007','gestor2@municipio.gob.ec','REUNION_PRESENCIAL','ACUERDO_PARCIAL','Acordó pago fraccionado', ts(7),'COMPROMETIDO_PAGO','gestor2@municipio.gob.ec', ts(10)],
    [TEST_PREFIX+'GES-014', ts(5), 'TEST-EXP-007','gestor2@municipio.gob.ec','LLAMADA_TELEFONICA','PROMESA_PAGO',  'Confirmó pago el viernes', ts(3),'COMPROMETIDO_PAGO','gestor2@municipio.gob.ec', ts(5)],
    // EXP-008 (3 gestiones — cerrado exitoso)
    [TEST_PREFIX+'GES-015', ts(35),'TEST-EXP-008','gestor1@municipio.gob.ec','LLAMADA_TELEFONICA','CONTACTADO',    'Empresa receptiva', ts(20),'EN_GESTION','gestor1@municipio.gob.ec', ts(35)],
    [TEST_PREFIX+'GES-016', ts(15),'TEST-EXP-008','gestor1@municipio.gob.ec','REUNION_PRESENCIAL','PROMESA_PAGO',  'Acuerdo de pago firmado', ts(7),'COMPROMETIDO_PAGO','gestor1@municipio.gob.ec', ts(15)],
    [TEST_PREFIX+'GES-017', ts(5), 'TEST-EXP-008','gestor1@municipio.gob.ec','CORREO_ELECTRONICO','PAGO_CONFIRMADO','Pago confirmado en caja', '', 'CERRADO_EXITOSO','gestor1@municipio.gob.ec', ts(5)],
    // EXP-009 (2 gestiones)
    [TEST_PREFIX+'GES-018', ts(35),'TEST-EXP-009','gestor2@municipio.gob.ec','VISITA_DOMICILIARIA','CONTACTADO',  'Empresa grande, proceso largo', ts(20),'EN_GESTION','gestor2@municipio.gob.ec', ts(35)],
    [TEST_PREFIX+'GES-019', ts(5), 'TEST-EXP-009','gestor2@municipio.gob.ec','LLAMADA_TELEFONICA','ACUERDO_PARCIAL','Primer pago parcial recibido', ts(30),'EN_GESTION','gestor2@municipio.gob.ec', ts(5)],
    // EXP-010 (3 gestiones)
    [TEST_PREFIX+'GES-020', ts(35),'TEST-EXP-010','gestor1@municipio.gob.ec','LLAMADA_TELEFONICA','SIN_RESPUESTA', 'No contesta', '', '',             'gestor1@municipio.gob.ec', ts(35)],
    [TEST_PREFIX+'GES-021', ts(25),'TEST-EXP-010','gestor1@municipio.gob.ec','CORREO_ELECTRONICO','SIN_RESPUESTA', 'Sin respuesta', '', '',            'gestor1@municipio.gob.ec', ts(25)],
    [TEST_PREFIX+'GES-022', ts(15),'TEST-EXP-010','gestor1@municipio.gob.ec','VISITA_DOMICILIARIA','NO_LOCALIZADO','Hotel cerrado temporalmente', '', '', 'gestor1@municipio.gob.ec', ts(15)],
    // EXP-011 (2 gestiones — derivado coactiva)
    [TEST_PREFIX+'GES-023', ts(60),'TEST-EXP-011','gestor2@municipio.gob.ec','NOTIFICACION_ESCRITA','RECHAZO',    'Notificación número 1', ts(30),'EN_GESTION','gestor2@municipio.gob.ec', ts(60)],
    [TEST_PREFIX+'GES-024', ts(35),'TEST-EXP-011','gestor2@municipio.gob.ec','NOTIFICACION_ESCRITA','DERIVAR_COACTIVA','Derivado por reincidencia', '', 'DERIVADO_COACTIVA','gestor2@municipio.gob.ec', ts(35)],
    // EXP-012 (2 gestiones)
    [TEST_PREFIX+'GES-025', ts(35),'TEST-EXP-012','gestor2@municipio.gob.ec','LLAMADA_TELEFONICA','NO_LOCALIZADO', 'Número fuera de servicio', '', '',      'gestor2@municipio.gob.ec', ts(35)],
    [TEST_PREFIX+'GES-026', ts(20),'TEST-EXP-012','gestor2@municipio.gob.ec','VISITA_DOMICILIARIA','NO_LOCALIZADO','Dirección incorrecta', '', '',          'gestor2@municipio.gob.ec', ts(20)],
    // EXP-013 (1 gestión)
    [TEST_PREFIX+'GES-027', ts(5), 'TEST-EXP-013','gestor1@municipio.gob.ec','LLAMADA_TELEFONICA','CONTACTADO',   'Primera gestión, empresa bien dispuesta', ts(30),'EN_GESTION','gestor1@municipio.gob.ec', ts(5)],
    // EXP-014 (2 gestiones)
    [TEST_PREFIX+'GES-028', ts(60),'TEST-EXP-014','gestor2@municipio.gob.ec','NOTIFICACION_ESCRITA','RECHAZO',    'Disputa legal activa', ts(30),'EN_GESTION','gestor2@municipio.gob.ec', ts(60)],
    [TEST_PREFIX+'GES-029', ts(35),'TEST-EXP-014','gestor2@municipio.gob.ec','LLAMADA_TELEFONICA','RECHAZO',      'Abogado de empresa rechaza notificación', ts(0),'EN_GESTION','gestor2@municipio.gob.ec', ts(35)],
    // EXP-015 (1 gestión)
    [TEST_PREFIX+'GES-030', ts(5), 'TEST-EXP-015','gestor1@municipio.gob.ec','CORREO_ELECTRONICO','CONTACTADO',  'Notificación de declaración complementaria enviada', ts(30),'EN_GESTION','gestor1@municipio.gob.ec', ts(5)]
  ];

  gestiones.forEach(fila => appendRow(SHEET_NAMES.GESTIONES, fila));
  Logger.log('Gestiones de prueba: ' + gestiones.length);
}
