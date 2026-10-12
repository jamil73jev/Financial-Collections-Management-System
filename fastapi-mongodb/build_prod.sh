#!/bin/bash
# ============================================================
# SIGECO MVP — Script de Build para Producción
# ============================================================
# Uso: bash build_prod.sh
# Construye el frontend React y lo copia dentro del backend
# para que FastAPI lo sirva como archivos estáticos.
# ============================================================

set -e  # Detener si hay error

echo ""
echo "=============================================="
echo "  SIGECO MVP — Build de Producción"
echo "=============================================="

# 1. Construir el frontend React
echo ""
echo "[1/3] Construyendo frontend React..."
cd frontend-v2
npm install --silent
npm run build
echo "      ✅ Frontend construido en frontend-v2/dist/"

# 2. Limpiar el directorio destino
echo ""
echo "[2/3] Copiando frontend al backend..."
cd ..
rm -rf backend/frontend
mkdir -p backend/frontend
cp -r frontend-v2/dist/. backend/frontend/
echo "      ✅ Frontend copiado a backend/frontend/"

# 3. Verificar que el index.html existe
if [ -f "backend/frontend/index.html" ]; then
    echo ""
    echo "[3/3] Verificando build..."
    echo "      ✅ backend/frontend/index.html encontrado"
    echo ""
    echo "=============================================="
    echo "  ✅ Build completado exitosamente"
    echo "  Ahora puedes iniciar el backend con:"
    echo "  cd backend && python main.py"
    echo "=============================================="
else
    echo "      ❌ ERROR: backend/frontend/index.html no encontrado"
    exit 1
fi
