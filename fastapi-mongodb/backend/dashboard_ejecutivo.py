"""
SIGECO — Dashboard Ejecutivo
==============================
Endpoints para métricas avanzadas del dashboard directivo:
  - Metas mensuales de recaudación (configurables por ADMIN)
  - Ranking de gestores
  - Comparativo anual de recaudación y morosidad
  - Proyección al cierre del mes
  - Tendencia histórica de gestiones y convenios

Colección MongoDB: config_metas
"""

from datetime import datetime, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import ASCENDING, DESCENDING
from motor.motor_asyncio import AsyncIOMotorClient

import os
from pathlib import Path

from auth import require_any, require_admin

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

_client      = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db          = _client[DB_NAME]
_col_notif   = _db["notificaciones"]
_col_gest    = _db["gestiones"]
_col_conv    = _db["convenios"]
_col_thunder = _db[os.getenv("COL_CONTRIB", "Base1,5")]
_col_metas   = _db["config_metas"]

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard Ejecutivo"])

# ── Helpers ───────────────────────────────────────────────────────────────────
def _mes_actual() -> tuple[datetime, datetime]:
    hoy = datetime.utcnow()
    inicio = hoy.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Fin del mes
    if hoy.month == 12:
        fin = inicio.replace(year=hoy.year + 1, month=1)
    else:
        fin = inicio.replace(month=hoy.month + 1)
    return inicio, fin


def _mes_anterior() -> tuple[datetime, datetime]:
    hoy = datetime.utcnow()
    fin_ant = hoy.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if hoy.month == 1:
        inicio_ant = fin_ant.replace(year=hoy.year - 1, month=12)
    else:
        inicio_ant = fin_ant.replace(month=hoy.month - 1)
    return inicio_ant, fin_ant


# ── Endpoints de Metas ────────────────────────────────────────────────────────

@router.get("/metas")
async def obtener_metas(current_user: dict = Depends(require_any)):
    """Retorna la configuración de metas actual."""
    hoy = datetime.utcnow()
    doc = await _col_metas.find_one(
        {"anio": hoy.year, "mes": hoy.month},
        sort=[("_id", DESCENDING)],
    )
    if not doc:
        return {
            "anio":              hoy.year,
            "mes":               hoy.month,
            "meta_recaudacion":  0,
            "meta_notificaciones": 0,
            "meta_gestiones":    0,
            "meta_convenios":    0,
            "configurada":       False,
        }
    doc["_id"] = str(doc["_id"])
    doc["configurada"] = True
    return doc


@router.put("/metas")
async def actualizar_metas(
    body: dict,
    current_user: dict = Depends(require_admin),
):
    """Configura metas del mes actual (solo ADMIN)."""
    hoy = datetime.utcnow()
    update = {
        "anio":               hoy.year,
        "mes":                hoy.month,
        "meta_recaudacion":   float(body.get("meta_recaudacion", 0)),
        "meta_notificaciones": int(body.get("meta_notificaciones", 0)),
        "meta_gestiones":     int(body.get("meta_gestiones", 0)),
        "meta_convenios":     int(body.get("meta_convenios", 0)),
        "actualizadoPor":     current_user.get("username"),
        "fechaActualizacion": hoy,
    }
    await _col_metas.update_one(
        {"anio": hoy.year, "mes": hoy.month},
        {"$set": update},
        upsert=True,
    )
    return {"mensaje": "Metas actualizadas"}


@router.get("/metas/historico")
async def historico_metas(
    meses: int = Query(6, ge=1, le=24),
    current_user: dict = Depends(require_any),
):
    """Historial de metas de los últimos N meses."""
    cursor = _col_metas.find({}).sort([("anio", DESCENDING), ("mes", DESCENDING)]).limit(meses)
    docs = await cursor.to_list(meses)
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs


# ── Endpoint Ranking de Gestores ──────────────────────────────────────────────

@router.get("/ranking-gestores")
async def ranking_gestores(
    anio: Optional[int]  = Query(None),
    mes:  Optional[int]  = Query(None),
    current_user: dict   = Depends(require_any),
):
    """
    Ranking de gestores por actividad y efectividad en el período.
    Por defecto: mes actual.
    """
    hoy = datetime.utcnow()
    anio = anio or hoy.year
    mes  = mes  or hoy.month

    try:
        inicio = datetime(anio, mes, 1)
        if mes == 12:
            fin = datetime(anio + 1, 1, 1)
        else:
            fin = datetime(anio, mes + 1, 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Período inválido")

    rango = {"$gte": inicio, "$lt": fin}

    # Gestiones del período
    pipeline_gest = [
        {"$match": {"fechaGestion": rango}},
        {"$group": {
            "_id": "$gestor",
            "total_gestiones":    {"$sum": 1},
            "contactados":        {"$sum": {"$cond": [{"$eq": ["$resultado", "contactado"]}, 1, 0]}},
            "promesas":           {"$sum": {"$cond": [{"$eq": ["$resultado", "promesa_pago"]}, 1, 0]}},
            "pagos_gestionados":  {"$sum": {"$cond": [{"$eq": ["$resultado", "pago_realizado"]}, 1, 0]}},
        }},
        {"$sort": {"total_gestiones": DESCENDING}},
    ]

    # Notificaciones del período
    pipeline_notif = [
        {"$match": {"fechaCreacion": rango}},
        {"$group": {
            "_id": "$empleadoNombre",
            "notificaciones": {"$sum": 1},
            "cobradas":       {"$sum": {"$cond": [{"$eq": ["$estado", "cobrada"]}, 1, 0]}},
        }},
    ]

    # Convenios del período
    pipeline_conv = [
        {"$match": {"fechaConvenio": rango}},
        {"$group": {
            "_id": "$gestorAsignado",
            "convenios": {"$sum": 1},
            "monto_convenios": {"$sum": "$montoTotal"},
        }},
    ]

    gestores_gest  = {r["_id"]: r for r in await _col_gest.aggregate(pipeline_gest).to_list(100)}
    gestores_notif = {r["_id"]: r for r in await _col_notif.aggregate(pipeline_notif).to_list(100)}
    gestores_conv  = {r["_id"]: r for r in await _col_conv.aggregate(pipeline_conv).to_list(100)}

    # Unificar por nombre de gestor
    todos_gestores = set(gestores_gest) | set(gestores_notif) | set(gestores_conv)

    ranking = []
    for g in todos_gestores:
        if not g:
            continue
        gest  = gestores_gest.get(g, {})
        notif = gestores_notif.get(g, {})
        conv  = gestores_conv.get(g, {})

        total_gest = gest.get("total_gestiones", 0)
        pagos      = gest.get("pagos_gestionados", 0)
        efectividad = round((pagos / total_gest * 100) if total_gest > 0 else 0, 1)

        ranking.append({
            "gestor":          g,
            "total_gestiones": total_gest,
            "contactados":     gest.get("contactados", 0),
            "promesas":        gest.get("promesas", 0),
            "pagos_gestionados": pagos,
            "efectividad_pct": efectividad,
            "notificaciones":  notif.get("notificaciones", 0),
            "cobradas":        notif.get("cobradas", 0),
            "convenios":       conv.get("convenios", 0),
            "monto_convenios": round(conv.get("monto_convenios", 0), 2),
        })

    ranking.sort(key=lambda r: (r["total_gestiones"] + r["notificaciones"]), reverse=True)
    return {"periodo": f"{anio}-{mes:02d}", "ranking": ranking}


# ── Comparativo Anual ─────────────────────────────────────────────────────────

@router.get("/comparativo-anual")
async def comparativo_anual(
    anios: int = Query(2, ge=1, le=5, description="Número de años a comparar"),
    current_user: dict = Depends(require_any),
):
    """
    Comparativo de indicadores mes a mes para los últimos N años.
    Retorna datos para gráfico de líneas multi-año.
    """
    hoy = datetime.utcnow()
    resultado = {}

    for delta in range(anios):
        anio = hoy.year - delta
        meses_data = []

        for mes in range(1, 13):
            # No incluir meses futuros del año actual
            if anio == hoy.year and mes > hoy.month:
                break
            try:
                inicio = datetime(anio, mes, 1)
                fin = datetime(anio, mes + 1, 1) if mes < 12 else datetime(anio + 1, 1, 1)
            except ValueError:
                continue

            rango = {"$gte": inicio, "$lt": fin}

            # Notificaciones
            n_notif = await _col_notif.count_documents({"fechaCreacion": rango})
            n_cobradas = await _col_notif.count_documents({"fechaCreacion": rango, "estado": "cobrada"})

            # Gestiones
            n_gest = await _col_gest.count_documents({"fechaGestion": rango})

            # Convenios
            cursor_conv = _col_conv.aggregate([
                {"$match": {"fechaConvenio": rango}},
                {"$group": {"_id": None, "count": {"$sum": 1}, "monto": {"$sum": "$montoTotal"}}},
            ])
            conv_agg = await cursor_conv.to_list(1)
            conv_data = conv_agg[0] if conv_agg else {"count": 0, "monto": 0}

            meses_data.append({
                "mes":          mes,
                "notificaciones": n_notif,
                "cobradas":     n_cobradas,
                "gestiones":    n_gest,
                "convenios":    conv_data["count"],
                "monto_convenios": round(conv_data["monto"], 2),
                "tasa_cobro":   round((n_cobradas / n_notif * 100) if n_notif > 0 else 0, 1),
            })

        resultado[str(anio)] = meses_data

    return resultado


# ── Proyección Mensual ────────────────────────────────────────────────────────

@router.get("/proyeccion-mensual")
async def proyeccion_mensual(current_user: dict = Depends(require_any)):
    """
    Proyección de cierre del mes actual basada en tendencia de días transcurridos.
    """
    hoy = datetime.utcnow()
    inicio_mes, fin_mes = _mes_actual()

    dias_mes = (fin_mes - inicio_mes).days
    dias_transcurridos = (hoy - inicio_mes).days + 1
    if dias_transcurridos <= 0:
        dias_transcurridos = 1

    rango_actual = {"$gte": inicio_mes, "$lt": hoy}

    # Actividad del mes hasta hoy
    notif_mes     = await _col_notif.count_documents({"fechaCreacion": rango_actual})
    cobradas_mes  = await _col_notif.count_documents({"fechaCreacion": rango_actual, "estado": "cobrada"})
    gestiones_mes = await _col_gest.count_documents({"fechaGestion": rango_actual})
    convenios_mes = await _col_conv.count_documents({"fechaConvenio": rango_actual})

    cursor_monto = _col_conv.aggregate([
        {"$match": {"fechaConvenio": rango_actual}},
        {"$group": {"_id": None, "monto": {"$sum": "$montoTotal"}}},
    ])
    conv_monto_agg = await cursor_monto.to_list(1)
    conv_monto = conv_monto_agg[0]["monto"] if conv_monto_agg else 0

    # Proyección lineal simple
    factor = dias_mes / dias_transcurridos

    # Metas del mes
    meta_doc = await _col_metas.find_one({"anio": hoy.year, "mes": hoy.month}) or {}

    def _semaforo(actual, meta):
        if not meta or meta == 0:
            return "gris"
        pct = actual / meta
        if pct >= 0.85:
            return "verde"
        elif pct >= 0.60:
            return "amarillo"
        return "rojo"

    meta_notif = meta_doc.get("meta_notificaciones", 0)
    meta_gest  = meta_doc.get("meta_gestiones", 0)
    meta_conv  = meta_doc.get("meta_convenios", 0)
    meta_rec   = meta_doc.get("meta_recaudacion", 0)

    return {
        "periodo": f"{hoy.year}-{hoy.month:02d}",
        "dias_mes": dias_mes,
        "dias_transcurridos": dias_transcurridos,
        "dias_restantes": dias_mes - dias_transcurridos,
        "avance_mes_pct": round(dias_transcurridos / dias_mes * 100, 1),
        "actual": {
            "notificaciones":  notif_mes,
            "cobradas":        cobradas_mes,
            "gestiones":       gestiones_mes,
            "convenios":       convenios_mes,
            "monto_convenios": round(conv_monto, 2),
            "tasa_cobro":      round((cobradas_mes / notif_mes * 100) if notif_mes > 0 else 0, 1),
        },
        "proyectado": {
            "notificaciones": int(notif_mes * factor),
            "cobradas":       int(cobradas_mes * factor),
            "gestiones":      int(gestiones_mes * factor),
            "convenios":      int(convenios_mes * factor),
            "monto_convenios": round(conv_monto * factor, 2),
        },
        "metas": {
            "notificaciones": meta_notif,
            "gestiones":      meta_gest,
            "convenios":      meta_conv,
            "recaudacion":    meta_rec,
        },
        "semaforo": {
            "notificaciones": _semaforo(notif_mes, meta_notif),
            "gestiones":      _semaforo(gestiones_mes, meta_gest),
            "convenios":      _semaforo(convenios_mes, meta_conv),
        },
    }


# ── Tendencia histórica de gestiones (para gráfico sparkline) ─────────────────

@router.get("/tendencia-gestiones")
async def tendencia_gestiones(
    dias: int = Query(30, ge=7, le=90),
    current_user: dict = Depends(require_any),
):
    """Actividad diaria de los últimos N días (para sparkline en dashboard)."""
    hoy = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    inicio = hoy - timedelta(days=dias)

    pipeline = [
        {"$match": {"fechaGestion": {"$gte": inicio}}},
        {"$group": {
            "_id": {
                "anio": {"$year": "$fechaGestion"},
                "mes":  {"$month": "$fechaGestion"},
                "dia":  {"$dayOfMonth": "$fechaGestion"},
            },
            "total":   {"$sum": 1},
            "pagos":   {"$sum": {"$cond": [{"$eq": ["$resultado", "pago_realizado"]}, 1, 0]}},
            "promesas": {"$sum": {"$cond": [{"$eq": ["$resultado", "promesa_pago"]}, 1, 0]}},
        }},
        {"$sort": {"_id.anio": 1, "_id.mes": 1, "_id.dia": 1}},
    ]
    rows = await _col_gest.aggregate(pipeline).to_list(dias + 2)

    serie = []
    for r in rows:
        d = r["_id"]
        serie.append({
            "fecha": f"{d['anio']}-{d['mes']:02d}-{d['dia']:02d}",
            "total": r["total"],
            "pagos": r["pagos"],
            "promesas": r["promesas"],
        })

    return {"dias": dias, "serie": serie}
