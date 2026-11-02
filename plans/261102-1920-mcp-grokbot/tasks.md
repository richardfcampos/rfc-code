# Tasks — Grokbot MCP

Gate por task: `npm run typecheck` limpo + testes da task verdes + `npm run lint` sem erro novo. Gate final: `npm test` completo (baseline 1376/1376) + smoke.

| ID | Task | Reqs | Modelo | Depende | Status |
| --- | --- | --- | --- | --- | --- |
| T1 | Esqueleto do módulo: `grokbot-mcp.types.ts`, `tools/tool-helpers.ts`, `tools/index.ts` (registro + invariantes), `index.ts` barrel, `grokbot-mcp.jsonrpc.ts` + testes do handler | R1, R10, R11 | opus | — | done |
| T2 | `grokbot-mcp.auth.ts` + `grokbot-mcp.routes.ts` + testes (401 sem/inválida/inativa; 405 GET; 204 DELETE; batch; tool inexistente) | R1, R2 | opus | T1 | done |
| T3 | `rest-dispatcher.ts` + testes com Express fixture (W, RAW, erro W, erro RAW, bytes, multipart, SSE, query encoding, `x-api-key`) | R3, R7, R8, R10 | opus | T1 | done |
| T4 | `chat-gateway.ts` + `shell-exec.ts` + testes (spawnFns fake; wait/timeout; abort; approve; events; shell timeout/cap) | R4, R5, R6 | opus | T1 | done |
| T5 | Tools: sistema, projetos, arquivos, sessões REST, assets (`system`, `projects`, `files`, `sessions`, `assets`) + testes de mapeamento | R9 §5.1–5.4, 5.18 | sonnet | T1, T3 | done |
| T6 | Tools: chat in-process + comandos + shell (`chat`, `commands`) + testes | R4–R6 | sonnet | T4 | done |
| T7 | Tools: worktrees, git (incl. compare), tasks, reviews + testes | §5.6–5.9 | sonnet | T1, T3 | done |
| T8 | Tools: automations, orgs, profiles, providers (auth/models/skills/mcp), plugins + testes | §5.10–5.14 | sonnet | T1, T3 | done |
| T9 | Tools: settings (api keys, credentials, notificações, notify-hub, endpoints, git identity, onboarding, browser-use), collab, team view, agent messages, taskmaster/prd/preview + testes | §5.15–5.17 | sonnet | T1, T3 | done |
| T10 | `grokbot-mcp.module.ts` (composition root) + mount em `server/index.js` + `configureGrokbotMcpRuntime` + README | R1–R3, N1 | opus | T2, T3, T4, T5–T9 | done |
| T11 | Teste de cobertura de rotas (scanner de `routes/*.js`, `modules/**/*.routes.ts`, inline `index.js`) vs `covers` + exclusões | R9, D6 | opus | T5–T9 | done |
| T12 | Smoke `scripts/smoke/grokbot-mcp-smoke.mjs` + execução; gate final (`npm test`, typecheck, lint); atualizar `plans/.../tasks.md` e `.specs/STATE.md` handoff | §7 | opus | T10, T11 | done |

## Execução (2026-11-02)
- T1 pelo orquestrador (contratos); T2/T3/T4 opus, T5–T9 sonnet em paralelo (8 workers); T10/T11/T12 pelo orquestrador.
- Ajustes pós-workers: `grokbotMcpErrorHandler` montado após o router em `server/index.js` (parse error → -32700); `chat-gateway-turn-effects.ts` dá ao `session_send` o mesmo título/primer/handoff do `chat.send`; `chat-gateway-connection.ts` extraído (limite de 200 linhas).
- Revisão independente (opus): 0 críticos, 2 majors, 17 minors. Aplicados: `null` em arg obrigatório aceito (reset de caveman funcionava só na UI), cap de bytes/SSE por streaming (sem buffer inteiro na memória), `redirect: 'manual'`, `%2e` e `..` recusados em `rfc_api_call`/`seg()`, run não fica presa se o spawn lança, `approveTool` reporta `UNKNOWN_REQUEST`, `wait` devolve só os 100 últimos eventos, `userId` da key chega às notificações, shell não trava com neto daemonizado, batch ≤ 20 e sequencial, timeouts de 10 min nas rotas com subprocesso, mensagem genérica em erro pré-auth. Descartados com motivo: fan-out para todos os sockets (instalação single-user, mesmo padrão do Review Center); AbortController por request (YAGNI).
- Gate final: módulo 273/273; cobertura de rotas 4/4 (0 rotas sem dono); smoke real 21/21 (199 tools); suíte completa verde; typecheck cliente+servidor limpos; ESLint 0 erros.
- Incidente: sessão Claude duplicada no mesmo worktree (`wt-mcp-grokbot-96`) começou a mesma feature em paralelo; recuou e deixou `plans/251102-1925-mcp-grokbot/` (não commitado por mim).

## Ondas
- Wave 1: T1
- Wave 2: T2, T3, T4 [P]
- Wave 3: T5, T7, T8, T9 [P] (dependem de T3) · T6 (depende de T4)
- Wave 4: T10, T11 [P]
- Wave 5: T12

## Traceability
| Req | Tasks |
| --- | --- |
| R1 | T1, T2, T10 |
| R2 | T2, T10 |
| R3 | T3, T10 |
| R4, R5 | T4, T6 |
| R6 | T4, T6 |
| R7, R8 | T3, T5, T7 |
| R9 | T5–T9, T11 |
| R10, R11 | T1 |
| N1–N5 | T10, T12 |
