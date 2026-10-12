@echo off
chcp 65001 >nul

:: Detectar IP de red local
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set LAN_IP=%%a
    goto :ip_found
)
set LAN_IP= No detectada
:ip_found
set LAN_IP=%LAN_IP: =%

echo ============================================================
echo   SIGECO MVP - Iniciar sistema
echo ============================================================
echo.
echo   MongoDB     : localhost:27017
echo   Base        : Base1,5 (Thunder)
echo.
echo   *** URL PARA EMPLEADOS (abrir en su navegador) ***
echo   http://%LAN_IP%:8000
echo.
echo   Swagger UI  : http://%LAN_IP%:8000/docs
echo ============================================================
echo.

:: Agregar ruta conocida de Python al PATH
set PATH=%LOCALAPPDATA%\Python\pythoncore-3.14-64;%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python311;%PATH%

:: Detectar Python
set PYTHON_CMD=

py --version >nul 2>&1
if not errorlevel 1 (
    set PYTHON_CMD=py
    goto python_ok
)

python --version >nul 2>&1
if not errorlevel 1 (
    set PYTHON_CMD=python
    goto python_ok
)

python3 --version >nul 2>&1
if not errorlevel 1 (
    set PYTHON_CMD=python3
    goto python_ok
)

if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    set PYTHON_CMD=%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe
    goto python_ok
)
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
    goto python_ok
)
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python311\python.exe
    goto python_ok
)

echo [ERROR] Python no encontrado en PATH.
pause
exit /b 1

:python_ok
echo [OK] Python detectado: %PYTHON_CMD%

:: Instalar dependencias
echo.
echo Instalando/verificando dependencias...
%PYTHON_CMD% -m pip install fastapi==0.111.0 "uvicorn[standard]==0.29.0" pymongo==4.7.2 python-multipart==0.0.9 "python-jose[cryptography]==3.3.0" "passlib[bcrypt]==1.7.4" bcrypt==4.0.1 openpyxl==3.1.2 reportlab==4.1.0 aiosmtplib==3.0.1 email-validator==2.1.1 apscheduler==3.10.4 slowapi==0.1.9 psutil==5.9.8 --quiet --no-warn-script-location

if errorlevel 1 (
    echo.
    echo [ERROR] No se pudo instalar las dependencias.
    echo         Intenta abrir esta ventana como Administrador.
    pause
    exit /b 1
)
echo [OK] Dependencias instaladas

:: Ir a la carpeta backend
cd /d "%~dp0backend"

:: Crear usuarios iniciales (solo la primera vez)
echo.
echo Inicializando usuarios del sistema...
set PYTHONUTF8=1
%PYTHON_CMD% seed_admin.py

:: Crear indices MongoDB
echo.
echo Creando indices MongoDB...
%PYTHON_CMD% setup_indexes.py

echo.
echo ============================================================
echo   SIGECO - Servidor activo
echo.
echo   Empleados abren en su navegador:
echo   http://%LAN_IP%:8000
echo.
echo   Presiona Ctrl+C para detener el servidor.
echo ============================================================
echo.

:: Liberar puerto 8000 si hay un proceso anterior colgado
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)

set PYTHONUTF8=1
%PYTHON_CMD% main.py

if errorlevel 1 (
    echo.
    echo [ERROR] El backend se detuvo. Revisa el error arriba.
    pause
)
