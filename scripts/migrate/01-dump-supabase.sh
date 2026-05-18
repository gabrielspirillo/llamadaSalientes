#!/usr/bin/env bash
# Dump del schema + data desde Supabase Postgres.
#
# Uso:
#   export SUPABASE_DIRECT_URL='postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
#   bash scripts/migrate/01-dump-supabase.sh
#
# IMPORTANTE:
# - Usar la SUPABASE_DIRECT_URL (puerto 5432, no la pooled 6543). pg_dump
#   no funciona con PgBouncer en transaction mode.
# - Excluimos schemas internos de Supabase (auth, storage, realtime, etc.)
#   porque no los necesitamos en el self-hosted (auth es Clerk, storage es
#   MinIO).
# - El dump es plain SQL para que se pueda inspeccionar antes del restore.

set -euo pipefail

OUT_DIR="${OUT_DIR:-./dumps}"
mkdir -p "$OUT_DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT_FILE="$OUT_DIR/supabase-dump-$TS.sql"

if [[ -z "${SUPABASE_DIRECT_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DIRECT_URL no seteada"
  exit 1
fi

# Verificar que pg_dump está instalado.
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump no encontrado. Instalá postgresql-client."
  exit 1
fi

echo "[dump] origen: ${SUPABASE_DIRECT_URL%%@*}@<host-redacted>"
echo "[dump] destino: $OUT_FILE"
echo "[dump] schemas: public (excluyendo extensiones gestionadas)"

# --no-owner / --no-privileges: el nuevo Postgres tiene otro user (cliniq),
# no `postgres@supabase`. Los GRANTs y OWNERs se ajustan al restore.
# --schema=public: solo nuestros datos, ignoramos auth/storage/realtime de Supabase.
# --quote-all-identifiers: previene colisiones con palabras reservadas.
pg_dump "$SUPABASE_DIRECT_URL" \
  --no-owner \
  --no-privileges \
  --no-acl \
  --schema=public \
  --quote-all-identifiers \
  --format=plain \
  --file="$OUT_FILE"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
LINES=$(wc -l <"$OUT_FILE")
echo "[dump] OK — $SIZE, $LINES líneas → $OUT_FILE"
echo ""
echo "Siguiente paso:"
echo "  scp $OUT_FILE root@72.60.212.232:/tmp/"
echo "  ssh root@72.60.212.232 bash < scripts/migrate/02-restore-postgres.sh"
