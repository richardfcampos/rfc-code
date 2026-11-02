import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewTools } from '@/modules/grokbot-mcp/tools/reviews.tools.js';
import { taskTools } from '@/modules/grokbot-mcp/tools/tasks.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

test('task_list queries by project name', async () => {
  const { request } = await runToolAndCapture(taskTools, 'task_list', { project: 'demo' });
  assert.equal(request?.method, 'GET');
  assert.equal(request?.path, '/api/tasks');
  assert.deepEqual(request?.query, { project: 'demo' });
});

test('task_create sends required fields and only the given optionals', async () => {
  const minimal = await runToolAndCapture(taskTools, 'task_create', { project: 'demo', title: 'T' });
  assert.equal(minimal.request?.method, 'POST');
  assert.equal(minimal.request?.path, '/api/tasks');
  assert.deepEqual(minimal.request?.body, { project: 'demo', title: 'T' });
  const full = await runToolAndCapture(taskTools, 'task_create', {
    project: 'demo', title: 'T', description: 'd', origin: 'agent', origin_detail: 'od',
    assignee_profile_id: 'pr', suggested_skill: 'sk', worktree_branch: 'wb',
  });
  assert.deepEqual(full.request?.body, {
    project: 'demo', title: 'T', description: 'd', origin: 'agent', origin_detail: 'od',
    assignee_profile_id: 'pr', suggested_skill: 'sk', worktree_branch: 'wb',
  });
});

test('task_get and task_delete address the task by id', async () => {
  const get = await runToolAndCapture(taskTools, 'task_get', { taskId: 't 1' });
  assert.equal(get.request?.method, 'GET');
  assert.equal(get.request?.path, '/api/tasks/t%201');
  const del = await runToolAndCapture(taskTools, 'task_delete', { taskId: 't1' });
  assert.equal(del.request?.method, 'DELETE');
  assert.equal(del.request?.path, '/api/tasks/t1');
});

test('task_update sends a PATCH with only the given fields, allowing null to clear', async () => {
  const stage = await runToolAndCapture(taskTools, 'task_update', { taskId: 't1', stage: 'done' });
  assert.equal(stage.request?.method, 'PATCH');
  assert.equal(stage.request?.path, '/api/tasks/t1');
  assert.deepEqual(stage.request?.body, { stage: 'done' });
  const clear = await runToolAndCapture(taskTools, 'task_update', { taskId: 't1', title: 'N', worktree_branch: null });
  assert.deepEqual(clear.request?.body, { title: 'N', worktree_branch: null });
});

test('task_evidence_add and task_evidence_delete map to the evidence routes', async () => {
  const add = await runToolAndCapture(taskTools, 'task_evidence_add', { taskId: 't1', kind: 'note', content: 'c' });
  assert.equal(add.request?.method, 'POST');
  assert.equal(add.request?.path, '/api/tasks/t1/evidence');
  assert.deepEqual(add.request?.body, { kind: 'note', content: 'c' });
  const withAttachment = await runToolAndCapture(taskTools, 'task_evidence_add', {
    taskId: 't1', kind: 'attachment', content: 'c', attachment_id: 'a1',
  });
  assert.deepEqual(withAttachment.request?.body, { kind: 'attachment', content: 'c', attachment_id: 'a1' });
  const del = await runToolAndCapture(taskTools, 'task_evidence_delete', { taskId: 't1', evidenceId: 'e1' });
  assert.equal(del.request?.method, 'DELETE');
  assert.equal(del.request?.path, '/api/tasks/t1/evidence/e1');
});

test('task attachment tools use multipart upload, byte download and delete', async () => {
  const add = await runToolAndCapture(taskTools, 'task_attachment_add', {
    taskId: 't1', fileName: 'a.txt', contentBase64: 'aGk=', mimeType: 'text/plain',
  });
  assert.equal(add.request?.method, 'POST');
  assert.equal(add.request?.path, '/api/tasks/t1/attachments');
  assert.deepEqual(add.request?.multipart, {
    files: [{ field: 'file', fileName: 'a.txt', contentBase64: 'aGk=', mimeType: 'text/plain' }],
  });
  const noMime = await runToolAndCapture(taskTools, 'task_attachment_add', { taskId: 't1', fileName: 'a', contentBase64: 'aGk=' });
  assert.deepEqual(noMime.request?.multipart, { files: [{ field: 'file', fileName: 'a', contentBase64: 'aGk=' }] });

  const download = await runToolAndCapture(taskTools, 'task_attachment_download', { taskId: 't1', attachmentId: 'a1' });
  assert.equal(download.request?.method, 'GET');
  assert.equal(download.request?.path, '/api/tasks/t1/attachments/a1/download');
  assert.equal(download.request?.responseType, 'bytes');

  const del = await runToolAndCapture(taskTools, 'task_attachment_delete', { taskId: 't1', attachmentId: 'a1' });
  assert.equal(del.request?.method, 'DELETE');
  assert.equal(del.request?.path, '/api/tasks/t1/attachments/a1');
});

test('task decomposition tools map to the subtasks routes', async () => {
  const subtasks = [{ title: 'a' }, { title: 'b', dependsOn: [0] }];
  const decompose = await runToolAndCapture(taskTools, 'task_decompose', { taskId: 't1', subtasks, origin_detail: 'od' });
  assert.equal(decompose.request?.method, 'POST');
  assert.equal(decompose.request?.path, '/api/tasks/t1/subtasks');
  assert.deepEqual(decompose.request?.body, { subtasks, origin_detail: 'od' });
  const list = await runToolAndCapture(taskTools, 'task_subtasks', { taskId: 't1' });
  assert.equal(list.request?.method, 'GET');
  assert.equal(list.request?.path, '/api/tasks/t1/subtasks');
  const ready = await runToolAndCapture(taskTools, 'task_subtasks_ready', { taskId: 't1' });
  assert.equal(ready.request?.path, '/api/tasks/t1/subtasks/ready');
});

test('task tools reject missing required arguments', async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['task_list', {}], ['task_create', { project: 'p' }], ['task_create', { title: 't' }], ['task_get', {}],
    ['task_update', {}], ['task_delete', {}], ['task_evidence_add', { taskId: 't', kind: 'note' }],
    ['task_evidence_delete', { taskId: 't' }], ['task_attachment_add', { taskId: 't', fileName: 'f' }],
    ['task_attachment_download', { taskId: 't' }], ['task_attachment_delete', { taskId: 't' }],
    ['task_subtasks', {}], ['task_subtasks_ready', {}],
  ];
  for (const [name, args] of cases) {
    await assert.rejects(runToolAndCapture(taskTools, name, args), ToolInputError, name);
  }
});

test('review_list sends only the given filters', async () => {
  const all = await runToolAndCapture(reviewTools, 'review_list', {});
  assert.equal(all.request?.method, 'GET');
  assert.equal(all.request?.path, '/api/reviews');
  assert.deepEqual(all.request?.query, {});
  const filtered = await runToolAndCapture(reviewTools, 'review_list', { state: 'open,approved', project: 'demo' });
  assert.deepEqual(filtered.request?.query, { state: 'open,approved', project: 'demo' });
});

test('review_get and review_file_diff address the review', async () => {
  const get = await runToolAndCapture(reviewTools, 'review_get', { reviewId: 'r1' });
  assert.equal(get.request?.method, 'GET');
  assert.equal(get.request?.path, '/api/reviews/r1');
  const diff = await runToolAndCapture(reviewTools, 'review_file_diff', { reviewId: 'r1', file: 'a/b.ts' });
  assert.equal(diff.request?.path, '/api/reviews/r1/diff');
  assert.deepEqual(diff.request?.query, { file: 'a/b.ts' });
});

test('review_comment posts file, body and optional line', async () => {
  const noLine = await runToolAndCapture(reviewTools, 'review_comment', { reviewId: 'r1', filePath: 'a.ts', body: 'hm' });
  assert.equal(noLine.request?.method, 'POST');
  assert.equal(noLine.request?.path, '/api/reviews/r1/comments');
  assert.deepEqual(noLine.request?.body, { filePath: 'a.ts', body: 'hm' });
  const withLine = await runToolAndCapture(reviewTools, 'review_comment', { reviewId: 'r1', filePath: 'a.ts', lineNo: 7, body: 'hm' });
  assert.deepEqual(withLine.request?.body, { filePath: 'a.ts', lineNo: 7, body: 'hm' });
});

test('review_approve and review_request_changes map to their routes', async () => {
  const bare = await runToolAndCapture(reviewTools, 'review_approve', { reviewId: 'r1' });
  assert.equal(bare.request?.method, 'POST');
  assert.equal(bare.request?.path, '/api/reviews/r1/approve');
  assert.deepEqual(bare.request?.body, {});
  const full = await runToolAndCapture(reviewTools, 'review_approve', { reviewId: 'r1', squash: true, message: 'm', removeWorktree: true });
  assert.deepEqual(full.request?.body, { squash: true, message: 'm', removeWorktree: true });

  const changes = await runToolAndCapture(reviewTools, 'review_request_changes', { reviewId: 'r1', body: 'fix' });
  assert.equal(changes.request?.path, '/api/reviews/r1/request-changes');
  assert.deepEqual(changes.request?.body, { body: 'fix' });
  const empty = await runToolAndCapture(reviewTools, 'review_request_changes', { reviewId: 'r1' });
  assert.deepEqual(empty.request?.body, {});
});

test('review tools reject missing required arguments', async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['review_get', {}], ['review_file_diff', { reviewId: 'r' }], ['review_comment', { reviewId: 'r', filePath: 'f' }],
    ['review_comment', { reviewId: 'r', body: 'b' }], ['review_approve', {}], ['review_request_changes', {}],
  ];
  for (const [name, args] of cases) {
    await assert.rejects(runToolAndCapture(reviewTools, name, args), ToolInputError, name);
  }
});
