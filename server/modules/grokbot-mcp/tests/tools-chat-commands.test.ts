import assert from 'node:assert/strict';
import test from 'node:test';

import { chatTools } from '@/modules/grokbot-mcp/tools/chat.tools.js';
import { commandTools } from '@/modules/grokbot-mcp/tools/commands.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { createFakeToolContext, runToolAndCapture } from './support/fake-tool-context.js';

const find = (name: string) => [...chatTools, ...commandTools].find((entry) => entry.name === name);

test('chat tools and shell_exec are in-process (covers empty); command tools cover their routes', () => {
  for (const name of ['session_send', 'session_abort', 'session_status', 'session_events', 'session_pending_approvals', 'session_approve_tool', 'shell_exec']) {
    assert.deepEqual(find(name)?.covers, [], name);
  }
  assert.deepEqual(find('command_list')?.covers, ['POST /api/commands/list']);
  assert.deepEqual(find('command_execute')?.covers, ['POST /api/commands/execute']);
});

test('session_send forwards only the defined keys, plus the key owner as userId', async () => {
  const { ctx } = await runToolAndCapture(chatTools, 'session_send', { sessionId: 's1', content: 'hi' });
  assert.deepEqual(ctx.chat.calls, [{ method: 'send', args: [{ sessionId: 's1', content: 'hi', userId: 1 }] }]);
  assert.equal(ctx.api.calls.length, 0);
});

test('session_send forwards every optional field exactly', async () => {
  const toolsSettings = { allowedTools: ['Read'], skipPermissions: false };
  const images = [{ name: 'a.png', data: 'x' }];
  const { ctx } = await runToolAndCapture(chatTools, 'session_send', {
    sessionId: 's1', content: 'hi', model: 'm', effort: 'high', permissionMode: 'plan', toolsSettings, images, wait: true, timeoutMs: 5000,
  });
  assert.deepEqual(ctx.chat.calls[0].args[0], {
    sessionId: 's1', content: 'hi', userId: 1, model: 'm', effort: 'high', permissionMode: 'plan', toolsSettings, images, wait: true, timeoutMs: 5000,
  });
});

test('session_send takes userId from the context, never from the arguments', async () => {
  const ctx = createFakeToolContext();
  ctx.user = { id: 42, username: 'owner' };
  await runToolAndCapture(chatTools, 'session_send', { sessionId: 's1', content: 'hi', userId: 999 }, ctx);
  assert.equal((ctx.chat.calls[0].args[0] as { userId?: number }).userId, 42);
});

test('session_send rejects missing or invalid arguments', async () => {
  await assert.rejects(runToolAndCapture(chatTools, 'session_send', { content: 'hi' }), ToolInputError);
  await assert.rejects(runToolAndCapture(chatTools, 'session_send', { sessionId: 's1', content: ' ' }), ToolInputError);
  await assert.rejects(runToolAndCapture(chatTools, 'session_send', { sessionId: 's1', content: 'hi', permissionMode: 'yolo' }), ToolInputError);
  await assert.rejects(runToolAndCapture(chatTools, 'session_send', { sessionId: 's1', content: 'hi', images: 'x' }), ToolInputError);
  await assert.rejects(runToolAndCapture(chatTools, 'session_send', { sessionId: 's1', content: 'hi', wait: 'yes' }), ToolInputError);
});

test('session_send description tells the model how to use it', () => {
  const description = find('session_send')?.description ?? '';
  assert.match(description, /session_create/);
  assert.match(description, /wait=true/);
  assert.match(description, /120s/);
  assert.match(description, /session_status/);
  assert.match(description, /session_events/);
});

test('session_abort, session_status and session_pending_approvals call the gateway with the session id', async () => {
  for (const [name, method] of [['session_abort', 'abort'], ['session_status', 'status'], ['session_pending_approvals', 'pendingApprovals']] as const) {
    const { ctx } = await runToolAndCapture(chatTools, name, { sessionId: 's9' });
    assert.deepEqual(ctx.chat.calls, [{ method, args: ['s9'] }], name);
    await assert.rejects(runToolAndCapture(chatTools, name, {}), ToolInputError, name);
  }
});

test('session_events defaults afterSeq to 0 and forwards a given value', async () => {
  const first = await runToolAndCapture(chatTools, 'session_events', { sessionId: 's1' });
  assert.deepEqual(first.ctx.chat.calls, [{ method: 'events', args: ['s1', 0] }]);
  const second = await runToolAndCapture(chatTools, 'session_events', { sessionId: 's1', afterSeq: 7 });
  assert.deepEqual(second.ctx.chat.calls, [{ method: 'events', args: ['s1', 7] }]);
  await assert.rejects(runToolAndCapture(chatTools, 'session_events', {}), ToolInputError);
  await assert.rejects(runToolAndCapture(chatTools, 'session_events', { sessionId: 's1', afterSeq: 1.5 }), ToolInputError);
});

test('session_approve_tool forwards the decision and optional fields', async () => {
  const minimal = await runToolAndCapture(chatTools, 'session_approve_tool', { requestId: 'r1', allow: false });
  assert.deepEqual(minimal.ctx.chat.calls, [{ method: 'approveTool', args: [{ requestId: 'r1', allow: false }] }]);
  const full = await runToolAndCapture(chatTools, 'session_approve_tool', { requestId: 'r1', allow: true, updatedInput: { a: 1 }, message: 'ok' });
  assert.deepEqual(full.ctx.chat.calls[0].args[0], { requestId: 'r1', allow: true, updatedInput: { a: 1 }, message: 'ok' });
  const scoped = await runToolAndCapture(chatTools, 'session_approve_tool', { requestId: 'r1', allow: true, sessionId: 's1' });
  assert.deepEqual(scoped.ctx.chat.calls[0].args[0], { requestId: 'r1', allow: true, sessionId: 's1' });
  assert.match(find('session_approve_tool')?.description ?? '', /UNKNOWN_REQUEST/);
  await assert.rejects(runToolAndCapture(chatTools, 'session_approve_tool', { allow: true }), ToolInputError);
  await assert.rejects(runToolAndCapture(chatTools, 'session_approve_tool', { requestId: 'r1' }), ToolInputError);
});

test('command_list posts projectPath only when given', async () => {
  const withPath = await runToolAndCapture(commandTools, 'command_list', { projectPath: '/tmp/x' });
  assert.equal(withPath.request?.method, 'POST');
  assert.equal(withPath.request?.path, '/api/commands/list');
  assert.deepEqual(withPath.request?.body, { projectPath: '/tmp/x' });
  const without = await runToolAndCapture(commandTools, 'command_list', {});
  assert.deepEqual(without.request?.body, {});
});

test('command_execute posts the given fields only', async () => {
  const minimal = await runToolAndCapture(commandTools, 'command_execute', { commandName: '/help' });
  assert.equal(minimal.request?.method, 'POST');
  assert.equal(minimal.request?.path, '/api/commands/execute');
  assert.deepEqual(minimal.request?.body, { commandName: '/help' });
  const context = { provider: 'claude', projectPath: '/tmp/x' };
  const full = await runToolAndCapture(commandTools, 'command_execute', { commandName: 'deploy', commandPath: '/p/deploy.md', args: ['a', 'b'], context });
  assert.deepEqual(full.request?.body, { commandName: 'deploy', commandPath: '/p/deploy.md', args: ['a', 'b'], context });
  await assert.rejects(runToolAndCapture(commandTools, 'command_execute', {}), ToolInputError);
  await assert.rejects(runToolAndCapture(commandTools, 'command_execute', { commandName: 'x', args: 'a' }), ToolInputError);
});

test('shell_exec resolves projectId to the project path', async () => {
  const { ctx, result } = await runToolAndCapture(commandTools, 'shell_exec', { projectId: 'p1', command: 'ls', timeoutMs: 1000 });
  assert.deepEqual(ctx.shell.calls, [{ cwd: '/tmp/project-one', command: 'ls', timeoutMs: 1000 }]);
  assert.equal((result as { stdout: string }).stdout, 'ok');
  assert.equal(ctx.api.calls.length, 0);
});

test('shell_exec prefers an explicit cwd and omits timeoutMs when absent', async () => {
  const { ctx } = await runToolAndCapture(commandTools, 'shell_exec', { projectId: 'p1', cwd: '/tmp/worktree', command: 'pwd' });
  assert.deepEqual(ctx.shell.calls, [{ cwd: '/tmp/worktree', command: 'pwd' }]);
});

test('shell_exec requires a command, a project or cwd, and a known projectId', async () => {
  await assert.rejects(runToolAndCapture(commandTools, 'shell_exec', { projectId: 'p1' }), ToolInputError);
  await assert.rejects(runToolAndCapture(commandTools, 'shell_exec', { command: 'ls' }), /projectId or cwd is required/);
  await assert.rejects(runToolAndCapture(commandTools, 'shell_exec', { projectId: 'nope', command: 'ls' }), /projectId is unknown/);
  const ctx = createFakeToolContext();
  await assert.rejects(find('shell_exec')!.run({ projectId: 'nope', command: 'ls' }, ctx), ToolInputError);
  assert.equal(ctx.shell.calls.length, 0);
});
