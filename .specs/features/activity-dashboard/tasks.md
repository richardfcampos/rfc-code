# Tasks: activity-dashboard

Gate padrão de TODAS as tasks: suíte `npm test` verde, `npx tsc --noEmit` 0, `npx eslint src/ server/` 0 erros, `npm run build` EXIT 0. (Armadilha conhecida: `npm run lint` sai 1 pelo wrapper npm — usar `npx eslint`.)
`[P]` = paralelizável. Sub-agentes recebem: a task, `design.md`, `spec.md` (FRs citados), e este cabeçalho.

## Fase A — fundações

- [x] **T1 [P] — Token `--review` + accents de projeto**
  O quê: `--review` em `index.css` (light+dark, roxo ~`262 83% 66%` dark / mais escuro no light p/ contraste) + `tailwind.config.js`; util `src/components/overview/utils/project-accent.ts` (`getProjectAccent(projectId)` → hash estável → 8 hues). FR-11, D5, D6.
  Done when: util com teste unitário (mesmo id → mesma cor; distribuição nos 8), token utilizável como `text-review`/`bg-review`.

- [x] **T2 [P] — Extrair bucket de status pra util compartilhado**
  O quê: mover a decisão run/attn/idle de `session-groups.ts:93-119` pra util puro (ex.: `src/components/sidebar/utils/session-status.ts`); sidebar passa a consumir. D2.
  Done when: sidebar sem mudança de comportamento (testes existentes verdes), util testado ("needs you" vence "running").

- [x] **T3 [P] — Migração `sessions.task_id`**
  O quê: coluna TEXT nullable em `schema.ts` (padrão de migração guardada do projeto), `SessionRow`/`sessionsDb` (`sessions.db.ts`), `PUT /api/providers/sessions/:id` aceita `taskId` (validação: string curta ou null), `SessionSummary` expõe `taskId` (`projects-with-sessions-fetch.service.ts:127-137`). FR-5, D3.
  Done when: teste de rota round-trip (set/clear taskId), boot com DB existente migra sem erro.

## Fase B — rotas e deep link

- [x] **T4 — Rota `/overview` + página esqueleto + entrada de navegação**
  Depende de: nada (mas T1 ajuda no visual).
  O quê: rota em `App.tsx:132-137`, `OverviewPage` com as 3 seções vazias/empty-states, link no sidebar header + entrada no command palette. FR-1.
  Done when: `/overview` renderiza no dev server, navegação vai e volta sem quebrar `/session/:id`.

- [x] **T5 — Deep link `/project/:projectId?tab=&task=`**
  Depende de: nada.
  O quê: rota nova em `App.tsx`; `AppContent` resolve `projectId`→seleção, `tab`→`setActiveTab` (URL vence localStorage quando presente, `useProjectsState.ts:357-394`); `TaskMasterPanel` prop `initialTaskId` reusando `handleTaskClick` (`TaskMasterPanel.tsx:64-88` — review→cockpit, resto→modal). FR-10, D4.
  Done when: URL com `?tab=tasks&task=8` abre board com a task; sem params, comportamento atual intacto (teste de precedência URL>localStorage nos utils).

## Fase C — dados e seções

- [x] **T6 — `useOverviewData`**
  Depende de: T2, T3 (shape com taskId), T4.
  O quê: agrega `GET /api/projects` + `SessionActivityMap` (poll 5s existente) + `GET /api/taskmaster/tasks/:projectId` em paralelo (tolerar 404/not-installed); view models de sessões (bucket, accent, chip de task), tasks (sort in-progress→review→pending) e boards (colunas core + counts); refetch 60s + focus. FR-2/6/7/12, D1.
  Done when: transformações em utils puros com testes (sort, bucket, junção task↔sessão, projeto sem taskmaster).

- [x] **T7 [P] — Seção Sessões**
  Depende de: T6.
  O quê: `SessionsSection`/`SessionCard` conforme mockup: accent stripe, chip wt/ (`getSessionWorktreeLabel`, `sidebar/utils/utils.ts:85-100`), logo do provider (`SessionProviderLogo`), status colorido, statusText+summary, "há X", `<a href=/session/:id>`, chip TASK quando `taskId` (link pro deep link do T5). FR-2/3/4/5.

- [x] **T8 [P] — Seção Tasks**
  Depende de: T6.
  O quê: `TasksSection`/`TaskRow` conforme mockup: dot+projeto, #id, título, chip de sessão vinculada, badge de status à direita; done oculta por padrão; clique → deep link do T5. FR-6.

- [x] **T9 [P] — Seção Boards**
  Depende de: T6.
  O quê: `BoardsSection`/`BoardMiniColumn`: 4 colunas core com counts, tickets → deep link, "Abrir board →". FR-7.

## Fase D — filtros e acabamento

- [x] **T10 — Filtros multi-select**
  Depende de: T7–T9.
  O quê: `useOverviewFilters` (Set, lógica do Tudo: Tudo⇔vazio, clicar Tudo limpa, desmarcar último volta; união de predicados) + `FilterChips` (contagens ao vivo) + sync `?f=` + dim de colunas. Predicados em `utils/overview-filter.ts` puro. FR-8/9, D7.
  Done when: testes dos predicados e da lógica do Tudo; `?f=attn,done` restaura estado.

- [ ] **T11 — Responsivo tablet + i18n + polish**
  Depende de: T10.
  O quê: breakpoints (<900px: sessões 1 col, boards 2 col), strings novas nos 10 locales, empty states, dark+light conferidos. FR-13, NFRs.
  Done when: screenshot 834px sem quebra; grep de strings hardcoded nas views novas = 0.

- [ ] **T12 — Verificação final + UAT**
  Depende de: tudo.
  O quê: gate completo; smoke no dev server (overview real com os projetos da máquina); screenshots desktop+tablet pro usuário; UAT do usuário no m1/tablet (critérios de aceite 1–4 do spec). Autor ≠ verificador (AD-012).
  Done when: usuário aprova. Nada commita antes do UAT (padrão do projeto).

## Rastreabilidade

| FR | Tasks |
| --- | --- |
| FR-1 | T4 |
| FR-2/3/4 | T6, T7 |
| FR-5 | T3, T7 |
| FR-6 | T6, T8 |
| FR-7 | T6, T9 |
| FR-8/9 | T10 |
| FR-10 | T5 |
| FR-11 | T1, T7–T9 |
| FR-12 | T6 |
| FR-13 | T11 |
