import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findProviderSkillMarkdownFiles } from '@/shared/utils.js';

/**
 * Skills are commonly linked into a config directory rather than copied — one
 * shared install serving several profiles. Discovery reads entry types from
 * lstat, so without resolving links a symlinked skill is invisible.
 */
async function withTree(
  runTest: (ctx: { store: string; configDir: string }) => void | Promise<void>,
): Promise<void> {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'skill-symlink-'));
  const store = path.join(tempDirectory, 'store');
  const configDir = path.join(tempDirectory, 'config', 'skills');
  fs.mkdirSync(configDir, { recursive: true });

  for (const name of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(store, name), { recursive: true });
    fs.writeFileSync(
      path.join(store, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} skill\n---\n`,
    );
  }

  try {
    await runTest({ store, configDir });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a symlinked skill is discovered', async () => {
  await withTree(async ({ store, configDir }) => {
    fs.symlinkSync(path.join(store, 'alpha'), path.join(configDir, 'alpha'));

    const found = await findProviderSkillMarkdownFiles(configDir);

    assert.equal(found.length, 1);
    assert.equal(found[0].endsWith(path.join('alpha', 'SKILL.md')), true);
  });
});

test('symlinked and real skills are discovered side by side', async () => {
  await withTree(async ({ store, configDir }) => {
    fs.symlinkSync(path.join(store, 'alpha'), path.join(configDir, 'alpha'));
    fs.mkdirSync(path.join(configDir, 'own'), { recursive: true });
    fs.writeFileSync(path.join(configDir, 'own', 'SKILL.md'), '---\nname: own\n---\n');

    const found = await findProviderSkillMarkdownFiles(configDir);

    assert.equal(found.length, 2);
  });
});

test('a broken symlink is skipped instead of failing the whole scan', async () => {
  await withTree(async ({ store, configDir }) => {
    fs.symlinkSync(path.join(store, 'alpha'), path.join(configDir, 'alpha'));
    fs.symlinkSync(path.join(store, 'deleted'), path.join(configDir, 'gone'));

    const found = await findProviderSkillMarkdownFiles(configDir);

    assert.equal(found.length, 1, 'one dangling link must not hide its siblings');
  });
});

test('a recursive scan follows symlinks without looping forever', async () => {
  await withTree(async ({ store, configDir }) => {
    fs.symlinkSync(path.join(store, 'alpha'), path.join(configDir, 'alpha'));
    // A link back to the directory being walked would recurse endlessly if the
    // walk did not track what it had already visited.
    fs.symlinkSync(configDir, path.join(configDir, 'loop'));

    const found = await findProviderSkillMarkdownFiles(configDir, { recursive: true });

    assert.equal(found.length >= 1, true);
  });
});
