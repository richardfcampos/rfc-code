# RFC Code — Project State

## Decisions Log

| ID | Date | Decision | Source |
| --- | --- | --- | --- |
| AD-001 | 2026-07-23 | Deploy em produção no servidor local **intel** | Usuário |
| AD-002 | 2026-07-23 | Acesso via **Tailscale sem login no app**; perímetro = tailnet; sem exposição pública | Usuário |
| AD-003 | 2026-07-23 | Agents do MVP: **Claude Code + Codex + OpenCode + Cursor** (Cursor com risco sinalizado) | Usuário |
| AD-004 | 2026-07-23 | **Tablet obrigatório** no MVP; phone P2; desktop-first | Usuário |
| AD-005 | 2026-07-23 | Base: **fork de siteboon/claudecodeui** (AGPLv3 ok p/ self-host pessoal) — CONFIRMADO pelo usuário | Usuário + pesquisa (3 researchers) |
| AD-007 | 2026-07-23 | Nome do projeto: **RFC Code** (dir `rfc-code`) | Usuário |
| AD-008 | 2026-07-23 | Compliance AGPL-3.0 + Seção 7 do upstream: manter atribuição "CloudCLI UI (github.com/siteboon/claudecodeui)" no README do fork; marcar como versão modificada; nunca usar marcas CloudCLI/Siteboon | Verificação (`LICENSE:668-695`, NOTICE) |
| AD-009 | 2026-07-23 | Estratégia de fork: branch `main` espelha upstream, trabalho em branch `rfc-code`; código novo em módulos novos; NÃO podar código upstream (minimizar conflitos de merge) | Design |
| AD-010 | 2026-07-23 | Linguagem: **híbrido** — backend do fork permanece Node/TS; componentes CPU-bound futuros nascem como sidecar Rust/Go (nenhum no MVP) | Usuário |
| AD-011 | 2026-07-23 | Perfis: **abordagem A** (env-injection por sessão, container único) — única compatível com troca de conta barata. + HUB-12 handoff entre turnos no MVP (P2). **Colaboração multi-conta** (planner/executor, review cruzado, debate) = feature 2 `multi-account-collab`, spec próprio | Usuário (escopo) + Design (sequenciamento) |
| AD-012 | 2026-07-23 | Execução: orquestrador (Fable) NÃO implementa — 1 worker por fase com roteamento de modelo: **Sonnet** fases mecânicas (1, 3, 4), **Opus** fases críticas (2 perfis, 5 handoff) e **Verifier** | Usuário |
| AD-013 | 2026-07-23 | Resiliência a limite de uso: scheduled task `rfc-code-resume-execute` (a cada 2h) lê Handoff e retoma Execute se heartbeat "Última atividade" > 90min e trabalho incompleto. TODA sessão executando DEVE atualizar o heartbeat no Handoff após cada task/fase | Usuário |
| AD-006 | 2026-07-23 | Isolamento multi-conta: 1 perfil = 1 config dir isolado em volume (`CLAUDE_CONFIG_DIR` p/ Claude; auth.json isolado p/ Codex/OpenCode/Cursor) | Pesquisa |

## Handoff

- **Última atividade:** 2026-07-23 14:40 -03 — ✅ Fase 3 concluída e commitada (T13 `0dd9145`, T14 `2a042b6`); 192 tests/0 fail, build+lint verdes.
- **Fase:** EXECUTE — tasks aprovadas (21 tasks / 5 fases, 1 worker/fase).
- **Concluído:** Fase 1 ✅ (T1 `df9c125`, T2 `95bbc10`); Fase 2a ✅ (T3 `604ca3a` … T9 `0e288d6`); Fase 2b ✅ (T10 `fe67876`, T11 `7cf5c1a`, T12 `b540257`); Fase 3 ✅ (T13 `0dd9145`, T14 `2a042b6`) — `AUTH_MODE=trusted` runtime completo (server + front), 192 tests/0 fail.
- **Próximo passo (ao retomar):** Fase 4 (T15–T17, deploy Docker) → Fase 5 (integrações P2) → Verifier (Opus) ao final de todas as tasks.
- **Como retomar:** ativar skill `tlc-spec-driven`, seguir fluxo Execute de `.specs/features/mvp-web-harness/tasks.md` a partir da primeira task não marcada concluída (T15), respeitando AD-001..AD-013.
- **Gap conhecido (não bloqueante):** `src/components/shell/utils/socket.ts` (WS do terminal embutido) não foi adaptado a trusted mode (fora do "Where" de T14); ainda exige token via localStorage. Deveria ser corrigido antes do UAT em T17/T21 (HUB-11 no perímetro trusted).
- **Bloqueios conhecidos:** T1 requer `gh` autenticado; T17 requer usuário (deploy intel + login de contas reais).
- **Clone de verificação:** scratchpad da sessão (`.../scratchpad/claudecodeui`) — shallow, descartável; fork real será clonado no Execute.
- **Artefatos:** `.specs/features/mvp-web-harness/spec.md`, `context.md`.
- **Pesquisas (resumo):** claudecodeui suporta os 4 agents; multi-conta não existe em nenhuma ferramenta (nosso diferencial); Claude Code tem o melhor suporte a perfis headless (`CLAUDE_CONFIG_DIR` + `claude setup-token`); Cursor headless experimental; Vibe Kanban sunsetting, omnara/claude-code-webui arquivados.
