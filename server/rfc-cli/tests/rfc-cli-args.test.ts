import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRfcArgs, RfcUsageError } from '../rfc-cli-args.js';

test('send with an inline prompt', () => {
  const args = parseRfcArgs(['send', 'sess-1', 'fix the build']);
  assert.deepEqual(args, { command: 'send', positionals: ['sess-1', 'fix the build'], flags: { json: false } });
});

test('send with --file and --json, flags anywhere', () => {
  const args = parseRfcArgs(['--json', 'send', '--file', 'prompt.md', 'sess-1']);
  assert.equal(args.command, 'send');
  assert.deepEqual(args.positionals, ['sess-1']);
  assert.deepEqual(args.flags, { json: true, file: 'prompt.md' });
});

test('send refuses both a prompt and --file, and refuses none', () => {
  assert.throws(() => parseRfcArgs(['send', 'sess-1', 'x', '--file', 'f']), RfcUsageError);
  assert.throws(() => parseRfcArgs(['send', 'sess-1']), RfcUsageError);
});

test('result parses --since as a non-negative integer', () => {
  assert.equal(parseRfcArgs(['result', 'sess-1', '--since', '42']).flags.since, 42);
  assert.throws(() => parseRfcArgs(['result', 'sess-1', '--since', '-1']), /non-negative integer/);
  assert.throws(() => parseRfcArgs(['result', 'sess-1', '--since', 'abc']), /non-negative integer/);
  assert.throws(() => parseRfcArgs(['result', 'sess-1', '--since']), /needs a value/);
});

test('status and notify-test need exactly one positional', () => {
  assert.equal(parseRfcArgs(['status', 'sess-1']).command, 'status');
  assert.throws(() => parseRfcArgs(['status']), RfcUsageError);
  assert.throws(() => parseRfcArgs(['status', 'a', 'b']), RfcUsageError);
  assert.equal(parseRfcArgs(['notify-test', 'ep-1']).positionals[0], 'ep-1');
  assert.throws(() => parseRfcArgs(['notify-test']), RfcUsageError);
});

test('sessions takes an optional --project and no positionals', () => {
  assert.deepEqual(parseRfcArgs(['sessions']).flags, { json: false });
  assert.equal(parseRfcArgs(['sessions', '--project', 'rfc']).flags.project, 'rfc');
  assert.throws(() => parseRfcArgs(['sessions', 'extra']), RfcUsageError);
});

test('help flag wins and unknown input is a usage error', () => {
  assert.equal(parseRfcArgs(['--help']).command, 'help');
  assert.equal(parseRfcArgs(['status', '-h']).command, 'help');
  assert.throws(() => parseRfcArgs([]), /command is required/);
  assert.throws(() => parseRfcArgs(['frobnicate']), /Unknown command/);
  assert.throws(() => parseRfcArgs(['status', 'x', '--verbose']), /Unknown flag/);
});

test('"-" is a valid --file value (stdin)', () => {
  assert.equal(parseRfcArgs(['send', 's', '--file', '-']).flags.file, '-');
});
