# RFC Code — Web Harness Multi-Agent (MVP) Specification

## Problem Statement

Richard usa Claude Code Desktop localmente, mas quer acessar seus projetos (no servidor intel) de qualquer dispositivo — laptop, tablet — via URL, com a mesma experiência de harness. Além disso, quer usar várias subscriptions (múltiplas contas Claude, ChatGPT/Codex, Cursor) e trocar entre elas facilmente, algo que nenhuma ferramenta existente resolve nativamente.

## Goals

- [ ] Acessar sessões de coding agent de qualquer dispositivo na tailnet, sem login no app
- [ ] Rodar 4 agents (Claude Code, Codex, OpenCode, Cursor) com N contas por provider e troca fácil
- [ ] Paridade essencial com Claude Code Desktop: sessões, streaming, aprovação de permissões, diffs, MCPs, skills

## Out of Scope

| Feature | Reason |
| --- | --- |
| Multi-usuário / teams / billing | Uso pessoal single-user; não é produto SaaS |
| Exposição pública sem Tailscale (Funnel/Cloudflare) | Decisão do usuário: tailnet sem login. Funnel exigiria auth na borda — deferido |
| Apps nativos iOS/Android | Web responsivo (desktop + tablet) cobre o caso de uso |
| Engine de agent próprio | Wrap dos CLIs oficiais; nunca reimplementar o agent |
| Tracking de custo/quota por conta | Deferred idea — fase futura |
| Phone-first UX | Tablet é obrigatório; phone é desejável (P2), não MVP |
| Colaboração multi-conta (planner/executor, review cruzado, debate até consenso) | Feature própria — fase 2 (`multi-account-collab`), construída sobre HUB-05 + HUB-12 deste MVP. Pedida pelo usuário em 2026-07-23; sequenciada, não descartada |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Base do projeto | Fork de `siteboon/claudecodeui` | Já suporta os 4 agents escolhidos, UI similar ao Claude Code Desktop, ativo (12.8k ⭐); diferencial (multi-conta) é o que construímos | **pendente** |
| Licença AGPLv3 do fork | Aceitável | Self-host pessoal, sem distribuição — obrigações AGPL não são acionadas | pendente |
| Tailscale disponível | intel + dispositivos do usuário já na tailnet (ou serão) | Usuário escolheu Tailscale como modelo de acesso | pendente |
| HTTPS na tailnet | `tailscale serve` (MagicDNS + cert automático) | URL estável tipo `https://agentdeck.<tailnet>.ts.net`, zero config de cert | y (design) |
| Login inicial das contas | 1x interativo por perfil (host ou `docker exec`), tokens long-lived depois | OAuth dos CLIs exige browser na primeira vez; `claude setup-token` gera token de 1 ano | y (pesquisa) |
| Raiz de projetos | Um diretório raiz do host montado no container (path definido no deploy) | Projetos já vivem no intel | pendente |
| Capacidades reais do claudecodeui | Verificado por evidência em 2026-07-23: upstream = CloudCLI v1.36.3; 7/11 reqs prontos, HUB-05 ausente (ver design.md) | Verificação com clone real substituiu a pesquisa web | y |
| Cursor CLI headless | Entra no MVP com risco sinalizado; se inviável em Docker, degrada para fase 2 | Suporte Docker experimental (jul/2026) | pendente |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1-1: Acesso remoto via tailnet ⭐ MVP

**User Story**: Como único usuário, quero abrir uma URL de qualquer dispositivo meu e cair direto no harness, sem login.

**Acceptance Criteria**:

1. WHEN um dispositivo na tailnet acessa a URL do serviço THEN o sistema SHALL carregar a UI sem exigir autenticação
2. WHEN uma request chega de fora da tailnet THEN o sistema SHALL ser inalcançável (porta não exposta em interface pública; bind apenas na tailnet/localhost)
3. WHEN acessado de um tablet (viewport ≥ 768px, touch) THEN a UI SHALL ser plenamente utilizável (navegação, chat, aprovações) sem elementos quebrados

**Independent Test**: abrir a URL no laptop e no tablet via Tailscale → UI funcional; tentar acessar pelo IP público → conexão recusada.

### P1-2: Sessão Claude Code com paridade essencial ⭐ MVP

**User Story**: Como usuário, quero navegar meus projetos, abrir uma sessão do Claude Code e interagir como no Desktop.

**Acceptance Criteria**:

1. WHEN seleciono um projeto e inicio sessão THEN o sistema SHALL iniciar o CLI naquele diretório e exibir output em streaming em tempo real
2. WHEN o agent pede permissão de ferramenta THEN a UI SHALL exibir prompt de aprovação (allow/deny) e repassar a resposta ao CLI
3. WHEN o agent edita arquivos THEN a UI SHALL exibir os diffs
4. WHEN recarrego a página ou troco de dispositivo THEN a sessão ativa e o histórico SHALL estar acessíveis (resume)
5. WHEN o processo do CLI morre inesperadamente THEN a sessão SHALL ser marcada como erro com transcript preservado

**Independent Test**: pedir uma edição real num projeto de teste, aprovar a permissão pelo tablet, ver o diff aplicado.

### P1-3: Perfis multi-conta por provider ⭐ MVP (diferencial)

**User Story**: Como usuário com várias subscriptions, quero cadastrar N contas por provider e escolher qual usar em cada sessão.

**Acceptance Criteria**:

1. WHEN cadastro um perfil (ex.: "Claude Max — conta A") THEN o sistema SHALL criar um diretório de config isolado (volume) para as credenciais daquele perfil
2. WHEN inicio uma sessão THEN o sistema SHALL permitir escolher o perfil em ≤ 3 cliques, e a sessão SHALL exibir qual perfil está em uso
3. WHEN um perfil não está autenticado ou o token expirou THEN a UI SHALL mostrar o status e instruções de re-auth (comando guiado)
4. WHEN duas sessões usam perfis diferentes do mesmo provider THEN as credenciais SHALL permanecer isoladas (sem vazamento entre config dirs)
5. WHEN o container reinicia THEN os perfis e credenciais SHALL persistir (volumes)

**Independent Test**: cadastrar 2 contas Claude, rodar 2 sessões em paralelo, confirmar via `/status`-equivalente que cada uma usa a conta certa.

### P1-4: Agents adicionais — Codex, OpenCode, Cursor ⭐ MVP

**User Story**: Como usuário, quero escolher o agent (além do Claude Code) ao iniciar uma sessão.

**Acceptance Criteria**:

1. WHEN inicio uma sessão THEN o sistema SHALL oferecer seletor de agent: Claude Code, Codex, OpenCode, Cursor
2. WHEN seleciono Codex ou OpenCode com perfil autenticado THEN a sessão SHALL funcionar com streaming e aprovações equivalentes
3. WHEN o CLI do agent não está autenticado/instalado THEN o sistema SHALL exibir erro claro com passo de correção (nunca falha silenciosa)
4. WHEN Cursor CLI se mostrar inviável headless THEN o sistema SHALL exibi-lo como "indisponível" com o motivo (degradação explícita)

**Independent Test**: uma sessão de cada agent completando um prompt trivial ("liste os arquivos e resuma o projeto").

### P1-5: Deploy Docker no intel ⭐ MVP

**User Story**: Como usuário, quero subir tudo com um comando no servidor intel.

**Acceptance Criteria**:

1. WHEN executo `docker compose up -d` no intel THEN o sistema SHALL subir com a raiz de projetos do host montada
2. WHEN o container reinicia THEN histórico de sessões, perfis e credenciais SHALL persistir
3. WHEN uma sessão estava ativa durante o restart THEN ela SHALL ser marcada como interrompida (não zumbi, não perdida)

**Independent Test**: `docker compose restart` no meio de uma sessão → estado consistente ao voltar.

### P2-1: Gerência de MCPs e skills via UI

**User Story**: Como usuário, quero adicionar/remover MCP servers e skills sem editar arquivos na mão.

**Acceptance Criteria**:

1. WHEN adiciono um MCP server pela UI THEN ele SHALL ficar disponível nas próximas sessões do agent correspondente
2. WHEN listo skills THEN a UI SHALL mostrar as skills instaladas (diretório de skills do perfil) com adicionar/remover

### P2-2: Notificações push (notify-hub)

**User Story**: Como usuário, quero ser notificado no celular quando uma sessão termina ou trava esperando aprovação.

**Acceptance Criteria**:

1. WHEN uma sessão finaliza ou aguarda aprovação por > 60s THEN o sistema SHALL enviar push via notify-hub (infra já existente no intel)

### P2-3: Layout phone

**Acceptance Criteria**:

1. WHEN acesso de viewport < 768px THEN as funções essenciais (acompanhar sessão, aprovar permissão) SHALL ser utilizáveis

### P2-4: Handoff de sessão entre contas

**User Story**: Como usuário, quero trocar a conta que atende uma sessão em andamento (ex.: quota do perfil A acabou → perfil B continua), preservando o contexto.

**Acceptance Criteria**:

1. WHEN solicito troca de perfil numa sessão existente (entre turnos) THEN o sistema SHALL continuar a conversa com o novo perfil preservando o histórico
2. WHEN o provider não suportar transplante de sessão THEN o sistema SHALL degradar explicitamente (nova sessão semeada com o contexto) — nunca falha silenciosa
3. WHEN a troca ocorre THEN o transcript SHALL registrar o ponto de troca e o novo perfil ativo

**Independent Test**: iniciar sessão com conta Claude A, pedir troca pra conta B, e a resposta seguinte referenciar corretamente o contexto anterior.

### P3-1: Ferramentas herdadas do fork

**User Story**: Manter funcionando o que o fork já dá de graça: terminal integrado, editor de arquivos, git UI.

**Acceptance Criteria**:

1. WHEN uso terminal/editor/git UI herdados THEN eles SHALL continuar funcionais no ambiente Docker (sem regressão do upstream)

---

## Edge Cases

- WHEN duas abas/dispositivos abrem a mesma sessão THEN o sistema SHALL espelhar o stream em ambas sem duplicar input (single-writer)
- WHEN o path de um projeto configurado não existe mais THEN a UI SHALL sinalizar e impedir início de sessão
- WHEN o provider está fora do ar THEN o erro do CLI SHALL ser exibido no transcript (não engolido)
- WHEN o disco de volumes enche THEN sessões novas SHALL falhar com mensagem clara (não corromper histórico)
- WHEN um prompt contém caracteres de controle/escape THEN o input SHALL ser sanitizado antes de chegar ao PTY/CLI
- WHEN troca de perfil é solicitada com turno em execução THEN o sistema SHALL enfileirar a troca para o fim do turno (nunca matar o turno)

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| HUB-01 | P1-1 Acesso tailnet | Design | Pending |
| HUB-02 | P1-1 Tablet | Design | Pending |
| HUB-03 | P1-2 Sessão Claude Code | Design | Pending |
| HUB-04 | P1-2 Persistência/resume | Design | Pending |
| HUB-05 | P1-3 Perfis multi-conta | Design | Pending |
| HUB-06 | P1-4 Multi-agent | Design | Pending |
| HUB-07 | P1-5 Deploy Docker | Design | Pending |
| HUB-08 | P2-1 MCPs/skills UI | — | Pending |
| HUB-09 | P2-2 notify-hub | — | Pending |
| HUB-10 | P2-3 Phone | — | Pending |
| HUB-11 | P3-1 Herdados do fork | — | Pending |
| HUB-12 | P2-4 Handoff entre contas | — | Pending |

**Coverage:** 12 total, 12 mapped to tasks (T1–T21 em tasks.md), 0 unmapped ✅

---

## Success Criteria

- [ ] Abrir o harness do laptop E do tablet via URL da tailnet e completar uma tarefa real de código
- [ ] 2+ contas Claude e 2+ contas Codex cadastradas; troca de perfil em ≤ 3 cliques
- [ ] Sessão de cada um dos 4 agents completa um prompt de teste (Cursor pode degradar com aviso)
- [ ] `docker compose restart` não perde histórico, perfis nem credenciais
- [ ] Nenhuma porta do serviço alcançável de fora da tailnet

## Implicit-Requirement Dimensions (sweep)

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | Sanitização de input p/ PTY (edge case); projetos restritos à raiz montada (HUB-03) |
| Failure / partial-failure | CLI crash → sessão erro c/ transcript (HUB-03); restart → interrompida (HUB-07) |
| Idempotency / retry | Resume de sessão sem duplicar processo (HUB-04) |
| Auth boundaries & rate limits | Perímetro = tailnet, sem auth no app (HUB-01); rate limit N/A because single-user |
| Concurrency / ordering | Multi-device single-writer (edge case); sessões paralelas c/ perfis isolados (HUB-05) |
| Data lifecycle / expiry | Histórico e credenciais persistem em volumes; limpeza manual — N/A retention automática because single-user com disco próprio |
| Observability | Logs do backend + por sessão acessíveis via `docker logs`; N/A metrics/tracing because uso pessoal |
| External-dependency failure | Provider fora do ar → erro visível (edge case); pin de versões dos CLIs no Dockerfile |
| State-transition integrity | Estados de sessão: idle → running → waiting-approval → done/error/interrupted (HUB-03/04/07) |
