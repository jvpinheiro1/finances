# ADR 0010: Relatórios em centavos e exportação CSV (anti-injection) e PDF nativo em Go

- Status: aceito (decisões E7-D1 e E7-D2 aprovadas pelo usuário em 2026-11-23)
- Data: 2026-11-23

## Contexto
Os familiares precisam visualizar o resumo de gastos por período, categoria, meio de pagamento e membro (desembolso vs consumo na divisão coletiva) e exportar os dados em CSV e PDF para controle pessoal ou arquivamento, sem violar o isolamento entre ambientes e sem introduzir dependências pesadas (como navegadores headless) ou riscos de CSV Formula Injection.

## Decisão
1. **Agregação 100% em centavos (`int64`) sobre o valor líquido**:
   - O módulo `internal/report` consome os serviços públicos de `expense`, `workspace` e `household` (respeitando `workspace.CanAccess` e `FORCE ROW LEVEL SECURITY`).
   - Cada lançamento contribui com seu valor líquido `net_amount_cents = amount_cents - refunded_cents`.
   - No ambiente coletivo, o consumo líquido de cada participante numa despesa com estorno parcial é calculado com `expense.ComputeRefundSplits(exp.NetAmountCents, exp.PaidByUserID, exp.Splits)`, garantindo que a soma do consumo líquido de todos os membros seja sempre idêntica a `total_net_cents`.
2. **Formato CSV pt-BR e proteção contra CSV Formula Injection (E7-D1)**:
   - Codificação UTF-8 com BOM (`\xEF\xBB\xBF`) e delimitador `;` para abertura direta no Excel, LibreOffice Calc e Google Sheets em português.
   - Qualquer célula textual que comece com `=`, `+`, `-`, `@`, `\t` ou `\r` recebe o prefixo `'` (`SanitizeCSVCell`), neutralizando execução de fórmulas em planilhas (OWASP CSV Injection).
3. **Gerador PDF 1.4 nativo em Go puro (E7-D2)**:
   - Implementado em `internal/report/pdf.go` usando apenas a biblioteca padrão do Go, emitindo um documento PDF 1.4 válido (`%PDF-1.4`, fonte padrão `Helvetica` com `/WinAnsiEncoding` para acentuação pt-BR em CP1252/ISO-8859-1, paginação automática e tabela `xref` exata).
   - Não requer Chromium, wkhtmltopdf nem bibliotecas externas.

## Consequências
- Exportações rápidas, leves (poucos kilobytes de memória) e seguras contra injeção de fórmulas.
