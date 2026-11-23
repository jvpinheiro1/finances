# Guias de Operação e Uso Diário (How-To Guides)

Estes guias mostram como executar tarefas específicas de administração e uso financeiro no dia a dia da família.

---

## 1. Como redefinir a senha de um familiar que esqueceu ou bloqueou a conta

Se um membro errar a senha 5 vezes seguidas (bloqueio temporário) ou esquecer a senha:

1. No terminal do servidor onde roda o Docker Compose, carregue o `.env` e execute `user reset-password`:
   ```bash
   set -a && . deploy/.env && set +a
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec \
     -e MIGRATE_DATABASE_URL="postgres://app_owner:${APP_OWNER_PASSWORD}@db:5432/${APP_DB_NAME}?sslmode=disable" \
     api /app/admin user reset-password --email "familiar@casa.local"
   ```
2. O comando revoga imediatamente todas as sessões ativas daquele membro, remove o bloqueio e imprime uma **nova senha temporária** (exibida uma única vez).
3. Entregue a senha temporária pessoalmente ao familiar. No próximo login, o sistema exigirá que ele defina uma nova senha pessoal (mínimo de 12 caracteres).

---

## 2. Como lançar um gasto pessoal privado e depois compartilhá-lo com a casa

1. No topo da aplicação web (`http://localhost:5173`), selecione a aba **Meu Espaço Individual (Privado)**.
2. Preencha descrição, valor em reais, data e categoria e clique em **Registrar despesa**.
   - Enquanto estiver no seu espaço individual, **nenhum outro membro da residência** consegue ver essa despesa, e ela não entra no cálculo de saldos da família.
3. Se decidir que essa despesa deve ser dividida com a família, clique no botão **Compartilhar com a casa** ao lado da despesa.
   - A despesa é movida para o **Espaço da Família (Coletivo)** com divisão igualitária inicial entre os membros ativos (você pode clicar em **Editar** na aba coletiva para ajustar quem participa da divisão).

---

## 3. Como dividir uma despesa coletiva e acertar o saldo por reembolso

1. Selecione a aba **Espaço da Família (Coletivo)**.
2. No formulário de lançamento, escolha **Pago por** (quem desembolsou o valor) e a estratégia em **Divisão entre familiares**:
   - **Partes iguais**: marque os checkboxes dos familiares que participam. Se a divisão deixar centavos de resto (ex.: R$ 100,00 ÷ 3), quem pagou absorve o centavo extra de forma determinística ([ADR 0006](adr/0006-divisoes-deterministicas-e-reembolsos.md)).
   - **Valor exato em R$**: digite o valor de cada participante (a soma deve bater com o total).
   - **Porcentagem (%)**: digite o percentual de cada participante (a soma deve ser `100%`).
   - **Cotas / Pesos**: digite o peso inteiro de cada participante (ex.: `2` e `1`).
3. No painel **Saldos e Reembolsos da Família**, veja a lista **Quem deve para quem**:
   - Clique em **Registrar pagamento** ao lado da dívida (ou preencha o formulário de reembolso).
   - **Se quem registrou foi o devedor** (quem pagou o reembolso): o registro nasce com status **Aguardando confirmação do recebedor**, e o saldo só é abatido depois que o credor clicar em **Confirmar recebimento**.
   - **Se quem registrou foi o próprio credor** (quem recebeu o dinheiro): o registro já nasce **Confirmado** e abate o saldo imediatamente.

---

## 4. Como inspecionar o banco de dados PostgreSQL (Terminal ou Cliente Gráfico)

O PostgreSQL 17 roda no container `financas-familia-db-1` e expõe a porta **`127.0.0.1:5433`** apenas para a sua máquina local.

### Opção A — Pelo terminal (usando o `psql` de dentro do container)

A partir da pasta `/home/gamer/projetos/financas-familia`:

```bash
docker exec -it financas-familia-db-1 psql -U app_owner -d financas
```

Comandos úteis dentro do `psql`:
- `\dt` — lista todas as tabelas (`household`, `app_user`, `workspace`, `category`, `payment_method`, `installment_plan`, `expense`, `expense_split`, `expense_refund`, `expense_refund_split`, `recurring_rule`, `recurring_rule_split`, `settlement`, `session`, `audit_log`);
- `SELECT id, name, email, status FROM app_user;` — lista os usuários cadastrados;
- `SELECT id, kind, owner_user_id FROM workspace;` — lista os ambientes coletivo e individuais;
- `\q` — sai do `psql`.

### Opção B — Por cliente gráfico (DBeaver, Beekeeper Studio, TablePlus ou extensão do VS Code)

1. Descubra a senha gerada para o papel `app_owner` no seu arquivo local `deploy/.env`:
   ```bash
   grep APP_OWNER_PASSWORD /home/gamer/projetos/financas-familia/deploy/.env
   ```
2. Configure a conexão no seu cliente gráfico com:
   - **Host**: `127.0.0.1` (ou `localhost`)
   - **Port**: `5433`
   - **Database**: `financas`
   - **User**: `app_owner`
   - **Password**: *(o valor de `APP_OWNER_PASSWORD`)*
   - **SSL Mode**: `Disable` (conexão local)

> **Nota sobre o RLS (`app_owner` vs `app_rw`)**: Conectando como `app_owner` você enxerga todas as linhas do banco. Se conectar como `app_rw` (o papel de privilégio mínimo usado pela API), as tabelas protegidas por `FORCE ROW LEVEL SECURITY` retornarão 0 linhas até que você defina um usuário na sessão com `SELECT set_config('app.user_id', '<uuid-do-usuario>', false);`.
