/**
 * ImportService.gs
 * Importación de datos de contribuyentes desde CSV filtrado.
 * El CSV es generado por preparar_csv.py y contiene solo contribuyentes con deuda activa.
 * Solo ADMINISTRADOR puede ejecutar importaciones.
 */

/**
 * Procesa un array de datos de contribuyentes y los carga en la hoja CONTRIBUYENTES.
 * El frontend parsea el CSV y envía los datos como array de arrays.
 *
 * @param {string} token
 * @param {Array<Array>} filas  — array de filas (primera fila = encabezados del CSV)
 * @param {boolean} [reemplazar=false] — si true, reemplaza todos los datos; si false, agrega
 * @returns {{ ok: boolean, cargados?: number, errores?: string[], error?: string }}
 */
function processContribuyentesData(token, filas, reemplazar) {
  const acceso = checkAccess(token, 'IMPORTAR_CONTRIBUYENTES');
  if (!acceso.ok) return acceso;

  if (!filas || !Array.isArray(filas) || filas.length < 2) {
    return { ok: false, error: 'No se recibieron datos válidos. El archivo debe tener encabezados y datos.' };
  }

  const encabezadosCSV = filas[0].map(h => String(h).trim().toUpperCase());
  const datosCSV       = filas.slice(1).filter(fila => fila.some(v => v !== '' && v !== null));

  // Validar que el CSV tiene columnas mínimas requeridas
  const columnasRequeridas = ['RUC', 'NOMBRE_CONTRIBUYENTE'];
  const columnasFaltantes  = columnasRequeridas.filter(c => !encabezadosCSV.includes(c));

  if (columnasFaltantes.length > 0) {
    return {
      ok: false,
      error: 'Columnas requeridas faltantes en CSV: ' + columnasFaltantes.join(', ') +
             '. Usar preparar_csv.py para generar el archivo correcto.'
    };
  }

  // Mapear columnas del CSV a columnas del sistema
  const mapaColumnas = _construirMapaColumnas(encabezadosCSV);

  // Validar y transformar filas
  const filasValidas = [];
  const errores      = [];

  datosCSV.forEach((fila, idx) => {
    const resultado = _transformarFila(fila, mapaColumnas, encabezadosCSV, idx + 2);
    if (resultado.valida) {
      filasValidas.push(resultado.filaTransformada);
    } else {
      errores.push('Fila ' + (idx + 2) + ': ' + resultado.error);
    }
  });

  if (filasValidas.length === 0) {
    return { ok: false, error: 'Ninguna fila válida para importar.', errores };
  }

  // Escribir en hoja CONTRIBUYENTES
  const ahora    = new Date();
  const fechaCarga = _fmt(ahora);

  // Agregar fecha de carga a cada fila
  const filasConFecha = filasValidas.map(fila => {
    // Asegurar longitud correcta según HEADERS.CONTRIBUYENTES
    while (fila.length < HEADERS.CONTRIBUYENTES.length - 1) fila.push('');
    fila.push(fechaCarga); // FECHA_CARGA
    return fila;
  });

  if (reemplazar) {
    overwriteDataSection(SHEET_NAMES.CONTRIBUYENTES, filasConFecha);
  } else {
    filasConFecha.forEach(fila => appendRow(SHEET_NAMES.CONTRIBUYENTES, fila));
  }

  logAction({
    token,
    hoja:    SHEET_NAMES.CONTRIBUYENTES,
    accion:  reemplazar ? 'IMPORTAR_CONTRIBUYENTES_REEMPLAZAR' : 'IMPORTAR_CONTRIBUYENTES_AGREGAR',
    contexto: 'Filas cargadas: ' + filasValidas.length +
              ' | Errores: ' + errores.length +
              ' | Modo: ' + (reemplazar ? 'REEMPLAZAR' : 'AGREGAR'),
    origen:  'ImportService.gs'
  });

  return {
    ok:      true,
    cargados: filasValidas.length,
    errores: errores.length > 0 ? errores.slice(0, 20) : [] // máximo 20 errores reportados
  };
}

/**
 * Busca un contribuyente por RUC en la hoja CONTRIBUYENTES.
 * Para autocompletar al crear un expediente.
 * @param {string} token
 * @param {string} ruc
 * @returns {{ ok: boolean, contribuyente?: Object, error?: string }}
 */
function getContribuyentePorRUC(token, ruc) {
  const sesion = verificarSesion(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  const registro = findRowByField(SHEET_NAMES.CONTRIBUYENTES, 'RUC', String(ruc).trim());
  if (!registro) return { ok: false, error: 'Contribuyente no encontrado para RUC: ' + ruc };

  return {
    ok: true,
    contribuyente: {
      ruc:                registro.RUC,
      nombre:             registro.NOMBRE_CONTRIBUYENTE,
      tipoPersona:        registro.TIPO_PERSONA,
      direccion:          registro.DIRECCION,
      correo:             registro.CORREO,
      telefono:           registro.TELEFONO,
      representanteLegal: registro.REPRESENTANTE_LEGAL,
      actividad:          registro.ACTIVIDAD_ECONOMICA,
      estadoDeclaracion:  registro.ESTADO_DECLARACION,
      totalDeuda:         parseFloat(registro.TOTAL_DEUDA) || 0,
      valorImpuesto:      parseFloat(registro.VALOR_IMPUESTO) || 0,
      recargo:            parseFloat(registro.RECARGO) || 0,
      intereses:          parseFloat(registro.INTERESES) || 0
    }
  };
}

/**
 * Retorna estadísticas de la hoja CONTRIBUYENTES para verificación de carga.
 * @param {string} token
 * @returns {{ ok: boolean, stats?: Object, error?: string }}
 */
function getEstadisticasContribuyentes(token) {
  const acceso = checkAccess(token, 'IMPORTAR_CONTRIBUYENTES');
  if (!acceso.ok) return acceso;

  const registros = getDataAsObjects(SHEET_NAMES.CONTRIBUYENTES);
  const fechas    = registros.map(r => r.FECHA_CARGA).filter(Boolean);
  const ultimaCarga = fechas.length > 0
    ? fechas.sort().reverse()[0]
    : null;

  return {
    ok: true,
    stats: {
      total:      registros.length,
      ultimaCarga
    }
  };
}

// ============================================================
// FUNCIONES PRIVADAS
// ============================================================

/**
 * Construye mapa de índice CSV → nombre de columna sistema.
 * Acepta variaciones de nombres de columna del CSV.
 */
function _construirMapaColumnas(encabezadosCSV) {
  // Mapa de equivalencias: nombre_csv → nombre_sistema
  const equivalencias = {
    'RUC':                        'RUC',
    'NOMBRE_CONTRIBUYENTE':       'NOMBRE_CONTRIBUYENTE',
    'NOMBRECONTRIBUYENTE':        'NOMBRE_CONTRIBUYENTE',
    'NOMBRE':                     'NOMBRE_CONTRIBUYENTE',
    'TIPO_PERSONA':               'TIPO_PERSONA',
    'TIPOPERSONA':                'TIPO_PERSONA',
    'DIRECCION':                  'DIRECCION',
    'CORREO':                     'CORREO',
    'CORREOEMAS':                 'CORREO',
    'TELEFONO':                   'TELEFONO',
    'TELEFONOEMAS':               'TELEFONO',
    'REPRESENTANTE_LEGAL':        'REPRESENTANTE_LEGAL',
    'REPRESENTANTELEGAL':         'REPRESENTANTE_LEGAL',
    'ACTIVIDAD_ECONOMICA':        'ACTIVIDAD_ECONOMICA',
    'ACTIVIDADECONOMICAPRINCIPAL':'ACTIVIDAD_ECONOMICA',
    'ESTADO_DECLARACION':         'ESTADO_DECLARACION',
    'ESTADODECLARACION':          'ESTADO_DECLARACION',
    'TIPO_DECLARACION':           'TIPO_DECLARACION',
    'TIPODECLARACION':            'TIPO_DECLARACION',
    'VALOR_IMPUESTO':             'VALOR_IMPUESTO',
    'VALORIMPUESTO15PORMIL':      'VALOR_IMPUESTO',
    'RECARGO':                    'RECARGO',
    'INTERESES':                  'INTERESES',
    'TOTAL_DEUDA':                'TOTAL_DEUDA',
    'TOTALDEUDA':                 'TOTAL_DEUDA',
    'VALORPAGAR':                 'TOTAL_DEUDA',
    'ANIO':                       'ANIO',
    'PERIODO':                    'PERIODO',
    'ID_TITULO_CREDITO':          'ID_TITULO_CREDITO',
    'IDTITULOCREDITO':            'ID_TITULO_CREDITO',
    'ID_ESTADO_TITULO':           'ID_ESTADO_TITULO',
    'IDESTADOTITULO':             'ID_ESTADO_TITULO'
  };

  const mapa = {};
  encabezadosCSV.forEach((header, idx) => {
    const norm = header.replace(/\s+/g, '_').toUpperCase();
    if (equivalencias[norm]) {
      mapa[equivalencias[norm]] = idx;
    }
  });

  return mapa;
}

function _transformarFila(fila, mapa, encabezadosCSV, numFila) {
  const get = (campo) => {
    const idx = mapa[campo];
    if (idx === undefined || idx === null) return '';
    const val = fila[idx];
    return val !== null && val !== undefined ? String(val).trim() : '';
  };

  const ruc = get('RUC');
  if (!ruc) return { valida: false, error: 'RUC vacío.' };

  const filaTransformada = [
    ruc,
    get('NOMBRE_CONTRIBUYENTE'),
    get('TIPO_PERSONA'),
    get('DIRECCION'),
    get('CORREO'),
    get('TELEFONO'),
    get('REPRESENTANTE_LEGAL'),
    get('ACTIVIDAD_ECONOMICA'),
    get('ESTADO_DECLARACION'),
    get('TIPO_DECLARACION'),
    _parseNum(get('VALOR_IMPUESTO')),
    _parseNum(get('RECARGO')),
    _parseNum(get('INTERESES')),
    _parseNum(get('TOTAL_DEUDA')),
    get('ANIO'),
    get('PERIODO'),
    get('ID_TITULO_CREDITO'),
    get('ID_ESTADO_TITULO')
    // FECHA_CARGA se agrega externamente
  ];

  return { valida: true, filaTransformada };
}

function _parseNum(val) {
  if (val === '' || val === null || val === undefined) return 0;
  const limpio = String(val).replace(',', '.');
  return parseFloat(limpio) || 0;
}

function _fmt(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}
