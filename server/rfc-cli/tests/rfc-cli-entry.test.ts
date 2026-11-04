import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseRfcArgs } from '../rfc-cli-args.js';
import { dispatch } from '../rfc-cli.js';

test('dispatch reads the prompt from --file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfc-cli-entry-'));
  const promptPath = path.join(dir, 'prompt.md');
  fs.writeFileSync(promptPath, 'from a file\n');
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const output = await dispatch(parseRfcArgs(['send', 'sess-1', '--file', promptPath]), async (name, args) => {
    calls.push({ name, args });
    return name === 'session_send' ? { sessionId: 'sess-1', provider: 'claude', started: true } : { lastSeq: 1 };
  });
  assert.equal(calls[0].args?.content, 'from a file\n');
  assert.equal(output.text, 'sent sess-1 seq=1');
});

test('dispatch rejects an empty or missing prompt file with a usage error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfc-cli-entry-'));
  const empty = path.join(dir, 'empty.md');
  fs.writeFileSync(empty, '   ');
  await assert.rejects(dispatch(parseRfcArgs(['send', 's', '--file', empty]), async () => ({})), /prompt file is empty/);
  await assert.rejects(dispatch(parseRfcArgs(['send', 's', '--file', path.join(dir, 'nope.md')]), async () => ({})), /Could not read/);
});

test('help never touches the server', async () => {
  const output = await dispatch(parseRfcArgs(['--help']), async () => {
    throw new Error('must not be called');
  });
  assert.match(output.text, /rfc send <sessionId>/);
});
