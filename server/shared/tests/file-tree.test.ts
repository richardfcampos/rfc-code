import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getFileTree } from '@/shared/file-tree.js';

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'file-tree-'));
  await mkdir(path.join(root, 'src', 'deep', 'deeper'), { recursive: true });
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(root, 'README.md'), '# hi');
  await writeFile(path.join(root, 'src', 'a.ts'), '');
  await writeFile(path.join(root, 'src', 'b.ts'), '');
  await writeFile(path.join(root, 'src', 'deep', 'c.ts'), '');
  await writeFile(path.join(root, 'src', 'deep', 'deeper', 'd.ts'), '');
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), '');
  return root;
}

test('getFileTree lists directories first, skips ignored dirs and honours maxDepth', async () => {
  const root = await makeFixture();
  try {
    const tree = await getFileTree(root, 1);
    assert.deepEqual(tree.map((item) => item.name), ['src', 'README.md']);
    const src = tree[0];
    assert.equal(src.type, 'directory');
    assert.equal(src.permissionsRwx?.length, 9);
    assert.deepEqual(src.children?.map((item) => item.name), ['deep', 'a.ts', 'b.ts']);
    const deep = src.children?.[0];
    assert.equal(deep?.children, undefined, 'depth 1 must not descend into src/deep');
    assert.equal(deep?.truncated, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('getFileTree stops at the entry budget and flags truncated directories', async () => {
  const root = await makeFixture();
  try {
    const tree = await getFileTree(root, 10, 0, true, 3);
    const count = (items: typeof tree): number =>
      items.reduce((sum, item) => sum + 1 + count(item.children ?? []), 0);
    assert.ok(count(tree) <= 3, `expected at most 3 entries, got ${count(tree)}`);
    const src = tree.find((item) => item.name === 'src');
    assert.equal(src?.truncated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('getFileTree keeps the whole tree when the budget is large enough', async () => {
  const root = await makeFixture();
  try {
    const tree = await getFileTree(root, 10, 0, true, 1000);
    const deeper = tree[0].children?.[0].children?.[0];
    assert.equal(deeper?.name, 'deeper');
    assert.deepEqual(deeper?.children?.map((item) => item.name), ['d.ts']);
    const flat = JSON.stringify(tree);
    assert.ok(!flat.includes('truncated'));
    assert.ok(!flat.includes('node_modules'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('getFileTree with thousands of siblings does not wedge the limiter queue', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'file-tree-wide-'));
  try {
    await Promise.all(Array.from({ length: 5000 }, (_, i) => writeFile(path.join(root, `f${i}`), '')));
    const started = Date.now();
    const tree = await getFileTree(root, 1);
    assert.equal(tree.length, 5000);
    assert.ok(Date.now() - started < 10_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
