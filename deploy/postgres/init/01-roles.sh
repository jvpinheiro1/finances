#!/bin/sh
# Executado UMA vez pelo entrypoint do Postgres, quando o volume está vazio.
# Cria os papéis da aplicação (ADR 0004):
#   app_owner: dono do banco e das tabelas (migrations e CLI admin)
#   app_rw:    usado pela API, sem ser dono, só com GRANTs mínimos
set -eu

: "${APP_DB_NAME:?defina APP_DB_NAME}"
: "${APP_OWNER_PASSWORD:?defina APP_OWNER_PASSWORD}"
: "${APP_RW_PASSWORD:?defina APP_RW_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v db="$APP_DB_NAME" -v owner_pw="$APP_OWNER_PASSWORD" -v rw_pw="$APP_RW_PASSWORD" <<'SQL'
CREATE ROLE app_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE app_rw    LOGIN PASSWORD :'rw_pw'    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE :"db" OWNER app_owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO app_owner, app_rw;
SQL
