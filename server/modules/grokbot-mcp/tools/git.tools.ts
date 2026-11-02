/**
 * Git read tools: `/api/git` queries plus branch comparison.
 *
 * Every tool sends `project` (the registry id); the mutating half lives in
 * `git-write.tools.ts` and is re-exported through `gitTools` so the registry
 * sees one section.
 */

import type { JsonObject, ToolContext, ToolDefinition } from '../grokbot-mcp.types.js';

import { gitWriteTools } from './git-write.tools.js';
import { optInt, PROJECT_ID, S, schema, str, tool } from './tool-helpers.js';

const FILE = S.string('File path relative to the repository root.');

function getGit(path: string, args: JsonObject, ctx: ToolContext, extra: Record<string, string | number> = {}): Promise<unknown> {
  return ctx.api.dispatch({ method: 'GET', path: `/api/git/${path}`, query: { project: str(args, 'projectId'), ...extra } });
}

const gitReadTools: ToolDefinition[] = [
  tool({
    name: 'git_status',
    description: 'Show the working tree state of a project: branch, staged, modified, untracked and deleted files.',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['GET /api/git/status'],
    run: (args, ctx) => getGit('status', args, ctx),
  }),
  tool({
    name: 'git_diff',
    description: 'Show the unified diff of one changed file in the working tree.',
    inputSchema: schema({ projectId: PROJECT_ID, file: FILE }, ['projectId', 'file']),
    covers: ['GET /api/git/diff'],
    run: (args, ctx) => getGit('diff', args, ctx, { file: str(args, 'file') }),
  }),
  tool({
    name: 'git_file_with_diff',
    description: 'Return a file with its old and new content plus the diff, as the editor diff view shows it.',
    inputSchema: schema({ projectId: PROJECT_ID, file: FILE }, ['projectId', 'file']),
    covers: ['GET /api/git/file-with-diff'],
    run: (args, ctx) => getGit('file-with-diff', args, ctx, { file: str(args, 'file') }),
  }),
  tool({
    name: 'git_branches',
    description: 'List local and remote branches of a project and which one is checked out.',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['GET /api/git/branches'],
    run: (args, ctx) => getGit('branches', args, ctx),
  }),
  tool({
    name: 'git_commits',
    description: 'List recent commits of the current branch (server caps limit at 100, default 10).',
    inputSchema: schema({ projectId: PROJECT_ID, limit: S.integer('Number of commits to return.') }, ['projectId']),
    covers: ['GET /api/git/commits'],
    run: (args, ctx) => {
      const limit = optInt(args, 'limit');
      return getGit('commits', args, ctx, limit === undefined ? {} : { limit });
    },
  }),
  tool({
    name: 'git_commit_diff',
    description: 'Show the diff introduced by one commit; use a hash from git_commits.',
    inputSchema: schema({ projectId: PROJECT_ID, commit: S.string('Commit hash.') }, ['projectId', 'commit']),
    covers: ['GET /api/git/commit-diff'],
    run: (args, ctx) => getGit('commit-diff', args, ctx, { commit: str(args, 'commit') }),
  }),
  tool({
    name: 'git_remote_status',
    description: 'Show how the current branch relates to its remote: ahead/behind counts and whether a remote or upstream exists.',
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: ['GET /api/git/remote-status'],
    run: (args, ctx) => getGit('remote-status', args, ctx),
  }),
  tool({
    name: 'git_compare',
    description: 'Compare the project checkout against another branch or worktree base: lists the files that differ.',
    inputSchema: schema({ projectId: PROJECT_ID, base: S.string('Branch or ref to compare against.') }, ['projectId', 'base']),
    covers: ['GET /api/git/compare'],
    run: (args, ctx) => getGit('compare', args, ctx, { base: str(args, 'base') }),
  }),
  tool({
    name: 'git_compare_diff',
    description: 'Show the diff of one file between the project checkout and a base branch; pick the file from git_compare.',
    inputSchema: schema({ projectId: PROJECT_ID, base: S.string('Branch or ref to compare against.'), file: FILE }, ['projectId', 'base', 'file']),
    covers: ['GET /api/git/compare-diff'],
    run: (args, ctx) => getGit('compare-diff', args, ctx, { base: str(args, 'base'), file: str(args, 'file') }),
  }),
];

export const gitTools: ToolDefinition[] = [...gitReadTools, ...gitWriteTools];
