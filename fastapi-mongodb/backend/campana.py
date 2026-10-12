"""
SIGECO — Campañas de Notificación Masiva
==========================================
Permite crear lotes de notificaciones para grupos de morosos según filtros,
con resumen previo (preview) antes de confirmar.

Colección: campanas
Esquema:
{
  "_id":         ObjectId,
  "nombre":      str,
  "filtro":      { clasificacion: str, tipo_persona: str, ... },
  "mensaje":     str,
  "medio":       "email"|"SMS"|"WhatsApp"|"carta",
  "empleadoId":  str,
  "estado":      "preview"|"ejecutada"|"cancelada",
  "total_contrib": int,
  "con_contacto":  int,
  "sin_contacto":  int,
  "notif_creadas": int,
  "creadoPor":   str,
  "creadoEn":    ISODate,
  "ejecutadaEn": ISODate | None,
}
"""

import asyncio
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import DESCENDING
from motor.motor_asyncio import AsyncIOMotorClient

from auth import require_supervisor, require_gestor, require_any

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
_col_camp     = _db["campanas"]
_col_thunder  = _db[os.getenv("COL_CONTRIB", "Base1,5")]
_col_notif    = _db["notificaciones"]
_col_empl     = _db["empleados"]

router = APIRouter(prefix="/api/campanas", tags=["Campañas Masivas"])

# ── Clasificación (debe coincidir con morosidad.py) ───────────────────────────
def _clasificar(saldo: float) -> str:
    if saldo <= 0:     return "AL_DIA"
    if saldo < 500:    return "MORA_LEVE"
    if saldo < 2000:   return "MORA_MEDIA"
    if saldo < 5000:   return "MORA_ALTA"
    if saldo < 20000:  return "MORA_CRITICA"
    return "COACTIVA"


def _build_thunder_query(filtro: dict) -> dict:
    """Convierte filtros de campaña a query MongoDB para Thunder."""
    query: dict = {}

    clasificacion = filtro.get("clasificacion")
    if clasificacion and clasificacion != "TODOS":
        # Mapear clasificación a rango de saldo
        rangos = {
            "MORA_LEVE":    {"$gt": 0, "$lt": 500},
            "MORA_MEDIA":   {"$gte": 500, "$lt": 2000},
            "MORA_ALTA":    {"$gte": 2000, "$lt": 5000},
            "MORA_CRITICA": {"$gte": 5000, "$lt": 20000},
            "COACTIVA":     {"$gte": 20000},
            "EN_MORA":      {"$gt": 0},  # todos con deuda
        }
        if clasificacion in rangos:
            query["Saldo"] = rangos[clasificacion]

    if filtro.get("tipo_persona"):
        query["TipoPersona"] = filtro["tipo_persona"]

    if filtro.get("estado_declaracion"):
        query["EstadoDeclaracion"] = filtro["estado_declaracion"]

    return query


# ── Preview ────────────────────────────────────────────────────────────────────

@router.post("/preview")
async def preview_campana(body: dict, current_user: dict = Depends(require_supervisor)):
    """
    Previsualiza cuántos contribuyentes serán notificados sin crear nada.
    Usa count_documents para los totales (sin cargar todos los docs en memoria)
    y solo trae 10 documentos de muestra para la tabla de preview.
    body: { nombre, filtro: {clasificacion, tipo_persona?}, mensaje, medio, empleadoId? }
    """
    filtro = body.get("filtro") or {}
    query  = _build_thunder_query(filtro)

    # ── Conteos eficientes con count_documents (sin cargar docs) ─────────────
    total_contrib = await _col_thunder.count_documents(query)

    # Construir queries para contacto combinando el filtro base
    query_email = {**query, "CorreoEMAS": {"$exists": True, "$nin": [None, ""]}}
    query_tel   = {**query, "TelefonoEMAS": {"$exists": True, "$nin": [None, ""]}}
    query_sin   = {**query, "CorreoEMAS": {"$in": [None, ""]}, "TelefonoEMAS": {"$in": [None, ""]}}

    con_email, con_tel, sin_contacto = await asyncio.gather(
        _col_thunder.count_documents(query_email),
        _col_thunder.count_documents(query_tel),
        _col_thunder.count_documents(query_sin),
    )

    # ── Solo 10 docs de muestra para mostrar en pantalla ─────────────────────
    proyeccion = {"_id": 0, "Ruc": 1, "NombreContribuyente": 1, "ValorPagar": 1,
                  "CorreoEMAS": 1, "TelefonoEMAS": 1}
    muestra_docs = await _col_thunder.find(query, proyeccion).limit(10).to_list(10)

    muestra = [{
        "ruc":           c.get("Ruc", ""),
        "nombre":        c.get("NombreContribuyente", ""),
        "saldo":         round(float(c.get("ValorPagar") or 0), 2),
        "clasificacion": _clasificar(float(c.get("ValorPagar") or 0)),
        "tiene_email":   bool(c.get("CorreoEMAS")),
        "tiene_tel":     bool(c.get("TelefonoEMAS")),
    } for c in muestra_docs]

    return {
        "total_contrib":   total_contrib,
        "con_email":       con_email,
        "con_telefono":    con_tel,
        "sin_contacto":    sin_contacto,
        "filtro_aplicado": filtro,
        "muestra_10":      muestra,
    }


# ── Crear campaña y ejecutar ──────────────────────────────────────────────────

@router.post("/ejecutar")
async def ejecutar_campana(body: dict, current_user: dict = Depends(require_supervisor)):
    """
    Crea N notificaciones en estado 'pendiente' para todos los contribuyentes del filtro.
    body: { nombre, filtro, mensaje, medio, empleadoId }
    """
    nombre     = (body.get("nombre") or "").strip()
    mensaje    = (body.get("mensaje") or "").strip()
    medio      = body.get("medio", "email")
    empleado_id = body.get("empleadoId")

    if not nombre or not mensaje:
        raise HTTPException(status_code=422, detail="nombre y mensaje son requeridos")

    filtro = body.get("filtro") or {}
    query  = _build_thunder_query(filtro)

    # Verificar que hay contribuyentes antes de cargar
    total_disponible = await _col_thunder.count_documents(query)
    if total_disponible == 0:
        raise HTTPException(status_code=422, detail="El filtro no devuelve contribuyentes")

    # Límite configurable: máx 50.000 por campaña para evitar sobrecarga
    LIMITE_CAMPANA = int(os.getenv("CAMPANA_LIMITE", "50000"))
    proyeccion = {"_id": 0, "Ruc": 1, "NombreContribuyente": 1, "ValorPagar": 1,
                  "CorreoEMAS": 1, "TelefonoEMAS": 1}
    cursor = _col_thunder.find(query, proyeccion).limit(LIMITE_CAMPANA)
    contribuyentes = await cursor.to_list(LIMITE_CAMPANA)

    # Datos del empleado (opcional)
    empleado_nombre = current_user["username"]
    if empleado_id:
        try:
            emp = await _col_empl.find_one({"_id": ObjectId(empleado_id)}, {"nombre": 1})
            if emp:
                empleado_nombre = emp.get("nombre", empleado_nombre)
        except Exception:
            pass

    ahora = datetime.utcnow()
    con_contacto = 0
    sin_contacto = 0
    notificaciones = []

    for c in contribuyentes:
        tiene_contacto = bool(c.get("CorreoEMAS") or c.get("TelefonoEMAS"))
        if tiene_contacto:
            con_contacto += 1
        else:
            sin_contacto += 1

        notificaciones.append({
            "ruc":            c["Ruc"],
            "contribuyente":  c.get("NombreContribuyente", c["Ruc"]),
            "montoDeuda":     round(float(c.get("ValorPagar") or 0), 2),
            "estado":         "pendiente",
            "medioNotificacion": medio,
            "mensaje":        mensaje,
            "empleadoId":     empleado_id,
            "empleadoNombre": empleado_nombre,
            "fechaCreacion":  ahora,
            "creadoPor":      current_user["username"],
            "origen":         "campana_masiva",
            "campana":        nombre,
        })

    if notificaciones:
        await _col_notif.insert_many(notificaciones, ordered=False)

    # Guardar registro de campaña
    camp_doc = {
        "nombre":        nombre,
        "filtro":        filtro,
        "mensaje":       mensaje,
        "medio":         medio,
        "empleadoId":    empleado_id,
        "estado":        "ejecutada",
        "total_contrib": len(contribuyentes),
        "con_contacto":  con_contacto,
        "sin_contacto":  sin_contacto,
        "notif_creadas": len(notificaciones),
        "creadoPor":     current_user["username"],
        "creadoEn":      ahora,
        "ejecutadaEn":   ahora,
    }
    await _col_camp.insert_one(camp_doc)

    return {
        "mensaje":       f"Campaña ejecutada: {len(notificaciones)} notificaciones creadas",
        "total_contrib": len(contribuyentes),
        "con_contacto":  con_contacto,
        "sin_contacto":  sin_contacto,
        "notif_creadas": len(notificaciones),
    }


# ── Historial de campañas ─────────────────────────────────────────────────────

@router.get("")
async def listar_campanas(
    skip:  int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_any),
):
    total = await _col_camp.count_documents({})
    cursor = _col_camp.find({}).sort("creadoEn", DESCENDING).skip(skip).limit(limit)
    docs = await cursor.to_list(limit)
    for d in docs:
        d["_id"] = str(d["_id"])
        if isinstance(d.get("creadoEn"),   datetime): d["creadoEn"]   = d["creadoEn"].isoformat()
        if isinstance(d.get("ejecutadaEn"),datetime): d["ejecutadaEn"]= d["ejecutadaEn"].isoformat()
    return {"total": total, "data": docs}
