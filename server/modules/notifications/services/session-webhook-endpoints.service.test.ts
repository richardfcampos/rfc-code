import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_WEBHOOK_EVENTS,
  SessionWebhookConfigError,
  maskSessionWebhookMetadata,
  matchesTransition,
  normalizeSessionWebhookUpsert,
  readSessionWebhookMetadata,
} from './session-webhook-endpoints.service.js';

test('create requires url and secret and defaults events to all three with empty filters', () => {
  const metadata = normalizeSessionWebhookUpsert({ url: 'https://bot.example/hook', secret: 'top-secret-sixteen' }, null);
  assert.deepEqual(metadata, {
    url: 'https://bot.example/hook',
    secret: 'top-secret-sixteen',
    events: [...SESSION_WEBHOOK_EVENTS],
    projects: [],
    sessions: [],
  });
  assert.throws(() => normalizeSessionWebhookUpsert({ url: 'https://bot.example/hook' }, null), SessionWebhookConfigError);
  assert.throws(() => normalizeSessionWebhookUpsert({ secret: 'x-secret-sixteen-chars' }, null), /url is required/);
  assert.throws(() => normalizeSessionWebhookUpsert({ url: 'ftp://nope', secret: 'x-secret-sixteen-chars' }, null), /http or https/);
  assert.throws(() => normalizeSessionWebhookUpsert({ url: 'not a url', secret: 'x-secret-sixteen-chars' }, null), /valid http/);
  assert.throws(() => normalizeSessionWebhookUpsert({ url: 'https://a', secret: 'x-secret-sixteen-chars', events: ['session.nope'] }, null), /subset/);
  assert.throws(() => normalizeSessionWebhookUpsert({ url: 'https://a', secret: 'x-secret-sixteen-chars', projects: [1] }, null), /array of strings/);
});

test('update keeps the stored secret when omitted and lets filters be replaced', () => {
  const existing = { url: 'https://old', secret: 'keep-me', events: ['session.error'], projects: ['p1'], sessions: [] };
  const updated = normalizeSessionWebhookUpsert({ url: 'https://new', events: ['session.idle', 'session.idle'], sessions: ['s9'] }, existing);
  assert.equal(updated.secret, 'keep-me');
  assert.equal(updated.url, 'https://new');
  assert.deepEqual(updated.events, ['session.idle']);
  assert.deepEqual(updated.projects, ['p1']);
  assert.deepEqual(updated.sessions, ['s9']);

  const rotated = normalizeSessionWebhookUpsert({ secret: 'fresh-secret-rotated' }, existing);
  assert.equal(rotated.secret, 'fresh-secret-rotated');
  assert.equal(rotated.url, 'https://old');
});

test('masking replaces the secret with hasSecret and its last four characters', () => {
  assert.deepEqual(maskSessionWebhookMetadata({ url: 'https://a', secret: 'abcdefghijklmnop', events: ['session.idle'] }), {
    url: 'https://a',
    events: ['session.idle'],
    hasSecret: true,
    secretLast4: 'mnop',
  });
  assert.deepEqual(maskSessionWebhookMetadata({ url: 'https://a' }), { url: 'https://a', hasSecret: false, secretLast4: null });
  // A short secret gets no hint at all: four characters would be most of it.
  assert.deepEqual(maskSessionWebhookMetadata({ secret: 'short' }), { hasSecret: true, secretLast4: null });
  assert.equal(JSON.stringify(maskSessionWebhookMetadata({ secret: 'abcdefghijklmnop' })).includes('abcdefghijklmnop'), false);
});

test('stored metadata is read leniently and unusable rows yield null', () => {
  assert.equal(readSessionWebhookMetadata(null), null);
  assert.equal(readSessionWebhookMetadata({ url: 'https://a' }), null);
  const read = readSessionWebhookMetadata({ url: 'https://a', secret: 's', events: ['session.error', 'junk'], projects: ['p', 3] });
  assert.deepEqual(read?.events, ['session.error']);
  assert.deepEqual(read?.projects, ['p']);
  assert.deepEqual(readSessionWebhookMetadata({ url: 'https://a', secret: 's' })?.events, [...SESSION_WEBHOOK_EVENTS]);
});

test('filters match on event, project id or path, and session id; empty lists match everything', () => {
  const base = { url: 'https://a', secret: 's', events: ['session.idle' as const], projects: [], sessions: [] };
  const input = { event: 'session.idle', projectId: 'p1', projectPath: '/srv/p1', sessionId: 's1' };
  assert.equal(matchesTransition(base, input), true);
  assert.equal(matchesTransition(base, { ...input, event: 'session.error' }), false);
  assert.equal(matchesTransition({ ...base, projects: ['p1'] }, input), true);
  assert.equal(matchesTransition({ ...base, projects: ['/srv/p1'] }, input), true);
  assert.equal(matchesTransition({ ...base, projects: ['p2'] }, input), false);
  assert.equal(matchesTransition({ ...base, projects: ['p1'] }, { ...input, projectId: null, projectPath: null }), false);
  assert.equal(matchesTransition({ ...base, sessions: ['s1'] }, input), true);
  assert.equal(matchesTransition({ ...base, sessions: ['s2'] }, input), false);
});
