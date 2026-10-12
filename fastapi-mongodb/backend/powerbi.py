"""
SIGECO — Endpoints para Power BI / Metabase / ETL
===================================================
Expone datos en formato plano (JSON flat) optimizado para consumo desde
herramientas de BI externas. Usa un token estático (POWERBI_TOKEN) separado
del JWT de usuarios para autenticación de las consultas BI.

Endpoints:
  GET /api/powerbi/contribuyentes         → padrón completo flat
  GET /api/powerbi/morosidad-summary      → resumen de mora por clasificación y período
  GET /api/powerbi/recaudacion            → serie temporal de cobros (notificaciones cobradas)
  GET /api/powerbi/gestiones-summary      → resumen de gestiones por tipo y resultado
  GET /api/powerbi/convenios-summary      → resumen de convenios activos/cerrados
  GET /api/powerbi/kpis-snapshot          → snapshot diario de KPIs (para series históricas)

Autenticación:
  Header: Authorization: Bearer <POWERBI_TOKEN>
  El token se configura en .env como POWERBI_TOKEN (cadena fija, no JWT).
  Fallback: también acepta JWT normal (usuarios con rol AUDITOR o superior).
"""

import hashlib
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from pymongo import ASCENDING, DESCENDING
from motor.motor_asyncio import AsyncIOMotorClient

from auth import require_any, get_current_user
from jose import JWTError

# ── Env ───────────────────────────────────────────────────────────────────────
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    with open(_env_path, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

MONGO_URI    = os.getenv("MONGO_URI",    "mongodb://localhost:27017")
DB_NAME      = os.getenv("DB_NAME",      "Thunder")
POWERBI_TOKEN = os.getenv("POWERBI_TOKEN", "")  # token fijo para BI, vacío = deshabilitado

_client      = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db          = _client[DB_NAME]
_col_thunder = _db[os.getenv("COL_CONTRIB", "Base1,5")]
_col_notif   = _db["notificaciones"]
_col_gest    = _db["gestiones"]
_col_conv    = _db["convenios"]
_col_kpis    = _db["kpis_historico"]   # colección para snapshots diarios

router = APIRouter(prefix="/api/powerbi", tags=["Power BI / BI"])

from auth import oauth2_scheme, get_current_user

# ── Auth helper para BI (token fijo o JWT normal) ─────────────────────────────

async def _require_bi_auth(token: str = Depends(oauth2_scheme)):
    """
    Acepta:
      1. 'Bearer <POWERBI_TOKEN>' (token fijo configurado en .env)
      2. 'Bearer <JWT>'  (usuario con cualquier rol via get_current_user)
    """
    if POWERBI_TOKEN and token == POWERBI_TOKEN:
        return {"username": "powerbi_connector", "role": "AUDITOR"}

    # 2. JWT normal usando la misma validación que el resto de la app
    try:
        user = await get_current_user(token)
        return user
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mora_clasificar(saldo: float) -> str:
    if saldo <= 0:
        return "AL_DIA"
    if saldo < 500:
        return "MORA_LEVE"
    if saldo < 2000:
        return "MORA_MEDIA"
    if saldo < 5000:
        return "MORA_ALTA"
    if saldo < 20000:
        return "MORA_CRITICA"
    return "COACTIVA"


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/contribuyentes")
async def contribuyentes_flat(
    limit:     int  = Query(5000, ge=1, le=10000),   # máx 10K por request para evitar sobrecarga
    offset:    int  = Query(0, ge=0),
    tipo:      Optional[str] = Query(None, description="NATURAL o JURIDICA"),
    estado:    Optional[str] = Query(None),
    _auth:     dict = Depends(_require_bi_auth),
):
    """
    Padrón completo de contribuyentes en formato flat para Power BI.
    Campos: Ruc, NombreContribuyente, TipoPersona, EstadoDeclaracion,
            ValorImpuesto, ValorPagado, Saldo, clasificacion_mora,
            Direccion, ActividadEconomicaPrincipal.
    """
    filtro: dict = {}
    if tipo:
        filtro["TipoPersona"] = tipo
    if estado:
        filtro["EstadoDeclaracion"] = estado

    proyeccion = {
        "_id": 0,
        "Ruc": 1,
        "NombreContribuyente": 1,
        "TipoPersona": 1,
        "EstadoDeclaracion": 1,
        "TipoDeclaracion": 1,
        "ValorImpuesto": 1,
        "ValorPagado": 1,
        "Saldo": 1,
        "Direccion": 1,
        "ActividadEconomicaPrincipal": 1,
        "RepresentanteLegal": 1,
    }

    cursor = _col_thunder.find(filtro, proyeccion).skip(offset).limit(limit)
    docs = await cursor.to_list(limit)

    # Añadir clasificación calculada
    for d in docs:
        saldo = float(d.get("Saldo") or 0)
        d["clasificacion_mora"] = _mora_clasificar(saldo)
        d["Saldo"]         = round(saldo, 2)
        d["ValorImpuesto"] = round(float(d.get("ValorImpuesto") or 0), 2)
        d["ValorPagado"]   = round(float(d.get("ValorPagado") or 0), 2)

    return {
        "total_registros": len(docs),
        "offset": offset,
        "limit": limit,
        "generado_en": datetime.utcnow().isoformat() + "Z",
        "datos": docs,
    }


@router.get("/morosidad-summary")
async def morosidad_summary(
    agrupacion: str = Query("clasificacion", regex="^(clasificacion|tipo_persona|actividad)$"),
    _auth:      dict = Depends(_require_bi_auth),
):
    """
    Resumen agregado de morosidad agrupado por clasificación, tipo de persona o actividad.
    Ideal para gráficos de barras / torta en Power BI.
    """
    group_field = {
        "clasificacion": None,  # se calcula en Python
        "tipo_persona":  "$TipoPersona",
        "actividad":     "$ActividadEconomicaPrincipal",
    }[agrupacion]

    # Usar agregación MongoDB en lugar de cargar docs en Python (más eficiente)
    if agrupacion == "tipo_persona":
        group_id = "$TipoPersona"
    elif agrupacion == "actividad":
        group_id = {"$substr": ["$ActividadEconomicaPrincipal", 0, 60]}
    else:
        # Para clasificacion se usa ValorPagar como proxy de saldo
        group_id = {
            "$switch": {
                "branches": [
                    {"case": {"$lte": ["$ValorPagar", 0]},    "then": "AL_DIA"},
                    {"case": {"$lt":  ["$ValorPagar", 500]},  "then": "MORA_LEVE"},
                    {"case": {"$lt":  ["$ValorPagar", 2000]}, "then": "MORA_MEDIA"},
                    {"case": {"$lt":  ["$ValorPagar", 5000]}, "then": "MORA_ALTA"},
                    {"case": {"$lt":  ["$ValorPagar", 20000]},"then": "MORA_CRITICA"},
                ],
                "default": "COACTIVA",
            }
        }

    pipeline = [
        {"$match": {"ValorPagar": {"$gt": 0}}},
        {"$group": {
            "_id":         group_id,
            "contribuyentes": {"$sum": 1},
            "deuda_total":    {"$sum": "$ValorPagar"},
        }},
        {"$sort": {"deuda_total": -1}},
        {"$limit": 50},
    ]
    rows = await _col_thunder.aggregate(pipeline, allowDiskUse=True).to_list(50)
    resultado = [
        {
            "grupo":          str(r["_id"]) if r["_id"] else "SIN_DATOS",
            "contribuyentes": r["contribuyentes"],
            "deuda_total":    round(r["deuda_total"], 2),
        }
        for r in rows
    ]

    return {
        "agrupacion": agrupacion,
        "generado_en": datetime.utcnow().isoformat() + "Z",
        "datos": resultado,
    }


@router.get("/recaudacion")
async def recaudacion_serie(
    anios:    int = Query(2, ge=1, le=5),
    _auth:    dict = Depends(_require_bi_auth),
):
    """
    Serie temporal mensual de notificaciones cobradas (proxy de recaudación).
    Retorna filas: anio, mes, notificaciones_cobradas, total_deuda_gestionada.
    """
    hoy = datetime.utcnow()
    desde = datetime(hoy.year - anios + 1, 1, 1)

    pipeline = [
        {"$match": {"estado": "cobrada", "fechaActualizacion": {"$gte": desde}}},
        {"$group": {
            "_id": {
                "anio": {"$year": "$fechaActualizacion"},
                "mes":  {"$month": "$fechaActualizacion"},
            },
            "notificaciones_cobradas": {"$sum": 1},
            "deuda_gestionada":        {"$sum": {"$ifNull": ["$montoDeuda", 0]}},
        }},
        {"$sort": {"_id.anio": ASCENDING, "_id.mes": ASCENDING}},
    ]

    cursor = _col_notif.aggregate(pipeline)
    rows = await cursor.to_list(100)
    datos = []
    for r in rows:
        datos.append({
            "anio":                   r["_id"]["anio"],
            "mes":                    r["_id"]["mes"],
            "periodo":                f"{r['_id']['anio']}-{r['_id']['mes']:02d}",
            "notificaciones_cobradas": r["notificaciones_cobradas"],
            "deuda_gestionada":       round(r["deuda_gestionada"], 2),
        })

    return {
        "anios": anios,
        "generado_en": datetime.utcnow().isoformat() + "Z",
        "datos": datos,
    }


@router.get("/gestiones-summary")
async def gestiones_summary(
    anio: Optional[int] = Query(None),
    mes:  Optional[int] = Query(None),
    _auth: dict = Depends(_require_bi_auth),
):
    """Resumen de gestiones por tipo y resultado en el período."""
    hoy  = datetime.utcnow()
    anio = anio or hoy.year
    mes  = mes  or hoy.month

    try:
        inicio = datetime(anio, mes, 1)
        fin    = datetime(anio, mes + 1, 1) if mes < 12 else datetime(anio + 1, 1, 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Período inválido")

    pipeline = [
        {"$match": {"fechaGestion": {"$gte": inicio, "$lt": fin}}},
        {"$group": {
            "_id": {"tipo": "$tipoGestion", "resultado": "$resultado"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": DESCENDING}},
    ]
    cursor = _col_gest.aggregate(pipeline)
    rows = await cursor.to_list(100)
    datos = [
        {
            "tipo":      r["_id"].get("tipo", "N/A"),
            "resultado": r["_id"].get("resultado", "N/A"),
            "cantidad":  r["count"],
        }
        for r in rows
    ]
    return {
        "periodo":    f"{anio}-{mes:02d}",
        "generado_en": datetime.utcnow().isoformat() + "Z",
        "datos":      datos,
    }


@router.get("/convenios-summary")
async def convenios_summary(_auth: dict = Depends(_require_bi_auth)):
    """Resumen de convenios de pago por estado."""
    pipeline = [
        {"$group": {
            "_id": "$estado",
            "count":       {"$sum": 1},
            "monto_total": {"$sum": "$montoTotal"},
            "monto_cobrado": {"$sum": "$montoCobrado"},
        }},
    ]
    cursor = _col_conv.aggregate(pipeline)
    rows = await cursor.to_list(20)
    datos = [
        {
            "estado":        r["_id"] or "SIN_ESTADO",
            "convenios":     r["count"],
            "monto_total":   round(r["monto_total"], 2),
            "monto_cobrado": round(r["monto_cobrado"], 2),
            "pendiente":     round(r["monto_total"] - r["monto_cobrado"], 2),
        }
        for r in rows
    ]
    return {
        "generado_en": datetime.utcnow().isoformat() + "Z",
        "datos":       datos,
    }


@router.get("/kpis-snapshot")
async def kpis_snapshot(_auth: dict = Depends(_require_bi_auth)):
    """
    KPIs del día actual y serie histórica de snapshots.
    Los snapshots se acumulan en la colección kpis_historico (1 por día).
    """
    hoy = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Calcular KPIs actuales
    total_contribuyentes = await _col_thunder.count_documents({})
    total_en_mora        = await _col_thunder.count_documents({"Saldo": {"$gt": 0}})
    notif_pendientes     = await _col_notif.count_documents({"estado": "pendiente"})
    notif_en_gestion     = await _col_notif.count_documents({"estado": "en_gestion"})
    notif_cobradas_mes   = await _col_notif.count_documents({
        "estado": "cobrada",
        "fechaActualizacion": {"$gte": hoy.replace(day=1)},
    })
    convenios_activos    = await _col_conv.count_documents({"estado": "activo"})

    cursor_deuda = _col_thunder.aggregate([
        {"$match": {"Saldo": {"$gt": 0}}},
        {"$group": {"_id": None, "total": {"$sum": "$Saldo"}}},
    ])
    deuda_agg = await cursor_deuda.to_list(1)
    deuda_total = round(deuda_agg[0]["total"] if deuda_agg else 0, 2)

    snapshot = {
        "fecha":                hoy,
        "total_contribuyentes": total_contribuyentes,
        "total_en_mora":        total_en_mora,
        "pct_mora":             round((total_en_mora / total_contribuyentes * 100) if total_contribuyentes else 0, 2),
        "deuda_total":          deuda_total,
        "notif_pendientes":     notif_pendientes,
        "notif_en_gestion":     notif_en_gestion,
        "notif_cobradas_mes":   notif_cobradas_mes,
        "convenios_activos":    convenios_activos,
    }

    # Guardar snapshot del día (upsert)
    await _col_kpis.update_one(
        {"fecha": hoy},
        {"$set": snapshot},
        upsert=True,
    )

    # Retornar también los últimos 90 días de historial
    cursor_hist = _col_kpis.find({}, {"_id": 0}).sort("fecha", DESCENDING).limit(90)
    historico = await cursor_hist.to_list(90)
    for d in historico:
        if isinstance(d.get("fecha"), datetime):
            d["fecha"] = d["fecha"].strftime("%Y-%m-%d")

    snapshot_out = {k: v for k, v in snapshot.items() if k != "fecha"}
    snapshot_out["fecha"] = hoy.strftime("%Y-%m-%d")
    snapshot_out["generado_en"] = datetime.utcnow().isoformat() + "Z"
    snapshot_out["historico_90d"] = historico

    return snapshot_out
