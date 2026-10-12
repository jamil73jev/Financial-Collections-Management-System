/**
 * PowerBITest.gs
 * Funciones de prueba y diagnóstico para la conexión con Power BI.
 * Ejecutar desde el editor Apps Script.
 */

/**
 * Prueba completa de la conexión Power BI
 * Ejecutar: testPowerBIConnection()
 */
function testPowerBIConnection() {
  Logger.log('=== INICIANDO PRUEBA DE CONEXIÓN POWER BI ===\n');

  const resultados = {
    timestamp: new Date().toISOString(),
    pruebas: {}
  };

  // PRUEBA 1: Verificar que existe la API Key configurada
  resultados.pruebas.apiKey = testAPIKey();

  // PRUEBA 2: Verificar que handlePowerBIRequest es accesible
  resultados.pruebas.handlePowerBI = testHandlePowerBIRequest();

  // PRUEBA 3: Prueba de sincronización con datos de prueba
  resultados.pruebas.syncTest = testSyncMasterData();

  // PRUEBA 4: Verificar integridad de la hoja destino
  resultados.pruebas.sheetIntegrity = testSheetIntegrity();

  // RESUMEN
  printResultados(resultados);

  return resultados;
}

/**
 * Prueba 1: Validar que la API Key está configurada
 */
function testAPIKey() {
  try {
    const configuredKey = PARAMS.POWERBI_API_KEY;
    const pythonKey = 'SIGECO_POWERBI_BRIDGE_2024'; // Value from sync_powerbi.py

    const test = {
      status: 'OK',
      apiKeyConfigured: !!configuredKey,
      keyMatch: configuredKey === pythonKey,
      details: {
        configKey: configuredKey,
        pythonKey: pythonKey,
        coinciden: configuredKey === pythonKey ? '✅ SÍ' : '❌ NO'
      }
    };

    if (!test.apiKeyConfigured) {
      test.status = 'ERROR';
      test.error = 'POWERBI_API_KEY no está configurada en Constants.gs';
    } else if (!test.keyMatch) {
      test.status = 'ERROR';
      test.error = 'API Key no coincide entre Constants.gs y sync_powerbi.py';
    }

    Logger.log('✓ PRUEBA 1 - API Key: ' + test.status);
    return test;
  } catch (e) {
    Logger.log('✗ PRUEBA 1 - API Key: ERROR - ' + e.message);
    return { status: 'ERROR', error: e.message };
  }
}

/**
 * Prueba 2: Verificar que handlePowerBIRequest existe y es accesible
 */
function testHandlePowerBIRequest() {
  try {
    // Crear payload de prueba válido
    const testPayload = {
      key: PARAMS.POWERBI_API_KEY,
      action: 'syncMasterData',
      reemplazar: false,
      data: [
        {
          RUC: '0912345678901',
          NOMBRE_CONTRIBUYENTE: 'TEST EMPRESA XYZ',
          TIPO_PERSONA: 'J'
        }
      ]
    };

    // Intentar llamar a la función
    const response = handlePowerBIRequest(testPayload);

    const test = {
      status: response.ok ? 'OK' : 'ERROR',
      functionExists: true,
      response: response,
      details: {
        ok: response.ok,
        error: response.error || 'N/A',
        cargados: response.cargados || 0
      }
    };

    Logger.log('✓ PRUEBA 2 - handlePowerBIRequest: ' + test.status);
    return test;
  } catch (e) {
    Logger.log('✗ PRUEBA 2 - handlePowerBIRequest: ERROR - ' + e.message);
    return {
      status: 'ERROR',
      functionExists: false,
      error: e.message
    };
  }
}

/**
 * Prueba 3: Prueba de sincronización completa con datos de prueba
 */
function testSyncMasterData() {
  try {
    const testData = [
      {
        RUC: 'TEST0912345678901',
        NOMBRE_CONTRIBUYENTE: 'EMPRESA TEST ABC',
        TIPO_PERSONA: 'J',
        DIRECCION: 'Calle Principal 123',
        CORREO: 'test@empresa.com',
        TELEFONO: '0991234567',
        REPRESENTANTE_LEGAL: 'Juan Pérez Test',
        ACTIVIDAD_ECONOMICA: 'Comercio',
        ESTADO_DECLARACION: 'DEUDOR',
        TIPO_DECLARACION: 'DEFINITIVA',
        VALOR_IMPUESTO: 1200.00,
        RECARGO: 80.00,
        INTERESES: 45.00,
        TOTAL_DEUDA: 1325.00,
        ANIO: '2024',
        PERIODO: '2024',
        ID_TITULO_CREDITO: 'TEST-TC-001',
        ID_ESTADO_TITULO: 'ACTIVO'
      },
      {
        RUC: 'TEST0923456789012',
        NOMBRE_CONTRIBUYENTE: 'DISTRIBUIDORA TEST XYZ',
        TIPO_PERSONA: 'J',
        DIRECCION: 'Avenida Secundaria 456',
        CORREO: 'xyz@distribuidora.com',
        TELEFONO: '0992345678',
        REPRESENTANTE_LEGAL: 'María López Test',
        ACTIVIDAD_ECONOMICA: 'Distribución',
        ESTADO_DECLARACION: 'DEUDOR',
        TIPO_DECLARACION: 'DEFINITIVA',
        VALOR_IMPUESTO: 850.00,
        RECARGO: 55.00,
        INTERESES: 30.00,
        TOTAL_DEUDA: 935.00,
        ANIO: '2024',
        PERIODO: '2024',
        ID_TITULO_CREDITO: 'TEST-TC-002',
        ID_ESTADO_TITULO: 'ACTIVO'
      }
    ];

    const payload = {
      key: PARAMS.POWERBI_API_KEY,
      action: 'syncMasterData',
      reemplazar: false,
      data: testData
    };

    const response = handlePowerBIRequest(payload);

    const test = {
      status: response.ok ? 'OK' : 'ERROR',
      recordsCargados: response.cargados || 0,
      tabla: response.tabla || 'N/A',
      response: response,
      details: {
        enviados: testData.length,
        cargados: response.cargados || 0,
        tabla: response.tabla || 'N/A',
        ok: response.ok
      }
    };

    Logger.log('✓ PRUEBA 3 - Sync Test Data: ' + test.status + ' (' + test.recordsCargados + ' registros)');
    return test;
  } catch (e) {
    Logger.log('✗ PRUEBA 3 - Sync Test Data: ERROR - ' + e.message);
    return { status: 'ERROR', error: e.message };
  }
}

/**
 * Prueba 4: Verificar integridad de hojas destino
 */
function testSheetIntegrity() {
  try {
    const ss = getSpreadsheet();

    // Hojas esperadas para Power BI
    const expectedSheets = ['DATA_POWERBI_IMPORT', 'CONTRIBUYENTES', 'FACT_DETALLE_15MIL'];

    const test = {
      status: 'OK',
      sheetsChecked: [],
      ss_name: ss.getName()
    };

    for (const sheetName of expectedSheets) {
      const hoja = ss.getSheetByName(sheetName);
      test.sheetsChecked.push({
        nombre: sheetName,
        existe: !!hoja,
        filas: hoja ? hoja.getLastRow() : 0,
        columnas: hoja ? hoja.getLastColumn() : 0
      });
    }

    Logger.log('✓ PRUEBA 4 - Sheet Integrity: OK');
    return test;
  } catch (e) {
    Logger.log('✗ PRUEBA 4 - Sheet Integrity: ERROR - ' + e.message);
    return { status: 'ERROR', error: e.message };
  }
}

/**
 * Imprime los resultados de manera legible
 */
function printResultados(resultados) {
  Logger.log('\n=== RESUMEN DE VERIFICACIÓN ===');
  Logger.log('Timestamp: ' + resultados.timestamp);
  Logger.log('');

  let todasOK = true;
  for (const [prueba, resultado] of Object.entries(resultados.pruebas)) {
    const status = resultado.status || 'DESCONOCIDO';
    Logger.log(prueba + ': ' + status);
    if (status !== 'OK') {
      todasOK = false;
      Logger.log('  Error: ' + (resultado.error || 'Sin detalles'));
    }
  }

  Logger.log('');
  Logger.log('=== ESTADO GENERAL ===');
  Logger.log(todasOK ? '✅ TODAS LAS PRUEBAS PASARON' : '⚠️ ALGUNAS PRUEBAS FALLARON');
  Logger.log('');
  Logger.log('Para ver detalles completos, revisa los logs de Apps Script.');
}

/**
 * Función auxiliar para verificar doPost
 * Simula un POST request desde Power BI
 */
function simulateDoPost() {
  try {
    Logger.log('\n=== SIMULANDO POST REQUEST ===\n');

    const simulatedRequest = {
      postData: {
        contents: JSON.stringify({
          key: PARAMS.POWERBI_API_KEY,
          action: 'syncMasterData',
          reemplazar: false,
          data: [
            {
              RUC: 'SIM0912345678901',
              NOMBRE_CONTRIBUYENTE: 'EMPRESA SIMULADA',
              TIPO_PERSONA: 'J'
            }
          ]
        })
      }
    };

    // Llamar doPost con el simulado request
    const result = doPost(simulatedRequest);
    const resultParsed = JSON.parse(result.getContent());

    Logger.log('✓ doPost ejecutado correctamente');
    Logger.log('Respuesta: ' + JSON.stringify(resultParsed, null, 2));

    return {
      status: 'OK',
      response: resultParsed
    };
  } catch (e) {
    Logger.log('✗ Error simulando doPost: ' + e.message);
    return {
      status: 'ERROR',
      error: e.message
    };
  }
}

