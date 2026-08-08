# Design: profile-usage

## Data sources (verificadas)

- **Claude**: `GET https://api.anthropic.com/api/oauth/usage`. Headers: `Authorization: Bearer <accessToken>`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/<ver>` (sem ele, bucket agressivo de 429 — anthropics/claude-code#31021). Token: `<profileDir>/.credentials.json` → `claudeAiOauth.accessToken` (+ `expiresAt` ms). Exige escopo `user:profile` — tokens só com `user:inference` recebem 401/403 → `unauthenticated`. Resposta: objetos `five_hour`, `seven_day`, `seven_day_sonnet`, `seven_day_opus` com `{ utilization: 0–100, resets_at: ISO }`; `subscriptionType`/`rate_limit_tier` p/ plano. Parse defensivo: só janelas com `utilization` numérico.
- **Codex**: rollouts em `<profileDir>/sessions/YYYY/MM/DD/rollout-*.jsonl`; eventos `token_count` carregam `rate_limits: { primary: { used_percent, window_minutes, resets_in_seconds }, secondary: {...} }`. Estratégia: achar arquivo mais novo (walk dirs em ordem desc), ler tail (256KB), varrer linhas de trás pra frente até o primeiro `rate_limits`. `resetsAt` = timestamp do evento + `resets_in_seconds`; snapshot inclui `asOf` (timestamp do evento) porque dado é do último uso, não tempo-real.

## Normalized contract

```ts
type ProfileUsageWindow = {
  id: string;                 // 'five_hour' | 'seven_day' | 'seven_day_opus' | ... | 'primary' | 'secondary'
  label: string;              // '5h' | '7d' | '7d Opus' | ...
  utilization: number;        // 0–100
  resetsAt: string | null;    // ISO
};
type ProfileUsageSnapshot = {
  supported: boolean;
  status: 'ok' | 'unauthenticated' | 'unavailable';
  windows: ProfileUsageWindow[];
  plan: string | null;
  asOf: string | null;        // codex: timestamp do evento; claude: fetchedAt
  fetchedAt: string;
};
```

Envelope: `createApiSuccessResponse({ usage })`, mesmo padrão das outras rotas de profiles.

## Components

| Arquivo | Papel |
| --- | --- |
| `server/modules/profiles/usage/profile-usage.types.ts` | Contrato acima |
| `server/modules/profiles/usage/claude-usage-fetcher.ts` | R2 (creds → fetch → normalize) |
| `server/modules/profiles/usage/codex-usage-fetcher.ts` | R3 (walk sessions → tail → normalize) |
| `server/modules/profiles/usage/profile-usage.service.ts` | dispatch por provider + cache TTL 60s (R4, R7) |
| `server/modules/profiles/profiles.routes.ts` | `GET /:id/usage` (R1) |
| `src/components/profiles/view/ProfileUsageMeter.tsx` | fetch + barras (R5) |
| `src/components/profiles/view/ProfilesSettingsTab.tsx` | monta o meter no card autenticado |
| `src/components/profiles/types.ts` | tipos frontend do snapshot |
| `src/i18n/locales/en/settings.json` | chaves `profiles.usage.*` (demais locales caem no defaultValue) |

Injeção de rede/clock nos fetchers via parâmetro opcional (`fetchImpl`, `now`) p/ testes — sem mock global.

## Decisions

- Fica no módulo `profiles` (rota aninhada em perfil), não no `providers` — o dado é da conta, não da sessão.
- Sem flag em provider-capabilities: o próprio snapshot carrega `supported`; matriz de capabilities é do composer.
- Sem refresh de OAuth token (KISS; expirado → `unauthenticated`, badge de re-login já existe).
- Cache em memória no service (Map) — single-process, suficiente.
