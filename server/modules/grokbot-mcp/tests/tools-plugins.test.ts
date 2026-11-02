import assert from 'node:assert/strict';
import test from 'node:test';

import { pluginTools } from '@/modules/grokbot-mcp/tools/plugins.tools.js';
import { ToolInputError } from '@/modules/grokbot-mcp/tools/tool-helpers.js';

import { runToolAndCapture } from './support/fake-tool-context.js';

test('plugin read/lifecycle tools map to their routes', async () => {
  const cases: Array<[string, Record<string, unknown>, string, string, unknown]> = [
    ['plugin_list', {}, 'GET', '/api/plugins', undefined],
    ['plugin_manifest', { name: 'pl' }, 'GET', '/api/plugins/pl/manifest', undefined],
    ['plugin_install', { url: 'https://github.com/a/b' }, 'POST', '/api/plugins/install', { url: 'https://github.com/a/b' }],
    ['plugin_update', { name: 'pl' }, 'POST', '/api/plugins/pl/update', undefined],
    ['plugin_enable', { name: 'pl', enabled: false }, 'PUT', '/api/plugins/pl/enable', { enabled: false }],
    ['plugin_uninstall', { name: 'pl' }, 'DELETE', '/api/plugins/pl', undefined],
  ];
  for (const [name, args, method, path, body] of cases) {
    const { request } = await runToolAndCapture(pluginTools, name, args);
    assert.equal(request?.method, method, name);
    assert.equal(request?.path, path, name);
    assert.deepEqual(request?.body, body, name);
  }
  await assert.rejects(runToolAndCapture(pluginTools, 'plugin_install', {}), ToolInputError);
  await assert.rejects(runToolAndCapture(pluginTools, 'plugin_enable', { name: 'pl' }), ToolInputError);
});

test('plugin_rpc strips the leading slash, keeps the query and forwards the body', async () => {
  const { request } = await runToolAndCapture(pluginTools, 'plugin_rpc', {
    name: 'pl',
    method: 'post',
    path: '/items/1?limit=5',
    body: { a: 1 },
  });
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, '/api/plugins/pl/rpc/items/1');
  assert.deepEqual(request?.query, { limit: '5' });
  assert.deepEqual(request?.body, { a: 1 });
});

test('plugin_rpc refuses dot segments and unknown methods', async () => {
  await assert.rejects(runToolAndCapture(pluginTools, 'plugin_rpc', { name: 'pl', method: 'GET', path: '../x' }), ToolInputError);
  await assert.rejects(runToolAndCapture(pluginTools, 'plugin_rpc', { name: 'pl', method: 'TRACE', path: 'x' }), ToolInputError);
});
