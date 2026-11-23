# ADR 0009: Notificações internas com RLS por destinatário e privacidade na PWA

- Status: aceito (decisões E6-D1 e E6-D2 aprovadas pelo usuário em 2026-11-23)
- Data: 2026-11-23

## Contexto
Os 4 membros da residência precisam ser avisados quando:
1. um devedor registra um reembolso aguardando confirmação do credor (`settlement_pending`);
2. o credor confirma ou recusa o reembolso (`settlement_confirmed` / `settlement_rejected`);
3. uma despesa coletiva é lançada ou compartilhada com a casa envolvendo o membro na divisão (`collective_expense_added`);
4. uma assinatura ou conta recorrente (coletiva ou individual) está a até 3 dias do vencimento (`recurring_due_soon`, **E6-D2**).

Ao mesmo tempo, um membro **nunca** pode ver notificações destinadas a outro membro (pois elas incluem alertas de assinaturas/contas individuais privadas daquele membro), e notificações do navegador não podem vazar valores financeiros na tela de bloqueio (**E6-D1**).

## Decisão
1. **RLS estrito por destinatário na tabela `notification`**:
   - `ENABLE` + `FORCE ROW LEVEL SECURITY` na tabela `notification`;
   - Políticas `SELECT` e `UPDATE` para `app_rw`: `household_id = app_current_household_id() AND recipient_user_id = app_current_user_id()`;
   - Política `INSERT` para `app_rw`: `household_id = app_current_household_id()` (permite que a transação do membro A grave uma notificação para o membro B quando A registra um reembolso ou uma despesa coletiva com B).
2. **Deduplicação de alertas de vencimento (E6-D2)**:
   - Coluna opcional `dedup_key text` com índice único parcial `UNIQUE (recipient_user_id, dedup_key) WHERE dedup_key IS NOT NULL` e `ON CONFLICT DO NOTHING`.
   - Para alertas de vencimento próximo (até 3 dias antes de `next_due_date`), `dedup_key = 'recurring_due:' || rule_id || ':' || period_key`, garantindo no máximo 1 alerta por ciclo para cada destinatário.
3. **Privacidade no alerta local do navegador (E6-D1)**:
   - A PWA exibe a caixa de entrada completa dentro da sessão autenticada e oferece ativação opcional da Notification API do navegador (`Notification.requestPermission()`).
   - Quando o contador de não lidas aumenta, o banner do sistema operacional exibe apenas texto genérico (*"Você tem uma nova atualização no Finanças Família"*), sem valores em reais nem descrições.

## Consequências
- Isolamento garantido no banco: nenhuma consulta de Membro A enxerga notificações de Membro B.
- Zero dependência de serviços pagos ou servidores Web Push externos.
