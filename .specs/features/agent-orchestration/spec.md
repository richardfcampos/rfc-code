# Feature: agent-orchestration (Pacote de Ausência)

## Summary

Transformar o rfc-code de "UI para rodar agente" em "time de agentes que trabalha
na ausência do usuário": tasks nativas, política de perfis por organização,
recomendação por quota, bridge agente↔app (CLI/MCP), e — em fases posteriores —
automações, inbox de handoff, review center, maestro, council estendido e team view.

Origem: análise comparativa com beeblock/orkestrai (plans/260822-orkestrai-features-adoption/).
Filtro de adoção: a feature funciona quando ninguém está olhando. Features de
"presença" do orkestrai (canvas-workspace, design mode, Figma, mobile sim) ficam fora.

## Scope: Complex — 3 fases

### Fase 1 (esta execução)

| ID | Requisito |
| --- | --- |
| R1 | Tasks nativas em SQLite: criar/listar/mover/atribuir sem TaskMaster. Criação em um campo (título) + Enter; demais campos opcionais (descrição, assignee, skill sugerida, origem). |
| R2 | Board Kanban com estágios fixos v1 (Backlog / Em progresso / Review / Done) numa tab "Tasks" por projeto; card mostra origem (você/agente/automação), assignee (provider·perfil) e worktree. |
| R3 | Entrada pela command palette existente: ação "Criar task: <texto>" quando o texto não bate com resultado. |
| R4 | Orgs: agrupar projetos por organização (regra por path-prefix + associação manual). Toda instalação tem org "Pessoal" default (catch-all). |
| R5 | Política de perfis por org: lista ordenada de perfis com papel `primary` \| `fallback` \| implicit-deny. Fallback tem condição: primários com uso ≥ limiar (default 85%) ou indisponíveis. |
| R6 | Enforcement central (profile resolver): TODOS os caminhos que escolhem perfil — spawn de sessão, composer, troca cross-provider, collab — consultam o resolver. Perfil fora da política não aparece na UI e o server recusa por API (HTTP 403, erro nomeado). Default deny. |
| R7 | Uso de fallback é registrado (audit: task/sessão, motivo, uso do primário no momento) e sinalizado na UI (chip `fallback`). |
| R8 | Recomendação por quota: serviço que, dado org + provider requisitos, retorna perfil recomendado usando os medidores de plan-usage existentes + política R5/R6. Exposto por REST e usado como default no spawn. |
| R9 | Bridge MCP: servidor MCP `rfc-code` embutido, escopado por sessão (org + projeto), com tools: `task_create`, `task_list`, `task_update_stage`, `task_assign`, `profile_recommend`. Escrita respeita R6. |
| R10 | UI de política: tela "Orgs" em Settings — CRUD de orgs, associação de projetos, lista ordenada de perfis com papel e limiar. |

### Fase 2 (spec aqui, execução futura)

| ID | Requisito |
| --- | --- |
| R11 | Automações: gatilhos (cron, task→estágio, webhook entrante, quota ≥ limiar) → ações (promptar agente via spawn com perfil do resolver, criar task, notificar push). Jobs idempotentes, retry com backoff limitado, histórico de execução. |
| R12 | Inbox de handoff: mensagens agente↔agente com id, estados enfileirado→entregue→reconhecido→respondido/falhou, persistente a restart. Tools MCP `message_send`/`message_ack`. |
| R13 | Review Center: fila de reviews ligada a tasks em estágio Review; diff por arquivo, comentário por linha persistente; approve = merge do worktree + task→Done; comentário roteado pra sessão viva do autor. |

### Fase 3 (spec aqui, execução futura)

| ID | Requisito |
| --- | --- |
| R14 | Maestro: sessão líder que decompõe task em subtasks com dependências, consulta R8, delega via R12, acompanha acks. |
| R15 | Council: generalizar collab existente para contrato evidência/risco/teste/discordância/confiança com orçamento. |
| R16 | Team View: tab read-only com grafo de sessões ativas (estado, task, quota) e arestas = handoffs do inbox; clique abre a sessão. |

## Non-goals

- Canvas-workspace com terminais em nós (presença; XL; conflita com tablet AD-004)
- Design mode / Figma / controle de dispositivos móveis
- Estágios de board configuráveis (v1 fixo em 4; configurável é evolução)
- Substituir TaskMaster à força — integração existente permanece intocada, tab própria
- Compartilhamento criptografado (tailnet já cobre o acesso remoto)

## Success criteria

- Criar task pela UI em <3s sem nenhum setup prévio no projeto (F1)
- Perfil de org A jamais listado/aceito em projeto de org B (teste de API direto → 403) (F1)
- Fallback pessoal só é usado com primário ≥ limiar, e o uso fica auditado (F1)
- Agente numa sessão consegue criar e mover task via MCP, sujeito à mesma política (F1)
- Suíte existente permanece verde; novas features cobertas por testes unit + integração
- Lint zero erros; build EXIT 0

## Traceability

Tasks em tasks.md referenciam IDs R1–R10. Fases 2–3 ganham tasks quando forem executadas.
