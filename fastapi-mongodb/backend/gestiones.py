"""
SIGECO — Módulo de Gestiones de Cobranza
=========================================
Registro de todas las interacciones con contribuyentes:
  - Visitas domiciliarias
  - Llamadas telefónicas
  - Correos electrónicos
  - WhatsApp / mensajes
  - Notificaciones formales

Colección MongoDB: gestiones
"""

from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import DESCENDING
from motor.motor_asyncio import AsyncIOMotorClient

import os
from pathlib import Path

from auth import require_any, require_gestor, require_supervisor, get_current_user

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

_client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db     = _client[DB_NAME]
_col    = _db["gestiones"]
_col_notif = _db["notificaciones"]

router = APIRouter(prefix="/api/gestiones", tags=["Gestiones"])

# ── Proyección para lista (evita traer campos pesados innecesarios) ────────────
_PROJ_GESTIONES = {
    "_id": 1,
    "ruc": 1,
    "nombreContrib": 1,
    "tipo": 1,
    "resultado": 1,
    "gestor": 1,
    "fechaGestion": 1,
    "observaciones": 1,
    "compromisoPago": 1,
    "fechaCompromiso": 1,
    "notificacion_id": 1,
    "contribuyente_id": 1,
    "origen": 1,
}

# ── Tipos de gestión válidos ──────────────────────────────────────────────────
TIPOS_GESTION = {
    "visita",
    "llamada",
    "correo",
    "whatsapp",
    "notificacion_formal",
    "acuerdo_pago",
    "otro",
}

RESULTADOS_GESTION = {
    "contactado",
    "sin_respuesta",
    "promesa_pago",
    "pago_realizado",
    "rechazo",
    "ausente",
    "direccion_incorrecta",
    "en_seguimiento",
    "otro",
}

# ── Helpers ───────────────────────────────────────────────────────────────────
def _to_dict(doc: dict) -> dict:
    if not doc:
        return {}
    out = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _u(user: dict) -> str:
    return user.get("username", "sistema")


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("")
async def listar_gestiones(
    ruc: Optional[str]           = Query(None, description="Filtrar por RUC/cédula"),
    contribuyente_id: Optional[str] = Query(None, description="Filtrar por ID de contribuyente"),
    notificacion_id: Optional[str]  = Query(None, description="Filtrar por ID de notificación"),
    tipo: Optional[str]          = Query(None, description="Tipo de gestión"),
    resultado: Optional[str]     = Query(None, description="Resultado de la gestión"),
    gestor: Optional[str]        = Query(None, description="Username del gestor"),
    fecha_desde: Optional[str]   = Query(None, description="Desde (YYYY-MM-DD)"),
    fecha_hasta: Optional[str]   = Query(None, description="Hasta (YYYY-MM-DD)"),
    page: int                    = Query(1, ge=1),
    page_size: int               = Query(20, ge=1, le=100),
    current_user: dict           = Depends(require_any),
):
    """Lista gestiones con filtros opcionales."""
    filtro: dict = {}

    if ruc:
        filtro["ruc"] = {"$regex": ruc, "$options": "i"}
    if contribuyente_id:
        filtro["contribuyente_id"] = contribuyente_id
    if notificacion_id:
        filtro["notificacion_id"] = notificacion_id
    if tipo:
        filtro["tipo"] = tipo
    if resultado:
        filtro["resultado"] = resultado
    if gestor:
        filtro["gestor"] = gestor

    # Rango de fechas
    if fecha_desde or fecha_hasta:
        rango: dict = {}
        if fecha_desde:
            rango["$gte"] = datetime.fromisoformat(fecha_desde)
        if fecha_hasta:
            rango["$lte"] = datetime.fromisoformat(fecha_hasta + "T23:59:59")
        filtro["fechaGestion"] = rango

    total = await _col.count_documents(filtro)
    skip  = (page - 1) * page_size
    cursor = _col.find(filtro, _PROJ_GESTIONES).sort("fechaGestion", DESCENDING).skip(skip).limit(page_size)
    docs = await cursor.to_list(page_size)

    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "pages":     (total + page_size - 1) // page_size,
        "data":      [_to_dict(d) for d in docs],
    }


@router.get("/estadisticas")
async def estadisticas_gestiones(
    gestor: Optional[str] = Query(None),
    fecha_desde: Optional[str] = Query(None),
    fecha_hasta: Optional[str] = Query(None),
    current_user: dict = Depends(require_any),
):
    """KPIs de gestiones: totales por tipo, resultado y gestor."""
    match: dict = {}
    if gestor:
        match["gestor"] = gestor
    if fecha_desde or fecha_hasta:
        rango: dict = {}
        if fecha_desde:
            rango["$gte"] = datetime.fromisoformat(fecha_desde)
        if fecha_hasta:
            rango["$lte"] = datetime.fromisoformat(fecha_hasta + "T23:59:59")
        match["fechaGestion"] = rango

    pipeline_tipo = [
        {"$match": match},
        {"$group": {"_id": "$tipo", "total": {"$sum": 1}}},
        {"$sort": {"total": -1}},
    ]
    pipeline_resultado = [
        {"$match": match},
        {"$group": {"_id": "$resultado", "total": {"$sum": 1}}},
        {"$sort": {"total": -1}},
    ]
    pipeline_gestor = [
        {"$match": match},
        {"$group": {
            "_id": "$gestor",
            "total": {"$sum": 1},
            "contactados": {"$sum": {"$cond": [{"$eq": ["$resultado", "contactado"]}, 1, 0]}},
            "promesas": {"$sum": {"$cond": [{"$eq": ["$resultado", "promesa_pago"]}, 1, 0]}},
            "pagos": {"$sum": {"$cond": [{"$eq": ["$resultado", "pago_realizado"]}, 1, 0]}},
        }},
        {"$sort": {"total": -1}},
    ]

    return {
        "total": await _col.count_documents(match),
        "por_tipo":      await _col.aggregate(pipeline_tipo).to_list(100),
        "por_resultado": await _col.aggregate(pipeline_resultado).to_list(100),
        "por_gestor":    await _col.aggregate(pipeline_gestor).to_list(100),
    }


@router.get("/{gid}")
async def obtener_gestion(
    gid: str,
    current_user: dict = Depends(require_any),
):
    """Obtiene una gestión por ID."""
    try:
        oid = ObjectId(gid)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de gestión inválido")

    doc = await _col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Gestión no encontrada")
    return _to_dict(doc)


@router.post("", status_code=201)
async def crear_gestion(
    body: dict,
    current_user: dict = Depends(require_gestor),
):
    """
    Registra una nueva gestión de cobranza.

    Campos requeridos:
      - ruc           : RUC o cédula del contribuyente
      - nombreContrib : Nombre del contribuyente
      - tipo          : tipo de gestión (ver TIPOS_GESTION)
      - resultado     : resultado de la gestión (ver RESULTADOS_GESTION)

    Campos opcionales:
      - contribuyente_id : ID MongoDB del contribuyente en Thunder
      - notificacion_id  : ID de notificación relacionada
      - observaciones    : texto libre
      - compromisoPago   : monto prometido (si resultado=promesa_pago)
      - fechaCompromiso  : fecha del compromiso (ISO)
      - coordenadas      : {lat, lng} si fue visita domiciliaria
    """
    # Validaciones
    required = ["ruc", "nombreContrib", "tipo", "resultado"]
    for field in required:
        if not body.get(field):
            raise HTTPException(status_code=422, detail=f"Campo requerido: {field}")

    tipo = body["tipo"]
    resultado = body["resultado"]

    if tipo not in TIPOS_GESTION:
        raise HTTPException(
            status_code=422,
            detail=f"Tipo inválido. Válidos: {sorted(TIPOS_GESTION)}"
        )
    if resultado not in RESULTADOS_GESTION:
        raise HTTPException(
            status_code=422,
            detail=f"Resultado inválido. Válidos: {sorted(RESULTADOS_GESTION)}"
        )

    doc = {
        "ruc":              body["ruc"].strip(),
        "nombreContrib":    body["nombreContrib"].strip(),
        "tipo":             tipo,
        "resultado":        resultado,
        "observaciones":    body.get("observaciones", "").strip(),
        "gestor":           _u(current_user),
        "fechaGestion":     datetime.utcnow(),
        "fechaCreacion":    datetime.utcnow(),
    }

    # Campos opcionales
    if body.get("contribuyente_id"):
        doc["contribuyente_id"] = body["contribuyente_id"]
    if body.get("notificacion_id"):
        doc["notificacion_id"] = body["notificacion_id"]
    if body.get("compromisoPago") is not None:
        try:
            doc["compromisoPago"] = float(body["compromisoPago"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="compromisoPago debe ser numérico")
    if body.get("fechaCompromiso"):
        try:
            doc["fechaCompromiso"] = datetime.fromisoformat(body["fechaCompromiso"])
        except ValueError:
            raise HTTPException(status_code=422, detail="fechaCompromiso formato inválido (ISO)")
    if body.get("coordenadas"):
        coord = body["coordenadas"]
        if isinstance(coord, dict) and "lat" in coord and "lng" in coord:
            doc["coordenadas"] = {"lat": float(coord["lat"]), "lng": float(coord["lng"])}

    result = await _col.insert_one(doc)

    # Si viene vinculada a una notificación, agregar referencia
    if doc.get("notificacion_id"):
        try:
            notif_oid = ObjectId(doc["notificacion_id"])
            await _col_notif.update_one(
                {"_id": notif_oid},
                {
                    "$push": {"gestiones": str(result.inserted_id)},
                    "$set":  {"ultimaGestion": datetime.utcnow(), "ultimoResultado": resultado},
                }
            )
        except Exception:
            pass  # No fallar si la notificación no existe

    return {"id": str(result.inserted_id), "mensaje": "Gestión registrada"}


@router.put("/{gid}")
async def actualizar_gestion(
    gid: str,
    body: dict,
    current_user: dict = Depends(require_gestor),
):
    """Actualiza observaciones o resultado de una gestión."""
    try:
        oid = ObjectId(gid)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

    doc = await _col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Gestión no encontrada")

    # Solo el gestor que la creó o un supervisor puede editar
    if (doc.get("gestor") != _u(current_user)
            and current_user.get("role") not in ("ADMINISTRADOR", "SUPERVISOR")):
        raise HTTPException(status_code=403, detail="Solo puedes editar tus propias gestiones")

    update: dict = {}
    if "resultado" in body:
        if body["resultado"] not in RESULTADOS_GESTION:
            raise HTTPException(status_code=422, detail="Resultado inválido")
        update["resultado"] = body["resultado"]
    if "observaciones" in body:
        update["observaciones"] = body["observaciones"].strip()
    if "compromisoPago" in body:
        try:
            update["compromisoPago"] = float(body["compromisoPago"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="compromisoPago debe ser numérico")
    if "fechaCompromiso" in body:
        try:
            update["fechaCompromiso"] = datetime.fromisoformat(body["fechaCompromiso"])
        except ValueError:
            raise HTTPException(status_code=422, detail="fechaCompromiso formato inválido")

    if not update:
        raise HTTPException(status_code=422, detail="No hay campos a actualizar")

    update["fechaModificacion"] = datetime.utcnow()
    await _col.update_one({"_id": oid}, {"$set": update})
    return {"mensaje": "Gestión actualizada"}


@router.delete("/{gid}", status_code=204)
async def eliminar_gestion(
    gid: str,
    current_user: dict = Depends(require_supervisor),
):
    """Elimina una gestión (solo supervisor/admin)."""
    try:
        oid = ObjectId(gid)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

    result = await _col.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Gestión no encontrada")
