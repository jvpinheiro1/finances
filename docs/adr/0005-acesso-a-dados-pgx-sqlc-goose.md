# ADR 0005: Acesso a dados com pgx + sqlc e migrations com goose

- Status: aceito
- Data: 2026-11-23

## Decisão
- Driver `github.com/jackc/pgx/v5` com pool (`pgxpool`).
- SQL escrito à mão em `backend/queries/<modulo>.sql` e código Go gerado pelo **sqlc** (um pacote por módulo). O código gerado é versionado.
- Migrations SQL em `backend/migrations/` com **goose**, embutidas no binário e executadas pelo comando `admin migrate up|down|status` usando o papel `app_owner`.
- Nenhum SQL concatenado com entrada do usuário; sempre parâmetros.

## Consequências
- SQL explícito, revisável e tipado, sem ORM.
- É preciso rodar `sqlc generate` após mudar queries ou schema (o CI confere que o código gerado está atualizado).
