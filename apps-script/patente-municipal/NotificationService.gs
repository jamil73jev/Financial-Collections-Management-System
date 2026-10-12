/**
 * NotificationService.gs
 * Envío de notificaciones por correo para SIGECO.
 * Usa GmailApp — scope requerido: https://www.googleapis.com/auth/gmail.send
 *
 * Puntos de entrada:
 *   enviarAlertasVencidos()       — trigger diario 8am
 *   enviarRecordatorioGestion()   — llamado desde GestionService al registrar fechaProxima
 *   enviarConfirmacionCierre()    — llamado desde GestionService al cerrar exitosamente
 */

// ============================================================
// TRIGGER DIARIO — alertas VENCIDO / CRITICO
// ============================================================

function enviarAlertasVencidos() {
  try {
    const emailAdmin = _notifGetEmailAdmin();
    if (!emailAdmin) {
      Logger.log('NotificationService: EMAIL_ADMIN no configurado — omitiendo alertas.');
      return;
    }

    const expedientes = getDataAsObjects(SHEET_NAMES.EXPEDIENTES)
      .filter(e => (e.ACTIVO === 'TRUE' || e.ACTIVO === true) &&
                   (e.ALERTA_ESTADO === 'VENCIDO' || e.ALERTA_ESTADO === 'CRITICO'));

    if (expedientes.length === 0) {
      Logger.log('NotificationService: Sin expedientes VENCIDO/CRITICO hoy.');
      return;
    }

    const municipio = getConfig('NOMBRE_MUNICIPIO', 'Municipio');
    const hoy       = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, 'dd/MM/yyyy');

    // Agrupar por gestor
    const porGestor = {};
    expedientes.forEach(e => {
      const g = e.FUNCIONARIO_ASIGNADO || '';
      if (!porGestor[g]) porGestor[g] = [];
      porGestor[g].push(e);
    });

    // Correo individual a cada gestor
    let gestoresNotificados = 0;
    Object.entries(porGestor).forEach(([correo, exps]) => {
      if (!correo || !correo.includes('@')) return;
      try {
        const filas = exps.map(e => `
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${e.ID_EXPEDIENTE || ''}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${e.CONTRIBUYENTE || ''}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${_notifFmtMonto(e.TOTAL_DEUDA)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-weight:600;color:${e.ALERTA_ESTADO === 'CRITICO' ? '#c62828' : '#e65100'}">${e.ALERTA_ESTADO}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${e.DIAS_SIN_MOVIMIENTO || 0} días</td>
          </tr>`).join('');

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto">
            <div style="background:#1a237e;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
              <h2 style="margin:0;font-size:16px">⚠️ SIGECO — Expedientes con Alerta</h2>
              <p style="margin:4px 0 0;font-size:12px;opacity:.8">${municipio} · ${hoy}</p>
            </div>
            <div style="background:#fff8e1;padding:12px 20px;border-left:4px solid #ff8f00">
              <strong>Tienes ${exps.length} expediente(s) con alerta de vencimiento.</strong>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:#f5f5f5;font-size:11px;color:#666">
                  <th style="padding:8px 10px;text-align:left">Expediente</th>
                  <th style="padding:8px 10px;text-align:left">Contribuyente</th>
                  <th style="padding:8px 10px;text-align:left">Deuda</th>
                  <th style="padding:8px 10px;text-align:left">Alerta</th>
                  <th style="padding:8px 10px;text-align:left">Sin movimiento</th>
                </tr>
              </thead>
              <tbody>${filas}</tbody>
            </table>
            <p style="font-size:11px;color:#999;padding:12px 20px">
              Accede al sistema SIGECO para actualizar las gestiones pendientes.
            </p>
          </div>`;

        GmailApp.sendEmail(
          correo,
          '[SIGECO] ' + exps.length + ' expediente(s) con alerta — ' + hoy,
          'Este mensaje requiere un cliente de correo con soporte HTML.',
          { htmlBody: html, name: 'SIGECO Notificaciones' }
        );
        gestoresNotificados++;
        Logger.log('Alerta enviada a: ' + correo + ' (' + exps.length + ' expedientes)');
      } catch (eGestor) {
        Logger.log('Error enviando alerta a ' + correo + ': ' + eGestor.message);
      }
    });

    // Resumen ejecutivo al administrador
    const totalDeuda = expedientes.reduce((s, e) => s + (parseFloat(e.TOTAL_DEUDA) || 0), 0);
    const htmlAdmin = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1a237e;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
          <h2 style="margin:0;font-size:16px">📊 SIGECO — Resumen Diario de Alertas</h2>
          <p style="margin:4px 0 0;font-size:12px;opacity:.8">${municipio} · ${hoy}</p>
        </div>
        <div style="padding:20px;background:#fff;font-size:14px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:7px 0;color:#555;width:220px">Expedientes con alerta:</td>
                <td style="font-weight:700;color:#c62828">${expedientes.length}</td></tr>
            <tr><td style="padding:7px 0;color:#555">Deuda total involucrada:</td>
                <td style="font-weight:700;color:#1a237e">${_notifFmtMonto(totalDeuda)}</td></tr>
            <tr><td style="padding:7px 0;color:#555">Gestores notificados:</td>
                <td style="font-weight:700">${gestoresNotificados}</td></tr>
            <tr><td style="padding:7px 0;color:#555">CRITICO:</td>
                <td>${expedientes.filter(e => e.ALERTA_ESTADO === 'CRITICO').length}</td></tr>
            <tr><td style="padding:7px 0;color:#555">VENCIDO:</td>
                <td>${expedientes.filter(e => e.ALERTA_ESTADO === 'VENCIDO').length}</td></tr>
          </table>
        </div>
      </div>`;

    GmailApp.sendEmail(
      emailAdmin,
      '[SIGECO] Resumen alertas ' + hoy + ' — ' + expedientes.length + ' expediente(s)',
      'Este mensaje requiere un cliente de correo con soporte HTML.',
      { htmlBody: htmlAdmin, name: 'SIGECO Notificaciones' }
    );

    logActionSystem({
      hoja:     SHEET_NAMES.EXPEDIENTES,
      accion:   'NOTIFICACION_ALERTAS_DIARIA',
      contexto: 'Gestores: ' + gestoresNotificados + ' | Expedientes: ' + expedientes.length,
      origen:   'NotificationService.gs'
    });

  } catch (err) {
    Logger.log('enviarAlertasVencidos ERROR: ' + err.message + '\n' + err.stack);
  }
}

// ============================================================
// RECORDATORIO — fechaProximaGestion registrada
// Llamado desde GestionService.registerGestion()
// ============================================================

function enviarRecordatorioGestion(gestorCorreo, expediente, fechaProxima) {
  try {
    if (!gestorCorreo || !gestorCorreo.includes('@') || !expediente || !fechaProxima) return;

    const municipio = getConfig('NOMBRE_MUNICIPIO', 'Municipio');
    const fechaFmt  = String(fechaProxima).substring(0, 10);

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#2e7d32;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
          <h2 style="margin:0;font-size:16px">📅 Próxima Gestión Programada — SIGECO</h2>
          <p style="margin:4px 0 0;font-size:12px;opacity:.8">${municipio}</p>
        </div>
        <div style="padding:20px;background:#fff;font-size:14px">
          <p style="margin:0 0 12px">Se ha programado una acción de cobro para:</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr><td style="padding:5px 0;color:#666;width:180px">Expediente:</td>
                <td style="font-weight:600">${expediente.ID_EXPEDIENTE || ''}</td></tr>
            <tr><td style="padding:5px 0;color:#666">Contribuyente:</td>
                <td>${expediente.CONTRIBUYENTE || ''}</td></tr>
            <tr><td style="padding:5px 0;color:#666">Deuda total:</td>
                <td>${_notifFmtMonto(expediente.TOTAL_DEUDA)}</td></tr>
            <tr><td style="padding:5px 0;color:#666">Fecha programada:</td>
                <td style="font-weight:700;color:#2e7d32;font-size:15px">${fechaFmt}</td></tr>
          </table>
        </div>
        <div style="background:#e8f5e9;padding:10px 20px;font-size:11px;color:#555;border-radius:0 0 6px 6px">
          Este recordatorio fue generado automáticamente por SIGECO.
        </div>
      </div>`;

    GmailApp.sendEmail(
      gestorCorreo,
      '[SIGECO] Gestión programada: ' + (expediente.ID_EXPEDIENTE || '') + ' — ' + fechaFmt,
      'Este mensaje requiere un cliente de correo con soporte HTML.',
      { htmlBody: html, name: 'SIGECO Notificaciones' }
    );
    Logger.log('Recordatorio enviado a: ' + gestorCorreo);
  } catch (err) {
    Logger.log('enviarRecordatorioGestion ERROR: ' + err.message);
  }
}

// ============================================================
// CONFIRMACIÓN — expediente cerrado exitosamente
// Llamado desde GestionService.registerGestion()
// ============================================================

function enviarConfirmacionCierre(gestorCorreo, expediente) {
  try {
    if (!gestorCorreo || !expediente) return;

    const emailAdmin = _notifGetEmailAdmin();
    const municipio  = getConfig('NOMBRE_MUNICIPIO', 'Municipio');
    const hoy        = Utilities.formatDate(new Date(), PARAMS.TIMEZONE, 'dd/MM/yyyy');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1b5e20;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
          <h2 style="margin:0;font-size:16px">✅ Expediente Cerrado Exitosamente</h2>
          <p style="margin:4px 0 0;font-size:12px;opacity:.8">${municipio} · ${hoy}</p>
        </div>
        <div style="background:#e8f5e9;padding:12px 20px;border-left:4px solid #2e7d32">
          <strong style="color:#1b5e20">La deuda ha sido recuperada y el expediente está cerrado.</strong>
        </div>
        <div style="padding:20px;background:#fff;font-size:13px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:5px 0;color:#666;width:180px">Expediente:</td>
                <td style="font-weight:600">${expediente.ID_EXPEDIENTE || ''}</td></tr>
            <tr><td style="padding:5px 0;color:#666">Contribuyente:</td>
                <td>${expediente.CONTRIBUYENTE || ''}</td></tr>
            <tr><td style="padding:5px 0;color:#666">RUC:</td>
                <td>${expediente.RUC || ''}</td></tr>
            <tr><td style="padding:5px 0;color:#666">Deuda recuperada:</td>
                <td style="font-weight:700;color:#1b5e20;font-size:15px">${_notifFmtMonto(expediente.TOTAL_DEUDA)}</td></tr>
          </table>
        </div>
      </div>`;

    GmailApp.sendEmail(
      gestorCorreo,
      '[SIGECO] ✅ Cierre exitoso: ' + (expediente.ID_EXPEDIENTE || ''),
      'Este mensaje requiere un cliente de correo con soporte HTML.',
      { htmlBody: html, name: 'SIGECO Notificaciones' }
    );

    if (emailAdmin && emailAdmin !== gestorCorreo && emailAdmin.includes('@')) {
      GmailApp.sendEmail(
        emailAdmin,
        '[SIGECO] Cierre exitoso: ' + (expediente.ID_EXPEDIENTE || '') + ' — ' + (expediente.CONTRIBUYENTE || ''),
        'Este mensaje requiere un cliente de correo con soporte HTML.',
        { htmlBody: html, name: 'SIGECO Notificaciones' }
      );
    }
    Logger.log('Confirmación cierre enviada: ' + (expediente.ID_EXPEDIENTE || ''));
  } catch (err) {
    Logger.log('enviarConfirmacionCierre ERROR: ' + err.message);
  }
}

// ============================================================
// TRIGGER INSTALADOR — ejecutar 1 vez desde la consola GAS
// ============================================================

function instalarTriggerNotificaciones() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'enviarAlertasVencidos')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('enviarAlertasVencidos')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  Logger.log('Trigger de notificaciones instalado (diario 8am).');
}

// ============================================================
// FUNCIONES PRIVADAS
// ============================================================

function _notifGetEmailAdmin() {
  return getConfig('EMAIL_ADMIN', '') || '';
}

function _notifFmtMonto(valor) {
  const n = parseFloat(valor) || 0;
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '$ ' + parts.join('.');
}
