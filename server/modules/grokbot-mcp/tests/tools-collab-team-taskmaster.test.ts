import assert from 'node:assert/strict';
import test from 'node:test';

import { collabTeamTools } from '@/modules/grokbot-mcp/tools/collab-team.tools.js';
import { taskmasterTools } from '@/modules/grokbot-mcp/tools/taskmaster.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';
import type { HttpMethod } from '@/modules/grokbot-mcp/grokbot-mcp.types.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

type Case = {
  name: string;
  args: Record<string, unknown>;
  method: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
};

const participants = [{ profileId: 'a', role: 'critic' }, { profileId: 'b' }];

const collabCases: Case[] = [
  { name: 'collab_list', args: {}, method: 'GET', path: '/api/collaborations', query: { projectPath: undefined } },
  { name: 'collab_list', args: { projectPath: '/p' }, method: 'GET', path: '/api/collaborations', query: { projectPath: '/p' } },
  {
    name: 'collab_create',
    args: { topic: 't', projectPath: '/p', mode: 'debate', participants, maxRounds: 3, budget: { tokens: 10 } },
    method: 'POST',
    path: '/api/collaborations',
    body: { topic: 't', projectPath: '/p', mode: 'debate', participants, maxRounds: 3, budget: { tokens: 10 } },
  },
  {
    name: 'collab_create',
    args: { topic: 't', projectPath: '/p', mode: 'vote', participants },
    method: 'POST',
    path: '/api/collaborations',
    body: { topic: 't', projectPath: '/p', mode: 'vote', participants },
  },
  { name: 'collab_get', args: { collaborationId: 'c1' }, method: 'GET', path: '/api/collaborations/c1' },
  { name: 'collab_stop', args: { collaborationId: 'c1' }, method: 'POST', path: '/api/collaborations/c1/stop' },
  { name: 'collab_delete', args: { collaborationId: 'c1' }, method: 'DELETE', path: '/api/collaborations/c1' },
  { name: 'team_view', args: {}, method: 'GET', path: '/api/team-view' },
  {
    name: 'agent_message_list',
    args: { sessionId: 's1', box: 'inbox', state: 'queued' },
    method: 'GET',
    path: '/api/agent-messages',
    query: { sessionId: 's1', box: 'inbox', state: 'queued' },
  },
  {
    name: 'agent_message_list',
    args: { sessionId: 's1' },
    method: 'GET',
    path: '/api/agent-messages',
    query: { sessionId: 's1', box: undefined, state: undefined },
  },
];

const taskmasterCases: Case[] = [
  { name: 'taskmaster_installation_status', args: {}, method: 'GET', path: '/api/taskmaster/installation-status' },
  { name: 'taskmaster_tasks', args: { projectId: 'p1' }, method: 'GET', path: '/api/taskmaster/tasks/p1' },
  { name: 'taskmaster_init', args: { projectId: 'p1' }, method: 'POST', path: '/api/taskmaster/init/p1' },
  {
    name: 'taskmaster_add_task',
    args: { projectId: 'p1', prompt: 'x', title: 'T', description: 'D', priority: 'high', dependencies: '1,2' },
    method: 'POST',
    path: '/api/taskmaster/add-task/p1',
    body: { prompt: 'x', title: 'T', description: 'D', priority: 'high', dependencies: '1,2' },
  },
  { name: 'taskmaster_add_task', args: { projectId: 'p1', prompt: 'x' }, method: 'POST', path: '/api/taskmaster/add-task/p1', body: { prompt: 'x' } },
  {
    name: 'taskmaster_update_task',
    args: { projectId: 'p1', taskId: '3.2', status: 'done' },
    method: 'PUT',
    path: '/api/taskmaster/update-task/p1/3.2',
    body: { status: 'done' },
  },
  {
    name: 'taskmaster_update_task',
    args: { projectId: 'p1', taskId: '3', title: 'N', description: 'd', priority: 'low', details: 'x', prompt: 'p' },
    method: 'PUT',
    path: '/api/taskmaster/update-task/p1/3',
    body: { title: 'N', description: 'd', priority: 'low', details: 'x', prompt: 'p' },
  },
  {
    name: 'taskmaster_parse_prd',
    args: { projectId: 'p1', fileName: 'a.txt', numTasks: 5, append: true },
    method: 'POST',
    path: '/api/taskmaster/parse-prd/p1',
    body: { fileName: 'a.txt', numTasks: 5, append: true },
  },
  { name: 'taskmaster_parse_prd', args: { projectId: 'p1' }, method: 'POST', path: '/api/taskmaster/parse-prd/p1', body: {} },
  { name: 'prd_list', args: { projectId: 'p1' }, method: 'GET', path: '/api/taskmaster/prd/p1' },
  { name: 'prd_get', args: { projectId: 'p1', fileName: 'a b.txt' }, method: 'GET', path: '/api/taskmaster/prd/p1/a%20b.txt' },
  {
    name: 'prd_save',
    args: { projectId: 'p1', fileName: 'a.txt', content: '# PRD' },
    method: 'POST',
    path: '/api/taskmaster/prd/p1',
    body: { fileName: 'a.txt', content: '# PRD' },
  },
  { name: 'prd_templates', args: {}, method: 'GET', path: '/api/taskmaster/prd-templates' },
  {
    name: 'prd_apply_template',
    args: { projectId: 'p1', templateId: 'web', fileName: 'w.txt', customizations: { name: 'X' } },
    method: 'POST',
    path: '/api/taskmaster/apply-template/p1',
    body: { templateId: 'web', fileName: 'w.txt', customizations: { name: 'X' } },
  },
  { name: 'prd_apply_template', args: { projectId: 'p1', templateId: 'web' }, method: 'POST', path: '/api/taskmaster/apply-template/p1', body: { templateId: 'web' } },
  { name: 'preview_config_get', args: { projectId: 'p1' }, method: 'GET', path: '/api/preview/config/p1' },
  {
    name: 'preview_config_set',
    args: { projectId: 'p1', command: 'npm run dev', setupCommand: 'npm i', bindHost: '127.0.0.1', port: 4000 },
    method: 'PUT',
    path: '/api/preview/config/p1',
    body: { command: 'npm run dev', setupCommand: 'npm i', bindHost: '127.0.0.1', port: 4000 },
  },
  { name: 'preview_config_set', args: { projectId: 'p1', command: 'c' }, method: 'PUT', path: '/api/preview/config/p1', body: { command: 'c' } },
  { name: 'preview_start', args: { projectId: 'p1', cwd: '/wt' }, method: 'POST', path: '/api/preview/start/p1', body: { cwd: '/wt' } },
  { name: 'preview_start', args: { projectId: 'p1' }, method: 'POST', path: '/api/preview/start/p1', body: {} },
  { name: 'preview_status', args: { projectId: 'p1', cwd: '/wt' }, method: 'GET', path: '/api/preview/status/p1', query: { cwd: '/wt' } },
  { name: 'preview_status', args: { projectId: 'p1' }, method: 'GET', path: '/api/preview/status/p1', query: { cwd: undefined } },
  { name: 'preview_stop', args: { projectId: 'p1', cwd: '/wt' }, method: 'POST', path: '/api/preview/stop/p1', body: { cwd: '/wt' } },
];

function register(label: string, tools: Parameters<typeof runToolAndCapture>[0], cases: Case[]): void {
  for (const entry of cases) {
    test(`${entry.name} maps to ${entry.method} ${entry.path}`, async () => {
      const { request } = await runToolAndCapture(tools, entry.name, entry.args);
      assert.equal(request?.method, entry.method);
      assert.equal(request?.path, entry.path);
      assert.deepEqual(request?.body, entry.body);
      assert.deepEqual(request?.query, entry.query);
    });
  }
  test(`every ${label} tool is covered by a mapping case`, () => {
    const tested = new Set(cases.map((entry) => entry.name));
    assert.deepEqual(tools.map((entry) => entry.name).filter((name) => !tested.has(name)), []);
  });
}

register('collab/team', collabTeamTools, collabCases);
register('taskmaster/preview', taskmasterTools, taskmasterCases);

const missing: Array<[string, Record<string, unknown>]> = [
  ['collab_create', { topic: 't', projectPath: '/p', mode: 'debate' }],
  ['collab_create', { topic: 't', projectPath: '/p', mode: 'debate', participants: [] }],
  ['collab_create', { projectPath: '/p', mode: 'debate', participants }],
  ['collab_get', {}],
  ['collab_stop', {}],
  ['collab_delete', {}],
  ['agent_message_list', {}],
  ['taskmaster_tasks', {}],
  ['taskmaster_init', {}],
  ['taskmaster_add_task', {}],
  ['taskmaster_update_task', { projectId: 'p1' }],
  ['taskmaster_parse_prd', {}],
  ['prd_list', {}],
  ['prd_get', { projectId: 'p1' }],
  ['prd_save', { projectId: 'p1', fileName: 'a.txt' }],
  ['prd_apply_template', { projectId: 'p1' }],
  ['preview_config_get', {}],
  ['preview_config_set', { projectId: 'p1' }],
  ['preview_start', {}],
  ['preview_status', {}],
  ['preview_stop', {}],
];

for (const [name, args] of missing) {
  test(`${name} rejects missing required arguments`, async () => {
    await assert.rejects(() => runToolAndCapture([...collabTeamTools, ...taskmasterTools], name, args), ToolInputError);
  });
}
