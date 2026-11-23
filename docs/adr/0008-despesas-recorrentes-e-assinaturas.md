# ADR 0008: Despesas recorrentes e assinaturas com geração idempotente

- Status: aceito (decisões E5-D1 e E5-D2 aprovadas pelo usuário em 2026-11-23)
- Data: 2026-11-23

## Contexto
Contas fixas/variáveis (aluguel, luz, água, internet) e assinaturas mensais/anuais (streaming, música, nuvem, academia) repetem-se periodicamente tanto no espaço coletivo da casa quanto no espaço individual privado de cada familiar. O sistema precisa lançá-las sem risco de duplicação e permitir que contas de valor variável sejam ajustadas no mês em que a fatura chega.

## Decisão
1. **Modelagem (`recurring_rule` e `recurring_rule_split`)**:
   - Cada regra pertence a um `workspace_id` (coletivo ou individual), com `frequency ∈ {'monthly', 'weekly', 'yearly'}`, `amount_cents > 0` (valor fixo da assinatura ou valor estimado da conta), `start_date`, `next_due_date`, `end_date` opcional e `is_active`.
   - Quando coletiva, a regra guarda sua estratégia de divisão (`split_strategy`) e os participantes/pesos em `recurring_rule_split`.
2. **Idempotência no banco (`recurring_rule_id` + `recurring_period`)**:
   - Cada despesa gerada recebe `recurring_rule_id` e a chave canônica do ciclo `recurring_period`:
     - mensal (`monthly`): `'AAAA-MM'` (ex.: `'2026-11'`);
     - anual (`yearly`): `'AAAA'` (ex.: `'2026'`);
     - semanal (`weekly`): `'AAAA-MM-DD'` (data de vencimento daquela semana).
   - O índice único parcial `UNIQUE (recurring_rule_id, recurring_period) WHERE recurring_rule_id IS NOT NULL` garante que o mesmo ciclo nunca seja lançado duas vezes.
3. **Geração automática + sob demanda (E5-D1) respeitando RLS**:
   - Um worker periódico no backend percorre os usuários ativos executando a materialização dentro de `WithUserTx` (mantendo `FORCE ROW LEVEL SECURITY` ativo sem privilégio extra para `app_rw`) para todas as regras ativas com `next_due_date <= hoje`.
   - O usuário também pode acionar `POST /api/v1/workspaces/{wsId}/recurring-rules/generate` na interface para materializar imediatamente as recorrências até o fim do mês atual (ou até uma data informada, limitado a no máximo 12 ciclos por chamada).
4. **Ajuste de valor em contas variáveis (E5-D2)**:
   - A ocorrência materializada é um registro normal em `expense`; se a conta daquele mês vier com valor diferente (ex.: conta de energia), o usuário edita normalmente aquele lançamento sem afetar os meses anteriores nem o valor base da regra.

## Consequências
- Assinaturas mensais e contas fixas entram automaticamente no controle financeiro e no cálculo de saldos da casa.
- Pausar (`is_active = false`) ou excluir uma assinatura interrompe apenas os ciclos futuros, preservando todo o histórico passado.
