# rfc CLI + session webhooks — Specification

## Problem

O agente externo (Grok Bot / James) opera o RFC Code pelo Grokbot MCP e gasta tokens demais: `project_list` devolve ~139 KB, acompanhar uma sessão exige poll de `session_events` (um frame por token) e não há aviso de "terminou". Objetivo: ler o resultado de uma sessão em poucas centenas de bytes e ser avisado por webhook quando a sessão parar.

## Goals

- `session_summary(sessionId, sinceSeq?)`: resumo compacto (status, tempos, resposta ≤1500 chars, git diff --stat, testes, último commit, branch).
- `project_list { compact: true }`: nome, caminho, sessões ativas, última atividade; sem worktrees vazias.
- CLI `rfc` na VPS (`send`, `status`, `result`, `sessions`, `notify-test`, `--json`) como cliente fino do MCP.
- Webhook em `running → idle | error | waiting_approval`, assinado (HMAC-SHA256), retry 3x com backoff, log consultável (`notification_deliveries`), endpoint de teste.

## Out of scope

| Item | Motivo |
| --- | --- |
| Mudar comportamento de qualquer tool existente | Restrição do pedido: só adicionar |
| Secret em log ou resposta | Restrição do pedido |
| UI em Settings para webhooks | Configuração é via MCP/CLI; UI fica para depois |

## User stories

### S1 session_summary
1. WHEN chamado com um `sessionId` THEN devolve `SessionSummary` (contrato em `server/modules/session-summary/session-summary.types.ts`).
2. WHEN a run está em memória THEN `response` vem dos eventos (após `sinceSeq`); WHEN já expirou THEN vem da última mensagem assistant do histórico persistido.
3. WHEN git falha (não é repo, cwd sumiu) THEN `git: null`, sem erro.
4. WHEN nenhum runner de testes é reconhecido na saída das tools THEN `tests: null`.
5. Status: `running` (run ativa) > `waiting_approval` (aprovação pendente) > `error` (última run falhou) > `idle`.

### S2 project_list compact
1. WHEN `compact: true` THEN cada item é `{ projectId, name, path, activeSessions, sessionsTotal, lastActivity }`.
2. WHEN o caminho está sob `*-worktrees/` e `sessionsTotal = 0` THEN o item é omitido.
3. WHEN `compact` é omitido THEN a resposta é idêntica à atual.

### S3 webhook
1. WHEN uma run termina THEN `session.idle` (exit 0 ou abort) ou `session.error` (exit ≠ 0) é despachado para cada endpoint `session_webhook` habilitado cujo filtro (events/projects/sessions) aceita.
2. WHEN chega `permission_request` numa run ativa THEN `session.waiting_approval`, uma vez por `requestId`.
3. Payload: `{ event, deliveryId, sentAt, sessionId, project, status, startedAt, finishedAt, lastSeq, summary }`; headers `X-RFC-Event`, `X-RFC-Delivery`, `X-RFC-Signature: sha256=<hex hmac(secret, body)>`.
4. Retry: 3 tentativas (1 s, 4 s, 16 s), timeout 5 s cada, sucesso = 2xx. Uma linha em `session_webhook_deliveries` por tentativa, sem payload e sem secret.
5. `notification_endpoint_upsert` aceita `url`, `secret`, `events`, `projects`, `sessions` com `channel: "session_webhook"`; secret omitido no update mantém o atual; toda leitura mascara (`hasSecret`, `secretLast4`).
6. `notification_deliveries(endpointId?, sessionId?, limit?)` lista entregas; `notification_endpoint_test(endpointId)` envia `session.test` pelo mesmo caminho.
7. Falha de webhook nunca afeta a sessão.

### S4 CLI
1. `rfc send <id> "<prompt>" | --file f` → `sent <id> seq=<n>`.
2. `rfc status <id>` ≤ 10 linhas. `rfc result <id> [--since n]`. `rfc sessions [--project nome]` uma linha por sessão. `rfc notify-test <endpointId>`.
3. `--json` em todos; erro → exit 1 com mensagem em stderr.
4. Config: `RFC_URL` / `RFC_API_KEY` ou `~/.rfc-code/rfc-cli.json`; default `http://localhost:7799`.

## Traceability

| ID | Story | Status |
| --- | --- | --- |
| RCW-01 | S1 | ✅ `server/modules/session-summary/`, tool `session_summary` |
| RCW-02 | S2 | ✅ `projects-compact-list.service.ts`, `GET /api/projects?compact=1` |
| RCW-03 | S3 | ✅ `session-lifecycle.events.ts`, `session-webhook-*.service.ts`, `session_webhook_deliveries` |
| RCW-04 | S4 | ✅ `server/rfc-cli/`, `install/templates/rfc` |
