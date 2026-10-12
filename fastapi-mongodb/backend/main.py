"""
SIGECO MVP - Backend API
========================
MongoDB : localhost:27017
Base    : Base1,5
Coleccion principal: Thunder  (~442K contribuyentes del 1.5 por mil)

Schema real de Thunder:
  IdFactDeclaracion15PorMil, IdDimContribuyente, Id15PorMil
  Ruc, NombreContribuyente, Direccion, TipoPersona
  TieneEstabAbiertoGyeNotificar, DireccionSRI
  CorreoEMAS, TelefonoEMAS
  IdentificacionRepresentanteLegal, RepresentanteLegal
  ActividadEconomicaPrincipal, FechaInicioActividadEconomica
  EstadoDeclaracion, TipoDeclaracion
  IdDimTituloCredito, IdDimEstadoTitulo, IdDimConvenio
  (y más campos financieros...)

Colecciones gestionadas por el sistema:
  - Thunder        → contribuyentes (existente, solo lectura/búsqueda)
  - notificaciones → notificaciones de cobro
  - empleados      → analistas/gestores
  - auditoria      → log de cambios
  - usuarios       → usuarios del sistema con roles JWT

Uso:
    python main.py          (arranca en http://localhost:8000)
    Swagger UI:             http://localhost:8000/docs

Variables de entorno (opcionales):
    MONGO_URI        (default: mongodb://localhost:27017)
    DB_NAME          (default: Base1,5)
    COL_CONTRIB      (default: Thunder)
    PORT             (default: 8000)
    JWT_SECRET       (¡CAMBIAR EN PRODUCCIÓN!)
    JWT_EXPIRE_HOURS (default: 8)
    CORS_ORIGINS     (default: * — restringir en producción)
"""

import json
import logging
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from bson import ObjectId
from fastapi import Body, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pymongo import DESCENDING
from motor.motor_asyncio import AsyncIOMotorClient

import uvicorn

from auth import (
    router as auth_router,
    require_any,
    require_gestor,
    require_supervisor,
    require_admin,
)
from exportaciones import router as export_router
from gestiones import router as gestiones_router
from convenios import router as convenios_router
from dashboard_ejecutivo import router as dashboard_ej_router
from alertas import router as alertas_router, iniciar_scheduler
from powerbi import router as powerbi_router
from admin_importar import router as importar_router
from coactivas import router as coactivas_router
from campana import router as campana_router

# ── Rate limiting (slowapi) — opcional, no bloquea el arranque si no está instalado ──
_limiter = None
try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    _limiter = Limiter(key_func=get_remote_address)
    _RATE_LIMITING_ENABLED = True
except ImportError:
    _RATE_LIMITING_ENABLED = False

# ── Cargar .env si existe (sin dependencia extra) ─────────────────────────────
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    with open(_env_path, encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

# ── Logging estructurado ──────────────────────────────────────────────────────
_LOG_DIR = Path(__file__).parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

class _JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({
            "ts":       datetime.utcnow().isoformat() + "Z",
            "level":    record.levelname,
            "module":   record.module,
            "msg":      record.getMessage(),
            "user":     getattr(record, "user",     None),
            "endpoint": getattr(record, "endpoint", None),
        }, ensure_ascii=False)

_handler = RotatingFileHandler(
    _LOG_DIR / "sigeco.log",
    maxBytes=10_000_000,   # 10 MB por archivo
    backupCount=30,        # 30 archivos → ~300 MB máximo
    encoding="utf-8",
)
_handler.setFormatter(_JSONFormatter())

logger = logging.getLogger("sigeco")
logger.setLevel(logging.INFO)
logger.addHandler(_handler)
# También mostrar en consola con formato legible
_console = logging.StreamHandler()
_console.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
logger.addHandler(_console)

# ── Configuración ─────────────────────────────────────────────────────────────
MONGO_URI    = os.getenv("MONGO_URI",    "mongodb://localhost:27017")
DB_NAME      = os.getenv("DB_NAME",     "Thunder")
COL_CONTRIB  = os.getenv("COL_CONTRIB", "Base1,5")
PORT         = int(os.getenv("PORT",    "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# ── Aplicación ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SIGECO MVP API",
    description="Sistema de Gestión de Cobros — Municipio de Guayaquil",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Registrar routers ─────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(export_router)
app.include_router(gestiones_router)
app.include_router(convenios_router)
app.include_router(dashboard_ej_router)
app.include_router(alertas_router)
app.include_router(powerbi_router)
app.include_router(importar_router)
app.include_router(coactivas_router)
app.include_router(campana_router)

# ── Rate limiting (si slowapi está instalado) ──────────────────────────────────
if _RATE_LIMITING_ENABLED:
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    app.state.limiter = _limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Scheduler de alertas ───────────────────────────────────────────────────────
@app.on_event("startup")
async def _startup():
    app.state.scheduler = iniciar_scheduler()

@app.on_event("shutdown")
async def _shutdown():
    s = getattr(app.state, "scheduler", None)
    if s and s.running:
        s.shutdown(wait=False)

# ── MongoDB (Motor Async) ──────────────────────────────────────────────────────
client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db     = client[DB_NAME]

def col(name: str):
    return db[name]

def to_json(doc: dict) -> dict:
    """Convierte un documento MongoDB a dict serializable."""
    if not doc:
        return {}
    result = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            result[k] = str(v)
        elif isinstance(v, datetime):
            result[k] = v.isoformat()
        else:
            result[k] = v
    if "_id" in result:
        result["_id"] = str(doc.get("_id", ""))
    return result

def many_to_json(docs) -> list:
    return [to_json(d) for d in docs]

async def audit(tipo: str, entidad: str, entidad_id: str, detalle: str, usuario: str = "sistema"):
    await col("auditoria").insert_one({
        "tipo":      tipo,
        "entidad":   entidad,
        "entidadId": entidad_id,
        "detalle":   detalle,
        "usuario":   usuario,
        "fecha":     datetime.utcnow().isoformat(),
    })


def _u(current_user: dict) -> str:
    """Extrae el username del dict de usuario JWT para auditoría."""
    return current_user.get("username", "sistema")

# ─────────────────────────────────────────────────────────────────────────────
# HEALTH / CONFIG
# ─────────────────────────────────────────────────────────────────────────────

_START_TIME = datetime.utcnow()

@app.get("/api/health", tags=["Sistema"])
async def health():
    """Endpoint público de salud con métricas del sistema."""
    import time
    t0 = time.monotonic()
    try:
        await client.admin.command("ping")
        latencia_ms = round((time.monotonic() - t0) * 1000, 1)
        count = await col(COL_CONTRIB).count_documents({})
        uptime_s = int((datetime.utcnow() - _START_TIME).total_seconds())

        # Métricas de memoria (psutil opcional)
        mem_mb = None
        try:
            import psutil, os as _os
            proc = psutil.Process(_os.getpid())
            mem_mb = round(proc.memory_info().rss / 1024 / 1024, 1)
        except Exception:
            pass

        # Tamaño de la BD
        try:
            stats = await client[DB_NAME].command("dbStats")
            db_size_mb = round(stats.get("dataSize", 0) / 1024 / 1024, 1)
        except Exception:
            db_size_mb = None

        return {
            "status":    "ok",
            "version":   "2.0.0",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "uptime_s":  uptime_s,
            "uptime":    f"{uptime_s // 3600}h {(uptime_s % 3600) // 60}m",
            "mongodb": {
                "status":       "ok",
                "latencia_ms":  latencia_ms,
                "docs_thunder": count,
                "db_size_mb":   db_size_mb,
            },
            "memoria_mb":       mem_mb,
            "rate_limiting":    _RATE_LIMITING_ENABLED,
        }
    except Exception as e:
        return {"status": "error", "detalle": str(e), "timestamp": datetime.utcnow().isoformat() + "Z"}


@app.get("/api/schema", tags=["Sistema"])
async def get_schema(current_user: dict = Depends(require_any)):
    """Devuelve los campos disponibles en la colección Thunder + valores únicos de estados."""
    sample = await col(COL_CONTRIB).find_one()
    if not sample:
        return {"campos": [], "muestra": {}}
    s = to_json(sample)

    estados_unicos = [
        d["_id"] for d in await col(COL_CONTRIB).aggregate([
            {"$group": {"_id": "$EstadoDeclaracion"}},
            {"$sort": {"_id": 1}},
            {"$limit": 30},
        ]).to_list(30) if d["_id"]
    ]
    tipos_persona = [
        d["_id"] for d in await col(COL_CONTRIB).aggregate([
            {"$group": {"_id": "$TipoPersona"}},
            {"$sort": {"_id": 1}},
        ]).to_list(10) if d["_id"]
    ]

    # Conteo de colecciones para panel de monitoreo
    colecciones = ["Thunder", "notificaciones", "empleados", "auditoria",
                   "usuarios", "gestiones", "convenios", "coactivas",
                   "campanas", "alertas", "vencimientos", "pagos_importados"]
    counts = {}
    for c_name in colecciones:
        try:
            counts[c_name] = await db[c_name].count_documents({})
        except Exception:
            counts[c_name] = 0

    return {
        "campos":         list(s.keys()),
        "muestra":        s,
        "estadosUnicos":  estados_unicos,
        "tiposPersona":   tipos_persona,
        "counts":         counts,
    }


@app.get("/api/config", tags=["Sistema"])
async def get_config(current_user: dict = Depends(require_admin)):
    return {
        "db":         DB_NAME,
        "collection": COL_CONTRIB,
        "mongo_uri":  MONGO_URI.replace("//", "//***@") if "@" in MONGO_URI else MONGO_URI,
    }

# ─────────────────────────────────────────────────────────────────────────────
# CONTRIBUYENTES  (colección Thunder)
# ─────────────────────────────────────────────────────────────────────────────


# ── Proyección para la vista de lista (solo campos necesarios en pantalla) ──────
# Reducción: 70 campos → 24 campos  (~65% menos datos por request)
_PROJ_LISTA = {
    "_id": 1,
    "Ruc": 1,
    "NombreContribuyente": 1,
    "RepresentanteLegal": 1,
    "TipoPersona": 1,
    "Direccion": 1,
    "CorreoEMAS": 1,
    "TelefonoEMAS": 1,
    "ActividadEconomicaPrincipal": 1,
    "EstadoDeclaracion": 1,
    "AnioDeclaracion": 1,
    "AnioSolicitud": 1,
    "FechaExigibilidad": 1,
    "PagadoSN": 1,
    "TieneTitulo": 1,
    "TieneRemisionSN": 1,
    "Notificado15PorMil": 1,
    "ValorImpuesto": 1,
    "ValorInteres": 1,
    "ValorMulta": 1,
    "ValorRecargo": 1,
    "ValorPagar": 1,
    "IdDimConvenio": 1,
    "IdDimJuicioCoactivo": 1,
}

# Mapa de aliases: permite buscar por nombre largo o código corto de estado
_ESTADO_ALIASES = {
    "generada presuntivamente": "SGP",
    "aprobada automáticamente": "SAA",
    "recibo impreso": "RIM",
    "anulada": "SAN",
    "prescrita": "SPR",
    "títulos de crédito": "STC",
    "no sujeta a pago": "SNP",
    "exoneración": "SRE",
    "no obligada": "SNO",
    "flujo manual": "SIM",
}

@app.get("/api/contribuyentes", tags=["Contribuyentes"])
async def get_contribuyentes(
    skip:       int  = Query(0,     ge=0),
    limit:      int  = Query(50,    ge=1, le=500),
    search:     str  = Query(None),
    estado:     str  = Query(None),
    zona:       str  = Query(None),
    ciudad:     str  = Query(None, description="Filtrar por ciudad (prefijo RUC, ej: 09 para Guayaquil)"),
    detalle:    bool = Query(False, description="Si es True devuelve todos los campos (vista detalle)"),
    current_user: dict = Depends(require_any),
):
    """Lista contribuyentes con búsqueda y paginación.
    Por defecto devuelve solo 24 campos para máximo rendimiento.
    Usa ?detalle=true para obtener todos los campos.
    """
    query: dict = {}

    if search:
        query["$or"] = [
            {"Ruc":                         {"$regex": search, "$options": "i"}},
            {"NombreContribuyente":         {"$regex": search, "$options": "i"}},
            {"RepresentanteLegal":          {"$regex": search, "$options": "i"}},
            {"ActividadEconomicaPrincipal": {"$regex": search, "$options": "i"}},
            {"Direccion":                   {"$regex": search, "$options": "i"}},
            {"CorreoEMAS":                  {"$regex": search, "$options": "i"}},
        ]

    if estado:
        # Soporta código corto (SGP) y texto largo (convierte automáticamente)
        estado_upper = estado.strip().upper()
        if len(estado_upper) == 3:
            # Búsqueda exacta por código
            cond = {"EstadoDeclaracion": estado_upper}
        else:
            # Intenta convertir texto largo a código; si no, usa regex
            codigo = next(
                (v for k, v in _ESTADO_ALIASES.items() if k in estado.lower()),
                None
            )
            cond = ({"EstadoDeclaracion": codigo} if codigo
                    else {"EstadoDeclaracion": {"$regex": estado_upper, "$options": "i"}})
        if "$or" in query:
            query["$and"] = [{"$or": query.pop("$or")}, cond]
        else:
            query.update(cond)

    if zona:
        query["TipoPersona"] = zona

    if ciudad:
        # Mapeo de códigos de provincia a nombres de Cantón (según requerimiento de columna canton)
        map_cantores = {
            "09": "GUAYAQUIL",
            "17": "QUITO",
            "01": "CUENCA",
            "13": "MANTA",
            "07": "MACHALA",
            "18": "AMBATO",
        }
        val = map_cantores.get(ciudad, ciudad.upper())
        # Búsqueda exacta o parcial en la columna "Canton"
        query["Canton"] = {"$regex": f"^{val}", "$options": "i"}

    # Proyección: mínima para lista, completa solo si se pide explícitamente
    projection = None if detalle else _PROJ_LISTA

    total  = await col(COL_CONTRIB).count_documents(query)
    cursor = col(COL_CONTRIB).find(query, projection).skip(skip).limit(limit)
    docs   = await cursor.to_list(limit)

    return {
        "total":  total,
        "skip":   skip,
        "limit":  limit,
        "campos": len(_PROJ_LISTA) if not detalle else "todos",
        "data":   many_to_json(docs),
    }


@app.get("/api/contribuyentes/{doc_id}", tags=["Contribuyentes"])
async def get_contribuyente(doc_id: str, current_user: dict = Depends(require_any)):
    """Obtiene un contribuyente por _id o por Ruc."""
    # Intentar como ObjectId
    try:
        oid = ObjectId(doc_id)
        doc = await col(COL_CONTRIB).find_one({"_id": oid})
        if doc:
            return {"ok": True, "data": to_json(doc)}
    except Exception:
        pass # No es un ObjectId válido, probar como RUC

    # Probar como RUC (estándar en GAS)
    doc = await col(COL_CONTRIB).find_one({"$or": [{"Ruc": doc_id}, {"RUC": doc_id}]})
    if doc:
        return {"ok": True, "data": to_json(doc)}
    
    raise HTTPException(404, "Contribuyente no encontrado")


@app.put("/api/contribuyentes/{doc_id}", tags=["Contribuyentes"])
async def update_contribuyente(doc_id: str, payload: dict = Body(...),
                         current_user: dict = Depends(require_supervisor)):
    """Actualiza campos de un contribuyente. Requiere rol SUPERVISOR o superior."""
    try:
        oid = ObjectId(doc_id)
    except Exception:
        raise HTTPException(400, "ID inválido")

    payload.pop("_id", None)
    payload["_modificado"] = datetime.utcnow().isoformat()

    result = await col(COL_CONTRIB).update_one({"_id": oid}, {"$set": payload})
    if result.matched_count == 0:
        raise HTTPException(404, "No encontrado")

    await audit("Edición", "contribuyente", doc_id,
          f"Campos actualizados: {list(payload.keys())}", _u(current_user))
    return {"message": "Actualizado correctamente"}

# ─────────────────────────────────────────────────────────────────────────────
# DASHBOARD / KPIs
# ─────────────────────────────────────────────────────────────────────────────

async def _try_sum(field_candidates: list) -> float:
    """Suma el primer campo que tenga valores numéricos > 0."""
    for field in field_candidates:
        pipeline = [{"$group": {"_id": None,
                                "total": {"$sum": {
                                    "$convert": {
                                        "input": f"${field}",
                                        "to": "double",
                                        "onError": 0.0,
                                        "onNull": 0.0
                                    }
                                }}}}]
        try:
            r = await col(COL_CONTRIB).aggregate(pipeline).to_list(1)
        except:
            continue
        if r and r[0].get("total", 0) > 0:
            return round(r[0]["total"], 2)
    return 0.0


def _mora_switch_expr(saldo_field: str = "$_saldo") -> dict:
    """
    Expresión MongoDB $switch que clasifica un saldo en nivel de mora.
    NOTA: Usa monto de saldo como proxy de días en mora.
          No existen campos FechaVencimiento ni FechaPago en Thunder.
    Umbrales:
      AL_DIA      : saldo <= 0
      MORA_LEVE   : 0 < saldo <= 200
      MORA_MEDIA  : 200 < saldo <= 1000
      MORA_ALTA   : 1000 < saldo <= 5000
      MORA_CRITICA: saldo > 5000
    COACTIVA se aplica por separado vía IdDimConvenio.
    """
    return {
        "$switch": {
            "branches": [
                {"case": {"$lte": [saldo_field, 0]},    "then": "AL_DIA"},
                {"case": {"$lte": [saldo_field, 200]},  "then": "MORA_LEVE"},
                {"case": {"$lte": [saldo_field, 1000]}, "then": "MORA_MEDIA"},
                {"case": {"$lte": [saldo_field, 5000]}, "then": "MORA_ALTA"},
            ],
            "default": "MORA_CRITICA",
        }
    }


def _prioridad_switch_expr(mora_field: str = "$clasificacionMora") -> dict:
    """Expresión MongoDB $switch para prioridadGestion."""
    return {
        "$switch": {
            "branches": [
                {"case": {"$in": [mora_field, ["AL_DIA", "MORA_LEVE"]]},        "then": "BAJA"},
                {"case": {"$in": [mora_field, ["MORA_MEDIA"]]},                 "then": "MEDIA"},
                {"case": {"$in": [mora_field, ["MORA_ALTA"]]},                  "then": "ALTA"},
                {"case": {"$in": [mora_field, ["MORA_CRITICA", "COACTIVA"]]},   "then": "CRITICA"},
            ],
            "default": "MEDIA",
        }
    }


def _mora_pipeline_stages() -> list:
    """
    Devuelve los 4 stages de $addFields que calculan los campos de morosidad.
    Reutilizado en /api/morosidad y /api/morosidad/kpis.

    Compatibilidad: usa $ifNull de 2 argumentos (compatible desde MongoDB 3.2).
    No usa $type en contexto aggregation (problemático en versiones < 5.0).
    """
    # $ifNull anidado (2 args cada uno) para compatibilidad con MongoDB < 5.0
    stage1 = {
        "$addFields": {
            "_imp": {
                "$convert": {
                    "input": {"$ifNull": ["$ValorImpuesto",
                              {"$ifNull": ["$Impuesto",
                              {"$ifNull": ["$MontoImpuesto", 0]}]}]},
                    "to": "double", "onError": 0.0, "onNull": 0.0,
                }
            },
            "_pag": {
                "$convert": {
                    "input": {"$ifNull": ["$ValorPagado",
                              {"$ifNull": ["$MontoPagado", 0]}]},
                    "to": "double", "onError": 0.0, "onNull": 0.0,
                }
            },
        }
    }
    # _saldo: usa campo Saldo si existe y es > null (patrón $gt [$ifNull, null] es
    # universalmente compatible), sino calcula imp - pag; mínimo 0.
    stage2 = {
        "$addFields": {
            "_saldo": {
                "$max": [
                    {
                        "$cond": [
                            {"$gt": [{"$ifNull": ["$Saldo", None]}, None]},
                            {"$convert": {"input": "$Saldo", "to": "double",
                                          "onError": 0.0, "onNull": 0.0}},
                            {"$subtract": ["$_imp", "$_pag"]},
                        ]
                    },
                    0.0,
                ]
            },
            "_hasConvenio": {
                "$cond": [
                    {"$and": [
                        {"$gt": [{"$ifNull": ["$IdDimConvenio", None]}, None]},
                        {"$ne": ["$IdDimConvenio", ""]},
                        {"$ne": ["$IdDimConvenio", 0]},
                    ]},
                    True,
                    False,
                ]
            },
        }
    }
    stage3 = {
        "$addFields": {
            "clasificacionMora": {
                "$cond": {
                    "if": "$_hasConvenio",
                    "then": "COACTIVA",
                    "else": _mora_switch_expr("$_saldo"),
                }
            },
        }
    }
    stage4 = {
        "$addFields": {
            "prioridadGestion": _prioridad_switch_expr("$clasificacionMora"),
            "diasMora": {
                "$cond": [
                    {"$lte": ["$_saldo", 0]},
                    0,
                    {"$toInt": {"$min": [{"$divide": ["$_saldo", 5]}, 730]}},
                ]
            },
            "deudaTotal":   "$_imp",
            "deudaVencida": "$_saldo",
        }
    }
    return [stage1, stage2, stage3, stage4]


@app.get("/api/dashboard/kpis", tags=["Dashboard"])
async def get_kpis(current_user: dict = Depends(require_any)):
    """KPIs financieros y de gestión para el dashboard."""
    total = await col(COL_CONTRIB).count_documents({})

    # Campos financieros reales de Thunder (se prueban en orden hasta encontrar valores > 0)
    total_impuesto = await _try_sum([
        "ValorImpuesto", "Impuesto", "MontoImpuesto", "TotalImpuesto",
        "ValorDeclarado", "ValorTotal", "Monto",
        "impuesto", "valor_impuesto", "monto",
    ])
    total_pagado = await _try_sum([
        "ValorPagado", "MontoPagado", "TotalPagado", "ValorRecaudado",
        "pagado", "valor_pag_ado", "monto_pagado",
    ])
    total_saldo = await _try_sum([
        "Saldo", "SaldoPendiente", "ValorPendiente", "SaldoPorCobrar",
        "saldo", "saldo_pendiente",
    ])
    if total_saldo == 0 and total_impuesto > 0:
        total_saldo = round(total_impuesto - total_pagado, 2)

    efectividad = round((total_pagado / total_impuesto * 100) if total_impuesto else 0, 1)

    # Distribución por EstadoDeclaracion (campo real de Thunder)
    estados_pipeline = [
        {"$group": {
            "_id": {"$ifNull": ["$EstadoDeclaracion", "$TipoDeclaracion", "Sin estado"]},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
        {"$limit": 15},
    ]
    estados = await col(COL_CONTRIB).aggregate(estados_pipeline).to_list(15)

    # Recaudación mensual por FechaInicioActividadEconomica (campo real Thunder)
    mensual_pipeline = [
        {"$match": {"FechaInicioActividadEconomica": {"$ne": None, "$exists": True}}},
        {"$group": {
            "_id": {"$substr": [
                {"$ifNull": ["$FechaInicioActividadEconomica", ""]}, 0, 7
            ]},
            "total": {"$sum": {
                "$convert": {
                    "input": {"$ifNull": [
                        "$ValorPagado", "$MontoPagado", "$ValorRecaudado", 0
                    ]},
                    "to": "double",
                    "onError": 0.0,
                    "onNull": 0.0
                }
            }},
            "count": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
        {"$limit": 12},
    ]
    mensual = await col(COL_CONTRIB).aggregate(mensual_pipeline).to_list(12)

    # Stats de notificaciones
    notif_total    = await col("notificaciones").count_documents({})
    notif_pendiente = await col("notificaciones").count_documents({"estado": "pendiente"})
    notif_cobrada  = await col("notificaciones").count_documents({"estado": "cobrada"})
    notif_vencida  = await col("notificaciones").count_documents({"estado": "vencida"})

    return {
        "contribuyentes": {"total": total},
        "financiero": {
            "totalImpuesto": total_impuesto,
            "totalPagado":   total_pagado,
            "totalSaldo":    total_saldo,
            "efectividad":   efectividad,
        },
        "estados": [
            {"estado": e["_id"], "count": e["count"]}
            for e in estados if e["_id"]
        ],
        "mensual": [
            {"mes": m["_id"], "total": round(m["total"], 2)}
            for m in mensual if m["_id"]
        ],
        "notificaciones": {
            "total":     notif_total,
            "pendiente": notif_pendiente,
            "cobrada":   notif_cobrada,
            "vencida":   notif_vencida,
        },
    }

# ─────────────────────────────────────────────────────────────────────────────
# NOTIFICACIONES  (colección nueva gestionada por el sistema)
# ─────────────────────────────────────────────────────────────────────────────

ESTADOS_NOTIF = [
    "pendiente", "enviada", "recibida",
    "en_gestion", "cobrada", "vencida", "convenio",
]


@app.get("/api/notificaciones", tags=["Notificaciones"])
async def get_notificaciones(
    skip:       int = Query(0,  ge=0),
    limit:      int = Query(50, ge=1, le=500),
    estado:     str = Query(None),
    empleadoId: str = Query(None),
    search:     str = Query(None),
    current_user: dict = Depends(require_gestor),
):
    query: dict = {}
    if estado:      query["estado"]     = estado
    if empleadoId:  query["empleadoId"] = empleadoId
    if search:
        query["$or"] = [
            {"contribuyente": {"$regex": search, "$options": "i"}},
            {"ruc":           {"$regex": search, "$options": "i"}},
        ]

    total = await col("notificaciones").count_documents(query)
    cursor = col("notificaciones").find(query).sort("fechaCreacion", DESCENDING).skip(skip).limit(limit)
    docs = await cursor.to_list(limit)
    return {"total": total, "data": many_to_json(docs)}


@app.post("/api/notificaciones", tags=["Notificaciones"])
async def create_notificacion(payload: dict = Body(...),
                        current_user: dict = Depends(require_gestor)):
    """Crea una nueva notificación de cobro."""
    ahora = datetime.utcnow().isoformat()
    payload.setdefault("estado", "pendiente")
    payload["fechaCreacion"]      = ahora
    payload["fechaActualizacion"] = ahora
    payload.setdefault("historial", [{
        "estado": "pendiente",
        "fecha":  ahora,
        "observacion": "Notificación creada",
    }])

    result = await col("notificaciones").insert_one(payload)
    nid = str(result.inserted_id)
    await audit("Creación", "notificacion", nid,
          f"Nueva notificación para {payload.get('contribuyente', 'N/A')}",
          _u(current_user))
    return {"id": nid, "message": "Notificación creada"}


@app.put("/api/notificaciones/{nid}/estado", tags=["Notificaciones"])
async def update_notificacion_estado(nid: str, payload: dict = Body(...),
                               current_user: dict = Depends(require_gestor)):
    """Cambia el estado de una notificación."""
    nuevo = payload.get("estado", "")
    obs   = payload.get("observacion", "")

    if nuevo not in ESTADOS_NOTIF:
        raise HTTPException(400, f"Estado inválido. Opciones: {ESTADOS_NOTIF}")

    ahora = datetime.utcnow().isoformat()
    result = await col("notificaciones").update_one(
        {"_id": ObjectId(nid)},
        {
            "$set":  {"estado": nuevo, "fechaActualizacion": ahora},
            "$push": {"historial": {
                "estado": nuevo, "fecha": ahora,
                "observacion": obs, "usuario": _u(current_user),
            }},
        },
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Notificación no encontrada")

    await audit("Cambio Estado", "notificacion", nid,
          f"Estado → {nuevo}. {obs}", _u(current_user))
    return {"message": f"Estado actualizado a '{nuevo}'"}


@app.put("/api/notificaciones/{nid}", tags=["Notificaciones"])
async def update_notificacion(nid: str, payload: dict = Body(...),
                        current_user: dict = Depends(require_gestor)):
    """Actualiza datos de una notificación."""
    payload.pop("_id", None)
    payload["fechaActualizacion"] = datetime.utcnow().isoformat()

    result = await col("notificaciones").update_one(
        {"_id": ObjectId(nid)}, {"$set": payload}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "No encontrada")

    await audit("Edición", "notificacion", nid,
          f"Campos: {list(payload.keys())}", _u(current_user))
    return {"message": "Actualizado"}


@app.get("/api/notificaciones/{nid}", tags=["Notificaciones"])
async def get_notificacion(nid: str, current_user: dict = Depends(require_gestor)):
    """Obtiene una notificación por su ID."""
    try:
        oid = ObjectId(nid)
    except Exception:
        raise HTTPException(400, "ID inválido")
    doc = await col("notificaciones").find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Notificación no encontrada")
    return to_json(doc)


@app.get("/api/notificaciones/{nid}", tags=["Notificaciones"])
@app.delete("/api/notificaciones/{nid}", tags=["Notificaciones"])
async def delete_notificacion(nid: str, current_user: dict = Depends(require_supervisor)):
    """Elimina una notificación. Requiere rol SUPERVISOR o superior."""
    result = await col("notificaciones").delete_one({"_id": ObjectId(nid)})
    if result.deleted_count == 0:
        raise HTTPException(404, "No encontrada")
    await audit("Eliminación", "notificacion", nid,
          "Notificación eliminada", _u(current_user))
    return {"message": "Eliminada"}

# ─────────────────────────────────────────────────────────────────────────────
# EMPLEADOS
# ─────────────────────────────────────────────────────────────────────────────

_DEFAULT_EMPLEADOS = [
    {"id": "E001", "nombre": "Carlos Mendoza",  "cargo": "Analista de Cobro",   "zona": "Norte",             "email": "cmendoza@guayaquil.gob.ec",  "activo": True},
    {"id": "E002", "nombre": "María Salazar",   "cargo": "Analista de Cobro",   "zona": "Sur",               "email": "msalazar@guayaquil.gob.ec",  "activo": True},
    {"id": "E003", "nombre": "Luis Paredes",    "cargo": "Analista de Cobro",   "zona": "Centro",            "email": "lparedes@guayaquil.gob.ec",  "activo": True},
    {"id": "E004", "nombre": "Ana Guerrero",    "cargo": "Analista Senior",     "zona": "Daule-Perimetral",  "email": "aguerrero@guayaquil.gob.ec", "activo": True},
    {"id": "E005", "nombre": "Pedro Villamar",  "cargo": "Analista de Cobro",   "zona": "Samborondón Ext.",  "email": "pvillamar@guayaquil.gob.ec", "activo": True},
]


@app.get("/api/empleados", tags=["Empleados"])
async def get_empleados(current_user: dict = Depends(require_any)):
    docs = await col("empleados").find().to_list(100)
    if not docs:
        await col("empleados").insert_many([dict(e) for e in _DEFAULT_EMPLEADOS])
        return {"data": _DEFAULT_EMPLEADOS}
    return {"data": many_to_json(docs)}


@app.post("/api/empleados", tags=["Empleados"])
async def create_empleado(payload: dict = Body(...),
                    current_user: dict = Depends(require_supervisor)):
    payload["fechaCreacion"] = datetime.utcnow().isoformat()
    payload.setdefault("activo", True)
    result = await col("empleados").insert_one(payload)
    await audit("Creación", "empleado", str(result.inserted_id),
          f"Empleado: {payload.get('nombre','N/A')}", _u(current_user))
    return {"id": str(result.inserted_id), "message": "Empleado creado"}


@app.put("/api/empleados/{eid}", tags=["Empleados"])
async def update_empleado(eid: str, payload: dict = Body(...),
                    current_user: dict = Depends(require_supervisor)):
    payload.pop("_id", None)
    payload["_modificado"] = datetime.utcnow().isoformat()
    result = await col("empleados").update_one({"_id": ObjectId(eid)}, {"$set": payload})
    if result.matched_count == 0:
        raise HTTPException(404, "Empleado no encontrado")
    await audit("Edición", "empleado", eid,
          f"Campos: {list(payload.keys())}", _u(current_user))
    return {"message": "Actualizado"}

# ─────────────────────────────────────────────────────────────────────────────
# RECAUDACIÓN
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/recaudacion", tags=["Recaudación"])
async def get_recaudacion(current_user: dict = Depends(require_any)):
    """Recaudación agrupada por TipoPersona / TipoDeclaracion (campos reales Thunder)."""
    pipeline = [
        {
            "$group": {
                "_id": {
                    "$ifNull": [
                        "$TipoPersona",
                        "$TipoDeclaracion",
                        "$EstadoDeclaracion",
                        "Sin clasificar",
                    ]
                },
                "totalImpuesto": {"$sum": {
                    "$convert": {
                        "input": {"$ifNull": [
                            "$ValorImpuesto", "$Impuesto", "$MontoImpuesto", "$impuesto", 0
                        ]},
                        "to": "double",
                        "onError": 0.0,
                        "onNull": 0.0
                    }
                }},
                "totalPagado": {"$sum": {
                    "$convert": {
                        "input": {"$ifNull": [
                            "$ValorPagado", "$MontoPagado", "$pagado", 0
                        ]},
                        "to": "double",
                        "onError": 0.0,
                        "onNull": 0.0
                    }
                }},
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"totalImpuesto": -1}},
        {"$limit": 25},
    ]
    docs = await col(COL_CONTRIB).aggregate(pipeline).to_list(25)

    result = []
    for d in docs:
        impuesto = round(d["totalImpuesto"], 2)
        pagado   = round(d["totalPagado"],   2)
        saldo    = round(impuesto - pagado,   2)
        result.append({
            "sector":        d["_id"] or "Sin clasificar",
            "totalImpuesto": impuesto,
            "totalPagado":   pagado,
            "totalSaldo":    saldo,
            "count":         d["count"],
            "porcentaje":    round((pagado / impuesto * 100) if impuesto else 0, 1),
        })
    return {"data": result}

# ─────────────────────────────────────────────────────────────────────────────
# MOROSIDAD  (clasificación de deuda — colección Thunder)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/morosidad/anios", tags=["Morosidad"])
async def get_morosidad_anios(current_user: dict = Depends(require_any)):
    """Devuelve la lista de años (AnioSolicitud) disponibles en Thunder, ordenados descendente."""
    years = await col(COL_CONTRIB).distinct("AnioSolicitud")
    years = sorted([y for y in years if y and isinstance(y, int)], reverse=True)
    return {"anios": years}


@app.get("/api/morosidad/kpis", tags=["Morosidad"])
async def get_morosidad_kpis(current_user: dict = Depends(require_any)):
    """
    KPIs de morosidad: totales y montos agrupados por clasificación.
    Ejecuta agregación completa sobre Thunder (~442K docs) con allowDiskUse.
    """
    stages = _mora_pipeline_stages()
    pipeline = stages + [
        {"$match": {"_saldo": {"$gt": 0}}},
        {"$group": {
            "_id":        "$clasificacionMora",
            "count":      {"$sum": 1},
            "montoTotal": {"$sum": "$_saldo"},
        }},
    ]
    raw = await col(COL_CONTRIB).aggregate(pipeline, allowDiskUse=True).to_list(10)
    counts = {
        r["_id"]: {"count": r["count"], "monto": round(r["montoTotal"], 2)}
        for r in raw
    }
    total_mora  = sum(v["count"] for v in counts.values())
    monto_total = round(sum(v["monto"] for v in counts.values()), 2)
    return {
        "totalEnMora":  total_mora,
        "montoVencido": monto_total,
        "moraLeve":     counts.get("MORA_LEVE",    {"count": 0, "monto": 0.0}),
        "moraMedia":    counts.get("MORA_MEDIA",   {"count": 0, "monto": 0.0}),
        "moraAlta":     counts.get("MORA_ALTA",    {"count": 0, "monto": 0.0}),
        "moraCritica":  counts.get("MORA_CRITICA", {"count": 0, "monto": 0.0}),
        "coactiva":     counts.get("COACTIVA",     {"count": 0, "monto": 0.0}),
        "alDia":        counts.get("AL_DIA",       {"count": 0, "monto": 0.0}),
    }


@app.get("/api/morosidad", tags=["Morosidad"])
async def get_morosidad(
    skip:           int   = Query(0,   ge=0),
    limit:          int   = Query(50,  ge=1, le=200),
    search:         str   = Query(None),
    tipoPersona:    str   = Query(None),
    clasificacion:  str   = Query(None),
    prioridad:      str   = Query(None),
    minDeuda:       float = Query(None, ge=0),
    maxDeuda:       float = Query(None, ge=0),
    actividad:      str   = Query(None),
    estadoCobranza: str   = Query(None),
    canton:         str   = Query(None),
    anio:           int   = Query(None),
    current_user:   dict  = Depends(require_any),
):
    """
    Lista contribuyentes clasificados por nivel de mora, con paginación y filtros.

    NOTA TÉCNICA: diasMora es un valor estimado (saldo / 5) porque la colección
    Thunder no contiene campos FechaVencimiento ni FechaPago.
    Campos faltantes para clasificación real:
      - FechaVencimiento: fecha límite de pago por período fiscal
      - FechaPago: fecha del último pago efectivo
    """
    stages = _mora_pipeline_stages()

    # ── Pre-filtro con campos NATIVOS de Thunder (se aplica ANTES de los stages
    #    para reducir el número de documentos que pasan por los $addFields costosos)
    native_match: dict = {}
    if search:
        native_match["$or"] = [
            {"NombreContribuyente": {"$regex": search, "$options": "i"}},
        ]
    if tipoPersona:
        native_match["TipoPersona"] = tipoPersona
    if actividad:
        native_match["ActividadEconomicaPrincipal"] = {"$regex": actividad, "$options": "i"}
    if canton:
        native_match["Canton"] = canton.upper()
    if anio is not None:
        native_match["AnioSolicitud"] = anio

    pre_match_stages = [{"$match": native_match}] if native_match else []

    # ── Filtros sobre campos CALCULADOS (se aplican DESPUÉS de los stages) ──
    match: dict = {}
    if clasificacion:
        match["clasificacionMora"] = clasificacion
    if prioridad:
        match["prioridadGestion"] = prioridad
    if minDeuda is not None or maxDeuda is not None:
        saldo_filter: dict = {}
        if minDeuda is not None:
            saldo_filter["$gte"] = minDeuda
        if maxDeuda is not None:
            saldo_filter["$lte"] = maxDeuda
        match["_saldo"] = saldo_filter

    match_stage = {"$match": match} if match else None

    # ── Contar total (pipeline separado) ─────────────────────────────────────
    count_stages = pre_match_stages + stages
    if match_stage:
        count_stages = count_stages + [match_stage]
    count_pipeline = count_stages + [{"$count": "total"}]
    count_result   = await col(COL_CONTRIB).aggregate(count_pipeline, allowDiskUse=True).to_list(1)
    total          = count_result[0]["total"] if count_result else 0

    # ── Proyección — solo campos necesarios para reducir payload ─────────────
    project_stage = {
        "$project": {
            "_id": 1,
            "Ruc": 1,
            "NombreContribuyente": 1,
            "TipoPersona": 1,
            "ActividadEconomicaPrincipal": 1,
            "RepresentanteLegal": 1,
            "CorreoEMAS": 1,
            "TelefonoEMAS": 1,
            "EstadoDeclaracion": 1,
            "IdDimConvenio": 1,
            "deudaTotal": 1,
            "deudaVencida": 1,
            "diasMora": 1,
            "clasificacionMora": 1,
            "prioridadGestion": 1,
        }
    }

    data_pipeline = pre_match_stages + stages
    if match_stage:
        data_pipeline = data_pipeline + [match_stage]
    data_pipeline = data_pipeline + [
        {"$sort": {"deudaVencida": -1}},
        {"$skip":  skip},
        {"$limit": limit},
        project_stage,   # proyectar DESPUÉS de paginar para máximo rendimiento
    ]
    docs = await col(COL_CONTRIB).aggregate(data_pipeline, allowDiskUse=True).to_list(limit)

    result = []
    for d in docs:
        item = to_json(d)
        item["obligacionesPendientes"] = 1     # placeholder: Thunder no tiene multi-obligaciones
        item["ultimoPago"]             = "—"   # placeholder: no existe campo FechaPago
        mora = item.get("clasificacionMora", "")
        pri  = item.get("prioridadGestion",  "")
        item["estadoCobranza"] = (
            "COACTIVA"    if mora == "COACTIVA"              else
            "EN_GESTION"  if pri  in ("ALTA", "CRITICA")     else
            "AL_CORRIENTE" if mora == "AL_DIA"               else
            "PENDIENTE"
        )
        result.append(item)

    return {
        "total": total,
        "skip":  skip,
        "limit": limit,
        "data":  result,
        "_nota": "diasMora es estimado proxy (saldo/5). No existe FechaVencimiento en Thunder.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# AUDITORÍA
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/auditoria", tags=["Auditoría"])
async def get_auditoria(
    skip:  int  = Query(0,   ge=0),
    limit: int  = Query(100, ge=1, le=500),
    tipo:  str  = Query(None),
    usuario: str = Query(None),
    current_user: dict = Depends(require_supervisor),
):
    query: dict = {}
    if tipo:
        query["tipo"] = tipo
    if usuario:
        query["usuario"] = usuario

    total = await col("auditoria").count_documents(query)
    cursor = col("auditoria").find(query).sort("fecha", DESCENDING).skip(skip).limit(limit)
    docs = await cursor.to_list(limit)
    return {"total": total, "data": many_to_json(docs)}

# ── Frontend estático ─────────────────────────────────────────────────────────
from fastapi.responses import FileResponse

# ── Frontend estático (React SPA) ─────────────────────────────────────────────
_frontend_dir = Path(__file__).parent / "frontend"

if _frontend_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(_frontend_dir / "assets")), name="assets")
    
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # Si el usuario pide un archivo específico en la raíz (ej. favicon.ico)
        file_path = _frontend_dir / full_path
        if file_path.is_file() and not full_path.startswith("api/"):
            return FileResponse(str(file_path))
        
        # Caso contrario, delegar enrutamiento a React (index.html)
        return FileResponse(str(_frontend_dir / "index.html"))

# ─────────────────────────────────────────────────────────────────────────────
# ENTRADA
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  SIGECO MVP - Backend API")
    print("=" * 50)
    print(f"  MongoDB  : {MONGO_URI}")
    print(f"  Base     : {DB_NAME}")
    print(f"  Coleccion: {COL_CONTRIB}")
    print(f"  URL      : http://localhost:{PORT}")
    print(f"  Swagger  : http://localhost:{PORT}/docs")
    print("=" * 50 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
