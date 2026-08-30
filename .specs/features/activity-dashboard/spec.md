# Feature: activity-dashboard

**Escopo:** Large · **Status:** especificada · **Mockup aprovado:** `mockup-v1.html` (neste diretório — fonte da verdade visual; iterado com o usuário em 2026-08-30)

## Problema

Não existe visão geral do que está acontecendo no rfc-code. Hoje só há 2 rotas (`/` e `/session/:sessionId` — `src/App.tsx:132-137`); pra saber o que roda, o que espera decisão e o que está em review, o usuário precisa entrar projeto por projeto, aba por aba. O sidebar tem um modo "running" cross-project (`SidebarSessionToolbar.tsx:44`) mas nada agrega tasks/boards.

## Solução

Rota nova `/overview`: dashboard com **3 modos empilhados** — decisão do usuário: "já tem modo chat, modo board, falta o modo task":

1. **Sessões (modo chat)** — cards das sessões recentes de todos os projetos
2. **Tasks (modo task)** — lista plana cross-project das tasks do TaskMaster
3. **Boards (modo board)** — mini-kanban por projeto com board

Tudo clicável (chat ou board), cores fixas por projeto, filtros de status **multi-selecionáveis** aplicados às 3 seções.

## Requisitos Funcionais

| ID | Requisito |
| --- | --- |
| FR-1 | Rota `/overview` renderiza o dashboard; acessível por link no header/sidebar e pelo command palette |
| FR-2 | **Seção Sessões**: card por sessão (últimas 24h, todas de projetos não arquivados) com: nome do projeto (accent color), chip `wt/<branch>` quando houver worktree (label via `getSessionWorktreeLabel`), badge do provider (logos existentes de `SessionProviderLogo`), título (custom_name/summary), status com cor (rodando = primary pulsante / precisa de você = warning / idle), linha de atividade ("Rodando · <statusText>" quando processando), e "há X min" (updated_at) |
| FR-3 | Card de sessão mostra "o que fez / o que falta": v1 = `statusText` da run ativa + summary; checklist estruturado ✓/○ real fica **fora do v1** (ver Deferido) |
| FR-4 | Clique no card → `/session/:id` (rota existente); `<a href>` real pra cmd/middle-click, como `SidebarSessionItem.tsx:130-146` |
| FR-5 | Card de sessão com task vinculada mostra **chip TASK** no meio (`#id título · status`, cor do status), clicável pro board na task. Vínculo = `sessions.task_id` (novo, ver design); sem vínculo, sem chip |
| FR-6 | **Seção Tasks**: lista plana de todas as tasks dos projetos com TaskMaster, ordenada in-progress → review → pending; done oculta por padrão (aparece só com filtro "concluída"). Linha: dot+nome do projeto (accent), `#id`, título, chip de sessão vinculada quando houver ("sessão rodando"/"precisa de você"), badge de status à direita (cores por status). Clique → board do projeto com a task aberta |
| FR-7 | **Seção Boards**: bloco por projeto com TaskMaster, com as 4 colunas core (`CORE_WORKFLOW_STATUSES` — pending/in-progress/review/done, `taskKanban.ts:56`), contagem por coluna, tickets clicáveis → board na task, e "Abrir board →" no cabeçalho do bloco |
| FR-8 | **Filtros multi-selecionáveis** (regra geral do usuário, vale como padrão pra filtros futuros): chips no header — Tudo · rodando · precisam de você · em review · concluída — com contagens ao vivo. Seleção múltipla = **união** dos critérios. Lógica do Tudo: Tudo ativo ⇔ conjunto vazio; clicar Tudo limpa os demais; desmarcar o último volta pro Tudo. Estado na URL (`?f=run,attn`) — deep-linkável |
| FR-9 | Mapeamento dos filtros por seção (igual ao mockup): rodando → sessões `run` + coluna in-progress; precisam de você → sessões `attn` + coluna review; em review → sessões com task em review + coluna review; concluída → sessões idle + tasks/coluna done. Nos boards, colunas fora da união ficam esmaecidas (opacity), não somem |
| FR-10 | **Deep link de board**: rota `/project/:projectId` com `?tab=tasks&task=<id>` — seleciona o projeto, ativa a aba e abre a task (drawer do cockpit se status=review, senão TaskDetailModal, mesma regra de `TaskMasterPanel.handleTaskClick`). Hoje aba é só localStorage (`useProjectsState.ts:357-394`) — a rota passa a ser a fonte quando presente |
| FR-11 | **Cores por projeto**: accent determinístico por `projectId` (paleta fixa de ~8 hues), usado no stripe do card, dot do board e nome do projeto — consistente entre as 3 seções |
| FR-12 | Atualização ao vivo: reusar o poll de 5s de `/api/providers/sessions/running` (já existe em `AppContent.tsx:102-141`); dados de projetos/tasks re-buscados em foco da aba e a cada 60s |
| FR-13 | Responsivo tablet (AD-004): sessões viram 1 coluna e boards 2 colunas em <900px (como o mockup) |

## Não-funcionais

- Tema: tokens do design system (`src/index.css`), dark e light — **não** copiar os hex hardcoded do mockup; mapear pros tokens (`--primary`, `--warning`, `--idle`, `--success` etc.). Cor de review: introduzir token `--review` (roxo), hoje inexistente — o board usa Tailwind cru (`taskKanban.ts:5-54`, inconsistência conhecida)
- Sem dependência nova; sem endpoint pesado novo (agregação client-side, ver design)
- i18n: strings novas nos 10 locales (padrão do projeto; DB-003 não se repete aqui)

## Fora de escopo (v1) / Deferido

- Checklist ✓/○ real por sessão (exige extração/estruturação do histórico) — v1 usa statusText+summary (FR-3)
- Decision Inbox cross-project — é a Fase 3 de `docs/designs/review-cockpit-uat-runner.md`, não duplicar aqui
- Overview como tela inicial default (`/` continua como está)
- Filtro por projeto/provider (só status no v1)

## Critérios de aceite

1. `/overview` no m1/tablet mostra as 3 seções com dados reais dos projetos locais
2. Clique em card de sessão abre o chat; clique em ticket/linha de task abre o board do projeto com a task aberta
3. Selecionar "precisam de você" + "concluída" mostra a união (sessões attn+idle, tasks review+done, colunas review+done acesas) e a URL reflete `?f=attn,done`
4. Recarregar a URL com `?f=...` restaura os filtros
5. Gate do projeto: suíte completa verde, typecheck 0, eslint 0 erros, build EXIT 0
