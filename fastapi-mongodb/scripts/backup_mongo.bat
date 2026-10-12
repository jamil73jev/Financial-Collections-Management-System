@echo off
:: ============================================================
:: SIGECO — Backup manual de MongoDB (Windows)
:: ============================================================
:: Requiere mongodump en PATH (viene con MongoDB Tools)
:: Descarga: https://www.mongodb.com/try/download/database-tools
:: ============================================================

chcp 65001 >nul
setlocal

:: Configuración
set MONGO_URI=mongodb://localhost:27017
set DB_NAME=Base1,5
set BACKUP_DIR=%~dp0..\backup

:: Fecha para nombre del archivo
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set DATE=%%c%%b%%a
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set HORA=%%a%%b
set STAMP=%DATE%_%HORA%
set BACKUP_PATH=%BACKUP_DIR%\%STAMP%

echo ============================================================
echo   SIGECO — Backup MongoDB
echo ============================================================
echo   Base     : %DB_NAME%
echo   Destino  : %BACKUP_PATH%
echo ============================================================
echo.

:: Verificar mongodump
mongodump --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] mongodump no encontrado.
    echo         Descarga MongoDB Database Tools desde:
    echo         https://www.mongodb.com/try/download/database-tools
    pause
    exit /b 1
)

:: Crear directorio
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

:: Ejecutar backup
echo Ejecutando backup...
mongodump --uri="%MONGO_URI%" --db="%DB_NAME%" --out="%BACKUP_PATH%"

if errorlevel 1 (
    echo [ERROR] El backup fallo. Revisa que MongoDB este activo.
    pause
    exit /b 1
)

echo.
echo [OK] Backup completado en: %BACKUP_PATH%
echo.
pause
