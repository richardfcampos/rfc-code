import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CAVEMAN_MODE,
  normalizeCavemanMode,
  resolveCavemanEnv,
  resolveCavemanMode,
} from '@/modules/agent-tooling/caveman.js';

test('normalizeCavemanMode accepts supported modes case-insensitively', () => {
  assert.equal(normalizeCavemanMode('ultra'), 'ultra');
  assert.equal(normalizeCavemanMode(' FULL '), 'full');
});

test('normalizeCavemanMode rejects unsupported values instead of defaulting', () => {
  // A silent fallback here would store a mode the user never picked.
  assert.equal(normalizeCavemanMode('wenyan'), null);
  assert.equal(normalizeCavemanMode('verbose'), null);
  assert.equal(normalizeCavemanMode(42), null);
  assert.equal(normalizeCavemanMode(null), null);
});

test('resolveCavemanMode prefers the session override over the profile default', () => {
  assert.equal(resolveCavemanMode('lite', 'ultra'), 'lite');
});

test('resolveCavemanMode falls back to the profile default, then to off', () => {
  assert.equal(resolveCavemanMode(null, 'ultra'), 'ultra');
  assert.equal(resolveCavemanMode(null, null), DEFAULT_CAVEMAN_MODE);
  assert.equal(resolveCavemanMode(null, null), 'off');
});

test('resolveCavemanMode ignores a malformed override rather than failing the dispatch', () => {
  assert.equal(resolveCavemanMode('nonsense', 'lite'), 'lite');
});

test('a session override of off wins over a compressing profile default', () => {
  assert.equal(resolveCavemanMode('off', 'ultra'), 'off');
});

test('resolveCavemanEnv emits the variable even for off', () => {
  // Omitting it would let a CAVEMAN_DEFAULT_MODE inherited from the server
  // process leak into the session and defeat an explicit "off".
  assert.deepEqual(resolveCavemanEnv('off'), { CAVEMAN_DEFAULT_MODE: 'off' });
  assert.deepEqual(resolveCavemanEnv('ultra'), { CAVEMAN_DEFAULT_MODE: 'ultra' });
});
