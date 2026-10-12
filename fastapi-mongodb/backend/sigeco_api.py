# ============================================================
# SIGECO — Microservicio API para Google Apps Script
# FastAPI + PyMongo — Endpoints de consulta de contribuyentes
# ============================================================
# No requiere autenticación compleja: usa un API_KEY simple
# que se guarda en ScriptProperties de Google Apps Script.
# ============================================================

import os
from fastapi import FastAPI, Query, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from typing import Optional
import math
import re

# ── Configuración ──────────────────────────────────────────────
MONGO_URI  = os.getenv("MONGO_URI", "")
DB_NAME    = os.getenv("DB_NAME", "Thunder")
COLLECTION = os.getenv("COL_CONTRIB", "Base1,5")
API_KEY    = os.getenv("SIGECO_API_KEY", "sigeco-secret-2026")
PORT       = int(os.getenv("PORT", "8001"))

# ── App ────────────────────────────────────────────────────────
app = FastAPI(title="SIGECO API — Contribuyentes", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── MongoDB ────────────────────────────────────────────────────
_client = None

def get_col():
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return _client[DB_NAME][COLLECTION]


# ── Auth simple ────────────────────────────────────────────────
def verificar_key(x_api_key: str = Header(...)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="API Key inválida")


# ── Health Check ───────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "SIGECO API"}


# ── Buscar contribuyentes ──────────────────────────────────────
@app.get("/api/contribuyentes")
def buscar_contribuyentes(
    q: Optional[str] = Query(None, description="Texto a buscar (RUC o Nombre)"),
    estado: Optional[str] = Query(None),
    excluir_estados: Optional[str] = Query(None, description="Estados a excluir"),
    incluir_estados: Optional[str] = Query(None, description="Estados a incluir"),
    tipo: Optional[str] = Query(None, description="J o N"),
    ciudad: Optional[str] = Query(None, description="09=Gye, 17=Uio, etc."),
    anio: Optional[int] = Query(None, description="Año de solicitud"),
    pagina: int = Query(1, ge=1),
    limite: int = Query(50, ge=1, le=200),
    x_api_key: str = Header(...),
):
    verificar_key(x_api_key)
    col = get_col()

    filtro = {}
    if q:
        pattern = re.compile(re.escape(q), re.IGNORECASE)
        filtro["$or"] = [
            {"RUC": pattern},
            {"NombreContribuyente": pattern},
        ]
    
    # Lógica de estados (Preferencia: estado > incluir > excluir)
    if estado:
        # Usamos regex para coincidir con el prefijo (ej. SAJ coincide con SAJ - SOLICITUD...)
        filtro["EstadoDeclaracion"] = {"$regex": f"^{re.escape(estado)}", "$options": "i"}
    elif incluir_estados:
        estados_list = [e.strip() for e in incluir_estados.split(",")]
        regex_pattern = "^(" + "|".join([re.escape(e) for e in estados_list]) + ")"
        filtro["EstadoDeclaracion"] = {"$regex": regex_pattern, "$options": "i"}
    elif excluir_estados:
        estados_list = [e.strip() for e in excluir_estados.split(",")]
        regex_pattern = "^(" + "|".join([re.escape(e) for e in estados_list]) + ")"
        filtro["EstadoDeclaracion"] = {"$not": re.compile(regex_pattern, re.IGNORECASE)}

    if tipo:
        # Mapeo de J/N a JURIDICA/NATURAL
        map_tipo = {"J": "JURIDICA", "N": "NATURAL"}
        filtro["TipoPersona"] = map_tipo.get(tipo.upper(), tipo)

    if ciudad:
        # Mapeo según requerimiento de columna canton
        map_cantores = {
            "09": "GUAYAQUIL",
            "17": "QUITO",
            "01": "CUENCA",
            "13": "MANTA",
            "07": "MACHALA",
            "18": "AMBATO",
        }
        val = map_cantores.get(ciudad, ciudad.upper())
        filtro["Canton"] = {"$regex": f"^{val}", "$options": "i"}

    if anio:
        filtro["AnioSolicitud"] = anio

    skip = (pagina - 1) * limite
    total = col.count_documents(filtro)
    
    # Agregación para limpiar comas y convertir la deuda a número en los resultados
    # Manejamos strings vacíos como fallback hacia ValorPagar
    pipeline = [
        {"$match": filtro},
        {"$addFields": {
            "DeudaRaw": {"$cond": [
                {"$and": [{"$ne": ["$TotalDeuda", ""]}, {"$ne": [{"$type": "$TotalDeuda"}, "missing"]}, {"$ne": ["$TotalDeuda", None]}]},
                "$TotalDeuda",
                {"$cond": [
                    {"$and": [{"$ne": ["$ValorPagar", ""]}, {"$ne": [{"$type": "$ValorPagar"}, "missing"]}, {"$ne": ["$ValorPagar", None]}]},
                    "$ValorPagar",
                    0
                ]}
            ]}
        }},
        {"$addFields": {
            "TotalDeudaStr": {"$toString": "$DeudaRaw"}
        }},
        {"$addFields": {
            "TotalDeudaClean": {"$replaceAll": {"input": "$TotalDeudaStr", "find": ",", "replacement": "."}}
        }},
        {"$addFields": {
            "TotalDeuda": {"$convert": {
                "input": {"$trim": {"input": "$TotalDeudaClean"}}, 
                "to": "double", 
                "onError": 0.0, 
                "onNull": 0.0
            }}
        }},
        {"$skip": skip},
        {"$limit": limite},
        {"$project": {"_id": 0}}
    ]
    docs = list(col.aggregate(pipeline))

    return {
        "ok": True,
        "data": docs,
        "total": total,
        "pagina": pagina,
        "paginas": math.ceil(total / limite),
    }


# ── Detalle de un contribuyente por RUC ───────────────────────
@app.get("/api/contribuyentes/{ruc}")
def get_contribuyente(ruc: str, x_api_key: str = Header(...)):
    verificar_key(x_api_key)
    col = get_col()
    
    pipeline = [
        {"$match": {"$or": [{"RUC": ruc}, {"Ruc": ruc}]}},
        {"$addFields": {
            "DeudaRaw": {"$cond": [
                {"$and": [{"$ne": ["$TotalDeuda", ""]}, {"$ne": [{"$type": "$TotalDeuda"}, "missing"]}, {"$ne": ["$TotalDeuda", None]}]},
                "$TotalDeuda",
                {"$cond": [
                    {"$and": [{"$ne": ["$ValorPagar", ""]}, {"$ne": [{"$type": "$ValorPagar"}, "missing"]}, {"$ne": ["$ValorPagar", None]}]},
                    "$ValorPagar",
                    0
                ]}
            ]}
        }},
        {"$addFields": {
            "TotalDeudaStr": {"$toString": "$DeudaRaw"}
        }},
        {"$addFields": {
            "TotalDeudaClean": {"$replaceAll": {"input": "$TotalDeudaStr", "find": ",", "replacement": "."}}
        }},
        {"$addFields": {
            "TotalDeuda": {"$convert": {
                "input": {"$trim": {"input": "$TotalDeudaClean"}}, 
                "to": "double", 
                "onError": 0.0, 
                "onNull": 0.0
            }}
        }},
        {"$project": {"_id": 0}}
    ]
    docs = list(col.aggregate(pipeline))
    if not docs:
        raise HTTPException(status_code=404, detail="Contribuyente no encontrado")
    return {"ok": True, "data": docs[0]}


# ── Top deudores ───────────────────────────────────────────────
@app.get("/api/top-deudores")
def top_deudores(limite: int = Query(10, ge=1, le=100), x_api_key: str = Header(...)):
    verificar_key(x_api_key)
    col = get_col()
    
    pipeline = [
        {"$addFields": {
            "DeudaRaw": {"$cond": [
                {"$and": [{"$ne": ["$TotalDeuda", ""]}, {"$ne": [{"$type": "$TotalDeuda"}, "missing"]}, {"$ne": ["$TotalDeuda", None]}]},
                "$TotalDeuda",
                {"$cond": [
                    {"$and": [{"$ne": ["$ValorPagar", ""]}, {"$ne": [{"$type": "$ValorPagar"}, "missing"]}, {"$ne": ["$ValorPagar", None]}]},
                    "$ValorPagar",
                    0
                ]}
            ]}
        }},
        {"$addFields": {
            "TotalDeudaStr": {"$toString": "$DeudaRaw"}
        }},
        {"$addFields": {
            "TotalDeudaClean": {"$replaceAll": {"input": "$TotalDeudaStr", "find": ",", "replacement": "."}}
        }},
        {"$addFields": {
            "TotalDeudaNum": {"$convert": {
                "input": {"$trim": {"input": "$TotalDeudaClean"}}, 
                "to": "double", 
                "onError": 0.0, 
                "onNull": 0.0
            }}
        }},
        {"$sort": {"TotalDeudaNum": -1}},
        {"$limit": limite},
        {"$project": {"_id": 0, "RUC": 1, "NombreContribuyente": 1, "TotalDeuda": "$TotalDeudaNum"}}
    ]
    docs = list(col.aggregate(pipeline))
    return {"ok": True, "data": docs}


# ── KPIs del dashboard ─────────────────────────────────────────
@app.get("/api/kpis")
def kpis(x_api_key: str = Header(...)):
    verificar_key(x_api_key)
    col = get_col()

    total = col.count_documents({})

    pipeline = [
        {"$addFields": {
            "DeudaRaw": {"$cond": [
                {"$and": [{"$ne": ["$TotalDeuda", ""]}, {"$ne": [{"$type": "$TotalDeuda"}, "missing"]}, {"$ne": ["$TotalDeuda", None]}]},
                "$TotalDeuda",
                {"$cond": [
                    {"$and": [{"$ne": ["$ValorPagar", ""]}, {"$ne": [{"$type": "$ValorPagar"}, "missing"]}, {"$ne": ["$ValorPagar", None]}]},
                    "$ValorPagar",
                    0
                ]}
            ]}
        }},
        {"$addFields": {
            "TotalDeudaStr": {"$toString": "$DeudaRaw"}
        }},
        {"$addFields": {
            "TotalDeudaClean": {"$replaceAll": {"input": "$TotalDeudaStr", "find": ",", "replacement": "."}}
        }},
        {"$addFields": {
            "TotalDeudaNum": {"$convert": {
                "input": {"$trim": {"input": "$TotalDeudaClean"}}, 
                "to": "double", 
                "onError": 0.0, 
                "onNull": 0.0
            }}
        }},
        {"$group": {
            "_id": "$EstadoDeclaracion",
            "count": {"$sum": 1},
            "deuda": {"$sum": "$TotalDeudaNum"}
        }}
    ]
    
    estados = list(col.aggregate(pipeline))
    deuda_total = sum(e.get("deuda", 0) for e in estados)
    por_estado = {str(e["_id"] or "Pendiente"): e["count"] for e in estados}

    return {
        "ok": True,
        "data": {
            "totalContribuyentes": total,
            "deudaTotal": deuda_total,
            "porEstado": por_estado,
        }
    }


# ── Entry point ────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("sigeco_api:app", host="0.0.0.0", port=PORT, reload=False)
