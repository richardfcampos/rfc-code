import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyCodexGlobalInstructions,
  buildCodexManagedBlock,
  mergeManagedBlock,
} from '@/modules/agent-tooling/codex-instructions.js';
import { setCodegraphAvailableForTests } from '@/modules/agent-tooling/codegraph-settings.js';

test('managed block carries the codegraph rule only when the CLI exists', () => {
  assert.match(buildCodexManagedBlock({ codegraph: true }), /codegraph explore/);
  assert.doesNotMatch(buildCodexManagedBlock({ codegraph: false }), /codegraph explore/);
  assert.match(buildCodexManagedBlock({ codegraph: false }), /RFC_MEMORY_DIR/);
});

test('mergeManagedBlock appends to user content and replaces an older block in place', () => {
  const block1 = buildCodexManagedBlock({ codegraph: false });
  const block2 = buildCodexManagedBlock({ codegraph: true });

  const appended = mergeManagedBlock('# Mine\n\nkeep this\n', block1);
  assert.ok(appended.startsWith('# Mine\n\nkeep this\n\n<!-- rfc-code:managed:start -->'));

  const withTail = `${appended}\n## After\nalso keep\n`;
  const replaced = mergeManagedBlock(withTail, block2);
  assert.match(replaced, /codegraph explore/);
  assert.equal(replaced.split('rfc-code:managed:start').length, 2, 'exactly one block');
  assert.ok(replaced.startsWith('# Mine\n\nkeep this\n\n'));
  assert.ok(replaced.endsWith('<!-- rfc-code:managed:end -->\n\n## After\nalso keep\n'));
});

test('applyCodexGlobalInstructions writes AGENTS.md into the profile dir idempotently', () => {
  setCodegraphAvailableForTests(true);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-instructions-'));

  applyCodexGlobalInstructions(profileDir);
  const first = fs.readFileSync(path.join(profileDir, 'AGENTS.md'), 'utf8');
  applyCodexGlobalInstructions(profileDir);
  const second = fs.readFileSync(path.join(profileDir, 'AGENTS.md'), 'utf8');

  assert.equal(first, second);
  assert.match(first, /codegraph explore/);
  setCodegraphAvailableForTests(null);
});
