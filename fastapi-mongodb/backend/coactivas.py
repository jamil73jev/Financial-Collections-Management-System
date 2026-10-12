"""
SIGECO — Módulo de Proceso Coactivo
======================================
Gestión del proceso de cobro coactivo para contribuyentes en mora alta.

Colección: coactivas
Esquema:
{
  "_id":              ObjectId,
  "expediente":       "COA-2026-001",        # número correlativo
  "ruc":              str,
  "contribuyente":    str,
  "montoTotal":       float,
  "etapa":            "inicio|citacion|embargo|remate|cobro|suspendido|cerrado",
  "abogado":          str | None,
  "juicio":           str | None,             # número de juicio
  "fechaInicio":      ISODate,
  "fechaUltimaActuacion": ISODate | None,
  "actuaciones":      [
    { "tipo": str, "descripcion": str, "fecha": ISODate, "usuario": str, "documento": str|None }
  ],
  "estado":           "activo | suspendido | cerrado",
  "creadoPor":        str,
  "creadoEn":         ISODate,
}
"""

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import DESCENDING
from motor.motor_asyncio import AsyncIOMotorClient

from auth import require_any, require_supervisor, require_gestor

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

_client       = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db           = _client[DB_NAME]
_col          = _db["coactivas"]
_col_thunder  = _db[os.getenv("COL_CONTRIB", "Base1,5")]
_col_audit    = _db["auditoria"]
_col_counter  = _db["contadores"]

router = APIRouter(prefix="/api/coactivas", tags=["Coactiva"])

# ── Etapas válidas ─────────────────────────────────────────────────────────────
ETAPAS = ["inicio", "citacion", "embargo", "remate", "cobro"]
ESTADOS = ["activo", "suspendido", "cerrado"]

# ── Helpers ───────────────────────────────────────────────────────────────────

async def _next_expediente() -> str:
    """Genera correlativo COA-YYYY-NNN."""
    anio = datetime.utcnow().year
    res = await _col_counter.find_one_and_update(
        {"_id": f"coactiva_{anio}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = res.get("seq", 1)
    return f"COA-{anio}-{seq:04d}"


def _to_dict(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    for k in ("fechaInicio", "fechaUltimaActuacion", "creadoEn"):
        if isinstance(doc.get(k), datetime):
            doc[k] = doc[k].isoformat()
    for act in doc.get("actuaciones", []):
        if isinstance(act.get("fecha"), datetime):
            act["fecha"] = act["fecha"].isoformat()
    return doc


async def _audit(tipo, entidad_id, detalle, usuario):
    await _col_audit.insert_one({
        "tipo": tipo, "entidad": "coactivas", "entidadId": entidad_id,
        "detalle":   detalle, "usuario": usuario, "fecha": datetime.utcnow().isoformat(),
    })


# ── KPIs ──────────────────────────────────────────────────────────────────────

@router.get("/kpis")
async def kpis_coactivas(current_user: dict = Depends(require_any)):
    """Resumen ejecutivo del módulo coactivo."""
    total        = await _col.count_documents({})
    activos      = await _col.count_documents({"estado": "activo"})
    suspendidos  = await _col.count_documents({"estado": "suspendido"})
    cerrados     = await _col.count_documents({"estado": "cerrado"})

    monto_agg = await _col.aggregate([
        {"$match": {"estado": "activo"}},
        {"$group": {"_id": None, "total": {"$sum": "$montoTotal"}}},
    ]).to_list(1)
    monto_activo = round(monto_agg[0]["total"] if monto_agg else 0, 2)

    por_etapa_agg = await _col.aggregate([
        {"$match": {"estado": "activo"}},
        {"$group": {"_id": "$etapa", "count": {"$sum": 1}}},
    ]).to_list(10)
    por_etapa = {r["_id"]: r["count"] for r in por_etapa_agg}

    return {
        "total":           total,
        "activos":         activos,
        "suspendidos":     suspendidos,
        "cerrados":        cerrados,
        "monto_en_proceso": monto_activo,
        "por_etapa":       {e: por_etapa.get(e, 0) for e in ETAPAS},
    }


# ── Listado ────────────────────────────────────────────────────────────────────

@router.get("")
async def listar_coactivas(
    estado:    Optional[str] = Query(None),
    etapa:     Optional[str] = Query(None),
    buscar:    Optional[str] = Query(None),
    skip:      int = Query(0, ge=0),
    limit:     int = Query(50, ge=1, le=200),
    current_user: dict = Depends(require_any),
):
    filtro: dict = {}
    if estado:
        filtro["estado"] = estado
    if etapa:
        filtro["etapa"] = etapa
    if buscar:
        filtro["$or"] = [
            {"ruc":            {"$regex": buscar, "$options": "i"}},
            {"contribuyente":  {"$regex": buscar, "$options": "i"}},
            {"expediente":     {"$regex": buscar, "$options": "i"}},
        ]

    total = await _col.count_documents(filtro)
    cursor = _col.find(filtro).sort("fechaInicio", DESCENDING).skip(skip).limit(limit)
    docs = await cursor.to_list(limit)
    return {"total": total, "skip": skip, "limit": limit, "data": [_to_dict(d) for d in docs]}


# ── Obtener uno ────────────────────────────────────────────────────────────────

@router.get("/{cid}")
async def obtener_coactiva(cid: str, current_user: dict = Depends(require_any)):
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=422, detail="ID inválido")
    doc = await _col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")
    return _to_dict(doc)


# ── Crear expediente ──────────────────────────────────────────────────────────

@router.post("")
async def crear_coactiva(body: dict, current_user: dict = Depends(require_supervisor)):
    """
    Inicia un proceso coactivo para un contribuyente.
    Requiere: ruc, montoTotal. Opcional: abogado, juicio.
    """
    ruc = (body.get("ruc") or "").strip()
    if not ruc:
        raise HTTPException(status_code=422, detail="RUC es requerido")

    monto = float(body.get("montoTotal") or 0)
    if monto <= 0:
        raise HTTPException(status_code=422, detail="El monto debe ser mayor a 0")

    # Buscar nombre en Thunder
    contrib = await _col_thunder.find_one({"Ruc": ruc}, {"NombreContribuyente": 1})
    nombre = body.get("contribuyente") or (contrib["NombreContribuyente"] if contrib else ruc)

    # Verificar si ya tiene proceso activo
    existente = await _col.find_one({"ruc": ruc, "estado": "activo"})
    if existente:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe un proceso coactivo activo para este RUC: {existente.get('expediente')}"
        )

    expediente = await _next_expediente()
    doc = {
        "expediente":           expediente,
        "ruc":                  ruc,
        "contribuyente":        nombre,
        "montoTotal":           monto,
        "etapa":                "inicio",
        "abogado":              body.get("abogado"),
        "juicio":               body.get("juicio"),
        "fechaInicio":          datetime.utcnow(),
        "fechaUltimaActuacion": None,
        "actuaciones":          [{
            "tipo":        "INICIO",
            "descripcion": body.get("observacion") or "Inicio del proceso coactivo",
            "fecha":       datetime.utcnow(),
            "usuario":     current_user["username"],
            "documento":   None,
        }],
        "estado":    "activo",
        "creadoPor": current_user["username"],
        "creadoEn":  datetime.utcnow(),
    }
    await _col.insert_one(doc)
    await _audit("Creación", expediente, f"Proceso coactivo {expediente} para RUC {ruc}", current_user["username"])
    return _to_dict(doc)


# ── Actualizar etapa ──────────────────────────────────────────────────────────

@router.put("/{cid}/etapa")
async def avanzar_etapa(cid: str, body: dict, current_user: dict = Depends(require_supervisor)):
    """
    Avanza el expediente a la siguiente etapa o a una específica.
    body: { etapa: str, descripcion: str, documento: str|None }
    """
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=422, detail="ID inválido")

    nueva_etapa = body.get("etapa", "").strip()
    if nueva_etapa not in ETAPAS:
        raise HTTPException(status_code=422, detail=f"Etapa inválida. Válidas: {ETAPAS}")

    doc = await _col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")
    if doc["estado"] != "activo":
        raise HTTPException(status_code=409, detail="Solo se pueden modificar expedientes activos")

    actuacion = {
        "tipo":        f"AVANCE_ETAPA_{nueva_etapa.upper()}",
        "descripcion": body.get("descripcion") or f"Avance a etapa: {nueva_etapa}",
        "fecha":       datetime.utcnow(),
        "usuario":     current_user["username"],
        "documento":   body.get("documento"),
    }
    await _col.update_one(
        {"_id": oid},
        {
            "$set": {
                "etapa": nueva_etapa,
                "fechaUltimaActuacion": datetime.utcnow(),
            },
            "$push": {"actuaciones": actuacion},
        },
    )
    await _audit("Modificación", doc["expediente"], f"Avance a etapa {nueva_etapa}", current_user["username"])
    return {"mensaje": f"Etapa actualizada a '{nueva_etapa}'"}


# ── Agregar actuación ─────────────────────────────────────────────────────────

@router.post("/{cid}/actuaciones")
async def agregar_actuacion(cid: str, body: dict, current_user: dict = Depends(require_gestor)):
    """
    Registra una nueva actuación en el expediente (diligencia, notificación, etc.).
    body: { tipo: str, descripcion: str, documento: str|None }
    """
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=422, detail="ID inválido")

    doc = await _col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    tipo_act = (body.get("tipo") or "DILIGENCIA").upper()
    descripcion = (body.get("descripcion") or "").strip()
    if not descripcion:
        raise HTTPException(status_code=422, detail="La descripción es requerida")

    actuacion = {
        "tipo":        tipo_act,
        "descripcion": descripcion,
        "fecha":       datetime.utcnow(),
        "usuario":     current_user["username"],
        "documento":   body.get("documento"),
    }
    await _col.update_one(
        {"_id": oid},
        {
            "$push": {"actuaciones": actuacion},
            "$set":  {"fechaUltimaActuacion": datetime.utcnow()},
        },
    )
    return {"mensaje": "Actuación registrada"}


# ── Cambiar estado (suspender / cerrar) ───────────────────────────────────────

@router.put("/{cid}/estado")
async def cambiar_estado(cid: str, body: dict, current_user: dict = Depends(require_supervisor)):
    """
    Suspende o cierra un expediente coactivo.
    body: { estado: 'suspendido'|'cerrado'|'activo', motivo: str }
    """
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=422, detail="ID inválido")

    nuevo_estado = body.get("estado", "").strip()
    if nuevo_estado not in ESTADOS:
        raise HTTPException(status_code=422, detail=f"Estado inválido. Válidos: {ESTADOS}")

    doc = await _col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    motivo = body.get("motivo") or f"Cambio de estado a {nuevo_estado}"
    actuacion = {
        "tipo":        f"ESTADO_{nuevo_estado.upper()}",
        "descripcion": motivo,
        "fecha":       datetime.utcnow(),
        "usuario":     current_user["username"],
        "documento":   None,
    }
    await _col.update_one(
        {"_id": oid},
        {
            "$set":  {"estado": nuevo_estado, "fechaUltimaActuacion": datetime.utcnow()},
            "$push": {"actuaciones": actuacion},
        },
    )
    await _audit("Modificación", doc["expediente"], motivo, current_user["username"])
    return {"mensaje": f"Estado actualizado a '{nuevo_estado}'"}


# ── Actualizar datos generales ────────────────────────────────────────────────

@router.put("/{cid}")
async def actualizar_coactiva(cid: str, body: dict, current_user: dict = Depends(require_supervisor)):
    """Actualiza abogado, juicio, o monto del expediente."""
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=422, detail="ID inválido")

    update: dict = {}
    if "abogado"  in body: update["abogado"]  = body["abogado"]
    if "juicio"   in body: update["juicio"]   = body["juicio"]
    if "montoTotal" in body:
        try:
            update["montoTotal"] = float(body["montoTotal"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="montoTotal debe ser numérico")

    if not update:
        raise HTTPException(status_code=422, detail="Nada que actualizar")

    result = await _col.update_one({"_id": oid}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")
    return {"mensaje": "Expediente actualizado"}
