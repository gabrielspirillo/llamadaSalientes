#!/usr/bin/env bash
# Restore del dump SQL en el nuevo Postgres self-hosted.
#
# CORRER EN EL SERVIDOR (vía SSH). El dump debe estar en /tmp/.
#
# Uso:
#   ssh root@72.60.212.232
#   export DUMP_FILE=/tmp/supabase-dump-XXXX.sql
#   export TARGET_URL='postgres://cliniq:<password>@cliniq-postgres:5432/cliniq'
#   bash 02-restore-postgres.sh

set -euo pipefail

DUMP_FILE="${DUMP_FILE:?DUMP_FILE no seteada}"
TARGET_URL="${TARGET_URL:?TARGET_URL no seteada (postgres://user:pass@host:port/db del Postgres en Dokploy)}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: $DUMP_FILE no existe"
  exit 1
fi

echo "[restore] dump: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
echo "[restore] destino: ${TARGET_URL%%@*}@<host-redacted>"

# Usamos psql vía docker run con la imagen postgres:16 — así no necesitamos
# tener psql instalado en el host. Mount del dump como volumen.
docker run --rm \
  --network=dokploy-network \
  -v "$(dirname "$DUMP_FILE")":/dumps:ro \
  postgres:16 \
  psql "$TARGET_URL" \
    -v ON_ERROR_STOP=1 \
    --single-transaction \
    -f "/dumps/$(basename "$DUMP_FILE")"

echo "[restore] OK — verificá con:"
echo "  psql \"$TARGET_URL\" -c '\\dt'"
echo "  psql \"$TARGET_URL\" -c 'SELECT count(*) FROM tenants;'"
