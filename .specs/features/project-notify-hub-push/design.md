# Design — Project Notify-Hub Push

## Princípio

Nada de canal novo: o `webhookNotifyChannel` existente ganha (a) **config resolvida por envio** (DB → env) e (b) **gate por projeto**. Os providers só passam mais contexto (`projectPath`, `startedAt`). O frontend replica o padrão da estrela.

## Backend

### 1. Projeto (`server/modules/projects/**`, `server/modules/database/**`)

- Migração: `addColumnToTableIfNotExists(db, 'projects', columnNames, 'notifyEnabled', 'BOOLEAN DEFAULT 0')` junto de `isStarred` (`migrations.ts:138`); schema (`schema.ts:89`) ganha a coluna.
- `projects.db.ts`: incluir `notifyEnabled` em todos os SELECTs que já devolvem `isStarred`; novo `updateProjectNotifyEnabledById(projectId, enabled)`; garantir `getProjectByPath(projectPath)` devolve a linha inteira (já existe SELECT por path em ~51).
- `project-notify.service.ts` (novo, espelho de `project-star.service.ts`): `toggleProjectNotify(projectId) → { notifyEnabled }`.
- `projects.routes.ts`: `POST /:projectId/toggle-notify` ao lado de `toggle-star`.
- `projects-with-sessions-fetch.service.ts`: `notifyEnabled: Boolean(row.notifyEnabled)` em ativos (~239) e arquivados (~291); tipos `ProjectListItem`/`ArchivedProjectListItem`.

### 2. Config do notify-hub (`server/modules/notifications/services/notify-hub-config.service.ts`, novo)

```ts
type NotifyHubConfig = { url: string | null; token: string | null; timezone: string | null; source: 'db' | 'env' | 'none' }
getNotifyHubConfig(): NotifyHubConfig        // app_config → process.env fallback, por campo
saveNotifyHubConfig({ url, token?, timezone }) // valida URL http(s) e IANA; token '' ou undefined mantém atual
toPublicView(cfg) → { url, hasToken, tokenHint: '••••abcd', timezone, source, configured: boolean }
isNotifyHubConfigured(cfg) → Boolean(url && token)
```

Chaves `app_config`: `notify_hub_url`, `notify_hub_token`, `notify_hub_timezone`. Validação de fuso: `new Intl.DateTimeFormat('en-US', { timeZone })` em try/catch.

Rotas em `notifications.routes.ts`:
- `GET /notify-hub` → view pública
- `PUT /notify-hub` → salva, devolve view
- `POST /notify-hub/test` → monta payload de teste e chama `postToNotifyHub` direto (sem gate de projeto), aguarda a resposta e devolve `{ ok, status, error? }` (401 → `"Token inválido"`; timeout/rede → mensagem do erro). Único caminho que *espera* o hub — é UX, não sessão.

### 3. Canal (`webhook-notify-channel.service.js`)

- `isEnabled` → `isNotifyHubConfigured(getNotifyHubConfig())`, avaliado a cada evento (hot config, PNH-11).
- `send({ event, payload })`:
  1. `resolveNotifyProject(event)` → `meta.projectPath` ?? `sessionsDb.getSessionById(sessionId)?.project_path` ?? `getSessionByProviderSessionId(...)?.project_path`; depois `projectsDb.getProjectByPath(path)`. Sem linha ou `notifyEnabled = 0` → `return undefined` (PNH-04).
  2. `buildNotifyHubRequestBody(event, project, cfg, now)` (função pura, testável) → `{ title, message, priority, metadata }` conforme spec P2. Formatação de hora: `Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })`; duração `<1min | 12min | 1h 04min` (mesma regra do hook).
  3. Deferimento de 60s para `permission.required` inalterado; o gate por projeto roda **no disparo** (estado do sino pode mudar nos 60s).
- `postToNotifyHub(body, cfg)` recebe a config (não lê env dentro).
- Nome do projeto: `custom_project_name?.trim() || path.basename(project_path)`.

### 4. Providers → orquestrador

Contrato: `notifyRunStopped/notifyRunFailed({ ..., projectPath = null, startedAt = null })` copiam para `meta`; evento `permission.required` ganha `meta.projectPath`. Call sites:
- `claude-sdk.js` (~555 emitNotification/permission ~673, stop ~788, fail ~821): `projectPath: options.cwd`, `startedAt` capturado no início de `queryClaudeSDK`
- `openai-codex.js` (~349, ~379, ~412): `cwd || projectPath`
- `cursor-cli.js` (`notifyTerminalState` ~103): `workingDir`
- `opencode-cli.js` (`notifyTerminalState` ~140): `workingDir`

`buildNotificationPayload` (web-push/desktop) **não muda** — texto novo é só do canal notify-hub.

## Frontend

### Sidebar
- `src/types/app.ts` `Project.notifyEnabled?: boolean`
- `src/utils/api.ts` (onde vive `toggleProjectStar`): `toggleProjectNotify(projectId)`
- `src/components/sidebar/hooks/useOptimisticProjectToggle.ts` (novo, genérico: `readFlag`, `request`, sequência por projeto, rollback) — usado pelo sino; estrela **não** é refatorada nesta feature (AD-009, menos churn)
- `SidebarProjectMenuRow`: botão `Bell`/`BellRing` após a estrela, `aria-pressed`, tooltip `tooltips.enableProjectNotifications|disableProjectNotifications`; props `isNotifyEnabled`, `onToggleNotify` propagadas por `SidebarProjectSelector` → `Sidebar.tsx` → `useSidebarController`

### Settings
- `src/components/settings/hooks/useNotifyHubSettings.ts` (novo): load `GET`, form state, save `PUT`, test `POST`, pré-preenche fuso do navegador quando vazio
- `src/components/settings/view/tabs/notifications-settings/NotifyHubSettingsCard.tsx` (novo, <200 linhas): campos URL / token (password, placeholder `••••abcd` quando `hasToken`) / fuso, badge de origem (`db`/`env`/`none`), botões Salvar e Testar, feedback inline
- `NotificationsSettingsTab.tsx`: renderiza o card acima de "Event Types"
- i18n: `settings.json` → `notifications.notifyHub.*`; `sidebar.json` → 2 tooltips; 10 locales (de, en, fr, it, ja, ko, ru, tr, zh-CN, zh-TW)

## Testes

| Área | Casos |
| --- | --- |
| `notify-hub-config.service` | DB sobrepõe env; env fallback por campo; token vazio mantém; URL inválida rejeita; fuso inválido rejeita; view mascara token |
| `webhook-notify-channel` (existente + novos) | não configurado → nada; projeto sem flag → nada; sem projeto → nada; flag ligada → POST com Bearer da config DB; título/prioridade por código; `Início · Fim (dur)` com `startedAt` e fuso `America/Sao_Paulo`; só `Fim` sem `startedAt`; fallback via `sessions.project_path`; permissão deferida e cancelada (regressão) |
| `project-notify.service` / rota | toggle 0→1→0; 404 projeto inexistente; 400 id vazio |
| rota `notify-hub/test` | 202 → ok; 401 → "Token inválido"; rede → ok=false |

Gate: `npm test`, `npm run typecheck`, `npx eslint src/ server/`, `npm run build`.

## Segurança

- Token em `app_config` em claro, como `jwt_secret` — perímetro é a tailnet (AD-002); nunca sai da API em claro (só `hasToken` + 4 últimos)
- `PUT` só aceita `http:`/`https:`; sem SSRF extra além do que o env já permitia (operador controla o host)
- Rotas sob `authenticateToken` (`index.js:221`, `:195`)
