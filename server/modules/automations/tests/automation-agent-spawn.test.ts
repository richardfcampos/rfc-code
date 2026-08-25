import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAutomationSpawnGateway,
  type AutomationPolicyGateway,
  type AutomationSpawnDeps,
} from '@/modules/automations/services/automation-agent-spawn.service.js';
import { OrgPolicyError } from '@/modules/orgs/index.js';
import type { PromptAgentInput } from '@/modules/automations/automations.types.js';

const INPUT: PromptAgentInput = {
  projectPath: '/home/dev/my-app',
  provider: 'claude',
  prompt: 'Pick up the card',
  requestedProfileId: null,
  worktreePath: null,
  worktreeBranch: null,
};

interface Harness {
  gateway: ReturnType<typeof createAutomationSpawnGateway>;
  sessions: Parameters<AutomationSpawnDeps['createSession']>[0][];
  spawns: { prompt: string; options: Record<string, unknown> }[];
  completed: number;
  started: number;
}

function build(overrides: {
  policy?: Partial<AutomationPolicyGateway>;
  spawn?: (prompt: string, options: Record<string, unknown>) => Promise<unknown>;
  startRun?: AutomationSpawnDeps['registry']['startRun'];
  spawnFns?: AutomationSpawnDeps['spawnFns'];
} = {}): Harness {
  const sessions: Parameters<AutomationSpawnDeps['createSession']>[0][] = [];
  const spawns: { prompt: string; options: Record<string, unknown> }[] = [];
  const harness = { sessions, spawns, completed: 0, started: 0 } as Harness;

  const policy: AutomationPolicyGateway = {
    assertProfileAllowed: () => {},
    resolveProfileForSpawn: async () => ({ profileId: 'profile-resolved' }),
    listAllowedProfiles: () => ({ profiles: [{ profileId: 'profile-resolved' }], policyManaged: true }),
    ...overrides.policy,
  };

  harness.gateway = createAutomationSpawnGateway({
    policy,
    registry: {
      startRun:
        overrides.startRun ??
        (() => {
          harness.started += 1;
          return { writer: 'writer' };
        }),
      completeRunIfCurrent: () => {
        harness.completed += 1;
      },
    },
    createSession: (input) => {
      sessions.push(input);
    },
    spawnFns: overrides.spawnFns ?? {
      claude: async (prompt, options) => {
        spawns.push({ prompt, options });
        return overrides.spawn ? overrides.spawn(prompt, options) : undefined;
      },
    },
  });

  return harness;
}

test('a run gets its own session, the resolved account and the project as cwd', async () => {
  const harness = build();

  const result = await harness.gateway.promptAgent(INPUT);

  assert.equal(harness.sessions.length, 1);
  assert.equal(harness.sessions[0].sessionId, result.sessionId);
  assert.equal(harness.sessions[0].provider, 'claude');
  assert.equal(harness.sessions[0].projectPath, '/home/dev/my-app');
  assert.equal(harness.sessions[0].profileId, 'profile-resolved');
  assert.equal(result.profileId, 'profile-resolved');

  assert.equal(harness.spawns[0].prompt, 'Pick up the card');
  assert.equal(harness.spawns[0].options.cwd, '/home/dev/my-app');
  assert.equal(harness.spawns[0].options.profileId, 'profile-resolved');
  assert.equal(harness.spawns[0].options.resume, false);
});

test('a worktree pins both the session and the run to that directory', async () => {
  const harness = build();

  await harness.gateway.promptAgent({
    ...INPUT,
    worktreePath: '/home/dev/my-app-wt',
    worktreeBranch: 'feat/board',
  });

  assert.equal(harness.sessions[0].worktreePath, '/home/dev/my-app-wt');
  assert.equal(harness.sessions[0].worktreeBranch, 'feat/board');
  assert.equal(harness.spawns[0].options.cwd, '/home/dev/my-app-wt');
  assert.equal(harness.spawns[0].options.projectPath, '/home/dev/my-app');
});

test('a requested profile is checked against the org allow-list, never trusted', async () => {
  const checked: string[] = [];
  const harness = build({
    policy: {
      assertProfileAllowed: (_projectPath, profileId) => {
        checked.push(profileId);
      },
    },
  });

  const result = await harness.gateway.promptAgent({ ...INPUT, requestedProfileId: 'profile-asked' });

  assert.deepEqual(checked, ['profile-asked']);
  assert.equal(result.profileId, 'profile-asked');
});

test('a profile the org denies stops the spawn before a session exists', async () => {
  const harness = build({
    policy: {
      assertProfileAllowed: () => {
        throw new OrgPolicyError('Profile "profile-asked" is not allowed for this project');
      },
    },
  });

  await assert.rejects(
    () => harness.gateway.promptAgent({ ...INPUT, requestedProfileId: 'profile-asked' }),
    OrgPolicyError,
  );
  assert.equal(harness.sessions.length, 0);
  assert.equal(harness.spawns.length, 0);
});

test('an installation with no accounts and no policies keeps the runtime default', async () => {
  const harness = build({
    policy: {
      listAllowedProfiles: () => ({ profiles: [], policyManaged: false }),
      resolveProfileForSpawn: async () => {
        throw new Error('the resolver must not be consulted here');
      },
    },
  });

  const result = await harness.gateway.promptAgent(INPUT);

  assert.equal(result.profileId, null);
  assert.equal(harness.sessions[0].profileId, null);
  assert.equal(harness.spawns[0].options.profileId, null);
});

test('an unavailable provider fails before anything is created', async () => {
  const harness = build({ spawnFns: {} });

  await assert.rejects(() => harness.gateway.promptAgent(INPUT), /is not available for automations/);
  assert.equal(harness.sessions.length, 0);
});

test('a session that already has a run in progress is refused', async () => {
  const harness = build({ startRun: () => null });

  await assert.rejects(() => harness.gateway.promptAgent(INPUT), /already has a run in progress/);
  assert.equal(harness.spawns.length, 0);
});

test('the dispatch resolves without waiting for the agent to finish', async () => {
  let releaseRun: () => void = () => {};
  const runFinished = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const harness = build({ spawn: () => runFinished });

  // Resolving at all is the assertion: awaiting the run itself would hang here
  // until the agent is released, which is exactly what must not happen.
  const result = await harness.gateway.promptAgent(INPUT);
  assert.ok(result.sessionId);
  assert.equal(harness.completed, 0);

  releaseRun();
  await runFinished;
  await new Promise((resolve) => setImmediate(resolve));
  // The run's completion still closes it out, so the session never sticks
  // in "processing" once the runtime is done.
  assert.equal(harness.completed, 1);
});

test('a run that fails after dispatch is closed out instead of leaking', async () => {
  const harness = build({ spawn: async () => Promise.reject(new Error('provider crashed')) });

  await harness.gateway.promptAgent(INPUT);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.completed, 1);
});
