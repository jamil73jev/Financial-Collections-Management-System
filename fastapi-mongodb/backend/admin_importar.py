"""
SIGECO — Importación Masiva de Datos
======================================
Permite cargar datos desde Excel (.xlsx) o CSV (.csv) para:
  - contribuyentes: actualización masiva del padrón (upsert por RUC)
  - pagos: registro de pagos procesados externamente
  - vencimientos: tabla de fechas de vencimiento por RUC/año fiscal

Endpoints:
  POST /api/admin/importar/preview   → previsualiza primeras 10 filas sin grabar
  POST /api/admin/importar/confirmar → importa y retorna reporte de resultados

Seguridad: require_admin (solo ADMINISTRADOR)

Formato esperado por tipo:
  contribuyentes → columnas: Ruc, NombreContribuyente, ValorImpuesto, ValorPagado, Saldo, ...
  pagos          → columnas: Ruc, FechaPago, MontoPago, Referencia
  vencimientos   → columnas: Ruc, AnioFiscal, FechaVencimiento
"""

import io
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pymongo import UpdateOne
from motor.motor_asyncio import AsyncIOMotorClient

from auth import require_admin

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

_client         = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
_db             = _client[DB_NAME]
_col_thunder    = _db[os.getenv("COL_CONTRIB", "Base1,5")]
_col_pagos      = _db["pagos_importados"]
_col_vencim     = _db["vencimientos"]

logger = logging.getLogger("sigeco.importar")

router = APIRouter(prefix="/api/admin/importar", tags=["Importación"])

# ── Columnas requeridas por tipo ──────────────────────────────────────────────
_COLUMNAS_REQUERIDAS = {
    "contribuyentes": ["Ruc"],
    "pagos":          ["Ruc", "FechaPago", "MontoPago"],
    "vencimientos":   ["Ruc", "AnioFiscal", "FechaVencimiento"],
}

_COLUMNAS_OPCIONALES = {
    "contribuyentes": [
        "NombreContribuyente", "TipoPersona", "EstadoDeclaracion", "TipoDeclaracion",
        "ValorImpuesto", "ValorPagado", "Saldo", "Direccion",
        "CorreoEMAS", "TelefonoEMAS", "RepresentanteLegal", "ActividadEconomicaPrincipal",
    ],
    "pagos":          ["Referencia", "ObservacionPago"],
    "vencimientos":   ["TipoImpuesto", "Descripcion"],
}


# ── Parseo de archivo ─────────────────────────────────────────────────────────

def _leer_archivo(file: UploadFile) -> list[dict]:
    """Lee un .xlsx o .csv y retorna lista de dicts."""
    contenido = file.file.read()
    nombre = (file.filename or "").lower()

    if nombre.endswith(".csv"):
        import csv
        texto = contenido.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(texto))
        return [dict(row) for row in reader]

    elif nombre.endswith(".xlsx") or nombre.endswith(".xls"):
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(
                status_code=422,
                detail="openpyxl no instalado. Use CSV o instale openpyxl.",
            )
        wb = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
        ws = wb.active
        filas = list(ws.iter_rows(values_only=True))
        if not filas:
            return []
        headers = [str(h).strip() if h is not None else f"col_{i}" for i, h in enumerate(filas[0])]
        resultado = []
        for fila in filas[1:]:
            if all(v is None for v in fila):
                continue
            resultado.append({headers[i]: v for i, v in enumerate(fila)})
        return resultado
    else:
        raise HTTPException(status_code=422, detail="Formato no soportado. Use .xlsx o .csv")


def _validar_columnas(filas: list[dict], tipo: str):
    """Valida que existan las columnas requeridas."""
    if not filas:
        raise HTTPException(status_code=422, detail="El archivo está vacío")
    cols_archivo = set(filas[0].keys())
    requeridas   = set(_COLUMNAS_REQUERIDAS[tipo])
    faltantes    = requeridas - cols_archivo
    if faltantes:
        raise HTTPException(
            status_code=422,
            detail=f"Columnas requeridas faltantes: {sorted(faltantes)}. "
                   f"Columnas encontradas: {sorted(cols_archivo)}",
        )


def _limpiar_valor(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


# ── Transformadores por tipo ──────────────────────────────────────────────────

def _transformar_contribuyente(fila: dict) -> dict | None:
    ruc = _limpiar_valor(fila.get("Ruc"))
    if not ruc:
        return None

    doc: dict = {"Ruc": ruc}
    for campo in _COLUMNAS_OPCIONALES["contribuyentes"]:
        val = _limpiar_valor(fila.get(campo))
        if val is not None:
            # Campos numéricos
            if campo in ("ValorImpuesto", "ValorPagado", "Saldo"):
                try:
                    doc[campo] = float(val.replace(",", "."))
                except ValueError:
                    doc[campo] = None
            else:
                doc[campo] = val
    return doc


def _transformar_pago(fila: dict) -> dict | None:
    ruc = _limpiar_valor(fila.get("Ruc"))
    if not ruc:
        return None

    fecha_str = _limpiar_valor(fila.get("FechaPago"))
    try:
        fecha = datetime.strptime(fecha_str, "%Y-%m-%d") if fecha_str else None
    except ValueError:
        try:
            fecha = datetime.strptime(fecha_str, "%d/%m/%Y")
        except Exception:
            fecha = None

    monto_str = _limpiar_valor(fila.get("MontoPago"))
    try:
        monto = float(str(monto_str).replace(",", ".")) if monto_str else 0.0
    except ValueError:
        monto = 0.0

    return {
        "Ruc":              ruc,
        "FechaPago":        fecha,
        "MontoPago":        monto,
        "Referencia":       _limpiar_valor(fila.get("Referencia")),
        "ObservacionPago":  _limpiar_valor(fila.get("ObservacionPago")),
        "importadoEn":      datetime.utcnow(),
    }


def _transformar_vencimiento(fila: dict) -> dict | None:
    ruc = _limpiar_valor(fila.get("Ruc"))
    if not ruc:
        return None

    fecha_str = _limpiar_valor(fila.get("FechaVencimiento"))
    try:
        fecha = datetime.strptime(fecha_str, "%Y-%m-%d") if fecha_str else None
    except ValueError:
        try:
            fecha = datetime.strptime(fecha_str, "%d/%m/%Y")
        except Exception:
            fecha = None

    anio_str = _limpiar_valor(fila.get("AnioFiscal"))
    try:
        anio = int(anio_str) if anio_str else None
    except ValueError:
        anio = None

    return {
        "Ruc":             ruc,
        "AnioFiscal":      anio,
        "FechaVencimiento": fecha,
        "TipoImpuesto":    _limpiar_valor(fila.get("TipoImpuesto")),
        "Descripcion":     _limpiar_valor(fila.get("Descripcion")),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/preview")
async def preview_importacion(
    tipo:  str        = Form(..., description="contribuyentes | pagos | vencimientos"),
    file:  UploadFile = File(...),
    current_user: dict = Depends(require_admin),
):
    """
    Previsualiza las primeras 10 filas del archivo sin importar datos.
    Valida columnas y retorna errores de formato.
    """
    if tipo not in _COLUMNAS_REQUERIDAS:
        raise HTTPException(status_code=422, detail=f"Tipo '{tipo}' no válido")

    filas = _leer_archivo(file)
    _validar_columnas(filas, tipo)

    preview_filas = filas[:10]
    errores = []

    # Validar muestra
    transformadores = {
        "contribuyentes": _transformar_contribuyente,
        "pagos":          _transformar_pago,
        "vencimientos":   _transformar_vencimiento,
    }
    transformar = transformadores[tipo]

    preview_transformado = []
    for i, fila in enumerate(preview_filas):
        doc = transformar(fila)
        if doc is None:
            errores.append({"fila": i + 2, "error": "RUC vacío o inválido"})
        else:
            preview_transformado.append(doc)

    return {
        "tipo":              tipo,
        "archivo":           file.filename,
        "total_filas":       len(filas),
        "columnas":          list(filas[0].keys()) if filas else [],
        "columnas_requeridas": _COLUMNAS_REQUERIDAS[tipo],
        "columnas_opcionales": _COLUMNAS_OPCIONALES[tipo],
        "preview_10_filas":  preview_transformado,
        "errores_muestra":   errores,
    }


@router.post("/confirmar")
async def confirmar_importacion(
    tipo:          str        = Form(...),
    file:          UploadFile = File(...),
    modo_duplicados: str      = Form("actualizar", description="actualizar | omitir"),
    current_user:  dict       = Depends(require_admin),
):
    """
    Importa el archivo completo.
    Retorna reporte: insertados, actualizados, omitidos, errores.
    """
    if tipo not in _COLUMNAS_REQUERIDAS:
        raise HTTPException(status_code=422, detail=f"Tipo '{tipo}' no válido")
    if modo_duplicados not in ("actualizar", "omitir"):
        raise HTTPException(status_code=422, detail="modo_duplicados debe ser 'actualizar' u 'omitir'")

    filas = _leer_archivo(file)
    _validar_columnas(filas, tipo)

    transformadores = {
        "contribuyentes": _transformar_contribuyente,
        "pagos":          _transformar_pago,
        "vencimientos":   _transformar_vencimiento,
    }
    transformar = transformadores[tipo]

    colecciones = {
        "contribuyentes": _col_thunder,
        "pagos":          _col_pagos,
        "vencimientos":   _col_vencim,
    }
    col = colecciones[tipo]

    # Llave única por tipo
    llaves = {
        "contribuyentes": "Ruc",
        "pagos":          None,   # insert simple
        "vencimientos":   ("Ruc", "AnioFiscal"),
    }
    llave = llaves[tipo]

    insertados = 0
    actualizados = 0
    omitidos = 0
    errores_lista = []

    BATCH = 500
    operaciones: list = []

    for i, fila in enumerate(filas):
        try:
            doc = transformar(fila)
            if doc is None:
                errores_lista.append({"fila": i + 2, "error": "RUC vacío"})
                continue

            if llave is None:
                # Insertar directo (pagos)
                operaciones.append(doc)
                insertados += 1
            else:
                # Upsert por llave
                if isinstance(llave, tuple):
                    filtro = {k: doc[k] for k in llave if k in doc}
                else:
                    filtro = {llave: doc[llave]}

                if modo_duplicados == "omitir":
                    if await col.find_one(filtro, {"_id": 1}):
                        omitidos += 1
                        continue
                    operaciones.append(UpdateOne(filtro, {"$setOnInsert": doc}, upsert=True))
                    insertados += 1
                else:
                    operaciones.append(UpdateOne(filtro, {"$set": doc}, upsert=True))
                    actualizados += 1  # aproximado; el real se puede calcular del bulk_write

        except Exception as e:
            errores_lista.append({"fila": i + 2, "error": str(e)})

        # Flush en batch
        if len(operaciones) >= BATCH:
            if llave is None:
                await col.insert_many(operaciones, ordered=False)
            else:
                result = await col.bulk_write(operaciones, ordered=False)
                # Ajuste real: upserted = insertados, matched = actualizados
                insertados  = result.upserted_count
                actualizados = result.modified_count
            operaciones = []

    # Último batch
    if operaciones:
        if llave is None:
            await col.insert_many(operaciones, ordered=False)
        else:
            result = await col.bulk_write(operaciones, ordered=False)
            insertados   += result.upserted_count
            actualizados += result.modified_count

    logger.info(
        f"Importación {tipo} por {current_user['username']}: "
        f"ins={insertados} act={actualizados} om={omitidos} err={len(errores_lista)}"
    )

    return {
        "tipo":         tipo,
        "archivo":      file.filename,
        "total_filas":  len(filas),
        "insertados":   insertados,
        "actualizados": actualizados,
        "omitidos":     omitidos,
        "errores":      len(errores_lista),
        "detalle_errores": errores_lista[:50],  # máximo 50 para no saturar la respuesta
        "importado_en": datetime.utcnow().isoformat() + "Z",
        "importado_por": current_user["username"],
    }
