# Plano da Etapa 7: Relatórios Mensais e Exportação CSV / PDF

> [!IMPORTANT]
> Seguindo as regras do projeto, este documento apresenta os requisitos, regras de negócio, impactos arquiteturais, riscos de segurança, critérios de aceite e decisões em aberto da **Etapa 7** para sua validação antes da implementação.

## 1. Requisitos cobertos na Etapa 7

- **RF11 (Relatórios financeiros por período, categoria, meio de pagamento e membro)**:
  - Relatório consolidado de um ambiente (`workspace_id`, coletivo da casa ou individual do usuário) em um período (`from` e `to`, padrão: mês atual);
  - Quebra exata em centavos (`int64`) por:
    1. **Categoria** (`total_net_cents`, quantidade de lançamentos e percentual em pontos-base `share_bps`);
    2. **Meio de pagamento** (`total_net_cents` e quantidade);
    3. **Membro pagador e membro participante** (no ambiente coletivo: quanto cada familiar desembolsou `paid_net_cents` vs quanto consumiu na divisão `consumed_share_cents`);
- **RF12 (Exportação em CSV e PDF)**:
  - Exportação dos lançamentos e do resumo do período em **CSV** (compatível com Excel/LibreOffice/Google Sheets) e **PDF** (relatório formatado para impressão ou arquivamento familiar).
- **RNF01 / RNF02**:
  - Todo relatório respeita estritamente `workspace.CanAccess` + `FORCE ROW LEVEL SECURITY`: o relatório do ambiente individual inclui apenas os gastos do próprio usuário (`404` para qualquer outro membro), e o relatório do ambiente coletivo inclui apenas os gastos compartilhados da casa.

---

## 2. Regras de negócio da Etapa 7

1. **Valores líquidos em centavos**:
   - Todas as agregações consideram o valor líquido de cada lançamento (`net_amount_cents = amount_cents - refunded_cents`).
   - No ambiente coletivo, o consumo por membro (`consumed_share_cents`) é a soma de `expense_split.share_cents - COALESCE(expense_refund_split.share_cents, 0)`.
2. **Proteção contra CSV Formula Injection (CSV Injection / OWASP)**:
   - Campos textuais exportados no CSV (`description`, `category_name`, `payment_method_name`, `notes`) que comecem com `=`, `+`, `-`, `@`, `\t` ou `\r` recebem prefixo de escape (`'`) antes de serem gravados no CSV, impedindo execução de fórmulas maliciosas ao abrir em planilhas.
3. **Geração de CSV e PDF sem serviços pagos nem dependências externas pesadas**:
   - O CSV é gerado diretamente pela stdlib do Go (`encoding/csv`).
   - Para o PDF, apresento as alternativas em **E7-D2** abaixo.

---

## 3. Rotas REST propostas para a Etapa 7

- `GET /api/v1/workspaces/{wsId}/reports/summary?from=AAAA-MM-DD&to=AAAA-MM-DD`
  - Retorna JSON com `total_gross_cents`, `total_refunded_cents`, `total_net_cents`, `expense_count`, `by_category`, `by_payment_method` e (quando coletivo) `by_member`.
- `GET /api/v1/workspaces/{wsId}/reports/export.csv?from=AAAA-MM-DD&to=AAAA-MM-DD`
  - Retorna `text/csv; charset=utf-8` (com BOM UTF-8 opcional para abrir acentos direto no Excel) e `Content-Disposition: attachment; filename="relatorio-....csv"`.
- `GET /api/v1/workspaces/{wsId}/reports/export.pdf?from=AAAA-MM-DD&to=AAAA-MM-DD`
  - Retorna `application/pdf` com o cabeçalho do ambiente/período, resumo por categoria/membro e tabela de lançamentos.

---

## 4. Riscos de segurança e mitigação

| Risco | Mitigação |
|---|---|
| CSV Injection (fórmula `=CMD(...)` na descrição/notas) | Sanitização obrigatória prefixando `'` em células textuais que iniciem com `=`, `+`, `-`, `@`, `\t`, `\r` + teste unitário específico |
| Vazamento de despesas individuais em relatório coletivo ou vice-versa | Todas as queries filtram `workspace_id = @workspace_id` dentro de `WithUserTx` com RLS `FORCE` + retorno 404 para workspace alheio |
| DoS por período excessivamente longo | Limite de intervalo máximo por consulta/exportação (ex.: até 366 dias / 1 ano por relatório) |

---

## 5. Critérios de aceite da Etapa 7

1. `GET /api/v1/workspaces/{wsId}/reports/summary` devolve as somas exatas em centavos por categoria, por meio de pagamento e por membro, batendo com `total_net_cents`.
2. Membro A tentando acessar o resumo, CSV ou PDF do ambiente individual de Membro B recebe **404**.
3. `export.csv` retorna arquivo CSV válido com cabeçalho em português e neutraliza tentativas de CSV Injection (`=1+1` vira `'=1+1`).
4. `export.pdf` retorna arquivo PDF válido (`%PDF-1.4`) com o resumo e os lançamentos do período.
5. Frontend PWA exibe o painel **"Relatórios e Exportação (CSV / PDF)"** com barras visuais de distribuição por categoria, tabela de desembolso vs consumo por membro (no coletivo) e botões de download de CSV e PDF.

---

## 6. Decisões da Etapa 7 para sua validação ❓

| # | Decisão | Opções |
|---|---|---|
| **E7-D1** | **Formato do CSV para planilhas em pt-BR (Excel / LibreOffice / Google Sheets)** | **(a) Recomendado:** UTF-8 com BOM (`\uFEFF`, para o Excel no Windows reconhecer acentos automaticamente), separador `;` (padrão de planilhas em pt-BR) e coluna de valor tanto em centavos inteiros (`valor_liquido_centavos`) quanto formatada em reais (`valor_liquido_brl`, ex.: `120,00`).<br>**(b)** Separador `,` (padrão inglês) sem BOM. |
| **E7-D2** | **Geração do PDF** | **(a) Recomendado:** Gerar o PDF diretamente no backend Go (`GET /api/v1/workspaces/{wsId}/reports/export.pdf`) usando gerador PDF nativo em Go puro (sem Chromium/wkhtmltopdf e sem bibliotecas pagas), funcionando em qualquer dispositivo.<br>**(b)** Apenas impressão/PDF via `window.print()` do navegador. |
