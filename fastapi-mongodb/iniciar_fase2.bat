@echo off
chcp 65001 >nul
echo ============================================================
echo   SIGECO MVP -- Iniciar Fase 2 (v2)
echo ============================================================
echo.

:: Detectar Python (intentar 'py', luego 'python')
set PY_CMD=py
py --version >nul 2>&1
if errorlevel 1 (
    set PY_CMD=python
    python --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python no encontrado. Por favor instálalo desde python.org
        pause
        exit /b 1
    )
)

echo [OK] Usando comando: %PY_CMD%

:: Inicializar Base de Datos (Usuarios)
echo.
echo Verificando usuarios iniciales (seed)...
%PY_CMD% v2/backend/seed_admin.py

:: Iniciar Backend
echo.
echo Iniciando Servidor SIGECO v2...
echo.
echo   URL API: http://localhost:8000
echo   Frontend: abre v2/frontend/index.html en tu navegador
echo.
echo Presiona Ctrl+C para detener el servidor.
echo ------------------------------------------------------------
cd /d "%~dp0v2/backend"
%PY_CMD% main.py
pause
