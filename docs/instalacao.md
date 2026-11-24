# Guia de Instalação e Execução Local (Etapa 1)

## 1. Pré-requisitos

- Docker Engine + plugin `docker compose`
- (Opcional para desenvolvimento fora de containers) Go 1.27+ e Node.js 24+

## 2. Configurar variáveis de ambiente

A partir da raiz do repositório (`/home/gamer/projetos/financas-familia`):

```bash
cp deploy/.env.example deploy/.env
```

Edite `deploy/.env` e defina senhas aleatórias (apenas letras e números, ex.: `openssl rand -hex 24`) para:
- `POSTGRES_PASSWORD`
- `APP_OWNER_PASSWORD`
- `APP_RW_PASSWORD`

> O arquivo `deploy/.env` está no `.gitignore` e nunca deve ser versionado.

## 3. Subir os serviços com Docker Compose

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Isso sobe:
- `db` (PostgreSQL 17, porta local `127.0.0.1:5433`, inicializando os papéis `app_owner` e `app_rw`);
- `migrate` (aplica as migrations como `app_owner` e encerra);
- `api` (servidor Go conectado como `app_rw`, porta `127.0.0.1:8080`);
- `web` (frontend PWA em Nginx com proxy `/api/`, porta `127.0.0.1:5173`).

Verifique a saúde da API:

```bash
curl -s http://127.0.0.1:8080/readyz
```

## 4. Criar a residência e os 4 usuários (Bootstrap via CLI)

Com os containers rodando, execute o CLI `admin` dentro do container `api` (passando a URL do `app_owner`):

```bash
set -a && . deploy/.env && set +a

# 1. Criar a residência e o ambiente coletivo (limite padrão: 4 membros)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec \
  -e MIGRATE_DATABASE_URL="postgres://app_owner:${APP_OWNER_PASSWORD}@db:5432/${APP_DB_NAME}?sslmode=disable" \
  api /app/admin bootstrap --name "Casa da Família" --max-members 4

# 2. Adicionar cada familiar (a senha temporária será exibida uma única vez no terminal)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec \
  -e MIGRATE_DATABASE_URL="postgres://app_owner:${APP_OWNER_PASSWORD}@db:5432/${APP_DB_NAME}?sslmode=disable" \
  api /app/admin user add --name "Familiar 1" --email "familiar1@casa.local"
```

No primeiro acesso em `http://localhost:5173`, o familiar entra com a senha temporária e o sistema exige a definição de uma senha pessoal (mínimo de 12 caracteres) antes de liberar o acesso aos ambientes.

## 5. Rodar os testes automatizados

A partir da raiz do repositório, com o container `db` ativo:

```bash
set -a && . deploy/.env && set +a
TEST_OWNER_DATABASE_URL="postgres://app_owner:${APP_OWNER_PASSWORD}@127.0.0.1:5433/${APP_DB_NAME}?sslmode=disable" \
TEST_RW_DATABASE_URL="postgres://app_rw:${APP_RW_PASSWORD}@127.0.0.1:5433/${APP_DB_NAME}?sslmode=disable" \
go test -v ./...
```
