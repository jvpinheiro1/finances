# ADR 0004: Ambientes (coletivo/individual) com política central e RLS

- Status: aceito
- Data: 2026-11-23

## Contexto
Despesas individuais são privadas: nenhum outro membro pode vê-las, nem por bug de autorização (cenários de aceite 2 e 4).

## Decisão
- Tabela `workspace` com `kind ∈ {household, personal}`. Cada residência tem exatamente 1 ambiente coletivo; cada usuário tem exatamente 1 individual (índices únicos parciais).
- Todo registro financeiro futuro terá `workspace_id`.
- **Política central em Go** (`workspace.CanAccess`): coletivo → qualquer membro ativo da mesma residência; individual → só o dono.
- **Defesa em profundidade no PostgreSQL**:
  - migrations rodam com o papel `app_owner` (dono das tabelas);
  - a API conecta com `app_rw`, que não é dono e tem só os privilégios mínimos;
  - `ENABLE` + `FORCE ROW LEVEL SECURITY` nas tabelas de ambientes (e nas financeiras futuras);
  - cada transação autenticada executa `set_config('app.user_id', <uuid>, true)` (escopo da transação); as políticas usam a função `app_current_user_id()`.
- Recurso inexistente ou sem acesso → **404** (não revela existência).
- Tabelas de identidade (`app_user`, `session`) ficam sem RLS porque o login acontece antes de existir um usuário autenticado; o acesso a elas é restrito por GRANTs e pelo código.

## Consequências
- Funciona em Postgres puro e no Supabase (também Postgres).
- Os nomes dos papéis `app_owner` e `app_rw` são fixos nas migrations.
