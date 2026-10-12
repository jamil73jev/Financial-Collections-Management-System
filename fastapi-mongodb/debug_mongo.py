import os
from pymongo import MongoClient
import json

ATLAS_URI = os.environ["ATLAS_URI"]  # definir en el entorno, nunca en el código

def debug_data():
    try:
        client = MongoClient(ATLAS_URI)
        db = client['Thunder']
        col = db['Base1,5']
        
        # Obtener estados únicos
        estados = col.distinct("EstadoDeclaracion")
        print("\n--- ESTADOS ÚNICOS EN BD ---")
        for e in estados:
            print(f"- {e}")
        print("----------------------------\n")
        
        docs = list(col.find().limit(5))
        print("----------------------------\n")
        
        # Verificar tipos de datos
        print("Tipos detectados:")
        for key, val in doc.items():
            print(f" - {key}: {type(val)} = {repr(val)}")
            
        client.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_data()
