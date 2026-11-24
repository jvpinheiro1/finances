# ADR 0001: Monólito modular em Go com REST

- Status: aceito
- Data: 2026-11-23

## Contexto
O sistema atende 4 usuários de uma família. Precisa ser simples de operar, barato de hospedar e fácil de manter, com regras de negócio fortes (privacidade, divisões, parcelamentos).

## Decisão
- Um único binário Go (`cmd/api`) com módulos internos (`internal/<modulo>`), API REST JSON em `/api/v1`.
- Roteamento com `net/http` (ServeMux do Go ≥ 1.22, com método e curingas), sem framework.
- Cada módulo segue `domain → service → (repository | http)`. Um módulo só usa outro pelo service público dele; nunca acessa as tabelas do outro diretamente.
- Sem microsserviços e sem Kubernetes na primeira versão.

## Consequências
- Deploy e depuração simples, com uma transação de banco que pode abranger vários módulos quando necessário (ex.: criar usuário + ambiente individual).
- Se um dia for preciso separar algo, os limites entre módulos já estão definidos.
