import assert from 'node:assert/strict';
import test from 'node:test';

import { getProjectAccent, PROJECT_ACCENT_PALETTE } from './project-accent';

test('same project id always returns the same accent', () => {
  const first = getProjectAccent('project-abc');
  const second = getProjectAccent('project-abc');

  assert.equal(first.hue, second.hue);
});

test('returned hue comes from the fixed palette', () => {
  const accent = getProjectAccent('project-xyz');

  assert.ok(PROJECT_ACCENT_PALETTE.includes(accent.hue as (typeof PROJECT_ACCENT_PALETTE)[number]));
});

test('distinct ids can land on distinct accents', () => {
  const ids = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
  const hues = new Set(ids.map((id) => getProjectAccent(id).hue));

  assert.ok(hues.size > 1);
});

test('empty id resolves without throwing', () => {
  assert.doesNotThrow(() => getProjectAccent(''));
});
