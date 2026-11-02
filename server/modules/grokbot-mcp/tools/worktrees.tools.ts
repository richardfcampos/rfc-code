/**
 * Git worktree tools: `/api/worktrees`.
 *
 * The server resolves `project` (the registry id) to a repository path itself,
 * so the tools only forward ids and flags.
 */

import type { ToolDefinition } from '../grokbot-mcp.types.js';

import { optBool, optStr, PROJECT_ID, S, schema, str, tool, LONG_RUNNING_TIMEOUT_MS } from './tool-helpers.js';

const WORKTREE_PATH = S.string('Absolute path of the worktree, as returned by worktree_list.');

export const worktreeTools: ToolDefinition[] = [
  tool({
    name: 'worktree_list',
    description: 'List the git worktrees of a project, with branch and path of each. Use before opening, merging or removing one.',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['GET /api/worktrees'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/worktrees', query: { project: str(args, 'projectId') } }),
  }),
  tool({
    name: 'worktree_create',
    description:
      'Create a git worktree for a branch (optionally cut from baseBranch) and register it as a project. Set uniqueBranch to suffix the branch name when it already exists.',
    inputSchema: schema(
      {
        projectId: PROJECT_ID,
        branch: S.string('Branch name for the new worktree.'),
        baseBranch: S.string('Branch to start from; defaults to the current HEAD.'),
        uniqueBranch: S.boolean('Pick a unique branch name instead of failing when the branch exists.'),
      },
      ['projectId', 'branch'],
    ),
    covers: ['POST /api/worktrees/create'],
    run: (args, ctx) => {
      const body: Record<string, unknown> = { project: str(args, 'projectId'), branch: str(args, 'branch') };
      const baseBranch = optStr(args, 'baseBranch');
      const uniqueBranch = optBool(args, 'uniqueBranch');
      if (baseBranch !== undefined) body.baseBranch = baseBranch;
      if (uniqueBranch !== undefined) body.uniqueBranch = uniqueBranch;
      return ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: '/api/worktrees/create', body });
    },
  }),
  tool({
    name: 'worktree_open',
    description: 'Register an existing worktree as a project so sessions and files can use it. Returns the project record.',
    inputSchema: schema({ projectId: PROJECT_ID, worktreePath: WORKTREE_PATH }, ['projectId', 'worktreePath']),
    covers: ['POST /api/worktrees/open'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST',
        path: '/api/worktrees/open',
        body: { project: str(args, 'projectId'), worktreePath: str(args, 'worktreePath') },
      }),
  }),
  tool({
    name: 'worktree_merge',
    description:
      'Merge a worktree branch into the main checkout of the project. squash collapses it to one commit (use message); removeAfterMerge deletes the worktree afterwards.',
    inputSchema: schema(
      {
        projectId: PROJECT_ID,
        worktreePath: WORKTREE_PATH,
        squash: S.boolean('Squash-merge into a single commit.'),
        message: S.string('Commit message for the squash merge.'),
        removeAfterMerge: S.boolean('Remove the worktree after a successful merge.'),
      },
      ['projectId', 'worktreePath'],
    ),
    covers: ['POST /api/worktrees/merge'],
    run: (args, ctx) => {
      const body: Record<string, unknown> = { project: str(args, 'projectId'), worktreePath: str(args, 'worktreePath') };
      const squash = optBool(args, 'squash');
      const message = optStr(args, 'message');
      const removeAfterMerge = optBool(args, 'removeAfterMerge');
      if (squash !== undefined) body.squash = squash;
      if (message !== undefined) body.message = message;
      if (removeAfterMerge !== undefined) body.removeAfterMerge = removeAfterMerge;
      return ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: '/api/worktrees/merge', body });
    },
  }),
  tool({
    name: 'worktree_remove',
    description: 'Remove a git worktree. force discards uncommitted changes; deleteBranch also deletes its branch. Destructive, confirm before using force.',
    inputSchema: schema(
      {
        projectId: PROJECT_ID,
        worktreePath: WORKTREE_PATH,
        force: S.boolean('Remove even with uncommitted changes.'),
        deleteBranch: S.boolean('Also delete the worktree branch.'),
      },
      ['projectId', 'worktreePath'],
    ),
    covers: ['POST /api/worktrees/remove'],
    run: (args, ctx) => {
      const body: Record<string, unknown> = { project: str(args, 'projectId'), worktreePath: str(args, 'worktreePath') };
      const force = optBool(args, 'force');
      const deleteBranch = optBool(args, 'deleteBranch');
      if (force !== undefined) body.force = force;
      if (deleteBranch !== undefined) body.deleteBranch = deleteBranch;
      return ctx.api.dispatch({ timeoutMs: LONG_RUNNING_TIMEOUT_MS, method: 'POST', path: '/api/worktrees/remove', body });
    },
  }),
];

