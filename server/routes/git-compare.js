import path from 'path';
import { promises as fs } from 'fs';

import express from 'express';

import {
  getActualProjectPath,
  getRepositoryRootPath,
  spawnAsync,
  stripDiffHeaders,
  validateFilePath,
  validateGitRepository,
} from './git.js';

/**
 * Compare the checked-out work of a project against any other ref.
 *
 * The comparison runs from the merge base of `base` and HEAD to the working
 * tree, so it answers "what did this branch/worktree change" the way a pull
 * request does — commits landed on the base meanwhile are not counted — while
 * still including uncommitted edits and untracked files.
 */
const router = express.Router();
const COMPARE_DIFF_CHARACTER_LIMIT = 500_000;

function validateCompareRef(ref) {
  // A leading dash would let a ref be parsed as a git option.
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || !/^[a-zA-Z0-9._~^{}@/-]+$/.test(ref)) {
    throw new Error('Invalid base reference');
  }
  return ref;
}

function readStatusCode(status) {
  switch (status[0]) {
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    default:
      // Modified, type change, rename and copy all show as a modification.
      return 'M';
  }
}

/**
 * Joins `git diff --name-status -z`, `git diff --numstat -z` and
 * `git ls-files --others --exclude-standard -z` into one file list.
 *
 * NUL-separated output keeps paths with spaces and unicode intact. Renames
 * and copies carry two path entries (old, new); numstat marks them with an
 * empty path followed by the same pair. Exported for tests.
 */
export function parseCompareFiles(nameStatusOutput, numStatOutput, untrackedOutput) {
  const counts = new Map();
  const numStatEntries = numStatOutput.split('\0');
  for (let index = 0; index < numStatEntries.length; index++) {
    const entry = numStatEntries[index];
    if (!entry) continue;
    const [insertions, deletions, inlinePath] = entry.split('\t');
    let filePath = inlinePath;
    if (filePath === undefined || filePath === '') {
      // Rename/copy: the pair follows as two separate entries.
      filePath = numStatEntries[index + 2];
      index += 2;
    }
    if (!filePath) continue;
    // Binary files report "-" instead of a count; they get zeroes.
    const added = Number.parseInt(insertions, 10);
    const removed = Number.parseInt(deletions, 10);
    counts.set(filePath, {
      insertions: Number.isNaN(added) ? 0 : added,
      deletions: Number.isNaN(removed) ? 0 : removed,
    });
  }

  const files = [];
  const nameStatusEntries = nameStatusOutput.split('\0');
  for (let index = 0; index < nameStatusEntries.length; index++) {
    const status = nameStatusEntries[index];
    if (!status) continue;
    const isPair = status[0] === 'R' || status[0] === 'C';
    const previousPath = isPair ? nameStatusEntries[index + 1] : null;
    const filePath = nameStatusEntries[isPair ? index + 2 : index + 1];
    index += isPair ? 2 : 1;
    if (!filePath) continue;

    files.push({
      path: filePath,
      previousPath: previousPath || null,
      status: readStatusCode(status),
      insertions: counts.get(filePath)?.insertions ?? 0,
      deletions: counts.get(filePath)?.deletions ?? 0,
    });
  }

  for (const filePath of untrackedOutput.split('\0')) {
    if (!filePath) continue;
    files.push({ path: filePath, previousPath: null, status: 'U', insertions: 0, deletions: 0 });
  }

  return files;
}

function parseAheadBehind(revListOutput) {
  const [behind, ahead] = revListOutput.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
  return {
    ahead: Number.isNaN(ahead) ? 0 : ahead,
    behind: Number.isNaN(behind) ? 0 : behind,
  };
}

async function resolveCompareContext(projectId, rawBase) {
  const base = validateCompareRef(rawBase);
  const projectPath = await getActualProjectPath(projectId);
  await validateGitRepository(projectPath);
  const repositoryRoot = await getRepositoryRootPath(projectPath);

  try {
    await spawnAsync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: repositoryRoot });
  } catch {
    throw new Error(`Unknown reference "${base}"`);
  }

  let mergeBase;
  try {
    ({ stdout: mergeBase } = await spawnAsync('git', ['merge-base', base, 'HEAD'], { cwd: repositoryRoot }));
  } catch {
    throw new Error(`"${base}" shares no history with the current branch`);
  }

  return { repositoryRoot, base, mergeBase: mergeBase.trim() };
}

router.get('/compare', async (req, res) => {
  const { project, base } = req.query;

  if (!project || !base) {
    return res.status(400).json({ error: 'Project id and base reference are required' });
  }

  try {
    const context = await resolveCompareContext(project, base);
    const gitOptions = { cwd: context.repositoryRoot };

    const [nameStatus, numStat, untracked, revList] = await Promise.all([
      spawnAsync('git', ['diff', '--name-status', '-z', '-M', context.mergeBase, '--'], gitOptions),
      spawnAsync('git', ['diff', '--numstat', '-z', '-M', context.mergeBase, '--'], gitOptions),
      spawnAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], gitOptions),
      spawnAsync('git', ['rev-list', '--left-right', '--count', `${context.base}...HEAD`], gitOptions),
    ]);

    res.json({
      base: context.base,
      mergeBase: context.mergeBase,
      ...parseAheadBehind(revList.stdout),
      files: parseCompareFiles(nameStatus.stdout, numStat.stdout, untracked.stdout),
    });
  } catch (error) {
    console.error('Git compare error:', error);
    res.json({ error: error.message });
  }
});

async function readUntrackedFileDiff(repositoryRoot, filePath) {
  const absolutePath = path.join(repositoryRoot, filePath);
  const stats = await fs.stat(absolutePath);
  if (stats.isDirectory()) {
    return `Directory: ${filePath}\n(Cannot show diff for directories)`;
  }

  const lines = (await fs.readFile(absolutePath, 'utf-8')).split('\n');
  return `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`;
}

router.get('/compare-diff', async (req, res) => {
  const { project, base, file } = req.query;

  if (!project || !base || !file) {
    return res.status(400).json({ error: 'Project id, base reference and file path are required' });
  }

  try {
    const context = await resolveCompareContext(project, base);
    const filePath = validateFilePath(String(file), context.repositoryRoot)
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '');
    const gitOptions = { cwd: context.repositoryRoot };

    const { stdout: untrackedOutput } = await spawnAsync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '-z', '--', filePath],
      gitOptions,
    );

    let diff;
    if (untrackedOutput.split('\0').includes(filePath)) {
      diff = await readUntrackedFileDiff(context.repositoryRoot, filePath);
    } else {
      const { stdout } = await spawnAsync('git', ['diff', '-M', context.mergeBase, '--', filePath], gitOptions);
      diff = stripDiffHeaders(stdout);
    }

    const isTruncated = diff.length > COMPARE_DIFF_CHARACTER_LIMIT;
    res.json({
      diff: isTruncated
        ? `${diff.slice(0, COMPARE_DIFF_CHARACTER_LIMIT)}\n\n... Diff truncated to keep the UI responsive ...`
        : diff,
      isTruncated,
    });
  } catch (error) {
    console.error('Git compare diff error:', error);
    res.json({ error: error.message });
  }
});

export default router;
