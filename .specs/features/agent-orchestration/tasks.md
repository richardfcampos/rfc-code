# Tasks — agent-orchestration Fase 1

Orquestração: Fable coordena, não implementa (C6). Workers: **sonnet** = mecânico,
**opus** = crítico (segurança/enforcement/bridge). Gate global por task:
`npm test` verde + lint sem erro novo. Waves respeitam dependências.

| ID | Task | Reqs | Modelo | Depende | Status |
| --- | --- | --- | --- | --- | --- |
| T1 | Schema + repositories: tabelas orgs/org_project_rules/org_profile_policies/tasks/profile_fallback_audit em schema.ts, migrations idempotentes + seed org Pessoal, repos `orgs.db.ts` e `tasks.db.ts` + testes | R1,R4,R5 | sonnet | — | done |
| T2 | Módulo orgs: org-resolver + profile-policy (assert/list/resolveForSpawn, fallback c/ audit, OrgPolicyError, compat org-sem-policy) + testes | R4–R7 | opus | T1 | done |
| T3 | Enforcement no spawn: chat-websocket runtimeOptions consulta resolver; REST `GET /api/orgs/*` (orgs CRUD, allowed-profiles, recommend); mount em index.js + testes | R6,R8 | opus | T2 | done |
| T4 | Quota recommend service (usage + policy, ordem primária→fallback) integrado no default de spawn + testes | R8 | sonnet | T2 | done |
| T5 | Módulo tasks: service/routes/module, validações, broadcast `task_update` + testes | R1,R2 | sonnet | T1 | done |
| T6 | Bridge MCP: `agent-bridge-mcp` stdio + `/api/agent-bridge/tools/*`, token HMAC por sessão, 5 tools, policy no assign + testes | R9 | opus | T3,T5 | done |
| T7 | UI Board: tab builtin `board`, TaskBoardTab 4 colunas + quick-add, useTaskBoard (WS), palette source "Criar task" | R1–R3 | sonnet | T5 | done |
| T8 | UI Orgs: OrgsSettingsTab (CRUD org, regras path, perfis ordenados c/ papel e threshold) | R10 | sonnet | T3 | done |
| T9 | Gate final: suíte completa, lint, build vite, correções | — | sonnet | T1–T8 | done |

## Execução

- Wave 1: T1
- Wave 2: T2, T5 [P]
- Wave 3: T3+T4 (mesmo worker, mesma superfície), T6*, T7, T8 [P] (*T6 espera T3/T5)
- Wave 4: T9

## Fases 2–3

Sem tasks ainda — specs R11–R16 em spec.md; criar tasks quando forem executadas.

## Traceability

| Req | Tasks | | Req | Tasks |
| --- | --- | --- | --- | --- |
| R1 | T1,T5,T7 | | R6 | T2,T3 |
| R2 | T5,T7 | | R7 | T2 |
| R3 | T7 | | R8 | T3,T4 |
| R4 | T1,T2 | | R9 | T6 |
| R5 | T1,T2 | | R10 | T8 |
