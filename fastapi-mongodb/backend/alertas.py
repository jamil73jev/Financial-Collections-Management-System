"""
SIGECO — Sistema de Alertas Automáticas
=========================================
- APScheduler: tareas diarias a las 07:00 (análisis de mora, vencimientos, pendientes)
- Colección MongoDB: alertas
- Endpoints REST para consultar y gestionar alertas
- Badge en topbar: conteo de alertas no vistas del usuario actual

Esquema de alerta:
{
  "_id":         ObjectId,
  "tipo":        "mora_nueva" | "cuota_vencida" | "notif_pendiente" | "notif_sin_respuesta" | "resumen_diario",
  "titulo":      str,
  "mensaje":     str,
  "ruc":         str | None,
  "contribuyente": str | None,
  "referencia_id": str | None,     # ID del objeto relacionado
  "referencia_col": str | None,    # colección del objeto relacionado
  "urgencia":    "alta" | "media" | "baja",
  "para_roles":  ["ADMINISTRADOR", "SUPERVISOR", ...],
  "para_usuario": str | None,      # si es personal de un gestor específico
  "visto_por":   [str],            # lista de usernames que ya lo vieron
  "fecha":       ISODate,
}
"""

import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import DESCENDING
from motor.motor_asyncio import AsyncIOMotorClient

from auth import require_any, require_supervisor

# ── Env ───────────────────────────────────────────────────────────────────────
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    with open(_env_path, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME   = os.getenv("DB_NAME",   "Thunder")

_client     = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db         = _client[DB_NAME]
_col_alertas = _db["alertas"]
_col_notif   = _db["notificaciones"]
_col_conv    = _db["convenios"]
_col_thunder = _db[os.getenv("COL_CONTRIB", "Thunder")]

logger = logging.getLogger("sigeco.alertas")

router = APIRouter(prefix="/api/alertas", tags=["Alertas"])

# ── Roles que reciben alertas de supervisión ──────────────────────────────────
_ROLES_SUPERVISORES = ["ADMINISTRADOR", "SUPERVISOR"]
_ROLES_TODOS        = ["ADMINISTRADOR", "SUPERVISOR", "GESTOR", "AUDITOR"]


# ═══════════════════════════════════════════════════════════════════════════════
# GENERADORES DE ALERTAS (llamados por el scheduler)
# ═══════════════════════════════════════════════════════════════════════════════

async def _insertar_alerta(
    tipo: str,
    titulo: str,
    mensaje: str,
    urgencia: str = "media",
    para_roles: list = None,
    para_usuario: str = None,
    ruc: str = None,
    contribuyente: str = None,
    referencia_id: str = None,
    referencia_col: str = None,
):
    """Inserta una alerta en la colección (evita duplicados del mismo día)."""
    hoy = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    manana = hoy + timedelta(days=1)

    # Evitar duplicado del mismo tipo/ruc en el mismo día
    filtro = {"tipo": tipo, "fecha": {"$gte": hoy, "$lt": manana}}
    if ruc:
        filtro["ruc"] = ruc
    if para_usuario:
        filtro["para_usuario"] = para_usuario

    if await _col_alertas.find_one(filtro):
        return  # ya existe

    doc = {
        "tipo":           tipo,
        "titulo":         titulo,
        "mensaje":        mensaje,
        "ruc":            ruc,
        "contribuyente":  contribuyente,
        "referencia_id":  referencia_id,
        "referencia_col": referencia_col,
        "urgencia":       urgencia,
        "para_roles":     para_roles or _ROLES_SUPERVISORES,
        "para_usuario":   para_usuario,
        "visto_por":      [],
        "fecha":          datetime.utcnow(),
    }
    await _col_alertas.insert_one(doc)


async def generar_alertas_notificaciones_pendientes():
    """
    Notificaciones con estado 'pendiente' por más de 7 días sin actualización.
    """
    limite = datetime.utcnow() - timedelta(days=7)
    cursor = _col_notif.find({
        "estado": "pendiente",
        "fechaCreacion": {"$lt": limite},
    }, {"_id": 1, "ruc": 1, "contribuyente": 1, "empleadoNombre": 1})
    
    count = 0
    async for n in cursor:
        await _insertar_alerta(
            tipo="notif_pendiente",
            titulo="Notificación pendiente sin gestión",
            mensaje=f"La notificación de {n.get('contribuyente', n.get('ruc', 'N/A'))} "
                    f"lleva más de 7 días en estado pendiente.",
            urgencia="media",
            para_roles=_ROLES_SUPERVISORES,
            ruc=n.get("ruc"),
            contribuyente=n.get("contribuyente"),
            referencia_id=str(n["_id"]),
            referencia_col="notificaciones",
        )
        count += 1

    logger.info(f"Alertas notif_pendiente generadas: {count}")
    return count


async def generar_alertas_sin_respuesta():
    """
    Notificaciones en estado 'enviada' sin respuesta por más de 15 días.
    """
    limite = datetime.utcnow() - timedelta(days=15)
    cursor = _col_notif.find({
        "estado": "enviada",
        "fechaEnvio": {"$lt": limite},
    }, {"_id": 1, "ruc": 1, "contribuyente": 1})

    count = 0
    async for n in cursor:
        await _insertar_alerta(
            tipo="notif_sin_respuesta",
            titulo="Notificación enviada sin respuesta",
            mensaje=f"{n.get('contribuyente', n.get('ruc', 'N/A'))} no ha respondido "
                    f"en más de 15 días desde el envío.",
            urgencia="alta",
            para_roles=_ROLES_SUPERVISORES,
            ruc=n.get("ruc"),
            contribuyente=n.get("contribuyente"),
            referencia_id=str(n["_id"]),
            referencia_col="notificaciones",
        )
        count += 1

    logger.info(f"Alertas notif_sin_respuesta generadas: {count}")
    return count


async def generar_alertas_cuotas_vencidas():
    """
    Cuotas de convenios vencidas ayer sin pago registrado.
    """
    ayer = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    hoy  = ayer + timedelta(days=1)

    pipeline = [
        {"$match": {"estado": "activo"}},
        {"$unwind": "$cuotas"},
        {"$match": {
            "cuotas.fechaVencimiento": {"$gte": ayer, "$lt": hoy},
            "cuotas.estado": {"$ne": "pagada"},
        }},
        {"$project": {
            "ruc": 1,
            "contribuyente": 1,
            "cuota_num": "$cuotas.numero",
            "cuota_monto": "$cuotas.monto",
        }},
    ]

    count = 0
    cursor = _col_conv.aggregate(pipeline)
    async for doc in cursor:
        await _insertar_alerta(
            tipo="cuota_vencida",
            titulo="Cuota de convenio vencida",
            mensaje=f"Cuota #{doc.get('cuota_num')} de {doc.get('contribuyente', doc.get('ruc', 'N/A'))} "
                    f"venció ayer (${doc.get('cuota_monto', 0):.2f}) y no fue pagada.",
            urgencia="alta",
            para_roles=_ROLES_SUPERVISORES,
            ruc=doc.get("ruc"),
            contribuyente=doc.get("contribuyente"),
            referencia_id=str(doc["_id"]),
            referencia_col="convenios",
        )
        count += 1

    logger.info(f"Alertas cuota_vencida generadas: {count}")
    return count


async def generar_resumen_diario():
    """
    Resumen diario de actividad del día anterior para supervisores.
    """
    ayer = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    hoy  = ayer + timedelta(days=1)
    rango = {"$gte": ayer, "$lt": hoy}

    pendientes  = await _col_notif.count_documents({"estado": "pendiente"})
    en_gestion  = await _col_notif.count_documents({"estado": "en_gestion"})
    cobradas    = await _col_notif.count_documents({"estado": "cobrada", "fechaActualizacion": rango})
    nuevas_hoy  = await _col_notif.count_documents({"fechaCreacion": rango})

    mensaje = (
        f"Ayer: {nuevas_hoy} notificaciones creadas, {cobradas} cobradas. "
        f"Acumulado: {pendientes} pendientes, {en_gestion} en gestión."
    )

    await _insertar_alerta(
        tipo="resumen_diario",
        titulo="Resumen diario de cobranza",
        mensaje=mensaje,
        urgencia="baja",
        para_roles=_ROLES_SUPERVISORES,
    )
    logger.info("Resumen diario generado")


async def ejecutar_todas_las_alertas():
    """Punto de entrada del scheduler — ejecuta todos los generadores."""
    logger.info("Iniciando generación de alertas diarias...")
    try:
        await generar_alertas_notificaciones_pendientes()
        await generar_alertas_sin_respuesta()
        await generar_alertas_cuotas_vencidas()
        await generar_resumen_diario()
        logger.info("Alertas diarias generadas correctamente")
    except Exception as e:
        logger.error(f"Error generando alertas: {e}", exc_info=True)


# ═══════════════════════════════════════════════════════════════════════════════
# SCHEDULER SETUP (se llama desde main.py al arrancar)
# ═══════════════════════════════════════════════════════════════════════════════

def iniciar_scheduler():
    """
    Inicia APScheduler con tarea diaria a las 07:00.
    Llama a esta función desde el startup event de FastAPI.
    """
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = AsyncIOScheduler(timezone="America/Guayaquil")
        scheduler.add_job(
            ejecutar_todas_las_alertas,
            trigger=CronTrigger(hour=7, minute=0),
            id="alertas_diarias",
            replace_existing=True,
            misfire_grace_time=3600,  # tolerar hasta 1h de retraso
        )
        scheduler.start()
        logger.info("Scheduler de alertas iniciado — tarea diaria a las 07:00 ECT")
        return scheduler
    except ImportError:
        logger.warning("apscheduler no instalado — alertas automáticas deshabilitadas")
        return None
    except Exception as e:
        logger.error(f"Error iniciando scheduler: {e}", exc_info=True)
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS REST
# ═══════════════════════════════════════════════════════════════════════════════

def _alerta_to_dict(doc: dict, username: str) -> dict:
    doc["_id"]   = str(doc["_id"])
    doc["vista"] = username in doc.get("visto_por", [])
    return doc


@router.get("")
async def listar_alertas(
    solo_no_vistas: bool  = Query(False),
    urgencia:       Optional[str] = Query(None, regex="^(alta|media|baja)$"),
    tipo:           Optional[str] = Query(None),
    limit:          int  = Query(20, ge=1, le=100),
    current_user:   dict = Depends(require_any),
):
    """
    Alertas visibles para el usuario actual según su rol.
    Puede filtrar por no vistas, urgencia o tipo.
    """
    username = current_user["username"]
    role     = current_user["role"]

    # Filtro base: la alerta aplica al rol del usuario o es personal suya
    filtro: dict = {
        "$or": [
            {"para_roles": role},
            {"para_usuario": username},
        ]
    }
    if solo_no_vistas:
        filtro["visto_por"] = {"$ne": username}
    if urgencia:
        filtro["urgencia"] = urgencia
    if tipo:
        filtro["tipo"] = tipo

    cursor = _col_alertas.find(filtro).sort("fecha", DESCENDING).limit(limit)
    docs = await cursor.to_list(limit)
    return [_alerta_to_dict(d, username) for d in docs]


@router.get("/resumen")
async def resumen_alertas(current_user: dict = Depends(require_any)):
    """Conteo de alertas no vistas por urgencia (para badge en topbar)."""
    username = current_user["username"]
    role     = current_user["role"]

    filtro = {
        "$or": [
            {"para_roles": role},
            {"para_usuario": username},
        ],
        "visto_por": {"$ne": username},
    }

    pipeline = [
        {"$match": filtro},
        {"$group": {"_id": "$urgencia", "count": {"$sum": 1}}},
    ]
    rows = {r["_id"]: r["count"] for r in await _col_alertas.aggregate(pipeline).to_list(10)}

    total = sum(rows.values())
    return {
        "total":    total,
        "alta":     rows.get("alta", 0),
        "media":    rows.get("media", 0),
        "baja":     rows.get("baja", 0),
    }


@router.put("/{aid}/vista")
async def marcar_vista(aid: str, current_user: dict = Depends(require_any)):
    """Marca una alerta como vista por el usuario actual."""
    try:
        oid = ObjectId(aid)
    except Exception:
        raise HTTPException(status_code=422, detail="ID inválido")

    username = current_user["username"]
    role     = current_user["role"]

    alerta = await _col_alertas.find_one({
        "_id": oid,
        "$or": [{"para_roles": role}, {"para_usuario": username}],
    })
    if not alerta:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")

    await _col_alertas.update_one(
        {"_id": oid},
        {"$addToSet": {"visto_por": username}},
    )
    return {"mensaje": "Marcada como vista"}


@router.put("/marcar-todas-vistas")
async def marcar_todas_vistas(current_user: dict = Depends(require_any)):
    """Marca todas las alertas visibles como vistas."""
    username = current_user["username"]
    role     = current_user["role"]

    filtro = {
        "$or": [
            {"para_roles": role},
            {"para_usuario": username},
        ],
        "visto_por": {"$ne": username},
    }
    result = await _col_alertas.update_many(
        filtro,
        {"$addToSet": {"visto_por": username}},
    )
    return {"actualizadas": result.modified_count}


@router.post("/ejecutar-ahora")
async def ejecutar_alertas_manual(current_user: dict = Depends(require_supervisor)):
    """Ejecuta el análisis de alertas manualmente (solo SUPERVISOR/ADMIN)."""
    try:
        await ejecutar_todas_las_alertas()
        return {"mensaje": "Análisis de alertas ejecutado correctamente"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
