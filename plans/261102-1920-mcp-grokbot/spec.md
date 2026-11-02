# Spec — Grokbot MCP: controle total do RFC Code via MCP

Data: 2026-11-02 · Worktree `wt-mcp-grokbot` (branch `wt/mcp-grokbot`) · Escopo: **Large** (multi-componente, sem ambiguidade de domínio)
Research: `research/*.md` (4 relatórios: catálogo REST A e B, protocolo WS, mapa UI→backend).

## 1. Objetivo

Expor um servidor MCP (Model Context Protocol) **embutido no RFC Code** para que o Grokbot (cliente MCP externo) leia e altere tudo que a UI web permite, sem navegador. Uma única tool catalogada por operação, em todas as seções do app.

## 2. Princípios

- **Reuso, não reimplementação.** Cada tool mapeia 1:1 para a rota REST que a UI já chama (validação, erros, policies e broadcasts WS continuam no lugar de sempre), ou para o mesmo caminho in-process que a UI usa por WebSocket (chat). Nada de lógica de negócio nova.
- **Cobertura verificável.** Toda rota REST do servidor é declarada como coberta por uma tool (`covers`) ou listada numa exclusão explícita com motivo. Um teste automatizado falha se uma rota ficar sem dono.
- **Escape hatch.** `rfc_api_call` (método/caminho/query/body) garante acesso a qualquer rota existente ou futura que ainda não tenha tool dedicada.
- **Segredos fora do repositório.** Autenticação por API key criada em Settings > API Tokens (banco). Nenhum token em arquivo commitado.

## 3. Requisitos funcionais

| ID | Requisito |
| --- | --- |
| R1 | Endpoint MCP **Streamable HTTP** em `POST /api/grokbot-mcp` (JSON-RPC 2.0; `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/*`; batch JSON array aceito). `GET` → 405, `DELETE` → 204. Stateless: sem `Mcp-Session-Id`. Resposta `application/json` (sem SSE). |
| R2 | Autenticação obrigatória **em todo modo** (inclusive `AUTH_MODE=trusted` e platform): `Authorization: Bearer <api key>` ou `x-api-key`, validada por `apiKeysDb.validateApiKey` (tabela `api_keys`, criada em Settings > API Tokens). Sem key ou key inativa → 401 JSON-RPC error. `API_KEY` de ambiente (se definido) continua exigido como hoje em `/api`. |
| R3 | Tools REST executam por **loopback HTTP no próprio servidor** com JWT emitido para o usuário dono da key (`generateToken`), de modo que middleware, validação, policies (orgs), broadcasts WS e logs se comportam exatamente como na UI. |
| R4 | **Chat sem browser**: `session_send` inicia/continua um turno via `chatRunRegistry.startRun` + `spawnFns[provider]` (mesmo caminho de `chat.send`), aceitando `content`, `model`, `effort`, `permissionMode`, `toolsSettings`, `images`; opção `wait` bloqueia até `complete` (timeout configurável, default 120s) e devolve o texto final; sem `wait` devolve imediatamente e o Grokbot acompanha com `session_events`. Mesma política de perfil (org) do chat. |
| R5 | `session_abort`, `session_pending_approvals`, `session_approve_tool` (allow/deny/updatedInput/message), `session_events` (replay do buffer por `afterSeq`), `session_list_running` cobrem o restante do protocolo `/ws`. |
| R6 | Shell: `shell_exec` executa um comando one-shot no diretório do projeto (ou worktree) com timeout e cap de saída; sem PTY interativo. |
| R7 | Streams SSE viram tools one-shot: `project_clone` (consome `clone-progress` até `complete|error`), `session_search` (consome `search/sessions` até `done`). |
| R8 | Upload/Download: tools aceitam/retornam **base64** para multipart (`asset_upload_image`, `asset_upload_file`, `task_attachment_add`, `file_upload`) e bytes (`file_read_bytes`, `task_attachment_download`, `asset_download`), com cap de 20 MiB. |
| R9 | **Cobertura por seção** (lista de tools em §5): projetos, arquivos/editor, sessões, chat, worktrees, git, tasks/board, reviews, automations, orgs, profiles, skills, MCP servers dos providers, modelos/auth/capabilities, plugins, settings (api keys, credentials, notificações, notify-hub, endpoints, git identity, onboarding, browser-use), collab, team view, agent messages, TaskMaster/PRD/preview, comandos, sistema (health, update, filesystem), escape hatch. |
| R10 | Erros de qualquer rota (envelope `{success:false,error}` ou RAW `{error}`) chegam ao cliente como `tools/call` result com `isError: true` e texto `"<STATUS> <code>: <message>"`; erros de protocolo (método desconhecido, JSON inválido, tool inexistente, args inválidos) como JSON-RPC `error` (`-32601`, `-32700`, `-32602`). |
| R11 | `tools/list` entrega `inputSchema` JSON Schema por tool, com enums reais (stages, providers, scopes, modos). Nomes `snake_case` com prefixo de seção. |
| R12 | Novo comando CLI `cloudcli grokbot-mcp-url` **não** é criado (YAGNI). A URL e o modo de conexão ficam documentados em `server/modules/grokbot-mcp/README.md`. |

## 4. Requisitos não funcionais

| ID | Requisito |
| --- | --- |
| N1 | Arquivos ≤ 200 linhas; um arquivo de tools por seção; módulo `server/modules/grokbot-mcp/` respeitando `eslint-plugin-boundaries` (imports de outros módulos só via barrel; runtimes legados injetados por `configureGrokbotMcpRuntime` em `server/index.js`). |
| N2 | Sem dependência nova: JSON-RPC implementado à mão como `agent-bridge-mcp.ts` (o SDK MCP só existe como dependência transitiva). |
| N3 | Nada de novo em portas/config do VPS; o endpoint vive na mesma porta do app. Nenhum segredo em arquivo versionado. |
| N4 | `npm test` continua verde (baseline 1376/1376), `npm run typecheck` limpo, `npm run lint` sem erro novo. |
| N5 | Sem merge/push/deploy nesta feature. |

## 5. Superfície MCP — tools por seção

Convenções: `projectId` = id do registro em `projects` (o que a UI usa); `project` nas tasks = `project_name`. Tools marcadas **[in-process]** não passam por REST. `(gen)` = coberta apenas pelo escape hatch, com motivo.

### 5.1 Sistema e escape hatch
`health`, `system_update`, `filesystem_browse {path?}`, `filesystem_create_folder {path}`, `rfc_api_call {method, path, query?, body?}` (qualquer `/api/*`), `auth_status`, `user_onboarding_status`, `user_complete_onboarding`.

### 5.2 Projetos
`project_list {skipSync?, sessionsLimit?, sessionsOffset?}`, `project_list_archived`, `project_create {path, customName?}`, `project_clone {path, githubUrl, githubTokenId?, newGithubToken?}` (SSE→one-shot), `project_rename {projectId, displayName}`, `project_toggle_star`, `project_toggle_notify`, `project_archive {projectId}`, `project_delete {projectId}` (force), `project_restore`, `project_sessions {projectId, limit?, offset?}`, `project_taskmaster_status`, `project_codegraph_status`, `project_codegraph_init`, `project_migrate_legacy_stars (gen)`.

### 5.3 Arquivos / editor
`file_tree {projectId}`, `file_read {projectId, filePath}`, `file_read_bytes {projectId, path}` (base64), `file_write {projectId, filePath, content}`, `file_create {projectId, name, type, path?}`, `file_rename {projectId, oldPath, newName}`, `file_delete {projectId, path}`, `file_upload {projectId, files:[{name, contentBase64}], targetPath?}`.

### 5.4 Sessões (REST)
`session_create {provider, projectPath, profileId?}`, `session_list_running`, `session_list_archived`, `session_rename {sessionId, summary, taskId?}`, `session_archive`, `session_delete` (force), `session_restore`, `session_messages {sessionId, limit?, offset?}`, `session_token_usage {projectId, sessionId}`, `session_search {q, limit?}` (SSE→one-shot), `session_set_active_model {provider, sessionId, model}`, `session_set_caveman_mode {sessionId, cavemanMode}`, `session_handoff_profile {sessionId, profileId}`.

### 5.5 Chat **[in-process]**
`session_send {sessionId, content, model?, effort?, permissionMode?, toolsSettings?, images?, wait?, timeoutMs?}`, `session_abort {sessionId}`, `session_events {sessionId, afterSeq?}`, `session_pending_approvals {sessionId}`, `session_approve_tool {requestId, allow, updatedInput?, message?}`, `session_status {sessionId}` (isProcessing, lastSeq, provider).

### 5.6 Worktrees
`worktree_list {projectId}`, `worktree_create {projectId, branch, baseBranch?, uniqueBranch?}`, `worktree_open {projectId, worktreePath}`, `worktree_merge {projectId, worktreePath, squash?, message?, removeAfterMerge?}`, `worktree_remove {projectId, worktreePath, force?, deleteBranch?}`.

### 5.7 Git
`git_status`, `git_diff {file}`, `git_file_with_diff {file}`, `git_branches`, `git_commits {limit?}`, `git_commit_diff {commit}`, `git_remote_status`, `git_compare {base}`, `git_compare_diff {base, file}`, `git_stage {files[]}`, `git_unstage {files[]}`, `git_discard {file}`, `git_delete_untracked {file}`, `git_commit {message, files[]}`, `git_generate_commit_message {files[], provider?}`, `git_initial_commit`, `git_revert_local_commit`, `git_checkout {branch}`, `git_create_branch {branch}`, `git_delete_branch {branch}`, `git_fetch`, `git_pull`, `git_push`, `git_publish {branch}` (todas com `projectId`).

### 5.8 Tasks / Board
`task_list {project}`, `task_create {project, title, description?, origin?, origin_detail?, assignee_profile_id?, suggested_skill?, worktree_branch?}`, `task_get {taskId}`, `task_update {taskId, title?, stage?, description?, assignee_profile_id?, suggested_skill?, worktree_branch?}`, `task_delete`, `task_evidence_add {taskId, kind, content, attachment_id?}`, `task_evidence_delete`, `task_attachment_add {taskId, fileName, contentBase64, mimeType?}`, `task_attachment_download` (base64), `task_attachment_delete`, `task_decompose {taskId, subtasks[], origin_detail?}`, `task_subtasks {taskId}`, `task_subtasks_ready {taskId}`.

### 5.9 Reviews
`review_list {state?, project?}`, `review_get {reviewId}`, `review_file_diff {reviewId, file}`, `review_comment {reviewId, filePath, lineNo?, body}`, `review_approve {reviewId, squash?, message?, removeWorktree?}`, `review_request_changes {reviewId, body?}`.

### 5.10 Automations
`automation_list`, `automation_create {name, trigger_kind, trigger_config, action_kind, action_config, enabled?}`, `automation_get`, `automation_update` (parcial), `automation_delete`, `automation_runs {automationId, limit?}`, `automation_fire`, `automation_rotate_webhook_secret`. (Webhook de entrada `POST /api/automations/webhook/:id` excluído: autentica com segredo próprio, não é ação de usuário.)

### 5.11 Orgs
`org_list`, `org_create {name, fallbackThreshold?}`, `org_update`, `org_delete`, `org_rule_add {orgId, kind, pattern}`, `org_rule_delete`, `org_policies_replace {orgId, policies[]}`, `org_allowed_profiles {project?, provider?}`, `org_recommend_profile {project?, provider?}`.

### 5.12 Profiles
`profile_list {provider?}`, `profile_create {provider, name}`, `profile_delete`, `profile_status`, `profile_set_default {profileId, isDefault}`, `profile_set_tooling {profileId, cavemanMode?, rtkMode?}`, `profile_usage {profileId?}` (todos ou um), `profile_skills {profileId}`, `profile_skills_set {profileId, enabled[]}`, `profile_skills_restore`.

### 5.13 Providers: auth, modelos, skills, MCP servers
`provider_auth_status {provider}`, `provider_models {provider, bypassCache?}`, `provider_capabilities {provider?}`, `skill_list {provider, workspacePath?, profileId?}`, `skill_create {provider, entries[]}`, `skill_delete {provider, directoryName}`, `mcp_server_list {provider, scope?, workspacePath?}`, `mcp_server_upsert {provider, name, transport, scope?, …}`, `mcp_server_delete {provider, name, scope?, workspacePath?}`, `mcp_server_add_global {…}`, `cursor_config`, `taskmaster_mcp_server_status {projectId?}`.

### 5.14 Plugins
`plugin_list`, `plugin_manifest {name}`, `plugin_install {url}`, `plugin_update {name}`, `plugin_enable {name, enabled}`, `plugin_uninstall {name}`, `plugin_rpc {name, method, path, body?}`. (`GET /:name/assets/*` excluído: estático da UI.)

### 5.15 Settings
`api_key_list`, `api_key_create {keyName}`, `api_key_delete`, `api_key_toggle {keyId, isActive}`, `credential_list {type?}`, `credential_create {…}`, `credential_delete`, `credential_toggle`, `notification_preferences_get`, `notification_preferences_set {preferences}`, `notification_endpoints {channel}`, `notification_endpoint_upsert`, `notification_endpoint_toggle`, `notification_endpoint_delete`, `notify_hub_get`, `notify_hub_set {url, token?, timezone?}`, `notify_hub_test`, `git_identity_get`, `git_identity_set {gitName, gitEmail}`, `browser_use_settings_get`, `browser_use_settings_set {enabled}`, `browser_use_status`, `browser_use_install_runtime`, `browser_use_sessions`, `browser_use_session_stop`, `browser_use_session_delete`. Push `subscribe/unsubscribe/vapid` excluídos (exigem um navegador com Push API). Preferências só de browser (tema, idioma, listas de permissão, modelo/effort padrão, voz, editor) **não têm estado no servidor** e ficam fora por natureza (ver research `ui-sections-to-backend-map.md`); o equivalente é passar `model/effort/permissionMode/toolsSettings` em `session_send`.

### 5.16 Collab, Team View, Agent messages
`collab_list {projectPath?}`, `collab_create {…}`, `collab_get`, `collab_stop`, `collab_delete`, `team_view`, `agent_message_list {sessionId, box?, state?}`.

### 5.17 TaskMaster, PRD, UAT preview
`taskmaster_installation_status`, `taskmaster_tasks {projectId}`, `taskmaster_init`, `taskmaster_add_task {…}`, `taskmaster_update_task {projectId, taskId, …}`, `taskmaster_parse_prd {…}`, `prd_list {projectId}`, `prd_get {projectId, fileName}`, `prd_save {projectId, fileName, content}`, `prd_templates`, `prd_apply_template {…}`, `preview_config_get`, `preview_config_set {…}`, `preview_start {projectId, cwd?}`, `preview_status`, `preview_stop`.

### 5.18 Comandos e shell
`command_list {projectPath?}`, `command_execute {commandName, commandPath?, args?, context?}`, `shell_exec {projectId|cwd, command, timeoutMs?}` **[in-process]**, `asset_upload_image`, `asset_upload_file`, `asset_download {kind, filename}`.

### Exclusões declaradas (teste de cobertura as aceita só com motivo)
`POST /api/auth/register|login|logout` (bot já autenticado por key), `POST /api/automations/webhook/:id` (auth própria), `/api/agent-bridge/*` e `/api/browser-use-mcp/*` (bridges com token próprio), `/api/plugins/:name/assets/*` (estático), `/api/settings/push/*` (Push API do navegador), `/api/voice/*` (proxy de áudio do browser), `/api/assets/images|files/:filename` GET via `asset_download`.

## 6. Como o Grokbot conecta

- URL: `http://<host do RFC Code>:<porta>/api/grokbot-mcp` (prod: mesma porta do app; dev: `SERVER_PORT`).
- Header: `Authorization: Bearer <api key>` (criada em Settings > API Tokens; ou via `api_key_create` a partir de outra key).
- Transporte: Streamable HTTP, stateless, JSON. Cliente MCP padrão (ou registro como MCP remoto no mcp-manager, decisão do usuário, fora desta feature).
- Handshake esperado: `initialize` → `notifications/initialized` → `tools/list` → `tools/call`.

## 7. Testes (ver tasks.md T10–T12)

1. **Unit** (`node --test` via `npm test`): handler JSON-RPC; middleware de auth (sem key/inválida/inativa/ok; trusted mode ainda exige key); dispatcher loopback (Express fixture: envelope W, RAW, erro W, erro RAW, bytes, multipart, SSE); invariantes do registro (nomes únicos, snake_case, schema `object`, `required ⊆ properties`, descrição ≥ 20 chars, `covers` não vazio ou `[in-process]`); mapeamento args→request de **cada** tool REST com dispatcher fake (tabela por seção); chat gateway (send/wait/abort/approve/events) com `spawnFns` fake e registry real; `shell_exec` (cwd, timeout, cap).
2. **Cobertura de rotas**: teste varre `server/routes/*.js`, `server/modules/**/*.routes.ts` e `app.(get|post|…)('/api…` em `server/index.js`, normaliza `METHOD /api/path/:param` e exige `∈ union(covers) ∪ exclusões`.
3. **Smoke** (`scripts/smoke/grokbot-mcp-smoke.mjs`, manual, fora do `npm test`): sobe o servidor real em porta efêmera com `DATABASE_PATH` temporário, `AUTH_MODE=trusted`, `HOST=127.0.0.1`; cria API key por REST; roda `initialize`, `tools/list`, `health`, `project_create` (repo git temporário), `task_create/list/update`, `git_status`, `file_write/read`, `worktree_list`, `session_create`, `session_list_running`, `profile_list`, `org_list`, `automation_list`, chamada sem key (401) e tool inexistente (-32601). Imprime PASS/FAIL por passo.

## 8. Fora de escopo
Stdio shim (`cloudcli grokbot-mcp`), MCP resources/prompts, SSE streaming de respostas MCP, UI para gerenciar o endpoint, registro automático no mcp-manager, deploy.
