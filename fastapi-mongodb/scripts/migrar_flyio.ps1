# ============================================================
# SIGECO — Migración de datos a MongoDB en Fly.io
# Ejecutar desde PowerShell en la raíz del proyecto
# ============================================================
#
# PRE-REQUISITOS:
#   1. fly proxy corriendo en otra ventana:
#      fly proxy 27017:27017 -a sigeco-mongo
#   2. MongoDB Tools instalado:
#      C:\Program Files\MongoDB\Tools\100\bin\mongorestore.exe
#
# USO:
#   .\scripts\migrar_flyio.ps1 -Password "TU_PASSWORD_APP"
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Password
)

$MONGORESTORE = "C:\Program Files\MongoDB\Tools\100\bin\mongorestore.exe"
$DUMP_DIR     = ".\dump"
$MONGO_URI    = "mongodb://sigeco_app:${Password}@localhost:27017/Thunder?authSource=admin"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SIGECO — Restaurando datos en Fly.io  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANTE: Asegúrate de tener corriendo en OTRA ventana:" -ForegroundColor Yellow
Write-Host "  fly proxy 27017:27017 -a sigeco-mongo" -ForegroundColor Yellow
Write-Host ""

# Verificar que mongorestore existe
if (-not (Test-Path $MONGORESTORE)) {
    Write-Host "ERROR: mongorestore no encontrado en:" -ForegroundColor Red
    Write-Host "  $MONGORESTORE" -ForegroundColor Red
    Write-Host "Instala MongoDB Database Tools desde: https://www.mongodb.com/try/download/database-tools" -ForegroundColor Red
    exit 1
}

# Verificar que el dump existe
if (-not (Test-Path $DUMP_DIR)) {
    Write-Host "ERROR: Carpeta dump\ no encontrada." -ForegroundColor Red
    Write-Host "Ejecuta este script desde la raíz del proyecto SIGECO_MVP" -ForegroundColor Red
    exit 1
}

# Verificar conexión al proxy
Write-Host "Verificando conexión a MongoDB via fly proxy..." -ForegroundColor White
$test = & $MONGORESTORE --uri $MONGO_URI --dryRun --quiet 2>&1
if ($LASTEXITCODE -ne 0 -and $test -notlike "*no collection specified*") {
    Write-Host "ERROR: No se pudo conectar a MongoDB." -ForegroundColor Red
    Write-Host "¿Está corriendo 'fly proxy 27017:27017 -a sigeco-mongo'?" -ForegroundColor Red
    exit 1
}

Write-Host "Conexión OK. Iniciando restauración..." -ForegroundColor Green
Write-Host ""

# Restaurar todos los datos
& $MONGORESTORE `
    --uri $MONGO_URI `
    --gzip `
    --drop `
    --numInsertionWorkersPerCollection 4 `
    $DUMP_DIR

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Restauración completada exitosamente  " -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Próximos pasos:" -ForegroundColor Cyan
    Write-Host "  1. Ejecutar seed_admin:" -ForegroundColor White
    Write-Host "     fly ssh console -a sigeco-backend" -ForegroundColor Yellow
    Write-Host "  2. Crear índices (en el backend):" -ForegroundColor White
    Write-Host "     python seed_admin.py" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "ERROR en la restauración. Revisa los mensajes arriba." -ForegroundColor Red
}
