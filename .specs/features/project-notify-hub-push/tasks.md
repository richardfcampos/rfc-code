# Tasks — Project Notify-Hub Push

Orquestração AD-012: orquestrador não implementa. T1 ∥ T2 ∥ T4 ∥ T5; T3 depende de T1+T2; T6 depende de T2 (contrato da rota); T7 é do orquestrador (segredos).

## T1 — Coluna `notifyEnabled` + toggle por projeto (backend)

- **What**: migração + schema; `projects.db.ts` (SELECTs, `updateProjectNotifyEnabledById`, `getProjectByPath` completo); `project-notify.service.ts`; rota `POST /:projectId/toggle-notify`; `notifyEnabled` na lista ativa e arquivada
- **Where**: `server/modules/database/{schema,migrations}.ts`, `server/modules/database/repositories/projects.db.ts`, `server/modules/projects/services/project-notify.service.ts` (novo), `projects.routes.ts`, `projects-with-sessions-fetch.service.ts`
- **Reuses**: `project-star.service.ts`, `toggle-star`
- **Depends on**: —
- **Done when**: rota alterna e devolve `{ notifyEnabled }`; lista traz o campo; typecheck verde
- **Tests**: service (0→1→0, 404, 400)
- **Requisitos**: PNH-02, PNH-03
- **Status**: done — coluna + migração (inclui rebuild legado), `updateProjectNotifyEnabledById`, `project-notify.service.ts`, rota `toggle-notify`, DTOs (lista ativa/arquivada, `ProjectApiView`, `WorktreeProjectView`, watcher, chat-run-registry); teste em `server/modules/projects/tests/project-notify.service.test.ts` (3 casos)

## T2 — Config do notify-hub (service + rotas)

- **What**: `notify-hub-config.service.ts` (get/save/view/isConfigured, DB→env); rotas `GET/PUT /notify-hub`, `POST /notify-hub/test` em `notifications.routes.ts`; exportar `postToNotifyHub(body, cfg)` do canal p/ o teste **ou** implementar o POST de teste no service (com 5s timeout)
- **Where**: `server/modules/notifications/services/notify-hub-config.service.ts` (novo), `notifications.routes.ts`, `server/modules/notifications/index.ts`
- **Reuses**: `appConfigDb`, padrão de rotas do arquivo
- **Depends on**: —
- **Done when**: GET mascara token; PUT valida e persiste; test devolve `{ ok, status, error? }`
- **Tests**: service (6 casos do design) + rota test (202/401/rede)
- **Requisitos**: PNH-08, PNH-09, PNH-10, PNH-11
- **Status**: done — `notify-hub-config.service.ts` (DB→env por campo, validação URL/IANA, view mascarada, `sendNotifyHubTest` 5s), rotas GET/PUT `/notify-hub` + POST `/notify-hub/test`, `.env.example`; 10 testes. Nota: fuso vazio grava `''` (sem `appConfigDb.delete`), leitura trata falsy como não-setado → cai no env

## T3 — Canal: gate por projeto + payload PT-BR com horário

- **What**: `isEnabled` via config service; `resolveNotifyProject`; `buildNotifyHubRequestBody` puro (título/emoji/prioridade/`Início · Fim (dur)`/sessão/erro 200 chars/metadata); `postToNotifyHub(body, cfg)`; gate avaliado no disparo do deferido
- **Where**: `server/modules/notifications/services/webhook-notify-channel.service.js` (+ `.test.js`); se passar de 200 linhas, extrair `notify-hub-payload.js`
- **Reuses**: deferimento/cancel existentes; `sessionsDb.getSessionById`/`getSessionByProviderSessionId`; `projectsDb.getProjectByPath`
- **Depends on**: T1, T2
- **Done when**: tabela de testes do design verde; testes antigos adaptados (agora precisam de projeto com flag ligada)
- **Requisitos**: PNH-04, PNH-05, PNH-06, PNH-07, PNH-12
- **Status**: done — canal reescrito (204 l.) + `notify-hub-payload.js` puro (170 l.); gates (config + sino) avaliados no disparo, inclusive dentro do timer de 60s; lookups em try/catch; by-path = `projectsDb.getProjectPath`. 9 + 11 testes. `buildWebhookRequestBody` removido (único importador era o próprio teste). Limite aceito: `permission.required` sem `startedAt` → só `Fim HH:MM`

## T4 — Providers passam `projectPath` e `startedAt`

- **What**: `notifyRunStopped/notifyRunFailed` aceitam e copiam `projectPath`/`startedAt` p/ `meta`; evento `permission.required` ganha `meta.projectPath`; 4 providers preenchem
- **Where**: `notification-orchestrator.service.js`, `server/claude-sdk.js`, `server/openai-codex.js`, `server/cursor-cli.js`, `server/opencode-cli.js`
- **Depends on**: — (contrato fixado no design; ∥ T3)
- **Done when**: grep mostra os 4 providers passando `projectPath`; testes existentes dos providers verdes
- **Tests**: orquestrador propaga meta (unit pequeno)
- **Requisitos**: PNH-07 (entrada), PNH-04
- **Status**: done — `buildRunStoppedEvent/buildRunFailedEvent` puros; 4 providers passam `projectPath`+`startedAt`; permissão do claude leva `projectPath`; +3 testes em `server/services/tests/notification-orchestrator.test.js`. INCIDENTE: worker rodou `git stash`/`pop` na árvore compartilhada, reverteu ~21 arquivos de outros workers no meio; recuperado por eles + auditoria do orquestrador (typecheck 0, 692/692). Lição: proibir git mutável nos briefs de worker

## T5 — Sidebar: sino por projeto

- **What**: tipo `Project.notifyEnabled`; `api.toggleProjectNotify`; hook genérico `useOptimisticProjectToggle`; botão no `SidebarProjectMenuRow`; props via Selector/Sidebar/controller; 2 tooltips em 10 locales
- **Where**: `src/types/app.ts`, `src/utils/api.ts`, `src/components/sidebar/hooks/{useOptimisticProjectToggle.ts (novo), useSidebarController.ts}`, `src/components/sidebar/view/{Sidebar.tsx, subcomponents/SidebarProjectMenuRow.tsx, subcomponents/SidebarProjectSelector.tsx}`, `src/i18n/locales/*/sidebar.json`
- **Reuses**: `toggleStarProject` (padrão), `ICON_BUTTON_CLASS`
- **Depends on**: T1 (rota) — pode começar pelo contrato
- **Done when**: clique alterna com otimismo/rollback; estado visível; typecheck + lint verdes
- **Requisitos**: PNH-01, PNH-02
- **Status**: done — `useOptimisticProjectToggle` genérico (estrela não refatorada), sino `Bell/BellRing` (`text-primary`) após a estrela, `api.toggleProjectNotify` (em `src/utils/api.js`), 2 tooltips × 10 locales

## T6 — Settings: card do notify-hub

- **What**: `useNotifyHubSettings.ts`; `NotifyHubSettingsCard.tsx`; montar em `NotificationsSettingsTab`; i18n `notifications.notifyHub.*` em 10 locales
- **Where**: `src/components/settings/hooks/useNotifyHubSettings.ts` (novo), `src/components/settings/view/tabs/notifications-settings/NotifyHubSettingsCard.tsx` (novo), `NotificationsSettingsTab.tsx`, `src/i18n/locales/*/settings.json`
- **Depends on**: T2 (contrato GET/PUT/test)
- **Done when**: carrega, salva, testa, mostra origem; fuso pré-preenchido; typecheck + lint verdes
- **Requisitos**: PNH-08, PNH-10, PNH-11
- **Status**: done — `useNotifyHubSettings.ts` (142 l.), `NotifyHubSettingsCard.tsx` (170 l.) entre Sound e Event Types, `notifications.notifyHub.*` × 10 locales; Testar desabilitado até `configured`

## T7 — Seed das credenciais do usuário (orquestrador)

- **What**: extrair token de `/srv/code/personal/notify-hub/.env` (`TOKENS`), validar com `GET http://localhost:8080/channels`, gravar `NOTIFY_URL/NOTIFY_TOKEN/NOTIFY_TIMEZONE` em `~/.rfc-code/env` e `~/.rfc-code-dev/env` (backup antes)
- **Depends on**: —
- **Done when**: ambos os env têm as 3 vars; `GET /channels` 200 com o token
- **Requisitos**: PNH-13
- **Status**: done — 2026-09-13: token do `TOKENS` validado (`GET /channels` 200, default channel `telegram`); `NOTIFY_URL=http://localhost:8080/notify`, `NOTIFY_TOKEN`, `NOTIFY_TIMEZONE=America/Sao_Paulo` gravados em `~/.rfc-code/env` e `~/.rfc-code-dev/env` (backups `*.bak-notify-<ts>`)

## T8 — Gate

- **What**: `npm test`, `npm run typecheck`, `npx eslint src/ server/`, `npm run build`; smoke: 1 push real de teste via rota `/notify-hub/test` com sino ligado num projeto
- **Depends on**: T3, T4, T5, T6, T7
- **Status**: done — typecheck 0, **704/704 testes**, eslint 0 erros (241 warnings pré-existentes), build EXIT 0. Smoke real 2026-09-13: payload do builder novo → `POST /notify` **202** (`jobId 4`), título `✅ rfc-code — concluído`, `Início 08:41 · Fim 08:48 (7min)` no fuso -03. Comentário stale do canal no orquestrador atualizado pelo orquestrador

## T9 — Review

- **What**: `code-reviewer` no diff completo (vazamento do token na API, gate por projeto, HUB-09 preservado, regressão web-push/desktop)
- **Depends on**: T8
- **Status**: done — relatório `plans/reports/reviewer-260913-project-notify-hub-push.md`: 0 critical, 3 major, 8 minor → SHIP-WITH-FIXES. Majors corrigidos pelo orquestrador: (1) `useProjectsState.ts` reconstruía `Project` sem `notifyEnabled` em 3 pontos (projeto chegando por `session_upserted` renderizava sino OFF e o toggle é flip → clique desligava); (2) `projectsHaveChanges` ignorava `notifyEnabled` (refetch só com delta do sino era descartado); (3) `saveNotifyHubConfig` gravava URL antes de validar fuso (save meio aplicado). Minor aplicado: fallback do `Intl` na rota de teste. Minors aceitos p/ depois: toggle é flip (não set idempotente), mapa otimista nunca limpo, projeto arquivado com sino ligado ainda envia, `source` = db se só 1 campo veio do DB, sem caminho de 'desconfigurar' com env setado, timer de permissão só cancelado no claude-sdk
