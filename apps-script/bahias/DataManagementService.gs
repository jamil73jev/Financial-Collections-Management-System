/**
 * DataManagementService.gs
 * Funciones para gestión de datos: reset, importación, limpieza.
 * ⚠️ ESTAS FUNCIONES SOLO SE EJECUTAN MANUALMENTE DESDE LA CONSOLA
 * NO se llaman automáticamente desde el dispatcher ni desde otras funciones.
 */

/**
 * LIMPIA COMPLETAMENTE EL SISTEMA para empezar de cero.
 *
 * ⚠️ ADVERTENCIA: Esto elimina TODOS los datos de:
 * - CONTRIBUYENTES
 * - EXPEDIENTES
 * - GESTIONES
 * - SEGUIMIENTO
 * - BITACORA
 *
 * SOLO ejecutar manualmente desde consola si estás seguro:
 * resetSistemaCompleto_()
 */
function resetSistemaCompleto_() {
  try {
    Logger.log('=== RESET COMPLETO DEL SISTEMA ===');
    Logger.log('⚠️  ADVERTENCIA: Borrando todos los datos...');

    // Función auxiliar para limpiar una hoja sin eliminar headers
    const limpiarHoja = (nombreHoja) => {
      const hoja = getHoja_(nombreHoja);
      const data = hoja.getDataRange();
      if (data.getNumRows() > 1) {
        hoja.getRange(2, 1, data.getNumRows() - 1, data.getNumColumns()).clearContent();
      }
    };

    Logger.log('Limpiando CONTRIBUYENTES...');
    limpiarHoja(SHEET_NAMES.CONTRIBUYENTES);

    Logger.log('Limpiando EXPEDIENTES...');
    limpiarHoja(SHEET_NAMES.EXPEDIENTES);

    Logger.log('Limpiando GESTIONES...');
    limpiarHoja(SHEET_NAMES.GESTIONES);

    Logger.log('Limpiando SEGUIMIENTO...');
    limpiarHoja(SHEET_NAMES.SEGUIMIENTO);

    Logger.log('Limpiando BITACORA...');
    limpiarHoja(SHEET_NAMES.BITACORA);

    const cache = CacheService.getScriptCache();
    cache.removeAll(['kpis_dashboard', 'estadisticas_rapidas', 'exp_list_']);
    Logger.log('Cache limpiado');

    Logger.log('\n✅ === RESET COMPLETADO ===');
    Logger.log('Próximo paso: importarYProcesarCSV()');

  } catch (err) {
    Logger.log('❌ Error en resetSistemaCompleto_: ' + err.message);
    Logger.log(err.stack);
  }
}

/**
 * Crea EXPEDIENTES automáticamente basándose en CONTRIBUYENTES.
 * Asigna gestores por round-robin, calcula prioridades, y llena campos iniciales.
 * ⚠️ Ejecutar DESPUÉS de migrateDataPowerBIToContribuyentes_()
 */
function crearExpedientesDesdeContribuyentes_() {
  try {
    Logger.log('=== CREACIÓN DE EXPEDIENTES DESDE CONTRIBUYENTES ===\n');

    // Leer contribuyentes
    const contribuyentes = getDataAsObjects_(SHEET_NAMES.CONTRIBUYENTES);
    if (contribuyentes.length === 0) {
      Logger.log('❌ No hay contribuyentes en la hoja');
      return { ok: false, error: 'CONTRIBUYENTES vacío' };
    }
    Logger.log('✅ Leyendo ' + contribuyentes.length + ' contribuyentes');

    // Preparar headers de EXPEDIENTES
    const headers = HEADERS.EXPEDIENTES;
    const filas = [];

    // Obtener lista de gestores activos para asignación por round-robin
    let gestores = [];
    try {
      const usuarios = getDataAsObjects_(SHEET_NAMES.USUARIOS);
      gestores = usuarios
        .filter(u => String(u.ROL).toUpperCase() === 'GESTOR' && (u.ACTIVO === 'TRUE' || u.ACTIVO === true))
        .map(u => String(u.CORREO_INSTITUCIONAL || '').trim())
        .filter(correo => correo);
    } catch (e) {
      Logger.log('❌ Error al leer USUARIOS: ' + e.message);
    }

    // Sin gestores activos = no se puede asignar, abortar con error claro
    if (gestores.length === 0) {
      Logger.log('❌ No se encontraron usuarios con ROL=GESTOR y ACTIVO=TRUE.');
      Logger.log('   Crea los gestores en la sección Usuarios antes de ejecutar esta función.');
      return { ok: false, error: 'Sin gestores activos. Crea usuarios con ROL=GESTOR primero.' };
    }

    Logger.log('Gestores disponibles (' + gestores.length + '): ' + gestores.join(', '));

    // Función para calcular prioridad según deuda
    const _calcularPrioridad = (valor) => {
      const num = typeof valor === 'number' ? valor : parseFloat(String(valor).replace(/,/g, '.')) || 0;
      if (num >= 50000) return 'CRITICA';
      if (num >= 10000) return 'ALTA';
      if (num >= 1000)  return 'MEDIA';
      return 'BAJA';
    };

    // Contadores
    let idCounter = 1;
    let gestorIndex = 0;
    let validos = 0, invalidos = 0;

    // Fecha y hora actual
    const ahora = new Date();
    const fechaAsignacion = Utilities.formatDate(ahora, PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");

    // Agrupar comerciantes por RUC (un expediente por RUC)
    Logger.log('Agrupando por RUC...');
    const agrupadosPorRUC = {};

    contribuyentes.forEach((contrib, idx) => {
      if (!contrib.RUC) {
        Logger.log('⚠️  Fila ' + (idx + 2) + ': RUC vacío, saltando');
        invalidos++;
        return;
      }
      const ruc = String(contrib.RUC).trim();

      if (!agrupadosPorRUC[ruc]) {
        agrupadosPorRUC[ruc] = {
          contribuyente:      contrib.NOMBRE_CONTRIBUYENTE || '',
          ruc:                ruc,
          // Datos Bahia
          categoriaMercado:   contrib.CATEGORIA_TIPO_MERCADO || '',
          mercadoSector:      contrib.MERCADO_SECTOR || '',
          asociacion:         contrib.ASOCIACION || '',
          noDePuesto:         contrib.NO_DE_PUESTO || '',
          giroNegocio:        contrib.GIRO_DEL_NEGOCIO || '',
          estadoComerciant:   contrib.ESTADO_COMERCIANTE || '',
          periodoDesde:       contrib.PERIODO_DESDE || '',
          periodoHasta:       contrib.PERIODO_HASTA || '',
          estadoDeDeuda:      contrib.ESTADO_DE_DEUDA || '',
          codigoCep:          contrib.CODIGO_CEP || '',
          rubros:             new Set(),
          totalDeuda:         0,
          totalPorCobrar:     0
        };
      }

      const _n = v => parseFloat(String(v || 0).replace(/,/g, '.')) || 0;
      agrupadosPorRUC[ruc].totalDeuda      += _n(contrib.TOTAL_DEUDA);
      agrupadosPorRUC[ruc].totalPorCobrar  += _n(contrib.TOTAL_POR_COBRAR);

      if (contrib.TIPO_IMPUESTO) {
        agrupadosPorRUC[ruc].rubros.add(contrib.TIPO_IMPUESTO);
      }
    });

    const grupos = Object.values(agrupadosPorRUC);
    Logger.log('Se detectaron ' + grupos.length + ' contribuyentes (RUCs) únicos.');

    // Leer expedientes existentes para no duplicar RUCs que ya tienen historial
    const ESTADOS_TERMINALES = ['CERRADO_EXITOSO', 'CERRADO_SIN_ACUERDO', 'DERIVADO_TITULO'];
    let expedientesExistentes = [];
    try {
      expedientesExistentes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
    } catch (e) { /* hoja vacía, ok */ }

    // Mapa RUC → expediente activo (con _rowIndex para poder actualizarlo)
    const expActivosPorRUC = {};
    expedientesExistentes
      .filter(e => !ESTADOS_TERMINALES.includes(e.ESTADO_EXPEDIENTE) && (e.ACTIVO === 'TRUE' || e.ACTIVO === true))
      .forEach(e => {
        const ruc = String(e.RUC || '').trim();
        if (ruc) expActivosPorRUC[ruc] = e;
      });
    const rucsConExpedienteActivo = new Set(Object.keys(expActivosPorRUC));
    Logger.log('RUCs con expediente activo existente: ' + rucsConExpedienteActivo.size);

    // Índice del último ID para continuar la secuencia
    if (expedientesExistentes.length > 0) {
      const ultimoId = expedientesExistentes
        .map(e => parseInt(String(e.CODIGO_INTERNO || '0'), 10))
        .filter(n => !isNaN(n) && n > 0)
        .reduce((max, n) => Math.max(max, n), 0);
      if (ultimoId >= idCounter) idCounter = ultimoId + 1;
    }

    // Procesar cada contribuyente único agrupado
    let omitidosPorDuplicado = 0;
    const actualizacionesDeuda = [];   // acumula updates de deuda para expedientes existentes

    grupos.forEach((agrupado) => {
      // Si ya existe expediente activo: actualizar montos con los datos nuevos
      if (rucsConExpedienteActivo.has(agrupado.ruc)) {
        const expExistente = expActivosPorRUC[agrupado.ruc];
        if (expExistente && expExistente._rowIndex) {
          actualizacionesDeuda.push({
            rowIndex: expExistente._rowIndex,
            campos: {
              TOTAL_DEUDA:      agrupado.totalDeuda,
              TOTAL_POR_COBRAR: agrupado.totalPorCobrar,
              TIPO_OBLIGACION:  Array.from(agrupado.rubros).join(' + ') || expExistente.TIPO_OBLIGACION || '',
              PRIORIDAD:        _calcularPrioridad(agrupado.totalDeuda),
              ESTADO_DE_DEUDA:  agrupado.estadoDeDeuda || expExistente.ESTADO_DE_DEUDA || ''
            }
          });
        }
        omitidosPorDuplicado++;
        return;
      }
      try {
        const fila = [];

        headers.forEach(header => {
          let valor = '';

          switch (header) {
            case 'ID_EXPEDIENTE':
              const mes = Utilities.formatDate(ahora, PARAMS.TIMEZONE, 'yyyyMM');
              valor = 'EXP-' + mes + '-' + String(idCounter).padStart(4, '0');
              idCounter++;
              break;

            case 'CODIGO_INTERNO':
              valor = idCounter - 1;
              break;

            case 'RUC':
              valor = agrupado.ruc;
              break;

            case 'CONTRIBUYENTE':
              valor = agrupado.contribuyente;
              break;

            // ── Datos Bahia adicionales ───────────────────────────────
            case 'CATEGORIA_TIPO_MERCADO':
              valor = agrupado.categoriaMercado;
              break;

            case 'MERCADO_SECTOR':
              valor = agrupado.mercadoSector;
              break;

            case 'ASOCIACION':
              valor = agrupado.asociacion;
              break;

            case 'NO_DE_PUESTO':
              valor = agrupado.noDePuesto;
              break;

            case 'GIRO_DEL_NEGOCIO':
              valor = agrupado.giroNegocio;
              break;

            case 'ESTADO_COMERCIANTE':
              valor = agrupado.estadoComerciant;
              break;

            case 'PERIODO_DESDE':
              valor = agrupado.periodoDesde;
              break;

            case 'PERIODO_HASTA':
              valor = agrupado.periodoHasta;
              break;

            case 'ESTADO_DE_DEUDA':
              valor = agrupado.estadoDeDeuda;
              break;

            case 'CODIGO_CEP':
              valor = agrupado.codigoCep;
              break;
            // ─────────────────────────────────────────────────────────

            case 'TIPO_OBLIGACION':
              valor = Array.from(agrupado.rubros).join(' + ') || '';
              break;

            case 'ESTADO_EXPEDIENTE':
              valor = 'EN_GESTION';
              break;

            case 'PRIORIDAD':
              valor = _calcularPrioridad(agrupado.totalDeuda);
              break;

            case 'FUNCIONARIO_ASIGNADO':
              valor = gestores[gestorIndex];
              gestorIndex = (gestorIndex + 1) % gestores.length;
              break;

            case 'FECHA_ASIGNACION':
              valor = fechaAsignacion;
              break;

            case 'DIAS_SIN_MOVIMIENTO':
              valor = 0;
              break;

            case 'OBSERVACION_GENERAL':
              valor = 'Asignación automática Bahia OK';
              break;

            case 'ALERTA_ESTADO':
              valor = 'OK';
              break;

            case 'ACTIVO':
              valor = 'TRUE';
              break;

            case 'TOTAL_DEUDA':
              valor = agrupado.totalDeuda;
              break;

            case 'TOTAL_POR_COBRAR':
              valor = agrupado.totalPorCobrar;
              break;

            default:
              valor = '';
          }

          fila.push(valor);
        });

        filas.push(fila);
        validos++;

      } catch (e) {
        Logger.log('⚠️  Error al generar expediente para RUC ' + agrupado.ruc + ': ' + e.message);
        invalidos++;
      }
    });

    // Actualizar deuda en expedientes existentes que recibieron datos nuevos
    if (actualizacionesDeuda.length > 0) {
      Logger.log('\nActualizando montos en ' + actualizacionesDeuda.length + ' expediente(s) existente(s)...');
      batchUpdateRows_(SHEET_NAMES.EXPEDIENTES, actualizacionesDeuda);
      Logger.log('✅ Montos actualizados');
    }

    if (filas.length === 0) {
      Logger.log(omitidosPorDuplicado > 0
        ? '⚠️  Todos los RUCs ya tenían expediente activo. Montos actualizados donde aplica.'
        : '❌ Ningún expediente válido para crear');
      if (typeof invalidarCacheMaestro_ === 'function') invalidarCacheMaestro_();
      return {
        ok: true,
        creados: 0,
        errores: invalidos,
        omitidos: omitidosPorDuplicado,
        actualizados: actualizacionesDeuda.length,
        mensaje: 'Todos los RUCs ya tenían expediente activo. ' + actualizacionesDeuda.length + ' montos actualizados.'
      };
    }

    // Agregar solo los expedientes nuevos (no sobreescribe los existentes)
    Logger.log('\nAgregando ' + validos + ' expedientes nuevos a EXPEDIENTES...');
    const hojaExp = getHoja_(SHEET_NAMES.EXPEDIENTES);
    filas.forEach(fila => hojaExp.appendRow(fila));

    if (typeof invalidarCacheMaestro_ === 'function') {
      invalidarCacheMaestro_();
    }

    logActionSystem_({
      hoja:    SHEET_NAMES.EXPEDIENTES,
      accion:  'CREACION_EXPEDIENTES_AUTOMATICA',
      contexto: 'Creados: ' + validos + ' | Actualizados: ' + actualizacionesDeuda.length + ' | Omitidos sin cambio: ' + (omitidosPorDuplicado - actualizacionesDeuda.length) + ' | Errores: ' + invalidos,
      origen:  'DataManagementService.gs'
    });

    Logger.log('\n✅ PROCESO EXITOSO');
    Logger.log('   Nuevos expedientes creados:    ' + validos);
    Logger.log('   Expedientes con monto updated: ' + actualizacionesDeuda.length);
    Logger.log('   RUCs omitidos (sin cambio):    ' + omitidosPorDuplicado);
    Logger.log('   Inválidos:                     ' + invalidos);

    return { ok: true, creados: validos, omitidos: omitidosPorDuplicado, actualizados: actualizacionesDeuda.length, errores: invalidos };

  } catch (err) {
    Logger.log('❌ Error en crearExpedientesDesdeContribuyentes_: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * IMPORTACIÓN Y PROCESAMIENTO — DATA_POWERBI_IMPORT (carga masiva principal).
 * Lee desde DATA_POWERBI_IMPORT, migra a CONTRIBUYENTES y genera expedientes.
 * No borra ni duplica registros existentes.
 * ⚠️ Ejecutar manualmente desde consola: importarYProcesarImportPrincipal_()
 */
function importarYProcesarImportPrincipal_() {
  try {
    Logger.log('=== IMPORTACIÓN Y PROCESAMIENTO — ' + SHEET_IMPORT_PRINCIPAL + ' ===\n');

    Logger.log('Paso 1: Migrando datos de ' + SHEET_IMPORT_PRINCIPAL + ' a CONTRIBUYENTES...');
    const resultMigra = migrateDataPowerBIToContribuyentes_(SHEET_IMPORT_PRINCIPAL);
    if (!resultMigra) {
      Logger.log('❌ Error en migración o hoja vacía, abortando.');
      return;
    }
    Logger.log('✅ Migración completada\n');

    Logger.log('Paso 2: Creando expedientes para RUCs nuevos...');
    const resultAsign = crearExpedientesDesdeContribuyentes_();
    if (!resultAsign.ok) {
      Logger.log('❌ Error al crear expedientes: ' + resultAsign.error);
      return;
    }
    Logger.log('✅ Expedientes creados: ' + resultAsign.creados + '\n');

    Logger.log('Paso 3: Verificando totales...');
    const contribuyentes = getDataAsObjects_(SHEET_NAMES.CONTRIBUYENTES);
    const expedientes    = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
    Logger.log('   - Contribuyentes totales: ' + contribuyentes.length);
    Logger.log('   - Expedientes totales:    ' + expedientes.length);

    if (typeof invalidarCacheMaestro_ === 'function') invalidarCacheMaestro_();

    Logger.log('\n=== ✅ COMPLETADO ===');
    Logger.log('  Nuevos expedientes creados: ' + (resultAsign.creados  || 0));
    Logger.log('  RUCs ya existentes omitidos: ' + (resultAsign.omitidos || 0));

  } catch (err) {
    Logger.log('❌ Error en importarYProcesarImportPrincipal_: ' + err.message);
    Logger.log(err.stack);
  }
}

/**
 * IMPORTACIÓN Y PROCESAMIENTO — DATA_POWERBI_IMPORT_CONTRIBUYENTES (nuevos contribuyentes).
 * Lee desde DATA_POWERBI_IMPORT_CONTRIBUYENTES, migra a CONTRIBUYENTES y genera expedientes.
 * No borra ni duplica registros existentes.
 * ⚠️ Ejecutar manualmente desde consola: importarYProcesarContribuyentesETL_()
 *    O usar el botón "Procesar Contribuyentes ETL" en la web.
 */
function importarYProcesarContribuyentesETL_() {
  try {
    Logger.log('=== IMPORTACIÓN Y PROCESAMIENTO — ' + SHEET_CONTRIB_ETL + ' ===\n');

    Logger.log('Paso 1: Migrando datos de ' + SHEET_CONTRIB_ETL + ' a CONTRIBUYENTES...');
    const resultMigra = migrateDataPowerBIToContribuyentes_();
    if (!resultMigra) {
      Logger.log('❌ Error en migración o hoja vacía, abortando.');
      return;
    }
    Logger.log('✅ Migración completada\n');

    Logger.log('Paso 2: Creando expedientes para RUCs nuevos...');
    const resultAsign = crearExpedientesDesdeContribuyentes_();
    if (!resultAsign.ok) {
      Logger.log('❌ Error al crear expedientes: ' + resultAsign.error);
      return;
    }
    Logger.log('✅ Expedientes creados: ' + resultAsign.creados + '\n');

    Logger.log('Paso 3: Verificando totales...');
    const contribuyentes = getDataAsObjects_(SHEET_NAMES.CONTRIBUYENTES);
    const expedientes    = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
    Logger.log('   - Contribuyentes totales: ' + contribuyentes.length);
    Logger.log('   - Expedientes totales:    ' + expedientes.length);

    if (typeof invalidarCacheMaestro_ === 'function') invalidarCacheMaestro_();

    Logger.log('\n=== ✅ COMPLETADO ===');
    Logger.log('  Nuevos expedientes creados: ' + (resultAsign.creados  || 0));
    Logger.log('  RUCs ya existentes omitidos: ' + (resultAsign.omitidos || 0));

  } catch (err) {
    Logger.log('❌ Error en importarYProcesarContribuyentesETL_: ' + err.message);
    Logger.log(err.stack);
  }
}

/**
 * Transforma datos normalizados a estructura de CONTRIBUYENTES.
 * @param {string} [origenHoja] Hoja de origen. Por defecto DATA_POWERBI_IMPORT_CONTRIBUYENTES.
 */
function migrateDataPowerBIToContribuyentes_(origenHoja) {
  try {
    const hojaOrigen = origenHoja || SHEET_CONTRIB_ETL;
    const datosPowerBI = getDataAsObjects_(hojaOrigen);
    if (datosPowerBI.length === 0) {
      Logger.log('❌ ' + hojaOrigen + ' está vacío');
      return false;
    }
    Logger.log('✅ Leyendo ' + datosPowerBI.length + ' registros de ' + hojaOrigen);

    const headers = HEADERS.CONTRIBUYENTES;
    const filas = [];
    let validos = 0, invalidos = 0;

    const _parseNum_ = (v) => {
      if (typeof v === 'number') return v;
      const s = String(v || '0').replace(/,/g, '.').replace(/[^0-9.-]/g, '');
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };

    datosPowerBI.forEach((doc, idx) => {
      const docNormalizado = {};
      Object.entries(doc).forEach(([key, val]) => {
        const keyNorm = key
          .replace(/^suma\s+de\s+/i, '')
          .replace(/\s+/g, '_')
          .toUpperCase();
        docNormalizado[keyNorm] = val;
      });

      // Equivalencias BASE BAHIA
      const equivalencias = {
        'CATEGORIA_TIPO_MERCADO': ['CATEGORIATIPOMERCADO', 'CATEGORIA_TIPO_MERCADO', 'CATEGORIA/TIPOMERCADO'],
        'MERCADO_SECTOR':         ['MERCADOSECTOR', 'MERCADO_SECTOR'],
        'ASOCIACION':             ['ASOCIACION', 'ASOCIACIÓN'],
        'NO_DE_PUESTO':           ['NODEPUESTO', 'NO_DE_PUESTO', 'NODEPUEST'],
        'GIRO_DEL_NEGOCIO':       ['GIRONEGOCIO', 'GIRO_DEL_NEGOCIO', 'GIRODEL_NEGOCIO'],
        'RUC':                    ['RUC', 'IDENTIFICACION', 'IDENTIFICACIÓN'],
        'NOMBRE_CONTRIBUYENTE':   ['NOMBRECONTRIBUYENTE', 'NOMBRE_CONTRIBUYENTE', 'COMERCIANTE'],
        'CORREO_GESTION':         ['CORREOS', 'CORREO_GESTION', 'CORREO'],
        'TELEFONO_GESTION':       ['CELULARES', 'TELEFONO_GESTION', 'CELULAR'],
        'TELEFONO_GESTION2':      ['TELEFONOSDOMICILIO', 'TELEFONO_GESTION2'],
        'DETALLE_CONTACTOS':      ['DETALLECONTACTOS', 'DETALLE_CONTACTOS'],
        'ESTADO_COMERCIANTE':     ['ESTADOCOMERCIANT', 'ESTADO_COMERCIANTE'],
        'PERIODO_DESDE':          ['PERIODODESDE', 'PERIODO_DESDE'],
        'PERIODO_HASTA':          ['PERIODOHASTA', 'PERIODO_HASTA'],
        'ESTADO_DE_DEUDA':        ['ESTADODEDEUDA', 'ESTADO_DE_DEUDA'],
        'TIPO_IMPUESTO':          ['TIPO_DE_RUBRO', 'TIPODERUBRO', 'TIPO_IMPUESTO'],
        'TOTAL_DEUDA':            ['TOTAL_DE_DEUDA', 'TOTALDEDEUDA', 'TOTAL_DEUDA'],
        'TOTAL_POR_COBRAR':       ['TOTALACOBRAR', 'TOTAL_POR_COBRAR'],
        'CODIGO_CEP':             ['CODIGOCEP', 'CODIGO_CEP']
      };

      const fila = [];
      let esValida = true;

      headers.forEach(header => {
        let valor = '';

        if (equivalencias[header]) {
          for (const clave of equivalencias[header]) {
            if (docNormalizado[clave]) {
              valor = docNormalizado[clave];
              break;
            }
          }
        }

        if (header === 'RUC' && !valor) {
          Logger.log('⚠️  Fila ' + (idx + 2) + ': RUC vacío, saltando');
          esValida = false;
        }

        if (['TOTAL_DEUDA', 'TOTAL_POR_COBRAR'].includes(header)) {
          valor = _parseNum_(valor);
        }

        if (header === 'FECHA_CARGA') {
          valor = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
        }

        fila.push(valor);
      });

      if (esValida) {
        filas.push(fila);
        validos++;
      } else {
        invalidos++;
      }
    });

    if (filas.length === 0) {
      Logger.log('❌ Ningún registro válido para migrar');
      return false;
    }

    // Leer existentes para deduplicar antes de agregar
    let existentesContrib = [];
    try { existentesContrib = getDataAsObjects_(SHEET_NAMES.CONTRIBUYENTES); } catch (e) {}
    // Una obligación puede repetirse por rubro y puesto en períodos distintos.
    const crearClave = datos => [
      datos.RUC,
      datos.TIPO_IMPUESTO,
      datos.NO_DE_PUESTO,
      datos.PERIODO_DESDE,
      datos.PERIODO_HASTA
    ].map(v => String(v || '').trim().toUpperCase()).join('|');
    const keysExistentes = new Set(existentesContrib.map(crearClave));

    const iRUC   = headers.indexOf('RUC');
    const iTIPO  = headers.indexOf('TIPO_IMPUESTO');
    const iPUEST = headers.indexOf('NO_DE_PUESTO');
    const iDESDE = headers.indexOf('PERIODO_DESDE');
    const iHASTA = headers.indexOf('PERIODO_HASTA');
    const filasNuevas = filas.filter(fila => {
      const clave = crearClave({
        RUC: fila[iRUC],
        TIPO_IMPUESTO: fila[iTIPO],
        NO_DE_PUESTO: fila[iPUEST],
        PERIODO_DESDE: fila[iDESDE],
        PERIODO_HASTA: fila[iHASTA]
      });
      if (keysExistentes.has(clave)) return false;
      keysExistentes.add(clave);
      return true;
    });

    const nuevos = filasNuevas.length;
    const omitidos = filas.length - nuevos;
    Logger.log('Agregando ' + nuevos + ' registro(s) nuevos en CONTRIBUYENTES (' + omitidos + ' ya existían, omitidos)...');

    if (nuevos > 0) {
      const hojaContrib = getHoja_(SHEET_NAMES.CONTRIBUYENTES);
      const numCols = headers.length;
      hojaContrib.getRange(hojaContrib.getLastRow() + 1, 1, nuevos, numCols)
        .setValues(filasNuevas.map(f => f.slice(0, numCols)));
    }

    Logger.log('✅ MIGRACIÓN EXITOSA');
    Logger.log('   Total válidos en ETL: ' + validos);
    Logger.log('   Nuevos agregados: ' + nuevos);
    Logger.log('   Omitidos (ya existían): ' + omitidos);
    Logger.log('   Total inválidos: ' + invalidos);

    return true;

  } catch (err) {
    Logger.log('❌ Error en migración: ' + err.message);
    return false;
  }
}

// ============================================================
// CONSTANTES DE LAS HOJAS ETL
// ============================================================
const SHEET_IMPORT_PRINCIPAL = 'DATA_POWERBI_IMPORT';
const SHEET_CONTRIB_ETL      = 'DATA_POWERBI_IMPORT_CONTRIBUYENTES';
// Columnas en el MISMO ORDEN que el Excel de BASE BAHIA
const HEADERS_CONTRIB_ETL = [
  'CATEGORIA_TIPO_MERCADO', 'MERCADO_SECTOR', 'ASOCIACION', 'NO_DE_PUESTO', 'GIRO_DEL_NEGOCIO',
  'IDENTIFICACION', 'COMERCIANTE', 'CORREOS', 'CELULARES', 'TELEFONOSDOMICILIO',
  'DETALLECONTACTOS', 'ESTADO_COMERCIANTE', 'PERIODO_DESDE', 'PERIODO_HASTA', 'ESTADO_DE_DEUDA',
  'TIPO_DE_RUBRO', 'TOTAL_DE_DEUDA', 'TOTAL_POR_COBRAR', 'CODIGO_CEP'
];

/**
 * Versión web de importarYProcesarCSV — valida sesión y devuelve resultado estructurado.
 * Llamada desde el botón "Procesar Contribuyentes ETL" en la interfaz web.
 */
function importarYProcesarCSVWeb_(token) {
  if (token !== null) {
    const acceso = checkAccess_(token, 'MODIFICAR_CONFIG');
    if (!acceso.ok) return acceso;
  }
  try {
    const resultMigra = migrateDataPowerBIToContribuyentes_();
    if (!resultMigra) {
      return { ok: false, error: 'La hoja ' + SHEET_CONTRIB_ETL + ' está vacía o no existe. Crea la hoja y pega los datos primero.' };
    }
    const resultAsign = crearExpedientesDesdeContribuyentes_();
    if (!resultAsign.ok && resultAsign.creados === undefined) {
      return resultAsign;
    }
    if (typeof invalidarCacheMaestro_ === 'function') invalidarCacheMaestro_();
    return {
      ok:       true,
      creados:  resultAsign.creados  || 0,
      omitidos: resultAsign.omitidos || 0,
      errores:  resultAsign.errores  || 0,
      mensaje:  (resultAsign.creados || 0) + ' expediente(s) nuevo(s) creado(s). ' +
                (resultAsign.omitidos || 0) + ' RUC(s) ya tenían expediente activo.'
    };
  } catch (err) {
    Logger.log('importarYProcesarCSVWeb_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Crea la hoja DATA_POWERBI_IMPORT_CONTRIBUYENTES con sus encabezados.
 * Ejecutar UNA VEZ desde consola o desde la web (botón Setup).
 */
function setupContribuyentesETLSheet_() {
  try {
    const ss = getSpreadsheet_();
    let hoja = ss.getSheetByName(SHEET_CONTRIB_ETL);
    if (!hoja) {
      hoja = ss.insertSheet(SHEET_CONTRIB_ETL);
      Logger.log('Hoja ' + SHEET_CONTRIB_ETL + ' creada.');
    }
    hoja.getRange(1, 1, 1, HEADERS_CONTRIB_ETL.length).setValues([HEADERS_CONTRIB_ETL]);
    const rng = hoja.getRange(1, 1, 1, HEADERS_CONTRIB_ETL.length);
    rng.setBackground('#1b5e20').setFontColor('#ffffff').setFontWeight('bold');
    hoja.setFrozenRows(1);
    hoja.setColumnWidth(1,  150); // CATEGORIA_TIPO_MERCADO
    hoja.setColumnWidth(2,  150); // MERCADO_SECTOR
    hoja.setColumnWidth(3,  180); // ASOCIACION
    hoja.setColumnWidth(4,  120); // NO_DE_PUESTO
    hoja.setColumnWidth(5,  180); // GIRO_DEL_NEGOCIO
    hoja.setColumnWidth(6,  140); // IDENTIFICACION (RUC)
    hoja.setColumnWidth(7,  220); // COMERCIANTE
    hoja.setColumnWidth(8,  200); // CORREOS
    hoja.setColumnWidth(9,  140); // CELULARES
    hoja.setColumnWidth(10, 140); // TELEFONOSDOMICILIO
    hoja.setColumnWidth(11, 200); // DETALLECONTACTOS
    hoja.setColumnWidth(12, 120); // ESTADO_COMERCIANTE
    hoja.setColumnWidth(13, 110); // PERIODO_DESDE
    hoja.setColumnWidth(14, 110); // PERIODO_HASTA
    hoja.setColumnWidth(15, 120); // ESTADO_DE_DEUDA
    hoja.setColumnWidth(16, 160); // TIPO_DE_RUBRO
    hoja.setColumnWidth(17, 120); // TOTAL_DEUDA
    hoja.setColumnWidth(18, 120); // TOTAL_POR_COBRAR
    hoja.setColumnWidth(19, 120); // CODIGO_CEP
    Logger.log('✅ ' + SHEET_CONTRIB_ETL + ' lista para recibir datos.');
    return { ok: true, mensaje: 'Hoja ' + SHEET_CONTRIB_ETL + ' configurada correctamente.' };
  } catch (err) {
    Logger.log('setupContribuyentesETLSheet_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

const SHEET_PAGOS_ETL    = 'DATA_POWERBI_IMPORT_PAGOS';
const HEADERS_PAGOS_ETL  = ['RUC', 'MONTO_PAGADO', 'TIPO_PAGO', 'REFERENCIA', 'FECHA_PAGO'];

/**
 * Crea la hoja DATA_POWERBI_IMPORT_PAGOS con sus encabezados.
 * Ejecutar UNA VEZ desde consola o desde la web (botón Setup).
 */
function setupPagosETLSheet_() {
  try {
    const ss = getSpreadsheet_();
    let hoja = ss.getSheetByName(SHEET_PAGOS_ETL);
    if (!hoja) {
      hoja = ss.insertSheet(SHEET_PAGOS_ETL);
      Logger.log('Hoja ' + SHEET_PAGOS_ETL + ' creada.');
    }
    // Escribir / sobrescribir encabezados en fila 1
    hoja.getRange(1, 1, 1, HEADERS_PAGOS_ETL.length).setValues([HEADERS_PAGOS_ETL]);
    const rng = hoja.getRange(1, 1, 1, HEADERS_PAGOS_ETL.length);
    rng.setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
    hoja.setFrozenRows(1);
    hoja.setColumnWidth(1, 140); // RUC
    hoja.setColumnWidth(2, 130); // MONTO_PAGADO
    hoja.setColumnWidth(3, 150); // TIPO_PAGO
    hoja.setColumnWidth(4, 200); // REFERENCIA
    hoja.setColumnWidth(5, 130); // FECHA_PAGO
    Logger.log('✅ ' + SHEET_PAGOS_ETL + ' lista para recibir datos.');
    return { ok: true, mensaje: 'Hoja ' + SHEET_PAGOS_ETL + ' configurada correctamente.' };
  } catch (err) {
    Logger.log('setupPagosETLSheet_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * ETL DE PAGOS AUTOMÁTICO.
 *
 * Lee la hoja DATA_POWERBI_IMPORT_PAGOS (formato simple RUC + monto),
 * busca el expediente activo de cada RUC y registra el pago.
 *
 * Columnas requeridas en DATA_POWERBI_IMPORT_PAGOS:
 *   RUC          — RUC del contribuyente (obligatorio)
 *   MONTO_PAGADO — Monto del pago en dólares (obligatorio)
 *   TIPO_PAGO    — ABONO | PAGO_TOTAL | CUOTA_CONVENIO (opcional, default: ABONO)
 *   REFERENCIA   — N° comprobante o nota (opcional)
 *   FECHA_PAGO   — Fecha YYYY-MM-DD (opcional, default: hoy)
 *
 * @param {string|null} token
 * @returns {{ ok, procesados, omitidos, errores, detalle[], error? }}
 */
function procesarPagosETL_(token) {
  if (token !== null) {
    const acceso = checkAccess_(token, 'REGISTRAR_PAGO');
    if (!acceso.ok) return acceso;
  }

  try {
    Logger.log('=== ETL DE PAGOS: ' + SHEET_PAGOS_ETL + ' ===\n');

    // 1. Leer hoja de pagos ETL
    const ss   = getSpreadsheet_();
    const hoja = ss.getSheetByName(SHEET_PAGOS_ETL);
    if (!hoja) {
      return {
        ok: false,
        error: 'Hoja ' + SHEET_PAGOS_ETL + ' no existe. Ejecuta primero setupPagosETLSheet_().'
      };
    }

    const filas = hoja.getDataRange().getValues();
    if (filas.length < 2) {
      return { ok: false, error: 'La hoja ' + SHEET_PAGOS_ETL + ' no tiene datos. Pega el CSV y vuelve a intentar.' };
    }

    // Mapear columnas por nombre (flexible ante reorden manual)
    const hdrs = filas[0].map(h => String(h || '').trim().toUpperCase());
    const col  = name => hdrs.indexOf(name);
    const iRUC    = col('RUC');
    const iMonto  = col('MONTO_PAGADO');
    const iTipo   = col('TIPO_PAGO');
    const iRef    = col('REFERENCIA');
    const iFecha  = col('FECHA_PAGO');

    if (iRUC < 0 || iMonto < 0) {
      return { ok: false, error: 'La hoja debe tener al menos las columnas RUC y MONTO_PAGADO.' };
    }

    const filasDatos = filas.slice(1).filter(f => f.some(v => v !== '' && v !== null));
    Logger.log('Filas a procesar: ' + filasDatos.length);

    // 2. Cargar expedientes activos (índice por RUC para búsqueda rápida)
    const ESTADOS_TERMINALES = ['CERRADO_EXITOSO', 'CERRADO_SIN_ACUERDO', 'DERIVADO_TITULO'];
    const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
    const mapaExpedientes = {};
    expedientes.forEach(e => {
      const ruc = String(e.RUC || '').trim();
      if (ruc && !ESTADOS_TERMINALES.includes(e.ESTADO_EXPEDIENTE) &&
          (e.ACTIVO === 'TRUE' || e.ACTIVO === true)) {
        if (!mapaExpedientes[ruc]) mapaExpedientes[ruc] = [];
        mapaExpedientes[ruc].push(e);
      }
    });

    // 3. Procesar cada fila
    const hoy = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, 'yyyy-MM-dd');
    let procesados = 0, omitidos = 0, errores = 0;
    const detalle = [];

    filasDatos.forEach((fila, idx) => {
      const ruc    = String(fila[iRUC]  || '').trim();
      const monto  = parseFloat(String(fila[iMonto] || '0').replace(/,/g, '.'));
      const tipo   = iTipo  >= 0 ? String(fila[iTipo]  || '').trim().toUpperCase() || 'ABONO' : 'ABONO';
      const ref    = iRef   >= 0 ? String(fila[iRef]   || '').trim() : '';
      const fecha  = iFecha >= 0 ? String(fila[iFecha] || '').trim() || hoy : hoy;

      // Validaciones básicas
      if (!ruc) {
        detalle.push({ fila: idx + 2, ruc: '', estado: 'OMITIDO', razon: 'RUC vacío' });
        omitidos++;
        return;
      }
      if (!monto || monto <= 0) {
        detalle.push({ fila: idx + 2, ruc, estado: 'OMITIDO', razon: 'Monto inválido: ' + fila[iMonto] });
        omitidos++;
        return;
      }
      if (!['ABONO', 'PAGO_TOTAL', 'CUOTA_CONVENIO'].includes(tipo) && tipo !== '') {
        detalle.push({ fila: idx + 2, ruc, estado: 'OMITIDO', razon: 'TIPO_PAGO inválido: ' + tipo });
        omitidos++;
        return;
      }

      // Buscar expediente activo del RUC
      const expsRUC = mapaExpedientes[ruc];
      if (!expsRUC || expsRUC.length === 0) {
        detalle.push({ fila: idx + 2, ruc, estado: 'OMITIDO', razon: 'Sin expediente activo para este RUC' });
        omitidos++;
        return;
      }

      // Macheo: expediente con saldo mas cercano al monto pagado (desempate por estado)
      const _ORDEN = ['EN_GESTION','COMPROMETIDO_PAGO','GESTION_PAUSADA','PENDIENTE_ASIGNACION'];
      const exp = expsRUC.slice().sort((a, b) => {
        const sA = parseFloat(a.SALDO_PENDIENTE) || parseFloat(a.TOTAL_DEUDA) || 0;
        const sB = parseFloat(b.SALDO_PENDIENTE) || parseFloat(b.TOTAL_DEUDA) || 0;
        const dA = Math.abs(sA - monto); const dB = Math.abs(sB - monto);
        if (Math.abs(dA - dB) < 0.01)
          return _ORDEN.indexOf(a.ESTADO_EXPEDIENTE) - _ORDEN.indexOf(b.ESTADO_EXPEDIENTE);
        return dA - dB;
      })[0];
      const saldoExp  = parseFloat(exp.SALDO_PENDIENTE) || parseFloat(exp.TOTAL_DEUDA) || 0;
      const tipoFinal = (['ABONO','PAGO_TOTAL','CUOTA_CONVENIO'].includes(tipo) ? tipo
                        : (monto >= saldoExp ? 'PAGO_TOTAL' : 'ABONO'));

      try {
        const resultado = _registrarPagoInterno_({
          idExpediente:  exp.ID_EXPEDIENTE,
          ruc:           ruc,
          monto:         monto,
          tipoPago:      tipo || 'ABONO',
          referencia:    ref || 'ETL_PAGOS',
          registradoPor: 'SISTEMA_ETL',
          fuente:        'ETL_PAGOS',
          fechaPago:     new Date(fecha + 'T12:00:00'),
          exp:           exp,
          token:         null
        });

        if (resultado.ok) {
          detalle.push({
            fila: idx + 2, ruc,
            idExpediente: exp.ID_EXPEDIENTE,
            estado: resultado.cerradoAutomaticamente ? 'CERRADO' : 'ABONO_OK',
            monto, saldoNuevo: resultado.saldoPendiente
          });
          procesados++;
          // Actualizar el expediente en memoria para que la próxima fila del mismo RUC vea el saldo correcto
          exp.MONTO_PAGADO   = (parseFloat(exp.MONTO_PAGADO) || 0) + monto;
          exp.SALDO_PENDIENTE = resultado.saldoPendiente;
          if (resultado.cerradoAutomaticamente) {
            exp.ESTADO_EXPEDIENTE = 'CERRADO_EXITOSO';
            exp.ACTIVO = 'FALSE';
          }
        } else {
          detalle.push({ fila: idx + 2, ruc, estado: 'ERROR', razon: resultado.error });
          errores++;
        }
      } catch (e) {
        detalle.push({ fila: idx + 2, ruc, estado: 'ERROR', razon: e.message });
        errores++;
      }
    });

    // 4. Invalidar caché
    if (typeof invalidarCacheMaestro_   === 'function') invalidarCacheMaestro_();
    if (typeof invalidarCacheDashboard_ === 'function') invalidarCacheDashboard_();

    Logger.log('\n✅ ETL PAGOS COMPLETADO');
    Logger.log('   Procesados: ' + procesados);
    Logger.log('   Omitidos:   ' + omitidos);
    Logger.log('   Errores:    ' + errores);

    return { ok: true, procesados, omitidos, errores, detalle,
             mensaje: procesados + ' pago(s) registrado(s). ' + omitidos + ' omitido(s). ' + errores + ' error(es).' };

  } catch (err) {
    Logger.log('procesarPagosETL_ ERROR: ' + err.message + '\n' + err.stack);
    return { ok: false, error: err.message };
  }
}

/**
 * SINCRONIZA LOS ENCABEZADOS FÍSICOS DE LAS HOJAS CON Constants.gs
 * Ejecutar esto UNA VEZ desde la consola si los conteos muestran 0 inesperadamente,
 * o si cambiaste la estructura de columnas en Constants.gs.
 *
 * sincronizarEncabezados_()
 */
function sincronizarEncabezados_() {
  try {
    Logger.log('=== SINCRONIZANDO ENCABEZADOS ===');
    const ss = getSpreadsheet_();
    Object.keys(HEADERS).forEach(key => {
      const nombreHoja = SHEET_NAMES[key];
      const headersArray = HEADERS[key];
      const hoja = ss.getSheetByName(nombreHoja);

      if (hoja) {
        hoja.getRange(1, 1, 1, hoja.getMaxColumns()).clearContent();
        hoja.getRange(1, 1, 1, headersArray.length).setValues([headersArray]);

        const range = hoja.getRange(1, 1, 1, headersArray.length);
        range.setBackground(FORMATOS.HEADER_BG_COLOR || '#1a237e');
        range.setFontColor(FORMATOS.HEADER_FONT_COLOR || '#ffffff');
        range.setFontWeight('bold');

        Logger.log('✅ Hoja ' + nombreHoja + ' sincronizada.');
      }
    });
    Logger.log('✅ COMPLETADO — Ahora vuelve a ejecutar crearExpedientesDesdeContribuyentes_()');
  } catch (err) {
    Logger.log('❌ Error: ' + err.message);
  }
}

// ============================================================
// REPARAR CAMPOS DERIVADOS DE EXPEDIENTES
// ============================================================

/**
 * Recalcula y corrige FECHA_ULTIMA_GESTION, RESULTADO_ULTIMA_GESTION y ESTADO_EXPEDIENTE
 * en todos los expedientes que estén desincronizados respecto a la hoja GESTIONES.
 *
 * Ejecución manual desde la consola GAS — no afecta gestiones ni otros datos.
 * Usa batchUpdateRows_ para escribir en una sola llamada API por bloque.
 */
function repararCamposDesdeGestiones_() {
  try {
    Logger.log('=== REPARAR CAMPOS DERIVADOS DESDE GESTIONES ===');

    const ss     = getSpreadsheet_();
    const shExp  = ss.getSheetByName(SHEET_NAMES.EXPEDIENTES);
    const shGes  = ss.getSheetByName(SHEET_NAMES.GESTIONES);

    const expData = shExp.getDataRange().getValues();
    const gesData = shGes.getDataRange().getValues();

    const expHeaders = expData[0];
    const gesHeaders = gesData[0];

    const iExpId    = expHeaders.indexOf('ID_EXPEDIENTE');
    const iFechaUlt = expHeaders.indexOf('FECHA_ULTIMA_GESTION');
    const iResUlt   = expHeaders.indexOf('RESULTADO_ULTIMA_GESTION');
    const iEstado   = expHeaders.indexOf('ESTADO_EXPEDIENTE');

    const iGesExp    = gesHeaders.indexOf('ID_EXPEDIENTE');
    const iGesDate   = gesHeaders.indexOf('FECHA_REGISTRO');
    const iGesRes    = gesHeaders.indexOf('RESULTADO');
    const iGesEstado = gesHeaders.indexOf('ESTADO_POST_GESTION');

    if ([iExpId, iFechaUlt, iResUlt, iEstado, iGesExp, iGesDate, iGesRes].includes(-1)) {
      Logger.log('❌ No se encontraron todas las columnas necesarias. Verifica los headers.');
      return;
    }

    // Agrupar gestiones por expediente → conservar la más reciente por FECHA_REGISTRO
    const ultimaGestion = {};
    for (let i = 1; i < gesData.length; i++) {
      const id     = gesData[i][iGesExp];
      const fecha  = gesData[i][iGesDate];
      const res    = gesData[i][iGesRes];
      const estado = iGesEstado >= 0 ? gesData[i][iGesEstado] : '';
      if (!id || !fecha) continue;
      if (!ultimaGestion[id] || fecha > ultimaGestion[id].fecha) {
        ultimaGestion[id] = { fecha, resultado: res, estadoPost: estado };
      }
    }

    // Detectar expedientes desincronizados
    const actualizaciones = [];
    let sinGestion  = 0;
    let yaCorrectos = 0;

    for (let i = 1; i < expData.length; i++) {
      const id = expData[i][iExpId];
      if (!id) continue;

      const ult = ultimaGestion[id];
      if (!ult) { sinGestion++; continue; }

      const fechaSheet  = String(expData[i][iFechaUlt] || '').substring(0, 10);
      const resSheet    = expData[i][iResUlt];
      const estadoSheet = expData[i][iEstado];
      const fechaReal   = String(ult.fecha).substring(0, 10);

      const fechaOk  = fechaSheet  === fechaReal;
      const resOk    = resSheet    === ult.resultado;
      const estadoOk = !ult.estadoPost || estadoSheet === ult.estadoPost;

      if (fechaOk && resOk && estadoOk) { yaCorrectos++; continue; }

      const campos = {
        FECHA_ULTIMA_GESTION:     ult.fecha,
        RESULTADO_ULTIMA_GESTION: ult.resultado
      };

      // Solo actualizar estado si la gestión indicó un estado post-gestión explícito
      if (ult.estadoPost && CATALOGOS.ESTADOS_EXPEDIENTE.includes(ult.estadoPost)) {
        campos['ESTADO_EXPEDIENTE'] = ult.estadoPost;
      }

      actualizaciones.push({ rowIndex: i + 1, campos });
    }

    Logger.log('Ya correctos:     ' + yaCorrectos);
    Logger.log('Sin gestión:      ' + sinGestion);
    Logger.log('A reparar:        ' + actualizaciones.length);

    if (actualizaciones.length === 0) {
      Logger.log('✅ Todos los expedientes están sincronizados. No hay nada que reparar.');
      return;
    }

    // Aplicar correcciones en batch
    batchUpdateRows_(SHEET_NAMES.EXPEDIENTES, actualizaciones);

    // Limpiar caché para que la página muestre los datos actualizados
    invalidarCacheMaestro_();
    invalidarCacheDashboard_();

    Logger.log('✅ COMPLETADO — ' + actualizaciones.length + ' expediente(s) reparados. Caché limpiado.');

  } catch (err) {
    Logger.log('❌ Error en repararCamposDesdeGestiones_: ' + err.message);
  }
}
