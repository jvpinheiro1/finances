# Finanças Família

Sistema privado de gestão financeira familiar para 4 membros, com ambientes individuais isolados no banco via **PostgreSQL `FORCE ROW LEVEL SECURITY` (RLS)** e ambiente coletivo da residência com rateio determinístico em centavos, reembolsos, parcelamentos, estornos, contas/assinaturas recorrentes, notificações internas, relatórios mensais (CSV/PDF) e app Android nativo em Kotlin para captura de notificações bancárias.

## Stack

- **Backend**: Go 1.27 (`net/http` stdlib, monólito modular REST, `pgx/v5`, `sqlc`, `goose`, `argon2id`)
- **Banco de Dados**: PostgreSQL 17 (`FORCE ROW LEVEL SECURITY`, separação de papéis `app_owner` e `app_rw`, valores monetários 100% em centavos `BIGINT`/`int64`)
- **Web (PWA)**: React 19 + TypeScript + Vite (`web/`)
- **Mobile**: Android nativo em Kotlin (`android/`, `minSdk = 26`, `targetSdk = 35`, `NotificationListenerService` + `SharedPreferences` isolado em `MODE_PRIVATE` com `allowBackup="false"`)
- **Infraestrutura & CI**: Docker Compose, Dockerfile unificado para PaaS (Render / Fly.io) + Supabase Free, scripts de backup criptografado AES-256 e GitHub Actions (`govulncheck`, `gitleaks`, testes de integração com RLS).

## Documentação (Estrutura Diátaxis)

Consulte o índice completo em [`docs/README.md`](docs/README.md):

1. **Tutorial**: [Guia de Instalação e Primeiro Acesso](docs/instalacao.md)
2. **Guias Como-Fazer (How-To)**:
   - [Guias de Operação e Uso Diário](docs/guias-operacao.md)
   - [Deploy em Produção (PaaS + Supabase Free) e Backup Criptografado](docs/producao-e-backup.md)
3. **Referência Técnica**: [Referência da API REST e CLI Admin](docs/referencia-api.md)
4. **Explicação e Arquitetura**: [Arquitetura Geral](docs/arquitetura.md) e [ADRs 0001–0012](docs/adr/)
