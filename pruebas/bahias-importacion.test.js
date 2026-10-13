'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargar } = require('./cargar-gs');

function entorno(filas) {
  const e = cargar('bahias', ['Constants.gs', 'Production.gs']);
  e.ctx.getHoja_ = () => ({ getDataRange: () => ({ getValues: () => filas }) });
  return e;
}

const ENCABEZADO = ['IDENTIFICACION', 'COMERCIANTE', 'NO DE PUESTO', 'TIPO DE RUBRO',
  'PERIODO DESDE', 'PERIODO HASTA', 'TOTAL DE DEUDA', 'TOTAL POR COBRAR'];

test('normaliza encabezados: sin tildes, mayúsculas y guion bajo', () => {
  const { ctx } = entorno([ENCABEZADO]);
  assert.equal(ctx._normalizeImportHeader_(' Código CEP '), 'CODIGO_CEP');
  assert.equal(ctx._normalizeImportHeader_('Mercado / Sector'), 'MERCADO_SECTOR');
});

test('identificación: completa ceros perdidos y rechaza longitudes inválidas', () => {
  const { ctx } = entorno([ENCABEZADO]);
  assert.equal(ctx._normalizeImportValue_('RUC', '990000000'), '0990000000');
  assert.equal(ctx._normalizeImportValue_('RUC', '990000000001'), '0990000000001');
  assert.equal(ctx._normalizeImportValue_('RUC', '09-9000.0000'), '0990000000');
  assert.equal(ctx._normalizeImportValue_('RUC', '12345'), '');
});

test('importes: acepta coma o punto como decimal y separadores de miles', () => {
  const { ctx } = entorno([ENCABEZADO]);
  assert.equal(ctx._parseImportAmount_('1.234,56'), 1234.56);
  assert.equal(ctx._parseImportAmount_('1,234.56'), 1234.56);
  assert.equal(ctx._parseImportAmount_('12,5'), 12.5);
  assert.equal(ctx._parseImportAmount_('$ 100'), 100);
  assert.equal(ctx._parseImportAmount_(''), 0);
});

test('sin identificación oficial genera un identificador interno estable', () => {
  const { ctx } = entorno([ENCABEZADO]);
  const a = { RUC: '', NOMBRE_CONTRIBUYENTE: 'Comerciante Uno', NO_DE_PUESTO: '12' };
  const b = { RUC: '', NOMBRE_CONTRIBUYENTE: 'Comerciante Uno', NO_DE_PUESTO: '12' };
  assert.equal(ctx._ensureImportIdentity_(a), true);
  ctx._ensureImportIdentity_(b);
  assert.match(a.RUC, /^SINID-[A-F0-9]{16}$/);
  assert.equal(a.RUC, b.RUC);
  assert.equal(ctx._ensureImportIdentity_({ RUC: '0990000000001' }), false);
});

test('validación: exige campos y rechaza montos negativos', () => {
  const { ctx } = entorno([ENCABEZADO]);
  const ok = { RUC: '0990000000001', NOMBRE_CONTRIBUYENTE: 'A', NO_DE_PUESTO: '1',
    TIPO_IMPUESTO: 'X', PERIODO_DESDE: '2025-01-01', PERIODO_HASTA: '2025-12-31', TOTAL_DEUDA: 10 };
  assert.equal(ctx._validateImportRecord_(ok).length, 0);
  assert.ok(ctx._validateImportRecord_({ ...ok, NOMBRE_CONTRIBUYENTE: '' }).length > 0);
  assert.ok(ctx._validateImportRecord_({ ...ok, TOTAL_DEUDA: -1 }).some(m => /negativos/.test(m)));
});

test('vista previa: acepta, descarta duplicados exactos, rechaza y detecta conflictos', () => {
  const fila = (id, puesto, deuda) => [id, 'Comerciante ' + puesto, puesto, 'Tasa', '2025-01-01', '2025-12-31', deuda, deuda];
  const filas = [
    ENCABEZADO,
    fila('0990000000001', '1', 100),
    fila('0990000000001', '1', 100),      // duplicado exacto
    fila('0990000000001', '1', 250),      // misma obligación, otro valor: conflicto
    fila('0990000000001', '2', 80),       // otra obligación del mismo contribuyente
    ['0990000000001', '', '3', 'Tasa', '2025-01-01', '2025-12-31', 5, 5], // sin nombre: rechazada
  ];
  const { ctx } = entorno(filas);
  const r = ctx._analyzeProductionImport_();
  assert.equal(r.sourceRows, 5);
  assert.equal(r.accepted.length, 2);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.uniqueContribuyentes, 1);
});

test('la suma de verificación cambia si cambia un dato', () => {
  const base = [ENCABEZADO, ['0990000000001', 'A', '1', 'Tasa', '2025-01-01', '2025-12-31', 10, 10]];
  const a = entorno(base).ctx._analyzeProductionImport_().checksum;
  const b = entorno(base).ctx._analyzeProductionImport_().checksum;
  const c = entorno([ENCABEZADO, ['0990000000001', 'A', '1', 'Tasa', '2025-01-01', '2025-12-31', 11, 10]])
    .ctx._analyzeProductionImport_().checksum;
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('falta una columna requerida: la vista previa falla con mensaje claro', () => {
  const sinPuesto = ENCABEZADO.filter(h => h !== 'NO DE PUESTO');
  const { ctx } = entorno([sinPuesto, ['0990000000001', 'A', 'Tasa', '2025-01-01', '2025-12-31', 1, 1]]);
  assert.throws(() => ctx._analyzeProductionImport_(), /Falta la columna requerida: NO_DE_PUESTO/);
});
