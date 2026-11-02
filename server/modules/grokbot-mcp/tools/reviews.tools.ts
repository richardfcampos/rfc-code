/**
 * Review Center tools: `/api/reviews`.
 *
 * Reviews are opened by the server when a task with a worktree branch moves to
 * the review stage, so there is no create tool; these read the queue and act
 * on one review.
 */

import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optBool, optInt, optStr, S, schema, seg, str, tool } from './tool-helpers.js';

const REVIEW_ID = S.string('Review id, as returned by review_list.');

const reviewPath = (args: JsonObject): string => `/api/reviews/${seg(str(args, 'reviewId'))}`;

export const reviewTools: ToolDefinition[] = [
  tool({
    name: 'review_list',
    description: 'List reviews in the queue (open and changes_requested by default). Filter by state (comma separated) or project name.',
    inputSchema: schema({
      state: S.string('Comma separated states: open, approved, changes_requested, closed.'),
      project: S.string('Project name to filter by.'),
    }),
    covers: ['GET /api/reviews'],
    run: (args, ctx) => {
      const state = optStr(args, 'state');
      const project = optStr(args, 'project');
      return ctx.api.dispatch({
        method: 'GET',
        path: '/api/reviews',
        query: { ...(state === undefined ? {} : { state }), ...(project === undefined ? {} : { project }) },
      });
    },
  }),
  tool({
    name: 'review_get',
    description: 'Get one review with its task, worktree info, changed files and comments.',
    inputSchema: schema({ reviewId: REVIEW_ID }, ['reviewId']),
    covers: ['GET /api/reviews/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: reviewPath(args) }),
  }),
  tool({
    name: 'review_file_diff',
    description: 'Get the diff of one changed file of a review; the file must be one listed by review_get.',
    inputSchema: schema({ reviewId: REVIEW_ID, file: S.string('File path as listed in the review.') }, ['reviewId', 'file']),
    covers: ['GET /api/reviews/:id/diff'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: `${reviewPath(args)}/diff`, query: { file: str(args, 'file') } }),
  }),
  tool({
    name: 'review_comment',
    description: 'Add a comment to a review on a file, optionally on a specific line. The comment is routed to the task agent.',
    inputSchema: schema(
      {
        reviewId: REVIEW_ID,
        filePath: S.string('File the comment is about.'),
        lineNo: S.integer('Line number in the file.'),
        body: S.string('Comment text.'),
      },
      ['reviewId', 'filePath', 'body'],
    ),
    covers: ['POST /api/reviews/:id/comments'],
    run: (args, ctx) => {
      const lineNo = optInt(args, 'lineNo');
      return ctx.api.dispatch({
        method: 'POST',
        path: `${reviewPath(args)}/comments`,
        body: { filePath: str(args, 'filePath'), body: str(args, 'body'), ...(lineNo === undefined ? {} : { lineNo }) },
      });
    },
  }),
  tool({
    name: 'review_approve',
    description: 'Approve a review and merge its worktree branch. squash collapses to one commit (use message); removeWorktree deletes the worktree after merging.',
    inputSchema: schema(
      {
        reviewId: REVIEW_ID,
        squash: S.boolean('Squash-merge into a single commit.'),
        message: S.string('Commit message for the squash merge.'),
        removeWorktree: S.boolean('Remove the worktree after merging.'),
      },
      ['reviewId'],
    ),
    covers: ['POST /api/reviews/:id/approve'],
    run: (args, ctx) => {
      const body: JsonObject = {};
      const squash = optBool(args, 'squash');
      const message = optStr(args, 'message');
      const removeWorktree = optBool(args, 'removeWorktree');
      if (squash !== undefined) body.squash = squash;
      if (message !== undefined) body.message = message;
      if (removeWorktree !== undefined) body.removeWorktree = removeWorktree;
      return ctx.api.dispatch({ method: 'POST', path: `${reviewPath(args)}/approve`, body });
    },
  }),
  tool({
    name: 'review_request_changes',
    description: 'Send a review back with requested changes; the optional body is posted as a comment and routed to the task agent.',
    inputSchema: schema({ reviewId: REVIEW_ID, body: S.string('What needs to change.') }, ['reviewId']),
    covers: ['POST /api/reviews/:id/request-changes'],
    run: (args, ctx) => {
      const body = optStr(args, 'body');
      return ctx.api.dispatch({
        method: 'POST',
        path: `${reviewPath(args)}/request-changes`,
        body: body === undefined ? {} : { body },
      });
    },
  }),
];
