# Worktrees Design

Estratégia: **port cirúrgico do upstream v1.37.0** (AD-016). O código de referência é `upstream/main` (commit `06e7ee9`, "#1037"), já disponível localmente como remote — nada precisa ser baixado.

## Arquitetura

```
                        ┌──────────────────────────────────────┐
 AppContent             │ handleProjectSelect                  │  já existe em
   │                    │ refreshProjectsSilently              │  useProjectsState
   ├─ onProjectSelect ──▶└──────────────────────────────────────┘
   └─ onProjectsRefresh
        │
        ▼
   MainContent ──▶ GitPanel ──▶ GitViewTabs [Changes|Commits|Branches|Worktrees]
                                     │
                                     ▼
                              WorktreesView
                                     │  useWorktreesController
                                     ▼
                        /api/worktrees  (GET / POST create|open|merge|remove)
                                     │
                                     ▼
                          worktrees.module.ts  ← composition root
                          ┌──────────┴───────────┐
                    adapters                  services (puros, injetados)
              runGitCommand (cross-spawn)     list · create · open
              worktreeFileSystem (fs.access)  merge · remove · createAndOpen
              worktreeProjects (projectsDb +
                projects barrel)
```

O ponto forte do desenho upstream, que a gente preserva: **todo service é uma função pura com dependências injetadas**. O único lugar que junta adaptadores reais com workflows é o `worktrees.module.ts`. É por isso que os 8 arquivos de teste rodam sem tocar em disco nem em git de verdade.

## Deltas de adaptação (v1.37 → nosso v1.36.3)

Isto é o que difere de um `git checkout upstream/main -- <arquivos>` puro:

| # | Upstream v1.37 | Nosso fork | Ação |
| --- | --- | --- | --- |
| D1 | `server/index.ts` monta via sistema de módulos (`*.module.ts` registrados) | `server/index.js` monta com `app.use('/api/x', authenticateToken, xRoutes)` | Montar `app.use('/api/worktrees', authenticateToken, worktreesRoutes)` no padrão do fork |
| D2 | `createProject` / `restoreArchivedProject` exportados do barrel de projects | existem em `project-management.service.ts` / `project-delete.service.ts`, fora do barrel | Adicionar os dois ao `server/modules/projects/index.ts` |
| D3 | Tipos de worktree já em `server/shared/types.ts` | ausentes | Acrescentar o bloco de tipos (ver abaixo) |
| D4 | `GitViewTabs` com scroll horizontal + `role="tablist"` | versão sem scroll | Portar a versão upstream inteira (é melhora real p/ tablet — AD-004) |
| D5 | `GitPanelProps` com `onProjectSelect` / `onProjectsRefresh` | só `selectedProject`/`isMobile`/`onFileOpen` | Estender o tipo e a fiação `AppContent → MainContent → GitPanel` |
| D6 | `ConfirmActionModal` já com variantes usadas pelos modais de worktree | versão mais antiga | Portar as mudanças do upstream nesse arquivo |

Tudo o mais (`@/*` alias, `AppError`, `asyncHandler`, `createApiSuccessResponse`, `normalizeProjectPath`, `projectsDb.getProjectPathById`, `projectsDb.getProjectPath`, `ProjectRepositoryRow.isArchived`, `cross-spawn`) **já existe no fork** — verificado antes de escrever este design.

## Contrato da API

Envelope compartilhado `{ success, data | error{code,message,details} }`, montado por `createApiSuccessResponse` / `AppError`.

| Método | Rota | Body / Query | Resposta |
| --- | --- | --- | --- |
| GET | `/api/worktrees?project=<id>` | — | `{ repositoryRoot, baseBranch, worktrees: WorktreeInfo[] }` |
| POST | `/api/worktrees/create` | `{ project, branch, baseBranch? }` | `{ worktreePath, branch, createdBranch, project }` |
| POST | `/api/worktrees/open` | `{ project, worktreePath }` | `{ project }` |
| POST | `/api/worktrees/merge` | `{ project, worktreePath, squash, message, removeAfterMerge }` | `{ mergedBranch, targetBranch, squash, removedWorktree, cleanupError }` |
| POST | `/api/worktrees/remove` | `{ project, worktreePath, force, deleteBranch }` | `{ removedPath, branch, branchDeleted, archivedProjectId, archivalError }` |

`project` é sempre um **projectId**, resolvido para path por `services.resolveProjectPath` (404 `PROJECT_NOT_FOUND` se não existir). A camada de rota só faz parsing — nenhuma rota fala com o Database.

## Tipos a acrescentar em `server/shared/types.ts`

`GitCommandResult`, `GitCommandRunner`, `WorktreePorcelainEntry`, `WorktreeDescriptor`, `WorktreeListResult`, `ListWorktreesInput`, `CreateWorktreeInput`, `CreateWorktreeResult`, `CreateAndOpenWorktreeResult`, `OpenWorktreeInput`, `MergeWorktreeInput`, `MergeWorktreeResult`, `RemoveWorktreeInput`, `RemoveWorktreeResult`, `WorktreeProjectView`, `WorktreeFileSystem`, `WorktreeProjectGateway`, `WorktreeServices` — copiados do bloco correspondente do upstream.

Espelho no frontend em `src/components/git-panel/types/types.ts`: `WorktreeInfo`, `WorktreeListData`, `WorktreeApiEnvelope<T>`, `MergeWorktreeOptions`, `RemoveWorktreeOptions`.

## Decisões de segurança herdadas (manter intactas)

1. **Path só via porcelain** — `findWorktreeEntryByPath` só aceita paths que aparecem no `git worktree list --porcelain` do próprio repo. Sem isso, `/open` viraria "criar projeto em qualquer path".
2. **Validação de branch em profundidade** — `validateWorktreeBranchName` roda antes de qualquer chamada de git, rejeitando `-flag`, `..`, `//`, `.lock`, `.` inicial e caracteres fora de `[a-zA-Z0-9._/-]`.
3. **`spawn` sem shell** — `cross-spawn` com `shell: false`; args nunca são interpolados numa string.
4. **Merge não destrutivo** — origem e destino têm de estar limpos; conflito faz `reset --merge` e aborta.
5. **Remoção arquiva, não deleta** — o projeto ligado ao worktree é arquivado; histórico de chat sobrevive.

## Inventário de arquivos

**Novos — backend** (`server/modules/worktrees/`): `index.ts`, `worktrees.module.ts`, `worktrees.routes.ts`, `services/worktree-{git,list,create,create-and-open,open,merge,remove}.service.ts`, `tests/` (8 arquivos).

**Novos — frontend**: `src/components/git-panel/hooks/useWorktreesController.ts`, `view/worktrees/WorktreesView.tsx`, `view/modals/{New,Merge,Remove}WorktreeModal.tsx`.

**Modificados**: `server/index.js` (D1), `server/modules/projects/index.ts` (D2), `server/shared/types.ts` (D3), `src/components/git-panel/view/GitViewTabs.tsx` (D4), `.../types/types.ts` (D5), `.../view/GitPanel.tsx`, `.../view/modals/ConfirmActionModal.tsx` (D6), `src/components/main-content/types/types.ts`, `.../view/MainContent.tsx`, `src/components/app/AppContent.tsx`, i18n.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Worktrees criados em pasta irmã poluem `/Volumes/External Code/M1/Code/personal/` | AD-018 aceitou; a pasta é `<repo>-worktrees/`, previsível e única por repo |
| Volume externo + serviço nativo (AD-015): criar worktree exige permissão de escrita no volume | Já resolvido — o node do LaunchAgent tem Full Disk Access desde o incidente de 2026-07-30 |
| `ConfirmActionModal` compartilhado com Branches/Changes: portar a versão upstream pode mexer no que já funciona | Diff dirigido, não sobrescrita cega; conferir os call sites existentes |
| `server/index.js` é JS e os módulos são TS | Já é o padrão vigente do fork (`allowJs: true`); os outros módulos TS são montados assim hoje |
