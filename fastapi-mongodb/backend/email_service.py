"""
SIGECO — Servicio de Correo Electrónico
=========================================
Envío de notificaciones de cobranza por email usando SMTP/aiosmtplib.
Compatible con:
  - Gmail  (SMTP_HOST=smtp.gmail.com  SMTP_PORT=587)
  - Outlook (SMTP_HOST=smtp.office365.com SMTP_PORT=587)
  - Sendgrid (SMTP_HOST=smtp.sendgrid.net SMTP_PORT=587)
  - Servidor corporativo SMTP del Municipio

Variables de entorno requeridas:
  SMTP_HOST         (default: smtp.gmail.com)
  SMTP_PORT         (default: 587)
  SMTP_USER         correo del remitente
  SMTP_PASS         contraseña o app-password
  EMAIL_FROM_NAME   (default: SIGECO - Municipio de Guayaquil)
  EMAIL_REPLY_TO    (default: igual a SMTP_USER)

Variables de entorno opcionales:
  SMTP_TLS          (default: true — STARTTLS en puerto 587)
  SMTP_SSL          (default: false — SSL directo en puerto 465)
"""

import asyncio
import logging
import os
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

logger = logging.getLogger("sigeco")

# ── Config ─────────────────────────────────────────────────────────────────────
SMTP_HOST      = os.getenv("SMTP_HOST",       "smtp.gmail.com")
SMTP_PORT      = int(os.getenv("SMTP_PORT",   "587"))
SMTP_USER      = os.getenv("SMTP_USER",       "")
SMTP_PASS      = os.getenv("SMTP_PASS",       "")
SMTP_TLS       = os.getenv("SMTP_TLS",        "true").lower() == "true"
SMTP_SSL       = os.getenv("SMTP_SSL",        "false").lower() == "true"
FROM_NAME      = os.getenv("EMAIL_FROM_NAME", "SIGECO - Municipio de Guayaquil")
REPLY_TO       = os.getenv("EMAIL_REPLY_TO",  SMTP_USER)


# ── Verificación de configuración ─────────────────────────────────────────────
def email_configured() -> bool:
    """Retorna True si SMTP_USER y SMTP_PASS están configurados."""
    return bool(SMTP_USER and SMTP_PASS)


# ── Plantillas HTML ───────────────────────────────────────────────────────────
_HTML_BASE = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{subject}</title>
<style>
  body {{ margin:0; padding:0; background:#f5f5f5; font-family:'Segoe UI',Arial,sans-serif; }}
  .wrapper {{ max-width:620px; margin:24px auto; background:#ffffff; border-radius:8px; overflow:hidden;
              box-shadow:0 2px 12px rgba(0,0,0,.1); }}
  .header {{ background:#1A2472; padding:24px 32px; }}
  .header-title {{ color:#F5C000; font-size:22px; font-weight:700; margin:0; }}
  .header-sub {{ color:#a0aed4; font-size:13px; margin:4px 0 0; }}
  .accent {{ height:4px; background:linear-gradient(90deg,#F5C000,#ffdc6e); }}
  .body {{ padding:28px 32px; color:#333; font-size:15px; line-height:1.6; }}
  .body h2 {{ color:#1A2472; font-size:17px; margin-top:0; }}
  .info-box {{ background:#f0f3ff; border-left:4px solid #1A2472; padding:14px 18px;
               border-radius:0 6px 6px 0; margin:18px 0; }}
  .info-row {{ display:flex; justify-content:space-between; padding:4px 0;
               border-bottom:1px solid #e2e6f3; font-size:14px; }}
  .info-row:last-child {{ border-bottom:none; }}
  .info-label {{ color:#666; }}
  .info-value {{ font-weight:600; color:#1A2472; }}
  .amount {{ font-size:26px; font-weight:700; color:#e53e3e; text-align:center;
             padding:16px; background:#fff5f5; border-radius:6px; margin:20px 0; }}
  .btn {{ display:block; width:fit-content; margin:24px auto 0; padding:12px 32px;
          background:#1A2472; color:#fff!important; text-decoration:none;
          border-radius:6px; font-weight:600; font-size:15px; text-align:center; }}
  .warning {{ background:#fffbeb; border:1px solid #f5c000; border-radius:6px;
              padding:12px 16px; font-size:13px; color:#7a5800; margin-top:18px; }}
  .footer {{ background:#f7f8fc; padding:16px 32px; text-align:center;
             font-size:12px; color:#999; border-top:1px solid #e8eaf0; }}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <p class="header-title">🏛️ Municipio de Guayaquil</p>
    <p class="header-sub">Departamento de Control Financiero y Estadística — SIGECO</p>
  </div>
  <div class="accent"></div>
  <div class="body">
    {content}
  </div>
  <div class="footer">
    Este mensaje fue generado automáticamente por SIGECO v2.0 &nbsp;·&nbsp;
    Municipio de Guayaquil &nbsp;·&nbsp; {year}<br>
    No responda a este correo directamente. Contacte al departamento en {reply_to}.
  </div>
</div>
</body>
</html>"""


def _render(content: str, subject: str) -> str:
    return _HTML_BASE.format(
        content=content,
        subject=subject,
        year=datetime.utcnow().year,
        reply_to=REPLY_TO or "controlfinanciero@guayaquil.gob.ec",
    )


def _tpl_notificacion_cobro(
    nombre: str,
    ruc: str,
    valor_deuda: float,
    tipo_notif: str,
    plazo_dias: int = 15,
) -> tuple[str, str]:
    """Plantilla: notificación de cobro formal."""
    subject = f"Notificación de Obligación Tributaria — {ruc}"
    content = f"""
    <h2>Estimado/a contribuyente,</h2>
    <p>
      Le comunicamos que la entidad municipal ha registrado una obligación tributaria
      pendiente de pago a su nombre.
    </p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Contribuyente</span>
        <span class="info-value">{nombre}</span>
      </div>
      <div class="info-row">
        <span class="info-label">RUC / Cédula</span>
        <span class="info-value">{ruc}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Tipo de notificación</span>
        <span class="info-value">{tipo_notif.upper()}</span>
      </div>
    </div>
    <div class="amount">💰 ${valor_deuda:,.2f} USD</div>
    <p>
      Le solicitamos regularizar su situación en un plazo de <strong>{plazo_dias} días hábiles</strong>
      a partir de la recepción de esta comunicación.
    </p>
    <div class="warning">
      ⚠️ El incumplimiento de esta obligación puede derivar en la aplicación de recargos,
      multas e inicio del proceso coactivo según la normativa municipal vigente.
    </div>
    <p style="margin-top:20px;">
      Para más información o acuerdos de pago, comuníquese con nuestro departamento
      al correo <a href="mailto:{REPLY_TO}">{REPLY_TO}</a>.
    </p>
    """
    return subject, _render(content, subject)


def _tpl_convenio_creado(
    nombre: str,
    ruc: str,
    monto_total: float,
    n_cuotas: int,
    monto_cuota: float,
    periodicidad: str,
    primera_fecha: str,
) -> tuple[str, str]:
    """Plantilla: confirmación de convenio de pago."""
    subject = f"Convenio de Pago Aprobado — {ruc}"
    content = f"""
    <h2>Convenio de pago registrado</h2>
    <p>
      Se ha aprobado un acuerdo de pago fraccionado para la deuda tributaria
      pendiente a nombre de <strong>{nombre}</strong>.
    </p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Monto total acordado</span>
        <span class="info-value">${monto_total:,.2f}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Número de cuotas</span>
        <span class="info-value">{n_cuotas} cuota(s) {periodicidad}(es)</span>
      </div>
      <div class="info-row">
        <span class="info-label">Valor por cuota</span>
        <span class="info-value">${monto_cuota:,.2f}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Primera cuota</span>
        <span class="info-value">{primera_fecha}</span>
      </div>
    </div>
    <p>
      Es importante cumplir con las fechas de pago acordadas para evitar
      el incumplimiento del convenio y sus consecuencias legales.
    </p>
    <div class="warning">
      ⚠️ Recuerde que el incumplimiento de dos o más cuotas consecutivas
      produce la terminación automática del convenio.
    </div>
    """
    return subject, _render(content, subject)


def _tpl_cuota_vencida(
    nombre: str,
    ruc: str,
    n_cuota: int,
    monto_cuota: float,
    fecha_vencimiento: str,
) -> tuple[str, str]:
    """Plantilla: cuota de convenio vencida."""
    subject = f"Cuota de Convenio Vencida — {ruc}"
    content = f"""
    <h2>⚠️ Cuota pendiente de pago</h2>
    <p>
      Le informamos que la cuota <strong>N° {n_cuota}</strong> de su convenio
      de pago ha vencido sin registrar pago.
    </p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Contribuyente</span>
        <span class="info-value">{nombre}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Cuota N°</span>
        <span class="info-value">{n_cuota}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Monto</span>
        <span class="info-value">${monto_cuota:,.2f}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Fecha de vencimiento</span>
        <span class="info-value">{fecha_vencimiento}</span>
      </div>
    </div>
    <div class="warning">
      ⚠️ Si no regulariza su pago en los próximos 5 días hábiles,
      su convenio podrá quedar sin efecto.
    </div>
    """
    return subject, _render(content, subject)


# ── Función de envío ──────────────────────────────────────────────────────────
async def _send_async(
    to_email: str,
    subject: str,
    html_body: str,
    attachment_path: Optional[Path] = None,
    attachment_name: Optional[str]  = None,
) -> None:
    """Envía un correo HTML con adjunto opcional usando aiosmtplib."""
    try:
        import aiosmtplib
    except ImportError:
        raise RuntimeError("aiosmtplib no instalado. Ejecuta: pip install aiosmtplib")

    msg = MIMEMultipart("mixed")
    msg["From"]     = f"{FROM_NAME} <{SMTP_USER}>"
    msg["To"]       = to_email
    msg["Subject"]  = subject
    msg["Reply-To"] = REPLY_TO or SMTP_USER

    # Parte HTML
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(alt)

    # Adjunto opcional (PDF)
    if attachment_path and attachment_path.exists():
        with open(attachment_path, "rb") as f:
            part = MIMEApplication(f.read(), _subtype="pdf")
        part.add_header(
            "Content-Disposition",
            "attachment",
            filename=attachment_name or attachment_path.name,
        )
        msg.attach(part)

    kwargs: dict = {
        "hostname": SMTP_HOST,
        "port":     SMTP_PORT,
        "username": SMTP_USER,
        "password": SMTP_PASS,
    }
    if SMTP_TLS and not SMTP_SSL:
        kwargs["start_tls"] = True
    elif SMTP_SSL:
        kwargs["use_tls"] = True

    await aiosmtplib.send(msg, **kwargs)
    logger.info("Email enviado a %s: %s", to_email, subject)


# send_email eliminado en favor de las funciones async especializadas.


# ── API conveniente ───────────────────────────────────────────────────────────
async def enviar_notificacion_cobro(
    to_email: str,
    nombre: str,
    ruc: str,
    valor_deuda: float,
    tipo_notif: str = "notificación formal",
    plazo_dias: int = 15,
    pdf_path: Optional[Path] = None,
) -> bool:
    if not email_configured():
        logger.warning("Email no configurado. Omitiendo notificación cobro.")
        return False
    if not to_email or "@" not in to_email:
        return False

    subject, html = _tpl_notificacion_cobro(nombre, ruc, valor_deuda, tipo_notif, plazo_dias)
    try:
        await _send_async(
            to_email,
            subject,
            html,
            attachment_path=pdf_path,
            attachment_name=f"notificacion_{ruc}.pdf" if pdf_path else None,
        )
        return True
    except Exception as exc:
        logger.error("Error al enviar notificación de cobro a %s: %s", to_email, exc)
        return False


async def enviar_confirmacion_convenio(
    to_email: str,
    nombre: str,
    ruc: str,
    monto_total: float,
    n_cuotas: int,
    monto_cuota: float,
    periodicidad: str,
    primera_fecha: str,
) -> bool:
    if not email_configured(): return False
    subject, html = _tpl_convenio_creado(
        nombre, ruc, monto_total, n_cuotas, monto_cuota, periodicidad, primera_fecha
    )
    try:
        await _send_async(to_email, subject, html)
        return True
    except Exception:
        return False


async def enviar_aviso_cuota_vencida(
    to_email: str,
    nombre: str,
    ruc: str,
    n_cuota: int,
    monto_cuota: float,
    fecha_vencimiento: str,
) -> bool:
    if not email_configured(): return False
    subject, html = _tpl_cuota_vencida(
        nombre, ruc, n_cuota, monto_cuota, fecha_vencimiento
    )
    try:
        await _send_async(to_email, subject, html)
        return True
    except Exception:
        return False
