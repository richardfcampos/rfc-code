# Worktrees Tasks

**Spec**: `.specs/features/worktrees/spec.md`
**Design**: `.specs/features/worktrees/design.md`
**Status**: In Progress

**Referência**: `upstream/main` (`06e7ee9`). Todos os arquivos-fonte estão acessíveis via `git show upstream/main:<path>`.

## Gate Check Commands

| Gate | Comando | Baseline |
| --- | --- | --- |
| quick | `npm test` | 256 testes / 249 pass / **7 fail pré-existentes** (ver T0) |
| full | `npm test && npm run typecheck` | — |
| build | `npm run build` | EXIT 0 |
| lint | `npm run lint` | 0 erros |

Não existe `.specs/codebase/TESTING.md`. Matriz de cobertura adotada, inferida do repo: **services de backend → unit co-located** (padrão de todos os módulos existentes); **rotas → unit com services injetados**; **componentes React → none** (o `npm test` só varre `server/**`; os `.test.ts` de `src/` não têm runner configurado — dívida registrada, fora deste escopo).

---

## Execution Plan

```
Fase 0        T0
               │
Fase 1        T1 ──┬── T2
                   │
Fase 2             ├─→ T3 ─┬→ T4 [P]
                   │       ├→ T5 [P]
                   │       ├→ T6 [P]
                   │       └→ T7 [P] ──→ T8
                   │                      │
                   │            T5,T6,T7 ─┴→ T9
                   │
Fase 3             └─→ T10
                        │
        T2,T4..T9,T10 ─→ T11 ─→ T12
                                 │
Fase 4                          T13 ─┬→ T14 ─┐
                                     └→ T15 ─┴→ T16 ─→ T17 ─→ T18
                                                                │
                                     T19 ──────────────────────┤
Fase 5                                                          └→ T20
```

Execução **sequencial** nesta sessão (sem sub-agentes — restrição do ambiente). As marcas `[P]` indicam ausência de dependência entre si, não paralelismo real desta rodada.

---

## Task Breakdown

### T0: Isolar o env de trusted mode nos testes de auth

**What**: `withIsolatedAuthEnvironment` passa a **apagar** `AUTH_MODE`, `AUTH_TRUSTED_CONTAINER_BIND` e `AUTH_TRUSTED_NATIVE_BIND` no setup (já restaura no teardown), para que a suíte não dependa do `~/.rfc-code/env` da máquina.
**Where**: `server/middleware/auth.test.js`
**Depends on**: None
**Requirement**: — (habilitador de gate; falha pré-existente de AD-015, não desta feature)

**Done when**:
- [ ] Os 7 testes de auth passam com `AUTH_TRUSTED_NATIVE_BIND=1` presente no ambiente
- [ ] Nenhum teste novo criado, nenhum removido
- [ ] Gate: `npm test` → 256/256 pass

**Verify**: `npm test 2>&1 | grep -c '^not ok'` → `0`

**Commit**: `fix(test): isolate trusted-mode env vars in auth tests`

---

### T1: Tipos de worktree no contrato compartilhado

**What**: Acrescentar o bloco de tipos de worktree ao types compartilhado do servidor.
**Where**: `server/shared/types.ts` (modify)
**Depends on**: T0
**Reuses**: `ProjectRepositoryRow` (linha 549), padrão de tipos do arquivo
**Requirement**: WT-01..WT-10

**Done when**:
- [ ] `GitCommandResult`, `GitCommandRunner`, `WorktreePorcelainEntry`, `WorktreeDescriptor`, `WorktreeListResult`, `ListWorktreesInput`, `CreateWorktreeInput`, `CreateWorktreeResult`, `CreateAndOpenWorktreeResult`, `OpenWorktreeInput`, `MergeWorktreeInput`, `MergeWorktreeResult`, `RemoveWorktreeInput`, `RemoveWorktreeResult`, `WorktreeProjectView`, `WorktreeFileSystem`, `WorktreeProjectGateway`, `WorktreeServices` definidos
- [ ] `npm run typecheck` sem erros novos

**Tests**: none (só tipos) · **Gate**: build

---

### T2: Expor createProject e restoreArchivedProject no barrel de projects

**What**: Adicionar os dois re-exports ao barrel, para o módulo de worktrees não importar arquivos de service diretamente.
**Where**: `server/modules/projects/index.ts` (modify)
**Depends on**: T0
**Reuses**: `project-management.service.ts:88`, `project-delete.service.ts:80`
**Requirement**: WT-06, WT-10

**Done when**:
- [ ] `createProject` e `restoreArchivedProject` exportados
- [ ] Nenhum import existente quebrado
- [ ] Gate: `npm test` → 256 pass

**Tests**: none (re-export) · **Gate**: quick

---

### T3: Service de primitivas git dos worktrees

**What**: Runner do git + validação de branch + parser do porcelain + busca de entry + contagem de arquivos sujos.
**Where**: `server/modules/worktrees/services/worktree-git.service.ts` + `tests/worktree-git.service.test.ts`
**Depends on**: T1
**Reuses**: `cross-spawn` (mesma escolha de `server/routes/git.js`), `AppError`, `normalizeProjectPath`
**Requirement**: WT-01, WT-04, WT-07

**Done when**:
- [ ] `runGitCommand`, `validateWorktreeBranchName`, `parseWorktreeListPorcelain`, `listWorktreePorcelainEntries`, `findWorktreeEntryByPath`, `countChangedFiles` exportados
- [ ] Nomes de branch inválidos (`-x`, `..`, `//`, `a.lock`, `.oculta`) rejeitados com 400
- [ ] Path fora do porcelain rejeitado com 404
- [ ] Gate: `npm test` → 256 + testes deste arquivo

**Tests**: unit · **Gate**: quick

---

### T4: Service de listagem [P]

**What**: Monta o payload do painel: worktrees + dirty count + ahead/behind + último commit + projeto ligado.
**Where**: `.../services/worktree-list.service.ts` + teste
**Depends on**: T3
**Requirement**: WT-01, WT-02

**Done when**:
- [ ] Principal sempre primeiro, `isMain`/`isCurrent` corretos
- [ ] `ahead/behind` cai em zeros quando não calculável
- [ ] Concorrência limitada a 4
- [ ] Gate: `npm test`

**Tests**: unit · **Gate**: quick

---

### T5: Service de criação [P]

**What**: Cria worktree em `<pai>/<repo>-worktrees/<branch-sanitizada>`, branch nova ou existente.
**Where**: `.../services/worktree-create.service.ts` + teste
**Depends on**: T3
**Requirement**: WT-03, WT-04

**Done when**:
- [ ] `feature/login-form` → pasta `feature-login-form`
- [ ] 409 `BRANCH_ALREADY_CHECKED_OUT` e 409 `WORKTREE_FOLDER_EXISTS` cobertos
- [ ] 400 `WORKTREE_BASE_BRANCH_UNKNOWN` quando o principal está detached
- [ ] Gate: `npm test`

**Tests**: unit · **Gate**: quick

---

### T6: Service de abertura como projeto [P]

**What**: Registra/restaura o projeto do worktree e devolve a view do projeto.
**Where**: `.../services/worktree-open.service.ts` + teste
**Depends on**: T3
**Requirement**: WT-06, WT-07

**Done when**:
- [ ] Nome `<repo> · <branch>`
- [ ] Projeto arquivado é restaurado, não duplicado
- [ ] Path não-worktree → 404
- [ ] Gate: `npm test`

**Tests**: unit · **Gate**: quick

---

### T7: Service de remoção [P]

**What**: Remove worktree linkado, apaga branch (best-effort) e arquiva o projeto ligado.
**Where**: `.../services/worktree-remove.service.ts` + teste
**Depends on**: T3
**Requirement**: WT-10

**Done when**:
- [ ] Sujo sem force → 409 `WORKTREE_DIRTY`; principal → 400 `WORKTREE_MAIN_NOT_REMOVABLE`
- [ ] Falha de `branch -D` não derruba a remoção
- [ ] Projeto é **arquivado**, nunca deletado; falha vira `archivalError`
- [ ] Gate: `npm test`

**Tests**: unit · **Gate**: quick

---

### T8: Service de merge

**What**: Merge da branch do worktree na base, com squash opcional, guardas de sujeira e rollback de conflito.
**Where**: `.../services/worktree-merge.service.ts` + teste
**Depends on**: T3, T7
**Requirement**: WT-08, WT-09

**Done when**:
- [ ] `--squash` + `commit -m` vs `--no-ff -m` conforme a flag
- [ ] 409 para origem suja, destino sujo e conflito (com lista de arquivos)
- [ ] Conflito dispara `reset --merge`; falha de rollback → 500 `WORKTREE_MERGE_ROLLBACK_FAILED`
- [ ] `removeAfterMerge` falho vira `cleanupError` sem invalidar o merge
- [ ] Gate: `npm test`

**Tests**: unit · **Gate**: quick

---

### T9: Service de criar-e-abrir com compensação

**What**: Orquestra create → open, revertendo o worktree se o registro falhar.
**Where**: `.../services/worktree-create-and-open.service.ts` + teste
**Depends on**: T5, T6, T7
**Requirement**: WT-05

**Done when**:
- [ ] Falha no open remove o worktree (force) e a branch se foi criada ali
- [ ] Falha do rollback → 500 `WORKTREE_CREATE_ROLLBACK_FAILED` com os dois erros
- [ ] Gate: `npm test`

**Tests**: unit · **Gate**: quick

---

### T10: Router HTTP dos worktrees

**What**: Router express com as 5 rotas, só parsing, services injetados.
**Where**: `server/modules/worktrees/worktrees.routes.ts` + `tests/worktrees.routes.test.ts`
**Depends on**: T1
**Reuses**: `asyncHandler`, `createApiSuccessResponse`, `AppError`
**Requirement**: WT-01..WT-10

**Done when**:
- [ ] `project` ausente → 400 `PROJECT_ID_REQUIRED`; campos obrigatórios → 400 `INVALID_REQUEST_BODY`
- [ ] Nenhuma rota importa Database
- [ ] Gate: `npm test`

**Tests**: unit · **Gate**: quick

---

### T11: Composition root do módulo

**What**: Adaptadores reais (fs, git, projects) + montagem dos services + export do router.
**Where**: `server/modules/worktrees/worktrees.module.ts`, `server/modules/worktrees/index.ts`
**Depends on**: T2, T4, T5, T6, T7, T8, T9, T10
**Requirement**: WT-01..WT-10

**Done when**:
- [ ] `resolveProjectPath` lança 404 `PROJECT_NOT_FOUND` quando o id não resolve
- [ ] Barrel exporta só `worktreesRoutes`
- [ ] Gate: `npm run typecheck` + `npm test`

**Tests**: none (coberto pelos services/rotas) · **Gate**: full

---

### T12: Montar /api/worktrees no servidor

**What**: `app.use('/api/worktrees', authenticateToken, worktreesRoutes)` no padrão do fork (delta D1).
**Where**: `server/index.js` (modify)
**Depends on**: T11
**Reuses**: bloco de montagem das linhas 176-227
**Requirement**: WT-12

**Done when**:
- [ ] Rota autenticada como as demais
- [ ] Servidor sobe sem erro; `GET /api/worktrees?project=x` sem token → 401
- [ ] Gate: `npm run build` EXIT 0

**Tests**: none · **Gate**: build

**Commit** (T1..T12): `feat(worktrees): backend module for git worktree management`

---

### T13: Tipos de worktree no frontend + props do GitPanel

**What**: Espelho dos tipos da API + `onProjectSelect`/`onProjectsRefresh` em `GitPanelProps` (delta D5).
**Where**: `src/components/git-panel/types/types.ts` (modify)
**Depends on**: T12
**Requirement**: WT-12

**Done when**:
- [ ] `WorktreeInfo`, `WorktreeListData`, `WorktreeApiEnvelope`, `MergeWorktreeOptions`, `RemoveWorktreeOptions` definidos
- [ ] `GitPanelView` aceita `'worktrees'`
- [ ] Gate: `npm run typecheck`

**Tests**: none · **Gate**: build

---

### T14: Controller de worktrees

**What**: Hook com fetch + create/open/merge/remove, guarda de resposta obsoleta e trava de operação única.
**Where**: `src/components/git-panel/hooks/useWorktreesController.ts`
**Depends on**: T13
**Reuses**: `authenticatedFetch` (`src/utils/api`)
**Requirement**: WT-11

**Done when**:
- [ ] Troca de projeto no meio do request descarta a resposta
- [ ] Só uma operação open/merge/remove por vez
- [ ] `details` em array mostra até 5 + reticências
- [ ] Gate: `npm run typecheck`

**Tests**: none (sem runner de frontend) · **Gate**: build

---

### T15: Modais New / Merge / Remove

**What**: Os três modais + o delta do `ConfirmActionModal` (D6).
**Where**: `src/components/git-panel/view/modals/{New,Merge,Remove}WorktreeModal.tsx`, `ConfirmActionModal.tsx` (modify)
**Depends on**: T13
**Requirement**: WT-03, WT-08, WT-10

**Done when**:
- [ ] New: branch + base branch + "abrir depois de criar"
- [ ] Merge: squash, mensagem, remover depois
- [ ] Remove: force, apagar branch
- [ ] Call sites atuais do `ConfirmActionModal` (Branches/Changes) continuam funcionando
- [ ] Gate: `npm run typecheck`

**Tests**: none · **Gate**: build

---

### T16: WorktreesView

**What**: Lista, estados vazio/carregando/erro, ações por linha.
**Where**: `src/components/git-panel/view/worktrees/WorktreesView.tsx`
**Depends on**: T14, T15
**Requirement**: WT-01, WT-02, WT-11

**Done when**:
- [ ] Principal identificado, sem merge/remove
- [ ] Badges de dirty / ahead / behind / locked / detached
- [ ] Linha ocupada bloqueia as demais ações
- [ ] Gate: `npm run typecheck`

**Tests**: none · **Gate**: build

---

### T17: Aba Worktrees no painel Git

**What**: Portar o `GitViewTabs` upstream (com scroll horizontal + `role="tablist"`, delta D4) e ligar a view no `GitPanel`.
**Where**: `src/components/git-panel/view/GitViewTabs.tsx`, `view/GitPanel.tsx` (modify)
**Depends on**: T16
**Requirement**: WT-12

**Done when**:
- [ ] 4ª aba com ícone `GitFork`
- [ ] Abas roláveis no mobile/tablet sem quebrar o layout desktop
- [ ] Gate: `npm run typecheck`

**Tests**: none · **Gate**: build

---

### T18: Fiação AppContent → MainContent → GitPanel

**What**: Passar `handleProjectSelect` e `refreshProjectsSilently` até o GitPanel (delta D5).
**Where**: `src/components/app/AppContent.tsx`, `src/components/main-content/types/types.ts`, `view/MainContent.tsx` (modify)
**Depends on**: T17
**Reuses**: `useProjectsState` (`handleProjectSelect:836`, `refreshProjectsSilently:482`)
**Requirement**: WT-12

**Done when**:
- [ ] Abrir worktree troca o projeto ativo e re-sincroniza a sidebar
- [ ] Gate: `npm run build` EXIT 0

**Tests**: none · **Gate**: build

---

### T19: i18n dos worktrees

**What**: Chaves novas em `en` + 8 locales.
**Where**: `src/i18n/locales/*/…`
**Depends on**: T13
**Requirement**: WT-11

**Done when**:
- [ ] `en` completo; demais locales sem chave faltando
- [ ] Gate: `npm run build`

**Tests**: none · **Gate**: build

**Commit** (T13..T19): `feat(worktrees): git panel worktrees tab with create, open, merge and remove`

---

### T20: Gate final + UAT

**What**: Rodar a bateria completa e validar o fluxo real ponta a ponta.
**Depends on**: T18, T19
**Requirement**: todos

**Done when**:
- [ ] `npm test` 256+ pass, 0 fail
- [ ] `npm run typecheck` limpo · `npm run lint` sem erros novos · `npm run build` EXIT 0
- [ ] UAT (usuário): criar worktree → aparece na sidebar → sessão de agente nele → merge de volta → remover

**Tests**: — · **Gate**: full + build

---

## Task Granularity Check

| Task | Escopo | Status |
| --- | --- | --- |
| T0 | 1 helper de teste | ✅ |
| T1 | 1 arquivo de tipos | ✅ |
| T2 | 1 barrel | ✅ |
| T3–T9 | 1 service + seu teste cada | ✅ |
| T10 | 1 router + teste | ✅ |
| T11 | 1 composition root | ✅ |
| T12 | 1 ponto de montagem | ✅ |
| T13 | 1 arquivo de tipos | ✅ |
| T14 | 1 hook | ✅ |
| T15 | 3 modais coesos + 1 delta | ⚠️ OK — mesma pasta, mesmo contrato |
| T16–T19 | 1 view / 1 aba / 1 fiação / 1 i18n | ✅ |
| T20 | verificação | ✅ |

## Diagram-Definition Cross-Check

| Task | Depends on (corpo) | Diagrama | Status |
| --- | --- | --- | --- |
| T0 | — | raiz | ✅ |
| T1 | T0 | T0→T1 | ✅ |
| T2 | T0 | T0→T2 (via T1 na linha) | ✅ |
| T3 | T1 | T1→T3 | ✅ |
| T4,T5,T6,T7 | T3 | T3→{T4,T5,T6,T7} | ✅ |
| T8 | T3, T7 | T7→T8 | ✅ |
| T9 | T5,T6,T7 | {T5,T6,T7}→T9 | ✅ |
| T10 | T1 | T1→T10 | ✅ |
| T11 | T2,T4–T10 | convergem em T11 | ✅ |
| T12 | T11 | T11→T12 | ✅ |
| T13 | T12 | T12→T13 | ✅ |
| T14,T15 | T13 | T13→{T14,T15} | ✅ |
| T16 | T14,T15 | →T16 | ✅ |
| T17 | T16 | →T17 | ✅ |
| T18 | T17 | →T18 | ✅ |
| T19 | T13 | T19→T20 | ✅ |
| T20 | T18,T19 | →T20 | ✅ |

## Test Co-location Validation

| Task | Camada | Matriz exige | Task diz | Status |
| --- | --- | --- | --- | --- |
| T3–T10 | service/rota de backend | unit | unit | ✅ |
| T1, T13 | tipos | none | none | ✅ |
| T2 | re-export | none | none | ✅ |
| T11 | composition root | none (coberto por T3–T10) | none | ✅ |
| T12, T18 | fiação | none | none | ✅ |
| T14–T17, T19 | componente React | none (sem runner) | none | ✅ |

---

## Progress

| Task | Status | Notas |
| --- | --- | --- |
| T0 | ✅ Done | `withIsolatedAuthEnvironment` passou a limpar `AUTH_MODE` + as duas vars de bind. 249/256 → 256/256 |
| T1 | ✅ Done | 254 linhas de tipos anexadas; nosso arquivo terminava exatamente onde o bloco do upstream começa |
| T2 | ✅ Done | `createProject` + `restoreArchivedProject` no barrel |
| T3–T11 | ✅ Done | **port literal, zero adaptação** — 18 arquivos, typecheck limpo de primeira, +36 testes (256 → 292) |
| T12 | ✅ Done | `app.use('/api/worktrees', authenticateToken, worktreesRoutes)` |
| T13 | ✅ Done | só os hunks de worktree; `notGitRepository`/`initRepository`/`isLoadingCommits` do upstream **deixados de fora** (feature de git-init, outro escopo — AD-016) |
| T14–T16 | ✅ Done | controller + view + 3 modais, port literal. `ConfirmActionModal` **não precisou** de delta (D6 do design não se materializou — os modais são autossuficientes) |
| T17 | ✅ Done | `GitViewTabs` do upstream (abas roláveis + `role="tablist"`) |
| T18 | ✅ Done | `handleProjectSelect` + `refreshProjectsSilently` já existiam no `useProjectsState` |
| T19 | ⛔ N/A | o painel Git inteiro (nosso **e** o do upstream) não usa i18n — strings hardcoded. A feature segue a convenção existente. Dívida: DB-003 |
| T20 | ✅ Done (automático) / ⏳ UAT pendente | 292/292, typecheck 0, build EXIT 0, lint 0 erros. Smoke real com git validado (ver abaixo) |

## Verificação executada

Além dos 36 testes unitários (que injetam um runner falso), rodei os services contra **git de verdade** em repositórios descartáveis:

**Ciclo feliz** — `createWorktree('feature/login-form')` → pasta `wt-smoke-worktrees/feature-login-form`, branch criada; `listWorktrees` reportou base `main`, ahead 1/behind 0 e o assunto do último commit após um commit no worktree; `mergeWorktree(removeAfterMerge)` gerou o merge commit em `main`, removeu o worktree e apagou a branch; sobrou só o worktree principal.

**Conflito** — edições divergentes na mesma linha dos dois lados. Resultado: `WORKTREE_MERGE_CONFLICT` 409 com `["shared.txt"]`, **HEAD inalterado**, conteúdo de `main` inalterado, working tree limpa dos dois lados, worktree de origem preservado. O rollback via `reset --merge` faz o que promete.

**Achado (não é defeito nosso)**: no smoke, `isCurrent` veio `false` para o worktree principal porque passei `/tmp/wt-smoke` e o git reporta `/private/tmp/wt-smoke` (symlink do macOS). No app o path vem do banco, gravado a partir de `pathValidation.resolvedPath`, então já chega resolvido. Comportamento idêntico ao do upstream.
