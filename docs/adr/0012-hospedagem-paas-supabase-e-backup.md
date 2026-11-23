# ADR 0012: Hospedagem PaaS + Supabase Free, Proxy Reverso Confiável e Backup Criptografado

- **Status**: Aceito (2026-11-23)
- **Decisões relacionadas**: E9-D1 (opção b) e E9-D2 (opção a)

## Contexto

Na Etapa 9 precisamos preparar o sistema **Finanças Família** para execução em produção sem custo mensal obrigatório, garantindo:
1. **Isolamento RLS no PostgreSQL gerenciado (Supabase Free)**: o usuário padrão `postgres` criado pelo Supabase possui o atributo `BYPASSRLS`, o que anularia as políticas `FORCE ROW LEVEL SECURITY` caso a API conectasse com ele.
2. **Cookies `HttpOnly; Secure; SameSite=Lax` em PaaS (Render / Fly.io)**: se o frontend (PWA) e a API rodarem em domínios diferentes (ex.: `*.onrender.com` diferentes), navegadores modernos (especialmente Safari no iOS e Chrome no Android com bloqueio de cookies de terceiros) bloqueiam o envio do cookie de sessão `SameSite=Lax`.
3. **Extração segura de IP atrás de Load Balancer (`X-Forwarded-For`)**: em qualquer PaaS ou proxy reverso, a conexão TCP chega do IP interno do proxy. Confiar cegamente em `X-Forwarded-For` de qualquer origem permitiria burlar o rate limit de login; ignorar `X-Forwarded-For` bloquearia todos os usuários atrás do mesmo proxy.
4. **Ausência de backup automático no Supabase Free e pausa por inatividade (7 dias)**: o plano gratuito do Supabase não oferece backups automáticos e pausa o banco caso não haja atividade por 7 dias.

## Decisão

1. **Deploy Unificado Single-Origin para PaaS (`E9-D1`, opção b)**:
   - Criado um `Dockerfile` multi-stage na raiz do projeto que compila a PWA React (`frontend/dist`) e os binários Go (`api` e `admin`) na mesma imagem mínima (`alpine:3.21`), servindo o frontend estático diretamente pelo binário `api` quando `STATIC_DIR=/app/public` estiver definido.
   - Assim, tanto no **Render Free** ([render.yaml](file:///home/gamer/projetos/financas-familia/render.yaml)) quanto no **Fly.io** ([fly.toml](file:///home/gamer/projetos/financas-familia/fly.toml)), a PWA e `/api/v1/*` compartilham a **mesma origem HTTPS**, garantindo funcionamento nativo do cookie `ff_session` (`HttpOnly; Secure; SameSite=Lax`) sem CORS e consumindo apenas 1 serviço gratuito.
   - O suporte a `PORT` (injetado por Render/Fly.io) foi adicionado a `internal/platform/config`.

2. **Script de Papéis para Supabase Free ([deploy/supabase-init-roles.sql](file:///home/gamer/projetos/financas-familia/deploy/supabase-init-roles.sql))**:
   - No Supabase Free, o administrador executa uma única vez o script `deploy/supabase-init-roles.sql` no SQL Editor para criar o papel `app_rw` com `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`.
   - As migrations (`admin migrate up`) e o bootstrap (`admin bootstrap`) usam a string de conexão do usuário `postgres` (`OWNER_DATABASE_URL`), enquanto a API em execução no PaaS usa exclusivamente a string de conexão do usuário `app_rw` (`DATABASE_URL`), preservando 100% do `FORCE ROW LEVEL SECURITY` e sem acoplar nenhuma regra de negócio a recursos proprietários do Supabase.

3. **Validação de Proxy Confiável (`TRUSTED_PROXY_CIDRS`)**:
   - `httpx.ClientIP(r)` passa a verificar se `r.RemoteAddr` pertence às faixas CIDR configuradas em `TRUSTED_PROXY_CIDRS` (ex.: redes privadas `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.1/32,::1/128` usadas pelos load balancers internos de PaaS/Docker).
   - Somente quando a conexão TCP vem de um proxy confiável o IP real do cliente é extraído de `X-Forwarded-For` (pegando o IP mais à direita que não seja um proxy confiável) ou `X-Real-IP`.

4. **Backup Automatizado com Criptografia AES-256 Opcional e Retenção de 30 Dias (`E9-D2`, opção a)**:
   - Os scripts [scripts/backup-db.sh](file:///home/gamer/projetos/financas-familia/scripts/backup-db.sh) e [scripts/restore-db.sh](file:///home/gamer/projetos/financas-familia/scripts/restore-db.sh) suportam tanto conexão remota (`BACKUP_DATABASE_URL` apontando para o Supabase Free) quanto o container local (`DB_CONTAINER`), usando automaticamente `postgres:17-alpine` via Docker caso `pg_dump`/`pg_restore` não estejam instalados no sistema hospedeiro.
   - Quando `BACKUP_PASSPHRASE` é definida, o dump (`pg_dump -Fc`) é criptografado em trânsito com `openssl enc -aes-256-cbc -pbkdf2 -salt` (`.dump.enc`) e acompanhado de manifesto `.sha256`.
   - A execução diária via cron/GitHub Actions/systemd timer cumpre dupla função no Supabase Free: gera backup externo criptografado com retenção de 30 dias e mantém atividade regular no banco para evitar a pausa de 7 dias.

## Consequências

- **Positivas**: Custo R$ 0,00 em nuvem (PaaS + Supabase Free) ou localmente via Docker Compose; zero dependência de Supabase Auth/SDK; RLS `FORCE` preservado; backups criptografados fora do provedor.
- **Limitações conhecidas do Tier Gratuito**: No Render Free, o container hiberna após 15 minutos sem tráfego (o primeiro request leva ~30s para acordar; o app Android possui `connectTimeout = 10s` / `readTimeout = 15s` e pode ser ajustado ou o endpoint `/healthz` pode receber ping periódico).
