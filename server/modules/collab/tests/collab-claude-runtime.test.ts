/**
 * The Claude adapter, exercised with a fake SDK entry point. It is the piece
 * that decides what a "turn" even is — which frames count as the answer, which
 * failures the SDK reports through the writer instead of by throwing, and what
 * a turn is allowed to do to the repository it is reasoning about.
 *
 * No test here touches the real SDK, the real session index or a real model:
 * every dependency the adapter has is injected, which is the whole point of the
 * seam it is built on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collabClaudeRuntime,
  configureCollabClaudeRuntime,
} from '@/modules/collab/collab-claude-runtime.service.js';
import type { RuntimeAnswer } from '@/modules/collab/collab-runtime.js';
import type { CollabTurnUsage } from '@/modules/collab/collab.types.js';

type WriterLike = { send: (data: unknown) => void; setSessionId: (id: string) => void };

const TURN_INPUT = {
  prompt: 'Argue your case.',
  profileId: 'profile-a',
  provider: 'claude' as const,
  cwd: '/workspace/demo',
};

/**
 * The runtime seam still allows a bare string — every fake in the engine suite
 * answers that way — but this adapter always reports the pair, so the tests
 * narrow it once here instead of at every assertion.
 */
function readAnswer(answer: RuntimeAnswer): { content: string; usage: CollabTurnUsage | null } {
  if (typeof answer === 'string') return { content: answer, usage: null };
  return { content: answer.content, usage: answer.usage ?? null };
}

async function runTurn(
  query: (prompt: string, options: Record<string, unknown>, writer: WriterLike) => Promise<void>,
  input: typeof TURN_INPUT & { model?: string; effort?: string } = TURN_INPUT,
): Promise<{ content: string; usage: CollabTurnUsage | null }> {
  configureCollabClaudeRuntime({
    query: (prompt, options, writer) => query(prompt, options, writer as WriterLike),
    resolveToolApproval: () => {},
    // Stubbed everywhere: the real one indexes the provider's session files,
    // which is the machine's actual chat history and not this suite's business.
    archiveSession: () => {},
  });
  return readAnswer(await collabClaudeRuntime(input));
}

test('the Claude adapter keeps assistant text, drops tool noise and runs read-only', async () => {
  let seenOptions: Record<string, unknown> = {};

  const answer = await runTurn(async (prompt, options, writer) => {
    seenOptions = options;
    assert.equal(prompt, 'Argue your case.');
    writer.setSessionId('claude-session-1');
    writer.send({ kind: 'tool_use', toolName: 'Read', toolInput: { file: 'a.ts' } });
    writer.send({ kind: 'text', role: 'assistant', content: 'The cache is the constraint.' });
    writer.send({ kind: 'text', role: 'user', content: 'echo of the prompt' });
    writer.send({ kind: 'status', text: 'token_budget' });
    writer.send({ kind: 'text', role: 'assistant', content: 'CONSENSUS: YES' });
    writer.send({ kind: 'complete' });
  });

  assert.equal(answer.content, 'The cache is the constraint.\n\nCONSENSUS: YES');
  // A status frame with no accounting attached reports nothing, which is not
  // the same as a turn that cost zero.
  assert.equal(answer.usage, null);
  assert.equal(seenOptions.permissionMode, 'plan');
  assert.equal(seenOptions.profileId, 'profile-a');
  assert.equal(seenOptions.cwd, '/workspace/demo');
  assert.equal(seenOptions.sessionId, null);

  // Plan mode is not read-only on its own: it clears web access and subagents,
  // and the target repository's settings can allow anything else. The deny list
  // is what actually holds, so every tool that could change the working tree,
  // run a command, reach the network or fan out into subagents belongs in it.
  const tools = seenOptions.toolsSettings as { allowedTools: string[]; disallowedTools: string[] };
  assert.deepEqual(tools.disallowedTools, [
    'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
    'Bash', 'BashOutput', 'KillShell',
    'WebFetch', 'WebSearch', 'Task',
  ]);
  assert.deepEqual(tools.allowedTools, ['Grep', 'Glob', 'NotebookRead', 'Skill']);
  for (const tool of tools.allowedTools) {
    assert.ok(!tools.disallowedTools.includes(tool), `${tool} is allowed and denied at once`);
  }

  // A topic may invoke a skill, and an unlisted tool call becomes a permission
  // prompt this runtime always denies — so without Skill on the list the skill
  // would never load. It grants no write capability: loading is not acting, and
  // whatever the loaded instructions ask for still hits the deny list.
  assert.ok(tools.allowedTools.includes('Skill'));
  assert.ok(!tools.disallowedTools.includes('Skill'));
});

test('the Claude adapter runs the turn on the seat own model and effort', async () => {
  let seenOptions: Record<string, unknown> = {};
  const capture = async (
    _prompt: string,
    options: Record<string, unknown>,
    writer: WriterLike,
  ): Promise<void> => {
    seenOptions = options;
    writer.send({ kind: 'text', role: 'assistant', content: 'Done arguing.' });
  };

  await runTurn(capture, { ...TURN_INPUT, model: 'opus', effort: 'max' });
  assert.equal(seenOptions.model, 'opus');
  assert.equal(seenOptions.effort, 'max');

  // A seat that picked nothing must reach the SDK exactly as it did before
  // seats could pick, so the entry point keeps applying its own defaults.
  await runTurn(capture);
  assert.equal(seenOptions.model, undefined);
  assert.equal(seenOptions.effort, undefined);
});

test('the Claude adapter reports the last token accounting the SDK announced', async () => {
  const answer = await runTurn(async (_prompt, _options, writer) => {
    writer.send({
      kind: 'status',
      text: 'token_budget',
      tokenBudget: { inputTokens: 1_200, outputTokens: 300 },
    });
    writer.send({ kind: 'text', role: 'assistant', content: 'Done arguing.' });
    // The frames carry running totals, so the last one is the turn's cost.
    writer.send({
      kind: 'status',
      text: 'token_budget',
      tokenBudget: { inputTokens: 1_800, outputTokens: 900 },
    });
  });

  assert.deepEqual(answer.usage, { inputTokens: 1_800, outputTokens: 900 });
});

test('the Claude adapter turns a writer error frame into a rejection', async () => {
  await assert.rejects(
    runTurn(async (_prompt, _options, writer) => {
      writer.send({ kind: 'error', content: 'Claude Code is not installed.' });
      writer.send({ kind: 'complete' });
    }),
    /Claude Code is not installed/,
  );
});

test('the Claude adapter rejects a turn that produced no answer', async () => {
  await assert.rejects(
    runTurn(async (_prompt, _options, writer) => {
      writer.send({ kind: 'tool_use', toolName: 'Read' });
    }),
    /no answer/,
  );
});

test('the Claude adapter denies a prompt whose resolver is registered after the frame goes out', async () => {
  const denied: { requestId: string; allow: boolean }[] = [];
  const resolvers = new Map<string, (decision: { allow: boolean; message?: string }) => void>();

  configureCollabClaudeRuntime({
    // Reproduces the runtime's own sequence: the frame is announced first and
    // the resolver only exists once `send` has returned. An answer produced
    // inside `send` finds nothing to resolve and is discarded, which used to
    // leave the turn waiting on a prompt no one was ever going to answer.
    query: async (_prompt, _options, writer) => {
      const target = writer as WriterLike;
      const decision = await Promise.race([
        new Promise<{ allow: boolean; message?: string }>((resolve) => {
          target.send({ kind: 'permission_request', requestId: 'req-1', toolName: 'Bash' });
          resolvers.set('req-1', resolve);
        }),
        // Stands in for the approval timeout, short enough that a dropped
        // answer fails this test in milliseconds instead of hanging it.
        new Promise<{ allow: boolean; message?: string }>((resolve) => {
          setTimeout(() => resolve({ allow: true, message: 'nobody answered' }), 50);
        }),
      ]);
      target.send({ kind: 'text', role: 'assistant', content: `Tool refused: ${decision.message}` });
    },
    resolveToolApproval: (requestId, decision) => {
      denied.push({ requestId, allow: decision.allow });
      // Unknown request ids are ignored, exactly as the runtime ignores them.
      resolvers.get(requestId)?.(decision);
    },
    archiveSession: () => {},
  });

  const answer = readAnswer(await collabClaudeRuntime(TURN_INPUT));

  assert.match(answer.content, /Tool refused: This collaboration is read-only/);
  assert.deepEqual(denied, [{ requestId: 'req-1', allow: false }]);
});

test('the Claude adapter archives the session a finished turn leaves behind', async () => {
  const archived: string[] = [];

  configureCollabClaudeRuntime({
    query: (_prompt, _options, writer) => {
      const target = writer as WriterLike;
      target.setSessionId('claude-session-7');
      target.send({ kind: 'text', role: 'assistant', content: 'Done arguing.' });
      return Promise.resolve();
    },
    archiveSession: (providerSessionId) => {
      archived.push(providerSessionId);
    },
  });

  assert.equal(readAnswer(await collabClaudeRuntime(TURN_INPUT)).content, 'Done arguing.');
  assert.deepEqual(archived, ['claude-session-7']);
});

test('a turn survives an archive that fails and skips it when no session was announced', async () => {
  let attempts = 0;

  configureCollabClaudeRuntime({
    query: (_prompt, _options, writer) => {
      (writer as WriterLike).send({ kind: 'text', role: 'assistant', content: 'Done arguing.' });
      return Promise.resolve();
    },
    archiveSession: () => {
      attempts += 1;
      return Promise.reject(new Error('the session index is unavailable'));
    },
  });

  // No setSessionId call: there is nothing to archive and nothing to log about.
  assert.equal(readAnswer(await collabClaudeRuntime(TURN_INPUT)).content, 'Done arguing.');
  assert.equal(attempts, 0);

  configureCollabClaudeRuntime({
    query: (_prompt, _options, writer) => {
      const target = writer as WriterLike;
      target.setSessionId('claude-session-8');
      target.send({ kind: 'text', role: 'assistant', content: 'Done arguing.' });
      return Promise.resolve();
    },
    archiveSession: () => {
      attempts += 1;
      return Promise.reject(new Error('the session index is unavailable'));
    },
  });

  // The answer is already paid for; sidebar housekeeping cannot take it down.
  assert.equal(readAnswer(await collabClaudeRuntime(TURN_INPUT)).content, 'Done arguing.');
  assert.equal(attempts, 1);
});
