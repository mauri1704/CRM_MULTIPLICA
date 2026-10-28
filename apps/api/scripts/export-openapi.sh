#!/usr/bin/env bash
# Exporta la especificación OpenAPI desde una API en marcha a docs/openapi.json.
# Uso: apps/api/scripts/export-openapi.sh [URL_BASE]   (por defecto http://localhost:3001)
set -euo pipefail
BASE="${1:-http://localhost:3001}"
OUT="$(cd "$(dirname "$0")/../../.." && pwd)/docs/openapi.json"
curl -fsS "$BASE/api/docs-json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s),null,2)+"\n"))' > "$OUT"
echo "Escrito $OUT"
