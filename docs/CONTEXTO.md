CONTEXTO DO PROJETO - FINANÇAS FAMÍLIA
Atualizado em: 2026-11-24

OBJETIVO
- Sistema privado de gestão financeira para 4 familiares: despesas individuais
  (privadas) e coletivas, divisões, reembolsos, parcelamentos, estornos,
  contas recorrentes, notificações, relatórios (CSV/PDF) e captura de
  notificações bancárias via app Android.
- Stack: Go (monólito modular, REST) + React/TS (PWA) + PostgreSQL + Kotlin
  (Android) + Docker Compose + GitHub Actions. Supabase opcional.

AMBIENTE (verificado em 2026-11-23, WSL Ubuntu 24.04)
- [OK] Docker Engine 29.1.3 (daemon rodando)
- [OK] Docker Compose v5.8.0 em ~/.docker/cli-plugins/docker-compose (sha256 conferido). Obs.: o sandbox do agente não enxerga ~/.docker; comandos compose precisam rodar fora do sandbox (com aprovação)
- [OK] Go 1.27.4 em ~/.local/go (sha256 conferido); PATH adicionado ao ~/.bashrc ($HOME/.local/go/bin e $HOME/go/bin)
- [OK] Node 24.14.1 / npm (via nvm)
- [OK] Git
- [OK] Java 25 Temurin (/home/gamer/.local/jdk-25), útil para o Android depois
- psql ausente (usar o cliente de dentro do container do Postgres)
- Sandbox do agente: sem acesso ao socket do Docker, sem gcc e sem make; docker/compose/testcontainers só fora do sandbox (com aprovação)

DOCUMENTOS
- Plano da Etapa 1: docs/etapa1_plano.md [IMPLEMENTADO E VALIDADO]
- Plano da Etapa 2: docs/etapa2_plano.md [IMPLEMENTADO E VALIDADO]
- Plano da Etapa 3: docs/etapa3_plano.md [IMPLEMENTADO E VALIDADO]
- Plano da Etapa 4: docs/etapa4_plano.md [IMPLEMENTADO E VALIDADO]
- Plano da Etapa 5: docs/etapa5_plano.md [IMPLEMENTADO E VALIDADO]
- Plano da Etapa 6: docs/etapa6_plano.md [IMPLEMENTADO E VALIDADO]
- Plano da Etapa 7: docs/etapa7_plano.md [IMPLEMENTADO E VALIDADO]
- Plano da Etapa 8: docs/etapa8_plano.md [IMPLEMENTADO E VALIDADO]
- Plano da Etapa 9: docs/etapa9_plano.md [IMPLEMENTADO E VALIDADO]
- Documentação Diátaxis (skill documentation-writer): docs/README.md (índice), docs/instalacao.md (Tutorial), docs/guias-operacao.md + docs/producao-e-backup.md (How-To), docs/referencia-api.md (Reference), docs/arquitetura.md + docs/adr/0001..0012 (Explanation)

DECISÕES
- [OK] D5: pasta do projeto /home/gamer/projetos/financas-familia
- [OK] D6: contexto próprio do projeto neste arquivo; contexto_cybersec.txt
  não é usado (registrado no /home/gamer/AGENTS.md)
- [OK] D1 auth própria no Go (argon2id); Supabase só como Postgres gerenciado opcional (aprovado 2026-11-23)
- [OK] D2 sessão opaca em cookie HttpOnly (hash no BD) + token de dispositivo Android na E8 (aprovado 2026-11-23)
- [OK] D3 bootstrap de usuários via CLI admin com senha temporária e troca obrigatória (aprovado 2026-11-23)
- [OK] D4 Go em ~/.local/go e compose em ~/.docker/cli-plugins, sem sudo (aprovado 2026-11-23)
- [OK] Dinheiro em centavos (BIGINT/int64), só BRL (ADR 0002)
- [OK] E2-D1: qualquer membro ativo da residência pode editar/excluir despesa do ambiente coletivo, com registro em auditoria (aprovado 2026-11-23)
- [OK] E2-D2: criar automaticamente as 8 categorias padrão (Alimentação, Moradia, Contas, Transporte, Saúde, Lazer, Educação, Outros) para a residência (aprovado 2026-11-23)
- [OK] E3-D1: rateio determinístico de centavos restantes na divisão: absorve primeiro quem pagou (paid_by, se participante) e depois por ordem de user_id dos participantes (aprovado 2026-11-23)
- [OK] E3-D2: confirmação de reembolso em 2 etapas quando registrado pelo devedor (pending -> credor confirma -> confirmed) e imediata quando registrado pelo próprio credor (aprovado 2026-11-23)
- [OK] E4-D1: closing_day e due_day opcionais (1..31) em cartões de crédito; 1ª parcela avança 1 mês se a compra ocorrer no dia do fechamento ou depois, e as parcelas 2..N avançam mês a mês mantendo o dia (ajustado para o último dia do mês em meses mais curtos) (aprovado 2026-11-23)
- [OK] E4-D2: permitir excluir tanto uma parcela individual quanto o parcelamento inteiro via DELETE /api/v1/installment-plans/{planId} (aprovado 2026-11-23)
- [OK] E5-D1: geração de despesas recorrentes (incluindo assinaturas mensais/anuais e contas fixas) automática por worker periódico no backend + botão sob demanda na UI (aprovado 2026-11-23)
- [OK] E5-D2: contas recorrentes de valor variável nascem com o valor de referência em centavos e a ocorrência gerada no mês pode ser editada normalmente (aprovado 2026-11-23)
- [OK] E6-D1: caixa de entrada de notificações na barra superior da PWA + alerta opcional da Notification API do navegador com texto genérico sem valores monetários (aprovado 2026-11-23)
- [OK] E6-D2: alerta de vencimento próximo de assinaturas/contas recorrentes com até 3 dias de antecedência, deduplicado por ciclo (aprovado 2026-11-23)
- [OK] E7-D1: CSV em UTF-8 com BOM, separador ';' (padrão pt-BR), colunas de valor em centavos inteiros e BRL formatado, e sanitização contra CSV Formula Injection (aprovado 2026-11-23)
- [OK] E7-D2: geração de PDF diretamente no backend Go puro (GET /api/v1/workspaces/{wsId}/reports/export.pdf), sem Chromium nem serviços pagos (aprovado 2026-11-23)
- [OK] E8-D1: parsers dedicados para Nubank, Itaú, Bradesco, Banco do Brasil, Inter, Santander e C6 Bank + parser genérico pt-BR (aprovado 2026-11-23)
- [OK] E8-D2: App Android em Kotlin com minSdk 26 (Android 8.0+) e targetSdk 35 (Android 15) (aprovado 2026-11-23)
- [OK] E8-D3: quando o formato da notificação bancária não puder ser extraído com 100% de certeza, nunca "chutar" valor; gravar como parse_status='needs_review' na fila privada do dono do celular para revisão manual (aprovado 2026-11-23)
- [OK] E9-D1: opção (b) - configurar e documentar como padrão o deploy em PaaS gratuito (Render / Fly.io) + Supabase Free (PostgreSQL com script de inicialização de papéis app_owner/app_rw e RLS FORCE), mantendo o Docker Compose para execução local/auto-hospedada (aprovado 2026-11-23)
- [OK] E9-D2: opção (a) recomendado - scripts scripts/backup-db.sh e scripts/restore-db.sh com pg_dump -Fc, retenção de 30 dias e criptografia AES-256 (openssl enc -aes-256-cbc -pbkdf2) opcional via BACKUP_PASSPHRASE, compatíveis com Supabase remoto e Docker local (aprovado 2026-11-23)

SKILLS / MCP (pedido em 2026-11-18)
- [BLOQUEADO] Instalação a partir de cursor.directory/plugins/{go, mcp-supabase,
  mcp-cloudflare, mcp-vercel, mcp-figma, mcp-docker, uiux-design}: o site
  responde HTTP 429 com "Vercel Security Checkpoint" (desafio anti-bot).
  Não contornado. Aguardando o usuário escolher como seguir.
- Locais de instalação no agy: skills globais em ~/.gemini/config/skills/<nome>/SKILL.md
  (ou do projeto em <projeto>/.agents/skills/), MCP em ~/.gemini/config/mcp_config.json
  (hoje só tem o "burp").
- [OK] Skill "context-engineering" (addyosmani/agent-skills, licença MIT, commit
  583df9afd8abd0e9cbe9f25c0927ed74c0c72028) instalada GLOBALMENTE em
  ~/.gemini/config/skills/context-engineering/ (SKILL.md sem alterações + ORIGEM.txt).
  Conteúdo revisado: só texto de orientação, sem scripts. Vale a partir da
  próxima conversa (as skills são lidas no início da sessão).
- [OK] Skill "go-api-stdlib" (texto da regra "go" do cursor.directory colado pelo
  usuário) instalada globalmente em ~/.gemini/config/skills/go-api-stdlib/.
  Adicionados frontmatter + notas locais: ServeMux NÃO suporta regex (o texto
  original diz que sim), preferir log/slog, e as regras do AGENTS.md do projeto
  prevalecem sobre a skill.
- [OK] Skill "uiux-design" (texto colado pelo usuário) instalada globalmente em
  ~/.gemini/config/skills/uiux-design/. Notas locais: FID foi substituído por INP,
  WCAG 2.2 AA, sem analytics/heatmap/gravação de sessão em app financeiro sem
  aprovação (LGPD), A/B testing não se aplica a 4 usuários, paleta/marca só com
  orientação do usuário.
- [OK] Skill "ui-ux-pro-max" (nextlevelbuilder/ui-ux-pro-max-skill, MIT, commit f823ab5fb970de820e5a0626a0786aba9aee0543 / v2.15.0) instalada globalmente em ~/.gemini/config/skills/ui-ux-pro-max/ (SKILL.md com caminho de scripts/search.py ajustado, data/, references/, scripts/). Scripts Python auditados (stdlib puro, sem rede).
- [OK] Skill "documentation-writer" (github/awesome-copilot, Diátaxis framework, blob 93e3fbf57fe64179570de382347db8258c661b56) instalada globalmente em ~/.gemini/config/skills/documentation-writer/ (SKILL.md + ORIGEM.txt, apenas texto, sem scripts).
- [PENDENTE] MCP restantes do cursor.directory: mcp-supabase, mcp-cloudflare,
  mcp-vercel, mcp-figma, mcp-docker.
- Observação: o GitHub (raw.githubusercontent.com / api.github.com) funciona sem
  bloqueio; é uma boa fonte alternativa quando o repositório original da skill é público.

PRÓXIMOS PASSOS
1. Todas as Etapas 1 a 9 do roadmap foram implementadas, testadas e documentadas!
2. Amanhã: executar o ROTEIRO DE TESTES PRÁTICOS abaixo (bootstrap, login na PWA em http://localhost:5173, simulação de notificação Android via curl e backup criptografado).
3. Para publicar em nuvem gratuita (E9-D1b), seguir o passo a passo de docs/producao-e-backup.md (Supabase Free + Render/Fly.io).
4. (Opcional, não bloqueia) Usuário enviar o conteúdo dos MCP restantes do cursor.directory se desejar instalá-los.

ROTEIRO DE TESTES PRÁTICOS (PARA AMANHÃ)
- Passo 1 (Bootstrap da família e senhas temporárias):
  cd /home/gamer/projetos/financas-familia
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm --entrypoint /app/admin migrate bootstrap --name "Família Silva"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm --entrypoint /app/admin migrate user add --name "Maria" --email "maria@familia.local"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm --entrypoint /app/admin migrate user add --name "João" --email "joao@familia.local"
- Passo 2 (Acesso à PWA no navegador):
  Abrir http://localhost:5173 -> logar com maria@familia.local e a senha temporária impressa -> definir nova senha (>= 12 caracteres) -> testar alternância de Ambiente Coletivo/Individual, Nova Despesa, Parcelamentos (2x..48x), Divisões (Igual/Exato/%/Cotas), Saldos/Reembolsos, Estornos, Recorrentes/Assinaturas, Notificações e Relatórios CSV/PDF.
- Passo 3 (Simular captura do App Android via curl):
  Na PWA, gerar um token na seção "App Android (Captura Bancária) e Fila de Revisão" (ff_dev_...) e rodar:
  curl -i -X POST http://localhost:8080/api/v1/ingest/bank-notification -H "Authorization: Bearer SEU_TOKEN_ff_dev" -H "X-Requested-With: AndroidApp" -H "Content-Type: application/json" -d '{"package_name":"com.nu.production","title":"Compra aprovada no seu cartão","text":"Compra de R$ 89,90 aprovada em Supermercado Dia para o cartão final 4321 em 2x","external_id":"teste-nubank-001"}'
  curl -i -X POST http://localhost:8080/api/v1/ingest/bank-notification -H "Authorization: Bearer SEU_TOKEN_ff_dev" -H "X-Requested-With: AndroidApp" -H "Content-Type: application/json" -d '{"package_name":"com.itau","title":"Aviso Itau","text":"Movimentacao realizada na sua conta hoje","external_id":"teste-itau-002"}'
  Clicar em "Atualizar fila" na PWA para revisar/aprovar ou descartar.
- Passo 4 (Testar Backup Criptografado AES-256 e verificação):
  BACKUP_PASSPHRASE="minha-chave-secreta-teste" ./scripts/backup-db.sh
  BACKUP_PASSPHRASE="minha-chave-secreta-teste" ./scripts/restore-db.sh --verify-only backups/financas_*.dump.enc

HISTÓRICO DE ATIVIDADES
- 2026-11-18 15:15 | Análise do briefing e do ambiente; plano da Etapa 1 escrito | nenhum código ainda | validar D1-D6
- 2026-11-18 15:22 | Tentativa de baixar as 7 páginas de plugins do cursor.directory (curl) | HTTP 429 "Vercel Security Checkpoint" em todas (desafio anti-bot), bloqueio NÃO contornado | usuário colar o conteúdo ou autorizar as fontes oficiais
- 2026-11-18 15:25 | AGENTS.md reestruturado: regras gerais + projeto cybersec + projeto Finanças Família, cada um com o próprio arquivo de contexto; criada a pasta do projeto, este CONTEXTO.md e a cópia docs/etapa1_plano.md | OK | idem acima
- 2026-11-18 15:27 | Baixada via raw.githubusercontent.com e instalada a skill context-engineering (addyosmani/agent-skills, MIT, commit 583df9a) em ~/.gemini/config/skills/context-engineering/ | OK, conteúdo revisado e sem scripts | carregar numa conversa nova; seguem pendentes as skills do cursor.directory e D1-D4
- 2026-11-18 15:29 | Instalada a skill go-api-stdlib (texto colado pelo usuário) em ~/.gemini/config/skills/go-api-stdlib/ com frontmatter e notas de compatibilidade (sem regex no ServeMux; slog) | OK | faltam as 5 MCP + uiux-design; D1-D4 pendentes
- 2026-11-18 15:30 | Instalada a skill uiux-design (texto colado pelo usuário) em ~/.gemini/config/skills/uiux-design/ com frontmatter e notas (INP, WCAG 2.2, privacidade) | OK | faltam as 5 MCP; D1-D4 pendentes; pedir paleta/identidade visual antes da UI
- 2026-11-23 13:26 | Retomada do projeto em nova conversa (11a42b9b): lidos CONTEXTO.md e etapa1_plano.md; ambiente reverificado (Go e docker compose continuam ausentes; projeto só tem docs/) | OK | usuário validar D1-D4
- 2026-11-23 13:31 | Usuário aprovou D1-D4 como recomendado | decisões registradas | instalar Go e compose (requer rede, aprovação do usuário)
- 2026-11-23 13:33 | Instalados Go 1.27.4 (~/.local/go) e Docker Compose v5.8.0 (~/.docker/cli-plugins); downloads via go.dev e github.com fora do sandbox, checksums SHA-256 OK; PATH no ~/.bashrc. Downloads em /tmp/ff-dl | OK | iniciar implementação da Etapa 1
- 2026-11-23 13:35 | INÍCIO da implementação da Etapa 1 (backend primeiro: skeleton, ADRs, compose Postgres, migrations, módulos, CLI admin) | em andamento | obs.: sandbox sem docker/gcc/make, comandos docker rodam fora do sandbox |
- 2026-11-23 13:42 | Etapa 1 backend PARCIAL: ADRs 0001-0005, migration 00001_init.sql (RLS + GRANTs), deploy/ (compose, init de papéis, .env.example), sqlc.yaml + queries + código gerado (sqlc v1.31.1 em ~/go/bin), módulos platform/identity/household/workspace/audit/admin, cmd/api e cmd/admin escritos. AINDA NÃO compilado nem testado; falta Dockerfile, testes, go mod tidy, frontend, CI, docs/instalacao.md | pausado a pedido do usuário (instalar skill ui-ux-pro-max) | compilar (go build/vet), escrever testes, Dockerfile |
- 2026-11-23 13:51 | Instalada globalmente a skill ui-ux-pro-max (nextlevelbuilder/ui-ux-pro-max-skill, MIT, commit f823ab5 / v2.15.0) em ~/.gemini/config/skills/ui-ux-pro-max/; scripts Python auditados (stdlib, offline) e search.py testado | OK | continuar implementação do backend da Etapa 1 (compilar, testar, Dockerfile)
- 2026-11-23 13:55 | Backend da Etapa 1 compilado e testado: Dockerfile, testes unitários (identity, workspace) e teste de integração de ponta a ponta (TestEtapa1Integration) com PostgreSQL 17 em container (migrations up/down/up, bootstrap, limite de 4 membros, senha temporária, lockout após 5 falhas, isolamento 404 + RLS direto no banco com app_rw) | PASS (1.0s) | criar frontend PWA da Etapa 1, CI e docs/instalacao.md |
- 2026-11-23 14:03 | Etapa 1 CONCLUÍDA: frontend React+TS PWA (login, troca de senha obrigatória, seletor de ambiente coletivo/individual), Dockerfile/Nginx, CI (.github/workflows/ci.yml), docs/arquitetura.md, docs/instalacao.md e stack completa validada via docker compose up (db, migrate, api:8080/readyz=200, web:5173=200). Escrito docs/etapa2_plano.md | OK | usuário validar Etapa 1 e decisões E2-D1/E2-D2 da Etapa 2
- 2026-11-23 14:10 | Usuário aprovou E2-D1 e E2-D2; INÍCIO da implementação da Etapa 2 (migration 00002_expenses.sql, queries sqlc, módulo expense, rotas REST, testes de integração com RLS e UI de despesas/categorias/meios de pagamento) | em andamento | criar migration e gerar sqlc |
- 2026-11-23 14:18 | Etapa 2 CONCLUÍDA: migration 00002_expenses.sql (category, payment_method, expense com RLS FORCE e seed de 8 categorias), módulo internal/expense (sqlc, bloqueio de PAN, centavos int64, compartilhamento individual->coletivo), testes unitários e de integração (PASS 1.3s), UI completa no frontend PWA e stack atualizada no Docker Compose. Escrito docs/etapa3_plano.md | OK | usuário validar E3-D1 e E3-D2 da Etapa 3
- 2026-11-23 14:27 | Instalada globalmente a skill documentation-writer (github/awesome-copilot, Diátaxis, blob 93e3fbf); usuário aprovou E3-D1 e E3-D2 como recomendado; INÍCIO da implementação da Etapa 3 | OK | criar ADR 0006, migration 00003_splits_and_settlements.sql, módulos expense/settlement, testes, frontend e docs Diátaxis |
- 2026-11-23 14:38 | Etapa 3 CONCLUÍDA + Documentação Diátaxis: ADR 0006, migration 00003_splits_and_settlements.sql (expense_split, settlement com RLS FORCE), rateio determinístico de centavos (E3-D1), módulo internal/settlement (saldos bilaterais + confirmação de reembolso E3-D2), testes unitários e de integração (PASS 2.1s), UI completa de divisões e reembolsos no frontend PWA, e documentação nos 4 quadrantes Diátaxis (docs/README.md, docs/guias-operacao.md, docs/referencia-api.md). Escrito docs/etapa4_plano.md | OK | usuário validar E4-D1 e E4-D2 da Etapa 4
- 2026-11-23 14:58 | Usuário aprovou E4-D1 e E4-D2 como recomendado; INÍCIO da implementação da Etapa 4 (ADR 0007, migration 00004_installments_and_refunds.sql, parcelamentos e estornos com impacto proporcional nos saldos, testes, UI e documentação) | em andamento | criar ADR 0007 e migration 00004 |
- 2026-11-23 15:11 | Etapa 4 CONCLUÍDA: ADR 0007, migration 00004_installments_and_refunds.sql (closing_day/due_day em cartões, installment_plan, expense_refund, expense_refund_split com RLS FORCE), cronograma de parcelas E4-D1, exclusão individual ou do parcelamento completo E4-D2, estornos proporcionais abatendo saldos coletivos, testes unitários e de integração (PASS 2.3s), UI completa no frontend PWA e docs Diátaxis atualizados. Escrito docs/etapa5_plano.md | OK | usuário validar E5-D1 e E5-D2 da Etapa 5
- 2026-11-23 15:18 | Usuário aprovou E5-D1 e E5-D2; perguntou sobre assinaturas mensais e como visualizar o banco de dados; INÍCIO da implementação da Etapa 5 (ADR 0008, migration 00005_recurring_expenses.sql, módulo recurring/expense, worker + botão, testes e UI) | em andamento | implementar Etapa 5 |
- 2026-11-23 15:30 | Etapa 5 CONCLUÍDA: ADR 0008, migration 00005_recurring_expenses.sql (recurring_rule, recurring_rule_split com RLS FORCE e índice único de idempotência recurring_rule_id+recurring_period), worker periódico + endpoint sob demanda (E5-D1), suporte a assinaturas mensais/anuais e contas variáveis (E5-D2), testes unitários e de integração (PASS 2.2s), UI completa no frontend PWA e guia de inspeção do banco em docs/guias-operacao.md. Escrito docs/etapa6_plano.md | OK | usuário validar E6-D1 e E6-D2 da Etapa 6
- 2026-11-23 15:42 | Usuário aprovou E6-D1 e E6-D2 como recomendado; INÍCIO da implementação da Etapa 6 (ADR 0009, migration 00006_notifications.sql, módulo internal/notification com RLS estrito por destinatário, disparos automáticos em settlement/expense/recurring, testes e UI) | em andamento | implementar Etapa 6 |
- 2026-11-23 15:52 | Etapa 6 CONCLUÍDA: ADR 0009, migration 00006_notifications.sql (tabela notification com RLS estrito por recipient_user_id), módulo internal/notification, disparos automáticos em settlement/expense/recurring (com deduplicação de vencimento próximo em 3 dias, E6-D2), teste de integração com RLS (PASS 2.5s), caixa de entrada + Notification API discreta (E6-D1) no frontend PWA e docs Diátaxis atualizados. Escrito docs/etapa7_plano.md | OK | usuário validar E7-D1 e E7-D2 da Etapa 7
- 2026-11-23 15:57 | Usuário aprovou E7-D1 e E7-D2 como recomendado; INÍCIO da implementação da Etapa 7 (ADR 0010, módulo internal/report com agregações em centavos, exportação CSV anti-injection e gerador PDF 1.4 nativo em Go puro, testes e UI) | em andamento | implementar Etapa 7 |
- 2026-11-23 16:04 | Etapa 7 CONCLUÍDA: ADR 0010, módulo internal/report (resumo em centavos por categoria, meio de pagamento e desembolso vs consumo por membro; exportação CSV UTF-8 BOM com separador ';' e proteção anti-CSV Injection E7-D1; exportação PDF 1.4 nativa em Go puro E7-D2), testes unitários e de integração com RLS (PASS 2.5s), UI de relatórios e download CSV/PDF no frontend PWA e docs Diátaxis atualizados. Escrito docs/etapa8_plano.md | OK | usuário validar E8-D1, E8-D2 e E8-D3 da Etapa 8
- 2026-11-23 16:09 | Usuário aprovou E8-D1, E8-D2 e E8-D3 como recomendado; INÍCIO da implementação da Etapa 8 (ADR 0011, migration 00007_android_imports.sql, módulo internal/bankimport com tokens de dispositivo SHA-256, parser de notificações e fila de revisão com RLS, app Android Kotlin em android/, UI na PWA e testes) | em andamento | implementar Etapa 8 |
- 2026-11-23 16:20 | Etapa 8 CONCLUÍDA: ADR 0011, migration 00007_android_imports.sql (device_token SHA-256 e bank_import_inbox com RLS FORCE por owner_user_id), módulo internal/bankimport (parsers para Nubank/Itaú/Bradesco/BB/Inter/Santander/C6/generic E8-D1, needs_review sem chute E8-D3, mascaramento anti-PAN), app Android Kotlin em android/ (minSdk 26 / targetSdk 35 E8-D2, NotificationListenerService), UI na PWA, testes unitários e de integração (PASS 2.9s) e docs Diátaxis atualizados. Escrito docs/etapa9_plano.md | OK | usuário validar E9-D1 e E9-D2 da Etapa 9
- 2026-11-23 16:31 | Usuário aprovou E9-D1 opção (b) (PaaS gratuito Render/Fly.io + Supabase Free) e E9-D2 opção (a) (backup pg_dump -Fc com retenção de 30 dias e criptografia AES-256 opcional); INÍCIO da implementação da Etapa 9 | em andamento | implementar ADR 0012, TRUSTED_PROXY_CIDRS + COOKIE_SAMESITE, script Supabase roles, render.yaml/fly.toml + docker-compose.prod.yml, scripts backup/restore, CI gitleaks e docs/producao-e-backup.md |
- 2026-11-23 16:39 | Implementados ADR 0012, TRUSTED_PROXY_CIDRS/STATIC_DIR/PORT na API Go, deploy/supabase-init-roles.sql, Dockerfile multi-stage unificado, render.yaml, fly.toml, scripts/backup-db.sh e scripts/restore-db.sh, e CI com gitleaks; iniciando teste de integração completo e teste real de backup criptografado + restore --verify-only | em andamento | rodar testes e escrever docs/producao-e-backup.md |
- 2026-11-23 16:45 | Etapa 9 CONCLUÍDA (Roadmap 1..9 100% finalizado): backup criptografado AES-256 testado (financas_20261123T194154Z.dump.enc + restore-db.sh --verify-only OK com 187 objetos), todos os testes unitários e de integração com RLS passando (PASS 2.6s), docs/producao-e-backup.md escrito e containers Docker Compose atualizados | OK | projeto pronto para uso local e deploy em PaaS + Supabase Free |
- 2026-11-23 16:55 | Salvo roteiro prático de testes para amanhã no CONTEXTO.md; criado README.md na raiz; auditados arquivos contra vazamento de segredos (.env, backups/*.dump.enc, node_modules, dist e *.tsbuildinfo ignorados no .gitignore) e criado commit inicial no Git local (branch main) | OK | conectar repositório remoto privado no GitHub e fazer git push |
- 2026-11-24 13:35 | Criadas as pastas `agents/` e `.agents/` (com `skills/` e `rules/`) na raiz do projeto `/home/gamer/projetos/financas-familia` para início do trabalho com multi-agents | OK | definir os papéis/arquivos dos agentes a pedido do usuário |
- 2026-11-24 13:43 | Configurado o subagent `software-architect` em `agents/software-architect.md` e `.agents/agents/software-architect.md` com frontmatter compatível com o Antigravity (`name`, `description`, `subagent: true`, `mainAgent: false`, `tools`) | OK | aguardar o próximo agente a ser configurado pelo usuário |
- 2026-11-24 13:50 | Configurado o subagent `reality-checker` em `agents/reality-checker.md` e `.agents/agents/reality-checker.md` com frontmatter compatível com o Antigravity (`name: reality-checker`, `subagent: true`, `mainAgent: false`, `tools`) | OK | aguardar o próximo agente a ser configurado pelo usuário |
- 2026-11-24 13:55 | Configurado o 3º subagent `devsecops-mentor` (somente leitura/execução, sem ferramentas de edição para guiar o usuário sem escrever por ele) em `agents/devsecops-mentor.md` e `.agents/agents/devsecops-mentor.md` | OK | time inicial de 3 subagents pronto (`software-architect`, `reality-checker`, `devsecops-mentor`) |
- 2026-11-24 15:04 | Acionado o subagent `software-architect` para validar a estrutura atual do projeto e do código frente às convenções e ao modelo de negócio | concluído | relatório arquitetural entregue (modelo de domínio e RLS aprovados; 4 recomendações pragmáticas e 2 correções no roteiro de testes do CONTEXTO.md identificadas) |
- 2026-11-24 15:15 | Aplicadas as correções arquiteturais recomendadas pelo `software-architect`: (1) aprovação atômica da fila Android em transação única via `expense.Service.CreateTx` + `FOR UPDATE` em `GetMyBankImport`; (2) filtros de período/categoria em `ListWorkspaceExpenseSplits` e `MaxRows` parametrizável (`5000` em relatórios); (3) emissão de alertas de recorrência de 3 dias também no `StartRecurringWorker`; (4) timeout de 35s + 2 tentativas no `ApiClient.kt` (Android) para suportar cold start em PaaS Free; (5) roteiro prático de comandos corrigido neste `CONTEXTO.md`. `sqlc generate`, `go vet` e testes unitários OK | OK | commitar e configurar repositório remoto no GitHub |
- 2026-11-24 15:25 | Commit `5a6eaab` criado com os 3 subagents (`software-architect`, `reality-checker`, `devsecops-mentor`) e as melhorias arquiteturais; configurado remote `origin` (`https://github.com/jvpinheiro1/finances.git`) e realizado `git push -u origin main` com sucesso | OK | repositório sincronizado no GitHub |
- 2026-11-24 15:30 | Reestruturado o repositório para o Padrão 1 de mercado (*Go-First layout*: `cmd/`, `internal/`, `migrations/`, `queries/`, `go.mod`, `sqlc.yaml` na raiz; `web/` para a PWA React/TS; `android/` para o app Kotlin; `deploy/`, `scripts/`, `docs/`) e removidas do repositório todas as pastas de agentes (`agents/` e `.agents/`), mantendo apenas o código do sistema | OK | validar `go test` na raiz e atualizar GitHub (`git push`) |
- 2026-11-24 15:36 | Acionado o subagent `reality-checker` para validar o funcionamento real do sistema (builds Go e Web, testes unitários e de integração com RLS, endpoints HTTP e auditoria de especificação vs. implementação após a reestruturação de pastas) | concluído (`Status: NEEDS WORK`, Nota: `B`) | builds Go/Web, `go vet`, `bash -n` e 16 testes unitários PASS; prompt de permissão fora do sandbox para `TestEtapa1Integration`/Docker expirou após 60s (bloqueio registrado); identificadas discrepâncias na documentação (`EncryptedSharedPreferences` no README.md, comandos `-C backend` e `DATABASE_URL` vs `MIGRATE_DATABASE_URL` em `docs/producao-e-backup.md`, caminhos `backend/`/`frontend/` em `docs/instalacao.md` e `docs/arquitetura.md`, e senha `>= 12 caracteres` no roteiro) |
- 2026-11-24 15:56 | Corrigidas todas as discrepâncias apontadas pelo `reality-checker` (`README.md`, `docs/producao-e-backup.md`, `docs/instalacao.md`, `docs/arquitetura.md`, `render.yaml`, ADRs 0001/0005/0012 e `docs/CONTEXTO.md`) e executado o teste de integração ponta a ponta `TestEtapa1Integration` (Etapas 1 a 9 + RLS no PostgreSQL 17 real, incluindo aprovação atômica da fila Android via `CreateTx` + `FOR UPDATE`) | PASS (3.05s, 0 falhas) | commitar e fazer `git push` para o GitHub |
