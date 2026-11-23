#!/usr/bin/env bash
# ============================================================================
# Finanças Família — Script de Backup Consistente do PostgreSQL (ADR 0012 / E9-D2)
# ============================================================================
# Recursos:
# - Suporta tanto PostgreSQL remoto (Supabase Free via BACKUP_DATABASE_URL)
#   quanto container Docker local (DB_CONTAINER=financas-familia-db-1).
# - Formato custom comprimido do PostgreSQL (pg_dump -Fc) + validação com pg_restore --list.
# - Criptografia simétrica AES-256 opcional (openssl enc -aes-256-cbc -pbkdf2)
#   quando BACKUP_PASSPHRASE estiver definida.
# - Manifesto de integridade SHA-256 (.sha256) e permissões restritas (chmod 600).
# - Rotação automática mantendo os últimos KEEP_DAYS dias (padrão: 30).
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/deploy/.env}"

if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key val; do
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    key="$(echo "$key" | xargs)"
    if [[ -z "${!key:-}" ]]; then
      export "$key=$val"
    fi
  done < "$ENV_FILE"
fi

BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
DB_CONTAINER="${DB_CONTAINER:-financas-familia-db-1}"
APP_DB_NAME="${APP_DB_NAME:-financas}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TMP_DUMP="$(mktemp "${BACKUP_DIR}/.tmp_financas_${TIMESTAMP}.XXXXXX.dump")"
trap 'rm -f "$TMP_DUMP"' EXIT

run_pg_dump() {
  if [[ -n "${BACKUP_DATABASE_URL:-}" ]]; then
    echo "[backup] Extraindo dump do banco remoto (BACKUP_DATABASE_URL)..." >&2
    if command -v pg_dump >/dev/null 2>&1; then
      pg_dump --format=custom --no-owner --no-privileges --enable-row-security "$BACKUP_DATABASE_URL" > "$TMP_DUMP"
    else
      docker run --rm -i -e TARGET_DB_URL="$BACKUP_DATABASE_URL" postgres:17-alpine \
        sh -c 'pg_dump --format=custom --no-owner --no-privileges --enable-row-security "$TARGET_DB_URL"' > "$TMP_DUMP"
    fi
  else
    echo "[backup] Extraindo dump do container local (${DB_CONTAINER} / banco ${APP_DB_NAME})..." >&2
    docker exec -i "$DB_CONTAINER" \
      pg_dump --format=custom --no-owner --no-privileges --enable-row-security --username=app_owner --dbname="$APP_DB_NAME" > "$TMP_DUMP"
  fi
}

verify_dump_toc() {
  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list "$TMP_DUMP" >/dev/null
  else
    docker run --rm -i postgres:17-alpine pg_restore --list < "$TMP_DUMP" >/dev/null
  fi
}

run_pg_dump

if [[ ! -s "$TMP_DUMP" ]]; then
  echo "[backup] ERRO: arquivo de dump vazio." >&2
  exit 1
fi

verify_dump_toc

if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  FINAL_FILE="${BACKUP_DIR}/financas_${TIMESTAMP}.dump.enc"
  echo "[backup] Criptografando dump com AES-256-CBC (PBKDF2)..." >&2
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt \
    -pass env:BACKUP_PASSPHRASE \
    -in "$TMP_DUMP" -out "$FINAL_FILE"
  rm -f "$TMP_DUMP"
else
  FINAL_FILE="${BACKUP_DIR}/financas_${TIMESTAMP}.dump"
  mv "$TMP_DUMP" "$FINAL_FILE"
fi

chmod 600 "$FINAL_FILE"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$FINAL_FILE")" > "$(basename "$FINAL_FILE").sha256")
chmod 600 "${FINAL_FILE}.sha256"

# Rotação de backups antigos (KEEP_DAYS)
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'financas_*.dump*' \) -mtime +"$KEEP_DAYS" -delete

echo "[backup] OK: $(basename "$FINAL_FILE") gerado e verificado em ${BACKUP_DIR} (retenção: ${KEEP_DAYS} dias)."
