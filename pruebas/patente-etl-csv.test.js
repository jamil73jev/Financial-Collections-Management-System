'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargar } = require('./cargar-gs');

function entorno() {
  return cargar('patente-municipal', ['DriveImportService.gs']);
}

test('CSV: detecta el punto y coma y quita el prefijo «Suma de»', () => {
  const { ctx } = entorno();
  const csv = 'AnioSolicitud;Suma de ValorImpuesto;Nombre Contribuyente\n2025;100,50;Contribuyente Uno\n';
  const [fila] = ctx._parsearCSV(csv);
  assert.equal(fila.ANIOSOLICITUD, '2025');
  assert.equal(fila.VALORIMPUESTO, '100,50');
  assert.equal(fila.NOMBRE_CONTRIBUYENTE, 'Contribuyente Uno');
});

test('CSV: ignora el BOM y respeta comas dentro de comillas', () => {
  const { ctx } = entorno();
  const csv = '﻿RUC,NOMBRECONTRIBUYENTE\n0990000000001,"EMPRESA, UNO S.A."\n';
  const filas = ctx._parsearCSV(csv);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].NOMBRECONTRIBUYENTE, 'EMPRESA, UNO S.A.');
});

test('CSV: quita tildes de los encabezados', () => {
  const { ctx } = entorno();
  const [fila] = ctx._parsearCSV('Año Solicitud,Teléfono Gestión\n2025,0999999999\n');
  assert.equal(fila.ANO_SOLICITUD, '2025');
  assert.equal(fila.TELEFONO_GESTION, '0999999999');
});

test('CSV: un archivo sin filas de datos devuelve una lista vacía', () => {
  const { ctx } = entorno();
  assert.equal(ctx._parsearCSV('RUC,NOMBRE\n').length, 0);
});

test('syncMasterData (ImportService): mapea columnas, convierte importes y descarta filas sin RUC', () => {
  const escritas = [];
  const { ctx, evaluar } = cargar('patente-municipal', ['Constants.gs', 'ImportService.gs'], {
    overwriteDataSection: (hoja, filas) => escritas.push({ hoja, filas }),
    appendRow() {},
    logActionSystem() {},
    invalidarCacheDashboard() {},
  });
  const resultado = ctx.syncMasterData([
    { ANIOSOLICITUD: '2025', IMPUESTO: 'PATENTE', RUC: '0990000000001', NOMBRECONTRIBUYENTE: 'Uno',
      SUMVALORIMPUESTO: '100,50', SUMVALORINTERES: '5', SUMVALORMULTA: '0', SUMVALORRECARGO: '1', SUMVALORPENDIENTE: '106,5' },
    { ANIOSOLICITUD: '2025', IMPUESTO: 'PATENTE', RUC: '', NOMBRECONTRIBUYENTE: 'Sin RUC' },
  ], true);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.cargados, 1);
  assert.equal(escritas.length, 1);
  const fila = escritas[0].filas[0];
  assert.equal(fila[2], '0990000000001');
  assert.equal(fila[10], 100.5);
  assert.equal(fila[14], 106.5);
  assert.equal(evaluar('SHEET_NAMES.CONTRIBUYENTES'), escritas[0].hoja);
});

test('syncMasterData: sin datos devuelve error', () => {
  const { ctx } = cargar('patente-municipal', ['Constants.gs', 'ImportService.gs']);
  assert.equal(ctx.syncMasterData([], true).ok, false);
});
