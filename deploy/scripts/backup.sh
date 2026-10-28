#!/usr/bin/env bash
# Respaldo diario de la base y los archivos. Programar con cron (ver docs/runbooks/respaldo-y-restauracion.md):
#   15 2 * * * /opt/crm/deploy/scripts/backup.sh >> /var/log/crm-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
: "${BACKUP_DIR:=/var/backups/crm}"
: "${BACKUP_RETENTION_DAYS:=30}"
COMPOSE="docker compose --env-file .env -f docker-compose.prod.yml"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
umask 077

DB_FILE="$BACKUP_DIR/crm-db-$STAMP.dump"
$COMPOSE exec -T db pg_dump -U crm -d crm -Fc --no-owner > "$DB_FILE.tmp"
mv "$DB_FILE.tmp" "$DB_FILE"

FILES="$BACKUP_DIR/crm-files-$STAMP.tar.gz"
$COMPOSE exec -T api tar -C /data/storage -czf - . > "$FILES.tmp"
mv "$FILES.tmp" "$FILES"

# Verifica que el volcado sea legible antes de darlo por bueno.
$COMPOSE exec -T db pg_restore --list < "$DB_FILE" > /dev/null
sha256sum "$DB_FILE" "$FILES" > "$BACKUP_DIR/crm-$STAMP.sha256"

find "$BACKUP_DIR" -type f -name 'crm-*' -mtime +"$BACKUP_RETENTION_DAYS" -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a --partial "$BACKUP_DIR/" "$BACKUP_REMOTE/"
fi
echo "$(date -Is) respaldo OK: $DB_FILE ($(du -h "$DB_FILE" | cut -f1)), $FILES"
