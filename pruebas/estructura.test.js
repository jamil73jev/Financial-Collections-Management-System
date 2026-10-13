'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { funciones, archivosGs } = require('./cargar-gs');

/** Mapa nombre -> archivos que lo declaran, solo para los nombres repetidos. */
function duplicadas(instancia) {
  const mapa = {};
  for (const archivo of archivosGs(instancia)) {
    for (const nombre of funciones(instancia, archivo)) (mapa[nombre] ||= []).push(archivo);
  }
  return Object.fromEntries(Object.entries(mapa).filter(([, v]) => v.length > 1));
}

test('Bahías no tiene funciones declaradas dos veces', () => {
  assert.deepEqual(duplicadas('bahias'), {});
});

// Hallazgo conocido (docs/pendientes-tecnicos.md, punto 1). Si esta prueba falla
// porque la lista cambió, actualizar el documento junto con esta lista.
const CONOCIDAS_PATENTE = [
  '_fmt', '_hashPasswordConSalt', 'diagnosticarContribuyentes', 'getAlertSummary', 'getBitacora',
  'getConfigMap', 'getExpediente', 'getGestiones', 'getHistorialExpediente', 'getSeguimientoData',
  'runFullCheck', 'setConfig', 'syncMasterData',
];

test('Patente Municipal: las funciones duplicadas son exactamente las conocidas', () => {
  assert.deepEqual(Object.keys(duplicadas('patente-municipal')).sort(), CONOCIDAS_PATENTE);
});

test('ningún archivo del proyecto contiene contraseñas ni claves literales', () => {
  const patron = /(password|clave|apikey|api_key|secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i;
  const permitidos = /TestData|Setup\.gs|SecretsService|Constants\.gs/;
  for (const instancia of ['bahias', 'patente-municipal']) {
    for (const archivo of archivosGs(instancia)) {
      if (permitidos.test(archivo)) continue;
      const texto = fs.readFileSync(path.join(__dirname, '..', 'apps-script', instancia, archivo), 'utf8');
      assert.doesNotMatch(texto, patron, `${instancia}/${archivo}`);
    }
  }
});
