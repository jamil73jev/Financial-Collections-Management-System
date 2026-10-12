/**
 * AsyncService.gs
 * Cola de tareas asíncronas para operaciones externas (Calendar, Gmail).
 *
 * Problema que resuelve:
 *   Calendar y Gmail añaden 2-4 segundos al hilo de registerGestion.
 *   Este servicio desacopla esas llamadas: las encola en PropertiesService
 *   y un trigger de 1 minuto las procesa en segundo plano.
 *
 * Activación:
 *   Ejecutar instalarTriggerTareas() UNA VEZ desde la consola GAS.
 */

const COLA_KEY    = 'COLA_TAREAS_ASYNC';
const COLA_MAX    = 100;  // máximo ítems en cola

// ============================================================
// API PÚBLICA — llamada desde otros servicios
// ============================================================

/**
 * Encola una tarea para ejecutarse en el siguiente ciclo del trigger.
 * NO bloquea — retorna inmediatamente.
 * @param {string} tipo  — 'CALENDAR' | 'EMAIL_RECORDATORIO' | 'EMAIL_CIERRE'
 * @param {Object} payload
 */
function encolarTareaExterna(tipo, payload) {
  encolarTareasExternas([{ tipo, payload }]);
}

/**
 * Encola múltiples tareas en una sola operación de lectura+escritura.
 * Usar cuando se necesita encolar 2+ tareas en el mismo flujo (p.ej. registerGestion)
 * para evitar N lecturas/escrituras de PropertiesService.
 * @param {Array<{tipo: string, payload: Object}>} tareas
 */
function encolarTareasExternas(tareas) {
  if (!tareas || tareas.length === 0) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const raw   = props.getProperty(COLA_KEY);
    const cola  = raw ? JSON.parse(raw) : [];

    const ts = Date.now();
    tareas.forEach(({ tipo, payload }) => {
      cola.push({ tipo, payload, ts });
    });

    // Evitar overflow: conservar los últimos COLA_MAX
    props.setProperty(COLA_KEY, JSON.stringify(cola.slice(-COLA_MAX)));
  } catch (e) {
    Logger.log('encolarTareasExternas ERROR: ' + e.message);
  }
}

// ============================================================
// PROCESADOR — ejecutado por trigger cada 1 minuto
// ============================================================

/**
 * Procesa todas las tareas pendientes en la cola.
 * Se instala como trigger: instalarTriggerTareas()
 */
function procesarColaTareas() {
  try {
    const props    = PropertiesService.getScriptProperties();
    const raw      = props.getProperty(COLA_KEY);
    if (!raw) return;

    const pendientes = JSON.parse(raw);
    if (pendientes.length === 0) return;

    // Vaciar cola antes de procesar (evita reproceso si algo falla)
    props.setProperty(COLA_KEY, '[]');
    Logger.log('procesarColaTareas: procesando ' + pendientes.length + ' tarea(s)');

    pendientes.forEach(tarea => {
      try {
        const p = tarea.payload || {};
        switch (tarea.tipo) {
          case 'CALENDAR':
            if (typeof crearEventoGestion === 'function') {
              crearEventoGestion(p.gestor, p.expediente, p.fechaProxima, p.idGestion);
            }
            break;
          case 'EMAIL_RECORDATORIO':
            if (typeof enviarRecordatorioGestion === 'function') {
              enviarRecordatorioGestion(p.gestor, p.expediente, p.fechaProxima);
            }
            break;
          case 'EMAIL_CIERRE':
            if (typeof enviarConfirmacionCierre === 'function') {
              enviarConfirmacionCierre(p.gestor, p.expediente);
            }
            break;
          default:
            Logger.log('procesarColaTareas: tipo desconocido: ' + tarea.tipo);
        }
      } catch (eTarea) {
        Logger.log('procesarColaTareas tarea fallida [' + tarea.tipo + ']: ' + eTarea.message);
      }
    });

  } catch (e) {
    Logger.log('procesarColaTareas ERROR GLOBAL: ' + e.message);
  }
}

// ============================================================
// INSTALACIÓN DEL TRIGGER
// ============================================================

/**
 * Instala el trigger de 1 minuto para procesar la cola.
 * Ejecutar UNA VEZ desde la consola GAS.
 */
function instalarTriggerTareas() {
  // Eliminar triggers existentes del mismo handler
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'procesarColaTareas')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('procesarColaTareas')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log('✅ Trigger procesarColaTareas instalado (cada 1 minuto)');
  return { ok: true, mensaje: 'Trigger de tareas asíncronas instalado.' };
}

/**
 * Muestra el estado actual de la cola (para diagnóstico).
 */
function verEstadoCola() {
  const raw  = PropertiesService.getScriptProperties().getProperty(COLA_KEY);
  const cola = raw ? JSON.parse(raw) : [];
  Logger.log('Cola actual (' + cola.length + ' tareas): ' + JSON.stringify(cola));
  return { ok: true, pendientes: cola.length, cola };
}
