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

- **Última atividade:** 2026-07-23 10:17 -03 (heartbeat — sessões ativas DEVEM atualizar após cada task/fase; retomada automática só age se >90min parado)
- **Fase:** EXECUTE — tasks APROVADAS pelo usuário (21 tasks / 5 fases, sub-agents aceitos: 1 worker/fase).
- **Em andamento:** Fase 1 CONCLUÍDA por worker Sonnet — T1 (`df9c125`, fork estabelecido) e T2 (`95bbc10`, script `test` + baseline 129 passed/0 failed + build verde) feitas. Push pendente para `origin/rfc-code`.
- **Próximo passo:** orquestrador recebe resumo da Fase 1 → despachar Fase 2 (Opus, T3-T12 perfis multi-conta). Após T21: Verifier automático (Opus).
- **Como retomar:** ativar skill `tlc-spec-driven`, seguir fluxo Execute de `.specs/features/mvp-web-harness/tasks.md` a partir da primeira task não marcada concluída, respeitando AD-001..AD-013.
- **Bloqueios conhecidos:** T1 requer `gh` autenticado; T17 requer usuário (deploy intel + login de contas reais).
- **Clone de verificação:** scratchpad da sessão (`.../scratchpad/claudecodeui`) — shallow, descartável; fork real será clonado no Execute.
- **Artefatos:** `.specs/features/mvp-web-harness/spec.md`, `context.md`.
- **Pesquisas (resumo):** claudecodeui suporta os 4 agents; multi-conta não existe em nenhuma ferramenta (nosso diferencial); Claude Code tem o melhor suporte a perfis headless (`CLAUDE_CONFIG_DIR` + `claude setup-token`); Cursor headless experimental; Vibe Kanban sunsetting, omnara/claude-code-webui arquivados.
