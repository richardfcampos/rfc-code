# Design — Profile Usage Quick Access

## Princípio

Nada de fetcher novo nem scheduler: o trabalho é **agregação sobre o serviço existente** (`profile-usage.service.ts`) + **transporte tardio** pelo broadcast WS já usado por `loading_progress`/`session_upserted`. Resposta HTTP nunca espera fetch lento — devolve cache + `pending` e o resto chega por evento.

## Arquitetura

### Service (`server/modules/profiles/services/profile-usage.service.ts`)

- `inflight: Map<profileId, Promise<ProfileUsageSnapshot>>` — criado antes do await, removido em `finally`. Dedupe entre chamadas concorrentes (batch×batch, batch×individual) e entre aberturas do popover.
- `getAllUsage(activeProfileId?)`:
  1. Lista perfis, filtra suportados (claude+codex), ordena: perfil ativo primeiro, depois agrupado por provider.
  2. Para cada perfil: cache válido → `{ state: 'cached', snapshot }`. Negative cache vigente → `cached` com snapshot de erro + `retryAt`. Senão dispara fetch (via `inflight`) sob semáforo global de 4.
  3. `Promise.race` com deadline de 5s (render deadline, não work deadline): o que resolveu entra como `cached`, o resto sai `pending` e continua rodando.
  4. Fetch tardio completa → grava cache → `broadcastProfileUsage(envelope)`.
- Negative cache: entrada `{ snapshot, cooldownUntil }` para `status === 'unavailable'`; cooldown 15s, ou `retryAfterMs` quando razão `rate_limited`. **Nunca** para `unauthenticated` — comentário existente na linha ~79 já protege esse caso; preservar.
- Refresh manual (`?force=1` na rota batch): ignora TTL; se negative cache com razão `rate_limited` e `retryAt` futuro → responde travado com `retryAt`; senão throttle 5s por perfil.

### Contrato (`profile-usage.types.ts`)

```ts
// interno ao snapshot 'unavailable'
reason?: 'rate_limited' | 'network' | 'server' | 'unknown'
retryAfterMs?: number

// envelope público (rota batch + evento WS)
interface ProfileUsageEnvelope {
  profileId: string
  state: 'cached' | 'pending'
  snapshot: ProfileUsageSnapshot | null
  retryAt?: string // ISO, derivado de retryAfterMs no momento da resposta
}
```

`claude-usage-fetcher.ts`: em `!response.ok`, mapear `429 → rate_limited` (+ parse `Retry-After` em segundos ou HTTP-date), `5xx → server`; catch de rede → `network`; resto → `unknown`. Header cru nunca sai do fetcher.

### Transporte

- `broadcastProfileUsage` em serviço novo ou junto ao state (`websocket-state.service.ts` expõe `connectedClients`), espelhando `broadcastProgress` de `projects-with-sessions-fetch.service.ts:178-189`.
- Evento: `{ kind: 'profile_usage', envelope }`.
- Demux frontend: `case 'profile_usage'` em `useChatRealtimeHandlers.ts` (~163) e passagem em `useProjectsState.ts` (~628) — mesmo caminho de `loading_progress`.
- Anti-regressão de ordem: consumidor compara `snapshot.fetchedAt`; evento mais antigo que a linha atual é descartado.

### Frontend

- `ProfileUsageMeterBody` (novo, puro): recebe `snapshot` via props; extraído do corpo de `ProfileUsageMeter.tsx` (hoje faz fetch próprio — vira wrapper Settings que busca e delega render).
- `ComposerUsagePopover` (novo): botão ícone ao lado de `ComposerModelMenu` em `ChatInterface`; on-click → `GET /api/profiles/usage` → render imediato; linhas `pending` com spinner; eventos `profile_usage` atualizam linhas.
- Destaque `7d Sonnet`/`7d Opus`; caveat `asOf` Codex.

## Decisões

| # | Decisão | Motivo |
|---|---|---|
| 1 | Fan-out dentro de `getAllUsage()`, não na rota | Rota fica fina; dedupe/semáforo pertencem ao serviço |
| 2 | Divergência (a) do debate resolvida: lockout só com `reason: 'rate_limited'` + `retryAt` real; resto throttle 5s | Sem estender o contrato, lockout é inimplementável — fetcher hoje descarta `response.status`. Após extensão, as duas posições coincidem |
| 3 | Divergência (b): deadline de render 5s | Meio-termo entre 3s (UX) e 10s (timeout de request); é deadline de render — trabalho continua e chega por WS, então custo de errar pra baixo é pequeno |
| 4 | Rota batch registrada antes de `/:id/usage` | Express casa `/usage` em `/:id` se ordem errada |
| 5 | Broadcast irrestrito (sem filtro por conexão) | `connectedClients` é app-wide e `session_upserted` já publica sem filtro; polling não criaria isolamento que não existe |
| 6 | Sem limite por provider no semáforo | Credencial por profileDir; buckets de rate-limit distintos por conta |
| 7 | `Date`/`retryAt` derivados no momento da resposta, não persistidos crus | Header `Retry-After` é relativo; ISO absoluto no envelope |

## Testes

| Alvo | Tipo | Casos |
|---|---|---|
| `getAllUsage` | unit (server) | 2 chamadas concorrentes → 1 fetch/perfil; teto 4; perfil `unauthenticated` não entra em negative cache nem derruba lote; deadline devolve `pending`; ordenação (ativo primeiro) |
| negative cache | unit | `rate_limited` respeita `retryAfterMs`; `network` cooldown 15s; `unauthenticated` nunca cacheado; force com `rate_limited` → travado; force com `network` → throttle 5s |
| claude fetcher | unit | 429+`Retry-After` → `reason: 'rate_limited'` + `retryAfterMs`; 500 → `server`; fetch reject → `network` |
| codex fetcher | unit | comportamento idêntico pós-migração `fs.promises` (testes existentes seguem verdes) |
| demux | existing pattern | `profile_usage` roteado; evento `fetchedAt` antigo descartado |

## Riscos

| Risco | Mitigação |
|---|---|
| CLI escreve no mesmo `.credentials.json` — corrida de rotação de token | Limiter in-process **reduz** mas não fecha a corrida; documentado aqui; nunca abortar `claude-token-refresh` a meio (PUQ-06) |
| Broadcast irrestrito vaza dados se app virar multi-user | Gatilho explícito: se `profiles` ganhar `userId`, `/ws` servir usuários distintos, ou snapshot incluir custo/ID de conta → eventos exigem autorização e roteamento por conexão |
| `Retry-After` ausente em 429 | Fallback cooldown 15s padrão |
| Evento tardio após popover fechado | Estado no hook do popover morre no unmount; evento é ignorado sem erro |
