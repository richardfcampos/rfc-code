# Tasks — Profile Usage Quick Access

## T1 — Contrato + razão de erro no fetcher Claude

- **What**: adicionar `reason`/`retryAfterMs` ao snapshot `unavailable`; tipo `ProfileUsageEnvelope`; mapear 429→`rate_limited` (parse `Retry-After`), 5xx→`server`, erro de rede→`network`, resto→`unknown`
- **Where**: `server/modules/profiles/types/profile-usage.types.ts`, `server/modules/profiles/services/claude-usage-fetcher.ts`
- **Reuses**: `requestUsage` existente (~127-135), coleta de status em ~153-155/~168-171
- **Depends on**: —
- **Done when**: fetcher devolve razão observada + `retryAfterMs`; nenhum header cru sai do fetcher; typecheck verde
- **Tests**: unit fetcher (429+Retry-After, 500, reject)
- **Requisitos**: PUQ-07
- **Status**: done (paths reais em `server/modules/profiles/usage/`; `FetchLike.headers` virou opcional p/ compat com mocks)

## T2 — Codex fetcher async IO

- **What**: migrar `readdirSync`/`statSync`/`openSync`/`readSync` para `fs.promises` (readdir recursivo + tail 256KB)
- **Where**: `server/modules/profiles/services/codex-usage-fetcher.ts`
- **Reuses**: lógica atual de descend + tail (~30-77)
- **Depends on**: — (∥ T1)
- **Done when**: zero IO síncrono no arquivo; testes existentes verdes
- **Tests**: existentes do codex fetcher
- **Requisitos**: PUQ-13
- **Status**: done (path real: `server/modules/profiles/usage/codex-usage-fetcher.ts`)

## T3 — Service: dedupe, negative cache, getAllUsage

- **What**: `inflight Map<profileId, Promise>`; negative cache (15s / `retryAfterMs`; nunca `unauthenticated`); `getAllUsage(activeProfileId?)` com semáforo global 4, ordenação (ativo primeiro, agrupado por provider), deadline render 5s, envelope `cached|pending`; força (`force`) com regra lockout/throttle; callback de conclusão tardia para broadcast
- **Where**: `server/modules/profiles/services/profile-usage.service.ts`
- **Reuses**: cache TTL 60s existente, `unsupportedSnapshot()`, comentário ~79 (preservar semântica `unauthenticated`)
- **Depends on**: T1
- **Done when**: critérios de spec PUQ-01..06, 08, 09; typecheck verde
- **Tests**: unit service (concorrência, teto, deadline, negative cache, force)
- **Requisitos**: PUQ-01..06, PUQ-08, PUQ-09
- **Status**: pending

## T4 — Rota batch + broadcast WS

- **What**: `GET /api/profiles/usage` (+`?force=1`) antes de `/:id/usage`; `broadcastProfileUsage` espelhando `broadcastProgress`; evento `kind: 'profile_usage'`
- **Where**: `server/modules/profiles/profiles.routes.ts`, serviço de broadcast (junto a `websocket-state.service.ts`), wiring do callback tardio de T3
- **Reuses**: `connectedClients`, padrão `broadcastProgress` (`projects-with-sessions-fetch.service.ts:178-189`)
- **Depends on**: T3
- **Done when**: rota devolve envelope imediato; fetch tardio emite evento; typecheck verde
- **Tests**: route test (envelope, ordem de registro), broadcast chamado em conclusão tardia
- **Requisitos**: PUQ-04, PUQ-10, PUQ-11
- **Status**: pending

## T5 — Frontend: componente puro + popover + demux

- **What**: extrair `ProfileUsageMeterBody` puro de `ProfileUsageMeter.tsx`; botão + `ComposerUsagePopover` ao lado de `ComposerModelMenu`; fetch on-click; linhas pending; `case 'profile_usage'` no demux (`useChatRealtimeHandlers.ts` ~163, `useProjectsState.ts` ~628); descarte por `fetchedAt`; destaque `7d Sonnet`/`7d Opus`; caveat `asOf`; i18n
- **Where**: `src/components/profiles/view/ProfileUsageMeter.tsx`, `src/components/chat/view/subcomponents/` (novo popover), `src/components/chat/view/ChatInterface.tsx`, `src/components/chat/hooks/useChatRealtimeHandlers.ts`, `src/components/main-content/**/useProjectsState.ts`, `src/i18n/`
- **Reuses**: render de barras do meter atual; padrão de portal do `ComposerModelMenu` (MODEL-04)
- **Depends on**: T4 (tipos do envelope/evento); extração do componente puro pode começar ∥ T3
- **Done when**: popover funcional com cached/pending/tardio; Settings inalterado visualmente; typecheck+lint verdes
- **Tests**: build + smoke manual (gate T7)
- **Requisitos**: PUQ-12, PUQ-14..18
- **Status**: partial — extração (PUQ-15) done: `ProfileUsageMeterBody.tsx` puro (props `snapshot`/`provider` + `isLoading`/`failed`/`onRefresh` passivos); resto pendente de T4

## T6 — Testes server

- **What**: estender `profile-usage.test.ts` + novos testes de T1/T3/T4 conforme design.md → Testes
- **Where**: `server/modules/profiles/tests/`
- **Depends on**: T3, T4
- **Done when**: todos os casos da tabela de testes cobertos e verdes
- **Requisitos**: cobertura PUQ-01..11, 13
- **Status**: pending

## T7 — Gate

- **What**: `npm test`, typecheck, lint, build — tudo verde; smoke manual popover (2 Claude + 1 Codex)
- **Depends on**: T5, T6
- **Status**: pending

## T8 — Review

- **What**: code review adversarial do diff completo (segurança do broadcast, corrida de token refresh, regressão Settings)
- **Depends on**: T7
- **Status**: pending

## Ordem

```
T1 ∥ T2
  │
  T3 ──────────┐
  │            │ (T5a extração ∥ T3)
  T4 ── T5 ── T6
        │      │
        └── T7 ┘
             │
            T8
```

## Cobertura

18 requisitos (PUQ-01..18), 18 mapeados, 0 órfãos.
