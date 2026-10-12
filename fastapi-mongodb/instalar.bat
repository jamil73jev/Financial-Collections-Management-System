@echo off
chcp 65001 >nul
echo ============================================================
echo   SIGECO MVP — Instalacion de dependencias
echo ============================================================
echo.

:: Verificar Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no encontrado. Instala Python 3.10+ desde python.org
    pause
    exit /b 1
)

echo [OK] Python encontrado
echo.

:: Instalar dependencias del backend
echo Instalando dependencias del backend...
cd /d "%~dp0backend"
pip install -r requirements.txt

if errorlevel 1 (
    echo.
    echo [ERROR] Fallo la instalacion de dependencias.
    echo Intenta con: pip install --upgrade pip  y luego vuelve a ejecutar este archivo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Instalacion completada correctamente!
echo   Ahora ejecuta: iniciar.bat
echo ============================================================
pause
