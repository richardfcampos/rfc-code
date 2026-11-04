# Tasks — ownership is strict; a worker never edits another worker's files

| ID | Owner | What | Files |
| --- | --- | --- | --- |
| T1 | W1 | session-summary module (service, git, tests parser, barrel) + tool `session_summary` + `project_list compact` + tests | `server/modules/session-summary/**`, `server/modules/grokbot-mcp/tools/session-summary.tools.ts`, `server/modules/grokbot-mcp/tools/projects.tools.ts`, `server/modules/projects/**`, `server/modules/grokbot-mcp/tests/session-summary.tools.test.ts` |
| T2 | W2 | lifecycle events + registry emit, endpoints ext (route + tool), signature, dispatcher, deliveries db/migration, tools `notification_deliveries` / `notification_endpoint_test`, tests | `server/modules/websocket/services/session-lifecycle.events.ts`, `server/modules/websocket/services/chat-run-registry.service.ts`, `server/modules/websocket/index.ts`, `server/modules/notifications/**`, `server/modules/database/repositories/session-webhook-deliveries.db.ts`, `server/modules/database/{schema,migrations,index}.ts`, `server/modules/grokbot-mcp/tools/settings-notifications.tools.ts`, `server/modules/grokbot-mcp/tools/session-webhooks.tools.ts`, `server/modules/grokbot-mcp/tests/session-webhooks.tools.test.ts` |
| T3 | W3 | CLI `rfc` + install template + tests | `server/rfc-cli/**`, `install/templates/rfc`, `package.json` (bin only) |
| T4 | lead | `tools/index.ts` registration, `server/index.js` wiring, README + grokbot README + STATE, full gate, deploy | rest |
