/**
 * The Codex adapter, exercised with a fake SDK client.
 *
 * The assertion that matters most is the boring one: the thread options. They
 * are the entire read-only guarantee — an OS sandbox instead of the Claude
 * adapter's hand-built refusals — so a turn that quietly started asking for
 * `workspace-write`, or for approvals nobody is there to grant, would be a
 * silent regression the rest of the suite could not see.
 *
 * No test here touches the real SDK, the real session index or a real model:
 * the client is injected, which is the whole point of the seam it is built on.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { RunResult, Thread, ThreadOptions } from '@openai/codex-sdk';

import {
  buildCollabCodexClientOptions,
  collabCodexRuntime,
  configureCollabCodexRuntime,
} from '@/modules/collab/collab-codex-runtime.service.js';
import type { CollabCodexThread } from '@/modules/collab/collab-codex-runtime.service.js';

const TURN_INPUT = {
  prompt: 'Argue your case.',
  profileId: 'profile-a',
  provider: 'codex' as const,
  cwd: '/workspace/demo',
};

type ThreadRun = Thread['run'];

interface RecordedCall {
  profileId: string;
  options: ThreadOptions;
  prompt: unknown;
  signal?: AbortSignal;
}

function completedTurn(overrides: Partial<RunResult> = {}): RunResult {
  return { items: [], finalResponse: '', usage: null, ...overrides };
}

/**
 * Wires a fake client and returns both the runtime call and what the SDK saw,
 * so every test can assert on the options without repeating the plumbing.
 */
function runTurn(
  run: ThreadRun,
  input: typeof TURN_INPUT & {
    signal?: AbortSignal;
    model?: string;
    effort?: string;
  } = TURN_INPUT,
): { answer: Promise<string>; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  configureCollabCodexRuntime({
    createClient: (profileId) => ({
      startThread: (options): CollabCodexThread => ({
        id: 'codex-thread-1',
        run: (prompt, turnOptions) => {
          calls.push({ profileId, options, prompt, signal: turnOptions?.signal });
          return run(prompt, turnOptions);
        },
      }),
    }),
    // Stubbed everywhere: the real one indexes the provider's session files,
    // which is the machine's actual chat history and not this suite's business.
    archiveSession: () => {},
  });

  return { answer: collabCodexRuntime(input), calls };
}

test('the Codex adapter returns the final assistant message and runs sandboxed', async () => {
  const { answer, calls } = runTurn(() =>
    Promise.resolve(
      completedTurn({
        items: [
          { id: 'r1', type: 'reasoning', text: 'thinking out loud' },
          { id: 'm1', type: 'agent_message', text: 'The cache is the constraint.' },
        ],
        finalResponse: 'The cache is the constraint.\n\nCONSENSUS: YES\n',
      }),
    ),
  );

  assert.equal(await answer, 'The cache is the constraint.\n\nCONSENSUS: YES');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'Argue your case.');
  assert.equal(calls[0].profileId, 'profile-a');

  // The safety property, asserted field by field: the sandbox is what makes a
  // turn read-only, `never` is what keeps an unattended run from stalling on an
  // approval, and the network stays shut so a debate cannot fan out.
  assert.equal(calls[0].options.sandboxMode, 'read-only');
  assert.equal(calls[0].options.approvalPolicy, 'never');
  assert.equal(calls[0].options.networkAccessEnabled, false);
  assert.equal(calls[0].options.webSearchEnabled, false);
  assert.equal(calls[0].options.workingDirectory, '/workspace/demo');
  assert.equal(calls[0].options.skipGitRepoCheck, true);
});

test('the Codex adapter opens the thread on the seat own model and effort', async () => {
  const answered = (): Promise<RunResult> =>
    Promise.resolve(completedTurn({ finalResponse: 'Done arguing.' }));

  const chosen = runTurn(answered, { ...TURN_INPUT, model: 'gpt-5.5', effort: 'xhigh' });
  await chosen.answer;
  assert.equal(chosen.calls[0].options.model, 'gpt-5.5');
  assert.equal(chosen.calls[0].options.modelReasoningEffort, 'xhigh');
  // The sandbox is not negotiable, whatever the seat chose.
  assert.equal(chosen.calls[0].options.sandboxMode, 'read-only');

  // A seat that picked nothing leaves both keys absent rather than explicitly
  // undefined, so the CLI keeps whatever the account has configured.
  const defaulted = runTurn(answered);
  await defaulted.answer;
  assert.ok(!('model' in defaulted.calls[0].options));
  assert.ok(!('modelReasoningEffort' in defaulted.calls[0].options));
});

test('an effort outside the SDK union is dropped rather than forwarded', async () => {
  // Validation already refuses what the catalog does not offer; this is the
  // last narrowing, so a value that somehow reached the adapter cannot be
  // handed to the CLI as a reasoning level it has never heard of.
  const { answer, calls } = runTurn(
    () => Promise.resolve(completedTurn({ finalResponse: 'Done arguing.' })),
    { ...TURN_INPUT, effort: 'ludicrous' },
  );

  await answer;
  assert.ok(!('modelReasoningEffort' in calls[0].options));
});

test('the Codex adapter propagates a failed turn as a rejection', async () => {
  const { answer } = runTurn(() => Promise.reject(new Error('Codex CLI is not authenticated.')));

  await assert.rejects(answer, /not authenticated/);
});

test('the Codex adapter reports an error item when the turn produced no text', async () => {
  const { answer } = runTurn(() =>
    Promise.resolve(
      completedTurn({
        items: [{ id: 'e1', type: 'error', message: 'the model stream ended early' }],
      }),
    ),
  );

  await assert.rejects(answer, /stream ended early/);
});

test('the Codex adapter rejects a turn that produced no answer at all', async () => {
  const { answer } = runTurn(() =>
    Promise.resolve(
      completedTurn({
        items: [
          {
            id: 'c1',
            type: 'command_execution',
            command: 'ls',
            aggregated_output: '',
            status: 'completed',
          },
        ],
      }),
    ),
  );

  await assert.rejects(answer, /no answer/);
});

test('an error item is ignored when the turn still produced an answer', async () => {
  const { answer } = runTurn(() =>
    Promise.resolve(
      completedTurn({
        // A hiccup the model recovered from must not end the collaboration:
        // the engine treats a rejection here as fatal to the whole run.
        items: [{ id: 'e1', type: 'error', message: 'a retried request failed once' }],
        finalResponse: 'Still here.',
      }),
    ),
  );

  assert.equal(await answer, 'Still here.');
});

test('the engine abort signal reaches the SDK call', async () => {
  const controller = new AbortController();
  const { answer, calls } = runTurn(
    (_prompt, turnOptions) =>
      new Promise<RunResult>((_resolve, reject) => {
        turnOptions?.signal?.addEventListener('abort', () => reject(new Error('turn aborted')));
      }),
    { ...TURN_INPUT, signal: controller.signal },
  );

  assert.equal(calls[0].signal, controller.signal);
  controller.abort();
  await assert.rejects(answer, /turn aborted/);
});

test('each participant gets a client bound to its own account', async () => {
  const seen: string[] = [];

  configureCollabCodexRuntime({
    createClient: (profileId) => {
      seen.push(profileId);
      return {
        startThread: (): CollabCodexThread => ({
          id: null,
          run: () => Promise.resolve(completedTurn({ finalResponse: 'Done arguing.' })),
        }),
      };
    },
    archiveSession: () => {},
  });

  await collabCodexRuntime(TURN_INPUT);
  await collabCodexRuntime({ ...TURN_INPUT, profileId: 'profile-b' });

  assert.deepEqual(seen, ['profile-a', 'profile-b']);
});

test('client options carry the profile CODEX_HOME on top of the host environment', () => {
  const options = buildCollabCodexClientOptions('profile-a', () => ({
    CODEX_HOME: '/profiles/codex/profile-a',
  }));

  assert.equal(options?.env.CODEX_HOME, '/profiles/codex/profile-a');
  // The SDK stops inheriting `process.env` once `env` is set, so the host
  // environment has to travel with the override or the CLI loses its PATH.
  assert.equal(options?.env.PATH, process.env.PATH);

  // No profile environment means no override: the client inherits as before.
  assert.equal(buildCollabCodexClientOptions('profile-a', () => ({})), undefined);
});

test('a turn survives an archive that fails and skips it when no thread was started', async () => {
  let attempts = 0;
  const archiveSession = (): Promise<void> => {
    attempts += 1;
    return Promise.reject(new Error('the session index is unavailable'));
  };
  const thread = (id: string | null): CollabCodexThread => ({
    id,
    run: () => Promise.resolve(completedTurn({ finalResponse: 'Done arguing.' })),
  });

  configureCollabCodexRuntime({
    createClient: () => ({ startThread: () => thread(null) }),
    archiveSession,
  });
  assert.equal(await collabCodexRuntime(TURN_INPUT), 'Done arguing.');
  assert.equal(attempts, 0);

  configureCollabCodexRuntime({
    createClient: () => ({ startThread: () => thread('codex-thread-8') }),
    archiveSession,
  });
  // The answer is already paid for; sidebar housekeeping cannot take it down.
  assert.equal(await collabCodexRuntime(TURN_INPUT), 'Done arguing.');
  assert.equal(attempts, 1);
});
