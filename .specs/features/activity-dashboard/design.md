# Design: activity-dashboard

Referência visual: `mockup-v1.html` (aprovado). Spec: `spec.md`.

## Decisões de arquitetura

**D1 — Agregação client-side, zero endpoint novo de leitura.** Os dados já existem:

- Sessões + worktree: `GET /api/projects` → `ProjectListItem{ projectId, displayName, sessions: SessionSummary[] }`, `SessionSummary{ id, provider, summary, lastActivity, worktreePath, worktreeBranch }` (`projects-with-sessions-fetch.service.ts:11-46`)
- Rodando: `GET /api/providers/sessions/running` (`provider.routes.ts:550-556`) — `AppContent` já faz poll de 5s e alimenta `SessionActivityMap` (`useSessionProtection.ts:3-14`); o overview consome o mesmo estado
- Tasks: `GET /api/taskmaster/tasks/:projectId` → `{ tasks[], tasksByStatus }` (`server/routes/taskmaster.js:233-247`), 1 chamada por projeto com board, em paralelo, tolerando 404/not-installed. N projetos é pequeno; só otimizar com endpoint agregado se doer (YAGNI)

**D2 — Buckets de status reusam a lógica do sidebar.** `session-groups.ts:93-119` já decide Running/Needs-you/Recent ("needs you" vence "running"). Extrair a função de bucket pra util compartilhado em vez de duplicar — overview e sidebar não podem divergir.

**D3 — Vínculo sessão↔task = coluna nova `sessions.task_id` (TEXT, nullable).** Já era escopo previsto: F2 do review cockpit lista "linkage task↔sessão" (`docs/designs/review-cockpit-uat-runner.md`). v1 desta feature entrega o armazenamento + exibição + escrita por 1 ponto: ao disparar sessão a partir do Review Cockpit/task (quando esse fluxo existir, grava `task_id`); e `PUT /api/providers/sessions/:id` aceita `taskId` pra vínculo manual/programático. Sem task_id → sem chip (FR-5 degrada limpo).

**D4 — Deep link muda a fonte da aba.** Rota nova `/project/:projectId` (+ `?tab=&task=`). `useProjectsState` hoje persiste `activeTab` só em localStorage (`:357-394`); com param presente, URL vence e sincroniza o localStorage. `TaskMasterPanel` ganha prop `initialTaskId` e reusa `handleTaskClick` (`TaskMasterPanel.tsx:64-88`) — task em review abre o cockpit drawer, resto abre o modal. Sem `task` param, só seleciona projeto+aba.

**D5 — Cores de projeto:** util puro `getProjectAccent(projectId)` — hash estável → paleta de 8 hues (HSL, mesma luminosidade nos 2 temas). Sem persistência.

**D6 — Token `--review`:** adicionar em `index.css` (light+dark) e no `tailwind.config.js` (`review: hsl(var(--review))`). O overview usa tokens; migrar `taskKanban.ts` pros tokens fica fora (débito existente, não piora).

**D7 — Filtro multi-select como estado local + URL.** `Set<FilterId>` (`run|attn|review|done`), vazio = Tudo. União dos predicados por seção (tabela do FR-9). `useSearchParams`-like sync manual (`history.replaceState`), formato `?f=run,attn`. Componente de chips reutilizável (`OverviewFilterChips`) — regra do usuário: filtros futuros também multi-select.

## Componentes (novos, `src/components/overview/`)

```
OverviewPage.tsx          — rota /overview; monta dados + estado de filtro
  useOverviewData.ts      — agrega projects + running + taskmaster; refetch 60s/focus
  useOverviewFilters.ts   — Set de filtros, lógica do Tudo, sync URL
  view/OverviewHeader.tsx — título + FilterChips (contagens ao vivo)
  view/FilterChips.tsx    — chips multi-select (genérico)
  view/SessionsSection.tsx / SessionCard.tsx
  view/TasksSection.tsx   / TaskRow.tsx
  view/BoardsSection.tsx  / BoardMiniColumn.tsx
  utils/project-accent.ts — getProjectAccent
  utils/overview-filter.ts— predicados por seção (puro, testável)
```

Modificados: `src/App.tsx` (rotas `/overview`, `/project/:projectId`), `AppContent.tsx` (resolver params → seleção projeto/aba/task), `useProjectsState.ts` (URL como fonte da aba quando presente), `TaskMasterPanel.tsx` (`initialTaskId`), `sidebar` (link Overview), `session-groups.ts` (extração do bucket util), `schema.ts` + `sessions.db.ts` + rota PUT (task_id), `index.css`/`tailwind.config.js` (`--review`), locales (10).

## Fluxo de dados

```
/overview mount
  → GET /api/projects ──────────────┐
  → SessionActivityMap (já no app) ─┼→ useOverviewData → view models:
  → GET /api/taskmaster/tasks/:id ──┘   sessions[] (bucket run/attn/idle, accent, taskChip?)
       (N em paralelo, 60s/focus)       tasks[] (flat, sort progress→review→pending)
                                        boards[] (colunas core + counts)
  filtros (Set) → predicados → hide/dim (CSS class), contagens no chip
```

## Edge cases

- Projeto sem TaskMaster → fora de Tasks/Boards, sessões aparecem normal
- 0 sessões nas 24h → seção mostra empty state ("nada rodando"), não some
- Task com status extra (blocked/deferred/cancelled) → aparece na lista com badge própria (cores de `taskKanban.ts`); nos boards segue regra atual (coluna só se não-vazia); filtros não a escondem no Tudo
- `task_id` apontando pra task deletada → chip não renderiza (lookup falho = sem chip)
- Sessão em worktree: card mostra chip `wt/`; clique abre o chat normal (sessão já vive no projeto pai)
- `?f=` com valor inválido → ignorado, cai no Tudo

## Riscos

- `useProjectsState` é grande e central; D4 mexe na fonte da aba — cobrir com teste de precedência URL>localStorage e não tocar nos fluxos sem param
- DB-001: componentes React sem runner de teste — lógica de filtro/bucket/accent vai em utils puros testáveis pelo runner do server; componentes ficam pra UAT
