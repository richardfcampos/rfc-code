# Design: multi-account-collab

## Módulo

`server/modules/collab/` (padrão do módulo `worktrees`: routes-factory + serviços + composition root).

```
collab.types.ts          contratos + união de status/modo
collab.repository.ts     SQL das 2 tabelas
collab-prompt.service.ts construção de prompt por modo/turno (puro, testável isolado)
collab-engine.service.ts loop de rodadas, convergência, síntese
collab.routes.ts         createCollabRouter(services)
collab.module.ts         composition root: liga engine ao runtime real
index.ts                 barrel (só collabRoutes + tipos)
tests/                   engine, prompt, routes
```

Fronteira do eslint (`eslint.config.js:229`): import cross-module só via `index.ts`.

## Schema

Duas tabelas em `schema.ts`, criadas em `migrations.ts` (`db.exec(SQL)` + índices, padrão de `profiles` em `migrations.ts:527`). `profile_id` é **soft reference sem FK**, igual `sessions.profile_id` (`schema.ts:134`).

```sql
CREATE TABLE IF NOT EXISTS collaborations (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  mode TEXT NOT NULL,              -- debate | review | vote
  project_path TEXT NOT NULL,
  status TEXT NOT NULL,            -- running | converged | exhausted | stopped | failed
  max_rounds INTEGER NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  participants TEXT NOT NULL,      -- JSON: [{profileId, provider, role}]
  verdict TEXT,                    -- síntese final; NULL enquanto roda
  error TEXT,                      -- mensagem quando status = failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collaboration_turns (
  id TEXT PRIMARY KEY,
  collaboration_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  turn_index INTEGER NOT NULL,     -- ordem dentro da rodada
  profile_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- participant | arbiter
  content TEXT NOT NULL,
  consensus INTEGER,               -- 1 sim, 0 não, NULL não aplicável
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collaboration_id) REFERENCES collaborations(id) ON DELETE CASCADE
);
```

Índices: `idx_collaboration_turns_collab ON collaboration_turns(collaboration_id)`, `idx_collaborations_project ON collaborations(project_path)`.

`participants` como JSON: lista curta, sempre lida inteira, nunca consultada por participante — tabela separada seria cerimônia. Parse defensivo em try/catch (padrão `notification-preferences.ts:67`).

## Runtime seam

O engine **não importa** `claude-sdk.js`. Recebe por injeção:

```ts
export type CollabRuntime = (input: {
  prompt: string;
  profileId: string;
  provider: LLMProvider;
  cwd: string;
  signal?: AbortSignal;
}) => Promise<string>;   // texto completo do assistente
```

Um adapter por provider, escolhido por turno em `collab.module.ts` (`RUNTIMES[input.provider] ?? collabClaudeRuntime`). Cada participante carrega seu `provider`, então claude e codex sentam na mesma mesa.

### claude — `collab-claude-runtime.service.ts`

Usa o writer duck-typed (mesma técnica de `server/routes/git.js:1085`):

```ts
const writer = { send: (data) => { /* acumula texto de kind 'text'/'stream_delta' */ },
                 setSessionId: () => {} };
await queryClaudeSDK(prompt, { cwd, profileId, permissionMode: 'plan', sessionId: null }, writer);
```

`permissionMode: 'plan'` é necessário mas **não suficiente** pra R7: o SDK carrega `settingSources: ['project','user','local']`, então regras `permissions.allow` e hooks do repo alvo valem numa run sem ninguém olhando, e plan mode auto-aprova `WebFetch`/`WebSearch`/`Task`. O adapter passa `disallowedTools: ['Write','Edit','MultiEdit','NotebookEdit','Bash','BashOutput','KillShell','WebFetch','WebSearch','Task']`, que remove a ferramenta do contexto do modelo e vence qualquer allow-rule. Fora da garantia: MCP server do repo que mute arquivos.

`sessionId: null` evita o insert direto, mas **não** evita registro de sessão: o CLI grava o JSONL no config dir isolado do perfil e `ClaudeSessionSynchronizer` varre exatamente esses roots. Cada turno viraria uma sessão fantasma no sidebar. O adapter captura o id via `setSessionId` e, no `finally`, sincroniza e arquiva a sessão (arquivar antes de indexar é no-op: `createSession` reseta `isArchived = 0` no upsert).

### codex — `collab-codex-runtime.service.ts`

Read-only aqui não é convenção deste processo, é sandbox do SO. `thread.run(prompt, { signal })` sobre um thread aberto com:

```ts
{ sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false,
  webSearchEnabled: false, skipGitRepoCheck: true, workingDirectory: cwd }
```

`sandboxMode: 'read-only'` faz a escrita falhar no kernel — nada a registrar, nada a negar. `approvalPolicy: 'never'` evita trava: o SDK dirige `codex exec`, cujo `ThreadEvent` não tem evento de aprovação e cujo `TurnOptions` só carrega `outputSchema` e `signal` — pedido de permissão não tem canal pra chegar. Por isso este adapter não tem contrapartida da deny-on-prompt do claude. `skipGitRepoCheck` só desarma um check pensado pra humano com trabalho não commitado, irrelevante pra quem não escreve.

Isolamento por conta igual ao chat: `CODEX_HOME` do perfil via `env` do client (`profilesService.resolveEnv`, host env mesclado — o SDK para de herdar `process.env` quando `env` é passado). `buildCodexClientOptions` de `server/codex-client-options.js` não é importado: fora de `server/modules`, barrado por `boundaries/no-unknown`. O SDK entra por `import()` dentro do factory default — import estático segura handle e travaria o test runner. Turno sem texto → throw (erro fatal pro engine); item de erro com resposta presente é ignorado, pois rejeitar derrubaria a colaboração inteira. Sessão fantasma: mesmo tratamento do claude, com o `thread.id` no `finally`.

Testes injetam um `CollabRuntime` fake no engine e um client fake no adapter codex — nenhum teste chama modelo de verdade.

## Prompt & convergência

`collab-prompt.service.ts` é puro: `buildTurnPrompt({mode, topic, transcript, self, others, round, maxRounds, isFinalRound})`.

Regra de saída exigida em todo turno de participante:

```
Termine sua resposta com uma última linha, exatamente neste formato:
CONSENSUS: YES   (se você concorda integralmente com a posição mais recente do outro)
CONSENSUS: NO — <o que impede o acordo em uma frase>
```

`parseConsensus(content)` lê a última ocorrência de `/^CONSENSUS:\s*(YES|NO)\b/im`. Ausente → `null` (tratado como "não convergiu"): o modelo não colaborou com o formato, não é motivo pra encerrar.

Critério de parada por modo:
- `debate`: todos os participantes da rodada declararam YES.
- `review`: o **revisor** declarou YES (o autor não vota no próprio trabalho).
- `vote`: nunca converge por sinal — roda exatamente 1 rodada, sem transcript compartilhado, e vai direto pra síntese.

Transcript visível: `debate`/`review` recebem todos os turnos anteriores; `vote` recebe só o tópico.

Síntese (R5): árbitro = participante índice 0, prompt separado (`buildVerdictPrompt`) pedindo pontos de acordo, divergências remanescentes e recomendação final. Gravado como turno `role: 'arbiter'` **e** em `collaborations.verdict`.

## Execução assíncrona

`POST` cria a linha em `running` e dispara `void engine.run(id)` sem await (R1). O engine persiste cada turno ao terminar (R3) e faz `updated_at`/`current_round` a cada rodada.

Parada (R6): `stop` grava `status='stopped'`; o engine checa o status no início de cada turno e aborta o loop. Não interrompe turno em voo — turno já pago é turno gravado.

Órfãs no boot: `collabRepository.failOrphanedRuns()` chamado no `initializeDatabase` path do módulo, marcando `running` → `failed` com "servidor reiniciado durante a execução".

## API (contrato fechado — backend e frontend dependem disto)

Envelope padrão `createApiSuccessResponse`. Montagem: `app.use('/api/collaborations', authenticateToken, collabRoutes)` em `server/index.js`.

| Método | Rota | Body / Query | Resposta |
| --- | --- | --- | --- |
| POST | `/api/collaborations` | `{topic, projectPath, mode, participants:[{profileId, role?}], maxRounds?}` | 201 `{collaboration}` |
| GET | `/api/collaborations` | `?projectPath=` (opcional) | `{collaborations: CollaborationSummary[]}` |
| GET | `/api/collaborations/:id` | — | `{collaboration: CollaborationDetail}` |
| POST | `/api/collaborations/:id/stop` | — | `{collaboration}` |
| DELETE | `/api/collaborations/:id` | — | `{deleted: true}` |

```ts
type CollaborationSummary = {
  id: string; topic: string; mode: CollabMode; projectPath: string;
  status: CollabStatus; maxRounds: number; currentRound: number;
  participants: { profileId: string; profileName: string; provider: LLMProvider; role: string }[];
  verdict: string | null; error: string | null;
  createdAt: string; updatedAt: string;
};
type CollaborationDetail = CollaborationSummary & { turns: CollaborationTurn[] };
type CollaborationTurn = {
  id: string; round: number; turnIndex: number; profileId: string; profileName: string;
  role: 'participant' | 'arbiter'; content: string;
  consensus: boolean | null; error: string | null; createdAt: string;
};
```

`profileName` é resolvido na camada de serviço via `profilesService.getProfile` (perfil apagado → `"(perfil removido)"`, nunca erro).

Validação no POST (`AppError`, 400): tópico não vazio; modo na união; 2–4 participantes; todos existentes, autenticados e do provider `claude` (v1); sem profileId repetido; `maxRounds` 1–5; `review` exige exatamente 2 participantes com papéis `author`/`reviewer`.

## Frontend

Nova aba em MainContent (superfície de trabalho, não Settings). Componentes em `src/components/collab/`:

- `view/CollabPanel.tsx` — lista + botão nova colaboração.
- `view/modals/CreateCollabModal.tsx` — tópico, modo, seleção de perfis, rodadas, **aviso de custo (R10)**.
- `view/CollabDetail.tsx` — turnos em ordem, badge de consenso por turno, veredito destacado, botão parar.
- `hooks/useCollaborations.ts` — CRUD + polling de 3s **apenas** enquanto `status === 'running'` (para ao terminar; sem timer eterno).
- `types.ts` — espelho dos tipos acima.

Markdown dos turnos: reusar o renderer já usado em `MessageComponent.tsx`.
i18n: novo namespace `collab` registrado em `src/i18n/config.js` (import + `resources` + array `ns:211`); só `en` obrigatório, resto cai no `defaultValue`.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Modelo ignora o formato `CONSENSUS:` | ausência = não convergiu; teto de rodadas sempre encerra |
| Custo dobrado silencioso | aviso no modal (R10) + medidor de uso por perfil já existe |
| Turno longo trava a colaboração | timeout por turno (5 min) → turno com `error`, colaboração segue |
| Concorrência: duas colaborações no mesmo perfil | permitido; o limite de plano é do usuário, não do app |
