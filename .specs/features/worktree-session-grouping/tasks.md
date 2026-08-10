# Worktree Session Grouping Tasks

Spec: [spec.md](./spec.md) · Design: [design.md](./design.md)

Gate padrão de toda task: `npm test` verde + `npm run typecheck` EXIT 0.

---

## T1 — Resolver de contexto de worktree

- **What**: `resolveWorktreeContext(cwd, runGit)` → `{ projectPath, worktreePath, worktreeBranch }`, com cache TTL 30s e fallback silencioso.
- **Where**: criar `server/modules/worktrees/services/worktree-context.service.ts`; exportar em `server/modules/worktrees/index.ts`.
- **Reuses**: `runGit` e o limite de concorrência de `worktree-git.service.ts`; `normalizeProjectPath` de `shared/utils.ts`.
- **Depends on**: —
- **Done when**: worktree principal → `worktreePath: null`; secundário → raiz do repo + path + branch; detached → SHA curto; não-git → `projectPath = cwd`, sem throw.
- **Tests**: `server/modules/worktrees/tests/worktree-context.service.test.ts` — 6 casos (principal, secundário, detached, não-git, git ausente, cache).
- **Requisitos**: WSG-06, WSG-07

## T2 — Colunas `worktree_path` / `worktree_branch`

- **What**: adicionar as duas colunas em `sessions`, via schema + migração idempotente.
- **Where**: `server/modules/database/schema.ts` (SESSIONS_TABLE_SCHEMA_SQL), `server/modules/database/migrations.ts` (`addColumnToTableIfNotExists`).
- **Depends on**: —
- **Done when**: banco novo e banco existente terminam com as colunas; rodar a migração duas vezes não quebra.
- **Tests**: `server/modules/database/tests/` — migração idempotente sobre banco sem as colunas.
- **Requisitos**: WSG-08

## T3 — Persistência do par resolvido

- **What**: `createSession` e `createAppSession` aceitam `worktreePath`/`worktreeBranch` e gravam nas colunas novas; `createProjectPath` continua recebendo só o repo pai.
- **Where**: `server/modules/database/repositories/sessions.db.ts:72-182`; `SESSION_ROW_COLUMNS` e o tipo `SessionRow` em `shared/types.ts`.
- **Depends on**: T2
- **Done when**: inserir sessão de worktree cria **uma** linha de projeto (a do pai) e preenche as colunas; UPDATE de re-sync sobrescreve a branch.
- **Tests**: unit em `server/modules/database/tests/sessions.db.test.ts`.
- **Requisitos**: WSG-01

## T4 — Ingestão de transcripts usa o resolver

- **What**: sincronizadores resolvem o `cwd` antes de gravar.
- **Where**: `claude-session-synchronizer.provider.ts:80-96,105-132,141-154` e os equivalentes em `list/codex`, `list/cursor`, `list/opencode`.
- **Depends on**: T1, T3
- **Done when**: transcript com `cwd` de worktree secundário grava `project_path` do repo pai; transcript comum não muda de comportamento.
- **Tests**: `server/modules/providers/tests/` — um caso por provider com `runGit` fake.
- **Requisitos**: WSG-01, WSG-02

## T5 — Criação de sessão pela API usa o resolver

- **What**: `sessions.service.createSession` resolve o `projectPath` recebido antes de gravar; item de listagem expõe `worktreePath`/`worktreeBranch`.
- **Where**: `server/modules/providers/services/sessions.service.ts:131-153,216-231`; tipos em `shared/types.ts`.
- **Depends on**: T1, T3
- **Done when**: POST `/api/providers/sessions` com path de worktree devolve sessão listada sob o repo pai, com branch no payload.
- **Tests**: unit do serviço + asserção no payload de listagem.
- **Requisitos**: WSG-01, WSG-02, WSG-03

## T6 — Execução dentro do worktree

- **What**: `cwd` do runtime passa a ser `session.worktree_path` quando existir; erro `WORKTREE_MISSING` quando o diretório sumiu.
- **Where**: `server/modules/websocket/services/chat-websocket.service.ts:196-213`.
- **Depends on**: T3
- **Done when**: `clientOptions.cwd` não sobrepõe `worktree_path`; worktree apagado não spawna processo.
- **Tests**: unit do dispatch — precedência de `cwd` e caminho de erro.
- **Requisitos**: WSG-04, WSG-12

## T7 — Toggle não troca mais o projeto ativo

- **What**: criar worktree pelo composer mantém o projeto pai selecionado; o path do worktree vai só no POST de criação de sessão.
- **Where**: `src/components/chat/view/ChatInterface.tsx:82-87`; `src/components/chat/hooks/useChatComposerState.ts:744-779,813-861`.
- **Depends on**: T5
- **Done when**: ligar o toggle e enviar mensagem mantém a seleção da sidebar e cria a sessão sob o projeto pai; falha de criação continua preservando o input.
- **Tests**: unit do hook (fetch mockado) — seleção intacta, path enviado, caminho de erro.
- **Requisitos**: WSG-05

## T8 — Badge de branch na linha da sessão

- **What**: exibir `worktreeBranch` (fallback: basename de `worktreePath`) na lista de sessões.
- **Where**: item de sessão em `src/components/sidebar/`; tipos em `src/components/chat/types/types.ts`.
- **Depends on**: T5
- **Done when**: sessão com worktree mostra badge; sessão sem worktree renderiza igual a hoje.
- **Tests**: unit de render — com e sem worktree.
- **Requisitos**: WSG-03

## T9 — Backfill das sessões existentes

- **What**: serviço de boot idempotente que reaponta sessões antigas de worktree para o repo pai e arquiva projetos esvaziados.
- **Where**: criar `server/modules/worktrees/services/worktree-session-backfill.service.ts`; chamada no boot após migrações (`server/index.js` / init do banco); flag em `app_config`.
- **Depends on**: T1, T2, T3
- **Done when**: sessão de worktree existente aparece sob o pai; diretório inexistente cai na heurística `<repo>-worktrees/<slug>`; projeto vazio fica `isArchived = 1`; nenhuma sessão apagada; segunda execução é no-op.
- **Tests**: `server/modules/worktrees/tests/worktree-session-backfill.service.test.ts` — 5 casos (reaponte, dir ausente, heurística falha, projeto arquivado, erro isolado).
- **Requisitos**: WSG-09, WSG-10

## T10 — Remoção de worktree preserva histórico

- **What**: teste de regressão garantindo que remover worktree não esconde sessões (o código de `worktree-remove.service.ts` não muda).
- **Where**: `server/modules/worktrees/tests/worktree-remove.service.test.ts`.
- **Depends on**: T9
- **Done when**: após remoção, as sessões continuam listadas sob o repo pai e o projeto do worktree fica arquivado e vazio.
- **Tests**: o próprio caso acima.
- **Requisitos**: WSG-11

## T11 — Fecho

- **What**: atualizar traceability do spec para ✅, registrar AD-4 (git panel segue o projeto pai) como débito em `.specs/STATE.md`, rodar o gate completo.
- **Where**: `.specs/features/worktree-session-grouping/spec.md`, `.specs/STATE.md`.
- **Depends on**: T1–T10
- **Done when**: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` todos EXIT 0.

---

## Ordem

```
T1 ─┬─ T4 ─┐
T2 ─┴─ T3 ─┼─ T5 ─┬─ T7 ─┐
           ├─ T6 ─┤      │
           └─ T9 ─┴─ T10 ─┴─ T8 ─► T11
```

Paralelizáveis: T1 ∥ T2 · T4 ∥ T5 ∥ T6 (depois de T3) · T7 ∥ T8 (depois de T5)

**Cobertura:** 12 requisitos, 12 mapeados, 0 órfãos.
