# Documentação do Projeto — Finanças Família (Estrutura Diátaxis)

Esta documentação é organizada segundo os quatro quadrantes do framework **Diátaxis**, separando aprendizado inicial, tarefas práticas, referência técnica e explicação arquitetural.

| Quadrante Diátaxis | Propósito | Documentos |
|---|---|---|
| **1. Tutorial** *(Orientado a aprendizado)* | Guiar passo a passo a subida do ambiente do zero até o primeiro acesso. | [Guia de Instalação e Primeiro Acesso](instalacao.md) |
| **2. Guias Como-Fazer (How-To)** *(Orientados a tarefas)* | Resolver tarefas específicas de operação, uso diário, deploy em produção e backup. | [Guias de Operação e Uso Diário](guias-operacao.md) e [Deploy PaaS + Supabase Free e Backup Criptografado](producao-e-backup.md) |
| **3. Referência Técnica (Reference)** *(Orientada à informação)* | Descrever com precisão as rotas REST, payloads JSON, códigos de erro e CLI. | [Referência da API REST e CLI Admin](referencia-api.md) |
| **4. Explicação (Explanation)** *(Orientada ao entendimento)* | Explicar o porquê das decisões técnicas, modelo de privacidade, RLS e centavos. | [Arquitetura Geral](arquitetura.md) e [ADRs 0001–0012](adr/) |

---

## Planos das Etapas Incrementais

- [Etapa 1 — Estrutura, Autenticação, Usuários, Ambientes e BD com RLS](etapa1_plano.md) *(Concluída)*
- [Etapa 2 — Despesas, Categorias, Meios de Pagamento e Compartilhamento](etapa2_plano.md) *(Concluída)*
- [Etapa 3 — Divisões Determinísticas e Reembolsos / Acerto de Contas](etapa3_plano.md) *(Concluída)*
- [Etapa 4 — Parcelamentos e Estornos](etapa4_plano.md) *(Concluída)*
- [Etapa 5 — Despesas e Contas Recorrentes / Assinaturas](etapa5_plano.md) *(Concluída)*
- [Etapa 6 — Notificações Internas e Alertas da PWA](etapa6_plano.md) *(Concluída)*
- [Etapa 7 — Relatórios Mensais e Exportação CSV / PDF](etapa7_plano.md) *(Concluída)*
- [Etapa 8 — App Android de Captura de Notificações Bancárias e Fila de Importação](etapa8_plano.md) *(Concluída)*
- [Etapa 9 — Hospedagem, TLS, Backup Automatizado e Observabilidade de Produção](etapa9_plano.md) *(Concluída)*
