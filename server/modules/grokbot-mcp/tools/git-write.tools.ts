/**
 * Git mutating tools: `/api/git` POST routes (stage, commit, branches, sync).
 *
 * The server expects `project` in the JSON body for all of them.
 */

import type { JsonObject, ToolContext, ToolDefinition } from '../grokbot-mcp.types.js';

import { optStr, PROJECT_ID, S, schema, str, strArray, tool, LONG_RUNNING_TIMEOUT_MS } from './tool-helpers.js';

const FILE = S.string('File path relative to the repository root.');
const FILES = S.stringArray('File paths relative to the repository root.');
// The server only wires message generation for these two providers.
const MESSAGE_PROVIDERS = ['claude', 'cursor'] as const;
const BRANCH = S.string('Branch name.');

function postGit(path: string, args: JsonObject, ctx: ToolContext, extra: JsonObject = {}): Promise<unknown> {
  // fetch/pull/push/publish and the AI commit message wait on subprocesses; the cap is harmless for the rest.
  return ctx.api.dispatch({ method: 'POST', path: `/api/git/${path}`, body: { project: str(args, 'projectId'), ...extra }, timeoutMs: LONG_RUNNING_TIMEOUT_MS });
}

/** A write tool whose only input is the project. */
function projectOnly(name: string, route: string, description: string): ToolDefinition {
  return tool({
    name,
    description,
    inputSchema: schema({ projectId: PROJECT_ID }, ['projectId']),
    covers: [`POST /api/git/${route}`],
    run: (args, ctx) => postGit(route, args, ctx),
  });
}

/** A write tool with one required string forwarded under the same name. */
function withString(name: string, route: string, field: string, fieldDescription: JsonObject, description: string): ToolDefinition {
  return tool({
    name,
    description,
    inputSchema: schema({ projectId: PROJECT_ID, [field]: fieldDescription }, ['projectId', field]),
    covers: [`POST /api/git/${route}`],
    run: (args, ctx) => postGit(route, args, ctx, { [field]: str(args, field) }),
  });
}

export const gitWriteTools: ToolDefinition[] = [
  tool({
    name: 'git_stage',
    description: 'Stage the given files (git add) so they are included in the next commit.',
    inputSchema: schema({ projectId: PROJECT_ID, files: FILES }, ['projectId', 'files']),
    covers: ['POST /api/git/stage'],
    run: (args, ctx) => postGit('stage', args, ctx, { files: strArray(args, 'files') }),
  }),
  tool({
    name: 'git_unstage',
    description: 'Unstage the given files, keeping their working tree changes.',
    inputSchema: schema({ projectId: PROJECT_ID, files: FILES }, ['projectId', 'files']),
    covers: ['POST /api/git/unstage'],
    run: (args, ctx) => postGit('unstage', args, ctx, { files: strArray(args, 'files') }),
  }),
  withString('git_discard', 'discard', 'file', FILE, 'Discard the working tree changes of one tracked file. Destructive: the edits cannot be recovered.'),
  withString('git_delete_untracked', 'delete-untracked', 'file', FILE, 'Delete one untracked file from disk. Destructive and not recoverable through git.'),
  tool({
    name: 'git_commit',
    description: 'Commit the given files with a message. Use git_generate_commit_message to draft the message first.',
    inputSchema: schema({ projectId: PROJECT_ID, message: S.string('Commit message.'), files: FILES }, ['projectId', 'message', 'files']),
    covers: ['POST /api/git/commit'],
    run: (args, ctx) => postGit('commit', args, ctx, { message: str(args, 'message'), files: strArray(args, 'files') }),
  }),
  tool({
    name: 'git_generate_commit_message',
    description: 'Ask an AI provider (claude or cursor) to draft a commit message for the given files. Does not commit.',
    inputSchema: schema(
      { projectId: PROJECT_ID, files: FILES, provider: S.enumOf(MESSAGE_PROVIDERS, 'Provider that writes the message; default claude.') },
      ['projectId', 'files'],
    ),
    covers: ['POST /api/git/generate-commit-message'],
    run: (args, ctx) => {
      const provider = optStr(args, 'provider');
      return postGit('generate-commit-message', args, ctx, {
        files: strArray(args, 'files'),
        ...(provider === undefined ? {} : { provider }),
      });
    },
  }),
  projectOnly('git_initial_commit', 'initial-commit', 'Create the first commit of a repository that has no commits yet, staging everything.'),
  projectOnly('git_revert_local_commit', 'revert-local-commit', 'Undo the latest local (unpushed) commit, keeping its changes in the working tree.'),
  withString('git_checkout', 'checkout', 'branch', BRANCH, 'Switch the project checkout to an existing branch.'),
  withString('git_create_branch', 'create-branch', 'branch', BRANCH, 'Create a new branch from the current HEAD and switch to it.'),
  withString('git_delete_branch', 'delete-branch', 'branch', BRANCH, 'Delete a local branch. Destructive when the branch has unmerged commits.'),
  projectOnly('git_fetch', 'fetch', 'Fetch from the remote without changing the working tree.'),
  projectOnly('git_pull', 'pull', 'Pull the current branch from its remote and merge it into the checkout.'),
  projectOnly('git_push', 'push', 'Push the current branch to its upstream remote.'),
  withString('git_publish', 'publish', 'branch', BRANCH, 'Push a branch to the remote and set its upstream; use for branches that were never pushed.'),
];
