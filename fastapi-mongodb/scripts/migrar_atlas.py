import os
"""
SIGECO MVP — Script de Migración: MongoDB Local → MongoDB Atlas
===============================================================
Este script copia toda la base de datos Thunder desde tu MongoDB
local al clúster de MongoDB Atlas.

Uso:
    1. Instalar dependencias: pip install pymongo motor
    2. Editar ATLAS_URI con tu connection string de Atlas
    3. Ejecutar: python scripts/migrar_atlas.py

Tiempo estimado: 10-30 minutos (depende de la velocidad de internet)
Datos a migrar: ~347 MB, 441K documentos
"""

import sys
from datetime import datetime

try:
    from pymongo import MongoClient, ASCENDING
    from pymongo.errors import BulkWriteError
except ImportError:
    print("❌ Instala pymongo: pip install pymongo")
    sys.exit(1)

# ── CONFIGURACIÓN ─────────────────────────────────────────────────────────────

ORIGEN_URI  = "mongodb://localhost:27017"
ORIGEN_DB   = "Thunder"

# ⚠️  REEMPLAZA con tu connection string de MongoDB Atlas
# Lo encuentras en: Atlas → Connect → Drivers → Python
ATLAS_URI = os.environ["ATLAS_URI"]  # definir en el entorno, nunca en el código
ATLAS_DB    = "Thunder"

# Colecciones a migrar (en orden de importancia)
COLECCIONES = [
    "Base1,5",       # Principal: 441K contribuyentes (la más grande)
    "empleados",
    "usuarios",
    "notificaciones",
    "auditoria",
    "dashboard_stats",
    "kpis_historico",
]

BATCH_SIZE = 200     # Lotes pequeños para conexiones Railway (evita timeout)

# ─────────────────────────────────────────────────────────────────────────────

def migrar_coleccion(col_origen, col_destino, nombre: str):
    total = col_origen.count_documents({})
    if total == 0:
        print(f"  ⏭️  {nombre}: vacía, omitiendo")
        return 0

    print(f"\n  📦 {nombre}: {total:,} documentos")

    migrados  = 0
    errores   = 0
    inicio    = datetime.now()

    cursor = col_origen.find({})

    batch = []
    for doc in cursor:
        batch.append(doc)
        if len(batch) >= BATCH_SIZE:
            try:
                col_destino.insert_many(batch, ordered=False)
                migrados += len(batch)
            except BulkWriteError as e:
                # Ignorar duplicados (_id ya existe)
                migrados += e.details.get("nInserted", 0)
                errores  += len(e.details.get("writeErrors", []))
            batch = []

            pct = (migrados / total) * 100
            elapsed = (datetime.now() - inicio).seconds
            print(f"    {migrados:,}/{total:,} ({pct:.1f}%) — {elapsed}s", end="\r")

    # Último lote
    if batch:
        try:
            col_destino.insert_many(batch, ordered=False)
            migrados += len(batch)
        except BulkWriteError as e:
            migrados += e.details.get("nInserted", 0)
            errores  += len(e.details.get("writeErrors", []))

    elapsed = (datetime.now() - inicio).seconds
    print(f"    ✅ {migrados:,} migrados, {errores} duplicados ignorados — {elapsed}s")
    return migrados


def recrear_indices(db_destino):
    """Recrea los índices más importantes en Atlas."""
    print("\n[4/4] Creando índices en Atlas...")
    col = db_destino["Base1,5"]
    indices = [
        ([("Ruc", ASCENDING)],            {"name": "idx_ruc"}),
        ([("NombreContribuyente", ASCENDING)], {"name": "idx_nombre"}),
        ([("EstadoDeclaracion", ASCENDING)],   {"name": "idx_estado"}),
        ([("TipoPersona", ASCENDING)],         {"name": "idx_tipo"}),
        ([("AnioSolicitud", ASCENDING)],        {"name": "idx_anio"}),
        ([("ActividadEconomicaPrincipal", ASCENDING)], {"name": "idx_actividad"}),
        ([("IdDimConvenio", ASCENDING)],        {"name": "idx_convenio"}),
        ([("PagadoSN", ASCENDING)],            {"name": "idx_pagado"}),
    ]
    for keys, opts in indices:
        try:
            col.create_index(keys, **opts)
            print(f"  ✅ Índice {opts['name']} creado")
        except Exception as e:
            print(f"  ⚠️  {opts['name']}: {e}")


def main():
    print("\n" + "=" * 55)
    print("  SIGECO MVP — Migración a MongoDB Atlas")
    print("=" * 55)

    if "USUARIO:PASSWORD" in ATLAS_URI:
        print("\n❌ ERROR: Edita el script y reemplaza ATLAS_URI")
        print("   con tu connection string real de MongoDB Atlas")
        sys.exit(1)

    # Conectar a origen (local)
    print("\n[1/4] Conectando a MongoDB local...")
    try:
        origen = MongoClient(ORIGEN_URI, serverSelectionTimeoutMS=5000)
        origen.admin.command("ping")
        db_origen = origen[ORIGEN_DB]
        print(f"  ✅ Local conectado: {ORIGEN_URI}")
    except Exception as e:
        print(f"  ❌ No se pudo conectar al MongoDB local: {e}")
        sys.exit(1)

    # Conectar a Atlas
    print("\n[2/4] Conectando a MongoDB Atlas...")
    try:
        destino = MongoClient(ATLAS_URI, serverSelectionTimeoutMS=30000,
                              socketTimeoutMS=120000, connectTimeoutMS=30000)
        destino.admin.command("ping")
        db_destino = destino[ATLAS_DB]
        print(f"  ✅ Atlas conectado")
    except Exception as e:
        print(f"  ❌ No se pudo conectar a Atlas: {e}")
        print(f"     Verifica: usuario, contraseña, IP permitida (0.0.0.0/0)")
        sys.exit(1)

    # Migrar colecciones
    print("\n[3/4] Migrando colecciones...")
    total_migrados = 0
    inicio_total = datetime.now()

    for nombre_col in COLECCIONES:
        try:
            col_origen  = db_origen[nombre_col]
            col_destino = db_destino[nombre_col]
            migrados = migrar_coleccion(col_origen, col_destino, nombre_col)
            total_migrados += migrados
        except Exception as e:
            print(f"  ❌ Error en {nombre_col}: {e}")

    # Crear índices
    recrear_indices(db_destino)

    # Resumen
    elapsed_total = (datetime.now() - inicio_total).seconds
    print("\n" + "=" * 55)
    print(f"  ✅ Migración completada en {elapsed_total // 60}m {elapsed_total % 60}s")
    print(f"  📊 Total migrado: {total_migrados:,} documentos")
    print("=" * 55)
    print("\n  Próximo paso: actualiza MONGO_URI en tu .env")
    print(f"  con: {ATLAS_URI[:50]}...\n")


if __name__ == "__main__":
    main()
