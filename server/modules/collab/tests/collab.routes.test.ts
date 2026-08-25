/**
 * The collaboration HTTP contract, driven end to end over a real server with a
 * fake engine in place of the model.
 *
 * Two things are worth the ceremony. The rejections: every one of them exists
 * to stop a run that would have spent plan quota on all participating accounts
 * before failing, so a rule that silently stops being enforced is expensive in
 * a way a green test suite would otherwise hide. And the read model: names are
 * resolved per request, which means a deleted account has to render as a label
 * instead of taking a transcript down with it.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { configureCollabModelCatalog } from '@/modules/collab/collab-model-catalog.service.js';
import { collabRepository } from '@/modules/collab/collab.repository.js';
import type { CouncilContract } from '@/modules/collab/council-contract.js';
import type { CouncilSummary } from '@/modules/collab/council-summary.js';
import { createCollabRouter } from '@/modules/collab/collab.routes.js';
import { createCollabService } from '@/modules/collab/collab.service.js';
import type { CollabProfileGateway, CollabProfileSummary } from '@/modules/collab/collab.service.js';
import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

type FakeProfile = CollabProfileSummary & { authenticated: boolean };

const profileStore = new Map<string, FakeProfile>();

/** Ids handed to the engine, so the fire-and-forget dispatch stays observable. */
const startedRuns: string[] = [];

const profiles: CollabProfileGateway = {
  find: (profileId) => profileStore.get(profileId) ?? null,
  isAuthenticated: (profileId) => profileStore.get(profileId)?.authenticated === true,
};

function seedProfile(overrides: Partial<FakeProfile> & { id: string }): FakeProfile {
  const profile: FakeProfile = {
    name: `Account ${overrides.id}`,
    provider: 'claude',
    authenticated: true,
    ...overrides,
  };
  profileStore.set(profile.id, profile);
  return profile;
}

function buildTestApp(): express.Express {
  const app = express();
  app.use(express.json());

  const services = createCollabService({
    profiles,
    // No model is ever reached: the run is recorded and immediately resolved.
    engine: {
      run: (collaborationId: string) => {
        startedRuns.push(collaborationId);
        return Promise.resolve();
      },
    },
  });

  app.use('/api/collaborations', createCollabRouter(services));
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({
          success: false,
          error: { code: err.code, message: err.message },
        });
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
    },
  );
  return app;
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'collab-routes-'));

  // A fixed catalog in place of the live one: the rule under test is that the
  // route refuses a model the participant's provider does not offer, and a
  // catalog that can change under the suite would test the provider instead.
  configureCollabModelCatalog({
    options: (provider) =>
      provider === 'claude'
        ? [{ value: 'opus', effortValues: ['low', 'high', 'max'] }]
        : [{ value: 'gpt-5.5', effortValues: ['low', 'high', 'xhigh'] }],
  });

  profileStore.clear();
  startedRuns.length = 0;
  seedProfile({ id: 'profile-a', name: 'Ada' });
  seedProfile({ id: 'profile-b', name: 'Linus' });

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const server = http.createServer(buildTestApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    configureCollabModelCatalog(null);
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

// `json` is intentionally `any`: tests assert on the dynamic REST envelope shape.
type JsonResponse = { status: number; json: any };

async function request(
  baseUrl: string,
  pathname: string,
  init?: RequestInit,
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, json: await response.json() };
}

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    topic: 'Should the scheduler be split in two?',
    projectPath: '/workspace/demo',
    mode: 'debate',
    participants: [{ profileId: 'profile-a' }, { profileId: 'profile-b' }],
    ...overrides,
  };
}

async function post(baseUrl: string, body: unknown): Promise<JsonResponse> {
  return request(baseUrl, '/api/collaborations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Every rejection shares the same shape, so they are asserted the same way. */
async function assertRejected(
  baseUrl: string,
  body: Record<string, unknown>,
  code: string,
): Promise<void> {
  const { status, json } = await post(baseUrl, body);
  assert.equal(status, 400, `expected 400 for ${code}, got ${status}`);
  assert.equal(json.error.code, code);
  assert.equal(startedRuns.length, 0, 'a rejected collaboration must never start a run');
}

test('POST /api/collaborations starts a running collaboration and returns 201', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await post(baseUrl, createBody());
    const collaboration = json.data.collaboration;

    assert.equal(status, 201);
    assert.equal(json.success, true);
    assert.equal(collaboration.status, 'running');
    assert.equal(collaboration.mode, 'debate');
    assert.equal(collaboration.maxRounds, 3);
    assert.equal(collaboration.currentRound, 0);
    assert.equal(collaboration.verdict, null);
    assert.deepEqual(
      collaboration.participants,
      [
        { profileId: 'profile-a', provider: 'claude', role: 'participant', profileName: 'Ada' },
        { profileId: 'profile-b', provider: 'claude', role: 'participant', profileName: 'Linus' },
      ],
    );
    assert.deepEqual(startedRuns, [collaboration.id]);
  });
});

test('POST /api/collaborations rejects malformed input before any run starts', async () => {
  await withServer(async (baseUrl) => {
    await assertRejected(baseUrl, createBody({ topic: '   ' }), 'TOPIC_REQUIRED');
    await assertRejected(baseUrl, createBody({ projectPath: '' }), 'PROJECT_PATH_REQUIRED');
    await assertRejected(baseUrl, createBody({ mode: 'brainstorm' }), 'INVALID_MODE');
    await assertRejected(
      baseUrl,
      createBody({ participants: [{ profileId: 'profile-a' }] }),
      'INVALID_PARTICIPANT_COUNT',
    );
    await assertRejected(
      baseUrl,
      createBody({
        participants: ['a', 'b', 'c', 'd', 'e'].map((suffix) => ({ profileId: `profile-${suffix}` })),
      }),
      'INVALID_PARTICIPANT_COUNT',
    );
    await assertRejected(
      baseUrl,
      createBody({ participants: [{ profileId: 'profile-a' }, { profileId: 'profile-a' }] }),
      'DUPLICATE_PARTICIPANT',
    );
    await assertRejected(baseUrl, createBody({ maxRounds: 0 }), 'INVALID_MAX_ROUNDS');
    await assertRejected(baseUrl, createBody({ maxRounds: 6 }), 'INVALID_MAX_ROUNDS');
    await assertRejected(baseUrl, createBody({ maxRounds: 2.5 }), 'INVALID_MAX_ROUNDS');
    await assertRejected(baseUrl, createBody({ maxRounds: '3' }), 'INVALID_MAX_ROUNDS');
  });
});

test('POST /api/collaborations rejects participants that cannot run a turn', async () => {
  await withServer(async (baseUrl) => {
    await assertRejected(
      baseUrl,
      createBody({ participants: [{ profileId: 'profile-a' }, { profileId: 'ghost' }] }),
      'PARTICIPANT_PROFILE_NOT_FOUND',
    );

    // Claude and Codex each have an enforced read-only mode; the other two have
    // none wired here, so a seat at the table would mean a participant free to
    // edit the repository the collaboration is arguing about.
    seedProfile({ id: 'profile-cursor', name: 'Cursed', provider: 'cursor' });
    await assertRejected(
      baseUrl,
      createBody({ participants: [{ profileId: 'profile-a' }, { profileId: 'profile-cursor' }] }),
      'PARTICIPANT_PROVIDER_UNSUPPORTED',
    );

    seedProfile({ id: 'profile-opencode', name: 'Opal', provider: 'opencode' });
    await assertRejected(
      baseUrl,
      createBody({ participants: [{ profileId: 'profile-a' }, { profileId: 'profile-opencode' }] }),
      'PARTICIPANT_PROVIDER_UNSUPPORTED',
    );

    seedProfile({ id: 'profile-fresh', name: 'Fresh', authenticated: false });
    await assertRejected(
      baseUrl,
      createBody({ participants: [{ profileId: 'profile-a' }, { profileId: 'profile-fresh' }] }),
      'PARTICIPANT_NOT_AUTHENTICATED',
    );
  });
});

test('POST /api/collaborations seats a Claude account and a Codex account together', async () => {
  await withServer(async (baseUrl) => {
    seedProfile({ id: 'profile-codex', name: 'Codie', provider: 'codex' });

    const { status, json } = await post(
      baseUrl,
      createBody({ participants: [{ profileId: 'profile-a' }, { profileId: 'profile-codex' }] }),
    );
    const collaboration = json.data.collaboration;

    assert.equal(status, 201);
    // The provider travels with the participant because it is what decides
    // which adapter runs that seat's turns.
    assert.deepEqual(
      collaboration.participants.map((participant: { provider: string }) => participant.provider),
      ['claude', 'codex'],
    );
    assert.deepEqual(startedRuns, [collaboration.id]);
  });
});

test('POST /api/collaborations seats each account on its own model and effort', async () => {
  await withServer(async (baseUrl) => {
    seedProfile({ id: 'profile-codex', name: 'Codie', provider: 'codex' });

    const { status, json } = await post(
      baseUrl,
      createBody({
        participants: [
          { profileId: 'profile-a', model: 'opus', effort: 'max' },
          // Each seat is checked against its own provider: `gpt-5.5` is not a
          // Claude model, and would be refused on the row above.
          { profileId: 'profile-codex', model: 'gpt-5.5', effort: 'xhigh' },
        ],
      }),
    );

    assert.equal(status, 201);
    assert.deepEqual(json.data.collaboration.participants, [
      {
        profileId: 'profile-a', provider: 'claude', role: 'participant',
        model: 'opus', effort: 'max', profileName: 'Ada',
      },
      {
        profileId: 'profile-codex', provider: 'codex', role: 'participant',
        model: 'gpt-5.5', effort: 'xhigh', profileName: 'Codie',
      },
    ]);
  });
});

test('POST /api/collaborations refuses a model the seat provider does not offer', async () => {
  await withServer(async (baseUrl) => {
    await assertRejected(
      baseUrl,
      createBody({
        participants: [{ profileId: 'profile-a', model: 'gpt-5.5' }, { profileId: 'profile-b' }],
      }),
      'PARTICIPANT_MODEL_UNSUPPORTED',
    );

    // An effort the model does not take is not worth a rejection: the run still
    // happens, on the model's own default, so the seat only loses the refinement.
    const { status, json } = await post(
      baseUrl,
      createBody({
        participants: [
          { profileId: 'profile-a', model: 'opus', effort: 'medium' },
          { profileId: 'profile-b' },
        ],
      }),
    );
    assert.equal(status, 201);
    assert.equal(json.data.collaboration.participants[0].model, 'opus');
    assert.equal(json.data.collaboration.participants[0].effort, undefined);
  });
});

test('POST /api/collaborations requires one author and one reviewer in review mode', async () => {
  await withServer(async (baseUrl) => {
    await assertRejected(baseUrl, createBody({ mode: 'review' }), 'INVALID_REVIEW_ROLES');
    await assertRejected(
      baseUrl,
      createBody({
        mode: 'review',
        participants: [
          { profileId: 'profile-a', role: 'reviewer' },
          { profileId: 'profile-b', role: 'reviewer' },
        ],
      }),
      'INVALID_REVIEW_ROLES',
    );

    seedProfile({ id: 'profile-c', name: 'Grace' });
    await assertRejected(
      baseUrl,
      createBody({
        mode: 'review',
        participants: [
          { profileId: 'profile-a', role: 'author' },
          { profileId: 'profile-b', role: 'reviewer' },
          { profileId: 'profile-c', role: 'reviewer' },
        ],
      }),
      'INVALID_REVIEW_ROLES',
    );

    const accepted = await post(
      baseUrl,
      createBody({
        mode: 'review',
        participants: [
          { profileId: 'profile-a', role: 'author' },
          { profileId: 'profile-b', role: 'reviewer' },
        ],
      }),
    );
    assert.equal(accepted.status, 201);
    assert.deepEqual(
      accepted.json.data.collaboration.participants.map((entry: { role: string }) => entry.role),
      ['author', 'reviewer'],
    );
  });
});

test('POST /api/collaborations coerces a vote to a single round instead of rejecting it', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await post(baseUrl, createBody({ mode: 'vote', maxRounds: 5 }));

    assert.equal(status, 201);
    assert.equal(json.data.collaboration.maxRounds, 1);
  });
});

test('GET /api/collaborations lists newest first and filters by project path', async () => {
  await withServer(async (baseUrl) => {
    await post(baseUrl, createBody({ topic: 'First', projectPath: '/workspace/one' }));
    await post(baseUrl, createBody({ topic: 'Second', projectPath: '/workspace/two' }));

    const all = await request(baseUrl, '/api/collaborations');
    assert.equal(all.status, 200);
    assert.equal(all.json.data.collaborations.length, 2);

    const filtered = await request(
      baseUrl,
      `/api/collaborations?projectPath=${encodeURIComponent('/workspace/two')}`,
    );
    assert.equal(filtered.json.data.collaborations.length, 1);
    assert.equal(filtered.json.data.collaborations[0].topic, 'Second');
    assert.equal(filtered.json.data.collaborations[0].participants[0].profileName, 'Ada');
  });
});

test('GET /api/collaborations/:id returns the transcript with account names', async () => {
  await withServer(async (baseUrl) => {
    const created = await post(baseUrl, createBody());
    const id = created.json.data.collaboration.id;

    collabRepository.appendTurn({
      id: 'turn-1',
      collaborationId: id,
      round: 1,
      turnIndex: 0,
      profileId: 'profile-a',
      role: 'participant',
      content: 'Splitting it costs us the shared cache.',
      consensus: false,
    });
    collabRepository.appendTurn({
      id: 'turn-2',
      collaborationId: id,
      round: 1,
      turnIndex: 1,
      profileId: 'profile-b',
      role: 'participant',
      content: 'Agreed, the cache is the deciding constraint.',
      consensus: true,
    });

    const { status, json } = await request(baseUrl, `/api/collaborations/${id}`);
    const turns = json.data.collaboration.turns;

    assert.equal(status, 200);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].profileName, 'Ada');
    assert.equal(turns[0].consensus, false);
    assert.equal(turns[1].profileName, 'Linus');
    assert.equal(turns[1].consensus, true);
    assert.equal(turns[1].error, null);
  });
});

test('GET /api/collaborations/:id renders a deleted account instead of failing', async () => {
  await withServer(async (baseUrl) => {
    const created = await post(baseUrl, createBody());
    const id = created.json.data.collaboration.id;

    collabRepository.appendTurn({
      id: 'turn-1',
      collaborationId: id,
      round: 1,
      turnIndex: 0,
      profileId: 'profile-b',
      role: 'participant',
      content: 'A position nobody can attribute anymore.',
    });
    profileStore.delete('profile-b');

    const { status, json } = await request(baseUrl, `/api/collaborations/${id}`);
    const collaboration = json.data.collaboration;

    assert.equal(status, 200);
    assert.equal(collaboration.participants[0].profileName, 'Ada');
    assert.equal(collaboration.participants[1].profileName, '(profile removed)');
    assert.equal(collaboration.turns[0].profileName, '(profile removed)');
  });
});

test('GET /api/collaborations/:id returns 404 for an unknown collaboration', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await request(baseUrl, '/api/collaborations/nope');
    assert.equal(status, 404);
    assert.equal(json.error.code, 'COLLABORATION_NOT_FOUND');
  });
});

test('POST /api/collaborations/:id/stop stops a running collaboration once', async () => {
  await withServer(async (baseUrl) => {
    const created = await post(baseUrl, createBody());
    const id = created.json.data.collaboration.id;

    const stopped = await request(baseUrl, `/api/collaborations/${id}/stop`, { method: 'POST' });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.data.collaboration.status, 'stopped');

    const again = await request(baseUrl, `/api/collaborations/${id}/stop`, { method: 'POST' });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, 'COLLABORATION_NOT_RUNNING');
  });
});

test('DELETE /api/collaborations/:id removes the collaboration', async () => {
  await withServer(async (baseUrl) => {
    const created = await post(baseUrl, createBody());
    const id = created.json.data.collaboration.id;

    const deleted = await request(baseUrl, `/api/collaborations/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.json.data.deleted, true);

    const list = await request(baseUrl, '/api/collaborations');
    assert.equal(list.json.data.collaborations.length, 0);

    const missing = await request(baseUrl, `/api/collaborations/${id}`, { method: 'DELETE' });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'COLLABORATION_NOT_FOUND');
  });
});

test('POST /api/collaborations starts a council and echoes the budget it will run under', async () => {
  await withServer(async (baseUrl) => {
    const { status, json } = await post(
      baseUrl,
      createBody({ mode: 'council', maxRounds: 2, budget: { totalTokens: 40_000 } }),
    );
    const collaboration = json.data.collaboration;

    assert.equal(status, 201);
    assert.equal(collaboration.mode, 'council');
    assert.deepEqual(collaboration.budget, {
      totalTokens: 40_000,
      // Untouched fields keep the defaults for this shape: two seats, two
      // rounds, plus the synthesis.
      maxTurns: 5,
      turnTimeoutMs: 300_000,
    });
    // No run has finished, so there is nothing to summarize yet.
    assert.equal(collaboration.summary, null);
    assert.deepEqual(startedRuns, [collaboration.id]);
  });
});

test('POST /api/collaborations refuses an impossible budget before anything runs', async () => {
  await withServer(async (baseUrl) => {
    await assertRejected(baseUrl, createBody({ budget: { maxTurns: 0 } }), 'INVALID_BUDGET');
    await assertRejected(baseUrl, createBody({ budget: { totalTokens: 12 } }), 'INVALID_BUDGET');
    await assertRejected(baseUrl, createBody({ budget: 'unlimited' }), 'INVALID_BUDGET');
  });
});

test('GET /api/collaborations/:id exposes the contract, the cost and the council summary', async () => {
  await withServer(async (baseUrl) => {
    const created = await post(baseUrl, createBody({ mode: 'council', maxRounds: 1 }));
    const { id } = created.json.data.collaboration;

    const contract: CouncilContract = {
      evidence: [{ observation: 'the scheduler holds one lock', source: 'a.ts:1' }],
      risks: [{ risk: 'stranded jobs', severity: 'high' }],
      tests: [{ test: 'replay the queue', status: 'proposed', result: null }],
      disagreements: [{ with: 'Linus', point: 'the lock is not the bottleneck' }],
      confidence: { value: 65, rationale: 'read it, did not profile it' },
    };
    const summary: CouncilSummary = {
      contractsParsed: 1,
      contractsFailed: 1,
      agreements: [],
      disputes: [{ point: 'the lock is not the bottleneck', raisedBy: ['profile-a'], against: ['Linus'] }],
      risks: [{ risk: 'stranded jobs', severity: 'high', raisedBy: ['profile-a'] }],
      confidence: { min: 65, median: 65, max: 65, byParticipant: [{ profileId: 'profile-a', value: 65 }] },
      budget: { totalTokens: 200_000, maxTurns: 3, tokensUsed: 4_200, turnsUsed: 3, stoppedBy: 'turns' },
    };

    collabRepository.appendTurn({
      id: 'turn-1',
      collaborationId: id,
      round: 1,
      turnIndex: 0,
      profileId: 'profile-a',
      role: 'participant',
      content: 'Prose plus a contract.',
      consensus: false,
      contract,
      usage: { inputTokens: 3_000, outputTokens: 1_200 },
    });
    collabRepository.appendTurn({
      id: 'turn-2',
      collaborationId: id,
      round: 1,
      turnIndex: 1,
      profileId: 'profile-b',
      role: 'participant',
      content: 'No JSON here.',
      contractError: 'No council contract JSON object was found in this answer.',
    });
    collabRepository.updateStatus(id, { status: 'exhausted', verdict: 'Synthesis.', summary });

    const { status, json } = await request(baseUrl, `/api/collaborations/${id}`);
    const collaboration = json.data.collaboration;

    assert.equal(status, 200);
    assert.deepEqual(collaboration.summary, summary);
    assert.deepEqual(collaboration.turns[0].contract, contract);
    assert.deepEqual(collaboration.turns[0].usage, { inputTokens: 3_000, outputTokens: 1_200 });
    assert.equal(collaboration.turns[0].profileName, 'Ada');

    // The unreadable answer keeps its prose and carries the reason next to it.
    assert.equal(collaboration.turns[1].contract, null);
    assert.match(collaboration.turns[1].contractError, /No council contract JSON object/);
    assert.equal(collaboration.turns[1].content, 'No JSON here.');
  });
});

test('a debate answered before councils existed is served with empty council fields', async () => {
  await withServer(async (baseUrl) => {
    const created = await post(baseUrl, createBody());
    const { id } = created.json.data.collaboration;

    collabRepository.appendTurn({
      id: 'turn-1',
      collaborationId: id,
      round: 1,
      turnIndex: 0,
      profileId: 'profile-a',
      role: 'participant',
      content: 'A position.\nCONSENSUS: NO — not yet',
      consensus: false,
    });

    const { json } = await request(baseUrl, `/api/collaborations/${id}`);
    const collaboration = json.data.collaboration;

    assert.equal(collaboration.summary, null);
    assert.equal(collaboration.turns[0].contract, null);
    assert.equal(collaboration.turns[0].contractError, null);
    assert.equal(collaboration.turns[0].usage, null);
    // The fields the panel already renders are untouched.
    assert.equal(collaboration.turns[0].consensus, false);
    assert.equal(collaboration.turns[0].content, 'A position.\nCONSENSUS: NO — not yet');
  });
});
