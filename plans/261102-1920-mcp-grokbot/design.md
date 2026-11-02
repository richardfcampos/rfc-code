# Design — Grokbot MCP

## 1. Arquitetura

```
Grokbot ──HTTP POST /api/grokbot-mcp (Bearer api key)──▶ grokbot-mcp.routes.ts
                                                            │ auth: apiKeysDb.validateApiKey (injetado)
                                                            ▼
                                                   grokbot-mcp.jsonrpc.ts  (initialize / tools/list / tools/call)
                                                            │
                                                   tool registry (tools/*.tools.ts, 1 arquivo por seção)
                                             ┌──────────────┼──────────────────┐
                                             ▼              ▼                  ▼
                                   rest-dispatcher.ts   chat-gateway.ts    shell-exec.ts
                                   (loopback HTTP →     (chatRunRegistry + (child_process)
                                    http://127.0.0.1:   spawnFns/abortFns/
                                    <porta>/api/…,      resolveToolApproval
                                    Bearer JWT do user)  injetados)
```

Módulo novo: `server/modules/grokbot-mcp/`

| Arquivo | Responsabilidade |
| --- | --- |
| `grokbot-mcp.types.ts` | `ToolDefinition { name, description, inputSchema, covers: string[], run(args, ctx) }`, `ToolContext { api, chat, shell }`, tipos de deps. |
| `grokbot-mcp.jsonrpc.ts` | Puro. `handleJsonRpc(message | message[], registry, ctx)` → resposta(s). Métodos: `initialize` (protocolVersion `2025-03-26`, `capabilities.tools`, `serverInfo {name:'rfc-code-grokbot'}`), `ping`, `tools/list`, `tools/call` (valida `required` do schema antes de chamar; erro de tool vira `result.isError=true`), `notifications/*` → sem resposta. Códigos -32700/-32600/-32601/-32602/-32000. |
| `grokbot-mcp.auth.ts` | Middleware Express: lê `Authorization: Bearer` ou `x-api-key`, chama `deps.validateApiKey`, põe `req.grokbotUser`. 401 em JSON-RPC error. |
| `grokbot-mcp.routes.ts` | `createGrokbotMcpRouter(deps)`: `POST /` → auth → jsonrpc; `GET` 405; `DELETE` 204. |
| `rest-dispatcher.ts` | `createRestDispatcher({ resolveBaseUrl, mintToken, extraHeaders })`. `dispatch({ method, path, query?, body?, multipart?, responseType?: 'json'|'bytes'|'sse', sseUntil? })`. Normaliza: envelope `{success,data}` → `data`; RAW → como veio; `success:false`/`{error}`/status ≥ 400 → `RestError {status, code, message}`. SSE: coleta eventos até predicado. Bytes: base64 + cap 20 MiB. Multipart: monta `FormData` nativo com `Blob`. |
| `chat-gateway.ts` | `createChatGateway({ spawnFns, abortFns, resolveToolApproval, getPendingApprovals, orgPolicy })`. `send` replica `handleChatSend` (worktree check, decideSpawnProfile via `orgPolicyService` do barrel orgs, `startRun`, fan-out para `connectedClients`, `completeRunIfCurrent`), com `wait`: Promise resolvida no evento `complete` (coleta `text` + `stream_end`), rejeita por timeout mantendo a run viva. `abort`, `events(afterSeq)`, `pending(sessionId)`, `approve(requestId, …)`, `status`. |
| `shell-exec.ts` | `runShellCommand({ cwd, command, timeoutMs ≤ 600000, maxOutputBytes })` via `spawn('bash', ['-lc', cmd])`; retorna `{ exitCode, stdout, stderr, timedOut, truncated }`. |
| `tools/<secao>.tools.ts` | Tabelas declarativas: cada tool = schema + `covers` + `run` que chama `ctx.api.dispatch(...)`. Helpers em `tools/tool-helpers.ts` (`str`, `optStr`, `optBool`, `optInt`, `enumOf`, `jsonTool`). |
| `tools/index.ts` | `buildToolRegistry()` concatena as seções e valida invariantes (nomes únicos). |
| `grokbot-mcp.module.ts` | Composition root: `grokbotMcpRoutes` (router já construído com deps reais) + `configureGrokbotMcpRuntime({ server, mintToken, spawnFns, abortFns, resolveToolApproval, getPendingApprovalsForSession })`. `resolveBaseUrl` lê `server.address()`; `0.0.0.0`/`::` → `127.0.0.1`; host específico (tailnet) → o próprio host. |
| `index.ts` | Barrel. |
| `README.md` | Como conectar, autenticar, lista de tools, exclusões. |

`server/index.js`: `app.use('/api/grokbot-mcp', grokbotMcpRoutes)` **antes** de qualquer `authenticateToken` genérico (mount próprio, como `/api/agent-bridge`); após `server.listen` → `configureGrokbotMcpRuntime({...})`. `generateToken`/`validateApiKey` vêm de `middleware/auth.js`/`apiKeysDb` passados pelo root (módulos não importam `middleware/`).

## 2. Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Loopback HTTP em vez de chamar services in-process | 150+ rotas com validação/erros/broadcast nos handlers (muitos legados em JS inline). Reimplementar = duplicar e divergir. Loopback custa ~1ms e garante paridade exata com a UI. |
| D2 | JWT por chamada (`generateToken(user)`), não passar a api key adiante | `/api/*` autentica por JWT; a key só prova quem é o bot. Em trusted/platform o JWT é ignorado — inofensivo. |
| D3 | Chat in-process (não loopback) | Chat é WS-only; abrir um WS para si mesmo seria mais frágil que reutilizar `chatRunRegistry` como reviews/automations já fazem. |
| D4 | JSON-RPC à mão, stateless, sem SSE | Mesmo padrão dos dois MCPs existentes; MCP Streamable HTTP permite resposta JSON simples; sem dependência nova. |
| D5 | Auth por `api_keys` do banco (Settings > API Tokens) | Mecanismo já existente com UI de criação/revogação; nunca em arquivo. |
| D6 | `covers` + teste de cobertura | "Todas as seções" vira asserção mecânica, não promessa. |
| D7 | `shell_exec` one-shot | Parity com a aba Shell sem PTY; cap de saída e timeout obrigatórios. |

## 3. Fluxos

**tools/call REST** — `session_rename {sessionId, summary}` → `dispatch({method:'PUT', path:'/api/providers/sessions/<id>', body:{summary}})` → fetch loopback com `Authorization: Bearer <jwt>` (+ `x-api-key` se `API_KEY` env) → `{success,data}` → `data` → `content:[{type:'text', text: JSON}]`.

**session_send wait=true** — valida sessão (`sessionsDb.getSessionById`), worktree existe, perfil via `orgPolicyService` (mesma função de `chat.send`), `startRun` com conexão fan-out, `spawnFn(content, options, run.writer)`; a conexão interceptora acumula eventos (`text`, `tool_use`, `error`, `complete`); resolve em `complete` ou rejeita em `timeoutMs` (a run continua; cliente usa `session_events`).

**project_clone** — `dispatch({responseType:'sse', path:'/api/projects/clone-progress', query:{...}, sseUntil: ev => ev.type==='complete'||ev.type==='error'})`; o JWT vai só no header `Authorization` (o dispatcher usa `fetch`, não `EventSource`; o middleware aceita header ou `?token=`).

## 4. Segurança

- Tudo exige api key ativa; `AUTH_MODE=trusted` não dispensa (bot ≠ pessoa no tailnet).
- `shell_exec` e `rfc_api_call` dão poder total ao portador da key — documentado no README; o escopo é o mesmo da UI logada.
- Loopback usa somente o endereço em que o servidor escuta; nunca uma URL de env.
- Caps: 20 MiB bytes/base64, 1 MiB de saída de shell, 600s timeout máx.

## 5. Modelos de execução (AD-012)
Fable orquestra. Workers: **opus** nas críticas (jsonrpc+auth+routes, dispatcher, chat-gateway, cobertura); **sonnet** nas tabelas de tools e testes mecânicos; **haiku** não usado.
