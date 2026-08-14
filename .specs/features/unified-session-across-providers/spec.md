# Unified Session Across Providers — Specification

**Criado:** 2026-08-14
**Pesquisa:** [research.md](research.md)
**Antecessor:** `.specs/features/cross-provider-session-switch/` (AD-020)

## Problem Statement

Trocar de provider no meio da sessão hoje cria uma `session_id` nova: a conversa se parte em
duas na sidebar e o usuário perde o fio. Trocar de conta dentro do mesmo provider já preserva
a sessão (transplant), então o caso real "o crédito acabou, quero seguir na outra conta" só
quebra quando cruza provider. O `session_id` já é, por contrato do próprio schema, o id
estável do app (`schema.ts:125-130`) — o fork viola esse contrato para resolver um problema
que é do provider, não do app.

## Goals

- [ ] Trocar provider/conta/modelo no meio da sessão sem que a `session_id` mude — a conversa
      continua sendo uma linha só na sidebar e na URL
- [ ] Histórico contínuo: mensagens de todas as pernas em ordem cronológica, com fronteira
      visível de quem respondeu o quê
- [ ] Voltar a um provider já usado retoma a sessão nativa dele (resume, não sessão nova)
- [ ] Pares já forkados pela feature anterior viram uma sessão só

## Out of Scope

| Feature | Motivo |
| --- | --- |
| Traduzir transcript nativo entre CLIs (forjar rollout do codex a partir do claude) | Formato interno, versionado por `cli_version`, `reasoning.encrypted_content` não atravessa conta. Ver research §3 |
| Store canônico de mensagens no banco substituindo o transcript do CLI | Abandonaria resume nativo dos 4 providers. Ver research §comparativa opção C |
| Tool calls / thinking atravessando a fronteira de provider | Segue a limitação atual do primer: só papel + texto |
| Troca automática de conta quando o limite estourar | Ideia adjacente, feature própria (ver Deferred em context.md) |
| Preservar cache de prompt na troca | Impossível — cache é por provider/modelo. Comunicado, não contornado |

---

## User Stories

### P1: Sessão não forka ao trocar de provider ⭐ MVP

**User Story**: Como usuário com contas em mais de um provider, quero trocar de provider no
meio da conversa e continuar na mesma sessão, para não perder o lugar quando o crédito acabar.

**Why P1**: É a dor relatada. Sem isso a feature anterior entrega contexto mas quebra navegação.

**Acceptance Criteria**:

1. WHEN o usuário troca para um perfil de outro provider THEN o sistema SHALL manter a mesma
   `sessions.session_id` e repontar `provider`, `profile_id` e `provider_session_id` para a perna nova
2. WHEN a troca conclui THEN o sistema SHALL manter o usuário na mesma sessão aberta, sem
   navegar para outro id
3. WHEN a troca conclui THEN a sidebar SHALL continuar exibindo uma entrada só para a conversa
4. WHEN a troca ocorre THEN a sessão nova do provider destino SHALL herdar `project_path`,
   `worktree_path` e `worktree_branch` da sessão
5. WHEN a troca falha em qualquer etapa THEN o sistema SHALL deixar a sessão na perna anterior,
   sem estado meio-trocado, e reportar o erro

**Independent Test**: Abrir sessão no claude, trocar pro codex pelo menu do composer, conferir
que a URL/id não mudou, que a sidebar tem uma linha só, e que o próximo turno roda no codex.

---

### P1: Histórico contínuo com fronteira visível ⭐ MVP

**User Story**: Como usuário, quero ver toda a conversa numa timeline só, sabendo onde cada
provider/conta entrou, para entender quem produziu cada resposta.

**Why P1**: Sem isso a sessão é "única" só no nome — o painel mostraria apenas a perna ativa.

**Acceptance Criteria**:

1. WHEN o histórico de uma sessão com N pernas é pedido THEN o sistema SHALL devolver as
   mensagens de todas as pernas ordenadas por `timestamp` (merge, não concatenação de pernas)
2. WHEN duas pernas consecutivas na ordem cronológica têm provider ou perfil diferente THEN o
   sistema SHALL inserir um marcador de fronteira com provider destino, nome da conta e horário
3. WHEN o chat renderiza um marcador de fronteira THEN a UI SHALL exibi-lo como separador de
   sistema, visualmente distinto de mensagem de usuário ou assistente
4. WHEN o histórico é paginado (`limit`/`offset`) THEN a paginação SHALL operar sobre a
   timeline unificada, não por perna
5. WHEN o transcript de uma perna sumiu do disco THEN o sistema SHALL renderizar as demais
   pernas e marcar a perna ausente como indisponível, sem falhar a requisição inteira

**Independent Test**: Sessão com claude→codex→claude; abrir o histórico e conferir ordem
cronológica correta e dois separadores.

---

### P1: Retomar perna existente ao voltar para um provider ⭐ MVP

**User Story**: Como usuário que alterna entre contas, quero que voltar ao provider anterior
retome a sessão nativa dele, para não jogar fora o transcript e o cache já acumulados.

**Why P1**: Decisão do usuário (context.md §Volta). Sem isso, alternar A→B→A cria três sessões
nativas e paga o custo de contexto toda vez.

**Acceptance Criteria**:

1. WHEN o usuário troca para um par (provider, perfil) que já tem perna nesta sessão THEN o
   sistema SHALL reativar essa perna e resumir a sessão nativa dela, sem criar sessão nova
2. WHEN uma perna é reativada THEN o sistema SHALL montar um primer contendo apenas o que
   aconteceu **depois** do último turno daquela perna
3. WHEN a perna reativada tem seu transcript nativo ausente ou ilegível THEN o sistema SHALL
   degradar para perna nova, explicitamente e de forma observável
4. WHEN o usuário troca para um par (provider, perfil) sem perna nesta sessão THEN o sistema
   SHALL criar perna nova com o primer completo (comportamento atual)

**Independent Test**: claude→codex→claude; conferir que a terceira troca reusa o
`provider_session_id` da primeira perna e que o primer cobre só o trecho do codex.

---

### P1: Contexto inteiro atravessa, resumido só quando não couber ⭐ MVP

**User Story**: Como usuário, quero que o modelo do outro provider saiba de tudo que já
conversamos, para eu continuar falando sem reexplicar nada — como se eu não tivesse trocado.

**Why P1**: É a diferença entre "a sessão é a mesma" e "a conversa é a mesma". O primer de 24k
chars (≈6k tokens) atual entrega a cauda e joga o resto fora — o modelo destino chega amnésico.

**Acceptance Criteria**:

1. WHEN uma troca cross-provider ocorre THEN o primer SHALL conter a conversa inteira, não uma
   cauda de tamanho fixo
2. WHEN o orçamento do primer é calculado THEN ele SHALL derivar da janela de contexto do
   modelo destino, reservando espaço para o trabalho do turno
3. WHEN a conversa inteira não cabe no orçamento THEN o sistema SHALL resumir o trecho **antigo**
   numa execução destacada e enviar `resumo + cauda crua`, nunca cortar cego
4. WHEN o resumo não pode ser produzido (runtime indisponível, execução falha) THEN o sistema
   SHALL degradar para truncamento da cauda com marca visível, e a troca SHALL prosseguir
5. WHEN o primer é montado THEN seu enquadramento SHALL apresentar o histórico como **esta**
   conversa continuando, não como "uma conversa anterior em outra sessão"
6. WHEN o resumo roda THEN ele SHALL acontecer antes do primeiro turno do usuário, sem
   interromper nem duplicar esse turno

**Independent Test**: Sessão longa (acima do orçamento) trocada de provider; conferir que o
primer tem resumo + cauda e que o modelo destino responde sobre um detalhe do começo da conversa.

---

### P2: Confirmação honesta na troca cross-provider

**User Story**: Como usuário, quero um passo de confirmação antes de cruzar provider, para não
disparar por engano uma troca que trunca contexto e mata o cache.

**Why P2**: Decisão do usuário (manter confirmação), mas o texto atual mente — promete sessão
nova, que deixa de existir. Corrigir o texto é obrigatório; a P1 não pode shippar com ele.

**Acceptance Criteria**:

1. WHEN o usuário escolhe um perfil de outro provider THEN o sistema SHALL pedir confirmação
   antes de aplicar
2. WHEN a confirmação é exibida THEN ela SHALL declarar que a sessão continua a mesma, que a
   conversa inteira atravessa (resumida só se não couber na janela do destino) e que o cache do
   provider anterior se perde
3. WHEN o usuário escolhe um perfil do mesmo provider THEN o sistema SHALL aplicar sem confirmação
4. WHEN o perfil destino não está autenticado THEN a opção SHALL aparecer desabilitada com o motivo

**Independent Test**: Abrir o menu, escolher perfil de outro provider, ler o texto do modal e
confirmar que nenhuma frase promete sessão nova.

---

### P2: Migração dos pares já forkados

**User Story**: Como usuário, quero que as conversas que a versão anterior partiu em duas
apareçam unificadas, para a sidebar refletir a realidade.

**Why P2**: Só limpeza de dados — nenhum fluxo novo depende disso.

**Acceptance Criteria**:

1. WHEN a migração roda THEN ela SHALL identificar pares origem→destino pelas sessões semeadas
   e uni-los como pernas de uma sessão só, preservando a `session_id` da **origem**
2. WHEN um par é ambíguo ou não pode ser reconstruído com confiança THEN a migração SHALL
   deixá-lo intacto e registrar o motivo, nunca adivinhar
3. WHEN a migração conclui THEN nenhuma mensagem SHALL ter sido apagada ou reescrita — só
   metadado de sessão muda
4. WHEN a migração roda de novo THEN ela SHALL ser idempotente

**Independent Test**: Rodar a migração num banco com par forkado conhecido e conferir sidebar,
histórico unificado e reexecução sem efeito.

---

## Edge Cases

- WHEN a troca é pedida com um turno rodando THEN o sistema SHALL enfileirar e aplicar ao fim
  do turno (fila existente), sem matar o turno
- WHEN duas trocas são pedidas em sequência rápida THEN só a última SHALL valer
- WHEN o usuário troca para o perfil que já está ativo THEN o sistema SHALL recusar como no-op
- WHEN uma sessão com pernas é arquivada ou apagada THEN todas as pernas SHALL acompanhar
- WHEN o histórico da perna de origem é vazio ou ilegível THEN a troca SHALL prosseguir sem
  primer e sinalizar que a sessão começa limpa (`primed: false`)
- WHEN uma perna aponta para um perfil que foi removido THEN o histórico SHALL renderizar com o
  nome de conta registrado na perna, sem quebrar
- WHEN uma perna nunca produziu turno (troca seguida de outra troca) THEN ela SHALL sumir do
  histórico e não gerar separador órfão

---

## Requirement Traceability

| ID | Story | Fase | Status |
| --- | --- | --- | --- |
| USP-01 | P1: Sessão não forka | Design | Pending |
| USP-02 | P1: Sessão não forka (herança de projeto/worktree) | Design | Pending |
| USP-03 | P1: Sessão não forka (atomicidade da troca) | Design | Pending |
| USP-04 | P1: Histórico contínuo (merge por timestamp) | Design | Pending |
| USP-05 | P1: Histórico contínuo (marcador de fronteira) | Design | Pending |
| USP-06 | P1: Histórico contínuo (paginação unificada) | Design | Pending |
| USP-07 | P1: Histórico contínuo (perna ausente degrada) | Design | Pending |
| USP-08 | P1: Retomar perna (reativar + resume nativo) | Design | Pending |
| USP-09 | P1: Retomar perna (primer incremental) | Design | Pending |
| USP-10 | P1: Retomar perna (degradação p/ perna nova) | Design | Pending |
| USP-11 | P2: Confirmação honesta | Design | Pending |
| USP-12 | P2: Migração de pares forkados | Design | Pending |
| USP-13 | Edge: fila de turno / última troca vence | Design | Pending |
| USP-14 | Edge: ciclo de vida (archive/delete) das pernas | Design | Pending |
| USP-15 | P1: Contexto inteiro (orçamento pela janela do destino) | Design | Pending |
| USP-16 | P1: Contexto inteiro (resumo do trecho antigo no estouro) | Design | Pending |
| USP-17 | P1: Contexto inteiro (enquadramento de continuidade) | Design | Pending |

**Coverage:** 17 total, 0 mapeados para tasks, 17 pendentes

---

## Success Criteria

- [ ] claude→codex→claude produz **uma** entrada na sidebar e um histórico em ordem correta
- [ ] A terceira troca reusa o `provider_session_id` da primeira perna (resume nativo)
- [ ] `session.handoff` deixa de exigir navegação do cliente para outro id
- [ ] Nenhum texto de UI afirma que a troca cria sessão nova
- [ ] Depois de trocar, o modelo destino responde corretamente sobre um detalhe do **começo**
      da conversa — o teste real de "como se eu não tivesse trocado"
- [ ] Suíte verde no gate do projeto (testes + typecheck + eslint + build)
