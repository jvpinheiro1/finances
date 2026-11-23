# ADR 0003: Autenticação própria no Go com sessão opaca em cookie

- Status: aceito (decisões D1, D2 e D3 aprovadas pelo usuário em 2026-11-23)
- Data: 2026-11-23

## Contexto
O sistema não pode ficar preso a um provedor (Supabase é opcional). Há só 4 usuários e nenhum cadastro público.

## Decisão
1. **Auth própria** no backend Go.
   - Senhas com **argon2id** (`golang.org/x/crypto/argon2`), formato PHC (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`), parâmetros de referência do OWASP (m=19 MiB, t=2, p=1), com salt aleatório de 16 bytes.
   - Senha: mínimo de 12 e máximo de 128 caracteres.
   - Mensagem de erro genérica no login; para e-mail inexistente o hash é calculado mesmo assim (evita enumeração por tempo de resposta).
   - Bloqueio progressivo: após 5 falhas seguidas, 15 min; cada falha extra dobra o tempo, até 24 h. Rate limit adicional por IP na rota de login.
2. **Sessão opaca** para a PWA:
   - token aleatório de 256 bits, enviado só no cookie `ff_session` (`HttpOnly`, `Secure` em produção, `SameSite=Lax`, `Path=/`);
   - no banco fica apenas o **SHA-256** do token;
   - expiração absoluta e por inatividade, configuráveis (padrão: 14 dias / 3 dias);
   - troca de senha revoga as demais sessões; logout revoga a atual.
3. **Token de dispositivo** separado para o app Android (Etapa 8), revogável individualmente.
4. **Bootstrap** pelo CLI `admin`: cria a residência e os usuários com senha temporária e `must_change_password = true`. Enquanto a senha não for trocada, a API só aceita `me`, `password` e `logout`.
5. **CSRF**: `SameSite=Lax` + checagem do header `Origin` contra a lista permitida + header `X-Requested-With` obrigatório em métodos de escrita.

## Consequências
- Mais código de segurança sob nossa responsabilidade, coberto por testes.
- Revogação imediata de sessões, sem JWT exposto ao JavaScript.
