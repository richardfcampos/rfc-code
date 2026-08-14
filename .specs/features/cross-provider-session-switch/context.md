# Cross-Provider Session Switch — User Decisions

Gray areas raised during Specify and answered by the user (2026-08-13).

## Q1 — O que acontece com o histórico ao trocar claude → codex no meio da sessão?

**Resposta: levar contexto (seed).**

A conversa anterior acompanha a troca. O transcript nativo não é portável entre
providers (formatos diferentes, stores diferentes), então a continuação roda numa
sessão nova do provider destino com o histórico anterior injetado como contexto.
O id de sessão muda — isso é aceito.

Rejeitado: "sessão limpa" (codex começaria sem saber nada) e "perguntar na hora"
(fricção por troca).

## Q2 — Onde fica o controle?

**Resposta: os dois lugares.**

- Menu do composer (`ComposerModelMenu`) — troca rápida, sempre visível na barra.
- Modal do header (`SessionAccountSwitcher`) — troca de conta explícita, com aviso
  de que o contexto será re-semeado numa sessão nova.

Rejeitado: só um dos dois.

## Q3 — Quais providers participam?

**Resposta: todos os 4** (claude, codex, cursor, opencode).

Sem hardcode de par claude↔codex. O custo é validar auth/modelo/permission mode
dos quatro; o benefício é não precisar mexer de novo quando um provider novo entrar.

## Premissas derivadas (não perguntadas, verificadas no código)

| # | Premissa | Verificação |
| --- | --- | --- |
| P1 | Trocar o provider da sessão *no lugar* é inviável — a sessão nova é obrigatória | `sessions.service.ts:212-218` lê histórico do adapter do `session.provider` + `provider_session_id`; virar a coluna orfanaria o transcript |
| P2 | O "seed" atual não entrega contexto nenhum ao modelo | `handoff.service.ts:149` escreve `handoff-seeds/<id>.jsonl`; nenhum leitor em `server/**` |
| P3 | O caminho `queued` está morto | `markSessionRunning`/`markSessionIdle`/`drainPendingSwitch` sem caller em `server/**` |
