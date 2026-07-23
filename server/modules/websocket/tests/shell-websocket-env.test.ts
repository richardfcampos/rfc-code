import assert from 'node:assert/strict';
import test from 'node:test';

import { buildShellSpawnEnv } from '@/modules/websocket/services/shell-websocket.service.js';

// HUB-05 AC3 (guided re-auth): the login terminal must run with the selected
// profile's isolated env so `claude /login` (etc.) writes credentials into
// that profile's config dir rather than the server's default one.
test('buildShellSpawnEnv merges the resolved profile env into the base env', () => {
  const baseEnv = { PATH: '/usr/bin', TERM: 'xterm-256color' };
  const resolveProfileEnv = (profileId: string) => {
    assert.equal(profileId, 'profile-a');
    return { CLAUDE_CONFIG_DIR: '/data/profiles/claude/account-a' };
  };

  const result = buildShellSpawnEnv(baseEnv, 'profile-a', resolveProfileEnv);

  assert.equal(result.CLAUDE_CONFIG_DIR, '/data/profiles/claude/account-a');
  // Base env is preserved alongside the profile-scoped additions.
  assert.equal(result.PATH, '/usr/bin');
  assert.equal(result.TERM, 'xterm-256color');
});

// Retrocompat: a plain terminal (no profileId) never calls the resolver and
// gets back the exact base env, matching upstream behavior.
test('buildShellSpawnEnv returns the base env unchanged when no profileId is given', () => {
  const baseEnv = { PATH: '/usr/bin' };
  const resolveProfileEnv = () => {
    throw new Error('resolveProfileEnv must not be called without a profileId');
  };

  assert.equal(buildShellSpawnEnv(baseEnv, undefined, resolveProfileEnv), baseEnv);
});

// A dangling/unknown profile id is a hard, clear error — never a silent
// fallback to the server's own default credentials.
test('buildShellSpawnEnv propagates a clear error for an unknown profile id', () => {
  const baseEnv = { PATH: '/usr/bin' };
  const resolveProfileEnv = () => {
    throw new Error('Profile "does-not-exist" was not found.');
  };

  assert.throws(
    () => buildShellSpawnEnv(baseEnv, 'does-not-exist', resolveProfileEnv),
    /was not found/i,
  );
});
