# Worktrees Specification

## Problem Statement

Trabalhar em mais de uma frente no mesmo repositório hoje exige `git stash` / troca de branch no mesmo diretório, o que derruba o contexto de sessão do agente e obriga o rebuild do ambiente. O upstream `siteboon/claudecodeui` resolveu isso na v1.37.0 com um módulo de worktrees completo — o fork RFC Code parou na v1.36.3 e não tem nada disso (`grep -r worktree src/` = 0 resultados).

## Goals

- [ ] Criar, abrir, mesclar e remover git worktrees pela UI, sem terminal
- [ ] Cada worktree vira um **projeto próprio na sidebar**, com sessões de agente independentes
- [ ] Paridade funcional com a implementação upstream v1.37.0, adaptada ao padrão de módulos do fork (v1.36.3)
- [ ] Cobertura de teste equivalente à do upstream (8 arquivos de teste do módulo)

## Out of Scope

| Feature | Motivo |
| --- | --- |
| Merge da v1.37.0 inteira | AD-016: a v1.37 reescreveu `server/index.js`→`index.ts` e `routes/*.js`→`modules/*.module.ts`; colide de frente com os 64 commits do fork (native-install, profiles, providers, browser-use). Débito registrado. |
| Diretório de worktree configurável | AD-018: fica no padrão upstream `<pai-do-repo>/<repo>-worktrees/<branch>`. Sem UI de settings. |
| Resolução de conflito de merge na UI | Conflito aborta e faz rollback; resolver é trabalho de terminal/editor. |
| Worktrees em submódulos / bare repos | Upstream não cobre; não inventamos. |
| `git worktree lock/unlock/move/prune` | Só o estado `isLocked` é exibido; nenhuma ação sobre ele. |

---

## User Stories

### P1: Ver os worktrees do repositório ⭐ MVP

**User Story**: Como dev, quero uma aba "Worktrees" no painel de Git para ver todos os worktrees do repo com o estado real de cada um.

**Why P1**: Sem a listagem nenhuma outra ação tem onde acontecer.

**Acceptance Criteria**:

1. WHEN o usuário abre a aba Worktrees com um projeto git selecionado THEN o sistema SHALL listar todos os worktrees do repositório, o principal primeiro
2. WHEN um worktree é listado THEN o sistema SHALL exibir branch, SHA do HEAD, nº de arquivos sujos, ahead/behind vs. a base branch, assunto e data do último commit
3. WHEN o worktree corresponde ao diretório do projeto selecionado THEN o sistema SHALL marcá-lo como `isCurrent`
4. WHEN o worktree está registrado como projeto no banco THEN o sistema SHALL expor `linkedProjectId` e `linkedProjectArchived`
5. WHEN o diretório não é um repositório git THEN o sistema SHALL responder 400 `NOT_A_GIT_REPOSITORY` e a UI SHALL cair no estado de erro do painel, sem tela quebrada
6. WHEN o usuário troca de projeto com um request em voo THEN o sistema SHALL descartar a resposta obsoleta

**Independent Test**: abrir a aba num repo com 1 worktree (só o principal) e num repo com 2+; conferir os campos contra `git worktree list --porcelain` e `git status --porcelain`.

---

### P1: Criar um worktree ⭐ MVP

**User Story**: Como dev, quero criar um worktree a partir de uma branch nova ou existente e cair direto nele.

**Why P1**: É a ação que dá sentido à feature.

**Acceptance Criteria**:

1. WHEN o usuário informa um nome de branch THEN o sistema SHALL criar o worktree em `<pai-do-repo>/<repo>-worktrees/<branch-sanitizada>`
2. WHEN a branch já existe localmente THEN o sistema SHALL fazer checkout dela (`git worktree add <path> <branch>`)
3. WHEN a branch não existe THEN o sistema SHALL criá-la a partir da base branch informada, ou da branch do worktree principal (`git worktree add <path> -b <branch> <base>`)
4. WHEN a branch já está em checkout em outro worktree THEN o sistema SHALL responder 409 `BRANCH_ALREADY_CHECKED_OUT` com o path conflitante
5. WHEN a pasta de destino já existe THEN o sistema SHALL responder 409 `WORKTREE_FOLDER_EXISTS` sem tocar em nada
6. WHEN o nome da branch é inválido (começa com `-`, contém `..`, `//`, `.lock`, caracteres fora de `[a-zA-Z0-9._/-]`) THEN o sistema SHALL responder 400 `INVALID_BRANCH_NAME` antes de chamar o git
7. WHEN a criação dá certo mas o registro do projeto falha THEN o sistema SHALL remover o worktree criado (e a branch, se foi criada por ele) e propagar o erro original
8. WHEN o rollback do item 7 também falha THEN o sistema SHALL responder 500 `WORKTREE_CREATE_ROLLBACK_FAILED` com os dois erros nos details
9. WHEN a criação conclui THEN o sistema SHALL registrar o worktree como projeto ativo e — se o usuário pediu "abrir depois de criar" — trocar a UI para ele

**Independent Test**: criar `feature/x` num repo de teste; conferir a pasta irmã, a branch e o projeto novo na sidebar.

---

### P1: Abrir um worktree existente ⭐ MVP

**User Story**: Como dev, quero clicar num worktree e trabalhar nele como projeto.

**Why P1**: Worktrees criados fora da UI (pelo terminal, pelo agente) precisam de porta de entrada.

**Acceptance Criteria**:

1. WHEN o usuário abre um worktree ainda não registrado THEN o sistema SHALL criar o projeto com nome `<repo> · <branch>`
2. WHEN o projeto do worktree existe mas está arquivado THEN o sistema SHALL restaurá-lo em vez de duplicar
3. WHEN o path enviado não é um worktree registrado do repositório THEN o sistema SHALL responder 404 `WORKTREE_NOT_FOUND` — o endpoint nunca vira "criar projeto em path arbitrário"
4. WHEN a abertura conclui THEN a UI SHALL selecionar o projeto e re-sincronizar a sidebar

**Independent Test**: criar worktree por terminal (`git worktree add`), abrir pela UI, ver o projeto aparecer na sidebar.

---

### P2: Mesclar um worktree de volta

**User Story**: Como dev, quero mesclar a branch do worktree na base branch pela UI, com squash opcional e limpeza depois.

**Why P2**: Dá pra fazer por terminal; a listagem/criação/abertura é que é a dor central.

**Acceptance Criteria**:

1. WHEN o usuário confirma o merge THEN o sistema SHALL rodar tudo dentro do worktree principal, sem trocar o worktree atual do usuário
2. WHEN `squash` está ligado THEN o sistema SHALL rodar `merge --squash` + `commit -m`, senão `merge --no-ff -m`
3. WHEN o worktree de origem tem mudanças não commitadas THEN o sistema SHALL responder 409 `WORKTREE_SOURCE_DIRTY` antes de qualquer merge
4. WHEN o worktree base tem mudanças não commitadas THEN o sistema SHALL responder 409 `WORKTREE_TARGET_DIRTY`
5. WHEN o merge conflita THEN o sistema SHALL rodar `reset --merge`, abortar por completo e responder 409 `WORKTREE_MERGE_CONFLICT` com a lista de arquivos conflitantes
6. WHEN o rollback do item 5 falha THEN o sistema SHALL responder 500 `WORKTREE_MERGE_ROLLBACK_FAILED` com os dois erros
7. WHEN o worktree (origem ou base) está em detached HEAD THEN o sistema SHALL responder 400 (`WORKTREE_DETACHED_HEAD` / `WORKTREE_TARGET_DETACHED`)
8. WHEN o alvo é o worktree principal THEN o sistema SHALL responder 400 `WORKTREE_MERGE_MAIN`
9. WHEN `removeAfterMerge` está ligado THEN o sistema SHALL remover o worktree e apagar a branch — e, se essa limpeza falhar, SHALL reportar `cleanupError` sem invalidar o merge já concluído

**Independent Test**: merge limpo (verificar commit na base), merge conflitante (verificar que a base voltou ao estado anterior e que os arquivos conflitantes vieram na resposta).

---

### P2: Remover um worktree

**User Story**: Como dev, quero remover um worktree e opcionalmente apagar a branch, sem deixar projeto órfão na sidebar.

**Acceptance Criteria**:

1. WHEN o worktree tem mudanças não commitadas e `force` está desligado THEN o sistema SHALL responder 409 `WORKTREE_DIRTY` com a contagem
2. WHEN `force` está ligado THEN o sistema SHALL rodar `git worktree remove --force`
3. WHEN o alvo é o worktree principal THEN o sistema SHALL responder 400 `WORKTREE_MAIN_NOT_REMOVABLE`
4. WHEN `deleteBranch` está ligado THEN o sistema SHALL tentar `git branch -D` como best-effort — a falha não SHALL derrubar a remoção
5. WHEN existe projeto ativo ligado ao worktree THEN o sistema SHALL **arquivar** (não deletar) esse projeto, preservando o histórico de chat
6. WHEN o arquivamento falha THEN o sistema SHALL retornar `archivalError` sem falhar a remoção

**Independent Test**: remover worktree limpo (some da lista e da sidebar); tentar remover worktree sujo sem force (409); com force (remove).

---

### P3: Feedback de operação em andamento

**User Story**: Como dev, quero ver qual worktree está ocupado e o erro exato quando algo falha.

**Acceptance Criteria**:

1. WHEN uma operação open/merge/remove está em voo THEN a UI SHALL bloquear novas operações e marcar só a linha afetada como ocupada
2. WHEN a API retorna erro com `details` em array THEN a UI SHALL mostrar até 5 itens e sinalizar o truncamento

---

## Edge Cases

- WHEN o repo tem só o worktree principal THEN a lista SHALL trazer 1 item, marcado `isMain` + `isCurrent`, sem ações de merge/remove
- WHEN o worktree principal está em detached HEAD THEN `baseBranch` SHALL ser `null` e a criação sem base explícita SHALL responder 400 `WORKTREE_BASE_BRANCH_UNKNOWN`
- WHEN a branch é `feature/login-form` THEN a pasta SHALL ser `feature-login-form`
- WHEN a branch sanitiza para string vazia THEN o sistema SHALL responder 400 `INVALID_WORKTREE_FOLDER_NAME`
- WHEN `git worktree list` retorna vazio THEN o sistema SHALL responder 500 `WORKTREE_LIST_EMPTY` em vez de estourar índice
- WHEN `ahead/behind` não é calculável (mesma branch, HEAD detached, ref não nascida) THEN SHALL retornar zeros em vez de erro
- WHEN o repositório tem muitos worktrees THEN a coleta de status SHALL rodar com concorrência limitada a 4

---

## Requirement Traceability

| Requirement ID | Story | Fase | Status |
| --- | --- | --- | --- |
| WT-01 | P1: Listar | Tasks | Pending |
| WT-02 | P1: Listar (campos/estado) | Tasks | Pending |
| WT-03 | P1: Criar (paths + branch nova/existente) | Tasks | Pending |
| WT-04 | P1: Criar (validação de branch) | Tasks | Pending |
| WT-05 | P1: Criar (rollback compensatório) | Tasks | Pending |
| WT-06 | P1: Abrir (registro/restauração de projeto) | Tasks | Pending |
| WT-07 | P1: Abrir (guarda de path) | Tasks | Pending |
| WT-08 | P2: Merge (squash/no-ff + guardas de sujeira) | Tasks | Pending |
| WT-09 | P2: Merge (abort + rollback de conflito) | Tasks | Pending |
| WT-10 | P2: Remover (force / deleteBranch / arquivar projeto) | Tasks | Pending |
| WT-11 | P3: UI de estado ocupado + erro | Tasks | Pending |
| WT-12 | Aba Worktrees no painel Git + fiação App→MainContent→GitPanel | Tasks | Pending |

**Coverage:** 12 total, 12 mapeados em tasks.md, 0 sem mapeamento

---

## Success Criteria

- [ ] Criar worktree, trabalhar nele numa sessão de agente e mesclar de volta — tudo pela UI, sem terminal
- [ ] Suíte de testes verde, com os 8 arquivos de teste do módulo portados (nenhuma regressão nos 209 existentes)
- [ ] `npm run build` EXIT 0 e lint sem erros novos
- [ ] Nenhuma alteração de comportamento em projetos sem worktree além da aba nova
