# Unified Session Across Providers — Context

**Gathered:** 2026-08-14
**Spec:** [spec.md](spec.md)
**Status:** Ready for design

---

## Feature Boundary

Uma sessão do app passa a ter N pernas (uma por sessão nativa de provider). Trocar
provider/conta/modelo troca a perna ativa, nunca a `session_id`. Histórico é a timeline
unificada das pernas. Nada de tradução de formato nativo, nada de store canônico de mensagens.

---

## Implementation Decisions

### Voltar a um provider já usado

- **Retomar a perna antiga**, com resume nativo do transcript daquele provider — não criar
  perna nova a cada ida e volta.
- O primer da reativação cobre **só o intervalo desde o último turno daquela perna**, não a
  conversa inteira (o transcript nativo já tem o começo).
- Se o transcript da perna antiga sumiu, degrada para perna nova — explícito, nunca silencioso.

### Fronteira entre pernas

- **Separador visível** no histórico, estilo mensagem de sistema: provider destino, nome da
  conta, horário. Ex.: "continuou em codex · conta Pessoal · 14/08 10:32".
- Recusado: badge por mensagem (ruído no tablet, AD-004) e fronteira invisível (cega para
  depurar resposta ruim).
- A troca de conta **dentro do mesmo provider** já grava um marker `profile-switch` no próprio
  transcript (`handoff-transplant.ts:56-67`) — o separador dela sai daí, sem perna nova.

### Confirmação da troca

- **Manter o passo de confirmação** ao cruzar provider.
- O texto atual está errado e é obrigatório reescrever: não fala mais em "cria uma sessão
  nova"; fala que a sessão continua a mesma, que o contexto atravessa resumido e que o cache
  do provider anterior morre.
- Mesmo provider continua sem confirmação (é barato e reversível).

### Migração dos pares já forkados

- **Migrar em pernas**, preservando a `session_id` da **origem** (a sessão onde a conversa
  começou é a que o usuário reconhece).
- Reconstrução via `seed_primer_path` das sessões semeadas.
- Caso ambíguo não é adivinhado: fica intacto e o motivo é registrado.

### Quanto contexto atravessa

- **A conversa inteira**, não a cauda de 24k chars. O objetivo declarado pelo usuário é
  "continuar na mesma sessão como se eu não tivesse trocado" — sessão preservada com modelo
  amnésico não cumpre isso.
- Orçamento deixa de ser constante e passa a derivar da **janela do modelo destino**, com
  reserva para o trabalho do turno.
- Quando não couber: **resumir o trecho antigo** numa execução destacada e mandar
  `resumo + cauda crua`. Escolha explícita do usuário sobre truncar cego.
- Custo aceito: o resumo é um turno a mais, então a troca fica mais lenta **quando estoura**.
  Conversa que cabe no orçamento não paga nada disso.
- Se o resumo não puder rodar, degrada para truncamento com marca visível — a troca nunca
  falha por causa do resumo.
- O primer passa a se apresentar como **esta** conversa continuando, não como "uma conversa
  anterior em outra sessão" (o texto atual entrega o jogo e faz o modelo se comportar como
  recém-chegado).

### Costuras que o usuário decidiu MANTER

- Separador visível no chat: fica. "visualmente pode ter o separador, mas continuar na mesma sessão"
- Modal de confirmação ao cruzar provider: fica.

### Agent's Discretion

- Forma da persistência das pernas (tabela nova vs coluna) — decisão de design
- Estratégia de paginação sobre a timeline unificada
- Como o marcador de fronteira trafega da API até o componente de chat
- Onde exatamente o aviso de custo aparece no menu do composer

---

## Specific References

- Sessão claude→codex→claude é o cenário canônico de teste — foi o exemplo do usuário
- Gatilho real da feature: "imagine o crédito acabar em uma, quero só mudar a conta e usar na
  outra" — o caminho tem que ser curto, não uma sequência de decisões

---

## Deferred Ideas

- **Troca automática de conta ao estourar o limite**, lendo os dados de `profile-usage`. Ideia
  boa e adjacente, mas é feature própria: envolve política, detecção de limite e comportamento
  no meio de um turno.
- **Resumir tool traffic em texto** para atravessar a fronteira de provider. Só vale se o
  primer só-texto se mostrar insuficiente no uso real — medir antes de construir.
