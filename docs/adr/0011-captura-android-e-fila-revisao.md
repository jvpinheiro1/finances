# ADR 0011: Captura de notificações bancárias no Android, parser versionado e fila de revisão privada

- Status: aceito (decisões E8-D1, E8-D2 e E8-D3 aprovadas pelo usuário em 2026-11-23)
- Data: 2026-11-23

## Contexto
Para reduzir o trabalho manual de digitação de gastos do dia a dia sem usar Open Finance nem integrações bancárias pagas, um app Android nativo em Kotlin captura as notificações exibidas pelos aplicativos bancários do familiar e envia para o backend. É obrigatório preservar a privacidade individual (nenhum outro membro pode ver as notificações capturadas no celular de outro familiar), nunca registrar conteúdo de notificações em logs, nunca guardar PAN de cartão e nunca inventar/"chutar" valores quando o banco alterar o texto da notificação.

## Decisão
1. **Autenticação por Token de Dispositivo (`device_token`)**:
   - Cada familiar gera um token aleatório de 256 bits (`ff_dev_<base64url>`) na PWA para o seu celular.
   - O banco armazena apenas o **SHA-256** (`token_hash`) e permite revogação imediata (`revoked_at`).
   - A rota `POST /api/v1/ingest/bank-notification` autentica via `Authorization: Bearer <token>` (sem exigir cookie nem header de navegador), identifica o usuário dono do dispositivo e abre a transação com `WithUserTx(ctx, pool, ownerUserID, ...)` para respeitar o RLS.
2. **Bancos suportados e Parser Versionado (E8-D1 e E8-D3)**:
   - Mapeamento de pacotes e parsers dedicados para **Nubank, Itaú, Bradesco, Banco do Brasil, Inter, Santander e C6 Bank**, além de fallback genérico em português (`generic`).
   - O parser extrai valor em centavos (`R$ 1.234,56` → `123456`), meio (`pix`, `credit_card`, `debit`, `transfer`), 4 últimos dígitos opcionais (`final 1234`), número de parcelas (`em 3x`) e estabelecimento/título.
   - Qualquer sequência de 12 a 19 dígitos no texto é mascarada preventivamente (`MaskCardPAN`) antes de persistir, e **nenhum conteúdo da notificação é escrito em logs**.
   - Se o valor em reais não puder ser extraído com certeza (**E8-D3**), o item é gravado com `parse_status = 'needs_review'` e `parsed_amount_cents = NULL` para o usuário informar o valor na revisão manual.
3. **Isolamento estrito da fila (`bank_import_inbox`) e aprovação**:
   - `FORCE ROW LEVEL SECURITY` em `bank_import_inbox` com `owner_user_id = app_current_user_id()`.
   - Na aprovação (`POST /api/v1/imports/{id}/approve`), o usuário escolhe o ambiente de destino (padrão: seu **Meu Espaço Individual Privado**) e a categoria, criando a despesa (`expense.Service.Create`) e vinculando `approved_expense_id`.
4. **App Android Kotlin (`android/`, E8-D2)**:
   - `minSdk = 26` (Android 8.0+) e `targetSdk = 35` (Android 15), com `NotificationListenerService`, filtro de pacotes bancários autorizados, geração de `dedup_hash` SHA-256 e envio HTTPS.

## Consequências
- Captura automatizada sem custo e sem expor credenciais bancárias.
- Nenhum lançamento entra no ambiente coletivo da família sem aprovação explícita do dono do celular.
