"""
SIGECO — Creación de Índices MongoDB
======================================
Ejecutar DESPUÉS de seed_admin.py y UNA SOLA VEZ en producción:

    cd backend
    python setup_indexes.py

Los índices son críticos para el rendimiento con 442K+ documentos en Thunder.
Sin ellos, las consultas de morosidad pueden tardar 10-30 segundos.
Con ellos, bajan a milisegundos.
"""

import os
import asyncio
from pymongo import ASCENDING, DESCENDING, TEXT
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME   = os.getenv("DB_NAME",   "Thunder")


async def create_indexes():
    print("\n" + "=" * 55)
    print("  SIGECO — Creación de Índices MongoDB")
    print("=" * 55)

    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    try:
        await client.admin.command("ping")
        print(f"  ✓ Conectado a MongoDB: {MONGO_URI}")
    except Exception as e:
        print(f"  ✗ Error de conexión: {e}")
        return

    db = client[DB_NAME]

    # ── Colección Thunder (442K+ documentos) ─────────────────────────────────
    print("\n  [Thunder] Creando índices...")
    thunder = db["Base1,5"]

    indexes_thunder = [
        # Búsqueda por RUC — más usado en consultas individuales
        ([("Ruc", ASCENDING)],                        {"name": "idx_ruc",        "background": True}),
        # Búsqueda de texto en nombre y RUC
        ([("NombreContribuyente", ASCENDING)],        {"name": "idx_nombre",     "background": True}),
        # Morosidad: ordenar por saldo descendente
        ([("Saldo", DESCENDING)],                     {"name": "idx_saldo_desc", "background": True}),
        # Filtros de estado
        ([("EstadoDeclaracion", ASCENDING)],          {"name": "idx_estado",     "background": True}),
        # Filtros de tipo persona (Natural / Jurídica)
        ([("TipoPersona", ASCENDING)],                {"name": "idx_tipo",       "background": True}),
        # Filtro por año fiscal + saldo (morosidad con filtro de año)
        ([("AnioSolicitud", ASCENDING), ("Saldo", DESCENDING)],
                                                      {"name": "idx_anio_saldo", "background": True}),
        # Actividad económica (filtro en módulo morosidad)
        ([("ActividadEconomicaPrincipal", ASCENDING)],{"name": "idx_actividad",  "background": True}),
        # Convenios (campo IdDimConvenio — detección de coactiva)
        ([("IdDimConvenio", ASCENDING)],              {"name": "idx_convenio",   "background": True}),
    ]

    for index_keys, opts in indexes_thunder:
        await _safe_create(thunder, index_keys, opts)

    # ── Colección notificaciones ──────────────────────────────────────────────
    print("\n  [notificaciones] Creando índices...")
    notif = db["notificaciones"]

    indexes_notif = [
        ([("ruc", ASCENDING)],                               {"name": "idx_notif_ruc",    "background": True}),
        ([("estado", ASCENDING)],                            {"name": "idx_notif_estado", "background": True}),
        ([("empleadoId", ASCENDING)],                        {"name": "idx_notif_emp",    "background": True}),
        ([("fechaCreacion", DESCENDING)],                    {"name": "idx_notif_fecha",  "background": True}),
        ([("estado", ASCENDING), ("fechaCreacion", DESCENDING)],
                                                             {"name": "idx_notif_est_f",  "background": True}),
    ]

    for index_keys, opts in indexes_notif:
        await _safe_create(notif, index_keys, opts)

    # ── Colección auditoria ───────────────────────────────────────────────────
    print("\n  [auditoria] Creando índices...")
    audit = db["auditoria"]

    indexes_audit = [
        ([("fecha", DESCENDING)],                     {"name": "idx_aud_fecha",  "background": True}),
        ([("tipo", ASCENDING)],                       {"name": "idx_aud_tipo",   "background": True}),
        ([("usuario", ASCENDING)],                    {"name": "idx_aud_usr",    "background": True}),
        ([("entidad", ASCENDING), ("entidadId", ASCENDING)],
                                                      {"name": "idx_aud_ent",    "background": True}),
    ]

    for index_keys, opts in indexes_audit:
        await _safe_create(audit, index_keys, opts)

    # ── Colección usuarios ────────────────────────────────────────────────────
    print("\n  [usuarios] Creando índices...")
    users = db["usuarios"]

    indexes_users = [
        ([("username", ASCENDING)], {"name": "idx_usr_login",  "background": True, "unique": True}),
        ([("role", ASCENDING)],     {"name": "idx_usr_role",   "background": True}),
        ([("activo", ASCENDING)],   {"name": "idx_usr_activo", "background": True}),
    ]

    for index_keys, opts in indexes_users:
        await _safe_create(users, index_keys, opts)

    # ── Colección empleados ───────────────────────────────────────────────────
    print("\n  [empleados] Creando índices...")
    emps = db["empleados"]
    await _safe_create(emps, [("activo", ASCENDING)], {"name": "idx_emp_activo", "background": True})

    print("\n  ✓ Todos los índices creados correctamente.")
    print("  Tip: Usa db.Thunder.getIndexes() en mongosh para verificar.")
    print("=" * 55 + "\n")


async def _safe_create(collection, index_keys, opts):
    """Crea el índice; si ya existe con el mismo nombre lo omite."""
    name = opts.get("name", "")
    try:
        info = await collection.index_information()
        existing = list(info.keys())
        if name in existing:
            print(f"    — Omitido (ya existe): {name}")
            return
        await collection.create_index(index_keys, **opts)
        fields = " + ".join(f"{k}({d})" for k, d in index_keys)
        print(f"    ✓ {name}: [{fields}]")
    except Exception as e:
        print(f"    ✗ Error en {name}: {e}")


if __name__ == "__main__":
    asyncio.run(create_indexes())
