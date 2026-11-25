# ADR 0013: Redesign do Frontend PWA (Escuro/Claro Neutro, Rotas Declarativas e Visualização por Categoria)

- **Status**: Aceito (2026-11-25)
- **Decisões relacionadas**: DA-1 (C), DA-2 (C), DA-3 (A), DA-4 (A), DA-5 (C), DA-6 (A), DA-7 (A), DA-8 (A), DA-9 (A)
- **Documentação de design**: [docs/design/redesign-proposta.md](../design/redesign-proposta.md)

## Contexto

Com todas as Etapas 1 a 9 do roadmap implementadas e validadas, a interface da PWA (`web/`) precisava evoluir para uma experiência mobile-first mais limpa, rápida de operar no dia a dia familiar e inspirada na distribuição visual do aplicativo de referência *My Finance* (total gasto no período em destaque, seletor rápido de período com setas de avanço/recuo, gráfico Donut por categoria com total centralizado, lista de lançamentos agrupada por dia com ícones circulares e formulário de despesa em Sheet/Modal focado no valor e grade de categorias).

Ao mesmo tempo, o redesign precisava respeitar integralmente as restrições arquiteturais e de segurança do projeto **Finanças Família**:
1. Nenhuma funcionalidade fora dos requisitos (sem conceitos de renda/receitas, múltiplas moedas ou câmbio presentes no app de referência).
2. Valores monetários estritamente em centavos inteiros (`int64` / `number` inteiro), sem ponto flutuante.
3. Proteção de privacidade em uso público ("espiada" no celular) e zero armazenamento de dados financeiros sensíveis em `localStorage` ou logs.
4. Conformidade com WCAG 2.2 AA (contraste mínimo 4,5:1 para texto normal, 3:1 para bordas/gráficos, alvos de toque `>= 44x44px`, navegação por teclado e respeito a `prefers-reduced-motion`).

## Decisão

Com base nas decisões finais do usuário (DA-1 a DA-9), adotamos a seguinte arquitetura no frontend PWA (`web/`):

1. **Design System Escuro Neutro por Padrão + Tema Claro Neutro Manual (`DA-2 = C`, `DA-7 = A`)**:
   - A paleta base utiliza tons neutros de zinco (`#0E0E10` para fundo e `#18181B` / `#232326` para superfícies no tema escuro; `#F4F4F5` e `#FFFFFF` no tema claro `[data-theme="light"]`), eliminando os azuis saturados anteriores e as cores verde/amarela do app de referência.
   - Um controle na barra superior permite alternar manualmente entre os temas Escuro e Claro, persistindo apenas a string `"dark" | "light"` na chave `ff_theme` do `localStorage`.
   - Tipografia baseada na pilha nativa do sistema (`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`) com `font-variant-numeric: tabular-nums` obrigatório em todos os valores monetários e percentuais.

2. **Navegação com Menu Hambúrguer no Mobile, Sidebar Fixa no Desktop e Rotas `react-router` v7 (`DA-1 = C`, `DA-5 = C`)**:
   - Adotado `react-router` v7 (`BrowserRouter`, `Routes`, `Route`, `NavLink`, `useNavigate`, `useLocation`, `useSearchParams`) para navegação declarativa entre as telas:
     - `/` (Início: resumo do período, Donut SVG interativo por categoria, lista de categorias com filtro em 1 toque e cartões de pendências/saldos);
     - `/lancamentos` (Lançamentos agrupados por dia + Sheet de detalhes da despesa com divisões, estorno, compartilhamento, edição e exclusão);
     - `/saldos` (Saldos bilaterais e reembolsos);
     - `/recorrentes` (Contas recorrentes e assinaturas);
     - `/relatorios` (Relatórios consolidados e exportação CSV/PDF);
     - `/android` (Pareamento de dispositivos Android e fila privada de revisão bancária);
     - `/cadastros` (Categorias, cartões/meios de pagamento e membros da residência);
     - `/notificacoes` (Caixa de entrada privada com RLS).
   - No mobile (`< 1024px`), mantemos o menu hambúrguer (`☰`) que abre o drawer lateral responsivo e adicionamos o botão flutuante FAB `+` no canto inferior direito para abrir o Sheet "Nova despesa". No desktop (`>= 1024px`), a sidebar fica fixa à esquerda e o botão `+ Nova despesa` permanece no cabeçalho.
   - Tanto o Nginx (`web/nginx.conf` com `try_files $uri $uri/ /index.html;`) quanto o servidor Go unificado (`internal/app/app.go` quando `STATIC_DIR` está configurado) já possuem fallback de SPA para `index.html`, permitindo refresh direto em qualquer rota.

3. **Mapeamento Visual de Categorias e Gráfico Donut SVG no Frontend (`DA-3 = A`)**:
   - Sem alterar o esquema do banco de dados nem a API REST, o módulo `web/src/utils/categoryVisuals.ts` associa ícones vetoriais SVG inline às 8 categorias padrão da residência (*Alimentação, Moradia, Contas, Transporte, Saúde, Lazer, Educação, Outros*) e categorias adicionais comuns (ex.: *Pet, Assinaturas, Mercado, Farmácia*), usando a inicial do nome como fallback e uma paleta determinística de 8 cores dessaturadas (`--cat-1` a `--cat-8`) com contraste `>= 3:1` em ambos os temas.
   - O gráfico Donut é renderizado em SVG puro com arcos calculados sobre os centavos líquidos (`total_net_cents`) e pontos-base (`share_bps`), acompanhado sempre da lista textual acessível.

4. **Seletor de Período Sem Bugs de Fuso Horário (`DA-6 = A`, `DA-8 = A`)**:
   - O módulo `web/src/utils/period.ts` manipula datas exclusivamente em componentes locais (`YYYY-MM-DD` via `getFullYear()`, `getMonth()`, `getDate()`), evitando o deslocamento de dia causado por `Date.prototype.toISOString()` em fusos negativos como `America/Sao_Paulo` (UTC-3).
   - O período padrão ao abrir a PWA é o **Mês corrente** (`DA-6 = A`), com abas para `Dia`, `Semana` (iniciando na segunda-feira ISO-8601, `DA-8 = A`), `Mês`, `Ano`, `Período` personalizado e `Tudo`, além de botões `‹` e `›` para recuar ou avançar o intervalo.

5. **Modo de Privacidade "Ocultar Valores" (`DA-4 = A`)**:
   - O botão `👁` na barra superior ativa/desativa o mascaramento global de valores monetários (`R$ ••••`), iniciando desligado por padrão e salvando apenas `"1" | "0"` na chave `ff_hide_values` do `localStorage`.

6. **Testes Unitários Automatizados no Frontend (`DA-9 = A`)**:
   - Configurado o `vitest` (`npm --prefix web test`) para validar a aritmética local de períodos/datas (incluindo anos bissextos e semanas ISO-8601), a formatação/mascaramento de centavos e o mapeamento visual de categorias e segmentos do Donut.

## Consequências

- **Positivas**: Experiência mobile-first ágil inspirada na referência visual solicitada; 100% de paridade funcional com as Etapas 1 a 9; deep-linking por rota (`/lancamentos`, `/saldos`, etc.); zero mudança ou acoplamento no backend Go/PostgreSQL; alternância claro/escuro e modo de privacidade contra olhares de terceiros; cobertura de testes unitários para regras críticas de UI.
- **Limitações conhecidas**: Como toda PWA executando no navegador, o modo "ocultar valores" protege a exibição visual em tela, mas não impede capturas de tela do sistema operacional (recurso exclusivo de apps nativos via `FLAG_SECURE`).
