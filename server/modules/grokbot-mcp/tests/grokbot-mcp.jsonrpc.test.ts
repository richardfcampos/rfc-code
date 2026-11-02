import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JSON_RPC_ERRORS,
  MCP_PROTOCOL_VERSION,
  handleJsonRpcPayload,
  type ToolRegistry,
} from '@/modules/grokbot-mcp/grokbot-mcp.jsonrpc.js';
import { ToolInputError, schema, S, tool } from '@/modules/grokbot-mcp/tools/tool-helpers.js';
import { assertToolInvariants, createToolRegistry } from '@/modules/grokbot-mcp/tools/index.js';
import type { JsonRpcResponse, ToolDefinition } from '@/modules/grokbot-mcp/grokbot-mcp.types.js';

import { createFakeToolContext } from './support/fake-tool-context.js';

const echo = tool({
  name: 'echo_tool',
  description: 'Echoes the given message back to the caller.',
  inputSchema: schema({ message: S.string('Message to echo.') }, ['message']),
  covers: ['GET /api/echo'],
  run: async (args) => ({ echoed: args.message }),
});

const failing = tool({
  name: 'failing_tool',
  description: 'Always fails with a server-style error.',
  inputSchema: schema({}),
  covers: ['GET /api/fail'],
  run: async () => {
    const error = new Error('Task not found') as Error & { status?: number; code?: string };
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  },
});

const badInput = tool({
  name: 'bad_input_tool',
  description: 'Rejects its input at the tool layer.',
  inputSchema: schema({ value: S.string('Anything.') }),
  covers: ['GET /api/bad'],
  run: async () => {
    throw new ToolInputError('value must look different.');
  },
});

function registry(definitions: ToolDefinition[] = [echo, failing, badInput]): ToolRegistry {
  return createToolRegistry(definitions);
}

function single(response: JsonRpcResponse | JsonRpcResponse[] | null): JsonRpcResponse {
  assert.ok(response && !Array.isArray(response));
  return response;
}

test('initialize reports protocol version, tools capability and server info', async () => {
  const response = single(await handleJsonRpcPayload({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, registry(), createFakeToolContext()));
  assert.ok('result' in response);
  const result = response.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } };
  assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.ok(result.capabilities.tools);
  assert.equal(result.serverInfo.name, 'rfc-code-grokbot');
});

test('tools/list exposes name, description and inputSchema only', async () => {
  const response = single(await handleJsonRpcPayload({ jsonrpc: '2.0', id: 'a', method: 'tools/list' }, registry(), createFakeToolContext()));
  assert.ok('result' in response);
  const { tools } = response.result as { tools: Array<Record<string, unknown>> };
  assert.equal(tools.length, 3);
  assert.deepEqual(Object.keys(tools[0]!).sort(), ['description', 'inputSchema', 'name']);
});

test('tools/call runs the tool and wraps the result as text content', async () => {
  const response = single(await handleJsonRpcPayload(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo_tool', arguments: { message: 'hi' } } },
    registry(),
    createFakeToolContext(),
  ));
  assert.ok('result' in response);
  const result = response.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0]!.text), { echoed: 'hi' });
});

test('tools/call reports a failing tool as isError with status and code', async () => {
  const response = single(await handleJsonRpcPayload(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'failing_tool', arguments: {} } },
    registry(),
    createFakeToolContext(),
  ));
  assert.ok('result' in response);
  const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(result.isError, true);
  assert.equal(result.content[0]!.text, '404 TASK_NOT_FOUND: Task not found');
});

test('tools/call answers -32602 when a required argument is missing or the tool rejects input', async () => {
  const missing = single(await handleJsonRpcPayload(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo_tool', arguments: {} } },
    registry(),
    createFakeToolContext(),
  ));
  assert.ok('error' in missing);
  assert.equal(missing.error.code, JSON_RPC_ERRORS.INVALID_PARAMS);

  const rejected = single(await handleJsonRpcPayload(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bad_input_tool', arguments: { value: 'x' } } },
    registry(),
    createFakeToolContext(),
  ));
  assert.ok('error' in rejected);
  assert.equal(rejected.error.code, JSON_RPC_ERRORS.INVALID_PARAMS);
});

test('unknown tool and unknown method answer -32601', async () => {
  const unknownTool = single(await handleJsonRpcPayload(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } },
    registry(),
    createFakeToolContext(),
  ));
  assert.ok('error' in unknownTool);
  assert.equal(unknownTool.error.code, JSON_RPC_ERRORS.METHOD_NOT_FOUND);

  const unknownMethod = single(await handleJsonRpcPayload({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, registry(), createFakeToolContext()));
  assert.ok('error' in unknownMethod);
  assert.equal(unknownMethod.error.code, JSON_RPC_ERRORS.METHOD_NOT_FOUND);
});

test('notifications and id-less requests produce no response', async () => {
  assert.equal(await handleJsonRpcPayload({ jsonrpc: '2.0', method: 'notifications/initialized' }, registry(), createFakeToolContext()), null);
  assert.equal(await handleJsonRpcPayload({ jsonrpc: '2.0', method: 'ping' }, registry(), createFakeToolContext()), null);
});

test('batches answer each request that has an id and reject an empty batch', async () => {
  const batch = await handleJsonRpcPayload(
    [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo_tool', arguments: { message: 'b' } } },
    ],
    registry(),
    createFakeToolContext(),
  );
  assert.ok(Array.isArray(batch));
  assert.equal(batch.length, 2);

  const empty = single(await handleJsonRpcPayload([], registry(), createFakeToolContext()));
  assert.ok('error' in empty);
  assert.equal(empty.error.code, JSON_RPC_ERRORS.INVALID_REQUEST);
});

test('non-object payloads are invalid requests', async () => {
  const response = single(await handleJsonRpcPayload('nope', registry(), createFakeToolContext()));
  assert.ok('error' in response);
  assert.equal(response.error.code, JSON_RPC_ERRORS.INVALID_REQUEST);
});

test('registry invariants reject duplicates, bad names, short descriptions and dangling required keys', () => {
  assert.throws(() => assertToolInvariants([echo, echo]), /Duplicate tool name/);
  assert.throws(() => assertToolInvariants([{ ...echo, name: 'Echo-Tool' }]), /snake_case/);
  assert.throws(() => assertToolInvariants([{ ...echo, description: 'short' }]), /description/);
  assert.throws(
    () => assertToolInvariants([{ ...echo, inputSchema: { type: 'object', properties: {}, required: ['missing'] } }]),
    /not in properties/,
  );
  assert.throws(() => assertToolInvariants([{ ...echo, covers: ['FETCH /api/x'] }]), /malformed route/);
  assert.doesNotThrow(() => assertToolInvariants([echo, failing, badInput]));
});
