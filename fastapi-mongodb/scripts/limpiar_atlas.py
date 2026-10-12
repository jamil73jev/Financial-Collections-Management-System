import os
"""
SIGECO — Script de limpieza de Atlas
=====================================
Muestra todas las bases de datos en Atlas y las elimina
para dejar espacio libre antes de la migración.

Uso:
    python scripts/limpiar_atlas.py
"""
from pymongo import MongoClient

ATLAS_URI = os.environ["ATLAS_URI"]  # definir en el entorno, nunca en el código

EXCLUIR = {"admin", "local", "config"}  # Bases del sistema, no tocar

print("\n" + "=" * 55)
print("  SIGECO — Limpieza de MongoDB Atlas")
print("=" * 55)

client = MongoClient(ATLAS_URI, serverSelectionTimeoutMS=10000)

try:
    client.admin.command("ping")
    print("  ✅ Conectado a Atlas\n")
except Exception as e:
    print(f"  ❌ Error: {e}")
    exit(1)

# Listar bases de datos con tamaño
print("  Bases de datos encontradas:")
dbs = client.list_databases()
para_borrar = []
for db in dbs:
    nombre = db["name"]
    size_mb = round(db.get("sizeOnDisk", 0) / 1024 / 1024, 1)
    if nombre in EXCLUIR:
        print(f"    [SISTEMA] {nombre} ({size_mb} MB) — omitida")
    else:
        print(f"    [BORRAR]  {nombre} ({size_mb} MB)")
        para_borrar.append(nombre)

if not para_borrar:
    print("\n  No hay bases de datos para borrar. Atlas ya está vacío.")
    exit(0)

print(f"\n  Se eliminarán {len(para_borrar)} base(s): {', '.join(para_borrar)}")
confirm = input("  ¿Confirmas? (escribe 'si' para continuar): ").strip().lower()

if confirm != "si":
    print("  Cancelado.")
    exit(0)

for nombre in para_borrar:
    try:
        client.drop_database(nombre)
        print(f"  ✅ Eliminada: {nombre}")
    except Exception as e:
        print(f"  ❌ Error al eliminar {nombre}: {e}")

print("\n  Atlas limpio. Ahora ejecuta:")
print("  python scripts\\migrar_atlas.py")
print("=" * 55 + "\n")
