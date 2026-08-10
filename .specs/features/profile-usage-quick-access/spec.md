# Profile Usage Quick Access

Acesso one-click, a partir do composer do chat, ao usage de plano de todos os perfis autenticados (Claude + Codex).

## Problem Statement

O usage de plano existe hoje apenas em Settings > Profiles (`ProfileUsageMeter`), um perfil por vez. O usuário quer ver, com um clique no chat, o usage de todos os perfis de uma vez — sem navegar até Settings. A fonte de dados só fornece snapshot de janelas de plano por perfil; "usage por modelo" se materializa nas janelas `7d Sonnet` / `7d Opus` do fetcher Claude, que devem ganhar destaque.

## Goals

- [ ] Botão no composer (ao lado do `ComposerModelMenu`) abre popover com usage de todos os perfis suportados
- [ ] Resposta imediata: cache na hora, `pending` para o resto, atualização tardia via WebSocket
- [ ] Nenhum perfil com falha derruba o lote
- [ ] Sem rajadas contra a API Anthropic (dedupe + negative cache + teto de concorrência)

## Out of Scope

| Item | Motivo |
|---|---|
| Histórico / série temporal / gráfico | Fonte só fornece snapshot |
| Custo em dinheiro | Fonte não fornece |
| Cursor / OpenCode | `supported: false` hard-coded na fonte |
| Polling periódico | Fetch só on-click; eventos tardios via WS já cobrem atualização |
| Autorização por usuário no WS | Não existe `userId` no módulo; gatilho registrado em Riscos (design.md) |

## Requirements

### Backend — agregação

| ID | Requirement |
|---|---|
| PUQ-01 | `profileUsageService.getAllUsage()` agrega perfis `supported` (claude+codex), agrupados por provider, perfil ativo do chat primeiro |
| PUQ-02 | Teto global de 4 fetches in-flight; sem limite por provider (contas Claude têm buckets distintos de rate-limit) |
| PUQ-03 | Dedupe in-flight via `Map<profileId, Promise>` — vale também para `getUsage` individual; sobrevive a aberturas consecutivas do popover |
| PUQ-04 | Retorno imediato do batch: `{ profileId, snapshot\|null, state: 'cached'\|'pending', retryAt? }[]` — envelope fora do snapshot |
| PUQ-05 | Deadline de renderização 5s: resposta HTTP volta em ≤5s; fetches em andamento continuam, gravam cache e emitem evento WS tardio |
| PUQ-06 | `AbortSignal` apenas em `requestUsage` (claude-usage-fetcher). Nunca em `claude-token-refresh` — janela POST→persistência é não-cancelável |

### Contrato

| ID | Requirement |
|---|---|
| PUQ-07 | `unavailable` carrega razão interna `rate_limited\|network\|server\|unknown` + `retryAfterMs` (parse do header `Retry-After`); `retryAt` derivado só no envelope público |
| PUQ-08 | Negative cache com cooldown ~15s, separado do TTL 60s de sucesso; nunca aplicado a `unauthenticated` |
| PUQ-09 | Refresh manual ignora TTL; bloqueado até `retryAt` apenas quando razão = `rate_limited`; caso contrário throttle 5s |

### Transporte

| ID | Requirement |
|---|---|
| PUQ-10 | Rota batch `GET /api/profiles/usage` registrada antes de `/:id/usage` (evitar captura por `:id`) |
| PUQ-11 | `broadcastProfileUsage` espelhando `broadcastProgress`; evento `kind: 'profile_usage'` com envelope PUQ-04 |
| PUQ-12 | Frontend descarta evento com `fetchedAt` mais antigo que o da linha exibida |

### Fetchers

| ID | Requirement |
|---|---|
| PUQ-13 | `fetchCodexUsage` migra IO síncrono (`readdirSync`/`statSync`/`readSync`) para `fs.promises` |

### Frontend

| ID | Requirement |
|---|---|
| PUQ-14 | Botão ao lado do `ComposerModelMenu`; popover abre e dispara fetch on-click; sem polling |
| PUQ-15 | Corpo do `ProfileUsageMeter.tsx` extraído para componente puro (recebe snapshot via props); reusado em Settings e no popover |
| PUQ-16 | Janelas `7d Sonnet` / `7d Opus` destacadas no popover (mais próximo do pedido "usage por modelo") |
| PUQ-17 | Caveat de `asOf` do Codex mantido (snapshot, não tempo-real) |
| PUQ-18 | Strings novas via i18n |

## Success Criteria

- [ ] Dois `getAllUsage()` concorrentes → ≤1 fetch por perfil e ≤4 in-flight
- [ ] Perfil deslogado não derruba o lote e não entra no negative cache
- [ ] `Retry-After` presente → botão travado até `retryAt`; timeout de rede → throttle 5s
- [ ] Evento WS com `fetchedAt` antigo descartado
- [ ] Abort do deadline não corta token refresh a meio
- [ ] `profile-usage.test.ts` estendido + lint + typecheck + build verdes
- [ ] Popover manual com 2 perfis Claude + 1 Codex renderiza cached/pending/tardio

## Requirement Traceability

Ver tasks.md — Cobertura.
