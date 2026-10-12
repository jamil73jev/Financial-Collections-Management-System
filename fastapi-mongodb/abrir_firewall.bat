@echo off
:: Este script requiere permisos de Administrador
:: Clic derecho → "Ejecutar como administrador"

echo Abriendo puerto 8000 en el Firewall de Windows...

netsh advfirewall firewall add rule ^
    name="SIGECO - Sistema Municipal" ^
    dir=in ^
    action=allow ^
    protocol=TCP ^
    localport=8000

if errorlevel 1 (
    echo.
    echo [ERROR] Necesitas ejecutar este archivo como Administrador.
    echo Clic derecho sobre el archivo y selecciona "Ejecutar como administrador"
) else (
    echo.
    echo [OK] Puerto 8000 habilitado en el Firewall.
    echo Los empleados ya pueden acceder desde su navegador.
)

echo.
pause
