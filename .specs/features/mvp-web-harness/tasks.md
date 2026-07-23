# RFC Code MVP Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/mvp-web-harness/design.md`
**Status**: Draft (aguardando aprovação)

---

## Test Coverage Matrix

> Generated from codebase (clone de verificação CloudCLI v1.36.3), guidelines e spec. Upstream: 25 arquivos `*.test.{js,ts}` usando **node:test** (ex.: `server/opencode-cli.test.js:5`), sem script `test` no `package.json` e sem step de teste no CI. T2 pinou os comandos reais (ver Gate Check Commands abaixo).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Server modules/services (profiles, handoff, webhook, auth-mode) | unit (node:test) | Todos os branches; 1:1 com ACs do spec; edge cases listados | `server/**/*.test.{js,ts}` co-locado | `npm test` |
| Server routes (profiles CRUD) | unit c/ mocks (padrão upstream) | Happy + edge + error paths por rota | `server/**/*.test.{js,ts}` | `npm test` |
| Migrations/schema | unit (abre DB efêmero, valida schema) | Criação + idempotência | `server/modules/database/*.test.ts` | `npm test` |
| Frontend components | none — build+lint gate + UAT | — (padrão upstream: zero testes front; validação via UAT interativo) | — | `npm run build` |
| Deploy (Docker/compose) | smoke manual scriptado | Checklist de AC do HUB-07 | `deploy/smoke-test.sh` | execução manual no intel |

## Parallelism Assessment

> Generated from codebase — confirm before Execute.

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --- | --- | --- | --- |
| node:test (server) | Não determinado → tratar como sequencial | DB better-sqlite3 em path fixo (`~/.cloudcli/auth.db`); testes upstream usam mocks, mas isolamento de DB não comprovado | `server/load-env.js:30` (path global) |
| Build/lint | Yes | Sem estado compartilhado | — |

**Consequência:** `[P]` abaixo é apenas ordem-livre de implementação; execução de testes sempre sequencial.

## Gate Check Commands

> Pinados em T2 — comandos reais do repo, confirmados rodando localmente (Node v22.23.1, conforme `.nvmrc`).

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com unit tests | `npm test` |
| Full | Tasks que tocam rotas/integração | `npm test && npm run build` |
| Build | Tasks só de UI/config/deploy | `npm run build` (lint disponível via `npm run lint`, não incluído no gate padrão — script pré-existente do upstream) |

**Comando `test` (`package.json`)**: `tsx --tsconfig server/tsconfig.json --test "server/**/*.test.js" "server/**/*.test.ts"` — usa `tsx` (já devDependency upstream) para suportar os testes `.ts` co-locados via `node:test` nativo, resolvendo o alias `@/` de `server/tsconfig.json`.

**Baseline (T2, 2026-07-23)**: 129 testes (`test()`) em 25 arquivos `server/**/*.test.{js,ts}` — **129 passed, 0 failed**. Nenhuma falha pré-existente encontrada; suíte 100% verde na primeira execução após adicionar o script. `npm run build` verde (warnings pré-existentes de CSS minify e chunk size — não bloqueantes, não tocados).

---

## Execution Plan

### Phase 1 — Fundação do fork (Sequential): T1 → T2
### Phase 2 — Perfis multi-conta HUB-05 (após P1): T3 → T4 → T5; T6, T7, T8 [P entre si, após T4]; T9 (após T6-T8); T10, T11, T12 [P entre si, após T5/T9]
### Phase 3 — Acesso trusted HUB-01 (após P1; independe de P2): T13 → T14
### Phase 4 — Deploy HUB-07 (após P2+P3): T15 → T16 → T17
### Phase 5 — Integrações P2 HUB-09/12/10 (após P4): T18; T19 → T20; T21

> Verifier automático roda após a última task (não é task). UAT interativo (Complex, user-facing) incluído em T17/T21.

---

## Task Breakdown

### T1: Estabelecer o fork

**What**: Fork `siteboon/claudecodeui` no GitHub do usuário (nome `rfc-code`), clone em `/Volumes/External Code/INTEL/Code/personal/rfc-code` preservando `.specs/`, branch `rfc-code` criada a partir de `main`, README com nota de atribuição "Based on CloudCLI UI (https://github.com/siteboon/claudecodeui)" + marca de versão modificada (AD-008).
**Where**: raiz do repo, `README.md`
**Depends on**: None | **Reuses**: upstream inteiro | **Requirement**: infra (AD-008/AD-009)
**Tools**: MCP: NONE; Skill: NONE (gh CLI)
**Done when**:
- [x] `git remote -v` mostra fork (origin) + upstream
- [x] Branch `rfc-code` ativa; `.specs/` commitado nela
- [x] README com atribuição AGPL Seção 7
- [x] `npm install` completa sem erro
**Tests**: none | **Gate**: build (install) | **Commit**: `chore: establish rfc-code fork with attribution` — `df9c125`
**Status**: ✅ Done (2026-07-23)

### T2: Baseline de build e testes

**What**: Adicionar script `test` (node:test sobre `server/**/*.test.*`), rodar suíte inteira e registrar contagem baseline; garantir `npm run build` verde; pinar comandos reais nas seções Gate/Matrix acima.
**Where**: `package.json`, este arquivo (atualizar comandos)
**Depends on**: T1 | **Reuses**: 27 testes upstream existentes
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [x] `npm test` executa e passa (falhas pré-existentes documentadas, nunca deletadas)
- [x] Contagem baseline registrada aqui: **129 testes, 129 passed, 0 failed** (nenhuma falha pré-existente)
- [x] `npm run build` verde
**Tests**: none (habilita os demais) | **Gate**: full | **Commit**: `test: add test script and record baseline`
**Status**: ✅ Done (2026-07-23)

### T3: Migration profiles

**What**: Tabela `profiles` (id, provider, name, slug, created_at) + coluna `sessions.profile_id` (nullable) via mecanismo de migration do upstream.
**Where**: `server/modules/database/schema.ts` (+ arquivo de teste co-locado)
**Depends on**: T2 | **Reuses**: padrão de schema/migrations existente (`schema.ts:99-120`)
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [x] Migration cria tabela+coluna em DB efêmero; re-execução é idempotente
- [x] Gate passa; test count ≥ baseline + novos
**Tests**: unit | **Gate**: quick | **Commit**: `feat(profiles): add profiles table and sessions.profile_id` — `604ca3a`
**Status**: ✅ Done (2026-07-23) — 133 tests (baseline 129 + 4)

### T4: Profiles service

**What**: `server/modules/profiles/profiles.service.ts`: `createProfile`, `listProfiles`, `deleteProfile`, `resolveEnv(profileId)` (Claude→`CLAUDE_CONFIG_DIR`; Codex→`CODEX_HOME`; Cursor→`HOME`; OpenCode→`XDG_CONFIG_HOME`+`XDG_DATA_HOME`; dirs sob `/data/profiles/<provider>/<slug>`), `getAuthStatus(profileId)` (verifica credencial no dir).
**Where**: `server/modules/profiles/` (novo) + testes co-locados
**Depends on**: T3 | **Reuses**: padrão de módulos `server/modules/providers/`
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Testes 1:1 com HUB-05 AC1/AC3/AC4 (isolamento de env entre perfis; status não-autenticado)
- [ ] Gate passa; sem regressão de contagem
**Tests**: unit | **Gate**: quick | **Commit**: `feat(profiles): profile registry service with env resolution`

### T5: Profiles routes

**What**: Rotas REST `/api/profiles` (GET/POST/DELETE + GET status) montadas no server, protegidas pelo auth middleware existente.
**Where**: `server/modules/profiles/profiles.routes.ts`, mount em `server/index.js` (patch mínimo)
**Depends on**: T4 | **Reuses**: padrão `provider.routes.ts`
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Happy + error paths (perfil inexistente, provider inválido, delete com sessões ativas) testados
- [ ] Gate passa
**Tests**: unit (rotas c/ mocks, padrão upstream) | **Gate**: full | **Commit**: `feat(profiles): REST routes`

### T6: Env-injection Claude + dispatch profileId [P]

**What**: `profileId` aceito no options do dispatch (WS `server/index.js:112-117` e SSE `server/routes/agent.js:956-1000`) e aplicado em `sdkOptions.env` (`server/claude-sdk.js:167`) via `resolveEnv`.
**Where**: 3 patches cirúrgicos + teste
**Depends on**: T4 | **Reuses**: `resolveEnv` (T4)
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Sessão criada com `profileId` recebe `CLAUDE_CONFIG_DIR` correto (teste unit no builder de options)
- [ ] Sem `profileId` → comportamento upstream intacto (retrocompat)
- [ ] Gate passa
**Tests**: unit | **Gate**: quick | **Commit**: `feat(profiles): claude env injection + dispatch profileId`

### T7: Codex profile support (spike + implementação) [P]

**What**: SPIKE: verificar se `@openai/codex-sdk` propaga env/`CODEX_HOME` (docs + código do pacote). Se sim → injetar em `server/openai-codex.js:260`; se não → fallback spawn direto do CLI `codex` com env isolado (copiar padrão `cursor-cli.js`). Resultado do spike documentado no design.md (Risks resolvido).
**Where**: `server/openai-codex.js` (ou novo `codex-cli.js`) + teste
**Depends on**: T4 | **Reuses**: padrão `cursor-cli.js` se fallback
**Tools**: MCP: NONE; Skill: `docs-seeker` (docs do codex-sdk)
**Done when**:
- [ ] Spike documentado com evidência (nunca suposição)
- [ ] 2 perfis Codex concorrentes não vazam env entre si (teste)
- [ ] Gate passa
**Tests**: unit | **Gate**: quick | **Commit**: `feat(profiles): codex profile isolation`

### T8: Env-injection Cursor + OpenCode [P]

**What**: Aplicar `resolveEnv` em `server/cursor-cli.js:138` e `server/opencode-cli.js:271`.
**Where**: 2 patches + testes
**Depends on**: T4 | **Reuses**: `resolveEnv`
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Env correto por perfil nos 2 spawns (testes); retrocompat sem profileId
- [ ] Gate passa
**Tests**: unit | **Gate**: quick | **Commit**: `feat(profiles): cursor and opencode env injection`

### T9: Synchronizers profile-aware

**What**: Session synchronizers varrem roots por perfil (além de `~`) e gravam `profile_id` na tabela `sessions`; sessões existentes seguem com `profile_id` null.
**Where**: `server/modules/providers/list/*/*-session-synchronizer.provider.ts` (4 patches) + testes
**Depends on**: T6, T7, T8 | **Reuses**: synchronizers upstream
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Sessão criada via perfil aparece indexada com `profile_id` correto (teste com dirs efêmeros)
- [ ] Gate passa
**Tests**: unit | **Gate**: full | **Commit**: `feat(profiles): profile-aware session sync`

### T10: UI página de perfis [P]

**What**: `src/components/profiles/`: listar perfis por provider c/ status auth, criar (provider+nome), excluir. Padrões visuais do upstream (Tailwind, componentes existentes).
**Where**: `src/components/profiles/` (novo) + rota/menu
**Depends on**: T5 | **Reuses**: padrões de `src/components/mcp/`
**Tools**: MCP: NONE; Skill: `frontend-development` se necessário
**Done when**:
- [ ] CRUD funcional contra API; status visível (HUB-05 AC3)
- [ ] Build verde
**Tests**: none (build gate + UAT) | **Gate**: build | **Commit**: `feat(profiles): profiles management UI`

### T11: Login guiado via terminal web [P]

**What**: Botão "autenticar" no perfil abre o terminal web (shell WS existente) com env do perfil pré-injetado + comando sugerido (`claude /login`, `codex login`, etc.). Resolve OAuth interativo 1x por conta.
**Where**: `src/components/profiles/` + patch no shell WS p/ aceitar env extra (`shell-websocket.service.ts`)
**Depends on**: T5 | **Reuses**: terminal xterm+node-pty upstream
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Terminal abre com env do perfil (verificável via `echo $CLAUDE_CONFIG_DIR`)
- [ ] Build verde; teste unit do patch no shell service (env extra aplicado)
**Tests**: unit (server patch) | **Gate**: full | **Commit**: `feat(profiles): guided auth via web terminal`

### T12: Seletor de perfil na sessão + badge [P]

**What**: Dropdown de perfil na criação de sessão (junto do seletor de provider) + badge do perfil ativo no header da sessão (HUB-05 AC2: ≤3 cliques).
**Where**: `src/components/chat/hooks/useChatProviderState.ts`, `ProviderSelectionEmptyState.tsx`, header da sessão
**Depends on**: T5, T9 | **Reuses**: seletor de provider upstream (README providers 85-89)
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Fluxo criar-sessão-com-perfil em ≤3 cliques; badge visível
- [ ] Build verde
**Tests**: none (build gate + UAT) | **Gate**: build | **Commit**: `feat(profiles): session profile selector and badge`

### T13: AUTH_MODE=trusted (runtime)

**What**: Modo `AUTH_MODE=trusted` no server: pula JWT em HTTP e WS, auto-seed de user no boot se DB vazio, e guard que RECUSA subir se bind não for 127.0.0.1/loopback (HUB-01 AC2).
**Where**: `server/middleware/auth.js`, `server/index.js` (boot) + testes
**Depends on**: T2 | **Reuses**: blocos `IS_PLATFORM` existentes como referência
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Testes: trusted+loopback sobe sem auth; trusted+bind público aborta com erro claro; modo default intacto
- [ ] Gate passa
**Tests**: unit | **Gate**: quick | **Commit**: `feat(auth): runtime trusted mode for tailnet deployments`

### T14: Front sem tela de login em trusted

**What**: Front consulta `/api/auth/status` (existente) e pula login quando server em trusted — sem depender de flag build-time `VITE_IS_PLATFORM`.
**Where**: `src/utils/api.js`, `src/contexts/WebSocketContext.tsx` (patches mínimos)
**Depends on**: T13 | **Reuses**: fluxo `needsSetup` existente
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Com server trusted, UI entra direto; modo normal inalterado
- [ ] Build verde
**Tests**: none (build gate + UAT) | **Gate**: build | **Commit**: `feat(auth): skip login UI when server is trusted`

### T15: Dockerfile

**What**: `deploy/Dockerfile`: node:22, instala CLIs (`@anthropic-ai/claude-code`, `@openai/codex`, `opencode-ai`, cursor-agent — método verificado na task), builda o app, user não-root, entrypoint `AUTH_MODE=trusted`-ready.
**Where**: `deploy/Dockerfile` (dir novo — zero conflito upstream)
**Depends on**: T12, T14 | **Reuses**: `docker/shared/*.sh` upstream como referência
**Tools**: MCP: NONE; Skill: `devops` se necessário
**Done when**:
- [ ] `docker build` verde; `docker run` local serve a UI; 4 CLIs presentes no PATH (`--version`)
**Tests**: none | **Gate**: build (image) | **Commit**: `feat(deploy): production dockerfile with agent CLIs`

### T16: docker-compose + smoke script

**What**: `deploy/docker-compose.yml` (volumes: `/projects` [raiz de projetos], `/data` [db+profiles]; `ports: 127.0.0.1:PORT:PORT`; restart unless-stopped; envs documentados) + `deploy/smoke-test.sh` (checklist HUB-07 ACs) + `deploy/README.md` (inclui setup `tailscale serve`).
**Where**: `deploy/`
**Depends on**: T15 | **Reuses**: —
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] `docker compose up -d` local ok; restart preserva DB/perfis (HUB-07 AC2 via smoke script)
**Tests**: smoke script | **Gate**: build | **Commit**: `feat(deploy): compose, smoke test and tailscale docs`

### T17: Deploy no intel + validação de dispositivos

**What**: Executar deploy real no intel: compose up, `tailscale serve`, login das contas reais (via T11), smoke test + UAT interativo com o usuário (laptop + tablet) cobrindo HUB-01/02/07 e caminho feliz de HUB-03/05/06.
**Where**: intel (operacional) — requer acesso do usuário
**Depends on**: T16 | **Reuses**: smoke script T16
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] URL tailnet acessível de laptop e tablet; fora da tailnet inacessível
- [ ] 2+ contas Claude autenticadas; sessão real completada de cada dispositivo
- [ ] `docker compose restart` durante sessão → estado consistente (HUB-07 AC3)
**Tests**: UAT interativo | **Gate**: smoke | **Commit**: `docs(deploy): record intel deployment` (se houver ajuste de config)

### T18: Canal webhook notify-hub [P]

**What**: Canal `webhook` no notification orchestrator (`notification-orchestrator.service.js:209-222`): POST ao notify-hub em `run.stopped`, `run.failed`, `permission.required` (pendente >60s), config via env (`NOTIFY_URL`/`NOTIFY_TOKEN`), fire-and-forget timeout 5s.
**Where**: `server/modules/notifications/` + teste
**Depends on**: T2 | **Reuses**: registry de canais plugável upstream
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Testes: payload correto por evento; notify-hub fora do ar não afeta sessão (HUB-09)
- [ ] Gate passa
**Tests**: unit | **Gate**: quick | **Commit**: `feat(notifications): webhook channel for notify-hub`

### T19: Spike portabilidade de session files

**What**: Provar/refutar com experimento real: session `.jsonl` do Claude copiado entre `CLAUDE_CONFIG_DIR`s distintos permite `resume`? Idem Codex (`CODEX_HOME/sessions`). Resultado documentado (design.md Risks) com evidência.
**Where**: experimento em dirs efêmeros; doc no design.md
**Depends on**: T9 | **Reuses**: perfis (T4)
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Veredito POR PROVIDER com evidência (funciona / não funciona / parcial)
**Tests**: none (spike) | **Gate**: — | **Commit**: `docs(handoff): session portability spike results`

### T20: Handoff service + UI trocar conta

**What**: `handoff.service.ts`: trocar perfil de sessão entre turnos — transplante do session file (providers aprovados no T19) OU degradação explícita (nova sessão semeada com transcript, HUB-12 AC2); fila se turno em execução (edge case do spec); marcador de troca no transcript (AC3). UI: ação "trocar conta" no header.
**Where**: `server/modules/profiles/handoff.service.ts` + UI header + testes
**Depends on**: T19 | **Reuses**: resume nativo (`claude-sdk.js:229`, `openai-codex.js:272`)
**Tools**: MCP: NONE; Skill: NONE
**Done when**:
- [ ] Testes 1:1 com HUB-12 AC1-3 + edge case de turno em execução
- [ ] Gate passa; build verde
**Tests**: unit | **Gate**: full | **Commit**: `feat(handoff): mid-session account switch`

### T21: Passe tablet/phone

**What**: UAT em tablet real (HUB-02) e phone (HUB-10): telas novas (perfis, seletor, handoff) + fluxo de aprovação; corrigir quebras encontradas.
**Where**: `src/components/profiles/`, ajustes CSS pontuais
**Depends on**: T17, T20 | **Reuses**: breakpoints/`isMobile` upstream
**Tools**: MCP: NONE; Skill: `web-design-guidelines` se necessário
**Done when**:
- [ ] Checklist UAT tablet: navegar, criar sessão c/ perfil, aprovar permissão — sem elementos quebrados
- [ ] Build verde
**Tests**: UAT | **Gate**: build | **Commit**: `fix(ui): tablet/phone polish for profile flows`

---

## Parallel Execution Map

```
Phase 1: T1 ──→ T2
Phase 2: T2 ──→ T3 ──→ T4 ──→ T5
              T4 ──┬→ T6 [P]
                   ├→ T7 [P]   → T9 ──┬→ T12 [P]
                   └→ T8 [P]          │
              T5 ──┬→ T10 [P]         │
                   └→ T11 [P]         │
Phase 3: T2 ──→ T13 ──→ T14
Phase 4: (T12,T14) → T15 ──→ T16 ──→ T17
Phase 5: T18 [P]; T19 ──→ T20; (T17,T20) → T21
```

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1-T3, T5, T13-T16, T18, T19 | 1 entrega/arquivo-alvo cada | ✅ Granular |
| T4 | 1 service (5 métodos coesos, 1 módulo) | ✅ OK (coeso) |
| T6/T7/T8 | patches cirúrgicos por provider | ✅ Granular |
| T9 | 4 synchronizers, mesmo padrão repetido | ⚠️ OK coeso (1 conceito) |
| T10/T11/T12 | 1 área de UI cada | ✅ Granular |
| T17/T21 | operacional/UAT | ✅ OK |
| T20 | service + ação de UI | ⚠️ OK coeso (handoff fim-a-fim) |

## Diagram-Definition Cross-Check

| Task | Depends On (body) | Diagram | Status |
| --- | --- | --- | --- |
| T2→T1; T3→T2; T4→T3; T5→T4 | idem | idem | ✅ |
| T6,T7,T8→T4 | T4 | T4→{T6,T7,T8} | ✅ |
| T9→T6,T7,T8 | idem | {T6,T7,T8}→T9 | ✅ |
| T10,T11→T5 | T5 | T5→{T10,T11} | ✅ |
| T12→T5,T9 | idem | T9→T12 (+T5 implícito por fase) | ✅ |
| T13→T2; T14→T13 | idem | idem | ✅ |
| T15→T12,T14; T16→T15; T17→T16 | idem | idem | ✅ |
| T18→T2; T19→T9; T20→T19; T21→T17,T20 | idem | idem | ✅ |

## Test Co-location Validation

| Task | Layer | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T3 migration | schema | unit | unit | ✅ |
| T4 service | server module | unit | unit | ✅ |
| T5 routes | routes | unit | unit | ✅ |
| T6/T7/T8/T9 patches server | server module | unit | unit | ✅ |
| T10/T12/T14 UI | frontend | none (build+UAT) | none/build | ✅ |
| T11 | front + server patch | unit (server) | unit | ✅ |
| T13 auth | server module | unit | unit | ✅ |
| T15/T16 deploy | deploy | smoke | smoke/build | ✅ |
| T18 webhook | server module | unit | unit | ✅ |
| T19 spike | doc | none | none | ✅ |
| T20 handoff | server module | unit | unit | ✅ |
| T21 UAT | frontend | none (UAT) | UAT | ✅ |
