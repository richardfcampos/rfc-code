# Feature: profile-usage — plan-usage meters per profile

## Problem

O app existe para alternar entre contas quando limites de uso estouram (AD-013), mas a UI não mostra quanto de limite cada perfil já consumiu. O usuário pediu: "mostrar quanto temos de uso no nosso perfil".

## Interpretation (assumption, recorded)

"Uso" = **utilização dos limites do plano** por perfil (janela de 5h e semanal — o que `claude /usage` mostra), NÃO tokens por sessão (já existe em `/api/projects/:id/sessions/:id/token-usage`). Base: propósito multi-conta do produto + AD-013. Confiança ~85%; alternativa (agregado de tokens/custo estilo ccusage) fica como ideia futura.

## Requirements

| ID | Requirement |
| --- | --- |
| R1 | `GET /api/profiles/:id/usage` retorna snapshot normalizado de uso do plano do perfil |
| R2 | Perfis **claude**: consulta `GET https://api.anthropic.com/api/oauth/usage` com Bearer token do `.credentials.json` do perfil (headers `anthropic-beta: oauth-2025-04-20` + `User-Agent: claude-code/<ver>`) |
| R3 | Perfis **codex**: lê o último evento `token_count.rate_limits` do rollout JSONL mais recente em `<profileDir>/sessions/` |
| R4 | Perfis **cursor/opencode**: `supported: false` (sem fonte de dados conhecida); UI oculta a seção |
| R5 | UI: barras de uso no card do perfil em Settings > Profiles, carregadas para perfis autenticados |
| R6 | Falhas graciosamente degradadas — sem credencial/token expirado/escopo ausente (401/403) → `status: 'unauthenticated'`; rede/429/5xx/sem sessões codex → `status: 'unavailable'`; nunca 500 (exceto perfil inexistente → 404) |
| R7 | Cache server-side por perfil (TTL 60s) para não martelar o endpoint OAuth (429 conhecido sem User-Agent correto) |

## Success criteria

- Suíte `npm test` verde (novos testes cobrem R1–R4, R6, R7); `npm run typecheck`, `lint`, `build` limpos.
- Perfil claude autenticado exibe % das janelas 5h/semana com horário de reset.

## Out of scope

- Refresh de token OAuth (se expirado → pedir re-login).
- Agregado de tokens/custo por perfil (ccusage-style) — ideia futura.
- Polling/auto-refresh contínuo na UI (botão/reload manual + fetch on mount basta no MVP).
