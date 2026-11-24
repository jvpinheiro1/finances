# Arquitetura — Finanças Família

## Visão geral

O sistema é um **monólito modular em Go** (`cmd/api` + `cmd/admin`) com banco **PostgreSQL 17** e interface web **React + TypeScript (PWA)** (`web/`).

- As decisões arquiteturais estão documentadas em `docs/adr/`:
  - [ADR 0001](adr/0001-monolito-modular-go.md) — Monólito modular em Go com REST (`net/http` stdlib)
  - [ADR 0002](adr/0002-dinheiro-em-centavos.md) — Valores monetários em centavos (`BIGINT` / `int64`)
  - [ADR 0003](adr/0003-autenticacao-propria-e-sessoes.md) — Autenticação própria (argon2id) e sessão opaca em cookie `HttpOnly`
  - [ADR 0004](adr/0004-ambientes-e-rls.md) — Ambientes coletivo e individual com política central e Row Level Security (RLS)
  - [ADR 0005](adr/0005-acesso-a-dados-pgx-sqlc-goose.md) — Acesso a dados com `pgx` + `sqlc` e migrations com `goose`
  - [ADR 0006](adr/0006-divisoes-deterministicas-e-reembolsos.md) — Rateio determinístico de centavos em divisões e confirmação de reembolsos
  - [ADR 0007](adr/0007-parcelamentos-e-estornos.md) — Materialização de parcelamentos e estornos proporcionais em centavos
  - [ADR 0008](adr/0008-despesas-recorrentes-e-assinaturas.md) — Despesas recorrentes e assinaturas com geração idempotente
  - [ADR 0009](adr/0009-notificacoes-internas-e-privacidade-pwa.md) — Notificações internas com RLS por destinatário e privacidade na PWA
  - [ADR 0010](adr/0010-relatorios-e-exportacao-csv-pdf.md) — Relatórios em centavos e exportação CSV (anti-injection) e PDF nativo em Go
  - [ADR 0011](adr/0011-captura-android-e-fila-revisao.md) — Captura de notificações bancárias no Android, parser versionado e fila de revisão privada
  - [ADR 0012](adr/0012-hospedagem-paas-supabase-e-backup.md) — Hospedagem PaaS + Supabase Free, proxy reverso confiável e backup criptografado

## Módulos implementados (Etapas 1 a 9)

- `internal/platform/`: configuração (`config`), conexão e transações com `app.user_id` para RLS (`db`), contexto de autenticação (`authctx`), middlewares HTTP, CSRF, rate limiting e respostas JSON (`httpx`), executor de migrations (`migrate`).
- `internal/identity/`: hash de senha `argon2id`, bloqueio progressivo após falhas de login, sessões opacas (apenas SHA-256 no banco), troca obrigatória de senha temporária.
- `internal/household/`: residência e listagem de membros ativos (sem expor e-mail de terceiros).
- `internal/workspace/`: ambientes coletivo (`household`) e individual (`personal`), política central `workspace.CanAccess` + proteção por RLS no banco.
- `internal/expense/`: categorias (8 padrão + personalizadas), meios de pagamento (com `last4`, `closing_day` e `due_day` opcionais e bloqueio de PAN), despesas em centavos (`int64`), divisões determinísticas (`equal`, `exact`, `percentage`, `shares`), parcelamentos (`2x..48x` com resto na 1ª parcela), estornos parciais/totais e contas/assinaturas recorrentes (`monthly`, `weekly`, `yearly`) com geração idempotente e RLS `FORCE`.
- `internal/settlement/`: cálculo de saldos líquidos por membro e dívidas bilaterais entre pares (descontando estornos coletivos) e ciclo de vida de reembolsos (`pending` → `confirmed`/`rejected`) segundo os ADRs 0006 e 0007.
- `internal/notification/`: caixa de entrada individual por familiar com RLS estrito (`recipient_user_id = app_current_user_id()` para leitura/atualização) e deduplicação de alertas de vencimento próximo (ADR 0009).
- `internal/report/`: consolidação financeira em centavos por período, categoria, meio de pagamento e membro (desembolso vs consumo líquido), exportação CSV pt-BR com sanitização contra CSV Formula Injection e gerador PDF 1.4 nativo em Go puro (ADR 0010).
- `internal/bankimport/` e `android/`: tokens de dispositivo Android revogáveis (SHA-256 no banco), app Android em Kotlin (`NotificationListenerService`, `minSdk 26`), parsers para Nubank, Itaú, Bradesco, BB, Inter, Santander, C6 e genérico com mascaramento anti-PAN, e fila privada de revisão com `FORCE ROW LEVEL SECURITY` por dono do celular (ADR 0011).
- `internal/audit/`: trilha de auditoria sem senhas, tokens ou dados financeiros.
- `internal/admin/`: operações transacionais do CLI administrativo (`bootstrap`, `user add`, `user reset-password`, `user list`).
