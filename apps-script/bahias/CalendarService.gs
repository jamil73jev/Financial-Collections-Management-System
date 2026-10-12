/**
 * CalendarService.gs
 * Integración con Google Calendar para recordatorios de gestión.
 * Scope requerido: https://www.googleapis.com/auth/calendar
 *
 * MODELO: Los eventos se crean en el calendario del deployer (admin).
 * El gestor recibe una invitación como guest → aparece en su propio Google Calendar.
 * El eventId se persiste en ScriptProperties con clave 'cal_<idGestion>'.
 *
 * Exports:
 *   crearEventoGestion_(gestorCorreo, expediente, fechaProxima, idGestion) → eventId | null
 *   actualizarEventoGestion_(idGestion, nuevaFecha, expediente)
 *   cancelarEventoGestion_(idGestion)
 */

// ============================================================
// CREAR EVENTO
// Llamado desde GestionService cuando se registra fechaProximaGestion
// ============================================================

function crearEventoGestion_(gestorCorreo, expediente, fechaProxima, idGestion) {
  try {
    if (!fechaProxima || !expediente) return null;

    const fechaEvento = new Date(fechaProxima);
    if (isNaN(fechaEvento.getTime())) return null;

    // El evento dura 1 hora
    const fechaFin = new Date(fechaEvento.getTime() + 60 * 60 * 1000);

    const municipio = getConfig_('NOMBRE_MUNICIPIO', 'Municipio');
    const titulo = '[SIGECO] ' + (expediente.ID_EXPEDIENTE || '') +
                   ' — ' + (expediente.CONTRIBUYENTE || '').substring(0, 40);

    const descripcion =
      'Expediente: '    + (expediente.ID_EXPEDIENTE || '') + '\n' +
      'Contribuyente: ' + (expediente.CONTRIBUYENTE || '') + '\n' +
      'RUC: '           + (expediente.RUC || '') + '\n' +
      'Deuda: '         + _calFmtMonto_(expediente.TOTAL_DEUDA) + '\n' +
      'Estado: '        + (expediente.ESTADO_EXPEDIENTE || '').replace(/_/g, ' ') + '\n' +
      'Gestor: '        + (gestorCorreo || '') + '\n' +
      'Sistema: SIGECO — ' + municipio;

    const opciones = { description: descripcion };
    if (gestorCorreo && gestorCorreo.includes('@')) {
      opciones.guests     = gestorCorreo;
      opciones.sendInvites = true;
    }

    const calendario = CalendarApp.getDefaultCalendar();
    const evento     = calendario.createEvent(titulo, fechaEvento, fechaFin, opciones);
    evento.setColor(CalendarApp.EventColor.CYAN);

    const eventId = evento.getId();

    // Persistir el eventId mapeado a la gestión
    if (idGestion) {
      PropertiesService.getScriptProperties()
        .setProperty('cal_' + idGestion, eventId);
    }

    Logger.log('CalendarService: evento creado [' + eventId + '] para gestión ' + idGestion);
    return eventId;

  } catch (err) {
    Logger.log('crearEventoGestion_ ERROR: ' + err.message);
    return null;
  }
}

// ============================================================
// ACTUALIZAR EVENTO
// Llamado si se registra una nueva fecha sobre la misma gestión
// ============================================================

function actualizarEventoGestion_(idGestion, nuevaFecha, expediente) {
  try {
    const eventId = PropertiesService.getScriptProperties()
      .getProperty('cal_' + idGestion);
    if (!eventId) return;

    const evento = CalendarApp.getEventById(eventId);
    if (!evento) return;

    const nuevaFechaEvento = new Date(nuevaFecha);
    if (isNaN(nuevaFechaEvento.getTime())) return;

    const nuevaFechaFin = new Date(nuevaFechaEvento.getTime() + 60 * 60 * 1000);
    evento.setTime(nuevaFechaEvento, nuevaFechaFin);

    if (expediente) {
      evento.setDescription(
        'ACTUALIZADO\n' +
        'Expediente: '    + (expediente.ID_EXPEDIENTE || '') + '\n' +
        'Contribuyente: ' + (expediente.CONTRIBUYENTE || '') + '\n' +
        'Deuda: '         + _calFmtMonto_(expediente.TOTAL_DEUDA)
      );
    }

    Logger.log('CalendarService: evento actualizado [' + eventId + ']');
  } catch (err) {
    Logger.log('actualizarEventoGestion_ ERROR: ' + err.message);
  }
}

// ============================================================
// CANCELAR EVENTO
// Llamado cuando el expediente se cierra o la gestión se completa
// ============================================================

function cancelarEventoGestion_(idGestion) {
  try {
    if (!idGestion) return;

    const eventId = PropertiesService.getScriptProperties()
      .getProperty('cal_' + idGestion);
    if (!eventId) return;

    const evento = CalendarApp.getEventById(eventId);
    if (evento) {
      evento.deleteEvent();
      Logger.log('CalendarService: evento eliminado [' + eventId + ']');
    }

    PropertiesService.getScriptProperties().deleteProperty('cal_' + idGestion);

  } catch (err) {
    Logger.log('cancelarEventoGestion_ ERROR: ' + err.message);
  }
}

// ============================================================
// TRIGGER INSTALADOR — ejecutar 1 vez si se quiere trigger dedicado
// (opcional: el calendar hook corre inline en registerGestion_)
// ============================================================

function instalarTriggerCalendar_() {
  Logger.log('CalendarService: el hook de Calendar se ejecuta inline en GestionService.');
  Logger.log('No requiere trigger independiente.');
}

// ============================================================
// FUNCIÓN PRIVADA
// ============================================================

function _calFmtMonto_(valor) {
  const n = parseFloat(valor) || 0;
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '$ ' + parts.join('.');
}
