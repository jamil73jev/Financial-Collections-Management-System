/**
 * ImportService.gs
 * Importación de datos de contribuyentes desde CSV filtrado.
 * El CSV es generado por preparar_csv.py y contiene solo contribuyentes con deuda activa.
 * Solo ADMINISTRADOR puede ejecutar importaciones.
 */

/**
 * Sincroniza los datos maestros desde CSV (DriveImportService).
 * Esta función es llamada desde _procesarArchivoCSV() en DriveImportService.
 *
 * @param {Array<Object>} docs  — array de objetos con datos de contribuyentes
 * @param {boolean} [reemplazar=true] — si true, limpia la hoja antes de cargar
 * @returns {{ ok: boolean, cargados: number, error?: string }}
 */
function syncMasterData(docs, reemplazar = true) {
  if (!docs || !Array.isArray(docs) || docs.length === 0) {
    return { ok: false, error: 'No se recibieron datos para sincronizar.' };
  }

  try {
    Logger.log('=== syncMasterData: Iniciando ===');
    Logger.log('Registros recibidos: ' + docs.length);

    // Preparar headers de CONTRIBUYENTES
    const headers = HEADERS.CONTRIBUYENTES;
    const filas = [];
    let validos = 0, invalidos = 0;

    // Función auxiliar para convertir a número
    const _parseNum = (v) => {
      if (v === '' || v === null || v === undefined) return 0;
      if (typeof v === 'number') return v;
      const s = String(v).replace(/,/g, '.').replace(/[^0-9.-]/g, '');
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };

    // Fecha de carga
    const ahora = new Date();
    const fechaCarga = Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");

    // Procesar cada registro
    docs.forEach((doc, idx) => {
      try {
        // Validar RUC
        const ruc = doc.RUC || doc.RUC || '';
        if (!ruc) {
          Logger.log('⚠️  Fila ' + (idx + 2) + ': RUC vacío');
          invalidos++;
          return;
        }

        // Construir fila con mapeo EXACTO a headers de CONTRIBUYENTES
        // El CSV puede tener diferentes nombres para las mismas columnas
        const leerColumna = (doc, nombres) => {
          for (const nombre of nombres) {
            if (doc[nombre] !== undefined && doc[nombre] !== '') {
              return doc[nombre];
            }
          }
          return '';
        };

        // Mapeo EXACTO: CSV BASE 20% - JURIDICA → SIGECOV3 CONTRIBUYENTES
        // DriveImportService normaliza headers a MAYUSCULAS sin espacios,
        // por eso usamos los nombres normalizados (ej: ANIOSOLICITUD, no AnioSolicitud)
        const _leer = (...claves) => {
          for (const k of claves) {
            if (doc[k] !== undefined && doc[k] !== '') return doc[k];
          }
          return '';
        };

        const fila = [
          _leer('ANIOSOLICITUD', 'AÑO_SOLICITUD', 'ANIO_SOLICITUD'),       // [0] AÑO_SOLICITUD
          _leer('IMPUESTO', 'TIPO_IMPUESTO'),                               // [1] TIPO_IMPUESTO
          ruc,                                                              // [2] RUC
          _leer('NOMBRECONTRIBUYENTE', 'NOMBRE_CONTRIBUYENTE'),            // [3] NOMBRE_CONTRIBUYENTE
          _leer('TIPOPERSONA', 'TIPO_PERSONA'),                            // [4] TIPO_PERSONA
          _leer('CORREOGESTION', 'CORREO_GESTION'),                        // [5] CORREO_GESTION
          _leer('TELEFONOGESTION', 'TELEFONO_GESTION'),                    // [6] TELEFONO_GESTION
          _leer('REPRESENTANTELEGAL', 'REPRESENTANTE_LEGAL'),              // [7] REPRESENTANTE_LEGAL
          _leer('CORREOGESTION2', 'CORREO_GESTION2'),                      // [8] CORREO_GESTION2
          _leer('TELEFONOGESTION2', 'TELEFONO_GESTION2'),                  // [9] TELEFONO_GESTION2
          _parseNum(_leer('SUMVALORIMPUESTO', 'VALOR_IMPUESTO')),          // [10] VALOR_IMPUESTO
          _parseNum(_leer('SUMVALORINTERES', 'SUMVALORINTEREST', 'SUMVALORINTERESES', 'SUMVALORINTERS', 'VALOR_INTERES')), // [11] VALOR_INTERES
          _parseNum(_leer('SUMVALORMULTA', 'VALOR_MULTA')),                // [12] VALOR_MULTA
          _parseNum(_leer('SUMVALORRECARGO', 'VALOR_RECARGO')),            // [13] VALOR_RECARGO
          _parseNum(_leer('SUMVALORPENDIENTE', 'TOTAL_DEUDA')),            // [14] TOTAL_DEUDA
          fechaCarga                                                        // [15] FECHA_CARGA
        ];

        filas.push(fila);
        validos++;

        // Mostrar primer registro para diagnóstico
        if (idx === 0) {
          Logger.log('✅ Primer registro transformado:');
          Logger.log('   AÑO: ' + fila[0]);
          Logger.log('   IMPUESTO: ' + fila[1]);
          Logger.log('   RUC: ' + fila[2]);
          Logger.log('   NOMBRE: ' + fila[3]);
          Logger.log('   CORREO: ' + fila[5]);
          Logger.log('   VALOR_IMPUESTO: ' + fila[10]);
          Logger.log('   INTERESES: ' + fila[11]);
          Logger.log('   MULTA: ' + fila[12]);
          Logger.log('   TOTAL_DEUDA: ' + fila[13]);
          Logger.log('   RECARGO: ' + fila[14]);
        }

      } catch (e) {
        Logger.log('⚠️  Fila ' + (idx + 2) + ': Error - ' + e.message);
        invalidos++;
      }
    });

    Logger.log('Registros válidos: ' + validos + ' | Errores: ' + invalidos);

    if (filas.length === 0) {
      return { ok: false, error: 'Ningún registro válido para sincronizar.' };
    }

    // Escribir en CONTRIBUYENTES
    Logger.log('Escribiendo ' + validos + ' registros en CONTRIBUYENTES...');
    if (reemplazar) {
      overwriteDataSection(SHEET_NAMES.CONTRIBUYENTES, filas);
    } else {
      filas.forEach(f => appendRow(SHEET_NAMES.CONTRIBUYENTES, f));
    }

    // Registrar en bitácora
    logActionSystem({
      hoja:    SHEET_NAMES.CONTRIBUYENTES,
      accion:  'SYNC_CSV_' + (reemplazar ? 'REPLACE' : 'APPEND'),
      contexto: 'Registros: ' + validos,
      origen:  'ImportService.gs'
    });

    // Invalidar caché
    invalidarCacheDashboard();

    Logger.log('✅ SINCRONIZACIÓN COMPLETADA: ' + validos + ' registros');

    return {
      ok:       true,
      cargados: validos,
      timestamp: ahora.toISOString()
    };

  } catch (err) {
    Logger.log('❌ Error en syncMasterData: ' + err.message);
    return { ok: false, error: err.message };
  }
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
      anoSolicitud:       registro['AÑO_SOLICITUD'] || '',
      tipoImpuesto:       registro.TIPO_IMPUESTO || '',
      ruc:                registro.RUC || '',
      nombre:             registro.NOMBRE_CONTRIBUYENTE || '',
      tipoPersona:        registro.TIPO_PERSONA || '',
      correoGestion:      registro.CORREO_GESTION || '',
      telefonoGestion:    registro.TELEFONO_GESTION || '',
      representanteLegal: registro.REPRESENTANTE_LEGAL || '',
      correoGestion2:     registro.CORREO_GESTION2 || '',
      telefonoGestion2:   registro.TELEFONO_GESTION2 || '',
      valorImpuesto:      parseFloat(registro.VALOR_IMPUESTO) || 0,
      valorInteres:       parseFloat(registro.VALOR_INTERES) || 0,
      valorMulta:         parseFloat(registro.VALOR_MULTA) || 0,
      valorRecargo:       parseFloat(registro.VALOR_RECARGO) || 0,
      totalDeuda:         parseFloat(registro.TOTAL_DEUDA) || 0
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
  // Mapa de equivalencias: nombre_csv_normalizado → nombre_sistema
  // Cubre nombres del export de Power BI (con y sin "Suma de "), CSV manual,
  // y variaciones históricas.
  const equivalencias = {
    // ── TIPO IMPUESTO ────────────────────────────────────────────────
    'TIPO_IMPUESTO':               'TIPO_IMPUESTO',
    'IMPUESTO':                    'TIPO_IMPUESTO',

    // ── RUC ──────────────────────────────────────────────────────────
    'RUC':                         'RUC',
    'RUN':                         'RUC',   // Power BI puede truncar/variar

    // ── NOMBRE ───────────────────────────────────────────────────────
    'NOMBRE_CONTRIBUYENTE':        'NOMBRE_CONTRIBUYENTE',
    'NOMBRECONTRIBUYENTE':         'NOMBRE_CONTRIBUYENTE',
    'NOMBRECONT':                  'NOMBRE_CONTRIBUYENTE',
    'NOMBRE':                      'NOMBRE_CONTRIBUYENTE',

    // ── TIPO PERSONA ─────────────────────────────────────────────────
    'TIPO_PERSONA':                'TIPO_PERSONA',
    'TIPOPERSONA':                 'TIPO_PERSONA',

    // ── DIRECCIÓN ────────────────────────────────────────────────────
    'DIRECCION':                   'DIRECCION',
    'DIRECCIONSRI':                'DIRECCION',  // Power BI: DireccionSRI

    // ── CORREO ───────────────────────────────────────────────────────
    'CORREO':                      'CORREO',
    'CORREOEMAS':                  'CORREO',     // Power BI: CorreoEMAS
    'CORREOGESTION':               'CORREO',

    // ── TELÉFONO ─────────────────────────────────────────────────────
    'TELEFONO':                    'TELEFONO',
    'TELEFONOEMAS':                'TELEFONO',
    'TELEFONOGESTION':             'TELEFONO',

    // ── REPRESENTANTE ────────────────────────────────────────────────
    'REPRESENTANTE_LEGAL':         'REPRESENTANTE_LEGAL',
    'REPRESENTANTELEGAL':          'REPRESENTANTE_LEGAL',

    // ── ESTADO / TIPO DECLARACIÓN ────────────────────────────────────
    'ESTADO_DECLARACION':          'ESTADO_DECLARACION',
    'ESTADODECLARACION':           'ESTADO_DECLARACION',  // Power BI: EstadoDeclaracion

    // ── VALORES FINANCIEROS ──────────────────────────────────────────
    // Nombres directos
    'VALOR_IMPUESTO':              'VALOR_IMPUESTO',
    'VALORIMPUESTO':               'VALOR_IMPUESTO',      // Power BI: ValorImpuesto
    'VALORIMPUESTO15PORMIL':       'VALOR_IMPUESTO',

    'RECARGO':                     'RECARGO',
    'VALORRECARGO':                'RECARGO',             // Power BI: ValorRecargo

    'INTERESES':                   'INTERESES',
    'VALORINTERES':                'INTERESES',
    'VALORINTERE':                 'INTERESES',

    'TOTAL_DEUDA':                 'TOTAL_DEUDA',
    'TOTALDEUDA':                  'TOTAL_DEUDA',
    'VALORPAGAR':                  'TOTAL_DEUDA',         // Power BI: ValorPagar
    'VALORPENDIENTE':              'TOTAL_DEUDA',
    'VALORPENDIE':                 'TOTAL_DEUDA'
  };

  const mapa = {};
  encabezadosCSV.forEach((header, idx) => {
    // 1. Eliminar prefijo "Suma de " de tablas dinámicas de Power BI
    const sinPrefijo = header.replace(/^suma\s+de\s+/i, '');
    // 2. Normalizar: quitar espacios → guiones bajos → mayúsculas
    const norm = sinPrefijo.replace(/\s+/g, '_').toUpperCase();
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
    get('TIPO_IMPUESTO') || get('IMPUESTO'),
    ruc,
    get('NOMBRE_CONTRIBUYENTE'),
    get('TIPO_PERSONA'),
    get('DIRECCION'),
    get('CORREO'),
    get('TELEFONO'),
    get('REPRESENTANTE_LEGAL'),
    get('ESTADO_DECLARACION'),
    _parseNum(get('VALOR_IMPUESTO')),
    _parseNum(get('RECARGO')),
    _parseNum(get('INTERESES')),
    _parseNum(get('TOTAL_DEUDA')),
    Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss")
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

/**
 * DIAGNÓSTICO: Verifica qué hay realmente en CONTRIBUYENTES
 */
function diagnosticarContribuyentes() {
  try {
    const hoja = getHoja(SHEET_NAMES.CONTRIBUYENTES);
    const datos = hoja.getDataRange().getValues();

    if (datos.length === 0) {
      Logger.log('❌ CONTRIBUYENTES vacío');
      return;
    }

    const headers = datos[0];
    Logger.log('📊 DIAGNÓSTICO CONTRIBUYENTES');
    Logger.log('Total filas: ' + datos.length);
    Logger.log('\n📋 Encabezados (completos):');
    headers.forEach((h, idx) => {
      Logger.log('  [' + (idx + 1) + '] ' + h);
    });

    // Mostrar primer registro completo
    Logger.log('\n🔍 Primer registro (fila 2):');
    const primerReg = datos[1];
    headers.forEach((h, idx) => {
      Logger.log('  [' + (idx + 1) + '] ' + h + ': ' + primerReg[idx] + ' (tipo: ' + typeof primerReg[idx] + ')');
    });

    // Buscar columnas numéricas específicamente
    Logger.log('\nðŸ’° COLUMNAS NUMÉRICAS:');
    const numericaCols = ['VALOR_IMPUESTO', 'VALOR_INTERES', 'VALOR_MULTA', 'VALOR_RECARGO', 'TOTAL_DEUDA'];
    numericaCols.forEach(col => {
      const idx = headers.indexOf(col);
      if (idx >= 0) {
        const valor = primerReg[idx];
        Logger.log('  ✅ ' + col + ' (col ' + (idx + 1) + '): ' + valor + ' (tipo: ' + typeof valor + ')');
      } else {
        Logger.log('  ❌ ' + col + ': NO ENCONTRADA');
      }
    });

    // Mostrar último registro
    Logger.log('\n🔍 Último registro (fila ' + datos.length + '):');
    const ultimoReg = datos[datos.length - 1];
    Logger.log('  RUC: ' + ultimoReg[headers.indexOf('RUC')]);
    Logger.log('  NOMBRE: ' + ultimoReg[headers.indexOf('NOMBRE_CONTRIBUYENTE')]);
    Logger.log('  TOTAL_DEUDA: ' + ultimoReg[headers.indexOf('TOTAL_DEUDA')]);

    // Contar cuántos tienen TOTAL_DEUDA > 0
    Logger.log('\n📊 ESTADÍSTICAS:');
    let conDeuda = 0;
    let sinDeuda = 0;
    for (let i = 1; i < datos.length; i++) {
      const totalDeudaIdx = headers.indexOf('TOTAL_DEUDA');
      const valor = parseFloat(String(datos[i][totalDeudaIdx] || 0).replace(/,/g, '.')) || 0;
      if (valor > 0) conDeuda++;
      else sinDeuda++;
    }
    Logger.log('  Con deuda (>0): ' + conDeuda);
    Logger.log('  Sin deuda (=0): ' + sinDeuda);

  } catch (err) {
    Logger.log('❌ Error en diagnosticarContribuyentes: ' + err.message);
    Logger.log(err.stack);
  }
}


