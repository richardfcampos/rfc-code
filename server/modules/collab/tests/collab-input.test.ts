/**
 * Rules that reject a collaboration before it costs anything.
 *
 * Asserted directly against the parser rather than through HTTP: it is pure,
 * the profile directory it needs is a two-method fake, and a payload that would
 * burn quota on a run that was always going to be wrong deserves a test that
 * says exactly which rule caught it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCreateCollaborationInput } from '../collab-input.service.js';
import type { CollabProfileGateway } from '../collab-input.service.js';
import type { CollabModelCatalog } from '../collab-model-catalog.service.js';

const profiles: CollabProfileGateway = {
  find: (id) => ({ id, name: `Account ${id}`, provider: 'claude' }),
  isAuthenticated: () => true,
};

/**
 * A catalog small enough to reason about, and deliberately not the real one:
 * these rules must hold for whatever a provider happens to offer today. `swift`
 * takes no effort at all, which is how a real provider ships its fastest model.
 */
const catalog: CollabModelCatalog = {
  options: (provider) =>
    provider === 'claude'
      ? [
        { value: 'opus', effortValues: ['low', 'high', 'max'] },
        { value: 'swift', effortValues: [] },
      ]
      : null,
};

function parse(overrides: Record<string, unknown> = {}) {
  return parseCreateCollaborationInput(body(overrides), profiles, catalog);
}

/** The first participant of a debate whose seats carry model choices. */
function seat(overrides: Record<string, unknown> = {}) {
  return parse({
    participants: [{ profileId: 'profile-a', ...overrides }, { profileId: 'profile-b' }],
  }).participants[0];
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    topic: 'Should we split the scheduler?',
    projectPath: '/workspace/demo',
    mode: 'debate',
    participants: [{ profileId: 'profile-a' }, { profileId: 'profile-b' }],
    ...overrides,
  };
}

function reviewBody(roles: string[]): Record<string, unknown> {
  return body({
    mode: 'review',
    participants: roles.map((role, index) => ({ profileId: `profile-${index}`, role })),
  });
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
  return 'NO_ERROR';
}

test('a seat keeps the model and effort its provider actually offers', () => {
  assert.deepEqual(seat({ model: 'opus', effort: 'max' }), {
    profileId: 'profile-a',
    provider: 'claude',
    role: 'participant',
    model: 'opus',
    effort: 'max',
  });

  // Picking nothing has to stay indistinguishable from the payloads sent before
  // seats could pick: no key at all, so the CLI default survives the round trip.
  assert.deepEqual(seat(), {
    profileId: 'profile-a',
    provider: 'claude',
    role: 'participant',
  });
  assert.deepEqual(seat({ model: '   ', effort: '' }), {
    profileId: 'profile-a',
    provider: 'claude',
    role: 'participant',
  });
});

test('a model the provider does not offer is refused before the run costs anything', () => {
  assert.equal(
    codeOf(() => seat({ model: 'gpt-5.5' })),
    'PARTICIPANT_MODEL_UNSUPPORTED',
  );
  // Not a string: the same refusal, because the alternative is spending a turn
  // to discover the CLI could not make sense of it either.
  assert.equal(codeOf(() => seat({ model: 7 })), 'PARTICIPANT_MODEL_UNSUPPORTED');
});

test('an unknown catalog lets a model through instead of inventing a rejection', () => {
  // A provider whose catalog has not loaded yet answers `null`. Rejecting here
  // would turn a cold snapshot into a 400 on a request that is probably fine;
  // the seat falls back to what omitting a model already does.
  const cold: CollabModelCatalog = { options: () => null };
  const parsed = parseCreateCollaborationInput(
    body({ participants: [{ profileId: 'profile-a', model: 'anything' }, { profileId: 'profile-b' }] }),
    profiles,
    cold,
  );

  assert.equal(parsed.participants[0].model, 'anything');
  // Effort cannot be checked against a model nobody vetted, so it is dropped.
  assert.equal(parsed.participants[0].effort, undefined);
});

test('an effort the chosen model rejects degrades instead of failing the request', () => {
  // `medium` is missing from this model, `swift` takes no effort at all, and an
  // effort with no model has nothing to be valid against. All three drop the
  // value and keep the run: effort is a refinement, not the choice that decides
  // what the round costs.
  assert.equal(seat({ model: 'opus', effort: 'medium' }).effort, undefined);
  assert.equal(seat({ model: 'opus', effort: 'high' }).effort, 'high');
  assert.equal(seat({ model: 'swift', effort: 'high' }).effort, undefined);
  assert.equal(seat({ effort: 'high' }).effort, undefined);
  assert.equal(seat({ model: 'opus', effort: 42 }).effort, undefined);
});

test('a review must list the author first, because it also arbitrates', () => {
  const ordered = parseCreateCollaborationInput(reviewBody(['author', 'reviewer']), profiles);
  assert.deepEqual(
    ordered.participants.map((participant) => participant.role),
    ['author', 'reviewer'],
  );

  assert.equal(
    codeOf(() => parseCreateCollaborationInput(reviewBody(['reviewer', 'author']), profiles)),
    'INVALID_REVIEW_ROLE_ORDER',
  );
});

test('maxRounds is type-checked even in a mode that then coerces it', () => {
  assert.equal(
    codeOf(() => parseCreateCollaborationInput(body({ mode: 'vote', maxRounds: 'banana' }), profiles)),
    'INVALID_MAX_ROUNDS',
  );
  assert.equal(
    codeOf(() => parseCreateCollaborationInput(body({ mode: 'vote', maxRounds: 9 }), profiles)),
    'INVALID_MAX_ROUNDS',
  );

  // A valid ceiling is still collapsed to the single round a vote runs.
  assert.equal(
    parseCreateCollaborationInput(body({ mode: 'vote', maxRounds: 5 }), profiles).maxRounds,
    1,
  );
  assert.equal(parseCreateCollaborationInput(body({ mode: 'vote' }), profiles).maxRounds, 1);
  assert.equal(parseCreateCollaborationInput(body({ maxRounds: 4 }), profiles).maxRounds, 4);
});
