/**
 * ExpedienteAPI.gs
 * API de expedientes para el frontend (Index.html)
 * Funciones: listExpedientes_, getExpediente_, getHistorialExpediente_
 */

/**
 * Lista expedientes con paginación y filtros.
 * @param {string} token
 * @param {number} pagina (1-indexed)
 * @param {Object} filtros { busqueda, estado, prioridad, alerta, tipoPersona }
 * @returns {{ ok, expedientes[], total, pagina, pageSize }}
 */
function listExpedientes_(token, pagina, filtros) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  pagina = Math.max(1, parseInt(pagina) || 1);
  const pageSize = PARAMS.PAGE_SIZE || 50;
  filtros = filtros || {};

  try {
    let expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);

    // Aplicar filtros
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      expedientes = expedientes.filter(e =>
        String(e.ID_EXPEDIENTE || '').toLowerCase().includes(q) ||
        String(e.CONTRIBUYENTE || '').toLowerCase().includes(q) ||
        String(e.RUC || '').toLowerCase().includes(q)
      );
    }

    if (filtros.estado && filtros.estado !== '') {
      expedientes = expedientes.filter(e => e.ESTADO_EXPEDIENTE === filtros.estado);
    }

    if (filtros.prioridad && filtros.prioridad !== '') {
      expedientes = expedientes.filter(e => e.PRIORIDAD === filtros.prioridad);
    }

    if (filtros.alerta && filtros.alerta !== '') {
      expedientes = expedientes.filter(e => e.ALERTA_ESTADO === filtros.alerta);
    }
    
    if (filtros.tipoPersona && filtros.tipoPersona !== '') {
      expedientes = expedientes.filter(e => e.MERCADO_SECTOR === filtros.tipoPersona);
    }

    // Control de acceso: GESTOR solo ve sus propios, SUPERVISOR ve todos
    if (sesion.rol === 'GESTOR') {
      const usuarioLower = String(sesion.usuario || '').toLowerCase();
      expedientes = expedientes.filter(e =>
        String(e.FUNCIONARIO_ASIGNADO || '').toLowerCase() === usuarioLower || !e.FUNCIONARIO_ASIGNADO
      );
    }

    // Paginación
    const total = expedientes.length;
    const inicio = (pagina - 1) * pageSize;
    const fin = inicio + pageSize;
    const paginados = expedientes.slice(inicio, fin);

    // Mapear para respuesta
    const resultado = paginados.map(e => ({
      id:                  e.ID_EXPEDIENTE,
      codigoInterno:       e.CODIGO_INTERNO,
      ruc:                 e.RUC,
      contribuyente:       e.CONTRIBUYENTE,
      mercadoSector:       e.MERCADO_SECTOR,
      giroNegocio:         e.GIRO_DEL_NEGOCIO,
      estadoComerciant:    e.ESTADO_COMERCIANTE,
      estadoDeDeuda:       e.ESTADO_DE_DEUDA,
      tipoObligacion:      e.TIPO_OBLIGACION,
      estadoExpediente:    e.ESTADO_EXPEDIENTE,
      prioridad:           e.PRIORIDAD,
      funcionarioAsignado: e.FUNCIONARIO_ASIGNADO,
      fechaAsignacion:     e.FECHA_ASIGNACION,
      fechaUltimaGestion:  e.FECHA_ULTIMA_GESTION,
      fechaProximaGestion: e.FECHA_PROXIMA_GESTION,
      fechaProxima:        e.FECHA_PROXIMA_GESTION,
      diasSinMovimiento:   parseInt(e.DIAS_SIN_MOVIMIENTO) || 0,
      resultadoUltimaGestion: e.RESULTADO_ULTIMA_GESTION,
      observacionGeneral:  e.OBSERVACION_GENERAL,
      alertaEstado:        e.ALERTA_ESTADO,
      totalDeuda:          parseFloat(e.TOTAL_DEUDA) || 0,
      totalPorCobrar:      parseFloat(e.TOTAL_POR_COBRAR) || 0,
      activo:              e.ACTIVO === 'TRUE' || e.ACTIVO === true
    }));

    return {
      ok: true,
      expedientes: resultado,
      total,
      pagina,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };

  } catch (err) {
    Logger.log('listExpedientes_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene detalle completo de un expediente.
 * @param {string} token
 * @param {string} idExpediente
 * @returns {{ ok, expediente: {...}, error? }}
 */
function getExpediente_(token, idExpediente) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    // INTENTAR DESDE CACHÉ MAESTRO (Mucho más rápido)
    const masterCacheKey = 'expedientes_master_list';
    let expedientes = getLargeCache_(masterCacheKey);
    
    if (!expedientes) {
      Logger.log('📂 getExpediente_: Caché Maestro vacío, leyendo de hoja...');
      expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
    }

    const exp = expedientes.find(e => e.ID_EXPEDIENTE === idExpediente || e.id === idExpediente);

    if (!exp) return { ok: false, error: 'Expediente no encontrado.' };

    // Control de acceso
    if (sesion.rol === 'GESTOR') {
      const usuarioLower = String(sesion.usuario || '').toLowerCase();
      if (String(exp.FUNCIONARIO_ASIGNADO || '').toLowerCase() !== usuarioLower) {
        return { ok: false, error: 'No tienes acceso a este expediente.' };
      }
    }

    // ── NORMALIZACIÓN DE RUC (robusta) ──────────────────────────────────────
    // Google Sheets puede almacenar RUCs como: número float (9.93e11), string
    // con cero inicial (0993...), sin cero (993...), con comas (993,470,123),
    // o incluso en notación científica. La solución: extraer SOLO los dígitos
    // y comparar sin ceros iniciales.
    const soloDigitos = (v) => {
      if (v === null || v === undefined || v === '') return '';
      // Convertir flotante a entero si es necesario (9.93232637001E11 → "993232637001")
      let s = String(v).trim();
      // Si es notación científica, convertir a número entero exacto
      if (s.includes('E') || s.includes('e')) {
        try { s = String(Math.round(parseFloat(s))); } catch(e) {}
      }
      // Eliminar .0 o decimales de flotante
      s = s.replace(/\.\d+$/, '');
      // Quitar todo lo que no sea dígito
      return s.replace(/[^0-9]/g, '');
    };

    const sinCerosIniciales = (s) => s.replace(/^0+/, '') || '0';

    const rucExpRaw  = soloDigitos(exp.ruc || exp.RUC);
    const rucExpNorm = sinCerosIniciales(rucExpRaw);
    
    // ── BÚSQUEDA HÍBRIDA (VELOCIDAD + FIABILIDAD DE VERSIÓN ANTERIOR) ───────
    // 1. Normalización para búsqueda
    const normalizarParaMatch = (txt) => String(txt || '').trim().toUpperCase()
                                         .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar tildes
                                         .replace(/[^A-Z0-9]/g, ''); // Solo letras y números

    const nombreBuscadoNorm = normalizarParaMatch(exp.contribuyente || exp.CONTRIBUYENTE);
    const rucBuscadoNorm = normalizarParaMatch(exp.ruc || exp.RUC);

    const hojaCon = getHoja_(SHEET_NAMES.CONTRIBUYENTES);
    const lastRowCon = hojaCon.getLastRow();
    
    // 2. BÚSQUEDA CAPA 1: Por RUC (Usando TextFinder que es rápido)
    let filasMatch = [];
    const finderRUC = hojaCon.getRange("B:B").createTextFinder(rucExpNorm).matchEntireCell(false).findAll();
    filasMatch = finderRUC.map(c => c.getRow());

    // 3. BÚSQUEDA CAPA 2: Por Nombre (Si el RUC falló)
    if (filasMatch.length === 0) {
      Logger.log("getExpediente_: Buscando por NOMBRE (Capa de Respaldo)...");
      // Buscamos los primeros 5000 registros para velocidad, si no toda la hoja
      const nomValues = hojaCon.getRange(1, 1, Math.min(lastRowCon, 10000), 10).getValues(); // Leemos bloque inicial
      for (let i = 0; i < nomValues.length; i++) {
        // Revisamos columna B (RUC) y C (Nombre) por si acaso
        const rucHoja = normalizarParaMatch(nomValues[i][1]);
        const nomHoja = normalizarParaMatch(nomValues[i][2]);
        
        if (rucHoja === rucBuscadoNorm || nomHoja === nombreBuscadoNorm) {
          filasMatch.push(i + 1);
        }
      }
    }

    // 4. BÚSQUEDA CAPA 3: TextFinder Global (Último recurso)
    if (filasMatch.length === 0) {
      const globalFinder = hojaCon.createTextFinder(rucExpNorm).matchEntireCell(false).findAll();
      filasMatch = globalFinder.map(c => c.getRow());
    }

    // Eliminar duplicados
    filasMatch = [...new Set(filasMatch)].filter(f => f > 1);

    let impuestosContrib = [];
    if (filasMatch.length > 0) {
      // Obtenemos los encabezados dinámicamente
      const headersCon = hojaCon.getRange(1, 1, 1, hojaCon.getLastColumn()).getValues()[0]
        .map(h => String(h || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, ''));
      
      impuestosContrib = filasMatch.map(rowNum => {
        const rowData = hojaCon.getRange(rowNum, 1, 1, headersCon.length).getValues()[0];
        const obj = {};
        headersCon.forEach((h, idx) => { if(h) obj[h] = rowData[idx]; });
        return obj;
      });
    }

    // Utilidad interna para parseo robusto de números (maneja "13,02" o 13.02)
    const _parseFloatRobust = (v) => {
      if (typeof v === 'number') return v;
      if (!v) return 0;
      let s = String(v).replace(/[^0-9,.-]/g, '').replace(/,/g, '.');
      let n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };

    // Calcular totales consolidados
    const totalDeudaConsolidada = impuestosContrib.reduce((acc, c) => {
      const v = _parseFloatRobust(c.TOTAL_DEUDA || c.TOTALDEDEUDA || 0);
      return acc + v;
    }, 0);
    const totalPorCobrarConsolidado = impuestosContrib.reduce((acc, c) => {
      const v = _parseFloatRobust(c.TOTAL_POR_COBRAR || c.TOTALACOBRAR || 0);
      return acc + v;
    }, 0);

    // Mapear cada rubro individualmente para el desglose en frontend
    const detalleImpuestos = impuestosContrib.map(c => ({
      noDePuesto:         String(c.NO_DE_PUESTO || ''),
      mercadoSector:      String(c.MERCADO_SECTOR || ''),
      tipoRubro:          String(c.TIPO_IMPUESTO || 'OTRO').replace(/_/g, ' '),
      estadoDeDeuda:      String(c.ESTADO_DE_DEUDA || ''),
      periodoDesde:       String(c.PERIODO_DESDE || ''),
      periodoHasta:       String(c.PERIODO_HASTA || ''),
      totalDeuda:         _parseFloatRobust(c.TOTAL_DEUDA),
      totalPorCobrar:     _parseFloatRobust(c.TOTAL_POR_COBRAR)
    }));

    // Datos base del primer registro (información general del contribuyente)
    const contribBase = impuestosContrib.length > 0 ? impuestosContrib[0] : null;

    return {
      ok: true,
      expediente: {
        id:                  exp.id || exp.ID_EXPEDIENTE,
        codigoInterno:       exp.codigoInterno || exp.CODIGO_INTERNO,
        ruc:                 exp.ruc || exp.RUC,
        contribuyente:       exp.contribuyente || exp.CONTRIBUYENTE,
        mercadoSector:       exp.mercadoSector || exp.MERCADO_SECTOR,
        giroNegocio:         exp.giroNegocio || exp.GIRO_DEL_NEGOCIO,
        estadoComerciant:    exp.estadoComerciant || exp.ESTADO_COMERCIANTE,
        estadoDeDeuda:       exp.estadoDeDeuda || exp.ESTADO_DE_DEUDA,
        tipoObligacion:      exp.tipoObligacion || exp.TIPO_OBLIGACION,
        estadoExpediente:    exp.estadoExpediente || exp.ESTADO_EXPEDIENTE,
        prioridad:           exp.prioridad || exp.PRIORIDAD,
        funcionarioAsignado: exp.funcionarioAsignado || exp.FUNCIONARIO_ASIGNADO,
        fechaAsignacion:     exp.fechaAsignacion || exp.FECHA_ASIGNACION,
        fechaUltimaGestion:  exp.fechaUltimaGestion || exp.FECHA_ULTIMA_GESTION,
        fechaProximaGestion: exp.fechaProximaGestion || exp.FECHA_PROXIMA_GESTION,
        diasSinMovimiento:   parseInt(exp.diasSinMovimiento) || 0,
        resultadoUltimaGestion: exp.resultadoUltimaGestion || exp.RESULTADO_ULTIMA_GESTION,
        observacionGeneral:  exp.observacionGeneral || exp.OBSERVACION_GENERAL,
        alertaEstado:        exp.alertaEstado || exp.ALERTA_ESTADO,
        totalDeuda:          parseFloat(exp.totalDeuda || 0),
        totalPorCobrar:      parseFloat(exp.totalPorCobrar || 0),
        activo:              exp.activo === true,
        // Desglose de rubros por puesto
        detalleImpuestos:    detalleImpuestos,
        totalDeudaConsolidada:    totalDeudaConsolidada,
        totalPorCobrarConsolidado: totalPorCobrarConsolidado,
        contribBase: contribBase ? {
          categoriaMercado: contribBase.CATEGORIA_TIPO_MERCADO || '',
          asociacion:       contribBase.ASOCIACION || '',
          codigoCep:        contribBase.CODIGO_CEP || '',
          correoGestion:    contribBase.CORREO_GESTION || '',
          telefonoGestion:  contribBase.TELEFONO_GESTION || ''
        } : null
      }
    };

  } catch (err) {
    Logger.log('getExpediente_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene el desglose BASE BAHÍA usando RUC exacto como criterio principal.
 * El nombre se usa únicamente cuando no se proporciona RUC.
 */
function getDesgloseDetallado_(token, ruc, nombre) {
  try {
    const sesion = verificarSesion_(token);
    if (!sesion) return { ok: false, error: 'Sesión inválida.' };

    const hojaCon = getHoja_(SHEET_NAMES.CONTRIBUYENTES);
    const lastRow = hojaCon.getLastRow();
    const lastCol = hojaCon.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      return {
        ok: true,
        impuestos: [],
        totalConsolidado: 0,
        totalPorCobrarConsolidado: 0,
        contactos: {}
      };
    }

    const norm = t => String(t || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const rucNorm = norm(ruc);
    const nomNorm = norm(nombre);

    const headers = hojaCon.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
      .map(h => String(h || '').trim().toUpperCase()
        .replace(/\s+/g, '_').replace(/[^A-ZÁÉÍÓÚÑ0-9_]/g, ''));
    const rucIdx = headers.indexOf('RUC');
    const nomIdx = headers.indexOf('NOMBRE_CONTRIBUYENTE') !== -1 ? headers.indexOf('NOMBRE_CONTRIBUYENTE') : headers.indexOf('CONTRIBUYENTE');

    const buscarFilas = (colIdx, valorOriginal, valorNorm) => {
      if (colIdx < 0 || !valorNorm) return [];
      const rango = hojaCon.getRange(2, colIdx + 1, lastRow - 1, 1);
      let coincidencias = rango.createTextFinder(String(valorOriginal || '').trim())
        .matchCase(false)
        .matchEntireCell(true)
        .findAll()
        .map(celda => celda.getRow());
      if (coincidencias.length === 0) {
        coincidencias = rango.getDisplayValues()
          .map((fila, idx) => norm(fila[0]) === valorNorm ? idx + 2 : 0)
          .filter(Boolean);
      }
      return coincidencias;
    };

    // No se mezclan coincidencias de RUC y nombre.
    const filasMatch = rucNorm
      ? buscarFilas(rucIdx, ruc, rucNorm)
      : buscarFilas(nomIdx, nombre, nomNorm);

    const filasFiltradas = [...new Set(filasMatch)].map(rowNum => {
      const valores = hojaCon.getRange(rowNum, 1, 1, lastCol).getValues()[0];
      const mostrados = hojaCon.getRange(rowNum, 1, 1, lastCol).getDisplayValues()[0];
      const datos = {};
      const textos = {};
      headers.forEach((header, idx) => {
        if (!header) return;
        datos[header] = valores[idx];
        textos[header] = mostrados[idx];
      });
      return { datos, textos };
    });

    const _parseFloatRobust = (v) => {
      if (typeof v === 'number') return v;
      if (!v) return 0;
      let s = String(v).replace(/[^0-9,.-]/g, '').replace(/,/g, '.');
      let n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };

    const texto = (fila, ...campos) => {
      for (const campo of campos) {
        if (fila.textos[campo] !== undefined && fila.textos[campo] !== '') {
          return String(fila.textos[campo]);
        }
      }
      return '';
    };

    const detalleImpuestos = filasFiltradas.map(fila => {
      const c = fila.datos;
      const tipoRubro = (texto(fila, 'TIPO_IMPUESTO', 'TIPO_DE_RUBRO') || 'OTRO').replace(/_/g, ' ');
      const numeroPuesto = texto(fila, 'NO_DE_PUESTO');
      return {
        mercadoSector: texto(fila, 'MERCADO_SECTOR'),
        asociacion: texto(fila, 'ASOCIACION'),
        numeroPuesto,
        noDePuesto: numeroPuesto,
        giroNegocio: texto(fila, 'GIRO_DEL_NEGOCIO'),
        periodoDesde: texto(fila, 'PERIODO_DESDE'),
        periodoHasta: texto(fila, 'PERIODO_HASTA'),
        tipoImpuesto: tipoRubro,
        tipoRubro,
        estadoDeuda: texto(fila, 'ESTADO_DE_DEUDA'),
        totalDeuda: _parseFloatRobust(c.TOTAL_DEUDA),
        totalPorCobrar: _parseFloatRobust(c.TOTAL_POR_COBRAR),
        // Compatibilidad con consumidores anteriores.
        anoSolicitud: '',
        valorImpuesto: 0,
        valorInteres: 0,
        valorMulta: 0,
        valorRecargo: 0
      };
    });

    const totalDeudaConsolidada = detalleImpuestos.reduce((s, i) => s + i.totalDeuda, 0);
    const totalPorCobrarConsolidado = detalleImpuestos.reduce((s, i) => s + i.totalPorCobrar, 0);

    const primerRegistro = filasFiltradas[0] || { textos: {} };
    const contactos = {
      correoGestion: texto(primerRegistro, 'CORREO_GESTION'),
      telefonoGestion: texto(primerRegistro, 'TELEFONO_GESTION'),
      correoGestion2: '',
      telefonoGestion2: texto(primerRegistro, 'TELEFONO_GESTION2'),
      detalleContactos: texto(primerRegistro, 'DETALLE_CONTACTOS')
    };

    return {
      ok: true,
      impuestos: detalleImpuestos,
      totalConsolidado: totalDeudaConsolidada,
      totalPorCobrarConsolidado,
      contactos
    };

  } catch (err) {
    Logger.log('getDesgloseDetallado_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene el historial de gestiones de un expediente.
 * @param {string} token
 * @param {string} idExpediente
 * @returns {{ ok, gestiones: [], error? }}
 */
function getHistorialExpediente_(token, idExpediente) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    // Verificar que el usuario tiene acceso a este expediente
    const expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);
    const exp = expedientes.find(e => e.ID_EXPEDIENTE === idExpediente);

    if (!exp) return { ok: false, error: 'Expediente no encontrado.' };

    const funcionarioAsignado = String(exp.FUNCIONARIO_ASIGNADO || '').trim().toLowerCase();
    const usuarioSesion = String(sesion.usuario || sesion.email || '').trim().toLowerCase();

    if (sesion.rol === 'GESTOR' && funcionarioAsignado !== usuarioSesion) {
      return { ok: false, error: 'No tienes acceso a este expediente.' };
    }

    // Obtener gestiones de este expediente
    const gestiones = getDataAsObjects_(SHEET_NAMES.GESTIONES);
    const historial = gestiones.filter(g => g.ID_EXPEDIENTE === idExpediente);

    return {
      ok: true,
      gestiones: historial.map(g => ({
        id:                   g.ID_GESTION,
        fechaRegistro:        g.FECHA_REGISTRO,
        idExpediente:         g.ID_EXPEDIENTE,
        funcionario:          g.FUNCIONARIO,
        tipoGestion:          g.TIPO_GESTION,
        resultado:            g.RESULTADO,
        observacion:          g.OBSERVACION,
        fechaProximaGestion:  g.FECHA_PROXIMA_GESTION,
        estadoPostGestion:    g.ESTADO_POST_GESTION,
        usuarioEditor:        g.USUARIO_EDITOR,
        timestamp:            g.TIMESTAMP
      }))
    };

  } catch (err) {
    Logger.log('getHistorialExpediente_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Lista gestiones con paginación.
 * @param {string} token
 * @param {number} pagina
 * @param {Object} filtros { busqueda, tipo, resultado }
 * @returns {{ ok, gestiones[], total, pagina, pageSize }}
 */
function getGestiones_(token, pagina, filtros) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  pagina = Math.max(1, parseInt(pagina) || 1);
  const pageSize = PARAMS.PAGE_SIZE || 50;
  filtros = filtros || {};

  try {
    let gestiones = getDataAsObjects_(SHEET_NAMES.GESTIONES);

    // Aplicar filtros
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      gestiones = gestiones.filter(g =>
        String(g.ID_GESTION || '').toLowerCase().includes(q) ||
        String(g.ID_EXPEDIENTE || '').toLowerCase().includes(q)
      );
    }

    if (filtros.tipo && filtros.tipo !== '') {
      gestiones = gestiones.filter(g => g.TIPO_GESTION === filtros.tipo);
    }

    if (filtros.resultado && filtros.resultado !== '') {
      gestiones = gestiones.filter(g => g.RESULTADO === filtros.resultado);
    }

    // Ordenar por fecha descendente
    gestiones.sort((a, b) =>
      new Date(b.FECHA_REGISTRO) - new Date(a.FECHA_REGISTRO)
    );

    // Paginación
    const total = gestiones.length;
    const inicio = (pagina - 1) * pageSize;
    const fin = inicio + pageSize;
    const paginados = gestiones.slice(inicio, fin);

    return {
      ok: true,
      gestiones: paginados.map(g => ({
        id:                   g.ID_GESTION,
        fechaRegistro:        g.FECHA_REGISTRO,
        idExpediente:         g.ID_EXPEDIENTE,
        funcionario:          g.FUNCIONARIO,
        tipoGestion:          g.TIPO_GESTION,
        resultado:            g.RESULTADO,
        observacion:          g.OBSERVACION,
        fechaProximaGestion:  g.FECHA_PROXIMA_GESTION,
        estadoPostGestion:    g.ESTADO_POST_GESTION,
        timestamp:            g.TIMESTAMP
      })),
      total,
      pagina,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };

  } catch (err) {
    Logger.log('getGestiones_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Obtiene datos para la vista de seguimiento.
 * @param {string} token
 * @param {string} categoria - 'TODOS', 'CRITICOS', 'VENCIDOS', 'SIN_MOVIMIENTO'
 * @returns {{ ok, expedientes[], error? }}
 */
function getSeguimientoData_(token, categoria) {
  const sesion = verificarSesion_(token);
  if (!sesion) return { ok: false, error: 'Sesión inválida.' };

  try {
    let expedientes = getDataAsObjects_(SHEET_NAMES.EXPEDIENTES);

    // Filtrar según categoría
    switch (categoria) {
      case 'CRITICOS':
        expedientes = expedientes.filter(e => e.ALERTA_ESTADO === 'CRITICO');
        break;
      case 'VENCIDOS':
        expedientes = expedientes.filter(e => e.ALERTA_ESTADO === 'VENCIDO');
        break;
      case 'SIN_MOVIMIENTO':
        expedientes = expedientes.filter(e => e.ALERTA_ESTADO === 'SIN_MOVIMIENTO');
        break;
    }

    return {
      ok: true,
      expedientes: expedientes.map(e => ({
        id:                  e.ID_EXPEDIENTE,
        contribuyente:       e.CONTRIBUYENTE,
        funcionario:         e.FUNCIONARIO_ASIGNADO,
        estado:              e.ESTADO_EXPEDIENTE,
        prioridad:           e.PRIORIDAD,
        diasSinMovimiento:   parseInt(e.DIAS_SIN_MOVIMIENTO) || 0,
        fechaProximaGestion: e.FECHA_PROXIMA_GESTION,
        alerta:              e.ALERTA_ESTADO,
        fechaActualizacion:  new Date().toISOString()
      }))
    };

  } catch (err) {
    Logger.log('getSeguimientoData_ ERROR: ' + err.message);
    return { ok: false, error: err.message };
  }
}
