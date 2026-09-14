import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureTaskMasterCliProviders,
  initializeTaskMaster,
} from '@/modules/projects/services/taskmaster-init.service.js';

const DEFAULT_INIT_CONFIG = {
  models: {
    main: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', maxTokens: 64000, temperature: 0.2 },
    research: { provider: 'perplexity', modelId: 'sonar', maxTokens: 8700, temperature: 0.1 },
    fallback: { provider: 'anthropic', modelId: 'claude-3-7-sonnet-20250219', maxTokens: 120000, temperature: 0.2 },
  },
  global: { logLevel: 'info' },
};

async function createProject(config: unknown | null = DEFAULT_INIT_CONFIG): Promise<string> {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), 'taskmaster-init-'));
  if (config) {
    await mkdir(path.join(projectPath, '.taskmaster'), { recursive: true });
    await writeFile(path.join(projectPath, '.taskmaster', 'config.json'), JSON.stringify(config, null, 2));
  }
  return projectPath;
}

async function readConfig(projectPath: string): Promise<typeof DEFAULT_INIT_CONFIG> {
  return JSON.parse(await readFile(path.join(projectPath, '.taskmaster', 'config.json'), 'utf8'));
}

function fakeSpawn(
  options: { exitCode?: number; stdout?: string; onSpawn?: (args: string[], cwd: string) => void | Promise<void> } = {},
) {
  return (_command: string, args: string[], spawnOptions: { cwd: string }) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    // Simulate the CLI's side effects finishing before the process exits.
    void Promise.resolve(options.onSpawn?.(args, spawnOptions.cwd)).then(() => {
      if (options.stdout) {
        child.stdout.emit('data', Buffer.from(options.stdout));
      }
      child.emit('close', options.exitCode ?? 0);
    });
    return child;
  };
}

test('ensureTaskMasterCliProviders swaps keyless hosted providers for claude-code', async () => {
  const projectPath = await createProject();
  try {
    const changed = await ensureTaskMasterCliProviders(projectPath, {});
    const config = await readConfig(projectPath);

    assert.equal(changed, true);
    assert.equal(config.models.main.provider, 'claude-code');
    assert.equal(config.models.main.modelId, 'opus');
    assert.equal(config.models.research.provider, 'claude-code');
    assert.equal(config.models.fallback.provider, 'claude-code');
    assert.equal(config.models.fallback.modelId, 'sonnet');
    assert.equal(config.global.logLevel, 'info', 'non-model settings are preserved');
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test('ensureTaskMasterCliProviders keeps hosted providers whose key is in the environment', async () => {
  const projectPath = await createProject();
  try {
    const changed = await ensureTaskMasterCliProviders(projectPath, { ANTHROPIC_API_KEY: 'sk-ant-real' });
    const config = await readConfig(projectPath);

    assert.equal(changed, true);
    assert.equal(config.models.main.provider, 'anthropic');
    assert.equal(config.models.fallback.provider, 'anthropic');
    assert.equal(config.models.research.provider, 'claude-code', 'perplexity had no key');
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test('ensureTaskMasterCliProviders reads keys from the project .env and ignores placeholders', async () => {
  const projectPath = await createProject();
  try {
    await writeFile(
      path.join(projectPath, '.env'),
      '# keys\nANTHROPIC_API_KEY="YOUR_ANTHROPIC_API_KEY_HERE"\nPERPLEXITY_API_KEY=pplx-real\n',
    );
    const changed = await ensureTaskMasterCliProviders(projectPath, {});
    const config = await readConfig(projectPath);

    assert.equal(changed, true);
    assert.equal(config.models.main.provider, 'claude-code', 'placeholder key does not count');
    assert.equal(config.models.research.provider, 'perplexity');
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test('ensureTaskMasterCliProviders is a no-op for CLI providers and missing config', async () => {
  const cliProject = await createProject({
    models: {
      main: { provider: 'claude-code', modelId: 'opus' },
      research: { provider: 'claude-code', modelId: 'opus' },
      fallback: { provider: 'codex-cli', modelId: 'gpt-5.2-codex' },
    },
  });
  const emptyProject = await createProject(null);
  try {
    assert.equal(await ensureTaskMasterCliProviders(cliProject, {}), false);
    assert.equal(await ensureTaskMasterCliProviders(emptyProject, {}), false);
  } finally {
    await rm(cliProject, { recursive: true, force: true });
    await rm(emptyProject, { recursive: true, force: true });
  }
});

test('initializeTaskMaster runs a non-interactive init when .taskmaster is missing', async () => {
  const projectPath = await createProject(null);
  const spawns: Array<{ args: string[]; cwd: string }> = [];
  try {
    const result = await initializeTaskMaster(projectPath, {
      env: {},
      spawnFn: fakeSpawn({
        stdout: 'ok',
        onSpawn: async (args, cwd) => {
          spawns.push({ args, cwd });
          await mkdir(path.join(cwd, '.taskmaster'), { recursive: true });
          await writeFile(path.join(cwd, '.taskmaster', 'config.json'), JSON.stringify(DEFAULT_INIT_CONFIG));
        },
      }) as never,
    });

    assert.equal(result.initialized, true);
    assert.equal(result.providersUpdated, true);
    assert.equal(result.output, 'ok');
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].cwd, projectPath);
    assert.ok(spawns[0].args.includes('init'));
    assert.ok(spawns[0].args.includes('-y'), 'init must not prompt');
    assert.ok(spawns[0].args.includes('--rules') && spawns[0].args.includes('claude'));
    assert.equal((await readConfig(projectPath)).models.main.provider, 'claude-code');
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test('initializeTaskMaster skips init but still repairs providers on an initialized project', async () => {
  const projectPath = await createProject();
  let spawned = false;
  try {
    const result = await initializeTaskMaster(projectPath, {
      env: {},
      spawnFn: fakeSpawn({ onSpawn: () => { spawned = true; } }) as never,
    });

    assert.equal(spawned, false);
    assert.equal(result.initialized, false);
    assert.equal(result.providersUpdated, true);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test('initializeTaskMaster rejects when the init process fails', async () => {
  const projectPath = await createProject(null);
  try {
    await assert.rejects(
      initializeTaskMaster(projectPath, { env: {}, spawnFn: fakeSpawn({ exitCode: 1 }) as never }),
      /exited with code 1/,
    );
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});
