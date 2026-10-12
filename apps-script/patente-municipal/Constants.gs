/**
 * Constants.gs
 * Constantes globales del sistema SIGECO.
 * Centraliza nombres de hojas, encabezados, catálogos y parámetros.
 * NUNCA usar strings literales de hojas o columnas fuera de este archivo.
 */

// ============================================================
// NOMBRES DE HOJAS
// ============================================================
const SHEET_NAMES = {
  CONFIG:               'CONFIG',
  USUARIOS:             'USUARIOS',
  CONTRIBUYENTES:       'CONTRIBUYENTES',
  EXPEDIENTES:          'EXPEDIENTES',
  GESTIONES:            'GESTIONES',
  PAGOS:                'PAGOS',
  SEGUIMIENTO:          'SEGUIMIENTO',
  BITACORA:             'BITACORA',
  DASHBOARD:            'DASHBOARD',
  EXPEDIENTES_CERRADOS: 'EXPEDIENTES_CERRADOS'
};

// ============================================================
// ENCABEZADOS POR HOJA (orden exacto de columnas)
// ============================================================
const HEADERS = {
  CONFIG: [
    'CLAVE', 'VALOR', 'DESCRIPCION', 'ACTIVO'
  ],
  USUARIOS: [
    'ID_USUARIO', 'NOMBRE', 'CORREO_INSTITUCIONAL', 'ROL',
    'AREA', 'ESTADO', 'ACTIVO', 'FECHA_CREACION', 'ULTIMO_ACCESO',
    'PASSWORD_HASH', 'PASSWORD_SALT'
  ],
  CONTRIBUYENTES: [
    'AÑO_SOLICITUD', 'TIPO_IMPUESTO', 'RUC', 'NOMBRE_CONTRIBUYENTE',
    'TIPO_PERSONA', 'CORREO_GESTION', 'TELEFONO_GESTION', 'REPRESENTANTE_LEGAL',
    'CORREO_GESTION2', 'TELEFONO_GESTION2', 'VALOR_IMPUESTO', 'VALOR_INTERES',
    'VALOR_MULTA', 'VALOR_RECARGO', 'TOTAL_DEUDA', 'FECHA_CARGA'
  ],
  EXPEDIENTES: [
    'ID_EXPEDIENTE', 'CODIGO_INTERNO', 'RUC', 'CONTRIBUYENTE',
    'TIPO_PERSONA', 'TIPO_OBLIGACION', 'ESTADO_EXPEDIENTE', 'PRIORIDAD',
    'FUNCIONARIO_ASIGNADO', 'FECHA_ASIGNACION', 'FECHA_ULTIMA_GESTION',
    'FECHA_PROXIMA_GESTION', 'DIAS_SIN_MOVIMIENTO', 'RESULTADO_ULTIMA_GESTION',
    'OBSERVACION_GENERAL', 'ALERTA_ESTADO', 'ACTIVO',
    'VALOR_IMPUESTO', 'VALOR_INTERES', 'VALOR_MULTA', 'VALOR_RECARGO', 'TOTAL_DEUDA',
    'MONTO_PAGADO', 'SALDO_PENDIENTE', 'PORCENTAJE_RECUPERADO', 'FECHA_ULTIMO_PAGO'
  ],
  PAGOS: [
    'ID_PAGO', 'FECHA_PAGO', 'ID_EXPEDIENTE', 'RUC',
    'MONTO_PAGADO', 'TIPO_PAGO', 'REFERENCIA', 'REGISTRADO_POR',
    'FUENTE', 'TIMESTAMP'
  ],
  GESTIONES: [
    'ID_GESTION', 'FECHA_REGISTRO', 'ID_EXPEDIENTE', 'FUNCIONARIO',
    'TIPO_GESTION', 'RESULTADO', 'OBSERVACION', 'FECHA_PROXIMA_GESTION',
    'ESTADO_POST_GESTION', 'MONTO_RECAUDADO', 'USUARIO_EDITOR', 'TIMESTAMP'
  ],
  SEGUIMIENTO: [
    'CATEGORIA', 'ID_EXPEDIENTE', 'CONTRIBUYENTE', 'FUNCIONARIO',
    'ESTADO_EXPEDIENTE', 'PRIORIDAD', 'DIAS_SIN_MOVIMIENTO',
    'FECHA_PROXIMA_GESTION', 'ALERTA_ESTADO', 'FECHA_ACTUALIZACION'
  ],
  BITACORA: [
    'ID_LOG', 'FECHA_HORA', 'USUARIO', 'ROL', 'HOJA',
    'ID_EXPEDIENTE', 'ACCION', 'CAMPO', 'VALOR_ANTERIOR',
    'VALOR_NUEVO', 'CONTEXTO', 'ORIGEN'
  ],
  DASHBOARD: [
    'INDICADOR', 'VALOR', 'DESCRIPCION', 'FECHA_CALCULO'
  ],
  EXPEDIENTES_CERRADOS: [
    'ID_EXPEDIENTE', 'CODIGO_INTERNO', 'RUC', 'CONTRIBUYENTE',
    'TIPO_PERSONA', 'TIPO_OBLIGACION', 'ESTADO_EXPEDIENTE', 'PRIORIDAD',
    'FUNCIONARIO_ASIGNADO', 'FECHA_ASIGNACION', 'FECHA_ULTIMA_GESTION',
    'FECHA_PROXIMA_GESTION', 'DIAS_SIN_MOVIMIENTO', 'RESULTADO_ULTIMA_GESTION',
    'OBSERVACION_GENERAL', 'ALERTA_ESTADO', 'ACTIVO',
    'VALOR_IMPUESTO', 'VALOR_INTERES', 'VALOR_MULTA', 'VALOR_RECARGO', 'TOTAL_DEUDA',
    'MONTO_PAGADO', 'SALDO_PENDIENTE', 'PORCENTAJE_RECUPERADO', 'FECHA_ULTIMO_PAGO',
    'FECHA_CIERRE', 'MOTIVO_CIERRE', 'CERRADO_POR', 'OBSERVACION_CIERRE'
  ]
};

// ============================================================
// CATÁLOGOS CERRADOS
// ============================================================
const CATALOGOS = {
  ESTADOS_EXPEDIENTE: [
    'PENDIENTE_ASIGNACION',
    'EN_GESTION',
    'GESTION_PAUSADA',
    'CONTACTADO',
    'NO_CONTACTADO',
    'COMPROMETIDO_PAGO',
    'PAGO_POR_CONFIRMAR',
    'DERIVADO_SUPERVISOR',
    'CERRADO_EXITOSO',
    'CERRADO_SIN_ACUERDO',
    'CERRADO_EXENTO',
    'DERIVADO_TITULO'
  ],
  PRIORIDADES: [
    'CRITICA',
    'ALTA',
    'MEDIA',
    'BAJA'
  ],
  TIPOS_GESTION: [
    'LLAMADA_TELEFONICA',
    'CORREO_ELECTRONICO',
    'EXENTO_VERIFICADO',
    'NUEVO_NUMERO',
    'OTRO'
  ],
  RESULTADOS_GESTION: [
    'CONTACTO_EFECTIVO',
    'NO_CONTACTADO',
    'NUEVO_NUMERO',
    'NUMERO_EQUIVOCADO',
    'CORREO_ENVIADO',
    'CORREO_REBOTADO',
    'PROMESA_PAGO',
    'PAGO_REPORTADO_POR_CONTRIBUYENTE',
    'PAGO_POR_CONFIRMAR',
    'PAGO_CONFIRMADO',
    'SIN_VOLUNTAD_PAGO',
    'REQUIERE_REVISION_SUPERVISOR'
  ],
  TIPOS_PAGO: [
    'ABONO',
    'PAGO_TOTAL',
    'CUOTA_CONVENIO'
  ],
  TIPOS_OBLIGACION: [
    'IMPUESTO_15_POR_MIL',
    'IMPUESTO_PATENTE'
  ],
  ESTADOS_ALERTA: [
    'OK',
    'SIN_MOVIMIENTO',
    'PROXIMO_VENCER',
    'VENCIDO',
    'CRITICO'
  ],
  ROLES: [
    'ADMINISTRADOR',
    'SUPERVISOR',
    'GESTOR',
    'AUDITOR'
  ],
  ESTADOS_CAMBIO_GESTION: [
    'EN_GESTION',
    'CONTACTADO',
    'NO_CONTACTADO',
    'COMPROMETIDO_PAGO',
    'PAGO_POR_CONFIRMAR',
    'DERIVADO_SUPERVISOR',
    'CERRADO_EXITOSO'
  ],
  ESTADOS_ORDENANZA: [
    'VIGENTE',
    'DEROGADA',
    'MODIFICADA'
  ]
};

/**
 * Retorna todos los catálogos del sistema.
 * @returns {{ ok: boolean, catalogos: Object }}
 */
function getCatalogos() {
  return { ok: true, catalogos: CATALOGOS };
}

// ============================================================
// ESTADOS TERMINALES DE EXPEDIENTE
// Fuente única de verdad — antes había hasta 8 copias locales de esta
// lista en distintos archivos, con contenidos que no siempre coincidían.
// ============================================================
const ESTADOS_TERMINALES_EXPEDIENTE = [
  'CERRADO_EXITOSO',
  'CERRADO_SIN_ACUERDO',
  'DERIVADO_TITULO',
  'CERRADO_EXENTO'
];

/**
 * Indica si un estado de expediente es terminal (cerrado / ya no gestionable).
 * @param {string} estado
 * @returns {boolean}
 */
function esEstadoTerminal(estado) {
  return ESTADOS_TERMINALES_EXPEDIENTE.includes(estado);
}

// ============================================================
// ROLES Y NIVELES
// ============================================================
const ROLES = {
  ADMINISTRADOR: { nivel: 4, label: 'Administrador' },
  SUPERVISOR:    { nivel: 3, label: 'Supervisor' },
  GESTOR:        { nivel: 2, label: 'Gestor' },
  AUDITOR:       { nivel: 1, label: 'Auditor' }
};

// ============================================================
// MATRIZ DE PERMISOS
// accion: { rolMinimo: 'ROL', descripcion: '...' }
// ============================================================
const PERMISOS = {
  VER_TODOS_EXPEDIENTES:   'SUPERVISOR',
  VER_PROPIO_EXPEDIENTE:   'GESTOR',
  CREAR_EXPEDIENTE:        'GESTOR',
  ACTUALIZAR_EXPEDIENTE:   'GESTOR',
  CERRADO_EXITOSO:             'GESTOR',
  REASIGNAR_EXPEDIENTE:        'SUPERVISOR',
  CERRAR_EXPEDIENTE:           'SUPERVISOR',
  CERRAR_EXPEDIENTE_EXENTO:    'SUPERVISOR',
  VER_EXPEDIENTES_CERRADOS:    'SUPERVISOR',
  REABRIR_EXPEDIENTE:          'SUPERVISOR',
  REGISTRAR_GESTION:       'GESTOR',
  VER_SEGUIMIENTO:         'SUPERVISOR',
  VER_BITACORA:            'AUDITOR',
  VER_DASHBOARD:           'GESTOR',
  IMPORTAR_CONTRIBUYENTES: 'ADMINISTRADOR',
  GESTIONAR_USUARIOS:      'ADMINISTRADOR',
  MODIFICAR_CONFIG:        'ADMINISTRADOR',
  REGISTRAR_PAGO:          'SUPERVISOR',
  VERIFICAR_INTEGRIDAD:    'ADMINISTRADOR',
  INSERTAR_DATOS_PRUEBA:   'ADMINISTRADOR',
  LIMPIAR_DATOS_PRUEBA:    'ADMINISTRADOR'
};

// ============================================================
// PARÁMETROS DEL SISTEMA
// ============================================================
const PARAMS = {
  SESSION_HOURS:              8,
  DIAS_ALERTA_SIN_MOVIMIENTO: 15,
  DIAS_ALERTA_PROXIMO_VENCER: 3,
  DIAS_ALERTA_VENCIDO:        0,
  DIAS_ALERTA_CRITICO:        30,
  PAGE_SIZE:                  50,
  CASES_PER_DAY_QUOTA:        20,
  VERSION_SISTEMA:            '2.0.0',
  NOMBRE_SISTEMA:             'SIGECO - Sistema de Seguimiento de Gestión Recaudatoria',
  TIMEZONE:                   'America/Guayaquil'
};

// ============================================================
// VALORES INICIALES DE CONFIG
// ============================================================
const CONFIG_DEFAULTS = [
  ['DIAS_ALERTA_SIN_MOVIMIENTO', '15',   'Días sin gestión para activar alerta SIN_MOVIMIENTO',    'TRUE'],
  ['DIAS_ALERTA_PROXIMO_VENCER', '3',    'Días antes del vencimiento para alerta PROXIMO_VENCER',  'TRUE'],
  ['DIAS_ALERTA_CRITICO',        '30',   'Días sin gestión para elevar alerta a CRITICO',           'TRUE'],
  ['VERSION_SISTEMA',            '2.0.0','Versión actual del sistema',                              'TRUE'],
  ['NOMBRE_MUNICIPIO',           'Municipio',  'Nombre del municipio o entidad',                   'TRUE'],
  ['AREA_RESPONSABLE',           'Rentas',     'Área responsable del sistema',                     'TRUE'],
  ['EMAIL_ADMIN',                '',      'Correo del administrador del sistema',                   'TRUE'],
  ['NOTIF_ALERTAS_ACTIVO',      'TRUE',  'Activar envío de alertas VENCIDO/CRITICO por correo',     'TRUE'],
  ['NOTIF_RECORDATORIO_ACTIVO', 'TRUE',  'Activar recordatorio al registrar fecha próxima gestión',  'TRUE'],
  ['NOTIF_CIERRE_ACTIVO',       'TRUE',  'Activar notificación de cierre exitoso por correo',        'TRUE'],
  ['CALENDAR_ACTIVO',           'TRUE',  'Activar creación de eventos en Google Calendar',           'TRUE'],
  ['DOCUMENTOS_FOLDER',         '',      'ID de carpeta Drive para PDFs (vacío = auto-crear)',       'TRUE'],
  ['PREFIJO_EXPEDIENTE',         'EXP',   'Prefijo para IDs de expedientes',                        'TRUE'],
  ['PREFIJO_GESTION',            'GES',   'Prefijo para IDs de gestiones',                          'TRUE'],
  ['PREFIJO_LOG',                'LOG',   'Prefijo para IDs de bitácora',                           'TRUE']
];

// ============================================================
// FORMATOS DE CELDA
// ============================================================
const FORMATOS = {
  HEADER_BG_COLOR:    '#1a237e',
  HEADER_FONT_COLOR:  '#ffffff',
  HEADER_FONT_SIZE:   10,
  ALERTA_CRITICO_BG:  '#ffcccc',
  ALERTA_VENCIDO_BG:  '#ffe0b2',
  ALERTA_SIN_MOV_BG:  '#fff9c4',
  ALERTA_OK_BG:       '#e8f5e9'
};
