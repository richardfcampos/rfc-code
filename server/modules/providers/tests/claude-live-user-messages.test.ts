import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const SESSION_ID = 'session-live';
const COMMAND_PAYLOAD =
  '<command-message>ai-architect</command-message>\n<command-name>/ai-architect</command-name>\n<command-args>SPEC: fix scope</command-args>';
const SKILL_BODY = 'Base directory for this skill: /home/me/.claude/skills/ai-architect\n\n# AI-Driven Systems Architect\n\nAct as...';

function userEvent(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    uuid: 'u-live',
    timestamp: '2026-11-02T20:00:00.000Z',
    type: 'user',
    message: { role: 'user', content },
    ...extra,
  };
}

test('live SDK event: a slash command expansion in a content block is remapped like the transcript row', () => {
  const provider = new ClaudeSessionsProvider();

  const fromBlocks = provider.normalizeMessage(userEvent([{ type: 'text', text: COMMAND_PAYLOAD }]), SESSION_ID);
  const fromString = provider.normalizeMessage(userEvent(COMMAND_PAYLOAD), SESSION_ID);

  for (const messages of [fromBlocks, fromString]) {
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].isLocalCommand, true);
    assert.equal(messages[0].content, '/ai-architect SPEC: fix scope');
    assert.equal(messages[0].commandName, '/ai-architect');
    assert.equal(messages[0].commandArgs, 'SPEC: fix scope');
  }
});

test('live SDK event: the injected skill instructions never reach the chat, flagged or not', () => {
  const provider = new ClaudeSessionsProvider();

  assert.deepEqual(provider.normalizeMessage(userEvent([{ type: 'text', text: SKILL_BODY }]), SESSION_ID), []);
  assert.deepEqual(provider.normalizeMessage(userEvent([{ type: 'text', text: SKILL_BODY }], { isMeta: true }), SESSION_ID), []);
  assert.deepEqual(provider.normalizeMessage(userEvent(SKILL_BODY), SESSION_ID), []);
});

test('live SDK event: local command stdout in a content block becomes assistant text', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage(
    userEvent([{ type: 'text', text: '<local-command-stdout>\u001B[1mdone\u001B[0m</local-command-stdout>' }]),
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].isLocalCommandStdout, true);
  assert.equal(messages[0].content, 'done');
});

test('live SDK event: an ordinary user block with an image keeps its image on the remapped message', () => {
  const provider = new ClaudeSessionsProvider();
  const messages = provider.normalizeMessage(
    userEvent([
      { type: 'text', text: 'look at this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
    ]),
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'look at this');
  assert.deepEqual(messages[0].images, [{ data: 'data:image/png;base64,QUJD' }]);
});
