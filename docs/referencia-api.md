# Referência Técnica — API REST (`/api/v1`) e CLI Admin

## Convenções Gerais da API

- **Autenticação**: cookie `ff_session` (`HttpOnly`, `SameSite=Lax`). Rotas protegidas sem sessão retornam `401 Unauthorized`.
- **Proteção CSRF**: todos os métodos de escrita (`POST`, `PATCH`, `DELETE`) exigem o cabeçalho `X-Requested-With: 1` e, quando presente, `Origin` contido em `ALLOWED_ORIGINS`. Caso contrário retornam `403 Forbidden` (`csrf_rejected`).
- **Valores monetários**: sempre inteiros em **centavos** de BRL (`amount_cents`, `share_cents`, `total_cents`, `net_cents`). Nunca envie nem espere números de ponto flutuante ([ADR 0002](adr/0002-dinheiro-em-centavos.md)).
- **Isolamento de recursos**: qualquer tentativa de acessar um ambiente ou despesa individual de outro membro retorna `404 Not Found` (`not_found`), protegido em camada dupla por `workspace.CanAccess` e `FORCE ROW LEVEL SECURITY` no PostgreSQL ([ADR 0004](adr/0004-ambientes-e-rls.md)).
- **Formato padrão de erro**:
  ```json
  {
    "error": {
      "code": "validation_error",
      "message": "Mensagem legível explicando a falha"
    }
  }
  ```

---

## Endpoints REST

### Saúde
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/healthz` | Pública | Liveness do processo HTTP (`{"status":"ok"}`) |
| `GET` | `/readyz` | Pública | Readiness com ping ao PostgreSQL (`200` ou `503`) |

### Autenticação e Sessão (`internal/identity`)
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | Pública (rate limit por IP + lockout por conta) | Valida `email` e `password`, emite cookie `ff_session` |
| `POST` | `/api/v1/auth/logout` | Sessão (`RequireSession`) | Revoga a sessão atual no banco e limpa o cookie |
| `GET` | `/api/v1/auth/me` | Sessão (`RequireSession`) | Retorna o usuário atual (`must_change_password` indica troca pendente) |
| `POST` | `/api/v1/auth/password` | Sessão (`RequireSession`) | Troca a senha (`current_password`, `new_password` >= 12 chars) e revoga as demais sessões |

### Residência e Ambientes (`internal/household`, `internal/workspace`)
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/household` | `RequireUser` | Dados da residência e lista de membros ativos (`id`, `name`, sem e-mail de terceiros) |
| `GET` | `/api/v1/workspaces` | `RequireUser` | Lista os 2 ambientes acessíveis: coletivo (`household`) e individual do usuário (`personal`) |
| `GET` | `/api/v1/workspaces/{id}` | `RequireUser` | Detalhe do ambiente (`404` se pertencer a outro membro) |

### Categorias, Meios de Pagamento e Despesas (`internal/expense`)
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/categories` | `RequireUser` | Lista categorias da residência (`?include_archived=true` opcional) |
| `POST` | `/api/v1/categories` | `RequireUser` | Cria categoria (`{"name": "..."}`) |
| `PATCH` | `/api/v1/categories/{id}` | `RequireUser` | Renomeia ou arquiva categoria (`{"name": "...", "is_archived": false}`) |
| `GET` | `/api/v1/payment-methods` | `RequireUser` | Lista meios coletivos + pessoais do próprio usuário |
| `POST` | `/api/v1/payment-methods` | `RequireUser` | Cria meio (`name`, `kind` em `pix\|debit\|credit_card\|cash\|transfer\|other`, `last4` opcional de 4 dígitos para cartão, `is_personal`) |
| `PATCH` | `/api/v1/payment-methods/{id}` | `RequireUser` | Renomeia ou arquiva meio de pagamento acessível |
| `GET` | `/api/v1/workspaces/{wsId}/expenses` | `RequireUser` | Lista despesas do ambiente (`?from=AAAA-MM-DD&to=AAAA-MM-DD&category_id=UUID`) com `total_cents` e `splits` |
| `POST` | `/api/v1/workspaces/{wsId}/expenses` | `RequireUser` | Cria despesa à vista (`total_installments = 1`) ou parcelada (`2..48`, materializando `installment_plan` + $N$ parcelas) |
| `GET` | `/api/v1/expenses/{id}` | `RequireUser` | Detalhe da despesa + `splits` (`404` se for individual de outro membro) |
| `PATCH` | `/api/v1/expenses/{id}` | `RequireUser` | Atualiza despesa e recalcula `splits` |
| `DELETE` | `/api/v1/expenses/{id}` | `RequireUser` | Exclui despesa (ou parcela individual) |
| `DELETE` | `/api/v1/installment-plans/{planId}` | `RequireUser` | Exclui todas as parcelas de uma compra parcelada de uma só vez |
| `POST` | `/api/v1/expenses/{id}/share-with-household` | `RequireUser` | Move despesa do ambiente individual para o coletivo da casa com divisão igualitária inicial |
| `GET` | `/api/v1/expenses/{id}/refunds` | `RequireUser` | Lista os estornos registrados na despesa |
| `POST` | `/api/v1/expenses/{id}/refunds` | `RequireUser` | Registra estorno parcial ou total (`amount_cents`, `refunded_on`, `reason`) e abate proporcionalmente os saldos se for coletiva |
| `GET` | `/api/v1/workspaces/{wsId}/recurring-rules` | `RequireUser` | Lista as contas recorrentes e assinaturas do ambiente |
| `POST` | `/api/v1/workspaces/{wsId}/recurring-rules` | `RequireUser` | Cadastra assinatura ou conta recorrente (`monthly`, `weekly`, `yearly`) |
| `PATCH` | `/api/v1/recurring-rules/{id}` | `RequireUser` | Edita, pausa ou reativa (`is_active`) uma recorrência |
| `DELETE` | `/api/v1/recurring-rules/{id}` | `RequireUser` | Remove a regra mantendo os lançamentos passados |
| `POST` | `/api/v1/workspaces/{wsId}/recurring-rules/generate` | `RequireUser` | Materializa de forma idempotente as recorrências vencidas/do mês atual |

### Saldos e Reembolsos (`internal/settlement`)
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/balances` | `RequireUser` | Retorna `members` (saldo líquido `net_cents` por membro) e `pairwise` (dívidas bilaterais líquidas `from_user_id` → `to_user_id`) |
| `GET` | `/api/v1/settlements` | `RequireUser` | Histórico de reembolsos (`?status=pending\|confirmed\|rejected` opcional) |
| `POST` | `/api/v1/settlements` | `RequireUser` | Registra reembolso (`from_user_id`, `to_user_id`, `amount_cents`, `paid_on`, `notes`). Nasce `pending` se criado pelo devedor e `confirmed` se criado pelo credor |
| `POST` | `/api/v1/settlements/{id}/confirm` | `RequireUser` | Credor (`to_user_id`) confirma o recebimento de um reembolso pendente |
| `POST` | `/api/v1/settlements/{id}/reject` | `RequireUser` | Credor ou devedor recusa/cancela um reembolso pendente |

### Notificações Internas (`internal/notification`)
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/notifications` | `RequireUser` | Lista as notificações do usuário logado (`?unread_only=true` opcional) e `unread_count` |
| `POST` | `/api/v1/notifications/{id}/read` | `RequireUser` | Marca uma notificação do próprio usuário como lida (`404` se for de outro membro) |
| `POST` | `/api/v1/notifications/read-all` | `RequireUser` | Marca todas as notificações do próprio usuário como lidas |

### Relatórios e Exportação CSV / PDF (`internal/report`)
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/workspaces/{wsId}/reports/summary` | `RequireUser` | Resumo em centavos do período (`?from=AAAA-MM-DD&to=AAAA-MM-DD`) por categoria, meio de pagamento e membro (`404` se o workspace for individual de outro familiar) |
| `GET` | `/api/v1/workspaces/{wsId}/reports/export.csv` | `RequireUser` | Download do relatório em CSV (UTF-8 com BOM, separador `;`, anti-CSV Injection) |
| `GET` | `/api/v1/workspaces/{wsId}/reports/export.pdf` | `RequireUser` | Download do relatório em PDF 1.4 gerado em Go puro |

### Dispositivos Android e Fila de Importação Bancária (`internal/bankimport`)
| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/devices` | `RequireUser` | Lista os dispositivos Android do próprio usuário |
| `POST` | `/api/v1/devices` | `RequireUser` | Cria token de dispositivo (`{"device_name":"..."}`) e retorna `plain_token` uma única vez |
| `DELETE` | `/api/v1/devices/{id}` | `RequireUser` | Revoga imediatamente o token de um dispositivo do usuário |
| `POST` | `/api/v1/ingest/bank-notification` | `Bearer <device_token>` | Recebe notificação capturada pelo App Android, aplica parser versionado + mascaramento anti-PAN e grava na fila privada do dono do celular |
| `GET` | `/api/v1/imports` | `RequireUser` | Lista itens da fila privada do usuário (`?status=pending\|approved\|discarded`) |
| `POST` | `/api/v1/imports/{id}/approve` | `RequireUser` | Aprova um item da fila criando a despesa no ambiente escolhido (`404` se pertencer a outro membro) |
| `POST` | `/api/v1/imports/{id}/discard` | `RequireUser` | Descarta um item pendente da fila privada (`404` se pertencer a outro membro) |

---

## CLI Administrativo (`cmd/admin`)

Exige a variável `MIGRATE_DATABASE_URL` conectada com o papel `app_owner`:

```text
admin migrate up|down|status
admin bootstrap --name "Casa" [--max-members 4]
admin user add --name "Fulano" --email fulano@exemplo.com
admin user reset-password --email fulano@exemplo.com
admin user list
```
