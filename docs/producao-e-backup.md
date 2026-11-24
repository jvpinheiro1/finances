# Guia de Deploy em Produção (PaaS + Supabase Free) e Backup Criptografado

> **Quadrante Diátaxis:** *How-To Guide (Guia Prático de Produção e Recuperação de Desastres)*  
> Este guia mostra como publicar o **Finanças Família** gratuitamente usando **Render Free** (ou **Fly.io**) + **Supabase Free (PostgreSQL)** conforme a decisão **E9-D1 (opção b)**, e como operar os backups criptografados com retenção de 30 dias conforme a decisão **E9-D2 (opção a)**.

---

## 1. Preparando o Banco no Supabase Free (com `FORCE ROW LEVEL SECURITY`)

O usuário padrão `postgres` do Supabase possui o privilégio `BYPASSRLS`, que ignoraria as políticas de isolamento entre ambientes individuais. Por isso, nosso sistema separa os papéis em `app_owner` (migrations e CLI admin) e `app_rw` (usado pela API em produção, com `NOBYPASSRLS`).

### Passo 1.1 — Criar os papéis `app_owner` e `app_rw` no Supabase
1. Crie um projeto gratuito em `https://supabase.com` (região recomendada: **South America - São Paulo `sa-east-1`**).
2. No menu lateral do Supabase, abra **SQL Editor** → **New query**.
3. Copie o conteúdo de [deploy/supabase-init-roles.sql](file:///home/gamer/projetos/financas-familia/deploy/supabase-init-roles.sql), substitua `'TROQUE_POR_SENHA_FORTE_OWNER'` e `'TROQUE_POR_SENHA_FORTE_RW'` por duas senhas fortes (geradas localmente com `openssl rand -hex 24`) e clique em **Run**.

### Passo 1.2 — Montar as duas strings de conexão (Session Mode — porta `5432`)
No painel do Supabase, clique em **Connect** → **Session pooler (port 5432)** para obter o host do pooler IPv4/IPv6 (ex.: `aws-0-sa-east-1.pooler.supabase.com`) e o sufixo do seu projeto (`<project-ref>`):

- **String do dono (`MIGRATE_DATABASE_URL`, usada apenas para migrations e bootstrap CLI)**:
  ```text
  postgres://app_owner.<project-ref>:<SENHA_OWNER>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
  ```
- **String da API (`DATABASE_URL`, usada pelo PaaS em produção com RLS ativo)**:
  ```text
  postgres://app_rw.<project-ref>:<SENHA_RW>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
  ```

> [!IMPORTANT]
> Use sempre a porta **`5432` (Session Mode)** do Supavisor (ou a conexão direta `db.<project-ref>.supabase.co:5432`). Isso garante total compatibilidade com prepared statements do `pgx/v5` e com o `SELECT set_config('app.user_id', $1, true)` por transação.

### Passo 1.3 — Aplicar as migrations e criar a residência + 4 familiares
A partir da raiz do repositório na sua máquina local (com `MIGRATE_DATABASE_URL` exportada):

```bash
export MIGRATE_DATABASE_URL="postgres://app_owner.<project-ref>:<SENHA_OWNER>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require"

# 1. Aplicar todas as migrations (00001 a 00007)
go run ./cmd/admin migrate up

# 2. Criar a residência e os membros (gera senhas temporárias com troca obrigatória no 1º login)
go run ./cmd/admin bootstrap --name "Família" --max-members 4
go run ./cmd/admin user add --name "Maria" --email "maria@familia.local"
go run ./cmd/admin user add --name "João" --email "joao@familia.local"
```

---

## 2. Deploy Unificado no Render Free ou Fly.io (`E9-D1b`)

O repositório inclui um [Dockerfile](file:///home/gamer/projetos/financas-familia/Dockerfile) multi-stage na raiz que empacota a PWA React compilada (`/app/public`) e os binários Go (`/app/api` e `/app/admin`) no mesmo container. Quando `STATIC_DIR=/app/public` está ativo:
- A PWA e a API (`/api/v1/*`) respondem no **mesmo domínio HTTPS**;
- O cookie de sessão `ff_session` (`HttpOnly; Secure; SameSite=Lax`) funciona nativamente no Android, iOS e Desktop sem bloqueio de cookies de terceiros;
- `TRUSTED_PROXY_CIDRS` permite que `httpx.ClientIP(r)` extraia com segurança o IP real do cliente a partir do `X-Forwarded-For` do load balancer do PaaS.

### Opção A — Deploy no Render Free ([render.yaml](file:///home/gamer/projetos/financas-familia/render.yaml))
1. Faça push do repositório para um repositório **privado** no GitHub.
2. No painel do Render (`https://dashboard.render.com`), clique em **New +** → **Blueprint** e selecione o repositório.
3. O Render lerá o arquivo [render.yaml](file:///home/gamer/projetos/financas-familia/render.yaml) e pedirá apenas duas variáveis:
   - `DATABASE_URL`: cole a string do papel **`app_rw`** do Supabase (`?sslmode=require`);
   - `ALLOWED_ORIGINS`: informe a URL HTTPS do serviço no Render (ex.: `https://financas-familia.onrender.com`).

### Opção B — Deploy no Fly.io na região de São Paulo `gru` ([fly.toml](file:///home/gamer/projetos/financas-familia/fly.toml))
```bash
fly launch --no-deploy
fly secrets set \
  DATABASE_URL="postgres://app_rw.<project-ref>:<SENHA_RW>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require" \
  ALLOWED_ORIGINS="https://financas-familia.fly.dev"
fly deploy
```

---

## 3. Backup Criptografado Automatizado e Retenção de 30 Dias (`E9-D2a`)

O plano gratuito do Supabase **não realiza backups automáticos** e **pausa o banco após 7 dias sem conexões**. O script [scripts/backup-db.sh](file:///home/gamer/projetos/financas-familia/scripts/backup-db.sh) resolve os dois problemas simultaneamente:
1. Conecta ao banco (remoto via `BACKUP_DATABASE_URL` ou container local `financas-familia-db-1`) e extrai um dump completo consistente (`pg_dump --format=custom --enable-row-security`);
2. Valida o catálogo do dump com `pg_restore --list`;
3. Se `BACKUP_PASSPHRASE` estiver definida, criptografa o arquivo com **AES-256-CBC + PBKDF2 (100.000 iterações)** gerando `backups/financas_<DATA>.dump.enc` + checksum `.sha256`;
4. Remove backups locais com mais de `KEEP_DAYS` dias (padrão: **30 dias**).

### 3.1 — Executar um backup criptografado manual
```bash
# Para o container Docker local:
BACKUP_PASSPHRASE="sua-frase-secreta-de-backup" ./scripts/backup-db.sh

# Para o Supabase Free remoto:
BACKUP_DATABASE_URL="postgres://app_owner.<project-ref>:<SENHA_OWNER>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require" \
BACKUP_PASSPHRASE="sua-frase-secreta-de-backup" \
./scripts/backup-db.sh
```

### 3.2 — Testar a integridade e descriptografia de um backup (sem alterar o banco)
```bash
BACKUP_PASSPHRASE="sua-frase-secreta-de-backup" \
./scripts/restore-db.sh --verify-only backups/financas_20261123T194154Z.dump.enc
```

### 3.3 — Restaurar um backup
```bash
# No container local:
BACKUP_PASSPHRASE="sua-frase-secreta-de-backup" \
./scripts/restore-db.sh backups/financas_20261123T194154Z.dump.enc

# No Supabase Free remoto:
RESTORE_DATABASE_URL="postgres://app_owner.<project-ref>:<SENHA_OWNER>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require" \
BACKUP_PASSPHRASE="sua-frase-secreta-de-backup" \
./scripts/restore-db.sh backups/financas_20261123T194154Z.dump.enc
```

### 3.4 — Agendar backup diário via Cron (evita pausa de 7 dias do Supabase Free)
Configure em `deploy/.env` as variáveis `BACKUP_DATABASE_URL` e `BACKUP_PASSPHRASE` e adicione ao `crontab -e` do seu usuário Linux/WSL:

```cron
0 3 * * * /home/gamer/projetos/financas-familia/scripts/backup-db.sh >> /home/gamer/projetos/financas-familia/backups/cron.log 2>&1
```
