import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNotifyHubRequestBody,
  formatDuration,
  formatTime,
  resolveProjectName,
} from '@/modules/notifications/services/notify-hub-payload.js';

const TIMEZONE = 'America/Sao_Paulo';
// Fixed instant so every time assertion is absolute: 14:05Z is 11:05 in São Paulo.
const NOW = Date.parse('2026-09-13T14:05:00Z');

const project = {
  project_id: 'p1',
  project_path: '/workspace/meu-projeto',
  custom_project_name: null,
  notifyEnabled: 1,
};

function event(code, meta = {}) {
  return { provider: 'claude', sessionId: 'sess-1', code, meta };
}

function build(code, meta, overrides = {}) {
  return buildNotifyHubRequestBody({
    event: event(code, meta),
    project,
    timezone: TIMEZONE,
    now: NOW,
    ...overrides,
  });
}

test('titles and priority follow the event code', () => {
  const completed = build('run.stopped', { stopReason: 'completed' });
  assert.equal(completed.title, '✅ meu-projeto — concluído');
  assert.equal(completed.priority, 'default');

  const aborted = build('run.stopped', { stopReason: 'aborted' });
  assert.equal(aborted.title, '⏹ meu-projeto — interrompido');
  assert.equal(aborted.priority, 'default');

  const failed = build('run.failed', { error: 'boom' });
  assert.equal(failed.title, '❌ meu-projeto — falhou');
  assert.equal(failed.priority, 'high');

  const permission = build('permission.required', { toolName: 'Bash' });
  assert.equal(permission.title, '🙋 meu-projeto — precisa de você');
  assert.equal(permission.priority, 'high');
});

test('startedAt turns the time line into a span with duration', () => {
  const body = build('run.stopped', {
    stopReason: 'completed',
    startedAt: NOW - 12 * 60_000,
    sessionName: 'Minha Sessão',
  });

  assert.equal(body.message, 'Início 10:53 · Fim 11:05 (12min)\nSessão: Minha Sessão');
});

test('without startedAt only the end time is shown', () => {
  const body = build('run.stopped', { stopReason: 'completed' });

  assert.equal(body.message, 'Fim 11:05');
});

test('formatTime renders the configured zone, not the server zone', () => {
  assert.equal(formatTime(NOW, TIMEZONE), '11:05');
  assert.equal(formatTime(NOW, 'UTC'), '14:05');
});

test('duration formatting covers sub-minute, minutes and hours', () => {
  assert.equal(formatDuration(45_000), '<1min');
  assert.equal(formatDuration(12 * 60_000), '12min');
  assert.equal(formatDuration(64 * 60_000), '1h 04min');
  // A startedAt ahead of now (clock skew) must not produce a negative duration.
  assert.equal(formatDuration(-5_000), '<1min');
});

test('an invalid timezone falls back to the server zone instead of throwing', () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const body = buildNotifyHubRequestBody({
      event: event('run.stopped', { stopReason: 'completed' }),
      project,
      timezone: 'Mars/Olympus',
      now: NOW,
    });

    assert.match(body.message, /^Fim \d{2}:\d{2}$/);
  } finally {
    console.warn = originalWarn;
  }
});

test('the error line is capped at 200 chars', () => {
  const body = build('run.failed', { error: 'x'.repeat(400) });
  const errorLine = body.message.split('\n').find((line) => line.startsWith('Erro: '));

  const errorText = errorLine.slice('Erro: '.length);
  assert.equal(errorText.length, 200);
  assert.ok(errorText.endsWith('…'));
});

test('permission body names the tool, or stays generic without one', () => {
  assert.match(build('permission.required', { toolName: 'Bash' }).message, /Ferramenta "Bash" aguarda aprovação/);
  assert.match(build('permission.required', {}).message, /Uma ferramenta aguarda aprovação/);
});

test('the custom project name wins over the folder name', () => {
  assert.equal(resolveProjectName(project), 'meu-projeto');
  assert.equal(resolveProjectName({ ...project, custom_project_name: '  RFC Code  ' }), 'RFC Code');

  const body = buildNotifyHubRequestBody({
    event: event('run.stopped', { stopReason: 'completed' }),
    project: { ...project, custom_project_name: 'RFC Code' },
    timezone: TIMEZONE,
    now: NOW,
  });
  assert.equal(body.title, '✅ RFC Code — concluído');
  assert.equal(body.metadata.project, 'RFC Code');
});

test('metadata carries the routing event plus project and session context', () => {
  assert.equal(build('run.stopped', { stopReason: 'completed' }).metadata.event, 'end');
  // An aborted run is still an end for routing purposes; only the title differs.
  assert.equal(build('run.stopped', { stopReason: 'aborted' }).metadata.event, 'end');
  assert.equal(build('run.failed', { error: 'boom' }).metadata.event, 'failed');
  assert.equal(build('permission.required', { toolName: 'Bash' }).metadata.event, 'needs-input');

  assert.deepEqual(build('run.stopped', { stopReason: 'completed' }).metadata, {
    event: 'end',
    project: 'meu-projeto',
    projectPath: '/workspace/meu-projeto',
    provider: 'claude',
    sessionId: 'sess-1',
    timestamp: '2026-09-13T14:05:00.000Z',
  });
});

test('the session name is normalised and the whole message is capped', () => {
  const body = build('run.failed', {
    error: 'y'.repeat(400),
    sessionName: `  ${'s'.repeat(120)}  `,
    startedAt: NOW - 64 * 60_000,
  });

  const sessionLine = body.message.split('\n')[1];
  assert.equal(sessionLine.slice('Sessão: '.length).length, 80);
  assert.ok(body.message.length <= 500);
  assert.match(body.message, /^Início 10:01 · Fim 11:05 \(1h 04min\)/);
});
