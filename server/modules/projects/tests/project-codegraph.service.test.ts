import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  detectCodegraphIndex,
  getProjectCodegraph,
  isCodegraphIndexing,
  startCodegraphIndexing,
  startWorktreeCodegraphIndex,
} from '@/modules/projects/services/project-codegraph.service.js';
import { AppError } from '@/shared/utils.js';

type FakeChild = EventEmitter;

function createSpawnRecorder() {
  const calls: Array<{ command: string; args: string[]; cwd: string | undefined; child: FakeChild }> = [];
  const spawnFn = ((command: string, args: string[], options: { cwd?: string }) => {
    const child = new EventEmitter();
    calls.push({ command, args, cwd: options?.cwd, child });
    return child;
  }) as unknown as typeof import('cross-spawn');
  return { calls, spawnFn };
}

test('project codegraph service', async (t) => {
  let projectDir: string;

  t.beforeEach(async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), 'codegraph-svc-'));
  });

  t.afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  await t.test('detectCodegraphIndex is true only for a .codegraph directory', async () => {
    assert.equal(await detectCodegraphIndex(projectDir), false);

    await writeFile(path.join(projectDir, '.codegraph'), 'not a dir');
    assert.equal(await detectCodegraphIndex(projectDir), false);

    await rm(path.join(projectDir, '.codegraph'));
    await mkdir(path.join(projectDir, '.codegraph'));
    assert.equal(await detectCodegraphIndex(projectDir), true);
  });

  await t.test('getProjectCodegraph throws 404 for unknown project ids', async () => {
    await assert.rejects(
      () => getProjectCodegraph('missing-project', () => null),
      (error: unknown) => error instanceof AppError && error.statusCode === 404,
    );
  });

  await t.test('getProjectCodegraph reports index and in-flight state', async () => {
    await mkdir(path.join(projectDir, '.codegraph'));
    const resolve = () => projectDir;

    const before = await getProjectCodegraph('proj-1', resolve);
    assert.deepEqual(before.codegraph, { hasCodegraph: true, indexing: false });

    const { calls, spawnFn } = createSpawnRecorder();
    startCodegraphIndexing(projectDir, { spawnFn });
    const during = await getProjectCodegraph('proj-1', resolve);
    assert.equal(during.codegraph.indexing, true);

    calls[0].child.emit('close', 0);
    const after = await getProjectCodegraph('proj-1', resolve);
    assert.equal(after.codegraph.indexing, false);
  });

  await t.test('startCodegraphIndexing runs codegraph init in the target dir and reports completion', () => {
    const { calls, spawnFn } = createSpawnRecorder();
    const outcomes: boolean[] = [];

    startCodegraphIndexing(projectDir, { spawnFn, onDone: (success) => outcomes.push(success) });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'codegraph');
    assert.deepEqual(calls[0].args, ['init']);
    assert.equal(calls[0].cwd, path.resolve(projectDir));
    assert.equal(isCodegraphIndexing(projectDir), true);

    calls[0].child.emit('close', 0);
    assert.deepEqual(outcomes, [true]);
    assert.equal(isCodegraphIndexing(projectDir), false);
  });

  await t.test('startCodegraphIndexing rejects a second run for the same directory', () => {
    const { calls, spawnFn } = createSpawnRecorder();
    startCodegraphIndexing(projectDir, { spawnFn });

    assert.throws(
      () => startCodegraphIndexing(projectDir, { spawnFn }),
      (error: unknown) => error instanceof AppError && error.statusCode === 409,
    );

    calls[0].child.emit('close', 0);
    // After completion a new run is allowed again.
    startCodegraphIndexing(projectDir, { spawnFn });
    calls[1].child.emit('close', 0);
  });

  await t.test('startCodegraphIndexing clears in-flight state when the binary is missing', () => {
    const { calls, spawnFn } = createSpawnRecorder();
    const outcomes: boolean[] = [];

    startCodegraphIndexing(projectDir, { spawnFn, onDone: (success) => outcomes.push(success) });
    calls[0].child.emit('error', new Error('spawn codegraph ENOENT'));

    assert.deepEqual(outcomes, [false]);
    assert.equal(isCodegraphIndexing(projectDir), false);
  });

  await t.test('startWorktreeCodegraphIndex only indexes when the source repo is indexed', async () => {
    const worktreeDir = await mkdtemp(path.join(tmpdir(), 'codegraph-wt-'));
    try {
      const { calls, spawnFn } = createSpawnRecorder();

      assert.equal(await startWorktreeCodegraphIndex(projectDir, worktreeDir, spawnFn), false);
      assert.equal(calls.length, 0);

      await mkdir(path.join(projectDir, '.codegraph'));
      assert.equal(await startWorktreeCodegraphIndex(projectDir, worktreeDir, spawnFn), true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].cwd, path.resolve(worktreeDir));
      calls[0].child.emit('close', 0);
    } finally {
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  await t.test('startWorktreeCodegraphIndex never throws', async () => {
    await mkdir(path.join(projectDir, '.codegraph'));
    const throwingSpawn = (() => {
      throw new Error('spawn exploded');
    }) as unknown as typeof import('cross-spawn');

    assert.equal(await startWorktreeCodegraphIndex(projectDir, projectDir + '-wt', throwingSpawn), false);
  });
});
