# Cross-Provider Session Switch — Tasks

Referências: [spec.md](spec.md) · [design.md](design.md) · [context.md](context.md)

**Gate por task** (o mesmo do projeto):
`npm test` · `npm run typecheck` · `npm run lint` · `npm run build`
Nenhuma task fecha com suíte vermelha. Débito conhecido DB-001: `npm test` só varre
`server/**` — as tasks de frontend são validadas por typecheck + lint + build + UAT.

Legenda: `[P]` = paralelizável com as outras `[P]` da mesma faixa.

---

## Faixa A — Backend: contexto que chega

### T1 — Coluna `seed_primer_path`

- **O quê**: coluna aditiva `sessions.seed_primer_path TEXT`
- **Onde**: `server/modules/database/schema.ts`, `server/modules/database/migrations.ts`, `SessionRow` + `SESSION_ROW_COLUMNS` em `server/modules/database/repositories/sessions.db.ts`
- **Depende de**: —
- **Reusa**: `addColumnToTableIfNotExists` (`migrations.ts:263` é o precedente exato de `jsonl_path`)
- **Feito quando**: banco existente migra sem perda; `SessionRow.seed_primer_path` tipado; nova coluna nasce `NULL`
- **Testes**: integração de migração em `server/modules/database/tests/` — banco pré-migração ganha a coluna, linhas antigas com `NULL`
- **Rastreia**: XSW-09

### T2 — Repositório: gravar e consumir o primer

- **O quê**: `updateSessionSeedPrimerPath(sessionId, path | null)` e leitura via `SessionRow`
- **Onde**: `server/modules/database/repositories/sessions.db.ts`
- **Depende de**: T1
- **Reusa**: forma de `updateSessionJsonlPath` (`sessions.db.ts:304-315`)
- **Feito quando**: escrever e limpar o caminho funciona; `updated_at` acompanha
- **Testes**: unitário no arquivo de testes do repositório
- **Rastreia**: XSW-09

### T3 — Montagem do primer

- **O quê**: módulo puro que transforma histórico normalizado em markdown com orçamento
- **Onde**: **novo** `server/modules/profiles/handoff-primer.ts` (+ `handoff-primer.test.ts`)
- **Depende de**: —
- **Reusa**: shape de mensagem devolvido por `sessionsService.fetchHistory`
- **Feito quando**:
  - cabeçalho nomeia provider e conta de origem
  - `PRIMER_CHAR_BUDGET = 24_000`, corte pela **cauda**, marca de truncamento explícita no texto
  - histórico vazio → devolve `null` (sem primer, sem erro)
  - só papel + texto; tool calls e thinking descartados
  - arquivo < 200 linhas
- **Testes**: histórico curto (sem truncar) · histórico longo (cauda preservada + marca) · vazio → `null` · mensagem sem texto ignorada
- **Rastreia**: XSW-08, XSW-10

### T4 — Handoff aceita alvo de outro provider

- **O quê**: remover o `HANDOFF_PROVIDER_MISMATCH`; ramo `seedCrossProvider`; `HandoffDeps.loadHistory`; funções viram async
- **Onde**: `server/modules/profiles/handoff.service.ts`, `server/modules/profiles/index.ts`, `server/modules/profiles/profiles.routes.ts:199-206`
- **Depende de**: T2, T3
- **Reusa**: `seedHandoff` como base, `createAppSession` (`sessions.db.ts:193`), `resolveProfileDir`
- **Feito quando**:
  - mesmo provider: transplant **inalterado** (asserções antigas verdes sem edição)
  - provider diferente: cria sessão no provider destino herdando `project_path`, `worktree_path`, `worktree_branch`; grava primer em `<profileDir>/handoff-seeds/<newId>.md`; aponta `seed_primer_path`; devolve `seeded` + `seededSessionId`
  - criação da sessão + gravação do caminho numa transação
  - perfil destino com `authenticated: false` → 400 acionável, sem sessão criada
  - histórico irrecuperável → sessão criada sem primer, resultado sinaliza
  - `loadHistory` default por import dinâmico (sem import estático de `modules/providers`)
- **Testes**: `handoff.service.test.ts` — cross-provider cria sessão + primer · herda worktree · perfil não autenticado recusa e não cria linha · histórico vazio · same-provider sem regressão · no-op continua 400
- **Rastreia**: XSW-01, XSW-05, XSW-08, XSW-14

### T5 — Primer prefixado no primeiro turno

- **O quê**: `consumePendingPrimer(session)` no handoff service + prefixo no despacho
- **Onde**: `server/modules/profiles/handoff.service.ts`, `server/modules/websocket/services/chat-websocket.service.ts` (entre `:221` e `:254`)
- **Depende de**: T2, T4
- **Reusa**: `command` já montado em `:224`
- **Feito quando**:
  - primeiro turno da sessão semeada recebe `primer + separador + prompt do usuário`
  - `seed_primer_path` limpa na mesma chamada → segundo turno vai sem primer
  - primer ilegível/ausente degrada para "sem contexto", nunca lança
- **Testes**: `server/modules/websocket/tests/` — turno 1 com primer · turno 2 sem · arquivo faltando não quebra o despacho
- **Rastreia**: XSW-09

---

## Faixa B — Backend: fila de turno

### T6 — Ligar running/idle e o dreno

- **O quê**: chamar `markSessionRunning` após o `startRun`, `markSessionIdle` + dreno no `finally`
- **Onde**: `server/modules/websocket/services/chat-websocket.service.ts:205-265`
- **Depende de**: T4
- **Reusa**: as três funções já existentes e sem caller (`handoff.service.ts:65-76,226`)
- **Feito quando**: troca pedida durante turno responde `queued` e não mata o turno; ao fim do turno a troca aplica; dreno é fire-and-forget com catch (nunca derruba o run loop)
- **Testes**: troca durante turno → `queued` e turno intacto · fim do turno aplica · dreno que lança não propaga
- **Rastreia**: XSW-11, XSW-12

### T7 — Notificar o handoff aos clientes

- **O quê**: emitir `session.handoff` no websocket quando o dreno resolve
- **Onde**: `server/modules/websocket/services/chat-websocket.service.ts`, `src/stores/useSessionStore.ts` (ou o handler de mensagens do chat)
- **Depende de**: T6
- **Reusa**: writer/broadcast já usado pelos eventos de sessão
- **Feito quando**: payload `{ type, sessionId, status, targetSessionId, provider, profileId }` chega ao cliente; sessão semeada aparece na sidebar sem reload
- **Testes**: unitário do dispatch em `server/modules/websocket/tests/`
- **Rastreia**: XSW-13

---

## Faixa C — Frontend

### T8 [P] — Hook `useProviderSwitch`

- **O quê**: regra única "mesmo provider → handoff; provider diferente → confirma, handoff, navega"
- **Onde**: **novo** `src/components/chat/hooks/useProviderSwitch.ts`
- **Depende de**: T4
- **Reusa**: `useSessionHandoff` (inalterado), `onNavigateToSession` (`AppContent.tsx:288`)
- **Feito quando**: expõe `switchTo(provider, profileId)`, estado de confirmação pendente, `isSwitching`, `error`; ao receber `seededSessionId` navega e pede refresh de projetos; sem sessão aberta não chama a rota
- **Testes**: sem runner de `src/` (DB-001) — coberto por typecheck + UAT
- **Rastreia**: XSW-03, XSW-04

### T9 [P] — `SessionAccountSwitcher` com todos os providers

- **O quê**: listar perfis de todos os providers, agrupados; aviso cross-provider; desabilitar não autenticados
- **Onde**: `src/components/profiles/view/SessionAccountSwitcher.tsx` (remover o filtro em `:51`), `HeaderSessionIdentity.tsx`, `MainContentTitle.tsx` (passar `onNavigateToSession`)
- **Depende de**: T8
- **Reusa**: `authenticated` já presente no `Profile`
- **Feito quando**: AC1–AC6 do P1; same-provider mantém o texto e o fluxo atuais; arquivo continua sob 200 linhas (extrair a lista se estourar)
- **Testes**: typecheck + lint + UAT
- **Rastreia**: XSW-02, XSW-03, XSW-04, XSW-05

### T10 [P] — Seção Provider/Conta no menu do composer

- **O quê**: seção colapsada acima de Reasoning
- **Onde**: **novo** `src/components/chat/view/subcomponents/ComposerAccountSection.tsx`; props novas em `ComposerModelMenu.tsx`, `ComposerToolbar.tsx`, `composerTypes.ts`, `ChatComposer.tsx`, `ChatInterface.tsx`
- **Depende de**: T8
- **Reusa**: `ComposerMenuPrimitives`, `profilesByProvider` (já em `useChatProviderState.ts:650`)
- **Feito quando**: AC1–AC4 do P2; props opcionais (tela vazia não quebra); `ComposerModelMenu.tsx` continua sob 200 linhas
- **Testes**: typecheck + lint + UAT
- **Rastreia**: XSW-06, XSW-07

### T11 — i18n

- **O quê**: strings novas (seção de conta, aviso de sessão nova, motivo de desabilitado, confirmação)
- **Onde**: `src/i18n/` — en + 8 locales
- **Depende de**: T9, T10
- **Reusa**: chaves de `chat`/`profiles` existentes
- **Feito quando**: nenhuma string hardcoded nas superfícies novas; 9 locales completos
- **Rastreia**: XSW-02, XSW-03, XSW-07

---

## Faixa D — Validação

### T12 — Smoke com contas reais

- **O quê**: sessão claude com 5+ mensagens → trocar para perfil codex → conferir que a primeira resposta demonstra o contexto; repetir codex → claude
- **Depende de**: T1–T11
- **Feito quando**: os dois sentidos passam; sessão de origem segue navegável e íntegra; sessão semeada aparece na sidebar sob o projeto certo
- **Rastreia**: todos

### T13 — UAT do usuário

- **O quê**: usuário exercita as duas superfícies em desktop e tablet (AD-004)
- **Depende de**: T12
- **Feito quando**: usuário confirma; decisão de commit é dele
- **Rastreia**: todos

---

## Ordem e paralelismo

```
T1 → T2 ─┐
T3 ──────┴→ T4 → T5 → T6 → T7
                 └→ T8 → [T9 | T10] → T11 → T12 → T13
```

T3 é puro e independente — pode sair junto com T1/T2. T9 e T10 são paralelas de
verdade (arquivos distintos), desde que T8 já exista.

## Status

| Task | Estado | Gate |
| --- | --- | --- |
| T1 — coluna `seed_primer_path` | ✅ Done | 471/471 |
| T2 — `updateSessionSeedPrimerPath` | ✅ Done | 482/482 |
| T3 — `handoff-primer.ts` | ✅ Done | 479/479 |
| T4 — handoff cross-provider | ✅ Done | 488/488 |
| T5 — primer prefixado no 1º turno | ✅ Done | 493/493 |
| T6 — fila ligada ao run loop | ✅ Done | 498/498 |
| T7 — broadcast `session.handoff` | ✅ Done | 502/502 |
| T8 — hook `useProviderSwitch` | ✅ Done | typecheck 0 |
| T9 — modal do header, todos os providers | ✅ Done | typecheck 0 |
| T10 — seção Provider/Conta no composer | ✅ Done | typecheck 0 |
| T11 — i18n, 10 locales | ✅ Done | build 0 |
| T14 — `authenticated` no payload da lista | ✅ Done | 504/504 |
| T12 — smoke com contas reais | ⏳ Pendente (usuário) | — |
| T13 — UAT desktop + tablet | ⏳ Pendente (usuário) | — |

**Gate final verificado pelo orquestrador**: 504/504 testes · `tsc --noEmit` nos dois
configs limpo · `npx eslint src/ server/` exit 0, 0 erros · `npm run build` EXIT 0 ·
59 arquivos no working tree, nada commitado.

> Nota de ambiente: `npm run lint` sai 1 nesta máquina por causa do wrapper npm, não
> do eslint. O gate real é `npx eslint src/ server/` (exit 0).

### Desvios de implementação (Faixa A)

- **T3**: primer renderizado em **inglês**, não no português do exemplo do design.md §2. O texto é consumido por modelo, e todas as strings server-side voltadas ao modelo já são inglês (ex.: o switch marker `Account switched to "…"`). O exemplo do design era ilustrativo.
- **T3**: orçamento aplica ao **corpo**; header + marca de truncamento ficam por cima (pior caso ~24.250 chars). Mensagem única maior que o orçamento tem a cauda clipada em vez de ser descartada — senão o primer seria só o header.
- **T4**: `handoff.service.ts` (251 ln) quebrado em três — o serviço vira orquestração pura (171 ln), `handoff-transplant.ts` (126 ln, movido verbatim, zero mudança de lógica) e `handoff-seed.ts` (162 ln). Respeita o teto de 200 linhas.
- **T4**: import dinâmico aponta para o **barril** `@/modules/providers/index.js`, não para o caminho fundo do design §3 — `eslint-plugin-boundaries` proíbe import profundo entre módulos. Precedente: `collab-model-catalog.service.ts:56`.
- **T4**: R7 materializado como `HandoffResult.primed?: boolean` — presente só no caminho cross-provider. Falha ao **escrever** o primer aborta antes de qualquer escrita no banco (não degrada): esconder erro de disco atrás de uma sessão aparentemente sã seria pior que falhar.
- **T5**: consume posicionado **depois** do `if (!run)`. Um envio duplicado com turno vivo (`RUN_IN_PROGRESS`) queimaria o primer num despacho que nunca acontece — e é irreversível depois que a coluna zera. Coberto por teste.
- **T5** (concern registrado): `chat-websocket.service.ts` está em 474 linhas, acima do teto de 200 — já estava em 455 antes. Split fica fora do escopo desta feature. Após T6/T7 chegou a ~555 linhas.
- **T7**: broadcast usa o mesmo mecanismo do `session_upserted` (itera `connectedClients` de `websocket-state.service.ts`) — audiência é todo cliente autenticado conectado, não só os inscritos na sessão. Frame `type`-tagged segue o precedente do TaskMaster no mesmo socket. Cliente só **atualiza a lista** (`refreshProjectsSilently`), nunca navega: uma troca enfileirada aterrissa de forma assíncrona, e arrastar a view do usuário seria hostil.
- **T9**: teve de estender a cadeia de props além dos arquivos designados — `MainContentHeader.tsx`, `MainContent.tsx` e `main-content/types/types.ts` não repassavam `onNavigateToSession`/refresh até o header. Prop-threading mecânico, sem colisão com a task paralela.
- **T14** (task não prevista no plano): a premissa "`authenticated` já vem na lista de perfis" era **falsa** (ver design.md §6.1). T9 contornou com N+1 requests de status, T10 com leitura fail-open — que deixava conta não autenticada parecendo usável no composer. Corrigido na raiz: `toView` emite `authenticated`, `getAuthStatus` e a lista compartilham `isProfileAuthenticated(row)`, os dois contornos foram removidos. Custo: um `fs.existsSync` por perfil na listagem.
