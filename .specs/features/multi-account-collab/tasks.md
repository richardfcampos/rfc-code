# Tasks: multi-account-collab

Orquestração AD-012: orquestrador não implementa; 1 worker por fase.

| # | Task | Reqs | Arquivos (ownership exclusivo) | Depende | Status |
| --- | --- | --- | --- | --- | --- |
| C1 | Schema + migração + repositório + tipos | R3, R8 | `database/schema.ts`, `database/migrations.ts`, `collab/collab.types.ts`, `collab/collab.repository.ts` | — | done |
| C2 | Prompt builder por modo + parser de consenso | R4, R5 | `collab/collab-prompt.service.ts`, `tests/collab-prompt.test.ts` | — | done |
| C3 | Motor: loop de rodadas, convergência, síntese, parada, timeout | R2, R4–R8 | `collab/collab-engine.service.ts`, `collab-runtime.ts`, `tests/collab-engine.test.ts` | C1, C2 | done |
| C4 | Rotas + validação + composition root + mount | R1, R6 | `collab.service.ts`, `collab-input.service.ts`, `collab.routes.ts`, `collab.module.ts`, `index.ts`, `server/index.js`, `tests/collab.routes.test.ts` | C3 | done |
| C5 | Frontend: painel, modal, detalhe, hook de polling, i18n, aba | R9, R10 | `src/components/collab/**`, `src/i18n/**`, aba no MainContent | contrato do design.md | done |
| C6 | Gate: `npm test` + typecheck + lint + build | — | — | C4, C5 | done (418/418, typecheck 0, lint 0 erros, build EXIT 0) |
| C7 | Smoke real: 2 perfis claude discutindo tópico do repo | success criteria | — | C6 | **pending (usuário)** |

## Revisão + correções (pós-C6)

`code-reviewer` achou 2 defeitos bloqueantes que **nenhum teste com fake pegava**. Corrigidos:

| ID | Defeito | Correção |
| --- | --- | --- |
| RV-1 (crítico) | `claude-sdk.js:596` mandava o `permission_request` **antes** de registrar o resolver → auto-deny do collab caía no vazio. Todo turno que chamasse `ExitPlanMode` (plan mode empurra pra isso) travava 300s, era cobrado e gravado vazio | `waitForToolApproval` chamado antes do `send`; deny do módulo adiado com `queueMicrotask`; teste agora modela a ordem (registra o resolver depois do `send`) e falha se regredir |
| RV-2 (alto, reproduzido) | stop durante o turno do árbitro era sobrescrito — veredito gravado em run parada | toda transição do motor virou compare-and-set (`updateStatus(id, patch, {onlyIfStatus})`); política isolada em `collab-run-state.ts` |
| RV-3 | `permissionMode: 'plan'` sozinho não garante read-only (settings/hooks do repo alvo valem; plan auto-aprova `WebFetch`/`WebSearch`/`Task`) | `disallowedTools` explícito com 10 ferramentas; comprovado que remove a ferramenta do contexto e vence allow-rule |
| RV-4 | Cada turno virava sessão fantasma no sidebar (~7 por debate) | adapter captura o id via `setSessionId`, sincroniza e arquiva no `finally` |
| RV-5 | Run com todos os turnos falhos ainda pagava árbitro e inventava veredito | transcript vazio → `failed` com o erro do primeiro turno, sem chamada de síntese |
| RV-6 | Consenso vazio na rodada 1 (quem fala primeiro "concorda" com posição inexistente) | sinal de turno com transcript vazio não converge (valor ainda gravado pra exibição) |
| RV-7 | `review` aceitava `[reviewer, author]` via API; `maxRounds` sem type check no modo vote | ordem validada (`INVALID_REVIEW_ROLE_ORDER`); valida antes de coagir |
| RV-8 | Turnos órfãos em delete concorrente; lista e último turno pós-stop parados na UI | insert só com parent vivo; poll da lista enquanto houver run ativa + 1 fetch atrasado após stop |

Aceito sem mudança: sweep de órfãs sem escopo de instância (single-process; o CAS do RV-2 torna seguro) e ausência de teto de colaborações concorrentes (design.md § Riscos já decidiu que o limite é do plano do usuário).

**Aviso do revisor:** RV-1 era invisível pra todo fake da suíte e aparece no primeiro turno real. C7 não é formalidade.

## Extensão pós-smoke: codex participante + refinamentos de UX

Smoke test real com claude revelou 3 lacunas de UX + usuário pediu suporte a codex como participante.

| ID | O que | Arquivos | Status |
| --- | --- | --- | --- |
| E1 | Codex como participante — sandbox `read-only` de SO (`sandboxMode`), sem canal de aprovação no SDK (verificado nos `.d.ts`) | `collab-codex-runtime.service.ts`, `collab.module.ts` (dispatch por provider), `collab-input.service.ts` (allowlist) | done (revisado, 0 crítico) |
| E2 | Host bloqueava sandbox do codex (AppArmor `apparmor_restrict_unprivileged_userns`) | infra, `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (usuário, não persistente) | done |
| R11 | Modelo + reasoning effort por participante | `collab.types.ts`, `collab-input.service.ts`, ambos adapters, `CollabParticipantPicker.tsx` | done |
| R12 | Botão "nova sessão a partir do veredito" — pré-preenche composer, não envia sozinho | `CollabDetail.tsx`, `StartSessionModal.tsx`, `StartSessionPicker.tsx`, seed via `window` CustomEvent em `ChatInterface.tsx`/`AppContent.tsx` | done |
| R13 | Skill no tópico (`/nome`) — autocomplete + fix real: tool `Skill` não estava na allowlist do adapter claude (bloqueava carregamento) | `collab-claude-runtime.service.ts`, `CollabTopicField.tsx`, `use-collab-skill-autocomplete.ts` | done |

Gate pós-extensão: **437/437 testes, typecheck 0, lint 0 erros, build EXIT 0**. Achados do revisor no E1 (nenhum crítico): F1 comentário impreciso sobre network, F2 MCP fora do sandbox (mitigado: repo não injeta MCP), F3 bwrap indisponível degrada silencioso (resolvido pelo E2 + achado real no host), F6 primeiro erro reportado é o menos informativo (não corrigido — dívida aberta), F7 cursor de sync pode regredir sob concorrência (pré-existente, também no claude), F8 provider desconhecido cai no adapter claude por default (não corrigido — dívida aberta).

Dívidas abertas (não corrigidas, baixo risco): F6, F7, F8 do revisor E1; codex `$skill` sem autocomplete (best-effort, R13); modelo do participante não aparece no transcript (`CollabTurnCard.tsx`).
