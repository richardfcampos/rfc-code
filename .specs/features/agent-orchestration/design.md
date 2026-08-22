# Design — agent-orchestration Fase 1

## Arquitetura

```
                       ┌──────────────────────────────────────────────┐
                       │                 FRONTEND                     │
                       │  Tabs: … | Board(novo) | Settings>Orgs(novo) │
                       │  CommandPalette + useTaskActionsSource(novo) │
                       └───────────────┬──────────────────────────────┘
                                       │ REST + WS (kind: task_update)
   ┌───────────────────────────────────┼─────────────────────────────────┐
   │ SERVER                            ▼                                 │
   │  ┌────────────────┐   ┌───────────────────┐   ┌──────────────────┐  │
   │  │ modules/tasks   │   │ modules/orgs      │   │ modules/         │  │
   │  │ CRUD + stages   │──▶│ policy resolver   │◀──│ agent-bridge     │  │
   │  │ ws broadcast    │   │ + quota recommend │   │ (MCP stdio→REST) │  │
   │  └───────┬────────┘   └─────────┬─────────┘   └────────┬─────────┘  │
   │          │                      │ enforce               │ token/    │
   │          ▼                      ▼                       │ sessão    │
   │  ┌────────────────┐   ┌───────────────────────────┐     │           │
   │  │ database:      │   │ chat-websocket.service    │◀────┘           │
   │  │ tasks, orgs,   │   │ spawn choke point         │                 │
   │  │ policies, audit│   │ (profileId → resolver)    │                 │
   │  └────────────────┘   └───────────────────────────┘                 │
   └─────────────────────────────────────────────────────────────────────┘
```

## Dados (schema.ts + runMigrations, padrão PROFILES_TABLE)

```sql
orgs(id, name UNIQUE, is_default 0/1, fallback_threshold INTEGER DEFAULT 85, created_at)
org_project_rules(id, org_id FK, kind 'path_prefix'|'project_name', pattern, created_at)
org_profile_policies(id, org_id FK, profile_id FK, role 'primary'|'fallback',
                     priority INTEGER, UNIQUE(org_id, profile_id))
tasks(id, project_name, title, description, stage 'backlog'|'in_progress'|'review'|'done',
      origin 'user'|'agent'|'automation', origin_detail, assignee_profile_id NULL,
      suggested_skill NULL, worktree_branch NULL, created_at, updated_at)
profile_fallback_audit(id, org_id, profile_id, project_name, session_id NULL,
                       reason, primary_usage_pct, created_at)
```

Seed na migration: org `Pessoal` com `is_default=1` (catch-all; sem regra de path).

## Fluxos e shadow paths

**Resolução de org** (`orgs/services/org-resolver.service.ts`): project path → primeira
regra `path_prefix` que casa (mais longa vence) → senão `project_name` → senão org default.
Nil/empty path → org default. Duas regras iguais → prioridade pela mais longa, depois id.

**Policy resolver** (`orgs/services/profile-policy.service.ts`), API central:

```ts
listAllowedProfiles(projectPath): { profileId, role, priority }[]   // ordenada
assertProfileAllowed(projectPath, profileId): void                  // throw OrgPolicyError
resolveProfileForSpawn(projectPath, { provider?, requestedProfileId? }):
  { profileId, role, fallback?: { reason, primaryUsagePct } }
```

- Org sem NENHUMA policy → compat: todos os perfis permitidos (instalação atual
  continua funcionando sem configurar nada). Org COM ≥1 policy → default deny.
- Fallback elegível só quando todo `primary` do provider pedido está: uso ≥ threshold
  (via `profileUsageService`), sem snapshot (unknown NÃO libera fallback — conservador),
  ou não autenticado. Uso de fallback grava `profile_fallback_audit` e retorna motivo.
- `OrgPolicyError` nomeado → REST 403 `{ code: 'ORG_POLICY_DENIED' }`; no WS, evento
  de erro pro cliente (mesmo canal de erro de spawn existente). Nunca silencioso.

**Enforcement** — pontos que consultam o resolver:
1. `chat-websocket.service.ts` runtimeOptions (linha ~291-325): antes do spawn,
   `assertProfileAllowed(projectPath, profileId)`; se `profileId` null,
   `resolveProfileForSpawn` decide (troca o default atual).
2. REST `GET /api/orgs/allowed-profiles?project=…` → composer/switcher filtram a lista.
3. Bridge (abaixo) — toda tool com `profileId` valida.
4. Collab/cross-provider switch: reusam (2) na UI e (1) no spawn — sem código novo.

**Quota recommend** (`orgs/services/profile-recommend.service.ts`):
`recommend(projectPath, provider?) → { profileId, role, usagePct, reason }` —
percorre a lista permitida em ordem (primaries por priority, usage < threshold;
senão fallback elegível). Exposto em `GET /api/orgs/recommend` e usado pelo (1)
quando não há perfil pedido.

## Tasks module (`server/modules/tasks`)

Padrão worktrees: `tasks.repository.ts` (em `database/repositories/tasks.db.ts`),
`tasks.service.ts`, `tasks.routes.ts` (router com services injetados), `tasks.module.ts`,
barrel `index.ts`, mount `app.use('/api/tasks', authenticateToken, tasksRoutes)`.

REST: `GET /api/tasks?project=`, `POST /api/tasks` `{title, project, …opcionais}`,
`PATCH /api/tasks/:id` (stage/assignee/campos), `DELETE /api/tasks/:id`.
Toda mutação → `broadcastTaskUpdate({kind:'task_update', task})` (padrão
profile-usage-broadcast: iterate connectedClients, try/catch por cliente).
Validação: title obrigatório não-vazio ≤500 chars; stage do enum; project existente;
assignee (se presente) passa por `assertProfileAllowed`. Erros nomeados → 400/403/404.

## Bridge MCP (`server/modules/agent-bridge` + `server/agent-bridge-mcp.ts`)

Padrão browser-use-mcp: processo stdio (`cli.js` subcomando `agent-bridge-mcp`)
que proxeia pra `POST /api/agent-bridge/tools/:toolName` com bearer token.
Token por sessão: gerado no spawn, carrega `{ sessionId, projectPath }` (HMAC com
segredo do server, mesmo esquema do browser-use token). Escopo: tools operam
implicitamente no projeto da sessão — agente não escolhe org.
Tools v1: `task_create`, `task_list`, `task_update_stage`, `task_assign`,
`profile_recommend`. `task_assign` valida via policy resolver (403 → erro MCP
com mensagem do motivo). Registro no config MCP do provider: mesma mecânica
que o browser-use usa hoje (documentar no módulo; sem auto-inject novo).

## Frontend

- **Board tab**: builtin id `board`, label "Board", em BASE_TABS (sempre visível;
  TaskMaster continua conditional, intocado). `src/components/task-board/`:
  `view/TaskBoardTab.tsx` (4 colunas, quick-add input topo, cards com chips
  origem/assignee/worktree), `hooks/useTaskBoard.ts` (fetch + subscribe
  `task_update` com freshness por `updated_at`). Mobile: colunas viram accordion
  vertical (tablet AD-004).
- **Palette**: `sources/useTaskActionsSource.ts` — sempre oferece
  "Criar task: <query>" quando query ≥3 chars; Enter → POST + toast + fecha.
- **Orgs UI**: `src/components/profiles/view/OrgsSettingsTab.tsx` ao lado de
  ProfilesSettingsTab (mesma navegação de Settings). CRUD org, regras de path,
  lista ordenada de perfis (papel primary/fallback, reorder, threshold),
  seção "bloqueados" implícita (perfis fora da lista). Chip `fallback ativo`
  quando recommend atual retorna fallback.
- Tipos client-side copiados (convenção: frontend não importa módulos do server).

## Segurança

- Todas rotas novas atrás de `authenticateToken`.
- Bridge: token HMAC por sessão, sem profileId no token (server resolve), validade
  = vida da sessão; tool com input validado (zod ou validação manual como browser-use).
- Policy é allow-list; erro de resolução → deny + log estruturado (nunca fail-open),
  EXCETO org sem policies (compat explícita, documentada).
- Audit de fallback é insert-only.

## Testes (node:test via tsx, colocados em tests/ do módulo)

- org-resolver: path prefix/name/default, nil/empty, regras sobrepostas.
- policy: allow/deny, org sem policy (compat), fallback com uso ≥/<' threshold,
  snapshot ausente, provider sem primary, audit gravado.
- tasks service: CRUD, validações, transições de stage, broadcast chamado.
- bridge routes: token inválido/expirado, tool ok, assign negado por policy.
- spawn integration: profileId negado → erro, null → recommend usado (fake deps,
  padrão dos testes existentes de chat-websocket, se houver; senão service puro).

## Rollback

Migrations só criam tabelas/seed (aditivas, idempotentes). Branch separada;
revert = não mergear. Nenhuma mudança em comportamento existente quando não há
orgs configuradas além da default (compat) — exceção: default de perfil no spawn
passa pelo recommend, que sem policies retorna o default atual (is_default).
