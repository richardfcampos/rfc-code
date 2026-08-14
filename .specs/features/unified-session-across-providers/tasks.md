# Unified Session Across Providers — Tasks

**Design:** [design.md](design.md) · **Spec:** [spec.md](spec.md) · **Context:** [context.md](context.md)
**Status:** Draft

---

## Gate Check Commands

Não existe `.specs/codebase/TESTING.md` neste projeto. Comandos extraídos de `package.json` e
do padrão de gate registrado em `.specs/STATE.md`:

| Gate | Comando | Baseline |
| --- | --- | --- |
| quick | `npm test` | 504 testes passando |
| full | `npm test && npm run typecheck` | 504 + typecheck 0 |
| build | `npm test && npm run typecheck && npx eslint src/ server/ && npm run build` | + eslint exit 0 + build EXIT 0 |

**Armadilha registrada:** `npm run lint` sai 1 por causa do wrapper npm, não do eslint — use
`npx eslint src/ server/`.

**Cobertura de testes (DB-001, aberto):** `npm test` só varre `server/**`. Arquivos de `src/`
não têm runner. Tasks de frontend ficam `Tests: none / Gate: build` — não é escolha, é o
estado do projeto. Verificação de frontend é manual (T17/T18).

---

## Execution Plan

### Fase 1 — Fundação (sequencial, com 3 paralelas soltas)

```
T1 → T2
T4  [P]  (função pura, sem dependência)
T6  [P]  (tipo, sem dependência)
T19 [P]  (função pura, sem dependência)
```

### Fase 1b — Contexto do primer

```
T19 → T20 → T21
```

### Fase 2 — Backend (paralelas após a fundação)

```
        ┌→ T3 [P]
        ├→ T9 [P]
T2 ─────┼→ T12 [P]
        ├→ T16 [P]
        └→ T5 ──→ T10 ──→ T11
T4,T20,T21 ──→ T5
T2,T6 ──→ T7 ──→ T8
```

### Fase 3 — Frontend (após backend)

```
T6  ──→ T14 [P]
T10 ──→ T13 ──→ T15
```

### Fase 4 — Validação (usuário)

```
T11,T8,T14,T15,T16 → T17 → T18
```

---

## Task Breakdown

### T1: Migração `session_legs` + backfill

**What**: Cria a tabela `session_legs`, seus índices, e faz o backfill de uma perna `seq = 0`
para toda sessão existente com `provider_session_id`.
**Where**: `server/modules/database/migrations.ts`, `server/modules/database/schema.ts`
**Depends on**: None
**Reuses**: `addColumnToTableIfNotExists` e o padrão de migração aditiva já usado para `seed_primer_path`
**Requirement**: USP-01, USP-14

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Tabela criada com as colunas do design §4, incluindo `profile_name_at_switch`
- [ ] Índice `idx_session_legs_session` e único parcial `idx_session_legs_provider_session` criados
- [ ] Backfill cria exatamente uma perna por sessão com `provider_session_id` não nulo
- [ ] Migração é idempotente (rodar duas vezes não duplica perna)
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos testes de migração

**Tests**: unit · **Gate**: quick
**Commit**: `feat(database): session legs table with backfill`

---

### T2: Repositório `session-legs.db.ts`

**What**: Repositório das pernas com as 6 operações do design §3.
**Where**: `server/modules/database/repositories/session-legs.db.ts` (novo), export no barril
**Depends on**: T1
**Reuses**: `getConnection()`, `normalizeSessionRow`, padrão de transação de `handoff-seed.ts:138-153`
**Requirement**: USP-01, USP-08

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `listLegs`, `findLeg`, `openLeg`, `activateLeg`, `attachProviderSessionId`, `findSessionIdByProviderSessionId` implementados
- [ ] `openLeg` fecha a perna ativa e abre a nova numa transação só
- [ ] `seq` é monotônico por sessão
- [ ] `findLeg` casa por (session_id, provider, profile_id)
- [ ] Gate: `npm test`
- [ ] Test count: 504 + testes do repositório

**Tests**: unit · **Gate**: quick
**Commit**: `feat(database): session legs repository`

---

### T3: Watcher enxerga pernas inativas [P]

**What**: `getSessionByProviderSessionId` cai em `session_legs` quando não acha em `sessions`,
para que o rollout de uma perna inativa nunca vire sessão fantasma na sidebar.
**Where**: `server/modules/database/repositories/sessions.db.ts:355`
**Depends on**: T2
**Reuses**: `findSessionIdByProviderSessionId` (T2)
**Requirement**: USP-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Busca por id de perna inativa devolve a sessão dona
- [ ] Busca por id desconhecido continua devolvendo `null`
- [ ] Teste cobre o cenário do watcher: sessão com 2 pernas, artefato da perna antiga indexado → nenhuma linha nova em `sessions`
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `fix(sessions): resolve provider ids of inactive legs to their owning session`

---

### T4: Primer incremental (`since`) [P]

**What**: `buildHandoffPrimer` aceita um corte temporal e renderiza só as mensagens posteriores
a ele, com cabeçalho próprio ("o que aconteceu enquanto você esteve fora").
**Where**: `server/modules/profiles/handoff-primer.ts`
**Depends on**: None (função pura)
**Reuses**: orçamento de 24k chars e lógica de cauda existentes
**Requirement**: USP-09

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `since` opcional; ausente = comportamento atual, byte a byte
- [ ] Com `since`, mensagens anteriores ou iguais ao corte são excluídas
- [ ] Nada depois do corte → devolve `null` (nada a semear)
- [ ] Orçamento de caracteres continua respeitado no modo incremental
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(profiles): incremental handoff primer`

---

### T5: `handoff-leg.ts` — troca cross-provider vira perna

**What**: Substitui a criação de `session_id` nova por abertura/reativação de perna sobre a
sessão existente.
**Where**: `server/modules/profiles/handoff-leg.ts` (novo); `handoff-seed.ts` reduzido a helpers reusados
**Depends on**: T2, T4, T20, T21
**Reuses**: `assertTargetAuthenticated`, `renderPrimer`, `resolvePrimerPath` (`handoff-seed.ts:53,85,103`)
**Requirement**: USP-01, USP-02, USP-03, USP-08, USP-10

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Sem perna para o par (provider, perfil) → `openLeg` com `provider_session_id` NULL e primer completo
- [ ] Com perna e transcript presente → `activateLeg` + primer incremental desde `ended_at`
- [ ] Com perna e transcript ausente → degrada para perna nova, com log explícito
- [ ] `session_id` nunca muda; `project_path`, `worktree_path`, `worktree_branch` preservados
- [ ] Escrita do primer, `seed_primer_path` e repoint das colunas ativas numa transação só
- [ ] Falha em qualquer etapa deixa a sessão na perna anterior
- [ ] Perfil destino não autenticado é rejeitado antes de criar qualquer coisa
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(profiles): cross-provider switch as a session leg`

---

### T6: Marcador de fronteira no contrato de mensagem [P]

**What**: Adiciona `'provider_switch'` a `MessageKind` e o shape do marcador (provider,
profileName, timestamp).
**Where**: `server/shared/types.ts:169-182`
**Depends on**: None
**Reuses**: união `MessageKind` existente
**Requirement**: USP-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Kind adicionado à união e ao conjunto de kinds do websocket
- [ ] Campos do marcador tipados
- [ ] `npm run typecheck` limpo em `src/` e `server/`
- [ ] Gate: `npm test && npm run typecheck`

**Tests**: none (só tipo) · **Gate**: full
**Commit**: `feat(types): provider switch message kind`

---

### T7: Merge de histórico por timestamp

**What**: `fetchUnifiedHistory` lê todas as pernas, ordena por `timestamp`, injeta marcadores
de fronteira e pagina no fim.
**Where**: `server/modules/providers/services/session-history-merge.ts` (novo)
**Depends on**: T2, T6
**Reuses**: chamada de adapter de `sessions.service.ts:213-218`; `NormalizedMessage.timestamp` (`types.ts:218`)
**Requirement**: USP-04, USP-05, USP-07

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Cenário A→B→A devolve ordem cronológica correta (não concatenação de pernas)
- [ ] Marcador inserido antes da primeira mensagem de cada perna a partir da segunda
- [ ] Perna sem `provider_session_id` é ignorada, sem marcador órfão
- [ ] Perna cujo adapter lança vira marcador de erro; as demais rendem
- [ ] `offset`/`limit` aplicados sobre a timeline unificada; `total` e `hasMore` corretos
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(providers): merge session history across legs`

---

### T8: `fetchHistory` passa a usar o merge

**What**: `sessionsService.fetchHistory` delega ao merge quando a sessão tem mais de uma perna.
**Where**: `server/modules/providers/services/sessions.service.ts:188-227`
**Depends on**: T7
**Reuses**: `fetchUnifiedHistory` (T7)
**Requirement**: USP-04, USP-06

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Sessão de perna única produz resultado idêntico ao atual (sem regressão)
- [ ] Sessão multi-perna produz timeline unificada
- [ ] `sessionId` continua sendo reescrito em toda mensagem para o id do app
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(providers): unified history for multi-leg sessions`

---

### T9: `assignProviderSessionId` grava na perna ativa [P]

**What**: Quando o CLI anuncia seu id no primeiro turno de uma perna, o id vai também para a
linha da perna.
**Where**: `server/modules/database/repositories/sessions.db.ts:231`
**Depends on**: T2
**Reuses**: `attachProviderSessionId` (T2); transação de merge de duplicata existente
**Requirement**: USP-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Perna ativa recebe `provider_session_id` e `jsonl_path`
- [ ] O merge de linha duplicada existente continua funcionando
- [ ] Sessão sem perna (não deve existir após T1) não quebra
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(sessions): record provider session id on the active leg`

---

### T10: Roteamento e resultado do handoff

**What**: `applySwitch` chama `handoff-leg` no caminho cross-provider; `HandoffStatus` troca
`seeded` por `leg-opened` / `leg-resumed`.
**Where**: `server/modules/profiles/handoff.service.ts:97-106,30-49`
**Depends on**: T5
**Reuses**: fila de turno existente (`:61-83,143`), inalterada
**Requirement**: USP-01, USP-03, USP-13

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Cross-provider devolve `leg-opened` ou `leg-resumed` com a `session_id` original
- [ ] `seededSessionId` sai do contrato
- [ ] Same-provider continua `transplanted`, sem tocar em pernas
- [ ] Troca com turno rodando continua `queued` e drena ao fim
- [ ] Testes existentes de `handoff.service.test.ts` atualizados, nenhum apagado
- [ ] Gate: `npm test && npm run typecheck`

**Tests**: unit · **Gate**: full
**Commit**: `feat(profiles): route cross-provider switches through legs`

---

### T11: Broadcast do switch sem navegação

**What**: `session.handoff` deixa de mandar o cliente para outro id e passa a sinalizar
"recarregue o histórico desta sessão".
**Where**: `server/modules/websocket/services/chat-websocket.service.ts`
**Depends on**: T10
**Reuses**: emissão de `session.handoff` existente; `consumePendingPrimer` inalterado
**Requirement**: USP-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Payload traz `sessionId`, `status`, `provider`, `profileId`, sem `targetSessionId`
- [ ] Primer da perna nova é consumido no primeiro turno após a troca
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(chat): broadcast leg switches without session navigation`

---

### T12: Ciclo de vida das pernas [P]

**What**: Arquivar/desarquivar/apagar uma sessão alcança suas pernas.
**Where**: `server/modules/database/repositories/sessions.db.ts` (métodos de archive/delete)
**Depends on**: T2
**Reuses**: métodos de ciclo de vida existentes
**Requirement**: USP-14

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Apagar sessão apaga suas pernas (sem perna órfã)
- [ ] Arquivar/desarquivar não perde perna
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `fix(sessions): cascade lifecycle operations to session legs`

---

### T13: `useProviderSwitch` sem fork

**What**: União discriminada perde `seeded`, ganha `leg-opened`/`leg-resumed`; some a navegação
para outro id, entra invalidação do histórico atual.
**Where**: `src/components/chat/hooks/useProviderSwitch.ts`
**Depends on**: T10
**Reuses**: `useSessionHandoff` (contrato de rota inalterado)
**Requirement**: USP-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Nenhuma chamada a `onNavigateToSession` no caminho cross-provider
- [ ] Histórico da sessão atual é recarregado após a troca
- [ ] `npm run typecheck` limpo
- [ ] Gate: `npm run typecheck && npx eslint src/ server/ && npm run build`

**Tests**: none (DB-001: `src/` sem runner) · **Gate**: build
**Commit**: `feat(chat): keep the session when switching provider`

---

### T14: Separador de fronteira no chat [P]

**What**: Componente que renderiza a mensagem `provider_switch` como separador de sistema.
**Where**: `src/components/chat/` (componente novo + case no switch de `kind`)
**Depends on**: T6
**Reuses**: padrão de mensagem de sistema existente no chat
**Requirement**: USP-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Renderiza provider, nome da conta e horário
- [ ] Visualmente distinto de mensagem de usuário/assistente
- [ ] Legível no breakpoint de tablet (AD-004)
- [ ] Gate: `npm run typecheck && npx eslint src/ server/ && npm run build`

**Tests**: none (DB-001) · **Gate**: build
**Commit**: `feat(chat): render provider switch boundaries in the transcript`

---

### T15: Texto de confirmação e aviso de custo

**What**: Reescreve o modal de confirmação cross-provider e a nota do menu do composer, com
i18n nos 10 locales.
**Where**: `src/components/chat/`, `src/components/SessionAccountSwitcher`, arquivos de locale
**Depends on**: T13
**Reuses**: chaves e estrutura de i18n existentes da feature anterior
**Requirement**: USP-11

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Nenhuma string afirma que a troca cria sessão nova
- [ ] Texto diz: mesma sessão, contexto resumido, cache do provider anterior se perde
- [ ] Mesmo provider continua sem modal
- [ ] Perfil não autenticado desabilitado com motivo
- [ ] 10 locales atualizados, sem chave órfã
- [ ] Gate: `npm run typecheck && npx eslint src/ server/ && npm run build`

**Tests**: none (DB-001) · **Gate**: build
**Commit**: `feat(i18n): honest copy for cross-provider switches`

---

### T16: Migração dos pares já forkados [P]

**What**: Script de migração que junta origem→destino das trocas antigas como pernas de uma
sessão só, preservando a `session_id` da origem.
**Where**: `server/modules/database/migrations.ts`
**Depends on**: T2
**Reuses**: `seed_primer_path` e o cabeçalho do primer para reconstruir a origem
**Requirement**: USP-12

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Par reconstruído vira duas pernas sob a `session_id` da origem; linha do destino removida
- [ ] Caso ambíguo (origem sumida, primer ilegível, destino com pernas próprias) fica intacto e loga o motivo
- [ ] Nenhuma mensagem apagada ou reescrita — só metadado
- [ ] Reexecução não tem efeito
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(database): merge previously forked sessions into legs`

---

### T19: Orçamento do primer pela janela do destino [P]

**What**: `resolvePrimerBudget(provider, model?)` — mapa explícito de janelas conhecidas, piso
conservador para modelo desconhecido, e `source` dizendo qual dos dois foi usado.
**Where**: `server/modules/profiles/handoff-primer-budget.ts` (novo)
**Depends on**: None (função pura)
**Reuses**: `PRIMER_CHAR_BUDGET` (`handoff-primer.ts:17`) vira o piso; `model_context_window`
do codex (`codex-sessions.provider.ts:131`) como referência da única janela real disponível hoje
**Requirement**: USP-15

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Modelo conhecido → orçamento derivado da janela, com reserva para o trabalho do turno
- [ ] Modelo desconhecido → piso conservador e `source: 'fallback'`
- [ ] Orçamento nunca fica abaixo do piso atual de 24k chars
- [ ] Mapa de janelas é explícito e comentado — nenhuma janela inventada sem fonte
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(profiles): derive primer budget from the destination context window`

---

### T20: Resumo do trecho antigo no estouro

**What**: `summarizeOverflow` — comprime o começo da conversa pela `EphemeralQuery` quando a
conversa inteira não cabe, devolvendo `null` (para o chamador truncar) se não der.
**Where**: `server/modules/profiles/handoff-primer-summarize.ts` (novo)
**Depends on**: T19
**Reuses**: `EphemeralQuery` e o seam de `configureBtwRuntime` (`btw-command.service.ts:24-28,67`)
**Requirement**: USP-16

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Cauda crua fica com a maior parte do orçamento; o começo vira resumo
- [ ] Runtime não cabeado → `null`, sem lançar
- [ ] Execução que falha ou estoura tempo → `null`, sem lançar
- [ ] Nenhuma linha de sessão, transcript de provider ou mensagem de chat é criada pelo resumo
- [ ] Limitação claude-only documentada no módulo, não só no design
- [ ] Gate: `npm test`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: quick
**Commit**: `feat(profiles): summarize the old span when the primer overflows`

---

### T21: Primer com orçamento injetado e enquadramento de continuidade

**What**: `buildHandoffPrimer` troca a constante por orçamento injetado, chama o resumo no
estouro, e o cabeçalho passa a apresentar o histórico como **esta** conversa continuando.
**Where**: `server/modules/profiles/handoff-primer.ts`
**Depends on**: T19, T20
**Reuses**: seleção de blocos e marca de truncamento existentes (`:97-123`)
**Requirement**: USP-15, USP-16, USP-17

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Conversa que cabe no orçamento atravessa **inteira**, sem truncamento
- [ ] Conversa que estoura → `resumo + cauda crua`
- [ ] Resumo indisponível → trunca a cauda com marca visível, sem falhar
- [ ] Cabeçalho não contém "conversa anterior" nem "outra sessão"; apresenta continuidade
- [ ] `renderConversationPrimer` do `/btw` continua com o cabeçalho dele, sem regressão
- [ ] Gate: `npm test && npm run typecheck`
- [ ] Test count: 504 + novos

**Tests**: unit · **Gate**: full
**Commit**: `feat(profiles): carry the whole conversation across a provider switch`

---

### T17: Smoke com contas reais (usuário)

**What**: Rodar o ciclo claude→codex→claude com contas de verdade nas duas pontas.
**Where**: instância rodando
**Depends on**: T8, T11, T14, T15, T16, T21
**Requirement**: todas

**Done when**:
- [ ] Uma entrada só na sidebar depois de duas trocas
- [ ] Histórico em ordem cronológica com dois separadores
- [ ] Terceira troca reusa o `provider_session_id` da primeira perna (conferir no banco)
- [ ] Nenhuma sessão fantasma aparece depois que o watcher reindexa
- [ ] Depois da troca, perguntar sobre um detalhe do **começo** da conversa e obter resposta correta
- [ ] Testar uma conversa acima do orçamento e conferir que o resumo rodou (não truncou cego)
- [ ] Conferir o caminho de degradação sem perfil claude autenticado — resumo indisponível deve
      truncar com marca visível, não quebrar a troca
- [ ] Gate: `npm test && npm run typecheck && npx eslint src/ server/ && npm run build`

**Tests**: manual · **Gate**: build

---

### T18: UAT (usuário)

**What**: Validação do fluxo real "crédito acabou, troca conta e segue".
**Depends on**: T17
**Requirement**: todas

**Done when**:
- [ ] Caminho é curto o bastante para o cenário de urgência
- [ ] Texto do modal condiz com o que acontece
- [ ] Usuário aprova commit

**Tests**: manual · **Gate**: build

---

## Task Granularity Check

| Task | Escopo | Status |
| --- | --- | --- |
| T1 | 1 migração | ✅ |
| T2 | 1 repositório | ✅ |
| T3 | 1 função | ✅ |
| T4 | 1 função | ✅ |
| T5 | 1 módulo | ✅ |
| T6 | 1 tipo | ✅ |
| T7 | 1 módulo | ✅ |
| T8 | 1 função | ✅ |
| T9 | 1 função | ✅ |
| T10 | 1 função + contrato | ✅ coeso |
| T11 | 1 serviço | ✅ |
| T12 | métodos de ciclo de vida do mesmo repositório | ⚠️ coeso, aceito |
| T13 | 1 hook | ✅ |
| T14 | 1 componente | ✅ |
| T15 | strings + locales | ⚠️ coeso, aceito |
| T16 | 1 migração | ✅ |
| T19 | 1 função pura | ✅ |
| T20 | 1 função | ✅ |
| T21 | 1 função (modificação) | ✅ |
| T17–T18 | validação | ✅ |

## Diagram–Definition Cross-Check

| Task | Depends on (corpo) | Diagrama | Status |
| --- | --- | --- | --- |
| T1 | — | raiz | ✅ |
| T2 | T1 | T1→T2 | ✅ |
| T3 | T2 | T2→T3 | ✅ |
| T4 | — | solta na Fase 1 | ✅ |
| T5 | T2, T4, T20, T21 | T2→T5; T4,T20,T21→T5 | ✅ |
| T6 | — | solta na Fase 1 | ✅ |
| T7 | T2, T6 | T2,T6→T7 | ✅ |
| T8 | T7 | T7→T8 | ✅ |
| T9 | T2 | T2→T9 | ✅ |
| T10 | T5 | T5→T10 | ✅ |
| T11 | T10 | T10→T11 | ✅ |
| T12 | T2 | T2→T12 | ✅ |
| T13 | T10 | T10→T13 | ✅ |
| T14 | T6 | T6→T14 | ✅ |
| T15 | T13 | T13→T15 | ✅ |
| T16 | T2 | T2→T16 | ✅ |
| T19 | — | solta na Fase 1 | ✅ |
| T20 | T19 | T19→T20 | ✅ |
| T21 | T19, T20 | T19→T20→T21 | ✅ |
| T17 | T8, T11, T14, T15, T16, T21 | Fase 4 | ✅ |
| T18 | T17 | T17→T18 | ✅ |

Nenhuma task `[P]` depende de outra `[P]` da mesma fase. ✅
T20 e T21 **não** são `[P]`: encadeadas com T19 e entre si.

## Test Co-location Validation

| Task | Camada | Exigido | Task diz | Status |
| --- | --- | --- | --- | --- |
| T1, T16 | migração (`server/**`) | unit | unit | ✅ |
| T2, T3, T9, T12 | repositório (`server/**`) | unit | unit | ✅ |
| T4, T5, T10 | serviço (`server/**`) | unit | unit | ✅ |
| T19, T20, T21 | serviço (`server/**`) | unit | unit | ✅ |
| T7, T8 | serviço (`server/**`) | unit | unit | ✅ |
| T11 | websocket (`server/**`) | unit | unit | ✅ |
| T6 | tipo, sem runtime | none | none | ✅ |
| T13, T14, T15 | frontend (`src/**`) | sem runner (DB-001) | none | ⚠️ aceito com débito registrado |

---

## Traceability

| ID | Tasks | Status |
| --- | --- | --- |
| USP-01 | T1, T2, T3, T5, T9, T10, T11, T13 | Pending |
| USP-02 | T5 | Pending |
| USP-03 | T5, T10 | Pending |
| USP-04 | T7, T8 | Pending |
| USP-05 | T6, T7, T14 | Pending |
| USP-06 | T8 | Pending |
| USP-07 | T7 | Pending |
| USP-08 | T2, T5 | Pending |
| USP-09 | T4, T5 | Pending |
| USP-10 | T5 | Pending |
| USP-11 | T15 | Pending |
| USP-12 | T16 | Pending |
| USP-13 | T10 | Pending |
| USP-14 | T1, T12 | Pending |
| USP-15 | T19, T21 | Pending |
| USP-16 | T20, T21 | Pending |
| USP-17 | T21 | Pending |

**Coverage:** 17/17 requisitos mapeados, 0 órfãos ✅
**Total:** 21 tasks (18 de código, 2 de validação, T19–T21 acrescentadas na revisão de contexto)
