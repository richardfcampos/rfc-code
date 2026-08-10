# Feature: multi-account-collab — dois perfis conversando até um veredito

Feature 2 do AD-011. Base pronta: isolamento por perfil (`profile-env.ts`) e dispatch de provider chamável sem websocket (`queryClaudeSDK(prompt, options, writer)`, precedentes em `server/routes/git.js:1129` e `server/routes/agent.js:959`).

## Problem

Hoje um perfil só substitui outro (handoff sequencial, `handoff.service.ts:191`). Não existe forma de duas contas discutirem um problema e convergirem. O usuário quer consenso entre perfis.

## Modes (AD-011)

| Modo | Fluxo | Uso |
| --- | --- | --- |
| `debate` | A e B alternam vendo o transcript inteiro; convergem ou esgotam rodadas | decisão de arquitetura |
| `review` | autor produz, revisor critica, autor revisa | revisão cruzada de código |
| `vote` | todos respondem a mesma pergunta **sem ver os outros**; árbitro compara | tirar viés de rodada única |

Um motor só: os modos diferem em (a) quem vê o quê, (b) ordem dos turnos, (c) critério de parada.

## Requirements

| ID | Requirement |
| --- | --- |
| R1 | `POST /api/collaborations` cria e dispara uma colaboração `{topic, projectPath, mode, participants[], maxRounds}`; responde imediatamente com a entidade em `running` |
| R2 | Motor executa rodadas chamando o runtime do provider com o `profileId` de cada participante (isolamento de conta preservado) |
| R3 | Cada turno é persistido assim que termina — `GET /api/collaborations/:id` mostra progresso parcial durante a execução |
| R4 | Convergência: turno que declara `CONSENSUS: YES` conforme o critério do modo encerra em `converged`; estourar `maxRounds` encerra em `exhausted` |
| R5 | Turno final de síntese (árbitro = primeiro participante) grava o `verdict` em ambos os desfechos |
| R6 | `POST /api/collaborations/:id/stop` interrompe entre turnos → `stopped` |
| R7 | **Read-only por provider**: claude via plan mode + deny list; codex via `sandboxMode: 'read-only'` (sandbox de SO). Nenhum participante escreve no repo |
| R8 | Falha de um turno (provider fora, perfil sem auth) → colaboração em `failed` com mensagem, turnos já feitos preservados |
| R9 | UI: criar colaboração (tópico, modo, 2+ perfis, rodadas), acompanhar turnos ao vivo por polling, ler o veredito |
| R10 | Custo visível: a UI avisa que cada rodada consome limite de **todas** as contas participantes, com link pro medidor de uso |
| R11 | Cada participante escolhe modelo + reasoning effort (não só perfil), reusando o catálogo por provider já usado no composer normal. Omitido → default do CLI (comportamento atual) |
| R12 | Botão no veredito abre um chat novo com tópico+veredito **pré-preenchidos no composer** (perfil/modelo/effort já selecionados) — usuário revisa e manda, nada é auto-enviado |
| R13 | Tópico da colaboração aceita invocar skill (`/nome` claude); allowlist do adapter claude libera a tool `Skill` (carregar instrução não é escrita — continua coberto pelo deny-list). Codex é best-effort (sintaxe `$nome`, carregamento fora do modo interativo não verificado) |

## Constraints

- Aceita perfis **claude** e **codex** — os dois com read-only de fato: claude por plan mode + deny list, codex por sandbox de SO (`sandboxMode: 'read-only'`). `cursor` e `opencode` seguem recusados (`PARTICIPANT_PROVIDER_UNSUPPORTED`): sem mecanismo verificado, participante escreveria no repo que está discutindo.
- Providers podem se misturar na mesma colaboração: o `provider` viaja com o participante e decide o adapter de cada turno.
- Participantes: 2 a 4.
- `maxRounds`: 1 a 5 (default 3).
- Sem retomada após restart do servidor: colaboração `running` órfã é marcada `failed` no boot.

## Success criteria

- Duas contas claude distintas discutem um tópico real no repo e produzem veredito.
- `npm test` verde com cobertura do motor (convergência, esgotamento, parada, falha) usando runtime fake.
- typecheck/lint/build limpos.

## Out of scope

- Streaming token a token na UI (polling entrega turno completo).
- Participantes escreverem código (read-only por decisão de segurança, R7).
- Perfis cursor/opencode como participante (sem mecanismo read-only verificado).
