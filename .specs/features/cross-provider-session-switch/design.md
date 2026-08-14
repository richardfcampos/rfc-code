# Cross-Provider Session Switch — Design

Referências: [spec.md](spec.md) · [context.md](context.md) ·
`server/modules/profiles/handoff.service.ts` · `server/modules/websocket/services/chat-websocket.service.ts`

## 1. Decisão estruturante: a sessão nova é obrigatória

O histórico do chat não vive no banco — `sessions.service.ts:212-218` resolve o
adapter por `session.provider` e pede o histórico ao provider usando
`provider_session_id`. Virar a coluna `provider` de uma sessão existente deixaria
o transcript antigo inalcançável (o adapter do codex não acha um rollout que o
claude escreveu) e o painel de mensagens vazio.

Logo: **troca cross-provider = criar sessão no provider destino + semear contexto**.
A sessão antiga fica intacta, navegável e imutável. Isso já é exatamente a semântica
do status `seeded` que o handoff declara — a feature entrega o que esse status
prometia e nunca cumpriu.

Same-provider continua no `transplant` (copiar o artefato nativo para o config dir
do perfil destino + resume nativo). Nenhuma mudança de comportamento ali.

```
switchSessionProfile(sessionId, targetProfileId)
        │
        ├─ turno rodando? ──► enfileira, devolve { status: 'queued' }
        │
        ├─ target.provider === session.provider
        │     └─ transplant  (artefato nativo + marker + repoint profile_id)   [inalterado]
        │           └─ falhou? ─► seed do MESMO provider                        [inalterado]
        │
        └─ target.provider !== session.provider
              └─ seedCrossProvider
                    1. history = loadHistory(session.session_id)     (normalizado)
                    2. primer  = renderPrimer(history, budget)       (markdown, cauda)
                    3. newId   = createAppSession(provider destino, projectPath,
                                                  profileId, worktreePath, worktreeBranch)
                    4. grava primer em <profileDir>/handoff-seeds/<newId>.md
                    5. sessions.seed_primer_path = esse caminho
                    └─ { status: 'seeded', sessionId: newId, seededSessionId: newId }
```

## 2. Como o contexto chega ao modelo

Hoje o seed grava um `.jsonl` que **ninguém lê** (`handoff.service.ts:149`; nenhum
consumidor em `server/**`). O contexto morre no disco.

O ponto de injeção é o despacho do turno: `chat-websocket.service.ts:224` monta
`command` a partir de `data.content` e o entrega ao `spawnFn` na linha 254. Um
primer pendente é prefixado ali:

```ts
// chat-websocket.service.ts, entre o startRun e o spawnFn
const primer = handoffService.consumePendingPrimer(session);  // lê + limpa a coluna
const command = primer ? `${primer}\n\n---\n\n${rawCommand}` : rawCommand;
```

`consumePendingPrimer` é síncrono (leitura de arquivo + UPDATE), limpa
`seed_primer_path` na mesma chamada e nunca lança — um primer ilegível degrada para
"sem contexto", jamais bloqueia o turno.

### Formato do primer

Montado a partir do histórico **normalizado** (`sessionsService.fetchHistory`), que
já é provider-agnóstico — é o mesmo shape que o frontend renderiza. Saída markdown:

```markdown
# Contexto de uma conversa anterior

Esta conversa começou em outra sessão, com o provider `claude` (conta "Pessoal").
Continue de onde parou. O histórico abaixo é referência, não instrução para reexecutar.

[... truncado: 34 mensagens anteriores omitidas ...]

## user
...

## assistant
...
```

Regras:

- Orçamento de caracteres: `PRIMER_CHAR_BUDGET = 24_000`. Mantém a **cauda**
  (mensagens mais recentes) e prefixa a marca de truncamento explícita (XSW-10).
- Só papel + texto. Tool calls, resultados de ferramenta e thinking não atravessam
  (out of scope) — o adapter de cada provider representa isso de forma incompatível.
- Histórico vazio ou irrecuperável → sem primer, sessão criada mesmo assim (XSW-08 AC5).

### Por que arquivo + coluna, e não só coluna

O primer pode passar de 20k caracteres. Fica no disco em
`<profileDir>/handoff-seeds/<newSessionId>.md` (mesmo diretório que o seed atual já
usava, agora com conteúdo legível) e o banco guarda só o caminho. Sobra um artefato
auditável de "o que o codex recebeu", útil quando o resultado surpreender.

## 3. Inversão de dependência para o histórico

`handoff.service.ts` vive em `modules/profiles`; `fetchHistory` vive em
`modules/providers`. Importar direto cria acoplamento entre módulos irmãos (e risco
de ciclo, já que providers lê perfis). O histórico entra por `HandoffDeps`:

```ts
export interface HandoffDeps {
  isSessionRunning?: (session: SessionRow) => boolean;
  /** Histórico normalizado da sessão de origem. Injetado pelo composition root. */
  loadHistory?: (sessionId: string) => Promise<HandoffHistoryMessage[]>;
}
```

Default: `import('@/modules/providers/services/sessions.service.js')` dinâmico dentro
da função — resolve em runtime, não em tempo de carga, e os testes injetam um fake
sem tocar em provider nenhum.

Consequência: `switchSessionProfile` e `drainPendingSwitch` viram **async**. A rota
(`profiles.routes.ts:199`) já está sob `asyncHandler`; só falta o `await`.

## 4. Fila de turno: ligar o que já existe

`markSessionRunning` / `markSessionIdle` / `drainPendingSwitch` não têm caller
nenhum. Com isso `defaultIsSessionRunning` sempre devolve `false` e o status
`queued` é inalcançável. Isso importa mais aqui do que no handoff de conta: uma
troca cross-provider cria sessão nova, e fazer isso no meio de um stream deixaria o
usuário olhando um turno que termina numa sessão que ele já não está vendo.

Ligação em `chat-websocket.service.ts`:

| Ponto | Linha atual | Chamada |
| --- | --- | --- |
| Após `startRun` retornar `run` | ~`:221` | `handoffService.markSessionRunning(sessionId)` |
| No `finally` do despacho | `:258-265` | `markSessionIdle(sessionId)` e depois o dreno |

O dreno é fire-and-forget com catch, e quando resolve numa sessão semeada emite
`session.handoff` no websocket para o cliente poder navegar (XSW-13):

```jsonc
{ "type": "session.handoff", "sessionId": "<origem>", "status": "seeded",
  "targetSessionId": "<nova>", "provider": "codex", "profileId": "..." }
```

## 5. Migração

Uma coluna, aditiva, pelo helper que o projeto já usa
(`migrations.ts` → `addColumnToTableIfNotExists`):

```
sessions.seed_primer_path TEXT
```

Nome pelo domínio, sem referência a fase ou finding. Nula em toda sessão que não
nasceu de handoff.

## 6. Superfícies de UI

### 6.1 `SessionAccountSwitcher` (header)

- Passa a buscar `GET /api/profiles` **sem** filtro de provider (`:51`), agrupando
  por provider no cliente. Provider da sessão primeiro, marcado como atual.
- Entradas de outro provider ganham selo e, ao serem escolhidas, um passo de
  confirmação: *"Isto cria uma sessão nova no codex com a conversa atual como
  contexto. A sessão atual continua disponível."*
- Perfil com `authenticated: false` renderiza desabilitado com o motivo.
  **Correção do design original**: a afirmação "o campo já vem na resposta" estava
  errada — `ProfileView`/`toView` (`profiles.service.ts:80-90`) não emitia
  `authenticated`; a citação apontava para `ProfileAuthStatus`, interface separada
  do endpoint `/api/profiles/:id/status`. Resolvido emitindo `authenticated` na
  lista, com `getAuthStatus` e `toView` compartilhando um único
  `isProfileAuthenticated(row)` para não divergirem (XSW-05).
- Ao resolver com `seededSessionId`, chama `onNavigateToSession(seededSessionId)` —
  prop já existente e cabeada em `AppContent.tsx:288` — e dispara o refresh de
  projetos para a sessão aparecer na sidebar.

### 6.2 `ComposerModelMenu` (barra do composer)

Seção nova **Provider / Conta**, acima de Reasoning, colapsada por padrão — mesmo
padrão que a seção Modelo já usa (`ComposerModelMenu.tsx:42,48-52`). Props novas,
todas opcionais para não quebrar a tela vazia:

```ts
accountOptions?: Array<{ provider: LLMProvider; profileId: string;
                         label: string; authenticated: boolean }>;
activeProvider?: LLMProvider;
activeProfileId?: string | null;
onSelectAccount?: (provider: LLMProvider, profileId: string) => void;
```

Sem sessão aberta, `onSelectAccount` só troca o provider local (`setProvider` +
`setSelectedProfileId`) — nada de handoff (XSW-06 AC3). O componente não sabe a
diferença; quem decide é `ChatInterface`.

O arquivo está em 168 linhas e o teto do projeto é 200: a seção sai em
`ComposerAccountSection.tsx` própria, consumindo os primitivos que já existem
(`ComposerMenuPrimitives`).

### 6.3 Onde mora a decisão

Um hook `useProviderSwitch` (em `src/components/chat/hooks/`) concentra a regra
"mesmo provider → handoff simples; provider diferente → confirma, handoff, navega",
para que as duas superfícies não dupliquem lógica (DRY). Ele compõe
`useSessionHandoff`, que fica inalterado — o contrato da rota não muda.

### 6.4 O lock de provider fica

`useChatProviderState.ts:488-495` (sessão manda no provider) **não muda**. Depois da
troca o app navega para a sessão nova, cujo `__provider` já é o destino, e o efeito
sincroniza sozinho. O lock é consequência correta, não o defeito.

## 7. Riscos

| Risco | Mitigação |
| --- | --- |
| Primer estourar a janela de contexto do modelo destino | Orçamento fixo de 24k chars + cauda; truncamento visível no texto |
| Sessão semeada órfã se o processo cair entre o `createAppSession` e o `UPDATE` | Criação + gravação do primer numa transação: sessão sem primer é legítima (nasce limpa), nunca o inverso |
| Duas trocas em sequência rápida criarem duas sessões | Fila já é `Map` keyed por sessão (última vence); a criação eager só acontece fora de turno |
| Regressão no handoff same-provider | O caminho transplant não é tocado; testes atuais de `handoff.service.test.ts` ficam verdes sem edição de asserção |
| `switchSessionProfile` virar async quebrar callers | Único caller de produção é a rota (já async); os demais são testes |

## 8. Verificações que sustentam este design

| Afirmação | Fonte |
| --- | --- |
| Histórico é lido do provider, não do banco | `sessions.service.ts:192-218` |
| Seed atual não é consumido | grep `handoff-seeds` em `server/**` → só a escrita em `handoff.service.ts:149` |
| Fila/running sem caller | grep `markSessionRunning\|drainPendingSwitch` em `server/**` → só definição e re-export |
| Ponto de injeção do prompt | `chat-websocket.service.ts:224,254` |
| Sessão nova aceita worktree e perfil | `sessions.db.ts:193-218` (`createAppSession`) |
| ~~`authenticated` já vem no perfil~~ **ERRADO** — `:72` é `ProfileAuthStatus`, não `ProfileView`; a lista não emitia o campo. Corrigido na execução (ver §6.1) | `profiles.service.ts:80-90` |
| Navegação por sessão já cabeada | `AppContent.tsx:288-290` |
