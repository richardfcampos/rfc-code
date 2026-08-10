# Worktree Session Grouping Design

Spec: [spec.md](./spec.md) · Requisitos WSG-01..12

## Princípio

Uma única função resolve `cwd → { projectPath, worktreePath, worktreeBranch }`, e **todo** caminho de escrita de sessão passa por ela. O agrupamento vira consequência do dado gravado, não de lógica de leitura: a listagem da sidebar continua sendo o join `sessions.project_path = projects.project_path` que já existe hoje (`sessions.db.ts:418-433`), sem nenhuma mudança.

```
cwd do transcript ──┐
                    ├──► resolveWorktreeContext(cwd) ──► project_path  = raiz do repo principal
cwd da UI (toggle) ─┘                                    worktree_path = cwd, se for worktree secundário
                                                         worktree_branch = branch (ou SHA curto)
```

## Arquitetura

### Componente novo: `worktree-context.service.ts`

`server/modules/worktrees/services/worktree-context.service.ts`

```
resolveWorktreeContext(cwd, runGit): Promise<{
  projectPath: string;        // sempre preenchido; = cwd quando não-git
  worktreePath: string | null;
  worktreeBranch: string | null;
}>
```

Algoritmo (WSG-06):

1. `git -C <cwd> rev-parse --path-format=absolute --git-common-dir` → `<mainRepo>/.git`
   `path.dirname()` do resultado = raiz do worktree principal. Repo bare/`--git-common-dir` que não termina em `.git` → trata como não-git (fallback).
2. `git -C <cwd> rev-parse --show-toplevel` → raiz do worktree atual.
3. Iguais → `{ projectPath: toplevel, worktreePath: null, worktreeBranch: null }` (WSG-06 AC3).
4. Diferentes → `{ projectPath: mainRoot, worktreePath: toplevel, worktreeBranch }`, com branch de `git -C <cwd> rev-parse --abbrev-ref HEAD`; retorno `HEAD` (detached) vira SHA curto de `rev-parse --short HEAD`.
5. Qualquer erro/timeout/git ausente → `{ projectPath: cwd, worktreePath: null, worktreeBranch: null }` (AC2), com `console.warn` uma vez por diretório.

Cache (WSG-07): `Map<cwd, Promise<Context>>` no módulo, invalidado por TTL curto (30s) — o mesmo `cwd` reaparece em dezenas de transcripts por scan, e a branch precisa refrescar entre scans. Chamadas de git reusam o `runGit` do módulo de worktrees (`worktree-git.service.ts`), inclusive o limite de concorrência 4.

**Por que `--git-common-dir` e não o padrão de path `<repo>-worktrees/<slug>`:** funciona para worktree criado em qualquer lugar (terminal, outra ferramenta), e é o mesmo dado que o git usa. O padrão de path fica só como fallback do backfill, onde o diretório pode não existir mais (WSG-09 AC4).

### Schema (WSG-08)

`schema.ts` — duas colunas em `sessions`:

```sql
worktree_path TEXT,     -- NULL = sessão roda na raiz do repo (todo o comportamento atual)
worktree_branch TEXT    -- rótulo do badge; refrescado a cada sync
```

`migrations.ts` — `addColumnToTableIfNotExists(db, 'sessions', columnNames, 'worktree_path', 'TEXT')` e idem para `worktree_branch`. Sem tabela nova, sem recriação de tabela: o padrão idempotente que o arquivo já usa.

Sem FK para `projects`: `worktree_path` é diretório de execução, não chave de agrupamento.

### Caminhos de escrita

| Onde | Mudança |
| --- | --- |
| `claude-session-synchronizer.provider.ts:141-154` | `processSessionFile` passa a devolver `cwd` cru; `synchronizeHome`/`synchronizeFile` chamam `resolveWorktreeContext(cwd)` antes do `createSession`. Mesmo tratamento nos sincronizadores de codex/cursor/opencode (mesma forma, arquivos irmãos). |
| `sessions.db.ts:72-152` `createSession` | Ganha `worktreePath`/`worktreeBranch` como parâmetros. `projectsDb.createProjectPath` continua recebendo só `projectPath` — nenhuma linha de projeto é criada para worktree. UPDATE e INSERT gravam as duas colunas novas (sempre sobrescrevendo: o valor vem da resolução mais recente). |
| `sessions.db.ts:165-182` `createAppSession` | Mesmos dois parâmetros. |
| `sessions.service.ts:131-153` `createSession` | Recebe `projectPath` = o `cwd` desejado (pode ser o worktree), roda `resolveWorktreeContext` e grava o par resolvido. O frontend **não** decide o agrupamento. |
| `sessions.service.ts:216-231` (listagem) | Expõe `worktreePath` e `worktreeBranch` no item de sessão. |

### Execução (WSG-04)

`chat-websocket.service.ts:203-204`:

```ts
cwd: session.worktree_path ?? clientOptions.cwd ?? session.project_path ?? undefined,
projectPath: session.project_path ?? clientOptions.projectPath,
```

`worktree_path` vem **antes** de `clientOptions.cwd`: o cliente manda o path do projeto selecionado (agora o repo pai), e a sessão isolada não pode ser arrastada para fora do worktree por uma opção de composer.

WSG-12: antes do spawn, se `session.worktree_path` não existe em disco → `sendProtocolError('WORKTREE_MISSING', …)` com o path, sem spawn e sem criar worktree novo. O usuário decide na UI (retomar na raiz limpa o `worktree_path` da linha).

### Frontend

| Arquivo | Mudança |
| --- | --- |
| `ChatInterface.tsx:82-87` | `handleWorktreeProjectCreated` deixa de chamar `onProjectSelect`. Só `onProjectsRefresh()`. O projeto ativo continua o repo pai (WSG-05). |
| `useChatComposerState.ts:744-779` | `worktreeProject` vira `worktreeCwd: string \| null` (o `path` devolvido por `/api/worktrees/create`). `sessionProject` volta a ser sempre `selectedProject`; só o `projectPath` do POST `/api/providers/sessions` usa `worktreeCwd ?? resolvedProjectPath`. `onSessionEstablished` recebe o projeto pai — é sob ele que a sessão aparece. |
| Linha de sessão na sidebar (`SidebarProjectList` / item de sessão) | Badge com `worktreeBranch` quando presente. Sem branch (worktree criado fora e branch irresolúvel) → basename do `worktreePath`. |
| `src/components/chat/types/types.ts`, `shared/types.ts` | `worktreePath?: string \| null; worktreeBranch?: string \| null` no tipo de sessão. |

### Backfill (WSG-09/WSG-10)

Serviço de boot, **não** migração SQL — precisa de git e fs assíncronos:
`server/modules/worktrees/services/worktree-session-backfill.service.ts`, chamado uma vez no boot depois das migrações, guardado por flag em `app_config` (`worktree_session_backfill_done`).

1. `SELECT DISTINCT project_path FROM sessions WHERE worktree_path IS NULL`
2. Para cada path: se o diretório existe → `resolveWorktreeContext`. Se não existe → heurística de path `…/<repo>-worktrees/<slug>` → pai = `…/<repo>` **se** esse diretório existir e for repo git; senão pula (WSG-09 AC4).
3. Quando resolve para um repo diferente: `UPDATE sessions SET project_path = ?, worktree_path = ?, worktree_branch = ? WHERE project_path = ?`, dentro de transação por repo, depois de garantir a linha do projeto pai (`projectsDb.createProjectPath`).
4. Projeto que ficou com zero sessões → `isArchived = 1` (nunca DELETE — WSG-10).
5. Erro por path: `console.warn` e segue (AC5). `jsonl_path` nunca é tocado (AC6).

### Remoção de worktree (WSG-11)

`worktree-remove.service.ts:69-76` fica como está: continua arquivando **o projeto** ligado ao worktree. A diferença é que esse projeto já não tem sessões — elas vivem no pai —, então arquivar não esconde histórico nenhum. Nenhuma mudança de código; teste novo cobre a garantia.

## Decisões

| # | Decisão | Motivo |
| --- | --- | --- |
| AD-1 | Resolução no **write path**, não no read path | Leitura da sidebar é hot path e roda sem git; resolver na escrita mantém o join atual intacto e o custo amortizado no scan. |
| AD-2 | `worktree_branch` desnormalizado na linha da sessão | Badge sem chamada de git na listagem. Fica stale se o usuário trocar de branch dentro do worktree; o próximo sync corrige. Aceito. |
| AD-3 | "Abrir worktree como projeto" (aba Worktrees) continua existindo | Fora de escopo remover. Consequência aceita: esse projeto fica vazio, porque toda sessão criada nele é reagrupada para o pai. |
| AD-4 | Git panel/terminal seguem o **projeto selecionado** (repo pai), não o worktree da sessão | Painel é por projeto, não por sessão. Ver o diff do worktree exige a aba Worktrees. Registrar como débito em STATE.md. |
| AD-5 | Backfill em serviço de boot com flag, não em `migrations.ts` | Migrações são SQLite síncronas; git/fs são assíncronos e podem falhar por path inexistente. |
| AD-6 | Sem coluna `parent_project_id` em `projects` | O pedido é sessão→repo. Hierarquia de projeto resolveria mais do que o problema e mudaria a listagem inteira. |

## Testes

| Alvo | Tipo | Casos |
| --- | --- | --- |
| `worktree-context.service` | unit (runGit fake) | principal, secundário, detached, não-git, git ausente, cache hit |
| `sessions.db` create/createApp | unit | grava par resolvido; não cria projeto para o worktree; UPDATE sobrescreve branch |
| synchronizer claude | unit | transcript com cwd de worktree cai no projeto pai |
| backfill service | unit | reaponte, dir inexistente com heurística, projeto esvaziado arquivado, falha isolada não aborta |
| chat websocket | unit | `cwd` = worktree_path mesmo com `clientOptions.cwd` presente; `WORKTREE_MISSING` |
| composer state | unit | toggle não troca projeto; POST de sessão usa o path do worktree |

Gate: `npm test` (209+ existentes verdes), `npm run typecheck`, `npm run lint`, `npm run build`.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Scan lento por chamada de git por transcript | Cache por `cwd` + concorrência 4; scans incrementais já filtram por `birthtime`. |
| Backfill reaponta sessão errada em repo clonado dentro de outro | Só reaponta quando `--git-common-dir` aponta para outra raiz **e** o diretório existe; heurística de path exige o sufixo `-worktrees/`. |
| Sessão antiga sem `worktree_path` retomada num worktree | `worktree_path IS NULL` → comportamento atual (roda em `project_path`). Sem regressão. |
