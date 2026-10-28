#!/usr/bin/env bash
# Restaura un respaldo EN LA BASE DE PRODUCCIÓN (reemplaza los datos actuales).
# Uso: restore.sh crm-db-AAAAMMDD-HHMMSS.dump [crm-files-AAAAMMDD-HHMMSS.tar.gz]
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP="${1:?Indique el archivo .dump}"
FILES="${2:-}"
COMPOSE="docker compose --env-file .env -f docker-compose.prod.yml"
read -r -p "Esto REEMPLAZA la base actual con $DUMP. Escriba RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

$COMPOSE stop api worker web
$COMPOSE exec -T db psql -U crm -d postgres -c "DROP DATABASE IF EXISTS crm WITH (FORCE)" -c "CREATE DATABASE crm OWNER crm"
$COMPOSE exec -T db pg_restore -U crm -d crm --no-owner --exit-on-error < "$DUMP"
if [ -n "$FILES" ]; then
  $COMPOSE run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/storage/* && tar -C /data/storage -xzf -' < "$FILES"
fi
# Reaplica rol y permisos (idempotente) y arranca todo.
$COMPOSE up -d --force-recreate migrate
$COMPOSE up -d
echo "Restauración terminada. Verifique: curl -s http://127.0.0.1:3001/api/v1/health/ready"
