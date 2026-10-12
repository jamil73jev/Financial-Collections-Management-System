#!/bin/bash
# ============================================================
# SIGECO — Backup automático de MongoDB
# ============================================================
# Configurar cron (Linux):
#   crontab -e
#   0 2 * * * /opt/sigeco/scripts/backup_mongo.sh >> /var/log/sigeco_backup.log 2>&1
#
# También ejecutable manualmente:
#   bash scripts/backup_mongo.sh
# ============================================================

set -euo pipefail

# ── Configuración ─────────────────────────────────────────
MONGO_URI="${MONGO_URI:-mongodb://localhost:27017}"
DB_NAME="${DB_NAME:-Base1,5}"
BACKUP_BASE="${BACKUP_DIR:-/backup/sigeco}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_BASE}/${DATE}"

# ── Funciones ─────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error() { log "ERROR: $*" >&2; exit 1; }

# ── Verificar mongodump disponible ────────────────────────
command -v mongodump >/dev/null 2>&1 || error "mongodump no encontrado. Instala mongodb-tools."

# ── Crear directorio ──────────────────────────────────────
mkdir -p "${BACKUP_BASE}"

log "Iniciando backup de ${DB_NAME}..."
log "Destino: ${BACKUP_PATH}.tar.gz"

# ── Ejecutar backup ───────────────────────────────────────
mongodump \
  --uri="${MONGO_URI}" \
  --db="${DB_NAME}" \
  --out="${BACKUP_PATH}" \
  --quiet

# ── Comprimir ─────────────────────────────────────────────
tar -czf "${BACKUP_PATH}.tar.gz" -C "${BACKUP_BASE}" "${DATE}"
rm -rf "${BACKUP_PATH}"

SIZE=$(du -sh "${BACKUP_PATH}.tar.gz" | cut -f1)
log "Backup completado: ${BACKUP_PATH}.tar.gz (${SIZE})"

# ── Limpiar backups antiguos ──────────────────────────────
DELETED=$(find "${BACKUP_BASE}" -name "*.tar.gz" -mtime "+${RETAIN_DAYS}" -print -delete | wc -l)
if [ "${DELETED}" -gt 0 ]; then
  log "Eliminados ${DELETED} backups de más de ${RETAIN_DAYS} días"
fi

# ── Listar backups disponibles ────────────────────────────
TOTAL=$(find "${BACKUP_BASE}" -name "*.tar.gz" | wc -l)
log "Total de backups almacenados: ${TOTAL}"
log "Backup finalizado correctamente."
