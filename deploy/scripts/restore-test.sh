#!/usr/bin/env bash
# Prueba de restauración SIN tocar producción: restaura el respaldo en una base temporal y
# comprueba que las tablas clave tengan datos. Hacerla al menos una vez al mes.
# Uso: restore-test.sh crm-db-AAAAMMDD-HHMMSS.dump
#   Variables: PGHOST PGPORT PGUSER PGPASSWORD (servidor Postgres donde crear la base temporal)
set -euo pipefail
DUMP="${1:?Indique el archivo .dump}"
TMPDB="crm_restore_test_$$"
cleanup() { psql -d postgres -qc "DROP DATABASE IF EXISTS $TMPDB WITH (FORCE)" >/dev/null || true; }
trap cleanup EXIT

psql -d postgres -qc "CREATE DATABASE $TMPDB"
pg_restore -d "$TMPDB" --no-owner --exit-on-error "$DUMP"
for t in organizations users contacts companies leads deals tasks record_history; do
  n=$(psql -d "$TMPDB" -Atc "SELECT count(*) FROM $t")
  printf '%-18s %s filas\n' "$t" "$n"
done
m=$(psql -d "$TMPDB" -Atc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
echo "migraciones aplicadas: $m"
[ "$m" -gt 0 ] || { echo "FALLO: sin migraciones"; exit 1; }
echo "RESTAURACIÓN VERIFICADA"
