# Research: continuidade de sessão ao trocar perfil/conta/provider

Data: 2026-08-14 · Escopo: rfc-code · Sucessor de `cross-provider-session-switch` (AD-020)

## Sumário executivo

O problema que o usuário relata não é o contexto — é a **identidade da sessão**. Trocar
claude→codex hoje cria uma `session_id` nova e o usuário perde o fio na sidebar. Trocar de
conta dentro do mesmo provider já preserva a sessão (transplant), então o caso "acabou o
crédito, quero outra conta" **já funciona**; o que quebra é só o cruzamento de provider.

A correção mais barata e mais duradoura não é traduzir formato de transcript entre CLIs
(frágil, indocumentado, quebra a cada bump de versão do CLI): é **desacoplar a sessão do app
da sessão do provider**, que o schema já quase faz. `sessions.session_id` é descrito no
próprio schema como "the stable app-facing id that the frontend uses for the whole session
lifetime" (`schema.ts:125-130`) e `provider_session_id` como o id do CLI. O seed
cross-provider viola essa separação ao criar um `session_id` novo quando só o
`provider_session_id` mudou.

Recomendação: **sessão com pernas (legs)**. Uma sessão do app = N pernas, cada perna presa a
um (provider, profile, provider_session_id). Trocar de provider fecha uma perna e abre outra,
mantendo `session_id`. Histórico = concatenação normalizada das pernas. O primer de 24k
continua existindo — ele resolve o contexto *do modelo*, não a identidade da sessão.

## Metodologia

- Fontes: 4 buscas/fetches web + leitura direta do código e de artefatos reais em disco
- Verificação empírica: rollout real do codex em `~/.rfc-code/data/profiles/codex/codex-pessoal/sessions/2026/08/10/`
- Período: material de 2025–2026

## Achados

### 1. Estado atual (verificado no código)

| Caso | Mecânica | Sessão | Fonte |
| --- | --- | --- | --- |
| Mesmo provider, outra conta | transplant: copia o `.jsonl` nativo pro config dir do perfil destino, mantém path relativo sob o segmento de store, repointa `profile_id` | **mesma** | `handoff-transplant.ts:43-80` |
| Provider diferente | seed: cria sessão nova + primer markdown prefixado no 1º turno | **nova** | `handoff-seed.ts`, `handoff-primer.ts` |

Segmentos de store portáveis já mapeados: `claude → projects`, `codex → sessions`
(`handoff-transplant.ts:32-35`). Resume nativo: claude via `sdkOptions.resume = sessionId`
(`claude-sdk.js:271`); codex via `codex.resumeThread(sessionId, ...)` (`openai-codex.js:274`).

Limitações do primer, hoje: só papel + texto (tool calls, resultados de ferramenta e thinking
não atravessam), orçamento 24k chars mantendo a cauda, e `primed:false` quando o histórico é
vazio/ilegível.

### 2. Formato do rollout do codex (verificado em arquivo real)

Linhas JSONL com `{timestamp, type, payload}`. Tipos observados numa sessão real:
`session_meta` (session_id, cwd, cli_version, originator, base_instructions inteiro),
`turn_context`, `world_state`, `response_item` (message/reasoning), `event_msg`
(task_started, user_message, agent_message, token_count, task_complete).

O `response_item` de `reasoning` carrega `encrypted_content` — conteúdo cifrado do lado do
servidor, atrelado à conta/org. **Isso não atravessa provider nem conta**, o que sozinho já
mata a fantasia de fidelidade total numa tradução de formato.

### 3. Traduzir formato entre CLIs: possível, mas ruim

Existe precedente oficial: o Codex Desktop importa transcripts de agentes externos gravando
`.jsonl` sob `~/.codex/sessions/` e reindexando ([issue #21376](https://github.com/openai/codex/issues/21376)),
e o rollout é replay de `SessionMeta`/`TurnContext`/`ResponseItem`
([DeepWiki](https://deepwiki.com/openai/codex/3.5.2-rollout-persistence-and-replay)).

Mas: nenhuma das duas fontes documenta schema mínimo, validação de ingestão, ou garantia de
que um arquivo escrito à mão resume. O formato é interno, versionado por `cli_version`, e já
teve bug de perda de dados com rollout ausente ([issue #21196](https://github.com/openai/codex/issues/21196)).
Custo de manutenção alto, benefício marginal sobre o primer — **rejeitado**.

### 4. Como o resto do mercado faz

- **Pi (badlogic)** — store canônico próprio, mensagens transformadas na saída: user/tool
  result passam intactos, assistant de outro provider tem thinking convertido pra texto
  `<thinking>`, tool calls preservados ([guia](https://badlogic-pi-mono.mintlify.app/guides/cross-provider-handoffs)).
- **AgentsRoom** — handoff summary (arquivos modificados + atividade + última resposta) em vez
  de transcript literal ([multi-provider](https://agentsroom.dev/features/multi-provider)).
- **Junie CLI (JetBrains)** — histórico acumulado na sessão, repassado ao novo backend; a
  crítica documentada é que o modelo herda a thread mas não o estado aprendido
  ([MemU](https://memu.pro/blog/junie-cli-model-agnostic-coding-memory)).

Consenso: **ninguém traduz formato nativo**. Todo mundo mantém store próprio ou resume em
texto. O que nós temos (primer da cauda normalizada) já é a abordagem mediana do mercado.

Caveat unânime e inevitável: o **prompt cache morre na troca** — é por provider/modelo. O
primeiro turno depois da troca é caro. Vale avisar na UI, não vale tentar contornar.

## Análise comparativa

| Opção | Sessão única na UI | Fidelidade de contexto | Fragilidade | Esforço |
| --- | --- | --- | --- | --- |
| A. Status quo (seed + primer) | ❌ fork visível | Média (texto, 24k, cauda) | Baixa | 0 |
| B. Forjar transcript nativo do destino | ✅ | Alta no papel, quebra em reasoning cifrado | **Alta** — formato interno, versionado | Alto |
| C. Store canônico no banco, replay a cada turno | ✅ | Alta | Média | Muito alto — abandona resume nativo dos 4 CLIs |
| **D. Sessão com pernas (recomendada)** | ✅ | Igual à A (primer) | Baixa | Médio |

B e C brigam com a arquitetura: o projeto delega persistência de transcript ao CLI de
propósito (é o que dá resume nativo, cache e paridade de feature). D aceita essa delegação e
conserta só a camada que é nossa: a identidade.

## Recomendação: sessão com pernas

```
sessions (session_id estável, provider/profile/provider_session_id = perna ATIVA)
   └── session_legs
         leg_id, session_id, seq, provider, profile_id,
         provider_session_id, jsonl_path, project_path, started_at, ended_at
```

Troca cross-provider passa a ser:

1. fecha perna ativa (`ended_at`)
2. cria perna nova no provider/perfil destino (sessão nativa nova, como hoje)
3. grava o primer e prende à perna nova
4. repointa `sessions.provider / provider_session_id / profile_id` — **`session_id` não muda**

`fetchHistory` deixa de resolver um adapter só e passa a concatenar as pernas em ordem de
`seq`, marcando a fronteira com um separador de sistema ("continuou em codex · conta X").
Same-provider continua transplant e nem cria perna nova (só troca `profile_id`).

Ganhos diretos: sidebar mostra uma conversa só; `session.handoff` deixa de precisar navegar o
cliente pra outro id; o caso "crédito acabou" vira dois cliques sem perder o lugar.

Custos honestos:
- paginação de histórico atravessando pernas é a parte chata (offset/limit hoje é por adapter)
- migração das sessões já semeadas (pares órfãos criados pela feature anterior)
- retomar uma perna antiga (voltar pro claude depois de ir pro codex) precisa decidir: perna
  nova sempre, ou reusar a perna anterior daquele provider com resume nativo. Reusar é melhor
  UX e mais barato em cache — mas exige injetar no prompt o que aconteceu na perna do meio.

## Armadilhas conhecidas

- Cache de prompt morre na troca — inevitável, comunicar em vez de esconder
- `encrypted_content` do reasoning do codex nunca atravessa conta/provider
- Tool calls fora do primer: o modelo destino vê a conversa, não o que foi executado. Se isso
  incomodar no uso real, o passo seguinte é resumir tool traffic em texto, não copiá-lo
- Perfil não autenticado deve aparecer desabilitado (já resolvido em `isProfileAuthenticated`)

## Próximos passos

1. Especificar `unified-session-across-providers` pelo tlc-spec-driven (spec → design → tasks)
2. Decidir com o usuário: retomar perna antiga vs sempre criar perna nova
3. Decidir com o usuário: troca cross-provider ainda pede confirmação, ou vira silenciosa

## Questões em aberto

- Ao voltar pro provider de origem, resume da perna antiga ou perna nova? (afeta schema e UX)
- O separador de fronteira entre pernas deve ser visível no chat ou só metadado?
- Vale expor "trocar conta quando estourar limite" automático, lendo `profile-usage`, ou fica manual?

## Fontes

- [Codex Desktop external-agent import (issue #21376)](https://github.com/openai/codex/issues/21376)
- [Rollout Persistence and Replay — DeepWiki](https://deepwiki.com/openai/codex/3.5.2-rollout-persistence-and-replay)
- [Data loss: resumed-thread errors due missing rollout JSONL (issue #21196)](https://github.com/openai/codex/issues/21196)
- [Cross-Provider Model Handoffs — Pi](https://badlogic-pi-mono.mintlify.app/guides/cross-provider-handoffs)
- [Multi-Provider — AgentsRoom](https://agentsroom.dev/features/multi-provider)
- [Junie CLI model switch erases learned context — MemU](https://memu.pro/blog/junie-cli-model-agnostic-coding-memory)
- [Never Switch Models Mid-Conversation — MindStudio](https://www.mindstudio.ai/blog/never-switch-models-mid-conversation-ai-agents)
