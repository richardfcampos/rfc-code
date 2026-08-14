# Cross-Provider Session Switch Specification

## Problem Statement

Uma sessão aberta fica presa no provider em que nasceu. Não existe caminho de
claude → codex (nem o inverso) sem abrir sessão nova na mão e re-explicar tudo.
O bloqueio é de quatro camadas, todas verificadas:

| Camada | Onde | Comportamento hoje |
| --- | --- | --- |
| Estado do chat | `src/components/chat/hooks/useChatProviderState.ts:488-495` | `provider` é forçado a `selectedSession.__provider` |
| Menu do composer | `src/components/chat/view/subcomponents/ComposerModelMenu.tsx:26` | Só lista `currentProviderModelOptions` — catálogo do provider ativo |
| Troca de conta | `src/components/profiles/view/SessionAccountSwitcher.tsx:51` | `GET /api/profiles?provider=<atual>` — irmãos do mesmo provider só |
| Backend | `server/modules/profiles/handoff.service.ts:199-204` | `HANDOFF_PROVIDER_MISMATCH` (400) para qualquer alvo de outro provider |

E dois defeitos pré-existentes no handoff (HUB-12) que essa feature encosta:

- **Seed sem contexto**: `handoff.service.ts:143-165` grava
  `handoff-seeds/<id>.jsonl` e reaponta `jsonl_path`, mas **nenhum consumidor
  existe em `server/**`**. O modelo destino nunca vê o histórico — o status
  `seeded` promete contexto que não entrega.
- **Fila morta**: `markSessionRunning` / `markSessionIdle` / `drainPendingSwitch`
  (`handoff.service.ts:65-76,226`) não têm caller. `defaultIsSessionRunning`
  sempre devolve `false`, então uma troca durante um turno é aplicada na hora, e
  uma troca enfileirada nunca dreanaria.

## Goals

- [ ] Trocar o provider/conta de uma sessão em andamento, nos dois sentidos, entre os 4 providers
- [ ] O provider destino recebe a conversa anterior como contexto (decisão do usuário, `context.md` Q1)
- [ ] Dois pontos de entrada: menu do composer e modal do header (Q2)
- [ ] Fechar os dois defeitos do handoff que a feature depende (seed que entrega, fila que dreana)

## Out of Scope

| Feature | Motivo |
| --- | --- |
| Trocar o provider da sessão *no lugar* (mesmo id) | Histórico é lido do adapter do provider (`sessions.service.ts:212-218`); virar a coluna orfanaria o transcript — ver `context.md` P1 |
| Tradução fiel de tool calls / thinking entre formatos | Primer é texto: papel + conteúdo. Ferramentas e raciocínio interno não atravessam |
| Continuar um turno em execução no provider novo | Turno vivo termina onde começou; a troca aplica depois (fila) |
| Trocar provider de sessões de collab (`multi-account-collab`) | Motor de collab tem ciclo próprio; v1 dele é claude-only (AD-019) |
| Mesclar de volta as duas sessões | A sessão antiga fica intacta e navegável; nada de merge |

---

## User Stories

### P1: Trocar de provider pelo modal do header ⭐ MVP

**User Story**: Como usuário, quero escolher uma conta de outro provider no botão
de troca do header, para continuar a mesma conversa no codex sem re-explicar nada.

**Acceptance Criteria**:

1. WHEN o usuário abre o `SessionAccountSwitcher` THEN o sistema SHALL listar
   perfis de **todos** os providers, agrupados por provider, marcando o atual
2. WHEN o alvo é de outro provider THEN o sistema SHALL exibir, antes de confirmar,
   que uma sessão nova será criada com a conversa anterior como contexto
3. WHEN o usuário confirma uma troca cross-provider THEN o backend SHALL criar uma
   sessão do provider destino ligada ao perfil escolhido, com status `seeded`
4. WHEN a troca resolve THEN o frontend SHALL navegar para a sessão nova
5. WHEN o alvo é do mesmo provider THEN o comportamento atual (transplant) SHALL
   permanecer inalterado
6. WHEN o perfil destino não está autenticado THEN o sistema SHALL recusar com
   mensagem acionável, sem criar sessão órfã

**Independent Test**: numa sessão claude com 5+ mensagens, trocar para um perfil
codex; a sessão nova abre e a primeira resposta do codex demonstra conhecer a
conversa anterior.

### P2: Trocar de provider pelo menu do composer

**User Story**: Como usuário, quero trocar de provider direto na barra do composer,
onde já troco modelo e effort.

**Acceptance Criteria**:

1. WHEN o menu abre THEN o sistema SHALL mostrar uma seção Provider/Conta acima de
   Modelo, colapsada por padrão (mesmo padrão da seção Modelo)
2. WHEN o usuário escolhe um provider/conta diferente do da sessão THEN o sistema
   SHALL disparar o mesmo fluxo do P1 (aviso + handoff + navegação)
3. WHEN não há sessão aberta (composer da tela vazia) THEN a seção SHALL apenas
   trocar o provider selecionado localmente, sem chamar handoff
4. WHEN o provider destino não tem perfil autenticado THEN suas entradas SHALL
   aparecer desabilitadas com o motivo

**Independent Test**: em sessão codex, abrir o menu do composer, escolher um perfil
claude, confirmar, e verificar que a próxima mensagem sai no claude com contexto.

### P3: Contexto que realmente chega ao modelo

**User Story**: Como usuário, quero que o provider novo saiba o que já foi
conversado, não que finja saber.

**Acceptance Criteria**:

1. WHEN uma sessão é semeada THEN o sistema SHALL montar um primer a partir do
   histórico normalizado da sessão de origem (`sessionsService.fetchHistory`)
2. WHEN o primeiro turno da sessão semeada é despachado THEN o primer SHALL ser
   prefixado ao prompt enviado ao runtime
3. WHEN o primer é consumido THEN o sistema SHALL limpá-lo, de forma que turnos
   seguintes não o reenviem
4. WHEN o histórico excede o orçamento de caracteres THEN o sistema SHALL manter a
   cauda (mensagens mais recentes) e marcar explicitamente o truncamento
5. WHEN a sessão de origem não tem histórico recuperável THEN a sessão nova SHALL
   ser criada mesmo assim, sem primer, e o resultado SHALL dizer isso

**Independent Test**: semear uma sessão, inspecionar o comando efetivamente
despachado no primeiro turno (primer presente) e no segundo (ausente).

### P4: Troca durante um turno em execução

**User Story**: Como usuário, quero pedir a troca sem esperar o turno acabar, e sem
que o turno morra.

**Acceptance Criteria**:

1. WHEN um turno está executando THEN o run loop SHALL marcar a sessão como running
2. WHEN uma troca chega com turno em execução THEN o sistema SHALL responder
   `queued` e SHALL NOT matar o turno
3. WHEN o turno termina THEN o sistema SHALL aplicar a troca enfileirada
4. WHEN a troca enfileirada resolve numa sessão nova THEN os clientes conectados
   SHALL ser notificados para poder navegar

---

## Edge Cases

- WHEN o perfil destino é o mesmo já servindo a sessão THEN 400 `HANDOFF_NO_OP` (atual)
- WHEN a sessão está presa a um worktree THEN a sessão semeada SHALL herdar `worktree_path`/`worktree_branch` — a conversa continua na mesma árvore
- WHEN o provider destino não tem modelo salvo THEN o default do catálogo dele vale (`pickStoredOrCurrent`)
- WHEN o permission mode atual não existe no provider destino THEN cair no default dele (`resolvePermissionModeForProvider` já faz isso)
- WHEN duas trocas são pedidas em sequência rápida THEN a última vence; nenhuma sessão semeada órfã pode sobrar
- WHEN o usuário troca de provider numa sessão sem nenhuma mensagem THEN não há primer a montar; a sessão nova nasce limpa

---

## Requirement Traceability

| Requirement ID | Story | Fase | Status |
| --- | --- | --- | --- |
| XSW-01 | P1: handoff aceita alvo de outro provider (seeded) | Execute | Pending |
| XSW-02 | P1: modal lista perfis de todos os providers, agrupados | Execute | Pending |
| XSW-03 | P1: aviso de sessão nova antes de confirmar | Execute | Pending |
| XSW-04 | P1: navegação para a sessão semeada | Execute | Pending |
| XSW-05 | P1: perfil não autenticado recusado | Execute | Pending |
| XSW-06 | P2: seção Provider/Conta no menu do composer | Execute | Pending |
| XSW-07 | P2: entradas sem auth desabilitadas com motivo | Execute | Pending |
| XSW-08 | P3: primer montado do histórico normalizado | Execute | Pending |
| XSW-09 | P3: primer prefixado ao primeiro turno e limpo depois | Execute | Pending |
| XSW-10 | P3: truncamento pela cauda, explícito | Execute | Pending |
| XSW-11 | P4: run loop marca running/idle | Execute | Pending |
| XSW-12 | P4: dreno da troca enfileirada no fim do turno | Execute | Pending |
| XSW-13 | P4: notificação de handoff aos clientes | Execute | Pending |
| XSW-14 | Edge: sessão semeada herda worktree | Execute | Pending |

---

## Success Criteria

- [ ] claude → codex e codex → claude funcionam em sessão com histórico, com contexto demonstrável na primeira resposta
- [ ] Handoff do mesmo provider (transplant) sem regressão
- [ ] Suíte verde, typecheck 0, lint 0 erros, build EXIT 0
- [ ] i18n: strings novas em en + 8 locales
