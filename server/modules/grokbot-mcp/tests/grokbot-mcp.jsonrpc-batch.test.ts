import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JSON_RPC_ERRORS,
  MAX_BATCH_SIZE,
  handleJsonRpcPayload,
} from '@/modules/grokbot-mcp/grokbot-mcp.jsonrpc.js';
import { createToolRegistry } from '@/modules/grokbot-mcp/tools/index.js';
import { S, schema, tool } from '@/modules/grokbot-mcp/tools/tool-helpers.js';
import type { JsonRpcResponse, ToolDefinition } from '@/modules/grokbot-mcp/grokbot-mcp.types.js';

import { createFakeToolContext } from './support/fake-tool-context.js';

function registry(definitions: ToolDefinition[]) {
  return createToolRegistry(definitions);
}

function single(response: JsonRpcResponse | JsonRpcResponse[] | null): JsonRpcResponse {
  assert.ok(response && !Array.isArray(response));
  return response;
}

test('a required argument given as null is passed to the tool, not rejected', async () => {
  const nullable = tool({
    name: 'nullable_tool',
    description: 'Accepts an explicit null for its required argument.',
    inputSchema: schema({ value: S.string('Anything, or null.') }, ['value']),
    covers: ['GET /api/nullable'],
    run: async (args) => ({ received: args.value }),
  });
  const response = single(await handleJsonRpcPayload(
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'nullable_tool', arguments: { value: null } } },
    registry([nullable]),
    createFakeToolContext(),
  ));
  assert.ok('result' in response);
  const result = response.result as { content: Array<{ text: string }> };
  assert.deepEqual(JSON.parse(result.content[0]!.text), { received: null });
});

test('batches run sequentially and an oversized batch is refused', async () => {
  const order: number[] = [];
  const slow = tool({
    name: 'slow_tool',
    description: 'Records the order in which batch entries ran.',
    inputSchema: schema({ n: S.integer('Position.') }, ['n']),
    covers: ['GET /api/slow'],
    run: async (args) => {
      await new Promise((resolve) => setTimeout(resolve, args.n === 1 ? 30 : 1));
      order.push(args.n as number);
      return { n: args.n };
    },
  });
  const batch = await handleJsonRpcPayload(
    [1, 2, 3].map((n) => ({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'slow_tool', arguments: { n } } })),
    registry([slow]),
    createFakeToolContext(),
  );
  assert.ok(Array.isArray(batch) && batch.length === 3);
  assert.deepEqual(order, [1, 2, 3]);

  const oversized = single(await handleJsonRpcPayload(
    Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, index) => ({ jsonrpc: '2.0', id: index, method: 'ping' })),
    registry([slow]),
    createFakeToolContext(),
  ));
  assert.ok('error' in oversized);
  assert.equal(oversized.error.code, JSON_RPC_ERRORS.INVALID_REQUEST);
});
