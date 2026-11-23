# Plano da Etapa 9: Hospedagem, TLS, Backup Automatizado e Observabilidade de Produção

> [!IMPORTANT]
> Seguindo as regras do projeto (`AGENTS.md`), este documento apresenta a comparação técnica das opções de **hospedagem** (decisão em aberto obrigatória), estratégia de TLS/HTTPS, scripts de backup/restauração do PostgreSQL e endurecimento de produção para sua validação antes da implementação. **Nenhum serviço pago será contratado ou ativado.**

## 1. Requisitos cobertos na Etapa 9

- **RNF01 (Segurança em produção)**:
  - HTTPS/TLS obrigatório (`COOKIE_SECURE=true`, HSTS, headers de segurança no proxy reverso);
  - Confiar em `X-Forwarded-For` / `X-Real-IP` no rate limiter somente quando a requisição vier de proxy reverso confiável configurado (`TRUSTED_PROXY_CIDRS`);
- **RNF03 / RNF04 (Disponibilidade, Backup e Recuperação de Desastres)**:
  - Script automatizado e testado de backup lógico (`pg_dump --format=custom`) e restauração (`pg_restore`) com retenção local e opção de criptografia simétrica (`openssl enc -aes-256-cbc -pbkdf2` ou `gpg`), já que planos gratuitos de banco gerenciado (como Supabase Free) **não** oferecem backup automático;
- **RNF07 (Observabilidade e Operação)**:
  - Logs estruturados JSON sem dados sensíveis, healthchecks em todos os containers (`db`, `api`, `web`/`proxy`), perfil `docker-compose.prod.yml` com Caddy (TLS automático Let's Encrypt) ou Cloudflare Tunnel, e verificação de segredos (`gitleaks`) no CI.

---

## 2. Comparação de Alternativas de Hospedagem (Sem Custo)

| Opção | Como funciona | Vantagens | Limitações / Riscos |
|---|---|---|---|
| **A) Auto-hospedado na rede da casa / mini-PC / servidor local + Tailscale ou Cloudflare Tunnel (Recomendada para custo R$ 0 e privacidade total)** | Roda o `docker compose` em uma máquina da casa (WSL/Linux/Raspberry/mini-PC). Os 4 celulares/navegadores acessam via **Tailscale** (VPN WireGuard privada gratuita para até 100 dispositivos) ou **Cloudflare Tunnel** com HTTPS. | - **Custo R$ 0,00 garantido** (sem cartão de crédito);<br>- **100% dos dados financeiros ficam fisicamente dentro da sua casa**;<br>- Sem pausa por inatividade e sem limite de 500 MB. | Depende de a máquina local estar ligada quando os familiares forem acessar. |
| **B) VPS Gratuita (Oracle Cloud Always Free ARM/AMD) + Docker Compose + Caddy TLS** | Roda a mesma stack `docker-compose.prod.yml` (Postgres + API Go + Frontend + Caddy HTTPS) numa VM gratuita na nuvem. | - Online 24/7 na internet com HTTPS automático;<br>- Banco local na VM sem pausa de 7 dias. | Exige cadastro de cartão na Oracle (embora o tier Always Free não cobre) e backup externo periódico. |
| **C) PaaS Gratuito (Render Free / Fly.io / Koyeb) + Supabase Free (PostgreSQL)** | API Go e Frontend hospedados em PaaS gratuito conectando ao Postgres do Supabase Free (`app_owner` / `app_rw` com RLS). | - Sem servidor para administrar;<br>- Nossas migrations e RLS funcionam direto no Supabase. | - **Supabase Free pausa após 7 dias sem atividade** e **não tem backup automático**;<br>- Render/Koyeb Free hibernam o container após 15 min ocioso (cold start de ~30s, o que pode atrasar o envio do app Android). |

---

## 3. Entregáveis técnicos da Etapa 9 no repositório

1. **Compose de Produção (`deploy/docker-compose.prod.yml` + `deploy/Caddyfile`)**:
   - Proxy reverso **Caddy 2** com HTTPS automático, HSTS, compressão e roteamento unificado (`/` → frontend estático, `/api/*` → `api:8080`), eliminando problemas de CORS e garantindo `COOKIE_SECURE=true`.
2. **Suporte a Proxy Reverso Confiável no Backend (`TRUSTED_PROXY_CIDRS`)**:
   - Evolução de `httpx.ClientIP` para extrair o IP real do cliente de `X-Forwarded-For` **apenas** quando a conexão TCP vier de um proxy reverso autorizado (evitando falsificação de IP no rate limit de login).
3. **Scripts de Backup e Restauração (`scripts/backup-db.sh` e `scripts/restore-db.sh`)**:
   - `backup-db.sh`: gera dump consistente (`pg_dump -Fc`), valida integridade, aplica criptografia opcional se `BACKUP_PASSPHRASE` estiver definida e limpa backups antigos conforme retenção (`KEEP_DAYS=30`).
   - `restore-db.sh`: testa e restaura um backup de forma segura.
4. **Hardening no CI (`.github/workflows/ci.yml`)**:
   - Adição de varredura de segredos (`gitleaks`) e verificação de `sqlc` atualizado.
5. **Guia completo de Deploy, Backup e Produção (`docs/producao-e-backup.md`)**.

---

## 4. Decisões da Etapa 9 validadas pelo usuário ✅

### **E9-D1 — Modelo de hospedagem principal configurado e documentado**
- **Aprovada opção (b): PaaS gratuito (Render Free / Fly.io) + Supabase Free**, utilizando o `Dockerfile` multi-stage unificado na raiz (`STATIC_DIR=/app/public`, mesma origem HTTPS para PWA + API), blueprints `render.yaml` e `fly.toml`, e o script `deploy/supabase-init-roles.sql` que cria os papéis `app_owner` e `app_rw` (`NOBYPASSRLS`) no Supabase mantendo `FORCE ROW LEVEL SECURITY`.

### **E9-D2 — Estratégia de Backup do Banco (`scripts/backup-db.sh` e `scripts/restore-db.sh`)**
- **Aprovada opção (a) recomendado:** Script `pg_dump -Fc --enable-row-security` automatizável via cron/systemd timer com retenção de 30 dias, manifesto `.sha256` e suporte a criptografia AES-256 (`openssl enc -aes-256-cbc -pbkdf2 -iter 100000`) quando a variável `BACKUP_PASSPHRASE` for informada.
