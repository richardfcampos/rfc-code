# Tasks: profile-usage

| # | Task | Reqs | Done when | Status |
| --- | --- | --- | --- | --- |
| T1 | Tipos + fetcher claude (`usage/profile-usage.types.ts`, `usage/claude-usage-fetcher.ts`) | R2, R6 | creds ausente/expirado → unauthenticated; 401/403 → unauthenticated; 429/5xx/rede → unavailable; 200 → janelas normalizadas | done |
| T2 | Fetcher codex (`usage/codex-usage-fetcher.ts`) | R3, R6 | acha rollout mais novo, extrai último rate_limits do tail; sem sessões → unavailable | done |
| T3 | Service + cache + rota (`usage/profile-usage.service.ts`, `profiles.routes.ts`) | R1, R4, R7 | GET /api/profiles/:id/usage responde envelope; cursor/opencode supported:false; 2ª chamada <60s não refaz fetch | done |
| T4 | Testes server (`tests/profile-usage.test.ts`) | R1–R4, R6, R7 | casos do Done when de T1–T3 cobertos; suíte verde | done |
| T5 | Frontend: tipos + `ProfileUsageMeter.tsx` + integração no `ProfilesSettingsTab.tsx` + i18n en | R5 | card de perfil autenticado (claude/codex) mostra barras/estado; unsupported oculto | done |
| T6 | Gate final: `npm test` + `typecheck` + `lint` + `build` | — | tudo verde | done (355/355, typecheck 0, lint 0 erros, build EXIT 0) |
| T7 | Fix UAT: refresh de OAuth token (`usage/claude-token-refresh.ts`) — token expirado de perfil ocioso renovado via `platform.claude.com/v1/oauth/token` (fallback console.anthropic.com) e persistido no `.credentials.json`; 401 inesperado → 1 refresh+retry | R2, R6 | perfil autenticado ocioso mostra uso sem re-login | done (357/357) |

Dependências: T1→T3→T4; T2→T3; T5 após T3 (contrato); T6 por último.
