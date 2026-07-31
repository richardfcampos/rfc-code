# Session Worktree Toggle Specification

## Problem Statement

A feature `worktrees` entregou o painel de gerência (aba no Git panel), portado do upstream v1.37.0. Mas ela não faz o que o Claude Code desktop faz: um **toggle por sessão** que isola o trabalho do agente num worktree próprio. Para rodar isolado hoje, o usuário tem que ir na aba Worktrees, criar, esperar trocar de projeto e só então começar a conversa.

## Goals

- [x] Toggle no composer: ligado, a próxima sessão nasce dentro de um worktree novo
- [x] Zero passos extras — sem modal, sem escolher nome de branch
- [x] Reutilizar `POST /api/worktrees/create`, sem endpoint novo

## Out of Scope

| Feature | Motivo |
| --- | --- |
| Mover sessão já iniciada para worktree | O path é gravado na linha da sessão no `POST /api/providers/sessions`. Toggle some quando já há sessão. |
| Escolher o nome da branch na hora | O ponto é ser um clique. Quem quer controlar o nome usa a aba Worktrees. |
| Mesclar/remover ao fim da sessão | Ciclo de vida fica com a aba Worktrees. Fechar sessão não decide destino de código. |
| Toggle global em Settings | Usuário escolheu a variante por sessão. |

---

## User Stories

### P1: Isolar a próxima sessão ⭐ MVP

1. WHEN não há sessão aberta THEN o composer SHALL exibir o toggle "Worktree" com estado visível
2. WHEN o toggle está ligado e o usuário envia a primeira mensagem THEN o sistema SHALL criar o worktree **antes** de alocar a sessão
3. WHEN o worktree é criado THEN o sistema SHALL trocar o projeto ativo para ele, re-sincronizar a sidebar e criar a sessão com o path do worktree
4. WHEN a criação falha THEN o sistema SHALL mostrar o erro, **não** alocar sessão, **não** subir imagem e **não** limpar o input
5. WHEN já existe sessão aberta THEN o toggle SHALL sumir
6. WHEN o toggle é ligado THEN o estado SHALL persistir por `projectId` entre reloads

### P2: Nome de branch previsível

1. WHEN o worktree é criado THEN a branch SHALL ser `wt/<slug da 1ª mensagem>`, `[a-z0-9-]`, máx. 32 chars de slug
2. WHEN a mensagem não produz slug (só emoji/pontuação) THEN SHALL usar `wt/session-<seed base36>`
3. WHEN a branch já existe ou está em checkout THEN o backend responde 409 e o AC4 do P1 cobre o resto

---

## Edge Cases

- WHEN o usuário troca de projeto THEN o estado do toggle SHALL seguir a chave do projeto novo
- WHEN a mensagem é slash command THEN a interceptação ocorre antes e nenhum worktree SHALL ser criado
- WHEN há turno em voo (`isLoading`) THEN o caminho de fila retorna cedo e nenhum worktree SHALL ser criado

---

## Traceability

| ID | Story | Status |
| --- | --- | --- |
| SWT-01 | toggle + visibilidade | ✅ |
| SWT-02 | criação antes da sessão | ✅ |
| SWT-03 | troca de projeto + refresh | ✅ |
| SWT-04 | falha não aloca sessão nem perde input | ✅ |
| SWT-05 | persistência por projeto | ✅ |
| SWT-06 | slug da branch | ✅ |

## Implementação

| Arquivo | Papel |
| --- | --- |
| `src/components/chat/utils/worktreeBranchName.ts` | slug → `wt/<slug>` (novo) |
| `src/components/chat/hooks/useChatComposerState.ts` | cria o worktree em `handleSubmit`, antes do upload de imagem e da alocação da sessão; `sessionProject` substitui `selectedProject` no path e no contexto de `onSessionEstablished` |
| `src/components/chat/view/ChatInterface.tsx` | estado do toggle por `projectId` em localStorage; `handleWorktreeProjectCreated` faz refresh + select |
| `src/components/chat/view/subcomponents/ChatComposer.tsx` | chip com `role="switch"` |
| `src/components/main-content/view/MainContent.tsx` | repassa `onProjectSelect`/`onProjectsRefresh` ao ChatInterface |

## Verificação

Gate: typecheck 0, **292/292** testes, lint sem issue nos arquivos tocados, build EXIT 0.

Contrato exercido contra o app rodando (`POST /api/worktrees/create` com `wt/teste-do-toggle`, exatamente a chamada que o toggle faz):

```
→ worktreePath: .../rfc-code-worktrees/wt-teste-do-toggle
  branch: wt/teste-do-toggle   createdBranch: true
  project.fullPath: .../rfc-code-worktrees/wt-teste-do-toggle
  project.displayName: "rfc-code · wt/teste-do-toggle"
```

`project.fullPath` é o valor que o toggle injeta no `POST /api/providers/sessions`. Removido em seguida: `branchDeleted: true`, `archivedProjectId` preenchido, `git worktree list` de volta ao estado anterior.

**Não coberto por teste automatizado**: `buildWorktreeBranchName` e o caminho do `handleSubmit` são frontend, e `npm test` só varre `server/**` (DB-001). Falta UAT: ligar o toggle e mandar a primeira mensagem de verdade.
