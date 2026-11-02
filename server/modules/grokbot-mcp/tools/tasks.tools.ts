/**
 * Task board tools: `/api/tasks` plus evidence, attachments and decomposition.
 *
 * Tasks are keyed by `project` = the project name (not the registry id), and
 * `task_update` forwards only the fields the caller gave so a partial update
 * never clears anything by accident; an explicit null clears a nullable field.
 */

import type { JsonObject, ToolDefinition } from '../grokbot-mcp.types.js';

import { optStr, pick, S, schema, seg, str, tool, TASK_STAGES } from './tool-helpers.js';

const TASK_ID = S.string('Task id, as returned by task_list.');
const ORIGINS = ['user', 'agent', 'automation'] as const;
const EVIDENCE_KINDS = ['note', 'link', 'attachment'] as const;

const NULLABLE_TASK_FIELDS: Record<string, JsonObject> = {
  description: S.string('Task description.'),
  assignee_profile_id: S.string('Profile id the task is assigned to.'),
  suggested_skill: S.string('Skill the agent should use for this task.'),
  worktree_branch: S.string('Worktree branch carrying the work; moving to review with it opens a review.'),
};

const taskPath = (args: JsonObject): string => `/api/tasks/${seg(str(args, 'taskId'))}`;

export const taskTools: ToolDefinition[] = [
  tool({
    name: 'task_list',
    description: 'List the board tasks of a project (by project name) with their stage. Use first to find task ids.',
    inputSchema: schema({ project: S.string('Board key: the project registry id (projectId from project_list), which is what the UI and the agent bridge use as project_name.') }, ['project']),
    covers: ['GET /api/tasks'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: '/api/tasks', query: { project: str(args, 'project') } }),
  }),
  tool({
    name: 'task_create',
    description: 'Create a task on the board of a project, starting in backlog. Use origin agent when an agent files it on its own.',
    inputSchema: schema(
      {
        project: S.string('Board key: the project registry id (projectId from project_list).'),
        title: S.string('Short task title (max 500 chars).'),
        origin: S.enumOf(ORIGINS, 'Who created the task; default user.'),
        origin_detail: S.string('Free-form detail about the origin, e.g. the session or automation.'),
        ...NULLABLE_TASK_FIELDS,
      },
      ['project', 'title'],
    ),
    covers: ['POST /api/tasks'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST',
        path: '/api/tasks',
        body: {
          project: str(args, 'project'),
          title: str(args, 'title'),
          ...pick(args, ['origin', 'origin_detail', ...Object.keys(NULLABLE_TASK_FIELDS)]),
        },
      }),
  }),
  tool({
    name: 'task_get',
    description: 'Get one task with its attachments and evidence.',
    inputSchema: schema({ taskId: TASK_ID }, ['taskId']),
    covers: ['GET /api/tasks/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: taskPath(args) }),
  }),
  tool({
    name: 'task_update',
    description:
      'Update a task. Only the fields you pass change; null clears description, assignee_profile_id, suggested_skill or worktree_branch. Changing stage moves the card between board columns.',
    inputSchema: schema(
      {
        taskId: TASK_ID,
        title: S.string('New title.'),
        stage: S.enumOf(TASK_STAGES, 'New board stage.'),
        ...NULLABLE_TASK_FIELDS,
      },
      ['taskId'],
    ),
    covers: ['PATCH /api/tasks/:id'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'PATCH', path: taskPath(args), body: pick(args, ['title', 'stage', ...Object.keys(NULLABLE_TASK_FIELDS)]) }),
  }),
  tool({
    name: 'task_delete',
    description: 'Delete a task and its evidence and attachments. Destructive.',
    inputSchema: schema({ taskId: TASK_ID }, ['taskId']),
    covers: ['DELETE /api/tasks/:id'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: taskPath(args) }),
  }),
  tool({
    name: 'task_evidence_add',
    description: 'Attach evidence to a task: a note, a link, or a reference to an uploaded attachment (kind attachment plus attachment_id).',
    inputSchema: schema(
      {
        taskId: TASK_ID,
        kind: S.enumOf(EVIDENCE_KINDS, 'Evidence type.'),
        content: S.string('Note text, URL or attachment label (max 10k chars).'),
        attachment_id: S.string('Attachment id when kind is attachment.'),
      },
      ['taskId', 'kind', 'content'],
    ),
    covers: ['POST /api/tasks/:id/evidence'],
    run: (args, ctx) =>
      ctx.api.dispatch({
        method: 'POST', path: `${taskPath(args)}/evidence`,
        body: { kind: str(args, 'kind'), content: str(args, 'content'), ...pick(args, ['attachment_id']) },
      }),
  }),
  tool({
    name: 'task_evidence_delete',
    description: 'Remove one evidence entry from a task.',
    inputSchema: schema({ taskId: TASK_ID, evidenceId: S.string('Evidence id from task_get.') }, ['taskId', 'evidenceId']),
    covers: ['DELETE /api/tasks/:id/evidence/:evidenceId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: `${taskPath(args)}/evidence/${seg(str(args, 'evidenceId'))}` }),
  }),
  tool({
    name: 'task_attachment_add',
    description: 'Upload a file to a task from base64 content. Link it in the task with task_evidence_add kind attachment.',
    inputSchema: schema(
      {
        taskId: TASK_ID,
        fileName: S.string('File name including extension.'),
        contentBase64: S.string('File bytes, base64 encoded.'),
        mimeType: S.string('MIME type; defaults to application/octet-stream.'),
      },
      ['taskId', 'fileName', 'contentBase64'],
    ),
    covers: ['POST /api/tasks/:id/attachments'],
    run: (args, ctx) => {
      const mimeType = optStr(args, 'mimeType');
      const file = { field: 'file', fileName: str(args, 'fileName'), contentBase64: str(args, 'contentBase64') };
      return ctx.api.dispatch({
        method: 'POST',
        path: `${taskPath(args)}/attachments`,
        multipart: { files: [mimeType === undefined ? file : { ...file, mimeType }] },
      });
    },
  }),
  tool({
    name: 'task_attachment_download',
    description: 'Download a task attachment; returns its bytes as base64 with mime type and size.',
    inputSchema: schema({ taskId: TASK_ID, attachmentId: S.string('Attachment id from task_get.') }, ['taskId', 'attachmentId']),
    covers: ['GET /api/tasks/:id/attachments/:attachmentId/download'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'GET', path: `${taskPath(args)}/attachments/${seg(str(args, 'attachmentId'))}/download`, responseType: 'bytes' }),
  }),
  tool({
    name: 'task_attachment_delete',
    description: 'Delete a task attachment and its stored file.',
    inputSchema: schema({ taskId: TASK_ID, attachmentId: S.string('Attachment id from task_get.') }, ['taskId', 'attachmentId']),
    covers: ['DELETE /api/tasks/:id/attachments/:attachmentId'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'DELETE', path: `${taskPath(args)}/attachments/${seg(str(args, 'attachmentId'))}` }),
  }),
  tool({
    name: 'task_decompose',
    description:
      'Split a task into subtasks (max 50). dependsOn lists zero-based indexes of earlier subtasks in the same array that must finish first.',
    inputSchema: schema(
      {
        taskId: TASK_ID,
        subtasks: S.array(
          {
            type: 'object',
            properties: {
              title: S.string('Subtask title.'),
              description: S.string('Subtask description.'),
              skill: S.string('Suggested skill for the subtask.'),
              dependsOn: S.array({ type: 'integer' }, 'Indexes of subtasks in this array it depends on.'),
            },
            required: ['title'],
            additionalProperties: false,
          },
          'Subtasks to create.',
        ),
        origin_detail: S.string('Free-form detail about who decomposed the task.'),
      },
      ['taskId', 'subtasks'],
    ),
    covers: ['POST /api/tasks/:id/subtasks'],
    run: (args, ctx) =>
      ctx.api.dispatch({ method: 'POST', path: `${taskPath(args)}/subtasks`, body: { subtasks: args.subtasks, ...pick(args, ['origin_detail']) } }),
  }),
  tool({
    name: 'task_subtasks',
    description: 'Get the subtask plan of a task: parent, subtasks and their dependencies.',
    inputSchema: schema({ taskId: TASK_ID }, ['taskId']),
    covers: ['GET /api/tasks/:id/subtasks'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: `${taskPath(args)}/subtasks` }),
  }),
  tool({
    name: 'task_subtasks_ready',
    description: 'List the subtasks of a task whose dependencies are all done, i.e. the ones that can start now.',
    inputSchema: schema({ taskId: TASK_ID }, ['taskId']),
    covers: ['GET /api/tasks/:id/subtasks/ready'],
    run: (args, ctx) => ctx.api.dispatch({ method: 'GET', path: `${taskPath(args)}/subtasks/ready` }),
  }),
];
