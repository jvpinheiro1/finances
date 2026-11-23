# ADR 0006: Rateio determinístico de centavos em divisões e confirmação de reembolsos

- Status: aceito (decisões E3-D1 e E3-D2 aprovadas pelo usuário em 2026-11-23)
- Data: 2026-11-23

## Contexto
Em despesas coletivas, o valor em centavos (`amount_cents`) é dividido entre 1 a 4 membros da residência. Divisões igualitárias (`equal`), por porcentagem em pontos-base (`percentage`, onde `10000` bps = 100,00%) ou por cotas (`shares`) frequentemente deixam resto inteiro (ex.: `10000` centavos ÷ 3 = `3333` com resto `1`). Além disso, pagamentos de reembolso entre familiares precisam evitar abatimentos unilaterais indevidos pelo devedor.

## Decisão
1. **Invariante de conservação de centavos**:
   - Para toda despesa no ambiente coletivo (`workspace.kind = 'household'`), a soma das cotas gravadas em `expense_split.share_cents` é **sempre idêntica** a `expense.amount_cents`.
   - Despesas no ambiente individual (`workspace.kind = 'personal'`) não possuem linhas em `expense_split` e nunca entram no cálculo de saldos da casa. Ao serem compartilhadas com a casa (`share-with-household`), recebem automaticamente uma divisão igualitária entre todos os membros ativos da residência (editável em seguida).
2. **Rateio determinístico do resto (E3-D1)**:
   - Dado o total $T$ em centavos e pesos inteiros positivos $w_1, \dots, w_k$ com $W = \sum w_i$:
     - Cota base de cada participante: $s_i = \lfloor (T \times w_i) / W \rfloor$;
     - Resto: $R = T - \sum s_i$ (onde $0 \le R < k$);
     - Os participantes são ordenados colocando **primeiro quem pagou a despesa** (`paid_by_user_id`, caso faça parte da divisão) e os demais em **ordem crescente de `user_id` (UUID textual)**. Os primeiros $R$ participantes dessa ordem recebem `+1` centavo.
   - Em divisão por valor exato (`exact`), os valores `share_cents` enviados pelo cliente devem somar exatamente $T$; caso contrário a API responde HTTP 422.
3. **Fluxo de confirmação de reembolso (E3-D2)**:
   - Um reembolso (`settlement`) registra uma transferência de `from_user_id` (devedor) para `to_user_id` (credor) no valor `amount_cents > 0`.
   - Só pode ser criado pelo próprio devedor (`from_user_id`) ou pelo próprio credor (`to_user_id`):
     - Se criado pelo **credor** (`actor == to_user_id`), já nasce com `status = 'confirmed'` (o próprio recebedor atestou o recebimento).
     - Se criado pelo **devedor** (`actor == from_user_id`), nasce com `status = 'pending'`. Somente o **credor** (`to_user_id`) pode confirmar (`status = 'confirmed'`) ou rejeitar (`status = 'rejected'`).
   - Apenas reembolsos com `status = 'confirmed'` abatem o saldo devedor no cálculo de saldos da família.

## Consequências
- Nenhum centavo é criado ou perdido em arredondamentos, e o resultado da divisão é 100% reproduzível em testes.
- O credor tem garantia de que uma dívida não será dada como quitada sem sua confirmação.
