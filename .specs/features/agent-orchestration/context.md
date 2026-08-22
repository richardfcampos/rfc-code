# Context — decisões do usuário (conversa 2026-08-22)

| # | Decisão | Verbatim/essência |
| --- | --- | --- |
| C1 | Adotar do orkestrai só o que funciona na ausência do usuário; rejeitar features de presença (canvas-workspace, design mode, Figma, mobile sim). | "quais features … deixaria o produto muito melhor pra desenvolver" + aceite da análise |
| C2 | Canvas SIM, mas como visão read-only (Team View) em cima dos dados de orquestração — não como workspace. | "pq n ter um canvas pra poder acompanhar quando eu quiser ver?" |
| C3 | Criação de task tem que ser trivial (comparativo: orkestrai ~3s vs TaskMaster init+PRD). Kanban nativo; TaskMaster vira opcional. | "qual o mais fácil de criar uma task" |
| C4 | Política de perfis por empresa é obrigatória: 3 empresas; claude de uma NUNCA na outra; pessoal permitido em qualquer uma mas SÓ como fallback quando o da empresa não tiver disponibilidade. | "o claude de uma não pode ser usado na outra, mas meu perfil pessoal pode, mas … só se n tiver nada no da empresa" |
| C5 | Skills continuam funcionando no fluxo delegado; task pode sugerir skill; automação pode disparar skill. | "vou poder usar skills, correto?" |
| C6 | Execução desta feature: Fable APENAS orquestra; workers em outros modelos escolhidos pelo orquestrador (precedente AD-012: sonnet mecânico, opus crítico). | argumento do /tlc-spec-driven |
| C7 | Branch totalmente separada da conversa de análise ("mudança bem grande"): `feat/agent-orchestration` a partir de `rfc-code` @ ce5d328. | argumento do /tlc-spec-driven |
| C8 | Fluxo-alvo de referência (exemplo validado com o usuário): task "tela de cadastro de funcionários, CPF, Tailwind" → maestro decompõe back/front/testes → quota escolhe contas → worktrees isolados → review no tablet com comentário por linha voltando pro agente. | pergunta do fluxo |

## Gray areas resolvidas pelo orquestrador (não perguntadas — defaults razoáveis, reversíveis)

| # | Decisão | Racional |
| --- | --- | --- |
| D1 | Estágios do board fixos em 4 no v1 (Backlog/Em progresso/Review/Done). | Configurável (orkestrai tem 10) é evolução; 4 cobrem o fluxo-alvo C8. |
| D2 | Org por path-prefix + override manual por projeto; org "Pessoal" é catch-all default. | Espelha layout real (`~/code/empresa-a/*`); zero-config no primeiro uso. |
| D3 | Limiar de fallback default 85%, editável por org. | Número usado nos exemplos aceitos pelo usuário. |
| D4 | Bridge v1 = MCP embutido (não CLI standalone). | Sessões já são MCP-aware; CLI seria segunda superfície pra manter. |
| D5 | Fase 1 = R1–R10; automações/inbox/review/maestro/council/team view ficam com spec pronto e execução posterior. | Menor conjunto que já entrega valor e destrava o resto; sessão única não comporta as 3 fases. |
