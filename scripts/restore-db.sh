#!/usr/bin/env bash
# ============================================================================
# Finanças Família — Script de Verificação e Restauração de Backup (ADR 0012 / E9-D2)
# ============================================================================
# Uso:
#   1. Apenas testar integridade/descriptografia sem alterar o banco:
#      ./scripts/restore-db.sh --verify-only backups/financas_20261123T163500Z.dump.enc
#
#   2. Restaurar no banco (remoto via RESTORE_DATABASE_URL ou container local):
#      ./scripts/restore-db.sh backups/financas_20261123T163500Z.dump.enc
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

VERIFY_ONLY=false
if [[ "${1:-}" == "--verify-only" ]]; then
  VERIFY_ONLY=true
  shift
fi

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Uso: $0 [--verify-only] <caminho-do-arquivo.dump|.dump.enc>" >&2
  exit 1
fi

if [[ -f "${BACKUP_FILE}.sha256" ]]; then
  echo "[restore] Conferindo checksum SHA-256..." >&2
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null)
fi

TMP_PLAIN="$(mktemp "$(dirname "$BACKUP_FILE")/.tmp_restore.XXXXXX.dump")"
trap 'rm -f "$TMP_PLAIN"' EXIT

if [[ "$BACKUP_FILE" == *.enc ]]; then
  if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
    echo "[restore] ERRO: BACKUP_PASSPHRASE é obrigatória para descriptografar ${BACKUP_FILE}." >&2
    exit 1
  fi
  echo "[restore] Descriptografando ${BACKUP_FILE}..." >&2
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
    -pass env:BACKUP_PASSPHRASE \
    -in "$BACKUP_FILE" -out "$TMP_PLAIN"
else
  cp "$BACKUP_FILE" "$TMP_PLAIN"
fi

echo "[restore] Validando catálogo interno do dump (pg_restore --list)..." >&2
if command -v pg_restore >/dev/null 2>&1; then
  TOC_COUNT="$(pg_restore --list "$TMP_PLAIN" | grep -c '^[^;]' || true)"
else
  TOC_COUNT="$(docker run --rm -i postgres:17-alpine pg_restore --list < "$TMP_PLAIN" | grep -c '^[^;]' || true)"
fi

if [[ "$TOC_COUNT" -le 0 ]]; then
  echo "[restore] ERRO: catálogo do dump inválido." >&2
  exit 1
fi

if [[ "$VERIFY_ONLY" == "true" ]]; then
  echo "[restore] OK (--verify-only): backup íntegro (${TOC_COUNT} objetos catalogados)."
  exit 0
fi

DB_CONTAINER="${DB_CONTAINER:-financas-familia-db-1}"
APP_DB_NAME="${APP_DB_NAME:-financas}"

if [[ -n "${RESTORE_DATABASE_URL:-}" ]]; then
  echo "[restore] Restaurando no banco remoto (RESTORE_DATABASE_URL)..." >&2
  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$TMP_PLAIN"
  else
    docker run --rm -i -e TARGET_DB_URL="$RESTORE_DATABASE_URL" postgres:17-alpine \
      sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET_DB_URL"' < "$TMP_PLAIN"
  fi
else
  echo "[restore] Restaurando no container local (${DB_CONTAINER} / ${APP_DB_NAME})..." >&2
  docker exec -i "$DB_CONTAINER" \
    pg_restore --clean --if-exists --no-owner --no-privileges --username=app_owner --dbname="$APP_DB_NAME" < "$TMP_PLAIN"
fi

echo "[restore] OK: restauração concluída com sucesso."
