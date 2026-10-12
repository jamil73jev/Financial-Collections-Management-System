/**
 * ImportService.gs
 * Importación de datos de comerciantes de la Bahía desde la hoja ETL.
 * La hoja ETL (DATA_POWERBI_IMPORT_CONTRIBUYENTES) contiene las 19 columnas
 * de BASE BAHIA.xlsx. Solo ADMINISTRADOR puede ejecutar importaciones.
 */

/**
 * Sincroniza los datos maestros desde la hoja ETL.
 * Esta función es llamada internamente por migrateDataPowerBIToContribuyentes_().
 *
 * @param {Array<Object>} docs  — array de objetos con datos de comerciantes
 * @param {boolean} [reemplazar=true] — si true, limpia la hoja antes de cargar
 * @returns {{ ok: boolean, cargados: number, error?: string }}
 */
function syncMasterData_(docs, reemplazar = true) {
  if (!docs || !Array.isArray(docs) || docs.length === 0) {
    return { ok: false, error: 'No se recibieron datos para sincronizar.' };
  }

  try {
    Logger.log('=== syncMasterData_ (BASE BAHIA): Iniciando ===');
    Logger.log('Registros recibidos: ' + docs.length);

    const validacionDesglose = _validarColumnasDesgloseFuente_(docs);
    if (reemplazar && !validacionDesglose.ok) {
      return {
        ok: false,
        error: 'Carga cancelada para proteger CONTRIBUYENTES. Faltan columnas de gestión: ' +
          validacionDesglose.faltantes.join(', ')
      };
    }

    const headers = HEADERS.CONTRIBUYENTES;
    const filas = [];
    let validos = 0, invalidos = 0;

    const _parseNum_ = (v) => {
      if (v === '' || v === null || v === undefined) return 0;
      if (typeof v === 'number') return v;
      const s = String(v).replace(/,/g, '.').replace(/[^0-9.-]/g, '');
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };

    const fechaCarga = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");

    docs.forEach((doc, idx) => {
      try {
        // Intentar leer el RUC desde cualquiera de sus variantes de nombre
        const ruc = String(
          doc.RUC || doc.IDENTIFICACION || doc.IDENTIFICACIÓN || ''
        ).trim();

        if (!ruc) {
          Logger.log('⚠️  Fila ' + (idx + 2) + ': RUC/Identificación vacío');
          invalidos++;
          return;
        }

        const _leer = (...claves) => {
          for (const k of claves) {
            if (doc[k] !== undefined && doc[k] !== '') return doc[k];
          }
          return '';
        };

        // Mapeo EXACTO → columnas de CONTRIBUYENTES (nueva estructura BASE BAHIA)
        const fila = [
          _leer('CATEGORIA_TIPO_MERCADO', 'CATEGORIATIPOMERCADO', 'Categoría/Tipo Mercado'),  // [0]
          _leer('MERCADO_SECTOR', 'MERCADOSECTOR', 'Mercado/Sector'),                          // [1]
          _leer('ASOCIACION', 'ASOCIACIÓN', 'Asociación'),                                     // [2]
          _leer('NO_DE_PUESTO', 'NODEPUESTO', 'No. de Puesto'),                               // [3]
          _leer('GIRO_DEL_NEGOCIO', 'GIRONEGOCIO', 'Giro del Negocio'),                       // [4]
          ruc,                                                                                  // [5] RUC / Identificación
          _leer('NOMBRE_CONTRIBUYENTE', 'COMERCIANTE', 'NOMBRECONTRIBUYENTE'),                 // [6]
          _leer('CORREO_GESTION', 'CORREOS', 'CORREO'),                                        // [7]
          _leer('TELEFONO_GESTION', 'CELULARES', 'CELULAR'),                                   // [8]
          _leer('TELEFONO_GESTION2', 'TELEFONOSDOMICILIO', 'TelefonosDomicilio'),              // [9]
          _leer('DETALLE_CONTACTOS', 'DETALLECONTACTOS', 'DetalleContactos'),                  // [10]
          _leer('ESTADO_COMERCIANTE', 'ESTADOCOMERCIANT', 'Estado Comerciante'),               // [11]
          _leer('PERIODO_DESDE', 'PERIODODESDE', 'Periodo Desde'),                             // [12]
          _leer('PERIODO_HASTA', 'PERIODOHASTA', 'Periodo Hasta'),                             // [13]
          _leer('ESTADO_DE_DEUDA', 'ESTADODEDEUDA', 'Estado de Deuda'),                        // [14]
          _leer('TIPO_IMPUESTO', 'TIPO_DE_RUBRO', 'TIPODERUBRO', 'Tipo de Rubro'),            // [15]
          _parseNum_(_leer('TOTAL_DEUDA', 'TOTAL_DE_DEUDA', 'TOTALDEDEUDA', 'Total de Deuda')), // [16]
          _parseNum_(_leer('TOTAL_POR_COBRAR', 'TOTALACOBRAR', 'Total por Cobrar')),             // [17]
          _leer('CODIGO_CEP', 'CODIGOCEP', 'Código CEP'),                                      // [18]
          fechaCarga                                                                             // [19] FECHA_CARGA
        ];

        filas.push(fila);
        validos++;

        if (idx === 0) {
          Logger.log('✅ Primer registro transformado:');
          Logger.log('   CATEGORIA: ' + fila[0]);
          Logger.log('   MERCADO: ' + fila[1]);
          Logger.log('   ASOCIACION: ' + fila[2]);
          Logger.log('   PUESTO: ' + fila[3]);
          Logger.log('   RUC: ' + fila[5]);
          Logger.log('   NOMBRE: ' + fila[6]);
          Logger.log('   TOTAL_DEUDA: ' + fila[16]);
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

    Logger.log('Escribiendo ' + validos + ' registros en CONTRIBUYENTES...');
    if (reemplazar) {
      overwriteDataSection_(SHEET_NAMES.CONTRIBUYENTES, filas);
    } else {
      filas.forEach(f => appendRow_(SHEET_NAMES.CONTRIBUYENTES, f));
    }

    logActionSystem_({
      hoja:    SHEET_NAMES.CONTRIBUYENTES,
      accion:  'SYNC_BAHIA_' + (reemplazar ? 'REPLACE' : 'APPEND'),
      contexto: 'Registros cargados: ' + validos,
      origen:  'ImportService.gs'
    });

    invalidarCacheDashboard_();
    Logger.log('✅ SINCRONIZACIÓN BAHIA COMPLETADA: ' + validos + ' registros');

    return {
      ok:       true,
      cargados: validos,
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    Logger.log('❌ Error en syncMasterData_: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Diagnóstico interno de solo lectura del esquema de CONTRIBUYENTES.
 */
function verificarEsquemaDesgloseDeuda() {
  const hoja = getHoja_(SHEET_NAMES.CONTRIBUYENTES);
  const lastCol = hoja.getLastColumn();
  const headers = lastCol > 0
    ? hoja.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    : [];
  const normalizados = headers.map(_normalizarHeaderDesglose_);
  const faltantes = CAMPOS_DESGLOSE_DEUDA.filter(campo =>
    !normalizados.includes(_normalizarHeaderDesglose_(campo))
  );
  const resultado = {
    ok: faltantes.length === 0,
    hoja: SHEET_NAMES.CONTRIBUYENTES,
    columnasEncontradas: CAMPOS_DESGLOSE_DEUDA.filter(campo =>
      normalizados.includes(_normalizarHeaderDesglose_(campo))
    ),
    columnasFaltantes: faltantes,
    registros: Math.max(hoja.getLastRow() - 1, 0)
  };
  Logger.log(JSON.stringify(resultado));
  return resultado;
}

function _normalizarHeaderDesglose_(valor) {
  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/gi, '')
    .toUpperCase();
}

function _validarColumnasDesgloseFuente_(docs) {
  const claves = Object.keys(docs[0] || {}).map(_normalizarHeaderDesglose_);
  const aliases = {
    MERCADO_SECTOR: ['MERCADO_SECTOR', 'MERCADOSECTOR'],
    ASOCIACION: ['ASOCIACION'],
    NO_DE_PUESTO: ['NO_DE_PUESTO', 'NODEPUESTO'],
    GIRO_DEL_NEGOCIO: ['GIRO_DEL_NEGOCIO', 'GIRONEGOCIO', 'GIRODELNEGOCIO'],
    PERIODO_DESDE: ['PERIODO_DESDE', 'PERIODODESDE'],
    PERIODO_HASTA: ['PERIODO_HASTA', 'PERIODOHASTA']
  };
  const faltantes = CAMPOS_DESGLOSE_DEUDA.filter(campo =>
    !aliases[campo].some(alias => claves.includes(alias))
  );
  return { ok: faltantes.length === 0, faltantes };
}

/**
 * Busca un comerciante por RUC/Identificación en la hoja CONTRIBUYENTES.
 * Para autocompletar al crear un expediente.
 * @param {string} token
 * @param {string} ruc
 * @returns {{ ok: boolean, contribuyente?: Object, error?: string }}
 */
function getContribuyentePorRUC_(token, ruc) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  const registro = findRowByField_(SHEET_NAMES.CONTRIBUYENTES, 'RUC', String(ruc).trim());
  if (!registro) return { ok: false, error: 'Comerciante no encontrado para identificación: ' + ruc };

  return {
    ok: true,
    contribuyente: {
      // Datos de ubicación comercial
      categoriaTipoMercado: registro.CATEGORIA_TIPO_MERCADO || '',
      mercadoSector:        registro.MERCADO_SECTOR || '',
      asociacion:           registro.ASOCIACION || '',
      noDePuesto:           registro.NO_DE_PUESTO || '',
      giroDelNegocio:       registro.GIRO_DEL_NEGOCIO || '',
      // Identificación
      ruc:                  registro.RUC || '',
      nombre:               registro.NOMBRE_CONTRIBUYENTE || '',
      // Contacto
      correoGestion:        registro.CORREO_GESTION || '',
      telefonoGestion:      registro.TELEFONO_GESTION || '',
      telefonoGestion2:     registro.TELEFONO_GESTION2 || '',
      detalleContactos:     registro.DETALLE_CONTACTOS || '',
      // Estado y período
      estadoComerciant:     registro.ESTADO_COMERCIANTE || '',
      periodoDesde:         registro.PERIODO_DESDE || '',
      periodoHasta:         registro.PERIODO_HASTA || '',
      estadoDeDeuda:        registro.ESTADO_DE_DEUDA || '',
      // Financiero
      tipoImpuesto:         registro.TIPO_IMPUESTO || '',
      totalDeuda:           parseFloat(registro.TOTAL_DEUDA) || 0,
      totalPorCobrar:       parseFloat(registro.TOTAL_POR_COBRAR) || 0,
      codigoCep:            registro.CODIGO_CEP || ''
    }
  };
}

// ============================================================
// FUNCIONES INTERNAS
// ============================================================

/**
 * Construye mapa de índice ETL → nombre de columna sistema BASE BAHIA.
 * Acepta variaciones en los nombres de columna del Excel.
 */
function _construirMapaColumnas_(encabezadosCSV) {
  const equivalencias = {
    // ── UBICACIÓN COMERCIAL ──────────────────────────────────────────
    'CATEGORIA_TIPO_MERCADO':  'CATEGORIA_TIPO_MERCADO',
    'CATEGORIATIPOMERCADO':    'CATEGORIA_TIPO_MERCADO',
    'MERCADO_SECTOR':          'MERCADO_SECTOR',
    'MERCADOSECTOR':           'MERCADO_SECTOR',
    'ASOCIACION':              'ASOCIACION',
    'ASOCIACIÓN':              'ASOCIACION',
    'NO_DE_PUESTO':            'NO_DE_PUESTO',
    'NODEPUESTO':              'NO_DE_PUESTO',
    'GIRO_DEL_NEGOCIO':        'GIRO_DEL_NEGOCIO',
    'GIRONEGOCIO':             'GIRO_DEL_NEGOCIO',

    // ── IDENTIFICACIÓN ───────────────────────────────────────────────
    'RUC':                     'RUC',
    'IDENTIFICACION':          'RUC',
    'IDENTIFICACIÓN':          'RUC',

    // ── NOMBRE ───────────────────────────────────────────────────────
    'NOMBRE_CONTRIBUYENTE':    'NOMBRE_CONTRIBUYENTE',
    'COMERCIANTE':             'NOMBRE_CONTRIBUYENTE',
    'NOMBRECONTRIBUYENTE':     'NOMBRE_CONTRIBUYENTE',

    // ── CONTACTO ─────────────────────────────────────────────────────
    'CORREO_GESTION':          'CORREO_GESTION',
    'CORREOS':                 'CORREO_GESTION',
    'TELEFONO_GESTION':        'TELEFONO_GESTION',
    'CELULARES':               'TELEFONO_GESTION',
    'TELEFONO_GESTION2':       'TELEFONO_GESTION2',
    'TELEFONOSDOMICILIO':      'TELEFONO_GESTION2',
    'DETALLE_CONTACTOS':       'DETALLE_CONTACTOS',
    'DETALLECONTACTOS':        'DETALLE_CONTACTOS',

    // ── ESTADO Y PERÍODO ─────────────────────────────────────────────
    'ESTADO_COMERCIANTE':      'ESTADO_COMERCIANTE',
    'ESTADOCOMERCIANT':        'ESTADO_COMERCIANTE',
    'PERIODO_DESDE':           'PERIODO_DESDE',
    'PERIODODESDE':            'PERIODO_DESDE',
    'PERIODO_HASTA':           'PERIODO_HASTA',
    'PERIODOHASTA':            'PERIODO_HASTA',
    'ESTADO_DE_DEUDA':         'ESTADO_DE_DEUDA',
    'ESTADODEDEUDA':           'ESTADO_DE_DEUDA',

    // ── RUBRO Y DEUDA ────────────────────────────────────────────────
    'TIPO_IMPUESTO':           'TIPO_IMPUESTO',
    'TIPO_DE_RUBRO':           'TIPO_IMPUESTO',
    'TIPODERUBRO':             'TIPO_IMPUESTO',
    'TOTAL_DEUDA':             'TOTAL_DEUDA',
    'TOTAL_DE_DEUDA':          'TOTAL_DEUDA',
    'TOTALDEDEUDA':            'TOTAL_DEUDA',
    'TOTAL_POR_COBRAR':        'TOTAL_POR_COBRAR',
    'TOTALACOBRAR':            'TOTAL_POR_COBRAR',
    'CODIGO_CEP':              'CODIGO_CEP',
    'CODIGOCEP':               'CODIGO_CEP'
  };

  const mapa = {};
  encabezadosCSV.forEach((header, idx) => {
    const sinPrefijo = header.replace(/^suma\s+de\s+/i, '');
    const norm = sinPrefijo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
      .replace(/[/\\.\s]+/g, '_')
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '');
    if (equivalencias[norm]) {
      mapa[equivalencias[norm]] = idx;
    }
  });

  return mapa;
}

function _parseNum_(val) {
  if (val === '' || val === null || val === undefined) return 0;
  const limpio = String(val).replace(',', '.');
  return parseFloat(limpio) || 0;
}

function _fmtImport_(fecha) {
  return Utilities.formatDate(fecha, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * DIAGNÓSTICO: Verifica qué hay realmente en CONTRIBUYENTES
 */
function _diagnosticarContribuyentesImport_() {
  try {
    const hoja = getHoja_(SHEET_NAMES.CONTRIBUYENTES);
    const datos = hoja.getDataRange().getValues();

    if (datos.length === 0) {
      Logger.log('❌ CONTRIBUYENTES vacío');
      return;
    }

    const headers = datos[0];
    Logger.log('📊 DIAGNÓSTICO CONTRIBUYENTES (BASE BAHIA)');
    Logger.log('Total filas: ' + datos.length);
    Logger.log('\n📋 Encabezados:');
    headers.forEach((h, idx) => {
      Logger.log('  [' + (idx + 1) + '] ' + h);
    });

    Logger.log('\n🔍 Primer registro (fila 2):');
    const primerReg = datos[1];
    headers.forEach((h, idx) => {
      Logger.log('  [' + (idx + 1) + '] ' + h + ': ' + primerReg[idx]);
    });

    Logger.log('\n💰 COLUMNAS FINANCIERAS:');
    ['TOTAL_DEUDA', 'TOTAL_POR_COBRAR'].forEach(col => {
      const idx = headers.indexOf(col);
      if (idx >= 0) {
        Logger.log('  ✅ ' + col + ' (col ' + (idx + 1) + '): ' + primerReg[idx]);
      } else {
        Logger.log('  ❌ ' + col + ': NO ENCONTRADA');
      }
    });

    Logger.log('\n📊 ESTADÍSTICAS:');
    let conDeuda = 0, sinDeuda = 0;
    const totalDeudaIdx = headers.indexOf('TOTAL_DEUDA');
    for (let i = 1; i < datos.length; i++) {
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

