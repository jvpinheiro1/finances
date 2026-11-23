# ADR 0002: Valores monetários em centavos (inteiros)

- Status: aceito
- Data: 2026-11-23

## Contexto
Ponto flutuante gera erros de arredondamento (0,1 + 0,2 ≠ 0,3). Divisões de despesas precisam somar exatamente o total.

## Decisão
- Banco: `BIGINT` em centavos. Go: `int64`. JSON: inteiro em centavos (ex.: `{"amount_cents": 12345}`).
- Somente BRL na primeira versão (sem coluna de moeda).
- Proibido `float32/float64` e `NUMERIC` com casas decimais para dinheiro.
- O rateio de centavos que sobram na divisão será determinístico (regra definida na Etapa 3).

## Alternativa considerada
`NUMERIC(14,2)`: correto no banco, mas no Go exigiria biblioteca decimal e conversões. Rejeitado pela simplicidade dos inteiros.
