import assert from 'node:assert/strict';
import test from 'node:test';

import { assetTools } from '@/modules/grokbot-mcp/tools/assets.tools.js';
import { fileTools } from '@/modules/grokbot-mcp/tools/files.tools.js';
import { sessionTools } from '@/modules/grokbot-mcp/tools/sessions.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

async function call(tools: typeof fileTools, name: string, args: Record<string, unknown> = {}) {
  const { request } = await runToolAndCapture(tools, name, args);
  return request;
}

test('file read tools use their distinct query names', async () => {
  const tree = await call(fileTools, 'file_tree', { projectId: 'p1' });
  assert.equal(tree?.method, 'GET');
  assert.equal(tree?.path, '/api/projects/p1/files');
  const read = await call(fileTools, 'file_read', { projectId: 'p1', filePath: 'src/a.ts' });
  assert.equal(read?.path, '/api/projects/p1/file');
  assert.deepEqual(read?.query, { filePath: 'src/a.ts' });
  const bytes = await call(fileTools, 'file_read_bytes', { projectId: 'p1', path: 'logo.png' });
  assert.equal(bytes?.path, '/api/projects/p1/files/content');
  assert.deepEqual(bytes?.query, { path: 'logo.png' });
  assert.equal(bytes?.responseType, 'bytes');
  await assert.rejects(call(fileTools, 'file_read', { projectId: 'p1' }), ToolInputError);
});

test('file_write allows empty content but not a missing one', async () => {
  const request = await call(fileTools, 'file_write', { projectId: 'p1', filePath: 'a.txt', content: '' });
  assert.equal(request?.method, 'PUT');
  assert.equal(request?.path, '/api/projects/p1/file');
  assert.deepEqual(request?.body, { filePath: 'a.txt', content: '' });
  await assert.rejects(call(fileTools, 'file_write', { projectId: 'p1', filePath: 'a.txt' }), ToolInputError);
});

test('file_create, file_rename and file_delete bodies', async () => {
  const create = await call(fileTools, 'file_create', { projectId: 'p1', name: 'x.ts', type: 'file', path: 'src' });
  assert.equal(create?.method, 'POST');
  assert.equal(create?.path, '/api/projects/p1/files/create');
  assert.deepEqual(create?.body, { name: 'x.ts', type: 'file', path: 'src' });
  assert.deepEqual((await call(fileTools, 'file_create', { projectId: 'p1', name: 'd', type: 'directory' }))?.body, { name: 'd', type: 'directory' });
  await assert.rejects(call(fileTools, 'file_create', { projectId: 'p1', name: 'd', type: 'link' }), ToolInputError);
  const rename = await call(fileTools, 'file_rename', { projectId: 'p1', oldPath: 'a.ts', newName: 'b.ts' });
  assert.equal(rename?.method, 'PUT');
  assert.equal(rename?.path, '/api/projects/p1/files/rename');
  assert.deepEqual(rename?.body, { oldPath: 'a.ts', newName: 'b.ts' });
  const del = await call(fileTools, 'file_delete', { projectId: 'p1', path: 'a.ts' });
  assert.equal(del?.method, 'DELETE');
  assert.equal(del?.path, '/api/projects/p1/files');
  assert.deepEqual(del?.body, { path: 'a.ts' });
  await assert.rejects(call(fileTools, 'file_delete', { projectId: 'p1' }), ToolInputError);
});

test('file_upload builds a multipart request with the files field', async () => {
  const request = await call(fileTools, 'file_upload', {
    projectId: 'p1',
    files: [{ name: 'a.txt', contentBase64: 'YQ==', mimeType: 'text/plain' }, { name: 'b.bin', contentBase64: 'Yg==' }],
    targetPath: 'docs',
  });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/projects/p1/files/upload');
  assert.deepEqual(request?.multipart, {
    files: [
      { field: 'files', fileName: 'a.txt', contentBase64: 'YQ==', mimeType: 'text/plain' },
      { field: 'files', fileName: 'b.bin', contentBase64: 'Yg==' },
    ],
    fields: { targetPath: 'docs', requestedFileCount: '2' },
  });
  await assert.rejects(call(fileTools, 'file_upload', { projectId: 'p1', files: [] }), ToolInputError);
  await assert.rejects(call(fileTools, 'file_upload', { projectId: 'p1', files: [{ name: 'a' }] }), ToolInputError);
});

test('session_create posts provider, projectPath and optional profile', async () => {
  const request = await call(sessionTools, 'session_create', { provider: 'claude', projectPath: '/srv/p', profileId: 'pr1' });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/providers/sessions');
  assert.deepEqual(request?.body, { provider: 'claude', projectPath: '/srv/p', profileId: 'pr1' });
  assert.deepEqual((await call(sessionTools, 'session_create', { provider: 'codex', projectPath: '/p' }))?.body, { provider: 'codex', projectPath: '/p' });
  await assert.rejects(call(sessionTools, 'session_create', { provider: 'claude' }), ToolInputError);
});

test('session list, restore, archive and delete routes', async () => {
  assert.equal((await call(sessionTools, 'session_list_running'))?.path, '/api/providers/sessions/running');
  assert.equal((await call(sessionTools, 'session_list_archived'))?.path, '/api/providers/sessions/archived');
  const restore = await call(sessionTools, 'session_restore', { sessionId: 's1' });
  assert.equal(restore?.method, 'POST');
  assert.equal(restore?.path, '/api/providers/sessions/s1/restore');
  const archive = await call(sessionTools, 'session_archive', { sessionId: 's1' });
  assert.equal(archive?.method, 'DELETE');
  assert.equal(archive?.path, '/api/providers/sessions/s1');
  assert.equal(archive?.query, undefined);
  const hard = await call(sessionTools, 'session_delete', { sessionId: 's1' });
  assert.equal(hard?.path, '/api/providers/sessions/s1');
  assert.deepEqual(hard?.query, { force: true });
  await assert.rejects(call(sessionTools, 'session_delete', {}), ToolInputError);
});

test('session_rename passes taskId through only when the key is present', async () => {
  const withTask = await call(sessionTools, 'session_rename', { sessionId: 's1', summary: 'T', taskId: 't9' });
  assert.equal(withTask?.method, 'PUT');
  assert.equal(withTask?.path, '/api/providers/sessions/s1');
  assert.deepEqual(withTask?.body, { summary: 'T', taskId: 't9' });
  assert.deepEqual((await call(sessionTools, 'session_rename', { sessionId: 's1', summary: 'T', taskId: null }))?.body, { summary: 'T', taskId: null });
  assert.deepEqual((await call(sessionTools, 'session_rename', { sessionId: 's1', summary: 'T' }))?.body, { summary: 'T' });
  await assert.rejects(call(sessionTools, 'session_rename', { sessionId: 's1' }), ToolInputError);
  await assert.rejects(call(sessionTools, 'session_rename', { sessionId: 's1', summary: 'T', taskId: 4 }), ToolInputError);
});

test('session_messages and session_token_usage', async () => {
  const messages = await call(sessionTools, 'session_messages', { sessionId: 's1', limit: 50, offset: 0 });
  assert.equal(messages?.path, '/api/providers/sessions/s1/messages');
  assert.deepEqual(messages?.query, { limit: 50, offset: 0 });
  assert.deepEqual((await call(sessionTools, 'session_messages', { sessionId: 's1' }))?.query, {});
  const usage = await call(sessionTools, 'session_token_usage', { projectId: 'p1', sessionId: 's1' });
  assert.equal(usage?.method, 'GET');
  assert.equal(usage?.path, '/api/projects/p1/sessions/s1/token-usage');
});

test('session_search collects SSE until done or error', async () => {
  const request = await call(sessionTools, 'session_search', { q: 'bug', limit: 5 });
  assert.equal(request?.path, '/api/providers/search/sessions');
  assert.deepEqual(request?.query, { q: 'bug', limit: 5 });
  assert.equal(request?.responseType, 'sse');
  assert.equal(request?.sseUntil?.({ event: 'done' }), true);
  assert.equal(request?.sseUntil?.({ event: 'error' }), true);
  assert.equal(request?.sseUntil?.({ event: 'result' }), false);
  await assert.rejects(call(sessionTools, 'session_search', {}), ToolInputError);
});

test('session_set_active_model, caveman mode and handoff', async () => {
  const model = await call(sessionTools, 'session_set_active_model', { provider: 'claude', sessionId: 's1', model: 'opus' });
  assert.equal(model?.method, 'POST');
  assert.equal(model?.path, '/api/providers/claude/sessions/s1/active-model');
  assert.deepEqual(model?.body, { model: 'opus' });
  const caveman = await call(sessionTools, 'session_set_caveman_mode', { sessionId: 's1', cavemanMode: 'full' });
  assert.equal(caveman?.method, 'PATCH');
  assert.equal(caveman?.path, '/api/profiles/sessions/s1/tooling');
  assert.deepEqual(caveman?.body, { cavemanMode: 'full' });
  const cleared = await call(sessionTools, 'session_set_caveman_mode', { sessionId: 's1', cavemanMode: null });
  assert.ok(cleared?.body && 'cavemanMode' in (cleared.body as object));
  assert.deepEqual(cleared?.body, { cavemanMode: null });
  await assert.rejects(call(sessionTools, 'session_set_caveman_mode', { sessionId: 's1', cavemanMode: 'max' }), ToolInputError);
  await assert.rejects(call(sessionTools, 'session_set_caveman_mode', { sessionId: 's1' }), ToolInputError);
  const handoff = await call(sessionTools, 'session_handoff_profile', { sessionId: 's1', profileId: 'pr2' });
  assert.equal(handoff?.method, 'POST');
  assert.equal(handoff?.path, '/api/profiles/sessions/s1/handoff');
  assert.deepEqual(handoff?.body, { profileId: 'pr2' });
});

test('asset uploads use the images and files multipart fields', async () => {
  const image = await call(assetTools, 'asset_upload_image', { fileName: 'a.png', contentBase64: 'AA==', mimeType: 'image/png' });
  assert.equal(image?.method, 'POST');
  assert.equal(image?.path, '/api/assets/images');
  assert.deepEqual(image?.multipart, { files: [{ field: 'images', fileName: 'a.png', contentBase64: 'AA==', mimeType: 'image/png' }] });
  const file = await call(assetTools, 'asset_upload_file', { fileName: 'n.txt', contentBase64: 'AA==' });
  assert.equal(file?.path, '/api/assets/files');
  assert.deepEqual(file?.multipart, { files: [{ field: 'files', fileName: 'n.txt', contentBase64: 'AA==' }] });
  await assert.rejects(call(assetTools, 'asset_upload_file', { fileName: 'n.txt' }), ToolInputError);
});

test('asset_download picks the store and requests bytes', async () => {
  const request = await call(assetTools, 'asset_download', { kind: 'images', filename: 'x y.png' });
  assert.equal(request?.method, 'GET');
  assert.equal(request?.path, '/api/assets/images/x%20y.png');
  assert.equal(request?.responseType, 'bytes');
  assert.equal((await call(assetTools, 'asset_download', { kind: 'files', filename: 'n.txt' }))?.path, '/api/assets/files/n.txt');
  await assert.rejects(call(assetTools, 'asset_download', { kind: 'videos', filename: 'n' }), ToolInputError);
});
