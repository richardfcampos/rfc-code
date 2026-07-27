import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applySkillSelection,
  disableSkill,
  enableAllSkills,
  enableSkill,
  listBundledSkills,
  listEnabledSkills,
  resolveProfileSkillsDir,
} from '@/modules/bundled-skills/index.js';

/**
 * Builds a fake bundle plus an empty profile dir, standing in for the image's
 * /opt/rfc-code/skills and one profile's config directory.
 */
async function withBundle(
  runTest: (ctx: { bundleRoot: string; profileDir: string }) => void | Promise<void>,
): Promise<void> {
  const previousRoot = process.env.BUNDLED_SKILLS_ROOT;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'bundled-skills-'));
  const bundleRoot = path.join(tempDirectory, 'bundle');
  const profileDir = path.join(tempDirectory, 'profile');

  for (const [name, description] of [
    ['alpha', 'First skill'],
    ['beta', 'Second skill'],
  ]) {
    fs.mkdirSync(path.join(bundleRoot, name), { recursive: true });
    fs.writeFileSync(
      path.join(bundleRoot, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n`,
    );
  }
  // Support dir with no SKILL.md — the "required" case.
  fs.mkdirSync(path.join(bundleRoot, 'common'), { recursive: true });
  fs.writeFileSync(path.join(bundleRoot, 'common', 'helper.py'), '# helper\n');

  fs.mkdirSync(profileDir, { recursive: true });
  process.env.BUNDLED_SKILLS_ROOT = bundleRoot;

  try {
    await runTest({ bundleRoot, profileDir });
  } finally {
    if (previousRoot === undefined) {
      delete process.env.BUNDLED_SKILLS_ROOT;
    } else {
      process.env.BUNDLED_SKILLS_ROOT = previousRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('the bundle lists skills with descriptions and flags support dirs', async () => {
  await withBundle(() => {
    const skills = listBundledSkills();

    assert.deepEqual(skills.map((s) => s.name), ['alpha', 'beta', 'common']);
    assert.equal(skills.find((s) => s.name === 'alpha')?.description, 'First skill');
    assert.equal(skills.find((s) => s.name === 'common')?.required, true);
    assert.equal(skills.find((s) => s.name === 'alpha')?.required, false);
  });
});

test('enabling a skill links it rather than copying it', async () => {
  await withBundle(({ bundleRoot, profileDir }) => {
    enableSkill(profileDir, 'alpha');

    const link = path.join(resolveProfileSkillsDir(profileDir), 'alpha');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(bundleRoot, 'alpha')));
    assert.deepEqual(listEnabledSkills(profileDir), ['alpha']);
  });
});

test('enabling twice is idempotent', async () => {
  await withBundle(({ profileDir }) => {
    enableSkill(profileDir, 'alpha');
    enableSkill(profileDir, 'alpha');

    assert.deepEqual(listEnabledSkills(profileDir), ['alpha']);
  });
});

test('disabling removes the link', async () => {
  await withBundle(({ profileDir }) => {
    enableAllSkills(profileDir);
    disableSkill(profileDir, 'beta');

    assert.deepEqual(listEnabledSkills(profileDir), ['alpha', 'common']);
  });
});

test('a selection always keeps required support dirs linked', async () => {
  await withBundle(({ profileDir }) => {
    // Asking for only "alpha" must not strip common/, which other skills import.
    applySkillSelection(profileDir, ['alpha']);

    assert.deepEqual(listEnabledSkills(profileDir), ['alpha', 'common']);
  });
});

test("a profile's own skill directory is never removed or reported as ours", async () => {
  await withBundle(({ profileDir }) => {
    const skillsDir = resolveProfileSkillsDir(profileDir);
    fs.mkdirSync(path.join(skillsDir, 'my-own'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'my-own', 'SKILL.md'), '---\nname: my-own\n---\n');

    enableAllSkills(profileDir);
    applySkillSelection(profileDir, []);

    assert.equal(fs.existsSync(path.join(skillsDir, 'my-own', 'SKILL.md')), true);
    assert.equal(listEnabledSkills(profileDir).includes('my-own'), false);
  });
});

test('a stale link pointing outside the bundle is repaired, not reported', async () => {
  await withBundle(({ bundleRoot, profileDir }) => {
    const skillsDir = resolveProfileSkillsDir(profileDir);
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.symlinkSync('/nonexistent/old-image/alpha', path.join(skillsDir, 'alpha'));

    // A broken link resolves nowhere, so it must not count as enabled.
    assert.deepEqual(listEnabledSkills(profileDir), []);

    enableSkill(profileDir, 'alpha');
    assert.equal(
      fs.realpathSync(path.join(skillsDir, 'alpha')),
      fs.realpathSync(path.join(bundleRoot, 'alpha')),
    );
  });
});

test("a user's own link with a colliding name is left alone", async () => {
  await withBundle(({ profileDir }) => {
    const skillsDir = resolveProfileSkillsDir(profileDir);
    fs.mkdirSync(skillsDir, { recursive: true });

    // Same name as a bundled skill, but pointing at the user's own checkout.
    const elsewhere = path.join(profileDir, 'elsewhere', 'alpha');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'SKILL.md'), '---\nname: alpha\n---\n');
    fs.symlinkSync(elsewhere, path.join(skillsDir, 'alpha'));

    enableAllSkills(profileDir);

    // Replacing it would silently swap the skill they chose for ours.
    assert.equal(fs.realpathSync(path.join(skillsDir, 'alpha')), fs.realpathSync(elsewhere));
    assert.equal(listEnabledSkills(profileDir).includes('alpha'), false);
  });
});

test('a link into the bundle is refreshed rather than left stale', async () => {
  await withBundle(({ bundleRoot, profileDir }) => {
    const skillsDir = resolveProfileSkillsDir(profileDir);
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.symlinkSync(path.join(bundleRoot, 'beta'), path.join(skillsDir, 'alpha'));

    enableSkill(profileDir, 'alpha');

    assert.equal(
      fs.realpathSync(path.join(skillsDir, 'alpha')),
      fs.realpathSync(path.join(bundleRoot, 'alpha')),
    );
  });
});

test('a missing bundle yields no skills instead of throwing', async () => {
  await withBundle(({ profileDir }) => {
    process.env.BUNDLED_SKILLS_ROOT = path.join(tmpdir(), 'definitely-not-here');

    assert.deepEqual(listBundledSkills(), []);
    assert.deepEqual(listEnabledSkills(profileDir), []);
  });
});
