"""
SIGECO — Script de inicialización de usuarios
===============================================
Ejecutar UNA SOLA VEZ después de instalar dependencias:

    cd backend
    python seed_admin.py

Crea los usuarios iniciales del sistema con sus roles.
Si el usuario ya existe, lo omite (no duplica).
"""

import os
import asyncio
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME   = os.getenv("DB_NAME",   "Thunder")

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

USUARIOS_INICIALES = [
    {
        "username": "admin",
        "password": "Admin2024!",
        "nombre":   "Administrador del Sistema",
        "email":    "admin@municipio.gob.ec",
        "cargo":    "Administrador",
        "role":     "ADMINISTRADOR",
    },
    {
        "username": "supervisor",
        "password": "Super2024!",
        "nombre":   "Supervisor de Cobranza",
        "email":    "supervisor@municipio.gob.ec",
        "cargo":    "Supervisor",
        "role":     "SUPERVISOR",
    },
    {
        "username": "gestor1",
        "password": "Gestor2024!",
        "nombre":   "Carlos Mendoza",
        "email":    "cmendoza@municipio.gob.ec",
        "cargo":    "Gestor de Cobranza",
        "role":     "GESTOR",
    },
    {
        "username": "auditor",
        "password": "Audit2024!",
        "nombre":   "Auditor Interno",
        "email":    "auditor@municipio.gob.ec",
        "cargo":    "Auditor",
        "role":     "AUDITOR",
    },
]


async def main():
    print("\n" + "=" * 50)
    print("  SIGECO — Seed de Usuarios Iniciales")
    print("=" * 50)

    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    try:
        await client.admin.command("ping")
        print(f"  ✓ Conectado a MongoDB: {MONGO_URI}")
    except Exception as e:
        print(f"  ✗ Error de conexión: {e}")
        return

    db  = client[DB_NAME]
    col = db["usuarios"]

    creados  = 0
    omitidos = 0

    for u in USUARIOS_INICIALES:
        if await col.find_one({"username": u["username"]}):
            print(f"  — Omitido (ya existe): {u['username']} [{u['role']}]")
            omitidos += 1
            continue

        await col.insert_one({
            "username":     u["username"],
            "nombre":       u["nombre"],
            "email":        u["email"],
            "cargo":        u["cargo"],
            "role":         u["role"],
            "activo":       True,
            "passwordHash": pwd_ctx.hash(u["password"]),
            "fechaCreacion": datetime.utcnow().isoformat(),
            "creadoPor":    "seed_admin.py",
        })
        print(f"  ✓ Creado: {u['username']} [{u['role']}]  pass: {u['password']}")
        creados += 1

    print()
    print(f"  Resultado: {creados} creados, {omitidos} omitidos")
    print()
    print("  ⚠  IMPORTANTE: Cambia las contraseñas en producción.")
    print("     Ve a http://localhost:8000/docs → POST /api/auth/usuarios/{uid}/password")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
