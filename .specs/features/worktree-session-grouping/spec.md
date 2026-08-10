# Worktree Session Grouping Specification

## Problem Statement

Uma sessão iniciada com o toggle de worktree ligado desaparece do projeto onde ela nasceu. O toggle troca o projeto ativo para o worktree (`worktree-open.service.ts:65`), e a sessão é gravada com `project_path` = diretório do worktree (`claude-session-synchronizer.provider.ts:144`, `sessions.db.ts:85-90`), o que cria uma linha de projeto separada. Efeitos observados:

- A sessão some da lista do repositório principal — o usuário procura em `rfc-code` e não acha.
- Como `generateDisplayName` cai no `package.json.name`, um worktree aberto fora da UI aparece com **o mesmo nome** do projeto pai (`projects-with-sessions-fetch.service.ts:86-112`).
- Remover o worktree arquiva o projeto (`worktree-remove.service.ts:69-76`), e a listagem filtra `isArchived = 0` (`projects.db.ts:89-96`): o histórico de chat some da sidebar de vez, porque o rescan incremental só relê arquivos com `birthtime > lastScanAt` (`utils.ts:1195-1197`).

Isso contraria a expectativa do usuário: o worktree é um detalhe de execução da sessão, não um projeto diferente.

## Goals

- [ ] Sessão de worktree aparece na lista de sessões do **repositório principal**
- [ ] A sessão continua executando dentro do diretório do worktree (isolamento preservado)
- [ ] A branch do worktree fica visível na linha da sessão
- [ ] Sessões de worktree já existentes migram para o projeto pai, sem perda de histórico
- [ ] Remover um worktree deixa de esconder o histórico de chat

## Out of Scope

| Feature | Motivo |
| --- | --- |
| Remover o modelo "worktree como projeto" da aba Worktrees | Abrir um worktree como projeto próprio continua válido para quem quer trabalhar nele como raiz. Só o **caminho por sessão** muda. |
| Hierarquia pai/filho genérica entre projetos | Resolve mais do que o pedido; a associação é sessão→repo, não projeto→projeto. |
| Mover sessão já iniciada para outro worktree | Continua fora de escopo, como em `session-worktree-toggle`. |
| Merge/remoção automáticos ao fim da sessão | Ciclo de vida do worktree fica na aba Worktrees. |
| Agrupar sessões de repos distintos que compartilham nome | Chave é o path real do repositório principal, não o nome. |

---

## User Stories

### P1: Sessão de worktree listada no projeto pai ⭐ MVP

**User Story**: Como dev, quando eu ligo o toggle de worktree e mando a primeira mensagem, quero achar essa sessão na lista do repositório principal.

**Acceptance Criteria**:

1. WHEN uma sessão é criada com `cwd` dentro de um worktree secundário THEN o sistema SHALL gravar `project_path` = caminho do **worktree principal** do repositório e `worktree_path` = caminho do worktree secundário
2. WHEN a sessão é listada THEN ela SHALL aparecer sob o projeto do repositório principal, ordenada junto das demais sessões
3. WHEN a sessão tem `worktree_path` THEN a UI SHALL exibir a branch do worktree como badge na linha da sessão
4. WHEN a sessão é retomada THEN o processo do provider SHALL rodar com `cwd` = `worktree_path`, não `project_path`
5. WHEN o toggle cria o worktree THEN o sistema SHALL **manter** o projeto ativo no repositório principal, sem troca de seleção na sidebar
6. WHEN o `cwd` não pertence a nenhum repositório git THEN `project_path` SHALL continuar sendo o próprio `cwd` e `worktree_path` SHALL ser `NULL` (comportamento atual)

**Independent Test**: ligar o toggle num projeto limpo, mandar uma mensagem, conferir que a sessão aparece sob o projeto pai e que `pwd` dentro da sessão é o diretório do worktree.

---

### P1: Resolução do repositório principal ⭐ MVP

**User Story**: Como sistema, preciso decidir a qual repositório um `cwd` pertence, para qualquer sessão — criada pela UI, pelo terminal ou importada de transcript antigo.

**Acceptance Criteria**:

1. WHEN o sistema resolve um `cwd` THEN SHALL usar `git -C <cwd> rev-parse --path-format=absolute --git-common-dir` e derivar a raiz do worktree principal do diretório retornado
2. WHEN o comando falha, o git não existe, ou o diretório não é repositório THEN o sistema SHALL cair para `cwd` como `project_path`, sem erro visível ao usuário
3. WHEN o `cwd` já é o worktree principal THEN `worktree_path` SHALL ser `NULL` (nenhum badge, nenhuma mudança de comportamento)
4. WHEN o mesmo `cwd` é resolvido repetidamente durante um scan THEN o resultado SHALL vir de cache em memória, com no máximo uma chamada de git por diretório por scan
5. WHEN a resolução é feita durante o scan de transcripts THEN ela SHALL respeitar o mesmo limite de concorrência já usado no módulo de worktrees (4)
6. WHEN o diretório do worktree não existe mais em disco THEN a resolução SHALL usar o valor persistido em `worktree_path` e não SHALL reclassificar a sessão

**Independent Test**: rodar a resolução contra o worktree principal, um worktree secundário, um diretório comum e um diretório apagado; conferir os quatro resultados.

---

### P1: Migração das sessões existentes ⭐ MVP

**User Story**: Como dev, quero que as sessões de worktree que já existem apareçam no projeto pai depois do update, incluindo as que sumiram por arquivamento.

**Acceptance Criteria**:

1. WHEN a migração roda THEN o sistema SHALL adicionar a coluna `sessions.worktree_path TEXT` com default `NULL`
2. WHEN a migração encontra uma sessão cujo `project_path` é um worktree secundário de um repositório conhecido THEN SHALL reapontar `project_path` para o repositório principal e preencher `worktree_path` com o valor antigo
3. WHEN um projeto fica sem nenhuma sessão depois do reapontamento **e** foi criado por abertura de worktree THEN o sistema SHALL arquivá-lo, não deletá-lo
4. WHEN o diretório do worktree não existe mais THEN a sessão SHALL ser reapontada mesmo assim, desde que o repositório principal seja derivável do path (`<repo>-worktrees/<slug>` → `<repo>`); caso contrário SHALL ficar como está
5. WHEN a migração falha em uma sessão THEN SHALL registrar aviso e seguir para a próxima, sem abortar o boot
6. WHEN a migração termina THEN nenhuma sessão SHALL ter sido apagada e nenhum `jsonl_path` SHALL ter mudado

**Independent Test**: em um banco com a sessão do worktree `wt-n-o-quero-so-que-anexe-imagens-a`, rodar a migração e conferir que ela aparece sob `rfc-code` com a branch no badge.

---

### P2: Remoção de worktree não esconde histórico

**User Story**: Como dev, quero remover um worktree sem perder de vista as conversas que rodaram nele.

**Acceptance Criteria**:

1. WHEN um worktree é removido THEN as sessões que rodaram nele SHALL continuar listadas sob o projeto pai
2. WHEN o projeto ligado ao worktree ainda existir (aberto pela aba Worktrees) THEN o arquivamento atual SHALL continuar valendo para esse projeto, agora sem levar sessões junto
3. WHEN uma sessão com `worktree_path` inexistente é retomada THEN o sistema SHALL informar que o worktree não existe mais e SHALL oferecer rodar no repositório principal, sem criar worktree novo automaticamente

**Independent Test**: criar worktree por toggle, conversar, remover o worktree pela aba, conferir que a sessão continua na lista do pai e que retomar mostra o aviso.

---

## Edge Cases

- WHEN dois worktrees do mesmo repo têm sessões THEN todas SHALL aparecer sob o mesmo projeto pai, distinguidas pelo badge de branch
- WHEN o worktree está em detached HEAD THEN o badge SHALL mostrar o SHA curto em vez da branch
- WHEN o repositório principal ainda não tem linha de projeto no banco THEN ela SHALL ser criada na ingestão, como já ocorre hoje para qualquer `cwd`
- WHEN o transcript tem `cwd` de um worktree em outra máquina/profile (path inexistente) THEN vale o AC4 de migração: deriva pelo padrão de path ou mantém como está
- WHEN o usuário abre o worktree como projeto pela aba Worktrees THEN esse projeto continua existindo, mas SHALL ficar vazio de sessões — elas vivem no pai
- WHEN uma linha JSONL malformada aborta o scan do arquivo (`utils.ts:1284-1300`) THEN a sessão continua invisível — bug pré-existente, fora de escopo, registrado em STATE.md

---

## Requirement Traceability

| ID | Story | Fase | Status |
| --- | --- | --- | --- |
| WSG-01 | Gravação de `project_path` do repo + `worktree_path` | Design | Pending |
| WSG-02 | Listagem da sessão sob o projeto pai | Design | Pending |
| WSG-03 | Badge de branch na linha da sessão | Design | Pending |
| WSG-04 | Execução com `cwd` = worktree | Design | Pending |
| WSG-05 | Toggle deixa de trocar o projeto ativo | Design | Pending |
| WSG-06 | Resolução do repo principal via `--git-common-dir` + fallback | Design | Pending |
| WSG-07 | Cache e concorrência da resolução | Design | Pending |
| WSG-08 | Migração de schema (`worktree_path`) | Design | Pending |
| WSG-09 | Backfill/reaponte das sessões existentes | Design | Pending |
| WSG-10 | Arquivamento de projeto de worktree esvaziado | Design | Pending |
| WSG-11 | Remoção de worktree preserva histórico no pai | Design | Pending |
| WSG-12 | Retomada com worktree inexistente | Design | Pending |

**Coverage:** 12 total, 0 mapeados em tasks.md, 12 sem mapeamento

---

## Success Criteria

- [ ] Ligar o toggle, conversar e achar a sessão sob o repositório principal, com a branch visível
- [ ] `pwd` dentro da sessão continua sendo o worktree
- [ ] A sessão perdida (`7b512696…`) volta a aparecer sob `rfc-code` depois da migração
- [ ] Suíte verde, sem regressão nas sessões de projetos sem worktree
- [ ] `npm run build` EXIT 0, lint sem erros novos
