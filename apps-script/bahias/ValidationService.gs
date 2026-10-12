/**
 * ValidationService.gs
 * Validaciones de datos del sistema SIGECO.
 * Centraliza reglas de negocio de validación por entidad.
 * Retorna { valido: true } o { valido: false, errores: [...] }.
 */

/**
 * Valida los datos para crear un nuevo expediente.
 * @param {Object} datos
 * @returns {{ valido: boolean, errores: string[] }}
 */
function validateExpediente_(datos) {
  if (!datos) return { valido: false, errores: ['Datos no proporcionados.'] };
  const errores = [];

  if (!datos.ruc)              errores.push('RUC es obligatorio.');
  if (!datos.contribuyente)    errores.push('Nombre del contribuyente es obligatorio.');
  if (!datos.tipoObligacion)   errores.push('Tipo de obligación es obligatorio.');
  if (!datos.estadoExpediente) errores.push('Estado del expediente es obligatorio.');
  if (!datos.prioridad)        errores.push('Prioridad es obligatoria.');

  if (datos.estadoExpediente &&
      !CATALOGOS.ESTADOS_EXPEDIENTE.includes(datos.estadoExpediente)) {
    errores.push('Estado de expediente inválido: ' + datos.estadoExpediente);
  }
  if (datos.prioridad && !CATALOGOS.PRIORIDADES.includes(datos.prioridad)) {
    errores.push('Prioridad inválida: ' + datos.prioridad);
  }
  if (datos.tipoObligacion &&
      !CATALOGOS.TIPOS_OBLIGACION.includes(datos.tipoObligacion)) {
    errores.push('Tipo de obligación inválido: ' + datos.tipoObligacion);
  }

  const estadosSinResponsable = ['PENDIENTE_ASIGNACION'];
  if (!estadosSinResponsable.includes(datos.estadoExpediente) && !datos.funcionarioAsignado) {
    errores.push('Funcionario asignado es obligatorio salvo en estado PENDIENTE_ASIGNACION.');
  }

  if (datos.ruc) {
    const rucLimpio = String(datos.ruc).trim();
    if (!/^\d{10}(\d{3})?$/.test(rucLimpio)) {
      errores.push('RUC/Cédula inválido: debe tener 10 o 13 dígitos numéricos.');
    }
  }

  return { valido: errores.length === 0, errores };
}

/**
 * Valida los datos para registrar una gestión.
 * @param {Object} datos
 * @returns {{ valido: boolean, errores: string[] }}
 */
function validateGestion_(datos) {
  if (!datos) return { valido: false, errores: ['Datos no proporcionados.'] };
  const errores = [];

  if (!datos.idExpediente)  errores.push('ID de expediente es obligatorio.');
  if (!datos.tipoGestion)   errores.push('Tipo de gestión es obligatorio.');
  if (!datos.resultado)     errores.push('Resultado es obligatorio.');
  if (!datos.funcionario)   errores.push('Funcionario es obligatorio.');

  if (datos.tipoGestion && !CATALOGOS.TIPOS_GESTION.includes(datos.tipoGestion)) {
    errores.push('Tipo de gestión inválido: ' + datos.tipoGestion);
  }
  if (datos.resultado && !CATALOGOS.RESULTADOS_GESTION.includes(datos.resultado)) {
    errores.push('Resultado inválido: ' + datos.resultado);
  }
  if (datos.estadoPostGestion &&
      !CATALOGOS.ESTADOS_CAMBIO_GESTION.includes(datos.estadoPostGestion)) {
    errores.push('Estado post-gestión inválido: ' + datos.estadoPostGestion);
  }

  if (datos.fechaProximaGestion) {
    const fecha = new Date(datos.fechaProximaGestion);
    if (isNaN(fecha.getTime())) {
      errores.push('Fecha próxima gestión inválida.');
    }
  }

  return { valido: errores.length === 0, errores };
}

/**
 * Valida si un expediente existe y está activo.
 * OPTIMIZACIÓN v2.1: usa findRowByFieldFast_ (TextFinder nativo) en lugar de
 * findRowByField_ (full-scan de todas las filas). Reduce ~600-1000ms a ~80ms.
 * @param {string} idExpediente
 * @returns {{ existe: boolean, expediente?: Object }}
 */
function validarExpedienteExiste_(idExpediente) {
  const exp = findRowByFieldFast_(SHEET_NAMES.EXPEDIENTES, 'ID_EXPEDIENTE', idExpediente);
  if (!exp) return { existe: false };
  if (exp.ACTIVO !== 'TRUE' && exp.ACTIVO !== true) return { existe: false };
  return { existe: true, expediente: exp };
}

/**
 * Valida un campo individual contra su catálogo.
 * @param {string} catalogo — clave de CATALOGOS
 * @param {string} valor
 * @returns {boolean}
 */
function validateCatalogo_(catalogo, valor) {
  const lista = CATALOGOS[catalogo];
  if (!lista) return false;
  return lista.includes(valor);
}
