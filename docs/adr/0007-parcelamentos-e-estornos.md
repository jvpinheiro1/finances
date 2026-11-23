# ADR 0007: Materialização de parcelamentos e estornos proporcionais em centavos

- Status: aceito (decisões E4-D1 e E4-D2 aprovadas pelo usuário em 2026-11-23)
- Data: 2026-11-23

## Contexto
Compras parceladas no cartão (2x a 48x) precisam preservar o total exato em centavos, aparecer no filtro de cada mês de competência e respeitar o fechamento opcional do cartão. Além disso, estornos parciais ou totais precisam reduzir o gasto líquido do período e abater proporcionalmente as dívidas entre familiares quando a despesa for coletiva.

## Decisão
1. **Materialização das parcelas**:
   - Quando uma despesa é lançada com `total_installments = N` ($2 \le N \le 48$), criamos um registro em `installment_plan` e materializamos as $N$ parcelas na tabela `expense` dentro da mesma transação.
   - **Conservação de centavos**: cada parcela recebe $\lfloor T / N \rfloor$ centavos, e a **1ª parcela** recebe o resto $R = T \bmod N$ ($\lfloor T / N \rfloor + R$). Assim, $\sum_{k=1}^{N} \text{parcela}_k = T$.
   - Cada parcela coletiva tem suas próprias linhas em `expense_split` calculadas por `ComputeSplits` (ADR 0006).
2. **Datas das parcelas e fechamento do cartão (E4-D1)**:
   - Cartões de crédito (`payment_method.kind = 'credit_card'`) aceitam opcionalmente `closing_day` (`1..31`) e `due_day` (`1..31`).
   - Se o cartão tiver `closing_day` definido e o dia da compra for `>= closing_day`, a data de competência da 1ª parcela avança 1 mês (`AddMonthsClamped(incurred_on, 1)`); caso contrário, a 1ª parcela permanece na data da compra.
   - A parcela $k$ ($1 \dots N$) recebe a data `AddMonthsClamped(data_parcela_1, k - 1)`, mantendo o dia do mês e ajustando para o último dia válido em meses mais curtos (ex.: 31/01 + 1 mês → 28/02 ou 29/02).
3. **Exclusão de parcelamentos (E4-D2)**:
   - O usuário pode excluir uma parcela individual (`DELETE /api/v1/expenses/{id}`) ou excluir todas as parcelas do plano de uma só vez (`DELETE /api/v1/installment-plans/{planId}`).
4. **Estornos (`expense_refund` e `expense_refund_split`)**:
   - Um estorno registra `amount_cents > 0` em `expense_refund` e incrementa `expense.refunded_cents`, garantindo `refunded_cents <= expense.amount_cents` sob lock transacional (`FOR UPDATE`).
   - Na listagem de despesas (`GET /api/v1/workspaces/{wsId}/expenses`), `total_cents` soma o gasto líquido de cada lançamento (`amount_cents - refunded_cents`).
   - Se a despesa for coletiva, o valor estornado é distribuído em `expense_refund_split` na mesma proporção das cotas originais da despesa (`expense_split.share_cents`) usando a regra determinística do ADR 0006, abatendo automaticamente o saldo devedor em `GET /api/v1/balances`.

## Consequências
- Consultas mensais, filtros e relatórios continuam simples e rápidos (sem projeções virtuais em tempo de leitura).
- Estornos preservam o histórico contábil da despesa original e mantêm os saldos da família consistentes ao centavo.
