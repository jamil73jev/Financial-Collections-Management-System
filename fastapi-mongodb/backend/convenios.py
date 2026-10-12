"""
SIGECO — Módulo de Convenios de Pago
======================================
Gestión de acuerdos de pago fraccionado con contribuyentes:
  - Crear convenio con cuotas calculadas automáticamente
  - Registrar pagos de cuotas
  - Control de estado: ACTIVO / EN_MORA / COMPLETADO / ANULADO
  - KPIs de cumplimiento

Colección MongoDB: convenios
"""

from datetime import datetime, date, timedelta
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
_col    = _db["convenios"]

router = APIRouter(prefix="/api/convenios", tags=["Convenios"])

# ── Constantes ────────────────────────────────────────────────────────────────
ESTADOS_CONVENIO = {"ACTIVO", "EN_MORA", "COMPLETADO", "ANULADO"}

# Periodicidades de pago
PERIODICIDADES = {
    "mensual":   30,
    "bimensual": 60,
    "trimestral": 90,
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
        elif isinstance(v, list):
            out[k] = [_to_dict(i) if isinstance(i, dict) else i for i in v]
        else:
            out[k] = v
    return out


def _u(user: dict) -> str:
    return user.get("username", "sistema")


def _generar_cuotas(
    monto_total: float,
    n_cuotas: int,
    fecha_inicio: datetime,
    periodicidad_dias: int,
) -> list:
    """Genera la lista de cuotas con fecha de vencimiento y monto."""
    monto_cuota = round(monto_total / n_cuotas, 2)
    # Ajustar última cuota para que la suma sea exacta
    diferencia = round(monto_total - monto_cuota * n_cuotas, 2)

    cuotas = []
    for i in range(n_cuotas):
        vencimiento = fecha_inicio + timedelta(days=periodicidad_dias * (i + 1))
        monto = monto_cuota + (diferencia if i == n_cuotas - 1 else 0)
        cuotas.append({
            "numero":       i + 1,
            "monto":        monto,
            "vencimiento":  vencimiento,
            "estado":       "PENDIENTE",   # PENDIENTE | PAGADA | VENCIDA
            "fechaPago":    None,
            "montoPagado":  None,
        })
    return cuotas


def _actualizar_estado_convenio(convenio: dict) -> str:
    """Recalcula el estado del convenio según el estado de sus cuotas."""
    cuotas = convenio.get("cuotas", [])
    if not cuotas:
        return "ACTIVO"

    hoy = datetime.utcnow()
    todas_pagadas = all(c["estado"] == "PAGADA" for c in cuotas)
    if todas_pagadas:
        return "COMPLETADO"

    alguna_vencida = any(
        c["estado"] == "PENDIENTE" and c["vencimiento"] < hoy
        for c in cuotas
    )
    return "EN_MORA" if alguna_vencida else "ACTIVO"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def listar_convenios(
    ruc: Optional[str]           = Query(None),
    estado: Optional[str]        = Query(None),
    gestor: Optional[str]        = Query(None),
    fecha_desde: Optional[str]   = Query(None),
    fecha_hasta: Optional[str]   = Query(None),
    page: int                    = Query(1, ge=1),
    page_size: int               = Query(20, ge=1, le=100),
    current_user: dict           = Depends(require_any),
):
    """Lista convenios con filtros."""
    filtro: dict = {}

    if ruc:
        filtro["ruc"] = {"$regex": ruc, "$options": "i"}
    if estado:
        if estado not in ESTADOS_CONVENIO:
            raise HTTPException(status_code=422, detail=f"Estado inválido. Válidos: {sorted(ESTADOS_CONVENIO)}")
        filtro["estado"] = estado
    if gestor:
        filtro["gestorAsignado"] = gestor
    if fecha_desde or fecha_hasta:
        rango: dict = {}
        if fecha_desde:
            rango["$gte"] = datetime.fromisoformat(fecha_desde)
        if fecha_hasta:
            rango["$lte"] = datetime.fromisoformat(fecha_hasta + "T23:59:59")
        filtro["fechaConvenio"] = rango

    total = await _col.count_documents(filtro)
    skip  = (page - 1) * page_size
    cursor = _col.find(filtro).sort("fechaConvenio", DESCENDING).skip(skip).limit(page_size)
    docs = await cursor.to_list(page_size)

    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "pages":     (total + page_size - 1) // page_size,
        "data":      [_to_dict(d) for d in docs],
    }


@router.get("/kpis")
async def kpis_convenios(
    current_user: dict = Depends(require_any),
):
    """KPIs de convenios: totales, recaudado, pendiente, mora."""
    pipeline = [
        {"$group": {
            "_id": "$estado",
            "cantidad": {"$sum": 1},
            "montoTotal": {"$sum": "$montoTotal"},
            "montoPagado": {"$sum": "$montoPagado"},
        }},
    ]
    por_estado = {r["_id"]: r for r in await _col.aggregate(pipeline).to_list(10)}

    total_convenios = await _col.count_documents({})
    activos = por_estado.get("ACTIVO", {})
    en_mora = por_estado.get("EN_MORA", {})
    completados = por_estado.get("COMPLETADO", {})

    # Cuotas vencidas globales
    hoy = datetime.utcnow()
    cuotas_vencidas_pipeline = [
        {"$unwind": "$cuotas"},
        {"$match": {
            "cuotas.estado": "PENDIENTE",
            "cuotas.vencimiento": {"$lt": hoy},
        }},
        {"$group": {
            "_id": None,
            "cantidad": {"$sum": 1},
            "monto": {"$sum": "$cuotas.monto"},
        }},
    ]
    cuotas_venc = await _col.aggregate(cuotas_vencidas_pipeline).to_list(1)
    cuotas_vencidas = cuotas_venc[0] if cuotas_venc else {"cantidad": 0, "monto": 0}

    return {
        "totalConvenios":    total_convenios,
        "activos":           activos.get("cantidad", 0),
        "enMora":            en_mora.get("cantidad", 0),
        "completados":       completados.get("cantidad", 0),
        "montoTotalActivos": activos.get("montoTotal", 0),
        "montoPagado":       (
            completados.get("montoPagado", 0)
            + activos.get("montoPagado", 0)
            + en_mora.get("montoPagado", 0)
        ),
        "cuotasVencidasCount": cuotas_vencidas.get("cantidad", 0),
        "cuotasVencidasMonto": round(cuotas_vencidas.get("monto", 0), 2),
    }


@router.get("/{cid}")
async def obtener_convenio(
    cid: str,
    current_user: dict = Depends(require_any),
):
    """Obtiene un convenio con detalle de cuotas."""
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

    doc = await _col.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Convenio no encontrado")
    return _to_dict(doc)


@router.post("", status_code=201)
async def crear_convenio(
    body: dict,
    current_user: dict = Depends(require_gestor),
):
    """
    Crea un convenio de pago fraccionado.

    Campos requeridos:
      - ruc             : RUC o cédula del contribuyente
      - nombreContrib   : Nombre del contribuyente
      - montoTotal      : Monto total de la deuda acordada
      - nCuotas         : Número de cuotas (1-24)
      - periodicidad    : 'mensual' | 'bimensual' | 'trimestral'

    Campos opcionales:
      - contribuyente_id : ID en Thunder
      - notificacion_id  : ID de notificación relacionada
      - observaciones    : texto libre
      - fechaInicio      : ISO date (default: hoy)
    """
    required = ["ruc", "nombreContrib", "montoTotal", "nCuotas", "periodicidad"]
    for f in required:
        if body.get(f) is None:
            raise HTTPException(status_code=422, detail=f"Campo requerido: {f}")

    try:
        monto_total = float(body["montoTotal"])
        if monto_total <= 0:
            raise ValueError
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="montoTotal debe ser un número positivo")

    try:
        n_cuotas = int(body["nCuotas"])
        if not (1 <= n_cuotas <= 24):
            raise ValueError
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="nCuotas debe ser entero entre 1 y 24")

    periodicidad = body["periodicidad"]
    if periodicidad not in PERIODICIDADES:
        raise HTTPException(
            status_code=422,
            detail=f"Periodicidad inválida. Válidas: {list(PERIODICIDADES.keys())}"
        )

    # Fecha de inicio
    if body.get("fechaInicio"):
        try:
            fecha_inicio = datetime.fromisoformat(body["fechaInicio"])
        except ValueError:
            raise HTTPException(status_code=422, detail="fechaInicio formato inválido")
    else:
        fecha_inicio = datetime.utcnow()

    cuotas = _generar_cuotas(
        monto_total=monto_total,
        n_cuotas=n_cuotas,
        fecha_inicio=fecha_inicio,
        periodicidad_dias=PERIODICIDADES[periodicidad],
    )

    doc = {
        "ruc":            body["ruc"].strip(),
        "nombreContrib":  body["nombreContrib"].strip(),
        "montoTotal":     monto_total,
        "montoPagado":    0.0,
        "saldoPendiente": monto_total,
        "nCuotas":        n_cuotas,
        "periodicidad":   periodicidad,
        "estado":         "ACTIVO",
        "cuotas":         cuotas,
        "gestorAsignado": _u(current_user),
        "observaciones":  body.get("observaciones", "").strip(),
        "fechaConvenio":  fecha_inicio,
        "fechaCreacion":  datetime.utcnow(),
        "fechaVencimiento": cuotas[-1]["vencimiento"],  # última cuota
    }

    if body.get("contribuyente_id"):
        doc["contribuyente_id"] = body["contribuyente_id"]
    if body.get("notificacion_id"):
        doc["notificacion_id"] = body["notificacion_id"]

    result = await _col.insert_one(doc)
    return {
        "id":      str(result.inserted_id),
        "mensaje": f"Convenio creado con {n_cuotas} cuota(s)",
        "cuotas":  [_to_dict(c) for c in cuotas],
    }


@router.post("/{cid}/pagar")
async def registrar_pago(
    cid: str,
    body: dict,
    current_user: dict = Depends(require_gestor),
):
    """
    Registra el pago de una cuota.

    Campos requeridos:
      - numeroCuota  : número de la cuota (1-based)
      - montoPagado  : monto efectivamente pagado

    Campos opcionales:
      - observaciones : texto libre
      - fechaPago     : ISO datetime (default: ahora)
    """
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

    convenio = await _col.find_one({"_id": oid})
    if not convenio:
        raise HTTPException(status_code=404, detail="Convenio no encontrado")
    if convenio["estado"] == "ANULADO":
        raise HTTPException(status_code=400, detail="No se puede pagar un convenio anulado")
    if convenio["estado"] == "COMPLETADO":
        raise HTTPException(status_code=400, detail="El convenio ya está completado")

    n_cuota = body.get("numeroCuota")
    if n_cuota is None:
        raise HTTPException(status_code=422, detail="Campo requerido: numeroCuota")
    try:
        n_cuota = int(n_cuota)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="numeroCuota debe ser entero")

    try:
        monto_pagado = float(body["montoPagado"])
        if monto_pagado <= 0:
            raise ValueError
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="montoPagado debe ser número positivo")

    cuotas: list = convenio["cuotas"]
    idx = next((i for i, c in enumerate(cuotas) if c["numero"] == n_cuota), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Cuota {n_cuota} no encontrada")
    if cuotas[idx]["estado"] == "PAGADA":
        raise HTTPException(status_code=400, detail=f"La cuota {n_cuota} ya fue pagada")

    # Fecha de pago
    if body.get("fechaPago"):
        try:
            fecha_pago = datetime.fromisoformat(body["fechaPago"])
        except ValueError:
            raise HTTPException(status_code=422, detail="fechaPago formato inválido")
    else:
        fecha_pago = datetime.utcnow()

    # Actualizar cuota
    cuotas[idx]["estado"]      = "PAGADA"
    cuotas[idx]["fechaPago"]   = fecha_pago
    cuotas[idx]["montoPagado"] = monto_pagado

    # Recalcular totales
    total_pagado = sum(c.get("montoPagado") or 0 for c in cuotas)
    saldo        = round(convenio["montoTotal"] - total_pagado, 2)

    # Recalcular estado
    nuevo_estado = _actualizar_estado_convenio({**convenio, "cuotas": cuotas})

    await _col.update_one(
        {"_id": oid},
        {"$set": {
            "cuotas":         cuotas,
            "montoPagado":    round(total_pagado, 2),
            "saldoPendiente": saldo,
            "estado":         nuevo_estado,
            "fechaUltimoPago": fecha_pago,
        }}
    )

    return {
        "mensaje":       f"Pago de cuota {n_cuota} registrado",
        "montoPagado":   round(total_pagado, 2),
        "saldoPendiente": saldo,
        "estado":        nuevo_estado,
    }


@router.put("/{cid}/anular")
async def anular_convenio(
    cid: str,
    body: dict,
    current_user: dict = Depends(require_supervisor),
):
    """Anula un convenio activo (solo supervisor/admin)."""
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

    convenio = await _col.find_one({"_id": oid})
    if not convenio:
        raise HTTPException(status_code=404, detail="Convenio no encontrado")
    if convenio["estado"] == "COMPLETADO":
        raise HTTPException(status_code=400, detail="No se puede anular un convenio completado")
    if convenio["estado"] == "ANULADO":
        raise HTTPException(status_code=400, detail="Ya está anulado")

    motivo = body.get("motivo", "").strip()
    if not motivo:
        raise HTTPException(status_code=422, detail="Se requiere 'motivo' para anular")

    await _col.update_one(
        {"_id": oid},
        {"$set": {
            "estado":           "ANULADO",
            "motivoAnulacion":  motivo,
            "anuladoPor":       _u(current_user),
            "fechaAnulacion":   datetime.utcnow(),
        }}
    )
    return {"mensaje": "Convenio anulado"}


@router.put("/{cid}")
async def actualizar_convenio(
    cid: str,
    body: dict,
    current_user: dict = Depends(require_supervisor),
):
    """Actualiza observaciones o gestor asignado de un convenio."""
    try:
        oid = ObjectId(cid)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")

    if not await _col.find_one({"_id": oid}):
        raise HTTPException(status_code=404, detail="Convenio no encontrado")

    update: dict = {}
    if "observaciones" in body:
        update["observaciones"] = body["observaciones"].strip()
    if "gestorAsignado" in body:
        update["gestorAsignado"] = body["gestorAsignado"].strip()

    if not update:
        raise HTTPException(status_code=422, detail="No hay campos a actualizar")

    update["fechaModificacion"] = datetime.utcnow()
    await _col.update_one({"_id": oid}, {"$set": update})
    return {"mensaje": "Convenio actualizado"}
