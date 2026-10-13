'use strict';
// Carga archivos .gs reales de Apps Script en un contexto de Node con las
// APIs de Google simuladas, para probar la lógica sin desplegar nada.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..', 'apps-script');

function utilities() {
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_alg, texto) =>
      Array.from(crypto.createHash('sha256').update(String(texto), 'utf8').digest())
        .map(b => (b > 127 ? b - 256 : b)),
    formatDate: (fecha, _zona, formato) => {
      const d = new Date(fecha);
      const p = n => String(n).padStart(2, '0');
      const base = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
      return formato.startsWith("yyyy-MM-dd'T'")
        ? `${base}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
        : base;
    },
  };
}

/** Crea un contexto con las APIs de Google simuladas y carga los archivos pedidos. */
function cargar(instancia, archivos, extra = {}) {
  const ctx = vm.createContext({
    console,
    Logger: { log() {} },
    Utilities: utilities(),
    MimeType: { CSV: 'text/csv' },
    ...extra,
  });
  for (const archivo of archivos) {
    const ruta = path.join(RAIZ, instancia, archivo);
    vm.runInContext(fs.readFileSync(ruta, 'utf8'), ctx, { filename: ruta });
  }
  return {
    ctx,
    /** Evalúa una expresión dentro del contexto (también ve las constantes `const`). */
    evaluar: expresion => vm.runInContext(expresion, ctx),
  };
}

/** Funciones declaradas con `function nombre(` en el nivel superior de un archivo. */
function funciones(instancia, subruta) {
  const ruta = path.join(RAIZ, instancia, subruta);
  const texto = fs.readFileSync(ruta, 'utf8');
  return [...texto.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1]);
}

/** Todos los .gs de un proyecto, incluida la carpeta Scripts. */
function archivosGs(instancia) {
  const dir = path.join(RAIZ, instancia);
  const lista = [];
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.gs')) lista.push(f);
    if (f === 'Scripts') {
      for (const g of fs.readdirSync(path.join(dir, f))) if (g.endsWith('.gs')) lista.push(`Scripts/${g}`);
    }
  }
  return lista.sort();
}

module.exports = { cargar, funciones, archivosGs };
