import os
"""
Diagnóstico: verifica a qué clúster se conecta y qué contiene.
Uso: python scripts/diagnostico_atlas.py
"""
from pymongo import MongoClient

ATLAS_URI = os.environ["ATLAS_URI"]  # definir en el entorno, nunca en el código

print("\n" + "=" * 60)
print("  DIAGNÓSTICO DE CONEXIÓN A ATLAS")
print("=" * 60)
print(f"\n  Conectando a:\n  {ATLAS_URI}\n")

try:
    client = MongoClient(ATLAS_URI, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")
    print("  ✅ Conexión exitosa\n")
except Exception as e:
    print(f"  ❌ Error de conexión: {e}")
    exit(1)

# Listar bases de datos
print("  Bases de datos en este clúster:")
try:
    for db in client.list_databases():
        nombre = db["name"]
        size_mb = round(db.get("sizeOnDisk", 0) / 1024 / 1024, 2)
        print(f"    - {nombre}: {size_mb} MB")
except Exception as e:
    print(f"    Error listando bases: {e}")

# Intentar insertar un documento de prueba
print("\n  Probando escritura...")
try:
    col = client["test_diagnostico"]["prueba"]
    col.insert_one({"test": True, "msg": "diagnóstico SIGECO"})
    print("  ✅ Escritura exitosa — el clúster SÍ acepta datos")
    col.delete_many({"test": True})
    print("  ✅ Limpieza completada")
except Exception as e:
    print(f"  ❌ Error de escritura: {e}")

print("\n" + "=" * 60)
