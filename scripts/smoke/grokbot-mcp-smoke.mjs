#!/usr/bin/env node
/**
 * Smoke test for the Grokbot MCP endpoint against a REAL server process: boots
 * `server/index.js` on a free port with every data location in a scratch
 * directory, mints an API key over REST, then drives the endpoint like a client
 * (handshake, listing, one round trip per section that needs no provider CLI).
 * Not part of `npm test`:  node scripts/smoke/grokbot-mcp-smoke.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_TOOL_NAMES, bootServer, createApiKey, createMcpClient, createScratchEnvironment, ledger, step,
} from './grokbot-mcp-smoke-helpers.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = createScratchEnvironment();
const server = await bootServer(REPO_ROOT, env);
const { baseUrl } = server;
const mcp = createMcpClient(baseUrl);
const { call, callExpectingError, rpc, rpcRaw } = mcp;

try {
  await step('server boots on a free port', async () => {
    await server.waitForHealth();
    return baseUrl;
  });

  await step('API key created through REST (trusted mode)', async () => {
    const apiKey = await createApiKey(baseUrl, 'grokbot-smoke');
    mcp.setApiKey(apiKey);
    return `key ${apiKey.slice(0, 8)}…`;
  });

  await step('request without a key is refused with 401', async () => {
    const { status, json } = await rpcRaw({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    if (status !== 401 || !json?.error) throw new Error(`got ${status} ${JSON.stringify(json)}`);
  });

  await step('request with a wrong key is refused with 401', async () => {
    const { status } = await rpcRaw({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer nope' });
    if (status !== 401) throw new Error(`got ${status}`);
  });

  await step('initialize handshake', async () => {
    const result = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
    if (!result.protocolVersion || !result.capabilities?.tools) throw new Error(JSON.stringify(result));
    await rpcRaw({ jsonrpc: '2.0', method: 'notifications/initialized' }, mcp.authHeaders());
    return `${result.serverInfo.name} ${result.protocolVersion}`;
  });

  await step('tools/list covers every section', async () => {
    const { tools } = await rpc('tools/list');
    const names = tools.map((tool) => tool.name);
    const missing = EXPECTED_TOOL_NAMES.filter((name) => !names.includes(name));
    if (missing.length) throw new Error(`missing tools: ${missing.join(', ')}`);
    return `${tools.length} tools`;
  });

  await step('unknown tool answers -32601; GET is 405 and DELETE is 204', async () => {
    const { json } = await rpcRaw({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } }, mcp.authHeaders());
    if (json?.error?.code !== -32601) throw new Error(JSON.stringify(json));
    const get = await fetch(`${baseUrl}/api/grokbot-mcp`, { headers: mcp.authHeaders() });
    const del = await fetch(`${baseUrl}/api/grokbot-mcp`, { method: 'DELETE', headers: mcp.authHeaders() });
    if (get.status !== 405 || del.status !== 204) throw new Error(`GET ${get.status}, DELETE ${del.status}`);
  });

  await step('health tool', async () => {
    const health = await call('health');
    if (health.status !== 'ok') throw new Error(JSON.stringify(health));
    return `version ${health.version}`;
  });

  let projectId = '';
  await step('project_create + project_list', async () => {
    const created = await call('project_create', { path: env.repo, customName: 'Smoke Repo' });
    const projects = await call('project_list', { skipSync: true });
    const list = Array.isArray(projects) ? projects : projects.projects ?? [];
    const found = list.find((project) => project.fullPath === env.repo || project.path === env.repo);
    if (!found) throw new Error(`project not listed: ${JSON.stringify(created).slice(0, 200)}`);
    projectId = found.projectId ?? found.id ?? found.name;
    return `projectId ${projectId}`;
  });

  await step('file_write + file_read + file_tree + file_read_bytes', async () => {
    await call('file_write', { projectId, filePath: 'notes.txt', content: 'hello grokbot\n' });
    const read = await call('file_read', { projectId, filePath: 'notes.txt' });
    if (read.content !== 'hello grokbot\n') throw new Error(JSON.stringify(read));
    if (!JSON.stringify(await call('file_tree', { projectId })).includes('notes.txt')) throw new Error('notes.txt missing from tree');
    const bytes = await call('file_read_bytes', { projectId, path: 'notes.txt' });
    if (Buffer.from(bytes.contentBase64, 'base64').toString() !== 'hello grokbot\n') throw new Error(JSON.stringify(bytes));
  });

  await step('git_status + git_stage + git_commit + git_commits + git_branches', async () => {
    const status = await call('git_status', { projectId });
    if (!status.untracked?.includes('notes.txt')) throw new Error(JSON.stringify(status));
    await call('git_stage', { projectId, files: ['notes.txt'] });
    await call('git_commit', { projectId, message: 'chore: add notes', files: ['notes.txt'] });
    const commits = await call('git_commits', { projectId, limit: 10 });
    if ((commits.commits ?? []).length < 2) throw new Error(JSON.stringify(commits));
    const branches = await call('git_branches', { projectId });
    if (!branches.branches?.includes('main')) throw new Error(JSON.stringify(branches));
    return `${commits.commits.length} commits`;
  });

  await step('worktree_list', async () => {
    const worktrees = await call('worktree_list', { projectId });
    if (!Array.isArray(worktrees.worktrees)) throw new Error(JSON.stringify(worktrees));
    return `${worktrees.worktrees.length} worktree(s)`;
  });

  await step('task_create + task_list + task_update + task_get + task_evidence_add + task_delete', async () => {
    const created = await call('task_create', { project: projectId, title: 'Smoke task', description: 'from mcp' });
    const taskId = created.task.id;
    const listed = await call('task_list', { project: projectId });
    if (!listed.tasks.some((task) => task.id === taskId)) throw new Error('task not listed');
    const updated = await call('task_update', { taskId, stage: 'in_progress' });
    if (updated.task.stage !== 'in_progress') throw new Error(JSON.stringify(updated));
    await call('task_evidence_add', { taskId, kind: 'note', content: 'checked by smoke' });
    const detail = await call('task_get', { taskId });
    if (detail.evidence.length !== 1) throw new Error(JSON.stringify(detail));
    await call('task_delete', { taskId });
    await callExpectingError('task_get', { taskId }, 'TASK_NOT_FOUND');
  });

  await step('review_list + automation_list + org_list + profile_list + api_key_list', async () => {
    const reviews = await call('review_list', {});
    const automations = await call('automation_list', {});
    const orgs = await call('org_list', {});
    const profiles = await call('profile_list', {});
    const keys = await call('api_key_list', {});
    if (!Array.isArray(reviews.reviews) || !Array.isArray(automations.automations)) throw new Error('bad shapes');
    if (!Array.isArray(orgs) || !orgs.some((org) => org.isDefault)) throw new Error(`orgs: ${JSON.stringify(orgs)}`);
    if (!Array.isArray(profiles.profiles)) throw new Error(JSON.stringify(profiles));
    if (!keys.apiKeys?.some((key) => key.key_name === 'grokbot-smoke')) throw new Error(JSON.stringify(keys));
    return `${orgs.length} org(s), ${profiles.profiles.length} profile(s)`;
  });

  await step('automation_create + automation_get + automation_delete', async () => {
    const created = await call('automation_create', {
      name: 'smoke cron', trigger_kind: 'cron', trigger_config: { cron: '0 0 1 1 *' },
      action_kind: 'create_task', action_config: { project: projectId, title: 'auto task' }, enabled: false,
    });
    const id = created.automation.automationId;
    const fetched = await call('automation_get', { automationId: id });
    if (fetched.automation.name !== 'smoke cron') throw new Error(JSON.stringify(fetched));
    await call('automation_delete', { automationId: id });
  });

  await step('session_create + session_status + session_list_running + session_rename + caveman null reset', async () => {
    const created = await call('session_create', { provider: 'claude', projectPath: env.repo });
    const status = await call('session_status', { sessionId: created.sessionId });
    if (status.isProcessing !== false) throw new Error(JSON.stringify(status));
    if (!Array.isArray((await call('session_list_running', {})).sessions)) throw new Error('running list');
    await call('session_rename', { sessionId: created.sessionId, summary: 'Smoke session' });
    const reset = await call('session_set_caveman_mode', { sessionId: created.sessionId, cavemanMode: null });
    if (reset.session?.cavemanMode !== null) throw new Error(JSON.stringify(reset));
    return created.sessionId;
  });

  await step('session_send on an unknown session is refused (no provider run attempted)', async () => {
    await callExpectingError('session_send', { sessionId: 'does-not-exist', content: 'hi' }, 'SESSION_NOT_FOUND');
  });

  await step('shell_exec in the project directory', async () => {
    const out = await call('shell_exec', { projectId, command: 'echo smoke-$(basename "$PWD")' });
    if (out.exitCode !== 0 || !out.stdout.includes('smoke-smoke-repo')) throw new Error(JSON.stringify(out));
  });

  await step('rfc_api_call escape hatch (GET /api/auth/status) and refusal of encoded dot segments', async () => {
    const status = await call('rfc_api_call', { method: 'GET', path: '/api/auth/status' });
    if (typeof status.needsSetup !== 'boolean') throw new Error(JSON.stringify(status));
    const { json } = await rpcRaw(
      { jsonrpc: '2.0', id: 77, method: 'tools/call', params: { name: 'rfc_api_call', arguments: { method: 'GET', path: '/api/%2e%2e/index.html' } } },
      mcp.authHeaders(),
    );
    if (json?.error?.code !== -32602) throw new Error(JSON.stringify(json));
  });

  await step('notify_hub_get + git_identity_get + provider_capabilities + plugin_list + team_view', async () => {
    await call('notify_hub_get', {});
    await call('git_identity_get', {});
    const caps = await call('provider_capabilities', {});
    if (!Array.isArray(caps.providers)) throw new Error(JSON.stringify(caps));
    await call('plugin_list', {});
    const team = await call('team_view', {});
    if (!Array.isArray(team.sessions)) throw new Error(JSON.stringify(team));
  });
} finally {
  await server.stop();
}

console.log('');
console.log(`${ledger.results.length - ledger.failures}/${ledger.results.length} steps passed`);
if (ledger.failures > 0) {
  console.log(`server log kept at ${env.logPath}`);
  process.exit(1);
}
env.remove();
